/** CSV determinista RFC 4180 para `lila run --csv` (LILA-046). */

import type { ProcessIR } from './core/ir.js';
import type { EventLogRow, RunResult } from './core/result.js';

type CsvValue = string | number | null | undefined;

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

export function elementsCsv(ir: ProcessIR, result: RunResult): string {
  const headers = [
    'Id',
    'Name',
    'Type',
    'Instances started',
    'Instances completed',
    'Minimum time',
    'Maximum time',
    'Average time',
    'Total time',
    'Minimum time (waiting for resource)',
    'Maximum time (waiting for resource)',
    'Average time (waiting for resource)',
    'Standard deviation (waiting for resource)',
    'Total time (waiting for resource)',
    'Total fixed cost',
  ];
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
  return toCsv(headers, rows);
}

export function flowsCsv(ir: ProcessIR, result: RunResult): string {
  const headers = ['Id', 'Name', 'From', 'To', 'Instances/Tokens completed'];
  const rows = Object.entries(result.flows).map(([id, metrics]) => {
    const flow = ir.flows[id];
    return [id, flow?.name ?? '', flow?.from ?? '', flow?.to ?? '', metrics.count];
  });
  return toCsv(headers, rows);
}

export function resourcesCsv(
  result: RunResult,
  names: Readonly<Record<string, string | undefined>> = {},
): string {
  const headers = ['Id', 'Name', 'Utilization (%)', 'Busy time', 'Fixed cost', 'Unit cost', 'Total cost'];
  const rows = Object.entries(result.resources).map(([id, metrics]) => [
    id,
    names[id] ?? '',
    metrics.utilization * 100,
    metrics.busyTime,
    metrics.fixedCost,
    metrics.unitCost,
    metrics.totalCost,
  ]);
  return toCsv(headers, rows);
}

export function processCsv(result: RunResult): string {
  const headers = [
    'Instances started',
    'Instances completed',
    'In flight',
    'Cycle time minimum',
    'Cycle time maximum',
    'Cycle time average',
    'Cycle time standard deviation',
    'Cycle time p50',
    'Cycle time p90',
    'Cycle time p95',
    'Wait time minimum',
    'Wait time maximum',
    'Wait time average',
    'Wait time standard deviation',
    'Wait time p50',
    'Wait time p90',
    'Wait time p95',
    'Throughput per hour',
    'Cost per case',
    'Total cost',
  ];
  const { process } = result;
  return toCsv(headers, [
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
    ],
  ]);
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
