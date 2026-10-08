/**
 * Lane controls on the canvas (#596, section 07 «pools» of the Claude Design draft):
 *
 * - a «+» on the pool's edge before every lane and after the last: one click adds a lane right
 *   there, with nothing selected first (`LilaCarriles.insertar`);
 * - a ⠿ handle next to each lane's header: dragging it onto another lane takes the lane to that place
 *   (`LilaCarriles.moverA`, one undo step), and Alt+↑/↓ on it — or on the canvas with the lane
 *   selected — moves it one place (`LilaCarriles.mover`, the swap of #580).
 *
 * Both are diagram-js overlays: real `<button>`s with translated labels, so they take the keyboard
 * focus and a screen reader names them. They are repainted from the canvas tree after every
 * command (`elements.changed`), on import, on a change of plane and on a change of language, so
 * they never point at a lane that moved. The focused one gets its focus back after a repaint.
 *
 * They belong to Model: outside it (`.modo-simular`, `.modo-resultados` on the app shell) and
 * while «Validate paths» animates tokens (`.simulation` on bpmn-js's container) `app.css` hides
 * them and Alt+↑/↓ does nothing.
 *
 * Resizing needs nothing here: bpmn-js already resizes lanes from the handles of a selected lane;
 * `app.css` paints those handles in the theme's selection colour.
 */
import { isExpanded } from 'bpmn-js/lib/util/DiUtil';
import { carrilesDe, eje, hermanos, nombreCarril, vertical, type Direccion, type Forma, type LilaCarriles } from './carriles';
import { strings, subscribe } from './i18n';

/** Overlay type: diagram-js puts `djs-overlay-lila-carril` on each overlay's container. */
const TIPO = 'lila-carril';

/** Marker of the lane a dragged lane would land on. */
const DESTINO = 'lila-carril-destino';

interface Punto { x: number; y: number }

interface Inyectados {
  eventBus: { on(eventos: string | string[], prioridad: number, escuchar: (e: never) => unknown): void };
  overlays: {
    add(el: Forma, tipo: string, overlay: { position: { left?: number; top?: number; right?: number; bottom?: number }; html: HTMLElement; scale?: object; show?: object }): string;
    remove(filtro: { type: string }): void;
  };
  elementRegistry: { filter(prueba: (el: Forma) => boolean): Forma[] };
  canvas: {
    getContainer(): HTMLElement;
    viewbox(): { x: number; y: number; scale: number };
    addMarker(el: Forma, marca: string): void;
    removeMarker(el: Forma, marca: string): void;
  };
  selection: { select(el: Forma): void; get(): Forma[] };
  keyboard: { addListener(prioridad: number, escuchar: (e: { keyEvent: KeyboardEvent }) => unknown): void };
  directEditing: { activate(el: Forma): void };
}

/** Alt+↑/← takes a lane one place back, Alt+↓/→ one place forward; anything else is not ours. */
export function direccionDeTecla(e: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>): Direccion | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') return 'arriba';
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') return 'abajo';
  return null;
}

/** The pools that take lanes: bpmn-js only adds lanes to an expanded pool (one with a process). */
const esPoolConProceso = (el: Forma): boolean =>
  el.type === 'bpmn:Participant' && el.labelTarget === undefined && isExpanded(el as never);

const nombrePool = (pool: Forma): string => {
  const nombre = pool.businessObject.get?.('name');
  return typeof nombre === 'string' && nombre.trim() !== '' ? nombre.trim() : strings().propiedades.tipos['bpmn:Participant'] ?? 'Pool';
};

export class LilaControlesCarriles {
  static $inject = ['eventBus', 'overlays', 'elementRegistry', 'canvas', 'selection', 'keyboard', 'directEditing', 'lilaCarriles'];

  /** Ends the drag in progress, if any (restores the marker and the listeners). */
  private terminarArrastre: (() => void) | null = null;

