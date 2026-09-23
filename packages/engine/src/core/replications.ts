/**
 * Warmup y replicaciones (LILA-027).
 *
 * Este módulo solo orquesta funciones puras de `core/`: cada replicación estrena el estado
 * de `runReplication`, cuyo índice forma parte de la semilla de cada stream (R-ARR-8,
 * R-DET-2). La conversión de una `ReplicationRun` a métricas pertenece a LILA-028; aquí se
 * ofrece la agregación estadística independiente para que `simulate` pueda componer ambas.
 */

import type { ProcessIR } from './ir.js';
import { coded, coreMessages, type Locale } from './messages/index.js';
import type { KpiSummary, ReplicationSummary, RunResult } from './result.js';
import { runReplication, type ReplicationRun, type SimScenario } from './sim.js';

/** Ejecuta todas las replicaciones desde estado vacío, en orden 0..R-1. */
export function runReplications(
  ir: ProcessIR,
  scenario: SimScenario,
  locale: Locale = 'en',
): ReplicationRun[] {
  const count = scenario.run.replications ?? 1;
  const runs: ReplicationRun[] = [];
  for (let replication = 0; replication < count; replication++) {
    runs.push(runReplication(ir, scenario, replication, { locale }));
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
export function summarizeKpi(values: readonly number[], locale: Locale = 'en'): Required<KpiSummary> {
  if (values.length < 2) {
    throw new RangeError(
      coded(
        'E-REPLICACIONES-INSUFICIENTES',
        coreMessages(locale).codes['E-REPLICACIONES-INSUFICIENTES/valores'](),
      ),
    );
  }
  let total = 0;
  for (const value of values) total += value;
  const mean = total / values.length;
  const sd = sampleSd(values, mean);
  const margin = studentT975(values.length - 1) * (sd / Math.sqrt(values.length));
  return { mean, n: values.length, sd, ci95: [mean - margin, mean + margin] };
}

/**
 * Estimador de un KPI sobre las replicaciones que lo observaron (#356, ADR-024): una observación
 * por replicación. Con dos o más, media, sd e IC de Student; con una sola, la media sin
 * dispersión; sin ninguna, `{mean: 0, n: 0}`, donde el 0 es la identidad numérica que conserva
 * el conjunto de claves, no una estimación.
 */
export function estimateKpi(values: readonly number[], locale: Locale = 'en'): KpiSummary {
  if (values.length === 0) return { mean: 0, n: 0 };
  if (values.length === 1) return { mean: values[0]!, n: 1 };
  return summarizeKpi(values, locale);
}

/**
 * Agrega mapas planos de KPI. Todos deben contener exactamente las mismas claves finitas:
 * una discrepancia suele indicar que una replicación se agregó con otro contrato.
 *
 * `excluded[i]`, si existe, son los paths que la replicación `i` no observó (`excludedPaths`):
 * su valor se valida igual que los demás, pero no entra al estimador de ese path (#356).
 */
export function summarizeKpis(
  replicationKpis: readonly Readonly<Record<string, number>>[],
  locale: Locale = 'en',
  excluded: readonly ReadonlySet<string>[] = [],
): ReplicationSummary {
  const M = coreMessages(locale).codes;
  if (replicationKpis.length < 2) {
    throw new RangeError(
      coded('E-REPLICACIONES-INSUFICIENTES', M['E-REPLICACIONES-INSUFICIENTES/replicaciones']()),
    );
  }
  const keys = Object.keys(replicationKpis[0] ?? {});
  const expected = new Set(keys);
  const kpis: Record<string, KpiSummary> = {};

  for (let index = 0; index < replicationKpis.length; index++) {
    const record = replicationKpis[index]!;
    const recordKeys = Object.keys(record);
    if (recordKeys.length !== keys.length || recordKeys.some((key) => !expected.has(key))) {
      throw new Error(coded('E-KPI-INCONSISTENTE', M['E-KPI-INCONSISTENTE'](index)));
    }
    for (const key of keys) {
      if (!Number.isFinite(record[key])) {
        throw new Error(coded('E-KPI-NO-FINITO', M['E-KPI-NO-FINITO'](index, key)));
      }
    }
  }

  for (const key of keys) kpis[key] = estimateKpi(observedValues(replicationKpis, excluded, key), locale);
  return { count: replicationKpis.length, kpis };
}

/**
 * Los valores de `path` en las replicaciones que lo observaron, en orden de replicación. Es la
 * única selección que usan el top-level de `simulate` y `replications.kpis`: por eso su media es
 * la misma (R-ARR-9).
 */
export function observedValues(
  replicationKpis: readonly Readonly<Record<string, number>>[],
  excluded: readonly ReadonlySet<string>[],
  path: string,
): number[] {
  const values: number[] = [];
  for (let index = 0; index < replicationKpis.length; index++) {
    if (excluded[index]?.has(path) === true) continue;
    values.push(replicationKpis[index]![path]!);
  }
  return values;
}

/**
 * `.` es válido en un NCName BPMN, por lo que los ids dinámicos deben escapar el separador de los
 * paths. La barra inversa no es un NameChar XML; aun así se escapa primero para que la
 * transformación siga siendo inequívoca ante una entrada no validada.
 */
export function escapeId(id: string): string {
  return id.replaceAll('\\', '\\\\').replaceAll('.', '\\.');
}

/** Las cuatro colecciones de un `RunResult` que llevan KPI numéricos. */
export type KpiShape = Pick<RunResult, 'elements' | 'flows' | 'resources' | 'process'>;

/** Recibe cada hoja numérica: su path y el objeto que la contiene, para leerla o reescribirla. */
export type KpiLeafVisitor = (path: string, holder: Record<string, unknown>, key: string) => void;

function walkLeaves(
  holder: Record<string, unknown>,
  path: string,
  visit: KpiLeafVisitor,
  skip?: string,
): void {
  for (const [key, child] of Object.entries(holder)) {
    if (key === skip) continue;
    const childPath = `${path}.${key}`;
    if (typeof child === 'number') visit(childPath, holder, key);
    else if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      walkLeaves(child as Record<string, unknown>, childPath, visit);
    }
  }
}

function walkById(values: Readonly<Record<string, unknown>>, collection: string, visit: KpiLeafVisitor): void {
  const holder = values as Record<string, unknown>;
  for (const [id, value] of Object.entries(holder)) {
    const path = `${collection}.${escapeId(id)}`;
    if (typeof value === 'number') visit(path, holder, id);
    else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      walkLeaves(value as Record<string, unknown>, path, visit);
    }
  }
}

