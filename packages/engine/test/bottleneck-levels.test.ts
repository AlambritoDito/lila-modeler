/**
 * The app's bottleneck scale in the engine (#669): `waitLevel`'s thresholds, the canvas's cut of
 * `result.bottlenecks` and the Results heat map, as `apps/web/src/BottleneckOverlay.ts` applied
 * them before the move, and the colours of Lila Light's `sim.bottleneck.*` tokens.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { bottleneckCut, heatMap, WAIT_LEVEL_COLOURS, waitLevel } from '../src/bottleneck-levels.js';
import type { RunResult } from '../src/core/result.js';

type Result = Pick<RunResult, 'bottlenecks' | 'elements'>;

/** A result whose tasks wait `wait` seconds and work `processing` seconds on average. */
function result(tasks: Record<string, { wait: number; processing: number; started?: number }>, ranking: readonly string[] = Object.keys(tasks)): Result {
  const elements: Record<string, unknown> = {};
  for (const [id, t] of Object.entries(tasks)) {
    elements[id] = { started: t.started ?? 10, processing: { mean: t.processing }, resourceWait: { mean: t.wait } };
  }
  return {
    elements: elements as Result['elements'],
    bottlenecks: ranking.map((elementId, index) => ({ elementId, utilization: 0.9 - index / 10 })) as unknown as Result['bottlenecks'],
  };
}

describe('waitLevel', () => {
  test('low below 0.05, mid below 1, high from exactly 1 (and Infinity)', () => {
    expect(waitLevel(0)).toBe('low');
    expect(waitLevel(0.0499)).toBe('low');
    expect(waitLevel(0.05)).toBe('mid');
    expect(waitLevel(0.99)).toBe('mid');
    expect(waitLevel(1)).toBe('high');
    expect(waitLevel(Infinity)).toBe('high');
  });
});

describe('bottleneckCut', () => {
  test('the high ones, in the ranking\'s order, with rank 0 first even when it is not high', () => {
    const r = result({ A: { wait: 5, processing: 10 }, B: { wait: 20, processing: 10 }, C: { wait: 1, processing: 100 }, D: { wait: 30, processing: 10 } });
    const cut = bottleneckCut(r);
    expect(cut.map((e) => [e.elementId, e.level, e.rank])).toEqual([['A', 'mid', 0], ['B', 'high', 1], ['D', 'high', 3]]);
    expect(cut[1]).toEqual({ elementId: 'B', level: 'high', rank: 1, utilization: 0.8, resourceWaitMean: 20 });
  });

  test('no high one: the first three; never more than five', () => {
    const mids = Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map((id) => [id, { wait: 5, processing: 10 }]));
    expect(bottleneckCut(result(mids)).map((e) => e.elementId)).toEqual(['A', 'B', 'C']);
    const highs = Object.fromEntries(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((id) => [id, { wait: 50, processing: 10 }]));
    expect(bottleneckCut(result(highs)).map((e) => e.elementId)).toEqual(['A', 'B', 'C', 'D', 'E']);
    // Rank 0 not high plus five high ones: still five, rank 0 kept.
    const mixed = { Z: { wait: 1, processing: 10 }, ...highs };
    expect(bottleneckCut(result(mixed)).map((e) => e.elementId)).toEqual(['Z', 'A', 'B', 'C', 'D']);
  });

  test('an entry without its element is skipped; no processing time is the highest level; empty stays empty', () => {
    const r = result({ A: { wait: 5, processing: 0 } }, ['ghost', 'A']);
    expect(bottleneckCut(r)).toEqual([{ elementId: 'A', level: 'high', rank: 1, utilization: 0.8, resourceWaitMean: 5 }]);
    expect(bottleneckCut(result({}))).toEqual([]);
  });
});

describe('heatMap', () => {
  test('every measured task of the list, in its order; never started or unknown ones are left out', () => {
    const r = result({ A: { wait: 0, processing: 10 }, B: { wait: 20, processing: 10 }, C: { wait: 1, processing: 10, started: 0 } }, []);
    const map = heatMap(r, ['B', 'A', 'C', 'X']);
    expect(Object.keys(map)).toEqual(['B', 'A']);
    expect(map.B).toEqual({ level: 'high', resourceWaitMean: 20 });
    expect(map.A).toEqual({ level: 'low', resourceWaitMean: 0 });
  });

  test('no processing time: any wait is high, no wait is low', () => {
    const r = result({ A: { wait: 3, processing: 0 }, B: { wait: 0, processing: 0 } }, []);
    expect(heatMap(r, ['A', 'B'])).toEqual({ A: { level: 'high', resourceWaitMean: 3 }, B: { level: 'low', resourceWaitMean: 0 } });
  });

  test('a task id such as `__proto__` is an ordinary key', () => {
    const r = result({}, []);
    Object.defineProperty(r.elements, '__proto__', { value: { started: 1, processing: { mean: 10 }, resourceWait: { mean: 20 } }, enumerable: true });
    const map = heatMap(r, ['__proto__']);
    expect(Object.hasOwn(map, '__proto__')).toBe(true);
    expect(Object.keys(map)).toEqual(['__proto__']);
  });
});

test('the colours are Lila Light\'s sim.bottleneck tokens, the theme renderSvg draws in', () => {
  const theme = JSON.parse(readFileSync(fileURLToPath(new URL('../../../apps/web/src/theme/themes/lila-light.json', import.meta.url)), 'utf8')) as { tokens: Record<string, string> };
  expect(WAIT_LEVEL_COLOURS).toEqual({
    low: theme.tokens['sim.bottleneck.low'],
    mid: theme.tokens['sim.bottleneck.mid'],
    high: theme.tokens['sim.bottleneck.high'],
  });
});
