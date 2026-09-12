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
import { XLSX_MIME_TYPE, resourceNamesOf, scenarioWorkbook } from '@lila/engine/xlsx-report';
import {
  columnLabel,
  formatDuration,
  formatNumber,
  type BaseTimeUnit,
  type ResultScope,
} from '@lila/engine/format';
import type { ResolvedScenario } from '@lila/engine/schema';
import type {
  BottleneckEntry,
  ElementMetrics,
  FlowMetrics,
  OutcomeMetrics,
  ProcessIR,
  ResourceMetrics,
  RunResult,
} from '@lila/engine';
import { getLocale, strings, useStrings } from './i18n';

export interface ResultsViewProps {
  ir: ProcessIR;
  scenario: ResolvedScenario;
  result: RunResult;
  /**
   * Switches the shell to the «Animate» mode (#331). Optional because the demo page
   * (`results-demo.tsx`) has no shell to switch: without it the button is not painted.
   */
  onAnimar?: (() => void) | undefined;
  /**
   * `true` when that run has no event log in memory (it was reopened from a `.lila`): the button
   * is painted but disabled, because the replay mode would only say «run it again» (#331).
   */
  sinLog?: boolean | undefined;
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
  /** Casi siempre un string (`formatNumber`/`formatDuration`); CompareView (LILA-063) le mete
   * JSX para la marca `*` de significancia sin duplicar la tabla. */
  display: (row: Row) => ReactNode;
  /** Estilo extra por celda; CompareView (LILA-063) lo usa para resaltar solo las que cambian. */
  cellStyle?: (row: Row) => CSSProperties;
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
    // Los números se comparan como números (10 > 9, no "10" < "9") y los textos con
    // `localeCompare` en español, para que "Ánimo" quede junto a "Animo" y no detrás de "Zorro".
    if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv, 'es') * sign;
    if (av < bv) return -1 * sign;
    if (av > bv) return 1 * sign;
    return 0;
  });
}

export const sectionStyle: CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  marginBottom: 16,
  padding: 12,
};

const titleRowStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  justifyContent: 'space-between',
  marginBottom: 8,
};

export const h2Style: CSSProperties = { color: 'var(--fg-primary)', fontSize: 14, margin: 0 };

export const exportButtonStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-strong)',
  color: 'var(--fg-primary)',
  cursor: 'pointer',
  font: 'inherit',
  padding: '4px 10px',
};

export const tableWrapStyle: CSSProperties = {
  border: '1px solid var(--border)',
  maxHeight: 420,
  overflow: 'auto',
};

export const tableStyle: CSSProperties = {
  borderCollapse: 'collapse',
  fontVariantNumeric: 'tabular-nums',
  width: '100%',
};

export const thStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  padding: 'calc(4px * var(--espacio, 1)) 8px',
  position: 'sticky',
  textAlign: 'left',
  top: 0,
  userSelect: 'none',
  whiteSpace: 'nowrap',
};

export const tdStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  color: 'var(--fg-primary)',
  padding: 'calc(3px * var(--espacio, 1)) 8px',
  whiteSpace: 'nowrap',
};

export function sortIndicator(sort: SortState | null, key: string): string {
  if (sort === null || sort.key !== key) return '';
  return sort.dir === 'asc' ? ' ▲' : ' ▼';
}

