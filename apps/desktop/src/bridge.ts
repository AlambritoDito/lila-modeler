/**
 * Contrato del puente `window.lila` (OP-02, reescrito en OP-08 al alcance de operaciones de
 * proyecto — contrato §Puente B). Puro tipo — sin Electron, sin `ipcRenderer` — para que
 * `apps/web` (vía `DesktopStore`, LILA-071) y `preload.cts` compartan la misma forma sin que el
 * renderer importe nada de `electron`. `platform: 'desktop'` es lo que `ProjectStore` (LILA-058)
 * usa para detectar esta modalidad con `typeof window.lila !== 'undefined'`.
 *
 * `listFiles`/`readFile`/`writeFile` (OP-02, genéricos) se retiraron: el puente ya no expone E/S
 * de archivos sueltos, solo operaciones de proyecto completo (`chooseFolder`/`readProject`/
 * `writeProject`), como fija el contrato.
 */
import type { ProjectDocument, ProjectProblem } from './projectTypes.js';

/** Valor fijo de `LilaBridge.platform`: distingue esta modalidad de `BrowserStore`/`RemoteStore`. */
export const LILA_PLATFORM = 'desktop';

/**
 * Lo que devuelve `readProject`: un `ProjectDocument` de verdad (todos sus campos), más
 * `problems`, que el contrato de A no declara porque `ProjectDocument` no lo tiene. Es la
 * extensión mínima para que `DesktopStore.lastProblems` (OP-08, decisión 3) pueda mostrar qué
 * `*.scenario.json`/`runs/*.result.json` se excluyeron por JSON roto sin inventar un canal IPC
 * aparte. Petición a A (ver `estado/OP-08-claude.md`): declarar `problems?` opcional en
 * `ProjectDocument` para no depender de esta extensión del lado B.
 */
export interface LilaProjectDocument extends ProjectDocument {
  readonly problems: readonly ProjectProblem[];
}

export interface LilaBridge {
  readonly platform: typeof LILA_PLATFORM;
  readonly version: string;

  /**
   * Abre el selector nativo de carpetas. `null` es "se cerró sin elegir nada": no es un error.
   * La carpeta elegida queda autorizada en main para `readProject`/`writeProject`.
   */
  chooseFolder(): Promise<string | null>;
  /**
   * Lee el proyecto completo de `dir` (ya autorizada por `chooseFolder`): modelo, escenarios
   * crudos (con `problems` para los que no se pudieron interpretar) y corridas guardadas.
   */
  readProject(dir: string): Promise<LilaProjectDocument>;
  /**
   * Escribe el proyecto completo en `dir` (ya autorizada). Rechaza sin tocar disco si alguna
   * corrida ya existe con otro contenido (`E-RUN-DUPLICADO`).
   */
  writeProject(dir: string, document: ProjectDocument): Promise<void>;
}

declare global {
  interface Window {
    lila?: LilaBridge;
  }
}
