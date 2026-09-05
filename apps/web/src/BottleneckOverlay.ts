/**
 * Overlay de cuellos de botella (LILA-064): `BaseRenderer` de bpmn-js con prioridad 1500 que
 * delega en el renderer por defecto y tiñe `fill`/`stroke` de las tareas según su
 * `resourceWait.mean`, en tres pasos (cuánto pesa esa espera frente al propio tiempo de proceso
 * de la tarea, ver `nivelDeRatio` más abajo), más el servicio `overlays` para una etiqueta con la
 * espera media y la utilización del recurso principal, y un marcador CSS para `bottlenecks[0]`.
 * Aspecto de referencia: `docs/design/bottleneck-overlay.png`.
 *
 * El ranking **no se recalcula aquí**: se recorre `result.bottlenecks` tal cual, que ya viene
 * ordenado por `resourceWait.total` con desempate por utilización (docs/RESULTS_FORMAT.md §6) y
 * ya trae la `utilization` del recurso principal de cada elemento. Así el overlay, la tarjeta de
 * `ResultsView` (LILA-062) y `lila run` coinciden siempre, y el escenario solo se usa para saber
 * en qué unidad presentar los tiempos.
 *
 * `overlayModel` es la parte pura y testeable: clasifica y etiqueta sin tocar bpmn-js, así que se
 * prueba sin navegador (jsdom no llega a dibujar bpmn-js: le faltan `getBBox` y
 * `SVGElement.transform`, ver `BottleneckOverlay.test.ts`). `sincronizarOverlay` es el único punto
 * que toca el modelador — `Modeler.tsx` lo expone como `Modelador.cuellos(corrida, visible)` y
 * `main.tsx` lo llama desde un solo efecto, así que "hay resultado nuevo", "cambió el escenario",
 * "se recargó el modelo" y "se apagó el interruptor" son todos el mismo camino.
 *
 * `BaseRenderer` se auto-registra en el `eventBus` al construirse (así funciona en diagram-js, sin
 * pasar por el contenedor de inyección de dependencias) — por eso puede crearse sobre un modelador
 * ya montado, sin tener que pasar por `additionalModules` al construirlo.
 */
import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import type Modeler from 'bpmn-js/lib/Modeler';
import type BpmnRenderer from 'bpmn-js/lib/draw/BpmnRenderer';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type EventBus from 'diagram-js/lib/core/EventBus';
import type GraphicsFactory from 'diagram-js/lib/core/GraphicsFactory';
import type Overlays from 'diagram-js/lib/features/overlays/Overlays';
import type { ElementLike } from 'diagram-js/lib/model/Types';
import type { Shape as BpmnShape } from 'bpmn-js/lib/model/Types';
import { formatDuration, formatNumber, type BaseTimeUnit } from '@lila/engine/format';
import type { ResolvedScenario } from '@lila/engine/schema';
import type { RunResult } from '@lila/engine';

const PRIORITY = 1500;
const OVERLAY_TYPE = 'lila-bottleneck';
const MARKER_PRINCIPAL = 'lila-bottleneck-principal';
const STYLE_ID = 'lila-bottleneck-overlay-styles';

export type NivelEspera = 'low' | 'mid' | 'high';

export interface OverlayEntry {
  nivel: NivelEspera;
  etiqueta: string;
  /** `true` solo para `bottlenecks[0]`: la tarea donde más tiempo total se perdió esperando. */
  principal: boolean;
  /** Posición en `result.bottlenecks` (0 = principal). */
  rango: number;
}

/**
 * Mapa `id de elemento -> entrada`. El orden de inserción **es** el de `result.bottlenecks`, así
 * que `Object.keys(modelo)` devuelve el ranking del motor sin volver a ordenar nada.
 */
export type OverlayModel = Readonly<Record<string, OverlayEntry>>;

/** Lo que el shell guarda de la última corrida para poder repintar el overlay cuando haga falta. */
export interface Corrida {
  result: RunResult;
  scenario: ResolvedScenario;
  /**
   * `ir.source.originalIds`: `id del IR -> id que traía el archivo`. El IR sanitiza los ids que no
   * son NCName válido (docs/BPMN_EXTENSION.md), pero bpmn-js importó el XML original, así que las
   * claves de `RunResult` pueden no ser las que conoce el lienzo — ver `idEnLienzo`.
   */
  originalIds: Readonly<Record<string, string>>;
}

