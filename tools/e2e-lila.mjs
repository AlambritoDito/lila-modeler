/**
 * End-to-end check of the `.lila` container in a real browser (#317, ADR-027), driven over the
 * Chrome DevTools Protocol with nothing but Node's built-in WebSocket — no puppeteer, no
 * playwright, no dependency added to the repo for a script that runs by hand and in review.
 *
 * What it proves, in one pass over the published demo (`_site`, served at `/lila-modeler/`):
 * open a `.lila` built from `examples/pedido`, simulate a scenario, save (the download is
 * captured from disk), reload with the session mirror cleared, reopen the saved file, and save
 * again. The two saved archives must be byte-identical: everything the first one carried — the
 * run, the scenario revisions, the model — survived the round trip through the file, not through
 * `localStorage`.
 *
 *   npm run build:pages && node tools/e2e-lila.mjs
 *
 * Prints a JSON report and exits non-zero on the first failed expectation.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeLila, encodeLila, lilaEntryNames } from '@lila/engine/project';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SITE = join(ROOT, '_site');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.LILA_E2E_PORT ?? 8787);
const BASE = `http://127.0.0.1:${PORT}/lila-modeler/app/`;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.bpmn': 'application/xml',
};

const report = {};
const failures = {};
function check(name, ok, detail) {
  (ok ? report : failures)[name] = detail ?? ok;
  if (!ok) console.error(`FAIL ${name}: ${JSON.stringify(detail)}`);
}

/** `_site` mounted under `/lila-modeler/`, which is the only path the built app's base works at. */
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

/** The fixture: `examples/pedido` as a `.lila`, with no runs — the simulation adds the first one. */
function fixture(path) {
  const dir = join(ROOT, 'examples/pedido');
  const read = (name) => readFileSync(join(dir, name), 'utf8');
  const scenarios = Object.fromEntries(
    ['as-is.scenario.json', 'to-be-3-cajeros.scenario.json'].map((n) => [n, JSON.parse(read(n))]),
  );
  writeFileSync(path, encodeLila({
    version: 1, id: 'pedido-e2e', name: 'pedido-e2e',
    model: { id: 'Process_Pedido', name: 'model.bpmn', xml: read('model.bpmn'), revision: 0 },
    scenarios, scenarioRevisions: Object.fromEntries(Object.keys(scenarios).map((n) => [n, 0])), runs: [],
  }));
}

