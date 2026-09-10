/** CSV determinista RFC 4180 para `lila run --csv` (LILA-046). */

import type { ProcessIR } from './core/ir.js';
import type { EventLogRow, RunResult } from './core/result.js';
import { columnLabel, type ResultScope } from './format.js';

export type CsvValue = string | number | null | undefined;

function cell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values: readonly CsvValue[]): string {
  return `${values.map(cell).join(',')}\r\n`;
}

/** Serializa con comas, comillas dobles escapadas y CRLF, incluida la última fila. */
export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  return csvRow(headers) + rows.map(csvRow).join('');
}

/**
 * Métricas de cada tabla, en orden de columna. Los nombres salen del mapa único de `format.ts`
 * (docs/RESULTS_FORMAT.md § 10) y aquí van desnudos: el CSV siempre lleva segundos (§ 1), así que
 * ninguna columna de duración arrastra sufijo de unidad. La CLI y la web sí lo añaden con
 * `columnHeader`, porque convierten a `baseTimeUnit`.
 */
export const ELEMENT_COLUMNS = [
  'started',
  'completed',
  'processing.min',
  'processing.max',
  'processing.mean',
  'processing.total',
  'resourceWait.min',
  'resourceWait.max',
  'resourceWait.mean',
  'resourceWait.sd',
  'resourceWait.total',
  'fixedCostTotal',
] as const;

export const RESOURCE_COLUMNS = ['utilization', 'busyTime', 'fixedCost', 'unitCost', 'totalCost'] as const;

export const PROCESS_COLUMNS = [
  'started',
  'completed',
  'inFlight',
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
  'throughputPerHour',
  'costPerCase',
  'totalCost',
  // #316, añadidas al final: ningún consumidor v1 pierde su columna ni cambia de índice.
  // `withinServiceLevel` queda vacía sin `run.serviceLevel`; `outcome` está vacía en la fila
  // global y lleva el id del `end`/`terminate` en las filas por desenlace.
  'withinServiceLevel',
  'outcome',
] as const;

function labels(scope: ResultScope, metrics: readonly string[]): string[] {
  return metrics.map((metric) => columnLabel(scope, metric));
}

/**
 * Una tabla de resultados antes de serializarse: los mismos encabezados y las mismas filas que
 * escribe el CSV, sin escapado ni CRLF.
 *
 * Existe para que el CSV (`toCsv`) y el XLSX (`src/xlsx-report.ts`, issue #80) consuman **la misma**
 * construcción de filas: si el exportador de hoja de cálculo volviera a leer `RunResult` por su
 * cuenta, las dos salidas divergirían en cuanto cambiara una columna. Los constructores son puros
 * y no dependen de `node:*`, así que la web los usa igual.
 */
export interface ResultTable {
  headers: readonly string[];
  rows: readonly (readonly CsvValue[])[];
}

export function elementsRows(ir: ProcessIR, result: RunResult): ResultTable {
  const headers = ['Id', 'Name', 'Type', ...labels('elements', ELEMENT_COLUMNS)];
  const rows = Object.entries(result.elements).map(([id, metrics]) => {
    const node = ir.nodes[id];
    return [
      id,
      node?.name ?? '',
      node?.type ?? '',
      metrics.started,
      metrics.completed,
      metrics.processing.min,
      metrics.processing.max,
      metrics.processing.mean,
      metrics.processing.total,
      metrics.resourceWait.min,
      metrics.resourceWait.max,
      metrics.resourceWait.mean,
      metrics.resourceWait.sd,
      metrics.resourceWait.total,
      metrics.fixedCostTotal,
    ];
  });
  return { headers, rows };
}

export function flowsRows(ir: ProcessIR, result: RunResult): ResultTable {
  const headers = ['Id', 'Name', 'From', 'To', columnLabel('flows', 'count')];
  const rows = Object.entries(result.flows).map(([id, metrics]) => {
    const flow = ir.flows[id];
    return [id, flow?.name ?? '', flow?.from ?? '', flow?.to ?? '', metrics.count];
  });
  return { headers, rows };
}

export function resourcesRows(
  result: RunResult,
  names: Readonly<Record<string, string | undefined>> = {},
): ResultTable {
  const headers = ['Id', 'Name', ...labels('resources', RESOURCE_COLUMNS)];
  const rows = Object.entries(result.resources).map(([id, metrics]) => [
    id,
    names[id] ?? '',
    metrics.utilization * 100,
    metrics.busyTime,
    metrics.fixedCost,
    metrics.unitCost,
    metrics.totalCost,
  ]);
  return { headers, rows };
}

