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
  const { x = 0, y = 0, width = 0, height = 0 } = elemento;
  canvas.viewbox({ x: x + width / 2 - vista.width / 2, y: y + height / 2 - vista.height / 2, width: vista.width, height: vista.height });
}
