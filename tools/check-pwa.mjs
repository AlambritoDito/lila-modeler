/**
 * Installable-PWA check (#576, ADR-031) in headless Chrome over the DevTools Protocol, with
 * nothing but Node's built-in WebSocket — the same approach as `tools/e2e-lila.mjs`.
 *
 * On the Pages build served under `/lila-modeler/app/`, before asking a person to try Windows:
 * `Page.getAppManifest` reports no errors, `Page.getInstallabilityErrors` is empty, the manifest
 * has the 192, 512 and maskable icons, `start_url` is inside `scope`, and `file_handlers` takes
 * `.lila`. Then the save-in-place path of the tester guide (#573): with `showSaveFilePicker`
 * answered by a file in the origin-private file system, «Save» twice asks once, writes the same
 * file twice and downloads nothing.
 *
 *   npm run build:pages && node tools/check-pwa.mjs
 *
 * `LILA_PWA_PORT` (static server) and `LILA_PWA_CDP_PORT` (Chrome's debugging port) move the
 * two ports. Prints a JSON report and exits non-zero on the first failed expectation.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SITE = join(ROOT, '_site');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.LILA_PWA_PORT ?? 8797);
const CDP_PORT = Number(process.env.LILA_PWA_CDP_PORT ?? 9343);
const BASE = `http://127.0.0.1:${PORT}/lila-modeler/app/`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const report = {};
const failures = {};
function check(name, ok, detail) {
  (ok ? report : failures)[name] = detail ?? ok;
  if (!ok) console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
}

function serve() {
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
  return new Promise((ok) => server.listen(PORT, '127.0.0.1', () => ok(server)));
}

let nextId = 1;
function connect(ws) {
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id === undefined) return void events.push(msg.method);
    const entry = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`));
    else entry.resolve(msg.result);
  });
  return {
    events,
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
  if (!existsSync(SITE)) throw new Error('_site is missing: run `npm run build:pages` first.');
  const work = mkdtempSync(join(tmpdir(), 'lila-pwa-'));
  const server = await serve();
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${join(work, 'profile')}`,
    '--no-first-run', '--disable-gpu', '--window-size=1440,900',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  try {
    let targets;
    for (let i = 0; i < 60 && targets === undefined; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); } catch { await sleep(250); }
    }
    ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
    const cdp = connect(ws);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    // Downloads are refused, and reported: a save in place must not produce one.
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true });

    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true, userGesture: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'evaluate failed');
      return result.value;
    };
    const waitFor = async (expression, what, timeout = 60_000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { if (await evaluate(expression)) return; await sleep(250); }
      throw new Error(`timeout waiting for ${what}`);
    };

    await cdp.send('Page.navigate', { url: BASE });
    await waitFor(`!!document.querySelector('.lienzo svg') && !document.getElementById('startup')`, 'the canvas');

    // Guide step 3: a first visit opens on the Restaurant order example.
    check('the example is on the canvas', await evaluate(`document.querySelector('.lienzo svg').textContent.includes('Take order')`));

    // 1. Manifest and installability, as Chrome itself sees them.
    const manifest = await cdp.send('Page.getAppManifest');
    report.getAppManifest = { url: manifest.url, errors: manifest.errors, data: JSON.parse(manifest.data ?? 'null') };
    check('Page.getAppManifest has no errors', manifest.errors.length === 0, manifest.errors);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    report.getInstallabilityErrors = installabilityErrors;
    check('Page.getInstallabilityErrors is empty', installabilityErrors.length === 0, installabilityErrors);

    const data = report.getAppManifest.data ?? {};
    const icons = data.icons ?? [];
    const icon = (sizes, purpose = 'any') => icons.some((i) => i.sizes === sizes && (i.purpose ?? 'any').split(' ').includes(purpose));
    check('icons 192, 512 and maskable 512', icon('192x192') && icon('512x512') && icon('512x512', 'maskable'), icons);
    for (const i of icons) {
      const res = await fetch(new URL(i.src, manifest.url));
      check(`icon ${i.src} is served`, res.ok && res.headers.get('content-type') === 'image/png', res.status);
    }
    const scope = new URL(data.scope, manifest.url).href;
    const start = new URL(data.start_url, manifest.url).href;
    check('start_url is inside scope', start.startsWith(scope), { start, scope });
    check('scope is the app under its base', scope === BASE, scope);
    const handler = (data.file_handlers ?? []).find((h) => Object.values(h.accept ?? {}).flat().includes('.lila'));
    check('file_handlers takes .lila', handler !== undefined && new URL(handler.action, manifest.url).href.startsWith(scope), data.file_handlers);
    check('the page links the theme colour', await evaluate(`document.querySelector('meta[name=theme-color]')?.content`) === data.theme_color, data.theme_color);
    report.apis = await evaluate(`({ launchQueue: 'launchQueue' in window, showOpenFilePicker: typeof showOpenFilePicker, showSaveFilePicker: typeof showSaveFilePicker })`);

    // 2. Save in place (#573): the picker is answered once with an OPFS file; two saves.
    await evaluate(`(async () => {
      const dir = await navigator.storage.getDirectory();
      const handle = await dir.getFileHandle('check-pwa.lila', { create: true });
      window.__pickerCalls = 0; window.__writes = 0;
      // Counts the writes: the store keeps this object as its file and rewrites through it.
      const counted = { kind: 'file', name: handle.name, getFile: () => handle.getFile(),
        createWritable: (o) => { window.__writes++; return handle.createWritable(o); } };
      window.showSaveFilePicker = async () => { window.__pickerCalls++; return counted; };
      return true;
    })()`);
    const save = () => evaluate(`(() => {
      const b = [...document.querySelectorAll('.menu-archivo button')].find((x) => x.textContent.trim() === 'Save');
      if (!b) throw new Error('no Save button'); b.click(); return true;
    })()`);
    const size = `(async () => (await (await (await navigator.storage.getDirectory()).getFileHandle('check-pwa.lila')).getFile()).size)()`;
    await save();
    await waitFor(`${size}.then((n) => n > 0)`, 'the first save');
    const first = await evaluate(size);
    await sleep(300);
    await save();
    await sleep(1500);
    const calls = await evaluate('window.__pickerCalls');
    const writes = await evaluate('window.__writes');
    check('both saves write the same file', writes === 2, writes);
    const zip = await evaluate(`(async () => { const f = await (await (await navigator.storage.getDirectory()).getFileHandle('check-pwa.lila')).getFile(); const b = new Uint8Array(await f.arrayBuffer()); return [b[0], b[1]]; })()`);
    check('first save asks once, second save does not ask', calls === 1, calls);
    check('the file written is a ZIP (.lila)', zip[0] === 0x50 && zip[1] === 0x4b, zip);
    check('no download happened', !cdp.events.includes('Browser.downloadWillBegin') && !cdp.events.includes('Page.downloadWillBegin'), cdp.events.filter((e) => e.includes('download')));
    report.saveInPlace = { pickerCalls: calls, writes, bytes: first };
  } finally {
    ws?.close();
    chrome.kill();
    server.close();
    await sleep(500);
    try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* temp leftovers are harmless */ }
  }

  const failed = Object.keys(failures).length > 0;
  console.log(JSON.stringify({ ok: !failed, report, failures }, null, 2));
  if (failed) process.exitCode = 1;
}

await main();
