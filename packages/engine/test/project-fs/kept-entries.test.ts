/**
 * The entries of a `.lila` the reader could not use are kept by every write (#725, RM-01 § 1.4,
 * § 2.4): an unreadable scenario, a broken run and a loose `notes.md` survive a CLI write byte for
 * byte, `lila project show` reports them, and a valid entry the document no longer holds is not
 * brought back. A healthy project is written exactly as before.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../../src/cli.js';
import { decodeLila, decodeLilaArchive, encodeLila, readLilaPreserved } from '../../src/project/index.js';
import { lilaProjectInventory, readLilaFile, writeLilaFile } from '../../src/project-fs/index.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const exampleLila = join(repo, 'examples/pedido.lila');

/** What #725 puts in the archive: the base scenario unreadable, a broken run, and a loose note. */
const BROKEN = '{ "version": 1, "name": "AS-IS", ';
const BROKEN_RUN = '{ "id": "r1" }\n';
const NOTES = '# Notes\n\nKept by every write.\n';

let scratch: string;
let file: string;
let out: string[];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lila-kept-'));
  file = join(scratch, 'pedido.lila');
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

/** pedido.lila with `as-is.scenario.json` (which `to-be-3-cajeros` extends) unreadable, plus `extra`. */
function damaged(extra: Record<string, string> = { 'notes.md': NOTES, 'runs/r1.result.json': BROKEN_RUN }): Uint8Array {
  const entries = unzipSync(new Uint8Array(readFileSync(exampleLila)));
  entries['as-is.scenario.json'] = strToU8(BROKEN);
  for (const [name, text] of Object.entries(extra)) entries[name] = strToU8(text);
  return zipSync(entries);
}

function entriesOf(path: string): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(new Uint8Array(readFileSync(path)))).map(([name, bytes]) => [name, Buffer.from(bytes).toString('utf8')]));
}

describe('a .lila with entries the reader could not use (#725)', () => {
  test('the codec keeps them beside the document and writes them back', () => {
    const { document, preserved } = decodeLilaArchive(damaged());
    expect(Object.keys(document.scenarios)).toEqual(['to-be-3-cajeros.scenario.json']);
    expect(Object.keys(preserved.entries).sort()).toEqual(['as-is.scenario.json', 'notes.md', 'runs/r1.result.json']);
    expect(document.problems?.map((p) => p.file).sort()).toEqual(['as-is.scenario.json', 'notes.md', 'runs/r1.result.json']);
    expect(document.problems?.every((p) => p.message.endsWith('kept as is.'))).toBe(true);
    const written = unzipSync(encodeLila(document, preserved));
    expect(Buffer.from(written['as-is.scenario.json']!).toString('utf8')).toBe(BROKEN);
    expect(Buffer.from(written['notes.md']!).toString('utf8')).toBe(NOTES);
    expect(Buffer.from(written['runs/r1.result.json']!).toString('utf8')).toBe(BROKEN_RUN);
    // `readLilaPreserved` finds the same entries without decoding the document.
    expect(Object.keys(readLilaPreserved(damaged()).preserved.entries).sort()).toEqual(Object.keys(preserved.entries).sort());
  });

  test('a healthy archive keeps nothing and is written byte for byte as before', () => {
    const bytes = new Uint8Array(readFileSync(exampleLila));
    const { document, preserved } = decodeLilaArchive(bytes);
    expect(preserved.entries).toEqual({});
    expect(Buffer.from(encodeLila(document, preserved)).equals(Buffer.from(encodeLila(decodeLila(bytes))))).toBe(true);
  });

  test('`lila project show` reports them, as text and as JSON', async () => {
    writeFileSync(file, damaged());
    expect(await main(['project', 'show', file])).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('as-is.scenario.json');
    expect(text).toContain('notes.md');
    expect(text).toContain('runs/r1.result.json');
    const inventory = await lilaProjectInventory({ file });
    expect(inventory.problems.map((p) => p.file).sort()).toEqual(['as-is.scenario.json', 'notes.md', 'runs/r1.result.json']);
  });

  test('a CLI write keeps them byte for byte, and the scenario that extends the broken one is not left dangling', async () => {
    writeFileSync(file, damaged());
    const before = entriesOf(file);
    expect(await main(['process', 'attribute', 'define', file, '--name', 'SLA (h)', '--type', 'number', '--applies-to', 'task'])).toBe(0);
    const after = entriesOf(file);
    expect(after['as-is.scenario.json']).toBe(BROKEN);
    expect(after['notes.md']).toBe(NOTES);
    expect(after['runs/r1.result.json']).toBe(BROKEN_RUN);
    expect(after['to-be-3-cajeros.scenario.json']).toBe(before['to-be-3-cajeros.scenario.json']);
    expect(after['model.bpmn']).not.toBe(before['model.bpmn']);
  });

  test('a valid entry the document no longer holds is not brought back; a document entry replaces a kept one', async () => {
    writeFileSync(file, damaged());
    const { document } = await readLilaFile(file);
    const { 'to-be-3-cajeros.scenario.json': _gone, ...rest } = document.scenarios;
    const fixed = { version: 1, name: 'AS-IS', model: 'model.bpmn' };
    await writeLilaFile(file, { ...document, scenarios: { ...rest, 'as-is.scenario.json': fixed }, scenarioRevisions: { 'as-is.scenario.json': 1 } });
    const after = entriesOf(file);
    expect(after['to-be-3-cajeros.scenario.json']).toBeUndefined();
    expect(JSON.parse(after['as-is.scenario.json']!)).toEqual(fixed);
    expect(after['notes.md']).toBe(NOTES);
  });

  test('a «Save as» to a new file starts without them unless the caller passes them (#690)', async () => {
    writeFileSync(file, damaged());
    const { document, preserved } = await readLilaFile(file);
    const plain = join(scratch, 'copy.lila');
    await writeLilaFile(plain, document, { saveAs: true });
    expect(entriesOf(plain)['notes.md']).toBeUndefined();
    const carried = join(scratch, 'carried.lila');
    await writeLilaFile(carried, document, { saveAs: true, preserved });
    expect(entriesOf(carried)['notes.md']).toBe(NOTES);
    expect(entriesOf(carried)['as-is.scenario.json']).toBe(BROKEN);
  });

  test('operating-system litter is dropped without a report', () => {
    const { document, preserved } = decodeLilaArchive(damaged({ '.DS_Store': 'x', '__MACOSX/._model.bpmn': 'x' }));
    expect(Object.keys(preserved.entries)).toEqual(['as-is.scenario.json']);
    expect(document.problems?.map((p) => p.file)).toEqual(['as-is.scenario.json']);
  });
});

