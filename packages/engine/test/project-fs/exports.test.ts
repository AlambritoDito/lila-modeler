/**
 * `lila export diagram|doc|results` (#538) over a `.lila` with stored runs: the engine's own
 * renderer, process document and result writers, no overwrite without --force, and clear errors
 * when there is no run to export.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { parseBpmn, renderSvg } from '../../src/bpmn/index.js';
import { main } from '../../src/cli.js';
import { elementsCsv } from '../../src/csv.js';
import { decodeLila } from '../../src/project/index.js';
import { bottleneckCut, heatMap, WAIT_LEVEL_COLOURS } from '../../src/bottleneck-levels.js';
import type { RunResult } from '../../src/core/result.js';
import { exportDiagram, exportDocument, exportResults } from '../../src/project-fs/index.js';
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

/** `id → fill` of every element the overlay tinted (its first child takes a level colour). */
function tinted(svg: string): Record<string, string> {
  const colours = new Set(Object.values(WAIT_LEVEL_COLOURS));
  const out: Record<string, string> = {};
  for (const m of svg.matchAll(/<g data-element-id="([^"]*)"[^>]*><[a-z]+ [^>]*?fill="([^"]*)" stroke="([^"]*)"/g)) {
    if (colours.has(m[2]!)) {
      expect(m[3]).toBe(m[2]);
      out[m[1]!] = m[2]!;
    }
  }
  return out;
}

describe('lila export diagram --overlay (#669)', () => {
  test('bottlenecks tints exactly the cut, heatmap every measured task, with the token colours; same bytes', async () => {
    const file = join(dir, 'p.lila');
    const [run] = await pedidoWithRuns(file, ['as-is.scenario.json']);
    const result = run!.result as RunResult;
    const { ir } = await parseBpmn(XML);
    const cut = bottleneckCut(result);
    expect(cut.length).toBeGreaterThan(0);

    const bottlenecks = await exportDiagram({ file, overlay: 'bottlenecks' });
    expect(bottlenecks.run).toEqual({ id: 'run-1', scenario: 'as-is.scenario.json', current: true });
    const fileId = (id: string): string => ir.source.originalIds[id] ?? id;
    expect(tinted(bottlenecks.svg)).toEqual(Object.fromEntries(cut.map((e) => [fileId(e.elementId), WAIT_LEVEL_COLOURS[e.level]])));
    // One badge per tinted task: its mean wait and its resource's utilization.
    expect(bottlenecks.svg.match(/<tspan x="4" /g)!.length).toBe(cut.length);
    expect(bottlenecks.svg).toContain(`· ${Math.round(cut[0]!.utilization * 100)}%</tspan>`);

    const heat = await exportDiagram({ file, overlay: 'heatmap' });
    const tasks = Object.keys(ir.nodes).filter((id) => ir.nodes[id]!.type === 'task');
    const map = heatMap(result, tasks);
    const expected = Object.fromEntries(Object.entries(map).map(([id, e]) => [fileId(id), WAIT_LEVEL_COLOURS[e.level]]));
    for (const e of cut) expected[fileId(e.elementId)] = WAIT_LEVEL_COLOURS[e.level];
    expect(tinted(heat.svg)).toEqual(expected);
    expect(Object.keys(expected).length).toBeGreaterThan(cut.length);
    expect(heat.svg).toContain('>BOTTLENECK Wait ');
    expect((await exportDiagram({ file, overlay: 'heatmap', locale: 'es' })).svg).toContain('>CUELLO Espera ');

    // Same input, same bytes; without an overlay, the plain drawing.
    expect((await exportDiagram({ file, overlay: 'bottlenecks' })).svg).toBe(bottlenecks.svg);
    expect((await exportDiagram({ file, overlay: 'heatmap' })).svg).toBe(heat.svg);
    expect((await exportDiagram({ file })).svg).toBe(await renderSvg(XML));

    // The CLI writes the same SVG.
    const target = join(dir, 'b.svg');
    expect(await main(['export', 'diagram', file, '--overlay', 'bottlenecks', '--out', target])).toBe(0);
    expect(readFileSync(target, 'utf8')).toBe(bottlenecks.svg);
  });

  test('an overlay without a run fails clearly (en/es); a run without an overlay, or another overlay, too', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, []);
    await expect(exportDiagram({ file, overlay: 'bottlenecks' })).rejects.toThrow(/^overlay "bottlenecks" needs a stored run: process "pedido" of .* has no stored run/);
    await expect(exportDiagram({ file, overlay: 'heatmap', locale: 'es' })).rejects.toThrow(/^la capa "heatmap" necesita una corrida guardada: .*no tiene corridas guardadas/);
    expect(await main(['export', 'diagram', file, '--overlay', 'heatmap'])).toBe(1);
    expect(err.join('\n')).toMatch(/overlay "heatmap" needs a stored run/);

    const bpmn = join(dir, 'm.bpmn');
    writeFileSync(bpmn, XML);
    await expect(exportDiagram({ file: bpmn, overlay: 'heatmap' })).rejects.toThrow(/m\.bpmn is not a \.lila project: an overlay colours the diagram with a stored run/);
    await expect(exportDiagram({ file: bpmn, overlay: 'heatmap', locale: 'es' })).rejects.toThrow(/no es un proyecto \.lila: una capa colorea/);

    await pedidoWithRuns(file, ['as-is.scenario.json']);
    await expect(exportDiagram({ file, run: 'run-1' })).rejects.toThrow(/only applies to the diagram with an overlay/);
    await expect(exportDiagram({ file, scenario: 'as-is' })).rejects.toThrow(/only applies to the diagram with an overlay/);
    expect(await main(['export', 'diagram', file, '--overlay', 'utilization'])).toBe(1);
    expect(err.join('\n')).toMatch(/--overlay only accepts: bottlenecks, heatmap; got "utilization"/);
  });

  test('runs are selected as for the document; an older run by id is drawn, marked not current', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, ['as-is.scenario.json', 'to-be-3-cajeros.scenario.json']);
    await expect(exportDiagram({ file, overlay: 'heatmap' })).rejects.toThrow(/^process "pedido" of .* has current runs of several scenarios/);
    // A selection error is the selection's own message, not "needs a stored run".
    await expect(exportDiagram({ file, overlay: 'heatmap', run: 'run-1', scenario: 'as-is' })).rejects.toThrow(/^a run id already says which scenario/);
    expect((await exportDiagram({ file, overlay: 'heatmap', scenario: 'to-be-3-cajeros' })).run?.id).toBe('run-2');
    expect((await exportDiagram({ file, overlay: 'heatmap', run: 'run-1' })).run?.id).toBe('run-1');
    await expect(exportDiagram({ file, overlay: 'heatmap', run: 'nope' })).rejects.toThrow(/has no run "nope"/);

    await pedidoWithRuns(file, ['as-is.scenario.json'], { stale: true });
    await expect(exportDiagram({ file, overlay: 'bottlenecks' })).rejects.toThrow(/older runs: run-1/);
    const old = await exportDiagram({ file, overlay: 'bottlenecks', run: 'run-1' });
    expect(old.run).toEqual({ id: 'run-1', scenario: 'as-is.scenario.json', current: false });
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
    await expect(exportResults({ file, format: 'xlsx' })).rejects.toThrow(/has no stored run. Simulate it with `lila run <file> <scenario> --save`/);
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

