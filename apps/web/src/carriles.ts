/**
 * Lanes (#580): move a lane above or below its neighbour, and add a lane from the palette without
 * selecting the pool first.
 *
 * bpmn-js 18 forbids moving a lane (`BpmnRules.canMove`), and its context pad only adds lanes
 * above or below. `lila.carril.mover` swaps two adjacent sibling lanes as one undoable command:
 * each lane goes to where the band of the other started (so lanes of different heights keep
 * their own height), the shapes whose centre lies in a band travel with it (their boundary
 * events and labels follow through `modeling.moveElements`, and connections are kept), and the
 * two lanes trade places in their `laneSet`/`childLaneSet`, so the exported XML lists them in the
 * new order.
 *
 * The pick mode (`elegirPool`) is what the palette's Lane tool does with nothing fitting selected:
 * the next click on a pool or a lane adds the lane there (at the bottom, as with a selection),
 * a click elsewhere or Escape cancels.
 */
import { isHorizontal } from 'bpmn-js/lib/util/DiUtil';
import { strings } from './i18n';

/** A canvas shape as diagram-js hands it out: geometry, tree and the semantic element. */
export interface Forma {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  parent?: Forma;
  children?: Forma[];
  labelTarget?: unknown;
  waypoints?: unknown;
  host?: unknown;
  businessObject: Semantico;
}

interface Semantico {
  $parent?: { lanes?: Semantico[]; get?(nombre: string): unknown };
  $instanceOf?(tipo: string): boolean;
  get?(nombre: string): unknown;
}

export type Direccion = 'arriba' | 'abajo';

interface Orden { lista: Semantico[]; orden: Semantico[]; previo?: Semantico[] }

interface Contexto {
  carril: Forma;
  direccion: Direccion;
  /** Taken in `execute`, given back in `revert`: what bpmn-js's lane-ref commands reshuffle. */
  refs?: { lista: Semantico[]; copia: Semantico[] }[];
}

interface Inyectados {
  commandStack: {
    register(nombre: string, handler: object): void;
    execute(nombre: string, ctx: object): void;
  };
  modeling: {
    moveElements(formas: Forma[], delta: { x: number; y: number }): void;
    updateLaneRefs(nodos: Forma[], carriles: Forma[]): void;
    addLane(destino: Forma, lugar: 'top' | 'bottom'): Forma;
  };
  eventBus: { on(evento: string, prioridad: number, escuchar: (e: { element?: Forma }) => unknown): void };
  contextPad: { registerProvider(prioridad: number, proveedor: object): void; open?(el: Forma, forzar?: boolean): void; isOpen?(el?: Forma): boolean };
  directEditing: { activate(el: unknown): void };
  canvas: { getContainer(): HTMLElement; getRootElement(): Forma };
  elementRegistry: { filter(prueba: (el: Forma) => boolean): Forma[] };
}

const esCarril = (el: Forma | undefined): boolean => el?.type === 'bpmn:Lane';
const esPool = (el: Forma | undefined): boolean => el?.type === 'bpmn:Participant';

/** The axis lanes stack on: `y` in a horizontal pool, `x` in a vertical one. */
function eje(carril: Forma): { pos: 'x' | 'y'; tam: 'width' | 'height' } {
  return isHorizontal(carril as never) === false ? { pos: 'x', tam: 'width' } : { pos: 'y', tam: 'height' };
}

/** The sibling lanes of `carril` (itself included), in drawing order along their axis. */
export function hermanos(carril: Forma): Forma[] {
  const { pos } = eje(carril);
  return (carril.parent?.children ?? []).filter(esCarril).sort((a, b) => a[pos] - b[pos]);
}

/** The adjacent sibling `carril` would swap places with, or `undefined` at the edge. */
export function vecino(carril: Forma, direccion: Direccion): Forma | undefined {
  if (!esCarril(carril)) return undefined;
  const lista = hermanos(carril);
  const i = lista.indexOf(carril);
  return lista[direccion === 'arriba' ? i - 1 : i + 1];
}

/** The lane or pool whose lanes carry flow node refs: the outermost container of `carril`. */
function raiz(carril: Forma): Forma {
  let el = carril;
  while (esCarril(el) && el.parent !== undefined) el = el.parent;
  return el;
}

/**
 * The shapes that travel with the band of `carril`: every child of the lanes' root (the pool)
 * whose centre lies inside the band. Lanes are not among them (nested lanes move with their
 * parent lane), nor labels, connections or boundary events, which follow their owner.
 */
function contenido(carril: Forma): Forma[] {
  const { pos, tam } = eje(carril);
  const desde = carril[pos], hasta = carril[pos] + carril[tam];
  return (raiz(carril).children ?? []).filter((el) =>
    !esCarril(el) && el.labelTarget === undefined && el.waypoints === undefined && el.host === undefined &&
    el[tam] !== undefined && el[pos] + el[tam] / 2 > desde && el[pos] + el[tam] / 2 < hasta);
}

