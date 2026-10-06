/**
 * Lote M, C2: the lanes of the canvas in **visual order**, and «click a lane's name to assign it
 * to a resource» while the Resources step is on screen.
 *
 * The scenario panel only gets the IR, and the IR knows a lane by its label (`name ?? id`) and in
 * the order the tasks appear in the file: neither the order people see nor whether the lane has a
 * name at all. Both live in bpmn-js, so this module reads them from the modeler and hands them to
 * the panel through a tiny external store, which keeps the wiring to one call in the shell:
 *
 *     useEffect(() => (modelador === null ? undefined : apply(modelador)), [modelador]);
 *
 * `apply` publishes the lanes now and after every import or command, and — only while a
 * Resources step is mounted (`usePasoRecursos`) — marks the lanes as clickable and turns a click
 * on a lane's label band into `elegirCarril(id)`, which the step answers with «Lane X · n tasks →
 * resource [Assign]». Without `apply` (tests, or before the shell wires it) `useCarriles()` is
 * `null` and the panel falls back to the IR order, as it did before.
 */
import { useEffect, useSyncExternalStore } from 'react';

/** One lane as the person sees it on the canvas. */
export interface CarrilVisual {
  /** BPMN id of the lane: the key, never shown. */
  readonly id: string;
  /** Its name, or `null` when it has none (the panel numbers it instead of printing the id). */
  readonly nombre: string | null;
  /** BPMN ids of the flow nodes the lane holds (`flowNodeRef`). */
  readonly nodos: readonly string[];
}

/** A canvas shape, reduced to what this module reads. */
export interface FormaCarril {
  id?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  di?: { isHorizontal?: boolean };
  businessObject?: { name?: string; flowNodeRef?: readonly { id?: string }[] };
}

/** A diagram-js event, reduced to what the click handler reads. */
export interface EventoCarril {
  element?: FormaCarril;
  originalEvent?: { clientX?: number; clientY?: number };
}

/** The part of the shell's `Modelador` this module uses (it satisfies it structurally). */
export interface LienzoCarriles {
  servicios: {
    elementRegistry: { filter(prueba: (elemento: FormaCarril) => boolean): FormaCarril[] };
    canvas: {
      /** diagram-js always gives `scale`; the shell's type just does not declare it. */
      viewbox(): { x: number; y: number; scale?: number };
      getContainer(): HTMLElement;
      addMarker?(elemento: FormaCarril, clase: string): void;
      removeMarker?(elemento: FormaCarril, clase: string): void;
    };
  };
  suscribir(eventos: string[], escuchar: (evento: EventoCarril) => unknown, prioridad?: number): () => void;
}

/** Width of the band where bpmn-js draws a lane's name (its `LANE_INDENTATION`). */
export const BANDA_ROTULO = 30;

/** Marker class of a clickable lane; `app.css` underlines its name and shows a pointer. */
export const MARCA_ASIGNABLE = 'lila-carril-asignable';

function horizontal(forma: FormaCarril): boolean {
  return forma.di?.isHorizontal !== false;
}

/**
 * The lanes of `formas` in the order they are drawn: top to bottom (left to right in a vertical
 * pool). A parent lane starts where its first child starts, so on a tie the bigger box — the
 * parent — goes first and the children follow it.
 */
export function ordenVisual(formas: readonly FormaCarril[]): CarrilVisual[] {
  const carriles = formas.filter((f) => f.type === 'bpmn:Lane' && typeof f.id === 'string');
  const eje = (f: FormaCarril): [number, number] =>
    horizontal(f) ? [f.y ?? 0, f.x ?? 0] : [f.x ?? 0, f.y ?? 0];
  const area = (f: FormaCarril): number => (f.width ?? 0) * (f.height ?? 0);
  return [...carriles]
    .sort((a, b) => {
      const [a1, a2] = eje(a);
      const [b1, b2] = eje(b);
      return a1 - b1 || a2 - b2 || area(b) - area(a);
    })
    .map((f) => {
      const nombre = f.businessObject?.name?.trim() ?? '';
      return {
        id: f.id!,
        nombre: nombre === '' ? null : nombre,
        nodos: (f.businessObject?.flowNodeRef ?? []).flatMap((ref) => (typeof ref.id === 'string' ? [ref.id] : [])),
      };
    });
}

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

