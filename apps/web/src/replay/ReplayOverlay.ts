/**
 * Canvas side of the replay (#331): the per-element counters and the dots that walk the flows.
 *
 * Same shape as `BottleneckOverlay.ts` — one module owning one overlay `type`, one idempotent
 * `sincronizarReplay` that the shell reaches through `Modelador.replay(...)`, one state per
 * modeler in a `WeakMap` — with one difference: this one is called on every animation frame, so
 * the labels are created once per element set and afterwards only their numbers are rewritten.
 *
 * The counters live in `data-` attributes as well as in the text: they are the contract the e2e
 * check (`tools/e2e-replay.mjs`) reads back from the DOM to compare against the stored run.
 *
 * The dots live in their own canvas layer (`lila-replay`), above the diagram and below the
 * overlays, so nothing of diagram-js has to be told about them and clearing the replay is
 * emptying one `<g>`.
 */
import type Modeler from 'bpmn-js/lib/Modeler';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Overlays from 'diagram-js/lib/features/overlays/Overlays';
import { strings } from '../i18n';
import type { ElementState, ReplayState } from './replayModel';

const OVERLAY_TYPE = 'lila-replay';
const LAYER = 'lila-replay';
const STYLE_ID = 'lila-replay-styles';
const MARCA_ACTIVO = 'lila-replay-activo';
const MARCA_COLA = 'lila-replay-en-cola';
const SVG_NS = 'http://www.w3.org/2000/svg';

/** What the shell hands over on every frame. `null` clears everything. */
export interface ReplayPintura {
  state: ReplayState;
  /** Elements that get a counter, in the order `replayModel` found them in the log. */
  elementIds: readonly string[];
  /** `ir.source.originalIds`, for the models whose ids the engine had to sanitise. */
  originalIds: Readonly<Record<string, string>>;
}

interface EstadoReplay {
  /** Canvas id -> its label. The key of the map IS the set of elements currently painted. */
  etiquetas: Map<string, HTMLElement>;
  /** Canvas ids carrying a marker class, so they can be removed without scanning the diagram. */
  marcados: Map<string, string>;
  capa: SVGElement | null;
  /** Reused `<circle>`s: a frame with fewer tokens hides the spare ones instead of dropping them. */
  puntos: SVGCircleElement[];
}

const estados = new WeakMap<Modeler, EstadoReplay>();

