/**
 * The charts of the Results view (#460) and the same charts on paper for the process document
 * (#454). Each chart is described once, as the props of `SvgBarras`/`SvgHistograma` built from the
 * very `RunResult` fields and formatters of its table; the screen draws them with the theme and
 * the document rasterises them in `PALETA_PAPEL`.
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { Component, type ReactNode } from 'react';
import { columnLabel, SECONDS_PER_UNIT, type BaseTimeUnit } from '@lila-modeler/engine/format';
import type { ResolvedScenario } from '@lila-modeler/engine/schema';
import type { EventLogRow, ProcessIR, RunResult } from '@lila-modeler/engine';
import {
  histograma,
  instanciasPorTarea,
  PERCENTILES,
  percentilesDelProceso,
  sinVentana,
  utilizacionPorRecurso,
  type Punto,
} from './graficas';
import {
  GraficaBarras,
  Histograma,
  PALETA_PAPEL,
  SvgBarras,
  SvgHistograma,
  textoClase,
  type GraficaBarrasProps,
  type HistogramaProps,
} from './GraficasSvg';
import { formatDisplay, formatDisplayDuration } from './formatDisplay';
import { strings, useStrings } from './i18n';

/** The event log sample the shell keeps for the run (`App.tsx`, `logs`). */
export interface LogDeCorrida {
  rows: readonly EventLogRow[];
  truncated: boolean;
  /** Cycle time (s) of each completed case of replication 0, from the engine (`onCycleTimes`). */
  ciclos?: readonly number[] | undefined;
}

const unaSerie = (titulo: string, serie: string, puntos: readonly Punto[], texto: (v: number) => string, tope?: number): GraficaBarrasProps => ({
  titulo,
  series: [serie],
  grupos: puntos.map((p) => ({ id: p.id, etiqueta: p.etiqueta, valores: [p.valor], textos: [p.valor === null ? strings().comparar.sinValor : texto(p.valor)] })),
  tope,
});

/** Utilization per pool; `null` without pools. Same value and text as the Resources table. */
export function graficaUtilizacion(result: RunResult, nombres: Readonly<Record<string, string>>): GraficaBarrasProps | null {
  const puntos = utilizacionPorRecurso(result, nombres);
  if (puntos.length === 0) return null;
  return unaSerie(strings().graficas.utilizacion, columnLabel('resources', 'utilization'), puntos, formatDisplay, 100);
}

/** Instances started per task; `null` without tasks. Same value and text as the Elements table. */
export function graficaInstancias(ir: ProcessIR, result: RunResult): GraficaBarrasProps | null {
  const puntos = instanciasPorTarea(ir, result);
  if (puntos.length === 0) return null;
  return unaSerie(strings().graficas.instancias, columnLabel('elements', 'started'), puntos, formatDisplay);
}

/**
 * Cycle and wait time p50/p90/p95, grouped by percentile; `null` when no case completed (absent,
 * not zero). Same values and text as those six columns of the Process table.
 */
export function graficaPercentiles(result: RunResult, unit: BaseTimeUnit): GraficaBarrasProps | null {
  const S = strings();
  const datos = percentilesDelProceso(result);
  if (datos === null) return null;
  return {
    titulo: S.graficas.percentiles(unit),
    series: [S.graficas.ciclo, S.graficas.espera],
    grupos: PERCENTILES.map((p, i) => {
      const segundos = [datos.ciclo[i]!, datos.espera[i]!];
      return {
        id: p,
        etiqueta: p,
        valores: segundos.map((s) => s / SECONDS_PER_UNIT[unit]),
        textos: segundos.map((s) => formatDisplayDuration(s, unit)),
      };
    }),
  };
}

/**
 * Per-case cycle time of replication 0, or why there is none. The times are the engine's own
 * sample behind `process.cycleTime` (`opts.onCycleTimes`, through the worker), never rebuilt from
 * the event log: a case stuck at a blocked join leaves no `inFlight` row, and a start → end case
 * leaves no row at all (QA of #512).
 */
