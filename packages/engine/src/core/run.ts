/**
 * API pública y pura del motor DES (LILA-029).
 *
 * Orquesta replicaciones independientes, métricas, callbacks y cancelación cooperativa sin leer
 * reloj, disco, red ni estado global. `core/` conserva cero dependencias externas (ADR-009).
 */

import type { ProcessIR } from './ir.js';
import { aggregateReplication, saturationWarning, type PoolLoad } from './metrics.js';
import { summarizeRunResults } from './replications.js';
import type { BottleneckEntry, EventLogRow, RunResult } from './result.js';
import {
  assertSupportedCalendarScenario,
  assertSupportedResourceScenario,
  runReplication,
  type AbortSignalLike,
  type SimScenario,
} from './sim.js';

export interface SimulationProgress {
  /** Replicación que está corriendo o que acaba de terminar, 0-indexada. */
  replication: number;
  completedReplications: number;
  totalReplications: number;
  /** Progreso global monótono en [0, 1]. */
  fraction: number;
  /** Tiempo virtual alcanzado dentro de la replicación actual, en segundos. */
  simulatedTime: number;
}

export interface SimulateOptions {
  /** Recibe cada fila completa en orden de simulación y de replicación. */
  onEvent?: ((row: EventLogRow) => void) | undefined;
  /** Recibe avances durante corridas con `duration` y al cerrar cada replicación. */
  onProgress?: ((progress: SimulationProgress) => void) | undefined;
  /** Señal estructural: basta cualquier objeto con un booleano `aborted`. */
  signal?: AbortSignalLike | undefined;
  /**
   * `false` desactiva el event log entero: ni llama a `onEvent` ni publica `result.log`.
   * Por defecto el log está habilitado (sección 7 de docs/RESULTS_FORMAT.md).
   */
  log?: boolean | undefined;
}

function mean(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

/** Promedia recursivamente una estructura estable compuesta solo por objetos y números. */
function meanShape<T>(values: readonly T[]): T {
  const first = values[0];
  if (typeof first === 'number') return mean(values as readonly number[]) as T;
  if (first === null || typeof first !== 'object' || Array.isArray(first)) {
    throw new TypeError('E-AGREGADO-NO-NUMERICO: la estructura de métricas no es promediable.');
  }

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(first)) {
    output[key] = meanShape(values.map((value) => (value as Record<string, unknown>)[key]));
  }
  return output as T;
}

/** Ranking futuro de M2: promedio por elemento y orden normativo estable. */
function meanBottlenecks(results: readonly RunResult[]): BottleneckEntry[] {
  const ids = new Set<string>();
  const byResult = results.map((result) => {
    const map = new Map<string, BottleneckEntry>();
    for (const entry of result.bottlenecks) {
      ids.add(entry.elementId);
      map.set(entry.elementId, entry);
    }
    return map;
  });

  return [...ids]
    .map((elementId) => {
      const appearances = byResult.flatMap((entries) => {
        const entry = entries.get(elementId);
        return entry === undefined ? [] : [entry];
      });
      return {
        elementId,
        // La espera total es una métrica incondicional: una réplica sin espera aporta cero.
        resourceWaitTotal: mean(byResult.map((entries) => entries.get(elementId)?.resourceWaitTotal ?? 0)),
        // La utilización describe el recurso del cuello observado. Si el elemento no fue cuello
        // en una réplica, no hay observación de esa relación y no se inventa un cero.
        utilization: mean(appearances.map((entry) => entry.utilization)),
      };
    })
    .filter((entry) => entry.resourceWaitTotal > 0)
    .sort(
      (left, right) =>
        right.resourceWaitTotal - left.resourceWaitTotal ||
        right.utilization - left.utilization ||
        (left.elementId < right.elementId ? -1 : left.elementId > right.elementId ? 1 : 0),
    );
}

/** Los campos top-level multi-réplica son medias de la misma ruta en cada replicación. */
function meanRunResults(results: readonly RunResult[]): RunResult {
  if (results.length === 0) throw new RangeError('E-REPLICACIONES-VACIAS: no hay resultados que agregar.');
  const warnings = new Set<string>();
  for (const result of results) for (const warning of result.warnings) warnings.add(warning);

  return {
    elements: meanShape(results.map((result) => result.elements)),
    flows: meanShape(results.map((result) => result.flows)),
    resources: meanShape(results.map((result) => result.resources)),
    process: meanShape(results.map((result) => result.process)),
    bottlenecks: meanBottlenecks(results),
    warnings: [...warnings],
  };
}

/**
 * LILA-191: la saturación es una propiedad del pool y de la **corrida**, no de la réplica, así
 * que se decide una sola vez sobre la media de las cantidades. Deduplicar los avisos de cada
 * réplica no serviría: bastaría con que una sola cruzara el umbral por azar (con ρ = 0,8 y 30
 * réplicas, unas cinco lo hacen) para que el aviso saliera en la corrida entera.
 */
