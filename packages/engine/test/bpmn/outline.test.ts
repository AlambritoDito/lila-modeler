/**
 * Outlines (#97): `outlineToBpmn` builds a laid-out, valid BPMN from a step list and
 * `bpmnToOutline` reads it back. The #97 example (two lanes and a XOR) is the acceptance case.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BpmnModdle } from 'bpmn-moddle';
import { describe, expect, test } from 'vitest';

import {
  bpmnToOutline,
  normalizeOutline,
  OUTLINE_STEP_TYPES,
  OutlineError,
  OutlineSchema,
  outlineToBpmn,
  parseDuration,
} from '../../src/bpmn/outline.js';
import { validateBpmnXml } from '../../src/bpmn/validate-report.js';
import { parseScenario, validateScenario } from '../../src/scenario.js';
import { expectCleanImport } from '../fixtures/bpmn-import.js';
import { CONSTRUCTS, CREDIT, ORDER } from '../fixtures/outlines.js';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Bounds of every shape of the main plane, by element id, plus each lane's members. */
async function geometry(xml: string): Promise<{ shapes: Map<string, Box>; lanes: Map<string, string[]>; types: Map<string, string> }> {
  const { rootElement } = await BpmnModdle().fromXML(xml);
  const definitions = rootElement as any;
  const plane = definitions.diagrams[0].plane;
  const shapes = new Map<string, Box>();
  const types = new Map<string, string>();
  for (const di of plane.planeElement) {
    if (di.$type !== 'bpmndi:BPMNShape') continue;
    const { x, y, width, height } = di.bounds;
    shapes.set(di.bpmnElement.id, { x, y, width, height });
    types.set(di.bpmnElement.id, di.bpmnElement.$type);
  }
  const process = definitions.rootElements.find((el: any) => el.$type === 'bpmn:Process');
  const lanes = new Map<string, string[]>();
  for (const lane of process.laneSets?.[0]?.lanes ?? []) lanes.set(lane.id, (lane.flowNodeRef ?? []).map((n: any) => n.id));
  return { shapes, lanes, types };
}

const contains = (outer: Box, inner: Box): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
const overlaps = (a: Box, b: Box): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function expectLaidOut(xml: string): Promise<void> {
  const { shapes, lanes, types } = await geometry(xml);
  expect(lanes.size).toBeGreaterThan(0);
  const pool = [...shapes].find(([id]) => types.get(id) === 'bpmn:Participant')![1];
  const laneBoxes = [...lanes.keys()].map((id) => shapes.get(id)!);
  for (const [laneId, members] of lanes) {
    const lane = shapes.get(laneId)!;
    expect(contains(pool, lane), `${laneId} inside the pool`).toBe(true);
    for (const member of members) expect(contains(lane, shapes.get(member)!), `${member} inside ${laneId}`).toBe(true);
  }
  for (let i = 0; i < laneBoxes.length; i++) {
    for (let j = i + 1; j < laneBoxes.length; j++) expect(overlaps(laneBoxes[i]!, laneBoxes[j]!)).toBe(false);
  }
  // Boundary events sit on their host's border by design (#631).
  const nodes = [...shapes].filter(([id]) => !['bpmn:Participant', 'bpmn:Lane', 'bpmn:BoundaryEvent'].includes(types.get(id)!));
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      expect(overlaps(nodes[i]![1], nodes[j]![1]), `${nodes[i]![0]} overlaps ${nodes[j]![0]}`).toBe(false);
    }
  }
}

