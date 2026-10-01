/**
 * `lila export diagram|doc|results` (#538) over a `.lila` with stored runs: the engine's own
 * renderer, process document and result writers, no overwrite without --force, and clear errors
 * when there is no run to export.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { parseBpmn, renderSvg } from '../../src/bpmn/index.js';
import { main } from '../../src/cli.js';
import { elementsCsv } from '../../src/csv.js';
import { decodeLila } from '../../src/project/index.js';
import { exportDocument, exportResults } from '../../src/project-fs/index.js';
import { readWorkbook } from '../../src/xlsx-read.js';
import { EXAMPLE_LILA, pedidoWithRuns } from './export-fixture.js';

let dir: string;
let out: string[];
let err: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lila-export-'));
  out = [];
  err = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args) => void err.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

const XML = decodeLila(readFileSync(EXAMPLE_LILA)).model.xml;

describe('lila export diagram', () => {
  test('prints the SVG of the .lila on stdout, or writes it with --out, never over an existing file', async () => {
    const svg = await renderSvg(XML);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await main(['export', 'diagram', EXAMPLE_LILA])).toBe(0);
    expect(write.mock.calls.map((c) => String(c[0])).join('')).toBe(`${svg}\n`);
    write.mockRestore();

    const target = join(dir, 'd.svg');
    expect(await main(['export', 'diagram', EXAMPLE_LILA, '--out', target])).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(svg);
    writeFileSync(target, 'mine');
    expect(await main(['export', 'diagram', EXAMPLE_LILA, '--out', target])).toBe(1);
    expect(err.join('\n')).toMatch(/already exists; nothing was written. Pass --force/);
    expect(readFileSync(target, 'utf8')).toBe('mine');
    expect(await main(['export', 'diagram', EXAMPLE_LILA, '--out', target, '--force'])).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(svg);
    // No temporary file is left next to it.
    expect(existsSync(`${target}.tmp-${process.pid}-0`)).toBe(false);
  });

  test('a .bpmn works too; --process only with a .lila', async () => {
    const bpmn = join(dir, 'm.bpmn');
    writeFileSync(bpmn, XML);
    expect(await main(['export', 'diagram', bpmn, '--out', join(dir, 'm.svg')])).toBe(0);
    expect(readFileSync(join(dir, 'm.svg'), 'utf8')).toBe(await renderSvg(XML));
    expect(await main(['export', 'diagram', bpmn, '--process', 'x'])).toBe(1);
  });
});

describe('lila export doc', () => {
  test('HTML with the SVG diagram and the results of the current run', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, ['as-is.scenario.json']);
    const target = join(dir, 'p.html');
    expect(await main(['export', 'doc', file, '--out', target])).toBe(0);
    expect(out).toEqual([`HTML: ${target}`]);
    const html = readFileSync(target, 'utf8');
    const svg = await renderSvg(XML);
    expect(html).toContain(`<img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}"`);
    expect(html).toContain('<h2>Results</h2>');
    expect(err).toEqual(['The charts of the run are left out: the engine has no rasteriser.']);
  });

  test('Word: a .docx that unzips, with the results and without the diagram, in Spanish', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, ['to-be-3-cajeros.scenario.json']);
    const target = join(dir, 'p.docx');
    expect(await main(['--lang', 'es', 'export', 'doc', file, '--out', target])).toBe(0);
    const parts = unzipSync(readFileSync(target));
    expect(Object.keys(parts)).not.toContain('word/media/diagram.png');
    const body = strFromU8(parts['word/document.xml']!);
    expect(body).toContain('Resultados');
    expect(body).not.toContain('<w:drawing>');
    expect(err).toContain('El documento Word va sin diagrama: Word necesita un PNG y el motor no rasteriza. El documento HTML sí lo lleva.');
  });

  test('without a current run the document goes without results; an older run by id is refused', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, ['as-is.scenario.json'], { stale: true });
    const doc = await exportDocument({ file, format: 'html', date: '2026-09-30' });
    expect(doc.run).toBeNull();
    expect(doc.notes).toContain('No current run: the document has the model and no results.');
    expect(doc.data).not.toContain('<h2>Results</h2>');
    await expect(exportDocument({ file, format: 'html', run: 'run-1' })).rejects.toThrow(/older model or scenario/);
    // "latest" said explicitly is a request for a run.
    await expect(exportDocument({ file, format: 'html', run: 'latest' })).rejects.toThrow(/no run of its current model and scenario; older runs: run-1 \(as-is.scenario.json\)/);
  });

  test('the format comes from --out or --format; a .bpmn is refused', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, []);
    expect(await main(['export', 'doc', file, '--out', join(dir, 'p.pdf')])).toBe(1);
    expect(err.at(-1)).toMatch(/choose a format with --format: docx, html/);
    expect(await main(['export', 'doc', file, '--out', join(dir, 'p'), '--format', 'html'])).toBe(0);
    expect(await main(['export', 'doc', file])).toBe(1);
    expect(err.at(-1)).toMatch(/needs --out/);
    const bpmn = join(dir, 'm.bpmn');
    writeFileSync(bpmn, XML);
    expect(await main(['export', 'doc', bpmn, '--out', join(dir, 'x.html')])).toBe(1);
    expect(err.at(-1)).toMatch(/is not a .lila project/);
  });
});

describe('lila export results', () => {
  test('xlsx: the workbook of the run, readable', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, ['as-is.scenario.json']);
    const target = join(dir, 'r.xlsx');
    expect(await main(['export', 'results', file, '--out', target])).toBe(0);
    const sheets = readWorkbook(readFileSync(target));
    expect(sheets.map((s) => s.name)).toEqual(['Summary', 'Elements', 'Flows', 'Resources', 'Parameters']);
  });

  test('csv: four files in the directory, the same as lila run --csv writes', async () => {
    const file = join(dir, 'p.lila');
    const [run] = await pedidoWithRuns(file, ['as-is.scenario.json']);
    const target = join(dir, 'csv');
    expect(await main(['export', 'results', file, '--out', target, '--format', 'csv'])).toBe(0);
    expect(out.map((line) => line.replace(`${target}/`, ''))).toEqual([
      'CSV: elements.csv', 'CSV: flows.csv', 'CSV: resources.csv', 'CSV: process.csv',
    ]);
    const { ir } = await parseBpmn(XML);
    expect(readFileSync(join(target, 'elements.csv'), 'utf8')).toBe(elementsCsv(ir, run!.result));
    // A second export refuses before writing any file.
    writeFileSync(join(target, 'process.csv'), 'mine');
    expect(await main(['export', 'results', file, '--out', target, '--format', 'csv'])).toBe(1);
    expect(readFileSync(join(target, 'process.csv'), 'utf8')).toBe('mine');
  });

  test('clear errors: no run, several scenarios, unknown id; an older run exports by id', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, []);
    await expect(exportResults({ file, format: 'xlsx' })).rejects.toThrow(/has no stored run. Simulate it in Lila Modeler/);
    await expect(exportResults({ file, format: 'xlsx', locale: 'es' })).rejects.toThrow(/no tiene corridas guardadas/);

    await pedidoWithRuns(file, ['as-is.scenario.json', 'to-be-3-cajeros.scenario.json']);
    await expect(exportResults({ file, format: 'xlsx' })).rejects.toThrow(/current runs of several scenarios \(as-is.scenario.json, to-be-3-cajeros.scenario.json\)/);
    expect((await exportResults({ file, format: 'xlsx', scenario: 'to-be-3-cajeros' })).run).toEqual({ id: 'run-2', scenario: 'to-be-3-cajeros.scenario.json', current: true });
    await expect(exportResults({ file, format: 'xlsx', run: 'nope' })).rejects.toThrow(/has no run "nope"; its runs are: run-1 \(as-is.scenario.json\), run-2/);

    await pedidoWithRuns(file, ['as-is.scenario.json'], { stale: true });
    await expect(exportResults({ file, format: 'xlsx' })).rejects.toThrow(/older runs: run-1/);
    expect((await exportResults({ file, format: 'csv', run: 'run-1' })).run.current).toBe(false);
  });
});

test('lila export with a wrong kind or arity says what it expects', async () => {
  expect(await main(['export', 'pdf', EXAMPLE_LILA])).toBe(1);
  expect(err.at(-1)).toBe('lila export: unknown export "pdf": expected diagram, doc or results.');
  expect(await main(['export'])).toBe(1);
  expect(err.at(-1)).toMatch(/expected diagram\|doc\|results and a <model.bpmn\|project.lila>/);
});
