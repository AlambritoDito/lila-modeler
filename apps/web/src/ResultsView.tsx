/**
 * Vista de resultados (LILA-062): tablas Elementos / Recursos / Proceso con las columnas y el
 * formato numérico de Bizagi (docs/RESULTS_FORMAT.md §10), tabla de Flujos, tarjeta de cuellos
 * de botella (orden ya decidido por `result.bottlenecks`, sección 6) y exportación a CSV
 * byte a byte igual a `lila run --csv` (reutiliza `elementsCsv`/`flowsCsv`/`resourcesCsv`/
 * `processCsv` de `@lila/engine/csv`, nunca reimplementadas aquí).
 *
 * Tablas HTML planas, sin librería de grid ni gráficas (BACKLOG.md LILA-062): ordenar por
 * columna y encabezado fijo se resuelven con `useState` + `position: sticky`.
 *
 * Cableado al shell de LILA-057 (pendiente de mezclar): el orquestador monta
 * `<ResultsView ir={ir} scenario={scenarioResuelto} result={runResult} />` donde hoy exista la
 * pestaña "Resultados" del `main.tsx` real, pasando el `ProcessIR` ya parseado y el
 * `ResolvedScenario` activo (los mismos que ya usa `runInWorker`, ver `simulationClient.ts`).
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  elementsCsv,
  flowsCsv,
  processCsv,
  resourcesCsv,
} from '@lila/engine/csv';
import { formatDuration, formatNumber, type BaseTimeUnit } from '@lila/engine/format';
import type { ResolvedScenario } from '@lila/engine/schema';
import type {
  BottleneckEntry,
  ElementMetrics,
  FlowMetrics,
  ProcessIR,
  ResourceMetrics,
  RunResult,
} from '@lila/engine';

export interface ResultsViewProps {
  ir: ProcessIR;
  scenario: ResolvedScenario;
  result: RunResult;
}

/* ------------------------------------------------------------------ *
 * Tabla genérica: ordenable por columna, sin librería de grid.
 * ------------------------------------------------------------------ */

type SortDir = 'asc' | 'desc';

interface SortState {
  key: string;
  dir: SortDir;
}

export interface ColumnDef<Row> {
  key: string;
  header: string;
  /** Valor comparable para ordenar; `numeric` decide si se compara como número. */
  sortValue: (row: Row) => number | string;
  display: (row: Row) => string;
  numeric?: boolean;
}

/** Pura y exportada para probar el orden sin simular clics en el DOM (no hay jsdom aquí). */
export function sortRows<Row>(
  rows: readonly Row[],
  columns: readonly ColumnDef<Row>[],
  sort: SortState | null,
): Row[] {
  if (sort === null) return [...rows];
  const column = columns.find((c) => c.key === sort.key);
  if (column === undefined) return [...rows];
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = column.sortValue(a);
    const bv = column.sortValue(b);
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    return 0;
  });
}

const sectionStyle: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  marginBottom: 16,
  padding: 12,
};

const titleRowStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: 8,
};

const h2Style: CSSProperties = { color: 'var(--fg-primary)', fontSize: 14, margin: 0 };

const exportButtonStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-strong)',
  borderRadius: 4,
  color: 'var(--fg-primary)',
  cursor: 'pointer',
  font: 'inherit',
  padding: '4px 10px',
};

const tableWrapStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 6,
  maxHeight: 420,
  overflow: 'auto',
};

const tableStyle: CSSProperties = {
  borderCollapse: 'collapse',
  fontVariantNumeric: 'tabular-nums',
  width: '100%',
};

const thStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  padding: '4px 8px',
  position: 'sticky',
  textAlign: 'left',
  top: 0,
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

const tdStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  color: 'var(--fg-primary)',
  padding: '3px 8px',
  whiteSpace: 'nowrap',
};

function sortIndicator(sort: SortState | null, key: string): string {
  if (sort === null || sort.key !== key) return '';
  return sort.dir === 'asc' ? ' ▲' : ' ▼';
}