describe('outlineToBpmn', () => {
  test('the #97 example validates with no errors and has its two lanes laid out', async () => {
    const { xml, warnings } = await outlineToBpmn(CREDIT);
    const report = await validateBpmnXml(xml);
    expect(report.errors).toEqual([]);
    expect(warnings).toEqual([]);
    await expectLaidOut(xml);

    // Step ids are the BPMN ids; start and end events were added.
    expect(Object.keys(report.ir.nodes).sort()).toEqual(
      ['EndEvent_issue', 'EndEvent_reject', 'StartEvent', 'check', 'issue', 'ok', 'receive', 'reject'].sort(),
    );
    const { lanes } = await geometry(xml);
    expect(lanes.get('Lane_1')).toEqual(['reject', 'EndEvent_reject']);
    expect(lanes.get('Lane_2')).toContain('ok');
    expect(xml).toContain('exporter="Lila Modeler"');
  });

  test('every step type, AND split/join, a loop and three lanes', async () => {
    const { xml } = await outlineToBpmn(ORDER);
    expect((await validateBpmnXml(xml)).errors).toEqual([]);
    await expectLaidOut(xml);
    expect(xml).toContain('<bpmn:userTask id="take"');
    expect(xml).toContain('<bpmn:serviceTask id="invoice"');
    expect(xml).toContain('<bpmn:callActivity id="fix"');
    expect(xml).toContain('<bpmn:subProcess id="review"');
    expect(xml).toContain('<bpmn:inclusiveGateway id="notify"');
    expect(xml).toMatch(/<bpmn:intermediateCatchEvent id="wait"[^>]*>[\s\S]*?<bpmn:timerEventDefinition/);
    // The sub-process content is drawn on its own drill-down plane, not over the process.
    expect(xml).toMatch(/<bpmndi:BPMNPlane id="BPMNPlane_review" bpmnElement="review">[\s\S]*?bpmnElement="review_start"/);
    expect((await geometry(xml)).shapes.has('review_start')).toBe(false);
  });

  test('without lanes: a plain process, laid out by bpmn-auto-layout as it comes', async () => {
    const { xml } = await outlineToBpmn({ name: 'Two steps', steps: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    expect(xml).not.toContain('bpmn:collaboration');
    const { shapes } = await geometry(xml);
    expect(shapes.get('a')!.x).toBeLessThan(shapes.get('b')!.x);
    expect((await validateBpmnXml(xml)).errors).toEqual([]);
  });

  test('lanes named only on the steps are collected in order', async () => {
    const { outline } = await outlineToBpmn({ name: 'P', steps: [{ id: 'a' }, { id: 'b', lane: 'Back' }, { id: 'c', lane: 'Front' }] });
    expect(outline.lanes).toEqual(['Back', 'Front']);
    expect(outline.steps.map((s) => s.lane)).toEqual(['Back', 'Back', 'Front']);
  });

  test('the base scenario carries arrivals, durations, resources and probabilities, and validates', async () => {
    const { xml, scenario } = await outlineToBpmn(ORDER);
    const parsed = parseScenario(scenario);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const { ir } = await validateBpmnXml(xml);
    const errors = validateScenario(parsed.data!, ir).filter((p) => p.severity === 'error');
    expect(errors).toEqual([]);
    const elements = scenario['elements'] as Record<string, any>;
    expect(elements['StartEvent']).toEqual({ triggerCount: 20, interTriggerTimer: { type: 'constant', value: 60 } });
    expect(elements['take'].processingTime).toEqual({ type: 'triangular', min: 60, mode: 120, max: 300 });
    expect(elements['pick'].resources).toEqual([{ ref: 'picker', quantity: 2 }]);
    expect(elements['wait'].processingTime).toEqual({ type: 'constant', value: 86_400 });
    expect(elements['Flow_good_fix'].probability).toBe(0.1);
    expect(elements['Flow_good_ship'].probability).toBeCloseTo(0.9, 12);
    expect((scenario['resources'] as Record<string, any>)['picker']).toEqual({ name: 'Picker', capacity: 2 });
  });

  test('the #97 XOR: the branch without a probability takes the rest', async () => {
    const { scenario } = await outlineToBpmn(CREDIT);
    const elements = scenario['elements'] as Record<string, any>;
    expect(elements['Flow_ok_issue']).toEqual({ probability: 0.7 });
    expect(elements['Flow_ok_reject']).toEqual({ probability: 0.3 });
    expect(elements['check']).toEqual({ processingTime: { type: 'normal', mean: 1200, sd: 300 } });
  });
});

describe('bpmnToOutline', () => {
  test.each([
    ['the #97 example', CREDIT],
    ['every step type', ORDER],
  ])('round trip of %s, with its scenario', async (_label, outline) => {
    const built = await outlineToBpmn(outline);
    const { outline: back, warnings } = await bpmnToOutline(built.xml, { scenario: built.scenario });
    expect(warnings).toEqual([]);
    expect(back).toEqual(normalizeOutline(outline));
    expect(back).toEqual(built.outline);
  });

  test('a gateway branch that ends the process', async () => {
    const outline = {
      name: 'Ends',
      steps: [
        { id: 'a', name: 'A' },
        { id: 'g', type: 'xor' as const, branches: [{ label: 'stop', end: true, probability: 0.25 }, { label: 'stop too', end: true }, { to: 'b' }] },
        { id: 'b', name: 'B' },
      ],
    };
    const built = await outlineToBpmn(outline);
    expect((await validateBpmnXml(built.xml)).errors).toEqual([]);
    expect(built.xml).toContain('id="EndEvent_g"');
    expect(built.xml).toContain('id="EndEvent_g_2"');
    expect((await bpmnToOutline(built.xml, { scenario: built.scenario })).outline).toEqual(normalizeOutline(outline));
    expect(normalizeOutline(outline).steps[1]!.branches).toEqual([
      { end: true, label: 'stop', probability: 0.25 },
      { end: true, label: 'stop too', probability: 0.375 },
      { to: 'b', probability: 0.375 },
    ]);
  });

  test('without the scenario the structure still round-trips', async () => {
    const { xml } = await outlineToBpmn(CREDIT);
    const { outline } = await bpmnToOutline(xml);
    const expected = normalizeOutline(CREDIT);
    for (const step of expected.steps) {
      delete step.duration;
      for (const branch of step.branches ?? []) delete branch.probability;
    }
    expect(outline).toEqual(expected);
  });

  test('a foreign BPMN: other elements are reported, not invented', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="x">
  <bpmn:process id="P" name="Foreign">
    <bpmn:startEvent id="s"/><bpmn:manualTask id="t" name="T"/><bpmn:intermediateThrowEvent id="m"/><bpmn:endEvent id="e"/>
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="t"/><bpmn:sequenceFlow id="f2" sourceRef="t" targetRef="m"/>
    <bpmn:sequenceFlow id="f3" sourceRef="m" targetRef="e"/>
  </bpmn:process>
</bpmn:definitions>`;
    const { outline, warnings } = await bpmnToOutline(xml);
    // A start that is not the trivial `StartEvent` is listed; a manual task keeps its type (#631).
    expect(outline).toEqual({ name: 'Foreign', starts: [{ id: 's' }], steps: [{ id: 't', name: 'T', type: 'manualTask', from: 's', end: true }] });
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('m (bpmn:IntermediateThrowEvent)');
  });
});

describe('parseDuration: the scenario distributions, written short', () => {
  test.each([
    [90, { type: 'constant', value: 90 }],
    ['90', { type: 'constant', value: 90 }],
    ['20m', { type: 'constant', value: 1200 }],
    ['1.5 h', { type: 'constant', value: 5400 }],
    ['normal(20m, 5m)', { type: 'normal', mean: 1200, sd: 300 }],
    ['Normal(mean=20 min, sd=300)', { type: 'normal', mean: 1200, sd: 300 }],
    ['triangular(1m, 2m, 5m)', { type: 'triangular', min: 60, mode: 120, max: 300 }],
    ['exponencial(4m)', { type: 'exponential', mean: 240 }],
    ['erlang(k=3, mean=1h)', { type: 'erlang', k: 3, mean: 3600 }],
    [{ type: 'uniform', min: 1, max: 2 }, { type: 'uniform', min: 1, max: 2 }],
  ])('%j', (input, expected) => {
    expect(parseDuration(input as never)).toEqual(expected);
  });

  test.each(['', 'soon', 'normal(20m)', 'triangular(5m, 2m, 1m)', 'normal(20 parsecs, 1m)', 'erlang(k=2m, mean=1h)', 'user(1)'])(
    'rejects %j',
    (input) => {
      expect(parseDuration(input)).toBeNull();
    },
  );
});

describe('a malformed outline is an OutlineError with every issue, nothing built', () => {
  async function issues(outline: unknown, locale?: 'es'): Promise<OutlineError> {
    try {
      await outlineToBpmn(outline, { locale });
    } catch (error) {
      expect(error).toBeInstanceOf(OutlineError);
      return error as OutlineError;
    }
    throw new Error('expected an OutlineError');
  }

  test('schema problems', async () => {
    const error = await issues({ name: 'X', steps: [{ id: 'a', type: 'gateway' }], extra: 1 });
    expect(error.code).toBe('LILA-OUTLINE');
    expect(error.issues.map((i) => i.path).sort()).toEqual(['extra', 'steps[0].type']);
  });

  test('graph problems, all at once', async () => {
    const error = await issues({
      name: 'X',
      lanes: ['A', 'A'],
      steps: [
        { id: 'a', next: 'nowhere', lane: 'B' },
        { id: 'a' },
        { id: '1bad', branches: [{ to: 'a' }] },
        { id: 'g', type: 'xor', branches: [{ to: 'a', probability: 0.8 }, { to: 'a', probability: 0.4 }] },
        { id: 'p', type: 'and', branches: [{ to: 'a', probability: 0.5 }] },
        { id: 'q', next: 'a', end: true },
        { id: 'r', type: 'xor', branches: [{ label: 'both', to: 'a', end: true }] },
        { id: 't', type: 'timer', duration: 'soon', resources: ['R'] },
        { id: 'many', next: ['a', 'g'] },
      ],
    });
    const messages = error.issues.map((i) => `${i.path} ${i.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringContaining('lanes lane "A" is listed more than once'),
        expect.stringContaining('steps[0].lane step "a": lane "B" is not in "lanes"'),
        expect.stringContaining('"nowhere" is not the id of a step'),
        expect.stringContaining('steps[1].id id "a" is used more than once'),
        expect.stringContaining('id "1bad" is not a valid BPMN id'),
        expect.stringContaining('"branches" needs a gateway'),
        expect.stringContaining('add up to 1.2'),
        expect.stringContaining('"probability" does not apply'),
        expect.stringContaining('"end" cannot be combined'),
        expect.stringContaining('duration "soon" is not a distribution'),
        expect.stringContaining('"resources" does not apply to a timer'),
        expect.stringContaining('several "next" steps need a gateway'),
        expect.stringContaining('each branch needs either "to"'),
      ]),
    );
  });

  test('ids that clash with generated ones', async () => {
    const error = await issues({ name: 'X', steps: [{ id: 'StartEvent' }, { id: 'Flow_x' }, { id: 'b' }, { id: 'b_di' }] });
    expect(error.issues.map((i) => i.path)).toEqual(['steps[0].id', 'steps[1].id', 'steps[3].id']);
  });

  test('a model that does not validate is refused with the validator errors', async () => {
    // `b` is never reached and never leaves: the validator's own errors come back as issues.
    const error = await issues({ name: 'X', steps: [{ id: 'a', end: true }, { id: 'g', type: 'xor', next: 'a' }] });
    expect(error.issues.length).toBeGreaterThan(0);
    // The validator's errors come back with their codes, at the step they are about.
    expect(new Set(error.issues.map((i) => i.path))).toEqual(new Set(['steps[1]']));
    expect(error.issues[0]!.message).toMatch(/^E-[A-Z-]+: /);
  });

  test('messages follow the locale', async () => {
    const error = await issues({ name: 'X', steps: [{ id: 'a', next: 'zz' }] }, 'es');
    expect(error.message).toContain('el esquema del proceso no es válido');
    expect(error.message).toContain('"zz" no es el id de ningún paso');
  });
});

