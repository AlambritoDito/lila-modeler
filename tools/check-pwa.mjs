/**
 * Checks the installable web app (#576, ADR-031) in headless Chrome over the DevTools Protocol,
 * before a person tries it on Windows (docs/WINDOWS-PWA-TESTER-GUIDE.md). Nothing but Node's
 * built-in WebSocket, like `tools/e2e-lila.mjs`.
 *
 * On the Pages build (`_site`, served at `/lila-modeler/app/`):
 *   1. `Page.getAppManifest` reports no errors, and the manifest has 192, 512 and maskable icons
 *      that load, `start_url` inside `scope`, `display: standalone` and a `.lila` file handler.
 *   2. `Page.getInstallabilityErrors` is empty: Chrome and Edge would offer «Install».
 *   3. The service worker (#574) controls the page after a reload, with the cache of this version.
 *   4. Save writes back to the file Open chose (#573): the File System Access pickers are replaced
 *      by a real handle in the origin-private file system, so the bytes and the modification time
 *      of that very file are checked, and no download happens.
 *   5. Offline: with the static server stopped, a reload still opens the editor.
 *
 *   npm run build:pages && npm run check:pwa
 *
 * `LILA_E2E_PORT`, `LILA_E2E_CDP_PORT` and `CHROME_PATH` as in `tools/e2e-lila.mjs`. Prints a
 * JSON report and exits non-zero on the first failed expectation. What it cannot do is the part a
 * person does: install from the address bar, double-click a `.lila` in Explorer, the system dialogs.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeLila, encodeLila } from '@lila-modeler/engine/project';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SITE = join(ROOT, '_site');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.LILA_E2E_PORT ?? 8788);
const CDP_PORT = Number(process.env.LILA_E2E_CDP_PORT ?? 9334);
const BASE = `http://127.0.0.1:${PORT}/lila-modeler/app/`;
const VERSION = JSON.parse(readFileSync(join(ROOT, 'apps/web/package.json'), 'utf8')).version;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.bpmn': 'application/xml',
};

const report = {};
const failures = {};
function check(name, ok, detail) {
  (ok ? report : failures)[name] = detail ?? ok;
  if (!ok) console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
}

/** `_site` mounted under `/lila-modeler/`; `stop()` also drops keep-alive sockets (offline). */
function serve() {
  const sockets = new Set();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/lila-modeler/')) return void res.writeHead(404).end();
    let file = join(SITE, decodeURIComponent(url.pathname.slice('/lila-modeler/'.length)));
    if (!file.startsWith(SITE)) return void res.writeHead(403).end();
    if (existsSync(file) && !extname(file)) file = join(file, 'index.html');
    if (!existsSync(file)) return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok({
    stop: () => new Promise((done) => { server.close(() => done()); for (const s of sockets) s.destroy(); }),
  })));
}

