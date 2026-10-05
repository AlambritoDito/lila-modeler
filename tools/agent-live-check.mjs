/**
 * Live acceptance check of Lote K (#527, #540): «with the app open, create_process on that .lila
 * makes the map appear». Not part of CI: it launches the real, unpackaged desktop app.
 *
 *   npm ci && npm run build && npm run build -w @lila-modeler/web && npm run build -w @lila-modeler/desktop
 *   node tools/agent-live-check.mjs [--port 9731] [--keep]
 *
 * 1. Copies `examples/pedido.lila` (one process) to a temp folder and opens it in Electron
 *    (`apps/desktop`, the Electron of `node_modules`) with its own `--user-data-dir`,
 *    `--remote-debugging-port`, the E2E env vars (no native dialog can block) and the flags that keep
 *    timers running in a background window.
 * 2. `lila process create` (the CLI) adds a process to that file. Over CDP, the process tabs of the
 *    open app must list it within the timeout, with no click or key in the app.
 * 3. `create_process` through `lila mcp` (the official MCP client over stdio) adds another. Same check.
 * 4. Evidence only, not a user action the check depends on: a click on each new tab must draw its
 *    steps on the canvas (`.djs-element[data-element-id]`).
 *
 * Prints PASS/FAIL per step and a JSON report; exits 1 on the first failure. Everything it writes
 * lives under the temp folder (removed at the end unless `--keep`).
 */
import { spawn, execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values: options } = parseArgs({
  options: { port: { type: 'string', default: '9731' }, keep: { type: 'boolean', default: false } },
});
const PORT = Number(options.port);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const ELECTRON = require('electron');
const LILA = join(ROOT, 'packages/engine/bin/lila.js');
const TIMEOUT_MS = 15_000;

const work = realpathSync(mkdtempSync(join(tmpdir(), 'lila-agent-live-')));
const profile = join(work, 'profile');
mkdirSync(profile);
// English UI, so the evidence reads the same for everyone.
writeFileSync(join(profile, 'estado.json'), JSON.stringify({ version: 1, window: null, recents: [], ajustes: { idioma: 'en' } }));
const project = join(work, 'agent.lila');
copyFileSync(join(ROOT, 'examples/pedido.lila'), project);
const cliOutline = join(work, 'credit.json');
copyFileSync(join(ROOT, 'examples/outline/credit-application.json'), cliOutline);
const mcpOutline = {
  name: 'Solicitud de tarjeta (MCP)',
  lanes: ['Ejecutivo de sucursal', 'Analista de crédito'],
  steps: [
    { id: 'recibir', name: 'Recibir solicitud', duration: '10m' },
    { id: 'evaluar', name: 'Evaluar capacidad de pago', lane: 'Analista de crédito', duration: 'normal(25m, 8m)' },
    { id: 'aprobada', type: 'xor', name: '¿Aprobada?', branches: [{ label: 'Sí', to: 'emitir' }, { label: 'No', to: 'rechazo', probability: 0.35 }] },
    { id: 'emitir', name: 'Emitir tarjeta', end: true },
    { id: 'rechazo', name: 'Notificar rechazo', lane: 'Ejecutivo de sucursal', end: true },
  ],
};

const report = { project, port: PORT, steps: [] };
let electron = null;
let mcp = null;

function pass(name, detail) {
  report.steps.push({ name, ok: true, ...detail });
  console.log(`PASS ${name} ${JSON.stringify(detail)}`);
}

async function finish(code) {
  await mcp?.close().catch(() => {});
  if (electron !== null && electron.exitCode === null) {
    electron.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (electron.exitCode === null) electron.kill('SIGKILL');
  }
  console.log(JSON.stringify(report, null, 2));
  if (!options.keep) rmSync(work, { recursive: true, force: true });
  process.exit(code);
}

async function fail(name, error) {
  report.steps.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
  console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  await finish(1);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `fn` until it returns something truthy, or throws `what` after the timeout. */
async function until(what, fn, timeout = TIMEOUT_MS) {
  const start = Date.now();
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return { value, ms: Date.now() - start };
    if (Date.now() - start > timeout) throw new Error(`timed out after ${timeout} ms waiting for ${what}`);
    await delay(150);
  }
}

// -- CDP: one WebSocket to the app's page, `Runtime.evaluate` only ---------------------------------
let socket = null;
let nextId = 0;
const pending = new Map();

async function connectCdp() {
  const { value: target } = await until(
    'the app page on the debugging port',
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      return list.find((t) => t.type === 'page' && t.url.startsWith('lila://app/'));
    },
    30_000,
  );
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  };
}

/** Evaluates `expression` in the page and returns its JSON value. */
async function page(expression) {
  const id = ++nextId;
  const reply = await new Promise((resolve) => {
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }));
  });
  if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
  return reply.result?.result?.value;
}