export function graficaHistograma(
  log: LogDeCorrida | undefined,
  scenario: ResolvedScenario,
  unit: BaseTimeUnit,
): { props: HistogramaProps } | { aviso: string } {
  const S = strings();
  const ciclos = log?.ciclos;
  if (ciclos === undefined) return { aviso: S.graficas.histogramaSinLog };
  if (ciclos.length === 0) return { aviso: S.graficas.histogramaSinCasos };
  return {
    props: {
      titulo: S.graficas.histograma(unit),
      sub: S.graficas.histogramaSub(ciclos.length, scenario.run.replications ?? 1),
      valores: ciclos.map((c) => c / SECONDS_PER_UNIT[unit]),
    },
  };
}

/* ------------------------------------------------------------------ *
 * On screen
 * ------------------------------------------------------------------ */

const seccionStyle = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  marginBottom: 16,
  padding: 12,
} as const;

function Nota({ children }: { children: ReactNode }): ReactNode {
  return <p className="grafica-nota">{children}</p>;
}

/**
 * A chart that fails to build or draw becomes a note: a chart is never worth the whole view
 * (QA of #512, where one blank screen came from a single chart).
 */
class SinCaida extends Component<{ children: ReactNode; datos: unknown }, { fallo: boolean; datos: unknown }> {
  override state = { fallo: false, datos: this.props.datos };
  static getDerivedStateFromError(): Partial<{ fallo: boolean }> {
    return { fallo: true };
  }
  /** New data (another run, another log) gets a fresh try instead of the old failure's note. */
  static getDerivedStateFromProps(props: { datos: unknown }, state: { datos: unknown }): { fallo: boolean; datos: unknown } | null {
    return props.datos === state.datos ? null : { fallo: false, datos: props.datos };
  }
  override render(): ReactNode {
    return this.state.fallo ? <Nota>{strings().graficas.error}</Nota> : this.props.children;
  }
}

/** A chart, or the note that says there is nothing to draw (never an empty or all-zero frame). */
function Barras({ props }: { props: () => GraficaBarrasProps | null }): ReactNode {
  const S = useStrings();
  const p = props();
  return p === null ? <Nota>{S.graficas.sinDatos}</Nota> : <GraficaBarras {...p} />;
}

/** The run measured nothing (all in the warm-up): say so instead of drawing its zeros. */
function SinVentana(): ReactNode {
  return <Nota>{useStrings().graficas.sinVentana}</Nota>;
}

export function GraficaDeUtilizacion({ result, scenario, nombres }: {
  result: RunResult;
  scenario: ResolvedScenario;
  nombres: Readonly<Record<string, string>>;
}): ReactNode {
  return (
    <section style={seccionStyle} data-grafica="utilizacion">
      <SinCaida datos={result}>
        {sinVentana(result, scenario.run.warmup) ? <SinVentana /> : <Barras props={() => graficaUtilizacion(result, nombres)} />}
      </SinCaida>
    </section>
  );
}

export function GraficaDeInstancias({ ir, result, scenario }: { ir: ProcessIR; result: RunResult; scenario: ResolvedScenario }): ReactNode {
  return (
    <section style={seccionStyle} data-grafica="instancias">
      <SinCaida datos={result}>
        {sinVentana(result, scenario.run.warmup) ? <SinVentana /> : <Barras props={() => graficaInstancias(ir, result)} />}
      </SinCaida>
    </section>
  );
}

function Percentiles({ result, unit }: { result: RunResult; unit: BaseTimeUnit }): ReactNode {
  const S = useStrings();
  const percentiles = graficaPercentiles(result, unit);
  return percentiles === null ? <Nota>{S.graficas.sinCompletados}</Nota> : <GraficaBarras {...percentiles} />;
}

