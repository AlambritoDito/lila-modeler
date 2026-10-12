/**
 * A `.lila` as the input of the MCP tools (#466): the same answers as on the extracted `.bpmn` +
 * scenario files, `process` for a repository, scenarios by name, and `patch_scenario` writing back
 * into the archive with every other process byte-identical. In-memory transport, like
 * `server.test.ts`.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeLila, encodeLila, processesOf } from '@lila-modeler/engine/project';
import type { ProcessDocument, ProjectDocument } from '@lila-modeler/engine/project';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createServer } from '../src/server.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const folder = `${repo}examples/pedido`;
const model = `${folder}/model.bpmn`;
const asIs = `${folder}/as-is.scenario.json`;
const toBe = `${folder}/to-be-3-cajeros.scenario.json`;
const exampleLila = `${repo}examples/pedido.lila`;

let client: Client;
let scratch: string;

beforeEach(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  scratch = mkdtempSync(join(tmpdir(), 'lila-mcp-lila-'));
});

afterEach(async () => {
  await client.close();
  rmSync(scratch, { recursive: true, force: true });
});

function textOf(result: { content: unknown }): string {
  return (result.content as { type: string; text: string }[])[0]?.text ?? '';
}

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, text: textOf(result) };
}

function pedidoDocument(): ProjectDocument {
  const scenarios = Object.fromEntries(
    readdirSync(folder)
      .filter((name) => name.endsWith('.scenario.json'))
      .sort()
      .map((name) => [name, JSON.parse(readFileSync(join(folder, name), 'utf8')) as Record<string, unknown>]),
  );
  return {
    version: 1,
    id: 'p1',
    name: 'pedido',
    model: { id: 'Process_Restaurante', name: 'model.bpmn', xml: readFileSync(model, 'utf8'), revision: 1 },
    scenarios,
    scenarioRevisions: Object.fromEntries(Object.keys(scenarios).map((name) => [name, 1])),
    runs: [],
  };
}

function repositoryDocument(): ProjectDocument {
  const base = pedidoDocument();
  const copia: ProcessDocument = {
    slug: 'copia',
    name: 'Copia',
    model: base.model,
    scenarios: { 'solo.scenario.json': { ...base.scenarios['as-is.scenario.json'], name: 'Solo' } },
    scenarioRevisions: { 'solo.scenario.json': 1 },
    runs: [],
  };
  return { ...base, process: { slug: 'pedido', name: 'Pedido' }, processes: [copia] };
}

function archive(name: string, document: ProjectDocument): string {
  const file = join(scratch, name);
  writeFileSync(file, encodeLila(document));
  return file;
}

describe('read-only tools on a .lila', () => {
  test('validate_bpmn: same report as the extracted model.bpmn', async () => {
    const fromBpmn = await call('validate_bpmn', { path: model });
    const fromLila = await call('validate_bpmn', { path: exampleLila });
    expect(fromLila.isError).toBe(false);
    expect(fromLila.text).toBe(fromBpmn.text);
  });

  test('describe_process: the scenario by name inside the archive', async () => {
    const fromBpmn = await call('describe_process', { path: model, scenario: toBe });
    const fromLila = await call('describe_process', { path: exampleLila, scenario: 'to-be-3-cajeros' });
    expect(fromLila.isError).toBe(false);
    expect(fromLila.text).toBe(fromBpmn.text);
  });

  test('run_simulation: same RunResult as on the .bpmn + .json, same seed', async () => {
    const args = { seed: 11, replications: 2 };
    const fromFiles = await call('run_simulation', { model, scenario: toBe, ...args });
    const fromLila = await call('run_simulation', { model: exampleLila, scenario: 'TO-BE 3 cashiers', ...args });
    expect(fromLila.isError, fromLila.text).toBe(false);
    expect(fromLila.text).toBe(fromFiles.text);
  });

  test('run_simulation: an inline scenario extends a scenario of the archive', async () => {
    const args = { seed: 11, replications: 2 };
    const fromFiles = await call('run_simulation', { model, scenario: toBe, ...args });
    const inline = { version: 1, name: 'TO-BE 3 cashiers', extends: 'as-is.scenario.json', resources: { cajero: { capacity: 3 } } };
    const fromLila = await call('run_simulation', { model: exampleLila, scenario: inline, ...args });
    expect(fromLila.isError, fromLila.text).toBe(false);
    expect(fromLila.text).toBe(fromFiles.text);
  });

  test('compare_scenarios: same CompareResult as on the extracted files', async () => {
    const args = { seed: 11, replications: 2 };
    const fromFiles = await call('compare_scenarios', { model, scenarios: [asIs, toBe], ...args });
    const fromLila = await call('compare_scenarios', { model: exampleLila, scenarios: ['as-is', 'to-be-3-cajeros'], ...args });
    expect(fromLila.isError, fromLila.text).toBe(false);
    expect(fromLila.text).toBe(fromFiles.text);
  });

  test('a repository: process required, unknown process, and the right one', async () => {
    const file = archive('repo.lila', repositoryDocument());
    const missing = await call('run_simulation', { model: file, scenario: 'as-is' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('several processes (pedido, copia)');
    const unknown = await call('validate_bpmn', { path: file, process: 'otro', locale: 'es' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('no tiene el proceso "otro"; sus procesos son: pedido, copia');
    const args = { seed: 5, replications: 2 };
    const reference = await call('run_simulation', { model, scenario: asIs, ...args });
    const chosen = await call('run_simulation', { model: file, process: 'copia', scenario: 'Solo', ...args });
    expect(chosen.isError, chosen.text).toBe(false);
    expect(chosen.text).toBe(reference.text);
  });

  test('process with a .bpmn model is refused', async () => {
    const result = await call('run_simulation', { model, process: 'pedido', scenario: asIs });
    expect(result.isError).toBe(true);
    expect(result.text).toContain('only applies when the model is a .lila');
  });
});

/**
 * A version 2 archive whose manifest lists a single process, `mostrador` (#517): any write saves it
 * as version 1, where its process is named after the project (`pedido`).
 */