  constructor(
    eventBus: Inyectados['eventBus'],
    private readonly overlays: Inyectados['overlays'],
    private readonly elementRegistry: Inyectados['elementRegistry'],
    private readonly canvas: Inyectados['canvas'],
    private readonly selection: Inyectados['selection'],
    keyboard: Inyectados['keyboard'],
    private readonly directEditing: Inyectados['directEditing'],
    private readonly carriles: LilaCarriles,
  ) {
    eventBus.on(['import.done', 'elements.changed', 'root.set'], 500, () => this.pintar());
    const dejarDeOir = subscribe(() => this.pintar());
    eventBus.on('diagram.destroy', 1000, () => {
      dejarDeOir();
      this.terminarArrastre?.();
    });
    // Above bpmn-js's arrow-key moves (which refuse lanes anyway): Alt+↑/↓ on a selected lane.
    keyboard.addListener(2000, ({ keyEvent }) => {
      const direccion = direccionDeTecla(keyEvent);
      const [carril, ...otros] = this.selection.get();
      if (direccion === null || carril?.type !== 'bpmn:Lane' || otros.length > 0 || !this.activo()) return undefined;
      this.carriles.mover(carril, direccion);
      return true;
    });
  }

  /** Model only, and not while «Validate paths» animates tokens (see the header). */
  activo(): boolean {
    const contenedor = this.canvas.getContainer();
    return contenedor.closest('.modo-simular, .modo-resultados') === null &&
      contenedor.parentElement?.classList.contains('simulation') !== true;
  }

  /** Draws every «+» and ⠿ again from the canvas tree. */
  pintar(): void {
    const enfocado = (document.activeElement as HTMLElement | null)?.closest?.('[data-lila-carril]')?.getAttribute('data-lila-carril') ?? null;
    this.overlays.remove({ type: TIPO });
    for (const pool of this.elementRegistry.filter(esPoolConProceso)) this.pintarPool(pool);
    if (enfocado !== null) {
      [...this.canvas.getContainer().querySelectorAll<HTMLElement>('[data-lila-carril]')]
        .find((b) => b.dataset['lilaCarril'] === enfocado)?.focus();
    }
  }

  private pintarPool(pool: Forma): void {
    const lista = carrilesDe(pool);
    const v = vertical(pool);
    const nombre = nombrePool(pool);
    const mas = (indice: number): HTMLElement => this.boton({
      clave: `mas:${pool.id}:${indice}`,
      clase: 'lila-carril-mas',
      texto: '+',
      titulo: strings().carriles.anadirAqui,
      etiqueta: strings().carriles.anadirEn(indice + 1, nombre),
      alPulsar: () => this.anadir(pool, indice),
    });
    if (lista.length === 0) {
      // Where the first lane would start: past the pool's header, at its far end.
      this.anadirOverlay(pool, v ? { right: 0, top: 30 } : { left: 30, bottom: 0 }, mas(0));
      return;
    }
    // In this order the Tab key walks them as they are drawn: «+», ⠿, «+», ⠿, …, the last «+».
    lista.forEach((carril, i) => {
      this.anadirOverlay(carril, { left: 0, top: 0 }, mas(i));
      this.pintarAsas(carril);
    });
    this.anadirOverlay(lista.at(-1)!, v ? { right: 0, top: 0 } : { left: 0, bottom: 0 }, mas(lista.length));
  }

  /** The ⠿ of `carril` and of its nested lanes, next to each one's header strip. */
  private pintarAsas(carril: Forma): void {
    const nombre = nombreCarril(carril);
    const asa = this.boton({
      clave: `asa:${carril.id}`,
      clase: 'lila-carril-asa',
      texto: '⠿',
      titulo: strings().carriles.asaTitulo,
      etiqueta: strings().carriles.asa(nombre),
      alPulsar: () => this.selection.select(carril),
    });
    asa.addEventListener('keydown', (e) => {
      const direccion = direccionDeTecla(e);
      if (direccion === null || !this.activo()) return;
      e.preventDefault();
      e.stopPropagation();
      this.carriles.mover(carril, direccion);
    });
    asa.addEventListener('pointerdown', (e) => this.arrastrar(e, carril));
    // Past the header strip, in the corner of the lane's own area: bpmn-js centres the lane's name
    // along the whole strip, so anything inside the strip would sit on a long name.
    this.anadirOverlay(carril, vertical(carril) ? { left: 14, top: 44 } : { left: 44, top: 14 }, asa);
    for (const anidado of carrilesDe(carril)) this.pintarAsas(anidado);
  }

