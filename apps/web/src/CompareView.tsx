/**
 * Vista de comparación (LILA-063): dos o más escenarios lado a lado, mismo `CompareResult` que
 * produce `compare()` (`packages/engine/src/core/compare.ts`, docs/RESULTS_FORMAT.md §11) y ya
 * imprime `lila compare` (LILA-047) en la CLI. Reutiliza `DataTable`/`sortRows`/estilos de
 * `ResultsView.tsx` (LILA-062): ninguna tabla ni función de formato se duplica aquí.
 *
 * Aceptación literal (BACKLOG LILA-063): "AS-IS vs TO-BE marca solo las celdas que cambian" — se
 * resalta la celda cuyo texto mostrado difiere del de la base, ver `cellChanged()`; nunca la
 * columna base, que se compara contra sí misma.
 *
 * Los nombres de columna salen del mapa único de `@lila-modeler/engine/format` (docs/RESULTS_FORMAT.md
 * §10, LILA-201), el mismo que usan `lila run`, `lila compare` y los CSV.
 *
 * ponytail: el subconjunto curado de KPIs sí se repite aquí en vez de importarse de
 * `packages/engine/src/cli.ts`: ese archivo es el binario de la CLI (usa `node:fs`, no está en los
 * `exports` de package.json) y no una librería pensada para compartirse con la web. Si el
 * subconjunto cambia en `lila compare`, hay que actualizar también `DEFAULT_COMPARE_METRICS` aquí.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  columnLabel,
  formatDuration,
  formatNumber,
  formatSignedPercent,
  isDurationMetric,
  SECONDS_PER_UNIT,
  splitOutcomeMetric,
  type BaseTimeUnit,
} from '@lila-modeler/engine/format';
import type { CompareResult, CompareRow, CompareScope, ProcessIR } from '@lila-modeler/engine';
import { compareWorkbook, type CompareEntry } from '@lila-modeler/engine/xlsx-report';
import {
  DataTable,
  downloadXlsx,
  exportButtonStyle,
  tabLabels,
  h2Style,
  notaStyle,
  sectionStyle,
  type ColumnDef,
} from './ResultsView.js';
import { compareWarnings, type CompareRunMeta } from './compareWarnings.js';
import { MAX_SERIES } from './graficas';
import { GraficaBarras, geometriaBarras, PLOT_MINIMO, useAncho, type GraficaBarrasProps } from './GraficasSvg';
import { formatDisplay, formatDisplayDuration, roundDisplay } from './formatDisplay';
import { getLocale, strings, useStrings } from './i18n';

export type { CompareRunMeta } from './compareWarnings.js';

export interface CompareViewProps {
  ir: ProcessIR;
  comparison: CompareResult;
  /** En el mismo orden que los `RunResult` pasados a `compare()`; `scenarioNames[0]` es la base. */
  scenarioNames: readonly string[];
  baseTimeUnit: BaseTimeUnit;
  /**
   * id de recurso -> nombre, fusionando **todos** los escenarios comparados y no solo el base
   * (`printCompareResult` en cli.ts hace lo mismo): un pool puede nacer en el TO-BE, y su fila
   * existe igual con la base en guion.
   */
  resourceNames?: Readonly<Record<string, string>>;
  /**
   * Metadatos de cada corrida, en el mismo orden que `scenarioNames` (OP-05 / issue #210): moneda,
   * semilla, réplicas, unidad de tiempo propia y los `warnings[]` que ya mostraba `ResultsView`.
   * Opcional y hacia atrás compatible: sin este prop la vista se comporta exactamente como antes
   * (sin panel de avisos, sin metadatos en la cabecera, `baseTimeUnit` para todas las columnas).
   */
  runs?: readonly CompareRunMeta[];
  /**
   * Escenario resuelto y `RunResult` de cada corrida, en el mismo orden que `scenarioNames`
   * (issue #80). Sin este prop no hay botón "Exportar XLSX": el libro necesita los resultados
   * completos —no solo el `CompareResult`— para escribir la hoja Resumen de cada escenario.
   */
  entries?: readonly CompareEntry[];
  /**
   * Palette slot of each scenario, in the order of `scenarioNames` (#460): the shell passes each
   * scenario's position in the project, so its chart color does not move when the base changes.
   * Without it, the index in `scenarioNames`.
   */
  seriesSlots?: readonly number[];
}