/** Every lane under `el`, at any depth. */
function carrilesBajo(el: Forma): Forma[] {
  return (el.children ?? []).filter(esCarril).flatMap((c) => [c, ...carrilesBajo(c)]);
}

export class LilaCarriles {
  static $inject = ['commandStack', 'modeling', 'eventBus', 'contextPad', 'directEditing', 'canvas', 'elementRegistry'];

  private alTerminar: (() => void) | null = null;
  private readonly escape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    // #581: an Escape meant for an open dialog (⌘K, Settings) is that dialog's: it closes it and
    // the pick stays on, instead of being swallowed here first.
    if ((e.target as Element | null)?.closest?.('dialog[open]') != null) return;
    e.preventDefault();
    e.stopPropagation();
    this.cancelar();
  };

  constructor(
    private readonly commandStack: Inyectados['commandStack'],
    private readonly modeling: Inyectados['modeling'],
    eventBus: Inyectados['eventBus'],
    contextPad: Inyectados['contextPad'],
    private readonly directEditing: Inyectados['directEditing'],
    private readonly canvas: Inyectados['canvas'],
    private readonly elementRegistry: Inyectados['elementRegistry'],
  ) {
    commandStack.register('lila.carril.mover', {
      // The lists the nested commands reshuffle (`listasReordenables`): taken here and given back
      // in `revert`, which runs after the nested commands have been undone.
      execute: (ctx: Contexto) => {
        ctx.refs = [...listasReordenables(raiz(ctx.carril))].map((lista) => ({ lista, copia: [...lista] }));
        return [];
      },
      revert: (ctx: Contexto) => {
        for (const { lista, copia } of ctx.refs ?? []) lista.splice(0, lista.length, ...copia);
        return [];
      },
      postExecute: (ctx: Contexto) => this.intercambiar(ctx),
    });
    // Sets lists to a given order: the moves above have shuffled them (`BpmnUpdater` re-appends
    // every moved element to its parent's list).
    commandStack.register('lila.carril.orden', {
      execute: ({ listas }: { listas: Orden[] }) => {
        // Reorders only: what bpmn-js moved in or out of a list meanwhile (an annotation goes to the
        // collaboration's artifacts) stays where bpmn-js put it, newcomers last.
        for (const o of listas) {
          o.previo = [...o.lista];
          const quedan = o.orden.filter((x) => o.previo!.includes(x));
          o.lista.splice(0, o.lista.length, ...quedan, ...o.previo.filter((x) => !quedan.includes(x)));
        }
        return [];
      },
      revert: ({ listas }: { listas: Orden[] }) => {
        for (const o of listas) o.lista.splice(0, o.lista.length, ...o.previo!);
        return [];
      },
    });

    // A destroyed or replaced diagram drops the pick (and its document listener).
    eventBus.on('diagram.destroy', 1000, () => this.cancelar());

    // Pick mode: above the default 1000, so the click neither selects nor reaches bpmn-js.
    eventBus.on('element.click', 1500, ({ element }) => {
      if (this.alTerminar === null) return undefined;
      let destino = element;
      while (destino !== undefined && !esCarril(destino) && !esPool(destino)) destino = destino.parent;
      if (destino === undefined) this.cancelar();
      else this.anadirEn(destino);
      return false;
    });

    const flecha = (d: string): string =>
      `<div class="entry lila-carril-mover"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="${d === 'arriba' ? 13 : 3}" width="18" height="8" rx="1"/><path d="${d === 'arriba' ? 'M12 10V2M8 6l4-4 4 4' : 'M12 14v8M8 18l4 4 4-4'}"/></svg></div>`;
    contextPad.registerProvider(500, {
      getContextPadEntries: (el: Forma) => (entradas: Record<string, unknown>) => {
        if (!esCarril(el)) return entradas;
        const extra: Record<string, unknown> = {};
        for (const d of ['arriba', 'abajo'] as const) {
          if (vecino(el, d) === undefined) continue;
          const titulo = d === 'arriba' ? strings().lienzo.moverCarrilArriba : strings().lienzo.moverCarrilAbajo;
          extra[`lila-carril-${d}`] = {
            group: 'lila-carril',
            html: flecha(d),
            title: titulo,
            action: {
              click: (_e: Event, carril: Forma) => {
                this.mover(carril, d);
                // The entries depend on the new neighbours: refresh the open pad.
                contextPad.open?.(carril, true);
              },
            },
          };
        }
        return { ...entradas, ...extra };
      },
    });
  }

  /** Swaps `carril` with its neighbour in `direccion`, as one undo step; `false` at the edge. */
  mover(carril: Forma, direccion: Direccion): boolean {
    if (vecino(carril, direccion) === undefined) return false;
    this.commandStack.execute('lila.carril.mover', { carril, direccion });
    return true;
  }

  private intercambiar({ carril, direccion }: Contexto): void {
    const otro = vecino(carril, direccion)!;
    const [arriba, abajo] = direccion === 'arriba' ? [otro, carril] : [carril, otro];
    const { pos, tam } = eje(carril);
    const delta = (d: number) => (pos === 'y' ? { x: 0, y: d } : { x: d, y: 0 });
    // Both bands, and the order of every list the moves touch, are read before anything moves.
    // Only the two lanes trade places in their `laneSet`; flow elements and artifacts keep
    // their order, so the simulation reads the document as before.
    const deArriba = contenido(arriba), deAbajo = contenido(abajo);
    const a = arriba.businessObject, b = abajo.businessObject;
    const listas: Orden[] = [...listasReordenables(raiz(carril), false)].map((lista) => ({
      lista, orden: lista.map((l) => (l === a ? b : l === b ? a : l)),
    }));
    // The upper lane ends where the lower one ended; the lower one starts where the upper started.
    this.modeling.moveElements([arriba, ...deArriba], delta(abajo[tam]));
    this.modeling.moveElements([abajo, ...deAbajo], delta(-arriba[tam]));
    // The two moves overlapped for a moment: one last pass over the whole pool settles the refs.
    this.modeling.updateLaneRefs([], [arriba, abajo]);
    this.commandStack.execute('lila.carril.orden', { listas });
  }

  /** Whether the palette's lane tool is waiting for a click on a pool. */
  eligiendo(): boolean {
    return this.alTerminar !== null;
  }

  /**
   * The palette's lane tool with nothing fitting selected. With a single pool the lane goes
   * straight into it; with several, the next click on a pool or lane picks it. `alTerminar` runs
   * once, when the lane is added or the pick is cancelled. `false` when there is no pool at all.
   */
  elegirPool(alTerminar: () => void): boolean {
    this.cancelar();
    const pools = this.elementRegistry.filter((el) => esPool(el) && el.labelTarget === undefined);
    if (pools.length === 0) return false;
    if (pools.length === 1) {
      this.directEditing.activate(this.modeling.addLane(pools[0]!, 'bottom'));
      alTerminar();
      return true;
    }
    this.alTerminar = alTerminar;
    this.canvas.getContainer().classList.add('lila-eligiendo-pool');
    document.addEventListener('keydown', this.escape, true);
    return true;
  }

  /** Leaves the pick mode, if it is on. */
  cancelar(): void {
    const alTerminar = this.alTerminar;
    if (alTerminar === null) return;
    this.alTerminar = null;
    this.canvas.getContainer().classList.remove('lila-eligiendo-pool');
    document.removeEventListener('keydown', this.escape, true);
    alTerminar();
  }

  private anadirEn(destino: Forma): void {
    const nuevo = this.modeling.addLane(destino, 'bottom');
    this.cancelar();
    this.directEditing.activate(nuevo);
  }
}

