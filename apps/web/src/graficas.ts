/**
 * Data of the charts in Results and Compare (#460): what each chart draws, taken from the same
 * `RunResult` fields as the table beside it, so a chart can never say something its table does
 * not. Pure: no React, no DOM — the tests compare these rows with the table's.
 *
 * The drawing lives in `GraficasSvg.tsx`; the colors, in `graficas.css` (screen) and `SERIES_CLARO`
 * below (paper).
 */
import type { EventLogRow, ProcessIR, RunResult } from '@lila-modeler/engine';

/**
 * Categorical slots, fixed order, never cycled: the validated default palette of the dataviz
 * method (worst adjacent CVD ΔE 9.1 light / 8.4 dark, normal-vision ΔE ≥ 19.3). Re-validated on
 * every built-in surface of Lila: light on `#FFFFFF` (Lila Light, Papel, Tieso) and `#F2D9FC`
 * (Montana), dark on `#1C1730` (Eva-01), `#271640` (Lila Dark) and `#14121F` (Akira). On the light
 * surfaces some slots sit under 3:1, which is why every bar carries its value as text and the
 * table stays next to the chart.
 *
 * `graficas.css` declares the same hex values as `--serie-N`; `graficas.test.ts` keeps them equal.
 */
export const SERIES_CLARO = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'] as const;
export const SERIES_OSCURO = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] as const;
/** Series a chart can tell apart; a ninth is never a generated hue. */
export const MAX_SERIES = SERIES_CLARO.length;

/** One bar: `valor` in the chart's unit, `null` when the table shows no value (absent, not zero). */
export interface Punto {
  id: string;
  etiqueta: string;
  valor: number | null;
}

/** Utilization per pool, in %, in the order of the Resources table (`resourceRows`). */
export function utilizacionPorRecurso(result: RunResult, nombres: Readonly<Record<string, string>>): Punto[] {
  return Object.entries(result.resources).map(([id, m]) => ({ id, etiqueta: nombres[id] ?? id, valor: m.utilization * 100 }));
}

/**
 * Instances started per task, in the order of the Elements table. Only tasks: events and gateways
 * repeat the count of the task next to them and would double the chart for nothing.
 */
export function instanciasPorTarea(ir: ProcessIR, result: RunResult): Punto[] {
  return Object.entries(result.elements)
    .filter(([id]) => ir.nodes[id]?.type === 'task')
    .map(([id, m]) => ({ id, etiqueta: ir.nodes[id]?.name || id, valor: m.started }));
}

export const PERCENTILES = ['p50', 'p90', 'p95'] as const;

/**
 * Cycle and wait time p50/p90/p95 of the Process table, in seconds; `null` when no case completed,
 * because then the engine's zeros are the statistics of an empty set, not a measured zero
 * (docs/RESULTS_FORMAT.md § 8).
 */
export function percentilesDelProceso(result: RunResult): { ciclo: number[]; espera: number[] } | null {
  if (result.process.completed === 0) return null;
  return {
    ciclo: PERCENTILES.map((p) => result.process.cycleTime[p]),
    espera: PERCENTILES.map((p) => result.process.waitTime[p]),
  };
}

/**
 * Cycle time of each completed case of the event log, in seconds: from the first activity it
 * enabled to the last one it closed (gateways and plain events take no time, so that is the
 * case's life). A case with an `inFlight` row had not finished at the stop, and a case born before
 * `warmup` is outside the measured cohort (R-ARR-7): neither enters, as in `process.cycleTime`.
 *
 * Incremental, so the worker can feed it every row of replication 0 as it is emitted and keep one
 * small record per case instead of the rows: the histogram does not depend on the log sample the
 * shell keeps for the replay, which a long run truncates.
 */
export function casosDelLog(): { agregar: (row: EventLogRow) => void; ciclos: (warmup?: number) => number[] } {
  const casos = new Map<string, { desde: number; hasta: number; abierto: boolean }>();
  return {
    agregar(row) {
      const clave = `${row.replication}\u0000${row.caseId}`;
      const caso = casos.get(clave) ?? { desde: Infinity, hasta: -Infinity, abierto: false };
      caso.desde = Math.min(caso.desde, row.enabledAt);
      caso.hasta = Math.max(caso.hasta, row.observedUntil);
      caso.abierto ||= row.status === 'inFlight';
      casos.set(clave, caso);
    },
    ciclos: (warmup = 0) => [...casos.values()].filter((c) => !c.abierto && c.desde >= warmup).map((c) => c.hasta - c.desde),
  };
}

/**
 * `casosDelLog` over a list of rows. Only valid over a complete log: a truncated sample may have
 * cut a case's last rows and make it look shorter.
 */
export function ciclosPorCaso(rows: readonly EventLogRow[], warmup = 0): number[] {
  const casos = casosDelLog();
  for (const row of rows) casos.agregar(row);
  return casos.ciclos(warmup);
}

/** The smallest 1, 2 or 5 × 10ⁿ that is at least `x` (> 0). */
export function pasoRedondo(x: number): number {
  const base = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * base).find((paso) => paso >= x * (1 - 1e-9)) ?? 10 * base;
}

/** Axis from 0 to a round top with about five ticks; an all-zero chart still gets an axis 0–1. */
export function escala(maximo: number, tope?: number): { tope: number; marcas: number[] } {
  const alto = tope ?? (maximo > 0 ? maximo : 1);
  const paso = pasoRedondo(alto / 5);
  const fin = tope ?? Math.ceil(alto / paso - 1e-9) * paso;
  const marcas: number[] = [];
  for (let v = 0; v <= fin + paso * 1e-9; v += paso) marcas.push(Math.round(v / paso) * paso);
  return { tope: fin, marcas };
}

/** One class of the histogram: `[desde, hasta)`. */
export interface Clase {
  desde: number;
  hasta: number;
  casos: number;
}

/**
 * Sturges' rule (between 5 and 20 classes) on round edges. Every value falls in exactly one class,
 * so the counts add up to the number of cases. A single distinct value is one class of its own.
 */
export function histograma(valores: readonly number[]): Clase[] {
  if (valores.length === 0) return [];
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  if (max === min) return [{ desde: min, hasta: max, casos: valores.length }];
  const clases = Math.min(20, Math.max(5, Math.ceil(Math.log2(valores.length)) + 1));
  const paso = pasoRedondo((max - min) / clases);
  const inicio = Math.floor(min / paso) * paso;
  const n = Math.floor((max - inicio) / paso) + 1;
  const resultado = Array.from({ length: n }, (_, i) => ({ desde: inicio + i * paso, hasta: inicio + (i + 1) * paso, casos: 0 }));
  for (const v of valores) resultado[Math.min(n - 1, Math.floor((v - inicio) / paso))]!.casos++;
  return resultado;
}
