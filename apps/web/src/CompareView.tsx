/**
 * Vista de comparación (LILA-063): dos o más escenarios lado a lado, mismo `CompareResult` que
 * produce `compare()` (`packages/engine/src/core/compare.ts`, docs/RESULTS_FORMAT.md §11) y ya
 * imprime `lila compare` (LILA-047) en la CLI. Reutiliza `DataTable`/`sortRows`/estilos de
 * `ResultsView.tsx` (LILA-062): ninguna tabla ni función de formato se duplica aquí.
 *
 * Aceptación literal (BACKLOG LILA-063): "AS-IS vs TO-BE marca solo las celdas que cambian" — una
 * celda se resalta si y solo si `deltaAbs !== 0` para esa columna; nunca la columna base, cuyo
 * delta contra sí misma es siempre 0 (invariante de `compare()`).
 *
 * ponytail: el subconjunto curado de KPIs y las etiquetas Bizagi (docs/RESULTS_FORMAT.md §10) se
 * repiten aquí en vez de importarse de `packages/engine/src/cli.ts`: ese archivo es el binario de
 * la CLI (usa `node:fs`, no está en los `exports` de package.json) y no una librería pensada para
 * compartirse con la web. Si el subconjunto cambia en `lila compare`, hay que actualizar también
 * `DEFAULT_COMPARE_METRICS`/`BIZAGI_COMPARE_LABELS` aquí.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { formatDuration, formatNumber, formatSignedPercent, type BaseTimeUnit } from '@lila/engine/format';
import type { CompareResult, CompareRow, CompareScope, ProcessIR } from '@lila/engine';
import {
  DataTable,
  TAB_LABELS,
  h2Style,
  sectionStyle,
  type ColumnDef,
} from './ResultsView.js';

export interface CompareViewProps {
  ir: ProcessIR;
  comparison: CompareResult;
  /** En el mismo orden que los `RunResult` pasados a `compare()`; `scenarioNames[0]` es la base. */
  scenarioNames: readonly string[];
  baseTimeUnit: BaseTimeUnit;
  /** id de recurso -> nombre declarado en el escenario; cualquiera de los comparados sirve. */
  resourceNames?: Readonly<Record<string, string>>;
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
]);

const BIZAGI_COMPARE_LABELS: Readonly<Record<string, string>> = {
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
  'resources:utilization': 'Utilization (%)',
  'resources:busyTime': 'Busy time',
  'resources:fixedCost': 'Fixed cost',
  'resources:unitCost': 'Unit cost',
  'resources:totalCost': 'Total cost',
  'flows:count': 'Instances/Tokens completed',
};

const DURATION_METRIC_PREFIXES: ReadonlySet<string> = new Set([
  'processing',
  'resourceWait',
  'offHoursWait',
  'cycleTime',
  'waitTime',
  'busyTime',
]);

function isDurationMetric(metric: string): boolean {
  return DURATION_METRIC_PREFIXES.has(metric.split('.')[0] ?? '');
}

/** Exportada para que el test ubique la fila de un KPI por su etiqueta sin adivinar el HTML. */
export function compareMetricLabel(scope: CompareScope, metric: string): string {
  return BIZAGI_COMPARE_LABELS[`${scope}:${metric}`] ?? metric;
}

/** Igual que `formatCompareValue` de `lila compare`: guion para `null`, % para utilización. */
function formatCellValue(metric: string, value: number | null, unit: BaseTimeUnit): string {
  if (value === null) return '-';
  if (isDurationMetric(metric)) return formatDuration(value, unit);
  if (metric === 'utilization') return `${formatNumber(value * 100)}%`;
  return formatNumber(value);
}

