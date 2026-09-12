/**
 * End-to-end check of the engine-driven replay (#331) in a real browser, over the Chrome DevTools
 * Protocol with nothing but Node's built-in WebSocket — same recipe as `tools/e2e-lila.mjs`, no
 * puppeteer, no playwright, no dependency added for a script that runs by hand and in review.
 *
 * What it proves, in one pass over the published demo (`_site`, served at `/lila-modeler/`):
 * open a `.lila` built from `examples/tarjeta-credito` with a single replication, run the
 * simulation, press «Play» in the results, jump the replay to the end with the «Instant» speed,
 * and read the counters the overlay wrote on every element of the diagram. Those counters must be
 * exactly `elements[id].started/completed` of the run that was just stored — which is read back
 * from the `.lila` the app saves, not from anything the page says about itself.
 *
 *   npm run build:pages && node tools/e2e-replay.mjs
 *
 * `CHROME_PATH` overrides the browser (the default is the macOS Google Chrome bundle).
 * Prints a JSON report and exits non-zero on the first failed expectation.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeLila, encodeLila } from '@lila/engine/project';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SITE = join(ROOT, '_site');
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.LILA_E2E_PORT ?? 8788);
const BASE = `http://127.0.0.1:${PORT}/lila-modeler/app/`;
/** `examples/tarjeta-credito` with seed 42 and one replication: 20 cards delivered. */
const CARDS_DELIVERED = 20;

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

/**
 * The fixture: `examples/tarjeta-credito` as a `.lila` with no runs and `replications: 1`. One
 * replication is the only case where the replay of the log and the aggregate of the result are
 * the same numbers, which is exactly the acceptance of #331.
 */
function fixture(path) {
  const dir = join(ROOT, 'examples/tarjeta-credito');
  const read = (name) => readFileSync(join(dir, name), 'utf8');
  const one = (name) => {
    const scenario = JSON.parse(read(name));
    return [name, { ...scenario, run: { ...scenario.run, replications: 1 } }];
  };
  const scenarios = Object.fromEntries([one('as-is.scenario.json'), one('to-be-3-analistas.scenario.json')]);
  writeFileSync(path, encodeLila({
    version: 1, id: 'tarjeta-e2e', name: 'tarjeta-e2e',
    model: { id: 'Process_TarjetaCredito', name: 'model.bpmn', xml: read('model.bpmn'), revision: 0 },
    scenarios, scenarioRevisions: Object.fromEntries(Object.keys(scenarios).map((n) => [n, 0])), runs: [],
  }));
}