/* ------------------------------------------------------------------ *
 * Subconjunto curado y etiquetas Bizagi, espejo de `lila compare` (docs/RESULTS_FORMAT.md §10,
 * BACKLOG.md LILA-047). Ver nota "ponytail" arriba sobre por qué se repite en vez de importarse.
 * ------------------------------------------------------------------ */

const DEFAULT_COMPARE_METRICS: ReadonlySet<string> = new Set([
  'elements:started',
  'elements:completed',
  'elements:processing.mean',
  'elements:resourceWait.mean',
  'elements:queueLength.mean',
  'resources:utilization',
  'resources:totalCost',
  'process:cycleTime.mean',
  'process:waitTime.mean',
  'process:throughputPerHour',
  'process:costPerCase',
  'process:totalCost',
  'process:withinServiceLevel',
]);

/**
 * Métricas por desenlace que entran en la tabla por defecto (#316), espejo de
 * `isDefaultOutcomeMetric` en `packages/engine/src/cli.ts`: sus paths llevan el id BPMN dentro,
 * así que no caben en el `Set` de arriba.
 */
function isDefaultOutcomeMetric(scope: CompareScope, metric: string): boolean {
  if (scope !== 'process') return false;
  const outcome = splitOutcomeMetric(metric);
  return outcome !== null && (outcome.metric === 'cycleTime.mean' || outcome.metric === 'withinServiceLevel');
}

/**
 * Los únicos campos monetarios de `RunResult` (`run.currency`, docs/RESULTS_FORMAT.md §§2,4,5):
 * `elements[id].fixedCostTotal`, `resources[id].{fixedCost,unitCost,totalCost}` y
 * `process.{costPerCase,totalCost}`. Todos son escalares sin punto en su `metric` (a diferencia de
 * `processing.mean`), así que comparar el nombre completo basta y no hace falta mirar `scope`.
 */
const COST_METRICS: ReadonlySet<string> = new Set(['fixedCostTotal', 'fixedCost', 'unitCost', 'totalCost', 'costPerCase']);

function isCostMetric(metric: string): boolean {
  return COST_METRICS.has(metric);
}

/** Exportada para que el test ubique la fila de un KPI por su etiqueta sin adivinar el HTML. */
export function compareMetricLabel(scope: CompareScope, metric: string): string {
  return columnLabel(scope, metric);
}

/**
 * `Intl.NumberFormat` solo cuando hay un código ISO 4217 de verdad; si no, número plano (igual que
 * el resto de la tabla). `RunSchema.currency` valida `/^[A-Z]{3}$/`, más laxo que la lista real de
 * códigos ISO — un código de tres letras mayúsculas que `Intl` no reconozca (p. ej. inventado a
 * mano en un escenario de prueba) cae al mismo número plano en vez de lanzar.
 */
function formatMoney(value: number, currency: string | undefined, exact: boolean): string {
  const plain = exact ? formatNumber : formatDisplay;
  if (currency === undefined) return plain(value);
  try {
    return new Intl.NumberFormat(undefined, { currency, style: 'currency' }).format(value);
  } catch {
    return plain(value);
  }
}

/**
 * Igual que `formatCompareValue` de `lila compare`: guion para `null`, % para utilización. La
 * celda muestra dos decimales (#578); con `exact` sale el valor de la CLI, para el `title`.
 */
