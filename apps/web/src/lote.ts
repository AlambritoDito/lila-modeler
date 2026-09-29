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
interface Borrado { context: { shape?: { type?: string; businessObject?: { processRef?: { id?: string } } } } }

/**
 * #515: bpmn-js's `UnclaimIdBehavior` frees a pool's process id in `preExecute`, outside the
 * command, so ⌘Z brings the process back with its id still free — and the next paste of that
 * pool kept it (`ModdleCopy._copyId`): two pools, one process. Undo claims it again; `executed`
 * (which redo also fires, unlike `preExecute`) frees it again.
 */
export class ReclamoDeProcesos {
  static $inject = ['eventBus', 'moddle'];

  constructor(eventBus: { on(evento: string, escuchar: (e: Borrado) => void): void }, moddle: { ids: Ids }) {
    const proceso = ({ context: { shape } }: Borrado) =>
      (shape?.type === 'bpmn:Participant' ? shape.businessObject?.processRef : undefined);
    eventBus.on('commandStack.shape.delete.reverted', (e) => {
      const p = proceso(e);
      if (p?.id !== undefined && !moddle.ids.assigned(p.id)) moddle.ids.claim(p.id, p);
    });
    eventBus.on('commandStack.shape.delete.executed', (e) => {
      const id = proceso(e)?.id;
      if (id !== undefined) moddle.ids.unclaim(id);
    });
  }
}

/**
 * didi module for `additionalModules` in `Modeler.tsx`: the batch, the guard that keeps the
 * extended attribute definitions alive when pools come and go (`atributos.ts`), and the one that
 * keeps a deleted-then-restored pool's process id claimed.
 */
export const moduloLote = {
  __init__: ['lilaLote', 'lilaGuardiaAtributos', 'lilaReclamoDeProcesos'],
  lilaLote: ['type', LilaLote],
  lilaGuardiaAtributos: ['type', GuardiaAtributos],
  lilaReclamoDeProcesos: ['type', ReclamoDeProcesos],
};