// -- CDP over the built-in WebSocket ------------------------------------------------------------
let nextId = 1;
function connect(ws) {
  const pending = new Map();
  const waiters = [];
  const listeners = [];
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
    for (const l of listeners) if (l.method === msg.method) l.fn(msg.params);
  });
  return {
    /** Every listener for `method`, for domain events that fire more than once. */
    on(method, fn) { listeners.push({ method, fn }); },
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
  const work = mkdtempSync(join(tmpdir(), 'lila-replay-'));
  const downloads = join(work, 'downloads');
  mkdirSync(downloads);
  const source = join(work, 'tarjeta-e2e.lila');
  fixture(source);

  const server = await serve();
  const profile = join(work, 'profile');
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=9334', `--user-data-dir=${profile}`,
    '--no-first-run', '--disable-gpu', '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });

  let targets;
  for (let i = 0; i < 60; i++) {
    try { targets = await (await fetch('http://127.0.0.1:9334/json/list')).json(); break; } catch { await sleep(250); }
  }
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  const cdp = connect(ws);

  try {
    // An exception inside the animation frame would otherwise show up only as counters that never
    // move: the page's own errors are part of the report.
    const errores = [];
    cdp.on('Runtime.exceptionThrown', (params) => {
      errores.push(params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text);
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
    await cdp.send('Page.setInterceptFileChooserDialog', { enabled: true });

    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true, userGesture: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? 'evaluate failed');
      return result.value;
    };

    /**
     * Clicks the first `<button>` under `scope` whose visible text is exactly `label`. The scope
     * matters: «Reset» is also the name of the button that restores the theme in the settings
     * dialog, which is in the DOM even while the dialog is closed.
     */
    const click = (label, scope = 'body') => evaluate(`(() => {
      const root = document.querySelector(${JSON.stringify(scope)});
      if (!root) throw new Error('no element matching ' + ${JSON.stringify(scope)});
      const b = [...root.querySelectorAll('button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!b) throw new Error('no button labelled ' + ${JSON.stringify(label)});
      b.click(); return true;
    })()`);

    const waitFor = async (expression, what, timeout = 120_000) => {
      const until = Date.now() + timeout;
      while (Date.now() < until) { if (await evaluate(expression)) return true; await sleep(250); }
      throw new Error(`timeout waiting for ${what}`);
    };

    const open = async (label, path) => {
      const chooser = cdp.once('Page.fileChooserOpened');
      await click(label);
      const { backendNodeId } = await chooser;
      await cdp.send('DOM.setFileInputFiles', { files: [path], backendNodeId });
    };

    /** Clicks «Save» and returns the path of the `.lila` the browser wrote. */
    const saved = async () => {
      const dir = join(downloads, 'save');
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
    await waitFor(`document.body.innerText.includes('tarjeta-e2e')`, 'the opened project name');

    // 2. Run the AS-IS the project came with; the app lands on «Results» by itself.
    await click('Run simulation');
    await waitFor(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Run simulation')`, 'the run to finish');
    await waitFor(`document.body.innerText.includes('Bottlenecks')`, 'the results view');

    // 3. «Play» switches to the replay; «Instant» takes it to the end of the replication.
    await click('Play', '.zona-resultados');
    await waitFor(`!!document.querySelector('.replay select')`, 'the replay controls');
    check('the replay starts at the beginning', await evaluate(
      `document.querySelector('[data-replay-progress]')?.getAttribute('data-replay-progress') === '0'`));
    check('the counters are painted on the diagram', await evaluate(
      `document.querySelectorAll('.lila-replay-contador[data-element-id]').length > 0`),
      await evaluate(`document.querySelectorAll('.lila-replay-contador[data-element-id]').length`));

    /** Picks a speed the way a person does: the native setter plus the event React listens to. */
    const velocidad = (valor) => evaluate(`(() => {
      const s = document.querySelector('.replay select');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(s, ${JSON.stringify(valor)});
      s.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await velocidad('instantanea');
    await waitFor(`document.querySelector('[data-replay-progress]')?.getAttribute('data-replay-progress') === '100'`,
      'the replay to reach the end');

    const counters = await evaluate(`(() => Object.fromEntries(
      [...document.querySelectorAll('.lila-replay-contador[data-element-id]')].map((d) => [d.dataset.elementId, {
        started: Number(d.dataset.started), completed: Number(d.dataset.completed), queue: Number(d.dataset.queue),
      }])))()`);
    report.elementsWithCounters = Object.keys(counters).length;

    // 4. The truth to compare against: the run stored in the project, read back from the file.
    const file = await saved();
    const project = decodeLila(readFileSync(file));
    const run = project.runs[project.runs.length - 1];
    check('the project carries exactly one run', project.runs.length === 1, project.runs.map((r) => r.scenarioName));
    check('the run is a single replication', run.inputs.scenario.run.replications === 1, run.inputs.scenario.run.replications);

    const mismatches = [];
    for (const [id, counter] of Object.entries(counters)) {
      const metrics = run.result.elements[id];
      if (metrics === undefined) { mismatches.push({ id, reason: 'not in result.elements' }); continue; }
      if (metrics.started !== counter.started || metrics.completed !== counter.completed) {
        mismatches.push({ id, overlay: counter, engine: { started: metrics.started, completed: metrics.completed } });
      }
    }
    check('every counter matches elements[id].started/completed', mismatches.length === 0, mismatches);
    check('the log covered every task of the model',
      Object.keys(counters).length === 13, Object.keys(counters).sort());
    check(`End_CardDelivered completed is ${CARDS_DELIVERED} with seed 42`,
      run.result.process.byEndEvent?.End_CardDelivered?.completed === CARDS_DELIVERED,
      run.result.process.byEndEvent?.End_CardDelivered?.completed);

    // 5. Pause/Reset still answer after the jump: the controls are not one-shot.
    await click('Reset', '.replay');
    check('Reset takes the clock back to zero', await evaluate(
      `document.querySelector('[data-replay-progress]')?.getAttribute('data-replay-progress') === '0'`));
    // Back to a watchable speed: «Instant» would finish the replication on the first frame and
    // the button would be «Play» again before this check could read it.
    await velocidad('600');
    await click('Play', '.replay');
    check('Play leaves the replay running', await evaluate(
      `[...document.querySelector('.replay').querySelectorAll('button')].some((b) => b.textContent.trim() === 'Pause')`));
    await click('Pause', '.replay');
    check('Pause stops it', await evaluate(
      `[...document.querySelector('.replay').querySelectorAll('button')].some((b) => b.textContent.trim() === 'Play')`));
    check('the page threw nothing', errores.length === 0, errores);
  } finally {
    ws.close();
    chrome.kill();
    server.close();
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
