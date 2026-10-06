/**
 * The results table under the Results map (Lote M, design 05; it took the place of the Simulate
 * dock of #394): a header with the title, the exports and the collapse button, and four ARIA tabs —
 * Tasks (the design's table), Full results (the four sections of the Results view with their
 * charts and CSV/XLSX, passed in as `detalle`), the run log and the warnings. The KPIs and the
 * bottlenecks the dock showed are in the Results summary panel (`PanelResumen.tsx`).
 *
 * Everything shown is read from the run as it is: the engine's `RunResult`, the scenario it ran
 * and the event log sample the shell keeps (`App.tsx`, `logs`).
 */
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import { formatNumber, SECONDS_PER_UNIT, type BaseTimeUnit } from '@lila-modeler/engine/format';
import type { ResolvedScenario } from '@lila-modeler/engine/schema';
import type { ProcessIR, RunResult } from '@lila-modeler/engine';
import { resourceNamesOf, scenarioWorkbook } from '@lila-modeler/engine/xlsx-report';
import { buildResultCsvExports, downloadCsv, downloadXlsx, tableStyle, tdStyle, thStyle } from './ResultsView';
import type { LogDeCorrida } from './GraficasResultados';
import { exactDuration, formatDisplay, formatDisplayDurationWithUnit } from './formatDisplay';
import { getLocale, useStrings } from './i18n';
import { agruparAvisos, AvisoAgrupado, type GrupoAvisos } from './avisos';
import './DockSimular.css';

export const PESTANAS_DOCK = ['tareas', 'detalle', 'log', 'avisos'] as const;
export type PestanaDock = (typeof PESTANAS_DOCK)[number];

/** Rows of the run log drawn at most: the sample holds up to ten thousand. */
export const FILAS_LOG = 500;

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

export interface TablaResultadosProps {
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
  /** Pick a task on the canvas (a row of the table). */
  onSeleccionar: (elementId: string) => void;
  /** Collapsed: only the header row (⌘J, its ▸ button or its divider's Enter). */
  plegada: boolean;
  onPlegar: () => void;
  /** The full Results view (its four sections, charts and exports): the «Full results» tab. */
  detalle: ReactNode;
  /** Element selected on the canvas, marked in the table. */
  seleccion?: string | null;
}

const guion = (valor: number | null, texto: (v: number) => string): string => (valor === null ? '—' : texto(valor));

/** One row of the Tasks tab (Lote M, design 05): what the engine measured for each task. */
export interface FilaTarea {
  id: string;
  nombre: string;
  /** Names of the resources the scenario assigns to it, `[]` = nobody. */
  recursos: string[];
  casos: number;
  proceso: number;
  espera: number;
  /** The busiest of its resources (`null` without resources). */
  utilizacion: number | null;
  costo: number;
}

/**
 * The Tasks tab: one row per task of the IR the run measured, in the diagram's order. The
 * resources and their utilization come from the scenario's assignments (no log needed, so a run
 * reopened from a file has them too); the cost is the task's own fixed cost (`fixedCostTotal`):
 * the engine does not split resource cost per task, and the table says so.
 */
export function filasTareas(ir: ProcessIR, result: RunResult, scenario: ResolvedScenario): FilaTarea[] {
  return Object.entries(ir.nodes)
    .filter(([id, nodo]) => nodo.type === 'task' && result.elements[id] !== undefined)
    .map(([id, nodo]): FilaTarea => {
      const m = result.elements[id]!;
      const usos = (scenario.elements?.[id] as { resources?: { ref: string }[] } | undefined)?.resources ?? [];
      const utilizaciones = usos.map((u) => result.resources[u.ref]?.utilization).filter((u): u is number => u !== undefined);
      return {
        id,
        nombre: nodo.name || id,
        recursos: usos.map((u) => scenario.resources?.[u.ref]?.name ?? u.ref),
        casos: m.completed,
        proceso: m.processing.mean,
        espera: m.resourceWait.mean,
        utilizacion: utilizaciones.length === 0 ? null : Math.max(...utilizaciones),
        costo: m.fixedCostTotal,
      };
    });
}

