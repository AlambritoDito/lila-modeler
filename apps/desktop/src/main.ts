/**
 * Proceso main de OP-02, endurecido en OP-14 (revisión de A sobre OP-02: issues #74/#70/#71).
 * Decisiones ya tomadas (ver ticket y checkpoint):
 *
 * - Producción sirve la SPA compilada por un protocolo propio (`lila://`), no `file://`: así
 *   `fetch('/eva-01.json')`, `/assets/*`, las fuentes bpmn y el Worker módulo funcionan con
 *   rutas absolutas sin tocar `apps/web/vite.config.ts`.
 * - En dev, si `LILA_DEV_URL` está definida, la ventana carga esa URL (el dev server de Vite);
 *   si no, carga el protocolo — así este proceso nunca depende de que Vite esté corriendo.
 * - Ventana endurecida: `contextIsolation`, `sandbox`, sin `nodeIntegration`, sin `remote`;
 *   `window.open` se bloquea siempre, los enlaces http(s) se abren con `shell.openExternal`,
 *   `will-navigate` bloquea cualquier destino que no sea la propia app, y las respuestas HTML del
 *   protocolo `lila://` llevan una `Content-Security-Policy` (ver `CSP`, abajo).
 * - El puente `window.lila` vive en `preload.ts`/`bridge.ts`; aquí solo se validan argumentos, se
 *   autorizan carpetas elegidas por diálogo antes de tocar el disco, y cada `ipcMain.handle`/`.on`
 *   verifica que el mensaje venga del frame principal de la propia app (`isTrustedSender`,
 *   `ipcGuards.ts`) — un frame anidado o una URL de navegación ajena no puede invocar el puente.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, shell } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, WebFrameMain } from 'electron';
import { appendFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SaveOutcome, Ajustes, OpenPathRequest, Recent } from './bridge.js';
import { closeDialogOptions, decideClose, readSaveOutcome, saveOutcomeDialogOptions, type CloseChoice } from './closeGuard.js';
import { e2eOverrides, type E2EOverrides } from './e2e.js';
import { isTrustedSender } from './ipcGuards.js';
import { resolveDesktopLocale, type DesktopLocale } from './locale.js';
import { menuTemplate } from './menu.js';
import { findBpmnArg, isBpmnPath, isLilaPath, withLilaExtension } from './openPath.js';
import { readLilaFile, writeLilaFile } from './lilaFile.js';
import { hasProjectModel, ProjectIOError, readProjectFolder, writeProjectFolder, type WriteProjectOptions } from './projectIO.js';
import type { ProjectDocument } from './projectTypes.js';
import { isFlatName, mimeFor, PathEscapeError, resolveWithin } from './safePaths.js';
import { desktopStrings, type Strings } from './strings/index.js';
import {
  addRecent,
  fitsAnyDisplay,
  parseAjustes,
  readSessionState,
  removeRecent,
  withAjustes,
  withWindowBounds,
  writeSessionState,
  type SessionState,
  type WindowBounds,
} from './sessionState.js';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lila',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** Raíz de la SPA compilada: `apps/desktop/dist/web` (ver `scripts/copy-web.mjs`). */
const webRoot = path.join(app.getAppPath(), 'dist', 'web');

/** Carpetas que el usuario autorizó explícitamente vía `chooseFolder` (diálogo nativo). */
const authorizedFolders = new Set<string>();

/**
 * Política de seguridad de contenido para las respuestas del protocolo `lila://` (issue #71,
 * punto 3 del ticket: "lo más estricta que el smoke permita"). Sin CDN ni red externa: el bundle
 * de producción es autocontenido (Vite empaqueta fuentes/CSS/JS), así que todo cabe en `'self'`.
 * `worker-src` incluye `blob:` porque algunos motores de Worker de módulos lo usan internamente
 * incluso para un script `'self'` (documentado, no verificado necesario tras el smoke — se deja
 * por si acaso, cuesta cero con `default-src 'self'` ya cerrado). Ninguna directiva tuvo que
 * relajarse tras correr el smoke (`LILA_SMOKE=1`): la lista de abajo es la final.
 */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'";

// -- Seam de pruebas E2E por variables de entorno (OP-14, issue #74) ----------------------------
// SOLO PARA PRUEBAS, no es una API pública: F no puede accionar diálogos nativos (selector de
// carpeta, Guardar/Descartar/Cancelar del cierre) desde una sesión automatizada. Leído de
// `process.env` UNA ÚNICA VEZ aquí, al cargar el módulo — nunca se vuelve a consultar
// `process.env` más abajo, así ninguna de las tres variables puede cambiar el comportamiento a
// mitad de una ejecución ya en marcha. Sin ninguna de las tres, `e2e` es `{}` y el comportamiento
// es idéntico al que había antes de este seam (ver `e2e.ts` para el detalle de cada variable).
const e2e: E2EOverrides = e2eOverrides(process.env);

/** Añade una línea JSON a `LILA_E2E_LOG` (si está definida); no-op en cualquier otro caso. */
async function e2eLog(event: string, data: object = {}): Promise<void> {
  if (e2e.logPath === undefined) return;
  const line = `${JSON.stringify({ ts: new Date().toISOString(), event, ...data })}\n`;
  await appendFile(e2e.logPath, line, 'utf8').catch(() => {});
}

