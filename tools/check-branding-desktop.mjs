/** Ensure files opened during the lazy startup are queued until the renderer subscribes. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const { _electron } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const temp = await realpath(await mkdtemp(join(tmpdir(), 'lila-brand-startup-')));
const file = join(temp, 'queued.bpmn');
await writeFile(file, await readFile(join(root, 'examples/pedido/model.bpmn')));
let app;
try {
  app = await _electron.launch({ executablePath: require('electron'), args: [join(root, 'apps/desktop'), `--user-data-dir=${join(temp, 'profile')}`], env: { ...process.env, LILA_E2E_CLOSE: 'discard' } });
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), join(temp, 'profile'));
  const page = await app.firstWindow();
  await page.locator('#startup').waitFor({ state: 'detached' });
  let release, requested;
  const gate = new Promise(resolve => { release = resolve; });
  const intercepted = new Promise(resolve => { requested = resolve; });
  await page.route('**/assets/main-*.js', async route => { requested(); await gate; await route.continue(); });
  const navigation = page.reload({ waitUntil: 'domcontentloaded' });
  await Promise.race([intercepted, new Promise((_, reject) => setTimeout(() => reject(Error('Startup bundle was not intercepted')), 10_000))]);
  await navigation;
  assert.equal(await page.locator('#startup').count(), 1);
  await app.evaluate(({ app }, file) => { app.emit('open-file', { preventDefault() {} }, file); }, file);
  // Let main finish stat/realpath while the editor bundle remains blocked.
  await new Promise(resolve => setTimeout(resolve, 200));
  release();
  await page.locator('#startup').waitFor({ state: 'detached' });
  await page.locator('.archivo').filter({ hasText: 'queued.bpmn' }).waitFor();
  console.log('PASS: Electron preserves open-file requests received during lazy startup.');
} finally { if (app) await app.close(); await rm(temp, { recursive: true, force: true }); }