export function processRows(result: RunResult): ResultTable {
  const headers = labels('process', PROCESS_COLUMNS);
  const { process } = result;
  const rows: CsvValue[][] = [
    [
      process.started,
      process.completed,
      process.inFlight,
      process.cycleTime.min,
      process.cycleTime.max,
      process.cycleTime.mean,
      process.cycleTime.sd,
      process.cycleTime.p50,
      process.cycleTime.p90,
      process.cycleTime.p95,
      process.waitTime.min,
      process.waitTime.max,
      process.waitTime.mean,
      process.waitTime.sd,
      process.waitTime.p50,
      process.waitTime.p90,
      process.waitTime.p95,
      process.throughputPerHour,
      process.costPerCase,
      process.totalCost,
      process.withinServiceLevel ?? null,
      null,
    ],
  ];
  for (const [endId, outcome] of Object.entries(process.byEndEvent ?? {})) {
    rows.push([
      null,
      outcome.completed,
      null,
      outcome.cycleTime.min,
      outcome.cycleTime.max,
      outcome.cycleTime.mean,
      outcome.cycleTime.sd,
      outcome.cycleTime.p50,
      outcome.cycleTime.p90,
      outcome.cycleTime.p95,
      outcome.waitTime.min,
      outcome.waitTime.max,
      outcome.waitTime.mean,
      outcome.waitTime.sd,
      outcome.waitTime.p50,
      outcome.waitTime.p90,
      outcome.waitTime.p95,
      null,
      null,
      null,
      outcome.withinServiceLevel ?? null,
      endId,
    ]);
  }
  return { headers, rows };
}

/** Serializa una `ResultTable`; el CSV y el XLSX salen de la misma. */
function tableCsv(table: ResultTable): string {
  return toCsv(table.headers, table.rows);
}

export function elementsCsv(ir: ProcessIR, result: RunResult): string {
  return tableCsv(elementsRows(ir, result));
}

export function flowsCsv(ir: ProcessIR, result: RunResult): string {
  return tableCsv(flowsRows(ir, result));
}

export function resourcesCsv(
  result: RunResult,
  names: Readonly<Record<string, string | undefined>> = {},
): string {
  return tableCsv(resourcesRows(result, names));
}

/**
 * Proceso (§ 5). La primera fila es el total de la corrida; detrás va una fila por desenlace
 * (`process.byEndEvent`, #316) con el id en la columna `Outcome` y vacías las columnas que solo
 * tienen sentido para el total (`started`, `inFlight`, rendimiento y costos).
 */
export function processCsv(result: RunResult): string {
  return tableCsv(processRows(result));
}

/**
 * Event log (docs/RESULTS_FORMAT.md § 7). Las 17 columnas en bruto conservan el contrato de
 * ADR-025 completo — una fila por asignación de pool, agrupadas por `activityInstanceId` — con
 * los tiempos en segundos relativos a `run.start`, que es lo que consume el procesamiento
 * programático. Reducir este conjunto rompería a los consumidores v1.
 */
const EVENT_LOG_HEADERS = [
  'replication',
  'caseId',
  'activityInstanceId',
  'elementId',
  'resourceId',
  'allocationIndex',
  'resourceQuantity',
  'status',
  'enabledAt',
  'startedAt',
  'endedAt',
  'observedUntil',
  'resourceWait',
  'offHoursWait',
  'elementCost',
  'resourceCost',
  'cost',
] as const;

/** Columnas derivadas que solo existen cuando el exportador conoce `run.start` (LILA-037). */
const EVENT_LOG_ISO_HEADERS = ['enabledAtIso', 'startedAtIso', 'endedAtIso'] as const;

/** Milisegundos epoch de `run.start`; `NaN` si la cadena no es una fecha válida. */
export function runStartMs(start: string): number {
  // `Date.parse` sobre el ISO 8601 con offset que valida el esquema del escenario es
  // determinista y no lee el reloj: R-DET-5 prohíbe la hora real, no aritmética de fechas.
  return Date.parse(start);
}

/** Instante absoluto de una columna de tiempo: `run.start + segundos`, en ISO 8601 UTC. */
function isoAt(startMs: number, seconds: number | null): string {
  if (seconds === null) return '';
  const ms = Math.round(startMs + seconds * 1000);
  // ponytail: fuera del rango representable por Date (o con un `run.start` ilegible) la celda
  // queda vacía en vez de lanzar a mitad de un CSV de millones de filas; las columnas en
  // segundos siguen siendo las autoritativas y conservan el valor exacto.
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return '';
  return new Date(ms).toISOString();
}

/**
 * Cabecera del event log. Con `startMs` (ver `runStartMs`) añade las tres columnas ISO 8601;
 * sin él, el CSV conserva solo los segundos relativos.
 */
export function eventLogCsvHeader(startMs?: number): string {
  return csvRow(
    startMs === undefined ? EVENT_LOG_HEADERS : [...EVENT_LOG_HEADERS, ...EVENT_LOG_ISO_HEADERS],
  );
}

/** Serializa una fila; se llama una vez por fila para poder escribir en streaming. */
export function eventLogRowCsv(row: EventLogRow, startMs?: number): string {
  const values: CsvValue[] = [
    row.replication,
    row.caseId,
    row.activityInstanceId,
    row.elementId,
    row.resourceId,
    row.allocationIndex,
    row.resourceQuantity,
    row.status,
    row.enabledAt,
    row.startedAt,
    row.endedAt,
    row.observedUntil,
    row.resourceWait,
    row.offHoursWait,
    row.elementCost,
    row.resourceCost,
    row.cost,
  ];
  if (startMs !== undefined) {
    values.push(isoAt(startMs, row.enabledAt), isoAt(startMs, row.startedAt), isoAt(startMs, row.endedAt));
  }
  return csvRow(values);
}

/** Event log completo en memoria. La CLI usa header + fila a fila para no materializarlo. */
export function eventLogCsv(rows: readonly EventLogRow[], startMs?: number): string {
  return eventLogCsvHeader(startMs) + rows.map((row) => eventLogRowCsv(row, startMs)).join('');
}
