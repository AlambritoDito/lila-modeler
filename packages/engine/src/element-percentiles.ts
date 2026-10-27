/**
 * Per-element percentiles from a run's event log rows (#396, moved from the web app by #666).
 *
 * `RunResult.elements[id]` carries means, totals and extremes but no percentile, so anything that
 * wants a p50/p95 per activity has to rebuild it from the log rows. This module is the one place
 * that does it, with the engine's own rules, so the app's views and `exportResults` apply the same
 * population rules (the views read replication 0 of the in-memory log sample; the export, every
 * replication):
 *
 * - **One sample per activity instance.** An instance with several pool assignments emits one row
 *   per assignment (ADR-025); it is counted once, keyed by `replication:activityInstanceId`.
 * - **Completed instances only**, like `process.waitTime` (RESULTS_FORMAT § 5).
 * - **The measured cohort only** (RESULTS_FORMAT § 8, `sim.ts` `isMeasuredCase`): a case that
 *   *started* before `run.warmup` is out of every statistic, even the rows it emits after it. The
 *   log carries no case start, so it is the case's earliest `enabledAt` in the rows: the engine
 *   creates the case at its arrival instant and moves the token to the first element at that same
 *   instant (`caseStates[…].startedAt = t` of the `arrive` event), so the first row it enables is
 *   enabled exactly then.
 * - **Percentile** = empirical, linear interpolation over the sorted sample, as the engine's
 *   `process.*.p50/p90/p95`.
 *
 * `elementSampler` takes the rows one at a time, so a caller can feed it from `simulate`'s
 * `onEvent` without keeping the log. It keeps an entry per case and per completed instance until
 * the cohort is decided; with `replicationsInOrder` (what `simulate` emits) it decides each
 * replication when the next one starts, so only one replication is held besides the numbers.
 *
 * Pure: no `node:*`, no React; types only from `core/`.
 */
import type { EventLogRow } from './core/result.js';

/** What is measured on one activity instance, in seconds. */
export type InstanceMeasure = (row: EventLogRow) => number;

/** The wait before starting: `resourceWait + offHoursWait`, as `process.waitTime` adds them. */
export const WAIT: InstanceMeasure = (row) => row.resourceWait + row.offHoursWait;

/**
 * The wait for a resource only (`resourceWait`): what the engine's `elements[id].resourceWait`, the
 * bottleneck ranking, the canvas labels and the Results «waiting for resource» columns measure. The
 * activity views (the Simulate dock, the properties quick view) and `exportResults` use this one,
 * so a task's wait reads the same everywhere (QA of #394).
 */
export const RESOURCE_WAIT: InstanceMeasure = (row) => row.resourceWait;

/** Empirical percentile `p` (0..1) with linear interpolation; `NaN` for an empty sample. */
export function percentile(sample: readonly number[], p: number): number {
  if (sample.length === 0) return Number.NaN;
  const sorted = [...sample].sort((a, b) => a - b);
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low]! + (sorted[high]! - sorted[low]!) * (position - low);
}

/** Collects the rows one at a time; `samples()` gives what `elementSamples` gives over the same rows. */
export interface ElementSampler {
  add(row: EventLogRow): void;
  samples(): Map<string, number[]>;
}

/**
 * A sampler of `measure` per element: one value per completed activity instance of the measured
 * cohort (cases that started at or after `warmup`, in seconds since `run.start`). Rows may come in
 * any order; the cohort is decided when `samples()` is called. `replicationsInOrder` promises that
 * every row of a replication comes before the first row of the next one (`simulate`'s order).
 */
export function elementSampler(
  warmup = 0,
  measure: InstanceMeasure = WAIT,
  { replicationsInOrder = false }: { replicationsInOrder?: boolean } = {},
): ElementSampler {
  let caseStart = new Map<string, number>();
  let byInstance = new Map<string, { element: string; caseKey: string; value: number }>();
  const decided = new Map<string, number[]>();
  let replication: number | undefined;
  const decide = (): void => {
    for (const { element, caseKey, value } of byInstance.values()) {
      if ((caseStart.get(caseKey) ?? -Infinity) < warmup) continue;
      const list = decided.get(element);
      if (list === undefined) decided.set(element, [value]);
      else list.push(value);
    }
    caseStart = new Map();
    byInstance = new Map();
  };
  return {
    add(row) {
      if (replicationsInOrder && replication !== undefined && row.replication !== replication) decide();
      replication = row.replication;
      const caseKey = `${row.replication}:${row.caseId}`;
      const before = caseStart.get(caseKey);
      if (before === undefined || row.enabledAt < before) caseStart.set(caseKey, row.enabledAt);
      if (row.status !== 'completed') return;
      byInstance.set(`${row.replication}:${row.activityInstanceId}`, { element: row.elementId, caseKey, value: measure(row) });
    },
    samples() {
      // A copy: what is still pending is decided into it, so a later `add` is not lost.
      const samples = new Map([...decided].map(([id, list]) => [id, [...list]]));
      for (const { element, caseKey, value } of byInstance.values()) {
        if ((caseStart.get(caseKey) ?? -Infinity) < warmup) continue;
        const list = samples.get(element);
        if (list === undefined) samples.set(element, [value]);
        else list.push(value);
      }
      return samples;
    },
  };
}

/** The sample of `measure` per element over `rows` (see `elementSampler`). */
export function elementSamples(
  rows: readonly EventLogRow[],
  warmup = 0,
  measure: InstanceMeasure = WAIT,
): Map<string, number[]> {
  const sampler = elementSampler(warmup, measure);
  for (const row of rows) sampler.add(row);
  return sampler.samples();
}

/** `ps` percentiles of each sample, in the order asked. */
export function samplePercentiles(samples: ReadonlyMap<string, readonly number[]>, ps: readonly number[]): Map<string, number[]> {
  return new Map([...samples].map(([id, sample]) => [id, ps.map((p) => percentile(sample, p))]));
}

/**
 * `ps` percentiles of `measure` per element, e.g. `elementPercentiles(rows, [0.5, 0.95], {
 * warmup })` → `Map { 'Task_A' => [p50, p95], … }`. Elements with no measured instance are absent.
 */
export function elementPercentiles(
  rows: readonly EventLogRow[],
  ps: readonly number[],
  { warmup = 0, measure = WAIT }: { warmup?: number; measure?: InstanceMeasure } = {},
): Map<string, number[]> {
  return samplePercentiles(elementSamples(rows, warmup, measure), ps);
}