/**
 * Valida `dir` contra `authorizedFolders` (que guarda siempre `realpath`, ver `chooseFolder`/
 * `acceptOpenPath`) y, además, vuelve a resolver su `realpath` en este momento: si difiere de sí
 * misma, la carpeta cambió de identidad (p. ej. la reemplazó un symlink) entre la autorización y
 * este uso — TOCTOU que `resolveWithin` por sí solo no cubre (issue #71).
 */
async function requireAuthorizedDir(dir: unknown): Promise<string> {
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new Error('E-ARGUMENTO: "dir" debe ser una ruta de texto no vacía.');
  }
  if (!authorizedFolders.has(dir)) {
    throw new Error('E-NO-AUTORIZADO: la carpeta no fue autorizada por un diálogo.');
  }
  let real: string;
  try {
    real = await realpath(dir);
  } catch {
    throw new Error('E-NO-AUTORIZADO: la carpeta autorizada ya no existe.');
  }
  if (real !== dir) {
    throw new Error('E-NO-AUTORIZADO: la carpeta cambió de identidad desde que se autorizó (symlink).');
  }
  return dir;
}

/**
 * Valida que `name` sea un nombre de archivo plano (`isFlatName`: sin `/`, sin `\`, ni `.`/`..`
 * exactos) terminado en `suffix`, y que además resuelva dentro de `dir` (defensa en profundidad
 * además de la forma: un nombre sin barras ya no puede escaparse, pero `resolveWithin` es la misma
 * comprobación que usa el resto del puente y cuesta cero repetirla aquí).
 */
function requireFlatName(dir: string, name: unknown, suffix: string, label: string): string {
  if (typeof name !== 'string' || !isFlatName(name) || !name.endsWith(suffix)) {
    throw new Error(
      `E-ARGUMENTO: "${label}" debe ser un nombre de archivo plano terminado en "${suffix}" (recibido: ${JSON.stringify(name)}).`,
    );
  }
  try {
    resolveWithin(dir, name);
  } catch (error) {
    if (error instanceof PathEscapeError) {
      throw new Error(`E-RUTA-FUERA: "${label}" resuelve fuera de la carpeta autorizada.`);
    }
    throw error;
  }
  return name;
}

/**
 * Nombre de `.bpmn` opcional del puente (LILA-072): el `file` de `lila:openRecent` (el archivo que
 * el usuario pulsó) y el `options.modelFile` de `lila:writeProject` (aquel en el que hay que
 * guardar). `undefined` (o `null`) es "el `model.bpmn` de siempre".
 */
function requireBpmnName(dir: string, value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !isBpmnPath(value)) {
    throw new Error(
      `E-ARGUMENTO: "file" debe ser un nombre de archivo .bpmn (recibido: ${JSON.stringify(value)}).`,
    );
  }
  // `Model.bpmn` con otras mayúsculas se rechaza en `projectIO` (lectura y escritura), y SOLO si
  // la carpeta ya es un proyecto Lila: ahí es donde se sabe si hay un `model.bpmn` que pisar
  // (LILA-208, hallazgo 3 del QA). Un `Model.bpmn` suelto en `~/Descargas` es legítimo y se abre.
  // El sufijo ya está comprobado arriba, e insensible a mayúsculas (`Ventas.BPMN` es válido);
  // aquí solo interesan las comprobaciones de nombre plano y `resolveWithin`.
  return requireFlatName(dir, value, '', 'file');
}

/**
 * Comprobación de forma mínima de `ProjectDocument` recibido por IPC: exactamente los campos
 * que `projectIO.writeProjectFolder` necesita para no reventar de forma confusa, sin validar el
 * contenido de cada escenario/corrida (eso es del motor o de A, no de este puente).
 */
function requireProjectDocument(value: unknown): ProjectDocument {
  if (typeof value !== 'object' || value === null) {
    throw new Error('E-ARGUMENTO: "document" debe ser un objeto.');
  }
  const doc = value as Record<string, unknown>;
  if (doc.version !== 1) throw new Error('E-ARGUMENTO: "document.version" debe ser 1.');
  if (typeof doc.id !== 'string' || typeof doc.name !== 'string') {
    throw new Error('E-ARGUMENTO: "document.id"/"document.name" deben ser texto.');
  }
  if (typeof doc.model !== 'object' || doc.model === null) {
    throw new Error('E-ARGUMENTO: "document.model" debe ser un objeto.');
  }
  const model = doc.model as Record<string, unknown>;
  if (
    typeof model.id !== 'string' ||
    typeof model.name !== 'string' ||
    typeof model.xml !== 'string' ||
    typeof model.revision !== 'number'
  ) {
    throw new Error('E-ARGUMENTO: "document.model" tiene forma inválida.');
  }
  if (typeof doc.scenarios !== 'object' || doc.scenarios === null || Array.isArray(doc.scenarios)) {
    throw new Error('E-ARGUMENTO: "document.scenarios" debe ser un objeto.');
  }
  if (
    typeof doc.scenarioRevisions !== 'object' ||
    doc.scenarioRevisions === null ||
    Array.isArray(doc.scenarioRevisions)
  ) {
    throw new Error('E-ARGUMENTO: "document.scenarioRevisions" debe ser un objeto.');
  }
  if (!Array.isArray(doc.runs)) {
    throw new Error('E-ARGUMENTO: "document.runs" debe ser un array.');
  }
  for (const run of doc.runs) {
    if (typeof run !== 'object' || run === null) {
      throw new Error('E-ARGUMENTO: cada elemento de "document.runs" debe ser un objeto.');
    }
    const r = run as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.scenarioName !== 'string') {
      throw new Error('E-ARGUMENTO: "document.runs[].id"/"scenarioName" deben ser texto.');
    }
  }
  return doc as unknown as ProjectDocument;
}