describe('kept entries follow their process when the layout folds or unfolds (#725, QA)', () => {
  const outline = join(repo, 'examples/outline/credit-application.json');
  const names = (): string[] => Object.keys(entriesOf(file)).sort();

  test('v1 → v2 → v1 → v2: the unreadable scenario moves with pedido, and a second process can be added again', async () => {
    writeFileSync(file, damaged({}));
    expect(await main(['process', 'create', '--outline', outline, '-p', file, '--process', 'otro'])).toBe(0);
    expect(entriesOf(file)['processes/pedido/as-is.scenario.json']).toBe(BROKEN);
    expect(names()).not.toContain('as-is.scenario.json');

    expect(await main(['process', 'delete', file, 'otro'])).toBe(0);
    expect(entriesOf(file)['as-is.scenario.json']).toBe(BROKEN);
    expect(names().some((name) => name.startsWith('processes/'))).toBe(false);

    expect(await main(['process', 'create', '--outline', outline, '-p', file, '--process', 'nuevo'])).toBe(0);
    expect(entriesOf(file)['processes/pedido/as-is.scenario.json']).toBe(BROKEN);
    // The extender and its base are side by side again.
    expect(names()).toContain('processes/pedido/to-be-3-cajeros.scenario.json');
  });

  test('deleting the process that holds an unreadable scenario is refused, naming it; nothing is written', async () => {
    writeFileSync(file, damaged({}));
    expect(await main(['process', 'create', '--outline', outline, '-p', file, '--process', 'otro'])).toBe(0);
    const before = readFileSync(file);
    expect(await main(['process', 'delete', file, 'pedido'])).not.toBe(0);
    expect(out.join('\n')).toContain('processes/pedido/as-is.scenario.json');
    expect(readFileSync(file).equals(before)).toBe(true);
  });

  test('the codec refuses to drop an unreadable entry of a deleted process, and tells the survivor by its model id', async () => {
    writeFileSync(file, damaged({}));
    expect(await main(['process', 'create', '--outline', outline, '-p', file, '--process', 'otro'])).toBe(0);
    const { document, preserved } = decodeLilaArchive(readFileSync(file));
    const [pedido, otro] = [document, document.processes![0]!];
    // Down to `otro`, written as version 1 without its slug: pedido's entry has no process left.
    const onlyOtro = { ...document, model: otro.model, scenarios: otro.scenarios, scenarioRevisions: otro.scenarioRevisions, runs: otro.runs };
    const { process: _p, processes: _ps, problems: _pr, ...plain } = onlyOtro;
    expect(() => encodeLila(plain, preserved)).toThrow(/process "pedido" is no longer in the project.*processes\/pedido\/as-is\.scenario\.json/);
    // Down to `pedido`, without its slug either: found by its model id, its entry goes to the root.
    const { process: _q, processes: _qs, problems: _qr, ...onlyPedido } = pedido;
    expect(Buffer.from(unzipSync(encodeLila(onlyPedido, preserved))['as-is.scenario.json']!).toString('utf8')).toBe(BROKEN);
  });

  test('an orphaned layout entry under a folder that is a process again is refused with its path, not a bare code', async () => {
    const entries = unzipSync(new Uint8Array(readFileSync(exampleLila)));
    entries['processes/otro/as-is.scenario.json'] = strToU8(BROKEN);
    writeFileSync(file, zipSync(entries));
    expect(await main(['process', 'create', '--outline', outline, '-p', file, '--process', 'otro'])).not.toBe(0);
    expect(out.join('\n')).toMatch(/processes\/otro\/as-is\.scenario\.json.*no longer listed/);
  });

  test('scenario patch --save-to onto an unreadable scenario is refused; the entry stays as it was', async () => {
    const entries = unzipSync(new Uint8Array(readFileSync(exampleLila)));
    entries['to-be-3-cajeros.scenario.json'] = strToU8(BROKEN);
    writeFileSync(file, zipSync(entries));
    const patch = join(scratch, 'patch.json');
    writeFileSync(patch, JSON.stringify([{ op: 'add', path: '/description', value: 'x' }]));
    const before = readFileSync(file);
    expect(await main(['scenario', 'patch', file, 'as-is', '--patch', patch, '--save-to', 'to-be-3-cajeros'])).not.toBe(0);
    expect(out.join('\n')).toContain('could not be read');
    expect(readFileSync(file).equals(before)).toBe(true);
  });
});