/* ------------------------------------------------------------------ *
 * Regressions from the QA of #553 (fixtures: test/fixtures/outlines/)
 * ------------------------------------------------------------------ */

const fixtures = fileURLToPath(new URL('../fixtures/outlines/', import.meta.url));
const qa = (name: string): unknown => JSON.parse(readFileSync(`${fixtures}${name}.json`, 'utf8'));

interface Edge {
  id: string;
  source: string;
  target: string;
  name?: string;
  points: { x: number; y: number }[];
  label?: Box;
}

async function edges(xml: string): Promise<Edge[]> {
  const { rootElement } = await BpmnModdle().fromXML(xml);
  return ((rootElement as any).diagrams[0].plane.planeElement as any[])
    .filter((di) => di.$type === 'bpmndi:BPMNEdge')
    .map((di) => ({
      id: di.bpmnElement.id,
      source: di.bpmnElement.sourceRef.id,
      target: di.bpmnElement.targetRef.id,
      name: di.bpmnElement.name,
      points: di.waypoint.map((p: any) => ({ x: p.x, y: p.y })),
      label: di.label?.bounds,
    }));
}

/** Does a segment of `points` go through the inside of `box`? */
function through(points: { x: number; y: number }[], box: Box): boolean {
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1]!, points[i]!];
    const [x1, x2, y1, y2] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
    if (x2 > box.x + 1 && x1 < box.x + box.width - 1 && y2 > box.y + 1 && y1 < box.y + box.height - 1) return true;
  }
  return false;
}

describe('QA of #553', () => {
  test('1. branches listed out of chain order no longer crash the layouter', async () => {
    const minimal = {
      name: 'Order',
      steps: [
        { id: 's1' },
        { id: 'g1', type: 'xor', branches: [{ to: 's4' }, { to: 's3' }, { to: 's2' }] },
        { id: 's2' },
        { id: 's3' },
        { id: 's4' },
      ],
    };
    for (const outline of [minimal, qa('06-ramas-terminan-saltos')]) {
      const { xml, scenario } = await outlineToBpmn(outline);
      expect((await validateBpmnXml(xml)).errors).toEqual([]);
      expect((await bpmnToOutline(xml, { scenario })).outline).toEqual(normalizeOutline(outline));
    }
  });

  test.each(['02-tarjeta', '05-and-or', '06-ramas-terminan-saltos', '10-entrevista-desordenada', '12-compras-un-carril'])(
    '2. %s: no flow is drawn through a shape it does not connect',
    async (name) => {
      const { xml } = await outlineToBpmn(qa(name));
      await expectLaidOut(xml);
      const { shapes, types } = await geometry(xml);
      for (const edge of await edges(xml)) {
        for (const [id, box] of shapes) {
          if (id === edge.source || id === edge.target || ['bpmn:Participant', 'bpmn:Lane'].includes(types.get(id)!)) continue;
          expect(through(edge.points, box), `${edge.id} goes through ${id}`).toBe(false);
        }
      }
    },
  );

  test.each(['02-tarjeta', '05-and-or', '10-entrevista-desordenada', '12-compras-un-carril'])(
    '3. %s: every branch label sits on its own branch, nearer its target than any sibling\'s',
    async (name) => {
      const { xml } = await outlineToBpmn(qa(name));
      const { shapes } = await geometry(xml);
      const all = await edges(xml);
      const centre = (b: Box): { x: number; y: number } => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
      const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
      // The distance from a point to the polyline of an edge.
      const toEdge = (p: { x: number; y: number }, e: Edge): number =>
        Math.min(
          ...e.points.slice(1).map((b, i) => {
            const a = e.points[i]!;
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (Math.hypot(b.x - a.x, b.y - a.y) ** 2 || 1)));
            return distance(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
          }),
        );
      for (const edge of all.filter((e) => e.name)) {
        expect(edge.label, `${edge.id} has a BPMNLabel`).toBeDefined();
        const label = centre(edge.label!);
        const siblings = all.filter((e) => e.source === edge.source && e.id !== edge.id);
        for (const sibling of siblings) {
          expect(toEdge(label, edge), `${edge.id} "${edge.name}" vs ${sibling.id}`).toBeLessThanOrEqual(toEdge(label, sibling));
        }
        void shapes;
      }
    },
  );

  test('4. every problem at once, in the caller\'s language, with steps[i].field paths', async () => {
    let error: OutlineError | undefined;
    try {
      await outlineToBpmn(
        {
          name: 'X',
          steps: [
            { id: 'a', duraton: '5m' },
            { id: 'a' },
            { id: 'g', type: 'xor', branches: [{ to: 'zz', probability: 0.8 }, { to: 'a', probability: 0.5 }] },
            { id: 'c', duration: 'normal(5m)', resources: [{ name: 'R', quantity: 0 }] },
          ],
        },
        { locale: 'es' },
      );
    } catch (e) {
      error = e as OutlineError;
    }
    expect(error?.issues.map((i) => i.path)).toEqual([
      'steps[0].duraton',
      'steps[3].resources[0].quantity',
      'steps[1].id',
      'steps[2].branches[0].to',
      'steps[2].branches',
      'steps[3].duration',
    ]);
    expect(error?.message).toContain('campo desconocido "duraton"');
    expect(error?.message).toContain('debe ser un número entero de al menos 1');
    expect(error?.message).not.toMatch(/Unrecognized|Too small|expected/);
  });

  test('5. a loop with no way out is refused, one issue per stuck step', async () => {
    const outline = {
      name: 'C',
      steps: [
        { id: 's' },
        { id: 'g', type: 'xor', branches: [{ to: 'a', probability: 0.5 }, { end: true }] },
        { id: 'a' },
        { id: 'b', next: 'a' },
      ],
    };
    await expect(outlineToBpmn(outline)).rejects.toMatchObject({
      issues: [
        { path: 'steps[2]', message: expect.stringContaining('from step "a" no path reaches an end') },
        { path: 'steps[3]', message: expect.stringContaining('from step "b"') },
      ],
    });
  });

  test('nits: rounded probabilities, 1h30m, and a parallel join behind an exclusive split', async () => {
    const { outline, scenario, notes } = await outlineToBpmn({
      name: 'N',
      steps: [
        { id: 'a', duration: '1h30m' },
        { id: 'g', type: 'xor', branches: [{ to: 'b', probability: 0.8 }, { to: 'c' }] },
        { id: 'b', next: 'j' },
        { id: 'c' },
        { id: 'j', type: 'and' },
      ],
    });
    expect(outline.steps[1]!.branches!.map((b) => b.probability)).toEqual([0.8, 0.2]);
    expect((scenario['elements'] as any)['a'].processingTime).toEqual({ type: 'constant', value: 5400 });
    expect(notes).toEqual([expect.stringContaining('parallel join "j" waits for branches of the exclusive gateway "g"')]);
  });

  test('6. resource selection is part of the outline and reaches the scenario', async () => {
    const outline = { name: 'S', steps: [{ id: 't', resources: ['A', 'B'], selection: 'or' }] };
    const built = await outlineToBpmn(outline);
    expect((built.scenario['elements'] as any)['t'].selection).toBe('or');
    expect((await bpmnToOutline(built.xml, { scenario: built.scenario })).outline.steps[0]!.selection).toBe('or');
  });

  test('6. a BPMN without names takes the process id as its name', async () => {
    const examples = fileURLToPath(new URL('../../../../examples/bizagi-exports/', import.meta.url));
    const file = readdirSync(examples).find((f) => f.endsWith('.bpmn'))!;
    const { outline } = await bpmnToOutline(readFileSync(examples + file, 'utf8'));
    expect(outline.name).not.toBe('');
  });
});