describe('the source file is never a destination (QA of #552)', () => {
  test('--out the project itself, with --force, by another spelling or through a symlink, is refused', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, ['as-is.scenario.json']);
    const before = readFileSync(file);
    const attempts: string[][] = [
      ['export', 'doc', file, '--out', file, '--format', 'html', '--force'],
      ['export', 'diagram', file, '--out', file, '--force'],
      ['export', 'results', file, '--out', file, '--format', 'xlsx', '--force'],
    ];
    const upper = join(dir, 'P.LILA');
    // A case-insensitive disk (macOS, Windows) reaches the same file by another spelling.
    if (existsSync(upper)) attempts.push(['export', 'diagram', file, '--out', upper, '--force']);
    symlinkSync(file, join(dir, 'link.lila'));
    attempts.push(['export', 'doc', file, '--out', join(dir, 'link.lila'), '--format', 'html', '--force']);
    for (const argv of attempts) {
      expect(await main(argv), argv.join(' ')).toBe(1);
      expect(err.at(-1)).toMatch(/is the file being exported; nothing was written. Choose another destination./);
    }
    expect(readFileSync(file).equals(before)).toBe(true);
    // Without --force the message is the same: it never suggests overwriting the project.
    expect(await main(['export', 'doc', file, '--out', file, '--format', 'html'])).toBe(1);
    expect(err.at(-1)).not.toMatch(/--force/);
    // A .bpmn source too.
    const bpmn = join(dir, 'm.bpmn');
    writeFileSync(bpmn, XML);
    expect(await main(['export', 'diagram', bpmn, '--out', bpmn, '--force'])).toBe(1);
    expect(readFileSync(bpmn, 'utf8')).toBe(XML);
  });

  test('an --out ending in a slash names no file', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, []);
    expect(await main(['export', 'doc', file, '--out', `${dir}/docs/`, '--format', 'html'])).toBe(1);
    expect(err.at(-1)).toMatch(/ends with a slash; name the file to write/);
  });
});

describe('run selection', () => {
  test('--run with --scenario is an error; --scenario with only older runs is too, for the document', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, ['as-is.scenario.json'], { stale: true });
    await expect(exportDocument({ file, format: 'html', run: 'run-1', scenario: 'as-is' })).rejects.toThrow(/pass --run <id> or --scenario/);
    await expect(exportDocument({ file, format: 'html', scenario: 'as-is' })).rejects.toThrow(/no run of its current model and scenario; older runs: run-1/);
    // Nothing named: the document goes without results.
    expect((await exportDocument({ file, format: 'html' })).run).toBeNull();
  });
});

test('lila export with a wrong kind or arity says what it expects', async () => {
  expect(await main(['export', 'pdf', EXAMPLE_LILA])).toBe(1);
  expect(err.at(-1)).toBe('lila export: unknown export "pdf": expected diagram, doc or results.');
  expect(await main(['export'])).toBe(1);
  expect(err.at(-1)).toMatch(/expected diagram\|doc\|results and a <model.bpmn\|project.lila>/);
});
