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
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { mimeFor, PathEscapeError, resolveWithin } from './safePaths.js';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'lila',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

/** Raíz de la SPA compilada: `apps/desktop/dist/web` (ver `scripts/copy-web.mjs`). */
const webRoot = path.join(app.getAppPath(), 'dist', 'web');

/** Carpetas que el usuario autorizó explícitamente vía `openFolder` (diálogo nativo). */
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

function requireRelativeWithin(dir: string, rel: unknown): string {
  if (typeof rel !== 'string' || rel.length === 0) {
    throw new Error('E-ARGUMENTO: "rel" debe ser una ruta de texto no vacía.');
  }
  try {
    return resolveWithin(dir, rel);
  } catch (error) {
    if (error instanceof PathEscapeError) {
      throw new Error('E-RUTA-FUERA: la ruta resuelve fuera de la carpeta autorizada.');
    }
    throw error;
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('lila:openFolder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const dir = result.filePaths[0]!;
    authorizedFolders.add(dir);
    return dir;
  });

  ipcMain.handle('lila:listFiles', async (_event, dirArg: unknown): Promise<string[]> => {
    const dir = requireAuthorizedDir(dirArg);
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  });

  ipcMain.handle('lila:readFile', async (_event, dirArg: unknown, relArg: unknown): Promise<string> => {
    const dir = requireAuthorizedDir(dirArg);
    const target = requireRelativeWithin(dir, relArg);
    return readFile(target, 'utf8');
  });

  ipcMain.handle(
    'lila:writeFile',
    async (_event, dirArg: unknown, relArg: unknown, contentArg: unknown): Promise<void> => {
      const dir = requireAuthorizedDir(dirArg);
      const target = requireRelativeWithin(dir, relArg);
      if (typeof contentArg !== 'string') {
        throw new Error('E-ARGUMENTO: "content" debe ser texto.');
      }
      await writeFile(target, contentArg, 'utf8');
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