function formatCellValue(metric: string, value: number | null, unit: BaseTimeUnit, currency: string | undefined, exact = false): string {
  const S = strings();
  const plain = exact ? formatNumber : formatDisplay;
  if (value === null) return S.comparar.sinValor;
  if (isCostMetric(metric)) return formatMoney(value, currency, exact);
  if (isDurationMetric(metric)) return exact ? formatDuration(value, unit) : formatDisplayDuration(value, unit);
  if (metric === 'utilization') return S.comparar.porCiento(plain(value * 100));
  if (metric === 'withinServiceLevel' || splitOutcomeMetric(metric)?.metric === 'withinServiceLevel') {
    return S.comparar.porCiento(plain(value * 100));
  }
  return plain(value);
}

/** Delta relativo como porcentaje con signo; en pantalla, con dos decimales de porcentaje. */
function deltaText(fraction: number, exact: boolean): string {
  return formatSignedPercent(exact ? fraction : roundDisplay(fraction, 4));
}

/**
 * Unidad y moneda con las que se formatea una columna: la de su propia corrida si se conoce.
 * `currency` no es opcional (a diferencia de `CompareRunMeta.currency`): con
 * `exactOptionalPropertyTypes` un campo opcional no admite `undefined` explícito, y este tipo
 * interno sí necesita poder decir "no hay moneda para esta columna".
 */
interface ColumnContext {
  unit: BaseTimeUnit;
  currency: string | undefined;
}

/** Texto completo de una celda no base: valor y delta relativo, como `lila compare` en la CLI. */
function cellText(row: CompareRow, index: number, ctx: ColumnContext, costsComparable: boolean, exact = false): string {
  const S = strings();
  const value = row.values[index] ?? null;
  const valueText = formatCellValue(row.metric, value, ctx.unit, ctx.currency, exact);
  if (index === 0 || value === null) return valueText;
  // Costos en monedas distintas (o una corrida sin moneda): `deltaAbs`/`deltaRel` restan números
  // crudos sin saber que representan divisas distintas (compare() no conoce `run.currency`), así
  // que ese delta no se imprime como si fuera dinero real (OP-05, issue #210).
  if (isCostMetric(row.metric) && !costsComparable) return S.comparar.celdaConDelta(valueText, S.comparar.noComparable);
  const deltaRel = row.deltaRel[index] ?? null;
  return S.comparar.celdaConDelta(
    valueText,
    deltaRel === null ? S.comparar.sinValor : deltaText(deltaRel, exact),
  );
}

/**
 * "Celdas que cambian" (aceptación de LILA-063) = las que el usuario ve distintas de la base, y
 * no `deltaAbs !== 0`: en `examples/pedido`, `Task_Preparar.processing.mean` difiere en 5.7e-14
 * entre AS-IS y TO-BE, así que se resaltaba una celda con el mismo número que la base y "(0%)" al
 * lado. Comparar los textos ya formateados no necesita ningún umbral y también cubre el caso
 * contrario: una fila que solo existe en el TO-BE tiene `deltaAbs === null` (base ausente) y sí
 * cambia, porque la base muestra un guion.
 *
 * Costo no comparable (OP-05): nunca se resalta ni se marca como mejora/ahorro, aunque el número
 * crudo difiera de la base — es la garantía de aceptación "no se presenta una diferencia de costo
 * entre monedas distintas como ahorro válido".
 */
function cellChanged(row: CompareRow, index: number, ctx: ColumnContext, baseCtx: ColumnContext, costsComparable: boolean): boolean {
  if (index === 0) return false;
  if (isCostMetric(row.metric) && !costsComparable) return false;
  const value = formatCellValue(row.metric, row.values[index] ?? null, ctx.unit, ctx.currency);
  if (value !== formatCellValue(row.metric, row.values[0] ?? null, baseCtx.unit, baseCtx.currency)) return true;
  const deltaRel = row.deltaRel[index] ?? null;
  return deltaRel !== null && deltaText(deltaRel, false) !== '0%';
}