  private boton(o: { clave: string; clase: string; texto: string; titulo: string; etiqueta: string; alPulsar: () => void }): HTMLElement {
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = o.clase;
    boton.textContent = o.texto;
    boton.title = o.titulo;
    boton.setAttribute('aria-label', o.etiqueta);
    boton.dataset['lilaCarril'] = o.clave;
    boton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.activo()) o.alPulsar();
    });
    return boton;
  }

  /**
   * One overlay anchored at a point of `el`: the button is centred on it by CSS, so it stays put
   * when diagram-js scales the overlay (it scales from the top left). Not smaller than 80 % nor
   * larger than 150 %, so it stays clickable zoomed out; hidden below 25 % zoom.
   */
  private anadirOverlay(el: Forma, position: { left?: number; top?: number; right?: number; bottom?: number }, boton: HTMLElement): void {
    const ancla = document.createElement('div');
    ancla.className = 'lila-carril-ancla';
    ancla.append(boton);
    this.overlays.add(el, TIPO, { position, html: ancla, scale: { min: 0.8, max: 1.5 }, show: { minZoom: 0.25 } });
  }

  private anadir(pool: Forma, indice: number): void {
    const nuevo = this.carriles.insertar(pool, indice);
    this.selection.select(nuevo);
    this.directEditing.activate(nuevo);
  }

  /** The point of the diagram under the pointer. */
  private aDiagrama(e: { clientX: number; clientY: number }): Punto {
    const caja = this.canvas.getContainer().getBoundingClientRect();
    const vista = this.canvas.viewbox();
    return { x: vista.x + (e.clientX - caja.left) / vista.scale, y: vista.y + (e.clientY - caja.top) / vista.scale };
  }

  /**
   * Drag from the ⠿ of `carril`: the sibling lane under the pointer is marked, and dropping there
   * takes `carril` to its place. A press without a move only selects the lane (the `click` that
   * follows does it); Escape or leaving the pool's lanes cancels.
   */
  private arrastrar(e: PointerEvent, carril: Forma): void {
    if (e.button !== 0 || !this.activo()) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement | null)?.focus();
    this.terminarArrastre?.();
    const { pos, tam } = eje(carril);
    const inicio = { x: e.clientX, y: e.clientY };
    const contenedor = this.canvas.getContainer();
    let destino: Forma | undefined;
    let movido = false;
    const marcar = (nuevo: Forma | undefined): void => {
      if (nuevo === destino) return;
      if (destino !== undefined) this.canvas.removeMarker(destino, DESTINO);
      destino = nuevo;
      if (destino !== undefined) this.canvas.addMarker(destino, DESTINO);
    };
    const mover = (ev: PointerEvent): void => {
      if (!movido && Math.hypot(ev.clientX - inicio.x, ev.clientY - inicio.y) < 4) return;
      movido = true;
      contenedor.classList.add('lila-arrastrando-carril');
      const p = this.aDiagrama(ev)[pos];
      marcar(hermanos(carril).find((l) => p >= l[pos] && p < l[pos] + l[tam]));
    };
    const fin = (soltar: boolean): void => {
      document.removeEventListener('pointermove', mover, true);
      document.removeEventListener('pointerup', alSoltar, true);
      document.removeEventListener('pointercancel', alCancelar, true);
      document.removeEventListener('keydown', alEscapar, true);
      contenedor.classList.remove('lila-arrastrando-carril');
      const llegada = destino;
      marcar(undefined);
      this.terminarArrastre = null;
      if (soltar && movido && llegada !== undefined && llegada !== carril) this.carriles.moverA(carril, hermanos(carril).indexOf(llegada));
    };
    const alSoltar = (): void => fin(true);
    const alCancelar = (): void => fin(false);
    const alEscapar = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      ev.stopPropagation();
      fin(false);
    };
    document.addEventListener('pointermove', mover, true);
    document.addEventListener('pointerup', alSoltar, true);
    document.addEventListener('pointercancel', alCancelar, true);
    document.addEventListener('keydown', alEscapar, true);
    this.terminarArrastre = alCancelar;
  }
}

/** didi module for `additionalModules` in `Modeler.tsx`; it needs `moduloCarriles` loaded too. */
export const moduloControlesCarriles = {
  __init__: ['lilaControlesCarriles'],
  lilaControlesCarriles: ['type', LilaControlesCarriles],
};
