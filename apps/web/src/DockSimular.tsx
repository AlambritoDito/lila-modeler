/**
 * The Simulate dock (#394, design Turno 2 option 2a): a resizable strip under the canvas with the
 * scenario's KPIs and four tabs — quick results, bottlenecks, run log and warnings. A finished run
 * opens it on «Quick results» instead of jumping to the Results mode; the full Results view stays
 * one click away («Open in Results», `onAbrirResultados`).
 *
 * Everything shown is read from the run as it is: the `RunResult` of the engine and the event log
 * sample the shell keeps (`App.tsx`, `logs`). The only numbers computed here are the per-activity
 * wait p95 (the shared `percentilesPorElemento`, over the log sample) and the pools each activity
 * used (utilization as the busiest pool the element used, the engine's bottleneck definition,
 * `docs/RESULTS_FORMAT.md` § 6).
 */
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { formatDuration, formatNumber, SECONDS_PER_UNIT, type BaseTimeUnit } from '@lila-modeler/engine/format';
import type { ResolvedScenario } from '@lila-modeler/engine/schema';
import type { ProcessIR, RunResult } from '@lila-modeler/engine';
import { BottleneckCard, buildResultCsvExports, downloadCsv, tableStyle, tdStyle, thStyle } from './ResultsView';
import { GraficaDeInstancias, GraficaDeUtilizacion, type LogDeCorrida } from './GraficasResultados';
import { useStrings } from './i18n';
import { agruparAvisos, AvisoAgrupado, type GrupoAvisos } from './avisos';
import { esperaCorta } from './BottleneckOverlay';
import { ESPERA_RECURSO, p95Fiable, percentilesPorElemento } from './percentilesPorElemento';
import './DockSimular.css';

export const PESTANAS_DOCK = ['rapidos', 'cuellos', 'log', 'avisos'] as const;
export type PestanaDock = (typeof PESTANAS_DOCK)[number];

/** Rows of the run log drawn at most: the sample holds up to ten thousand. */
export const FILAS_LOG = 500;

/** One row of the quick results table; `null` is «no value» (drawn as —), never zero. */
export interface FilaRapida {
  id: string;
  nombre: string;
  casos: number;
  /** `elements[id].resourceWait.mean`: every replication, the same figure as the Results view. */
  esperaMedia: number | null;
  /** 95th percentile of the same wait over the log sample (`percentilesPorElemento`). */
  esperaP95: number | null;
  utilizacion: number | null;
  costo: number;
}


/**
 * The quick results table: one row per task (events and gateways repeat their neighbours' counts,
 * as in `instanciasPorTarea`) plus the total row. The mean wait is the engine's, over every
 * replication; the p95 is the shared per-element percentile over the log sample (measured cohort
 * only, one value per completed instance), `null` without a log. The total row carries the cases
 * and the fixed cost only: the process wait per case is another quantity (QA of #394).
 */
export function filasRapidas(ir: ProcessIR, result: RunResult, scenario: ResolvedScenario, log: LogDeCorrida | undefined): { filas: FilaRapida[]; total: FilaRapida } {
  // Same rule as the properties quick view (`p95Fiable`): no p95 from a truncated sample.
  const p95 = !p95Fiable(log) ? new Map<string, number[]>()
    : percentilesPorElemento(log.rows, [0.95], { warmup: scenario.run.warmup, medida: ESPERA_RECURSO });
  const pools = new Map<string, Set<string>>();
  for (const fila of log?.rows ?? []) {
    if (fila.resourceId === null) continue;
    const usados = pools.get(fila.elementId) ?? new Set<string>();
    usados.add(fila.resourceId);
    pools.set(fila.elementId, usados);
  }
  const filas = Object.entries(result.elements)
    .filter(([id]) => ir.nodes[id]?.type === 'task')
    .map(([id, m]): FilaRapida => {
      const usados = pools.get(id);
      const cuello = result.bottlenecks.find((b) => b.elementId === id);
      const utilizacion = usados !== undefined
        ? Math.max(...[...usados].map((pool) => result.resources[pool]?.utilization ?? 0))
        : cuello?.utilization ?? null;
      const percentil95 = p95.get(id)?.[0];
      return {
        id,
        nombre: ir.nodes[id]?.name || id,
        casos: m.completed,
        esperaMedia: m.started > 0 ? m.resourceWait.mean : null,
        esperaP95: percentil95 === undefined || Number.isNaN(percentil95) ? null : percentil95,
        utilizacion,
        costo: m.fixedCostTotal,
      };
    });
  return {
    filas,
    total: {
      id: '',
      nombre: '',
      casos: result.process.completed,
      esperaMedia: null,
      esperaP95: null,
      utilizacion: null,
      costo: filas.reduce((suma, f) => suma + f.costo, 0),
    },
  };
}