/** Filas de un scope; con `showAll = false` solo el subconjunto curado (BACKLOG LILA-047). */
export function visibleCompareRows(
  rows: readonly CompareRow[],
  scope: CompareScope,
  showAll: boolean,
): CompareRow[] {
  return rows.filter(
    (row) =>
      row.scope === scope &&
      (showAll ||
        DEFAULT_COMPARE_METRICS.has(`${scope}:${row.metric}`) ||
        isDefaultOutcomeMetric(scope, row.metric)),
  );
}

function rowName(
  ir: ProcessIR,
  resourceNames: Readonly<Record<string, string>>,
  scope: CompareScope,
  id: string | null,
): string {
  if (id === null) return '';
  if (scope === 'elements') return ir.nodes[id]?.name ?? '';
  if (scope === 'flows') return ir.flows[id]?.name ?? '';
  if (scope === 'resources') return resourceNames[id] ?? '';
  return '';
}

/* ------------------------------------------------------------------ *
 * Columnas: Id/Name (salvo Proceso), Metric, y una por escenario visible.
 * ------------------------------------------------------------------ */

const highlightStyle: CSSProperties = { background: 'var(--bg-hover)' };

const significantMarkStyle: CSSProperties = { color: 'var(--accent-secondary)', fontWeight: 700 };

/**
 * Cabecera de columna: nombre y, entre paréntesis, "base" y los metadatos que existan (OP-05:
 * "la cabecera de cada columna muestra moneda, semilla, réplicas y unidad cuando existen"). Sin
 * `meta` (no se pasó `runs`) se comporta exactamente como antes: solo "(base)" en la columna 0.
 */
function columnHeader(name: string, index: number, meta: CompareRunMeta | undefined): string {
  const S = strings();
  const tags = [
    index === 0 ? S.comparar.etiquetaBase : null,
    meta?.currency ?? null,
    meta?.seed === undefined ? null : S.comparar.metaSemilla(meta.seed),
    meta?.replications === undefined ? null : S.comparar.metaReplicas(meta.replications),
    meta?.baseTimeUnit === undefined ? null : S.comparar.metaUnidad(meta.baseTimeUnit),
  ].filter((tag): tag is string => tag !== null);
  return S.comparar.columnaConMeta(name, tags);
}

function scenarioColumn(
  index: number,
  name: string,
  ctx: ColumnContext,
  baseCtx: ColumnContext,
  meta: CompareRunMeta | undefined,
  costsComparable: boolean,
  significanceAvailable: boolean,
): ColumnDef<CompareRow> {
  const S = strings();
  return {
    display: (row): ReactNode => {
      const text = cellText(row, index, ctx, costsComparable);
      // Sin réplicas suficientes no hay IC95 (compareWarnings.significanceAvailable), y un costo
      // no comparable entre monedas tampoco tiene una diferencia real que marcar: en ninguno de
      // los dos casos se pinta el asterisco, aunque `row.significant[index]` venga en `true`
      // (OP-05: "la vista no fabrica significancia").
      const showsSignificance =
        significanceAvailable && row.significant[index] === true && !(isCostMetric(row.metric) && !costsComparable);
      if (!showsSignificance) return text;
      return (
        <>
          {text}
          {/* `title` solo lo anuncian algunos lectores de pantalla; `role="img"` + `aria-label`
              convierten el asterisco en una imagen con texto alternativo, que sí se lee. */}
          <span aria-label={S.comparar.marcaSignificativa} role="img" style={significantMarkStyle} title={S.comparar.marcaSignificativa}>
            {' '}
            {S.comparar.asterisco}
          </span>
        </>
      );
    },
    title: (row) => cellText(row, index, ctx, costsComparable, true),
    cellStyle: (row): CSSProperties => (cellChanged(row, index, ctx, baseCtx, costsComparable) ? highlightStyle : {}),
    header: columnHeader(name, index, meta),
    key: `scenario-${index}`,
    numeric: true,
    sortValue: (row) => row.values[index] ?? Number.NEGATIVE_INFINITY,
  };
}