/* ------------------------------------------------------------------ *
 * Lote Q (#631, #638): the reader takes the new constructs
 * ------------------------------------------------------------------ */

describe('the outline reader: starts, terminate, default flows, new types, boundary, notes, data (#631, #638)', () => {
  async function refusedWith(outline: unknown, locale?: 'es'): Promise<{ path: string; message: string }[]> {
    try {
      await outlineToBpmn(outline, { locale });
    } catch (error) {
      expect(error).toBeInstanceOf(OutlineError);
      return (error as OutlineError).issues.map(({ path, message }) => ({ path, message }));
    }
    throw new Error('expected an OutlineError');
  }

  /** The claim escalation of the docs, with every new field once. */
  const ESCALATION = {
    name: 'Claim',
    lanes: ['Intake', 'Adjuster', 'Supervisor'],
    starts: [
      { id: 'web', name: 'Claim filed online', lane: 'Intake' },
      { id: 'nightly', name: 'Nightly batch', type: 'timer', lane: 'Intake' },
    ],
    steps: [
      { id: 'register', type: 'manualTask', name: 'Register claim', lane: 'Intake', from: ['web', 'nightly'], notes: ['Paper claims too'] },
      {
        id: 'assess',
        type: 'userTask',
        name: 'Assess claim',
        lane: 'Adjuster',
        duration: '2h',
        data: [{ name: 'Claim file', direction: 'in' }, { name: 'Assessment', direction: 'out' }],
        boundary: [{ id: 'sla', type: 'timer', name: '48 h', duration: '48h', interrupting: false, to: 'escalate' }],
      },
      {
        id: 'ok',
        type: 'xor',
        name: 'Covered?',
        branches: [{ label: 'Yes', to: 'notify', default: true }, { label: 'Fraud', end: 'terminate', probability: 0.05 }],
      },
      { id: 'notify', type: 'sendTask', name: 'Notify customer', next: 'reply' },
      { id: 'reply', type: 'eventGateway', name: 'Reply?', branches: [{ to: 'answer' }, { to: 'timeout' }] },
      { id: 'answer', type: 'message', name: 'Customer answers', duration: '1d', end: true },
      { id: 'timeout', type: 'timer', name: '5 days', duration: '5d', end: 'terminate' },
      { id: 'escalate', name: 'Escalate', lane: 'Supervisor', end: true },
    ],
  };

  test('the zod schema accepts every new field', () => {
    expect(OutlineSchema.safeParse(ESCALATION).success).toBe(true);
    expect(OUTLINE_STEP_TYPES).toEqual(
      expect.arrayContaining(['sendTask', 'receiveTask', 'manualTask', 'scriptTask', 'businessRuleTask', 'eventGateway', 'message']),
    );
  });

  test('the hand reader accepts them too, and they build and read back with no warning (#638 notes and data)', async () => {
    const built = await outlineToBpmn(ESCALATION);
    expect(built.warnings).toEqual([]);
    const reading = await bpmnToOutline(built.xml, { scenario: built.scenario as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    expect(reading.outline).toEqual(built.outline);
    expect(built.outline.steps[0]!.notes).toEqual(['Paper claims too']);
    expect(built.outline.steps[1]!.data).toEqual([
      { name: 'Claim file', direction: 'in' },
      { name: 'Assessment', direction: 'out' },
    ]);
  });

  test('every malformed new field, at its path, at once', async () => {
    const issues = await refusedWith({
      name: 'X',
      starts: [{ id: '', type: 'message', lane: 3, extra: 1 }, 'web'],
      steps: [
        { id: 'a', type: 'eventGatway', from: 7, end: 'stop' },
        { id: 'g', type: 'xor', branches: [{ to: 'a', default: 'yes' }, { end: 'abort' }] },
        {
          id: 'b',
          boundary: [
            { id: 'sla', type: 'message', duration: '1h', interrupting: 'no', to: 'a' },
            { id: 'both', type: 'timer', to: 'a', end: true },
            { id: 'neither', type: 'timer' },
            { type: 'timer', end: true, when: 'later' },
            'sla',
          ],
          notes: ['ok', ''],
          data: [{ name: 'File', direction: 'inout' }, { direction: 'in' }, { name: 'X', direction: 'out', kind: 'store' }, 4],
        },
        { id: 'c', boundary: [], notes: 'text', data: {} },
      ],
    });
    const at = (path: string): string[] => issues.filter((i) => i.path === path).map((i) => i.message);
    expect(at('starts[0].id')).toEqual(['must be a non-empty text.']);
    expect(at('starts[0].type')).toEqual(['must be one of none, timer.']);
    expect(at('starts[0].lane')).toEqual(['must be a non-empty text.']);
    expect(at('starts[0].extra')).toEqual(['unknown field "extra".']);
    expect(at('starts[1]')).toEqual(['must be an object.']);
    expect(at('steps[0].type')[0]).toContain('"eventGatway" is not a step type; use one of task, userTask, serviceTask, sendTask');
    expect(at('steps[0].from')).toEqual(['must be a start id or a list of start ids.']);
    expect(at('steps[0].end')).toEqual(['must be true, false or "terminate".']);
    expect(at('steps[1].branches[0].default')).toEqual(['must be true or false.']);
    expect(at('steps[1].branches[1].end')).toEqual(['must be true, false or "terminate".']);
    expect(at('steps[2].boundary[0].type')).toEqual(['must be one of timer.']);
    expect(at('steps[2].boundary[0].interrupting')).toEqual(['must be true or false.']);
    expect(at('steps[2].boundary[1]')).toEqual(['boundary "both" needs exactly one of "to" (a step id) and "end".']);
    expect(at('steps[2].boundary[2]')).toEqual(['boundary "neither" needs exactly one of "to" (a step id) and "end".']);
    expect(at('steps[2].boundary[3].id')).toEqual(['must be a non-empty text.']);
    expect(at('steps[2].boundary[3].when')).toEqual(['unknown field "when".']);
    expect(at('steps[2].boundary[4]')).toEqual(['must be an object.']);
    expect(at('steps[2].notes[1]')).toEqual(['must be a non-empty text.']);
    expect(at('steps[2].data[0].direction')).toEqual(['must be one of in, out.']);
    expect(at('steps[2].data[1].name')).toEqual(['must be a non-empty text.']);
    expect(at('steps[2].data[2].kind')).toEqual(['unknown field "kind".']);
    expect(at('steps[2].data[3]')).toEqual(['must be an object.']);
    expect(at('steps[3].boundary')).toEqual(['must be a non-empty list.']);
    expect(at('steps[3].notes')).toEqual(['must be a list of non-empty texts.']);
    expect(at('steps[3].data')).toEqual(['must be a non-empty list.']);
    // A well-formed boundary on a valid path is not reported for its target.
    expect(at('steps[2].boundary[0]')).toEqual([]);
  });

  test('the new messages follow the locale', async () => {
    const issues = await refusedWith(
      { name: 'X', starts: [{ id: 's', type: 'cron' }], steps: [{ id: 'a', from: [], end: 'stop', boundary: [{ id: 'b', type: 'timer' }] }] },
      'es',
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        { path: 'starts[0].type', message: 'debe ser uno de none, timer.' },
        { path: 'steps[0].from', message: 'debe ser el id de un inicio o una lista de ids de inicio.' },
        { path: 'steps[0].end', message: 'debe ser true, false o "terminate".' },
        { path: 'steps[0].boundary[0]', message: 'el evento adjunto "b" necesita uno solo de "to" (el id de un paso) y "end".' },
      ]),
    );
  });
});

