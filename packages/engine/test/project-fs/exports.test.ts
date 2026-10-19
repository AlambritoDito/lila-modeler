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
import { elementsCsv, flowsCsv, processCsv, resourcesCsv } from '../../src/csv.js';
import { RESOURCE_WAIT, elementPercentiles, elementSamples, type EventLogRow } from '../../src/index.js';
import { decodeLila, encodeLila } from '../../src/project/index.js';
import { exportDocument, exportResults } from '../../src/project-fs/index.js';
import { readWorkbook } from '../../src/xlsx-read.js';
import { resourceNamesOf, scenarioWorkbook } from '../../src/xlsx-report.js';
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

/** The rows of a `log.csv` (`lila run --csv`), back as `EventLogRow`s; pedido's ids need no quoting. */
function readLogCsv(text: string): EventLogRow[] {
  const [header, ...lines] = text.trimEnd().split('\r\n');
  const columns = header!.split(',');
  const numeric = (value: string): number | null => (value === '' ? null : Number(value));
  return lines.map((line) => {
    const cells = Object.fromEntries(line.split(',').map((value, index) => [columns[index]!, value]));
    return {
      replication: Number(cells.replication), caseId: cells.caseId!, activityInstanceId: cells.activityInstanceId!,
      elementId: cells.elementId!, resourceId: cells.resourceId || null, allocationIndex: numeric(cells.allocationIndex!),
      resourceQuantity: numeric(cells.resourceQuantity!), status: cells.status as EventLogRow['status'],
      enabledAt: Number(cells.enabledAt), startedAt: numeric(cells.startedAt!), endedAt: numeric(cells.endedAt!),
      observedUntil: Number(cells.observedUntil), resourceWait: Number(cells.resourceWait),
      offHoursWait: Number(cells.offHoursWait), elementCost: Number(cells.elementCost),
      resourceCost: Number(cells.resourceCost), cost: Number(cells.cost),
    };
  });
}

/** `percentiles.csv` as `id → [n, p50, p90, p95]`. */
function readPercentilesCsv(text: string): Map<string, number[]> {
  const [header, ...lines] = text.trimEnd().split('\r\n');
  expect(header).toBe('Id,Name,n,p50,p90,p95');
  return new Map(lines.map((line) => {
    const cells = line.split(',');
    return [cells[0]!, cells.slice(2).map(Number)];
  }));
}

