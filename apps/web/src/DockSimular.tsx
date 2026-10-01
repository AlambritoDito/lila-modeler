/**
 * The Simulate dock (#394, design Turno 2 option 2a): a resizable strip under the canvas with the
 * scenario's KPIs and four tabs — quick results, bottlenecks, run log and warnings. A finished run
 * opens it on «Quick results» instead of jumping to the Results mode; the full Results view stays
 * one click away («Open in Results», `onAbrirResultados`).
 *
 * Everything shown is read from the run as it is: the `RunResult` of the engine and the event log
 * sample the shell keeps (`App.tsx`, `logs`). The only numbers computed here are the per-activity
 * wait percentiles and the pools each activity used, both from that log, with the engine's own
 * definitions (linear-interpolated percentile, `docs/RESULTS_FORMAT.md` § 5; utilization as the
 * busiest pool the element used, § 6).
 */
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { formatDuration, formatNumber, type BaseTimeUnit } from '@lila-modeler/engine/format';
import type { ResolvedScenario } from '@lila-modeler/engine/schema';
import type { EventLogRow, ProcessIR, RunResult } from '@lila-modeler/engine';
import { BottleneckCard, buildResultCsvExports, downloadCsv, tableStyle, tdStyle, thStyle } from './ResultsView';
import { GraficaDeInstancias, GraficaDeUtilizacion, type LogDeCorrida } from './GraficasResultados';
import { useStrings } from './i18n';
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
  esperaP50: number | null;
  esperaP95: number | null;
  utilizacion: number | null;
  costo: number;
}

/** Same percentile as the engine's (`core/metrics.ts`): linear interpolation at `(n − 1) · p`. */
function percentil(ordenados: readonly number[], p: number): number {
  const posicion = (ordenados.length - 1) * p;
  const abajo = Math.floor(posicion);
  const izquierda = ordenados[abajo]!;
  return abajo === Math.ceil(posicion) ? izquierda : izquierda + (ordenados[abajo + 1]! - izquierda) * (posicion - abajo);
}

/**
 * The quick results table: one row per task (events and gateways repeat their neighbours' counts,
 * as in `instanciasPorTarea`) plus the total row. Wait p50/p95 per task come from the log sample
 * (one value per started activity instance); without a log they are `null`. The total row is the
 * process: completed cases, the per-case wait percentiles and the sum of the cost column.
 */
export function filasRapidas(ir: ProcessIR, result: RunResult, log: LogDeCorrida | undefined): { filas: FilaRapida[]; total: FilaRapida } {
  const esperas = new Map<string, Map<string, number>>();
  const pools = new Map<string, Set<string>>();
  for (const fila of log?.rows ?? [] as readonly EventLogRow[]) {
    if (fila.resourceId !== null) {
      const usados = pools.get(fila.elementId) ?? new Set<string>();
      usados.add(fila.resourceId);
      pools.set(fila.elementId, usados);
    }
    if (fila.startedAt === null) continue;
    // Several rows (one per pool allocation) share an activity instance and its wait.
    const instancias = esperas.get(fila.elementId) ?? new Map<string, number>();
    instancias.set(`${fila.replication}|${fila.activityInstanceId}`, fila.resourceWait);
    esperas.set(fila.elementId, instancias);
  }
  const filas = Object.entries(result.elements)
    .filter(([id]) => ir.nodes[id]?.type === 'task')
    .map(([id, m]): FilaRapida => {
      const valores = [...(esperas.get(id)?.values() ?? [])].sort((a, b) => a - b);
      const usados = pools.get(id);
      const cuello = result.bottlenecks.find((b) => b.elementId === id);
      const utilizacion = usados !== undefined
        ? Math.max(...[...usados].map((pool) => result.resources[pool]?.utilization ?? 0))
        : cuello?.utilization ?? null;
      return {
        id,
        nombre: ir.nodes[id]?.name || id,
        casos: m.completed,
        esperaP50: valores.length > 0 ? percentil(valores, 0.5) : null,
        esperaP95: valores.length > 0 ? percentil(valores, 0.95) : null,
        utilizacion,
        costo: m.fixedCostTotal,
      };
    });
  const conCasos = result.process.completed > 0;
  return {
    filas,
    total: {
      id: '',
      nombre: '',
      casos: result.process.completed,
      esperaP50: conCasos ? result.process.waitTime.p50 : null,
      esperaP95: conCasos ? result.process.waitTime.p95 : null,
      utilizacion: null,
      costo: filas.reduce((suma, f) => suma + f.costo, 0),
    },
  };
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
  const avisos = [
    ...(corrida?.result.warnings ?? []).map((mensaje): AvisoDock => ({ mensaje, severidad: 'warning' })),
    ...props.avisos,
  ];
  const etiqueta = (p: PestanaDock): string => (p === 'avisos' && avisos.length > 0 ? `${S.dock.pestanas[p]} (${avisos.length})` : S.dock.pestanas[p]);

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
      <div className="dock-cabecera">
        <div role="tablist" aria-label={S.dock.region} className="dock-pestanas">
          {PESTANAS_DOCK.map((p) => (
            <button key={p} type="button" role="tab" id={`${id}-tab-${p}`} aria-controls={`${id}-panel`}
              aria-selected={p === pestana} tabIndex={p === pestana ? 0 : -1}
              className={p === pestana ? 'pestana activa' : 'pestana'}
              onClick={() => onPestana(p)} onKeyDown={teclaPestana}>
              {etiqueta(p)}
            </button>
          ))}
        </div>
        {conCorrida && <Kpis result={corrida.result} scenario={corrida.scenario} />}
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
        {pestana === 'avisos' ? <Avisos avisos={avisos} />
          : !conCorrida ? vacio
            : pestana === 'rapidos' ? <Rapidos ir={ir} result={corrida.result} scenario={corrida.scenario} log={props.log} />
              : pestana === 'cuellos'
                ? <BottleneckCard bottlenecks={corrida.result.bottlenecks} ir={ir} unit={corrida.scenario.run.baseTimeUnit as BaseTimeUnit} onElegir={props.onSeleccionar} />
                : <Log ir={ir} scenario={corrida.scenario} log={props.log} />}
      </div>
    </section>
  );
}

