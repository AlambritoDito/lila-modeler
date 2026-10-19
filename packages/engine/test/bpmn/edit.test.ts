/**
 * `editBpmn` (#98): each operation, all-or-none with diagnostics per operation, both layouts, and
 * that a model made elsewhere (the app's `examples/pedido`, a Bizagi export) keeps everything the
 * edit does not touch: documentation, `lila:` annotations and extended attributes, text
 * annotations, other pools and message flows.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, expect, test } from 'vitest';

import { annotateElement, readAnnotations } from '../../src/bpmn/annotate.js';
import { editBpmn, EditError, EditOperationsSchema, type CallTarget, type EditOperation } from '../../src/bpmn/edit.js';
import { bpmnToOutline, outlineToBpmn } from '../../src/bpmn/outline.js';
import { validateBpmnXml } from '../../src/bpmn/validate-report.js';
import type { ScenarioDocument } from '../../src/project/types.js';
import { expectCleanImport } from '../fixtures/bpmn-import.js';
import { CREDIT, ORDER } from '../fixtures/outlines.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const pedidoXml = readFileSync(`${repo}examples/pedido/model.bpmn`, 'utf8');
const pedidoScenario = JSON.parse(readFileSync(`${repo}examples/pedido/as-is.scenario.json`, 'utf8')) as ScenarioDocument;
const bizagiXml = readFileSync(`${repo}examples/bizagi-exports/bizagi-miwg-A.4.1-roundtrip.bpmn`, 'utf8');

type Box = { x: number; y: number; width: number; height: number };

/** Bounds of every shape and waypoints of every edge, by the id of its BPMN element. */
async function di(xml: string): Promise<{ shapes: Map<string, Box>; edges: Map<string, { x: number; y: number }[]> }> {
  const { rootElement } = await BpmnModdle().fromXML(xml);
  const shapes = new Map<string, Box>();
  const edges = new Map<string, { x: number; y: number }[]>();
  for (const diagram of (rootElement as any).diagrams ?? []) {
    for (const el of diagram.plane.planeElement ?? []) {
      const id = el.bpmnElement?.id as string;
      if (el.$type === 'bpmndi:BPMNShape') shapes.set(id, { x: el.bounds.x, y: el.bounds.y, width: el.bounds.width, height: el.bounds.height });
      else edges.set(id, el.waypoint.map((p: any) => ({ x: p.x, y: p.y })));
    }
  }
  return { shapes, edges };
}

async function credit(): Promise<{ xml: string; scenario: ScenarioDocument }> {
  const built = await outlineToBpmn(CREDIT);
  return { xml: built.xml, scenario: built.scenario };
}

async function errorsOf(xml: string): Promise<string[]> {
  return (await validateBpmnXml(xml)).errors.map((e) => `${e.code} ${e.id}`);
}

async function outlineOf(xml: string, scenario?: ScenarioDocument) {
  return (await bpmnToOutline(xml, { scenario: scenario as Record<string, unknown> | undefined })).outline;
}

async function refused(xml: string, ops: unknown, options: Parameters<typeof editBpmn>[2] = {}): Promise<EditError> {
  try {
    await editBpmn(xml, ops, options);
  } catch (error) {
    expect(error).toBeInstanceOf(EditError);
    return error as EditError;
  }
  throw new Error('the edit was not refused');
}

describe.each([true, false])('each operation (layout %s)', (layout) => {
  test('add after a step: it takes over the outgoing flow; duration and resources go to the base scenario', async () => {
    const { xml, scenario } = await credit();
    const ops: EditOperation[] = [
      { op: 'add', step: { id: 'verify', name: 'Verify identity', duration: '5m', resources: ['Analyst'] }, after: 'receive' },
    ];
    const edit = await editBpmn(xml, ops, { scenario, layout });
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect(edit.changes).toEqual([{ op: 0, message: 'added task "verify" after "receive" in lane "Analyst"' }]);
    const outline = await outlineOf(edit.xml, edit.scenario);
    expect(outline.steps.map((s) => s.id)).toEqual(['receive', 'verify', 'check', 'ok', 'issue', 'reject']);
    expect(outline.steps[1]).toEqual({
      id: 'verify',
      name: 'Verify identity',
      lane: 'Analyst',
      duration: { type: 'constant', value: 300 },
      resources: ['Analyst'],
    });
    // The flow receive → check keeps its id and now ends at the new step.
    expect(edit.xml).toMatch(/<bpmn:sequenceFlow id="Flow_receive_check" sourceRef="receive" targetRef="verify"/);
    expect(edit.scenario?.resources).toEqual({ analyst: { name: 'Analyst', capacity: 1 } });
  });

  test('add: resources with a selection rule, as in an outline', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(xml, [{ op: 'add', step: { id: 'sign', resources: ['Analyst', 'Clerk'], selection: 'or' }, after: 'check' }], { scenario, layout });
    expect((edit.scenario?.elements as Record<string, unknown>)['sign']).toEqual({
      resources: [{ ref: 'analyst', quantity: 1 }, { ref: 'clerk', quantity: 1 }],
      selection: 'or',
    });
    const bad = await refused(xml, [{ op: 'add', step: { id: 'gate', type: 'xor', selection: 'and' } }], { scenario, layout });
    expect(bad.issues[0]).toMatchObject({ op: 0, path: 'step.selection' });
  });

  test('add between two steps keeps the flow (its label and probability) on the first leg', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(xml, [{ op: 'add', step: { id: 'call', name: 'Call customer', lane: 'Customer' }, between: ['ok', 'reject'] }], {
      scenario,
      layout,
    });
    expect(await errorsOf(edit.xml)).toEqual([]);
    const outline = await outlineOf(edit.xml, edit.scenario ?? scenario);
    expect(outline.steps.find((s) => s.id === 'ok')?.branches).toEqual([
      { to: 'issue', label: 'Yes', probability: 0.7 },
      { to: 'call', label: 'No', probability: 0.3 },
    ]);
    expect(outline.steps.find((s) => s.id === 'call')).toEqual({ id: 'call', name: 'Call customer', lane: 'Customer', next: 'reject' });
    expect(edit.scenario).toBeUndefined();
  });

  test('connect: a labelled branch with its probability in the base scenario', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(xml, [{ op: 'connect', from: 'ok', to: 'check', label: 'Ask again', probability: 0 }], { scenario, layout });
    expect(edit.changes[0]!.message).toBe('connected "ok" → "check" (Flow_ok_check)');
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect((edit.scenario?.elements as Record<string, unknown>)['Flow_ok_check']).toEqual({ probability: 0 });
    const branches = (await outlineOf(edit.xml, edit.scenario)).steps.find((s) => s.id === 'ok')?.branches;
    expect(branches).toContainEqual({ to: 'check', label: 'Ask again', probability: 0 });
  });

  test('remove: predecessors go to the successor and the model stays valid', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(xml, [{ op: 'remove', id: 'check' }], { scenario, layout });
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect(edit.removed).toEqual(['Flow_check_ok', 'check']);
    expect(edit.changes[0]!.message).toBe('removed "check"; reconnected receive → ok');
    expect((await outlineOf(edit.xml)).steps.map((s) => s.id)).toEqual(['receive', 'ok', 'issue', 'reject']);
    // A flow can be removed too.
    const flow = await editBpmn(xml, [{ op: 'connect', from: 'ok', to: 'check' }, { op: 'remove', id: 'Flow_ok_check' }], { layout });
    expect(flow.removed).toEqual(['Flow_ok_check']);
  });

  test('rename any element; setType keeps the id, the flows and the annotations', async () => {
    const { xml, scenario } = await credit();
    const annotated = await annotateElement(xml, 'check', { documentation: 'Ask the bureau', refs: { systemRef: ['bureau-api'] } });
    const edit = await editBpmn(
      annotated,
      [
        { op: 'rename', id: 'check', name: 'Check credit bureau' },
        { op: 'rename', id: 'Lane_1', name: 'Applicant' },
        { op: 'setType', id: 'check', type: 'serviceTask' },
      ],
      { scenario, layout },
    );
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect(edit.xml).toMatch(
      /<bpmn:serviceTask id="check" name="Check credit bureau">\s*<bpmn:documentation>Ask the bureau<\/bpmn:documentation>[\s\S]*<bpmn:incoming>Flow_receive_check<\/bpmn:incoming>\s*<bpmn:outgoing>Flow_check_ok<\/bpmn:outgoing>\s*<\/bpmn:serviceTask>/,
    );
    expect((await readAnnotations(edit.xml))['check']).toEqual({ documentation: 'Ask the bureau', refs: { systemRef: ['bureau-api'] } });
    const outline = await outlineOf(edit.xml, scenario);
    expect(outline.lanes).toEqual(['Applicant', 'Analyst']);
    // The scenario key did not change: the duration still applies.
    expect(outline.steps[1]).toMatchObject({ id: 'check', type: 'serviceTask', duration: { type: 'normal', mean: 1200, sd: 300 } });
  });

  test('setType keeps a gateway\'s default flow and its incoming and outgoing flows', async () => {
    const { xml } = await credit();
    const withDefault = xml.replace('<bpmn:exclusiveGateway id="ok" name="Approved?"', '<bpmn:exclusiveGateway id="ok" name="Approved?" default="Flow_ok_issue"');
    const edit = await editBpmn(withDefault, [{ op: 'setType', id: 'ok', type: 'or' }], { layout });
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect(edit.xml).toMatch(
      /<bpmn:inclusiveGateway id="ok" name="Approved\?" default="Flow_ok_issue">\s*<bpmn:incoming>Flow_check_ok<\/bpmn:incoming>\s*<bpmn:outgoing>Flow_ok_issue<\/bpmn:outgoing>\s*<bpmn:outgoing>Flow_ok_reject<\/bpmn:outgoing>/,
    );
    // Removing the default flow clears the reference.
    const removed = await editBpmn(edit.xml, [{ op: 'remove', id: 'Flow_ok_issue' }, { op: 'connect', from: 'ok', to: 'issue' }], { layout });
    expect(removed.xml).toContain('<bpmn:inclusiveGateway id="ok" name="Approved?">');
  });

  test('setType across kinds: task → xor, and a sub-process back to a task drops its content', async () => {
    const built = await outlineToBpmn(ORDER);
    const edit = await editBpmn(built.xml, [{ op: 'setType', id: 'review', type: 'task' }, { op: 'setType', id: 'wait', type: 'task' }], { layout });
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect([...edit.removed].sort()).toEqual(['review_end', 'review_flow', 'review_start']);
    expect(edit.xml).not.toContain('BPMNPlane_review');
    const shapes = (await di(edit.xml)).shapes;
    expect(shapes.get('wait')).toMatchObject({ width: 100, height: 80 });
    const to = await editBpmn(edit.xml, [{ op: 'setType', id: 'wait', type: 'subprocess' }], { layout });
    expect(await errorsOf(to.xml)).toEqual([]);
    expect(to.xml).toContain('<bpmn:subProcess id="wait" name="Wait a day">');
  });

  test('moveToLane takes EndEvent_<id> and EndEvent_<id>_<n>, not another id that starts the same (#630)', async () => {
    const { xml } = await credit();
    const laneOf = async (out: string, id: string) => {
      const { rootElement } = await BpmnModdle().fromXML(out);
      const lanes = (rootElement as any).rootElements.find((e: any) => e.$type === 'bpmn:Process').laneSets[0].lanes;
      return lanes.find((l: any) => (l.flowNodeRef ?? []).some((n: any) => n.id === id))?.id;
    };
    for (const [end, moves] of [['EndEvent_issue_2', true], ['EndEvent_issue_b', false]] as const) {
      const renamed = xml.replaceAll('EndEvent_issue', end);
      const edit = await editBpmn(renamed, [{ op: 'addLane', name: 'Back office', id: 'Lane_back' }, { op: 'moveToLane', id: 'issue', lane: 'Lane_back' }], { layout });
      expect(await laneOf(edit.xml, end) === 'Lane_back').toBe(moves);
    }
  });

  test('moveToLane and addLane', async () => {
    const { xml } = await credit();
    const edit = await editBpmn(
      xml,
      [
        { op: 'addLane', name: 'Back office', id: 'Lane_back' },
        { op: 'addLane', name: 'Front desk', before: 'Customer' },
        { op: 'moveToLane', id: 'issue', lane: 'Lane_back' },
      ],
      { layout },
    );
    expect(await errorsOf(edit.xml)).toEqual([]);
    const outline = await outlineOf(edit.xml);
    expect(outline.lanes).toEqual(['Front desk', 'Customer', 'Analyst', 'Back office']);
    expect(outline.steps.find((s) => s.id === 'issue')?.lane).toBe('Back office');
    // Every node sits inside its lane's band, and the lanes inside the pool.
    const { shapes } = await di(edit.xml);
    const lane = shapes.get('Lane_back')!;
    const issue = shapes.get('issue')!;
    expect(issue.y).toBeGreaterThanOrEqual(lane.y);
    expect(issue.y + issue.height).toBeLessThanOrEqual(lane.y + lane.height);
    // The end event the outline made for "issue" goes with it (#630).
    const end = shapes.get('EndEvent_issue')!;
    expect(end.y).toBeGreaterThanOrEqual(lane.y);
    expect(end.y + end.height).toBeLessThanOrEqual(lane.y + lane.height);
    const { rootElement } = await BpmnModdle().fromXML(edit.xml);
    const lanes = (rootElement as any).rootElements.find((e: any) => e.$type === 'bpmn:Process').laneSets[0].lanes;
    const refs = (id: string) => (lanes.find((l: any) => l.id === id).flowNodeRef ?? []).map((n: any) => n.id);
    expect(refs('Lane_back')).toEqual(['issue', 'EndEvent_issue']);
    expect(refs('Lane_2')).not.toContain('EndEvent_issue');
    const pool = shapes.get('Participant_1')!;
    for (const id of ['Lane_1', 'Lane_2', 'Lane_back', 'Lane_4']) {
      const l = shapes.get(id)!;
      expect(l.y, id).toBeGreaterThanOrEqual(pool.y);
      expect(l.y + l.height, id).toBeLessThanOrEqual(pool.y + pool.height);
    }
  });
});

