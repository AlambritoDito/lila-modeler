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

/**
 * didi module for `additionalModules` in `Modeler.tsx`: the batch, and the guard that keeps the
 * extended attribute definitions alive when pools come and go (`atributos.ts`).
 */
export const moduloLote = {
  __init__: ['lilaLote', 'lilaGuardiaAtributos'],
  lilaLote: ['type', LilaLote],
  lilaGuardiaAtributos: ['type', GuardiaAtributos],
};
