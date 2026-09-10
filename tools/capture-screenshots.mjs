/** Capture real browser pixels and exercise the Pages project round-trip. See docs/design/en/README.md. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', timezoneId: 'America/Mexico_City', deviceScaleFactor: 1 });
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
    return { destination, document: JSON.parse(await readFile(destination, 'utf8')) };
  }
  const session = () => page.evaluate(() => JSON.parse(localStorage.getItem('lila.project.v1')).project);
  await page.goto(url); await ready();
  // Set the actual settings through the UI, without overriding application rendering or state.
  await button('Settings').click(); assert.equal(await page.locator('dialog[open] select').nth(1).inputValue(), 'eva-01'); await page.getByLabel('Language', { exact: true }).selectOption('en'); await button('Close').click();
  await selectTask(); await page.getByLabel('Name', { exact: true }).fill('Take order — checked'); await page.getByLabel('Name', { exact: true }).press('Tab');
  await button('Simulate').click();
  await page.getByLabel('seed', { exact: true }).fill('43'); await page.getByLabel('seed', { exact: true }).press('Tab');
  assert.equal(await page.getByLabel('seed', { exact: true }).inputValue(), '43');
  await page.getByLabel('seed', { exact: true }).fill('42'); await page.getByLabel('seed', { exact: true }).press('Tab');
  await run();
  await button('Simulate').click(); await page.locator('.simulacion > label > select').selectOption({ label: 'TO-BE 3 cashiers' }); await run();
  await button('Compare').click();
  assert.match(await page.locator('body').innerText(), /TO-BE 3 cashiers/);
  const saved = await save(); assert.equal(saved.document.runs.length, 2);
  assert.deepEqual(saved.document.runs.map(r => r.scenarioName).sort(), ['as-is.scenario.json', 'to-be-3-cajeros.scenario.json']);
  for (const r of saved.document.runs) { assert.equal(r.inputs.scenario.run.seed, 42); assert.equal(r.inputs.scenario.run.replications, 30); assert.ok(Object.keys(r.result.elements).length > 0); } assert.match(saved.document.model.xml, /Take order — checked/);
  assert.equal(saved.document.scenarios['as-is.scenario.json'].run.seed, 42);
  await page.reload(); await ready(); assert.deepEqual(await session(), saved.document);
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
  await button('Settings').click(); assert.equal(await page.locator('dialog[open] select').nth(1).inputValue(), 'eva-01'); await page.getByLabel('Language', { exact: true }).selectOption('en'); await button('Close').click();
  const cdp = await context.newCDPSession(page);
  async function capture(name, canvas = true) {
    assert.doesNotMatch(await page.locator('body').innerText(), /\b(Modelar|Simular|Resultados|Comparar|Ajustes)\b/);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg-base').trim().toUpperCase()), '#12101A');
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
  await page.locator('summary').filter({ hasText: /^Run$/ }).click();
  await page.locator('summary').filter({ hasText: /^Calendars$/ }).click();
  await capture('calendar');
  await page.locator('.djs-container').first().click({ position: { x: 600, y: 650 } });
  await run(); await capture('results', false);
  await button('Simulate').click(); await capture('overlay');
  await page.locator('.simulacion > label > select').selectOption({ label: 'TO-BE 3 cashiers' }); await run();
  await button('Compare').click(); await save(); await page.reload(); await ready(); await button('Compare').click();
  await capture('compare', false);
  await button('Validate paths').click(); await button('Properties').click(); await capture('routes');
  await button('Model').click(); await button('Fit to screen').click(); await button('Settings').click(); await capture('appearance', false); await button('Close').click();
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'capture-manifest.json'), JSON.stringify({
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    browser: await browser.version(), locale: 'en-US', timezone: 'America/Mexico_City', theme: 'Eva-01', seed: 42, replications: 30,
    path: '/lila-modeler/app/', acceptance: 'edit, simulate both scenarios, compare, explicit save, reload, discard unsaved edits, reopen download: PASS',
    screenshots,
  }, null, 2) + '\n');
  await context.close();
} finally { await browser.close(); server.close(); await rm(temporary, { recursive: true, force: true }); }