/** Valida los nombres de archivo que `document` va a producir antes de tocar el disco. */
function requireSafeFileNames(dir: string, document: ProjectDocument): void {
  for (const name of Object.keys(document.scenarios)) {
    requireFlatName(dir, name, '.scenario.json', `document.scenarios["${name}"]`);
  }
  for (const run of document.runs) {
    requireFlatName(dir, `${run.id}.result.json`, '.result.json', `document.runs[].id (${run.id})`);
  }
}

/** `{}` si `value` es `undefined`; valida forma mínima en cualquier otro caso. */
function requireWriteOptions(dir: string, value: unknown): WriteProjectOptions {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null) {
    throw new Error('E-ARGUMENTO: "options" debe ser un objeto.');
  }
  const opts = value as Record<string, unknown>;
  if (opts.saveAs !== undefined && typeof opts.saveAs !== 'boolean') {
    throw new Error('E-ARGUMENTO: "options.saveAs" debe ser booleano.');
  }
  if (opts.overwrite !== undefined && typeof opts.overwrite !== 'boolean') {
    throw new Error('E-ARGUMENTO: "options.overwrite" debe ser booleano.');
  }
  if (opts.diagramOnly !== undefined && typeof opts.diagramOnly !== 'boolean') {
    throw new Error('E-ARGUMENTO: "options.diagramOnly" debe ser booleano.');
  }
  // Mismo filtro que el `file` de `openRecent`: nombre plano `.bpmn` dentro de la carpeta
  // autorizada (LILA-072). El renderer manda aquí el archivo con el que se abrió el proyecto.
  const modelFile = requireBpmnName(dir, opts.modelFile);
  // `exactOptionalPropertyTypes`: no asignar `undefined` explícito a una propiedad opcional,
  // solo omitirla.
  const result: WriteProjectOptions = {};
  if (typeof opts.saveAs === 'boolean') (result as { saveAs?: boolean }).saveAs = opts.saveAs;
  if (typeof opts.overwrite === 'boolean') (result as { overwrite?: boolean }).overwrite = opts.overwrite;
  if (typeof opts.diagramOnly === 'boolean') (result as { diagramOnly?: boolean }).diagramOnly = opts.diagramOnly;
  if (modelFile !== undefined) (result as { modelFile?: string }).modelFile = modelFile;
  return result;
}

/**
 * `true` si `frame` es el frame principal de `win` (no un `<iframe>` anidado) y su URL es de
 * confianza (`isTrustedSender`, `ipcGuards.ts`). La SPA no usa iframes, así que en la práctica
 * esto solo rechaza un frame `null`/destruido o, en teoría, contenido inyectado en un sub-frame.
 */
function isMainFrameOf(win: BrowserWindow, frame: WebFrameMain | null): boolean {
  if (frame === null) return false;
  if (frame !== win.webContents.mainFrame) return false;
  return isTrustedSender(frame.url, process.env.LILA_DEV_URL);
}

/**
 * Envuelve `ipcMain.handle` para rechazar (`E-ORIGEN`) cualquier mensaje cuyo `event.senderFrame`
 * no sea el frame principal de `win` con una URL de confianza (OP-14, issue #71). Todos los
 * canales de este puente pasan por aquí — ninguno se registra con `ipcMain.handle` directamente.
 */
function guardedHandle(
  win: BrowserWindow,
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!isMainFrameOf(win, event.senderFrame)) {
      throw new Error('E-ORIGEN: mensaje IPC de un origen no confiable.');
    }
    return handler(event, ...args);
  });
}

/** Igual que `guardedHandle`, para canales `ipcMain.on` (sin respuesta) como `lila:setDirty`. */
function guardedOn(
  win: BrowserWindow,
  channel: string,
  handler: (event: IpcMainEvent, ...args: unknown[]) => void,
): void {
  ipcMain.on(channel, (event, ...args: unknown[]) => {
    if (!isMainFrameOf(win, event.senderFrame)) return; // sin respuesta que dar: se ignora.
    handler(event, ...args);
  });
}

// -- Estado de sesión: ventana + recientes (OP-14, incremento 2) -------------------------------
// Un único objeto en memoria, releído al arrancar y reescrito (entero, atómico) cada vez que
// cambia algo — la app es de una sola ventana/proceso, así que no hace falta más que eso.
let sessionState: SessionState = { version: 1, window: null, recents: [], ajustes: {} };

/**
 * The language of the menu and the close dialogs (LILA-213). It is derived from the preference
 * the web app persists (`ajustes.idioma`: `'auto' | 'en' | 'es'`) and, when that says `'auto'`,
 * from `app.getLocale()`. It starts as the base language and is resolved for real in
 * `app.whenReady()`, once `estado.json` has been read; `lila:writeSettings` re-resolves it and
 * rebuilds the menu when the user changes the setting.
 */
let desktopLocale: DesktopLocale = 'en';

/** The active catalog. Call it where the text is built, never at module load. */
function strings(): Strings {
  return desktopStrings(desktopLocale);
}

/** Re-resolves `desktopLocale` from the persisted preference and the system language. */
function resolveLocaleFromSettings(): DesktopLocale {
  return resolveDesktopLocale(sessionState.ajustes.idioma, app.getLocale());
}
const sessionStatePath = path.join(app.getPath('userData'), 'estado.json');