const TABS = `[...document.querySelectorAll('nav.diagramas .pestana-proceso')].map((b) => b.textContent.trim())`;
const SINGLE_TAB = `document.querySelector('nav.diagramas .pestana.activa')?.firstChild?.textContent?.trim() ?? null`;
const CANVAS_IDS = `[...document.querySelectorAll('.djs-element[data-element-id]')].map((e) => e.getAttribute('data-element-id'))`;
const ALERT = `document.querySelector('[role="alert"]')?.textContent ?? null`;

async function showsOnCanvas(name, ids) {
  await page(`[...document.querySelectorAll('nav.diagramas .pestana-proceso')].find((b) => b.textContent.trim() === ${JSON.stringify(name)})?.click()`);
  const { value: drawn, ms } = await until(`the steps of "${name}" on the canvas`, async () => {
    const onCanvas = await page(CANVAS_IDS);
    return ids.every((id) => onCanvas.includes(id)) ? onCanvas : null;
  });
  return { drawn: ids.filter((id) => drawn.includes(id)), ms };
}

// -- 1. the app, open on the project ---------------------------------------------------------------
try {
  electron = spawn(
    ELECTRON,
    [
      join(ROOT, 'apps/desktop'),
      project,
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
    {
      env: {
        ...process.env,
        LILA_E2E_FOLDER: 'cancel',
        LILA_E2E_CLOSE: 'discard',
        LILA_E2E_RECOVERY: 'discard',
        LILA_E2E_SAVE_FILE: join(work, 'save-dialog.lila'),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let stderr = '';
  electron.stderr.on('data', (chunk) => (stderr = (stderr + chunk).slice(-4000)));
  electron.on('exit', (code) => {
    if (report.steps.length < 4) console.log(`electron exited early (${code}): ${stderr}`);
  });
  await connectCdp();
  const { value: opened, ms } = await until('pedido on the canvas', async () => {
    const ids = await page(CANVAS_IDS);
    return ids.includes('Task_TomarPedido') ? { tab: await page(SINGLE_TAB), elements: ids.length } : null;
  }, 30_000);
  pass('the app is open on the .lila', { ...opened, ms });
} catch (error) {
  await fail('the app is open on the .lila', error);
}

// -- 2. the CLI adds a process -------------------------------------------------------------------
try {
  const { stdout } = await promisify(execFile)(process.execPath, [
    LILA, 'process', 'create', '--outline', cliOutline, '-p', project, '--process', 'credit-cli', '--name', 'Credit (CLI)', '--json',
  ]);
  const written = JSON.parse(stdout);
  const { value: tabs, ms } = await until('the CLI process in the tabs', async () => {
    const t = await page(TABS);
    return t.includes('Credit (CLI)') ? t : null;
  });
  pass('lila process create: the new process appears in the open app, no user action', {
    slug: written.slug, tabs, msAfterWrite: ms, alert: await page(ALERT),
  });
  const shown = await showsOnCanvas('Credit (CLI)', ['receive', 'check', 'ok', 'issue', 'reject']);
  pass('evidence: its tab draws the outline steps on the canvas', shown);
} catch (error) {
  await fail('lila process create: the new process appears in the open app, no user action', error);
}

// -- 3. MCP create_process adds another -----------------------------------------------------------
try {
  const { Client } = await import('@modelcontextprotocol/client');
  const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
  mcp = new Client({ name: 'lila-agent-live-check', version: '0' });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [LILA, 'mcp'], cwd: work }));
  const result = await mcp.callTool({ name: 'create_process', arguments: { project: 'agent.lila', outline: mcpOutline, process: 'tarjeta-mcp' } });
  const text = result.content[0].text;
  if (result.isError) throw new Error(text);
  const { value: tabs, ms } = await until('the MCP process in the tabs', async () => {
    const t = await page(TABS);
    return t.includes(mcpOutline.name) ? t : null;
  });
  pass('MCP create_process: the new process appears in the open app, no user action', {
    slug: JSON.parse(text).slug, tabs, msAfterWrite: ms, alert: await page(ALERT),
  });
  const shown = await showsOnCanvas(mcpOutline.name, mcpOutline.steps.map((s) => s.id));
  pass('evidence: its tab draws the outline steps on the canvas', shown);
} catch (error) {
  await fail('MCP create_process: the new process appears in the open app, no user action', error);
}

// The file on disk holds the three processes the tabs show.
const { decodeLila, processesOf } = await import('@lila-modeler/engine/project');
report.onDisk = processesOf(decodeLila(new Uint8Array(readFileSync(project)))).map((p) => p.slug);
await finish(0);
