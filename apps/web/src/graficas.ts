/**
 * Data of the charts in Results and Compare (#460): what each chart draws, taken from the same
 * `RunResult` fields as the table beside it, so a chart can never say something its table does
 * not. Pure: no React, no DOM — the tests compare these rows with the table's.
 *
 * The drawing lives in `GraficasSvg.tsx`; the colors, in `graficas.css` (screen) and `SERIES_CLARO`
 * below (paper).
 */
import type { ProcessIR, RunResult } from '@lila-modeler/engine';
import {
  histogram,
  instancesByTask,
  MAX_SERIES as MAX,
  nothingMeasured,
  PERCENTILES as P,
  processPercentiles,
  roundStep,
  scale,
  SERIES_DARK,
  SERIES_LIGHT,
  utilizationByResource,
} from '@lila-modeler/engine/charts';

/*
 * The data functions live in the engine (`@lila-modeler/engine/charts`, #636), which also draws
 * these charts for the process document an agent exports. The names below keep the app's own
 * vocabulary over them.
 */

/** The categorical slots of the charts; `graficas.css` declares the same hex values as `--serie-N`. */
export const SERIES_CLARO = SERIES_LIGHT;
export const SERIES_OSCURO = SERIES_DARK;
/** Series a chart can tell apart; a ninth is never a generated hue. */
export const MAX_SERIES = MAX;

/** One bar: `valor` in the chart's unit, `null` when the table shows no value (absent, not zero). */
export interface Punto {
  id: string;
  etiqueta: string;
  valor: number | null;
}

/** Utilization per pool, in %, in the order of the Resources table (`resourceRows`). */
export function utilizacionPorRecurso(result: RunResult, nombres: Readonly<Record<string, string>>): Punto[] {
  return utilizationByResource(result, nombres).map(({ id, label, value }) => ({ id, etiqueta: label, valor: value }));
}

/** Instances started per task, in the order of the Elements table; only tasks. */
export function instanciasPorTarea(ir: ProcessIR, result: RunResult): Punto[] {
  return instancesByTask(ir, result).map(({ id, label, value }) => ({ id, etiqueta: label, valor: value }));
}

export const PERCENTILES = P;

/** Cycle and wait time p50/p90/p95 of the Process table, in seconds; `null` when no case completed. */
export function percentilesDelProceso(result: RunResult): { ciclo: number[]; espera: number[] } | null {
  const datos = processPercentiles(result);
  return datos === null ? null : { ciclo: datos.cycle, espera: datos.wait };
}

/** The smallest 1, 2 or 5 × 10ⁿ that is at least `x` (> 0). */
export const pasoRedondo = roundStep;

/** The run measured nothing: every arrival fell inside the warm-up, so no chart draws its zeros. */
export const sinVentana = nothingMeasured;

/** Axis from 0 to a round top with about five ticks; an all-zero chart still gets an axis 0–1. */
export function escala(maximo: number, tope?: number): { tope: number; marcas: number[] } {
  const { top, ticks } = scale(maximo, tope);
  return { tope: top, marcas: ticks };
}

/** One class of the histogram: `[desde, hasta)`. */
export interface Clase {
  desde: number;
  hasta: number;
  casos: number;
}

/** Sturges' rule (between 5 and 20 classes) on round edges; the counts add up to the cases. */
export function histograma(valores: readonly number[]): Clase[] {
  return histogram(valores).map(({ from, to, cases }) => ({ desde: from, hasta: to, casos: cases }));
}
