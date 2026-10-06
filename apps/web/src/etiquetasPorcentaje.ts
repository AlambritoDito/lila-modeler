/**
 * Percentage fields on the canvas (Lote M, C4, design screen 04): a small box near the start of
 * every outgoing flow of a diverging XOR/OR, with the flow's label and its share in percent.
 *
 * - In the Routes step (`editable`) the share is an `<input>`: type 70, ↑/↓ add or take 5, Enter
 *   leaves the field, Escape restores what it held when it got the focus. Focusing it selects the
 *   gateway (`onEnfocar`), so the panel shows the same split with its sum and one-click fix.
 * - Anywhere else in Simulate it is plain text («70 %»).
 * - The boxes of a XOR that does not add up to 100 % get a red border; those of the selected
 *   gateway, the accent.
 *
 * Same frontier as `BottleneckOverlay.ts`/`ValidationMarkers.ts`: `sincronizarEtiquetas` is the only
 * entry point that touches bpmn-js, `Modeler.tsx` exposes it as `Modelador.porcentajes(estado)`, and
 * calling it again with a new state updates the boxes **in place** — a field being typed into is
 * never rebuilt, so the live write of every keystroke does not steal the focus. `null` removes
 * everything. The numbers come from `repartoRutas.ts` (the panel's own logic), so the canvas and
 * the Routes step cannot disagree, and the file keeps fractions (`onCambiar` gets percent; the
 * host writes it with `escribirPorcentaje`).
 */
import type Modeler from 'bpmn-js/lib/Modeler';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type Overlays from 'diagram-js/lib/features/overlays/Overlays';

import { strings } from './i18n';
import type { ProcessIR } from '@lila-modeler/engine';

import {
  compuertaDeSeleccion,
  compuertasRepartibles,
  leerPorcentaje,
  pasoPorcentaje,
  repartoDe,
  type FlujoReparto,
  type Reparto,
} from './repartoRutas';

const OVERLAY_TYPE = 'lila-porcentaje';

export interface EstadoEtiquetas {
  /** The splits to draw (`repartoDe` of each `compuertasRepartibles`). */
  repartos: readonly Reparto[];
  /** Routes step: fields instead of text. */
  editable: boolean;
  /** The selected gateway (IR id), highlighted. */
  seleccion: string | null;
  /** `ir.source.originalIds`: IR id → id in the file, for ids the IR sanitised. */
  originalIds?: Readonly<Record<string, string>>;
  /** A typed share, in percent; `null` = the field was emptied (remove `probability`). */
  onCambiar(flujo: string, porcentaje: number | null): void;
  /**
   * Selection the host should make: `onEnfocar(compuerta, flujo)` when a field got the focus — select
   * that **flow**, so the panel knows which one was just edited and the one-click fix never undoes
   * it — and `onEnfocar(compuerta, null)` when a text box was clicked outside Routes — select the
   * **gateway**, which opens Routes; the clicked field then takes the focus and reports its flow.
   */
  onEnfocar?(compuerta: string, flujo: string | null): void;
}

interface Caja {
  raiz: HTMLDivElement;
  nombre: HTMLSpanElement;
  input: HTMLInputElement | null;
  valor: HTMLSpanElement | null;
  overlayId: string;
  /** Where the box was placed, to move it only when the flow moved. */
  posicion: string;
  /** Latest data, read by the listeners (they are attached once). */
  flujo: FlujoReparto;
  compuerta: string;
  editable: boolean;
  alEnfocar: string;
  /** What is typed is not a number from 0 to 100: shown invalid, nothing written. */
  invalido: boolean;
}

interface EstadoModeler {
  cajas: Map<string, Caja>;
  ultimo: EstadoEtiquetas | null;
  desuscribir: () => void;
  /**
   * A text box clicked outside Routes: its gateway was selected (which opens Routes) and its field
   * takes the focus as soon as the boxes become fields. One click, straight to typing.
   */
  enfocarAlEditar: string | null;
  /** Placed box per `gateway/flow`, recomputed only when the diagram or the zoom changed. */
  posiciones: Map<string, { left: number; top: number }>;
  zoom: number;
}

const estados = new WeakMap<Modeler, EstadoModeler>();

