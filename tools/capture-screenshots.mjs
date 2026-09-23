/** Capture real browser pixels and exercise the Pages project round-trip. See docs/design/en/README.md. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeLila } from '@lila/engine/project';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'docs/design/en');
const temporary = await mkdtemp(path.join(tmpdir(), 'lila-capture-'));
const site = path.join(root, '_site');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/lila-modeler/')) throw new Error('Invalid base');
    let relative = decodeURIComponent(url.pathname.slice('/lila-modeler/'.length));
    if (!relative || relative.endsWith('/')) relative += 'index.html';
    const file = path.resolve(site, relative);
    if (!file.startsWith(site + path.sep)) throw new Error('Invalid path');
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.statusCode = 404; res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const screenshots = [];
try {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/Mexico_City', deviceScaleFactor: 1, colorScheme: 'light' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}/lila-modeler/app/`;
  const button = name => page.getByRole('button', { name, exact: true });
  const task = () => page.locator('g.djs-element[data-element-id="Task_TomarPedido"]').first();
  async function ready() { await button('Run simulation').waitFor(); await task().waitFor(); await page.evaluate(() => document.fonts.ready); }
  async function selectTask() { await button('Model').click(); await task().click(); await button('Properties').click(); }
  async function run() {
    await button('Run simulation').click();
    await page.getByText('Scenario AS-IS · seed 42', { exact: false }).or(page.getByText('Scenario TO-BE 3 cashiers · seed 42', { exact: false })).first().waitFor({ timeout: 120000 });
    await button('Run simulation').waitFor({ timeout: 120000 });
  }
  async function save() {
    await page.locator('.menu-archivo > summary').click();
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.menu-archivo').getByRole('button', { name: 'Save', exact: true }).click();
    const download = await downloadPromise;
    const destination = path.join(temporary, download.suggestedFilename());
    await download.saveAs(destination);
    return { destination, document: decodeLila(new Uint8Array(await readFile(destination))) };
  }
  await page.goto(url); await ready();
  // Set the actual settings through the UI, without overriding application rendering or state.
  await button('Settings').click(); assert.equal(await page.locator('dialog[open] select').nth(1).inputValue(), 'lila-light'); await page.getByLabel('Language', { exact: true }).selectOption('en'); await button('Close').click();
  await selectTask(); await page.getByLabel('Name', { exact: true }).fill('Take order — checked'); await page.getByLabel('Name', { exact: true }).press('Tab');
  await button('Simulate').click();
  await page.getByLabel('Seed', { exact: true }).fill('43'); await page.getByLabel('Seed', { exact: true }).press('Tab');
  assert.equal(await page.getByLabel('Seed', { exact: true }).inputValue(), '43');
  await page.getByLabel('Seed', { exact: true }).fill('42'); await page.getByLabel('Seed', { exact: true }).press('Tab');
  await run();
  await button('Simulate').click(); await page.locator('.rail-fila', { hasText: 'TO-BE' }).click(); await run();
  await button('Compare').click();
  assert.match(await page.locator('body').innerText(), /TO-BE 3 cashiers/);
  const saved = await save(); assert.equal(saved.document.runs.length, 2);
  assert.deepEqual(saved.document.runs.map(r => r.scenarioName).sort(), ['as-is.scenario.json', 'to-be-3-cajeros.scenario.json']);
  for (const r of saved.document.runs) { assert.equal(r.inputs.scenario.run.seed, 42); assert.equal(r.inputs.scenario.run.replications, 30); assert.ok(Object.keys(r.result.elements).length > 0); } assert.match(saved.document.model.xml, /Take order — checked/);
  assert.equal(saved.document.scenarios['as-is.scenario.json'].run.seed, 42);
  await page.reload(); await ready(); assert.deepEqual((await save()).document, saved.document);
  await selectTask(); assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Take order — checked');
  await page.getByLabel('Name', { exact: true }).fill('UNSAVED EDIT'); await page.getByLabel('Name', { exact: true }).press('Tab');
  await page.reload(); await ready(); await selectTask(); assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), 'Take order — checked');
  await page.locator('.menu-archivo > summary').click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.menu-archivo').getByRole('button', { name: 'Open', exact: true }).click();
  await (await chooserPromise).setFiles(saved.destination); await ready();
  const reopened = await save(); assert.deepEqual(reopened.document, saved.document);
  console.log('PASS: edit BPMN, numeric scenario edit, both 30-replication seed-42 simulations, compare, download, reload, discard unsaved edit, reopen downloaded project.');
  // Clear this disposable context's saved project to capture the unchanged maintained example.
  await page.evaluate(() => localStorage.clear()); await page.reload(); await ready();
  await button('Settings').click(); assert.equal(await page.locator('dialog[open] select').nth(1).inputValue(), 'lila-light'); await page.getByLabel('Language', { exact: true }).selectOption('en'); await button('Close').click();
  const cdp = await context.newCDPSession(page);
  async function capture(name, canvas = true) {
    assert.doesNotMatch(await page.locator('body').innerText(), /\b(Modelar|Simular|Resultados|Comparar|Ajustes)\b/);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim().toUpperCase()), '#FAF8EE');
    for (const [width, height] of [[1440, 900], [1920, 1080]]) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(150); // Allow ResizeObserver and the diagram viewport to settle.
      if (canvas) await button('Fit to screen').click();
      await page.mouse.move(width - 4, height - 4);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const bytes = Buffer.from(data, 'base64');
      assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
      assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
      const file = `${name}${width === 1440 ? '' : '-1920'}.png`;
      await writeFile(path.join(output, file), bytes); screenshots.push({ file, width, height });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    console.log('Captured', name);
  }
  await capture('model');
  await selectTask(); await capture('properties');
  await button('Documentation').click(); await capture('documentation');
  await button('Simulate').click(); await capture('simulate');
  await button('4 · Calendar analysis').click(); await capture('calendar'); // Step 4 of the Simulate panel (#333).
  await page.locator('.djs-container').first().click({ position: { x: 600, y: 650 } });
  await run(); await capture('results', false);
  // Animate (#331): the replay of the event log, paused mid-run so the counters are readable.
  await page.locator('.zona-resultados').getByRole('button', { name: 'Play', exact: true }).click();
  await page.locator('.replay select').waitFor();
  await page.locator('.replay select').selectOption('600'); // 600x: ~2.5 simulated hours in 15 s, with cases still in flight.
  await page.locator('.replay').getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(15000);
  await page.locator('.replay').getByRole('button', { name: 'Pause', exact: true }).click();
  await capture('animate', false);
  await button('Simulate').click(); await capture('overlay');
  await page.locator('.rail-fila', { hasText: 'TO-BE' }).click(); await run();
  await button('Compare').click(); await save(); await page.reload(); await ready(); await button('Compare').click();
  await capture('compare', false);
  await button('Validate paths').click(); await button('Properties').click(); await capture('routes');
  await button('Model').click(); await button('Fit to screen').click(); await button('Settings').click(); await capture('appearance', false); await button('Close').click();
  assert.deepEqual(errors, []);
  // Lila Dark is what a dark-mode system gets on first launch (#404): one Model capture per size,
  // from a fresh context (no saved theme) with the dark scheme emulated, so nothing else changes.
  const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/Mexico_City', deviceScaleFactor: 1, colorScheme: 'dark' });
  const darkPage = await dark.newPage(); darkPage.on('pageerror', error => errors.push(error.message));
  await darkPage.goto(url); await darkPage.getByRole('button', { name: 'Run simulation', exact: true }).waitFor(); await darkPage.evaluate(() => document.fonts.ready);
  assert.equal(await darkPage.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim().toUpperCase()), '#1C0F2E');
  const darkCdp = await dark.newCDPSession(darkPage);
  for (const [width, height] of [[1440, 900], [1920, 1080]]) {
    await darkPage.setViewportSize({ width, height }); await darkPage.waitForTimeout(150);
    await darkPage.getByRole('button', { name: 'Fit to screen', exact: true }).click(); await darkPage.mouse.move(width - 4, height - 4); await darkPage.waitForTimeout(250);
    const bytes = Buffer.from((await darkCdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })).data, 'base64');
    assert.equal(bytes.readUInt32BE(16), width); assert.equal(bytes.readUInt32BE(20), height);
    const file = `theme-lila-dark${width === 1440 ? '' : '-1920'}.png`;
    await writeFile(path.join(output, file), bytes); screenshots.push({ file, width, height });
  }
  console.log('Captured theme-lila-dark'); await dark.close();
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'capture-manifest.json'), JSON.stringify({
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    browser: await browser.version(), locale: 'en-US', timezone: 'America/Mexico_City', theme: 'Lila Light', seed: 42, replications: 30,
    path: '/lila-modeler/app/', acceptance: 'edit, simulate both scenarios, compare, explicit save, reload, discard unsaved edits, reopen download: PASS',
    screenshots,
  }, null, 2) + '\n');
  await context.close();
} finally { await browser.close(); server.close(); await rm(temporary, { recursive: true, force: true }); }
