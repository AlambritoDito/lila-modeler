/**
 * The app's bottleneck scale (#669), moved out of `apps/web/src/BottleneckOverlay.ts` so the app's
 * canvas, the Results heat map and `export_diagram` / `lila export diagram` colour a run the same
 * way. Pure and without strings: the callers label the entries in their own language.
 *
 * - `waitLevel`: the level of one task, from the ratio of its mean resource wait to its own mean
 *   processing time (thresholds 0.05 and 1).
 * - `bottleneckCut`: the part of `result.bottlenecks` the canvas paints.
 * - `heatMap`: the level of every measured task, as the Results heat map paints it.
 * - `WAIT_LEVEL_COLOURS`: the `sim.bottleneck.*` tokens of Lila Light, the theme `renderSvg` draws in.
 */
import type { RunResult } from './core/result.js';

export type WaitLevel = 'low' | 'mid' | 'high';

/**
 * Thresholds of `waitLevel`, as a fraction of `resourceWait.mean / processing.mean`: how many
 * times longer a task waits for a resource than it actually works. Below `WAIT_RATIO_LOW` the
 * wait is under 5 % of the processing time and hardly shows; from `WAIT_RATIO_HIGH` = 1 the task
 * waits **longer** than it works — the textbook bottleneck. The ratio belongs to each task and does
 * not depend on the others, so a task's level follows its own wait between two scenarios (terciles
 * of the result's tasks were tried first and dropped: with two or three competing tasks a level
 * only said their order).
 */
export const WAIT_RATIO_LOW = 0.05;
export const WAIT_RATIO_HIGH = 1;

export function waitLevel(ratio: number): WaitLevel {
  if (ratio < WAIT_RATIO_LOW) return 'low';
  if (ratio < WAIT_RATIO_HIGH) return 'mid';
  return 'high';
}

/** Lila Light's `sim.bottleneck.*` (`apps/web/src/theme/themes/lila-light.json`). */
export const WAIT_LEVEL_COLOURS: Readonly<Record<WaitLevel, string>> = {
  low: '#E8B84B',
  mid: '#E07A22',
  high: '#C42152',
};

/** One task of `bottleneckCut`. */
export interface BottleneckCutEntry {
  readonly elementId: string;
  readonly level: WaitLevel;
  /** Position in `result.bottlenecks` (0 = the main bottleneck). */
  readonly rank: number;
  /** Utilization of the element's main resource, as `result.bottlenecks` carries it (0–1). */
  readonly utilization: number;
  /** `elements[id].resourceWait.mean`, in seconds. */
  readonly resourceWaitMean: number;
}

/**
 * How many entries of the ranking are painted (#226): rank 0 **always**, whatever its level (it is
 * the one the side panel names); plus the `high` ones; if none is `high`, the first `NO_HIGH`;
 * and never more than `CEILING`, as each one adds a label over the diagram.
 *
 * Rank 0 is handled apart because `bottlenecks` is sorted by `resourceWait.total` and the level
 * comes from `resourceWait.mean / processing.mean`: two different orders, so the first of the
 * ranking can be `mid` while another one is `high`.
 */
const CEILING = 5;
const NO_HIGH = 3;

/**
 * Walks `result.bottlenecks` in its order (the engine's ranking is not recomputed) and keeps the
 * entries that are painted, in that order. An entry without its element in `elements` (only a
 * hand-edited JSON has one) is skipped. Without resources or waits `bottlenecks` is empty, and so
 * is the cut.
 */
export function bottleneckCut(result: Pick<RunResult, 'bottlenecks' | 'elements'>): readonly BottleneckCutEntry[] {
  const entries: BottleneckCutEntry[] = [];
  for (const [rank, entry] of result.bottlenecks.entries()) {
    const metrics = result.elements[entry.elementId];
    if (metrics === undefined) continue;
    // A task with a wait completed at least once, so `processing.mean` > 0; if it is 0 anyway the
    // wait is infinitely longer than the processing — the highest level, not an error.
    const ratio = metrics.processing.mean > 0 ? metrics.resourceWait.mean / metrics.processing.mean : Infinity;
    entries.push({
      elementId: entry.elementId,
      level: waitLevel(ratio),
      rank,
      utilization: entry.utilization,
      resourceWaitMean: metrics.resourceWait.mean,
    });
  }
  const high = entries.filter((entry) => entry.level === 'high');
  const cut = high.length > 0 ? high : entries.slice(0, NO_HIGH);
  const main = entries[0];
  if (main !== undefined && !cut.includes(main)) cut.unshift(main);
  return cut.slice(0, CEILING);
}

/** One task of `heatMap`. */
export interface HeatMapEntry {
  readonly level: WaitLevel;
  /** `elements[id].resourceWait.mean`, in seconds. */
  readonly resourceWaitMean: number;
}

/**
 * The level of each of `taskIds` the result measured, in the order of `taskIds`. A task that
 * never started is left out: it has nothing to say. With no processing time, any wait is the
 * highest level and no wait the lowest.
 */
export function heatMap(
  result: Pick<RunResult, 'elements'>,
  taskIds: readonly string[],
): Readonly<Record<string, HeatMapEntry>> {
  // No prototype: a BPMN id may be `__proto__`.
  const map: Record<string, HeatMapEntry> = Object.create(null) as Record<string, HeatMapEntry>;
  for (const id of taskIds) {
    const m = result.elements[id];
    if (m === undefined || m.started === 0) continue;
    const ratio = m.processing.mean > 0 ? m.resourceWait.mean / m.processing.mean : m.resourceWait.mean > 0 ? Infinity : 0;
    map[id] = { level: waitLevel(ratio), resourceWaitMean: m.resourceWait.mean };
  }
  return map;
}