function oneProcessVersion2(name: string): string {
  const entries = unzipSync(encodeLila({ ...repositoryDocument(), process: { slug: 'mostrador', name: 'Mostrador' } }));
  const manifest = JSON.parse(strFromU8(entries['lila-project.json']!)) as { processes: { slug: string }[] };
  manifest.processes = manifest.processes.filter((p) => p.slug === 'mostrador');
  const kept = Object.fromEntries(Object.entries(entries).filter(([entry]) => !entry.startsWith('processes/copia/')));
  const file = join(scratch, name);
  writeFileSync(file, zipSync({ ...kept, 'lila-project.json': strToU8(JSON.stringify(manifest)) }));
  return file;
}

describe('writes on a one-process version 2 .lila report the process as written (#613)', () => {
  test('patch_scenario: the slug and the scenario\'s model are the version 1 ones', async () => {
    const file = oneProcessVersion2('mostrador.lila');
    const result = await call('patch_scenario', {
      project: file,
      scenario: 'as-is',
      patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 4 }],
    });
    expect(result.isError, result.text).toBe(false);
    const payload = JSON.parse(result.text) as { process: string; scenario: { model: string } };
    expect(payload.process).toBe('pedido');
    expect(payload.scenario.model).toBe(`${file}/model.bpmn`);
    // The reply names what is there: the next call by that slug finds it.
    const run = await call('run_simulation', { model: file, process: payload.process, scenario: 'as-is', replications: 1 });
    expect(run.isError, run.text).toBe(false);
  });

  test('run_simulation with saveRun: savedRun.process', async () => {
    const file = oneProcessVersion2('mostrador.lila');
    const result = await client.callTool({ name: 'run_simulation', arguments: { model: file, scenario: 'as-is', replications: 1, saveRun: true } });
    expect(result.isError, textOf(result)).not.toBe(true);
    const blocks = (result.content as { text: string }[]).map((b) => JSON.parse(b.text) as { savedRun?: { process: string } });
    expect(blocks.find((b) => b.savedRun !== undefined)?.savedRun?.process).toBe('pedido');
    expect(processesOf(decodeLila(new Uint8Array(readFileSync(file))))[0]!.slug).toBe('pedido');
  });
});