function saturationWarnings(loads: readonly Map<string, PoolLoad>[]): string[] {
  const warnings: string[] = [];
  if (loads.length === 0) return warnings;
  for (const poolId of loads[0]!.keys()) {
    const total: PoolLoad = { demand: 0, served: 0, pending: 0, capacity: 0, firstHalf: 0, secondHalf: 0 };
    for (const load of loads) {
      const entry = load.get(poolId);
      if (entry === undefined) continue;
      total.demand += entry.demand;
      total.served += entry.served;
      total.pending += entry.pending;
      total.capacity += entry.capacity;
      total.firstHalf += entry.firstHalf;
      total.secondHalf += entry.secondHalf;
    }
    // Las medias comparten denominador, así que basta dividir donde el umbral no es una razón.
    total.capacity /= loads.length;
    total.firstHalf /= loads.length;
    total.secondHalf /= loads.length;
    const warning = saturationWarning(poolId, total);
    if (warning !== undefined) warnings.push(warning);
  }
  return warnings;
}

/**
 * Simula una o más replicaciones. Una replicación incompleta nunca entra a
 * `replications.kpis`, evitando intervalos de confianza estadísticamente inválidos.
 */
export function simulate(ir: ProcessIR, scenario: SimScenario, options: SimulateOptions = {}): RunResult {
  // El preflight precede incluso al progreso inicial: un input no soportado no puede dejar
  // callbacks observables antes de lanzar el error estable.
  assertSupportedResourceScenario(scenario);
  assertSupportedCalendarScenario(scenario);
  // Contrato del event log (docs/RESULTS_FORMAT.md § 7): `result.log` solo se materializa cuando
  // nadie más se hizo cargo de las filas. Con `onEvent` el consumidor ya las recibe una a una —la
  // CLI las escribe directas a `log.csv`— y retenerlas otra vez duplicaría hasta 6 M de objetos.
  const log: EventLogRow[] | undefined =
    options.log === false || options.onEvent !== undefined ? undefined : [];
  const totalReplications = scenario.run.replications ?? 1;
  const completed: RunResult[] = [];
  // LILA-191: la evidencia de saturación de cada réplica incluida, en el mismo orden.
  const loads: Map<string, PoolLoad>[] = [];
  let partial: RunResult | undefined;
  let lastFraction = -1;

  const emitProgress = (progress: SimulationProgress): void => {
    if (progress.fraction <= lastFraction) return;
    lastFraction = progress.fraction;
    options.onProgress?.(progress);
  };

  // Incluso una réplica cuyo heap nazca vacío tiene un inicio observable y coherente.
  if (options.onProgress !== undefined) {
    emitProgress({
      replication: 0,
      completedReplications: 0,
      totalReplications,
      fraction: 0,
      simulatedTime: 0,
    });
  }

  for (let replication = 0; replication < totalReplications; replication++) {
    // Una señal activada por el callback de cierre anterior detiene entre replicaciones.
    if (replication > 0 && options.signal?.aborted === true) break;

    const duration = scenario.run.duration;
    const run = runReplication(ir, scenario, replication, {
      signal: options.signal,
      log: options.log,
      onEvent: options.onEvent,
      onStep:
        options.onProgress === undefined
          ? undefined
          : (simulatedTime) => {
              const localFraction =
                duration !== undefined && duration > 0
                  ? Math.min(1, Math.max(0, simulatedTime / duration))
                  : 0;
              emitProgress({
                replication,
                completedReplications: completed.length,
                totalReplications,
                fraction: (replication + localFraction) / totalReplications,
                simulatedTime,
              });
            },
    });
    // Solo el modo retenido conserva las filas más allá de la iteración; en los otros dos el
    // `ReplicationRun` entero queda libre al cerrarla, así que el pico es el de una replicación.
    if (log !== undefined) for (const row of run.rows) log.push(row);
    const load = new Map<string, PoolLoad>();
    const result = aggregateReplication(ir, run, scenario, load);

    if (run.cancelled === true) {
      partial = result;
      loads.push(load);
      break;
    }

    completed.push(result);
    loads.push(load);
    emitProgress({
      replication,
      completedReplications: completed.length,
      totalReplications,
      fraction: completed.length / totalReplications,
      simulatedTime: run.stoppedAt,
    });
  }

  const cancelled = partial !== undefined || completed.length < totalReplications;
  // El top-level cancelado conserva todo el trabajo observable, incluida la réplica parcial.
  // El IC, en cambio, se calcula más abajo solo con `completed`.
  const included = partial === undefined ? completed : [...completed, partial];
  const result = included.length === 1 ? included[0]! : meanRunResults(included);
  for (const warning of saturationWarnings(loads)) result.warnings.push(warning);

  if (completed.length > 1) result.replications = summarizeRunResults(completed);
  if (cancelled) {
    result.cancelled = true;
    result.completedReplications = completed.length;
  }
  if (log !== undefined) result.log = log;
  return result;
}