/* ------------------------------------------------------------------ *
 * Lote Q contract review (#631, #638): the graph rules, the end ids, the reader's warnings
 * ------------------------------------------------------------------ */

describe('the contract rules of the new constructs (#631, #638)', () => {
  async function issuesOf(outline: unknown): Promise<Map<string, string[]>> {
    try {
      await outlineToBpmn(outline);
    } catch (error) {
      expect(error).toBeInstanceOf(OutlineError);
      const byPath = new Map<string, string[]>();
      for (const { path, message } of (error as OutlineError).issues) {
        (byPath.get(path) ?? byPath.set(path, []).get(path)!).push(message);
      }
      return byPath;
    }
    throw new Error('expected an OutlineError');
  }

  test('an event gateway leads only to timer or message steps that have no other way in', async () => {
    const issues = await issuesOf({
      name: 'X',
      steps: [
        { id: 'a', next: 'wait' },
        { id: 'g', type: 'eventGateway', branches: [{ to: 'wait', probability: 0.5 }, { to: 'a' }, { end: true }, { to: 'msg', default: true }] },
        { id: 'wait', type: 'timer', duration: '1h', end: true },
        { id: 'msg', type: 'message', end: true },
        { id: 'h', type: 'eventGateway', branches: [{ to: 'msg2' }] },
        { id: 'msg2', type: 'message' },
        { id: 'lost', type: 'message', end: true },
        { id: 'last', type: 'eventGateway' },
      ],
    });
    expect(issues.get('steps[1].branches[0].to')).toEqual([
      'step "wait" follows the event gateway "g", so that must be its only way in; it has a, g. Check "next", "to", "from" and the step before it in the list.',
    ]);
    expect(issues.get('steps[1].branches[0].probability')).toEqual(['step "g": "probability" does not apply to a eventGateway.']);
    expect(issues.get('steps[1].branches[1].to')![0]).toContain('event gateway "g": every way out goes to a timer or message step, and "a" is not one');
    expect(issues.get('steps[1].branches[2].end')![0]).toContain('and "end" is not one');
    expect(issues.get('steps[1].branches[3].default')).toEqual(['step "g": "default" does not apply to a eventGateway.']);
    // msg2 is the step right after its gateway in the list, and its only branch: one way in, fine.
    expect(issues.has('steps[4].branches[0].to')).toBe(false);
    // The step before `lost` falls into it, and nothing else: a message needs an event gateway.
    expect(issues.get('steps[6].type')).toEqual(['step "lost": a message step only goes after an event gateway, as one of its branches.']);
    // The last step: its implicit way out is the end.
    expect(issues.get('steps[7]')![0]).toContain('event gateway "last"');
  });

  test('a timer after an event gateway that the step before it also falls into has two ways in', async () => {
    const issues = await issuesOf({
      name: 'X',
      steps: [
        { id: 'g', type: 'eventGateway', branches: [{ to: 't1' }, { to: 't2' }] },
        { id: 't1', type: 'timer', duration: '1h' },
        { id: 't2', type: 'timer', duration: '2h', end: true },
      ],
    });
    expect(issues.get('steps[0].branches[1].to')![0]).toContain('it has g, t1.');
  });

  test('default flows: xor and or only, one per gateway', async () => {
    const issues = await issuesOf({
      name: 'X',
      steps: [
        { id: 'p', type: 'and', branches: [{ to: 'x', default: true }, { to: 'x' }] },
        { id: 'x', type: 'xor', branches: [{ to: 'a', default: true }, { to: 'a', default: true }, { to: 'a', default: false }] },
        { id: 'a', end: true },
      ],
    });
    expect(issues.get('steps[0].branches[0].default')).toEqual(['step "p": "default" does not apply to a and.']);
    expect(issues.get('steps[1].branches')).toEqual(['gateway "x": only one branch can be the default ("default": true).']);
  });

  test('starts: each one in the "from" of exactly one step, "from" only with starts, lanes as for steps', async () => {
    const issues = await issuesOf({
      name: 'X',
      lanes: ['A'],
      starts: [{ id: 's1', lane: 'B' }, { id: 's2' }, { id: 's3' }],
      steps: [
        { id: 'a', from: ['s1', 'nope'] },
        { id: 'b', from: 's1' },
        { id: 'c', from: 's2', next: 's3' },
      ],
    });
    expect(issues.get('starts[0].lane')).toEqual(['start "s1": lane "B" is not in "lanes".']);
    expect(issues.get('steps[0].from[1]')).toEqual(['step "a": "nope" is not the id of a start in "starts".']);
    expect(issues.get('starts[0]')![0]).toContain('start "s1" is in the "from" of several steps (a, b)');
    expect(issues.get('starts[2]')).toEqual(['start "s3" leads nowhere: name it in the "from" of the step it leads to.']);
    // A start id is not a step id: `next` cannot name it.
    expect(issues.get('steps[2].next')).toEqual(['step "c": "s3" is not the id of a step.']);
    expect((await issuesOf({ name: 'X', steps: [{ id: 'a', from: 's' }] })).get('steps[0].from')).toEqual([
      'step "a": "from" names start events, so it needs "starts".',
    ]);
  });

  test('starts, steps and boundary events share one space of ids', async () => {
    const issues = await issuesOf({
      name: 'X',
      starts: [{ id: 'a' }],
      steps: [
        { id: 'a', from: 'a', boundary: [{ id: 'b', type: 'timer', duration: '1h', end: true }] },
        { id: 'b', end: true },
      ],
    });
    expect(issues.get('steps[0].id')![0]).toContain('id "a" is used more than once');
    expect(issues.get('steps[1].id')![0]).toContain('id "b" is used more than once');
  });

  test('boundary events: on tasks and call activities, to a step, with a valid duration', async () => {
    const issues = await issuesOf({
      name: 'X',
      steps: [
        { id: 'g', type: 'xor', branches: [{ to: 'c' }, { to: 's' }], boundary: [{ id: 'b0', type: 'timer', end: true }] },
        { id: 'c', type: 'callActivity', boundary: [{ id: 'b1', type: 'timer', duration: 'soon', to: 'ghost', label: 'Late' }], end: true },
        { id: 's', type: 'subprocess', boundary: [{ id: 'b2', type: 'timer', end: true }], end: true },
      ],
    });
    expect(issues.get('steps[0].boundary')).toEqual(['step "g": "boundary" does not apply to a xor.']);
    expect(issues.has('steps[1].boundary')).toBe(false);
    expect(issues.get('steps[1].boundary[0].to')).toEqual(['step "c": "ghost" is not the id of a step.']);
    expect(issues.get('steps[1].boundary[0].duration')![0]).toContain('duration "soon" is not a distribution');
    expect(issues.get('steps[2].boundary')).toEqual(['step "s": "boundary" does not apply to a subprocess.']);
  });

  test('data: on activities, a name and direction once per step', async () => {
    const issues = await issuesOf({
      name: 'X',
      steps: [
        { id: 'a', data: [{ name: 'File', direction: 'in' }, { name: 'File', direction: 'out' }, { name: 'File', direction: 'in' }] },
        { id: 's', type: 'subprocess', data: [{ name: 'File', direction: 'out' }] },
        { id: 'g', type: 'and', data: [{ name: 'File', direction: 'in' }], end: true },
      ],
    });
    expect(issues.get('steps[0].data[2]')).toEqual(['step "a": data "File" (in) is listed more than once.']);
    expect(issues.has('steps[1].data')).toBe(false);
    expect(issues.get('steps[2].data')).toEqual(['step "g": "data" does not apply to a and.']);
  });

  test('notes: each text once per step (removeAnnotation names a note by its text)', async () => {
    const issues = await issuesOf({
      name: 'X',
      steps: [
        { id: 'a', notes: ['Check ID', 'Paper too', 'Check ID'] },
        { id: 'b', notes: ['Check ID'], end: true },
      ],
    });
    expect(issues.get('steps[0].notes[2]')).toEqual(['step "a": the note "Check ID" is listed more than once.']);
    expect(issues.has('steps[1].notes[0]')).toBe(false);
  });
});