/** `aria-sort` del encabezado: lo que anuncia un lector de pantalla al llegar a la columna. */
function ariaSort(sort: SortState | null, key: string): 'ascending' | 'descending' | 'none' {
  if (sort === null || sort.key !== key) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

/** Descarga `contents` como si el navegador hubiera guardado el archivo del enlace. */
function downloadCsv(filename: string, contents: string): void {
  descargar(filename, new Blob([contents], { type: 'text/csv;charset=utf-8' }));
}

/**
 * Descarga el libro `.xlsx` que produce `@lila/engine/xlsx-report` (issue #80). Los bytes se
 * generan **al pulsar** y no en cada render: construir el zip de una corrida grande en cada
 * repintado de la tabla se notaría en la interfaz y casi siempre se tiraría sin usar.
 */
export function downloadXlsx(filename: string, bytes: Uint8Array): void {
  // `new Blob([bytes])` sobre la vista exacta: `bytes.buffer` podría llevar relleno de más.
  descargar(filename, new Blob([bytes.slice()], { type: XLSX_MIME_TYPE }));
}

function descargar(filename: string, blob: Blob): void {
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

export interface DataTableProps<Row> {
  title: string;
  columns: readonly ColumnDef<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Sin CSV no hay botón "Exportar CSV". */
  csvFilename?: string;
  csvContents?: string;
  /** Igual para el libro `.xlsx`; el thunk difiere la construcción del zip hasta el clic. */
  xlsxFilename?: string;
  xlsxContents?: () => Uint8Array;
}

/** Tabla ordenable genérica; ResultsView (LILA-062) y CompareView (LILA-063) la comparten. */
export function DataTable<Row>({
  title,
  columns,
  rows,
  rowKey,
  csvFilename,
  csvContents,
  xlsxFilename,
  xlsxContents,
}: DataTableProps<Row>): ReactNode {
  const S = useStrings();
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
        {csvContents !== undefined && csvFilename !== undefined && (
          <button
            type="button"
            style={exportButtonStyle}
            onClick={() => downloadCsv(csvFilename, csvContents)}
          >
            {S.resultados.exportarCsv}
          </button>
        )}
        {xlsxContents !== undefined && xlsxFilename !== undefined && (
          <button
            type="button"
            style={exportButtonStyle}
            onClick={() => downloadXlsx(xlsxFilename, xlsxContents())}
          >
            {S.resultados.exportarXlsx}
          </button>
        )}
      </div>
      <div style={tableWrapStyle}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.numeric === true ? { ...thStyle, textAlign: 'right' } : thStyle}
                  tabIndex={0}
                  aria-sort={ariaSort(sort, column.key)}
                  onClick={() => toggle(column.key)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    toggle(column.key);
                  }}
                >
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
                    style={{
                      ...tdStyle,
                      ...(column.numeric === true
                        ? { fontFamily: 'var(--font-mono)', textAlign: 'right' as const }
                        : { textAlign: 'left' as const }),
                      ...column.cellStyle?.(row),
                    }}
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
  const S = strings();
  return [
    { display: (row) => row.id, header: S.resultados.columnas.id, key: 'id', sortValue: (row) => row.id },
    { display: (row) => row.name, header: S.resultados.columnas.name, key: 'name', sortValue: (row) => row.name },
  ];
}

/**
 * El `key` de cada columna es la ruta de la métrica dentro de `RunResult`, así que el rótulo sale
 * del mapa único de `@lila/engine/format` (docs/RESULTS_FORMAT.md § 10, LILA-201): esta vista, la
 * CLI y los CSV no pueden llamar distinto a la misma columna.
 */
function numberColumn<Row>(scope: ResultScope, key: string, get: (row: Row) => number): ColumnDef<Row> {
  return {
    display: (row) => formatNumber(get(row)),
    header: columnLabel(scope, key),
    key,
    numeric: true,
    sortValue: get,
  };
}

function durationColumn<Row>(
  scope: ResultScope,
  key: string,
  unit: BaseTimeUnit,
  get: (row: Row) => number,
): ColumnDef<Row> {
  const S = strings();
  return {
    display: (row) => formatDuration(get(row), unit),
    header: S.resultados.columnaConUnidad(columnLabel(scope, key), unit),
    key,
    numeric: true,
    sortValue: get,
  };
}

