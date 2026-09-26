/** Synthetic regression models for #363. No private inputs or golden updates. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { simulate, type EventLogRow } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';
import { parseScenario, type ResolvedScenario } from '@lila-modeler/engine/schema';
import { buildReplay, stateAt } from './replayModel';
import { prepareSimulation } from '../simulationGate';

const seconds = (value: number) => ({ type: 'constant', value });
const boundaryXml = readFileSync(new URL('../../test/fixtures/replay/concurrent-boundary.bpmn', import.meta.url), 'utf8');
const boundaryScenario = JSON.parse(readFileSync(new URL('../../test/fixtures/replay/concurrent-boundary.scenario.json', import.meta.url), 'utf8'));

function model(nodes: Record<string, string>, edges: [string, string][]): string {
  return `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:replay-test">
    <bpmn:process id="P" isExecutable="true">
      ${Object.entries(nodes).map(([id, type]) => `<bpmn:${type} id="${id}" />`).join('\n')}
      ${edges.map(([from, to], i) => `<bpmn:sequenceFlow id="F${i}" sourceRef="${from}" targetRef="${to}" />`).join('\n')}
    </bpmn:process>
  </bpmn:definitions>`;
}
const forkNodes = { Start: 'startEvent', Fork: 'parallelGateway', A: 'task', B: 'task', EA: 'endEvent', EB: 'endEvent' };
const forkEdges: [string, string][] = [['Start', 'Fork'], ['Fork', 'A'], ['Fork', 'B'], ['A', 'EA'], ['B', 'EB']];
const forkXml = model(forkNodes, forkEdges);
const forkScenario = (a = 20, b = 5) => ({
  version: 1, name: 'Synthetic fork', run: { start: '2026-09-19T00:00:00Z', seed: 42, replications: 1 },
  elements: { Start: { triggerCount: 1 }, A: { processingTime: seconds(a) }, B: { processingTime: seconds(b) } },
});

async function run(xml = boundaryXml, input: unknown = boundaryScenario) {
  const ir = (await parseBpmn(xml)).ir;
  const parsed = parseScenario(input);
  if (!parsed.success) throw new Error(JSON.stringify(parsed));
  const scenario = parsed.data as ResolvedScenario;
  const rows: EventLogRow[] = [];
  const result = simulate(ir, scenario, { onEvent: (row) => rows.push(row) });
  const replay = buildReplay(rows, ir, scenario);
  return { ir, scenario, rows, result, replay, final: stateAt(replay, replay.horizon) };
}

function count(data: Awaited<ReturnType<typeof run>>, ids: string[]) {
  for (const id of ids) {
    expect({ id, started: data.final.elements[id]?.started ?? 0, completed: data.final.elements[id]?.completed ?? 0 })
      .toEqual({ id, started: data.result.elements[id]?.started, completed: data.result.elements[id]?.completed });
  }
}

describe('concurrent replay from real engine logs', () => {
  it.each([[20, 5], [5, 20], [10, 10]])('counts both fork ends (%s, %s seconds)', async (a, b) => {
    const data = await run(forkXml, forkScenario(a, b));
    count(data, Object.keys(forkNodes));
    expect(data.final.elements.EA?.completed).toBe(1);
    expect(data.final.elements.EB?.completed).toBe(1);
    expect(data.replay.moves.filter((move) => move.flows.includes('F0'))).toHaveLength(1);
    // Outcomes count one case, even though two tokens reach end events.
    expect(Object.values(data.result.process.byEndEvent).reduce((n, end) => n + end.completed, 0)).toBe(1);
  });

  it.each([5, 150])('counts the non-interrupting boundary and both ends (branch %s)', async (duration) => {
    const input = structuredClone(boundaryScenario);
    input.elements.Reminder.processingTime = seconds(duration);
    const data = await run(boundaryXml, input);
    count(data, ['Start', 'Host', 'Boundary', 'Reminder', 'HostEnd', 'ReminderEnd']);
    expect(data.final.elements.Boundary?.completed).toBe(1);
    expect(data.result.process.byEndEvent[duration === 5 ? 'HostEnd' : 'ReminderEnd']?.completed).toBe(1);
    expect(data.result.process.byEndEvent[duration === 5 ? 'ReminderEnd' : 'HostEnd']?.completed).toBe(0);
    expect(stateAt(data.replay, 99).elements.Boundary?.completed).toBe(0);
    expect(stateAt(data.replay, 100).elements.Boundary?.completed).toBe(1);
    const branchMove = data.replay.moves.find((move) => move.flows.includes('BoundaryReminder'));
    expect(branchMove?.from).toBe(100); // Not the host's completion at 200.
  });

  it('counts an interrupting boundary without completing the host or its normal end', async () => {
    const data = await run(boundaryXml.replace('cancelActivity="false"', 'cancelActivity="true"'));
    count(data, ['Host', 'Boundary', 'Reminder', 'HostEnd', 'ReminderEnd']);
    expect(data.final.elements.Host?.completed).toBe(0);
    expect(data.final.elements.Boundary?.completed).toBe(1);
    expect(data.final.elements.HostEnd).toBeUndefined();
  });

  it('recognizes a unique interrupting boundary going straight to an end', async () => {
    const xml = boundaryXml.replace('cancelActivity="false"', 'cancelActivity="true"')
      .replace('sourceRef="Boundary" targetRef="Reminder"', 'sourceRef="Boundary" targetRef="ReminderEnd"');
    const data = await run(xml);
    count(data, ['Host', 'Boundary', 'HostEnd', 'ReminderEnd']);
    expect(data.final.elements.ReminderEnd?.completed).toBe(1);
  });

  it('counts queued interruptions and releases only resources actually held', async () => {
    const input = structuredClone(boundaryScenario);
    input.elements.Start = { triggerCount: 2, interTriggerTimer: seconds(10) };
    input.resources = { worker: { capacity: 1 } };
    input.elements.Host.resources = [{ ref: 'worker' }];
    const data = await run(boundaryXml.replace('cancelActivity="false"', 'cancelActivity="true"'), input);
    expect(data.rows.filter((r) => r.elementId === 'Host').every((r) => r.status === 'interrupted')).toBe(true);
    count(data, ['Host', 'Boundary', 'ReminderEnd']);
    expect(stateAt(data.replay, 50).elements.Host?.queue).toBe(1);
    expect(data.final.pools.worker?.busy).toBe(0);
  });

  it.each([false, true])('does not invent an unfired boundary (interrupting %s)', async (interrupting) => {
    const input = structuredClone(boundaryScenario);
    input.elements.Host.processingTime = seconds(50);
    const data = await run(boundaryXml.replace('cancelActivity="false"', `cancelActivity="${interrupting}"`), input);
    count(data, ['Host', 'Boundary', 'HostEnd', 'ReminderEnd']);
    expect(data.replay.elementIds).not.toContain('Boundary');
  });

  it('counts a tie at the non-interrupting deadline once', async () => {
    const input = structuredClone(boundaryScenario);
    input.elements.Host.processingTime = seconds(100);
    const data = await run(boundaryXml, input);
    count(data, ['Host', 'Boundary', 'HostEnd', 'ReminderEnd']);
  });

  it('groups multiple allocation rows before reconstructing tokens', async () => {
    const input = { ...forkScenario(), resources: { first: { capacity: 2 }, second: { capacity: 1 } } };
    Object.assign(input.elements.A, { resources: [{ ref: 'first', quantity: 2 }, { ref: 'second' }] });
    const data = await run(forkXml, input);
    expect(data.rows.filter((r) => r.elementId === 'A')).toHaveLength(2);
    count(data, Object.keys(forkNodes));
    expect(stateAt(data.replay, 1).pools).toEqual({ first: { busy: 2, capacity: 2 }, second: { busy: 1, capacity: 1 } });
    const reordered = buildReplay([...data.rows].reverse(), data.ir, data.scenario);
    expect(stateAt(reordered, reordered.horizon).elements).toEqual(data.final.elements);
  });

  it('synchronizes a join, counting both arrivals and only one release', async () => {
    const xml = model({ ...forkNodes, Join: 'parallelGateway', C: 'task' }, [
      ...forkEdges.slice(0, 3), ['A', 'Join'], ['B', 'Join'], ['Join', 'C'], ['C', 'EA'],
    ]);
    const input = forkScenario();
    Object.assign(input.elements, { C: { processingTime: seconds(3) } });
    const data = await run(xml, input);
    count(data, ['Start', 'Fork', 'A', 'B', 'Join', 'C', 'EA']);
    expect(stateAt(data.replay, 5).elements.Join).toMatchObject({ started: 1, completed: 0 });
    expect(data.final.elements.Join).toMatchObject({ started: 2, completed: 1 });
    expect(data.final.elements.EA?.completed).toBe(1);
  });

  it('preserves independent frames when seeking backwards', async () => {
    const data = await run();
    const before = stateAt(data.replay, 50);
    stateAt(data.replay, data.replay.horizon);
    expect(stateAt(data.replay, 50)).toEqual(before);
    expect(stateAt(data.replay, -1).tokens).toEqual([]);
    expect(Object.values(stateAt(data.replay, -1).elements).every((s) => s.started === 0)).toBe(true);
  });

  it('filters other replications before grouping identical instance ids', async () => {
    const data = await run(forkXml, forkScenario());
    const mixed = [...data.rows, ...data.rows.map((r) => ({ ...r, replication: 1 }))];
    const replay = buildReplay(mixed, data.ir, data.scenario);
    expect(stateAt(replay, replay.horizon).elements).toEqual(data.final.elements);
  });

  it('does not complete the unfinished fork branch at the horizon', async () => {
    const input = forkScenario();
    Object.assign(input.run, { duration: 10 });
    const data = await run(forkXml, input);
    count(data, ['A', 'B', 'EA', 'EB']);
    expect(data.final.elements.EA).toBeUndefined();
    expect(data.final.elements.EB?.completed).toBe(1);
  });

  it('does not walk through missing log activities to invent a truncated end', async () => {
    const xml = model({ Start: 'startEvent', A: 'task', B: 'task', End: 'endEvent' }, [
      ['Start', 'A'], ['A', 'B'], ['B', 'End'],
    ]);
    const data = await run(xml, forkScenario());
    const replay = buildReplay(data.rows.slice(0, 1), data.ir, data.scenario, { truncated: true });
    expect(replay.truncated).toBe(true);
    expect(stateAt(replay, Infinity).elements.End).toBeUndefined();
    expect(replay.moves.flatMap((move) => move.flows)).not.toContain('F2');
  });

  it('keeps only the observed completed fork branch in a truncated prefix', async () => {
    const data = await run(forkXml, forkScenario());
    const replay = buildReplay(data.rows.slice(0, 1), data.ir, data.scenario, { truncated: true });
    expect(stateAt(replay, Infinity).elements.EB?.completed).toBe(1);
    expect(stateAt(replay, Infinity).elements.EA).toBeUndefined();
  });

  it('does not choose an arbitrary end behind an unobserved XOR decision', async () => {
    const xml = model({ Start: 'startEvent', A: 'task', Choice: 'exclusiveGateway', EA: 'endEvent', EB: 'endEvent' }, [
      ['Start', 'A'], ['A', 'Choice'], ['Choice', 'EA'], ['Choice', 'EB'],
    ]);
    const data = await run(xml, forkScenario());
    expect(data.final.elements.EA).toBeUndefined();
    expect(data.final.elements.EB).toBeUndefined();
    expect(data.final.elements.Choice?.completed).toBe(1);
  });

  it('does not infer a non-interrupting firing with no observable branch activity', async () => {
    const xml = boundaryXml.replace('sourceRef="Boundary" targetRef="Reminder"', 'sourceRef="Boundary" targetRef="ReminderEnd"');
    const data = await run(xml);
    expect(data.result.elements.Boundary?.completed).toBe(1);
    expect(data.final.elements.Boundary).toBeUndefined();
    expect(data.final.elements.ReminderEnd).toBeUndefined();
    expect(data.final.elements.HostEnd?.completed).toBe(1);
  });
});

describe('occurrence identity and conservative inference', () => {
  it('counts two simultaneous occurrences of the same activity separately', async () => {
    const xml = model({ Start: 'startEvent', Fork: 'parallelGateway', A: 'task', End: 'endEvent' }, [
      ['Start', 'Fork'], ['Fork', 'A'], ['Fork', 'A'], ['A', 'End'],
    ]);
    const data = await run(xml, forkScenario());
    count(data, ['Start', 'Fork', 'A', 'End']);
    expect(data.final.elements.End?.completed).toBe(2);
    const rows = data.rows.map((row, i) => ({ ...row, activityInstanceId: `opaque-${100 - i}` })).reverse();
    const replay = buildReplay(rows, data.ir, data.scenario);
    expect(stateAt(replay, replay.horizon).elements).toEqual(data.final.elements);
  });

  it('keeps positive-duration loop occurrences without counting a start per iteration', async () => {
    const xml = model({ Start: 'startEvent', A: 'task', Choice: 'exclusiveGateway', B: 'task', End: 'endEvent' }, [
      ['Start', 'A'], ['A', 'Choice'], ['Choice', 'A'], ['Choice', 'B'], ['B', 'End'],
    ]);
    const input = forkScenario();
    Object.assign(input.elements, { F2: { probability: 0.9 }, F3: { probability: 0.1 } });
    const data = await run(xml, input);
    expect(data.rows.filter((row) => row.elementId === 'A').length).toBeGreaterThan(1);
    count(data, ['Start', 'A', 'Choice', 'B', 'End']);
    const replay = buildReplay([...data.rows].reverse(), data.ir, data.scenario);
    expect(stateAt(replay, replay.horizon).elements).toEqual(data.final.elements);
  });

  it('does not guess which interrupting boundary fired when their branches coincide', async () => {
    const xml = boundaryXml.replace('cancelActivity="false"', 'cancelActivity="true"').replace('</bpmn:process>', `
      <bpmn:boundaryEvent id="OtherBoundary" attachedToRef="Host">
        <bpmn:timerEventDefinition id="OtherDeadline" />
      </bpmn:boundaryEvent>
      <bpmn:sequenceFlow id="OtherFlow" sourceRef="OtherBoundary" targetRef="Reminder" />
      </bpmn:process>`);
    const input = structuredClone(boundaryScenario);
    input.elements.OtherBoundary = { processingTime: seconds(50) };
    const data = await run(xml, input);
    expect(data.result.elements.OtherBoundary?.completed).toBe(1);
    expect(data.final.elements.OtherBoundary).toBeUndefined();
    expect(data.final.elements.Boundary).toBeUndefined();
    expect(data.final.elements.ReminderEnd?.completed).toBe(1);
  });

  it('does not complete a synthetic terminated lifecycle or infer a boundary from it', async () => {
    const data = await run();
    const row = data.rows.find((r) => r.elementId === 'Host')!;
    const replay = buildReplay([{ ...row, status: 'terminated', endedAt: null, observedUntil: 50 }], data.ir, data.scenario);
    const final = stateAt(replay, Infinity);
    expect(final.elements.Host?.completed).toBe(0);
    expect(final.elements.HostEnd).toBeUndefined();
    expect(final.elements.Boundary).toBeUndefined();
  });

  it('does not pick the first of two silent routes to the same observed activity', async () => {
    const xml = model({ Start: 'startEvent', A: 'task', Choice: 'exclusiveGateway', X: 'exclusiveGateway', Y: 'exclusiveGateway', B: 'task', End: 'endEvent' }, [
      ['Start', 'A'], ['A', 'Choice'], ['Choice', 'X'], ['Choice', 'Y'], ['X', 'B'], ['Y', 'B'], ['B', 'End'],
    ]);
    const data = await run(xml, forkScenario());
    expect(data.final.elements.X).toBeUndefined();
    expect(data.final.elements.Y).toBeUndefined();
    expect(data.final.elements.End?.completed).toBe(1);
  });
});

it('does not reuse one synthetic witness for two simultaneous exclusive choices', async () => {
  const data = await run(forkXml, forkScenario(20, 20));
  const ir = (await parseBpmn(model({
    Start: 'startEvent', Fork: 'parallelGateway', A: 'task', Choice: 'exclusiveGateway',
    Route: 'exclusiveGateway', B: 'task', End: 'endEvent', OtherEnd: 'endEvent',
  }, [
    ['Start', 'Fork'], ['Fork', 'A'], ['Fork', 'A'], ['A', 'Choice'],
    ['Choice', 'Route'], ['Route', 'B'], ['B', 'End'], ['Choice', 'OtherEnd'],
  ]))).ir;
  const template = data.rows[0]!;
  const rows: EventLogRow[] = [
    { ...template, elementId: 'A', activityInstanceId: 'left' },
    { ...template, elementId: 'A', activityInstanceId: 'right' },
    { ...template, elementId: 'B', activityInstanceId: 'unknown-parent', enabledAt: 20,
      startedAt: 20, endedAt: 25, observedUntil: 25 },
  ];
  const replay = buildReplay(rows, ir, data.scenario);
  const final = stateAt(replay, replay.horizon);
  expect(final.elements.Choice?.completed).toBe(2);
  expect(final.elements.Route).toBeUndefined();
  expect(final.elements.End?.completed).toBe(1);
  expect(final.elements.OtherEnd).toBeUndefined();
});

it('accepts the visual fixture through the browser simulation gate', async () => {
  const prepared = await prepareSimulation(boundaryXml, 'concurrent-boundary.scenario.json',
    { 'concurrent-boundary.scenario.json': boundaryScenario }, 'concurrent-boundary.bpmn', { locale: 'en' });
  expect(prepared.ir.nodes.Boundary?.interrupting).toBe(false);
});
