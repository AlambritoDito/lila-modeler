/**
 * Colours per element (#452): eight colours plus «none», from the properties panel and the context
 * pad. They are written to the element's DI in both namespaces bpmn-js renders and Camunda/Bizagi
 * exchange: `bioc:fill`/`bioc:stroke` and `color:background-color`/`color:border-color`
 * (bpmn-in-color). The label colour (`color:color` on the `bpmndi:BPMNLabel`) follows the stroke,
 * so the text stays readable on the pastel fill in a dark theme, whose default label is light.
 *
 * On import, Bizagi's own `bgColor`/`borderColor` are copied to the DI when the element has no
 * colour of its own.
 *
 * These are diagram data, not theme tokens: they persist in the XML as fixed hex and have to look
 * the same in every theme and in the PNG/PDF export (the same colours as bpmn-js-color-picker, so a
 * Camunda user finds the ones they know).
 */
import { strings } from './i18n';
import type { ElementoLienzo, ElementoModdle, Escritor } from './PropertiesPanel';

export const COLORES = [
  { id: 'azul', fill: '#BBDEFB', stroke: '#0D4372' },
  { id: 'verde', fill: '#C8E6C9', stroke: '#205022' },
  { id: 'amarillo', fill: '#FFF59D', stroke: '#5F4B00' },
  { id: 'naranja', fill: '#FFE0B2', stroke: '#6B3C00' },
  { id: 'rojo', fill: '#FFCDD2', stroke: '#831311' },
  { id: 'morado', fill: '#E1BEE7', stroke: '#5B176D' },
  { id: 'turquesa', fill: '#B2DFDB', stroke: '#004D40' },
  { id: 'gris', fill: '#E0E0E0', stroke: '#424242' },
] as const;

export type ColorId = (typeof COLORES)[number]['id'];

/** A DI element (`bpmndi:BPMNShape`/`BPMNEdge`), with moddle's generic accessors. */
interface Di extends ElementoModdle {
  label?: Di;
  get(nombre: string): unknown;
  set(nombre: string, valor: unknown): void;
  $model?: { create(tipo: string, atributos?: Record<string, unknown>): Di };
}

/** A canvas element with its DI, as bpmn-js hands it out (`element.di`). */
export type ElementoColoreable = ElementoLienzo & { di?: Di };

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
  if (di.label !== undefined) {
    escritor.modeling.updateModdleProperties(elemento, di.label, { 'color:color': elegido?.stroke });
  } else if (elegido !== undefined) {
    const label = escritor.bpmnFactory.create('bpmndi:BPMNLabel', { 'color:color': elegido.stroke });
    label.$parent = di;
    escritor.modeling.updateModdleProperties(elemento, di, { label });
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
 * (the label follows the border, as in `escribirColor`). Runs on the parsed tree, before bpmn-js
 * draws it, so it is not a command and not an edit.
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
    if (stroke !== undefined && di.$model !== undefined) {
      di.label ??= Object.assign(di.$model.create('bpmndi:BPMNLabel'), { $parent: di });
      di.label.set('color:color', stroke);
    }
  }
}

/* ------------------------------------------------------------------ *
 * bpmn-js module: the command, the context pad entry, its popup menu and the import hook.
 * ------------------------------------------------------------------ */

interface Inyectados {
  commandStack: {
    register(nombre: string, handler: { postExecute(ctx: { elemento: ElementoColoreable; color: ColorId | null }): void }): void;
    execute(nombre: string, ctx: object): void;
  };
  modeling: Escritor['modeling'];
  bpmnFactory: Escritor['bpmnFactory'];
  eventBus: { on(evento: string, oyente: (e: { definitions?: Parameters<typeof coloresDeBizagi>[0] }) => void): void };
  contextPad: {
    registerProvider(prioridad: number, proveedor: object): void;
    getPad(elemento: unknown): { html: HTMLElement };
  };
  popupMenu: {
    registerProvider(id: string, proveedor: object): void;
    open(elemento: unknown, id: string, posicion: object, opciones: object): void;
  };
}

/** The service `lilaColores`: `pintar` is one undoable command. */
export class LilaColores {
  static $inject = ['commandStack', 'modeling', 'bpmnFactory', 'eventBus', 'contextPad', 'popupMenu'];
  readonly pintar: (elemento: ElementoColoreable, color: ColorId | null) => void;

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
      postExecute: ({ elemento, color }) => escribirColor({ modeling, bpmnFactory }, elemento, color),
    });
    this.pintar = (elemento, color) => commandStack.execute('lila.color', { elemento, color });

    eventBus.on('import.parse.complete', ({ definitions }) => {
      if (definitions !== undefined) coloresDeBizagi(definitions);
    });

    const pintables = (el: ElementoColoreable): boolean => el.di !== undefined && el.type !== 'label';
    contextPad.registerProvider(500, {
      getContextPadEntries: (elemento: ElementoColoreable) => (entradas: Record<string, unknown>) =>
        !pintables(elemento) ? entradas : {
          ...entradas,
          'lila-color': {
            group: 'edit',
            className: 'lila-color-entrada',
            title: strings().propiedades.cambiarColor,
            action: {
              click: (evento: MouseEvent, el: ElementoColoreable) => {
                const caja = contextPad.getPad(el).html.getBoundingClientRect();
                popupMenu.open(el, 'lila-colores', { x: caja.left, y: caja.bottom + 5, cursor: { x: evento.x, y: evento.y } }, {
                  title: strings().propiedades.cambiarColor,
                });
              },
            },
          },
        },
    });
    popupMenu.registerProvider('lila-colores', {
      getPopupMenuEntries: (elemento: ElementoColoreable) => {
        const S = strings().propiedades.colores;
        const muestra = (fill: string, stroke: string): string =>
          `<div style="width:14px;height:14px;background:${fill};border:1px solid ${stroke}"></div>`;
        return Object.fromEntries(
          [{ id: 'ninguno' as const, fill: 'transparent', stroke: 'currentColor' }, ...COLORES].map((c) => [
            `lila-color-${c.id}`,
            {
              label: S[c.id],
              imageHtml: muestra(c.fill, c.stroke),
              action: () => this.pintar(elemento, c.id === 'ninguno' ? null : c.id),
            },
          ]),
        );
      },
    });
  }
}

/** didi module for `additionalModules` in `Modeler.tsx`. */
export const moduloColores = { __init__: ['lilaColores'], lilaColores: ['type', LilaColores] };