/** docs/RESULTS_FORMAT.md §10, tabla "Process elements": mismas columnas y orden que `elementsCsv`. */
function elementColumns(unit: BaseTimeUnit): ColumnDef<ElementRow>[] {
  const S = strings();
  return [
    ...idNameColumns<ElementRow>(),
    { display: (row) => row.type, header: S.resultados.columnas.type, key: 'type', sortValue: (row) => row.type },
    numberColumn('elements', 'started', (row) => row.metrics.started),
    numberColumn('elements', 'completed', (row) => row.metrics.completed),
    durationColumn('elements', 'processing.min', unit, (row) => row.metrics.processing.min),
    durationColumn('elements', 'processing.max', unit, (row) => row.metrics.processing.max),
    durationColumn('elements', 'processing.mean', unit, (row) => row.metrics.processing.mean),
    durationColumn('elements', 'processing.total', unit, (row) => row.metrics.processing.total),
    durationColumn('elements', 'resourceWait.min', unit, (row) => row.metrics.resourceWait.min),
    durationColumn('elements', 'resourceWait.max', unit, (row) => row.metrics.resourceWait.max),
    durationColumn('elements', 'resourceWait.mean', unit, (row) => row.metrics.resourceWait.mean),
    durationColumn('elements', 'resourceWait.sd', unit, (row) => row.metrics.resourceWait.sd),
    durationColumn('elements', 'resourceWait.total', unit, (row) => row.metrics.resourceWait.total),
    numberColumn('elements', 'fixedCostTotal', (row) => row.metrics.fixedCostTotal),
  ];
}

/** docs/RESULTS_FORMAT.md §10, tabla "Sequence flows": mismas columnas que `flowsCsv`. */
function flowColumns(): ColumnDef<FlowRow>[] {
  const S = strings();
  return [
    ...idNameColumns<FlowRow>(),
    { display: (row) => row.from, header: S.resultados.columnas.from, key: 'from', sortValue: (row) => row.from },
    { display: (row) => row.to, header: S.resultados.columnas.to, key: 'to', sortValue: (row) => row.to },
    numberColumn('flows', 'count', (row) => row.metrics.count),
  ];
}

/** docs/RESULTS_FORMAT.md §10, tabla "Resources": mismas columnas que `resourcesCsv`. */
function resourceColumns(unit: BaseTimeUnit): ColumnDef<ResourceRow>[] {
  return [
    ...idNameColumns<ResourceRow>(),
    numberColumn('resources', 'utilization', (row) => row.metrics.utilization * 100),
    durationColumn('resources', 'busyTime', unit, (row) => row.metrics.busyTime),
    numberColumn('resources', 'fixedCost', (row) => row.metrics.fixedCost),
    numberColumn('resources', 'unitCost', (row) => row.metrics.unitCost),
    numberColumn('resources', 'totalCost', (row) => row.metrics.totalCost),
  ];
}

/**
 * Tabla "Proceso": una sola fila (docs/RESULTS_FORMAT.md §5), mismas columnas y orden que
 * `processCsv` — incluidos los extras que Bizagi no ofrece (percentiles, throughput, costo por
 * caso, ver §10).
 */
