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
import { esperaCorta } from './BottleneckOverlay';
import { percentilesPorElemento } from './percentilesPorElemento';
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
   * scenario, rounded like the bottleneck labels (`esperaCorta`). The 95th percentile of the
   * measured cohort (`percentilesPorElemento`: after `run.warmup`) when the run's log sample is in
   * memory and complete — the shell keeps replication 0 only, up to `LOG_SAMPLE_LIMIT` rows, the
   * same sample the Results charts read —, otherwise the mean of `RunResult.elements[id]` over
   * every replication, labelled as a mean: the result carries no per-element percentile, and a
   * truncated sample would bias it. `null` when there is no run; «—» when the run has no data
   * for the element.
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

/** Wait p95 per element of a log sample, computed once per sample and warmup (it can be 10k rows). */
const cache = new WeakMap<readonly EventLogRow[], { warmup: number; p95: Map<string, number> }>();
export function esperasP95(rows: readonly EventLogRow[], warmup = 0): Map<string, number> {
  const hecho = cache.get(rows);
  if (hecho !== undefined && hecho.warmup === warmup) return hecho.p95;
  const p95 = new Map([...percentilesPorElemento(rows, [0.95], { warmup })].map(([id, [valor]]) => [id, valor!]));
  cache.set(rows, { warmup, p95 });
  return p95;
}

export function datosVistaRapida({ id, ir, escenario, resultado, log, S }: EntradaVistaRapida): VistaRapidaDatos | null {
  if (ir === null || escenario === null) return null;
  const idIr = idDelIr(ir, id);
  const tipo = idIr === null ? undefined : ir.nodes[idIr]?.type;
  if (idIr === null || (tipo !== 'task' && tipo !== 'timer')) return null;

  const run = escenario['run'];
  const valorUnidad = esObjeto(run) ? run['baseTimeUnit'] : undefined;
  const unidad: UnidadTiempo = esUnidadTiempo(valorUnidad) ? valorUnidad : 's';
  // The run was made with this same scenario revision (`corridaActual`), so its warmup is this one.
  const warmup = esObjeto(run) && typeof run['warmup'] === 'number' ? run['warmup'] : 0;
  const elemento = esObjeto(escenario['elements']) ? escenario['elements'][idIr] : undefined;
  const campos = esObjeto(elemento) ? elemento : {};

  let espera: VistaRapidaDatos['espera'] = null;
  if (resultado !== null) {
    const metricas = resultado.elements[idIr];
    const p95 = log !== undefined && !log.truncated ? esperasP95(log.rows, warmup).get(idIr) : undefined;
    const segundos = p95 ?? (metricas === undefined ? undefined : metricas.resourceWait.mean + metricas.offHoursWait.mean);
    // A run that has nothing on this element (added after it ran, say) is «—», not «no run».
    espera = segundos === undefined
      ? { texto: S.escenario.sinResumen, p95: false }
      : { texto: esperaCorta(segundos), p95: p95 !== undefined };
  }

  return {
    tiempo: resumenDistribucion(idIr, 'processingTime', campos['processingTime'], unidad, S),
    recurso: tipo === 'task' ? resumenRecursos(campos['resources'], S) : null,
    espera,
  };
}
