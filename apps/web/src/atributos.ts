/**
 * Extended attributes (#509) on the live moddle: where the definitions are, reading and writing
 * them and the values, and the bpmn-js guard that keeps the definitions alive when pools come and
 * go. No React: `AtributosExtendidos.tsx` is the UI on top.
 *
 * Where the definitions live (`docs/BPMN_EXTENSION.md` § 2.1): in the `extensionElements` of the
 * `bpmn:collaboration` when the diagram has one, else of its only `bpmn:process`. Always found from
 * `bpmn:Definitions`, never from the canvas root, which after a drill-down into a collapsed
 * sub-process is that sub-process. Definitions found anywhere else among the root elements (a
 * process, as the first cut of #513 wrote them, or a pasted copy) are still read, once per id —
 * the canonical place first — and move to the canonical place on the next save of the dialog.
 */
import { uniqueDefinitions, type AttributeDefinition } from '@lila-modeler/engine/bpmn';
import {
  anadirExtension,
  editarExtension,
  leerExtensiones,
  type ElementoLienzo,
  type ElementoModdle,
  type Escritor,
} from './PropertiesPanel';

const DEF = 'lila:AttributeDefinition';
const VAL = 'lila:AttributeValue';
const OPT = 'lila:Option';

/** The moddle properties this file reads beyond `ElementoModdle`. */
export interface Moddle extends ElementoModdle {
  appliesTo?: string;
  default?: string;
  options?: Moddle[];
  participants?: Moddle[];
  rootElements?: Moddle[];
  flowElements?: Moddle[];
  laneSets?: Moddle[];
  lanes?: Moddle[];
  childLaneSet?: Moddle;
  artifacts?: Moddle[];
  extensionElements?: Moddle;
  values?: Moddle[];
  processRef?: Moddle;
}

/** `bpmn:Definitions`, climbing from any element of the tree; `undefined` for a detached one. */
function raizDelArbol(el: Moddle): Moddle | undefined {
  let actual: Moddle | undefined = el;
  while (actual !== undefined && actual.$type !== 'bpmn:Definitions') actual = actual.$parent as Moddle | undefined;
  return actual;
}

/** Where definitions may be read from: the collaborations first, then the processes. */
function duenos(raiz: ElementoLienzo): Moddle[] {
  const bo = raiz.businessObject as Moddle;
  const raices = raizDelArbol(bo)?.rootElements ?? [bo];
  return [
    ...raices.filter((r) => r.$type === 'bpmn:Collaboration'),
    ...raices.filter((r) => r.$type === 'bpmn:Process'),
  ];
}

function definicionesDe(dueno: Moddle): Moddle[] {
  return (dueno.extensionElements?.values ?? []).filter((v) => v.$type === DEF);
}

/** Where definitions are written: the collaboration, else the process (`duenos` puts it first). */
function anfitrion(raiz: ElementoLienzo): Moddle {
  return duenos(raiz)[0] ?? (raiz.businessObject as Moddle);
}

function aPlano(def: Moddle): AttributeDefinition {
  const options = (def.options ?? []).map((o) => o.value ?? '');
  return {
    id: def.id ?? '',
    name: def.name ?? '',
    type: def.type ?? '',
    appliesTo: def.appliesTo ?? '',
    ...(def.default === undefined ? {} : { default: def.default }),
    ...(options.length === 0 ? {} : { options }),
  };
}

/** Every definition of the diagram, each id once (the canonical place's copy wins). */
export function leerDefiniciones(raiz: ElementoLienzo): AttributeDefinition[] {
  return uniqueDefinitions(duenos(raiz).flatMap(definicionesDe).map(aPlano));
}

/**
 * How the definitions are stored right now: `repetidas` copies that are ignored (the same id
 * again), and whether any of them is outside the canonical place. Either one makes the next save
 * of the dialog worth writing even if nothing was edited.
 */
export function estadoDefiniciones(raiz: ElementoLienzo): { repetidas: number; fueraDeSitio: boolean } {
  const host = anfitrion(raiz);
  const todas = duenos(raiz).flatMap(definicionesDe);
  return {
    repetidas: todas.length - uniqueDefinitions(todas.map(aPlano)).length,
    fueraDeSitio: duenos(raiz).some((d) => d !== host && definicionesDe(d).length > 0),
  };
}

