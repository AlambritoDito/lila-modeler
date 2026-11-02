/**
 * Centring an element on the canvas (#410). Apart from `Modeler.tsx` because that module cannot
 * be imported by a test (bpmn-js and its plugins), and this is the one piece worth a unit test.
 */
import type { Elemento } from './Modeler';

interface Caja { x: number; y: number; width: number; height: number }

/** The two canvas calls `centrar` needs. */
export interface CanvasCentrable {
  scrollToElement(elemento: unknown): void;
  viewbox(): Caja;
  viewbox(caja: Caja): void;
}

/**
 * Puts `elemento` in the middle of the view at the current zoom. `scrollToElement` goes first
 * because it also switches to the element's plane (a collapsed sub-process); on its own it only
 * scrolls until the element is inside a 100 px margin, which can leave it in a corner (QA of #438).
 */
export function centrar(canvas: CanvasCentrable, elemento: Elemento): void {
  canvas.scrollToElement(elemento);
  const vista = canvas.viewbox();
  const { x, y, width, height } = caja(elemento);
  canvas.viewbox({ x: x + width / 2 - vista.width / 2, y: y + height / 2 - vista.height / 2, width: vista.width, height: vista.height });
}

/** A shape has `x/y/width/height`; a connection only has `waypoints`, so its box is theirs. */
function caja(elemento: Elemento): Caja {
  const puntos = Array.isArray(elemento.waypoints) ? (elemento.waypoints as { x: number; y: number }[]) : [];
  if (puntos.length === 0) return { x: elemento.x ?? 0, y: elemento.y ?? 0, width: elemento.width ?? 0, height: elemento.height ?? 0 };
  const xs = puntos.map((p) => p.x); const ys = puntos.map((p) => p.y);
  const x = Math.min(...xs); const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Screen pixels kept clear on each side of the diagram by `ajustar` (#717). */
export interface Margen { arriba: number; derecha: number; abajo: number; izquierda: number }

/** The canvas call `ajustar` needs: diagram-js's `viewbox()` also reports the diagram and the view. */
export interface CanvasAjustable {
  viewbox(): Caja & { inner: Caja; outer: { width: number; height: number } };
  viewbox(caja: Caja): void;
}

/**
 * Fits the whole diagram inside the view minus `margen`, centred across and at the top of the
 * free area (#717). diagram-js's `zoom('fit-viewport')` pins the diagram to the top-left corner
 * with no margin, under the canvas's floating top row, which then hid the start event. Top, not
 * middle, so a wide diagram stays clear of the minimap in the bottom-left corner, as it was.
 * An empty diagram or a view with no room left is left as it is.
 */
export function ajustar(canvas: CanvasAjustable, margen: Margen): void {
  const { inner, outer } = canvas.viewbox();
  const ancho = outer.width - margen.izquierda - margen.derecha;
  const alto = outer.height - margen.arriba - margen.abajo;
  if (!(inner.width > 0 && inner.height > 0 && ancho > 0 && alto > 0)) return;
  const escala = Math.min(1, ancho / inner.width, alto / inner.height);
  canvas.viewbox({
    x: inner.x + inner.width / 2 - (margen.izquierda + ancho / 2) / escala,
    y: inner.y - margen.arriba / escala,
    width: outer.width / escala,
    height: outer.height / escala,
  });
}