describe('per-element wait percentiles (#666)', () => {
  test('a run saved by lila run --save: p50/p90/p95 equal elementPercentiles over the --csv log of the same inputs', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, []);
    const args = ['run', file, 'as-is', '--seed', '42', '--replications', '2'];
    expect(await main([...args, '--save'])).toBe(0);
    expect(await main([...args, '--csv', join(dir, 'log')])).toBe(0);
    const rows = readLogCsv(readFileSync(join(dir, 'log', 'log.csv'), 'utf8'));
    expect(new Set(rows.map((row) => row.replication))).toEqual(new Set([0, 1]));
    const warmup = decodeLila(readFileSync(file)).runs[0]!.inputs.scenario.run as { warmup: number };
    expect(warmup.warmup).toBeGreaterThan(0);
    const expected = elementPercentiles(rows, [0.5, 0.9, 0.95], { warmup: warmup.warmup, measure: RESOURCE_WAIT });
    const sizes = elementSamples(rows, warmup.warmup, RESOURCE_WAIT);

    const csv = await exportResults({ file, format: 'csv' });
    expect(csv.percentiles).toEqual({ included: true });
    const files = csv.data as Record<string, string>;
    expect(Object.keys(files)).toEqual(['elements.csv', 'flows.csv', 'resources.csv', 'process.csv', 'percentiles.csv']);
    const exported = readPercentilesCsv(files['percentiles.csv']!);
    expect([...exported.keys()].sort()).toEqual([...expected.keys()].sort());
    for (const [id, [n, ...ps]] of exported) {
      expect(ps, id).toEqual(expected.get(id));
      expect(n, id).toBe(sizes.get(id)!.length);
    }
    // n is the instances measured, over both replications.
    const { ir } = await parseBpmn(XML);
    const tasks = Object.keys(ir.nodes).filter((id) => ir.nodes[id]!.type === 'task');
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) expect(exported.get(task)?.[0], task).toBeGreaterThan(0);

    const xlsx = await exportResults({ file, format: 'xlsx' });
    expect(xlsx.percentiles).toEqual({ included: true });
    const sheets = readWorkbook(xlsx.data as Uint8Array);
    expect(sheets.map((sheet) => sheet.name)).toEqual(['Summary', 'Elements', 'Flows', 'Resources', 'Parameters', 'Percentiles']);
    const sheet = sheets.at(-1)!;
    expect(sheet.rows[0]).toEqual(['Id', 'Name', 'n', 'p50', 'p90', 'p95']);
    for (const [id, , n, ...ps] of sheet.rows.slice(1)) {
      expect([n, ...ps], String(id)).toEqual(exported.get(String(id)));
    }
    // The Spanish workbook names the sheet from the catalog; the columns stay the same.
    const es = readWorkbook((await exportResults({ file, format: 'xlsx', locale: 'es' })).data as Uint8Array);
    expect(es.at(-1)!.name).toBe('Percentiles');
    expect(es.at(-1)!.rows[0]).toEqual(['Id', 'Name', 'n', 'p50', 'p90', 'p95']);

    // The CLI writes the fifth file and prints no note.
    const target = join(dir, 'csv');
    err.length = 0;
    expect(await main(['export', 'results', file, '--out', target, '--format', 'csv'])).toBe(0);
    expect(readFileSync(join(target, 'percentiles.csv'), 'utf8')).toBe(files['percentiles.csv']);
    expect(err).toEqual([]);
  }, 60_000);

  test('the existing sheets and CSV files are byte-identical to the export without percentiles', async () => {
    const file = join(dir, 'p.lila');
    const [run] = await pedidoWithRuns(file, ['as-is.scenario.json'], { reproducible: true });
    const { ir } = await parseBpmn(XML);
    const scenario = run!.inputs.scenario as never;
    const csv = await exportResults({ file, format: 'csv' });
    expect(csv.percentiles.included).toBe(true);
    const files = csv.data as Record<string, string>;
    // What `exportResults` wrote before #666: the four files of `lila run --csv`.
    const stored = decodeLila(readFileSync(file)).runs[0]!.result;
    expect(files['elements.csv']).toBe(elementsCsv(ir, stored));
    expect(files['flows.csv']).toBe(flowsCsv(ir, stored));
    expect(files['resources.csv']).toBe(resourcesCsv(stored, resourceNamesOf(scenario)));
    expect(files['process.csv']).toBe(processCsv(stored));

    const before = unzipSync(scenarioWorkbook(ir, scenario, stored, resourceNamesOf(scenario)));
    const after = unzipSync((await exportResults({ file, format: 'xlsx' })).data as Uint8Array);
    const worksheets = Object.keys(before).filter((name) => name.startsWith('xl/worksheets/'));
    expect(worksheets).toHaveLength(5);
    for (const name of worksheets) expect(strFromU8(after[name]!), name).toBe(strFromU8(before[name]!));
    expect(Object.keys(after).filter((name) => name.startsWith('xl/worksheets/'))).toEqual([...worksheets, 'xl/worksheets/sheet6.xml']);
  });

  test('a run whose re-simulation does not reproduce it is exported without percentiles, and the note says why', async () => {
    const file = join(dir, 'p.lila');
    await pedidoWithRuns(file, ['as-is.scenario.json'], { reproducible: true });
    // As if it were saved on another platform: the last digit of one stored KPI differs.
    const project = decodeLila(readFileSync(file));
    const stored = project.runs[0]!;
    const mean = stored.result.process.cycleTime.mean;
    const tampered = { ...stored, result: { ...stored.result, process: { ...stored.result.process, cycleTime: { ...stored.result.process.cycleTime, mean: mean * (1 + Number.EPSILON) } } } };
    expect(tampered.result.process.cycleTime.mean).not.toBe(mean);
    writeFileSync(file, encodeLila({ ...project, runs: [tampered] }));

    const note = /^The per-element wait percentiles are left out: the run's stored inputs do not reproduce its stored results/;
    const csv = await exportResults({ file, format: 'csv' });
    expect(csv.percentiles.included).toBe(false);
    expect(csv.percentiles.note).toMatch(note);
    expect(Object.keys(csv.data)).toEqual(['elements.csv', 'flows.csv', 'resources.csv', 'process.csv']);
    const xlsx = await exportResults({ file, format: 'xlsx' });
    expect(readWorkbook(xlsx.data as Uint8Array).map((sheet) => sheet.name)).toEqual(['Summary', 'Elements', 'Flows', 'Resources', 'Parameters']);
    expect((await exportResults({ file, format: 'xlsx', locale: 'es' })).percentiles.note).toMatch(/^Los percentiles de espera por elemento quedan fuera: las entradas guardadas de la corrida no reproducen/);

    // The CLI still writes the export, and prints the note on stderr.
    expect(await main(['export', 'results', file, '--out', join(dir, 'r.xlsx')])).toBe(0);
    expect(err.at(-1)).toMatch(note);

    // The process KPIs alone can match while an element's wait drifts: the elements are compared too.
    const wait = stored.result.elements;
    const [task] = Object.keys(wait).filter((id) => wait[id]!.resourceWait.mean > 0);
    expect(task).toBeDefined();
    const elements = { ...wait, [task!]: { ...wait[task!]!, resourceWait: { ...wait[task!]!.resourceWait, mean: wait[task!]!.resourceWait.mean * (1 + Number.EPSILON) } } };
    writeFileSync(file, encodeLila({ ...project, runs: [{ ...stored, result: { ...stored.result, elements } }] }));
    expect((await exportResults({ file, format: 'csv' })).percentiles.note).toMatch(note);
    // And the untouched run reproduces.
    writeFileSync(file, encodeLila({ ...project, runs: [stored] }));
    expect((await exportResults({ file, format: 'csv' })).percentiles).toEqual({ included: true });
  });

  test('a stored scenario with other replications than the result, or a cancelled run, is not re-simulated', async () => {
    const file = join(dir, 'p.lila');
    // Stored as the entry is written (30 replications) though one ran.
    await pedidoWithRuns(file, ['as-is.scenario.json']);
    expect((await exportResults({ file, format: 'csv' })).percentiles).toEqual({
      included: false,
      note: expect.stringMatching(/do not reproduce its stored results/) as unknown as string,
    });
    await pedidoWithRuns(file, ['as-is.scenario.json'], { reproducible: true });
    const project = decodeLila(readFileSync(file));
    const stored = project.runs[0]!;
    writeFileSync(file, encodeLila({ ...project, runs: [{ ...stored, result: { ...stored.result, cancelled: true, completedReplications: 0 } }] }));
    expect((await exportResults({ file, format: 'csv' })).percentiles.included).toBe(false);
  });
});
