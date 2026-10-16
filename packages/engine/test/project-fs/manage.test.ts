/**
 * Renaming and deleting processes and scenarios of a `.lila` (#634): `renameLilaProcess`,
 * `deleteLilaProcess`, `renameLilaScenario` and `deleteLilaScenario`, and `lila process|scenario
 * rename|delete` through `main`. Every refusal and every dry run leaves the file byte for byte; a
 * write keeps the other processes as they were, and what it removes is gone from `get_project`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../../src/cli.js';
import { decodeLila, encodeLila, processesOf, processIds, type ProcessDocument, type ProjectDocument } from '../../src/project/index.js';
import {
  deleteLilaProcess,
  deleteLilaScenario,
  lilaProjectInventory,
  renameLilaProcess,
  renameLilaScenario,
} from '../../src/project-fs/index.js';
import { EXAMPLE_LILA, pedidoWithRuns } from './export-fixture.js';

let scratch: string;
let out: string[];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lila-manage-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

/** A process whose call activity names pedido's `Process_Restaurante` as a QName, as Bizagi writes it. */
const CALLER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_Llamador" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Llamador" isExecutable="false">
    <bpmn:startEvent id="Start_L" />
    <bpmn:callActivity id="Call_Pedido" name="Take order &amp; pay" calledElement="tns:Process_Restaurante" />
    <bpmn:endEvent id="End_L" />
    <bpmn:sequenceFlow id="Flow_L1" sourceRef="Start_L" targetRef="Call_Pedido" />
    <bpmn:sequenceFlow id="Flow_L2" sourceRef="Call_Pedido" targetRef="End_L" />
  </bpmn:process>
