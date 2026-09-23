/**
 * Real-Electron boundary E2E for issue #378: a `.lila` opened via a launch/open-file/recent/
 * open-dialog path could not be saved (`E-ARGUMENTO: "file" debe ser un nombre de archivo .bpmn
 * (recibido: "launch.lila")`). Drives the BUILT desktop app (`apps/desktop`, Electron itself from
 * this worktree's `node_modules`) with Playwright's `_electron`, the same pattern as
 * `tools/check-branding-desktop.mjs`. No dependency is added to the repo: Playwright lives
 * outside it (`PLAYWRIGHT_MODULE` points at that install).
 *
 *   npm run build -w @lila/engine && npm run build -w @lila/web && npm run build -w @lila/desktop
 *   PLAYWRIGHT_MODULE=<qa-runtime>/node_modules/playwright/index.mjs node tools/e2e-desktop-open-path.mjs
 *
 * Every profile is a fresh `--user-data-dir` under a temp folder; every fixture lives under a
 * temp "Descargas"-like folder — no real user project is ever touched. Writes a JSON report and
 * screenshots to `LILA_E2E_EVIDENCE_DIR` (default: alongside this script's temp work dir printed
 * at the end) and exits non-zero on the first failed expectation.
 */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, chmod, readFile, writeFile, rm, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const { _electron } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APP_DIR = join(ROOT, 'apps/desktop');
const ELECTRON_PATH = require('electron');

const EVIDENCE_DIR = process.env.LILA_E2E_EVIDENCE_DIR || join(ROOT, '..', 'evidence-378-fallback');
await mkdir(EVIDENCE_DIR, { recursive: true });

const { parseBpmn } = await import('@lila/engine/bpmn');
const { simulate } = await import('@lila/engine');
const { ScenarioSchema } = await import('@lila/engine/schema');
const { decodeLila, encodeLila } = await import('@lila/engine/project');

const PEDIDO_DIR = join(ROOT, 'examples/pedido');
const AS_IS = 'as-is.scenario.json';
const TO_BE = 'to-be-3-cajeros.scenario.json';

// -- report -------------------------------------------------------------------------------------
const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail: detail ?? null });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && !ok ? `: ${JSON.stringify(detail)}` : ''}`);
}
// Dev/debug filter: `LILA_E2E_ONLY=<substring>` skips every step whose name doesn't contain it.
// Not part of the required matrix — only for iterating on one route quickly while writing this
// script. Unset (the default) runs the whole matrix.
const ONLY = process.env.LILA_E2E_ONLY;
/** Set by each route body right after `launch()`, so a failure can screenshot the live page. */
let currentPage = null;
async function step(name, fn) {
  if (ONLY !== undefined && !name.includes(ONLY)) return;
  currentPage = null;
  try {
    await fn();
    record(name, true);
  } catch (error) {
    if (currentPage !== null) {
      const path = join(EVIDENCE_DIR, `FAILED-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 80)}.png`);
      await currentPage.screenshot({ path }).catch(() => {});
    }
    record(name, false, error instanceof Error ? error.message : String(error));
  }
}

// -- fixture: examples/pedido as a .lila, two scenarios, one saved run --------------------------
let cachedRun = null;
async function pedidoRun() {
  if (cachedRun !== null) return cachedRun;
  const xml = await readFile(join(PEDIDO_DIR, 'model.bpmn'), 'utf8');
  const asIsRaw = JSON.parse(await readFile(join(PEDIDO_DIR, AS_IS), 'utf8'));
  const scenario = ScenarioSchema.parse({ ...asIsRaw, run: { ...asIsRaw.run, replications: 1 } });
  const { ir } = await parseBpmn(xml);
  const result = simulate(ir, { ...scenario, model: scenario.model, run: scenario.run }, { log: false });
  cachedRun = {
    id: 'run-e2e-378',
    scenarioName: AS_IS,
    result,
    inputs: { modelRevision: 0, scenarioRevision: 0, xml, scenario: JSON.parse(JSON.stringify(scenario)) },
  };
  return cachedRun;
}

/** Builds a `.lila` at `path` (any Unicode form) from `examples/pedido` with two scenarios and one run. */
async function buildFixture(path, { taskName } = {}) {
  const xmlRaw = await readFile(join(PEDIDO_DIR, 'model.bpmn'), 'utf8');
  const xml = taskName === undefined ? xmlRaw : xmlRaw.replace('name="Take order"', `name=${JSON.stringify(taskName)}`);
  const asIs = JSON.parse(await readFile(join(PEDIDO_DIR, AS_IS), 'utf8'));
  const toBe = JSON.parse(await readFile(join(PEDIDO_DIR, TO_BE), 'utf8'));
  const run = await pedidoRun();
  const { ir } = await parseBpmn(xml);
  await writeFile(path, encodeLila({
    version: 1, id: 'pedido-e2e-378', name: 'pedido-e2e-378',
    model: { id: ir.id, name: 'model.bpmn', xml, revision: 0 },
    scenarios: { [AS_IS]: asIs, [TO_BE]: toBe },
    scenarioRevisions: { [AS_IS]: 0, [TO_BE]: 0 },
    runs: [run],
  }));
}

/** Loose `.bpmn` fixture (the control case): just the model, no project container. */
async function buildLooseBpmn(path) {
  await writeFile(path, await readFile(join(PEDIDO_DIR, 'model.bpmn')));
}

// -- estado.json seeding (locale forced to English; optionally seeded recents) -------------------
async function seedSessionState(profile, { recents = [] } = {}) {
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'estado.json'), JSON.stringify({
    version: 1, window: null, recents, ajustes: { idioma: 'en' },
  }));
}

// -- Electron app helpers -------------------------------------------------------------------------
let shotCount = 0;
async function shoot(page, name) {
  shotCount += 1;
  const path = join(EVIDENCE_DIR, `${String(shotCount).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path }).catch(() => {});
  return path;
}

