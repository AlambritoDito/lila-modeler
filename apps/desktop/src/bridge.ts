/**
 * Contrato del puente `window.lila` (OP-02, reescrito en OP-08 al alcance de operaciones de
 * proyecto — contrato §Puente B). Puro tipo — sin Electron, sin `ipcRenderer` — para que
 * `apps/web` (vía `DesktopStore`, LILA-071) y `preload.cts` compartan la misma forma sin que el
 * renderer importe nada de `electron`. `platform: 'desktop'` es lo que `ProjectStore` (LILA-058)
 * usa para detectar esta modalidad con `typeof window.lila !== 'undefined'`.
 *
 * `listFiles`/`readFile`/`writeFile` (OP-02, genéricos) se retiraron: el puente ya no expone E/S
 * de archivos sueltos, solo operaciones de proyecto completo (`chooseFolder`/`chooseSaveFile`/
 * `readProject`/`writeProject`), como fija el contrato.
 *
 * **Vocabulario de errores.** Un fallo de proyecto llega al renderer como `Error` con el mensaje
 * `"<código>: <texto>"` (lo compone `main.ts`). Los códigos son estables:
 *
 * - Carpeta y `.lila` por igual: `E-CARPETA-OCUPADA` («Guardar como» sobre un destino que ya tiene
 *   otro proyecto), `E-CAMBIO-EXTERNO` (algo cambió en disco desde la última lectura/escritura y
 *   no se pidió `overwrite`), `E-SIN-MODELO` (no hay proyecto que leer).
 * - Solo carpeta: `E-RUN-DUPLICADO`, `E-SYMLINK`, `E-DESTINO-INVALIDO`, `E-RECUPERACION-PENDIENTE`.
 * - Solo `.lila` (ADR-027, contenido del archivo): `E-ZIP` (no se pudo descomprimir),
 *   `E-NO-MANIFEST` (sin `lila-project.json`), `E-MANIFEST` (manifiesto inválido o de otra
 *   versión), `E-NO-MODEL` (sin `model.bpmn`), `E-ENTRY-PATH` (entrada con ruta insegura),
 *   `E-DOCUMENTO`, `E-DIAGNOSTICO`, `E-CORRIDA`, `E-ENTRADAS-CORRIDA` (el documento a escribir no
 *   valida). El mapa `LILA-…` del motor → `E-…` de aquí es explícito en `lilaFile.ts`.
 * - Del propio puente (validación de argumentos IPC): `E-ARGUMENTO`, `E-NO-AUTORIZADO`,
 *   `E-RUTA-FUERA`.
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
  /**
   * `true` si lo abierto es un diagrama suelto (LILA-072): CUALQUIER `.bpmn` que no sea el
   * `model.bpmn` de su carpeta, sea esa carpeta un proyecto Lila o no (LILA-206). El renderer lo
   * dice en el pie y lo devuelve como `options.diagramOnly` al guardar, para que un ⌘S no siembre
   * la carpeta del usuario con un proyecto entero.
   */
  readonly loose?: boolean;
}

/** Result of a close-time save. Only `saved` permits closing the window. */
export type SaveOutcome = 'saved' | 'diagram-only' | 'cancelled' | 'failed';

export interface LilaBridge {
  readonly platform: typeof LILA_PLATFORM;
  readonly version: string;

  /**
   * Abre el selector nativo. Por defecto elige una CARPETA de proyecto (ADR-018); en macOS el
   * mismo panel deja elegir también un `.lila` (ADR-027), que Windows y Linux no permiten mezclar
   * — de ahí `fileOnly`, que pide un diálogo de solo archivos (menú «Abrir proyecto .lila…»).
   * `null` es "se cerró sin elegir nada": no es un error. Lo elegido queda autorizado en main
   * para `readProject`/`writeProject`, sea carpeta o archivo.
   */
  chooseFolder(fileOnly?: boolean): Promise<string | null>;
  /**
   * Lee el proyecto completo de `dir` (ya autorizada por `chooseFolder`): modelo, escenarios
   * crudos (con `problems` para los que no se pudieron interpretar) y corridas guardadas.
   */
  readProject(dir: string): Promise<LilaProjectDocument>;
  /**
   * Escribe el proyecto completo en `dir` (ya autorizada). Rechaza sin tocar disco si alguna
   * corrida ya existe con otro contenido (`E-RUN-DUPLICADO`), si algún destino es un symlink
   * (`E-SYMLINK`), si `options.saveAs` y la carpeta ya tiene otro proyecto (`E-CARPETA-OCUPADA`,
   * OP-14), o si algún archivo cambió en disco desde la última lectura/escritura y no se pidió
   * `options.overwrite` (`E-CAMBIO-EXTERNO`, OP-14 incremento 2).
   */
  writeProject(dir: string, document: ProjectDocument, options?: WriteProjectOptions): Promise<void>;

  /**
   * Informa a main si el documento activo tiene cambios sin guardar (OP-14, issue #74): decide si
   * `win.on('close')`/`before-quit` deben interceptar el cierre para ofrecer guardar/descartar.
   */
  setDirty(dirty: boolean): void;
  /**
   * Registra `cb` para cuando main pide guardar antes de cerrar (el usuario eligió "Guardar" en el
   * diálogo nativo de cierre). `cb` reports a SaveOutcome; main closes only on `saved` and distinguishes
   * cancellation, a partial diagram save and a real failure. Devuelve una función para
   * cancelar la suscripción. El preload solo reenvía el evento IPC — no hay lógica aquí más que la
   * de mensajería (ver `preload.cts`).
   */
  onCloseRequested(cb: () => Promise<SaveOutcome>): () => void;

