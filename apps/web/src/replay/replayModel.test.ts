/**
 * Acceptance of the replay model (#331): the counters it reports at the end of the replay are
 * the engine's own `elements[id].started/completed`. The log comes from a real `simulate` over
 * `packages/engine/test/fixtures/service-request` with the scenario as it ships (seed 42) and a single replication —
 * the only case where a per-replication replay and the aggregate can be compared at all.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate, type EventLogRow, type ProcessIR, type RunResult } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';
import { parseScenario, type ResolvedScenario } from '@lila/engine/schema';
import { buildReplay, stateAt, type Replay } from './replayModel';

const dir = fileURLToPath(new URL('../../../../packages/engine/test/fixtures/service-request/', import.meta.url));

let ir: ProcessIR;
let scenario: ResolvedScenario;
let result: RunResult;
let rows: EventLogRow[];
let replay: Replay;

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(`${dir}model.bpmn`, 'utf8'))).ir;
  const raw = JSON.parse(readFileSync(`${dir}as-is.scenario.json`, 'utf8')) as Record<string, unknown>;
  const parsed = parseScenario({ ...raw, run: { ...(raw.run as object), replications: 1 } });
  if (!parsed.success) throw new Error('the example scenario does not parse');
  scenario = parsed.data as ResolvedScenario;
  rows = [];
  result = simulate(ir, scenario, { onEvent: (row) => rows.push(row) });
  replay = buildReplay(rows, ir, scenario);
}, 60_000);

describe('buildReplay over packages/engine/test/fixtures/service-request', () => {
  it('counts every element the log carries plus the ones inferred from the graph', () => {
    // Thirteen tasks emit rows (no timer here); the start event, the two gateways and the three
    // end events emit nothing and are recovered from the inferred paths: nineteen in total, the
    // same nineteen `result.elements` has.
    expect(replay.elementIds).toHaveLength(19);
    expect([...replay.elementIds].sort()).toEqual(Object.keys(result.elements).sort());
    expect(replay.horizon).toBeGreaterThan(0);
  });

  it('counts the start and every end event exactly like the engine', () => {
    const final = stateAt(replay, replay.horizon);
    const ends = Object.keys(ir.nodes).filter((id) => ir.nodes[id]?.type === 'end');
    const starts = Object.keys(ir.nodes).filter((id) => ir.nodes[id]?.type === 'start');
    expect(ends.length).toBeGreaterThan(1);
    for (const id of [...starts, ...ends]) {
      expect([id, final.elements[id]?.started, final.elements[id]?.completed])
        .toEqual([id, result.elements[id]?.started, result.elements[id]?.completed]);
    }
    // Seeded count for the synthetic fixture; all counters also match the engine above.
    expect(final.elements['End_ServiceCompleted']?.completed).toBe(17);
  });

  it('ends with the engine counters for every element of the log', () => {
    const final = stateAt(replay, replay.horizon);
    for (const id of replay.elementIds) {
      const metrics = result.elements[id];
      expect([id, final.elements[id]?.started, final.elements[id]?.completed])
        .toEqual([id, metrics?.started, metrics?.completed]);
    }
  });

  it('starts empty: nothing is counted before the first token is enabled', () => {
    const zero = stateAt(replay, -1);
    for (const id of replay.elementIds) expect(zero.elements[id]).toEqual({ completed: 0, queue: 0, running: 0, started: 0 });
    expect(zero.tokens).toEqual([]);
  });

  it('never completes a token that was still in flight at the horizon', () => {
    const unfinished = replay.activities.filter((a) => !a.completed);
    expect(unfinished.length).toBeGreaterThan(0);
    const final = stateAt(replay, replay.horizon * 2);
    const started = replay.elementIds.reduce((sum, id) => sum + (final.elements[id]?.started ?? 0), 0);
    const completed = replay.elementIds.reduce((sum, id) => sum + (final.elements[id]?.completed ?? 0), 0);
    expect(started - completed).toBe(unfinished.length);
  });

  it('keeps every pool within its capacity', () => {
    expect(Object.keys(replay.pools).sort()).toEqual(['analyst', 'executive', 'operator']);
    for (let i = 0; i <= 200; i++) {
      const state = stateAt(replay, (replay.horizon * i) / 200);
      for (const [id, pool] of Object.entries(state.pools)) {
        expect([id, pool.busy <= pool.capacity]).toEqual([id, true]);
      }
    }
  });

  it('walks the gateway between the prerequisite check and the rejection branch', () => {
    // `Task_CheckScreening -> Gateway_Screening -> Task_DenyScreening`: two flows, no shortcut.
    const hop = replay.moves.find((move) => {
      const first = ir.flows[move.flows[0] as string];
      const last = ir.flows[move.flows[move.flows.length - 1] as string];
      return first?.from === 'Task_CheckScreening' && last?.to === 'Task_DenyScreening';
    });
    expect(hop?.flows).toHaveLength(2);
    expect(ir.flows[hop?.flows[0] as string]?.to).toBe('Gateway_Screening');
  });

  it('puts a token on a flow while the hop lasts and nowhere after it', () => {
    const move = replay.moves[0] as { from: number; to: number; flows: readonly string[] };
    expect(move.to).toBeGreaterThan(move.from);
    const mid = stateAt(replay, (move.from + move.to) / 2);
    expect(mid.tokens.some((token) => move.flows.includes(token.flowId))).toBe(true);
    for (const token of mid.tokens) expect(token.progress).toBeGreaterThanOrEqual(0);
    for (const token of mid.tokens) expect(token.progress).toBeLessThan(1);
  });

  it('reports the scenario start and the replication count', () => {
    expect(replay.replications).toBe(1);
    expect(replay.startMs).toBe(Date.parse('2026-09-07T08:00:00-06:00'));
    expect(replay.truncated).toBe(false);
  });
});

/**
 * #81, third slice: the replay has to survive the new path. An event-based gateway emits no log
 * row of its own, and only the branch that won the race appears in the log at all — the losing
 * branches are never enabled, so no counter and no hop may be invented for them.
 */