/**
 * Umbrales del nivel, como fracción de `resourceWait.mean / processing.mean`: cuántas veces más
 * tarda una tarea esperando un recurso que trabajando de verdad. `RATIO_LOW` = la espera es menos
 * del 5 % del tiempo de proceso, apenas se nota; entre `RATIO_LOW` y `RATIO_HIGH`, la espera es
 * comparable al tiempo de proceso; desde `RATIO_HIGH` = 1, la tarea espera **más** de lo que tarda
 * en procesarse — el caso de libro de un cuello de botella.
 *
 * El ticket permite terciles "o documenta otra regla simple"; terciles entre las tareas con
 * espera **del propio resultado** se probaron primero y se descartaron: con solo dos o tres
 * tareas compitiendo por recursos (el caso típico, `examples/pedido` incluido) el nivel de una
 * tarea depende de su **orden** frente a las demás, no de cuánto cambió su propia espera — así,
 * `Task_TomarPedido` nunca cambiaba de nivel entre AS-IS y TO-BE 3 cajeros aunque su espera media
 * bajara de 14,9 s a 2,2 s, porque siempre seguía siendo la segunda de dos. Este ratio es propio
 * de cada tarea, no depende de las demás, así que sí refleja ese cambio (ver
 * `BottleneckOverlay.test.ts`).
 */
const RATIO_LOW = 0.05;
const RATIO_HIGH = 1;

function nivelDeRatio(ratio: number): NivelEspera {
  if (ratio < RATIO_LOW) return 'low';
  if (ratio < RATIO_HIGH) return 'mid';
  return 'high';
}

/**
 * Función pura: recorre `result.bottlenecks` en su orden y arma la entrada de cada elemento. Sin
 * recursos en el escenario (R-DEG-1) o sin ninguna tarea con espera, `bottlenecks` viene vacío y
 * el mapa queda `{}`: no hay overlay que pintar y `applyOverlay` no falla, solo no añade nada.
 */
export function overlayModel(result: RunResult, scenario: ResolvedScenario): OverlayModel {
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;

  const model: Record<string, OverlayEntry> = {};
  for (const [rango, entrada] of result.bottlenecks.entries()) {
    const metrics = result.elements[entrada.elementId];
    // Un `bottlenecks` sin su elemento en `elements` no lo produce el motor; si llegara de un
    // JSON editado a mano, se ignora esa entrada en vez de reventar el lienzo entero.
    if (metrics === undefined) continue;
    // `processing.mean` de una tarea con espera > 0 no debería ser 0 (tuvo que completar al
    // menos una vez para tener processing.mean, ver docs/RESULTS_FORMAT.md §2); si igual lo es,
    // la espera es infinitamente mayor que el proceso — el caso más alto, no un error.
    const ratio =
      metrics.processing.mean > 0 ? metrics.resourceWait.mean / metrics.processing.mean : Infinity;
    model[entrada.elementId] = {
      etiqueta:
        `espera media ${formatDuration(metrics.resourceWait.mean, unit)} ${unit}` +
        ` · utilización ${formatNumber(entrada.utilization * 100)}%`,
      nivel: nivelDeRatio(ratio),
      principal: rango === 0,
      rango,
    };
  }
  return model;
}

/* ------------------------------------------------------------------ *
 * Renderer de bpmn-js: delega el dibujo por defecto y solo cambia el color.
 * ------------------------------------------------------------------ */

class BottleneckRenderer extends BaseRenderer {
  constructor(
    eventBus: EventBus,
    private readonly bpmnRenderer: BpmnRenderer,
    private readonly niveles: ReadonlyMap<string, NivelEspera>,
  ) {
    super(eventBus, PRIORITY);
  }

  override canRender(element: ElementLike): boolean {
    return this.niveles.has(element.id);
  }

