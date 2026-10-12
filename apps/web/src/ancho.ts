/**
 * Activity width (#563): tasks (every subtype) and call activities can be made wider or narrower,
 * by dragging their left or right handle or from the Properties panel. Height stays as it is.
 *
 * bpmn-js 18 only lets expanded sub-processes, lanes, pools, text annotations and groups be
 * resized (`BpmnRules.canResize`). This rule runs before it and answers for tasks and call
 * activities only; everything else falls through to bpmn-js unchanged. `ResizeHandles` draws a
 * handle for each direction the rule allows, so asking only for `e` and `w` is what gives these
 * activities their two side handles and no others.
 *
 * Both ways go through `modeling.resizeShape`, one undoable command: the flows are laid out
 * again, boundary events follow, and the new `dc:Bounds` is what `saveXML` writes.
 */
import RuleProvider from 'diagram-js/lib/features/rules/RuleProvider';
import { is } from 'bpmn-js/lib/util/ModelUtil';

/**
 * The narrowest supported activity, in diagram units: half the default 100, still room for the
 * type icon in the corner and the loop/multi-instance marker at the bottom.
 */
export const ANCHO_MINIMO = 50;

/** The widest one typed in the field: 20 default tasks side by side, so a stray `1e7` is refused. */
export const ANCHO_MAXIMO = 2000;

interface Caja { x: number; y: number; width: number; height: number }

/** A canvas shape as diagram-js hands it out, or (when bpmn-js's replace asks) a business object. */
interface Forma extends Partial<Caja> { businessObject?: unknown }

interface Modeling { resizeShape(forma: Forma, caja: Caja): void }

/** Whether the width of `forma` can be edited: tasks (with their subtypes) and call activities. */
export function conAncho(forma: unknown): boolean {
  return is(forma as never, 'bpmn:Task') || is(forma as never, 'bpmn:CallActivity');
}

/**
 * Why `texto` is not a size between `minimo` and `maximo`, or `null` if it is (then
 * `Number(texto)` is it). The width of an activity, and the size of a lane (#596).
 */
export function problemaDeMedida(texto: string, minimo: number, maximo: number): 'vacio' | 'numero' | 'minimo' | 'maximo' | null {
  if (texto.trim() === '') return 'vacio';
  // Plain decimals only: `Number` would also take `0x64` and `1e2`.
  if (!/^\d+(\.\d+)?$/.test(texto.trim())) return 'numero';
  const valor = Number(texto.trim());
  if (valor < minimo) return 'minimo';
  return valor > maximo ? 'maximo' : null;
}

/** Why `texto` is not a width that can be set, or `null` if it is (then `Number(texto)` is it). */
export function problemaDeAncho(texto: string): 'vacio' | 'numero' | 'minimo' | 'maximo' | null {
  return problemaDeMedida(texto, ANCHO_MINIMO, ANCHO_MAXIMO);
}

export class LilaAncho extends RuleProvider {
  static override $inject = ['eventBus', 'modeling'];

  constructor(eventBus: ConstructorParameters<typeof RuleProvider>[0], private readonly modeling: Modeling) {
    super(eventBus);
    // Dragging below the minimum stops at it instead of refusing the whole drag; the height is
    // its own minimum, so it cannot change either.
    eventBus.on('resize.start', 1500, ({ context }: { context: { shape: Forma; minDimensions?: object } }) => {
      if (conAncho(context.shape)) context.minDimensions = { width: ANCHO_MINIMO, height: context.shape.height };
    });
  }

  override init(): void {
    this.addRule('shape.resize', 1500, ({ shape, newBounds, direction }: { shape: Forma; newBounds?: Caja; direction?: string }) => {
      if (!conAncho(shape)) return undefined;
      if (direction !== undefined && direction !== 'e' && direction !== 'w') return false;
      if (newBounds !== undefined) return newBounds.width >= ANCHO_MINIMO && newBounds.height === shape.height;
      if (direction !== undefined) return true;
      // No direction and no bounds: bpmn-js's replace asks with a business object (allowing it
      // keeps the width when a task becomes a user task); the space tool asks with a canvas shape
      // and may push in either axis, so it keeps moving activities instead of resizing them.
      return shape.businessObject === undefined;
    });
  }

  /** Sets the width of `forma`, keeping its left edge and its height. The caller validates. */
  fijar(forma: Caja, ancho: number): void {
    this.modeling.resizeShape(forma, { x: forma.x, y: forma.y, width: ancho, height: forma.height });
  }
}

/** didi module for `additionalModules` in `Modeler.tsx`. */
export const moduloAncho = {
  __init__: ['lilaAncho'],
  lilaAncho: ['type', LilaAncho],
};