async function persistSessionState(): Promise<void> {
  await writeSessionState(sessionStatePath, sessionState);
}

/** Añade/mueve `dir` al frente de recientes y persiste — llamar tras abrir/crear/guardar con éxito. */
async function recordRecent(dir: string, name: string): Promise<void> {
  sessionState = addRecent(sessionState, { dir, name, openedAt: new Date().toISOString() });
  await persistSessionState();
  refreshMenu();
}

/**
 * `recordRecent` solo si en `dir` hay un `model.bpmn` que reabrir (hallazgos 6 y 9 del QA):
 * recientes guarda CARPETAS y el menú Archivo las reabre por su `model.bpmn`, así que anotar la
 * carpeta de un `.bpmn` suelto prometería un proyecto que no existe (`E-SIN-MODELO` al reabrir).
 * Un proyecto Lila de verdad abierto por su `ventas.bpmn` SÍ entra: su `model.bpmn` sigue ahí y
 * reabrirlo funciona. Comparar el nombre del archivo pedido contra `model.bpmn` no servía: era
 * sensible a mayúsculas y dejaba fuera ese caso legítimo.
 */
async function recordRecentIfProject(dir: string, name: string): Promise<void> {
  if (await hasProjectModel(dir)) await recordRecent(dir, name);
}

/**
 * Menú nativo (plantilla en `menu.ts`): Preferencias… (`CmdOrCtrl+,`), Archivo con Abrir reciente
 * y los aceleradores de guardar/abrir/nuevo. Cada ítem manda su acción al renderer por
 * `lila:menu`; el shell la despacha. Se reconstruye entero cada vez que cambian los recientes y,
 * desde LILA-213, cada vez que cambia el idioma: la barra de menú vive en este proceso, así que
 * no se repinta con el renderer.
 */
