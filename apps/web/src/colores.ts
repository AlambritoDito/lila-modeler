/**
 * Colours per element (#452): eight colours plus «none», from the properties panel and the context
 * pad. They are written to the element's DI in both namespaces bpmn-js renders and Camunda/Bizagi
 * exchange: `bioc:fill`/`bioc:stroke` and `color:background-color`/`color:border-color`
 * (bpmn-in-color). An embedded label (tasks, sub-processes, pools, lanes, annotations) takes the
 * stroke as its colour (`color:color` on the `bpmndi:BPMNLabel`), so the text stays readable on
 * the pastel fill in a dark theme, whose default label is light. External labels (events,
 * gateways, data, flows) sit on the canvas, not on the fill: they keep the theme's colour.
 *
 * On import, Bizagi's own `bgColor`/`borderColor` are copied to the DI when the element has no
 * colour of its own.
 *
 * These are diagram data, not theme tokens: they persist in the XML as fixed hex and have to look
 * the same in every theme and in the PNG/PDF export (the same colours as bpmn-js-color-picker, so a
 * Camunda user finds the ones they know). The one exception is drawn, never written (#489): on a
 * canvas where the palette's dark stroke would vanish, a flow is painted with `strokeOscuro`, a
 * light tone of the same hue, and inside a coloured pool the theme's light flows and labels take
 * the pool's stroke (`trazoAlPintar`, `TrazoDelTema`).
 */
import type BpmnRenderer from 'bpmn-js/lib/draw/BpmnRenderer';
import { isLabelExternal } from 'bpmn-js/lib/util/LabelUtil';
import BaseRenderer from 'diagram-js/lib/draw/BaseRenderer';
import type EventBus from 'diagram-js/lib/core/EventBus';
import { strings } from './i18n';
import type { ElementoLienzo, ElementoModdle, Escritor } from './PropertiesPanel';

export const COLORES = [
  { id: 'azul', fill: '#BBDEFB', stroke: '#0D4372', strokeOscuro: '#64B5F6' },
  { id: 'verde', fill: '#C8E6C9', stroke: '#205022', strokeOscuro: '#81C784' },
  { id: 'amarillo', fill: '#FFF59D', stroke: '#5F4B00', strokeOscuro: '#FFF176' },
  { id: 'naranja', fill: '#FFE0B2', stroke: '#6B3C00', strokeOscuro: '#FFB74D' },
  { id: 'rojo', fill: '#FFCDD2', stroke: '#831311', strokeOscuro: '#E57373' },
  { id: 'morado', fill: '#E1BEE7', stroke: '#5B176D', strokeOscuro: '#CE93D8' },
  { id: 'turquesa', fill: '#B2DFDB', stroke: '#004D40', strokeOscuro: '#4DB6AC' },
  { id: 'gris', fill: '#E0E0E0', stroke: '#424242', strokeOscuro: '#BDBDBD' },
] as const;

export type ColorId = (typeof COLORES)[number]['id'];

/**
 * WCAG contrast ratio of two `#rrggbb` colours; `NaN` for anything else, which every comparison
 * below treats as «leave the colour alone».
 * ponytail: six-digit hex only, what every bundled theme and the palette use; parse through a
 * canvas if an imported theme ever writes `rgb()` or a name.
 */
