/**
 * `rename_process`, `delete_process`, `rename_scenario` and `delete_scenario` (#634) through the real
 * `lila mcp` over stdio, as an agent calls them: each operation, its dry run, its refusals in
 * English and Spanish with the file untouched, and what `get_project` sees afterwards. The deletes
 * are announced as destructive. Requires `dist/` (built before the tests).
 */
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { decodeLila, encodeLila, type ProcessDocument, type ProjectDocument } from '../../engine/src/project/index.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const exampleLila = join(repo, 'examples/pedido.lila');

/** A process whose call activity names pedido's `Process_Restaurante`. */
const CALLER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_Llamador" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_Llamador" isExecutable="false">
    <bpmn:startEvent id="Start_L" />
    <bpmn:callActivity id="Call_Pedido" name="Take order" calledElement="Process_Restaurante" />
    <bpmn:endEvent id="End_L" />
    <bpmn:sequenceFlow id="Flow_L1" sourceRef="Start_L" targetRef="Call_Pedido" />
    <bpmn:sequenceFlow id="Flow_L2" sourceRef="Call_Pedido" targetRef="End_L" />
  </bpmn:process>
</bpmn:definitions>
`;

let client: Client;
let temp: string;

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
  return { isError: result.isError === true, text };
}

/** pedido as a repository with a second process, `llamador`, that calls it. */
function repository(name: string): string {
  const file = join(temp, name);
  const base = decodeLila(readFileSync(exampleLila));
  const llamador: ProcessDocument = {
    slug: 'llamador',
    name: 'Llamador',
    model: { id: 'Process_Llamador', name: 'model.bpmn', xml: CALLER_XML, revision: 1 },
    scenarios: { 'as-is.scenario.json': { version: 1, name: 'AS-IS', model: 'model.bpmn' } },
    scenarioRevisions: { 'as-is.scenario.json': 1 },
    runs: [],
  };
  const document: ProjectDocument = { ...base, process: { slug: 'pedido', name: 'Pedido' }, processes: [llamador] };
  writeFileSync(file, encodeLila(document));
  return file;
}

beforeAll(async () => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), 'lila-mcp-manage-')));
  client = new Client({ name: 'lila-manage-e2e', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd: temp }));
}, 120_000);

afterAll(async () => {
  await client.close();
  rmSync(temp, { recursive: true, force: true });
});

test('the deletes are destructive, the renames are not', async () => {
  const { tools } = await client.listTools();
  const hints = Object.fromEntries(
    tools.filter((t) => /^(rename|delete)_(process|scenario)$/.test(t.name)).map((t) => [t.name, t.annotations?.destructiveHint]),
  );
  expect(hints).toEqual({ rename_process: false, delete_process: true, rename_scenario: false, delete_scenario: true });
});

test('rename_process and delete_process; refusals and dry runs write nothing', async () => {
  const file = repository('processes.lila');
  const bytes = readFileSync(file);
  const dry = await call('rename_process', { project: 'processes.lila', process: 'llamador', name: 'Caller', dryRun: true });
  expect(dry.isError, dry.text).toBe(false);
  expect(JSON.parse(dry.text)).toMatchObject({ dryRun: true, written: false, process: 'llamador', before: 'Llamador', after: 'Caller' });
  const called = await call('delete_process', { project: 'processes.lila', process: 'pedido' });
  expect(called.isError).toBe(true);
  expect(called.text).toMatch(/^delete_process: process pedido is the target of call activities in other processes: llamador\/Call_Pedido \(Take order\)/);
  const calledEs = await call('delete_process', { project: 'processes.lila', process: 'pedido', locale: 'es' });
  expect(calledEs.text).toMatch(/^delete_process: el proceso pedido es el destino de actividades de llamada/);
  expect(readFileSync(file)).toEqual(bytes);

  const renamed = await call('rename_process', { project: 'processes.lila', process: 'llamador', name: 'Caller' });
  expect(JSON.parse(renamed.text)).toMatchObject({ written: true, after: 'Caller' });
  const listed = JSON.parse((await call('get_project', { project: 'processes.lila' })).text);
  expect(listed.processes.map((p: { slug: string; name: string }) => [p.slug, p.name])).toEqual([['pedido', 'Pedido'], ['llamador', 'Caller']]);

  const deleted = await call('delete_process', { project: 'processes.lila', process: 'llamador' });
  expect(deleted.isError, deleted.text).toBe(false);
  expect(JSON.parse(deleted.text)).toMatchObject({ written: true, removedScenarios: ['as-is.scenario.json'], removedRuns: [], slugs: ['pedido'] });
  const single = JSON.parse((await call('get_project', { project: 'processes.lila' })).text);
  expect(single).toMatchObject({ formatVersion: 1, processes: [{ processId: 'Process_Restaurante' }] });
  const last = await call('delete_process', { project: 'processes.lila', process: 'pedido', locale: 'es' });
  expect(last.text).toMatch(/^delete_process: pedido es el único proceso/);
  const one = await call('rename_process', { project: 'processes.lila', process: 'pedido', name: 'X' });
  expect(one.text).toMatch(/^rename_process: .* has a single process/);
});

test('rename_scenario and delete_scenario; the runs of a deleted scenario are gone from get_project', async () => {
  copyFileSync(exampleLila, join(temp, 'scenarios.lila'));
  const saved = await call('run_simulation', { model: 'scenarios.lila', scenario: 'to-be-3-cajeros', replications: 1, saveRun: true });
  expect(saved.isError, saved.text).toBe(false);
  const runs = JSON.parse((await call('get_project', { project: 'scenarios.lila' })).text).processes[0].runs;
  expect(runs).toHaveLength(1);
  const bytes = readFileSync(join(temp, 'scenarios.lila'));

  const taken = await call('rename_scenario', { project: 'scenarios.lila', scenario: 'to-be-3-cajeros', name: 'AS-IS' });
  expect(taken.isError).toBe(true);
  expect(taken.text).toMatch(/already goes by "AS-IS"/);
  const extended = await call('delete_scenario', { project: 'scenarios.lila', scenario: 'as-is', locale: 'es' });
  expect(extended.text).toMatch(/^delete_scenario: otros escenarios heredan de as-is\.scenario\.json: to-be-3-cajeros\.scenario\.json/);
  const dry = await call('delete_scenario', { project: 'scenarios.lila', scenario: 'to-be-3-cajeros', dryRun: true });
  expect(JSON.parse(dry.text)).toMatchObject({ dryRun: true, written: false, removedRuns: [runs[0].id] });
  expect(readFileSync(join(temp, 'scenarios.lila'))).toEqual(bytes);

  const renamed = await call('rename_scenario', { project: 'scenarios.lila', scenario: 'to-be-3-cajeros', name: 'TO-BE' });
  expect(JSON.parse(renamed.text)).toMatchObject({ written: true, entry: 'to-be-3-cajeros.scenario.json', before: 'TO-BE 3 cashiers', after: 'TO-BE', revision: 2 });
  const deleted = await call('delete_scenario', { project: 'scenarios.lila', scenario: 'TO-BE' });
  expect(deleted.isError, deleted.text).toBe(false);
  expect(JSON.parse(deleted.text)).toMatchObject({ written: true, entry: 'to-be-3-cajeros.scenario.json', removedRuns: [runs[0].id] });
  const after = JSON.parse((await call('get_project', { project: 'scenarios.lila' })).text).processes[0];
  expect(after.runs).toEqual([]);
  expect(after.scenarios.map((s: { entry: string }) => s.entry)).toEqual(['as-is.scenario.json']);
  const lastOne = await call('delete_scenario', { project: 'scenarios.lila', scenario: 'as-is' });
  expect(lastOne.text).toMatch(/^delete_scenario: as-is\.scenario\.json is the only scenario of process/);
}, 120_000);
