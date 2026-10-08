/**
 * «Used by» of the calendar manager (Lote M, C3): who reads a calendar in the **resolved**
 * scenario, and which resources it can be assigned to from there.
 *
 * A calendar is read from three places of the format (§ 2.3–2.5): a pool's `calendar`, a shift of
 * a pool's per-shift `capacity` (R-CAL-11, LILA-164) and an element's `calendar` (a task's working
 * hours or a start event's arrival window). All three count, or deleting a calendar «nobody uses»
 * would leave a dangling reference (E-REF-DESCONOCIDA).
 */
import type { ProcessIR } from '@lila-modeler/engine';

import { esObjeto, type Ruta } from './escenarioModelo.js';

export type TipoUso = 'recurso' | 'turno' | 'tarea' | 'llegada' | 'elemento';

export interface Uso {
  tipo: TipoUso;
  /** Key in `resources` or `elements`. */
  id: string;
  /** The pool's `name`, the BPMN name of the element, or the id when there is none. */
  nombre: string;
  /** The path that holds the reference, as `escribir`/`leer` take it. */
  ruta: Ruta;
  /** Only for a shift: its capacity. */
  capacidad?: number;
}

function nombreRecurso(id: string, recurso: Record<string, unknown>): string {
  const nombre = recurso['name'];
  return typeof nombre === 'string' && nombre.trim() !== '' ? nombre : id;
}

/** Every reference to `clave` in `resuelto`, pools first (in file order), then elements. */
export function usadoPor(resuelto: Record<string, unknown>, clave: string, ir?: ProcessIR | null): Uso[] {
  const usos: Uso[] = [];
  const recursos = esObjeto(resuelto['resources']) ? resuelto['resources'] : {};
  for (const [id, recurso] of Object.entries(recursos)) {
    if (!esObjeto(recurso)) continue;
    const nombre = nombreRecurso(id, recurso);
    if (recurso['calendar'] === clave) usos.push({ tipo: 'recurso', id, nombre, ruta: ['resources', id, 'calendar'] });
    const capacidad = recurso['capacity'];
    if (Array.isArray(capacidad)) {
      capacidad.forEach((tramo: unknown, i) => {
        if (esObjeto(tramo) && tramo['calendar'] === clave) {
          usos.push({
            tipo: 'turno',
            id,
            nombre,
            ruta: ['resources', id, 'capacity', i, 'calendar'],
            ...(typeof tramo['capacity'] === 'number' ? { capacidad: tramo['capacity'] } : {}),
          });
        }
      });
    }
  }
  const elementos = esObjeto(resuelto['elements']) ? resuelto['elements'] : {};
  for (const [id, elemento] of Object.entries(elementos)) {
    if (!esObjeto(elemento) || elemento['calendar'] !== clave) continue;
    const nodo = ir?.nodes[id];
    const tipo: TipoUso = nodo?.type === 'task' ? 'tarea' : nodo?.type === 'start' ? 'llegada' : 'elemento';
    const nombre = nodo !== undefined && nodo.name.trim() !== '' ? nodo.name : id;
    usos.push({ tipo, id, nombre, ruta: ['elements', id, 'calendar'] });
  }
  return usos;
}

export interface Asignable {
  id: string;
  nombre: string;
  /** The calendar the pool uses now, if any: assigning replaces it. */
  actual?: string;
}

/**
 * The pools `clave` can be assigned to as their `calendar`: every pool that does not use it yet,
 * except those with per-shift capacity, where a pool `calendar` is forbidden (R16,
 * E-CAPACIDAD-Y-CALENDARIO): their calendars are chosen per shift, in Resources.
 */
export function recursosAsignables(resuelto: Record<string, unknown>, clave: string): Asignable[] {
  const recursos = esObjeto(resuelto['resources']) ? resuelto['resources'] : {};
  const salida: Asignable[] = [];
  for (const [id, recurso] of Object.entries(recursos)) {
    if (!esObjeto(recurso) || Array.isArray(recurso['capacity']) || recurso['calendar'] === clave) continue;
    const actual = recurso['calendar'];
    salida.push({
      id,
      nombre: nombreRecurso(id, recurso),
      ...(typeof actual === 'string' && actual !== '' ? { actual } : {}),
    });
  }
  return salida;
}
