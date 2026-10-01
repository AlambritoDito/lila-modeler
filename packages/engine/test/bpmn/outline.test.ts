/**
 * Outlines (#97): `outlineToBpmn` builds a laid-out, valid BPMN from a step list and
 * `bpmnToOutline` reads it back. The #97 example (two lanes and a XOR) is the acceptance case.
 */
import { BpmnModdle } from 'bpmn-moddle';
import { describe, expect, test } from 'vitest';

import {
  bpmnToOutline,
  normalizeOutline,
  OutlineError,
  outlineToBpmn,
  parseDuration,
} from '../../src/bpmn/outline.js';
import { validateBpmnXml } from '../../src/bpmn/validate-report.js';
import { parseScenario, validateScenario } from '../../src/scenario.js';
import { CREDIT, ORDER } from '../fixtures/outlines.js';

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
  const nodes = [...shapes].filter(([id]) => !['bpmn:Participant', 'bpmn:Lane'].includes(types.get(id)!));
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
    expect(outline).toEqual({ name: 'Foreign', steps: [{ id: 't', name: 'T', end: true }] });
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
    expect(error.issues.map((i) => i.path).sort()).toEqual(['(root)', 'steps.0.type']);
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
        expect.stringContaining('steps[1].id step id "a" is used more than once'),
        expect.stringContaining('step id "1bad" is not a valid BPMN id'),
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
    expect(error.issues.every((i) => i.path.startsWith('bpmn.'))).toBe(true);
  });

  test('messages follow the locale', async () => {
    const error = await issues({ name: 'X', steps: [{ id: 'a', next: 'zz' }] }, 'es');
    expect(error.message).toContain('el esquema del proceso no es válido');
    expect(error.message).toContain('"zz" no es el id de ningún paso');
  });
});