/**
 * `LILA_E2E_CLOSE` (`e2e.ts`) defaults to `discard` for every launch: without it, `app.close()`
 * on a project with unsaved changes (a failed save in the read-only case included) would open the
 * REAL native Save/Discard/Cancel dialog and hang forever — there is nothing to click it. Any
 * `env.LILA_E2E_CLOSE` the caller passes (the close-choice matrix, the read-only case) overrides
 * this default, since those are the routes actually exercising that dialog on purpose.
 */
function withCloseDefault(env) {
  return { LILA_E2E_CLOSE: 'discard', ...env };
}

async function launch(profile, { fileArg, env = {} } = {}) {
  const args = fileArg === undefined ? [APP_DIR, `--user-data-dir=${profile}`] : [APP_DIR, fileArg, `--user-data-dir=${profile}`];
  const app = await _electron.launch({
    executablePath: ELECTRON_PATH,
    args,
    env: { ...process.env, ...withCloseDefault(env) },
  });
  const page = await app.firstWindow();
  currentPage = page;
  await page.locator('#startup').waitFor({ state: 'detached', timeout: 30_000 });
  return { app, page };
}

/** Stubs `dialog.showOpenDialog`/`showSaveDialog` in the MAIN process for one call each. */
async function stubOpenDialog(app, filePath) {
  await app.evaluate(({ dialog }, path) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: [path] };
    };
  }, filePath);
}
async function stubSaveDialog(app, filePath) {
  await app.evaluate(({ dialog }, path) => {
    const original = dialog.showSaveDialog;
    dialog.showSaveDialog = async () => {
      dialog.showSaveDialog = original;
      return { canceled: false, filePath: path };
    };
  }, filePath);
}

/** Clicks the real native menu item whose accelerator is `accelerator` (e.g. `CmdOrCtrl+S`). */
async function clickMenuByAccelerator(app, accelerator) {
  const clicked = await app.evaluate(({ Menu }, accel) => {
    function find(items) {
      for (const item of items) {
        if (item.accelerator === accel) return item;
        if (item.submenu) { const found = find(item.submenu.items); if (found) return found; }
      }
      return null;
    }
    const menu = Menu.getApplicationMenu();
    if (!menu) return false;
    const item = find(menu.items);
    if (!item) return false;
    item.click();
    return true;
  }, accelerator);
  if (!clicked) throw new Error(`no menu item with accelerator ${accelerator}`);
}
const saveViaMenu = (app) => clickMenuByAccelerator(app, 'CmdOrCtrl+S');
const saveAsViaMenu = (app) => clickMenuByAccelerator(app, 'CmdOrCtrl+Shift+S');

