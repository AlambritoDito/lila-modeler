/**
 * Agregación de métricas de una replicación (LILA-028).
 *
 * Este módulo transforma la salida intermedia del DES en el contrato `RunResult`. No ejecuta
 * simulaciones ni mantiene estado global: una misma `ReplicationRun` siempre produce el mismo
 * resultado (R-DURA-6). Replicaciones e intervalos de confianza pertenecen a LILA-027.
 *
 * `core/` no importa nada fuera de `core/` (ADR-009). Todos los tiempos permanecen en segundos y
 * todos los mapas usan ids BPMN como clave (R-DURA-1, R-DURA-4).
 */

import type { ProcessIR } from './ir.js';
import type { ElementMetrics, Percentiles, RunResult, Stat, StatSd } from './result.js';
import type { ReplicationRun } from './sim.js';

const EMPTY_STAT: Readonly<Stat> = { min: 0, max: 0, mean: 0, total: 0 };
const EMPTY_STAT_SD: Readonly<StatSd> = { min: 0, max: 0, mean: 0, sd: 0, total: 0 };
const EMPTY_PERCENTILES: Readonly<Percentiles> = {
  min: 0,
  max: 0,
  mean: 0,
  sd: 0,
  p50: 0,
  p90: 0,
  p95: 0,
};

/** Desviación estándar muestral; con menos de dos observaciones es cero. */
function sampleSd(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0;
  let squared = 0;
  for (const value of values) squared += (value - mean) ** 2;
  return Math.sqrt(squared / (values.length - 1));
}

/** Estadísticas min/max/media/total. El conjunto vacío tiene identidad numérica cero. */
function stat(values: readonly number[]): Stat {
  if (values.length === 0) return { ...EMPTY_STAT };
  let min = values[0]!;
  let max = min;
  let total = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    total += value;
  }
  return { min, max, mean: total / values.length, total };
}

/** Estadísticas con desviación estándar muestral. */
function statSd(values: readonly number[]): StatSd {
  if (values.length === 0) return { ...EMPTY_STAT_SD };
  const base = stat(values);
  return { ...base, sd: sampleSd(values, base.mean) };
}

/**
 * Percentil empírico con interpolación lineal sobre la muestra ordenada.
 * Posición = `(n - 1) * p`, como prescribe docs/RESULTS_FORMAT.md.
 */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const left = sorted[lower]!;
  if (lower === upper) return left;
  return left + (sorted[upper]! - left) * (position - lower);
}

/** Estadísticas de proceso con p50/p90/p95 empíricos. */
function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) return { ...EMPTY_PERCENTILES };
  const sorted = [...values].sort((a, b) => a - b);
  const base = stat(sorted);
  return {
    min: base.min,
    max: base.max,
    mean: base.mean,
    sd: sampleSd(sorted, base.mean),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
  };
}

/** Crea las métricas neutras que deben existir para todo nodo del IR. */
function emptyElementMetrics(started: number, completed: number): ElementMetrics {
  return {
    started,
    completed,
    processing: { ...EMPTY_STAT },
    resourceWait: { ...EMPTY_STAT_SD },
    offHoursWait: { ...EMPTY_STAT_SD },
    queueLength: { mean: 0, max: 0 },
    fixedCostTotal: 0,
  };
}

/**
 * Convierte una replicación del kernel DES en un `RunResult` completo.
 *
 * LILA-028 posee las métricas de elemento, flujo y proceso. Los campos de recursos, colas y
 * cuellos de botella conservan su valor neutro hasta LILA-036. La agregación entre replicaciones
 * se hace después, en `replications.ts` (LILA-027).
 */
export interface AggregateReplicationOptions {
  /** Duración efectiva de la ventana estadística, en segundos (R-ARR-7). */
  statisticsDuration?: number | undefined;
}

