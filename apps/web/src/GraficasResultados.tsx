/**
 * The charts of the Results view (#460) and the same charts on paper for the process document
 * (#454). Each chart is described once, as the props of `SvgBarras`/`SvgHistograma` built from the
 * very `RunResult` fields and formatters of its table; the screen draws them with the theme and
 * the document rasterises them in `PALETA_PAPEL`.
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { columnLabel, formatDuration, formatNumber, SECONDS_PER_UNIT, type BaseTimeUnit } from '@lila-modeler/engine/format';
import type { ResolvedScenario } from '@lila-modeler/engine/schema';
import type { EventLogRow, ProcessIR, RunResult } from '@lila-modeler/engine';
import {
  ciclosPorCaso,
  histograma,
  instanciasPorTarea,
  PERCENTILES,
  percentilesDelProceso,
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
import { strings, useStrings } from './i18n';

/** The event log sample the shell keeps for the run (`App.tsx`, `logs`). */
export interface LogDeCorrida {
  rows: readonly EventLogRow[];
  truncated: boolean;
  /** Per-case cycle times the worker took from every row of replication 0 (`casosDelLog`). */
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
  return unaSerie(strings().graficas.utilizacion, columnLabel('resources', 'utilization'), puntos, formatNumber, 100);
}

/** Instances started per task; `null` without tasks. Same value and text as the Elements table. */
export function graficaInstancias(ir: ProcessIR, result: RunResult): GraficaBarrasProps | null {
  const puntos = instanciasPorTarea(ir, result);
  if (puntos.length === 0) return null;
  return unaSerie(strings().graficas.instancias, columnLabel('elements', 'started'), puntos, formatNumber);
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
        textos: segundos.map((s) => formatDuration(s, unit)),
      };
    }),
  };
}

/**
 * Per-case cycle time from the event log, or why there is none: the worker's per-case times when
 * it sent them, else the rows — only when complete, since a truncated sample may have cut a case
 * short (`ciclosPorCaso`).
 */
export function graficaHistograma(
  log: LogDeCorrida | undefined,
  scenario: ResolvedScenario,
  unit: BaseTimeUnit,
): { props: HistogramaProps } | { aviso: string } {
  const S = strings();
  if (log === undefined) return { aviso: S.graficas.histogramaSinLog };
  if (log.ciclos === undefined && log.truncated) return { aviso: S.graficas.histogramaTruncado };
  const ciclos = log.ciclos ?? ciclosPorCaso(log.rows, scenario.run.warmup ?? 0);
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

/** A chart, or the note that says there is nothing to draw (never an empty or all-zero frame). */
function Barras({ props }: { props: GraficaBarrasProps | null }): ReactNode {
  const S = useStrings();
  return props === null ? <Nota>{S.graficas.sinDatos}</Nota> : <GraficaBarras {...props} />;
}

export function GraficaDeUtilizacion({ result, nombres }: { result: RunResult; nombres: Readonly<Record<string, string>> }): ReactNode {
  return (
    <section style={seccionStyle} data-grafica="utilizacion">
      <Barras props={graficaUtilizacion(result, nombres)} />
    </section>
  );
}

export function GraficaDeInstancias({ ir, result }: { ir: ProcessIR; result: RunResult }): ReactNode {
  return (
    <section style={seccionStyle} data-grafica="instancias">
      <Barras props={graficaInstancias(ir, result)} />
    </section>
  );
}

/** Percentiles and, with the event log, the histogram, side by side when there is room. */
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
  const S = useStrings();
  const percentiles = graficaPercentiles(result, unit);
  const histo = graficaHistograma(log, scenario, unit);
  return (
    <section style={seccionStyle} className="graficas-fila">
      <div data-grafica="percentiles">
        {percentiles === null ? <Nota>{S.graficas.sinCompletados}</Nota> : <GraficaBarras {...percentiles} />}
      </div>
      <div data-grafica="histograma">
        {'aviso' in histo ? (
          <Nota>{histo.aviso}</Nota>
        ) : (
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
                      <td style={{ padding: '2px 8px', textAlign: 'right' }}>{formatNumber(c.casos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </>
        )}
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
    const svg = contenedor.querySelector('svg')!;
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
  const barras = [graficaUtilizacion(result, nombres), graficaPercentiles(result, unit)];
  const histo = graficaHistograma(entrada.log, scenario, unit);
  const graficas: ReactNode[] = [
    ...barras.flatMap((p) => (p === null ? [] : [<SvgBarras key={p.titulo} {...p} {...papel} />])),
    ...('props' in histo ? [<SvgHistograma key="histograma" {...histo.props} {...papel} />] : []),
    ...[graficaInstancias(ir, result)].flatMap((p) => (p === null ? [] : [<SvgBarras key={p.titulo} {...p} {...papel} />])),
  ];
  return graficas.map(aSvg);
}