export function TablaResultados(props: TablaResultadosProps): ReactNode {
  const S = useStrings();
  const { id, ir, corrida, pestana, onPestana, plegada } = props;
  const conCorrida = corrida !== null && ir !== null;
  const grupos = avisosDelDock(corrida?.result.warnings ?? [], props.avisos);
  const etiqueta = (p: PestanaDock): string => (p === 'avisos' && grupos.length > 0 ? `${S.c5.tabla.pestanas[p]} (${grupos.length})` : S.c5.tabla.pestanas[p]);

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

  const replicas = corrida?.scenario.run.replications ?? 1;
  const textoPlegar = plegada ? S.c5.tabla.desplegar : S.c5.tabla.plegar;
  return (
    <section id={id} className={plegada ? 'dock-simular plegada' : 'dock-simular'} aria-label={S.c5.tabla.region}>
      {/* The end of a run is announced here: it lands in Results without a page change. */}
      <p role="status" className="dock-anuncio">{conCorrida ? S.dock.corridaTerminada(formatNumber(Math.round(corrida.result.process.completed))) : ''}</p>
      <div className="dock-cabecera">
        <button type="button" className="boton icono c5-plegar" aria-expanded={!plegada} aria-controls={`${id}-panel`}
          aria-label={textoPlegar} title={textoPlegar} onClick={props.onPlegar}>
          <span aria-hidden="true">{plegada ? '▸' : '▾'}</span>
        </button>
        <span className="c5-tabla-titulo">
          <strong>{S.c5.tabla.titulo}</strong>
          {conCorrida && <span className="c5-nota">{` · ${S.c5.tabla.sub(replicas)}`}</span>}
        </span>
        <div role="tablist" aria-label={S.c5.tabla.vistas} className="dock-pestanas">
          {PESTANAS_DOCK.map((p) => (
            <button key={p} type="button" role="tab" id={`${id}-tab-${p}`} aria-controls={`${id}-panel`}
              aria-selected={p === pestana} tabIndex={p === pestana ? 0 : -1}
              className={p === pestana ? 'pestana activa' : 'pestana'}
              onClick={() => { onPestana(p); if (plegada) props.onPlegar(); }} onKeyDown={teclaPestana}>
              {etiqueta(p)}
            </button>
          ))}
        </div>
        <div className="dock-acciones">
          <button type="button" className="boton" disabled={!conCorrida} title={S.c5.tabla.exportarCsvTitulo}
            onClick={() => { if (conCorrida) downloadCsv('elements.csv', buildResultCsvExports(ir, corrida.scenario, corrida.result).elements); }}>
            {S.c5.tabla.exportarCsv}
          </button>
          <button type="button" className="boton" disabled={!conCorrida} title={S.c5.tabla.exportarXlsxTitulo}
            onClick={() => {
              if (conCorrida) downloadXlsx(`${corrida.scenario.name}.xlsx`, scenarioWorkbook(ir, corrida.scenario, corrida.result, resourceNamesOf(corrida.scenario), getLocale()));
            }}>
            {S.c5.tabla.exportarXlsx}
          </button>
        </div>
      </div>
      {/* One panel whose content follows the tab: focusable, so a long table scrolls by keyboard. */}
      {!plegada && (
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${pestana}`} tabIndex={0} className="dock-panel">
          {pestana === 'avisos' ? <Avisos grupos={grupos} />
            : !conCorrida ? <p className="vacio">{S.dock.vacio}</p>
              : pestana === 'tareas' ? <Tareas ir={ir} result={corrida.result} scenario={corrida.scenario} seleccion={props.seleccion ?? null} onSeleccionar={props.onSeleccionar} />
                : pestana === 'detalle' ? props.detalle
                  : <Log ir={ir} scenario={corrida.scenario} log={props.log} />}
        </div>
      )}
    </section>
  );
}

function Tareas({ ir, result, scenario, seleccion, onSeleccionar }: {
  ir: ProcessIR; result: RunResult; scenario: ResolvedScenario; seleccion: string | null; onSeleccionar: (id: string) => void;
}): ReactNode {
  const S = useStrings();
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  const moneda = scenario.run.currency === undefined ? '' : ` ${scenario.run.currency}`;
  const filas = filasTareas(ir, result, scenario);
  const C = S.c5.tabla.columnas;
  const tiempo = (v: number): string => formatDisplayDurationWithUnit(v, unit);
  const derecha = (): CSSProperties => ({ ...th(), textAlign: 'right' });
  return (
    <>
      <table style={tableStyle} className="dock-rapidos c5-tareas">
        <thead>
          <tr>
            <th scope="col" style={th()}>{C.tarea}</th>
            <th scope="col" style={th()}>{C.recurso}</th>
            <th scope="col" style={derecha()}>{C.casos}</th>
            <th scope="col" style={derecha()}>{C.proceso}</th>
            <th scope="col" style={derecha()}>{C.espera}</th>
            <th scope="col" style={derecha()} title={S.c5.tabla.utilizacionTitulo}>{C.utilizacion}</th>
            <th scope="col" style={derecha()} title={S.c5.tabla.costoTitulo}>{C.costo}</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.id} className={f.id === seleccion ? 'c5-fila-activa' : undefined}>
              <th scope="row" style={{ ...tdStyle, fontWeight: 'normal', textAlign: 'left' }}>
                {/* The name picks the task on the map (and shows its detail in the summary). */}
                <button type="button" className="enlace" aria-current={f.id === seleccion ? 'true' : undefined} onClick={() => onSeleccionar(f.id)}>{f.nombre}</button>
              </th>
              <td style={tdStyle}>{f.recursos.length === 0 ? S.c5.tabla.nadie : f.recursos.join(', ')}</td>
              <td style={numero()} title={formatNumber(f.casos)}>{formatDisplay(f.casos)}</td>
              <td style={numero()} title={exactDuration(f.proceso, unit)}>{tiempo(f.proceso)}</td>
              <td style={numero()} title={exactDuration(f.espera, unit)}>{tiempo(f.espera)}</td>
              <td style={numero()} title={guion(f.utilizacion, (v) => formatNumber(v * 100))}>{guion(f.utilizacion, (v) => `${formatDisplay(v * 100)} %`)}</td>
              <td style={numero()} title={`${formatNumber(f.costo)}${moneda}`}>{`${formatDisplay(f.costo)}${moneda}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dock-nota">{S.c5.tabla.notaCosto}</p>
    </>
  );
}

/**
 * Cell styles of the dock's tables, built from the Results ones. Functions, not module constants:
 * suites that mock `./ResultsView` (App's) must be able to import this file without them.
 */
const th = (): CSSProperties => ({ ...thStyle, cursor: 'default' });
const numero = (): CSSProperties => ({ ...tdStyle, fontFamily: 'var(--font-mono)', textAlign: 'right' });

function Log({ ir, scenario, log }: { ir: ProcessIR; scenario: ResolvedScenario; log: LogDeCorrida | undefined }): ReactNode {
  const S = useStrings();
  if (log === undefined) return <p className="vacio">{S.dock.sinLog}</p>;
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  const filas = log.rows.slice(0, FILAS_LOG);
  const tiempo = (v: number | null): string => guion(v, (x) => formatDisplay(x / SECONDS_PER_UNIT[unit]));
  const exacto = (v: number | null): string => guion(v, (x) => exactDuration(x, unit));
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
              <td style={numero()} title={exacto(f.enabledAt)}>{tiempo(f.enabledAt)}</td>
              <td style={numero()} title={exacto(f.startedAt)}>{tiempo(f.startedAt)}</td>
              <td style={numero()} title={exacto(f.endedAt)}>{tiempo(f.endedAt)}</td>
              <td style={numero()} title={exacto(f.resourceWait)}>{tiempo(f.resourceWait)}</td>
              <td style={numero()} title={formatNumber(f.cost)}>{formatDisplay(f.cost)}</td>
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