  override drawShape(parentGfx: SVGElement, element: ElementLike): SVGElement {
    // `BaseRenderer.canRender` solo la deja pasar a `BpmnShape` reales (tareas con espera); el
    // tipo genérico de `ElementLike` que exige la firma base no trae los campos de bpmn-js.
    const shape = this.bpmnRenderer.drawShape(parentGfx, element as unknown as BpmnShape);
    const nivel = this.niveles.get(element.id);
    if (nivel !== undefined) {
      shape.style.fill = `var(--sim-bottleneck-${nivel})`;
      shape.style.stroke = `var(--sim-bottleneck-${nivel})`;
    }
    return shape;
  }
}

/* ------------------------------------------------------------------ *
 * applyOverlay / clearOverlay: el único punto que toca el modelador.
 * ------------------------------------------------------------------ */

interface EstadoOverlay {
  /** Mutado in situ: lo lee `BottleneckRenderer.canRender`/`drawShape` en cada repintado. */
  niveles: Map<string, NivelEspera>;
  /** Elementos con `canvas.addMarker(id, MARKER_PRINCIPAL)`, para poder quitarlo en `clearOverlay`. */
  marcados: Set<string>;
}

/** Un estado por modelador: dos `<Lienzo>` (dos pestañas de diagrama) no se pisan el overlay. */
const estados = new WeakMap<Modeler, EstadoOverlay>();

/** CSS del marcador y de la etiqueta, inyectado una sola vez (ids: `document.getElementById`). */
function inyectarEstilos(): void {
  if (document.getElementById(STYLE_ID) !== null) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // `filter` en vez de `stroke`/`fill`: no compite con el color que ya puso `BottleneckRenderer`
  // ni con el que pone el renderer por defecto, así que no hace falta `!important`.
  style.textContent = `
.djs-element.${MARKER_PRINCIPAL} .djs-visual > :first-child {
  filter: drop-shadow(0 0 4px var(--accent-secondary));
}
.lila-bottleneck-label {
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  color: var(--fg-primary);
  font: 11px var(--font-ui, system-ui);
  padding: 1px 4px;
  white-space: nowrap;
}`;
  document.head.appendChild(style);
}

function etiquetaHtml(entry: OverlayEntry): HTMLElement {
  const div = document.createElement('div');
  div.className = 'lila-bottleneck-label';
  div.textContent = entry.etiqueta;
  return div;
}

function estadoDe(modeler: Modeler): EstadoOverlay {
  let estado = estados.get(modeler);
  if (estado === undefined) {
    const eventBus = modeler.get<EventBus>('eventBus');
    const bpmnRenderer = modeler.get<BpmnRenderer>('bpmnRenderer');
    const niveles = new Map<string, NivelEspera>();
    // `BaseRenderer` se registra en el `eventBus` desde su propio constructor (ver el comentario
    // de cabecera): no hace falta guardar la instancia, solo dejar que se construya.
    new BottleneckRenderer(eventBus, bpmnRenderer, niveles);
    estado = { marcados: new Set(), niveles };
    estados.set(modeler, estado);
  }
  return estado;
}

/** Repinta `ids` con el renderer por defecto (sin nivel) o con el tinte (con nivel puesto). */
function redibujar(modeler: Modeler, ids: Iterable<string>): void {
  const elementRegistry = modeler.get<ElementRegistry>('elementRegistry');
  const graphicsFactory = modeler.get<GraphicsFactory>('graphicsFactory');
  for (const id of ids) {
    const element = elementRegistry.get(id);
    if (element === undefined) continue;
    graphicsFactory.update('shape', element, elementRegistry.getGraphics(element));
  }
}

/**
 * Quita todo rastro del overlay anterior sobre `modeler`: etiquetas (`overlays.remove` por
 * `type`), el marcador del cuello de botella principal y el tinte de las tareas (repintadas con
 * el renderer por defecto, al vaciar `niveles` antes de repintar). Llamarla dos veces seguidas, o
 * antes de un `applyOverlay` con otro resultado, no acumula nada — no hay fuga de overlays.
 * Los elementos que ya no están en el lienzo (borrados en el diagrama después de simular) se
 * saltan en vez de reventar: limpiar tiene que funcionar siempre, es el camino de apagar el
 * interruptor, cambiar de escenario y abrir otro `.bpmn`.
 */
