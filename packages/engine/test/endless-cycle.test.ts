/**
 * #727 (R-ARR-11): without `run.duration`, a region a case can enter and never leave because every
 * way out has probability 0 is rejected before the first event, by the lint and by `core/`.
 * Synthetic models; the fixtures in `fixtures/endless-cycle/` are the QA models of #727, with
 * fewer arrivals where the original only made the run slower.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { parseBpmn } from '../src/bpmn/parse.js';
import { findEndlessCycle } from '../src/core/endless.js';
import { simulate } from '../src/core/run.js';
import { runReplication, type SimScenario } from '../src/core/sim.js';
import { validateScenario, type Scenario } from '../src/scenario.js';

const constant = (value: number) => ({ type: 'constant' as const, value });
const fixture = (name: string): { xml: string; scenario: SimScenario } => {
  const url = (ext: string) => new URL(`./fixtures/endless-cycle/${name}.${ext}`, import.meta.url);
  return { xml: readFileSync(url('bpmn'), 'utf8'), scenario: JSON.parse(readFileSync(url('scenario.json'), 'utf8')) };
};
const lint = async (xml: string, scenario: SimScenario, locale: 'en' | 'es' = 'en') => {
  const { ir } = await parseBpmn(xml);
  return validateScenario(scenario as unknown as Scenario, ir, { locale }).filter((p) => p.code === 'E-CICLO-SIN-SALIDA');
};

/** Task → XOR that goes back with `repeat` and leaves with `exit`. */
const LOOP = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test:727"><bpmn:process id="P">
<bpmn:startEvent id="Start"/><bpmn:sequenceFlow id="f0" sourceRef="Start" targetRef="Work"/>
<bpmn:task id="Work" name="Review"/><bpmn:sequenceFlow id="f1" sourceRef="Work" targetRef="Gateway"/>
<bpmn:exclusiveGateway id="Gateway" name="Approved?"/>
<bpmn:sequenceFlow id="Repeat" sourceRef="Gateway" targetRef="Work"/>
<bpmn:sequenceFlow id="Exit" sourceRef="Gateway" targetRef="End"/>
<bpmn:endEvent id="End"/></bpmn:process></bpmn:definitions>`;
const loop = (triggerCount: number, repeat: number | undefined, exit: number | undefined, duration?: number): SimScenario => ({
  run: { seed: 7, ...(duration === undefined ? {} : { duration }) },
  elements: {
    Start: { triggerCount, interTriggerTimer: constant(1) },
    Work: { processingTime: constant(60) },
    ...(repeat === undefined ? {} : { Repeat: { probability: repeat } }),
    ...(exit === undefined ? {} : { Exit: { probability: exit } }),
  },
});
const ENDLESS = /^E-CICLO-SIN-SALIDA: Review \(Work\): a case that gets here can never end, because every way out of Approved\? \(Gateway\) has probability 0/;

describe('flagged before the first event', () => {
  test.each([1, 1_000, 10_000])('the #727 loop with exit probability 0 and triggerCount %i', async (count) => {
    const { ir } = await parseBpmn(LOOP);
    const scenario = loop(count, 1, 0);
    let steps = 0;
    expect(() => simulate(ir, scenario, { onProgress: () => { steps++; } })).toThrow(ENDLESS);
    expect(() => runReplication(ir, scenario, 0, { onStep: () => { steps++; } })).toThrow(ENDLESS);
    expect(steps).toBe(0);
    const problems = await lint(LOOP, scenario);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ path: 'elements.Gateway', severity: 'error' });
    expect(`E-CICLO-SIN-SALIDA: ${problems[0]!.message}`).toMatch(ENDLESS);
  });

  test('an exit left undeclared gets the remainder, 0, and is flagged too (R-XOR-2)', async () => {
    const { ir } = await parseBpmn(LOOP);
    expect(() => simulate(ir, loop(5, 1, undefined))).toThrow(ENDLESS);
  });

  test('a zero-time loop without run.duration is caught statically now', async () => {
    const { ir } = await parseBpmn(LOOP);
    const scenario = loop(1, 1, 0);
    scenario.elements!.Work = { processingTime: constant(0) };
    expect(() => simulate(ir, scenario)).toThrow(ENDLESS);
  });

  test('localized, and the bare id when the element has no name', async () => {
    const { ir } = await parseBpmn(LOOP.replace(' name="Review"', '').replace(' name="Approved?"', ''));
    expect(() => simulate(ir, loop(1, 1, 0), { locale: 'es' })).toThrow(
      /^E-CICLO-SIN-SALIDA: Work: un caso que llega aquí nunca puede terminar, porque todas las salidas de Gateway tienen probabilidad 0/,
    );
  });

  test.each([
    ['tp_twogw', /^E-CICLO-SIN-SALIDA: Review \(W\): .* First check \(G1\) /],
    ['tp_subproc', /^E-CICLO-SIN-SALIDA: Inner \(W\): .* of G has probability 0/],
    ['tp_half', /^E-CICLO-SIN-SALIDA: Rework \(W\): .* of G has probability 0/],
  ])('%s: two gateways, a loop through a sub-process, half of the cases stuck', async (name, message) => {
    const { xml, scenario } = fixture(name);
    const { ir } = await parseBpmn(xml);
    expect(() => simulate(ir, scenario)).toThrow(message);
    expect(await lint(xml, scenario)).toHaveLength(1);
  });
});

describe('not flagged: every case can still end', () => {
  test('exit probability 0.001 runs to completion', async () => {
    const { ir } = await parseBpmn(LOOP);
    expect(findEndlessCycle(ir, loop(20, 0.999, 0.001))).toBeUndefined();
    expect(simulate(ir, loop(20, 0.999, 0.001)).process).toMatchObject({ completed: 20, inFlight: 0 });
  });

  test('with run.duration the rule does not apply: the case is in flight at the cut', async () => {
    const { ir } = await parseBpmn(LOOP);
    expect(await lint(LOOP, loop(1, 1, 0, 3_600))).toEqual([]);
    expect(simulate(ir, loop(1, 1, 0, 3_600)).process).toMatchObject({ completed: 0, inFlight: 1 });
  });

  test.each([
    ['mi_seq', 30],
    ['join_rework', 200],
    ['crowd_p0.001', 300],
  ])('the QA model %s still completes', async (name, cases) => {
    const { xml, scenario } = fixture(name);
    const { ir } = await parseBpmn(xml);
    expect(await lint(xml, scenario)).toEqual([]);
    expect(simulate(ir, scenario).process.started).toBe(cases);
  });

  test('a loop inside a sub-process that an interrupting boundary timer can cancel', async () => {
    const xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test:727"><bpmn:process id="P">
<bpmn:startEvent id="Start"/><bpmn:sequenceFlow id="f0" sourceRef="Start" targetRef="Sub"/>
<bpmn:subProcess id="Sub"><bpmn:startEvent id="SubStart"/><bpmn:sequenceFlow id="s0" sourceRef="SubStart" targetRef="Work"/>
<bpmn:task id="Work" name="Review"/><bpmn:sequenceFlow id="s1" sourceRef="Work" targetRef="Gateway"/>
<bpmn:exclusiveGateway id="Gateway"/><bpmn:sequenceFlow id="Repeat" sourceRef="Gateway" targetRef="Work"/>
<bpmn:sequenceFlow id="Exit" sourceRef="Gateway" targetRef="SubEnd"/><bpmn:endEvent id="SubEnd"/></bpmn:subProcess>
<bpmn:boundaryEvent id="Timeout" attachedToRef="Sub"><bpmn:timerEventDefinition/></bpmn:boundaryEvent>
<bpmn:sequenceFlow id="f1" sourceRef="Sub" targetRef="End"/><bpmn:sequenceFlow id="f2" sourceRef="Timeout" targetRef="End"/>
<bpmn:endEvent id="End"/></bpmn:process></bpmn:definitions>`;
    const { ir } = await parseBpmn(xml);
    const scenario = loop(10, 1, 0);
    scenario.elements!.Timeout = { processingTime: constant(600) };
    expect(findEndlessCycle(ir, scenario)).toBeUndefined();
    expect(simulate(ir, scenario).process).toMatchObject({ completed: 10, inFlight: 0 });
  });

  test('a terminate on a parallel branch can end a case whose other token cycles', async () => {
    const xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test:727"><bpmn:process id="P">
<bpmn:startEvent id="Start"/><bpmn:sequenceFlow id="f0" sourceRef="Start" targetRef="Fork"/><bpmn:parallelGateway id="Fork"/>
<bpmn:sequenceFlow id="a" sourceRef="Fork" targetRef="Work"/><bpmn:sequenceFlow id="b" sourceRef="Fork" targetRef="Wait"/>
<bpmn:task id="Work"/><bpmn:sequenceFlow id="f1" sourceRef="Work" targetRef="Gateway"/><bpmn:exclusiveGateway id="Gateway"/>
<bpmn:sequenceFlow id="Repeat" sourceRef="Gateway" targetRef="Work"/><bpmn:sequenceFlow id="Exit" sourceRef="Gateway" targetRef="End"/>
<bpmn:task id="Wait"/><bpmn:sequenceFlow id="f2" sourceRef="Wait" targetRef="Kill"/>
<bpmn:endEvent id="Kill"><bpmn:terminateEventDefinition/></bpmn:endEvent><bpmn:endEvent id="End"/></bpmn:process></bpmn:definitions>`;
    const { ir } = await parseBpmn(xml);
    const scenario = loop(10, 1, 0);
    scenario.elements!.Wait = { processingTime: constant(600) };
    expect(findEndlessCycle(ir, scenario)).toBeUndefined();
    expect(simulate(ir, scenario).process).toMatchObject({ completed: 10, inFlight: 0 });
  });
});
