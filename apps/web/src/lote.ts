/**
 * One undoable command around several `modeling` calls (#509): saving the extended attribute
 * definitions can also clear values on many elements, and one ⌘Z has to undo all of it. Same
 * trick as `lila.color` in `colores.ts`: `modeling` calls made in `postExecute` are recorded as
 * part of the command, and redo replays them without running `postExecute` again.
 */
import { GuardiaAtributos } from './atributos';

interface Contexto { hacer: () => void }

interface CommandStack {
  register(nombre: string, handler: { postExecute(ctx: Contexto): void }): void;
  execute(nombre: string, ctx: Contexto): void;
}

export class LilaLote {
  static $inject = ['commandStack'];
  readonly ejecutar: (hacer: () => void) => void;

  constructor(commandStack: CommandStack) {
    commandStack.register('lila.lote', { postExecute: ({ hacer }) => hacer() });
    this.ejecutar = (hacer) => commandStack.execute('lila.lote', { hacer });
  }
}

interface Ids { assigned(id: string): unknown; claim(id: string, element: unknown): void; unclaim(id: string): void }
interface ConId { id?: string; processRef?: ConId }
interface Borrado { context: { shape?: { type?: string; businessObject?: ConId }; connection?: { businessObject?: ConId } } }

/**
 * #515: bpmn-js's `UnclaimIdBehavior` frees a pool's process id in `preExecute`, outside the
 * command, so ⌘Z brings the process back with its id still free — and the next paste of that
 * pool kept it (`ModdleCopy._copyId`): two pools, one process. Undo claims it again; `executed`
 * (which redo also fires, unlike `preExecute`) frees it again when it is still the pool's.
 *
 * #534: a paste claims its ids outside the command too (`ModdleCopy`), so after undoing a paste
 * and the delete before it, redoing the delete frees the id the redone paste is using — and the
 * next paste kept it: «element <…> already exists». A create (and its redo) claims what is free.
 */
export class ReclamoDeProcesos {
  static $inject = ['eventBus', 'moddle'];

  constructor(eventBus: { on(evento: string | string[], escuchar: (e: Borrado) => void): void }, moddle: { ids: Ids }) {
    const proceso = ({ context: { shape } }: Borrado) =>
      (shape?.type === 'bpmn:Participant' ? shape.businessObject?.processRef : undefined);
    eventBus.on('commandStack.shape.delete.reverted', (e) => {
      const p = proceso(e);
      if (p?.id !== undefined && !moddle.ids.assigned(p.id)) moddle.ids.claim(p.id, p);
    });
    // Only if the id is still this process's: a pool pasted after the delete may have taken it.
    eventBus.on('commandStack.shape.delete.executed', (e) => {
      const p = proceso(e);
      if (p?.id !== undefined && moddle.ids.assigned(p.id) === p) moddle.ids.unclaim(p.id);
    });
    eventBus.on(['commandStack.shape.create.executed', 'commandStack.connection.create.executed'], ({ context }) => {
      const bo = (context.shape ?? context.connection)?.businessObject;
      for (const el of [bo, bo?.processRef]) {
        if (el?.id !== undefined && !moddle.ids.assigned(el.id)) moddle.ids.claim(el.id, el);
      }
    });
  }
}

interface Moddle {
  $parent?: Moddle;
  $descriptor?: { properties: { name: string; isMany?: boolean; isReference?: boolean }[] };
  processRef?: Moddle;
  get(nombre: string): unknown;
}
interface Elemento { type?: string; labelTarget?: unknown; businessObject?: Moddle; di?: Moddle }
interface Lugar { lista: Moddle[]; el: Moddle; indice: number }
interface BorradoConLugar { context: { shape?: Elemento; connection?: Elemento; lilaLugares?: Lugar[] } }

/** Where `el` sits among its parent's children (the many-valued property that holds it). */
function lugar(el: Moddle | undefined): Lugar | undefined {
  const padre = el?.$parent;
  for (const p of padre?.$descriptor?.properties ?? []) {
    if (!p.isMany || p.isReference) continue;
    const lista = padre!.get(p.name) as Moddle[] | undefined;
    const indice = lista?.indexOf(el!) ?? -1;
    if (indice >= 0) return { lista: lista!, el: el!, indice };
  }
  return undefined;
}

/**
 * #534: ⌘Z of a delete puts the element back at the END of its parent's list — a pool at the end
 * of `participants` and its process at the end of `definitions.rootElements`, each of its shapes
 * and flows at the end of `flowElements`, its DI at the end of the plane
 * (`BpmnUpdater.updateSemanticParent`/`updateDiParent`). The engine reads the document in order:
 * it simulates the first non-empty process (`parseBpmn`), so undoing the delete of the first pool
 * switched the simulated process (E-ELEMENTO-DESCONOCIDO), and the order of the flow elements
 * changes the results of a fixed seed. The places are taken right before each delete runs (in
 * `execute`, so redo takes them too, after the handler's own `preExecute` has removed the
 * element's connections and children) and given back after bpmn-js's revert. Undo runs in reverse
 * order, so each element finds its list exactly as it left it.
 */
export class OrdenAlDeshacer {
  static $inject = ['eventBus'];

  constructor(eventBus: { on(eventos: string[], prioridad: number, escuchar: (e: BorradoConLugar) => void): void }) {
    const borrados = ['commandStack.shape.delete', 'commandStack.connection.delete'];
    eventBus.on(borrados.map((b) => `${b}.execute`), 1000, ({ context }) => {
      const el = context.shape ?? context.connection;
      if (el === undefined || el.labelTarget !== undefined) return;
      const bo = el.businessObject;
      context.lilaLugares = [lugar(bo), lugar(el.di), lugar(bo?.processRef)].filter((l) => l !== undefined);
    });
    // Below the default priority: after `BpmnUpdater` has put them back.
    eventBus.on(borrados.map((b) => `${b}.reverted`), 500, ({ context }) => {
      for (const { lista, el, indice } of context.lilaLugares ?? []) {
        const actual = lista.indexOf(el);
        if (actual < 0 || actual === indice) continue;
        lista.splice(actual, 1);
        lista.splice(indice, 0, el);
      }
    });
  }
}

/**
 * didi module for `additionalModules` in `Modeler.tsx`: the batch, the guard that keeps the
 * extended attribute definitions alive when pools come and go (`atributos.ts`), and the one that
 * keeps a deleted-then-restored pool's process id claimed, and the one that gives what ⌘Z
 * brings back its place in the document.
 */
export const moduloLote = {
  __init__: ['lilaLote', 'lilaGuardiaAtributos', 'lilaReclamoDeProcesos', 'lilaOrdenAlDeshacer'],
  lilaLote: ['type', LilaLote],
  lilaGuardiaAtributos: ['type', GuardiaAtributos],
  lilaReclamoDeProcesos: ['type', ReclamoDeProcesos],
  lilaOrdenAlDeshacer: ['type', OrdenAlDeshacer],
};