/**
 * Exportada para que el test de QA ordene la tabla sin simular clics (no hay jsdom aquí).
 *
 * `runs`, `costsComparable` y `significanceAvailable` son opcionales y hacia atrás compatibles:
 * las llamadas existentes (sin esos tres argumentos) siguen formateando todas las columnas con
 * `unit` y mostrando cualquier significancia, exactamente como antes de OP-05.
 */
export function compareColumns(
  scope: CompareScope,
  ir: ProcessIR,
  resourceNames: Readonly<Record<string, string>>,
  scenarioNames: readonly string[],
  isVisible: (index: number) => boolean,
  unit: BaseTimeUnit,
  runs?: readonly CompareRunMeta[],
  costsComparable = true,
  significanceAvailable = true,
): ColumnDef<CompareRow>[] {
  const S = strings();
  const idColumns: ColumnDef<CompareRow>[] =
    scope === 'process'
      ? []
      : [
          { display: (row) => row.id ?? '', header: S.resultados.columnas.id, key: 'id', sortValue: (row) => row.id ?? '' },
          {
            display: (row) => rowName(ir, resourceNames, scope, row.id),
            header: S.resultados.columnas.name,
            key: 'name',
            sortValue: (row) => rowName(ir, resourceNames, scope, row.id),
          },
        ];
  const metricColumn: ColumnDef<CompareRow> = {
    display: (row) => compareMetricLabel(row.scope, row.metric),
    header: S.resultados.columnas.metric,
    key: 'metric',
    // Por la etiqueta mostrada y no por el path interno: ordenar por "Metric" tiene que dar el
    // orden alfabético que el usuario ve ("Average time" está bajo `processing.mean`), igual que
    // las columnas Id y Name, que ya ordenan por su texto.
    sortValue: (row) => compareMetricLabel(row.scope, row.metric),
  };
  // Unidad y moneda por columna: la de su propia corrida si `runs` la declara, si no la global
  // `unit` (y sin moneda) — así una corrida sin metadatos se comporta como antes de OP-05.
  const columnContext = (index: number): ColumnContext => ({
    currency: runs?.[index]?.currency,
    unit: runs?.[index]?.baseTimeUnit ?? unit,
  });
  const baseCtx = columnContext(0);
  const scenarioColumns = scenarioNames
    .map((name, index) =>
      isVisible(index)
        ? scenarioColumn(index, name, columnContext(index), baseCtx, runs?.[index], costsComparable, significanceAvailable)
        : null,
    )
    .filter((column): column is ColumnDef<CompareRow> => column !== null);

  return [...idColumns, metricColumn, ...scenarioColumns];
}

/* ------------------------------------------------------------------ *
 * Charts (#460): the key KPIs of the tables, one bar per visible scenario, each bar labelled with
 * its own cell text — value and delta against the base — so the chart cannot disagree with the
 * table. Colors follow the scenario (its index), never its position among the visible ones.
 * ------------------------------------------------------------------ */

export interface CompareChartsInput {
  rows: readonly CompareRow[];
  ir: ProcessIR;
  resourceNames: Readonly<Record<string, string>>;
  scenarioNames: readonly string[];
  isVisible: (index: number) => boolean;
  baseTimeUnit: BaseTimeUnit;
  runs?: readonly CompareRunMeta[] | undefined;
  costsComparable: boolean;
  /** See `CompareViewProps.seriesSlots`. */
  seriesSlots?: readonly number[] | undefined;
}

/**
 * The compare charts as props of `GraficaBarras`, plus the notes for what is not charted.
 * Exported for the test, which checks each bar against its table cell.
 */