type Punto = { x: number; y: number };
interface Conexion {
  waypoints?: Punto[];
}
interface Caja2D { x: number; y: number; width: number; height: number }
interface Forma extends Partial<Caja2D> {
  waypoints?: Punto[];
  type?: string;
  parent?: unknown;
  hidden?: boolean;
}

/** Size of a box on screen, in px (CSS `.lila-pct`); in diagram units it is this over the zoom. */
const ANCHO_PX = 64;
const ALTO_PX = 32;
/** The gateway's validation marker and selection outline stick out of its bounds by about this. */
const MARGEN_FORMA = 10;

function solape(a: Caja2D, b: Caja2D): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The box's offset from the connection's bounding box. Candidates on both sides of the first
 * segment, near its start and further along it, and the one that covers the least of the shapes
 * and labels around (and of the gateway with its marker) wins; ties go to the first, below/right
 * of the start. `obstaculos` are diagram boxes; `zoom` sizes the box (it never shrinks below 100 %).
 */
export function posicionDe(
  conexion: Conexion,
  obstaculos: readonly Caja2D[] = [],
  zoom = 1,
): { left: number; top: number } | null {
  const wps = conexion.waypoints;
  if (wps === undefined || wps.length < 2) return null;
  const minX = Math.min(...wps.map((p) => p.x));
  const minY = Math.min(...wps.map((p) => p.y));
  const [a, b] = [wps[0]!, wps[1]!];
  const largo = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const ux = (b.x - a.x) / largo;
  const uy = (b.y - a.y) / largo;
  const escala = Math.max(zoom, 1e-3) < 1 ? 1 / zoom : 1;
  const W = ANCHO_PX * escala;
  const H = ALTO_PX * escala;
  const horizontal = Math.abs(ux) >= Math.abs(uy);
  const candidatos: Caja2D[] = [];
  for (const d of [6, largo / 2, Math.max(6, largo - 6 - (horizontal ? W : H))]) {
    const px = a.x + ux * Math.min(d, largo);
    const py = a.y + uy * Math.min(d, largo);
    if (horizontal) {
      const x = ux >= 0 ? px : px - W;
      candidatos.push({ x, y: py + 5, width: W, height: H }, { x, y: py - 5 - H, width: W, height: H });
    } else {
      const y = uy >= 0 ? py : py - H;
      candidatos.push({ x: px + 5, y, width: W, height: H }, { x: px - 5 - W, y, width: W, height: H });
    }
  }
  let mejor = candidatos[0]!;
  let menor = Infinity;
  for (const c of candidatos) {
    const total = obstaculos.reduce((acc, o) => acc + solape(c, o), 0);
    if (total < menor - 1e-6) { menor = total; mejor = c; }
  }
  return { left: Math.round(mejor.x - minX), top: Math.round(mejor.y - minY) };
}

/**
 * What a box should not cover: every shape and label on the canvas except connections, the root and
 * the containers the flow runs inside (pools, lanes, expanded sub-processes: they contain its start),
 * the gateway inflated by its marker, and the boxes already placed.
 */
function obstaculosDe(registro: ElementRegistry, inicio: Punto, puestos: readonly Caja2D[]): Caja2D[] {
  const todos = (registro as unknown as { getAll?: () => Forma[] }).getAll?.() ?? [];
  const salida: Caja2D[] = [...puestos];
  for (const e of todos) {
    if (e.waypoints !== undefined || e.hidden === true || e.parent === undefined) continue;
    if (e.x === undefined || e.y === undefined || e.width === undefined || e.height === undefined) continue;
    const caja = { x: e.x, y: e.y, width: e.width, height: e.height };
    const contiene = inicio.x > caja.x + 1 && inicio.x < caja.x + caja.width - 1 && inicio.y > caja.y + 1 && inicio.y < caja.y + caja.height - 1;
    if (contiene && caja.width * caja.height > 4 * ANCHO_PX * ALTO_PX) continue;
    const toca = inicio.x >= caja.x - 1 && inicio.x <= caja.x + caja.width + 1 && inicio.y >= caja.y - 1 && inicio.y <= caja.y + caja.height + 1;
    // The gateway the flow leaves: its warning marker and selection outline stick out.
    salida.push(toca && e.type !== 'label'
      ? { x: caja.x - MARGEN_FORMA, y: caja.y - MARGEN_FORMA, width: caja.width + 2 * MARGEN_FORMA, height: caja.height + 2 * MARGEN_FORMA }
      : caja);
  }
  return salida;
}