/**
 * The Warnings tab: the run's warnings, then the live lint minus what the run already says (the
 * lint repeats some of them without their code), grouped by code (QA of #394).
 */
export function avisosDelDock(warnings: readonly string[], lint: readonly AvisoDock[]): GrupoAvisos[] {
  return agruparAvisos([
    ...warnings.map((mensaje): AvisoDock => ({ mensaje, severidad: 'warning' })),
    ...lint.filter((a) => !warnings.some((w) => w.includes(a.mensaje))),
  ]);
}

/** A problem of the scenario or the model, or the failed Run, for the Warnings tab. */
export interface AvisoDock {
  mensaje: string;
  severidad: 'error' | 'warning';
}

export interface DockSimularProps {
  /** Region id, for `aria-controls` of its divider and the panel toggles. */
  id: string;
  ir: ProcessIR | null;
  /** The current run of the active scenario, or `null` (none yet, or invalidated by an edit). */
  corrida: { result: RunResult; scenario: ResolvedScenario } | null;
  log: LogDeCorrida | undefined;
  /** The live lint of the scenario and the model, plus a failed Run. */
  avisos: readonly AvisoDock[];
  pestana: PestanaDock;
  onPestana: (pestana: PestanaDock) => void;
  /** Pick an element on the canvas (a bottleneck). */
  onSeleccionar: (elementId: string) => void;
  onAbrirResultados: () => void;
  /** Run from the empty state; `puedeEjecutar` false disables it (no canvas, or a run in flight). */
  onEjecutar: () => void;
  puedeEjecutar: boolean;
}

const guion = (valor: number | null, texto: (v: number) => string): string => (valor === null ? '—' : texto(valor));