/** Selects `Task_TomarPedido` on the canvas and returns the Properties panel's Name input. */
/**
 * Selecting the task and waiting for the Properties panel occasionally needs a second try under
 * load (many sequential real Electron launches in one run measurably slow the machine down) — one
 * retry with a longer timeout is cheap and avoids a flaky FAIL on an otherwise-working route.
 */
async function selectTomarPedido(page) {
  const input = page.getByLabel('Name', { exact: true });
  for (let attempt = 1; attempt <= 2; attempt++) {
    await page.locator('svg [data-element-id="Task_TomarPedido"]').first().click();
    try {
      await input.waitFor({ state: 'visible', timeout: attempt === 1 ? 15_000 : 30_000 });
      return input;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  return input;
}

async function renameTomarPedido(page, newName) {
  const input = await selectTomarPedido(page);
  await input.fill(newName);
  // Force the change to commit (React `onChange` already fired on `fill`; this blurs so nothing
  // is left pending when Save reads the exported XML right after).
  await page.keyboard.press('Tab');
}

async function waitProjectLoaded(page) {
  await page.locator('svg [data-element-id="Task_TomarPedido"]').first().waitFor({ timeout: 20_000 });
}

/** `.archivo` footer text, e.g. `model.bpmn · Saved`. */
async function archivoText(page) {
  return page.locator('.archivo').first().innerText();
}

/**
 * Waits for the footer to say "Saved" after a save (real IPC round trip). On timeout, folds in
 * the `.archivo` text and any visible error banner — this is what turns a bare "Timeout 15000ms
 * exceeded" into evidence that names the actual `E-ARGUMENTO` from issue #378 (or whatever else
 * went wrong), before `finally { app.close() }` tears the page down and that text is gone.
 */
async function waitSaved(page, timeout = 15_000) {
  try {
    await page.waitForFunction((text) => document.querySelector('.archivo')?.textContent?.includes(text), 'Saved', { timeout });
  } catch (error) {
    const footer = await archivoText(page).catch(() => '<unavailable>');
    // `App.tsx` renders the save error as `<... role="alert">{ioError}</...>` — read it directly
    // rather than the whole page's `innerText` (which can miss it if that banner sits in a region
    // CSS hides at the test window's size, even though it is present in the DOM and would be
    // visible at the app's normal size).
    const alerts = await page.locator('[role="alert"]').allTextContents().catch(() => []);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} — .archivo: ${JSON.stringify(footer)} — alerts: ${JSON.stringify(alerts)}`,
    );
  }
}

function assertFixtureIntegrity(bytes, { taskName, runId = 'run-e2e-378' } = {}) {
  const doc = decodeLila(bytes);
  if (taskName !== undefined) {
    assert.ok(doc.model.xml.includes(`name=${JSON.stringify(taskName)}`) || doc.model.xml.includes(`name="${taskName}"`),
      `saved XML does not contain the edited task name ${JSON.stringify(taskName)}`);
  }
  assert.deepEqual(Object.keys(doc.scenarios).sort(), [AS_IS, TO_BE].sort(), 'scenarios not preserved');
  assert.equal(doc.runs.length, 1, 'saved run not preserved');
  assert.equal(doc.runs[0].id, runId, 'saved run id changed');
  return doc;
}

// -- work dir -------------------------------------------------------------------------------------
const WORK = await realpath(await mkdtemp(join(tmpdir(), 'lila-e2e-378-')));
const DOWNLOADS = join(WORK, 'Descargas'); // synthetic "Downloads"-like folder — never a real one.
await mkdir(DOWNLOADS, { recursive: true });

const FILENAMES = {
  ascii: 'launch.lila',
  spaces: 'with spaces.lila',
  unicodeNFC: 'Trámite de Licencia — Completo.lila'.normalize('NFC'),
  unicodeNFD: 'Trámite de Licencia — Completo.lila'.normalize('NFD'),
};

// =================================================================================================
// Route 1: cold launch with the .lila as a launch argument, across all filenames, plus the
// close-with-save/discard/cancel matrix (on the ASCII name, to keep the run count sane).
// =================================================================================================
for (const [label, name] of Object.entries(FILENAMES)) {
  await step(`cold launch (${label}: ${JSON.stringify(name)}) opens, renames, saves`, async () => {
    const profile = join(WORK, `cold-${label}-profile`);
    const src = join(DOWNLOADS, `cold-${label}-${name}`);
    await buildFixture(src);
    await seedSessionState(profile);
    const edited = `Take order (${label} e2e)`;
    const { app, page } = await launch(profile, { fileArg: src });
    try {
      await waitProjectLoaded(page);
      await shoot(page, `cold-${label}-loaded`);
      await renameTomarPedido(page, edited);
      await saveViaMenu(app);
      // `dirty` clears (footer says "Saved") once main's `lila:writeProject` resolves.
      await waitSaved(page);
      const bytes = await readFile(src);
      assertFixtureIntegrity(bytes, { taskName: edited });
    } finally {
      await app.close();
    }
  });
}

await step('cold launch (ASCII): Save As to a new name writes a second file, original untouched', async () => {
  const profile = join(WORK, 'saveas-profile');
  const src = join(DOWNLOADS, 'saveas-source.lila');
  const dest = join(DOWNLOADS, 'saveas-dest.lila');
  await buildFixture(src);
  await seedSessionState(profile);
  const { app, page } = await launch(profile, { fileArg: src });
  try {
    await waitProjectLoaded(page);
    const beforeBytes = await readFile(src);
    await stubSaveDialog(app, dest);
    await saveAsViaMenu(app);
    await page.waitForFunction(() => document.querySelector('.archivo') !== null, undefined, { timeout: 15_000 });
    await stat(dest); // throws if "Save As" never wrote it.
    const afterBytes = await readFile(src);
    assert.ok(beforeBytes.equals(afterBytes), 'Save As must not touch the original file');
    assertFixtureIntegrity(await readFile(dest));
  } finally {
    await app.close();
  }
});

await step('cold launch (ASCII): reopen the saved file in a FRESH process keeps the edit', async () => {
  const profile1 = join(WORK, 'reopen-profile-1');
  const profile2 = join(WORK, 'reopen-profile-2');
  const src = join(DOWNLOADS, 'reopen.lila');
  await buildFixture(src);
  await seedSessionState(profile1);
  await seedSessionState(profile2);
  const edited = 'Take order (reopen e2e)';
  {
    const { app, page } = await launch(profile1, { fileArg: src });
    try {
      await waitProjectLoaded(page);
      await renameTomarPedido(page, edited);
      await saveViaMenu(app);
      await waitSaved(page);
    } finally { await app.close(); }
  }
  {
    const { app, page } = await launch(profile2, { fileArg: src });
    try {
      await waitProjectLoaded(page);
      const input = await selectTomarPedido(page);
      assert.equal(await input.inputValue(), edited, 'the reopened project lost the edit');
    } finally { await app.close(); }
  }
});

for (const choice of ['save', 'discard', 'cancel']) {
  await step(`cold launch (ASCII): close with "${choice}"`, async () => {
    const profile = join(WORK, `close-${choice}-profile`);
    const src = join(DOWNLOADS, `close-${choice}.lila`);
    await buildFixture(src);
    await seedSessionState(profile);
    const beforeBytes = await readFile(src);
    const edited = `Take order (close-${choice} e2e)`;
    const { app, page } = await launch(profile, { fileArg: src, env: { LILA_E2E_CLOSE: choice } });
    try {
      await waitProjectLoaded(page);
      await renameTomarPedido(page, edited);
      if (choice === 'save') {
        await app.close(); // main asks the renderer to save before quitting (LILA_E2E_CLOSE=save).
        const bytes = await readFile(src);
        assertFixtureIntegrity(bytes, { taskName: edited });
      } else if (choice === 'discard') {
        await app.close();
        const bytes = await readFile(src);
        assert.ok(beforeBytes.equals(bytes), 'discard must leave the file untouched');
      } else {
        // "cancel": closing the WINDOW (the red-button/CmdOrCtrl+W path — the one `attachCloseGuard`
        // actually guards with `win.on('close', ...)`) must be aborted, with `LILA_E2E_CLOSE=cancel`
        // resolving the skipped dialog to "cancel". `app.quit()`/`before-quit` was tried first here
        // and reliably hung the whole Electron process (even with `preventDefault()` in the
        // handler) — apparently quitting the app, even aborted, disrupts the CDP link Playwright's
        // `evaluate`/`close` depend on. `win.close()` exercises the same `decideClose` guard without
        // going anywhere near `app.quit()`.
        await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close(); });
        // Let the aborted close (and whatever macOS does around it) settle before touching the
        // page again; `.archivo` staying around and reachable is itself proof the window is alive.
        await page.waitForFunction(() => document.querySelector('.archivo') !== null, undefined, { timeout: 10_000 });
        const footer = await archivoText(page);
        assert.ok(footer.includes('Unsaved'), `cancel must leave the window dirty/open, footer was ${JSON.stringify(footer)}`);
        const input = await selectTomarPedido(page);
        assert.equal(await input.inputValue(), edited, 'cancel must keep the window open with the edit intact');
        const bytes = await readFile(src);
        assert.ok(beforeBytes.equals(bytes), 'cancel must not have written anything');
      }
    } finally {
      // "save"/"discard" already let the app close itself above (`dirty` is `false` by then, so
      // `win.on('close')` lets it through — this is a no-op). "cancel" deliberately left the
      // project dirty and the window open on purpose: `app.close()` on it would hit the exact same
      // guard again and hang, so it is force-exited first (`app.exit()`, unlike `app.quit()`, skips
      // `before-quit`/the close guard entirely — no dialog, no "stay" decision to hang on).
      await app.evaluate(({ app }) => { app.exit(0); }).catch(() => {});
      await app.close().catch(() => {});
    }
  });
}

// =================================================================================================
// Route 2: open-file emitted into a RUNNING app, and BEFORE the renderer is ready (lazy startup
// queue) — same interception pattern as tools/check-branding-desktop.mjs.
// =================================================================================================
await step('open-file into a running app opens the .lila and a save carries no modelFile error', async () => {
  const profile = join(WORK, 'openfile-running-profile');
  const src = join(DOWNLOADS, 'openfile-running.lila');
  await buildFixture(src);
  await seedSessionState(profile);
  const { app, page } = await launch(profile);
  try {
    await app.evaluate(({ app }, file) => { app.emit('open-file', { preventDefault() {} }, file); }, src);
    await waitProjectLoaded(page);
    const edited = 'Take order (open-file running e2e)';
    await renameTomarPedido(page, edited);
    await saveViaMenu(app);
    await waitSaved(page);
    assertFixtureIntegrity(await readFile(src), { taskName: edited });
  } finally {
    await app.close();
  }
});

await step('open-file BEFORE the renderer is ready (lazy startup queue) still opens and saves cleanly', async () => {
  const profile = join(WORK, 'openfile-lazy-profile');
  const src = join(DOWNLOADS, 'openfile-lazy.lila');
  await buildFixture(src);
  await seedSessionState(profile);
  const app = await _electron.launch({ executablePath: ELECTRON_PATH, args: [APP_DIR, `--user-data-dir=${profile}`], env: { ...process.env, ...withCloseDefault() } });
  try {
    const page = await app.firstWindow();
    currentPage = page;
    await page.locator('#startup').waitFor({ state: 'detached', timeout: 30_000 });
    let release, requested;
    const gate = new Promise((resolve) => { release = resolve; });
    const intercepted = new Promise((resolve) => { requested = resolve; });
    await page.route('**/assets/main-*.js', async (route) => { requested(); await gate; await route.continue(); });
    const navigation = page.reload({ waitUntil: 'domcontentloaded' });
    await Promise.race([intercepted, new Promise((_, reject) => setTimeout(() => reject(new Error('startup bundle not intercepted')), 10_000))]);
    await navigation;
    assert.equal(await page.locator('#startup').count(), 1);
    await app.evaluate(({ app }, file) => { app.emit('open-file', { preventDefault() {} }, file); }, src);
    await new Promise((resolve) => setTimeout(resolve, 200)); // let main finish stat/realpath while blocked.
    release();
    await page.locator('#startup').waitFor({ state: 'detached', timeout: 15_000 });
    await waitProjectLoaded(page);
    const edited = 'Take order (lazy-startup e2e)';
    await renameTomarPedido(page, edited);
    await saveViaMenu(app);
    await waitSaved(page);
    assertFixtureIntegrity(await readFile(src), { taskName: edited });
  } finally {
    await app.close();
  }
});

// =================================================================================================
// Route 3: recents (seed estado.json with the .lila in `recents`, open via the welcome screen).
// =================================================================================================
await step('opening from Recents (welcome screen) does not forward `file`, and a save works', async () => {
  const profile = join(WORK, 'recents-profile');
  const src = join(DOWNLOADS, 'recents.lila');
  await buildFixture(src);
  const realSrc = await realpath(src);
  await seedSessionState(profile, { recents: [{ dir: realSrc, name: 'pedido-e2e-378', openedAt: new Date().toISOString() }] });
  const { app, page } = await launch(profile);
  try {
    // The recent's button text is `<strong>name</strong><small>dir</small><time>…</time>`, so an
    // exact accessible-name match would have to include the relative-time text too; a substring
    // filter on the project name is enough and doesn't depend on wall-clock wording.
    await page.locator('.bienvenida-recientes button').filter({ hasText: 'pedido-e2e-378' }).click();
    await waitProjectLoaded(page);
    const edited = 'Take order (recents e2e)';
    await renameTomarPedido(page, edited);
    await saveViaMenu(app);
    await waitSaved(page);
    assertFixtureIntegrity(await readFile(realSrc), { taskName: edited });
  } finally {
    await app.close();
  }
});

// =================================================================================================
// Route 4: native open dialog override (dialog.showOpenDialog stubbed in the main process).
// =================================================================================================
await step('opening via the native Open dialog does not forward `file`, and a save works', async () => {
  const profile = join(WORK, 'opendialog-profile');
  const src = join(DOWNLOADS, 'opendialog.lila');
  await buildFixture(src);
  await seedSessionState(profile);
  const { app, page } = await launch(profile);
  try {
    await stubOpenDialog(app, src);
    // Welcome screen's "Open project (.lila)…" action (`openFile`): `fileOnly: true`, so
    // `chooseFolder(true)` opens `showOpenDialog` with `properties: ['openFile']` — the stub above
    // answers it with our fixture, exactly like a real native picker would.
    await page.locator('.bienvenida-accion').filter({ hasText: 'Open project (.lila)' }).click();
    await waitProjectLoaded(page);
    const edited = 'Take order (open-dialog e2e)';
    await renameTomarPedido(page, edited);
    await saveViaMenu(app);
    await waitSaved(page);
    assertFixtureIntegrity(await readFile(src), { taskName: edited });
  } finally {
    await app.close();
  }
});

// =================================================================================================
// Failure case: a read-only target. Save must fail, disk stays byte-identical, close-with-save
// keeps the window open with the edit.
// =================================================================================================
await step('a read-only .lila: Save fails, the file is untouched, close-with-save keeps the window open', async () => {
  const profile = join(WORK, 'readonly-profile');
  // `writeLilaFile` (`apps/desktop/src/lilaFile.ts`) writes a temp file next to the destination
  // and `rename`s it on top (atomic write) — `rename` only needs WRITE on the directory, not on
  // the target file itself, so chmod-ing just the `.lila` file would not actually make the save
  // fail. The directory is what has to be read-only.
  const readonlyDir = join(DOWNLOADS, 'readonly-dir');
  await mkdir(readonlyDir, { recursive: true });
  const src = join(readonlyDir, 'readonly.lila');
  await buildFixture(src);
  await seedSessionState(profile);
  const beforeBytes = await readFile(src);
  await chmod(readonlyDir, 0o555);
  const edited = 'Take order (readonly e2e)';
  const { app, page } = await launch(profile, { fileArg: src, env: { LILA_E2E_CLOSE: 'save' } });
  try {
    await waitProjectLoaded(page);
    await renameTomarPedido(page, edited);
    await saveViaMenu(app);
    // The footer must NOT flip to "Saved" — an error banner is expected instead.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const footer = await archivoText(page);
    assert.ok(!footer.includes('Saved'), `save on a read-only file should not report success: ${footer}`);
    const duringBytes = await readFile(src);
    assert.ok(beforeBytes.equals(duringBytes), 'a failed save must leave the file byte-identical');
    // Close-with-save: the save fails again, so the window must stay open with the edit intact.
    // `win.close()` via `evaluate`, NOT Playwright's own `app.close()`: when a close ends up
    // prevented (`event.preventDefault()` in `attachCloseGuard`, which is exactly what must
    // happen here), `app.close()` itself was observed to hang indefinitely — same failure mode as
    // `app.quit()` did for the "cancel" case above, and the fix is the same: drive the window
    // directly and verify state by polling the page, never by awaiting Playwright's close/quit.
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.close(); });
    // If the close instead (wrongly) succeeded, the window/page is gone and this poll itself times
    // out — that is a FAILURE, not a hang: `waitForFunction` always returns control after
    // `timeout`, whether the page is alive or not.
    await page.waitForFunction(() => document.querySelector('.archivo') !== null, undefined, { timeout: 10_000 })
      .catch(() => { throw new Error('the window did not stay open after a close with a failing save (data loss risk)'); });
    const footerAfterClose = await archivoText(page);
    assert.ok(footerAfterClose.includes('Unsaved'), `close-with-save must leave the window dirty/open, footer was ${JSON.stringify(footerAfterClose)}`);
    const input = await selectTomarPedido(page);
    assert.equal(await input.inputValue(), edited, 'the failed close must keep the edit in the window');
    const afterBytes = await readFile(src);
    assert.ok(beforeBytes.equals(afterBytes), 'a failed close-with-save must leave the file byte-identical');
  } finally {
    await chmod(readonlyDir, 0o755).catch(() => {});
    // Force-exit unconditionally, THEN let Playwright close: the window is still dirty and open at
    // this point on the success path (that is what was just asserted), so a plain `app.close()`
    // would hit the same guard and hang again.
    await app.evaluate(({ app }) => { app.exit(0); }).catch(() => {});
    await app.close().catch(() => {});
  }
});

// =================================================================================================
// Control: a loose .bpmn opened via the same launch path still saves as a .bpmn — no .lila created.
// =================================================================================================
await step('control: a loose .bpmn opened via launch path saves the .bpmn, no .lila is created', async () => {
  const profile = join(WORK, 'loose-bpmn-profile');
  const src = join(DOWNLOADS, 'loose-model.bpmn');
  await buildLooseBpmn(src);
  await seedSessionState(profile);
  const { app, page } = await launch(profile, { fileArg: src });
  try {
    await waitProjectLoaded(page);
    const edited = 'Take order (loose-bpmn e2e)';
    await renameTomarPedido(page, edited);
    await saveViaMenu(app);
    await waitSaved(page);
    const bytes = await readFile(src, 'utf8');
    assert.ok(bytes.includes(`name="${edited}"`), 'the .bpmn was not written with the edit');
    await stat(`${src}.lila`).then(() => { throw new Error('a .lila must NOT have been created for a loose .bpmn'); }, (error) => {
      assert.equal(error.code, 'ENOENT', `unexpected error checking for a stray .lila: ${error.message}`);
    });
  } finally {
    await app.close();
  }
});

// -- report -----------------------------------------------------------------------------------
const ok = results.every((r) => r.ok);
const report = { ok, generatedAt: new Date().toISOString(), workDir: WORK, evidenceDir: EVIDENCE_DIR, results };
const reportName = process.env.LILA_E2E_REPORT_NAME || 'report.json';
await writeFile(join(EVIDENCE_DIR, reportName), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok, failed: results.filter((r) => !r.ok).map((r) => r.name), reportPath: join(EVIDENCE_DIR, reportName) }, null, 2));
if (!process.env.LILA_E2E_KEEP) {
  await rm(WORK, { recursive: true, force: true }).catch(() => {});
}
if (!ok) process.exitCode = 1;
