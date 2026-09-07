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
import { app, BrowserWindow, dialog, ipcMain, protocol, screen, shell } from 'electron';
import type { IpcMainEvent, IpcMainInvokeEvent, WebFrameMain } from 'electron';
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { OpenPathRequest, Recent } from './bridge.js';
import { decideClose, type CloseChoice } from './closeGuard.js';
import { isTrustedSender } from './ipcGuards.js';
import { findBpmnArg, isBpmnPath } from './openPath.js';
import { ProjectIOError, readProjectFolder, writeProjectFolder, type WriteProjectOptions } from './projectIO.js';
import type { ProjectDocument } from './projectTypes.js';
import { mimeFor, PathEscapeError, resolveWithin } from './safePaths.js';
import {
  addRecent,
  fitsAnyDisplay,
  readSessionState,
  removeRecent,
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
 * Valida que `name` sea un nombre de archivo plano (sin `/`, sin `\`, sin `..`) terminado en
 * `suffix`, y que además resuelva dentro de `dir` (defensa en profundidad además de la forma:
 * un nombre sin barras ya no puede escaparse, pero `resolveWithin` es la misma comprobación que
 * usa el resto del puente y cuesta cero repetirla aquí).
 */
function requireFlatName(dir: string, name: unknown, suffix: string, label: string): string {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..') ||
    !name.endsWith(suffix)
  ) {
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
function requireWriteOptions(value: unknown): WriteProjectOptions {
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
  // `exactOptionalPropertyTypes`: no asignar `undefined` explícito a una propiedad opcional,
  // solo omitirla.
  const result: WriteProjectOptions = {};
  if (typeof opts.saveAs === 'boolean') (result as { saveAs?: boolean }).saveAs = opts.saveAs;
  if (typeof opts.overwrite === 'boolean') (result as { overwrite?: boolean }).overwrite = opts.overwrite;
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
let sessionState: SessionState = { version: 1, window: null, recents: [] };
const sessionStatePath = path.join(app.getPath('userData'), 'estado.json');

async function persistSessionState(): Promise<void> {
  await writeSessionState(sessionStatePath, sessionState);
}

/** Añade/mueve `dir` al frente de recientes y persiste — llamar tras abrir/crear/guardar con éxito. */
async function recordRecent(dir: string, name: string): Promise<void> {
  sessionState = addRecent(sessionState, { dir, name, openedAt: new Date().toISOString() });
  await persistSessionState();
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
  guardedHandle(win, 'lila:chooseFolder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    // `realpath`, no la ruta cruda del diálogo: la carpeta autorizada queda anclada a su
    // identidad real desde el principio (issue #71, "la carpeta autorizada se guarda como
    // fs.realpath"), y `requireAuthorizedDir` puede volver a comprobarla más tarde sin ambigüedad.
    const dir = await realpath(result.filePaths[0]!);
    authorizedFolders.add(dir);
    return dir;
  });

  guardedHandle(win, 'lila:readProject', async (_event, dirArg: unknown) => {
    const dir = await requireAuthorizedDir(dirArg);
    try {
      const { document, problems } = await readProjectFolder(dir);
      await recordRecent(dir, document.name);
      return { ...document, problems };
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
      const options = requireWriteOptions(optionsArg);
      requireSafeFileNames(dir, document);
      try {
        await writeProjectFolder(dir, document, options);
        await recordRecent(dir, document.name);
      } catch (error) {
        if (error instanceof ProjectIOError) throw new Error(`${error.code}: ${error.message}`);
        throw error;
      }
    },
  );

  guardedOn(win, 'lila:setDirty', (_event, value: unknown) => {
    if (typeof value === 'boolean') setDirty(value);
  });

  guardedHandle(win, 'lila:listRecents', async (): Promise<readonly Recent[]> => sessionState.recents);

  guardedHandle(win, 'lila:openRecent', async (_event, dirArg: unknown) => {
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
      return null;
    }
    authorizedFolders.add(real);
    try {
      const { document, problems } = await readProjectFolder(real);
      await recordRecent(real, document.name);
      return { ...document, problems };
    } catch (error) {
      if (error instanceof ProjectIOError) throw new Error(`${error.code}: ${error.message}`);
      throw error;
    }
  });

  guardedHandle(win, 'lila:pendingOpenPath', async (): Promise<OpenPathRequest | null> => {
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
/** Ruta `.bpmn` capturada antes de que `mainWindow` existiera; `pendingOpenPath()` la consume una vez. */
let pendingOpen: OpenPathRequest | null = null;

/**
 * Acepta `filePath` como ".bpmn a abrir" si termina en `.bpmn` y existe: autoriza su carpeta
 * contenedora (`realpath`, igual que `chooseFolder`) y, si la ventana ya está lista, se lo envía
 * de inmediato (`lila:open-path`); si no, lo deja en `pendingOpen` para `pendingOpenPath()`. Una
 * ruta que no exista o no sea `.bpmn` se ignora en silencio (no es un error del usuario: puede ser
 * cualquier argumento de línea de comandos que no nos interesa).
 */
async function acceptOpenPath(filePath: string): Promise<void> {
  if (!isBpmnPath(filePath)) return;
  try {
    await stat(filePath);
  } catch {
    return;
  }
  const dir = await realpath(path.dirname(filePath));
  authorizedFolders.add(dir);
  const request: OpenPathRequest = { dir, file: path.basename(filePath) };
  if (process.env.LILA_DEBUG === '1') {
    console.log(`[lila] ruta .bpmn aceptada: ${JSON.stringify(request)}`);
  }
  if (mainWindow !== null && !mainWindow.isDestroyed()) {
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
 * (`lila:close-response`, `{ saved: boolean }`) hasta `CLOSE_SAVE_TIMEOUT_MS`. Sin respuesta a
 * tiempo se trata como fallo (`saved: false`), igual que pide el ticket.
 */
function requestRendererSave(win: BrowserWindow): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (saved: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ipcMain.removeListener('lila:close-response', onResponse);
      resolve(saved);
    };
    const onResponse = (event: IpcMainEvent, payload: unknown): void => {
      if (!isMainFrameOf(win, event.senderFrame)) return;
      const saved = typeof payload === 'object' && payload !== null && (payload as { saved?: unknown }).saved === true;
      finish(saved);
    };
    const timer = setTimeout(() => finish(false), CLOSE_SAVE_TIMEOUT_MS);
    ipcMain.on('lila:close-response', onResponse);
    win.webContents.send('lila:close-requested');
  });
}

/**
 * Diálogo nativo Guardar/Descartar/Cancelar y, según la elección, pide guardar al renderer.
 * Devuelve `true` si la ventana debe cerrar (`decideClose`, `closeGuard.ts`).
 */
async function confirmClose(win: BrowserWindow): Promise<boolean> {
  const result = await dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Guardar', 'Descartar', 'Cancelar'],
    defaultId: 0,
    cancelId: 2,
    message: 'Hay cambios sin guardar.',
    detail: '¿Quieres guardar los cambios antes de cerrar?',
  });
  const choice: CloseChoice = result.response === 0 ? 'save' : result.response === 1 ? 'discard' : 'cancel';

  let saved: boolean | null = null;
  if (choice === 'save') {
    saved = await requestRendererSave(win);
  }

  const decision = decideClose(true, choice, saved);
  if (decision === 'close') {
    dirty = false;
    return true;
  }
  if (choice === 'save' && saved !== true) {
    await dialog.showMessageBox(win, {
      type: 'error',
      message: 'No se pudo guardar.',
      detail: 'El cierre se canceló para no perder cambios. Vuelve a intentar guardar manualmente.',
    });
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
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