/**
 * The lists a lane swap reshuffles through bpmn-js's own commands, whose undo appends instead of
 * putting back: the `laneSet`s, each lane's `flowNodeRef`, each flow node's `lanes`, the
 * process's flow elements and artifacts. (The DI needs nothing: bpmn-js rewrites the plane from
 * the canvas tree on every save, `BpmnDiOrdering`.) Taken whole, so ⌘Z gives the XML back byte
 * for byte. Without `conRefs` the lane refs are left out: `updateLaneRefs` recomputes those from
 * the geometry.
 */
function listasReordenables(raizDeCarriles: Forma, conRefs = true): Set<Semantico[]> {
  const listas = new Set<unknown>();
  for (const c of carrilesBajo(raizDeCarriles)) {
    listas.add(c.businessObject.$parent?.lanes);
    if (conRefs) listas.add(c.businessObject.get?.('flowNodeRef'));
  }
  for (const c of raizDeCarriles.children ?? []) {
    if (conRefs && c.businessObject.$instanceOf?.('bpmn:FlowNode') === true) listas.add(c.businessObject.get?.('lanes'));
    const padre = c.businessObject.$parent as Semantico | undefined;
    listas.add(padre?.get?.('flowElements'));
    listas.add(padre?.get?.('artifacts'));
  }
  return new Set([...listas].filter((l): l is Semantico[] => Array.isArray(l)));
}

/** didi module for `additionalModules` in `Modeler.tsx`. */
export const moduloCarriles = {
  __init__: ['lilaCarriles'],
  lilaCarriles: ['type', LilaCarriles],
};