function refreshMenu(): void {
  const win = mainWindow;
  const template = menuTemplate(
    sessionState.recents,
    process.platform,
    (action) => {
      if (win !== null && !win.isDestroyed()) win.webContents.send('lila:menu', action);
    },
    strings(),
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Tamaño usado cuando no hay bounds recordados, o los recordados ya no caben en ninguna pantalla. */
const DEFAULT_WINDOW_SIZE = { width: 1280, height: 800 };

let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null;

async function saveBounds(win: BrowserWindow): Promise<void> {
  if (win.isDestroyed()) return;
  const { x, y, width, height } = win.getBounds();
  sessionState = withWindowBounds(sessionState, { x, y, width, height });
  await persistSessionState();
}

/** Debounce simple: varios `move`/`resize` seguidos solo escriben disco una vez, 400 ms después del último. */
function scheduleSaveBounds(win: BrowserWindow): void {
  if (boundsSaveTimer !== null) clearTimeout(boundsSaveTimer);
  boundsSaveTimer = setTimeout(() => void saveBounds(win), 400);
}

function registerIpcHandlers(win: BrowserWindow): void {
  guardedHandle(win, 'lila:chooseFolder', async (_event, soloArchivoArg: unknown): Promise<string | null> => {
    // `true` cuando el renderer pide explícitamente un `.lila` (menú «Abrir proyecto .lila…»).
    const soloArchivo = soloArchivoArg === true;
    if (e2e.folder !== undefined) {
      // Seam E2E (`LILA_E2E_FOLDER`, ver `e2e.ts`): sin diálogo nativo.
      if (e2e.folder === null) {
        await e2eLog('chooseFolder', { result: null });
        return null;
      }
      await mkdir(e2e.folder, { recursive: true });
      const dir = await realpath(e2e.folder);
      authorizedFolders.add(dir);
      await e2eLog('chooseFolder', { result: dir });
      return dir;
    }

    // Un proyecto puede ser una CARPETA (ADR-018) o un `.lila`, que es esa misma carpeta zipeada
    // (ADR-027), así que el diálogo tiene que ofrecer las dos cosas. macOS es el único sistema
    // cuyo diálogo nativo permite de verdad elegir archivo O carpeta en el mismo panel; en
    // Windows y Linux, Electron ignora `openFile` cuando también se pide `openDirectory` y solo
    // deja elegir carpetas. Por eso el menú Archivo lleva además «Abrir proyecto .lila…»
    // (`menu.ts`, acción `abrirArchivo`), que abre este mismo diálogo SIN `openDirectory`: es la
    // única forma de abrir un `.lila` fuera de macOS, y en macOS tampoco estorba.
    const result = await dialog.showOpenDialog(win, {
      properties: soloArchivo
        ? ['openFile']
        : process.platform === 'darwin'
          ? ['openFile', 'openDirectory', 'createDirectory']
          : ['openDirectory', 'createDirectory'],
      filters: [{ name: 'Lila Modeler Project', extensions: ['lila'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    // `realpath`, no la ruta cruda del diálogo: la carpeta autorizada queda anclada a su
    // identidad real desde el principio (issue #71, "la carpeta autorizada se guarda como
    // fs.realpath"), y `requireAuthorizedDir` puede volver a comprobarla más tarde sin ambigüedad.
    const dir = await realpath(result.filePaths[0]!);
    authorizedFolders.add(dir);
    return dir;
  });

  /**
   * «Guardar como» hacia un `.lila` NUEVO (ADR-027, hallazgo 4 del QA a #323). `chooseFolder` solo
   * abre `showOpenDialog`, que en el mejor de los casos (macOS) deja elegir un `.lila` que YA
   * existe: no había forma de crear uno. Lo que se autoriza es el `realpath` de la carpeta
   * contenedora —el archivo todavía no existe, así que no tiene `realpath` propio— más el archivo
   * dentro de ella, que es lo que `requireAuthorizedDir` va a recibir después en
   * `readProject`/`writeProject`, igual que hace `acceptOpenPath` con un `.lila` abierto por doble
   * clic.
   */
  guardedHandle(win, 'lila:chooseSaveFile', async (_event, defaultPathArg: unknown): Promise<string | null> => {
    const defaultPath = typeof defaultPathArg === 'string' && defaultPathArg.length > 0 ? defaultPathArg : undefined;
    let chosen: string;
    if (e2e.saveFile !== undefined) {
      // Seam E2E (`LILA_E2E_SAVE_FILE`, ver `e2e.ts`): sin diálogo nativo.
      if (e2e.saveFile === null) {
        await e2eLog('chooseSaveFile', { result: null });
        return null;
      }
      await mkdir(path.dirname(e2e.saveFile), { recursive: true });
      chosen = e2e.saveFile;
    } else {
      const result = await dialog.showSaveDialog(win, {
        filters: [{ name: 'Lila project', extensions: ['lila'] }],
        ...(defaultPath === undefined ? {} : { defaultPath }),
      });
      if (result.canceled || result.filePath === undefined || result.filePath.length === 0) return null;
      chosen = result.filePath;
    }
    const file = withLilaExtension(chosen);
    const dir = await realpath(path.dirname(file));
    const real = path.join(dir, path.basename(file));
    authorizedFolders.add(real);
    await e2eLog('chooseSaveFile', { result: real });
    return real;
  });

  guardedHandle(win, 'lila:readProject', async (_event, dirArg: unknown) => {
    const dir = await requireAuthorizedDir(dirArg);
    try {
      // Un `.lila` es un proyecto entero en un archivo (ADR-027): mismo documento, misma respuesta
      // IPC, otro contenedor. Lo decide la extensión de la ruta ya autorizada, no un argumento
      // nuevo del puente — el renderer guarda esa ruta y la devuelve tal cual al guardar.
      const { document, problems, loose } = isLilaPath(dir)
        ? await readLilaFile(dir)
        : await readProjectFolder(dir);
      await recordRecent(dir, document.name);
      return { ...document, problems, loose };
    } catch (error) {
      if (error instanceof ProjectIOError) throw new Error(`${error.code}: ${error.message}`);
      throw error;
    }
  });

  guardedHandle(
    win,
    'lila:writeProject',
    async (_event, dirArg: unknown, documentArg: unknown, optionsArg: unknown): Promise<void> => {
      const dir = await requireAuthorizedDir(dirArg);
      const document = requireProjectDocument(documentArg);
      const options = requireWriteOptions(dir, optionsArg);
      requireSafeFileNames(dir, document);
      try {
        // Mismas `options` que el escritor de carpeta: un `.lila` se guarda con las mismas
        // guardias (`E-CARPETA-OCUPADA`, `E-CAMBIO-EXTERNO`), no con menos (ADR-027).
        if (isLilaPath(dir)) await writeLilaFile(dir, document, options);
        else await writeProjectFolder(dir, document, options);
        // Solo se anota lo que se puede reabrir desde recientes; guardar un diagrama suelto no
        // convierte `~/Descargas` en un proyecto (ver `recordRecentIfProject`).
        await recordRecentIfProject(dir, document.name);
        await e2eLog('writeProject', { dir, ok: true });
      } catch (error) {
        if (error instanceof ProjectIOError) {
          await e2eLog('writeProject', { dir, ok: false, code: error.code });
          throw new Error(`${error.code}: ${error.message}`);
        }
        await e2eLog('writeProject', { dir, ok: false, code: null });
        throw error;
      }
    },
  );

  guardedOn(win, 'lila:setDirty', (_event, value: unknown) => {
    if (typeof value === 'boolean') setDirty(value);
  });

  guardedHandle(win, 'lila:listRecents', async (): Promise<readonly Recent[]> => sessionState.recents);

  // Apariencia (LILA-113): el renderer lee al arrancar y escribe cada vez que el usuario cambia
  // tema o densidad. `parseAjustes` descarta lo que no sea texto en una clave conocida, así que
  // por aquí no entra nada raro en `estado.json` aunque el renderer se equivoque.
  guardedHandle(win, 'lila:readSettings', async (): Promise<Ajustes> => sessionState.ajustes);

  guardedHandle(win, 'lila:writeSettings', async (_event, value: unknown): Promise<void> => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('E-ARGUMENTO: "ajustes" debe ser un objeto.');
    }
    sessionState = withAjustes(sessionState, parseAjustes(value));
    // Language (LILA-213): the native menu is painted by THIS process, so it does not repaint on
    // its own when the renderer changes language. If the preference just saved resolves to a
    // language other than the one on screen, the whole menu is rebuilt with the new catalog.
    const siguiente = resolveLocaleFromSettings();
    if (siguiente !== desktopLocale) {
      desktopLocale = siguiente;
      refreshMenu();
    }
    await persistSessionState();
  });

  guardedHandle(win, 'lila:openRecent', async (_event, dirArg: unknown, fileArg: unknown) => {
    if (typeof dirArg !== 'string' || dirArg.length === 0) {
      throw new Error('E-ARGUMENTO: "dir" debe ser una ruta de texto no vacía.');
    }
    // A diferencia de `readProject`, `dir` viene de `recents` (persistido entre arranques), no de
    // `authorizedFolders` (en memoria, vacío al arrancar) — por eso se re-autoriza aquí en vez de
    // pasar por `requireAuthorizedDir`. Si ya no existe, se quita de recientes y se informa `null`
    // (no es un error: la carpeta pudo borrarse o moverse fuera de la app).
    let real: string;
    try {
      real = await realpath(dirArg);
    } catch {
      sessionState = removeRecent(sessionState, dirArg);
      await persistSessionState();
      refreshMenu();
      return null;
    }
    authorizedFolders.add(real);
    if (isLilaPath(real)) {
      // El `file` del puente nombra el `.bpmn` a abrir dentro de una CARPETA; un `.lila` no tiene
      // carpeta que recorrer, así que se ignora (`acceptOpenPath` manda el propio nombre del
      // archivo, que no es un `.bpmn` y `requireBpmnName` rechazaría).
      try {
        const { document, problems, loose } = await readLilaFile(real);
        await recordRecent(real, document.name);
        return { ...document, problems, loose };
      } catch (error) {
        if (error instanceof ProjectIOError) throw new Error(`${error.code}: ${error.message}`);
        throw error;
      }
    }
    const file = requireBpmnName(real, fileArg);
    try {
      const { document, problems, loose } = await readProjectFolder(real, file);
      await recordRecentIfProject(real, document.name);
      return { ...document, problems, loose };
    } catch (error) {
      if (error instanceof ProjectIOError) throw new Error(`${error.code}: ${error.message}`);
      throw error;
    }
  });

  guardedHandle(win, 'lila:pendingOpenPath', async (): Promise<OpenPathRequest | null> => {
    // Que el renderer pida la ruta pendiente ES la prueba de que ya está vivo y suscrito a
    // `lila:open-path` (`App.tsx` registra `onOpenPath` en la misma pasada). `did-finish-load`
    // llega DESPUÉS de esto (es el `load` de la página, tras sus subrecursos), así que sin esta
    // línea queda una rendija: una ruta que llegue entre esta llamada y `did-finish-load`
    // —`second-instance` de Windows contra una ventana recién arrancada— se guardaría en
    // `pendingOpen` cuando ya nadie va a volver a pedirlo, y se perdería en silencio.
    windowLoaded = true;
    const result = pendingOpen;
    pendingOpen = null; // se consume una vez.
    return result;
  });
}

function registerLilaProtocol(): void {
  protocol.handle('lila', async (request) => {
    let pathname: string;
    try {
      pathname = new URL(request.url).pathname;
    } catch {
      return new Response('No encontrado', { status: 404 });
    }
    if (pathname === '' || pathname === '/') pathname = '/index.html';
    const rel = pathname.replace(/^\/+/, '');

    let filePath: string;
    try {
      filePath = resolveWithin(webRoot, rel);
    } catch (error) {
      if (error instanceof PathEscapeError) return new Response('No encontrado', { status: 404 });
      throw error;
    }

    try {
      const data = await readFile(filePath);
      return new Response(new Uint8Array(data), {
        headers: { 'Content-Type': mimeFor(filePath), 'Content-Security-Policy': CSP },
      });
    } catch {
      return new Response('No encontrado', { status: 404 });
    }
  });
}

// -- Apertura de .bpmn: arranque frío y segunda apertura (OP-14, incremento 2, aceptación de
// OP-12 "arranque frío y segunda apertura") -----------------------------------------------------
/** La ventana principal, para reenviar `lila:open-path` cuando ya está lista; `null` antes de crearla. */
let mainWindow: BrowserWindow | null = null;
/** Ruta `.bpmn` capturada antes de que la ventana pudiera recibirla; `pendingOpenPath()` la consume una vez. */
let pendingOpen: OpenPathRequest | null = null;
/**
 * `true` desde que la ventana terminó de cargar su página. `mainWindow !== null` NO basta para
 * mandar `lila:open-path`: en el arranque en frío por argv (Windows/Linux) la ruta se acepta entre
 * `createWindow` y `loadURL`, cuando ya hay ventana pero ningún renderer suscrito, y el `send` se
 * perdería sin dejar nada en `pendingOpen` (hallazgo 2 del QA a LILA-072/074).
 */
let windowLoaded = false;

/**
 * Acepta `filePath` como ".bpmn a abrir" si termina en `.bpmn` y existe: autoriza su carpeta
 * contenedora (`realpath`, igual que `chooseFolder`) y, si la ventana ya tiene su página cargada,
 * se lo envía de inmediato (`lila:open-path`); si no, lo deja en `pendingOpen` para que el
 * renderer lo pida con `pendingOpenPath()` al montar. Una ruta que no exista o no sea `.bpmn` se
 * ignora en silencio (no es un error del usuario: puede ser cualquier argumento de línea de
 * comandos que no nos interesa).
 */
async function acceptOpenPath(filePath: string): Promise<void> {
  if (!isBpmnPath(filePath) && !isLilaPath(filePath)) return;
  try {
    await stat(filePath);
  } catch {
    return;
  }
  // Un `.lila` ES el proyecto: lo que se autoriza y se manda al renderer es el archivo, no su
  // carpeta (que puede ser `~/Descargas` entera). Un `.bpmn` sigue autorizando su carpeta, que es
  // donde viven el manifiesto, los escenarios y las corridas.
  const dir = isLilaPath(filePath) ? await realpath(filePath) : await realpath(path.dirname(filePath));
  authorizedFolders.add(dir);
  const request: OpenPathRequest = { dir, file: path.basename(filePath) };
  if (process.env.LILA_DEBUG === '1') {
    console.log(`[lila] ruta .bpmn aceptada: ${JSON.stringify(request)}`);
  }
  await e2eLog('openPath', request);
  if (windowLoaded && mainWindow !== null && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('lila:open-path', request);
  } else {
    pendingOpen = request;
  }
}

// `open-file` (macOS) puede llegar antes de `app.whenReady()` (doble clic en un `.bpmn` con la app
// cerrada) — hay que registrar el listener ya, a nivel de módulo, no dentro de `whenReady().then`.
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  void acceptOpenPath(filePath);
});

// Segunda apertura con la app ya corriendo (Windows/Linux: doble clic en un `.bpmn` lanza una
// segunda instancia; también cubre "abrir con..." en macOS tras el primer lanzamiento). Sin el
// lock, cada doble clic abriría una ventana nueva en vez de reusar la existente.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const bpmnArg = findBpmnArg(argv, 1); // `argv` de `second-instance` no incluye el propio ejecutable... salvo que sí (varía por SO); 1 cubre el caso común sin falsos negativos graves si no hay match.
    if (bpmnArg !== null) void acceptOpenPath(bpmnArg);
    if (mainWindow !== null) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// -- Cierre con cambios sin guardar (OP-14, issue #74) -----------------------------------------
// `dirty` es el único estado de sesión que main necesita para decidir si intercepta el cierre;
// el resto (guardar de verdad) vive en el renderer, vía el callback que registra
// `onSaveRequested`/`lila:close-requested`.
let dirty = false;
/** `true` tras decidir que la app debe cerrar de verdad: evita volver a interceptar el segundo intento. */
let allowQuit = false;

function setDirty(value: boolean): void {
  dirty = value;
}

/** Cuánto se espera la respuesta del renderer a `lila:close-requested` antes de dar por fallido el guardado. */
const CLOSE_SAVE_TIMEOUT_MS = 30_000;

/**
 * Pide al renderer que guarde (`lila:close-requested`) y espera su respuesta
 * (`lila:close-response`, `{ saved: SaveOutcome }`) hasta `CLOSE_SAVE_TIMEOUT_MS`. Sin respuesta a
 * tiempo se trata como fallo (`saved: "failed"`), igual que pide el ticket.
 */
function requestRendererSave(win: BrowserWindow): Promise<SaveOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (saved: SaveOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('lila:close-response', onResponse);
      resolve(saved);
    };
    const onResponse = (event: IpcMainEvent, payload: unknown): void => {
      if (!isMainFrameOf(win, event.senderFrame)) return;
      const saved = readSaveOutcome(payload);
      finish(saved);
    };
    const timer = setTimeout(() => finish('failed'), CLOSE_SAVE_TIMEOUT_MS);
    ipcMain.on('lila:close-response', onResponse);
    win.webContents.send('lila:close-requested');
  });
}