function processColumns(unit: BaseTimeUnit): ColumnDef<RunResult>[] {
  return [
    numberColumn('process', 'started', (r) => r.process.started),
    numberColumn('process', 'completed', (r) => r.process.completed),
    numberColumn('process', 'inFlight', (r) => r.process.inFlight),
    durationColumn('process', 'cycleTime.min', unit, (r) => r.process.cycleTime.min),
    durationColumn('process', 'cycleTime.max', unit, (r) => r.process.cycleTime.max),
    durationColumn('process', 'cycleTime.mean', unit, (r) => r.process.cycleTime.mean),
    durationColumn('process', 'cycleTime.sd', unit, (r) => r.process.cycleTime.sd),
    durationColumn('process', 'cycleTime.p50', unit, (r) => r.process.cycleTime.p50),
    durationColumn('process', 'cycleTime.p90', unit, (r) => r.process.cycleTime.p90),
    durationColumn('process', 'cycleTime.p95', unit, (r) => r.process.cycleTime.p95),
    durationColumn('process', 'waitTime.min', unit, (r) => r.process.waitTime.min),
    durationColumn('process', 'waitTime.max', unit, (r) => r.process.waitTime.max),
    durationColumn('process', 'waitTime.mean', unit, (r) => r.process.waitTime.mean),
    durationColumn('process', 'waitTime.sd', unit, (r) => r.process.waitTime.sd),
    durationColumn('process', 'waitTime.p50', unit, (r) => r.process.waitTime.p50),
    durationColumn('process', 'waitTime.p90', unit, (r) => r.process.waitTime.p90),
    durationColumn('process', 'waitTime.p95', unit, (r) => r.process.waitTime.p95),
    numberColumn('process', 'throughputPerHour', (r) => r.process.throughputPerHour),
    numberColumn('process', 'costPerCase', (r) => r.process.costPerCase),
    numberColumn('process', 'totalCost', (r) => r.process.totalCost),
  ];
}

/** Una fila de la tabla "Desenlaces": un `end`/`terminate` con sus métricas (#316). */
interface OutcomeRow {
  id: string;
  name: string;
  metrics: OutcomeMetrics;
}

function outcomeRows(ir: ProcessIR, result: RunResult): OutcomeRow[] {
  return Object.entries(result.process.byEndEvent ?? {}).map(([id, metrics]) => ({
    id,
    metrics,
    name: ir.nodes[id]?.name ?? '',
  }));
}

/**
 * Tabla "Desenlaces" (docs/RESULTS_FORMAT.md §5): una fila por `end`/`terminate`, con las
 * columnas que distinguen un desenlace de otro. `Within service level` solo existe cuando el
 * escenario declara `run.serviceLevel`, así que la columna aparece con él y no antes.
 */