</bpmn:definitions>
`;

function process(slug: string, name: string, xml: string, id: string): ProcessDocument {
  return {
    slug,
    name,
    model: { id, name: 'model.bpmn', xml, revision: 3 },
    scenarios: { 'as-is.scenario.json': { version: 1, name: 'AS-IS', model: 'model.bpmn' } },
    scenarioRevisions: { 'as-is.scenario.json': 1 },
    runs: [],
  };
}

/**
 * pedido with a run of each of its two scenarios (`run-1` of the AS-IS, `run-2` of the TO-BE, which
 * extends it), as a repository with the processes `extra` after it.
 */
async function repository(extra: readonly ProcessDocument[]): Promise<string> {
  const file = join(scratch, 'repo.lila');
  await pedidoWithRuns(file, ['as-is.scenario.json', 'to-be-3-cajeros.scenario.json']);
  const base = decodeLila(readFileSync(file));
  const document: ProjectDocument =
    extra.length === 0 ? base : { ...base, process: { slug: 'pedido', name: 'Pedido' }, processes: [...extra] };
  writeFileSync(file, encodeLila(document));
  return file;
}

/** pedido's model under process ids of its own, so a call to pedido does not name it too. */
const copia = (): ProcessDocument => {
  const xml = decodeLila(readFileSync(EXAMPLE_LILA)).model.xml.replaceAll('Process_Restaurante', 'Process_Copia').replaceAll('Process_Cliente', 'Process_CopiaCliente');
  return process('copia', 'Copia', xml, 'Process_Copia');
};
const llamador = (): ProcessDocument => process('llamador', 'Llamador', CALLER_XML, 'Process_Llamador');

function read(file: string): ProjectDocument {
  return decodeLila(readFileSync(file));
}

/** Runs `work`, expects it to throw `message`, and the file to be byte for byte as before. */
async function refused(file: string, work: () => Promise<unknown>, message: RegExp): Promise<void> {
  const before = readFileSync(file);
  await expect(work()).rejects.toThrow(message);
  expect(readFileSync(file).equals(before)).toBe(true);
}

describe('processIds', () => {
  test('the ids of every bpmn:process, with any prefix or none', () => {
    expect(processIds(read(EXAMPLE_LILA).model.xml)).toEqual(['Process_Restaurante', 'Process_Cliente']);
    expect(processIds('<definitions><process id="P1"/><x:process name="b" id=\'P2\'/></definitions>')).toEqual(['P1', 'P2']);
  });
});

describe('renameLilaProcess', () => {
  test('sets the name and keeps the slug and every other process', async () => {
    const file = await repository([copia()]);
    const before = read(file);
    const result = await renameLilaProcess({ file, process: 'copia', name: '  Copy  ' });
    expect(result).toMatchObject({ dryRun: false, written: true, process: 'copia', before: 'Copia', after: 'Copy', notes: [] });
    const after = processesOf(read(file));
    expect(after.map((p) => [p.slug, p.name])).toEqual([['pedido', 'Pedido'], ['copia', 'Copy']]);
    expect(after[0]).toEqual(processesOf(before)[0]);
    expect({ ...after[1], name: 'Copia' }).toEqual(processesOf(before)[1]);
    // The first process too: its name lives in the manifest's `process`.
    await renameLilaProcess({ file, process: 'pedido', name: 'Orders' });
    expect(read(file).process).toEqual({ slug: 'pedido', name: 'Orders' });
  });

  test('dryRun and the same name leave the bytes unchanged', async () => {
    const file = await repository([copia()]);
    const bytes = readFileSync(file);
    expect(await renameLilaProcess({ file, process: 'copia', name: 'Copy', dryRun: true })).toMatchObject({ dryRun: true, written: false });
    expect(await renameLilaProcess({ file, process: 'copia', name: 'Copia' })).toMatchObject({ written: false, summary: expect.stringMatching(/Nothing changes/) });
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('refused with a single process, with an empty name, and for an unknown slug', async () => {
    const single = await repository([]);
    await refused(single, () => renameLilaProcess({ file: single, process: 'pedido', name: 'X' }), /has a single process/);
    await refused(single, () => renameLilaProcess({ file: single, process: 'pedido', name: 'X', locale: 'es' }), /tiene un solo proceso/);
    const file = await repository([copia()]);
    await refused(file, () => renameLilaProcess({ file, process: 'copia', name: '  ' }), /cannot be empty/);
    await refused(file, () => renameLilaProcess({ file, process: 'nope', name: 'X' }), /no process "nope"/);
  });
});

describe('deleteLilaProcess', () => {
  test('refused while a call activity of another process targets it; the refusal lists it', async () => {
    const file = await repository([llamador()]);
    await refused(file, () => deleteLilaProcess({ file, process: 'pedido' }), /llamador\/Call_Pedido \(Take order & pay\)/);
    await refused(file, () => deleteLilaProcess({ file, process: 'pedido', locale: 'es' }), /actividades de llamada.*llamador\/Call_Pedido/);
  });

  test('refused for the last process', async () => {
    const file = await repository([]);
    await refused(file, () => deleteLilaProcess({ file, process: 'pedido' }), /only process/);
    await refused(file, () => deleteLilaProcess({ file, process: 'pedido', locale: 'es' }), /único proceso/);
  });

  test('removes the process with its scenarios and runs, and keeps the others', async () => {
    const file = await repository([copia(), llamador()]);
    const before = processesOf(read(file));
    const bytes = readFileSync(file);
    const dry = await deleteLilaProcess({ file, process: 'copia', dryRun: true });
    expect(readFileSync(file).equals(bytes)).toBe(true);
    const result = await deleteLilaProcess({ file, process: 'copia' });
    expect({ ...dry, dryRun: false, written: true, summary: '' }).toEqual({ ...result, summary: '' });
    expect(result).toMatchObject({ written: true, process: 'copia', name: 'Copia', removedScenarios: ['as-is.scenario.json'], removedRuns: [], slugs: ['pedido', 'llamador'], notes: [] });
    expect(processesOf(read(file))).toEqual([before[0], before[2]]);
  });

  test('down to one process: a version 1 archive that get_project reads, the runs gone', async () => {
    const file = await repository([copia()]);
    const copy = processesOf(read(file))[1]!;
    const result = await deleteLilaProcess({ file, process: 'pedido' });
    expect(result.removedScenarios).toEqual(['as-is.scenario.json', 'to-be-3-cajeros.scenario.json']);
    expect(result.removedRuns).toEqual(['run-1', 'run-2']);
    expect(result.summary).toMatch(/with 2 scenarios and 2 saved runs/);
    // A version 1 project's process is named after the project, and so is its slug.
    expect(result.slugs).toEqual(['pedido']);
    expect(result.notes).toEqual([expect.stringMatching(/"Copia" is now the only process.*slug pedido/)]);
    const written = read(file);
    expect(written.process).toBeUndefined();
    expect(written.processes).toBeUndefined();
    expect(written.model).toEqual(copy.model);
    const inventory = await lilaProjectInventory({ file });
    expect(inventory.formatVersion).toBe(1);
    expect(inventory.processes).toHaveLength(1);
    expect(inventory.processes[0]).toMatchObject({ processId: copy.model.id, runs: [] });
  });

  test('the process that calls is deleted freely', async () => {
    const file = await repository([llamador()]);
    expect((await deleteLilaProcess({ file, process: 'llamador' })).slugs).toEqual(['pedido']);
  });
});

describe('renameLilaScenario', () => {
  test('sets "name", keeps the entry and raises its revision and that of the scenarios extending it', async () => {
    const file = await repository([copia()]);
    const result = await renameLilaScenario({ file, process: 'pedido', scenario: 'AS-IS', name: 'Today' });
    expect(result).toMatchObject({ written: true, process: 'pedido', entry: 'as-is.scenario.json', before: 'AS-IS', after: 'Today', revision: 2 });
    const pedido = processesOf(read(file))[0]!;
    expect(pedido.scenarios['as-is.scenario.json']!['name']).toBe('Today');
    expect(pedido.scenarioRevisions).toEqual({ 'as-is.scenario.json': 2, 'to-be-3-cajeros.scenario.json': 2 });
    // The runs stay, now stale.
    expect((await lilaProjectInventory({ file })).processes[0]!.runs.map((r) => r.current)).toEqual([false, false]);
    // A leaf: only its own revision.
    await renameLilaScenario({ file, process: 'pedido', scenario: 'to-be-3-cajeros', name: 'Tomorrow' });
    expect(processesOf(read(file))[0]!.scenarioRevisions).toEqual({ 'as-is.scenario.json': 2, 'to-be-3-cajeros.scenario.json': 3 });
  });

  test('dryRun and the same name leave the bytes unchanged', async () => {
    const file = await repository([]);
    const bytes = readFileSync(file);
    expect(await renameLilaScenario({ file, scenario: 'as-is', name: 'Today', dryRun: true })).toMatchObject({ dryRun: true, written: false, revision: 2 });
    expect(await renameLilaScenario({ file, scenario: 'as-is', name: 'AS-IS' })).toMatchObject({ written: false, revision: 1 });
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('refused when another scenario already answers to that name, or the name is empty', async () => {
    const file = await repository([]);
    await refused(file, () => renameLilaScenario({ file, scenario: 'to-be-3-cajeros', name: 'AS-IS' }), /as-is\.scenario\.json .*already goes by "AS-IS"/);
    await refused(file, () => renameLilaScenario({ file, scenario: 'to-be-3-cajeros', name: 'as-is' }), /already goes by "as-is"/);
    await refused(file, () => renameLilaScenario({ file, scenario: 'to-be-3-cajeros', name: 'AS-IS', locale: 'es' }), /ya se llama "AS-IS"/);
    await refused(file, () => renameLilaScenario({ file, scenario: 'as-is', name: '' }), /cannot be empty/);
  });
});

describe('deleteLilaScenario', () => {
  test('removes the scenario, its revision and its runs, which get_project no longer lists', async () => {
    const file = await repository([copia()]);
    const bytes = readFileSync(file);
    const dry = await deleteLilaScenario({ file, process: 'pedido', scenario: 'TO-BE 3 cashiers', dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, written: false, removedRuns: ['run-2'] });
    expect(readFileSync(file).equals(bytes)).toBe(true);
    const result = await deleteLilaScenario({ file, process: 'pedido', scenario: 'TO-BE 3 cashiers' });
    expect(result).toMatchObject({ written: true, process: 'pedido', entry: 'to-be-3-cajeros.scenario.json', removedRuns: ['run-2'], notes: [] });
    expect(result.summary).toMatch(/with 1 saved run\./);
    const pedido = processesOf(read(file))[0]!;
    expect(Object.keys(pedido.scenarios)).toEqual(['as-is.scenario.json']);
    expect(pedido.scenarioRevisions).toEqual({ 'as-is.scenario.json': 1 });
    const inventory = await lilaProjectInventory({ file });
    expect(inventory.processes[0]!.runs.map((r) => r.id)).toEqual(['run-1']);
    expect(inventory.processes[0]!.scenarios.map((s) => s.entry)).toEqual(['as-is.scenario.json']);
    expect(processesOf(read(file))[1]).toEqual(processesOf(decodeLila(bytes))[1]);
  });

  test('refused while other scenarios extend it, and for the last one', async () => {
    const file = await repository([copia()]);
    await refused(file, () => deleteLilaScenario({ file, process: 'pedido', scenario: 'as-is' }), /extend as-is\.scenario\.json: to-be-3-cajeros\.scenario\.json/);
    await refused(file, () => deleteLilaScenario({ file, process: 'pedido', scenario: 'as-is', locale: 'es' }), /heredan de as-is\.scenario\.json/);
    await refused(file, () => deleteLilaScenario({ file, process: 'copia', scenario: 'as-is' }), /only scenario of process copia/);
    await refused(file, () => deleteLilaScenario({ file, process: 'copia', scenario: 'as-is', locale: 'es' }), /único escenario del proceso copia/);
  });

  test('deleting as-is.scenario.json says edit_process can no longer store durations there', async () => {
    const file = await repository([]);
    const document = read(file);
    const { extends: _parent, ...own } = document.scenarios['to-be-3-cajeros.scenario.json']!;
    writeFileSync(file, encodeLila({ ...document, scenarios: { ...document.scenarios, 'to-be-3-cajeros.scenario.json': { ...own, model: 'model.bpmn' } } }));
    const result = await deleteLilaScenario({ file, scenario: 'as-is' });
    expect(result.removedRuns).toEqual(['run-1']);
    expect(result.notes).toEqual([expect.stringMatching(/edit_process .* can no longer store them/)]);
  });
});

describe('lila process|scenario rename|delete', () => {
  test('rename and delete a process, with --dry-run and --json', async () => {
    const file = await repository([copia()]);
    const bytes = readFileSync(file);
    expect(await main(['process', 'rename', file, 'copia', '--name', 'Copy', '--dry-run'])).toBe(0);
    expect(out.join('\n')).toMatch(/Dry run: would rename process copia from "Copia" to "Copy"/);
    expect(await main(['process', 'delete', file, 'copia', '--dry-run', '--json'])).toBe(0);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ dryRun: true, written: false, removedScenarios: ['as-is.scenario.json'] });
    expect(readFileSync(file).equals(bytes)).toBe(true);
    expect(await main(['process', 'rename', file, 'copia', '--name', 'Copy'])).toBe(0);
    expect(processesOf(read(file))[1]!.name).toBe('Copy');
    out = [];
    expect(await main(['--lang', 'es', 'process', 'delete', file, 'pedido'])).toBe(0);
    expect(out.join('\n')).toMatch(/Borrado el proceso "Pedido" \(pedido\).*2 escenarios y 2 corridas guardadas[\s\S]*"Copy" queda como único proceso/);
    expect(read(file).processes).toBeUndefined();
  });

  test('rename and delete a scenario', async () => {
    const file = await repository([copia()]);
    expect(await main(['scenario', 'rename', file, 'to-be-3-cajeros', '--process', 'pedido', '--name', 'TO-BE 4', '--json'])).toBe(0);
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ written: true, entry: 'to-be-3-cajeros.scenario.json', after: 'TO-BE 4', revision: 2 });
    expect(await main(['scenario', 'delete', file, 'TO-BE 4', '--process', 'pedido'])).toBe(0);
    expect(out.at(-1)).toMatch(/Deleted scenario to-be-3-cajeros\.scenario\.json of process pedido .*with 1 saved run/);
    expect(Object.keys(processesOf(read(file))[0]!.scenarios)).toEqual(['as-is.scenario.json']);
  });

  test('a refusal or a bad call writes nothing and exits 1', async () => {
    const file = await repository([copia()]);
    const bytes = readFileSync(file);
    expect(await main(['--lang', 'es', 'scenario', 'delete', file, 'as-is', '--process', 'copia'])).toBe(1);
    expect(out.at(-1)).toMatch(/único escenario/);
    expect(await main(['process', 'rename', file, 'copia'])).toBe(1);
    expect(out.at(-1)).toMatch(/--name/);
    expect(await main(['process', 'delete', file, 'copia', '--name', 'x'])).toBe(1);
    expect(await main(['scenario', 'rename', file, 'as-is', '--process', 'pedido'])).toBe(1);
    expect(await main(['scenario', 'delete', file])).toBe(1);
    expect(await main(['scenario', 'remove', file, 'as-is'])).toBe(1);
    expect(out.at(-1)).toMatch(/rename, delete/);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });
});