/**
 * Diálogo nativo Guardar/Descartar/Cancelar y, según la elección, pide guardar al renderer.
 * Devuelve `true` si la ventana debe cerrar (`decideClose`, `closeGuard.ts`).
 */
async function confirmClose(win: BrowserWindow): Promise<boolean> {
  let choice: CloseChoice;
  if (e2e.close !== undefined) {
    // Seam E2E (`LILA_E2E_CLOSE`, ver `e2e.ts`): sin diálogo nativo.
    choice = e2e.close;
  } else {
    const result = await dialog.showMessageBox(win, closeDialogOptions(strings()));
    choice = result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel';
  }

  let saved: SaveOutcome | null = null;
  if (choice === 'save') {
    saved = await requestRendererSave(win);
  }

  const decision = decideClose(true, choice, saved);
  await e2eLog('closeRequested', { choice, saved, decision });
  if (decision === 'close') {
    dirty = false;
    return true;
  }
  const notice = saved === null ? null : saveOutcomeDialogOptions(saved, strings());
  if (notice !== null && e2e.close === undefined) {
    await dialog.showMessageBox(win, notice);
  }
  return false;
}

function attachCloseGuard(win: BrowserWindow): void {
  win.on('close', (event) => {
    if (!dirty) return; // sin cambios: cierra normalmente.
    event.preventDefault();
    void confirmClose(win).then((shouldClose) => {
      if (shouldClose) win.close(); // `dirty` ya es `false`: esta vez pasa de largo.
    });
  });

  // Cmd+Q / "Salir" en macOS: `before-quit` se dispara antes de cerrar cualquier ventana, así que
  // sin este handler el diálogo de `win.on('close')` de arriba nunca llegaría a mostrarse.
  app.on('before-quit', (event) => {
    if (allowQuit || !dirty) return;
    event.preventDefault();
    void confirmClose(win).then((shouldClose) => {
      if (shouldClose) {
        allowQuit = true;
        app.quit();
      }
    });
  });
}