function idEnLienzo(id: string, originalIds: Readonly<Record<string, string>> | undefined, registro: ElementRegistry): string | null {
  if (registro.get(id) !== undefined) return id;
  const original = originalIds?.[id];
  return original !== undefined && registro.get(original) !== undefined ? original : null;
}

/** The text a field shows: the declared share, or nothing (the effective one is the placeholder). */
const textoDe = (f: FlujoReparto): string => (f.porcentaje === null ? '' : String(f.porcentaje));

function crearCaja(modeler: Modeler, flujo: FlujoReparto, compuerta: string, editable: boolean): Caja {
  const raiz = document.createElement('div');
  raiz.className = 'lila-pct';
  raiz.dataset['flujo'] = flujo.id;
  const nombre = document.createElement('span');
  nombre.className = 'lila-pct-nombre';
  raiz.appendChild(nombre);
  const caja: Caja = { raiz, nombre, input: null, valor: null, overlayId: '', posicion: '', flujo, compuerta, editable, alEnfocar: '', invalido: false };

  // bpmn-js must not read a click, drag or double click on the box as one on the canvas.
  for (const tipo of ['mousedown', 'pointerdown', 'click', 'dblclick', 'contextmenu']) {
    raiz.addEventListener(tipo, (e) => { e.stopPropagation(); });
  }

  if (editable && !flujo.porDefecto) {
    const fila = document.createElement('span');
    fila.className = 'lila-pct-campo';
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'decimal';
    input.autocomplete = 'off';
    const unidad = document.createElement('span');
    unidad.className = 'lila-pct-unidad';
    unidad.textContent = '%';
    unidad.setAttribute('aria-hidden', 'true');
    fila.append(input, unidad);
    raiz.appendChild(fila);
    caja.input = input;
    // A click anywhere on the box («click the «Yes» label») lands in its field.
    raiz.addEventListener('click', () => { input.focus(); });

    const escribir = (texto: string): void => {
      const leido = leerPorcentaje(texto);
      caja.invalido = leido === null;
      marcarInvalido(caja);
      if (leido === null) return;
      estados.get(modeler)?.ultimo?.onCambiar(caja.flujo.id, leido === 'vacio' ? null : leido);
    };
    input.addEventListener('focus', () => {
      caja.alEnfocar = input.value;
      input.select();
      estados.get(modeler)?.ultimo?.onEnfocar?.(caja.compuerta, caja.flujo.id);
    });
    input.addEventListener('input', () => { escribir(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        const leido = leerPorcentaje(input.value);
        const base = typeof leido === 'number' ? leido : caja.flujo.efectivo;
        input.value = String(pasoPorcentaje(base, e.key === 'ArrowUp'));
        escribir(input.value);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (input.value !== caja.alEnfocar) {
          input.value = caja.alEnfocar;
          escribir(input.value);
        }
        input.blur();
      }
    });
  } else {
    const valor = document.createElement('span');
    valor.className = 'lila-pct-valor';
    raiz.appendChild(valor);
    caja.valor = valor;
    raiz.addEventListener('click', () => {
      const estado = estados.get(modeler);
      if (estado === undefined) return;
      if (!caja.flujo.porDefecto) estado.enfocarAlEditar = caja.flujo.id;
      estado.ultimo?.onEnfocar?.(caja.compuerta, null);
    });
  }
  return caja;
}

function marcarInvalido(caja: Caja): void {
  caja.raiz.classList.toggle('lila-pct-invalido', caja.invalido);
  if (caja.input === null) return;
  caja.input.setAttribute('aria-invalid', caja.invalido || caja.raiz.classList.contains('lila-pct-error') ? 'true' : 'false');
  caja.input.title = caja.invalido ? strings().rutas.invalido : '';
}

