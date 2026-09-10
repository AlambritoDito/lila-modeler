/** Presentación de tiempos y tablas de la CLI; los valores internos siempre siguen en segundos. */

export type BaseTimeUnit = 's' | 'min' | 'h' | 'day';

const SECONDS_PER_UNIT: Readonly<Record<BaseTimeUnit, number>> = {
  s: 1,
  min: 60,
  h: 3_600,
  day: 86_400,
};

/** Conversión solo de presentación (R-DURA-2); no se usa dentro de `simulate`. */
export function formatDuration(seconds: number, unit: BaseTimeUnit): string {
  return formatNumber(seconds / SECONDS_PER_UNIT[unit]);
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Fracción como porcentaje con signo explícito, para las columnas de delta de `lila compare`.
 * El signo sale del texto ya redondeado y no del valor crudo: una diferencia de −1e−11 redondea a
 * cero y se imprime `0%`, nunca `-0%` (ni `+0%`, que afirmaría un aumento inexistente).
 */
export function formatSignedPercent(fraction: number): string {
  const text = formatNumber(fraction * 100);
  if (text === '0') return '0%';
  return `${text.startsWith('-') ? '' : '+'}${text}%`;
}

/** Tabla monoespaciada estable sin dependencia de terminal ni locale. */
export function formatTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, column) => {
    let width = header.length;
    for (const row of rows) width = Math.max(width, row[column]?.length ?? 0);
    return width;
  });
  const line = (row: readonly string[]): string =>
    row.map((value, column) => value.padEnd(widths[column] ?? value.length)).join('  ').trimEnd();
  return [line(headers), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(line)].join('\n');
}

/* ------------------------------------------------------------------ *
 * Nombres de columna de resultados (docs/RESULTS_FORMAT.md § 10)
 * ------------------------------------------------------------------ */

export type ResultScope = 'elements' | 'flows' | 'resources' | 'process';

/**
 * Único mapa de nombres de columna del proyecto (LILA-201): lo consumen la CLI (`lila run`,
 * `lila compare`), los CSV de `csv.ts` y la vista de resultados de la web. La clave es
 * `${ámbito}:${ruta de la métrica dentro de RunResult}`, la misma que usa `compare()` para
 * partir un KPI en `scope`/`metric`.
 *
 * Una métrica ausente conserva su ruta interna: las que Bizagi no tiene y §10 no bautiza
 * (`queueLength.mean`, `offHoursWait.*`) no se renombran a ojo.
 */
export const COLUMN_LABELS: Readonly<Record<string, string>> = {
  'elements:started': 'Instances started',
  'elements:completed': 'Instances completed',
  'elements:processing.min': 'Minimum time',
  'elements:processing.max': 'Maximum time',
  'elements:processing.mean': 'Average time',
  'elements:processing.total': 'Total time',
  'elements:resourceWait.min': 'Minimum time (waiting for resource)',
  'elements:resourceWait.max': 'Maximum time (waiting for resource)',
  'elements:resourceWait.mean': 'Average time (waiting for resource)',
  'elements:resourceWait.sd': 'Standard deviation (waiting for resource)',
  'elements:resourceWait.total': 'Total time (waiting for resource)',
  'elements:fixedCostTotal': 'Total fixed cost',
  'flows:count': 'Instances/Tokens completed',
  'resources:utilization': 'Utilization (%)',
  'resources:busyTime': 'Busy time',
  'resources:fixedCost': 'Fixed cost',
  'resources:unitCost': 'Unit cost',
  'resources:totalCost': 'Total cost',
  'process:started': 'Instances started',
  'process:completed': 'Instances completed',
  'process:inFlight': 'In flight',
  'process:cycleTime.min': 'Cycle time minimum',
  'process:cycleTime.max': 'Cycle time maximum',
  'process:cycleTime.mean': 'Cycle time average',
  'process:cycleTime.sd': 'Cycle time standard deviation',
  'process:cycleTime.p50': 'Cycle time p50',
  'process:cycleTime.p90': 'Cycle time p90',
  'process:cycleTime.p95': 'Cycle time p95',
  'process:waitTime.min': 'Wait time minimum',
  'process:waitTime.max': 'Wait time maximum',
  'process:waitTime.mean': 'Wait time average',
  'process:waitTime.sd': 'Wait time standard deviation',
  'process:waitTime.p50': 'Wait time p50',
  'process:waitTime.p90': 'Wait time p90',
  'process:waitTime.p95': 'Wait time p95',
  'process:throughputPerHour': 'Throughput per hour',
  'process:costPerCase': 'Cost per case',
  'process:totalCost': 'Total cost',
  'process:withinServiceLevel': 'Within service level',
  'process:outcome': 'Outcome',
};