describe('all or none', () => {
  test('every bad operation is reported with its index and nothing is applied', async () => {
    const { xml, scenario } = await credit();
    const error = await refused(
      xml,
      [
        { op: 'rename', id: 'check', name: 'fine' },
        { op: 'add', step: { id: 'check' }, after: 'nope' },
        { op: 'connect', from: 'issue', to: 'StartEvent', probability: 0.5 },
        { op: 'moveToLane', id: 'receive', lane: 'Nowhere' },
        { op: 'frobnicate' },
      ],
      { scenario },
    );
    // One pass: the malformed operation and the semantic problems of the others, all at once.
    expect(error.issues.map((i) => [i.op, i.path])).toEqual([
      [1, 'step.id'],
      [1, 'after'],
      [2, 'to'],
      [2, 'probability'],
      [3, 'lane'],
      [4, 'op'],
    ]);

    const second = await refused(
      xml,
      [
        { op: 'rename', id: 'check', name: 'fine' },
        { op: 'add', step: { id: 'check' }, after: 'nope' },
        { op: 'connect', from: 'EndEvent_issue', to: 'StartEvent', probability: 0.5 },
        { op: 'moveToLane', id: 'receive', lane: 'Nowhere' },
      ],
      { scenario },
    );
    expect(second.code).toBe('LILA-EDIT');
    expect(second.issues.map((i) => [i.op, i.path])).toEqual([
      [1, 'step.id'],
      [1, 'after'],
      [2, 'from'],
      [2, 'to'],
      [2, 'probability'],
      [3, 'lane'],
    ]);
    expect(second.message).toContain('operations[1].step.id: id "check" is already used in the model.');
    expect(second.message).toContain('operations[3].lane: there is no lane "Nowhere"; the lanes are: Customer, Analyst.');
  });

  test('shape and meaning in one pass, in the caller\'s language (QA of #557)', async () => {
    const { xml, scenario } = await credit();
    const error = await refused(
      xml,
      [
        { op: 'add', step: { id: 'check' }, after: 'nope' },
        { op: 'connect', from: 'receive', to: 'nope', probability: 0.5 },
        { op: 'remove', id: 'nope' },
        { op: 'rename', id: 'check', nombre: 'x' },
        { op: 'setType', id: 'check', type: 'gateway' },
        { op: 'moveToLane', id: 'check', lane: 'Legal' },
        { op: 'add', step: { id: 'slow', duration: '20 minutoz' }, after: 'receive' },
        { op: 'explode' },
        'not an object',
        { op: 'add', step: { id: 'x' }, between: ['receive'] },
        { op: 'addLane', name: 'Customer' },
      ],
      { scenario, locale: 'es' },
    );
    expect(error.issues.map((i) => [i.op, i.path])).toEqual([
      [0, 'step.id'],
      [0, 'after'],
      [1, 'to'],
      [1, 'probability'],
      [2, 'id'],
      [3, 'nombre'],
      [3, 'name'],
      [4, 'type'],
      [5, 'lane'],
      [6, 'step.duration'],
      [7, 'op'],
      [8, '(operation)'],
      [9, 'between'],
      [10, 'name'],
    ]);
    expect(error.message).toContain('la edición se rechazó');
    expect(error.message).toContain('operations[3].nombre: campo desconocido "nombre".');
    expect(error.message).toContain('operations[4].type: "gateway" no es un tipo de paso');
    expect(error.message).toContain('operations[7].op: "explode" no es una operación');
    expect(error.message).toContain('operations[10].name: ya hay un carril llamado "Customer"');
    expect(error.message).not.toMatch(/Invalid|expected/);
    const notList = await refused(xml, { op: 'remove', id: 'check' }, { locale: 'es' });
    expect(notList.issues).toEqual([{ op: null, path: 'operations', message: 'debe ser una lista no vacía de operaciones.' }]);
  });

  test('an edit that would break validation is refused with the validator errors', async () => {
    const { xml } = await credit();
    const error = await refused(xml, [{ op: 'remove', id: 'StartEvent' }]);
    expect(error.message).toContain('the edited process would not validate');
    expect(error.issues).toEqual([expect.objectContaining({ op: 0, path: 'bpmn.Process_1' })]);
    expect(error.issues[0]!.message).toMatch(/^E-SIN-START: /);
  });

  test('ambiguous removals and placements are refused', async () => {
    const built = await outlineToBpmn(ORDER);
    const split = await refused(built.xml, [{ op: 'remove', id: 'split' }]);
    expect(split.issues[0]!.message).toContain('with 1 incoming and 2 outgoing flows');
    const after = await refused(built.xml, [{ op: 'add', step: { id: 'x' }, after: 'split' }]);
    expect(after.issues[0]!.message).toContain('"after" is ambiguous; use "between"');
    const noScenario = await refused(built.xml, [{ op: 'add', step: { id: 'x', duration: '1m' }, after: 'take' }]);
    expect(noScenario.issues[0]!.message).toContain('goes into the base scenario');
  });

  test('es messages', async () => {
    const { xml } = await credit();
    const error = await refused(xml, [{ op: 'remove', id: 'nope' }], { locale: 'es' });
    expect(error.message).toContain('la edición se rechazó');
    expect(error.issues[0]!.message).toBe('"nope" no es el id de un elemento del modelo.');
  });
});

describe('layout: false', () => {
  test('untouched shapes keep their positions', async () => {
    const { xml, scenario } = await credit();
    const before = await di(xml);
    const edit = await editBpmn(
      xml,
      [
        { op: 'rename', id: 'issue', name: 'Issue the card' },
        { op: 'connect', from: 'ok', to: 'check', label: 'Retry', probability: 0 },
        { op: 'add', step: { id: 'note', name: 'Unconnected note', lane: 'Customer' } },
        { op: 'connect', from: 'receive', to: 'note' },
        { op: 'connect', from: 'note', to: 'check' },
      ],
      { scenario, layout: false },
    );
    const after = await di(edit.xml);
    for (const [id, box] of before.shapes) {
      // Pools and lanes only get wider, to hold what was added at their right end.
      if (id.startsWith('Lane_') || id.startsWith('Participant_')) {
        expect(after.shapes.get(id), id).toEqual({ ...box, width: after.shapes.get(id)!.width });
        expect(after.shapes.get(id)!.width).toBeGreaterThanOrEqual(box.width);
      } else expect(after.shapes.get(id), id).toEqual(box);
    }
    for (const [id, points] of before.edges) expect(after.edges.get(id), id).toEqual(points);
    // The new shape sits in its lane, clear of the others.
    const note = after.shapes.get('note')!;
    const lane = after.shapes.get('Lane_1')!;
    expect(note.y).toBeGreaterThanOrEqual(lane.y);
    expect(note.y + note.height).toBeLessThanOrEqual(lane.y + lane.height);
    for (const [id, box] of after.shapes) {
      if (id === 'note' || id.startsWith('Lane_') || id.startsWith('Participant_')) continue;
      const apart = box.x >= note.x + note.width || note.x >= box.x + box.width || box.y >= note.y + note.height || note.y >= box.y + box.height;
      expect(apart, id).toBe(true);
    }
  });

  test('inserting into a chain shifts what is to its right, by one amount, and nothing to its left', async () => {
    const { xml } = await credit();
    const before = await di(xml);
    const edit = await editBpmn(xml, [{ op: 'add', step: { id: 'verify' }, between: ['receive', 'check'] }], { layout: false });
    const after = await di(edit.xml);
    const anchor = before.shapes.get('receive')!;
    const shifts = new Set<number>();
    for (const [id, box] of before.shapes) {
      if (id.startsWith('Lane_') || id.startsWith('Participant_')) continue;
      const moved = after.shapes.get(id)!;
      expect(moved.y, id).toBe(box.y);
      if (box.x <= anchor.x) expect(moved.x, id).toBe(box.x);
      else shifts.add(moved.x - box.x);
    }
    expect(shifts.size).toBe(1);
    const verify = after.shapes.get('verify')!;
    expect(verify.x).toBeGreaterThan(anchor.x + anchor.width);
    expect(after.shapes.get('check')!.x).toBeGreaterThan(verify.x + verify.width);
  });
});