function HistogramaDeCasos({ scenario, unit, log }: { scenario: ResolvedScenario; unit: BaseTimeUnit; log: LogDeCorrida | undefined }): ReactNode {
  const S = useStrings();
  const histo = graficaHistograma(log, scenario, unit);
  if ('aviso' in histo) return <Nota>{histo.aviso}</Nota>;
  return (
    <>
      <Histograma {...histo.props} />
      <details className="grafica-datos">
        <summary>{S.graficas.verDatos}</summary>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr>
              <th scope="col" style={{ padding: '2px 8px', textAlign: 'left' }}>{S.graficas.columnaClase(unit)}</th>
              <th scope="col" style={{ padding: '2px 8px', textAlign: 'right' }}>{S.graficas.columnaCasos}</th>
            </tr>
          </thead>
          <tbody>
            {histograma(histo.props.valores).map((c) => (
              <tr key={c.desde}>
                <td style={{ padding: '2px 8px' }}>{textoClase(c)}</td>
                <td style={{ padding: '2px 8px', textAlign: 'right' }}>{formatDisplay(c.casos)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}

/** Percentiles and, with the run's per-case times, the histogram, side by side when there is room. */
export function GraficasDelProceso({
  result,
  scenario,
  unit,
  log,
}: {
  result: RunResult;
  scenario: ResolvedScenario;
  unit: BaseTimeUnit;
  log: LogDeCorrida | undefined;
}): ReactNode {
  return (
    <section style={seccionStyle} className="graficas-fila">
      <div data-grafica="percentiles">
        <SinCaida datos={result}>
          <Percentiles result={result} unit={unit} />
        </SinCaida>
      </div>
      <div data-grafica="histograma">
        <SinCaida datos={log}>
          <HistogramaDeCasos scenario={scenario} unit={unit} log={log} />
        </SinCaida>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * On paper: the process document (#454)
 * ------------------------------------------------------------------ */

/** Width of a chart in the document, in CSS px: close to the A4 text width at 96 dpi. */
const ANCHO_PAPEL = 720;

/** Serialises one chart to standalone SVG (XML, fixed colors), ready for `aPng`. */
function aSvg(grafica: ReactNode): { svg: string; alt: string } {
  const contenedor = document.createElement('div');
  const raiz = createRoot(contenedor);
  try {
    flushSync(() => raiz.render(grafica));
    const svg = contenedor.querySelector('svg');
    if (svg === null) throw new Error('chart did not render');
    const alt = [svg.querySelector('title')?.textContent, svg.querySelector('desc')?.textContent].filter(Boolean).join('. ');
    // The serializer declares the SVG namespace itself; React's `xmlns` attribute would repeat it.
    svg.removeAttribute('xmlns');
    return { svg: new XMLSerializer().serializeToString(svg), alt };
  } finally {
    raiz.unmount();
  }
}

/**
 * The charts of a run for the process document, as SVG strings in reading order: utilization,
 * cycle/wait percentiles, the per-case histogram when the log allows it, instances per task. A
 * chart with nothing to draw is left out; the caller only asks when there is a run.
 */
export function graficasDelDocumento(entrada: {
  ir: ProcessIR;
  scenario: ResolvedScenario;
  result: RunResult;
  log?: LogDeCorrida | undefined;
}): { svg: string; alt: string }[] {
  const { ir, scenario, result } = entrada;
  const unit = (scenario.run.baseTimeUnit ?? 's') as BaseTimeUnit;
  const nombres = Object.fromEntries(Object.entries(scenario.resources ?? {}).map(([id, r]) => [id, r.name ?? id]));
  const papel = { paleta: PALETA_PAPEL, ancho: ANCHO_PAPEL };
  const medido = !sinVentana(result, scenario.run.warmup);
  // Each chart on its own: one that fails is left out, and the document still exports.
  const barras = (hacer: () => GraficaBarrasProps | null) => (): ReactNode => {
    const p = hacer();
    return p === null ? null : <SvgBarras {...p} {...papel} />;
  };
  const pasos: (() => ReactNode)[] = [
    ...(medido ? [barras(() => graficaUtilizacion(result, nombres))] : []),
    barras(() => graficaPercentiles(result, unit)),
    () => {
      const histo = graficaHistograma(entrada.log, scenario, unit);
      return 'props' in histo ? <SvgHistograma {...histo.props} {...papel} /> : null;
    },
    ...(medido ? [barras(() => graficaInstancias(ir, result))] : []),
  ];
  return pasos.flatMap((paso) => {
    try {
      const grafica = paso();
      return grafica === null ? [] : [aSvg(grafica)];
    } catch {
      return [];
    }
  });
}