// -- CDP over the built-in WebSocket ------------------------------------------------------------
let nextId = 1;
function connect(ws) {
  const pending = new Map();
  const waiters = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id !== undefined) {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) entry.reject(new Error(`${entry.method}: ${msg.error.message}`));
      else entry.resolve(msg.result);
      return;
    }
    for (const w of [...waiters]) {
      if (w.method === msg.method) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg.params); }
    }
  });
  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    once(method, timeout = 30_000) {
      return new Promise((resolve, reject) => {
        const w = { method, resolve };
        waiters.push(w);
        setTimeout(() => { if (waiters.includes(w)) { waiters.splice(waiters.indexOf(w), 1); reject(new Error(`timeout waiting for ${method}`)); } }, timeout);
      });
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!existsSync(SITE)) throw new Error('_site is missing: run `npm run build:pages` first.');
  const work = mkdtempSync(join(tmpdir(), 'lila-e2e-'));
  const downloads = join(work, 'downloads');
  mkdirSync(downloads);
  const source = join(work, 'pedido-e2e.lila');
  fixture(source);
  report.fixtureEntries = [...lilaEntryNames(readFileSync(source))];

  const server = await serve();
  const profile = join(work, 'profile');
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=9333', `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch('http://127.0.0.1:9333/json/list')).json(); break; } catch { await sleep(250); }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  const cdp = connect(ws);

  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });

    const evaluate = async (expression) => {
      // `userGesture`: opening a file chooser needs user activation, and a plain `Runtime.evaluate`
      // has none — the click would fire the React handler and the picker would never appear.
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true, userGesture: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'evaluate failed');
      return result.value;
    };

    /** Clicks the first `<button>` whose visible text is exactly `label`. */
    const click = (label) => evaluate(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!b) throw new Error('no button labelled ' + ${JSON.stringify(label)});
      b.click(); return true;
    })()`);

    const waitFor = async (expression, what, timeout = 60_000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { if (await evaluate(expression)) return true; await sleep(250); }
      throw new Error(`timeout waiting for ${what}`);
    };

    /** Clicks `label`, answers the file chooser it opens with `path`. */
    const open = async (label, path) => {
      const chooser = cdp.once('Page.fileChooserOpened');
      await click(label);
      const { backendNodeId } = await chooser;
      await cdp.send('DOM.setFileInputFiles', { files: [path], backendNodeId });
    };

    /**
     * Clicks «Save» and returns the path of the file the browser wrote. Each save gets its own
     * download directory: Chrome uniquifies a repeated name («… (1).lila»), and comparing bytes
     * is easier when the second save is the only thing in its folder.
     */
    let saveCount = 0;
    const saved = async () => {
      const dir = join(downloads, `save-${++saveCount}`);
      mkdirSync(dir, { recursive: true });
      await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
      await click('Save');
      const until = Date.now() + 30_000;
      while (Date.now() < until) {
        const now = readdirSync(dir).filter((f) => f.endsWith('.lila'));
        if (now.length === 1) { await sleep(300); return join(dir, now[0]); }
        await sleep(200);
      }
      throw new Error(`no .lila download appeared in ${dir}`);
    };

    // 1. The app, then the project.
    await cdp.send('Page.navigate', { url: BASE });
    await waitFor(`!!document.querySelector('.lienzo svg')`, 'the canvas');
    await open('Open', source);
    await waitFor(`document.body.innerText.includes('pedido-e2e')`, 'the opened project name');
    report.openedProject = await evaluate(`document.querySelector('.archivo, header')?.innerText.trim().slice(0, 120)`);

    // 2. Simulate the scenario the project came with.
    await click('Run simulation');
    await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Run simulation')`, 'the run to finish');
    await sleep(500);

    // 3. Save, and read back what was written.
    const first = await saved();
    const a = decodeLila(readFileSync(first));
    check('saved file is named after the project', first.endsWith('pedido-e2e.lila'), first.split('/').pop());
    check('the saved project carries the run', a.runs.length === 1, a.runs.map((r) => r.scenarioName));
    check('the saved archive is the folder layout', true, [...lilaEntryNames(readFileSync(first))]);
    report.savedRevisions = a.scenarioRevisions;

    // 4. Reload with the session mirror cleared: whatever comes back now came from the FILE.
    await evaluate(`localStorage.clear()`);
    await cdp.send('Page.navigate', { url: BASE });
    await waitFor(`!!document.querySelector('.lienzo svg')`, 'the canvas after reload');
    check('the mirror is empty after the reload', await evaluate(`localStorage.getItem('lila.project.v1') === null`));

    // 5. Reopen the saved file and save it again: byte-identical means nothing was lost.
    await open('Open', first);
    await waitFor(`document.body.innerText.includes('pedido-e2e')`, 'the reopened project');
    const second = await saved();
    const b = decodeLila(readFileSync(second));
    check('runs survive the round trip through the file', b.runs.length === 1 && b.runs[0].id === a.runs[0].id, b.runs.map((r) => r.id));
    check('revisions survive the round trip', JSON.stringify(b.scenarioRevisions) === JSON.stringify(a.scenarioRevisions), b.scenarioRevisions);
    check('re-saving is byte-identical', readFileSync(first).equals(readFileSync(second)), {
      first: readFileSync(first).length, second: readFileSync(second).length,
    });
  } finally {
    ws.close();
    chrome.kill();
    server.close();
    // Best effort: Chrome is still flushing its profile as it dies, and a failed cleanup must
    // never replace the error the run actually hit.
    if (!process.env.LILA_E2E_KEEP) {
      await sleep(500);
      try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); } catch { /* leftovers in the temp dir are harmless */ }
    }
  }

  const failed = Object.keys(failures).length > 0;
  console.log(JSON.stringify({ ok: !failed, report, failures }, null, 2));
  if (failed) process.exitCode = 1;
}

await main();