export function compareCharts(input: CompareChartsInput): { graficas: GraficaBarrasProps[]; notas: string[] } {
  const S = strings();
  const { rows, scenarioNames, isVisible, baseTimeUnit, runs, costsComparable } = input;
  const visibles = scenarioNames.map((_, i) => i).filter(isVisible);
  const indices = visibles.slice(0, MAX_SERIES);
  const notas = visibles.length > indices.length ? [S.graficas.compararDemasiados(visibles.length)] : [];
  // The palette slot each scenario owns, when the caller says (stable across base changes and
  // hidden columns); if those slots do not fit the palette or repeat, the position among the
  // charted ones.
  const propios = indices.map((i) => input.seriesSlots?.[i] ?? i);
  const colores = propios.every((slot, k) => slot >= 0 && slot < MAX_SERIES && propios.indexOf(slot) === k)
    ? propios
    : indices.map((_, k) => k);
  const ctx = (i: number): ColumnContext => ({ currency: runs?.[i]?.currency, unit: runs?.[i]?.baseTimeUnit ?? baseTimeUnit });
  const series = indices.map((i) => (i === 0 ? S.comparar.base(scenarioNames[i]!) : scenarioNames[i]!));
  const grupo = (row: CompareRow, etiqueta: string, valor: (v: number) => number) => ({
    id: row.kpi,
    etiqueta,
    valores: indices.map((i) => {
      const v = row.values[i] ?? null;
      return v === null ? null : valor(v);
    }),
    textos: indices.map((i) => cellText(row, i, ctx(i), costsComparable)),
  });
  const proceso = (metric: string): CompareRow | undefined => rows.find((r) => r.scope === 'process' && r.metric === metric);

  const graficas: GraficaBarrasProps[] = [];
  const ciclo = proceso('cycleTime.mean');
  // One axis: every bar in the base's unit, whatever unit its own column is printed in.
  if (ciclo !== undefined) {
    graficas.push({
      titulo: S.graficas.compararCiclo(baseTimeUnit),
      series,
      colores,
      grupos: [grupo(ciclo, compareMetricLabel('process', 'cycleTime.mean'), (v) => v / SECONDS_PER_UNIT[baseTimeUnit])],
    });
  }
  const costo = proceso('costPerCase');
  if (costo !== undefined && !costsComparable) notas.push(S.graficas.compararCostoNoComparable);
  else if (costo !== undefined) {
    graficas.push({
      titulo: S.graficas.compararCosto,
      series,
      colores,
      grupos: [grupo(costo, compareMetricLabel('process', 'costPerCase'), (v) => v)],
    });
  }
  const utilizacion = rows.filter((r) => r.scope === 'resources' && r.metric === 'utilization');
  if (utilizacion.length > 0) {
    graficas.push({
      titulo: S.graficas.compararUtilizacion,
      series,
      colores,
      grupos: utilizacion.map((r) => grupo(r, rowName(input.ir, input.resourceNames, 'resources', r.id) || (r.id ?? ''), (v) => v * 100)),
      tope: 100,
    });
  }
  return { graficas, notas };
}

