/**
 * The tools of #99, #403 and #514 through the real `lila mcp` over stdio, as an agent calls them:
 * create a project, annotate it, read its RACI matrix, hand out the scenario sheet and import it
 * back. Refusals come back as `isError` in English and Spanish with the file untouched, and a
 * repository's other process stays byte-identical. Requires `dist/` (built before the tests).
 */
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { decodeLila, encodeLila, type ProjectDocument } from '../../engine/src/project/index.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const exampleLila = join(repo, 'examples/pedido.lila');
const modelXml = readFileSync(join(repo, 'examples/pedido/model.bpmn'), 'utf8');
const asIs = JSON.parse(readFileSync(join(repo, 'examples/pedido/as-is.scenario.json'), 'utf8')) as Record<string, unknown>;

let client: Client;
let temp: string;

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
  return { isError: result.isError === true, text };
}

beforeAll(async () => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), 'lila-mcp-agent-')));
  client = new Client({ name: 'lila-agent-tools-e2e', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd: temp }));
}, 120_000);

afterAll(async () => {
  await client.close();
  rmSync(temp, { recursive: true, force: true });
});

test('create_project writes a .lila that decodeLila reads back; refusals write nothing', async () => {
  const created = await call('create_project', {
    path: 'agent/pedido.lila',
    name: 'Pedido',
    bpmn: modelXml,
    scenarios: [{ name: 'as-is', scenario: asIs }, { name: 'draft', scenario: { version: 1, name: 'Draft' } }],
  });
  expect(created.isError, created.text).toBe(false);
  const answer = JSON.parse(created.text);
  expect(answer).toMatchObject({ file: `${temp}/agent/pedido.lila`, name: 'Pedido', processId: 'Process_Restaurante' });
  expect(answer.scenarios.map((s: { entry: string; runnable: boolean }) => [s.entry, s.runnable])).toEqual([
    ['as-is.scenario.json', true],
    ['draft.scenario.json', false],
  ]);
  const document = decodeLila(readFileSync(join(temp, 'agent/pedido.lila')));
  expect(document.model.xml).toBe(modelXml);
  expect(document.scenarios['as-is.scenario.json']).toEqual(asIs);

  // It simulates like any .lila.
  const run = await call('run_simulation', { model: 'agent/pedido.lila', scenario: 'as-is', replications: 1 });
  expect(run.isError, run.text).toBe(false);

  const before = readFileSync(join(temp, 'agent/pedido.lila'));
  const again = await call('create_project', { path: 'agent/pedido.lila', name: 'Otro', bpmn: modelXml, locale: 'es' });
  expect(again).toEqual({ isError: true, text: `create_project: ${temp}/agent/pedido.lila ya existe; no se escribió nada. Pasa \`overwrite\` para reemplazarlo.` });
  const invalid = await call('create_project', { path: 'agent/bad.lila', name: 'Bad', bpmn: '<definitions/>' });
  expect(invalid.isError).toBe(true);
  expect(invalid.text).toMatch(/^create_project: the (BPMN cannot be read|model has \d+ validation errors?); nothing was written/);
  const notObject = await call('create_project', { path: 'agent/bad.lila', name: 'Bad', bpmn: modelXml, scenarios: [{ name: 'x', scenario: 'nope' }] });
  expect(notObject.text).toBe('create_project: scenario "x" must be a JSON object.');
  expect(readFileSync(join(temp, 'agent/pedido.lila'))).toEqual(before);
  expect(readdirSync(join(temp, 'agent'))).toEqual(['pedido.lila']);
}, 120_000);

