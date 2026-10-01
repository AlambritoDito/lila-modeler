/**
 * The export tools (#538) through the real `lila mcp` over stdio, as an agent would call them:
 * the diagram, the document (Word and HTML) and the results (xlsx and csv) of a `.lila` with a
 * stored run, written with no app running. Requires `dist/` (built before the tests).
 */
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { pedidoWithRuns } from '../../engine/test/project-fs/export-fixture.js';
import { readWorkbook } from '../../engine/src/xlsx-read.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');

let client: Client;
let temp: string;
let project: string;

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
  return { isError: result.isError === true, text };
}

beforeAll(async () => {
  // The real path: the server resolves `saveTo` against its cwd, which the OS reports resolved.
  temp = realpathSync(mkdtempSync(join(tmpdir(), 'lila-mcp-export-')));
  project = join(temp, 'pedido.lila');
  await pedidoWithRuns(project, ['as-is.scenario.json']);
  client = new Client({ name: 'lila-export-e2e', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd: temp }));
}, 120_000);

afterAll(async () => {
  await client.close();
  rmSync(temp, { recursive: true, force: true });
});

test('export_diagram returns the SVG, or writes it, and never overwrites without `overwrite`', async () => {
  const inline = await call('export_diagram', { project: 'pedido.lila' });
  expect(inline.isError).toBe(false);
  const { svg, process } = JSON.parse(inline.text) as { svg: string; process: string };
  expect(process).toBe('pedido');
  expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);

  const saved = await call('export_diagram', { project: 'pedido.lila', saveTo: 'out/d.svg' });
  expect(JSON.parse(saved.text).file).toBe(`${temp}/out/d.svg`.replaceAll('\\', '/'));
  expect(readFileSync(join(temp, 'out/d.svg'), 'utf8')).toBe(svg);

  const again = await call('export_diagram', { project: 'pedido.lila', saveTo: 'out/d.svg' });
  expect(again.isError).toBe(true);
  expect(again.text).toMatch(/^export_diagram: .*already exists; nothing was written/);
  expect((await call('export_diagram', { project: 'pedido.lila', saveTo: 'out/d.svg', overwrite: true })).isError).toBe(false);

  expect((await call('export_diagram', {})).text).toBe('export_diagram: pass `project` or `path`.');
}, 120_000);

test('export_document: HTML with the SVG and the run; Word that unzips, with notes', async () => {
  const html = await call('export_document', { project: 'pedido.lila', format: 'html', saveTo: 'doc.html' });
  expect(html.isError).toBe(false);
  const answer = JSON.parse(html.text);
  expect(answer.run).toEqual({ id: 'run-1', scenario: 'as-is.scenario.json', current: true });
  expect(answer.notes).toEqual(['The charts of the run are left out: the engine has no rasteriser.']);
  const page = readFileSync(join(temp, 'doc.html'), 'utf8');
  expect(page).toContain('<img src="data:image/svg+xml;base64,');
  expect(page).toContain('<h2>Results</h2>');

  const docx = await call('export_document', { project: 'pedido.lila', format: 'docx', saveTo: 'doc.docx', locale: 'es' });
  expect(docx.isError).toBe(false);
  expect(JSON.parse(docx.text).notes[0]).toMatch(/^El documento Word va sin diagrama/);
  const parts = unzipSync(readFileSync(join(temp, 'doc.docx')));
  expect(strFromU8(parts['word/document.xml']!)).toContain('Resultados');
}, 120_000);

test('export_results: an xlsx readWorkbook opens, CSV files, and a clear error without a run', async () => {
  const xlsx = await call('export_results', { project: 'pedido.lila', format: 'xlsx', saveTo: 'r.xlsx' });
  expect(xlsx.isError).toBe(false);
  expect(readWorkbook(readFileSync(join(temp, 'r.xlsx'))).map((s) => s.name)).toContain('Elements');

  const csv = await call('export_results', { project: 'pedido.lila', format: 'csv', saveTo: 'csv' });
  expect(JSON.parse(csv.text).files).toHaveLength(4);
  expect(readdirSync(join(temp, 'csv')).sort()).toEqual(['elements.csv', 'flows.csv', 'process.csv', 'resources.csv']);

  const empty = join(temp, 'empty.lila');
  await pedidoWithRuns(empty, []);
  const none = await call('export_results', { project: 'empty.lila', format: 'xlsx', saveTo: 'none.xlsx' });
  expect(none.isError).toBe(true);
  expect(none.text).toMatch(/^export_results: process "pedido" of .*empty.lila has no stored run/);
  writeFileSync(join(temp, 'm.bpmn'), '<x/>');
  expect((await call('export_document', { project: 'm.bpmn', format: 'html', saveTo: 'x.html' })).text).toMatch(/is not a .lila project/);
}, 120_000);

test('run_simulation with saveRun stores the run; export_document then has the results', async () => {
  const fresh = join(temp, 'fresh.lila');
  await pedidoWithRuns(fresh, []);
  const noRun = await call('export_document', { project: 'fresh.lila', format: 'html', saveTo: 'before.html' });
  expect(JSON.parse(noRun.text).run).toBeNull();

  const result = await client.callTool({
    name: 'run_simulation',
    arguments: { model: 'fresh.lila', scenario: 'as-is', seed: 42, replications: 1, saveRun: true },
  });
  expect(result.isError ?? false).toBe(false);
  const blocks = result.content as { type: string; text: string }[];
  const { savedRun } = JSON.parse(blocks[1]!.text) as { savedRun: { id: string; process: string; scenario: string } };
  expect(savedRun).toMatchObject({ process: 'pedido', scenario: 'as-is.scenario.json' });

  const after = await call('export_document', { project: 'fresh.lila', format: 'html', saveTo: 'after.html' });
  expect(JSON.parse(after.text).run).toEqual({ id: savedRun.id, scenario: 'as-is.scenario.json', current: true });
  expect(readFileSync(join(temp, 'after.html'), 'utf8')).toContain('<h2>Results</h2>');

  // Without a .lila, or with an inline scenario, there is nowhere to store it.
  const bpmn = await call('run_simulation', { model: join(repo, 'examples/pedido/model.bpmn'), scenario: join(repo, 'examples/pedido/as-is.scenario.json'), saveRun: true });
  expect(bpmn.text).toMatch(/^run_simulation: saving the run .* needs a .lila model/);
}, 120_000);