let nextId = 1;
function connect(ws) {
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id === undefined) return;
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`));
    else entry.resolve(msg.result);
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!existsSync(join(SITE, 'app/sw.js'))) throw new Error('_site/app is missing or stale: run `npm run build:pages` first.');
  const work = mkdtempSync(join(tmpdir(), 'lila-pwa-'));
  const downloads = join(work, 'downloads');
  mkdirSync(downloads);
  const server = await serve();
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(work, 'profile')}`,
    '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); break; } catch { await sleep(250); }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  const cdp = connect(ws);

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true, userGesture: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    };
    const waitFor = async (expression, what, timeout = 60_000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { if (await evaluate(expression).catch(() => false)) return true; await sleep(250); }
      throw new Error(`timeout waiting for ${what}`);
    };
    const click = (label) => evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!b) throw new Error('no button labelled ' + ${JSON.stringify(label)});
      b.click(); return true;
    })()`);
    const canvas = `!!document.querySelector('.lienzo svg')`;

    // The buttons are found by their English labels: pin the UI language, whatever the system's is.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('lila.idioma', 'en'); } catch {}` });
    await cdp.send('Page.navigate', { url: BASE });
    await waitFor(canvas, 'the canvas');

    // 1. The manifest, as Chrome parsed it.
    const app = await cdp.send('Page.getAppManifest');
    check('Page.getAppManifest has no errors', app.errors.length === 0, app.errors);
    check('the manifest is the one under the app base', app.url === `${BASE}manifest.webmanifest`, app.url);
    const m = JSON.parse(app.data);
    const abs = (u) => new URL(u, app.url).href;
    const icons = m.icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`);
    check('icons 192, 512 and maskable', ['192x192:any', '512x512:any', '512x512:maskable'].every((x) => icons.includes(x)), icons);
    const status = await evaluate(`Promise.all(${JSON.stringify(m.icons.map((i) => abs(i.src)))}.map((u) => fetch(u).then((r) => r.status + ' ' + r.headers.get('content-type'))))`);
    check('every icon loads as a PNG', status.every((s) => s === '200 image/png'), status);
    check('start_url is inside scope', abs(m.start_url).startsWith(abs(m.scope)), { start_url: abs(m.start_url), scope: abs(m.scope) });
    check('scope is the app base', abs(m.scope) === BASE, abs(m.scope));
    check('display is standalone', m.display === 'standalone', m.display);
    const handlers = (m.file_handlers ?? []).map((h) => ({ action: abs(h.action), accept: h.accept }));
    check('file_handlers open .lila inside the scope',
      handlers.some((h) => h.action.startsWith(BASE) && Object.values(h.accept).flat().includes('.lila')), handlers);
    report.manifest = { url: app.url, name: m.name, short_name: m.short_name, start_url: abs(m.start_url), scope: abs(m.scope), icons, file_handlers: handlers };

    // 2. Installability.
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    check('Page.getInstallabilityErrors is empty', installabilityErrors.length === 0, installabilityErrors);
    report.installabilityErrors = installabilityErrors;

    // 3. The service worker takes over after a reload, with this version's cache.
    await waitFor(`navigator.serviceWorker.ready.then((r) => !!r.active)`, 'an active service worker');
    await cdp.send('Page.reload');
    await waitFor(canvas, 'the canvas after reload');
    const sw = await evaluate(`(async () => ({ controller: navigator.serviceWorker.controller?.scriptURL ?? null, caches: await caches.keys() }))()`);
    check('the service worker controls the page', sw.controller === `${BASE}sw.js`, sw.controller);
    check('its cache is named after the app version', sw.caches.includes(`lila-modeler-${VERSION}`), sw.caches);
    report.serviceWorker = sw;

    // 4. Save in place through the File System Access API, with a real handle in the OPFS.
    const fixture = encodeLila({
      version: 1, id: 'pwa-check', name: 'pwa-check',
      model: { id: 'Process_Pedido', name: 'model.bpmn', xml: readFileSync(join(ROOT, 'examples/pedido/model.bpmn'), 'utf8'), revision: 0 },
      scenarios: { 'as-is.scenario.json': JSON.parse(readFileSync(join(ROOT, 'examples/pedido/as-is.scenario.json'), 'utf8')) },
      scenarioRevisions: { 'as-is.scenario.json': 0 }, runs: [],
    });
    const before = await evaluate(`(async () => {
      const dir = await navigator.storage.getDirectory();
      const handle = await dir.getFileHandle('pwa-check.lila', { create: true });
      const w = await handle.createWritable();
      await w.write(new Uint8Array(${JSON.stringify([...fixture])}));
      await w.close();
      window.__pwaHandle = handle;
      window.__savePickerOpened = 0;
      window.showOpenFilePicker = async () => [handle];
      window.showSaveFilePicker = async () => { window.__savePickerOpened++; throw new DOMException('aborted', 'AbortError'); };
      return (await handle.getFile()).lastModified;
    })()`);
    await click('Open');
    await waitFor(`document.body.innerText.includes('pwa-check')`, 'the project opened through showOpenFilePicker');
    await sleep(1100); // lastModified has one-second resolution on some file systems.
    await click('Save');
    await waitFor(`window.__pwaHandle.getFile().then((f) => f.lastModified > ${before})`, 'the same file rewritten', 15_000);
    const written = await evaluate(`window.__pwaHandle.getFile().then(async (f) => [...new Uint8Array(await f.arrayBuffer())])`);
    const doc = decodeLila(Uint8Array.from(written));
    check('Save rewrote the file Open chose', doc.id === 'pwa-check', doc.id);
    check('Save did not open the save dialog', await evaluate('window.__savePickerOpened') === 0, await evaluate('window.__savePickerOpened'));
    await sleep(500);
    check('Save did not download a copy', readdirSync(downloads).length === 0, readdirSync(downloads));

    // 5. Offline: nothing answers on the port any more, and the editor still opens.
    await server.stop();
    const offline = await fetch(BASE).then(() => 'online', () => 'offline');
    check('the static server is down', offline === 'offline', offline);
    await cdp.send('Page.reload');
    await waitFor(canvas, 'the canvas offline', 30_000);
    check('the editor opens offline', true);
  } finally {
    ws.close();
    chrome.kill();
    await server.stop().catch(() => {});
    if (!process.env.LILA_E2E_KEEP) {
      await sleep(500);
      try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* harmless */ }
    }
  }

  const failed = Object.keys(failures).length > 0;
  console.log(JSON.stringify({ ok: !failed, report, failures }, null, 2));
  if (failed) process.exitCode = 1;
}

await main();