test('annotate_element and get_raci_matrix on a repository; the other process stays byte-identical', async () => {
  const base = decodeLila(readFileSync(exampleLila));
  const repository: ProjectDocument = {
    ...base,
    process: { slug: 'pedido', name: 'Pedido' },
    processes: [{ slug: 'copia', name: 'Copia', model: base.model, scenarios: base.scenarios, scenarioRevisions: base.scenarioRevisions, runs: [] }],
  };
  writeFileSync(join(temp, 'repo.lila'), encodeLila(repository));
  const copia = (): Record<string, Uint8Array> =>
    Object.fromEntries(Object.entries(unzipSync(readFileSync(join(temp, 'repo.lila')))).filter(([name]) => name.startsWith('processes/copia/')));
  const untouched = copia();

  const dry = await call('annotate_element', {
    project: 'repo.lila', process: 'pedido', elementId: 'Task_TomarPedido', responsibilities: [{ type: 'R', roleRef: 'cajero' }], dryRun: true,
  });
  expect(JSON.parse(dry.text)).toMatchObject({ dryRun: true, changed: true, written: false });
  expect(JSON.parse((await call('get_raci_matrix', { project: 'repo.lila', process: 'pedido' })).text).rows).toEqual([]);

  const done = await call('annotate_element', {
    project: 'repo.lila',
    process: 'pedido',
    elementId: 'Task_TomarPedido',
    documentation: 'Takes the order.',
    responsibilities: [{ type: 'R', roleRef: 'cajero' }, { type: 'A', roleRef: 'gerente' }],
    refs: { systemRef: ['POS'] },
  });
  expect(done.isError, done.text).toBe(false);
  expect(JSON.parse(done.text).after).toEqual({
    documentation: 'Takes the order.',
    responsibilities: [{ type: 'R', roleRef: 'cajero' }, { type: 'A', roleRef: 'gerente' }],
    refs: { systemRef: ['POS'] },
  });
  const matrix = JSON.parse((await call('get_raci_matrix', { project: 'repo.lila', process: 'pedido' })).text);
  expect(matrix).toMatchObject({ process: 'pedido', roles: ['cajero', 'gerente'] });
  expect(matrix.rows).toEqual([
    {
      id: 'Task_TomarPedido',
      name: 'Take order',
      responsibilities: [{ type: 'R', roleRef: 'cajero' }, { type: 'A', roleRef: 'gerente' }],
      cells: { cajero: 'R', gerente: 'A' },
    },
  ]);
  expect(copia()).toEqual(untouched);

  const bytes = readFileSync(join(temp, 'repo.lila'));
  const unknown = await call('annotate_element', { project: 'repo.lila', process: 'pedido', elementId: 'Nope', documentation: 'x', locale: 'es' });
  expect(unknown.isError).toBe(true);
  expect(unknown.text).toBe(`annotate_element: ningún elemento del proceso pedido de ${temp}/repo.lila tiene el id "Nope"; no se escribió nada.`);
  const raci = await call('annotate_element', { project: 'repo.lila', process: 'pedido', elementId: 'Task_Revisar', responsibilities: [{ type: 'Z', roleRef: 'x' }] });
  expect(raci.text).toBe('annotate_element: "Z" is not a RACI type; use R, A, C or I.');
  const noProcess = await call('get_raci_matrix', { project: 'repo.lila' });
  expect(noProcess.isError).toBe(true);
  expect(readFileSync(join(temp, 'repo.lila'))).toEqual(bytes);
}, 120_000);

test('export_scenario_template, then import_scenario_sheet: dry run, write, and a refused plan', async () => {
  writeFileSync(join(temp, 'sheets.lila'), readFileSync(exampleLila));
  const template = await call('export_scenario_template', { project: 'sheets.lila', scenario: 'as-is', saveTo: 'as-is.xlsx' });
  expect(JSON.parse(template.text)).toMatchObject({ file: `${temp}/as-is.xlsx`, scenario: 'as-is.scenario.json', process: 'pedido' });
  expect((await call('export_scenario_template', { project: 'sheets.lila', scenario: 'as-is', saveTo: 'as-is.xlsx' })).isError).toBe(true);
  const roundTrip = JSON.parse((await call('import_scenario_sheet', { project: 'sheets.lila', scenario: 'as-is', sheet: 'as-is.xlsx' })).text);
  expect(roundTrip).toMatchObject({ changes: [], written: false });

  writeFileSync(join(temp, 'Resources.csv'), 'id,capacity\ncajero,4\n');
  const original = readFileSync(join(temp, 'sheets.lila'));
  const dry = JSON.parse((await call('import_scenario_sheet', { project: 'sheets.lila', scenario: 'to-be-3-cajeros', sheet: 'Resources.csv', dryRun: true, locale: 'es' })).text);
  expect(dry).toMatchObject({ dryRun: true, written: false, scenario: 'to-be-3-cajeros.scenario.json' });
  expect(dry.changes.map((change: { text: string }) => change.text)).toEqual(['Cashier (cajero) · capacity: 3 → 4']);
  expect(readFileSync(join(temp, 'sheets.lila'))).toEqual(original);

  const applied = await call('import_scenario_sheet', { project: 'sheets.lila', scenario: 'to-be-3-cajeros', sheet: 'Resources.csv' });
  expect(JSON.parse(applied.text).written).toBe(true);
  const saved = decodeLila(readFileSync(join(temp, 'sheets.lila')));
  expect(saved.scenarios['to-be-3-cajeros.scenario.json']).toEqual({
    version: 1, name: 'TO-BE 3 cashiers', extends: 'as-is.scenario.json', resources: { cajero: { capacity: 4 } },
  });
  expect(saved.scenarios['as-is.scenario.json']).toEqual(decodeLila(original).scenarios['as-is.scenario.json']);

  writeFileSync(join(temp, 'Elements.csv'), 'id,probability\nTask_TomarPedido,0.5\n');
  const before = readFileSync(join(temp, 'sheets.lila'));
  const lint = await call('import_scenario_sheet', { project: 'sheets.lila', scenario: 'as-is', sheet: 'Elements.csv', locale: 'es' });
  expect(lint.isError).toBe(true);
  expect(lint.text).toMatch(/^import_scenario_sheet: la importación dejaría el escenario con \d+ errore?s?; no se escribió nada: /);
  const missing = await call('import_scenario_sheet', { project: 'sheets.lila', scenario: 'as-is', sheet: 'none.csv' });
  expect(missing.text).toBe(`import_scenario_sheet: the file ${temp}/none.csv does not exist.`);
  expect(readFileSync(join(temp, 'sheets.lila'))).toEqual(before);
}, 120_000);
