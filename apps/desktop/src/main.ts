/**
 * Proceso main de OP-02. Decisiones ya tomadas (ver ticket y checkpoint):
 *
 * - Producción sirve la SPA compilada por un protocolo propio (`lila://`), no `file://`: así
 *   `fetch('/eva-01.json')`, `/assets/*`, las fuentes bpmn y el Worker módulo funcionan con
 *   rutas absolutas sin tocar `apps/web/vite.config.ts`.
 * - En dev, si `LILA_DEV_URL` está definida, la ventana carga esa URL (el dev server de Vite);
 *   si no, carga el protocolo — así este proceso nunca depende de que Vite esté corriendo.
 * - Ventana endurecida: `contextIsolation`, `sandbox`, sin `nodeIntegration`, sin `remote`;
 *   `window.open` se bloquea siempre, los enlaces http(s) se abren con `shell.openExternal`.
 * - El puente `window.lila` vive en `preload.ts`/`bridge.ts`; aquí solo se validan argumentos y
 *   se autorizan carpetas elegidas por diálogo antes de tocar el disco.
 */
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ProjectIOError, readProjectFolder, writeProjectFolder } from './projectIO.js';
import type { ProjectDocument } from './projectTypes.js';
import { mimeFor, PathEscapeError, resolveWithin } from './safePaths.js';

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

function requireAuthorizedDir(dir: unknown): string {
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new Error('E-ARGUMENTO: "dir" debe ser una ruta de texto no vacía.');
  }
  if (!authorizedFolders.has(dir)) {
    throw new Error('E-NO-AUTORIZADO: la carpeta no fue autorizada por un diálogo.');
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

function registerIpcHandlers(): void {
  ipcMain.handle('lila:chooseFolder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const dir = result.filePaths[0]!;
    authorizedFolders.add(dir);
    return dir;
  });

  ipcMain.handle('lila:readProject', async (_event, dirArg: unknown) => {
    const dir = requireAuthorizedDir(dirArg);
    try {
      const { document, problems } = await readProjectFolder(dir);
      return { ...document, problems };
    } catch (error) {
      if (error instanceof ProjectIOError) throw new Error(`${error.code}: ${error.message}`);
      throw error;
    }
  });

  ipcMain.handle(
    'lila:writeProject',
    async (_event, dirArg: unknown, documentArg: unknown): Promise<void> => {
      const dir = requireAuthorizedDir(dirArg);
      const document = requireProjectDocument(documentArg);
      requireSafeFileNames(dir, document);
      try {
        await writeProjectFolder(dir, document);
      } catch (error) {
        if (error instanceof ProjectIOError) throw new Error(`${error.code}: ${error.message}`);
        throw error;
      }
    },
  );
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
        headers: { 'Content-Type': mimeFor(filePath) },
      });
    } catch {
      return new Response('No encontrado', { status: 404 });
    }
  });
}

function createWindow(show: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
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
  registerIpcHandlers();

  const isSmoke = process.env.LILA_SMOKE === '1';
  const win = createWindow(!isSmoke);

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