describe('the trivial start and the exclusive splits of the new constructs (#631 contract review)', () => {
  test('starts: [{ id: "StartEvent" }] to a step further down is the trivial start: its step moves to the head', async () => {
    const outline = {
      name: 'X',
      starts: [{ id: 'StartEvent' }],
      steps: [
        { id: 'a', next: 'c' },
        { id: 'b', from: 'StartEvent', next: 'a' },
        { id: 'c', end: true },
      ],
    };
    const normal = normalizeOutline(outline);
    // b first; then a and c follow it in the list, so no `next` is left.
    expect(normal).toEqual({ name: 'X', steps: [{ id: 'b' }, { id: 'a' }, { id: 'c', end: true }] });
    const built = await outlineToBpmn(outline);
    const reading = await bpmnToOutline(built.xml, { scenario: built.scenario as unknown as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    expect(reading.outline).toEqual(normal);
  });

  test('a parallel join of the branches of an event gateway is flagged like one behind an xor', async () => {
    const built = await outlineToBpmn({
      name: 'X',
      steps: [
        { id: 'g', type: 'eventGateway', branches: [{ to: 'm' }, { to: 't' }] },
        { id: 'm', type: 'message', duration: '1h', next: 'j' },
        { id: 't', type: 'timer', duration: '2h', next: 'j' },
        { id: 'j', type: 'and', end: true },
      ],
    });
    expect(built.notes).toEqual([
      'parallel join "j" waits for branches of the exclusive gateway "g", which only ever takes one: cases would wait there forever. Use an xor (or or) join.',
    ]);
  });
});

describe('generated end ids never clash (#631 review)', () => {
  test('the second end of "x" and the end of step "x_2" get different ids, each with its flow', async () => {
    const outline = {
      name: 'X',
      steps: [
        { id: 'x', type: 'xor', branches: [{ label: 'No', end: true }, { label: 'Cancel', end: true }, { label: 'Yes', to: 'x_2' }] },
        { id: 'x_2', end: true },
      ],
    };
    const built = await outlineToBpmn(outline);
    const { rootElement } = await BpmnModdle().fromXML(built.xml);
    const process = (rootElement as any).rootElements.find((el: any) => el.$type === 'bpmn:Process');
    const ends = process.flowElements.filter((el: any) => el.$type === 'bpmn:EndEvent');
    expect(ends.map((el: any) => el.id).sort()).toEqual(['EndEvent_x', 'EndEvent_x_2', 'EndEvent_x_2_2']);
    const flows = process.flowElements.filter((el: any) => el.$type === 'bpmn:SequenceFlow');
    for (const end of ends) expect(flows.filter((f: any) => f.targetRef === end)).toHaveLength(1);
    const reading = await bpmnToOutline(built.xml, { scenario: built.scenario as unknown as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    expect(reading.outline).toEqual(normalizeOutline(outline));
  });
});

describe('the reader never returns an outline normalizeOutline refuses, and says what it leaves out (#631 review)', () => {
  const xml = (gateway: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="https://example.org">
  <bpmn:process id="P" name="P" isExecutable="true">
    <bpmn:startEvent id="S"><bpmn:signalEventDefinition /></bpmn:startEvent>
    <bpmn:sequenceFlow id="f1" name="go" sourceRef="S" targetRef="a" />
    <bpmn:sequenceFlow id="f2" sourceRef="S" targetRef="b" />
    <bpmn:task id="a" /><bpmn:task id="b" />
    <bpmn:${gateway} id="g" />
    <bpmn:sequenceFlow id="f3" sourceRef="a" targetRef="g" />
    <bpmn:sequenceFlow id="f4" sourceRef="g" targetRef="b" />
    <bpmn:sequenceFlow id="f5" sourceRef="g" targetRef="E" />
    <bpmn:sequenceFlow id="f6" sourceRef="b" targetRef="E2" />
    <bpmn:endEvent id="E"><bpmn:messageEventDefinition /></bpmn:endEvent>
    <bpmn:endEvent id="E2"><bpmn:terminateEventDefinition /></bpmn:endEvent>
  </bpmn:process>
</bpmn:definitions>`;

  test.each([
    ['parallelGateway', 0.5, 0.5],
    ['exclusiveGateway', 0.7, 0.6],
  ])('%s with probabilities %s and %s', async (gateway, p4, p5) => {
    const scenario = { elements: { f4: { probability: p4 }, f5: { probability: p5 } } };
    const { outline, warnings } = await bpmnToOutline(xml(gateway), { scenario });
    expect(() => normalizeOutline(outline)).not.toThrow();
    expect(JSON.stringify(outline)).not.toContain('probability');
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('were left out: f4, f5.'),
        'S: the outline has no bpmn:SignalEventDefinition; it is read as a plain event.',
        'E: the outline has no bpmn:MessageEventDefinition; it is read as a plain event.',
        'start event S has several outgoing flows; an outline start leads to one step, so these were left out: f2.',
        'the names of flows out of a start event are not part of the outline and were left out: f1 "go".',
      ]),
    );
    // A terminate end is an outline construct, not a loss.
    expect(warnings.some((w) => w.startsWith('E2:'))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * #631: each construct is built, validates, and reads back the same with no warning
 * ------------------------------------------------------------------ */

describe('the #631 constructs round-trip with no warning', () => {
  async function roundTrip(outline: unknown) {
    const built = await outlineToBpmn(outline);
    const parsed = parseScenario(built.scenario);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    const { ir, errors } = await validateBpmnXml(built.xml);
    expect(errors).toEqual([]);
    expect(validateScenario(parsed.data!, ir).filter((p) => p.severity === 'error')).toEqual([]);
    const reading = await bpmnToOutline(built.xml, { scenario: built.scenario as unknown as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    expect(reading.outline).toEqual(normalizeOutline(outline));
    expect(reading.outline).toEqual(built.outline);
    return { built, ir, elements: built.scenario['elements'] as Record<string, any> };
  }

  test.each(Object.entries(CONSTRUCTS))('%s', async (_label, outline) => {
    await roundTrip(outline);
  });

  test('task variants keep their BPMN element and simulate as tasks', async () => {
    const { built, ir } = await roundTrip(CONSTRUCTS['task variants']);
    for (const type of ['sendTask', 'receiveTask', 'manualTask', 'scriptTask', 'businessRuleTask']) expect(built.xml).toContain(`<bpmn:${type} `);
    expect(['send', 'receive', 'manual', 'script', 'rule'].map((id) => ir.nodes[id]!.type)).toEqual(['task', 'task', 'task', 'task', 'task']);
  });

  test('terminate ends: on a step and on a branch', async () => {
    const { built, ir } = await roundTrip(CONSTRUCTS['terminate ends']);
    expect(ir.nodes['EndEvent_fast']!.type).toBe('terminate');
    expect(ir.nodes['EndEvent_check']!.type).toBe('terminate');
    expect(ir.nodes['EndEvent_check_2']!.type).toBe('end');
    expect(built.outline.steps.find((s) => s.id === 'check')!.branches).toEqual([
      { end: 'terminate', label: 'Abort', probability: 0.5 },
      { end: true, label: 'Done', probability: 0.5 },
    ]);
  });

  test('starts: two streams of arrivals, a timer start, each start in its lane', async () => {
    const { built, elements } = await roundTrip(CONSTRUCTS['starts and a timer start']);
    expect(built.xml).toMatch(/<bpmn:startEvent id="nightly" name="Every night">\s*<bpmn:outgoing>[^<]+<\/bpmn:outgoing>\s*<bpmn:timerEventDefinition/);
    expect(elements['walkIn']).toEqual({ triggerCount: 20, interTriggerTimer: { type: 'constant', value: 60 } });
    expect(elements['nightly']).toEqual(elements['walkIn']);
    expect(elements['StartEvent']).toBeUndefined();
    const { lanes } = await geometry(built.xml);
    expect(lanes.get('Lane_1')).toContain('walkIn');
    expect(lanes.get('Lane_2')).toContain('nightly');
    expect(built.outline.starts).toEqual([
      { id: 'walkIn', name: 'Customer walks in', lane: 'Front' },
      { id: 'nightly', name: 'Every night', type: 'timer', lane: 'Back' },
    ]);
  });

  test('default flows of an xor and an or', async () => {
    const { built, ir } = await roundTrip(CONSTRUCTS['default flows']);
    expect(built.xml).toContain('<bpmn:exclusiveGateway id="kind" default="Flow_kind_review">');
    expect(built.xml).toContain('<bpmn:inclusiveGateway id="extras" default="Flow_extras_mail">');
    expect(ir.flows['Flow_kind_review']!.isDefault).toBe(true);
    expect(ir.flows['Flow_extras_mail']!.isDefault).toBe(true);
  });

  test('boundary timers: cancelActivity="false" only when they do not interrupt, their delay in the scenario', async () => {
    const { built, ir, elements } = await roundTrip(CONSTRUCTS['boundary timers']);
    expect(built.xml).toMatch(/<bpmn:boundaryEvent id="late" cancelActivity="false" attachedToRef="work">/);
    expect(built.xml).toMatch(/<bpmn:boundaryEvent id="cut" attachedToRef="work">/);
    expect(built.xml).toMatch(/<bpmn:boundaryEvent id="hang" attachedToRef="call">/);
    expect(built.xml).not.toContain('timeDuration');
    expect(ir.nodes['late']).toMatchObject({ type: 'timer', attachedTo: 'work', interrupting: false });
    expect(ir.nodes['cut']!.interrupting).not.toBe(false);
    expect(elements['late']).toEqual({ processingTime: { type: 'constant', value: 1200 } });
    expect(elements['cut']).toEqual({ processingTime: { type: 'constant', value: 2400 } });
    expect(ir.nodes['EndEvent_cut']!.type).toBe('terminate');
    // Each boundary event sits on its host's bottom border.
    const { shapes } = await geometry(built.xml);
    for (const [b, host] of [['late', 'work'], ['cut', 'work'], ['hang', 'call']] as const) {
      const box = shapes.get(b)!;
      const h = shapes.get(host)!;
      expect(box.y + box.height / 2, b).toBeCloseTo(h.y + h.height, 0);
    }
  });

  test('boundary events in a lane sit in the lane of their host, and so do their ends', async () => {
    const built = await outlineToBpmn({
      name: 'X',
      lanes: ['A', 'B'],
      steps: [
        { id: 'a', lane: 'B', duration: '1h', boundary: [{ id: 'sla', type: 'timer', duration: '30m', end: true }] },
        { id: 'b', lane: 'A', end: true },
      ],
    });
    const { lanes } = await geometry(built.xml);
    expect(lanes.get('Lane_2')).toEqual(expect.arrayContaining(['a', 'sla', 'EndEvent_sla']));
    await expectLaidOut(built.xml);
  });

  test('the event gateway: a message and a timer branch, their delays in the scenario', async () => {
    const { built, ir, elements } = await roundTrip(CONSTRUCTS['event gateway']);
    expect(built.xml).toContain('<bpmn:eventBasedGateway id="wait" name="Reply?">');
    expect(built.xml).toMatch(/<bpmn:intermediateCatchEvent id="answer" name="Answer">[\s\S]*?<bpmn:messageEventDefinition/);
    expect(ir.nodes['wait']!.type).toBe('eventGateway');
    expect(elements['answer']).toEqual({ processingTime: { type: 'exponential', mean: 1200 } });
    expect(elements['timeout']).toEqual({ processingTime: { type: 'constant', value: 1800 } });
  });

  test('the claim escalation example (examples/outline/claim-escalation.json) and the docs fixture', async () => {
    const repo = fileURLToPath(new URL('../../../../', import.meta.url));
    const example = JSON.parse(readFileSync(`${repo}examples/outline/claim-escalation.json`, 'utf8'));
    const { built } = await roundTrip(example);
    expect(built.notes).toEqual([]);
    expect(built.outline.steps.find((s) => s.id === 'assess')!.boundary).toEqual([
      { id: 'sla', type: 'timer', name: '48 h', label: 'No decision in 48 h', duration: { type: 'constant', value: 172800 }, interrupting: false, to: 'escalate' },
    ]);
    await expectLaidOut(built.xml);
  });

  test('a task with an interrupting boundary is an exclusive split for a parallel join', async () => {
    const built = await outlineToBpmn({
      name: 'X',
      steps: [
        { id: 'a', boundary: [{ id: 'cut', type: 'timer', duration: '1h', to: 'b' }, { id: 'soft', type: 'timer', duration: '2h', interrupting: false, to: 'c' }] },
        { id: 'j', type: 'and', end: true },
        { id: 'b', next: 'j' },
        { id: 'c', end: true },
      ],
    });
    expect(built.notes).toEqual([
      'parallel join "j" waits for branches of the exclusive gateway "a", which only ever takes one: cases would wait there forever. Use an xor (or or) join.',
    ]);
  });
});

describe('what the reader still leaves out of the new constructs, with a warning (#631)', () => {
  const doc = (body: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="https://example.org">
  <bpmn:process id="P" name="P" isExecutable="true">
    ${body}
  </bpmn:process>
</bpmn:definitions>`;

  test('timer expressions in the XML are said lost (durations live in the scenario)', async () => {
    const { outline, warnings } = await bpmnToOutline(
      doc(`<bpmn:startEvent id="s"><bpmn:timerEventDefinition><bpmn:timeCycle>R/P1D</bpmn:timeCycle></bpmn:timerEventDefinition></bpmn:startEvent>
    <bpmn:task id="a" /><bpmn:boundaryEvent id="b" attachedToRef="a"><bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>
    <bpmn:intermediateCatchEvent id="t"><bpmn:timerEventDefinition><bpmn:timeDate>2026-01-01</bpmn:timeDate></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="e" />
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="a" /><bpmn:sequenceFlow id="f2" sourceRef="a" targetRef="t" />
    <bpmn:sequenceFlow id="f3" sourceRef="t" targetRef="e" /><bpmn:sequenceFlow id="f4" sourceRef="b" targetRef="e" />`),
    );
    expect(warnings).toEqual([
      'timer expressions in the BPMN are not part of the outline (durations live in the scenario) and were left out: s, t, b.',
    ]);
    expect(outline.starts).toEqual([{ id: 's', type: 'timer' }]);
    expect(outline.steps[0]!.boundary).toEqual([{ id: 'b', type: 'timer', end: true }]);
  });

  test('an instantiating event gateway, a boundary on a sub-process, a lone message catch event', async () => {
    const { outline, warnings } = await bpmnToOutline(
      doc(`<bpmn:startEvent id="StartEvent" /><bpmn:eventBasedGateway id="g" instantiate="true" />
    <bpmn:intermediateCatchEvent id="m1"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:intermediateCatchEvent id="t1"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:subProcess id="sp" /><bpmn:boundaryEvent id="b" attachedToRef="sp"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
    <bpmn:intermediateCatchEvent id="m2"><bpmn:messageEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="e" />
    <bpmn:sequenceFlow id="f1" sourceRef="StartEvent" targetRef="sp" /><bpmn:sequenceFlow id="f2" sourceRef="sp" targetRef="g" />
    <bpmn:sequenceFlow id="f3" sourceRef="g" targetRef="m1" /><bpmn:sequenceFlow id="f4" sourceRef="g" targetRef="t1" />
    <bpmn:sequenceFlow id="f5" sourceRef="m1" targetRef="m2" /><bpmn:sequenceFlow id="f6" sourceRef="t1" targetRef="e" />
    <bpmn:sequenceFlow id="f7" sourceRef="m2" targetRef="e" /><bpmn:sequenceFlow id="f8" sourceRef="b" targetRef="e" />`),
    );
    expect(warnings).toEqual(
      expect.arrayContaining([
        'g (bpmn:EventBasedGateway) has no outline equivalent and was left out.',
        'b (bpmn:BoundaryEvent) has no outline equivalent and was left out.',
        'm1 (bpmn:IntermediateCatchEvent) has no outline equivalent and was left out.',
        'm2 (bpmn:IntermediateCatchEvent) has no outline equivalent and was left out.',
      ]),
    );
    expect(() => normalizeOutline(outline)).not.toThrow();
    expect(outline.steps.map((s) => s.id)).toEqual(['sp', 't1']);
  });
});

/* ------------------------------------------------------------------ *
 * #638: notes and data, built and read back
 * ------------------------------------------------------------------ */

describe('notes and data (#638)', () => {
  const PAPERWORK = {
    name: 'Paperwork',
    lanes: ['Desk', 'Back office'],
    steps: [
      { id: 'receive', name: 'Receive', lane: 'Desk', notes: ['Paper too', 'Check the ID'], data: [{ name: 'Claim', direction: 'out' }, { name: 'Policy', direction: 'in' }] },
      { id: 'ok', type: 'xor', name: 'Complete?', notes: ['Asked by phone'], branches: [{ to: 'file', label: 'Yes' }, { to: 'receive', label: 'No', probability: 0.1 }] },
      { id: 'file', type: 'subprocess', name: 'File it', lane: 'Back office', data: [{ name: 'Claim', direction: 'in' }, { name: 'Archive', direction: 'out' }] },
      { id: 'wait', type: 'timer', name: 'A day', duration: '1d', notes: ['Calendar days'], end: true },
    ],
  } as const;

  test('one data object per name, shared by the steps that name it; normal form lists reads first', async () => {
    const built = await outlineToBpmn(PAPERWORK);
    expect(built.warnings).toEqual([]);
    expect(built.xml.match(/<bpmn:dataObjectReference /g)).toHaveLength(3);
    expect(built.xml.match(/<bpmn:textAnnotation /g)).toHaveLength(4);
    expect(built.outline.steps[0]).toMatchObject({
      notes: ['Paper too', 'Check the ID'],
      data: [{ name: 'Policy', direction: 'in' }, { name: 'Claim', direction: 'out' }],
    });
    expect(normalizeOutline(PAPERWORK)).toEqual(built.outline);
    const reading = await bpmnToOutline(built.xml, { scenario: built.scenario as Record<string, unknown> });
    expect(reading.warnings).toEqual([]);
    expect(reading.outline).toEqual(built.outline);
    // Built again from what was read: the same model.
    expect((await outlineToBpmn(reading.outline)).xml).toBe(built.xml);
  });

  test('the model opens with no import warning; annotations sit inside the pool, beside their step', async () => {
    const built = await outlineToBpmn(PAPERWORK);
    await expectCleanImport(built.xml);
    const { rootElement } = await BpmnModdle().fromXML(built.xml);
    const shapes = new Map<string, any>(((rootElement as any).diagrams[0].plane.planeElement as any[]).map((di) => [di.bpmnElement.id, di.bounds]));
    const pool = shapes.get('Participant_1');
    for (const [id, b] of shapes) {
      if (!id.startsWith('TextAnnotation_')) continue;
      expect(b.y, id).toBeGreaterThanOrEqual(pool.y);
      expect(b.y + b.height, id).toBeLessThanOrEqual(pool.y + pool.height);
    }
  });

  test('reading a model from elsewhere: repeated notes once; empty ones, loose artifacts, a second object of a name and data on events said lost', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="x">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:startEvent id="s"><bpmn:dataOutputAssociation id="so"><bpmn:targetRef>form</bpmn:targetRef></bpmn:dataOutputAssociation></bpmn:startEvent>
    <bpmn:task id="a" name="A"><bpmn:dataOutputAssociation id="o1"><bpmn:targetRef>form</bpmn:targetRef></bpmn:dataOutputAssociation>
      <bpmn:dataOutputAssociation id="o2"><bpmn:targetRef>crm</bpmn:targetRef></bpmn:dataOutputAssociation>
      <bpmn:dataOutputAssociation id="o3"><bpmn:targetRef>form2</bpmn:targetRef></bpmn:dataOutputAssociation></bpmn:task>
    <bpmn:endEvent id="e"/>
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="a"/>
    <bpmn:sequenceFlow id="f2" sourceRef="a" targetRef="e"/>
    <bpmn:dataObject id="formData"/>
    <bpmn:dataObjectReference id="form" name="Form" dataObjectRef="formData"/>
    <bpmn:dataObjectReference id="loose" name="Loose" dataObjectRef="formData"/>
    <bpmn:dataObjectReference id="form2" name="Form" dataObjectRef="formData"/>
    <bpmn:dataStoreReference id="crm" name="CRM"/>
    <bpmn:textAnnotation id="n1"><bpmn:text>Twice</bpmn:text></bpmn:textAnnotation>
    <bpmn:textAnnotation id="n2"><bpmn:text>Twice</bpmn:text></bpmn:textAnnotation>
    <bpmn:textAnnotation id="n3"><bpmn:text> </bpmn:text></bpmn:textAnnotation>
    <bpmn:textAnnotation id="n4"><bpmn:text>On the start</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="a1" sourceRef="a" targetRef="n1"/>
    <bpmn:association id="a2" sourceRef="n2" targetRef="a"/>
    <bpmn:association id="a3" sourceRef="a" targetRef="n3"/>
    <bpmn:association id="a4" sourceRef="s" targetRef="n4"/>
  </bpmn:process>
</bpmn:definitions>`;
    const { outline, warnings } = await bpmnToOutline(xml);
    expect(outline.steps).toEqual([{ id: 'a', name: 'A', from: 's', end: true, notes: ['Twice'], data: [{ name: 'Form', direction: 'out' }] }]);
    expect(warnings).toEqual([
      expect.stringContaining('crm (bpmn:DataStoreReference) has no outline equivalent'),
      'text annotations that repeat a note of the same step were read once: a "Twice".',
      expect.stringContaining('loose (bpmn:DataObjectReference) has no outline equivalent'),
      expect.stringContaining('form2 (bpmn:DataObjectReference) has no outline equivalent'),
      expect.stringContaining('so (bpmn:DataOutputAssociation) has no outline equivalent'),
      '4 annotations, groups or associations are not part of the outline and were left out.',
    ]);
  });
});

test('the default arrivals are recognised whatever the key order of the scenario (patch_scenario rewrites it)', async () => {
  const built = await outlineToBpmn(CREDIT);
  const scenario = structuredClone(built.scenario) as any;
  scenario.elements.StartEvent = { interTriggerTimer: { value: 60, type: 'constant' }, triggerCount: 20 };
  expect((await bpmnToOutline(built.xml, { scenario })).warnings).toEqual([]);
});