/**
 * Generador único de los paths de KPI (#356): recorre cada hoja numérica en el orden de
 * RESULTS_FORMAT.md § 8 (elementos, flujos, recursos, proceso y sus desenlaces). `numericKpis`
 * lee con él y el top-level multi-réplica de `simulate` escribe con él, así que los dos no
 * pueden nombrar ni ordenar los KPI de forma distinta.
 */
export function forEachKpiLeaf(result: KpiShape, visit: KpiLeafVisitor): void {
  walkById(result.elements, 'elements', visit);
  walkById(result.flows, 'flows', visit);
  walkById(result.resources, 'resources', visit);
  // `process.byEndEvent` lleva ids BPMN por clave y por eso se recorre con `walkById`, igual
  // que las otras colecciones; el resto de `process` son claves fijas del contrato (#316).
  walkLeaves(result.process as unknown as Record<string, unknown>, 'process', visit, 'byEndEvent');
  walkById(result.process.byEndEvent ?? {}, 'process.byEndEvent', visit);
}

/**
 * Aplana los KPI numéricos estables de un RunResult. Se excluyen `bottlenecks` (ranking),
 * `warnings` y un resumen previo. Los paths resultantes coinciden con RESULTS_FORMAT.md,
 * por ejemplo `process.cycleTime.mean` y `elements.Task_A.processing.total`.
 */
export function numericKpis(result: KpiShape): Record<string, number> {
  const kpis: Record<string, number> = {};
  forEachKpiLeaf(result, (path, holder, key) => {
    kpis[path] = holder[key] as number;
  });
  return kpis;
}

const PERCENTILE_KEYS = ['min', 'max', 'mean', 'p50', 'p90', 'p95'] as const;
const STAT_KEYS = ['min', 'max', 'mean'] as const;

/**
 * Paths condicionales que esta replicación **no** observó (#356, RESULTS_FORMAT.md § 8). Un
 * estadístico de duración sin ninguna observación vale 0 por identidad del conjunto vacío, y una
 * `sd` con una sola observación vale 0 porque no hay dispersión que medir: ninguno de los dos es
 * una observación del KPI y no entra a su estimador.
 *
 * - `elements.X.{processing,resourceWait,offHoursWait}.{min,max,mean}`: solo en `task` y `timer`
 *   no adjunto con `completed = 0`. Gateways, start, end, terminate y bordes cuentan `completed`
 *   pero nunca producen duraciones: sus ceros son exactos y el path es incondicional.
 * - `resourceWait.sd` y `offHoursWait.sd` de esos nodos, con `completed < 2`.
 * - `process.{cycleTime,waitTime}.*`, `costPerCase` y `withinServiceLevel` con
 *   `process.completed = 0`; las dos `sd` con `process.completed < 2`. Igual por desenlace de
 *   `process.byEndEvent`, con su propio `completed`.
 */
export function excludedPaths(result: KpiShape, ir: ProcessIR): Set<string> {
  const excluded = new Set<string>();
  for (const [nodeId, node] of Object.entries(ir.nodes)) {
    const observable = node.type === 'task' || (node.type === 'timer' && node.attachedTo === undefined);
    const metrics = result.elements[nodeId];
    if (!observable || metrics === undefined) continue;
    const prefix = `elements.${escapeId(nodeId)}`;
    if (metrics.completed === 0) {
      for (const stat of ['processing', 'resourceWait', 'offHoursWait']) {
        for (const key of STAT_KEYS) excluded.add(`${prefix}.${stat}.${key}`);
      }
    }
    if (metrics.completed < 2) {
      excluded.add(`${prefix}.resourceWait.sd`);
      excluded.add(`${prefix}.offHoursWait.sd`);
    }
  }

  const excludeCases = (
    prefix: string,
    completed: number,
    extra: readonly string[],
  ): void => {
    if (completed === 0) {
      for (const stat of ['cycleTime', 'waitTime']) {
        for (const key of PERCENTILE_KEYS) excluded.add(`${prefix}.${stat}.${key}`);
      }
      for (const key of extra) excluded.add(`${prefix}.${key}`);
    }
    if (completed < 2) {
      excluded.add(`${prefix}.cycleTime.sd`);
      excluded.add(`${prefix}.waitTime.sd`);
    }
  };
  const cases = result.process;
  excludeCases('process', cases.completed, [
    'costPerCase',
    ...(cases.withinServiceLevel === undefined ? [] : ['withinServiceLevel']),
  ]);
  for (const [endId, outcome] of Object.entries(cases.byEndEvent ?? {})) {
    excludeCases(
      `process.byEndEvent.${escapeId(endId)}`,
      outcome.completed,
      outcome.withinServiceLevel === undefined ? [] : ['withinServiceLevel'],
    );
  }
  return excluded;
}
