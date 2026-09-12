/**
 * Acceptance of the replay model (#331): the counters it reports at the end of the replay are
 * the engine's own `elements[id].started/completed`. The log comes from a real `simulate` over
 * `examples/tarjeta-credito` with the scenario as it ships (seed 42) and a single replication —
 * the only case where a per-replication replay and the aggregate can be compared at all.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { simulate, type EventLogRow, type ProcessIR, type RunResult } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';
import { parseScenario, type ResolvedScenario } from '@lila/engine/schema';
import { buildReplay, stateAt, type Replay } from './replayModel';

const dir = fileURLToPath(new URL('../../../../examples/tarjeta-credito/', import.meta.url));

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

describe('buildReplay over examples/tarjeta-credito', () => {
  it('counts every element the log carries', () => {
    // Only tasks and timers emit rows; this example has thirteen tasks and no timer.
    expect(replay.elementIds).toHaveLength(13);
    expect(replay.horizon).toBeGreaterThan(0);
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

  it('walks the gateway between the bureau check and the rejection branch', () => {
    // `Task_CheckBureau -> Gateway_Bureau -> Task_DenyBureau`: two flows, no shortcut.
    const hop = replay.moves.find((move) => {
      const first = ir.flows[move.flows[0] as string];
      const last = ir.flows[move.flows[move.flows.length - 1] as string];
      return first?.from === 'Task_CheckBureau' && last?.to === 'Task_DenyBureau';
    });
    expect(hop?.flows).toHaveLength(2);
    expect(ir.flows[hop?.flows[0] as string]?.to).toBe('Gateway_Bureau');
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
