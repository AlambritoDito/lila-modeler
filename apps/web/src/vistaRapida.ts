/**
 * #396: the data of the «Quick view · simulation» block of the properties panel.
 *
 * The properties panel knows the canvas and nothing else; the shell (`App.tsx`) has the active
 * scenario and its last run. This is the one pure function between the two: given an element id
 * of the canvas, it answers with three already-written lines — the activity's time distribution,
 * its resources, and the wait of the last run — or `null` when the element is not an activity
 * the simulation times (a gateway, an event, a lane), which is what hides the block.
 *
 * The time and resource lines are the same text the Simulate panel's step lists print
 * (`resumenDistribucion`, `resumenRecursos`), so the two never write a distribution differently.
 */
import type { EventLogRow, ProcessIR, RunResult } from '@lila-modeler/engine';
import { formatDuration } from '@lila-modeler/engine/format';
import { resumenDistribucion, resumenRecursos } from './ScenarioPanel';
import { esUnidadTiempo, type UnidadTiempo } from './scenarioFields';
import type { Strings } from './strings.types';

export interface VistaRapidaDatos {
  /** `processingTime` as one line («Triangular 2 / 4 / 9 min»), «—» when it is not set. */
  tiempo: string;
  /** `resources` as one line («clerk ×1»), «—» without any; `null` where it does not apply (timer). */
  recurso: string | null;
  /**
   * Wait before starting (`resourceWait + offHoursWait`) in the last valid run of the active
   * scenario. The 95th percentile when the run's log sample is in memory and complete — the shell
   * keeps replication 0 only, up to `LOG_SAMPLE_LIMIT` rows, the same sample the Results charts
   * read —, otherwise the mean of `RunResult.elements[id]` over every replication, labelled as a
   * mean: the result carries no per-element percentile, and a truncated sample would bias it.
   * `null` when there is no run.
   */
  espera: { texto: string; p95: boolean } | null;
}

export interface EntradaVistaRapida {
  /** The id bpmn-js selected (may be a non-NCName id the IR sanitised, see `originalIds`). */
  id: string;
  ir: ProcessIR | null;
  /** The active scenario with `extends` applied, or `null` when it does not resolve. */
  escenario: Record<string, unknown> | null;
  /** The last valid run of that scenario, if any. */
  resultado: RunResult | null;
  log?: { rows: readonly EventLogRow[]; truncated: boolean } | undefined;
  S: Strings;
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The IR id of a canvas id: itself, or the sanitised one `source.originalIds` maps back to it. */
function idDelIr(ir: ProcessIR, id: string): string | null {
  if (ir.nodes[id] !== undefined) return id;
  const enIr = Object.entries(ir.source.originalIds).find(([, original]) => original === id);
  return enIr?.[0] ?? null;
}

/** Empirical percentile with linear interpolation, as `process.waitTime.p95` (RESULTS_FORMAT § 5). */
export function percentil(muestra: readonly number[], p: number): number {
  const orden = [...muestra].sort((a, b) => a - b);
  const pos = (orden.length - 1) * p;
  const bajo = Math.floor(pos);
  const alto = Math.ceil(pos);
  return orden[bajo]! + (orden[alto]! - orden[bajo]!) * (pos - bajo);
}

/** Wait p95 per element of a log, computed once per log (a log can hold a lot of rows). */
const cache = new WeakMap<readonly EventLogRow[], Map<string, number>>();
export function esperasP95(rows: readonly EventLogRow[]): Map<string, number> {
  const hecho = cache.get(rows);
  if (hecho !== undefined) return hecho;
  // Several rows share an activity instance (one per pool assignment, ADR-025); the wait is the
  // instance's, so it is counted once. Only completed instances, like `process.waitTime`.
  const porInstancia = new Map<string, { elemento: string; espera: number }>();
  for (const row of rows) {
    if (row.status !== 'completed') continue;
    porInstancia.set(`${row.replication}:${row.activityInstanceId}`, {
      elemento: row.elementId,
      espera: row.resourceWait + row.offHoursWait,
    });
  }
  const muestras = new Map<string, number[]>();
  for (const { elemento, espera } of porInstancia.values()) {
    const lista = muestras.get(elemento);
    if (lista === undefined) muestras.set(elemento, [espera]);
    else lista.push(espera);
  }
  const salida = new Map([...muestras].map(([id, lista]) => [id, percentil(lista, 0.95)]));
  cache.set(rows, salida);
  return salida;
}

export function datosVistaRapida({ id, ir, escenario, resultado, log, S }: EntradaVistaRapida): VistaRapidaDatos | null {
  if (ir === null || escenario === null) return null;
  const idIr = idDelIr(ir, id);
  const tipo = idIr === null ? undefined : ir.nodes[idIr]?.type;
  if (idIr === null || (tipo !== 'task' && tipo !== 'timer')) return null;

  const run = escenario['run'];
  const valorUnidad = esObjeto(run) ? run['baseTimeUnit'] : undefined;
  const unidad: UnidadTiempo = esUnidadTiempo(valorUnidad) ? valorUnidad : 's';
  const elemento = esObjeto(escenario['elements']) ? escenario['elements'][idIr] : undefined;
  const campos = esObjeto(elemento) ? elemento : {};

  let espera: VistaRapidaDatos['espera'] = null;
  const metricas = resultado?.elements[idIr];
  if (metricas !== undefined) {
    const p95 = log !== undefined && !log.truncated ? esperasP95(log.rows).get(idIr) : undefined;
    const segundos = p95 ?? metricas.resourceWait.mean + metricas.offHoursWait.mean;
    espera = { texto: `${formatDuration(segundos, unidad)} ${S.escenario.unidades[unidad]}`, p95: p95 !== undefined };
  }

  return {
    tiempo: resumenDistribucion(idIr, 'processingTime', campos['processingTime'], unidad, S),
    recurso: tipo === 'task' ? resumenRecursos(campos['resources'], S) : null,
    espera,
  };
}