describe('patch_scenario on a .lila', () => {
  test('in place: round trip through decodeLila, other process byte-identical', async () => {
    const file = archive('repo.lila', repositoryDocument());
    const before = unzipSync(new Uint8Array(readFileSync(file)));
    const result = await call('patch_scenario', {
      project: file,
      process: 'pedido',
      scenario: 'as-is',
      patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 4 }],
    });
    expect(result.isError, result.text).toBe(false);
    const payload = JSON.parse(result.text) as { file: string; process: string; entry: string };
    expect(payload).toMatchObject({ process: 'pedido', entry: 'as-is.scenario.json' });

    const after = unzipSync(new Uint8Array(readFileSync(file)));
    for (const name of Object.keys(before).filter((entry) => entry.startsWith('processes/copia/'))) {
      expect(Buffer.from(after[name]!).equals(Buffer.from(before[name]!)), name).toBe(true);
    }
    const decoded = decodeLila(new Uint8Array(readFileSync(file)));
    const [pedido, copia] = processesOf(decoded);
    const written = pedido!.scenarios['as-is.scenario.json'] as { model: string; resources: { cajero: { capacity: number } } };
    expect(written.resources.cajero.capacity).toBe(4);
    expect(written.model).toBe('model.bpmn');
    expect(pedido!.scenarioRevisions['as-is.scenario.json']).toBe(2);
    expect(copia).toEqual(processesOf(repositoryDocument())[1]);
    expect(readdirSync(scratch)).toEqual(['repo.lila']);

    // The patched scenario runs, and so does the one extending it.
    const run = await call('run_simulation', { model: file, process: 'pedido', scenario: 'to-be-3-cajeros', replications: 1 });
    expect(run.isError, run.text).toBe(false);
  });

  test('saveTo: a new entry with extends and only the delta', async () => {
    const file = archive('pedido.lila', pedidoDocument());
    const result = await call('patch_scenario', {
      project: file,
      scenario: 'as-is',
      saveTo: 'to-be-4',
      patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 4 }],
      name: 'TO-BE 4',
    });
    expect(result.isError, result.text).toBe(false);
    const decoded = decodeLila(new Uint8Array(readFileSync(file)));
    expect(decoded.scenarios['to-be-4.scenario.json']).toEqual({
      version: 1,
      extends: 'as-is.scenario.json',
      resources: { cajero: { capacity: 4 } },
      name: 'TO-BE 4',
    });
    expect(decoded.scenarios['as-is.scenario.json']).toEqual(pedidoDocument().scenarios['as-is.scenario.json']);
    const run = await call('run_simulation', { model: file, scenario: 'TO-BE 4', replications: 1 });
    expect(run.isError, run.text).toBe(false);
  });

  test('a patch that leaves the scenario invalid writes nothing', async () => {
    const file = archive('pedido.lila', pedidoDocument());
    const untouched = readFileSync(file);
    const result = await call('patch_scenario', {
      project: file,
      scenario: 'as-is',
      patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 0 }],
    });
    expect(result.isError).toBe(true);
    expect(readFileSync(file).equals(untouched)).toBe(true);
    expect(readdirSync(scratch)).toEqual(['pedido.lila']);
  });

  test('two concurrent patches of the same .lila: one is refused or both are kept, never one lost', async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const file = archive(`race-${attempt}.lila`, repositoryDocument());
      const [first, second] = await Promise.all([
        call('patch_scenario', {
          project: file,
          process: 'pedido',
          scenario: 'as-is',
          patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 7 }],
        }),
        call('patch_scenario', {
          project: file,
          process: 'copia',
          scenario: 'solo',
          patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 9 }],
        }),
      ]);
      const [pedido, copia] = processesOf(decodeLila(new Uint8Array(readFileSync(file))));
      const capacityOf = (process: ProcessDocument | undefined, entry: string): number =>
        (process!.scenarios[entry] as { resources: { cajero: { capacity: number } } }).resources.cajero.capacity;
      const kept = [capacityOf(pedido, 'as-is.scenario.json') === 7, capacityOf(copia, 'solo.scenario.json') === 9];
      // Every call that answered OK has its change on disk; a refused one says why.
      expect(kept[0], first.text).toBe(!first.isError);
      expect(kept[1], second.text).toBe(!second.isError);
      for (const result of [first, second].filter((r) => r.isError)) expect(result.text).toContain('changed on disk');
      expect(first.isError && second.isError).toBe(false);
    }
    expect(readdirSync(scratch).every((name) => name.endsWith('.lila'))).toBe(true);
  });

  test('project must be a .lila, and a missing name does not talk about files', async () => {
    const notLila = await call('patch_scenario', { project: model, scenario: 'as-is', patch: [{ op: 'test', path: '/version', value: 1 }] });
    expect(notLila.isError).toBe(true);
    expect(notLila.text).toContain('`project` must be a .lila file');
    const file = archive('pedido.lila', pedidoDocument());
    const missing = await call('patch_scenario', { project: file, scenario: 'nada', patch: [{ op: 'test', path: '/version', value: 1 }] });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('there is no scenario "nada"');
    expect(missing.text).not.toContain('file "nada"');
  });

  test('a repository without process, and a scenario that is not there', async () => {
    const file = archive('repo.lila', repositoryDocument());
    const patch = [{ op: 'replace', path: '/run/seed', value: 1 }];
    const missing = await call('patch_scenario', { project: file, scenario: 'as-is', patch });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('several processes (pedido, copia)');
    const absent = await call('patch_scenario', { project: file, process: 'copia', scenario: 'as-is', patch });
    expect(absent.isError).toBe(true);
    expect(absent.text).toContain('its scenarios are: solo.scenario.json');
  });
});