let carriles: readonly CarrilVisual[] | null = null;
let elegido: string | null = null;
let pasosMontados = 0;
const oyentes = new Set<() => void>();

function avisar(): void {
  for (const oyente of oyentes) oyente();
}

function suscribirse(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

/** Replaces the published lanes; `null` means «no modeler wired», and the panel uses the IR. */
export function publicarCarriles(lista: readonly CarrilVisual[] | null): void {
  carriles = lista;
  if (elegido !== null && !(lista ?? []).some((c) => c.id === elegido)) elegido = null;
  avisar();
}

/** The lane picked on the canvas (or `null` to dismiss it). */
export function elegirCarril(id: string | null): void {
  if (elegido === id) return;
  elegido = id;
  avisar();
}

/** The lane picked on the canvas right now, outside React. */
export function carrilElegido(): string | null {
  return elegido;
}

/** Whether a Resources step is on screen; the click handler does nothing otherwise. */
export function pasoRecursosVisible(): boolean {
  return pasosMontados > 0;
}

export function useCarriles(): readonly CarrilVisual[] | null {
  return useSyncExternalStore(suscribirse, () => carriles);
}

export function useCarrilElegido(): string | null {
  return useSyncExternalStore(suscribirse, () => elegido);
}

/** Mounted by the Resources step: while it is, lanes on the canvas are clickable. */
export function usePasoRecursos(): void {
  useEffect(() => {
    pasosMontados++;
    avisar();
    return () => {
      pasosMontados--;
      if (pasosMontados === 0) elegido = null;
      avisar();
    };
  }, []);
}

/* ------------------------------------------------------------------ *
 * The canvas layer
 * ------------------------------------------------------------------ */

/**
 * `true` if the click fell on the lane's label band (the 30 px strip with its name). Without a
 * pointer position — a synthetic event — the whole lane counts.
 */
export function enRotulo(lienzo: LienzoCarriles, carril: FormaCarril, evento: EventoCarril['originalEvent']): boolean {
  if (typeof evento?.clientX !== 'number' || typeof evento.clientY !== 'number') return true;
  const caja = lienzo.servicios.canvas.getContainer().getBoundingClientRect();
  const vista = lienzo.servicios.canvas.viewbox();
  const escala = vista.scale ?? 1;
  const x = vista.x + (evento.clientX - caja.left) / escala;
  const y = vista.y + (evento.clientY - caja.top) / escala;
  return horizontal(carril)
    ? x - (carril.x ?? 0) <= BANDA_ROTULO
    : y - (carril.y ?? 0) <= BANDA_ROTULO;
}

/**
 * Wires the lanes of `lienzo` to the store; returns the cleanup. Idempotent per modeler: calling
 * it again after the cleanup starts over.
 */
export function apply(lienzo: LienzoCarriles): () => void {
  const formas = (): FormaCarril[] => lienzo.servicios.elementRegistry.filter((f) => f.type === 'bpmn:Lane');
  let marcadas: FormaCarril[] = [];

  function desmarcar(): void {
    for (const forma of marcadas) lienzo.servicios.canvas.removeMarker?.(forma, MARCA_ASIGNABLE);
    marcadas = [];
  }

  function marcar(): void {
    desmarcar();
    if (!pasoRecursosVisible()) return;
    marcadas = formas();
    for (const forma of marcadas) lienzo.servicios.canvas.addMarker?.(forma, MARCA_ASIGNABLE);
  }

  function publicar(): void {
    publicarCarriles(ordenVisual(formas()));
    marcar();
  }

  publicar();
  let visible = pasoRecursosVisible();
  const dejarStore = suscribirse(() => {
    if (pasoRecursosVisible() === visible) return;
    visible = pasoRecursosVisible();
    marcar();
  });
  const dejarCambios = lienzo.suscribir(['import.done', 'commandStack.changed'], () => {
    publicar();
  });
  const dejarClic = lienzo.suscribir(
    ['element.click'],
    (evento) => {
      const forma = evento.element;
      if (!pasoRecursosVisible() || forma?.type !== 'bpmn:Lane' || typeof forma.id !== 'string') return undefined;
      if (!enRotulo(lienzo, forma, evento.originalEvent)) return undefined;
      elegirCarril(forma.id);
      return undefined;
    },
    1500,
  );

  return () => {
    dejarClic();
    dejarCambios();
    dejarStore();
    desmarcar();
    publicarCarriles(null);
  };
}