function CompareCharts(props: CompareChartsInput): ReactNode {
  const S = useStrings();
  const [ref, ancho] = useAncho();
  const { graficas, notas } = compareCharts(props);
  if (graficas.length === 0 && notas.length === 0) return null;
  // The one-group charts (cycle time, cost) sit side by side while each keeps a readable plot;
  // otherwise they go full width, like utilization (QA of #512: at 800 px the plot fell to 72 px).
  const pequenas = graficas.filter((g) => g.grupos.length === 1);
  const grandes = graficas.filter((g) => g.grupos.length !== 1);
  const mitad = (ancho - 12) / 2;
  const juntas = pequenas.every((g) => geometriaBarras(g.grupos, mitad).anchoPlot >= PLOT_MINIMO);
  return (
    <section style={sectionStyle} data-grafica="comparar">
      <h2 style={{ ...h2Style, marginBottom: 8 }}>{S.graficas.comparar}</h2>
      <div ref={ref} className={juntas ? 'graficas-fila' : undefined} data-juntas={juntas}>
        {pequenas.map((g) => (
          <GraficaBarras key={g.titulo} {...g} />
        ))}
      </div>
      {grandes.map((g) => (
        <GraficaBarras key={g.titulo} {...g} />
      ))}
      {notas.map((nota) => (
        <p key={nota} className="grafica-nota">
          {nota}
        </p>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Selector de escenarios (checkboxes; la base siempre visible y va primero).
 * ------------------------------------------------------------------ */

const selectorRowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 12 };

function chipStyle(disabled: boolean): CSSProperties {
  return {
    alignItems: 'center',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    color: disabled ? 'var(--fg-muted)' : 'var(--fg-primary)',
    cursor: disabled ? 'default' : 'pointer',
    display: 'flex',
    font: 'inherit',
    gap: 6,
    padding: '4px 12px',
  };
}

const toggleAllStyle: CSSProperties = {
  alignItems: 'center',
  color: 'var(--fg-muted)',
  cursor: 'pointer',
  display: 'flex',
  gap: 6,
  marginBottom: 12,
};

const SCOPES: readonly CompareScope[] = ['elements', 'resources', 'process', 'flows'];

/** Estilo de aviso, igual que la sección "Avisos" de `ResultsView` (LILA-062): mismo token. */
const warningListStyle: CSSProperties = { color: 'var(--status-warning)', margin: '8px 0 0', paddingLeft: 20 };

export function CompareView({
  ir,
  comparison,
  scenarioNames,
  baseTimeUnit,
  resourceNames = {},
  runs,
  entries,
  seriesSlots,
}: CompareViewProps): ReactNode {
  const S = useStrings();
  // Se guardan los índices ocultos y no los visibles: así un escenario que aparezca después (el
  // shell puede recomparar con uno más sin remontar la vista) nace visible en vez de quedar
  // atrapado fuera de un array de booleanos que se quedó corto.
  const [hidden, setHidden] = useState<readonly number[]>([]);
  const [showAll, setShowAll] = useState(false);
  const isVisible = (index: number): boolean => index === 0 || !hidden.includes(index);

  function toggle(index: number): void {
    if (index === 0) return; // la base nunca se oculta.
    setHidden((current) =>
      current.includes(index) ? current.filter((value) => value !== index) : [...current, index],
    );
  }

  // Sin `runs` (compatibilidad hacia atrás, y mientras A no conecte OP-13) `compareWarnings([])`
  // da `costsComparable`/`significanceAvailable` en `true` y ningún aviso: no hay metadatos que
  // bloquear nada, exactamente el comportamiento previo a OP-05.
  const globalWarnings = compareWarnings(runs ?? []);
  const costsComparable = globalWarnings.costsComparable;
  const significanceAvailable = globalWarnings.significanceAvailable;
  const mixedReplicationDefinitions = globalWarnings.mixedReplicationDefinitions;
  const perRunWarnings = (runs ?? []).some((run) => (run.warnings?.length ?? 0) > 0);
  // #356/#385 (QA on PR #385): at least one compared run stored before 1.0.0-beta.1 (no `n`) and
  // not mixed with a new one — a legacy run compared against another legacy run, or against a run
  // with no replication summary at all (single replication) — is not the *mixed* case
  // `compareWarnings` warns about, but the reader still has to know that run's means use the old
  // definition. Shown once, not per column; `mixedReplicationDefinitions` already has its own,
  // more specific warning below, so this note is skipped when that one applies.
  const anyLegacy = !mixedReplicationDefinitions && (runs ?? []).some((run) => run.legacyReplications === true);
  const showWarningsPanel = runs !== undefined && (globalWarnings.warnings.length > 0 || perRunWarnings || anyLegacy);

  return (
    <div style={{ color: 'var(--fg-primary)', font: 'var(--font-size-base) var(--font-ui)' }}>
      <p style={{ color: 'var(--fg-muted)', margin: '0 0 12px' }}>
        {S.comparar.cabecera(baseTimeUnit)}
      </p>

      <div style={selectorRowStyle}>
        {scenarioNames.map((name, index) => (
          // Por índice y no por nombre: dos escenarios pueden llamarse igual.
          <label key={index} style={chipStyle(index === 0)}>
            <input
              checked={isVisible(index)}
              disabled={index === 0}
              onChange={() => toggle(index)}
              type="checkbox"
            />
            {index === 0 ? S.comparar.base(name) : name}
          </label>
        ))}
      </div>

      <label style={toggleAllStyle}>
        <input checked={showAll} onChange={() => setShowAll((current) => !current)} type="checkbox" />
        {S.comparar.mostrarTodos}
      </label>

      {/*
       * Un solo botón para toda la vista, no uno por tabla: el libro lleva la hoja Resumen de cada
       * escenario y la hoja Comparación completa, así que exportarlo desde cada ámbito daría el
       * mismo archivo cuatro veces. Los bytes se construyen al pulsar (issue #80).
       */}
      {entries !== undefined && entries.length > 0 && (
        <div style={selectorRowStyle}>
          <button
            type="button"
            style={exportButtonStyle}
            onClick={() =>
              downloadXlsx(
                `${scenarioNames.join(' vs ')}.xlsx`,
                compareWorkbook(ir, entries, comparison, getLocale()),
              )
            }
          >
            {S.resultados.exportarXlsx}
          </button>
        </div>
      )}

      {/*
       * Panel de avisos (OP-05, issue #210): los de `compareWarnings` (moneda/unidad/significancia/
       * semilla/réplicas) primero, y debajo los `warnings[]` propios de cada corrida —los mismos
       * que `ResultsView` ya mostraba por separado— para no perder ninguno al comparar.
       */}
      {showWarningsPanel && (
        <section style={sectionStyle}>
          <h2 style={h2Style}>{S.comparar.avisos}</h2>
          {globalWarnings.warnings.length > 0 && (
            <ul style={warningListStyle}>
              {globalWarnings.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {anyLegacy && <p style={{ ...notaStyle, margin: '8px 0 0' }}>{S.resultados.notaReplicacionesLegado}</p>}
          {(runs ?? []).map((run, index) => {
            const warnings = run.warnings ?? [];
            if (warnings.length === 0) return null;
            return (
              <details key={index} open={warnings.length <= 10}>
                <summary style={{ ...h2Style, fontSize: 13, margin: '12px 0 0' }}>
                  {index === 0 ? S.comparar.base(run.name) : run.name} ({warnings.length})
                </summary>
                <ul style={warningListStyle}>
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </details>
            );
          })}
        </section>
      )}

      <CompareCharts
        rows={comparison.rows}
        ir={ir}
        resourceNames={resourceNames}
        scenarioNames={scenarioNames}
        isVisible={isVisible}
        baseTimeUnit={baseTimeUnit}
        runs={runs}
        costsComparable={costsComparable}
        seriesSlots={seriesSlots}
      />

      {SCOPES.filter((scope) => scope !== 'flows' || showAll).map((scope) => {
        const rows = visibleCompareRows(comparison.rows, scope, showAll);
        if (rows.length === 0) return null;
        return (
          <DataTable
            key={scope}
            columns={compareColumns(
              scope,
              ir,
              resourceNames,
              scenarioNames,
              isVisible,
              baseTimeUnit,
              runs,
              costsComparable,
              significanceAvailable,
            )}
            rowKey={(row) => row.kpi}
            rows={rows}
            title={tabLabels()[scope]}
          />
        );
      })}

      <section style={sectionStyle}>
        <h2 style={h2Style}>{S.comparar.significancia}</h2>
        {!significanceAvailable && (
          <p style={{ color: 'var(--status-warning)', margin: '8px 0 0' }}>
            {mixedReplicationDefinitions ? S.comparar.sinSignificanciaMixtas : S.comparar.sinSignificancia}
          </p>
        )}
        <p style={{ color: 'var(--fg-muted)', margin: '8px 0 0' }}>
          <span style={significantMarkStyle}>{S.comparar.asterisco}</span>
          {S.comparar.leyenda}
        </p>
      </section>
    </div>
  );
}
