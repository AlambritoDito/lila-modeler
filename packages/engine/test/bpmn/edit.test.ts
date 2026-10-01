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
import { editBpmn, EditError, type EditOperation } from '../../src/bpmn/edit.js';
import { bpmnToOutline, outlineToBpmn } from '../../src/bpmn/outline.js';
import { validateBpmnXml } from '../../src/bpmn/validate-report.js';
import type { ScenarioDocument } from '../../src/project/types.js';
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
    // The schema is checked first: an unknown op stops there.
    expect(error.issues).toEqual([expect.objectContaining({ op: 4, path: 'op' })]);

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
    expect(second.message).toContain('operations[1] step.id: id "check" is already used in the model.');
    expect(second.message).toContain('operations[3] lane: there is no lane "Nowhere"; the lanes are: Customer, Analyst.');
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