/** Descarga `contents` como si el navegador hubiera guardado el archivo del enlace. */
function downloadCsv(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface DataTableProps<Row> {
  title: string;
  columns: readonly ColumnDef<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  csvFilename: string;
  csvContents: string;
}

function DataTable<Row>({ title, columns, rows, rowKey, csvFilename, csvContents }: DataTableProps<Row>): ReactNode {
  const [sort, setSort] = useState<SortState | null>(null);
  const sorted = sortRows(rows, columns, sort);

  function toggle(key: string): void {
    setSort((current) => {
      if (current === null || current.key !== key) return { dir: 'asc', key };
      if (current.dir === 'asc') return { dir: 'desc', key };
      return null;
    });
  }

  return (
    <section style={sectionStyle}>
      <div style={titleRowStyle}>
        <h2 style={h2Style}>{title}</h2>
        <button
          type="button"
          style={exportButtonStyle}
          onClick={() => downloadCsv(csvFilename, csvContents)}
        >
          Exportar CSV
        </button>
      </div>
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} style={thStyle} onClick={() => toggle(column.key)}>
                  {column.header}
                  {sortIndicator(sort, column.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    style={{ ...tdStyle, textAlign: column.numeric === true ? 'right' : 'left' }}
                  >
                    {column.display(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Filas por tabla (docs/RESULTS_FORMAT.md §2-§5, §10)
 * ------------------------------------------------------------------ */

interface ElementRow {
  id: string;
  name: string;
  type: string;
  metrics: ElementMetrics;
}

interface FlowRow {
  id: string;
  name: string;
  from: string;
  to: string;
  metrics: FlowMetrics;
}

interface ResourceRow {
  id: string;
  name: string;
  metrics: ResourceMetrics;
}

function elementRows(ir: ProcessIR, result: RunResult): ElementRow[] {
  return Object.entries(result.elements).map(([id, metrics]) => ({
    id,
    metrics,
    name: ir.nodes[id]?.name ?? '',
    type: ir.nodes[id]?.type ?? '',
  }));
}

function flowRows(ir: ProcessIR, result: RunResult): FlowRow[] {
  return Object.entries(result.flows).map(([id, metrics]) => ({
    from: ir.flows[id]?.from ?? '',
    id,
    metrics,
    name: ir.flows[id]?.name ?? '',
    to: ir.flows[id]?.to ?? '',
  }));
}

function resourceNames(scenario: ResolvedScenario): Record<string, string> {
  return Object.fromEntries(
    Object.entries(scenario.resources ?? {}).map(([id, resource]) => [id, resource.name ?? id]),
  );
}

function resourceRows(result: RunResult, names: Readonly<Record<string, string>>): ResourceRow[] {
  return Object.entries(result.resources).map(([id, metrics]) => ({
    id,
    metrics,
    name: names[id] ?? id,
  }));
}

/** Columnas Id/Name comunes a Elementos, Flujos y Recursos (docs/RESULTS_FORMAT.md §10). */
function idNameColumns<Row extends { id: string; name: string }>(): ColumnDef<Row>[] {
  return [
    { display: (row) => row.id, header: 'Id', key: 'id', sortValue: (row) => row.id },
    { display: (row) => row.name, header: 'Name', key: 'name', sortValue: (row) => row.name },
  ];
}

function numberColumn<Row>(key: string, header: string, get: (row: Row) => number): ColumnDef<Row> {
  return { display: (row) => formatNumber(get(row)), header, key, numeric: true, sortValue: get };
}

function durationColumn<Row>(
  key: string,
  header: string,
  unit: BaseTimeUnit,
  get: (row: Row) => number,
): ColumnDef<Row> {
  return {
    display: (row) => formatDuration(get(row), unit),
    header: `${header} (${unit})`,
    key,
    numeric: true,
    sortValue: get,
  };
}

/** docs/RESULTS_FORMAT.md §10, tabla "Process elements": mismas columnas y orden que `elementsCsv`. */
function elementColumns(unit: BaseTimeUnit, costLabel: string): ColumnDef<ElementRow>[] {
  return [
    ...idNameColumns<ElementRow>(),
    { display: (row) => row.type, header: 'Type', key: 'type', sortValue: (row) => row.type },
    numberColumn('started', 'Instances started', (row) => row.metrics.started),
    numberColumn('completed', 'Instances completed', (row) => row.metrics.completed),
    durationColumn('processing.min', 'Minimum time', unit, (row) => row.metrics.processing.min),
    durationColumn('processing.max', 'Maximum time', unit, (row) => row.metrics.processing.max),
    durationColumn('processing.mean', 'Average time', unit, (row) => row.metrics.processing.mean),
    durationColumn('processing.total', 'Total time', unit, (row) => row.metrics.processing.total),
    durationColumn(
      'resourceWait.min',
      'Minimum time (waiting for resource)',
      unit,
      (row) => row.metrics.resourceWait.min,
    ),
    durationColumn(
      'resourceWait.max',
      'Maximum time (waiting for resource)',
      unit,
      (row) => row.metrics.resourceWait.max,
    ),
    durationColumn(
      'resourceWait.mean',
      'Average time (waiting for resource)',
      unit,
      (row) => row.metrics.resourceWait.mean,
    ),
    durationColumn(
      'resourceWait.sd',
      'Standard deviation (waiting for resource)',
      unit,
      (row) => row.metrics.resourceWait.sd,
    ),
    durationColumn(
      'resourceWait.total',
      'Total time (waiting for resource)',
      unit,
      (row) => row.metrics.resourceWait.total,
    ),
    numberColumn('fixedCostTotal', `Total fixed cost${costLabel}`, (row) => row.metrics.fixedCostTotal),
  ];
}

/** docs/RESULTS_FORMAT.md §10, tabla "Sequence flows": mismas columnas que `flowsCsv`. */
function flowColumns(): ColumnDef<FlowRow>[] {
  return [
    ...idNameColumns<FlowRow>(),
    { display: (row) => row.from, header: 'From', key: 'from', sortValue: (row) => row.from },
    { display: (row) => row.to, header: 'To', key: 'to', sortValue: (row) => row.to },
    numberColumn('count', 'Instances/Tokens completed', (row) => row.metrics.count),
  ];
}

/** docs/RESULTS_FORMAT.md §10, tabla "Resources": mismas columnas que `resourcesCsv`. */
function resourceColumns(unit: BaseTimeUnit, costLabel: string): ColumnDef<ResourceRow>[] {
  return [
    ...idNameColumns<ResourceRow>(),
    numberColumn('utilization', 'Utilization (%)', (row) => row.metrics.utilization * 100),
    durationColumn('busyTime', 'Busy time', unit, (row) => row.metrics.busyTime),
    numberColumn('fixedCost', `Fixed cost${costLabel}`, (row) => row.metrics.fixedCost),
    numberColumn('unitCost', `Unit cost${costLabel}`, (row) => row.metrics.unitCost),
    numberColumn('totalCost', `Total cost${costLabel}`, (row) => row.metrics.totalCost),
  ];
}

/**
 * Tabla "Proceso": una sola fila (docs/RESULTS_FORMAT.md §5), mismas columnas y orden que
 * `processCsv` — incluidos los extras que Bizagi no ofrece (percentiles, throughput, costo por
 * caso, ver §10).
 */
function processColumns(unit: BaseTimeUnit, costLabel: string): ColumnDef<RunResult>[] {
  const p = (get: (r: RunResult) => number) => get;
  return [
    numberColumn('started', 'Instances started', (r) => r.process.started),
    numberColumn('completed', 'Instances completed', (r) => r.process.completed),
    numberColumn('inFlight', 'In flight', (r) => r.process.inFlight),
    durationColumn('cycleTime.min', 'Cycle time minimum', unit, p((r) => r.process.cycleTime.min)),
    durationColumn('cycleTime.max', 'Cycle time maximum', unit, p((r) => r.process.cycleTime.max)),
    durationColumn('cycleTime.mean', 'Cycle time average', unit, p((r) => r.process.cycleTime.mean)),
    durationColumn('cycleTime.sd', 'Cycle time standard deviation', unit, p((r) => r.process.cycleTime.sd)),
    durationColumn('cycleTime.p50', 'Cycle time p50', unit, p((r) => r.process.cycleTime.p50)),
    durationColumn('cycleTime.p90', 'Cycle time p90', unit, p((r) => r.process.cycleTime.p90)),
    durationColumn('cycleTime.p95', 'Cycle time p95', unit, p((r) => r.process.cycleTime.p95)),
    durationColumn('waitTime.min', 'Wait time minimum', unit, p((r) => r.process.waitTime.min)),
    durationColumn('waitTime.max', 'Wait time maximum', unit, p((r) => r.process.waitTime.max)),
    durationColumn('waitTime.mean', 'Wait time average', unit, p((r) => r.process.waitTime.mean)),
    durationColumn('waitTime.sd', 'Wait time standard deviation', unit, p((r) => r.process.waitTime.sd)),
    durationColumn('waitTime.p50', 'Wait time p50', unit, p((r) => r.process.waitTime.p50)),
    durationColumn('waitTime.p90', 'Wait time p90', unit, p((r) => r.process.waitTime.p90)),
    durationColumn('waitTime.p95', 'Wait time p95', unit, p((r) => r.process.waitTime.p95)),
    numberColumn('throughputPerHour', 'Throughput per hour', (r) => r.process.throughputPerHour),
    numberColumn('costPerCase', `Cost per case${costLabel}`, (r) => r.process.costPerCase),
    numberColumn('totalCost', `Total cost${costLabel}`, (r) => r.process.totalCost),
  ];
}

/* ------------------------------------------------------------------ *
 * Tarjeta de cuellos de botella (docs/RESULTS_FORMAT.md §6): el orden ya lo decide el motor,
 * este componente solo lo pinta tal cual llega en `result.bottlenecks`.
 * ------------------------------------------------------------------ */

function BottleneckCard({
  bottlenecks,
  ir,
  unit,
}: {
  bottlenecks: readonly BottleneckEntry[];
  ir: ProcessIR;
  unit: BaseTimeUnit;
}): ReactNode {
  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>Cuellos de botella</h2>
      {bottlenecks.length === 0 ? (
        <p style={{ color: 'var(--fg-muted)' }}>Sin espera por recurso detectada.</p>
      ) : (
        <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          {bottlenecks.map((entry) => (
            <li key={entry.elementId} style={{ color: 'var(--fg-primary)', marginBottom: 4 }}>
              <strong>{ir.nodes[entry.elementId]?.name ?? entry.elementId}</strong>
              {' — espera total '}
              {formatDuration(entry.resourceWaitTotal, unit)} {unit}
              {', utilización '}
              {formatNumber(entry.utilization * 100)}%
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Componente principal
 * ------------------------------------------------------------------ */

const TABS = ['elements', 'resources', 'process', 'flows'] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Readonly<Record<Tab, string>> = {
  elements: 'Elementos del proceso',
  flows: 'Flujos',
  process: 'Proceso',
  resources: 'Recursos',
};

const tabBarStyle: CSSProperties = { display: 'flex', gap: 4, marginBottom: 12 };

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? 'var(--accent-tertiary)' : 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    borderRadius: 4,
    color: active ? 'var(--fg-onAccent)' : 'var(--fg-primary)',
    cursor: 'pointer',
    font: 'inherit',
    fontWeight: active ? 600 : 400,
    padding: '6px 12px',
  };
}

/** `run.currency` es opcional (docs/RESULTS_FORMAT.md §1): sin él, las columnas de costo no llevan sufijo. */
function costLabel(currency: string | undefined): string {
  return currency === undefined ? '' : ` (${currency})`;
}

/**
 * Los cuatro CSV que exporta cada tabla, byte a byte iguales a los que escribe `lila run --csv`
 * (`writeCsvDirectory` en `packages/engine/src/cli.ts`): misma función de `csv.ts`, mismos
 * argumentos. Exportada aparte para que el test la compare directo contra `elementsCsv`/
 * `flowsCsv`/`resourcesCsv`/`processCsv` sin tener que montar el componente.
 */
export function buildResultCsvExports(
  ir: ProcessIR,
  scenario: ResolvedScenario,
  result: RunResult,
): Readonly<Record<'elements' | 'flows' | 'resources' | 'process', string>> {
  return {
    elements: elementsCsv(ir, result),
    flows: flowsCsv(ir, result),
    process: processCsv(result),
    resources: resourcesCsv(result, resourceNames(scenario)),
  };
}

export function ResultsView({ ir, scenario, result }: ResultsViewProps): ReactNode {
  const [tab, setTab] = useState<Tab>('elements');
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  const currencyLabel = costLabel(scenario.run.currency);
  const names = resourceNames(scenario);
  const csv = buildResultCsvExports(ir, scenario, result);

  return (
    <div style={{ color: 'var(--fg-primary)', font: 'var(--font-size-base) var(--font-ui)' }}>
      <p style={{ color: 'var(--fg-muted)', margin: '0 0 12px' }}>
        Escenario {scenario.name} · semilla {scenario.run.seed} · replicaciones{' '}
        {scenario.run.replications} · unidad de tiempo {unit}
      </p>

      <BottleneckCard bottlenecks={result.bottlenecks} ir={ir} unit={unit} />

      <div style={tabBarStyle}>
        {TABS.map((candidate) => (
          <button
            key={candidate}
            type="button"
            style={tabButtonStyle(candidate === tab)}
            onClick={() => setTab(candidate)}
          >
            {TAB_LABELS[candidate]}
          </button>
        ))}
      </div>

      {tab === 'elements' && (
        <DataTable
          title={TAB_LABELS.elements}
          columns={elementColumns(unit, currencyLabel)}
          rows={elementRows(ir, result)}
          rowKey={(row) => row.id}
          csvFilename="elements.csv"
          csvContents={csv.elements}
        />
      )}
      {tab === 'flows' && (
        <DataTable
          title={TAB_LABELS.flows}
          columns={flowColumns()}
          rows={flowRows(ir, result)}
          rowKey={(row) => row.id}
          csvFilename="flows.csv"
          csvContents={csv.flows}
        />
      )}
      {tab === 'resources' && (
        <DataTable
          title={TAB_LABELS.resources}
          columns={resourceColumns(unit, currencyLabel)}
          rows={resourceRows(result, names)}
          rowKey={(row) => row.id}
          csvFilename="resources.csv"
          csvContents={csv.resources}
        />
      )}
      {tab === 'process' && (
        <DataTable
          title={TAB_LABELS.process}
          columns={processColumns(unit, currencyLabel)}
          rows={[result]}
          rowKey={() => 'process'}
          csvFilename="process.csv"
          csvContents={csv.process}
        />
      )}

      {result.warnings.length > 0 && (
        <section style={sectionStyle}>
          <h2 style={h2Style}>Avisos</h2>
          <ul style={{ color: 'var(--status-warning)', margin: '8px 0 0', paddingLeft: 20 }}>
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