export function aggregateReplication(
  ir: ProcessIR,
  run: ReplicationRun,
  options: AggregateReplicationOptions = {},
): RunResult {
  // Precondición de frontera con LILA-027: el productor entrega `cases`, `elements` y `flows`
  // pertenecientes a una misma ventana estadística. Puede conservar en `rows` eventos previos al
  // warmup para el event log; filtrar por los caseId recibidos impide que contaminen el agregado.
  // En LILA-028, `runReplication` de main equivale a esa precondición con warmup = 0.
  const includedCaseIds = new Set(run.cases.map((record) => String(record.caseId)));
  const includedRows = run.rows.filter((row) => includedCaseIds.has(row.caseId));

  const processingByElement = new Map<string, number[]>();
  const resourceWaitByElement = new Map<string, number[]>();
  const offHoursWaitByElement = new Map<string, number[]>();
  const fixedCostByElement = new Map<string, number>();
  const waitByCase = new Map<string, number>();
  const costByCase = new Map<string, number>();

  for (const row of includedRows) {
    // R-CAL-8: esta identidad sigue siendo correcta cuando una tarea se pausa durante el
    // cierre de calendario. En M1 las esperas valen cero y se reduce a endedAt - startedAt.
    const processing = row.endedAt - row.enabledAt - row.resourceWait - row.offHoursWait;
    const processingValues = processingByElement.get(row.elementId) ?? [];
    processingValues.push(processing);
    processingByElement.set(row.elementId, processingValues);

    const resourceWaitValues = resourceWaitByElement.get(row.elementId) ?? [];
    resourceWaitValues.push(row.resourceWait);
    resourceWaitByElement.set(row.elementId, resourceWaitValues);

    const offHoursWaitValues = offHoursWaitByElement.get(row.elementId) ?? [];
    offHoursWaitValues.push(row.offHoursWait);
    offHoursWaitByElement.set(row.elementId, offHoursWaitValues);

    // En M1 no existen recursos: `row.cost` es exactamente el fixedCost del elemento. LILA-036
    // extenderá esta separación cuando las filas incorporen costos de pools.
    fixedCostByElement.set(row.elementId, (fixedCostByElement.get(row.elementId) ?? 0) + row.cost);
    waitByCase.set(row.caseId, (waitByCase.get(row.caseId) ?? 0) + row.resourceWait + row.offHoursWait);
    costByCase.set(row.caseId, (costByCase.get(row.caseId) ?? 0) + row.cost);
  }

  const elements: Record<string, ElementMetrics> = {};
  for (const nodeId of Object.keys(ir.nodes)) {
    const counters = run.elements[nodeId] ?? { started: 0, completed: 0 };
    const metrics = emptyElementMetrics(counters.started, counters.completed);
    metrics.processing = stat(processingByElement.get(nodeId) ?? []);
    metrics.resourceWait = statSd(resourceWaitByElement.get(nodeId) ?? []);
    metrics.offHoursWait = statSd(offHoursWaitByElement.get(nodeId) ?? []);
    metrics.fixedCostTotal = fixedCostByElement.get(nodeId) ?? 0;
    elements[nodeId] = metrics;
  }

  const flows: RunResult['flows'] = {};
  for (const flowId of Object.keys(ir.flows)) flows[flowId] = { count: run.flows[flowId] ?? 0 };

  const completedCases = run.cases.filter((record) => record.endedAt !== null);
  const cycleTimes = completedCases.map((record) => record.endedAt! - record.startedAt);
  const waitTimes = completedCases.map((record) => waitByCase.get(String(record.caseId)) ?? 0);
  const completedCaseCosts = completedCases.map((record) => costByCase.get(String(record.caseId)) ?? 0);
  const totalCost = includedRows.reduce((total, row) => total + row.cost, 0);
  const effectiveSeconds = Math.max(0, options.statisticsDuration ?? run.stoppedAt);

  return {
    elements,
    flows,
    resources: {},
    process: {
      started: run.cases.length,
      completed: completedCases.length,
      inFlight: run.cases.length - completedCases.length,
      cycleTime: percentiles(cycleTimes),
      waitTime: percentiles(waitTimes),
      throughputPerHour: effectiveSeconds > 0 ? completedCases.length / (effectiveSeconds / 3600) : 0,
      costPerCase:
        completedCaseCosts.length > 0
          ? completedCaseCosts.reduce((total, cost) => total + cost, 0) / completedCaseCosts.length
          : 0,
      totalCost,
    },
    bottlenecks: [],
    warnings: [...run.warnings],
  };
}
