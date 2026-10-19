/**
 * Per-element percentiles from a run's event log sample (#396). The computation moved to the
 * engine (`@lila-modeler/engine` `elementPercentiles`, #666), where `exportResults` shares it, so
 * the app and the agents' exports never disagree on the population. What stays here is the app's
 * own rule, `p95Fiable`, and the two Spanish names `DockSimular.test.tsx` checks the dock against,
 * as thin aliases of the engine's.
 */
import { RESOURCE_WAIT, WAIT, elementPercentiles, type EventLogRow, type InstanceMeasure } from '@lila-modeler/engine';

/** `RESOURCE_WAIT`: the measure of the activity views (the Simulate dock, the properties quick view). */
export const ESPERA_RECURSO: InstanceMeasure = RESOURCE_WAIT;

/** `elementPercentiles`, with the measure under `medida` (`WAIT` by default, as the engine's). */
export function percentilesPorElemento(
  rows: readonly EventLogRow[],
  ps: readonly number[],
  { warmup = 0, medida = WAIT }: { warmup?: number; medida?: InstanceMeasure } = {},
): Map<string, number[]> {
  return elementPercentiles(rows, ps, { warmup, measure: medida });
}

/**
 * Whether a log sample can give a p95: present and complete. One rule for the properties quick view
 * and the Simulate dock (QA of #394): a truncated sample covers the first cases only and would bias
 * the percentile, so neither shows one from it.
 */
export function p95Fiable(log: { truncated: boolean } | undefined): log is { rows: readonly EventLogRow[]; truncated: boolean } {
  return log !== undefined && !log.truncated;
}