export function clearOverlay(modeler: Modeler): void {
  const estado = estados.get(modeler);
  if (estado === undefined) return;

  modeler.get<Overlays>('overlays').remove({ type: OVERLAY_TYPE });
  const canvas = modeler.get<Canvas>('canvas');
  const elementRegistry = modeler.get<ElementRegistry>('elementRegistry');
  for (const id of estado.marcados) {
    // El diagrama pudo cambiar después de pintar: si el usuario borró la tarea marcada,
    // `canvas.removeMarker` la resuelve contra el `elementRegistry` y escribe `element.markers`
    // sobre `undefined` (diagram-js `Canvas._updateMarker`), tumbando el efecto de `main.tsx`
    // que apaga el interruptor o cambia de escenario. Mismo guardia que `redibujar`.
    if (elementRegistry.get(id) !== undefined) canvas.removeMarker(id, MARKER_PRINCIPAL);
  }
  estado.marcados.clear();

  const previos = [...estado.niveles.keys()];
  estado.niveles.clear();
  redibujar(modeler, previos);
}

/**
 * Id con el que el lienzo conoce al elemento `id` del `RunResult`, o `null` si no lo conoce.
 *
 * El caso normal es que coincidan. No coinciden cuando el archivo traía ids que no son NCName
 * válido (Bizagi los exporta así de vez en cuando): el motor los sanitiza al construir el IR y
 * `RunResult` queda keyed por el id sanitizado, mientras que bpmn-js importó el XML original. Se
 * prueba el id del resultado primero y el original después, así que un `originalIds` de otro
 * modelo —o vacío— nunca puede desviar el overlay a un elemento equivocado.
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

/**
 * Aplica el overlay de una corrida sobre `modeler`: tiñe las tareas del ranking, marca
 * `bottlenecks[0]` y añade la etiqueta de cada una. Reemplaza cualquier overlay anterior del mismo
 * modelador (empieza con `clearOverlay`), así que llamarla de nuevo tras cambiar de escenario deja
 * el lienzo exactamente con el overlay del resultado nuevo, nada del anterior.
 */
export function applyOverlay(modeler: Modeler, corrida: Corrida): void {
  inyectarEstilos();
  const estado = estadoDe(modeler);
  clearOverlay(modeler);

  const modelo = overlayModel(corrida.result, corrida.scenario);
  const elementRegistry = modeler.get<ElementRegistry>('elementRegistry');
  const canvas = modeler.get<Canvas>('canvas');
  const overlays = modeler.get<Overlays>('overlays');
  const presentes: string[] = [];

  for (const [idResultado, entry] of Object.entries(modelo)) {
    // Un `result` de otro modelo (u otro `.bpmn` abierto mientras tanto) no revienta: los ids que
    // no existen en el lienzo se ignoran.
    const id = idEnLienzo(idResultado, corrida.originalIds, elementRegistry);
    if (id === null) continue;
    presentes.push(id);
    estado.niveles.set(id, entry.nivel);
    if (entry.principal) {
      canvas.addMarker(id, MARKER_PRINCIPAL);
      estado.marcados.add(id);
    }
    overlays.add(id, OVERLAY_TYPE, { html: etiquetaHtml(entry), position: { bottom: -4, right: -4 } });
  }

  redibujar(modeler, presentes);
}

/**
 * Único punto que el shell llama (`Modelador.cuellos`, ver `Modeler.tsx`): pinta la corrida si hay
 * una y el interruptor «Cuellos de botella» está encendido; limpia en cualquier otro caso. Que
 * «no hay corrida» y «el interruptor está apagado» compartan camino es lo que hace que cambiar de
 * escenario, recargar el modelo y apagar el overlay se resuelvan con un solo efecto en `main.tsx`.
 */
export function sincronizarOverlay(modeler: Modeler, corrida: Corrida | null, visible: boolean): void {
  if (corrida === null || !visible) clearOverlay(modeler);
  else applyOverlay(modeler, corrida);
}