function createWindow(show: boolean, bounds: WindowBounds | null): BrowserWindow {
  const win = new BrowserWindow({
    ...(bounds ?? DEFAULT_WINDOW_SIZE),
    show,
    webPreferences: {
      // `.cjs`: un preload sandboxeado no admite ESM (ni con `.mjs` — el `import` revienta con
      // "Cannot use import statement outside a module", verificado en el smoke de este
      // ticket); `preload.cts` (ver `src/preload.cts`, NodeNext) compila a CommonJS de verdad.
      preload: path.join(app.getAppPath(), 'dist', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Bloquea siempre `window.open`/enlaces `target=_blank`; los http(s) se abren en el
  // navegador del sistema en vez de crear una `BrowserWindow` sin las mismas protecciones.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Cualquier navegación (barra de direcciones no existe, pero sí `<a href>`/redirects/JS) que no
  // sea la propia app o el dev server declarado se bloquea (OP-14, issue #71, punto 3). Los
  // enlaces http(s) legítimos ya se abren fuera vía `setWindowOpenHandler`; esto cierra el resto.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedSender(url, process.env.LILA_DEV_URL)) event.preventDefault();
  });

  // Guardar bounds al mover/redimensionar (debounce simple) y al cerrar (sin debounce: puede ser
  // lo último que se ejecute antes de que el proceso termine).
  win.on('move', () => scheduleSaveBounds(win));
  win.on('resize', () => scheduleSaveBounds(win));
  win.on('close', () => {
    if (boundsSaveTimer !== null) clearTimeout(boundsSaveTimer);
    void saveBounds(win);
  });
  // A partir de aquí el renderer existe y `lila:open-path` llega a alguien (ver `windowLoaded`).
  win.webContents.on('did-finish-load', () => {
    if (mainWindow === win) windowLoaded = true;
  });
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
      windowLoaded = false;
    }
  });

  return win;
}