/** Writes the latest data into a box without rebuilding it (and without touching a focused field). */
function pintarCaja(caja: Caja, reparto: Reparto, estado: EstadoEtiquetas): void {
  const S = strings().rutas;
  const { flujo } = caja;
  caja.nombre.textContent = flujo.etiqueta;
  caja.raiz.title = S.cajaTitulo(flujo.etiqueta, flujo.destino);
  caja.raiz.classList.toggle('lila-pct-error', !reparto.cuadra);
  caja.raiz.classList.toggle('lila-pct-sel', estado.seleccion === reparto.id);
  if (caja.input !== null) {
    caja.input.setAttribute('aria-label', S.campoLienzo(flujo.etiqueta, reparto.nombre));
    caja.input.placeholder = String(flujo.efectivo);
    if (document.activeElement !== caja.input) {
      caja.input.value = textoDe(flujo);
      caja.invalido = false;
    }
    marcarInvalido(caja);
  }
  if (caja.valor !== null) {
    caja.valor.textContent = flujo.porDefecto && flujo.porcentaje === null ? S.resto(flujo.efectivo) : S.porciento(flujo.efectivo);
  }
}

/** The canvas while boxes are on it: CSS hides bpmn-js's context pad there, which covered them. */
const CLASE_LIENZO = 'lila-pct-activas';

function canvasDe(modeler: Modeler): Canvas | null {
  try {
    return modeler.get<Canvas>('canvas') ?? null;
  } catch {
    return null;
  }
}

function quitarTodo(modeler: Modeler, estado: EstadoModeler): void {
  const overlays = modeler.get<Overlays>('overlays');
  overlays.remove({ type: OVERLAY_TYPE });
  estado.cajas.clear();
  estado.posiciones.clear();
  canvasDe(modeler)?.getContainer().classList.remove(CLASE_LIENZO);
}

function estadoDe(modeler: Modeler): EstadoModeler {
  let estado = estados.get(modeler);
  if (estado === undefined) {
    const nuevo: EstadoModeler = {
      cajas: new Map(), ultimo: null, desuscribir: () => {}, enfocarAlEditar: null, posiciones: new Map(), zoom: zoomDe(modeler),
    };
    // A diagram edit (a gateway dragged, a waypoint moved, a shape added next to a box) or a new zoom
    // (the boxes keep their screen size, so they take more or less diagram room) places them again.
    const eventBus = modeler.get<EventBus>('eventBus');
    const alCambiar = (): void => {
      nuevo.posiciones.clear();
      if (nuevo.ultimo !== null) aplicar(modeler, nuevo, nuevo.ultimo);
    };
    const alMoverVista = (): void => {
      const zoom = zoomDe(modeler);
      if (Math.abs(zoom - nuevo.zoom) < 1e-3) return;
      nuevo.zoom = zoom;
      alCambiar();
    };
    eventBus.on('elements.changed', alCambiar);
    eventBus.on('canvas.viewbox.changed', alMoverVista);
    nuevo.desuscribir = () => {
      eventBus.off('elements.changed', alCambiar);
      eventBus.off('canvas.viewbox.changed', alMoverVista);
    };
    estados.set(modeler, nuevo);
    estado = nuevo;
  }
  return estado;
}

