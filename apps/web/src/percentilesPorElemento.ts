/**
 * Per-element percentiles from a run's event log sample (#396; shared with the Results views).
 *
 * `RunResult.elements[id]` carries means, totals and extremes but no percentile, so anything that
 * wants a p50/p95 per activity has to rebuild it from the log rows. This module is the one place
 * that does it, with the engine's own rules, so two screens never disagree on the population:
 *
 * - **One sample per activity instance.** An instance with several pool assignments emits one row
 *   per assignment (ADR-025); it is counted once, keyed by `replication:activityInstanceId`.
 * - **Completed instances only**, like `process.waitTime` (RESULTS_FORMAT § 5).
 * - **The measured cohort only** (RESULTS_FORMAT § 8, `sim.ts` `isMeasuredCase`): a case that
 *   *started* before `run.warmup` is out of every statistic, even the rows it emits after it. The
 *   log carries no case start, so it is the case's earliest `enabledAt` in the sample: the engine
 *   creates the case at its arrival instant and moves the token to the first element at that same
 *   instant (`caseStates[…].startedAt = t` of the `arrive` event), so the first row it enables is
 *   enabled exactly then.
 * - **Percentile** = empirical, linear interpolation over the sorted sample, as the engine's
 *   `process.*.p50/p90/p95`.
 *
 * Pure: no React, no engine runtime.
 */
import type { EventLogRow } from '@lila-modeler/engine';

/** What is measured on one activity instance, in seconds. */
export type MedidaInstancia = (fila: EventLogRow) => number;

/** The wait before starting: `resourceWait + offHoursWait`, as `process.waitTime` adds them. */
export const ESPERA: MedidaInstancia = (fila) => fila.resourceWait + fila.offHoursWait;

/**
 * The wait for a resource only (`resourceWait`): what the engine's `elements[id].resourceWait`, the
 * bottleneck ranking, the canvas labels and the Results «waiting for resource» columns measure. The
 * activity views (the Simulate dock, the properties quick view) use this one, so a task's wait reads
 * the same everywhere (QA of #394).
 */
export const ESPERA_RECURSO: MedidaInstancia = (fila) => fila.resourceWait;

/** Empirical percentile `p` (0..1) with linear interpolation; `NaN` for an empty sample. */
export function percentil(muestra: readonly number[], p: number): number {
  if (muestra.length === 0) return Number.NaN;
  const orden = [...muestra].sort((a, b) => a - b);
  const pos = (orden.length - 1) * p;
  const bajo = Math.floor(pos);
  const alto = Math.ceil(pos);
  return orden[bajo]! + (orden[alto]! - orden[bajo]!) * (pos - bajo);
}

/**
 * The sample of `medida` per element: one value per completed activity instance of the measured
 * cohort (cases that started at or after `warmup`, in seconds since `run.start`).
 */
export function muestrasPorElemento(
  rows: readonly EventLogRow[],
  warmup = 0,
  medida: MedidaInstancia = ESPERA,
): Map<string, number[]> {
  const inicioCaso = new Map<string, number>();
  for (const row of rows) {
    const clave = `${row.replication}:${row.caseId}`;
    const antes = inicioCaso.get(clave);
    if (antes === undefined || row.enabledAt < antes) inicioCaso.set(clave, row.enabledAt);
  }
  const porInstancia = new Map<string, { elemento: string; valor: number }>();
  for (const row of rows) {
    if (row.status !== 'completed') continue;
    if ((inicioCaso.get(`${row.replication}:${row.caseId}`) ?? -Infinity) < warmup) continue;
    porInstancia.set(`${row.replication}:${row.activityInstanceId}`, { elemento: row.elementId, valor: medida(row) });
  }
  const muestras = new Map<string, number[]>();
  for (const { elemento, valor } of porInstancia.values()) {
    const lista = muestras.get(elemento);
    if (lista === undefined) muestras.set(elemento, [valor]);
    else lista.push(valor);
  }
  return muestras;
}

/**
 * `ps` percentiles of `medida` per element, e.g. `percentilesPorElemento(rows, [0.5, 0.95], {
 * warmup })` → `Map { 'Task_A' => [p50, p95], … }`. Elements with no measured instance are absent.
 */
export function percentilesPorElemento(
  rows: readonly EventLogRow[],
  ps: readonly number[],
  { warmup = 0, medida = ESPERA }: { warmup?: number; medida?: MedidaInstancia } = {},
): Map<string, number[]> {
  return new Map(
    [...muestrasPorElemento(rows, warmup, medida)].map(([id, muestra]) => [id, ps.map((p) => percentil(muestra, p))]),
  );
}

/**
 * Whether a log sample can give a p95: present and complete. One rule for the properties quick view
 * and the Simulate dock (QA of #394): a truncated sample covers the first cases only and would bias
 * the percentile, so neither shows one from it.
 */
export function p95Fiable(log: { truncated: boolean } | undefined): log is { rows: readonly EventLogRow[]; truncated: boolean } {
  return log !== undefined && !log.truncated;
}