function outcomeColumns(unit: BaseTimeUnit, showServiceLevel: boolean): ColumnDef<OutcomeRow>[] {
  return [
    ...idNameColumns<OutcomeRow>(),
    numberColumn('process', 'completed', (row) => row.metrics.completed),
    durationColumn('process', 'cycleTime.mean', unit, (row) => row.metrics.cycleTime.mean),
    durationColumn('process', 'cycleTime.p50', unit, (row) => row.metrics.cycleTime.p50),
    durationColumn('process', 'cycleTime.p95', unit, (row) => row.metrics.cycleTime.p95),
    durationColumn('process', 'waitTime.mean', unit, (row) => row.metrics.waitTime.mean),
    ...(showServiceLevel
      ? [
          {
            display: (row: OutcomeRow) => `${formatNumber((row.metrics.withinServiceLevel ?? 0) * 100)}%`,
            header: columnLabel('process', 'withinServiceLevel'),
            key: 'withinServiceLevel',
            numeric: true,
            sortValue: (row: OutcomeRow) => row.metrics.withinServiceLevel ?? 0,
          },
        ]
      : []),
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
  const S = useStrings();
  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>{S.resultados.cuellos}</h2>
      {bottlenecks.length === 0 ? (
        <p style={{ color: 'var(--fg-muted)' }}>{S.resultados.sinCuellos}</p>
      ) : (
        <ol style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          {bottlenecks.map((entry) => (
            <li key={entry.elementId} style={{ color: 'var(--fg-primary)', marginBottom: 4 }}>
              <strong>{ir.nodes[entry.elementId]?.name ?? entry.elementId}</strong>
              {S.resultados.cuelloDetalle(
                formatDuration(entry.resourceWaitTotal, unit),
                unit,
                formatNumber(entry.utilization * 100),
              )}
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

/** Rótulos de sección del idioma activo; CompareView (LILA-063) los reutiliza para no inventar otros. */
export const tabLabels = (): Readonly<Record<Tab, string>> => strings().resultados.secciones;

const tabBarStyle: CSSProperties = { display: 'flex', gap: 4, marginBottom: 12 };

function tabButtonStyle(active: boolean): CSSProperties {
  return {
    background: active ? 'var(--accent-tertiary)' : 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    color: active ? 'var(--fg-onAccent)' : 'var(--fg-primary)',
    cursor: 'pointer',
    font: 'inherit',
    fontWeight: active ? 600 : 400,
    padding: '6px 12px',
  };
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

export function ResultsView({ ir, scenario, result, onAnimar, sinLog = false }: ResultsViewProps): ReactNode {
  const S = useStrings();
  const [tab, setTab] = useState<Tab>('elements');
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  const names = resourceNames(scenario);
  const csv = buildResultCsvExports(ir, scenario, result);
  const outcomes = outcomeRows(ir, result);
  // Un solo libro para toda la vista: las cinco hojas ya llevan las cuatro tablas, así que el
  // botón exporta lo mismo esté abierta la pestaña que esté.
  const xlsxFilename = `${scenario.name}.xlsx`;
  const xlsx = (): Uint8Array =>
    scenarioWorkbook(ir, scenario, result, resourceNamesOf(scenario), getLocale());

  return (
    <div style={{ color: 'var(--fg-primary)', font: 'var(--font-size-base) var(--font-ui)' }}>
      {onAnimar !== undefined && (
        <button type="button" className="boton primario" style={{ float: 'right' }} onClick={onAnimar}
          disabled={sinLog} title={sinLog ? S.animacion.sinLog : undefined}>
          {S.animacion.reproducirDesdeResultados}
        </button>
      )}
      <p style={{ color: 'var(--fg-muted)', margin: '0 0 12px' }}>
        {S.resultados.cabecera(
          scenario.name,
          scenario.run.seed ?? 1,
          scenario.run.replications,
          unit,
          scenario.run.currency,
        )}
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
            {tabLabels()[candidate]}
          </button>
        ))}
      </div>

      {tab === 'elements' && (
        <DataTable
          title={tabLabels().elements}
          columns={elementColumns(unit)}
          rows={elementRows(ir, result)}
          rowKey={(row) => row.id}
          csvFilename="elements.csv"
          csvContents={csv.elements}
          xlsxFilename={xlsxFilename}
          xlsxContents={xlsx}
        />
      )}
      {tab === 'flows' && (
        <DataTable
          title={tabLabels().flows}
          columns={flowColumns()}
          rows={flowRows(ir, result)}
          rowKey={(row) => row.id}
          csvFilename="flows.csv"
          csvContents={csv.flows}
          xlsxFilename={xlsxFilename}
          xlsxContents={xlsx}
        />
      )}
      {tab === 'resources' && (
        <DataTable
          title={tabLabels().resources}
          columns={resourceColumns(unit)}
          rows={resourceRows(result, names)}
          rowKey={(row) => row.id}
          csvFilename="resources.csv"
          csvContents={csv.resources}
          xlsxFilename={xlsxFilename}
          xlsxContents={xlsx}
        />
      )}
      {tab === 'process' && (
        <DataTable
          title={tabLabels().process}
          columns={processColumns(unit)}
          rows={[result]}
          rowKey={() => 'process'}
          csvFilename="process.csv"
          csvContents={csv.process}
          xlsxFilename={xlsxFilename}
          xlsxContents={xlsx}
        />
      )}
      {tab === 'process' && outcomes.length > 0 && (
        <DataTable
          title={S.resultados.desenlaces}
          columns={outcomeColumns(unit, result.process.withinServiceLevel !== undefined)}
          rows={outcomes}
          rowKey={(row) => row.id}
        />
      )}

      {result.warnings.length > 0 && (
        <section style={sectionStyle}>
          <h2 style={h2Style}>{S.resultados.avisos}</h2>
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
