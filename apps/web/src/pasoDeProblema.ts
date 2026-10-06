/**
 * Lote M: which step of the Simulate panel a validation problem belongs to.
 *
 * The step bar marks each step with «! n», the panel shows a banner with the problems of the step
 * it is on, and «▶ Simulate» takes the person to the first problem. All three need the same
 * answer to «where is this fixed?», and the only thing a problem carries is its path
 * (`ScenarioProblem.path`, or the zod path spelled the same way by `rutaTexto`). This module turns
 * that path into a step and, when the path is about one element, into the element to select.
 *
 * Pure: no React, no DOM. The step of an element field comes from `CAMPOS_DE_PASO`, so a field
 * moved between steps moves its problems with it.
 */
import type { ProcessIR } from '@lila-modeler/engine';

import type { PasoId } from './ids.js';
import { CAMPOS_DE_PASO, type ClaseElemento } from './scenarioFields.js';

/** A path split at the element: `elements.<id>` plus whatever follows the id. */
interface RutaElemento {
  id: string;
  /** The first segment after the id (`processingTime`, `resources`…), or `null` for the bare entry. */
  campo: string | null;
}

/**
 * `elements.Task_1.resources[0].ref` → `{ id: 'Task_1', campo: 'resources' }`.
 *
 * An NCName may contain dots (`Task.1`), so with an IR the id is the longest id of the model that
 * the path spells out; without one, or for an id the model does not have (an orphan entry), it is
 * whatever runs up to the next `.` or `[`.
 */
function partirElemento(ruta: string, ir: ProcessIR | null): RutaElemento | null {
  if (!ruta.startsWith('elements.')) return null;
  const resto = ruta.slice('elements.'.length);
  let id: string | null = null;
  if (ir !== null) {
    for (const candidato of [...Object.keys(ir.nodes), ...Object.keys(ir.flows)]) {
      if (!resto.startsWith(candidato)) continue;
      const siguiente = resto.charAt(candidato.length);
      if (siguiente !== '' && siguiente !== '.' && siguiente !== '[') continue;
      if (id === null || candidato.length > id.length) id = candidato;
    }
  }
  if (id === null) {
    const corte = resto.search(/[.[]/);
    id = corte === -1 ? resto : resto.slice(0, corte);
  }
  if (id === '') return null;
  const cola = resto.slice(id.length);
  const campo = /^\.([^.[]+)/.exec(cola)?.[1] ?? null;
  return { id, campo };
}

/** The class of `id` in the IR (`'flow'` for a sequence flow), or `null` without one. */
function claseDe(ir: ProcessIR | null, id: string): ClaseElemento | null {
  if (ir === null) return null;
  if (ir.flows[id] !== undefined) return 'flow';
  return (ir.nodes[id]?.type as ClaseElemento | undefined) ?? null;
}

/** The step an element is configured in when the problem names the element and no field. */
function pasoDeClase(clase: ClaseElemento | null): PasoId | null {
  switch (clase) {
    case 'start':
      return 'arrivals';
    case 'task':
    case 'timer':
      return 'times';
    case 'xor':
    case 'or':
    case 'flow':
      return 'routes';
    default:
      return null;
  }
}

/**
 * The step where the problem at `ruta` is fixed, or `null` when no step owns it (`extends`,
 * `model`, an unknown element): those go to the list at the foot of the panel.
 */
export function pasoDeProblema(ruta: string, ir: ProcessIR | null): PasoId | null {
  const raiz = /^[^.[]+/.exec(ruta)?.[0] ?? '';
  if (raiz === 'run') return 'run';
  if (raiz === 'calendars') return 'calendars';
  if (raiz === 'resources') return 'resources';
  if (raiz !== 'elements') return null;
  const partes = partirElemento(ruta, ir);
  if (partes === null) return null;
  if (partes.campo !== null) {
    for (const [paso, campos] of Object.entries(CAMPOS_DE_PASO) as [PasoId, readonly string[]][]) {
      if (campos.includes(partes.campo)) return paso;
    }
  }
  return pasoDeClase(claseDe(ir, partes.id));
}

/**
 * The element a problem is about, to select it when the person jumps to the problem; `null` for
 * a path outside `elements` or an id the model does not have (selecting it would select nothing).
 */
export function elementoDeProblema(ruta: string, ir: ProcessIR | null): string | null {
  const partes = partirElemento(ruta, ir);
  if (partes === null) return null;
  if (ir !== null && ir.nodes[partes.id] === undefined && ir.flows[partes.id] === undefined) return null;
  return partes.id;
}

/**
 * The tasks of the model whose resolved scenario gives them no `processingTime` (the design's «No
 * duration»). The engine runs them in zero time (R-DEG-3) and only warns when the whole entry is
 * missing, so this is the panel's own check: a task without a time is almost always a task nobody
 * has filled in yet, and it is the first thing the Times step exists to catch.
 */
export function tareasSinDuracion(resuelto: Record<string, unknown>, ir: ProcessIR | null): string[] {
  if (ir === null) return [];
  const elementos = resuelto['elements'];
  const mapa = typeof elementos === 'object' && elementos !== null ? (elementos as Record<string, unknown>) : {};
  return Object.entries(ir.nodes)
    .filter(([id, nodo]) => {
      if (nodo.type !== 'task') return false;
      const entrada = mapa[id];
      return typeof entrada !== 'object' || entrada === null || (entrada as Record<string, unknown>)['processingTime'] === undefined;
    })
    .map(([id]) => id);
}

/** Problems grouped by the step that owns them, with the ones no step owns apart. */
export interface ProblemasPorPaso<P> {
  porPaso: Record<PasoId, P[]>;
  sinPaso: P[];
}

export function agruparPorPaso<P extends { ruta: string }>(problemas: readonly P[], ir: ProcessIR | null): ProblemasPorPaso<P> {
  const porPaso: Record<PasoId, P[]> = { arrivals: [], times: [], routes: [], resources: [], calendars: [], run: [] };
  const sinPaso: P[] = [];
  for (const problema of problemas) {
    const paso = pasoDeProblema(problema.ruta, ir);
    if (paso === null) sinPaso.push(problema);
    else porPaso[paso].push(problema);
  }
  return { porPaso, sinPaso };
}
