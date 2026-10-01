/**
 * `edit_process` (#98) through the official MCP client against the real `lila mcp` over stdio, as
 * an agent would call it: the example of docs/MCP.md on a process `create_process` made, a dry run,
 * a refused edit (file unchanged, every problem with its operation), and an edit of the app's
 * example `examples/pedido.lila`. Requires `dist/` (the root `pretest` and the CI build first).
 */
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeLila } from '@lila-modeler/engine/project';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, expect, test } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const credit = JSON.parse(readFileSync(join(repo, 'examples/outline/credit-application.json'), 'utf8')) as Record<string, unknown>;
const pedidoOps = JSON.parse(readFileSync(join(repo, 'examples/outline/pedido-edit.json'), 'utf8')) as unknown[];

/** The example of docs/MCP.md § Editing a process. */
const DOC_OPERATIONS = [
  { op: 'add', step: { id: 'verify', name: 'Verify identity', duration: '5m', resources: ['Analyst'] }, after: 'receive' },
  { op: 'connect', from: 'ok', to: 'verify', label: 'Retry', probability: 0.1 },
  { op: 'rename', id: 'issue', name: 'Issue the card' },
  { op: 'setType', id: 'check', type: 'serviceTask' },
  { op: 'addLane', name: 'Back office' },
  { op: 'moveToLane', id: 'issue', lane: 'Back office' },
  { op: 'remove', id: 'reject' },
];

let client: Client;
let cwd: string;

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
  return { isError: result.isError === true, text };
}

const bytes = (file: string): Buffer => readFileSync(join(cwd, file));

beforeAll(async () => {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'lila-mcp-edit-')));
  client = new Client({ name: 'lila-edit', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd }));
  const created = await call('create_process', { outline: credit, project: 'credit.lila' });
  expect(created.isError, created.text).toBe(false);
}, 120_000);

afterAll(async () => {
  await client.close();
  rmSync(cwd, { recursive: true, force: true });
});

test('dryRun returns the changes and the outline after, and writes nothing', async () => {
  const before = bytes('credit.lila');
  const dry = await call('edit_process', { project: 'credit.lila', operations: DOC_OPERATIONS, dryRun: true });
  expect(dry.isError, dry.text).toBe(false);
  const result = JSON.parse(dry.text);
  expect(result).toMatchObject({ slug: 'credit-application', dryRun: true, removed: ['Flow_reject_EndEvent_reject', 'reject'] });
  expect(result.changes.map((c: { op: number }) => c.op)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(result.outline.lanes).toEqual(['Customer', 'Analyst', 'Back office']);
  expect(bytes('credit.lila').equals(before)).toBe(true);
}, 120_000);

test('the docs example: written, validated, and read back by get_process_outline', async () => {
  const edited = await call('edit_process', { project: 'credit.lila', operations: DOC_OPERATIONS });
  expect(edited.isError, edited.text).toBe(false);
  const result = JSON.parse(edited.text);
  expect(result.summary).toBe(`Edited process "Credit application" (credit-application) in ${join(cwd, 'credit.lila')}: 7 operations, 2 elements removed.`);
  expect(result.notes).toEqual([
    'gateway "ok": the probabilities of its outgoing flows in as-is.scenario.json now add up to 1.1; adjust them with patch_scenario, one {"op": "replace", "path": "/elements/<flow>/probability", "value": …} per flow of Flow_ok_issue, Flow_ok_reject, Flow_ok_verify.',
  ]);

  const read = await call('get_process_outline', { project: 'credit.lila' });
  const outline = JSON.parse(read.text).outline;
  expect(outline).toEqual(result.outline);
  expect(outline.steps.find((s: { id: string }) => s.id === 'verify')).toMatchObject({
    lane: 'Analyst',
    duration: { type: 'constant', value: 300 },
    resources: ['Analyst'],
  });
  expect(outline.steps.find((s: { id: string }) => s.id === 'issue')).toMatchObject({ name: 'Issue the card', lane: 'Back office' });
  const validated = await call('validate_bpmn', { path: 'credit.lila' });
  expect(JSON.parse(validated.text).errors).toEqual([]);
}, 120_000);

test('a refused edit: isError, every problem with its operation, the file byte-identical', async () => {
  const before = bytes('credit.lila');
  const refused = await call('edit_process', {
    project: 'credit.lila',
    operations: [
      { op: 'rename', id: 'check', name: 'fine' },
      { op: 'connect', from: 'check' },
      { op: 'remove', id: 'nope' },
    ],
  });
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain('edit_process: the edit was refused; nothing was changed:');
  expect(refused.text).toContain('operations[1].to: must be a non-empty text.');
  expect(refused.text).toContain('operations[2].id: "nope" is not the id of an element of the model.');

  const semantic = await call('edit_process', {
    project: 'credit.lila',
    operations: [{ op: 'rename', id: 'check', name: 'fine' }, { op: 'remove', id: 'nope' }, { op: 'moveToLane', id: 'check', lane: 'Nowhere' }],
    locale: 'es',
  });
  expect(semantic.isError).toBe(true);
  expect(semantic.text).toContain('operations[1].id: "nope" no es el id de un elemento del modelo.');
  expect(semantic.text).toContain('operations[2].lane: no hay un carril "Nowhere"');
  expect(bytes('credit.lila').equals(before)).toBe(true);

  // Not even a list: still the engine's own message, in the call's language.
  const notList = await call('edit_process', { project: 'credit.lila', operations: { op: 'remove', id: 'check' }, locale: 'es' });
  expect(notList.isError).toBe(true);
  expect(notList.text).toBe('edit_process: la edición se rechazó; no se cambió nada:\n  operations: debe ser una lista no vacía de operaciones.');
}, 120_000);

test('editing the app example keeps the scenario keys; layout: false', async () => {
  copyFileSync(join(repo, 'examples/pedido.lila'), join(cwd, 'pedido.lila'));
  const edited = await call('edit_process', { project: 'pedido.lila', operations: pedidoOps, layout: false });
  expect(edited.isError, edited.text).toBe(false);
  const document = decodeLila(new Uint8Array(bytes('pedido.lila')));
  expect(document.model.xml).toContain('<bpmn:userTask id="Task_Revisar" name="Review order">');
  expect(document.model.xml).toContain('<bpmn:task id="Task_Preparar" name="Cook">');
  const elements = document.scenarios['as-is.scenario.json']!.elements as Record<string, unknown>;
  expect(elements['Task_Revisar']).toBeDefined();
  expect(elements['Task_Cobrar']).toEqual({ processingTime: { type: 'constant', value: 120 }, resources: [{ ref: 'cajero', quantity: 1 }] });
  const run = await call('run_simulation', { model: 'pedido.lila', scenario: 'as-is', replications: 1 });
  expect(run.isError, run.text).toBe(false);
}, 120_000);
