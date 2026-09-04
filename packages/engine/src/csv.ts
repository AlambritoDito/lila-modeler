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

const EVENT_LOG_HEADERS = [
    'replication',
    'caseId',
    'elementId',
    'resourceId',
    'enabledAt',
    'startedAt',
    'endedAt',
    'resourceWait',
    'offHoursWait',
    'cost',
  ] as const;

export function eventLogCsvHeader(): string {
  return csvRow(EVENT_LOG_HEADERS);
}

export function eventLogRowCsv(row: EventLogRow): string {
  return csvRow([
    row.replication,
    row.caseId,
    row.elementId,
    row.resourceId,
    row.enabledAt,
    row.startedAt,
    row.endedAt,
    row.resourceWait,
    row.offHoursWait,
    row.cost,
  ]);
}

export function eventLogCsv(rows: readonly EventLogRow[]): string {
  return eventLogCsvHeader() + rows.map(eventLogRowCsv).join('');
}