  /** Hasta 10 proyectos abiertos/guardados recientemente en esta máquina, más nuevo primero (OP-14). */
  listRecents(): Promise<readonly Recent[]>;
  /**
   * Reabre un proyecto de `listRecents()` sin volver a mostrar el selector nativo de carpetas.
   * `null` si `dir` ya no existe (y se quita de recientes): no es un error, es "ya no disponible".
   * `file` (LILA-072) es el `.bpmn` a abrir como modelo cuando no es el `model.bpmn` del proyecto
   * —doble clic en un `.bpmn` cualquiera, incluso uno suelto en una carpeta que no es un proyecto
   * Lila—; esa apertura no entra en recientes, que guarda carpetas y reabriría el `model.bpmn`.
   */
  openRecent(dir: string, file?: string): Promise<LilaProjectDocument | null>;

  /**
   * Ruta `.bpmn` pendiente de abrir: doble clic en el explorador de archivos, `open-file` de
   * macOS, o argumento de línea de comandos, capturados antes de que la ventana estuviera lista.
   * Se consume una vez — la segunda llamada devuelve `null` aunque la primera haya devuelto algo.
   */
  pendingOpenPath(): Promise<OpenPathRequest | null>;
  /**
   * Se dispara cuando llega una nueva ruta `.bpmn` a abrir con la ventana ya lista (segunda
   * instancia, o `open-file` con la app ya corriendo). Devuelve una función para cancelar la
   * suscripción.
   */
  onOpenPath(cb: (path: OpenPathRequest) => void): () => void;

  /**
   * Acciones del menú nativo (Archivo, Preferencias…): main las manda por `lila:menu` y el shell
   * las despacha a las mismas funciones que los botones de la barra. Los aceleradores viven en el
   * menú (`menu.ts`), no en el renderer: así el atajo no se dispara dos veces en Windows/Linux.
   */
  onMenu(cb: (action: MenuAction) => void): () => void;

  /**
   * Preferencias de apariencia (LILA-113). Viven en `<userData>/estado.json`, junto a la ventana
   * y los recientes, y no en el `localStorage` del renderer: la configuración de una app de
   * escritorio se espera en la carpeta de usuario —copiable entre máquinas y borrable sin abrir
   * la app—, no dentro del perfil de Chromium.
   */
  readSettings(): Promise<Ajustes>;
  /** FUSIONA con lo guardado: mandar solo `{ tema }` no borra la densidad. */
  writeSettings(ajustes: Ajustes): Promise<void>;
}

/**
 * Preferencias de apariencia persistidas (LILA-113). Las dos son opcionales: un `estado.json`
 * escrito por una versión anterior no las trae, y el renderer manda una sola cuando cambia una
 * sola. Son texto libre a propósito —este contrato no conoce la lista de temas ni de densidades—:
 * quien las lee (`App.tsx`) descarta el valor que ya no exista y sigue con el de fábrica.
 */
export interface Ajustes {
  readonly tema?: string;
  readonly densidad?: string;
  /**
   * Language preference (LILA-210): `auto` (follow the system), `en` or `es`. It is the
   * PREFERENCE and not the resolved language, so a machine that changes its system language keeps
   * following it. Typed as `string` for the same reason as `tema` and `densidad`: main does not
   * know the list of valid values, the renderer does and falls back to `auto` for anything else.
   */
  readonly idioma?: string;
  /** Temas creados por el usuario en Ajustes → Apariencia (LILA-114). */
  readonly temas?: readonly TemaGuardado[];
}

/**
 * Un tema del usuario tal y como se guarda (LILA-114). `tema` es exactamente lo que se exporta e
 * importa (`{ name, tokens }`, `docs/THEMES.md`); `origen` son los tokens con los que nació —la
 * copia del integrado que se duplicó, o el JSON importado— y es lo único que necesita
 * «Restablecer»: guardarlos cuesta unos cientos de bytes por tema y ahorra volver a pedir el
 * integrado por `fetch` y depender de que su JSON no haya cambiado desde entonces.
 *
 * Este contrato no conoce la lista de tokens válidos, igual que no conoce la de temas: los valores
 * son texto y quien los lee (`theme/temas.ts`) descarta el tema que ya no valide.
 */
export interface TemaGuardado {
  readonly id: string;
  readonly tema: { readonly name: string; readonly tokens: { readonly [token: string]: string } };
  readonly origen: { readonly [token: string]: string };
}

/** Lo que el menú nativo puede pedirle al shell. `openRecent` lleva la carpeta de `listRecents()`. */
export type MenuAction =
  | 'ajustes'
  | 'nuevo'
  | 'abrir'
  | 'abrirArchivo'
  | 'guardar'
  | 'guardarComo'
  | { readonly openRecent: string };

export interface WriteProjectOptions {
  readonly saveAs?: boolean;
  readonly overwrite?: boolean;
  /** `.bpmn` donde va el XML; por defecto `model.bpmn` (LILA-072, ver `projectIO.ts`). */
  readonly modelFile?: string;
  /** `true` para escribir SOLO ese `.bpmn` (diagrama suelto): sin manifiesto, escenarios ni corridas. */
  readonly diagramOnly?: boolean;
}

/** Entrada de `listRecents()`: carpeta autorizable de nuevo sin diálogo, y cuándo se abrió. */
export interface Recent {
  readonly dir: string;
  readonly name: string;
  readonly openedAt: string;
}

/** `dir` (ya autorizada) y nombre de archivo de un `.bpmn` a abrir (`pendingOpenPath`/`onOpenPath`). */
export interface OpenPathRequest {
  readonly dir: string;
  readonly file: string;
}

declare global {
  interface Window {
    lila?: LilaBridge;
  }
}
