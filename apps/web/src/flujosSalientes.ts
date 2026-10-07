/**
 * Lote M, C6: in Routes, the outgoing flows of the gateway being split are drawn in the accent
 * colour on the canvas (design 1b, «Qué % sigue cada camino»), so the person sees which paths the
 * percentages of the panel are about. A canvas marker (`c6-saliente`) per flow, painted by
 * `app.css`; the pattern of the other canvas layers (`apply(modeler, …)`), idempotent.
 */
import type { ProcessIR } from '@lila-modeler/engine';
import { compuertaDeSeleccion } from './repartoRutas';

export const MARCA_SALIENTE = 'c6-saliente';

/** The canvas ids of the flows to mark: the selected (or selected flow's) gateway's exits. */
export function flujosSalientes(ir: ProcessIR | null, seleccion: string | null): string[] {
  if (ir === null) return [];
  const idIr = seleccion === null ? null
    : ir.nodes[seleccion] !== undefined || ir.flows[seleccion] !== undefined ? seleccion
      : Object.entries(ir.source.originalIds).find(([, original]) => original === seleccion)?.[0] ?? seleccion;
  const compuerta = compuertaDeSeleccion(ir, idIr);
  if (compuerta === null) return [];
  return (ir.nodes[compuerta]?.outgoing ?? []).map((f) => ir.source.originalIds[f] ?? f);
}

interface Marcador {
  addMarker(elemento: string, marca: string): void;
  removeMarker(elemento: string, marca: string): void;
}

/** What was marked last, per canvas, so the next call only has to undo that. */
const marcados = new WeakMap<object, string[]>();

/** Marks `ids` (canvas ids) and unmarks what the previous call marked. Unknown ids are skipped. */
export function marcarSalientes(canvas: object, ids: readonly string[]): void {
  const c = canvas as Marcador;
  for (const id of marcados.get(canvas) ?? []) {
    try { c.removeMarker(id, MARCA_SALIENTE); } catch { /* the element is gone */ }
  }
  const hechos: string[] = [];
  for (const id of ids) {
    try { c.addMarker(id, MARCA_SALIENTE); hechos.push(id); } catch { /* not on this canvas */ }
  }
  marcados.set(canvas, hechos);
}