interface SmokeChecks {
  lienzo: boolean;
  tema: boolean;
  fuente: boolean;
  puente: boolean;
}

async function runSmoke(win: BrowserWindow, loadPromise: Promise<void>): Promise<void> {
  const consoleErrors: string[] = [];
  let loadFailure: { errorCode: number; errorDescription: string } | null = null;

  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(event.message);
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    loadFailure = { errorCode, errorDescription };
  });

  try {
    await loadPromise;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: String(error) }));
    app.exit(1);
    return;
  }

  // bpmn-js monta el lienzo después de resolver el tema por fetch; hasta 3 s de margen.
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const checks = (await win.webContents.executeJavaScript(`(() => ({
    lienzo: !!document.querySelector('.djs-container'),
    tema: document.documentElement.style.getPropertyValue('--bg-base') !== '',
    fuente: document.fonts.check('12px bpmn'),
    puente: typeof window.lila === 'object' && window.lila !== null && window.lila.platform === 'desktop',
  }))()`)) as SmokeChecks;

  const smokeDir = process.env.LILA_SMOKE_DIR ?? path.join(app.getPath('temp'), 'lila-smoke');
  await mkdir(smokeDir, { recursive: true });
  const image = await win.webContents.capturePage();
  await writeFile(path.join(smokeDir, 'captura.png'), image.toPNG());

  const ok =
    checks.lienzo &&
    checks.tema &&
    checks.fuente &&
    checks.puente &&
    consoleErrors.length === 0 &&
    loadFailure === null;

  console.log(JSON.stringify({ ...checks, consoleErrors, loadFailure, ok }));
  app.exit(ok ? 0 : 1);
}

app.whenReady().then(async () => {
  registerLilaProtocol();

  sessionState = await readSessionState(sessionStatePath);
  // The shell's language (LILA-213), before the menu is built: the persisted preference wins and,
  // when it says `auto` (or there is none), the system language decides. `app.getLocale()` can
  // only be read with the app ready, which is exactly where we are.
  desktopLocale = resolveLocaleFromSettings();
  // Restaurar bounds guardados solo si caben en alguna pantalla conectada ahora mismo — un
  // portátil que se desconectó de un monitor externo, por ejemplo, no debe abrir la ventana fuera
  // de la pantalla visible.
  const savedBounds = sessionState.window;
  const bounds =
    savedBounds !== null && fitsAnyDisplay(savedBounds, screen.getAllDisplays().map((d) => d.bounds))
      ? savedBounds
      : null;

  const isSmoke = process.env.LILA_SMOKE === '1';
  const win = createWindow(!isSmoke, bounds);
  mainWindow = win;
  registerIpcHandlers(win);
  refreshMenu();
  if (!isSmoke) attachCloseGuard(win);

  // `.bpmn` como argumento de línea de comandos (Windows/Linux): sin empaquetar, `argv[0]` es el
  // binario de Electron y `argv[1]` la carpeta de la app (`electron apps/desktop [...]`);
  // empaquetada, `argv[0]` ya es el ejecutable de Lila Modeler.
  const bpmnArg = findBpmnArg(process.argv, app.isPackaged ? 1 : 2);
  if (bpmnArg !== null) await acceptOpenPath(bpmnArg);

  const devUrl = process.env.LILA_DEV_URL;
  const loadPromise = devUrl ? win.loadURL(devUrl) : win.loadURL('lila://app/index.html');

  if (isSmoke) {
    await runSmoke(win, loadPromise);
    return;
  }

  await loadPromise;
});

// Esta beta tiene una sola ventana: cerrar termina la sesión también en macOS.
// Las guardias de dirty ya se resolvieron antes de window-all-closed; al volver a
// abrir desde Finder se crea una sesión nueva con sus handlers IPC propios.
app.on('window-all-closed', () => {
  app.quit();
});