function zoomDe(modeler: Modeler): number {
  const zoom = canvasDe(modeler)?.zoom();
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function aplicar(modeler: Modeler, estado: EstadoModeler, datos: EstadoEtiquetas): void {
  const overlays = modeler.get<Overlays>('overlays');
  const registro = modeler.get<ElementRegistry>('elementRegistry');
  const vivas = new Set<string>();
  canvasDe(modeler)?.getContainer().classList.add(CLASE_LIENZO);
  const zoom = estado.zoom;
  /** Boxes placed in this pass, so two boxes do not land on each other either. */
  const puestas: { x: number; y: number; width: number; height: number }[] = [];

  for (const reparto of datos.repartos) {
    for (const flujo of reparto.flujos) {
      const id = idEnLienzo(flujo.id, datos.originalIds, registro);
      const conexion = id === null ? undefined : (registro.get(id) as Conexion | undefined);
      const wps = conexion?.waypoints;
      if (id === null || conexion === undefined || wps === undefined || wps.length < 2) continue;
      const clave = `${reparto.id}/${flujo.id}`;
      let posicion = estado.posiciones.get(clave);
      if (posicion === undefined) {
        posicion = posicionDe(conexion, obstaculosDe(registro, wps[0]!, puestas), zoom)!;
        estado.posiciones.set(clave, posicion);
      }
      const escala = zoom < 1 ? 1 / zoom : 1;
      puestas.push({
        x: Math.min(...wps.map((p) => p.x)) + posicion.left,
        y: Math.min(...wps.map((p) => p.y)) + posicion.top,
        width: ANCHO_PX * escala,
        height: ALTO_PX * escala,
      });
      vivas.add(clave);
      let caja = estado.cajas.get(clave);
      const editableAqui = datos.editable && !flujo.porDefecto;
      // Switching between field and text rebuilds the box; nothing else does.
      if (caja !== undefined && (caja.input !== null) !== editableAqui) {
        overlays.remove(caja.overlayId);
        estado.cajas.delete(clave);
        caja = undefined;
      }
      if (caja === undefined) {
        caja = crearCaja(modeler, flujo, reparto.id, datos.editable);
        estado.cajas.set(clave, caja);
      }
      caja.flujo = flujo;
      caja.compuerta = reparto.id;
      caja.editable = datos.editable;
      pintarCaja(caja, reparto, datos);
      const textoPosicion = `${id}:${posicion.left},${posicion.top}`;
      if (caja.posicion !== textoPosicion) {
        if (caja.overlayId !== '') overlays.remove(caja.overlayId);
        caja.overlayId = overlays.add(id, OVERLAY_TYPE, { html: caja.raiz, position: posicion, show: { minZoom: 0.4 }, scale: { min: 1 } });
        caja.posicion = textoPosicion;
      }
    }
  }

  if (datos.editable && estado.enfocarAlEditar !== null) {
    const pendiente = estado.enfocarAlEditar;
    estado.enfocarAlEditar = null;
    for (const caja of estado.cajas.values()) {
      if (caja.flujo.id === pendiente) caja.input?.focus();
    }
  }

  for (const [clave, caja] of estado.cajas) {
    if (vivas.has(clave)) continue;
    overlays.remove(caja.overlayId);
    estado.cajas.delete(clave);
    estado.posiciones.delete(clave);
  }
}

/**
 * The only entry point (`Modelador.porcentajes`). `null` clears every box; a state draws or updates
 * them. Idempotent: the shell can call it on every render.
 */
export function sincronizarEtiquetas(modeler: Modeler, datos: EstadoEtiquetas | null): void {
  if (datos === null) {
    const estado = estados.get(modeler);
    if (estado === undefined) return;
    estado.ultimo = null;
    quitarTodo(modeler, estado);
    return;
  }
  const estado = estadoDe(modeler);
  estado.ultimo = datos;
  aplicar(modeler, estado, datos);
}

/** Forgets a modeler (before `destroy()`): removes the boxes and the change listener. */
export function olvidarEtiquetas(modeler: Modeler): void {
  const estado = estados.get(modeler);
  if (estado === undefined) return;
  quitarTodo(modeler, estado);
  estado.desuscribir();
  estados.delete(modeler);
}

/**
 * The state the shell passes to `Modelador.porcentajes`, from what it already has: the IR, the
 * active scenario resolved, the canvas selection and whether the Routes step is open. `null` without
 * an IR or without any splitting gateway. The writes go through `onCambiar` in percent; the shell
 * stores them with `escribirPorcentaje(delta, padre, flujo, porcentaje)` (fractions in the file).
 */
export function construirEtiquetas(o: {
  ir: ProcessIR | null;
  resuelto: Record<string, unknown>;
  editable: boolean;
  /** The canvas selection (bpmn-js id, which may be the unsanitised original). */
  seleccion: string | null;
  onCambiar: EstadoEtiquetas['onCambiar'];
  onEnfocar?: EstadoEtiquetas['onEnfocar'];
}): EstadoEtiquetas | null {
  const { ir } = o;
  if (ir === null) return null;
  const ids = compuertasRepartibles(ir);
  if (ids.length === 0) return null;
  const enIr =
    o.seleccion === null || ir.nodes[o.seleccion] !== undefined || ir.flows[o.seleccion] !== undefined
      ? o.seleccion
      : (Object.entries(ir.source.originalIds).find(([, original]) => original === o.seleccion)?.[0] ?? o.seleccion);
  return {
    repartos: ids.map((id) => repartoDe(ir, id, o.resuelto)!),
    editable: o.editable,
    seleccion: compuertaDeSeleccion(ir, enIr),
    originalIds: ir.source.originalIds,
    onCambiar: o.onCambiar,
    ...(o.onEnfocar !== undefined ? { onEnfocar: o.onEnfocar } : {}),
  };
}
