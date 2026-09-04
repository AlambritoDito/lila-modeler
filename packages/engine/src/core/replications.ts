/**
 * Warmup y replicaciones (LILA-027).
 *
 * Este módulo solo orquesta funciones puras de `core/`: cada replicación estrena el estado
 * de `runReplication`, cuyo índice forma parte de la semilla de cada stream (R-ARR-8,
 * R-DET-2). La conversión de una `ReplicationRun` a métricas pertenece a LILA-028; aquí se
 * ofrece la agregación estadística independiente para que `simulate` pueda componer ambas.
 */

import type { ProcessIR } from './ir.js';
import type { KpiSummary, ReplicationSummary, RunResult } from './result.js';
import { runReplication, type ReplicationRun, type SimScenario } from './sim.js';

/** Ejecuta todas las replicaciones desde estado vacío, en orden 0..R-1. */
export function runReplications(ir: ProcessIR, scenario: SimScenario): ReplicationRun[] {
  const count = scenario.run.replications ?? 1;
  const runs: ReplicationRun[] = [];
  for (let replication = 0; replication < count; replication++) {
    runs.push(runReplication(ir, scenario, replication));
  }
  return runs;
}

/** Desviación estándar muestral (`n - 1`). */
function sampleSd(values: readonly number[], mean: number): number {
  let sumSquares = 0;
  for (const value of values) {
    const delta = value - mean;
    sumSquares += delta * delta;
  }
  return Math.sqrt(sumSquares / (values.length - 1));
}

/* t(0.975; df), valores publicados habituales para df 1..30. Para df mayores, la
 * expansión de Cornish-Fisher converge rápidamente al cuantil normal. */
const T975: readonly number[] = [
  0,
  12.7062047364,
  4.30265272975,
  3.18244630528,
  2.7764451052,
  2.57058183564,
  2.44691184879,
  2.36462425101,
  2.3060041352,
  2.26215716285,
  2.22813885196,
  2.20098516008,
  2.17881282966,
  2.16036865646,
  2.14478668792,
  2.13144954556,
  2.11990529922,
  2.10981557783,
  2.10092204024,
  2.09302405441,
  2.08596344727,
  2.07961384473,
  2.0738730679,
  2.06865761042,
  2.06389856163,
  2.05953855275,
  2.05552943864,
  2.05183051648,
  2.0484071418,
  2.04522964213,
  2.0422724563,
];

/** Cuantil bilateral de Student requerido por R-ARR-8. */
function studentT975(df: number): number {
  if (df <= 30) return T975[df]!;
  const z = 1.959963984540054;
  const z2 = z * z;
  const inverseDf = 1 / df;
  // Abramowitz-Stegun/Cornish-Fisher hasta O(df^-4).
  return (
    z +
    ((z * (z2 + 1)) / 4) * inverseDf +
    ((z * (5 * z2 * z2 + 16 * z2 + 3)) / 96) * inverseDf ** 2 +
    ((z * (3 * z2 ** 3 + 19 * z2 * z2 + 17 * z2 - 15)) / 384) * inverseDf ** 3 +
    ((z * (79 * z2 ** 4 + 776 * z2 ** 3 + 1482 * z2 * z2 - 1920 * z2 - 945)) / 92160) *
      inverseDf ** 4
  );
}

/** Resume una serie con media, sd muestral e IC 95 % de Student. */
export function summarizeKpi(values: readonly number[]): KpiSummary {
  if (values.length < 2) {
    throw new RangeError('E-REPLICACIONES-INSUFICIENTES: se requieren al menos 2 valores para calcular el IC 95 %.');
  }
  let total = 0;
  for (const value of values) total += value;
  const mean = total / values.length;
  const sd = sampleSd(values, mean);
  const margin = studentT975(values.length - 1) * (sd / Math.sqrt(values.length));
  return { mean, sd, ci95: [mean - margin, mean + margin] };
}

/**
 * Agrega mapas planos de KPI. Todos deben contener exactamente las mismas claves finitas:
 * una discrepancia suele indicar que una replicación se agregó con otro contrato.
 */
export function summarizeKpis(replicationKpis: readonly Readonly<Record<string, number>>[]): ReplicationSummary {
  if (replicationKpis.length < 2) {
    throw new RangeError('E-REPLICACIONES-INSUFICIENTES: se requieren al menos 2 replicaciones para calcular el IC 95 %.');
  }
  const keys = Object.keys(replicationKpis[0] ?? {});
  const expected = new Set(keys);
  const kpis: Record<string, KpiSummary> = {};

  for (let index = 0; index < replicationKpis.length; index++) {
    const record = replicationKpis[index]!;
    const recordKeys = Object.keys(record);
    if (recordKeys.length !== keys.length || recordKeys.some((key) => !expected.has(key))) {
      throw new Error(`E-KPI-INCONSISTENTE: la replicación ${index} no contiene el mismo conjunto de KPI.`);
    }
    for (const key of keys) {
      if (!Number.isFinite(record[key])) {
        throw new Error(`E-KPI-NO-FINITO: la replicación ${index}, KPI ${key}, no es un número finito.`);
      }
    }
  }

  for (const key of keys) kpis[key] = summarizeKpi(replicationKpis.map((record) => record[key]!));
  return { count: replicationKpis.length, kpis };
}

/**
 * Aplana los KPI numéricos estables de un RunResult. Se excluyen `bottlenecks` (ranking),
 * `warnings` y un resumen previo. Los paths resultantes coinciden con RESULTS_FORMAT.md,
 * por ejemplo `process.cycleTime.mean` y `elements.Task_A.processing.total`.
 */
export function numericKpis(result: RunResult): Record<string, number> {
  const kpis: Record<string, number> = {};
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      kpis[path] = value;
      return;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) visit(child, path === '' ? key : `${path}.${key}`);
  };

  visit(result.elements, 'elements');
  visit(result.flows, 'flows');
  visit(result.resources, 'resources');
  visit(result.process, 'process');
  return kpis;
}

/** Compone el resumen entre resultados ya agregados por LILA-028. */
export function summarizeRunResults(results: readonly RunResult[]): ReplicationSummary {
  return summarizeKpis(results.map(numericKpis));
}