export function DockSimular(props: DockSimularProps): ReactNode {
  const S = useStrings();
  const { id, ir, corrida, pestana, onPestana } = props;
  const conCorrida = corrida !== null && ir !== null;
  const grupos = avisosDelDock(corrida?.result.warnings ?? [], props.avisos);
  const etiqueta = (p: PestanaDock): string => (p === 'avisos' && grupos.length > 0 ? `${S.dock.pestanas[p]} (${grupos.length})` : S.dock.pestanas[p]);

  /** ARIA tabs with automatic activation: arrows wrap, Home/End go to the ends. */
  function teclaPestana(e: KeyboardEvent<HTMLButtonElement>): void {
    const i = PESTANAS_DOCK.indexOf(pestana);
    const n = PESTANAS_DOCK.length;
    const destino = e.key === 'ArrowRight' ? (i + 1) % n
      : e.key === 'ArrowLeft' ? (i - 1 + n) % n
        : e.key === 'Home' ? 0
          : e.key === 'End' ? n - 1 : null;
    if (destino === null) return;
    e.preventDefault();
    const siguiente = PESTANAS_DOCK[destino]!;
    onPestana(siguiente);
    e.currentTarget.parentElement?.querySelector<HTMLElement>(`#${id}-tab-${siguiente}`)?.focus();
  }

  const vacio = (
    <div className="dock-vacio">
      <p className="vacio">{S.dock.vacio}</p>
      <button type="button" className="boton primario" disabled={!props.puedeEjecutar} onClick={props.onEjecutar}>{S.dock.ejecutar}</button>
    </div>
  );

  return (
    <section id={id} className="dock-simular" aria-label={S.dock.region}>
      {/* The run no longer changes mode, so its end is announced here (QA of #394). */}
      <p role="status" className="dock-anuncio">{conCorrida ? S.dock.corridaTerminada(formatNumber(Math.round(corrida.result.process.completed))) : ''}</p>
      <div className="dock-cabecera">
        <div role="tablist" aria-label={S.dock.vistas} className="dock-pestanas">
          {PESTANAS_DOCK.map((p) => (
            <button key={p} type="button" role="tab" id={`${id}-tab-${p}`} aria-controls={`${id}-panel`}
              aria-selected={p === pestana} tabIndex={p === pestana ? 0 : -1}
              className={p === pestana ? 'pestana activa' : 'pestana'}
              onClick={() => onPestana(p)} onKeyDown={teclaPestana}>
              {etiqueta(p)}
            </button>
          ))}
        </div>
        {conCorrida && <Kpis ir={ir} result={corrida.result} scenario={corrida.scenario} onSeleccionar={props.onSeleccionar} />}
        <div className="dock-acciones">
          <button type="button" className="boton" disabled={!conCorrida} onClick={props.onAbrirResultados}>{S.dock.abrirResultados}</button>
          <button type="button" className="boton" disabled={!conCorrida} title={S.dock.tituloExportar}
            onClick={() => { if (conCorrida) downloadCsv('elements.csv', buildResultCsvExports(ir, corrida.scenario, corrida.result).elements); }}>
            {S.dock.exportarCsv}
          </button>
        </div>
      </div>
      {/* One panel whose content follows the tab: focusable, so a long table scrolls by keyboard. */}
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${pestana}`} tabIndex={0} className="dock-panel">
        {pestana === 'avisos' ? <Avisos grupos={grupos} />
          : !conCorrida ? vacio
            : pestana === 'rapidos' ? <Rapidos ir={ir} result={corrida.result} scenario={corrida.scenario} log={props.log} />
              : pestana === 'cuellos'
                ? <BottleneckCard bottlenecks={corrida.result.bottlenecks} ir={ir} unit={corrida.scenario.run.baseTimeUnit as BaseTimeUnit} onElegir={props.onSeleccionar} />
                : <Log ir={ir} scenario={corrida.scenario} log={props.log} />}
      </div>
    </section>
  );
}

const redondear = (valor: number, decimales: number): number => Math.round(valor * 10 ** decimales) / 10 ** decimales;

/**
 * The scenario's KPIs, the Process figures of the Results view rounded for a summary (the exact
 * value is the `title`), and the main bottleneck as a button that picks it on the canvas, so it is
 * read without changing tab.
 */
function Kpis({ ir, result, scenario, onSeleccionar }: {
  ir: ProcessIR; result: RunResult; scenario: ResolvedScenario; onSeleccionar: (elementId: string) => void;
}): ReactNode {
  const S = useStrings();
  const moneda = scenario.run.currency === undefined ? '' : ` ${scenario.run.currency}`;
  const p = result.process;
  const kpis: [string, string, string][] = [
    [S.dock.kpis.completados, formatNumber(Math.round(p.completed)), formatNumber(p.completed)],
    [S.dock.kpis.cicloMedio, p.completed > 0 ? esperaCorta(p.cycleTime.mean) : '—', formatNumber(p.cycleTime.mean)],
    [S.dock.kpis.throughput, formatNumber(redondear(p.throughputPerHour, 2)), formatNumber(p.throughputPerHour)],
    [S.dock.kpis.costoTotal, `${formatNumber(redondear(p.totalCost, 2))}${moneda}`, `${formatNumber(p.totalCost)}${moneda}`],
  ];
  const cuello = result.bottlenecks[0];
  return (
    <dl className="dock-kpis">
      {kpis.map(([nombre, valor, exacto]) => <div key={nombre}><dt>{nombre}</dt><dd title={exacto}>{valor}</dd></div>)}
      {cuello !== undefined && (
        <div className="dock-cuello">
          <dt>{S.dock.kpis.cuello}</dt>
          <dd>
            <button type="button" className="enlace" onClick={() => onSeleccionar(cuello.elementId)}>
              {ir.nodes[cuello.elementId]?.name || cuello.elementId}
              {' · '}
              {S.lienzo.cuelloEtiqueta(esperaCorta(result.elements[cuello.elementId]?.resourceWait.mean ?? 0), Math.round(cuello.utilization * 100))}
            </button>
          </dd>
        </div>
      )}
    </dl>
  );
}

/**
 * Cell styles of the dock's tables, built from the Results ones. Functions, not module constants:
 * suites that mock `./ResultsView` (App's) must be able to import this file without them.
 */
const th = (): CSSProperties => ({ ...thStyle, cursor: 'default' });
const numero = (): CSSProperties => ({ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' });

function Rapidos({ ir, result, scenario, log }: { ir: ProcessIR; result: RunResult; scenario: ResolvedScenario; log: LogDeCorrida | undefined }): ReactNode {
  const S = useStrings();
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  const { filas, total } = filasRapidas(ir, result, scenario, log);
  // Without a usable sample there is no p95 column at all; the note says why (QA of #394).
  const conP95 = p95Fiable(log);
  const tiempo = (segundos: number): string => formatNumber(redondear(segundos / SECONDS_PER_UNIT[unit], 2));
  const celdas = (f: FilaRapida): ReactNode => (
    <>
      {/* Whole cases: a mean over replications (1485.23…) reads as a count (QA of #394). */}
      <td style={numero()} title={formatNumber(f.casos)}>{formatNumber(Math.round(f.casos))}</td>
      {/* Rounded like the KPIs, the exact value as the title (QA of #394). */}
      <td style={numero()} title={guion(f.esperaMedia, (v) => formatDuration(v, unit))}>{guion(f.esperaMedia, tiempo)}</td>
      {conP95 && <td style={numero()} title={guion(f.esperaP95, (v) => formatDuration(v, unit))}>{guion(f.esperaP95, tiempo)}</td>}
      <td style={numero()} title={guion(f.utilizacion, (v) => formatNumber(v * 100))}>{guion(f.utilizacion, (v) => formatNumber(redondear(v * 100, 1)))}</td>
      <td style={numero()} title={formatNumber(f.costo)}>{formatNumber(redondear(f.costo, 2))}</td>
    </>
  );
  return (
    <>
      <table style={tableStyle} className="dock-rapidos">
        <thead>
          <tr>
            <th scope="col" style={th()}>{S.dock.columnas.actividad}</th>
            <th scope="col" style={{ ...th(), textAlign: 'right' }}>{S.dock.columnas.casos}</th>
            <th scope="col" style={{ ...th(), textAlign: 'right' }}>{S.dock.columnas.esperaMedia(unit)}</th>
            {conP95 && <th scope="col" style={{ ...th(), textAlign: 'right' }}>{S.dock.columnas.esperaP95(unit)}</th>}
            <th scope="col" style={{ ...th(), textAlign: 'right' }} title={S.dock.columnas.utilizacionTitulo}>{S.dock.columnas.utilizacion}</th>
            <th scope="col" style={{ ...th(), textAlign: 'right' }}>{S.dock.columnas.costo}</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => <tr key={f.id}><th scope="row" style={{ ...tdStyle, fontWeight: 'normal', textAlign: 'left' }}>{f.nombre}</th>{celdas(f)}</tr>)}
        </tbody>
        <tfoot>
          <tr className="total"><th scope="row" style={{ ...tdStyle, textAlign: 'left' }}>{S.dock.total}</th>{celdas(total)}</tr>
        </tfoot>
      </table>
      <p className="dock-nota">
        {log === undefined ? S.dock.notaSinLog : log.truncated ? S.dock.muestraParcial(log.rows.length) : S.dock.notaPercentiles(log.rows.length)}
      </p>
      <div className="graficas-fila">
        <GraficaDeInstancias ir={ir} result={result} scenario={scenario} />
        <GraficaDeUtilizacion result={result} scenario={scenario} nombres={Object.fromEntries(Object.entries(scenario.resources ?? {}).map(([id, r]) => [id, r.name ?? id]))} />
      </div>
    </>
  );
}

function Log({ ir, scenario, log }: { ir: ProcessIR; scenario: ResolvedScenario; log: LogDeCorrida | undefined }): ReactNode {
  const S = useStrings();
  if (log === undefined) return <p className="vacio">{S.dock.sinLog}</p>;
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  const filas = log.rows.slice(0, FILAS_LOG);
  const tiempo = (v: number | null): string => guion(v, (x) => formatDuration(x, unit));
  return (
    <>
      {log.truncated && <p className="dock-nota" role="note">{S.dock.logTruncado(log.rows.length)}</p>}
      {log.rows.length > FILAS_LOG && <p className="dock-nota">{S.dock.logMostrando(FILAS_LOG, log.rows.length)}</p>}
      <table style={tableStyle} className="dock-log">
        <thead>
          <tr>
            {[S.dock.log.caso, S.dock.log.elemento, S.dock.log.recurso].map((c) => <th key={c} scope="col" style={th()}>{c}</th>)}
            {[S.dock.log.habilitada(unit), S.dock.log.inicio(unit), S.dock.log.fin(unit), S.dock.log.espera(unit), S.dock.log.costo]
              .map((c) => <th key={c} scope="col" style={{ ...th(), textAlign: 'right' }}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>
              <td style={tdStyle}>{f.caseId}</td>
              <td style={tdStyle}>{ir.nodes[f.elementId]?.name || f.elementId}</td>
              <td style={tdStyle}>{f.resourceId === null ? '—' : scenario.resources?.[f.resourceId]?.name ?? f.resourceId}</td>
              <td style={numero()}>{tiempo(f.enabledAt)}</td>
              <td style={numero()}>{tiempo(f.startedAt)}</td>
              <td style={numero()}>{tiempo(f.endedAt)}</td>
              <td style={numero()}>{tiempo(f.resourceWait)}</td>
              <td style={numero()}>{formatNumber(f.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Avisos({ grupos }: { grupos: readonly GrupoAvisos[] }): ReactNode {
  const S = useStrings();
  if (grupos.length === 0) return <p className="vacio">{S.dock.sinAvisos}</p>;
  return <ul className="dock-avisos">{grupos.map((g) => <AvisoAgrupado key={g.clave} grupo={g} />)}</ul>;
}
