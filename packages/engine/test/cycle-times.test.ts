/**
 * `opts.onCycleTimes` (#460): the per-case sample behind `process.cycleTime`, handed out per
 * replication. Checked where rebuilding it from the event log goes wrong: cases stuck at a blocked
 * AND join leave no `inFlight` row, and cases that go start → end leave no row at all (QA of #512).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { parseBpmn } from '../src/bpmn/index.js';
import { simulate } from '../src/index.js';
import type { SimScenario } from '../src/core/sim.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Linear interpolation over the sorted sample, as `docs/RESULTS_FORMAT.md` § 5 defines it. */
function percentile(sorted: readonly number[], p: number): number {
  const pos = (sorted.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const constante = (value: number) => ({ type: 'constant', value });
const escenario = (probabilidades: Record<string, number>, replications = 1): SimScenario =>
  ({
    run: { start: '2026-09-07T00:00:00Z', duration: 86_400, replications, seed: 1, baseTimeUnit: 'min' },
    elements: {
      S: { interTriggerTimer: constante(600) },
      A: { processingTime: constante(60) },
      B: { processingTime: constante(120) },
      C: { processingTime: constante(1800) },
      ...Object.fromEntries(Object.entries(probabilidades).map(([flow, probability]) => [flow, { probability }])),
    },
  }) as unknown as SimScenario;

async function correr(fixture: string, scenario: SimScenario) {
  const { ir } = await parseBpmn(readFileSync(resolve(here, 'fixtures', fixture), 'utf8'));
  const porReplica = new Map<number, number[]>();
  const result = simulate(ir, scenario, { log: false, onCycleTimes: (replication, times) => porReplica.set(replication, times) });
  return { result, porReplica };
}

describe('onCycleTimes (#460)', () => {
  test('a blocked AND join: no case completed, so no cycle time', async () => {
    const { result, porReplica } = await correr('join-bloqueado.bpmn', escenario({ fa: 0.5, fb: 0.5 }));
    expect(result.process.completed).toBe(0);
    expect(result.process.inFlight).toBeGreaterThan(0);
    expect(porReplica.get(0)).toEqual([]);
  });

  test('blocked join mixed with activity-free cases: same n, min, max, mean and p50/p90/p95 as the engine', async () => {
    const { result, porReplica } = await correr('join-bloqueado-mixto.bpmn', escenario({ fa: 0.25, fb: 0.25, fc: 0.25, fd: 0.25 }));
    const times = [...porReplica.get(0)!].sort((a, b) => a - b);
    const ct = result.process.cycleTime;
    expect(times).toHaveLength(result.process.completed);
    expect(times[0]).toBe(ct.min);
    expect(times.at(-1)).toBe(ct.max);
    expect(times.reduce((a, b) => a + b, 0) / times.length).toBeCloseTo(ct.mean, 9);
    for (const p of ['p50', 'p90', 'p95'] as const) expect(percentile(times, Number(p.slice(1)) / 100)).toBeCloseTo(ct[p], 9);
    // Start → end cases take no time and leave no log row; they are in the sample all the same.
    expect(times[0]).toBe(0);
  });

  test('one call per replication, and the metrics do not change', async () => {
    const scenario = escenario({ fa: 0.25, fb: 0.25, fc: 0.25, fd: 0.25 }, 3);
    const { result, porReplica } = await correr('join-bloqueado-mixto.bpmn', scenario);
    expect([...porReplica.keys()]).toEqual([0, 1, 2]);
    const { ir } = await parseBpmn(readFileSync(resolve(here, 'fixtures', 'join-bloqueado-mixto.bpmn'), 'utf8'));
    expect(simulate(ir, scenario, { log: false })).toEqual(result);
  });
});