/** The scenario's KPIs: the same Process figures the Results view prints. */
function Kpis({ result, scenario }: { result: RunResult; scenario: ResolvedScenario }): ReactNode {
  const S = useStrings();
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  const moneda = scenario.run.currency;
  const kpis: [string, string][] = [
    [S.dock.kpis.completados, formatNumber(result.process.completed)],
    [S.dock.kpis.cicloMedio(unit), result.process.completed > 0 ? formatDuration(result.process.cycleTime.mean, unit) : '—'],
    [S.dock.kpis.throughput, formatNumber(result.process.throughputPerHour)],
    [S.dock.kpis.costoTotal, `${formatNumber(result.process.totalCost)}${moneda === undefined ? '' : ` ${moneda}`}`],
  ];
  return (
    <dl className="dock-kpis">
      {kpis.map(([nombre, valor]) => <div key={nombre}><dt>{nombre}</dt><dd>{valor}</dd></div>)}
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
  const { filas, total } = filasRapidas(ir, result, log);
  const celdas = (f: FilaRapida): ReactNode => (
    <>
      <td style={numero()}>{formatNumber(f.casos)}</td>
      <td style={numero()}>{guion(f.esperaP50, (v) => formatDuration(v, unit))}</td>
      <td style={numero()}>{guion(f.esperaP95, (v) => formatDuration(v, unit))}</td>
      <td style={numero()}>{guion(f.utilizacion, (v) => formatNumber(v * 100))}</td>
      <td style={numero()}>{formatNumber(f.costo)}</td>
    </>
  );
  return (
    <>
      <table style={tableStyle} className="dock-rapidos">
        <thead>
          <tr>
            <th scope="col" style={th()}>{S.dock.columnas.actividad}</th>
            <th scope="col" style={{ ...th(), textAlign: 'right' }}>{S.dock.columnas.casos}</th>
            <th scope="col" style={{ ...th(), textAlign: 'right' }}>{S.dock.columnas.esperaP50(unit)}</th>
            <th scope="col" style={{ ...th(), textAlign: 'right' }}>{S.dock.columnas.esperaP95(unit)}</th>
            <th scope="col" style={{ ...th(), textAlign: 'right' }}>{S.dock.columnas.utilizacion}</th>
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
      <p className="dock-nota">{log === undefined ? S.dock.notaSinLog : S.dock.notaPercentiles}</p>
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

function Avisos({ avisos }: { avisos: readonly AvisoDock[] }): ReactNode {
  const S = useStrings();
  if (avisos.length === 0) return <p className="vacio">{S.dock.sinAvisos}</p>;
  return (
    <ul className="dock-avisos">
      {avisos.map((a, i) => <li key={i} className={a.severidad === 'error' ? 'error' : 'aviso'}>{a.mensaje}</li>)}
    </ul>
  );
}