export function contraste(a: string, b: string): number {
  const luz = (hex: string): number => /^#[0-9a-f]{6}$/i.test(hex)
    ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
      .reduce((suma, c, i) => suma + c * [0.2126, 0.7152, 0.0722][i]!, 0)
    : NaN;
  const [x, y] = [luz(a), luz(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

/** A DI element (`bpmndi:BPMNShape`/`BPMNEdge`), with moddle's generic accessors. */
interface Di extends ElementoModdle {
  label?: Di;
  get(nombre: string): unknown;
  set(nombre: string, valor: unknown): void;
  $model?: { create(tipo: string, atributos?: Record<string, unknown>): Di };
}

/** A canvas element with its DI and its parent, as bpmn-js hands it out (`element.di`). */
export type ElementoColoreable = ElementoLienzo & { di?: Di; parent?: ElementoColoreable };

/** The DI attributes for a fill and a stroke; a connection has no fill. */
function atributos(di: Di, fill: string | undefined, stroke: string | undefined): Record<string, string | undefined> {
  const trazo = { 'bioc:stroke': stroke, 'color:border-color': stroke };
  return di.$type === 'bpmndi:BPMNEdge' ? trazo : { ...trazo, 'bioc:fill': fill, 'color:background-color': fill };
}

/** The palette colour the element wears, `null` for none and `undefined` for a foreign one. */
export function colorActual(elemento: ElementoColoreable): ColorId | null | undefined {
  const di = elemento.di;
  if (di === undefined) return null;
  const conexion = di.$type === 'bpmndi:BPMNEdge';
  const valor = conexion
    ? di.get('color:border-color') ?? di.get('bioc:stroke')
    : di.get('color:background-color') ?? di.get('bioc:fill');
  if (typeof valor !== 'string' || valor === '') return null;
  return COLORES.find((c) => (conexion ? c.stroke : c.fill).toLowerCase() === valor.toLowerCase())?.id;
}

/** An embedded label sits on the element's fill; an external one on the canvas (QA of #452). */
function etiquetaSobreRelleno(di: Di, bo: ElementoModdle | undefined): boolean {
  return di.$type !== 'bpmndi:BPMNEdge' && bo !== undefined && !isLabelExternal(bo as unknown as Parameters<typeof isLabelExternal>[0]);
}

/** The theme colours a flow or a label is drawn against: `--canvas-bg`, `--diagram-stroke`, `--diagram-label`. */
export interface ColoresTema { canvas: string; trazo: string; etiqueta: string }

/**
 * The stroke a flow or an external label is drawn with instead of the one bpmn-js would pick, or
 * `undefined` to leave it alone (#489). Its background is the fill of its direct container (a pool
 * or an expanded sub-process) if that wears a palette colour, or else the canvas: an uncoloured
 * sub-process paints the theme's fill, whatever the pool around it wears (QA M1 of #507). A
 * coloured flow takes whichever of its palette stroke and `strokeOscuro` stands out more there; an
 * uncoloured flow or label in a coloured container takes the container's stroke when the theme's
 * own colour falls under 3:1 on that fill. A colour from outside the palette (Bizagi's, or the one
 * token simulation writes to mark the chosen branch, QA M2 of #507) is never replaced.
 * ponytail: only direct containers and palette colours. A coloured lane or a label that merely
 * overlaps a pool without belonging to it (a message flow's, whose parent is the collaboration)
 * keeps bpmn-js's choice; test bounds against the coloured pools and lanes here if that matters.
 */
export function trazoAlPintar(el: ElementoColoreable, tema: ColoresTema): string | undefined {
  const etiqueta = el.type === 'label';
  if (!etiqueta && el.di?.$type !== 'bpmndi:BPMNEdge') return undefined;
  const actual = etiqueta ? null : colorActual(el);
  if (actual === undefined) return undefined;
  const padre = el.parent;
  const contenedor = padre === undefined ? undefined : COLORES.find((c) => c.id === colorActual(padre));
  const fondo = contenedor?.fill ?? tema.canvas;
  const propio = COLORES.find((c) => c.id === actual);
  if (propio !== undefined) return contraste(propio.strokeOscuro, fondo) > contraste(propio.stroke, fondo) ? propio.strokeOscuro : undefined;
  if (contenedor === undefined) return undefined;
  return contraste(etiqueta ? tema.etiqueta : tema.trazo, fondo) < 3 ? contenedor.stroke : undefined;
}

/**
 * Draws what `trazoAlPintar` changes through bpmn-js's own renderer with a `stroke` override (the
 * parameter bpmn-js reads before the DI), so arrowheads and label text follow and the XML is never
 * touched. Above bpmn-js's 1000; below the bottleneck overlay's 1500, which only draws tasks. The
 * theme is read at draw time, so `Modelador.repintar()` after a theme change is enough.
 */
export class TrazoDelTema extends BaseRenderer {
  static $inject = ['eventBus', 'bpmnRenderer'];
  constructor(eventBus: EventBus, private readonly bpmn: BpmnRenderer) {
    super(eventBus, 1100);
    // A pool's colour is the background of the flows and labels inside it: when the pool changes,
    // they are redrawn with it (before `ChangeSupport`, which reads this same list).
    interface Nodo { type: string; waypoints?: unknown; children?: Nodo[] }
    const dentro = (el: Nodo): Nodo[] => (el.children ?? []).flatMap((h) => [h, ...dentro(h)]);
    eventBus.on('elements.changed', 1500, (e: { elements: Nodo[] }) => {
      const ya = new Set(e.elements);
      for (const el of e.elements.filter((x) => x.type === 'bpmn:Participant').flatMap(dentro)) {
        if ((el.type === 'label' || el.waypoints !== undefined) && !ya.has(el)) { ya.add(el); e.elements.push(el); }
      }
    });
  }

  private trazo(el: unknown): string | undefined {
    const raiz = getComputedStyle(document.documentElement);
    const token = (nombre: string): string => raiz.getPropertyValue(nombre).trim();
    return trazoAlPintar(el as ElementoColoreable, { canvas: token('--canvas-bg'), trazo: token('--diagram-stroke'), etiqueta: token('--diagram-label') });
  }

  override canRender(el: unknown): boolean {
    return this.trazo(el) !== undefined;
  }

  override drawShape(gfx: SVGElement, el: Parameters<BpmnRenderer['drawShape']>[1], attrs?: object): SVGElement {
    return this.bpmn.drawShape(gfx, el, { ...attrs, stroke: this.trazo(el)! });
  }

  override drawConnection(gfx: SVGElement, el: Parameters<BpmnRenderer['drawConnection']>[1], attrs?: object): SVGElement {
    return this.bpmn.drawConnection(gfx, el, { ...attrs, stroke: this.trazo(el)! });
  }
}

/** The colour several elements share, `null` if none has one, `undefined` if they differ. */
export function colorComun(elementos: readonly ElementoColoreable[]): ColorId | null | undefined {
  const colores = new Set(elementos.map(colorActual));
  return colores.size === 1 ? [...colores][0] : undefined;
}

/**
 * Paints the element with a palette colour, or clears its colour with `null`. Goes through
 * `modeling`, so the canvas repaints; `moduloColores` wraps the calls in one command, so a single
 * ⌘Z undoes it.
 */
export function escribirColor(escritor: Escritor, elemento: ElementoColoreable, color: ColorId | null): void {
  const di = elemento.di;
  if (di === undefined) return;
  const elegido = COLORES.find((c) => c.id === color);
  escritor.modeling.updateModdleProperties(elemento, di, atributos(di, elegido?.fill, elegido?.stroke));
  const label = di.label;
  if (elegido === undefined) {
    if (label === undefined) return;
    // A label with no bounds only carried the colour: drop it rather than leave an empty tag.
    if (label.get('bounds') === undefined) escritor.modeling.updateModdleProperties(elemento, di, { label: undefined });
    else escritor.modeling.updateModdleProperties(elemento, label, { 'color:color': undefined });
    return;
  }
  if (!etiquetaSobreRelleno(di, elemento.businessObject)) return;
  if (label !== undefined) {
    escritor.modeling.updateModdleProperties(elemento, label, { 'color:color': elegido.stroke });
  } else {
    const nueva = escritor.bpmnFactory.create('bpmndi:BPMNLabel', { 'color:color': elegido.stroke });
    nueva.$parent = di;
    escritor.modeling.updateModdleProperties(elemento, di, { label: nueva });
  }
}

/** Bizagi writes these on every element: they mean «no colour», not «white on black». */
const BIZAGI_POR_DEFECTO = /^(white|black|#fff(fff)?|#000(000)?)$/i;

/** `bizagi:BizagiProperty` values by name, from the element's `extensionElements`. */
function propiedadesBizagi(bo: ElementoModdle): Map<string, string> {
  const props = new Map<string, string>();
  const visitar = (nodo: { $type?: string; name?: unknown; value?: unknown; $children?: unknown[] }): void => {
    if (nodo.$type === 'bizagi:BizagiProperty' && typeof nodo.name === 'string' && typeof nodo.value === 'string') {
      props.set(nodo.name, nodo.value);
    }
    for (const hijo of nodo.$children ?? []) visitar(hijo as typeof nodo);
  };
  for (const ext of bo.extensionElements?.values ?? []) visitar(ext as Parameters<typeof visitar>[0]);
  return props;
}

/**
 * Copies Bizagi's `bgColor`/`borderColor` to the DI of each element that has no colour of its own
 * (an embedded label follows the border, as in `escribirColor`). Runs on the parsed tree, before
 * bpmn-js draws it, so it is not a command and not an edit.
 *
 * ponytail: only hex values; Bizagi's named colours other than its white/black defaults are left
 * out. A name table (or a canvas to convert them) is the way up if a real file needs it.
 */
export function coloresDeBizagi(definitions: { diagrams?: Array<{ plane?: { planeElement?: Di[] } }> }): void {
  const hex = (v: string | undefined): string | undefined =>
    v !== undefined && /^#[0-9a-f]{6}$/i.test(v) && !BIZAGI_POR_DEFECTO.test(v) ? v : undefined;
  for (const di of (definitions.diagrams ?? []).flatMap((d) => d.plane?.planeElement ?? [])) {
    const bo = (di as unknown as { bpmnElement?: ElementoModdle }).bpmnElement;
    const propio = di.get('color:background-color') ?? di.get('bioc:fill') ?? di.get('color:border-color') ?? di.get('bioc:stroke');
    if (bo === undefined || propio !== undefined) continue;
    const props = propiedadesBizagi(bo);
    const fill = hex(props.get('bgColor'));
    const stroke = hex(props.get('borderColor'));
    if (fill === undefined && stroke === undefined) continue;
    for (const [nombre, valor] of Object.entries(atributos(di, fill, stroke))) {
      if (valor !== undefined) di.set(nombre, valor);
    }
    if (stroke !== undefined && di.$model !== undefined && etiquetaSobreRelleno(di, bo)) {
      di.label ??= Object.assign(di.$model.create('bpmndi:BPMNLabel'), { $parent: di });
      di.label.set('color:color', stroke);
    }
  }
}

/* ------------------------------------------------------------------ *
 * bpmn-js module: the command, the context pad entry, its popup menu and the import hook.
 * ------------------------------------------------------------------ */

interface Contexto { elementos: ElementoColoreable[]; color: ColorId | null }

interface Inyectados {
  commandStack: {
    register(nombre: string, handler: { postExecute(ctx: Contexto): void }): void;
    execute(nombre: string, ctx: Contexto): void;
  };
  modeling: Escritor['modeling'];
  bpmnFactory: Escritor['bpmnFactory'];
  eventBus: { on(evento: string, oyente: (e: { definitions?: Parameters<typeof coloresDeBizagi>[0] }) => void): void };
  contextPad: {
    registerProvider(prioridad: number, proveedor: object): void;
    getPad(elementos: unknown): { html: HTMLElement };
  };
  popupMenu: {
    registerProvider(id: string, proveedor: object): void;
    open(elementos: unknown, id: string, posicion: object, opciones: object): void;
  };
}

type Destino = ElementoColoreable | ElementoColoreable[];
/** The elements a target stands for: a label stands for its owner, each one once (re-QA of #452). */
export const lista = (destino: Destino): ElementoColoreable[] => [...new Set(
  (Array.isArray(destino) ? destino : [destino]).map((el) =>
    (el.type === 'label' && el.labelTarget !== undefined ? el.labelTarget : el) as ElementoColoreable),
)];

/** What can be painted: a shape or a connection (not a label, not the root's plane). */
export const pintable = (el: ElementoColoreable): boolean =>
  el.type !== 'label' && (el.di?.$type === 'bpmndi:BPMNShape' || el.di?.$type === 'bpmndi:BPMNEdge');

/** The service `lilaColores`: `pintar` is one undoable command, for one element or several. */
export class LilaColores {
  static $inject = ['commandStack', 'modeling', 'bpmnFactory', 'eventBus', 'contextPad', 'popupMenu'];
  readonly pintar: (elementos: Destino, color: ColorId | null) => void;

  constructor(
    commandStack: Inyectados['commandStack'],
    modeling: Inyectados['modeling'],
    bpmnFactory: Inyectados['bpmnFactory'],
    eventBus: Inyectados['eventBus'],
    contextPad: Inyectados['contextPad'],
    popupMenu: Inyectados['popupMenu'],
  ) {
    // Nested `modeling` calls in `postExecute` are recorded as part of this command: one ⌘Z.
    commandStack.register('lila.color', {
      postExecute: ({ elementos, color }) => {
        for (const el of elementos) escribirColor({ modeling, bpmnFactory }, el, color);
      },
    });
    this.pintar = (destino, color) =>
      commandStack.execute('lila.color', { elementos: lista(destino).filter(pintable), color });

    eventBus.on('import.parse.complete', ({ definitions }) => {
      if (definitions !== undefined) coloresDeBizagi(definitions);
    });

    const entrada = (destino: Destino) => (entradas: Record<string, unknown>) =>
      !lista(destino).some(pintable) ? entradas : {
        ...entradas,
        'lila-color': {
          group: 'edit',
          className: 'lila-color-entrada',
          title: strings().propiedades.cambiarColor,
          action: {
            click: (evento: MouseEvent, el: Destino) => {
              const caja = contextPad.getPad(el).html.getBoundingClientRect();
              popupMenu.open(el, 'lila-colores', { x: caja.left, y: caja.bottom + 5, cursor: { x: evento.x, y: evento.y } }, {
                title: strings().propiedades.cambiarColor,
              });
            },
          },
        },
      };
    contextPad.registerProvider(500, { getContextPadEntries: entrada, getMultiElementContextPadEntries: entrada });
    popupMenu.registerProvider('lila-colores', {
      getPopupMenuEntries: (destino: Destino) => {
        const S = strings().propiedades.colores;
        const actual = colorComun(lista(destino).filter(pintable));
        const muestra = (fill: string, stroke: string): string =>
          `<div style="width:14px;height:14px;background:${fill};border:1px solid ${stroke}"></div>`;
        return Object.fromEntries(
          [{ id: 'ninguno' as const, fill: 'transparent', stroke: 'currentColor' }, ...COLORES].map((c) => [
            `lila-color-${c.id}`,
            {
              label: S[c.id],
              imageHtml: muestra(c.fill, c.stroke),
              ...(actual === (c.id === 'ninguno' ? null : c.id) ? { className: 'lila-color-actual' } : {}),
              action: () => this.pintar(destino, c.id === 'ninguno' ? null : c.id),
            },
          ]),
        );
      },
    });
  }
}

/** didi module for `additionalModules` in `Modeler.tsx`. */
export const moduloColores = {
  __init__: ['lilaColores', 'lilaTrazoDelTema'],
  lilaColores: ['type', LilaColores],
  lilaTrazoDelTema: ['type', TrazoDelTema],
};