/** Filas de un scope; con `showAll = false` solo el subconjunto curado (BACKLOG LILA-047). */
export function visibleCompareRows(
  rows: readonly CompareRow[],
  scope: CompareScope,
  showAll: boolean,
): CompareRow[] {
  return rows.filter((row) => row.scope === scope && (showAll || DEFAULT_COMPARE_METRICS.has(`${scope}:${row.metric}`)));
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

function scenarioColumn(index: number, name: string, unit: BaseTimeUnit): ColumnDef<CompareRow> {
  return {
    display: (row): ReactNode => {
      const value = row.values[index] ?? null;
      const valueText = formatCellValue(row.metric, value, unit);
      if (index === 0 || value === null) return valueText;
      const deltaRel = row.deltaRel[index] ?? null;
      const deltaText = deltaRel === null ? '-' : formatSignedPercent(deltaRel);
      const significant = row.significant[index] ?? false;
      return (
        <>
          {valueText} ({deltaText})
          {significant && (
            <span style={significantMarkStyle} title="Diferencia significativa (IC95 disjuntos)">
              {' '}
              *
            </span>
          )}
        </>
      );
    },
    cellStyle: (row): CSSProperties => ((row.deltaAbs[index] ?? 0) !== 0 ? highlightStyle : {}),
    header: index === 0 ? `${name} (base)` : name,
    key: `scenario-${index}`,
    numeric: true,
    sortValue: (row) => row.values[index] ?? Number.NEGATIVE_INFINITY,
  };
}

function scopeColumns(
  scope: CompareScope,
  ir: ProcessIR,
  resourceNames: Readonly<Record<string, string>>,
  scenarioNames: readonly string[],
  visible: readonly boolean[],
  unit: BaseTimeUnit,
): ColumnDef<CompareRow>[] {
  const idColumns: ColumnDef<CompareRow>[] =
    scope === 'process'
      ? []
      : [
          { display: (row) => row.id ?? '', header: 'Id', key: 'id', sortValue: (row) => row.id ?? '' },
          {
            display: (row) => rowName(ir, resourceNames, scope, row.id),
            header: 'Name',
            key: 'name',
            sortValue: (row) => rowName(ir, resourceNames, scope, row.id),
          },
        ];
  const metricColumn: ColumnDef<CompareRow> = {
    display: (row) => compareMetricLabel(row.scope, row.metric),
    header: 'Metric',
    key: 'metric',
    sortValue: (row) => row.metric,
  };
  const scenarioColumns = scenarioNames
    .map((name, index) => (visible[index] === true ? scenarioColumn(index, name, unit) : null))
    .filter((column): column is ColumnDef<CompareRow> => column !== null);

  return [...idColumns, metricColumn, ...scenarioColumns];
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
    borderRadius: 999,
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

export function CompareView({
  ir,
  comparison,
  scenarioNames,
  baseTimeUnit,
  resourceNames = {},
}: CompareViewProps): ReactNode {
  const [visible, setVisible] = useState<boolean[]>(scenarioNames.map(() => true));
  const [showAll, setShowAll] = useState(false);

  function toggle(index: number): void {
    if (index === 0) return; // la base nunca se oculta.
    setVisible((current) => current.map((value, candidate) => (candidate === index ? !value : value)));
  }

  return (
    <div style={{ color: 'var(--fg-primary)', font: 'var(--font-size-base) var(--font-ui)' }}>
      <p style={{ color: 'var(--fg-muted)', margin: '0 0 12px' }}>
        Unidad de tiempo {baseTimeUnit} (escenario base) · Utilización en %
      </p>

      <div style={selectorRowStyle}>
        {scenarioNames.map((name, index) => (
          <label key={name} style={chipStyle(index === 0)}>
            <input
              checked={visible[index] === true}
              disabled={index === 0}
              onChange={() => toggle(index)}
              type="checkbox"
            />
            {index === 0 ? `${name} (base)` : name}
          </label>
        ))}
      </div>

      <label style={toggleAllStyle}>
        <input checked={showAll} onChange={() => setShowAll((current) => !current)} type="checkbox" />
        Mostrar todos los KPI
      </label>

      {SCOPES.filter((scope) => scope !== 'flows' || showAll).map((scope) => {
        const rows = visibleCompareRows(comparison.rows, scope, showAll);
        if (rows.length === 0) return null;
        return (
          <DataTable
            key={scope}
            columns={scopeColumns(scope, ir, resourceNames, scenarioNames, visible, baseTimeUnit)}
            rowKey={(row) => row.kpi}
            rows={rows}
            title={TAB_LABELS[scope]}
          />
        );
      })}

      <section style={sectionStyle}>
        <h2 style={h2Style}>Significancia</h2>
        <p style={{ color: 'var(--fg-muted)', margin: '8px 0 0' }}>
          <span style={significantMarkStyle}>*</span> diferencia significativa (IC95 sin
          solapamiento). Las celdas resaltadas son las que cambiaron contra la base.
        </p>
      </section>
    </div>
  );
}