/** The element's `lila:attributeValue`s for the definition `ref`, in file order. */
export function leerValores(elemento: ElementoLienzo, ref: string): ElementoModdle[] {
  return leerExtensiones(elemento, VAL).filter((v) => v.ref === ref);
}

/**
 * Sets the element's value for `ref`: edits the one it has, adds one, or — for the empty string —
 * removes it. The caller validates first: this writes what it is given.
 */
export function escribirValor(escritor: Escritor, elemento: ElementoLienzo, ref: string, valor: string): void {
  const [existente] = leerValores(elemento, ref);
  if (valor !== '') {
    if (existente === undefined) anadirExtension(escritor, elemento, VAL, { ref, value: valor });
    else editarExtension(escritor, elemento, existente, { value: valor });
    return;
  }
  if (existente !== undefined) quitarValores(escritor, elemento, elemento.businessObject as Moddle, (v) => v.ref === ref);
}

/** Everything under `bpmn:definitions` that can carry a value, as `annotate.ts` walks it. */
function* todos(el: Moddle): Generator<Moddle> {
  yield el;
  const hijos = [
    ...(el.rootElements ?? []),
    ...(el.flowElements ?? []),
    ...(el.participants ?? []),
    ...(el.artifacts ?? []),
    ...(el.laneSets ?? []),
    ...(el.lanes ?? []),
    ...(el.childLaneSet === undefined ? [] : [el.childLaneSet]),
  ];
  for (const hijo of hijos) yield* todos(hijo);
}

function elementosDelArbol(raiz: ElementoLienzo): Set<Moddle> {
  const bo = raiz.businessObject as Moddle;
  return new Set(todos(raizDelArbol(bo) ?? bo));
}

/** The values stored for `ref` anywhere in the diagram. */
export function valoresDe(raiz: ElementoLienzo, ref: string): string[] {
  const out: string[] = [];
  for (const el of elementosDelArbol(raiz)) {
    for (const v of el.extensionElements?.values ?? []) if (v.$type === VAL && v.ref === ref) out.push(v.value ?? '');
  }
  return out;
}

/** Removes the values `quitar` picks from `dueno`; an `extensionElements` left empty goes too. */
function quitarValores(escritor: Escritor, elemento: ElementoLienzo, dueno: Moddle, quitar: (v: Moddle) => boolean): void {
  const ext = dueno.extensionElements;
  if (ext === undefined) return;
  const antes = ext.values ?? [];
  const resto = antes.filter((v) => !(v.$type === VAL && quitar(v)));
  if (resto.length === antes.length) return;
  if (resto.length === 0) escritor.modeling.updateModdleProperties(elemento, dueno, { extensionElements: undefined });
  else escritor.modeling.updateModdleProperties(elemento, ext, { values: resto });
}

function crearDefinicion(escritor: Escritor, d: AttributeDefinition): Moddle {
  const def = escritor.bpmnFactory.create(DEF, {
    id: d.id,
    name: d.name,
    type: d.type,
    appliesTo: d.appliesTo,
    ...(d.default === undefined || d.default === '' ? {} : { default: d.default }),
  }) as Moddle;
  if (d.type === 'list') {
    def.options = (d.options ?? []).map((value) => {
      const opcion = escritor.bpmnFactory.create(OPT, { value }) as Moddle;
      opcion.$parent = def;
      return opcion;
    });
  }
  return def;
}

/**
 * Puts `defs` in place of `dueno`'s definitions (and the rest of its extensions untouched), with
 * no empty `extensionElements` left behind.
 */
function ponerDefiniciones(escritor: Escritor, elemento: ElementoLienzo, dueno: Moddle, defs: Moddle[]): void {
  const { modeling, bpmnFactory } = escritor;
  const ext = dueno.extensionElements;
  const resto = (ext?.values ?? []).filter((v) => v.$type !== DEF);
  if (ext === undefined) {
    if (defs.length === 0) return;
    const nuevo = bpmnFactory.create('bpmn:ExtensionElements', { values: defs }) as Moddle;
    nuevo.$parent = dueno;
    for (const d of defs) d.$parent = nuevo;
    modeling.updateModdleProperties(elemento, dueno, { extensionElements: nuevo });
  } else if (resto.length === 0 && defs.length === 0) {
    modeling.updateModdleProperties(elemento, dueno, { extensionElements: undefined });
  } else {
    for (const d of defs) d.$parent = ext;
    modeling.updateModdleProperties(elemento, ext, { values: [...resto, ...defs] });
  }
}