describe('models made elsewhere', () => {
  /** pedido with RACI, references, extended attributes, a text annotation and a foreign extension. */
  async function annotatedPedido(): Promise<string> {
    let xml = await annotateElement(pedidoXml, 'Collaboration_Pedido', {
      attributeDefinitions: [{ id: 'attr-risk', name: 'Risk', type: 'list', appliesTo: 'task', options: ['low', 'high'] }],
    });
    xml = await annotateElement(xml, 'Task_TomarPedido', {
      documentation: 'Ask for the order and the address.',
      responsibilities: [{ type: 'R', roleRef: 'role-cashier' }],
      refs: { systemRef: ['pos'] },
      attributes: [{ ref: 'attr-risk', value: 'low' }],
    });
    xml = await annotateElement(xml, 'Task_Preparar', { attributes: [{ ref: 'attr-risk', value: 'high' }] });
    xml = xml
      .replace('xmlns:di=', 'xmlns:acme="https://example.com/acme" xmlns:di=')
      .replace(
        '<bpmn:task id="Task_Preparar" name="Prepare food">',
        '<bpmn:task id="Task_Preparar" name="Prepare food" acme:station="grill">',
      )
      .replace(
        '</bpmn:process>',
        '  <bpmn:textAnnotation id="Note_Revisar"><bpmn:text>Checked by the supervisor</bpmn:text></bpmn:textAnnotation>\n' +
          '    <bpmn:association id="Assoc_Revisar" sourceRef="Task_Revisar" targetRef="Note_Revisar" />\n  </bpmn:process>',
      )
      .replace(
        '</bpmndi:BPMNPlane>',
        '  <bpmndi:BPMNShape id="Note_Revisar_di" bpmnElement="Note_Revisar"><dc:Bounds x="780" y="60" width="140" height="40" /></bpmndi:BPMNShape>\n' +
          '      <bpmndi:BPMNEdge id="Assoc_Revisar_di" bpmnElement="Assoc_Revisar"><di:waypoint x="830" y="180" /><di:waypoint x="830" y="100" /></bpmndi:BPMNEdge>\n    </bpmndi:BPMNPlane>',
      );
    expect(await errorsOf(xml)).toEqual([]);
    return xml;
  }

  test.each([true, false])('editing examples/pedido keeps annotations, attributes, other pools and messages (layout %s)', async (layout) => {
    const xml = await annotatedPedido();
    const annotations = await readAnnotations(xml);
    const before = await di(xml);
    const edit = await editBpmn(
      xml,
      [
        { op: 'add', step: { id: 'Task_Cobrar', name: 'Charge', duration: '2m', resources: ['Cashier'] }, after: 'Task_TomarPedido' },
        { op: 'rename', id: 'Task_Preparar', name: 'Cook' },
        { op: 'setType', id: 'Task_TomarPedido', type: 'userTask' },
      ],
      { scenario: pedidoScenario, layout },
    );
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect(await readAnnotations(edit.xml)).toEqual(annotations);
    expect(edit.xml).toContain('acme:station="grill"');
    expect(edit.xml).toContain('<bpmn:text>Checked by the supervisor</bpmn:text>');
    expect(edit.xml).toContain('<bpmn:association id="Assoc_Revisar" sourceRef="Task_Revisar" targetRef="Note_Revisar" />');
    expect(edit.xml).toContain('<bpmn:messageFlow id="MessageFlow_Entregado"');
    expect(edit.xml).toMatch(/<bpmn:userTask id="Task_TomarPedido" name="Take order">\s*<bpmn:documentation>/);
    // The new resource reuses the scenario's cashier.
    expect((edit.scenario?.elements as Record<string, any>)['Task_Cobrar']).toEqual({
      processingTime: { type: 'constant', value: 120 },
      resources: [{ ref: 'cajero', quantity: 1 }],
    });

    const after = await di(edit.xml);
    const customer = ['Participant_Cliente', 'StartEvent_ClienteInicio', 'Task_ClienteRecibe', 'EndEvent_ClienteFin'];
    if (!layout) {
      for (const id of customer) expect(after.shapes.get(id), id).toEqual(before.shapes.get(id));
    } else {
      // The customer pool moved as one piece (by however much the restaurant pool grew).
      const dy = after.shapes.get('Participant_Cliente')!.y - before.shapes.get('Participant_Cliente')!.y;
      for (const id of customer) expect(after.shapes.get(id), id).toEqual({ ...before.shapes.get(id)!, y: before.shapes.get(id)!.y + dy });
      // The note followed its task.
      const task = after.shapes.get('Task_Revisar')!;
      const note = after.shapes.get('Note_Revisar')!;
      const oldTask = before.shapes.get('Task_Revisar')!;
      const oldNote = before.shapes.get('Note_Revisar')!;
      expect(note.x - task.x).toBe(oldNote.x - oldTask.x);
      expect(note.y - task.y).toBe(oldNote.y - oldTask.y);
    }
  });

  test('message flows into one task get their own entry point and stretch, and their labels apart (QA of #557)', async () => {
    for (const layout of [true, false]) {
      const edit = await editBpmn(pedidoXml, [{ op: 'add', step: { id: 'Task_Cobrar', name: 'Charge' }, after: 'Task_TomarPedido' }, { op: 'addLane', name: 'Counter' }], { layout });
      const { rootElement } = await BpmnModdle().fromXML(edit.xml);
      const edges = new Map<string, any>();
      for (const el of (rootElement as any).diagrams[0].plane.planeElement) if (el.$type === 'bpmndi:BPMNEdge') edges.set(el.bpmnElement.id, el);
      const a = edges.get('MessageFlow_Entregado');
      const b = edges.get('MessageFlow_Rechazado');
      const last = (e: any) => e.waypoint[e.waypoint.length - 1];
      expect(last(a).x, String(layout)).not.toBe(last(b).x);
      const stretch = (e: any) => e.waypoint.find((p: any, i: number) => i > 0 && p.y === e.waypoint[i - 1].y && p.x !== e.waypoint[i - 1].x)?.y;
      expect(stretch(a)).not.toBe(stretch(b));
      const la = a.label.bounds;
      const lb = b.label.bounds;
      const apart = la.x + la.width <= lb.x || lb.x + lb.width <= la.x || la.y + la.height <= lb.y || lb.y + lb.height <= la.y;
      expect(apart, String(layout)).toBe(true);
    }
  });

  test('removing an element a message flow points at removes the message flow too, and says so', async () => {
    const edit = await editBpmn(pedidoXml, [{ op: 'add', step: { id: 'Task_Avisar' }, after: 'Timer_Reposo' }, { op: 'remove', id: 'EndEvent_Rechazado' }]);
    // EndEvent_Rechazado is the only target of Flow_Rechazado: removing it would leave a gateway branch nowhere.
    expect(edit.removed).toContain('MessageFlow_Rechazado');
    expect(edit.removed).toContain('Flow_Rechazado');
    expect(edit.xml).not.toContain('MessageFlow_Rechazado');
    expect(edit.changes[1]!.message).toBe('removed "EndEvent_Rechazado"; also removed MessageFlow_Rechazado');
  });

  test('addLane on a pool without lanes: the first lane holds every step', async () => {
    const edit = await editBpmn(pedidoXml, [{ op: 'addLane', name: 'Counter' }, { op: 'addLane', name: 'Kitchen' }, { op: 'moveToLane', id: 'Task_Preparar', lane: 'Kitchen' }], {
      layout: false,
    });
    expect(await errorsOf(edit.xml)).toEqual([]);
    const outline = await outlineOf(edit.xml);
    expect(outline.lanes).toEqual(['Counter', 'Kitchen']);
    expect(outline.steps.filter((s) => s.lane === 'Kitchen').map((s) => s.id)).toEqual(['Task_Preparar']);
    expect(outline.steps.every((s) => s.lane !== undefined)).toBe(true);
    // The lanes' title band is clear of the steps (QA of #557: it ran under the start event).
    const { shapes } = await di(edit.xml);
    const band = shapes.get('Lane_1')!.x + 30;
    for (const id of ['StartEvent_Pedido', 'Task_TomarPedido', 'Task_Preparar']) expect(shapes.get(id)!.x, id).toBeGreaterThanOrEqual(band + 20);
  });

  test('a process without lanes or a pool gets one with its first lane', async () => {
    const built = await outlineToBpmn({ name: 'Plain', steps: [{ id: 'a' }, { id: 'b' }] });
    expect(built.xml).not.toContain('bpmn:participant');
    for (const layout of [true, false]) {
      const edit = await editBpmn(built.xml, [{ op: 'addLane', name: 'Team' }], { layout });
      expect(await errorsOf(edit.xml)).toEqual([]);
      expect(edit.xml).toContain('<bpmn:participant id="Participant_1" name="Plain" processRef="Process_1" />');
      const { shapes } = await di(edit.xml);
      const pool = shapes.get('Participant_1')!;
      for (const id of ['a', 'b', 'StartEvent']) {
        const box = shapes.get(id)!;
        expect(box.x, id).toBeGreaterThan(pool.x);
        expect(box.y + box.height, id).toBeLessThanOrEqual(pool.y + pool.height);
      }
    }
  });

  test.each([true, false])('a Bizagi export (two pools, nested lane sets) can be edited (layout %s)', async (layout) => {
    const before = await di(bizagiXml);
    const errors = await errorsOf(bizagiXml);
    const edit = await editBpmn(
      bizagiXml,
      [
        { op: 'add', step: { id: 'Task_new', name: 'Double-check' }, after: 'sid-3D477D07-D669-4A26-9454-12AD775FDE70' },
        { op: 'rename', id: 'sid-1208A5BA-9E1C-49D2-82E3-5DB2C0E9887D', name: 'Task 2 (renamed)' },
      ],
      { layout },
    );
    expect(await errorsOf(edit.xml)).toEqual(errors);
    expect(edit.xml).toContain('name="Task 2 (renamed)"');
    // Pool 2 (another process) moves as one piece, if at all: aside, to make way for pool 1.
    const after = await di(edit.xml);
    const pool2 = [
      'sid-7E61DCD0-0700-4828-8A28-CD65132273D7',
      'sid-34E8C3A5-5C2A-4593-AC67-038B737814D7',
      'sid-485E1184-9951-4B41-9794-A9AFD42A3249',
      'sid-C189128A-82D2-4E5F-8FB4-F6E21FF27E83',
    ];
    const shift = (id: string) => ({ x: after.shapes.get(id)!.x - before.shapes.get(id)!.x, y: after.shapes.get(id)!.y - before.shapes.get(id)!.y });
    for (const id of pool2) expect(shift(id), id).toEqual(shift(pool2[0]!));
    if (!layout) expect(shift(pool2[0]!).y).toBe(0);
    // Pool 1 and pool 2 do not overlap.
    const p1 = after.shapes.get('sid-66751F1E-EEB9-4BA7-9FDA-7965A1CA9CD1')!;
    const p2 = after.shapes.get(pool2[0]!)!;
    expect(p1.x + p1.width <= p2.x || p1.y + p1.height <= p2.y).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Lote Q (#631, #638): the reader takes the new operations and fields
 * ------------------------------------------------------------------ */

describe('the operations reader: addBoundary, lanes, annotations, data objects, default, end types (#631, #638)', () => {
  test('the zod schema accepts every new operation', () => {
    const ops: EditOperation[] = [
      { op: 'add', step: { id: 'mail', type: 'sendTask' }, after: 'receive' },
      { op: 'setType', id: 'EndEvent_issue', type: 'terminate' },
      { op: 'connect', from: 'ok', to: 'issue', default: true },
      { op: 'addBoundary', on: 'check', boundary: { id: 'sla', type: 'timer', duration: '48h', interrupting: false, to: 'reject' } },
      { op: 'removeLane', lane: 'Customer', moveStepsTo: 'Analyst' },
      { op: 'moveLane', lane: 'Analyst', before: 'Customer' },
      { op: 'annotate', on: 'check', text: 'Within 48 h' },
      { op: 'removeAnnotation', on: 'check', text: 'Within 48 h' },
      { op: 'addDataObject', name: 'Claim file', on: 'check', direction: 'in' },
      { op: 'removeDataObject', name: 'Claim file' },
      { op: 'rename', id: 'Customer', name: 'Client' },
    ];
    expect(EditOperationsSchema.safeParse(ops).success).toBe(true);
  });

  test('well-formed ones pass the reader and are applied, in order', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(
      xml,
      [
        { op: 'add', step: { id: 'mail', type: 'sendTask' }, after: 'receive' },
        { op: 'setType', id: 'EndEvent_issue', type: 'terminate' },
        { op: 'connect', from: 'ok', to: 'issue', default: true },
        { op: 'addBoundary', on: 'check', boundary: { id: 'sla', type: 'timer', duration: '48h', end: 'terminate' } },
        { op: 'moveLane', lane: 'Analyst', before: 'Customer' },
        { op: 'annotate', on: 'check', text: 'Within 48 h' },
        { op: 'removeAnnotation', on: 'check', text: 'Within 48 h' },
        { op: 'addDataObject', name: 'Claim file', on: 'check', direction: 'out' },
        { op: 'removeDataObject', name: 'Claim file', on: 'check' },
        { op: 'removeLane', lane: 'Customer', moveStepsTo: 'Analyst' },
      ],
      { scenario },
    );
    expect(edit.changes.map((c) => c.op)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect((await outlineOf(edit.xml, edit.scenario)).lanes).toEqual(['Analyst']);
  });

  test('every malformed new operation, at its index and path, at once', async () => {
    const { xml, scenario } = await credit();
    const error = await refused(
      xml,
      [
        { op: 'addBoundary', on: 'check' },
        { op: 'addBoundary', on: '', boundary: { id: 'sla', type: 'message', to: 'reject', end: true, extra: 1 } },
        { op: 'addBoundary', on: 'check', boundary: 'sla' },
        { op: 'removeLane', moveStepsTo: 3 },
        { op: 'moveLane', lane: 'Analyst' },
        { op: 'moveLane', lane: 'Analyst', before: 'Customer', after: 'Customer' },
        { op: 'annotate', on: 'check' },
        { op: 'removeAnnotation', text: 'x', at: 'check' },
        { op: 'addDataObject', name: 'File', on: 'check', direction: 'both' },
        { op: 'removeDataObject', on: 'check' },
        { op: 'connect', from: 'ok', to: 'issue', default: 'yes' },
        { op: 'setType', id: 'issue', type: 'endEvent' },
        { op: 'add', step: { id: 'n', notes: ['x'], boundary: [] } },
      ],
      { scenario },
    );
    expect(error.issues.map((i) => [i.op, i.path, i.message])).toEqual([
      [0, 'boundary', 'must be an object.'],
      [1, 'on', 'must be a non-empty text.'],
      [1, 'boundary.extra', 'unknown field "extra".'],
      [1, 'boundary.type', 'must be one of timer.'],
      [1, 'boundary', 'boundary "sla" needs exactly one of "to" (a step id) and "end".'],
      [2, 'boundary', 'must be an object.'],
      [3, 'lane', 'must be a non-empty text.'],
      [3, 'moveStepsTo', 'must be a non-empty text.'],
      [4, 'before', 'give "before" or "after": the lane it goes next to.'],
      [5, 'before', 'use either "after" or "before", not both.'],
      [6, 'text', 'must be a non-empty text.'],
      [7, 'at', 'unknown field "at".'],
      [7, 'on', 'must be a non-empty text.'],
      [8, 'direction', 'must be one of in, out.'],
      [9, 'name', 'must be a non-empty text.'],
      [10, 'default', 'must be true or false.'],
      [11, 'type', expect.stringContaining('"endEvent" is not a step type; use one of task, userTask')],
      [12, 'step.notes', 'unknown field "notes".'],
      [12, 'step.boundary', 'unknown field "boundary".'],
    ]);
    expect(error.issues[16]!.message).toContain(', end, terminate.');
  });

  test('es messages for the new ones', async () => {
    const { xml, scenario } = await credit();
    const error = await refused(xml, [{ op: 'moveLane', lane: 'Analyst' }, { op: 'addDataObject', name: 'F', on: 'check', direction: 'x' }], {
      scenario,
      locale: 'es',
    });
    expect(error.message).toContain('operations[0].before: indica "before" o "after": el carril junto al que va.');
    expect(error.message).toContain('operations[1].direction: debe ser uno de in, out.');
  });
});

/* ------------------------------------------------------------------ *
 * Lote Q (#631): the new step types, end types, default flows and boundary timers
 * ------------------------------------------------------------------ */

/** The lane (by id) whose `flowNodeRef` lists `id`. */
async function laneOfNode(xml: string, id: string): Promise<string | undefined> {
  const { rootElement } = await BpmnModdle().fromXML(xml);
  const lanes = (rootElement as any).rootElements.find((e: any) => e.$type === 'bpmn:Process').laneSets?.[0]?.lanes ?? [];
  return lanes.find((l: any) => (l.flowNodeRef ?? []).some((n: any) => n.id === id))?.id;
}

describe.each([true, false])('the #631 operations (layout %s)', (layout) => {
  test('add and setType take the task variants, and setType turns an end into a terminate end and back', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(
      xml,
      [
        { op: 'add', step: { id: 'mail', name: 'Send receipt', type: 'sendTask', duration: '1m' }, after: 'receive' },
        { op: 'setType', id: 'check', type: 'businessRuleTask' },
        { op: 'setType', id: 'issue', type: 'terminate' },
        { op: 'setType', id: 'EndEvent_reject', type: 'terminate' },
        { op: 'setType', id: 'reject', type: 'end' },
      ],
      { scenario, layout },
    );
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect(edit.changes.map((c) => c.message).slice(2)).toEqual([
      '"EndEvent_issue": end → terminate',
      '"EndEvent_reject": end → terminate',
      '"EndEvent_reject": terminate → end',
    ]);
    const reading = await bpmnToOutline(edit.xml, { scenario: edit.scenario as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    expect(reading.outline.steps.map((s) => [s.id, s.type, s.end])).toEqual([
      ['receive', undefined, undefined],
      ['mail', 'sendTask', undefined],
      ['check', 'businessRuleTask', undefined],
      ['ok', 'xor', undefined],
      ['issue', undefined, 'terminate'],
      ['reject', undefined, true],
    ]);
    expect(reading.outline.steps[1]!.duration).toEqual({ type: 'constant', value: 60 });
    // A step that does not lead to exactly one end is refused.
    const bad = await refused(xml, [{ op: 'setType', id: 'ok', type: 'terminate' }], { layout });
    expect(bad.issues[0]).toMatchObject({ op: 0, path: 'id', message: '"ok" is neither an end event nor a step that leads to exactly one (it leads to none); give the id of the end event.' });
  });

  test('connect with default: the new flow is the default of an xor/or; a second one, or out of a task, is refused', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(xml, [{ op: 'connect', from: 'ok', to: 'check', label: 'Retry', default: true }], { scenario, layout });
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect(edit.xml).toContain('<bpmn:exclusiveGateway id="ok" name="Approved?" default="Flow_ok_check">');
    const branches = (await outlineOf(edit.xml, scenario)).steps.find((s) => s.id === 'ok')!.branches;
    expect(branches).toContainEqual({ to: 'check', label: 'Retry', default: true });
    const bad = await refused(
      edit.xml,
      [
        { op: 'connect', from: 'ok', to: 'reject', default: true },
        { op: 'connect', from: 'check', to: 'reject', default: true },
      ],
      { layout },
    );
    expect(bad.issues.map((i) => [i.op, i.path, i.message])).toEqual([
      [0, 'default', 'gateway "ok": only one branch can be the default ("default": true).'],
      [1, 'default', 'step "check": "default" does not apply to a task.'],
    ]);
  });

  test('setType of an xor to an and lists its outgoing flows as retyped (their probabilities no longer apply)', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(xml, [{ op: 'setType', id: 'ok', type: 'and' }], { scenario, layout });
    expect(edit.retyped).toEqual(['ok', 'Flow_ok_issue', 'Flow_ok_reject']);
  });

  test('addBoundary: a non-interrupting deadline to a step, its delay in the base scenario, in the lane of its host', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(
      xml,
      [{ op: 'addBoundary', on: 'check', boundary: { id: 'sla', type: 'timer', name: '48 h', label: 'Late', duration: '48h', interrupting: false, to: 'reject' } }],
      { scenario, layout },
    );
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect(edit.changes[0]!.message).toBe('attached the non-interrupting boundary timer "sla" to "check" → reject');
    expect(edit.xml).toMatch(/<bpmn:boundaryEvent id="sla" name="48 h" cancelActivity="false" attachedToRef="check">/);
    expect((edit.scenario?.elements as Record<string, unknown>)['sla']).toEqual({ processingTime: { type: 'constant', value: 172800 } });
    expect(await laneOfNode(edit.xml, 'sla')).toBe(await laneOfNode(edit.xml, 'check'));
    const reading = await bpmnToOutline(edit.xml, { scenario: edit.scenario as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    expect(reading.outline.steps.find((s) => s.id === 'check')!.boundary).toEqual([
      { id: 'sla', type: 'timer', name: '48 h', label: 'Late', duration: { type: 'constant', value: 172800 }, interrupting: false, to: 'reject' },
    ]);
    // On the host's border in the diagram.
    const { shapes } = await di(edit.xml);
    const host = shapes.get('check')!;
    const b = shapes.get('sla')!;
    expect(b.y + b.height / 2).toBeCloseTo(host.y + host.height, 0);
    expect(b.x).toBeGreaterThanOrEqual(host.x - b.width / 2);
    expect(b.x + b.width).toBeLessThanOrEqual(host.x + host.width + b.width / 2);
  });

  test('addBoundary with an end: an interrupting timer to a terminate end EndEvent_<boundary>', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(xml, [{ op: 'addBoundary', on: 'check', boundary: { id: 'cut', type: 'timer', duration: '1h', end: 'terminate' } }], {
      scenario,
      layout,
    });
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect(edit.xml).toMatch(/<bpmn:boundaryEvent id="cut" attachedToRef="check">/);
    expect(await laneOfNode(edit.xml, 'EndEvent_cut')).toBe(await laneOfNode(edit.xml, 'check'));
    const reading = await bpmnToOutline(edit.xml, { scenario: edit.scenario as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    expect(reading.outline.steps.find((s) => s.id === 'check')!.boundary).toEqual([
      { id: 'cut', type: 'timer', duration: { type: 'constant', value: 3600 }, end: 'terminate' },
    ]);
  });

  test('addBoundary refusals: not on a gateway, an unknown target, a bad duration, a taken id, no scenario for the duration', async () => {
    const { xml, scenario } = await credit();
    const bad = await refused(
      xml,
      [
        { op: 'addBoundary', on: 'ok', boundary: { id: 'b1', type: 'timer', end: true } },
        { op: 'addBoundary', on: 'check', boundary: { id: 'b2', type: 'timer', to: 'ghost' } },
        { op: 'addBoundary', on: 'check', boundary: { id: 'b3', type: 'timer', duration: 'soon', end: true } },
        { op: 'addBoundary', on: 'check', boundary: { id: 'issue', type: 'timer', end: true } },
      ],
      { scenario, layout },
    );
    expect(bad.issues.map((i) => [i.op, i.path])).toEqual([
      [0, 'on'],
      [1, 'boundary.to'],
      [2, 'boundary.duration'],
      [3, 'boundary.id'],
    ]);
    const noScenario = await refused(xml, [{ op: 'addBoundary', on: 'check', boundary: { id: 'b', type: 'timer', duration: '1h', end: true } }], { layout });
    expect(noScenario.issues[0]).toMatchObject({ op: 0, path: 'boundary.duration' });
  });

  test('remove a boundary event: the end it led to goes too; so does the end left behind by a removed flow', async () => {
    const { xml, scenario } = await credit();
    const withBoundary = await editBpmn(xml, [{ op: 'addBoundary', on: 'check', boundary: { id: 'cut', type: 'timer', duration: '1h', end: true } }], {
      scenario,
      layout,
    });
    const edit = await editBpmn(withBoundary.xml, [{ op: 'remove', id: 'cut' }], { layout });
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect(edit.removed).toEqual(['Flow_cut_EndEvent_cut', 'cut', 'EndEvent_cut']);
    expect(edit.changes[0]!.message).toBe('removed "cut"; also removed EndEvent_cut');
    expect(edit.xml).not.toContain('EndEvent_cut');
    // A flow into an end: the end has no way in left and goes.
    const flow = await editBpmn(xml, [{ op: 'remove', id: 'Flow_reject_EndEvent_reject' }, { op: 'setType', id: 'reject', type: 'task' }, { op: 'connect', from: 'reject', to: 'issue' }], { layout });
    expect(flow.removed).toEqual(['Flow_reject_EndEvent_reject', 'EndEvent_reject']);
  });

  test('moveToLane takes the boundary events of the step and the ends they lead to', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(
      xml,
      [
        { op: 'addBoundary', on: 'check', boundary: { id: 'cut', type: 'timer', duration: '1h', end: true } },
        { op: 'addBoundary', on: 'check', boundary: { id: 'late', type: 'timer', interrupting: false, to: 'reject' } },
        { op: 'moveToLane', id: 'check', lane: 'Customer' },
      ],
      { scenario, layout },
    );
    expect(await errorsOf(edit.xml)).toEqual([]);
    for (const id of ['check', 'cut', 'EndEvent_cut', 'late']) expect(await laneOfNode(edit.xml, id), id).toBe('Lane_1');
    const { shapes } = await di(edit.xml);
    const lane = shapes.get('Lane_1')!;
    for (const id of ['check', 'EndEvent_cut']) {
      const box = shapes.get(id)!;
      expect(box.y, id).toBeGreaterThanOrEqual(lane.y);
      expect(box.y + box.height, id).toBeLessThanOrEqual(lane.y + lane.height);
    }
    const host = shapes.get('check')!;
    for (const id of ['cut', 'late']) expect(shapes.get(id)!.y + 18, id).toBeCloseTo(host.y + host.height, 0);
    const reading = await bpmnToOutline(edit.xml, { scenario: edit.scenario as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
  });

  test('add an event gateway with a message and a timer branch, connected by hand', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(
      xml,
      [
        { op: 'add', step: { id: 'wait', type: 'eventGateway', name: 'Reply?' }, between: ['ok', 'reject'] },
        { op: 'add', step: { id: 'answer', type: 'message', name: 'Answer', duration: '1d' }, between: ['wait', 'reject'] },
        { op: 'add', step: { id: 'late', type: 'timer', name: '5 days', duration: '5d' } },
        { op: 'connect', from: 'wait', to: 'late' },
        { op: 'connect', from: 'late', to: 'reject' },
      ],
      { scenario, layout },
    );
    expect(await errorsOf(edit.xml)).toEqual([]);
    const reading = await bpmnToOutline(edit.xml, { scenario: edit.scenario as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    const step = (id: string) => reading.outline.steps.find((s) => s.id === id);
    expect(step('wait')).toMatchObject({ type: 'eventGateway', branches: [{ to: 'answer' }, { to: 'late' }] });
    expect(step('answer')).toMatchObject({ type: 'message', duration: { type: 'constant', value: 86400 } });
    expect(step('late')).toMatchObject({ type: 'timer', duration: { type: 'constant', value: 432000 } });
  });
});

/* ------------------------------------------------------------------ *
 * Lote Q (#638): lanes, text annotations and data objects
 * ------------------------------------------------------------------ */

/** A pool with a parent lane (two sub-lanes) and a plain lane, no diagram. */
const NESTED_LANES = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="x">
  <bpmn:collaboration id="C"><bpmn:participant id="Pool" name="Claims" processRef="P"/></bpmn:collaboration>
  <bpmn:process id="P" isExecutable="true">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="Office" name="Office"><bpmn:flowNodeRef>s</bpmn:flowNodeRef><bpmn:flowNodeRef>a</bpmn:flowNodeRef><bpmn:flowNodeRef>b</bpmn:flowNodeRef>
        <bpmn:childLaneSet id="LS2">
          <bpmn:lane id="Desk" name="Desk"><bpmn:flowNodeRef>s</bpmn:flowNodeRef><bpmn:flowNodeRef>a</bpmn:flowNodeRef></bpmn:lane>
          <bpmn:lane id="Back" name="Back"><bpmn:flowNodeRef>b</bpmn:flowNodeRef></bpmn:lane>
        </bpmn:childLaneSet>
      </bpmn:lane>
      <bpmn:lane id="Field" name="Field"><bpmn:flowNodeRef>c</bpmn:flowNodeRef><bpmn:flowNodeRef>e</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="s"/>
    <bpmn:task id="a" name="A"/>
    <bpmn:task id="b" name="B"/>
    <bpmn:task id="c" name="C"/>
    <bpmn:endEvent id="e"/>
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="a"/>
    <bpmn:sequenceFlow id="f2" sourceRef="a" targetRef="b"/>
    <bpmn:sequenceFlow id="f3" sourceRef="b" targetRef="c"/>
    <bpmn:sequenceFlow id="f4" sourceRef="c" targetRef="e"/>
  </bpmn:process>
</bpmn:definitions>`;

/** The bounds of each lane of the main plane, top to bottom. */
async function laneBands(xml: string): Promise<{ id: string; y: number; height: number }[]> {
  const { shapes } = await di(xml);
  const { rootElement } = await BpmnModdle().fromXML(xml);
  const lanes = ((rootElement as any).rootElements.find((e: any) => e.$type === 'bpmn:Process').laneSets?.[0]?.lanes ?? []) as any[];
  return lanes.map((l) => ({ id: l.id as string, y: shapes.get(l.id)!.y, height: shapes.get(l.id)!.height })).sort((a, b) => a.y - b.y);
}

describe.each([true, false])('the #638 operations (layout %s)', (layout) => {
  test('removeLane with moveStepsTo: its nodes (steps and ends) go to that lane, the lane leaves the model and the diagram', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(xml, [{ op: 'removeLane', lane: 'Customer', moveStepsTo: 'Analyst' }], { scenario, layout });
    expect(await errorsOf(edit.xml)).toEqual([]);
    await expectCleanImport(edit.xml);
    expect(edit.changes[0]!.message).toBe('removed lane "Customer" (Lane_1); reject, EndEvent_reject moved to lane "Analyst"');
    expect(edit.removed).toEqual(['Lane_1']);
    const outline = await outlineOf(edit.xml, scenario);
    expect(outline.lanes).toEqual(['Analyst']);
    expect(outline.steps.every((s) => s.lane === 'Analyst')).toBe(true);
    expect(await laneOfNode(edit.xml, 'EndEvent_reject')).toBe('Lane_2');
    const { shapes } = await di(edit.xml);
    expect(shapes.has('Lane_1')).toBe(false);
    const lane = shapes.get('Lane_2')!;
    const pool = shapes.get('Participant_1')!;
    expect(lane.y).toBe(pool.y);
    expect(lane.height).toBe(pool.height);
    for (const id of ['receive', 'check', 'ok', 'issue', 'reject', 'EndEvent_reject']) {
      const box = shapes.get(id)!;
      expect(box.y, id).toBeGreaterThanOrEqual(lane.y);
      expect(box.y + box.height, id).toBeLessThanOrEqual(lane.y + lane.height);
    }
    if (!layout) {
      // Every step keeps its column.
      const before = (await di(xml)).shapes;
      for (const id of ['receive', 'check', 'ok', 'issue', 'reject']) expect(shapes.get(id)!.x, id).toBe(before.get(id)!.x);
    }
  });

  test('removeLane of an empty lane needs no moveStepsTo; of the last lane, the lane set goes and the pool stays', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(
      xml,
      [
        { op: 'addLane', name: 'Back office' },
        { op: 'removeLane', lane: 'Back office' },
        { op: 'removeLane', lane: 'Customer', moveStepsTo: 'Analyst' },
        { op: 'removeLane', lane: 'Analyst' },
      ],
      { scenario, layout },
    );
    expect(await errorsOf(edit.xml)).toEqual([]);
    await expectCleanImport(edit.xml);
    expect(edit.changes.map((c) => c.message)).toEqual([
      'added lane "Back office" (Lane_3)',
      'removed lane "Back office" (Lane_3)',
      'removed lane "Customer" (Lane_1); reject, EndEvent_reject moved to lane "Analyst"',
      'removed lane "Analyst" (Lane_2), the last one: the process has no lanes now and its nodes stay in the pool',
    ]);
    expect(edit.xml).not.toContain('laneSet');
    expect(edit.xml).toContain('<bpmn:participant id="Participant_1"');
    const outline = await outlineOf(edit.xml, scenario);
    expect(outline.lanes).toBeUndefined();
    expect(outline.steps.map((s) => s.id)).toEqual(['receive', 'check', 'ok', 'issue', 'reject']);
    const { shapes } = await di(edit.xml);
    const pool = shapes.get('Participant_1')!;
    for (const id of ['receive', 'check', 'ok', 'issue', 'reject']) {
      const box = shapes.get(id)!;
      expect(box.y >= pool.y && box.y + box.height <= pool.y + pool.height, id).toBe(true);
    }
  });

  test('moveLane: the band moves whole, before or after a sibling; each step keeps its x', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(xml, [{ op: 'moveLane', lane: 'Analyst', before: 'Customer' }], { scenario, layout });
    expect(await errorsOf(edit.xml)).toEqual([]);
    await expectCleanImport(edit.xml);
    expect(edit.changes[0]!.message).toBe('moved lane "Analyst" above "Customer"');
    expect((await outlineOf(edit.xml, scenario)).lanes).toEqual(['Analyst', 'Customer']);
    const bands = await laneBands(edit.xml);
    expect(bands.map((b) => b.id)).toEqual(['Lane_2', 'Lane_1']);
    expect(bands[1]!.y).toBe(bands[0]!.y + bands[0]!.height);
    const { shapes, edges } = await di(edit.xml);
    const inBand = (id: string, lane: string): boolean => {
      const b = shapes.get(id)!;
      const l = shapes.get(lane)!;
      return b.y >= l.y && b.y + b.height <= l.y + l.height;
    };
    for (const id of ['receive', 'check', 'ok', 'issue']) expect(inBand(id, 'Lane_2'), id).toBe(true);
    expect(inBand('reject', 'Lane_1')).toBe(true);
    if (!layout) {
      const before = await di(xml);
      for (const id of ['receive', 'check', 'ok', 'issue', 'reject']) expect(shapes.get(id)!.x, id).toBe(before.shapes.get(id)!.x);
      // A flow inside one band moves with it unchanged in shape.
      const dy = shapes.get('receive')!.y - before.shapes.get('receive')!.y;
      expect(edges.get('Flow_receive_check')).toEqual(before.edges.get('Flow_receive_check')!.map((p) => ({ x: p.x, y: p.y + dy })));
      // The flow across the bands still joins its two shapes.
      const cross = edges.get('Flow_ok_reject')!;
      const reject = shapes.get('reject')!;
      expect(cross.at(-1)!.y).toBeGreaterThanOrEqual(reject.y);
      expect(cross.at(-1)!.y).toBeLessThanOrEqual(reject.y + reject.height);
    }
    const back = await editBpmn(edit.xml, [{ op: 'moveLane', lane: 'Analyst', after: 'Customer' }], { scenario, layout });
    expect((await outlineOf(back.xml, scenario)).lanes).toEqual(['Customer', 'Analyst']);
  });

  test('rename a lane by its name', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(xml, [{ op: 'rename', id: 'Customer', name: 'Client' }], { scenario, layout });
    expect(edit.changes[0]!.message).toBe('renamed "Lane_1": "Customer" → "Client"');
    expect((await outlineOf(edit.xml, scenario)).lanes).toEqual(['Client', 'Analyst']);
  });

  test('annotate and removeAnnotation: the step\'s notes; the same text twice changes nothing', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(
      xml,
      [
        { op: 'annotate', on: 'check', text: 'Within 48 h' },
        { op: 'annotate', on: 'check', text: 'Bureau B as fallback' },
        { op: 'annotate', on: 'check', text: 'Within 48 h' },
        { op: 'annotate', on: 'ok', text: 'Policy 7' },
      ],
      { scenario, layout },
    );
    expect(await errorsOf(edit.xml)).toEqual([]);
    await expectCleanImport(edit.xml);
    expect(edit.changes.map((c) => c.message)).toEqual([
      'annotated "check": "Within 48 h" (TextAnnotation_check)',
      'annotated "check": "Bureau B as fallback" (TextAnnotation_check_2)',
      '"check" already has the text annotation "Within 48 h"; nothing changed',
      'annotated "ok": "Policy 7" (TextAnnotation_ok)',
    ]);
    const reading = await bpmnToOutline(edit.xml, { scenario: scenario as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    expect(reading.outline.steps.find((s) => s.id === 'check')!.notes).toEqual(['Within 48 h', 'Bureau B as fallback']);
    // Each annotation is drawn beside its step, overlapping no other shape.
    const { shapes } = await di(edit.xml);
    const note = shapes.get('TextAnnotation_check')!;
    for (const [id, b] of shapes) {
      if (id === 'TextAnnotation_check' || id.startsWith('Lane_') || id.startsWith('Participant_')) continue;
      const apart = note.x + note.width <= b.x || b.x + b.width <= note.x || note.y + note.height <= b.y || b.y + b.height <= note.y;
      expect(apart, id).toBe(true);
    }

    const removed = await editBpmn(edit.xml, [{ op: 'removeAnnotation', on: 'check', text: 'Within 48 h' }], { scenario, layout });
    expect(removed.changes[0]!.message).toBe('removed the text annotation "Within 48 h" from "check" (Association_check, TextAnnotation_check)');
    expect(removed.removed).toEqual(['Association_check', 'TextAnnotation_check']);
    await expectCleanImport(removed.xml);
    expect((await outlineOf(removed.xml, scenario)).steps.find((s) => s.id === 'check')!.notes).toEqual(['Bureau B as fallback']);
    expect(removed.xml).not.toContain('Within 48 h');
  });

  test('addDataObject reuses the object by name; removeDataObject disconnects it and removes it once nothing uses it', async () => {
    const { xml, scenario } = await credit();
    const edit = await editBpmn(
      xml,
      [
        { op: 'addDataObject', name: 'Application', on: 'receive', direction: 'out' },
        { op: 'addDataObject', name: 'Application', on: 'check', direction: 'in' },
        { op: 'addDataObject', name: 'Application', on: 'check', direction: 'in' },
        { op: 'addDataObject', name: 'Bureau report', on: 'check', direction: 'out' },
      ],
      { scenario, layout },
    );
    expect(await errorsOf(edit.xml)).toEqual([]);
    await expectCleanImport(edit.xml);
    expect(edit.changes.map((c) => c.message)).toEqual([
      '"receive" writes data object "Application" (DataObjectReference_receive, new)',
      '"check" reads data object "Application" (DataObjectReference_receive)',
      '"check" already reads data object "Application"; nothing changed',
      '"check" writes data object "Bureau report" (DataObjectReference_check, new)',
    ]);
    expect(edit.xml.match(/<bpmn:dataObjectReference /g)).toHaveLength(2);
    const reading = await bpmnToOutline(edit.xml, { scenario: scenario as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    const step = (outline: typeof reading.outline, id: string) => outline.steps.find((s) => s.id === id)!;
    expect(step(reading.outline, 'receive').data).toEqual([{ name: 'Application', direction: 'out' }]);
    expect(step(reading.outline, 'check').data).toEqual([
      { name: 'Application', direction: 'in' },
      { name: 'Bureau report', direction: 'out' },
    ]);

    const one = await editBpmn(edit.xml, [{ op: 'removeDataObject', name: 'Application', on: 'check' }], { scenario, layout });
    expect(one.removed).toEqual(['DataInputAssociation_check']);
    expect(one.xml).not.toContain('__targetRef_placeholder');
    await expectCleanImport(one.xml);
    expect(step(await outlineOf(one.xml, scenario), 'check').data).toEqual([{ name: 'Bureau report', direction: 'out' }]);

    const all = await editBpmn(one.xml, [{ op: 'removeDataObject', name: 'Application' }], { scenario, layout });
    expect(all.removed).toEqual(['DataOutputAssociation_receive', 'DataObjectReference_receive', 'DataObject_receive']);
    expect(all.changes[0]!.message).toBe(
      'disconnected data object "Application" (DataOutputAssociation_receive, DataObjectReference_receive, DataObject_receive)',
    );
    await expectCleanImport(all.xml);
    expect(all.xml).not.toContain('Application');
  });

  test('remove takes annotations, data objects and associations; a removed step takes its data objects nothing else uses', async () => {
    const { xml, scenario } = await credit();
    const base = await editBpmn(
      xml,
      [
        { op: 'annotate', on: 'check', text: 'Note' },
        { op: 'annotate', on: 'issue', text: 'Loose soon' },
        { op: 'addDataObject', name: 'File', on: 'check', direction: 'in' },
        { op: 'addDataObject', name: 'Card', on: 'issue', direction: 'out' },
      ],
      { scenario, layout },
    );
    const edit = await editBpmn(
      base.xml,
      [
        { op: 'remove', id: 'TextAnnotation_check' },
        { op: 'remove', id: 'DataObjectReference_check' },
        { op: 'remove', id: 'Association_issue' },
        { op: 'remove', id: 'issue' },
      ],
      { scenario, layout },
    );
    expect(await errorsOf(edit.xml)).toEqual([]);
    await expectCleanImport(edit.xml);
    expect(edit.changes.map((c) => c.message)).toEqual([
      'removed TextAnnotation "TextAnnotation_check"; also removed Association_check',
      'removed DataObjectReference "DataObjectReference_check"; also removed DataInputAssociation_check, DataObject_check',
      'removed Association "Association_issue"',
      expect.stringContaining('removed "issue"'),
    ]);
    expect(edit.changes[3]!.message).toContain('DataOutputAssociation_issue');
    expect(edit.changes[3]!.message).toContain('DataObjectReference_issue');
    expect(edit.xml).not.toContain('DataObject_issue');
    // The annotation that lost its association is still there, and the outline says so.
    const reading = await bpmnToOutline(edit.xml, { scenario: scenario as Record<string, unknown> });
    expect(reading.warnings).toEqual(['1 annotation, group or association is not part of the outline and was left out.']);
    expect(reading.outline.steps.some((s) => s.notes !== undefined || s.data !== undefined)).toBe(false);
  });
});

describe('the #638 refusals', () => {
  test('removeLane: unknown, not empty, onto itself, onto a parent lane, a lane with sub-lanes', async () => {
    const { xml, scenario } = await credit();
    const error = await refused(
      xml,
      [
        { op: 'removeLane', lane: 'Nobody' },
        { op: 'removeLane', lane: 'Customer' },
        { op: 'removeLane', lane: 'Customer', moveStepsTo: 'Customer' },
        { op: 'removeLane', lane: 'Customer', moveStepsTo: 'Nobody' },
      ],
      { scenario },
    );
    expect(error.issues.map((i) => [i.op, i.path, i.message])).toEqual([
      [0, 'lane', 'there is no lane "Nobody"; the lanes are: Customer, Analyst.'],
      [1, 'moveStepsTo', 'lane "Customer" holds reject, EndEvent_reject; give "moveStepsTo": the lane that takes them.'],
      [2, 'moveStepsTo', '"moveStepsTo" is the lane being removed ("Customer"); name another lane.'],
      [3, 'moveStepsTo', 'there is no lane "Nobody"; the lanes are: Customer, Analyst.'],
    ]);
    const nested = await refused(NESTED_LANES, [
      { op: 'removeLane', lane: 'Office' },
      { op: 'removeLane', lane: 'Field', moveStepsTo: 'Office' },
    ]);
    expect(nested.issues.map((i) => [i.op, i.path, i.message])).toEqual([
      [0, 'lane', 'lane "Office" has sub-lanes (Desk, Back); remove them first.'],
      [1, 'moveStepsTo', 'lane "Office" has sub-lanes (Desk, Back); nodes go to a lane without sub-lanes.'],
    ]);
  });

  test('removeLane of a sub-lane: its nodes go to a leaf; the last sub-lane leaves its parent a plain lane', async () => {
    const edit = await editBpmn(NESTED_LANES, [
      { op: 'removeLane', lane: 'Back', moveStepsTo: 'Field' },
      { op: 'removeLane', lane: 'Desk', moveStepsTo: 'Field' },
    ]);
    expect(await errorsOf(edit.xml)).toEqual([]);
    expect(edit.removed).toEqual(['Back', 'LS2', 'Desk']);
    expect(edit.xml).not.toContain('childLaneSet');
    expect(await laneOfNode(edit.xml, 'a')).toBe('Field');
    expect((await outlineOf(edit.xml)).lanes).toEqual(['Office', 'Field']);
  });

  test('moveLane: only among siblings, not next to itself', async () => {
    const error = await refused(NESTED_LANES, [
      { op: 'moveLane', lane: 'Desk', after: 'Field' },
      { op: 'moveLane', lane: 'Field', before: 'Field' },
      { op: 'moveLane', lane: 'Nobody', before: 'Field' },
    ]);
    expect(error.issues.map((i) => [i.op, i.path, i.message])).toEqual([
      [0, 'after', 'lanes "Desk" and "Field" are not in the same lane set; a lane moves only among its siblings.'],
      [1, 'before', 'lane "Field" cannot go next to itself.'],
      [2, 'lane', 'there is no lane "Nobody"; the lanes are: Office, Desk, Back, Field.'],
    ]);
    const edit = await editBpmn(NESTED_LANES, [{ op: 'moveLane', lane: 'Back', before: 'Desk' }]);
    expect(edit.xml.indexOf('id="Back"')).toBeLessThan(edit.xml.indexOf('id="Desk"'));
  });

  test('annotations and data objects: unknown steps, texts and names; data only on activities', async () => {
    const { xml, scenario } = await credit();
    const base = await editBpmn(xml, [{ op: 'annotate', on: 'check', text: 'Note' }, { op: 'addDataObject', name: 'File', on: 'check', direction: 'in' }], { scenario });
    const error = await refused(
      base.xml,
      [
        { op: 'annotate', on: 'nope', text: 'x' },
        { op: 'removeAnnotation', on: 'check', text: 'Other' },
        { op: 'removeAnnotation', on: 'receive', text: 'Note' },
        { op: 'addDataObject', name: 'File', on: 'ok', direction: 'in' },
        { op: 'removeDataObject', name: 'Folder' },
        { op: 'removeDataObject', name: 'File', on: 'receive' },
        { op: 'remove', id: 'Lane_1' },
      ],
      { scenario },
    );
    expect(error.issues.map((i) => [i.op, i.path, i.message])).toEqual([
      [0, 'on', '"nope" is not the id of an element of the model.'],
      [1, 'text', '"check" has no text annotation "Other"; its annotations are: "Note".'],
      [2, 'text', '"receive" has no text annotation "Note".'],
      [3, 'on', 'step "ok": "data" does not apply to an xor.'],
      [4, 'name', 'the process has no data object named "Folder"; its data objects are: "File".'],
      [5, 'on', 'data object "File" is not connected to "receive".'],
      [6, 'id', expect.stringContaining('"Lane_1" is a bpmn:Lane; only steps, sequence flows, boundary events and artifacts')],
    ]);
  });

  test('es messages', async () => {
    const { xml, scenario } = await credit();
    const error = await refused(xml, [{ op: 'removeLane', lane: 'Customer' }, { op: 'removeDataObject', name: 'File' }], { scenario, locale: 'es' });
    expect(error.message).toContain('operations[0].moveStepsTo: el carril "Customer" contiene reject, EndEvent_reject; indica "moveStepsTo": el carril que los recibe.');
    expect(error.message).toContain('operations[1].name: el proceso no tiene un objeto de datos llamado "File".');
  });
});

/* ------------------------------------------------------------------ *
 * QA of #661, round 1
 * ------------------------------------------------------------------ */

describe('QA of #661: boundary events, nested lanes and notes with the incremental layout', () => {
  /** Whether the centre of `b` lies on the bottom or the top border of `host`. */
  const onBorder = (b: Box, host: Box): boolean => {
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    return cx >= host.x && cx <= host.x + host.width && (Math.abs(cy - (host.y + host.height)) < 1 || Math.abs(cy - host.y) < 1);
  };
  const apart = (a: Box, b: Box): boolean => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  const timer = (id: string, more: Record<string, unknown>) => ({ op: 'addBoundary', on: 'work', boundary: { id, type: 'timer', duration: '30m', ...more } }) as EditOperation;

  test.each([
    ['in one call', 1],
    ['in two calls', 2],
  ])('two addBoundary on one host (layout: false, %s): each stays on its host, clear of the other', async (_, calls) => {
    const built = await outlineToBpmn({ name: 'D', steps: [{ id: 'work', name: 'Work', duration: '1h', end: true }] });
    const ops = [timer('warn', { interrupting: false, end: true }), timer('cut', { end: 'terminate' })];
    let { xml, scenario } = built as { xml: string; scenario: ScenarioDocument | undefined };
    for (const batch of calls === 1 ? [ops] : ops.map((op) => [op])) ({ xml, scenario } = await editBpmn(xml, batch, { scenario, layout: false }));
    expect(await errorsOf(xml)).toEqual([]);
    await expectCleanImport(xml);
    const { shapes, edges } = await di(xml);
    const host = shapes.get('work')!;
    for (const id of ['warn', 'cut']) expect(onBorder(shapes.get(id)!, host), id).toBe(true);
    expect(apart(shapes.get('warn')!, shapes.get('cut')!)).toBe(true);
    // Each boundary's flow leaves from the boundary itself.
    for (const id of ['warn', 'cut']) {
      const b = shapes.get(id)!;
      const [first] = edges.get(`Flow_${id}_EndEvent_${id}`)!;
      expect(first!.x >= b.x - 1 && first!.x <= b.x + b.width + 1 && first!.y >= b.y - 1 && first!.y <= b.y + b.height + 1, id).toBe(true);
    }
    expect((await bpmnToOutline(xml, { scenario: scenario as Record<string, unknown> })).warnings).toEqual([]);
  });

  test('four boundaries on one host (layout: false) all stay on it', async () => {
    const built = await outlineToBpmn({ name: 'D', lanes: ['A'], steps: [{ id: 'work', lane: 'A', duration: '1h', end: true }] });
    const ops = ['b1', 'b2', 'b3', 'b4'].map((id) => timer(id, { end: true }));
    const edit = await editBpmn(built.xml, ops, { scenario: built.scenario, layout: false });
    const { shapes } = await di(edit.xml);
    const ids = ['b1', 'b2', 'b3', 'b4'];
    for (const id of ids) expect(onBorder(shapes.get(id)!, shapes.get('work')!), id).toBe(true);
    for (const a of ids) for (const b of ids) if (a < b) expect(apart(shapes.get(a)!, shapes.get(b)!), `${a} ${b}`).toBe(true);
  });

  test('a boundary added (layout: false) next to one create_process drew (the 48 h example) does not overlap it', async () => {
    const example = JSON.parse(readFileSync(`${repo}examples/outline/claim-escalation.json`, 'utf8'));
    const built = await outlineToBpmn(example);
    const edit = await editBpmn(
      built.xml,
      [{ op: 'addBoundary', on: 'assess', boundary: { id: 'late', type: 'timer', duration: '72h', end: true } }],
      { scenario: built.scenario, layout: false },
    );
    const { shapes } = await di(edit.xml);
    for (const id of ['sla', 'late']) expect(onBorder(shapes.get(id)!, shapes.get('assess')!), id).toBe(true);
    expect(apart(shapes.get('sla')!, shapes.get('late')!)).toBe(true);
  });

  test('moveLane among sub-lanes (layout: false) keeps the parent lane in the pool', async () => {
    const drawn = await editBpmn(NESTED_LANES, [{ op: 'rename', id: 'Field', name: 'Field' }], { layout: true });
    const edit = await editBpmn(drawn.xml, [{ op: 'moveLane', lane: 'Back', before: 'Desk' }], { layout: false });
    expect(await errorsOf(edit.xml)).toEqual([]);
    await expectCleanImport(edit.xml);
    const { shapes } = await di(edit.xml);
    const [pool, office, back, desk, field] = ['Pool', 'Office', 'Back', 'Desk', 'Field'].map((id) => shapes.get(id)!);
    expect(office!.y).toBe(pool!.y);
    expect(back!.y).toBe(office!.y);
    expect(desk!.y).toBe(back!.y + back!.height);
    expect(office!.height).toBe(back!.height + desk!.height);
    expect(field!.y).toBe(office!.y + office!.height);
    expect(field!.y + field!.height).toBe(pool!.y + pool!.height);
    const inside = (id: string, lane: Box): boolean => {
      const b = shapes.get(id)!;
      return b.y >= lane.y && b.y + b.height <= lane.y + lane.height;
    };
    expect(inside('b', back!)).toBe(true);
    expect(inside('a', desk!)).toBe(true);
    expect(inside('c', field!)).toBe(true);
  });

  test.each([true, false])('removing a step takes its notes with it (layout %s)', async (layout) => {
    const { xml, scenario } = await credit();
    const noted = await editBpmn(xml, [{ op: 'annotate', on: 'check', text: 'Two signatures' }, { op: 'annotate', on: 'ok', text: 'Policy 7' }], { scenario, layout });
    const edit = await editBpmn(noted.xml, [{ op: 'remove', id: 'check' }], { scenario, layout });
    expect(edit.changes[0]!.message).toContain('TextAnnotation_check');
    expect(edit.removed).toEqual(expect.arrayContaining(['check', 'Association_check', 'TextAnnotation_check']));
    expect(edit.xml).not.toContain('TextAnnotation_check');
    expect(edit.xml).toContain('TextAnnotation_ok');
    await expectCleanImport(edit.xml);
    const reading = await bpmnToOutline(edit.xml, { scenario: scenario as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    expect(reading.outline.steps.find((s) => s.id === 'ok')?.notes).toEqual(['Policy 7']);
  });
});

/* ------------------------------------------------------------------ *
 * QA of #661, round 2
 * ------------------------------------------------------------------ */

describe('QA of #661, round 2: a host keeps its outgoing flow, data objects stay in their lane', () => {
  const within = (p: { x: number; y: number }, b: Box): boolean => p.x >= b.x - 1 && p.x <= b.x + b.width + 1 && p.y >= b.y - 1 && p.y <= b.y + b.height + 1;
  const inside = (b: Box, band: Box): boolean => b.y >= band.y && b.y + b.height <= band.y + band.height && b.x >= band.x && b.x + b.width <= band.x + band.width;
  const apart = (a: Box, b: Box): boolean => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  const timer = (id: string) => ({ op: 'addBoundary', on: 'work', boundary: { id, type: 'timer', duration: '30m', interrupting: false, end: true } }) as EditOperation;

  test.each([
    ['no lanes, one boundary', [], ['warn']],
    ['no lanes, two boundaries', [], ['warn', 'cut']],
    ['one lane, two boundaries', ['A'], ['warn', 'cut']],
    ['two lanes, next in the other, four boundaries', ['A', 'B'], ['b1', 'b2', 'b3', 'b4']],
  ] as const)('addBoundary with an end (layout: false, %s): the host\'s own outgoing flow still leaves the host', async (_, lanes, ids) => {
    const lane = (i: number) => (lanes.length === 0 ? {} : { lane: lanes[Math.min(i, lanes.length - 1)] });
    const built = await outlineToBpmn({
      name: 'D',
      ...(lanes.length === 0 ? {} : { lanes: [...lanes] }),
      steps: [
        { id: 'reg', duration: '5m', ...lane(0) },
        { id: 'work', name: 'Work', duration: '1h', ...lane(0) },
        { id: 'next', duration: '5m', end: true, ...lane(1) },
      ],
    });
    const edit = await editBpmn(built.xml, ids.map(timer), { scenario: built.scenario, layout: false });
    expect(await errorsOf(edit.xml)).toEqual([]);
    const { shapes, edges } = await di(edit.xml);
    const work = shapes.get('work')!;
    const flow = edges.get('Flow_work_next')!;
    expect(within(flow[0]!, work), JSON.stringify(flow)).toBe(true);
    expect(within(flow[flow.length - 1]!, shapes.get('next')!), JSON.stringify(flow)).toBe(true);
    for (const id of ids) expect(apart(shapes.get(`EndEvent_${id}`)!, shapes.get('next')!), id).toBe(true);
    expect((await bpmnToOutline(edit.xml, { scenario: edit.scenario as Record<string, unknown> })).warnings).toEqual([]);
  });

  test('the round-1 repro: a host whose only outgoing flow is its own end keeps it', async () => {
    const built = await outlineToBpmn({ name: 'D', steps: [{ id: 'work', name: 'Work', duration: '1h', end: true }] });
    const edit = await editBpmn(built.xml, [timer('warn'), { ...timer('cut'), boundary: { id: 'cut', type: 'timer', duration: '1h', end: 'terminate' } } as EditOperation], {
      scenario: built.scenario,
      layout: false,
    });
    const { shapes, edges } = await di(edit.xml);
    expect(within(edges.get('Flow_work_EndEvent_work')![0]!, shapes.get('work')!)).toBe(true);
  });

  test.each([
    ['two lanes', ['X', 'Y']],
    ['one lane', ['Y']],
  ])('create_process with lanes (%s): a data object of a step in the last lane stays in its lane, inside the pool', async (_, lanes) => {
    const built = await outlineToBpmn({
      name: 'D',
      lanes,
      steps: [
        { id: 'a', lane: lanes[0]! },
        { id: 'b', lane: 'Y', end: true, data: [{ name: 'Doc', direction: 'out' }] },
      ],
    });
    await expectCleanImport(built.xml);
    const { shapes } = await di(built.xml);
    const laneY = shapes.get(`Lane_${lanes.length}`)!;
    expect(inside(shapes.get('DataObjectReference_b')!, laneY), JSON.stringify([...shapes])).toBe(true);
    expect(inside(laneY, shapes.get('Participant_1')!)).toBe(true);
    expect(inside(shapes.get('b')!, laneY)).toBe(true);
  });

  test.each([
    ['Middle before Front', { op: 'moveLane', lane: 'Middle', before: 'Front' }],
    ['Front after Back', { op: 'moveLane', lane: 'Front', after: 'Back' }],
  ])('moveLane %s (layout: false): the data object and the note stay in the lane of their step', async (_, op) => {
    const built = await outlineToBpmn({
      name: 'D',
      lanes: ['Front', 'Middle', 'Back'],
      steps: [
        { id: 'reg', lane: 'Front', data: [{ name: 'Claim file', direction: 'out' }], notes: ['Two signatures'] },
        { id: 'chk', lane: 'Middle', data: [{ name: 'Claim file', direction: 'in' }] },
        { id: 'pay', lane: 'Back', end: true },
      ],
    });
    const edit = await editBpmn(built.xml, [op as EditOperation], { scenario: built.scenario, layout: false });
    await expectCleanImport(edit.xml);
    const { shapes } = await di(edit.xml);
    const front = shapes.get('Lane_1')!;
    for (const id of ['reg', 'DataObjectReference_reg', 'TextAnnotation_reg']) expect(inside(shapes.get(id)!, front), id).toBe(true);
    expect(inside(front, shapes.get('Participant_1')!)).toBe(true);
  });

  test('moveLane (layout: false) carries a data object drawn in the next lane with its step, not with that lane', async () => {
    const built = await outlineToBpmn({
      name: 'D',
      lanes: ['Front', 'Middle', 'Back'],
      steps: [
        { id: 'reg', lane: 'Front', data: [{ name: 'Claim file', direction: 'out' }] },
        { id: 'chk', lane: 'Middle' },
        { id: 'pay', lane: 'Back', end: true },
      ],
    });
    // As it was drawn before this fix (and as another editor may draw it): below the step, in the next lane.
    const before = await di(built.xml);
    const lanes = ['Lane_1', 'Lane_2'].map((id) => before.shapes.get(id)!);
    const shape = before.shapes.get('DataObjectReference_reg')!;
    const moved = built.xml.replace(
      new RegExp(`(bpmnElement="DataObjectReference_reg"[^>]*>\\s*<dc:Bounds x="[^"]*" y=")[^"]*"`),
      `$1${lanes[1]!.y + 10}"`,
    );
    expect(moved).not.toBe(built.xml);
    const edit = await editBpmn(moved, [{ op: 'moveLane', lane: 'Middle', before: 'Front' }], { scenario: built.scenario, layout: false });
    const { shapes } = await di(edit.xml);
    const reg = shapes.get('reg')!;
    const data = shapes.get('DataObjectReference_reg')!;
    // Front moved down by Middle's height; the data object went with reg, not up with Middle.
    expect(reg.y - before.shapes.get('reg')!.y).toBe(lanes[1]!.height);
    expect(data.y).toBeGreaterThan(reg.y);
    expect(data.x).toBe(shape.x);
    expect(inside(data, shapes.get('Lane_1')!), JSON.stringify([data, shapes.get('Lane_1')])).toBe(true);
  });

  test('removing every lane (layout: false) leaves the data objects inside the pool, clear of the pool below', async () => {
    const laned = await editBpmn(
      pedidoXml,
      [
        { op: 'addLane', name: 'Kitchen' },
        { op: 'addLane', name: 'Counter' },
        { op: 'moveToLane', id: 'Task_Revisar', lane: 'Counter' },
        { op: 'addDataObject', on: 'Task_Revisar', name: 'Doc', direction: 'out' },
        { op: 'addDataObject', on: 'Task_TomarPedido', name: 'Ticket', direction: 'out' },
      ],
      { scenario: pedidoScenario, layout: false },
    );
    const edit = await editBpmn(laned.xml, [{ op: 'removeLane', lane: 'Counter', moveStepsTo: 'Kitchen' }, { op: 'removeLane', lane: 'Kitchen' }], {
      scenario: laned.scenario,
      layout: false,
    });
    expect(await errorsOf(edit.xml)).toEqual([]);
    await expectCleanImport(edit.xml);
    for (const xml of [laned.xml, edit.xml]) {
      const { shapes } = await di(xml);
      const pool = shapes.get('Participant_Restaurante')!;
      for (const id of ['DataObjectReference_Task_Revisar', 'DataObjectReference_Task_TomarPedido']) {
        expect(inside(shapes.get(id)!, pool), `${id} ${JSON.stringify(shapes.get(id))} ${JSON.stringify(pool)}`).toBe(true);
        expect(apart(shapes.get(id)!, shapes.get('Participant_Cliente')!), id).toBe(true);
      }
      expect(apart(pool, shapes.get('Participant_Cliente')!)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * QA of #661, round 3
 * ------------------------------------------------------------------ */

describe('QA of #661, round 3: boundaries stay on a host that moves up a lane, shared data objects stay in a lane of a step that uses them', () => {
  const inside = (b: Box, band: Box): boolean => b.y >= band.y && b.y + b.height <= band.y + band.height && b.x >= band.x && b.x + b.width <= band.x + band.width;
  /** The centre of `b` on the top or bottom border of `host`. */
  const onBorder = (b: Box, host: Box): boolean => {
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    return c.x >= host.x && c.x <= host.x + host.width && (Math.abs(c.y - host.y) <= 1 || Math.abs(c.y - (host.y + host.height)) <= 1);
  };
  const steps = (boundary: unknown[]) => [
    { id: 'reg', lane: 'A', duration: '5m' },
    { id: 'work', name: 'Work', lane: 'B', duration: '1h', ...(boundary.length === 0 ? {} : { boundary }) },
    { id: 'next', lane: 'B', duration: '5m', end: true },
  ];
  const sla = { id: 'sla', type: 'timer', duration: '30m', interrupting: false, end: true };
  const cut = { id: 'cut', type: 'timer', duration: '2h', end: 'terminate' };

  test.each([
    ['moveToLane up, two boundaries from the outline', [sla, cut], [], [{ op: 'moveToLane', id: 'work', lane: 'A' }], ['sla', 'cut']],
    ['removeLane of the host\'s lane, one boundary', [sla], [], [{ op: 'removeLane', lane: 'B', moveStepsTo: 'A' }], ['sla']],
    ['removeLane of the host\'s lane, two boundaries', [sla, cut], [], [{ op: 'removeLane', lane: 'B', moveStepsTo: 'A' }], ['sla', 'cut']],
    [
      'two addBoundary, then moveToLane up',
      [],
      [
        { op: 'addBoundary', on: 'work', boundary: { id: 'b1', type: 'timer', duration: '30m', interrupting: false, end: true } },
        { op: 'addBoundary', on: 'work', boundary: { id: 'b2', type: 'timer', duration: '2h', end: 'terminate' } },
      ],
      [{ op: 'moveToLane', id: 'work', lane: 'A' }],
      ['b1', 'b2'],
    ],
  ] as const)('layout: false, %s: every boundary stays on its host', async (_, boundary, first, then, ids) => {
    const built = await outlineToBpmn({ name: 'D', lanes: ['A', 'B'], steps: steps([...boundary]) });
    let { xml, scenario } = built;
    if (first.length > 0) ({ xml, scenario } = await editBpmn(xml, first as unknown as EditOperation[], { scenario, layout: false }));
    const edit = await editBpmn(xml, then as unknown as EditOperation[], { scenario, layout: false });
    expect(await errorsOf(edit.xml)).toEqual([]);
    await expectCleanImport(edit.xml);
    const { shapes } = await di(edit.xml);
    const work = shapes.get('work')!;
    expect(inside(work, shapes.get('Lane_1')!)).toBe(true);
    for (const id of ids) expect(onBorder(shapes.get(id)!, work), `${id} ${JSON.stringify(shapes.get(id))} on ${JSON.stringify(work)}`).toBe(true);
    expect((await bpmnToOutline(edit.xml, { scenario: edit.scenario as Record<string, unknown> })).warnings).toEqual([]);
  });

  const front = { id: 'reg', lane: 'Front', duration: '5m', data: [{ name: 'File', direction: 'out' }] };
  const pay = { id: 'pay', lane: 'Back', duration: '5m', end: true, data: [{ name: 'File', direction: 'in' }] };

  test.each([
    [
      'two lanes, in three calls',
      { name: 'D', lanes: ['Front', 'Back'], steps: [front, pay] },
      [[{ op: 'moveLane', lane: 'Back', before: 'Front' }], [{ op: 'remove', id: 'reg' }], [{ op: 'removeLane', lane: 'Front', moveStepsTo: 'Back' }]],
    ],
    [
      'two lanes, in one call',
      { name: 'D', lanes: ['Front', 'Back'], steps: [front, pay] },
      [[{ op: 'moveLane', lane: 'Back', before: 'Front' }, { op: 'remove', id: 'reg' }, { op: 'removeLane', lane: 'Front', moveStepsTo: 'Back' }]],
    ],
    [
      'three lanes, in four calls',
      {
        name: 'D',
        lanes: ['Front', 'Middle', 'Back'],
        steps: [front, { id: 'chk', lane: 'Middle', duration: '5m', data: [{ name: 'File', direction: 'in' }] }, pay],
      },
      [
        [{ op: 'moveLane', lane: 'Back', before: 'Front' }],
        [{ op: 'removeLane', lane: 'Middle', moveStepsTo: 'Back' }],
        [{ op: 'remove', id: 'reg' }],
        [{ op: 'removeLane', lane: 'Front', moveStepsTo: 'Back' }],
      ],
    ],
  ] as const)('layout: false, %s: a data object shared with a removed step stays in the lane of pay, inside the pool', async (_, outline, calls) => {
    let { xml, scenario } = await outlineToBpmn(outline as never);
    for (const ops of calls) {
      ({ xml, scenario } = await editBpmn(xml, ops as unknown as EditOperation[], { scenario, layout: false }));
      const { shapes } = await di(xml);
      if (!xml.includes('id="reg"')) {
        const data = shapes.get('DataObjectReference_reg')!;
        const lane = [...shapes].find(([id, b]) => id.startsWith('Lane_') && inside(shapes.get('pay')!, b))![1];
        expect(inside(data, lane), `${JSON.stringify(data)} in ${JSON.stringify(lane)}`).toBe(true);
        expect(inside(data, shapes.get('Participant_1')!)).toBe(true);
      }
    }
    expect(xml).not.toContain('id="Lane_1"');
    expect(await errorsOf(xml)).toEqual([]);
    await expectCleanImport(xml);
  });
});

/* ------------------------------------------------------------------ *
 * QA of #661, round 4
 * ------------------------------------------------------------------ */

describe('QA of #661, round 4: edits that do not touch the data leave it where its author drew it; boundaries of a growing sub-process', () => {
  /** The bounds of the data objects and stores, lanes and pools of `xml`. */
  const frame = async (xml: string): Promise<Record<string, Box>> => {
    const { shapes } = await di(xml);
    return Object.fromEntries([...shapes].filter(([id]) => /^(DataObjectReference|DataStoreReference|DO_|DS_|Lane_|Participant_)/.test(id)));
  };

  test.each([
    ['a rename of another step', { op: 'rename', id: 'b', name: 'Pay invoice' }],
    ['a rename of the other lane', { op: 'rename', id: 'Lane_2', name: 'Rear' }],
  ] as const)('layout: false, %s keeps a data object drawn in the lane below its step where it is', async (_, op) => {
    const built = await outlineToBpmn({
      name: 'Hand',
      lanes: ['A', 'B'],
      steps: [
        { id: 'a', lane: 'A', data: [{ name: 'Doc', direction: 'out' }] },
        { id: 'b', lane: 'B', end: true },
      ],
    });
    const lane2 = (await di(built.xml)).shapes.get('Lane_2')!;
    // Drawn by hand in B, as bpmn-js allows anywhere in the participant.
    const hand = built.xml.replace(
      /(bpmnElement="DataObjectReference_a"[^>]*>\s*<dc:Bounds x="[^"]*" y=")[^"]*"/,
      `$1${lane2.y + 10}"`,
    );
    expect(hand).not.toBe(built.xml);
    const edit = await editBpmn(hand, [op as EditOperation], { scenario: built.scenario, layout: false });
    expect(await frame(edit.xml)).toEqual(await frame(hand));
  });

  test('layout: false, renames, adds and retypes elsewhere keep a data store drawn outside every pool where it is', async () => {
    const xml = pedidoXml
      .replace(
        '<bpmn:outgoing>Flow_TomarPedido_ANDFork</bpmn:outgoing>\n    </bpmn:task>',
        '<bpmn:outgoing>Flow_TomarPedido_ANDFork</bpmn:outgoing>\n      <bpmn:dataOutputAssociation id="DOA_Orders"><bpmn:targetRef>DS_Orders</bpmn:targetRef></bpmn:dataOutputAssociation>\n    </bpmn:task>\n    <bpmn:dataStoreReference id="DS_Orders" name="Orders" />',
      )
      .replace(
        '<bpmndi:BPMNShape id="Task_TomarPedido_di" bpmnElement="Task_TomarPedido">',
        '<bpmndi:BPMNShape id="DS_Orders_di" bpmnElement="DS_Orders"><dc:Bounds x="305" y="488" width="50" height="50" /></bpmndi:BPMNShape>\n      <bpmndi:BPMNEdge id="DOA_Orders_di" bpmnElement="DOA_Orders"><di:waypoint x="330" y="260" /><di:waypoint x="330" y="488" /></bpmndi:BPMNEdge>\n      <bpmndi:BPMNShape id="Task_TomarPedido_di" bpmnElement="Task_TomarPedido">',
      );
    expect(xml).toContain('id="DS_Orders_di"');
    expect(xml).toContain('<bpmn:dataStoreReference id="DS_Orders"');
    const before = await frame(xml);
    expect(before['DS_Orders']).toEqual({ x: 305, y: 488, width: 50, height: 50 });
    for (const op of [
      { op: 'rename', id: 'Task_Revisar', name: 'Review the order' },
      { op: 'annotate', on: 'Task_Revisar', text: 'Check twice' },
      { op: 'setType', id: 'Task_Revisar', type: 'userTask' },
      { op: 'add', after: 'Task_Revisar', step: { id: 'Task_Sellar', name: 'Stamp' } },
    ]) {
      const edit = await editBpmn(xml, [op as EditOperation], { scenario: pedidoScenario, layout: false });
      expect((await frame(edit.xml))['DS_Orders'], JSON.stringify(op)).toEqual(before['DS_Orders']);
    }
  });

  /** Lanes A (0..200) and B (200..400); the expanded sub-process sp of A crosses into B, with bt on its bottom border. */
  const SUB = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs" targetNamespace="http://example.com/sub">
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="P" name="Sub" processRef="Proc" />
  </bpmn:collaboration>
  <bpmn:process id="Proc" isExecutable="false">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="Lane_A" name="A"><bpmn:flowNodeRef>s</bpmn:flowNodeRef><bpmn:flowNodeRef>t</bpmn:flowNodeRef><bpmn:flowNodeRef>sp</bpmn:flowNodeRef><bpmn:flowNodeRef>bt</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="Lane_B" name="B"><bpmn:flowNodeRef>e</bpmn:flowNodeRef><bpmn:flowNodeRef>e2</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="s"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="t" name="T"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:task>
    <bpmn:subProcess id="sp" name="Sp"><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing>
      <bpmn:startEvent id="ss"><bpmn:outgoing>g1</bpmn:outgoing></bpmn:startEvent>
      <bpmn:task id="st" name="St"><bpmn:incoming>g1</bpmn:incoming><bpmn:outgoing>g2</bpmn:outgoing></bpmn:task>
      <bpmn:endEvent id="se"><bpmn:incoming>g2</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="g1" sourceRef="ss" targetRef="st" />
      <bpmn:sequenceFlow id="g2" sourceRef="st" targetRef="se" />
    </bpmn:subProcess>
    <bpmn:boundaryEvent id="bt" attachedToRef="sp" cancelActivity="false"><bpmn:outgoing>f4</bpmn:outgoing><bpmn:timerEventDefinition id="bt_def"><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>
    <bpmn:endEvent id="e"><bpmn:incoming>f3</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="e2"><bpmn:incoming>f4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="t" />
    <bpmn:sequenceFlow id="f2" sourceRef="t" targetRef="sp" />
    <bpmn:sequenceFlow id="f3" sourceRef="sp" targetRef="e" />
    <bpmn:sequenceFlow id="f4" sourceRef="bt" targetRef="e2" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="Collab">
      <bpmndi:BPMNShape id="P_di" bpmnElement="P" isHorizontal="true"><dc:Bounds x="0" y="0" width="900" height="400" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_A_di" bpmnElement="Lane_A" isHorizontal="true"><dc:Bounds x="30" y="0" width="870" height="200" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_B_di" bpmnElement="Lane_B" isHorizontal="true"><dc:Bounds x="30" y="200" width="870" height="200" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="s_di" bpmnElement="s"><dc:Bounds x="80" y="82" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="t_di" bpmnElement="t"><dc:Bounds x="150" y="60" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="sp_di" bpmnElement="sp" isExpanded="true"><dc:Bounds x="300" y="30" width="350" height="230" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="ss_di" bpmnElement="ss"><dc:Bounds x="330" y="92" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="st_di" bpmnElement="st"><dc:Bounds x="410" y="70" width="100" height="80" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="se_di" bpmnElement="se"><dc:Bounds x="570" y="92" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="bt_di" bpmnElement="bt"><dc:Bounds x="450" y="242" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="e_di" bpmnElement="e"><dc:Bounds x="720" y="282" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="e2_di" bpmnElement="e2"><dc:Bounds x="450" y="330" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="f1_di" bpmnElement="f1"><di:waypoint x="116" y="100" /><di:waypoint x="150" y="100" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f2_di" bpmnElement="f2"><di:waypoint x="250" y="100" /><di:waypoint x="300" y="100" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="g1_di" bpmnElement="g1"><di:waypoint x="366" y="110" /><di:waypoint x="410" y="110" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="g2_di" bpmnElement="g2"><di:waypoint x="510" y="110" /><di:waypoint x="570" y="110" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f3_di" bpmnElement="f3"><di:waypoint x="650" y="145" /><di:waypoint x="738" y="145" /><di:waypoint x="738" y="282" /></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f4_di" bpmnElement="f4"><di:waypoint x="468" y="278" /><di:waypoint x="468" y="330" /></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

  test.each([
    ['addLane Z after A', [{ op: 'addLane', name: 'Z', after: 'A' }]],
    ['addDataObject on t, which makes A taller', [{ op: 'addDataObject', name: 'F', on: 't', direction: 'in' }]],
  ] as const)('layout: false, %s: the boundary on the bottom border of an expanded sub-process that crosses the lane line stays on it', async (_, ops) => {
    await expectCleanImport(SUB);
    const edit = await editBpmn(SUB, ops as unknown as EditOperation[], { layout: false });
    const { shapes, edges } = await di(edit.xml);
    const sp = shapes.get('sp')!;
    const bt = shapes.get('bt')!;
    expect(sp.height, 'the sub-process grew').toBeGreaterThan(230);
    expect(bt.y + bt.height / 2, `${JSON.stringify(bt)} on ${JSON.stringify(sp)}`).toBe(sp.y + sp.height);
    expect(bt.x).toBe(450);
    const f4 = edges.get('f4')!;
    const within = (p: { x: number; y: number }, b: Box): boolean => p.x >= b.x - 1 && p.x <= b.x + b.width + 1 && p.y >= b.y - 1 && p.y <= b.y + b.height + 1;
    expect(within(f4[0]!, bt), JSON.stringify(f4)).toBe(true);
    expect(within(f4[f4.length - 1]!, shapes.get('e2')!), JSON.stringify(f4)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * QA of #661, round 5
 * ------------------------------------------------------------------ */

describe('QA of #661, round 5: a data object drawn off its step\'s lane stays in the pool when its lane goes', () => {
  const inside = (b: Box, band: Box): boolean => b.y >= band.y && b.y + b.height <= band.y + band.height && b.x >= band.x && b.x + b.width <= band.x + band.width;

  test.each([
    ['removeLane of its lane', [[{ op: 'removeLane', lane: 'Lane_2', moveStepsTo: 'Lane_1' }]]],
    ['remove b, then removeLane of its lane', [[{ op: 'remove', id: 'b' }], [{ op: 'removeLane', lane: 'Lane_2', moveStepsTo: 'Lane_1' }]]],
  ] as const)('layout: false, %s', async (_, calls) => {
    const built = await outlineToBpmn({
      name: 'Hand',
      lanes: ['A', 'B'],
      steps: [
        { id: 'a', lane: 'A', data: [{ name: 'Doc', direction: 'out' }] },
        { id: 'b', lane: 'B', end: true },
      ],
    });
    const lane2 = (await di(built.xml)).shapes.get('Lane_2')!;
    let xml = built.xml.replace(/(bpmnElement="DataObjectReference_a"[^>]*>\s*<dc:Bounds x="[^"]*" y=")[^"]*"/, `$1${lane2.y + 10}"`);
    let scenario = built.scenario;
    for (const ops of calls) ({ xml, scenario } = await editBpmn(xml, ops as unknown as EditOperation[], { scenario, layout: false }));
    const { shapes } = await di(xml);
    const data = shapes.get('DataObjectReference_a')!;
    expect(inside(data, shapes.get('Participant_1')!), `${JSON.stringify(data)} in ${JSON.stringify(shapes.get('Participant_1'))}`).toBe(true);
    expect(inside(data, shapes.get('Lane_1')!)).toBe(true);
    expect(await errorsOf(xml)).toEqual([]);
    await expectCleanImport(xml);
  });
});

/* ------------------------------------------------------------------ *
 * #664: setCalledProcess
 * ------------------------------------------------------------------ */

describe('setCalledProcess (#664)', () => {
  /** ORDER's call activity `fix`, and the processes of a .lila it can call. */
  async function order() {
    const built = await outlineToBpmn(ORDER);
    const own = /<bpmn:process id="([^"]+)"/.exec(built.xml)![1]!;
    const callTargets = new Map<string, CallTarget>([
      ['order-fulfilment', { processId: undefined, name: 'Order fulfilment', self: true }],
      ['credit-application', { processId: 'Process_credit_application', name: 'Credit application' }],
      ['b', { processId: 'Process_1', name: 'B', sharedWith: ['c'] }],
      ['c', { processId: 'Process_1', name: 'C', sharedWith: ['b', 'd'] }],
      ['twin', { processId: own, name: 'Twin' }],
      ['lost', { processId: undefined, name: 'Lost', declared: ['Process_A', 'Process_B'] }],
    ]);
    return { xml: built.xml, scenario: built.scenario, callTargets, own };
  }
  const callActivity = (xml: string): string => /<bpmn:callActivity id="fix"[^>]*>/.exec(xml)![0];

  test('the operation shape: a slug or null, in the schema and the reader', async () => {
    const ops: EditOperation[] = [
      { op: 'setCalledProcess', id: 'fix', process: 'credit-application' },
      { op: 'setCalledProcess', id: 'fix', process: null },
    ];
    expect(EditOperationsSchema.safeParse(ops).success).toBe(true);
    expect(EditOperationsSchema.safeParse([{ op: 'setCalledProcess', id: 'fix' }]).success).toBe(false);
    const { xml, callTargets } = await order();
    const error = await refused(
      xml,
      [
        { op: 'setCalledProcess', id: 'fix' },
        { op: 'setCalledProcess', id: 'fix', process: 3 },
        { op: 'setCalledProcess', id: 'fix', process: '' },
        { op: 'setCalledProcess', process: 'credit-application' },
        { op: 'setCalledProcess', id: 'fix', process: 'credit-application', calledElement: 'X' },
      ],
      { callTargets },
    );
    const bad = 'must be the slug of a process of the project, or null to remove the called process.';
    expect(error.issues.map((i) => [i.op, i.path, i.message])).toEqual([
      [0, 'process', bad],
      [1, 'process', bad],
      [2, 'process', bad],
      [3, 'id', 'must be a non-empty text.'],
      [4, 'calledElement', 'unknown field "calledElement".'],
    ]);
  });

  test('writes the calledElement of the target, and null removes it; ids, flows and the rest stay', async () => {
    const { xml, scenario, callTargets } = await order();
    expect(callActivity(xml)).not.toContain('calledElement');
    const set = await editBpmn(xml, [{ op: 'setCalledProcess', id: 'fix', process: 'credit-application' }], { scenario, callTargets, layout: false });
    expect(set.changes).toEqual([{ op: 0, message: '"fix" now calls Credit application (credit-application)' }]);
    expect(callActivity(set.xml)).toContain('calledElement="Process_credit_application"');
    expect(set.removed).toEqual([]);
    expect(set.scenario).toBeUndefined();
    expect(await errorsOf(set.xml)).toEqual(await errorsOf(xml));
    expect((await outlineOf(set.xml)).steps).toEqual((await outlineOf(xml)).steps);

    const cleared = await editBpmn(set.xml, [{ op: 'setCalledProcess', id: 'fix', process: null }], { scenario, callTargets, locale: 'es' });
    expect(cleared.changes).toEqual([{ op: 0, message: '"fix" ya no llama a ningún proceso' }]);
    expect(callActivity(cleared.xml)).not.toContain('calledElement');
  });

  test('refused: an unknown slug (the other slugs listed), its own process, a shared or unresolvable id, a step that is not a call activity, an unknown id', async () => {
    const { xml, callTargets, own } = await order();
    const error = await refused(
      xml,
      [
        { op: 'setCalledProcess', id: 'fix', process: 'billing' },
        { op: 'setCalledProcess', id: 'fix', process: 'order-fulfilment' },
        { op: 'setCalledProcess', id: 'take', process: 'credit-application' },
        { op: 'setCalledProcess', id: 'nope', process: 'credit-application' },
        { op: 'setCalledProcess', id: 'fix', process: 'credit-application' },
        { op: 'setCalledProcess', id: 'fix', process: 'b' },
        { op: 'setCalledProcess', id: 'fix', process: 'c' },
        { op: 'setCalledProcess', id: 'fix', process: 'twin' },
        { op: 'setCalledProcess', id: 'fix', process: 'lost' },
      ],
      { callTargets },
    );
    expect(error.issues.map((i) => [i.op, i.path, i.message])).toEqual([
      [0, 'process', 'the project has no process "billing"; the processes a call activity can call are: credit-application, b, c, twin, lost.'],
      [1, 'process', `"order-fulfilment" has the BPMN process id ${own}, that of the process being edited: a call activity cannot call its own process.`],
      [2, 'id', '"take" is a userTask, not a call activity (callActivity); only a call activity calls a process.'],
      [3, 'id', '"nope" is not the id of an element of the model.'],
      [5, 'process', '"b" has the BPMN process id Process_1, which "c" declares too: a call activity cannot tell them apart; give one of them another id (put_process_bpmn with mode "replace").'],
      [6, 'process', '"c" has the BPMN process id Process_1, which "b", "d" declare too: a call activity cannot tell them apart; give one of them another id (put_process_bpmn with mode "replace").'],
      // A map without sharedWith still never writes the edited process's own id.
      [7, 'process', `"twin" has the BPMN process id ${own}, that of the process being edited: a call activity cannot call its own process.`],
      [8, 'process', 'cannot tell which BPMN process of "lost" to call: its model declares Process_A, Process_B, and none of them is its model id or the process it simulates.'],
    ]);
    const es = await refused(xml, [{ op: 'setCalledProcess', id: 'fix', process: 'b' }], { callTargets, locale: 'es' });
    expect(es.message).toContain('operations[0].process: "b" tiene el id de proceso BPMN Process_1, que "c" también declara: una actividad de llamada no puede distinguirlos');
  });

  test('a bare model (no callTargets) refuses it: it needs a .lila', async () => {
    const { xml } = await order();
    for (const process of ['credit-application', null]) {
      const error = await refused(xml, [{ op: 'setCalledProcess', id: 'fix', process }]);
      expect(error.issues).toEqual([
        {
          op: 0,
          path: 'process',
          message: 'setCalledProcess needs a .lila: the called process is named by its slug among the processes of the project (edit_process, lila process edit).',
        },
      ]);
    }
    const es = await refused(xml, [{ op: 'setCalledProcess', id: 'fix', process: 'x' }], { locale: 'es' });
    expect(es.message).toContain('operations[0].process: setCalledProcess necesita un .lila');
  });
});