describe('buildReplay with an event-based gateway', () => {
  const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_Replay" isExecutable="true">
    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Pedir" sourceRef="Start_Proceso" targetRef="Task_Pedir" />
    <bpmn:task id="Task_Pedir" name="Pedir" />
    <bpmn:sequenceFlow id="Flow_Pedir_Espera" sourceRef="Task_Pedir" targetRef="Gateway_Espera" />
    <bpmn:eventBasedGateway id="Gateway_Espera" name="Espera" />
    <bpmn:sequenceFlow id="Flow_Espera_Respuesta" sourceRef="Gateway_Espera" targetRef="Event_Respuesta" />
    <bpmn:sequenceFlow id="Flow_Espera_Plazo" sourceRef="Gateway_Espera" targetRef="Event_Plazo" />
    <bpmn:intermediateCatchEvent id="Event_Respuesta" name="Llega respuesta">
      <bpmn:messageEventDefinition id="Trigger_Respuesta" />
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_Respuesta_Fin" sourceRef="Event_Respuesta" targetRef="End_Respondido" />
    <bpmn:endEvent id="End_Respondido" name="Respondido" />
    <bpmn:intermediateCatchEvent id="Event_Plazo" name="Vence el plazo">
      <bpmn:timerEventDefinition id="Trigger_Plazo" />
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_Plazo_Fin" sourceRef="Event_Plazo" targetRef="End_Vencido" />
    <bpmn:endEvent id="End_Vencido" name="Vencido" />
  </bpmn:process>
</bpmn:definitions>`;

  const SCENARIO = {
    version: 1,
    name: 'event gateway',
    run: { start: '2026-09-07T08:00:00-06:00', seed: 42, replications: 1, duration: 3600 },
    elements: {
      Start_Proceso: { interTriggerTimer: { type: 'constant', value: 600 } },
      Task_Pedir: { processingTime: { type: 'constant', value: 60 } },
      Event_Respuesta: { processingTime: { type: 'constant', value: 90 } },
      Event_Plazo: { processingTime: { type: 'constant', value: 240 } },
    },
  };

  it('counts the gateway and the winning branch exactly like the engine', async () => {
    const parsedIr = (await parseBpmn(XML)).ir;
    const parsed = parseScenario(SCENARIO);
    if (!parsed.success) throw new Error('the inline scenario does not parse');
    const eventScenario = parsed.data as ResolvedScenario;
    const eventRows: EventLogRow[] = [];
    const eventResult = simulate(parsedIr, eventScenario, { onEvent: (row) => eventRows.push(row) });
    const eventReplay = buildReplay(eventRows, parsedIr, eventScenario);
    const final = stateAt(eventReplay, eventReplay.horizon);

    for (const id of eventReplay.elementIds) {
      expect([id, final.elements[id]?.started, final.elements[id]?.completed])
        .toEqual([id, eventResult.elements[id]?.started, eventResult.elements[id]?.completed]);
    }
    // The winner is in the log with its wait; the discarded branch is nowhere, neither in the
    // counters nor as a hop.
    expect(final.elements['Event_Respuesta']?.completed).toBeGreaterThan(0);
    expect(eventReplay.elementIds).not.toContain('Event_Plazo');
    expect(eventReplay.moves.some((move) => move.flows.includes('Flow_Espera_Plazo'))).toBe(false);
    // And the hop from the task to the winner really walks through the gateway.
    const hop = eventReplay.moves.find((move) => move.flows.includes('Flow_Espera_Respuesta'));
    expect(hop?.flows[0]).toBe('Flow_Pedir_Espera');
    expect(eventReplay.passages.some((passage) => passage.elementId === 'Gateway_Espera')).toBe(true);
  });
});