/**
 * Replaces every definition of the diagram with `nuevas`, written to the canonical place (so
 * copies elsewhere go away), and removes the values `borrar` picks, as one undoable command when
 * the modeler offers `lote`.
 */
export function guardarDefiniciones(
  escritor: Escritor,
  raiz: ElementoLienzo,
  nuevas: readonly AttributeDefinition[],
  borrar: (ref: string, valor: string) => boolean,
): void {
  const hacer = (): void => {
    const host = anfitrion(raiz);
    for (const dueno of duenos(raiz)) {
      if (dueno !== host && definicionesDe(dueno).length > 0) ponerDefiniciones(escritor, raiz, dueno, []);
    }
    ponerDefiniciones(escritor, raiz, host, nuevas.map((d) => crearDefinicion(escritor, d)));
    for (const el of elementosDelArbol(raiz)) {
      quitarValores(escritor, raiz, el, (v) => borrar(v.ref ?? '', v.value ?? ''));
    }
  };
  if (escritor.lote === undefined) hacer();
  else escritor.lote(hacer);
}

/* ------------------------------------------------------------------ *
 * The bpmn-js guard: definitions follow the root when pools come and go.
 * ------------------------------------------------------------------ */

interface Figura extends ElementoLienzo { parent?: Figura }

interface EventBus {
  on(evento: string, prioridad: number, oyente: (e: { context: Record<string, unknown> } & Record<string, unknown>) => unknown): void;
}

/**
 * Moves `desde`'s definitions to `hacia`, skipping ids `hacia` already has. Nested `modeling` calls
 * inside another command's pre/postExecute are recorded as part of it: one ⌘Z undoes both.
 */
function moverDefiniciones(escritor: Escritor, elemento: ElementoLienzo, desde: Moddle, hacia: Moddle): void {
  const propias = definicionesDe(desde);
  if (propias.length === 0 || desde === hacia) return;
  const ya = new Set(definicionesDe(hacia).map((d) => d.id));
  const nuevas = uniqueDefinitions(propias.map(aPlano)).filter((d) => !ya.has(d.id));
  ponerDefiniciones(escritor, elemento, desde, []);
  ponerDefiniciones(escritor, elemento, hacia, [
    ...definicionesDe(hacia).map((d) => crearDefinicion(escritor, aPlano(d))),
    ...nuevas.map((d) => crearDefinicion(escritor, d)),
  ]);
}

/**
 * - Turning a process diagram into a collaboration (the first pool) or back (the last pool
 *   deleted) replaces the canvas root (`canvas.updateRoot`): the definitions go with it.
 * - Deleting a pool whose process still holds definitions (a file from before this rule) moves
 *   them to the collaboration first: the process leaves the file with the pool.
 * - Copying a pool never copies definitions: the pasted process would repeat every id.
 */
export class GuardiaAtributos {
  static $inject = ['eventBus', 'modeling', 'bpmnFactory'];

  constructor(eventBus: EventBus, modeling: Escritor['modeling'], bpmnFactory: Escritor['bpmnFactory']) {
    const escritor: Escritor = { modeling, bpmnFactory };
    eventBus.on('commandStack.canvas.updateRoot.postExecute', 1000, ({ context }) => {
      const viejo = context.oldRoot as Figura | undefined;
      const nuevo = context.newRoot as Figura | undefined;
      if (viejo === undefined || nuevo === undefined) return;
      moverDefiniciones(escritor, nuevo, viejo.businessObject as Moddle, nuevo.businessObject as Moddle);
    });
    eventBus.on('commandStack.shape.delete.preExecute', 1000, ({ context }) => {
      const pool = context.shape as Figura | undefined;
      const proceso = (pool?.businessObject as Moddle | undefined)?.processRef;
      const colaboracion = pool?.parent;
      if (pool?.type !== 'bpmn:Participant' || proceso === undefined || colaboracion === undefined) return;
      moverDefiniciones(escritor, colaboracion, proceso, colaboracion.businessObject as Moddle);
    });
    eventBus.on('moddleCopy.canCopyProperty', 1500, ({ property }) =>
      (property as Moddle | undefined)?.$type === DEF ? false : undefined);
  }
}