/** Prefijo de las métricas por desenlace dentro de `process` (#316). */
const OUTCOME_PREFIX = 'byEndEvent.';

/**
 * Métricas que existen por desenlace, en orden de columna (`process.byEndEvent[id]`, § 5). El
 * orden imita el de `PROCESS_COLUMNS`: conteo, ciclo, espera.
 */
export const OUTCOME_METRICS = [
  'completed',
  'cycleTime.min',
  'cycleTime.max',
  'cycleTime.mean',
  'cycleTime.sd',
  'cycleTime.p50',
  'cycleTime.p90',
  'cycleTime.p95',
  'waitTime.min',
  'waitTime.max',
  'waitTime.mean',
  'waitTime.sd',
  'waitTime.p50',
  'waitTime.p90',
  'waitTime.p95',
  'withinServiceLevel',
] as const;

/**
 * Parte `byEndEvent.<id>.<métrica>` en sus dos mitades. El id BPMN puede contener puntos, así
 * que la métrica se reconoce por el sufijo conocido y no partiendo por el primer punto.
 * Devuelve `null` cuando el path no es de un desenlace.
 */
export function splitOutcomeMetric(metric: string): { endId: string; metric: string } | null {
  if (!metric.startsWith(OUTCOME_PREFIX)) return null;
  const rest = metric.slice(OUTCOME_PREFIX.length);
  for (const candidate of OUTCOME_METRICS) {
    if (rest.endsWith(`.${candidate}`)) {
      return { endId: rest.slice(0, -candidate.length - 1), metric: candidate };
    }
  }
  return null;
}

/** Nombre desnudo de la columna, sin unidad: el que llevan los CSV (siempre en segundos). */
export function columnLabel(scope: ResultScope, metric: string): string {
  const direct = COLUMN_LABELS[`${scope}:${metric}`];
  if (direct !== undefined) return direct;
  // Las métricas por desenlace llevan el id delante y el nombre de la métrica de proceso detrás.
  const outcome = scope === 'process' ? splitOutcomeMetric(metric) : null;
  if (outcome !== null) return `${outcome.endId}: ${columnLabel(scope, outcome.metric)}`;
  return metric;
}

/**
 * Métricas cuyo valor son segundos y por tanto se convierten a `baseTimeUnit` al imprimir
 * (R-DURA-2). `busyTime` son segundos-unidad (§ 4) y también se convierte: dejar la única
 * duración de la tabla de recursos en segundos crudos, junto a costos derivados de ella ya
 * convertidos, la hacía ilegible.
 */
const DURATION_METRIC_PREFIXES: ReadonlySet<string> = new Set([
  'processing',
  'resourceWait',
  'offHoursWait',
  'cycleTime',
  'waitTime',
  'busyTime',
]);

/**
 * `byEndEvent.<id>.cycleTime.mean` también es una duración: el segmento que decide puede no ser
 * el primero, así que se mira cualquiera de ellos (#316). Para las métricas de siempre —cuyos
 * ids nunca viajan dentro del path— el resultado es idéntico al de mirar solo el primero.
 */
export function isDurationMetric(metric: string): boolean {
  return metric.split('.').some((segment) => DURATION_METRIC_PREFIXES.has(segment));
}

/**
 * Nombre de columna para las superficies que convierten a `baseTimeUnit` (CLI y web): el mismo
 * de `columnLabel` con el sufijo ` (unidad)` en las columnas que son duraciones.
 */
export function columnHeader(scope: ResultScope, metric: string, unit: BaseTimeUnit): string {
  const label = columnLabel(scope, metric);
  return isDurationMetric(metric) ? `${label} (${unit})` : label;
}