function inyectarEstilos(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.lila-replay-contador {
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  color: var(--fg-primary);
  font: 11px var(--font-ui, system-ui);
  padding: 1px 4px;
  white-space: nowrap;
}
.lila-replay-contador[data-running="0"][data-queue="0"] { opacity: 0.65; }
.djs-element.${MARCA_ACTIVO} .djs-visual > :first-child {
  filter: drop-shadow(0 0 4px var(--accent-primary));
}
.djs-element.${MARCA_COLA} .djs-visual > :first-child {
  filter: drop-shadow(0 0 4px var(--accent-secondary));
}
.lila-replay-punto { fill: var(--accent-primary); stroke: var(--bg-elevated); stroke-width: 1; }`;
  document.head.appendChild(style);
}

/**
 * Canvas id of the element the result calls `id`, or `null` when the diagram does not have it.
 * Same two-step lookup as the bottleneck overlay: the result id first, the original id after.
 */
function idEnLienzo(
  id: string,
  originalIds: Readonly<Record<string, string>>,
  elementRegistry: ElementRegistry,
): string | null {
  if (elementRegistry.get(id) !== undefined) return id;
  const original = originalIds[id];
  if (original !== undefined && elementRegistry.get(original) !== undefined) return original;
  return null;
}

function estadoDe(modeler: Modeler): EstadoReplay {
  let estado = estados.get(modeler);
  if (estado === undefined) {
    estado = { capa: null, etiquetas: new Map(), marcados: new Map(), puntos: [] };
    estados.set(modeler, estado);
  }
  return estado;
}

function contador(id: string): HTMLElement {
  const div = document.createElement('div');
  div.className = 'lila-replay-contador';
  div.dataset.elementId = id;
  return div;
}

/** Point at `progress` (0..1) of a polyline, plus the leftover so short flows still move. */
function puntoEn(waypoints: readonly { x: number; y: number }[], progress: number): { x: number; y: number } {
  const largos: number[] = [];
  let total = 0;
  for (let i = 1; i < waypoints.length; i++) {
    const a = waypoints[i - 1] as { x: number; y: number };
    const b = waypoints[i] as { x: number; y: number };
    const largo = Math.hypot(b.x - a.x, b.y - a.y);
    largos.push(largo);
    total += largo;
  }
  let restante = total * Math.min(1, Math.max(0, progress));
  for (let i = 0; i < largos.length; i++) {
    const largo = largos[i] as number;
    if (restante > largo && i < largos.length - 1) { restante -= largo; continue; }
    const a = waypoints[i] as { x: number; y: number };
    const b = waypoints[i + 1] as { x: number; y: number };
    const f = largo === 0 ? 0 : Math.min(1, restante / largo);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }
  return waypoints[0] ?? { x: 0, y: 0 };
}

/** Removes every trace of the replay from `modeler`. Safe to call twice, and on an empty state. */
export function limpiarReplay(modeler: Modeler): void {
  const estado = estados.get(modeler);
  if (estado === undefined) return;
  modeler.get<Overlays>('overlays').remove({ type: OVERLAY_TYPE });
  estado.etiquetas.clear();
  const canvas = modeler.get<Canvas>('canvas');
  const elementRegistry = modeler.get<ElementRegistry>('elementRegistry');
  for (const [id, marca] of estado.marcados) {
    // The diagram may have changed since the frame that added the marker; `removeMarker` on an
    // element the registry no longer has writes through `undefined` inside diagram-js.
    if (elementRegistry.get(id) !== undefined) canvas.removeMarker(id, marca);
  }
  estado.marcados.clear();
  for (const punto of estado.puntos) punto.remove();
  estado.puntos = [];
  estado.capa = null;
}

function marcar(canvas: Canvas, estado: EstadoReplay, id: string, marca: string | null): void {
  const previa = estado.marcados.get(id);
  if (previa === marca) return;
  if (previa !== undefined) canvas.removeMarker(id, previa);
  if (marca === null) estado.marcados.delete(id);
  else { canvas.addMarker(id, marca); estado.marcados.set(id, marca); }
}

function escribir(div: HTMLElement, state: ElementState): void {
  const S = strings();
  const texto = S.animacion.contador(state.started, state.completed, state.queue);
  if (div.textContent !== texto) div.textContent = texto;
  if (div.dataset.started !== String(state.started)) div.dataset.started = String(state.started);
  if (div.dataset.completed !== String(state.completed)) div.dataset.completed = String(state.completed);
  if (div.dataset.queue !== String(state.queue)) div.dataset.queue = String(state.queue);
  if (div.dataset.running !== String(state.running)) div.dataset.running = String(state.running);
  const titulo = S.animacion.contadorTitulo(state.started, state.completed, state.queue, state.running);
  if (div.title !== titulo) div.title = titulo;
}

/**
 * Único punto que el shell llama (`Modelador.replay`). Paints the frame `pintura` describes, or
 * clears the replay when it is `null`. Idempotent and cheap to repeat: the labels are only
 * rebuilt when the set of elements changes, and each frame only rewrites the numbers that moved.
 */
export function sincronizarReplay(modeler: Modeler, pintura: ReplayPintura | null): void {
  if (pintura === null) { limpiarReplay(modeler); return; }
  inyectarEstilos();
  const estado = estadoDe(modeler);
  const elementRegistry = modeler.get<ElementRegistry>('elementRegistry');
  const canvas = modeler.get<Canvas>('canvas');
  const overlays = modeler.get<Overlays>('overlays');

  const enLienzo = pintura.elementIds
    .map((id) => [id, idEnLienzo(id, pintura.originalIds, elementRegistry)] as const)
    .filter((pair): pair is readonly [string, string] => pair[1] !== null);

  // The element set changed (another model, another run): start the labels over.
  const mismos = enLienzo.length === estado.etiquetas.size
    && enLienzo.every(([, canvasId]) => estado.etiquetas.has(canvasId));
  if (!mismos) {
    overlays.remove({ type: OVERLAY_TYPE });
    estado.etiquetas.clear();
    for (const [, canvasId] of enLienzo) {
      const div = contador(canvasId);
      estado.etiquetas.set(canvasId, div);
      overlays.add(canvasId, OVERLAY_TYPE, { html: div, position: { left: 0, top: -22 } });
    }
  }

  for (const [logId, canvasId] of enLienzo) {
    const state = pintura.state.elements[logId];
    const div = estado.etiquetas.get(canvasId);
    if (state === undefined || div === undefined) continue;
    escribir(div, state);
    marcar(canvas, estado, canvasId, state.running > 0 ? MARCA_ACTIVO : state.queue > 0 ? MARCA_COLA : null);
  }

  // The dots. `getLayer` creates the `<g>` the first time and returns the same one afterwards.
  estado.capa ??= canvas.getLayer(LAYER, 1) as unknown as SVGElement;
  const capa = estado.capa;
  const tokens = pintura.state.tokens;
  while (estado.puntos.length < tokens.length) {
    const circulo = document.createElementNS(SVG_NS, 'circle');
    circulo.setAttribute('r', '5');
    circulo.setAttribute('class', 'lila-replay-punto');
    capa.appendChild(circulo);
    estado.puntos.push(circulo);
  }
  for (const [i, punto] of estado.puntos.entries()) {
    const token = tokens[i];
    const flujo = token === undefined
      ? undefined
      : elementRegistry.get(idEnLienzo(token.flowId, pintura.originalIds, elementRegistry) ?? token.flowId);
    const waypoints = (flujo as { waypoints?: { x: number; y: number }[] } | undefined)?.waypoints;
    if (token === undefined || waypoints === undefined || waypoints.length < 2) {
      punto.style.display = 'none';
      continue;
    }
    const { x, y } = puntoEn(waypoints, token.progress);
    punto.style.display = '';
    punto.setAttribute('cx', String(x));
    punto.setAttribute('cy', String(y));
  }
}
