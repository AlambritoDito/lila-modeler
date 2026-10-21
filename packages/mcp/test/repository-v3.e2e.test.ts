/**
 * A version 3 `.lila` (#92, RM-01 § 8) through every MCP tool that writes into a `.lila`, over the
 * real `lila mcp` on stdio: after each write, every entry the tool had no reason to touch — the
 * catalog objects (a type this build does not know and a broken one included), `maps/`,
 * `notes.md` and the other processes — is byte for byte what it was, the manifest stays version 3
 * and the process ids do not change. `get_project` reports `formatVersion: 3`. Requires `dist/`.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { BILLING_ID, FRONT_DESK_ID, v3Fixture } from '../../engine/test/project/fixtures/lila-v3.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const credit = JSON.parse(readFileSync(join(repo, 'examples/outline/credit-application.json'), 'utf8')) as Record<string, unknown>;

const EXTRA_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_Housekeeping" targetNamespace="https://lila-modeler.org/bpmn">
  <bpmn:process id="Process_Housekeeping" name="Housekeeping" isExecutable="false">
    <bpmn:startEvent id="Start_H"><bpmn:outgoing>Flow_H1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_H" name="Clean the room"><bpmn:incoming>Flow_H1</bpmn:incoming><bpmn:outgoing>Flow_H2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End_H"><bpmn:incoming>Flow_H2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_H1" sourceRef="Start_H" targetRef="Task_H" />
    <bpmn:sequenceFlow id="Flow_H2" sourceRef="Task_H" targetRef="End_H" />
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

/** The archive's entries as base64, by name. */
function entriesOf(file: string): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(readFileSync(file))).map(([name, data]) => [name, Buffer.from(data).toString('base64')]));
}

function manifestOf(file: string): { version: number; processes: { id: string; slug: string }[] } {
  return JSON.parse(Buffer.from(unzipSync(readFileSync(file))['lila-project.json']!).toString('utf8'));
}

beforeAll(async () => {
  temp = realpathSync(mkdtempSync(join(tmpdir(), 'lila-mcp-v3-')));
  client = new Client({ name: 'lila-v3-e2e', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd: temp }));
}, 120_000);

afterAll(async () => {
  await client.close();
  rmSync(temp, { recursive: true, force: true });
});

test('every writing tool leaves the entries it does not own byte for byte (RM-01 § 8)', async () => {
  const file = join(temp, 'hotel.lila');
  writeFileSync(file, v3Fixture({ notes: true }));
  writeFileSync(join(temp, 'Arrivals.csv'), 'id,triggerCount\nStart_1,7\n');

  const inventory = JSON.parse((await call('get_project', { project: 'hotel.lila' })).text) as { formatVersion: number };
  expect(inventory.formatVersion).toBe(3);

  /** One write by `tool`, which may only touch the manifest and the entries `owns` names. */
  async function write(tool: string, args: Record<string, unknown>, owns: (name: string) => boolean): Promise<void> {
    const before = entriesOf(file);
    const ids = manifestOf(file).processes.map((p) => [p.slug, p.id]);
    const result = await call(tool, args);
    expect(result.isError, `${tool}: ${result.text}`).toBe(false);
    const after = entriesOf(file);
    expect(after, `${tool} changed nothing`).not.toEqual(before);
    const kept = (entries: Record<string, string>): Record<string, string> =>
      Object.fromEntries(Object.entries(entries).filter(([name]) => name !== 'lila-project.json' && !owns(name)));
    expect(kept(after), `${tool} touched an entry it does not own`).toEqual(kept(before));
    const manifest = manifestOf(file);
    expect(manifest.version, tool).toBe(3);
    // Processes that stay keep their id.
    for (const [slug, id] of ids) {
      const still = manifest.processes.find((p) => p.slug === slug);
      if (still !== undefined) expect(still.id, `${tool}: ${slug}`).toBe(id);
    }
    for (const p of manifest.processes) expect(p.id).toMatch(/^process-[0-9a-z]{12}$/);
  }
  const under = (slug: string) => (name: string) => name.startsWith(`processes/${slug}/`);

  await write('patch_scenario', {
    project: 'hotel.lila', process: 'billing', scenario: 'as-is',
    patch: [{ op: 'replace', path: '/elements/Task_1/processingTime/value', value: 45 }],
  }, under('billing'));
  await write('run_simulation', { model: 'hotel.lila', process: 'billing', scenario: 'as-is', replications: 1, saveRun: true }, under('billing'));
  await write('annotate_element', { project: 'hotel.lila', process: 'front-desk', elementId: 'Task_1', documentation: 'Greets the guest.' }, under('front-desk'));
  await write('define_attribute', { project: 'hotel.lila', process: 'front-desk', name: 'SLA (min)', type: 'number', appliesTo: 'task' }, under('front-desk'));
  await write('edit_process', { project: 'hotel.lila', process: 'front-desk', operations: [{ op: 'rename', id: 'Task_1', name: 'Check in' }] }, under('front-desk'));
  await write('import_scenario_sheet', { project: 'hotel.lila', process: 'billing', scenario: 'as-is', sheet: 'Arrivals.csv' }, under('billing'));
  await write('put_process_bpmn', { project: 'hotel.lila', mode: 'add', bpmn: EXTRA_BPMN, name: 'Housekeeping' }, under('housekeeping'));
  await write('create_process', { outline: credit, project: 'hotel.lila' }, (name) => name.startsWith('processes/') && !under('front-desk')(name) && !under('billing')(name) && !under('housekeeping')(name));
  await write('rename_scenario', { project: 'hotel.lila', process: 'billing', scenario: 'as-is', name: 'Baseline' }, under('billing'));
  await write('rename_process', { project: 'hotel.lila', process: 'billing', name: 'Invoicing' }, under('billing'));
  await write('patch_scenario', {
    project: 'hotel.lila', process: 'housekeeping', scenario: 'as-is', saveTo: 'to-be',
    patch: [{ op: 'replace', path: '/elements/Task_H/processingTime/value', value: 30 }],
  }, under('housekeeping'));
  await write('delete_scenario', { project: 'hotel.lila', process: 'housekeeping', scenario: 'to-be' }, under('housekeeping'));
  await write('delete_process', { project: 'hotel.lila', process: 'housekeeping' }, under('housekeeping'));

  // After all of them the catalog, the kept entries and the first two process ids are still there.
  const final = entriesOf(file);
  const original = Object.fromEntries(Object.entries(unzipSync(v3Fixture({ notes: true }))).map(([n, d]) => [n, Buffer.from(d).toString('base64')]));
  for (const name of Object.keys(original).filter((n) => n.startsWith('catalog/') || n === 'maps/x.json' || n === 'notes.md')) {
    expect(final[name], name).toBe(original[name]);
  }
  const ids = Object.fromEntries(manifestOf(file).processes.map((p) => [p.slug, p.id]));
  expect(ids['front-desk']).toBe(FRONT_DESK_ID);
  expect(ids['billing']).toBe(BILLING_ID);
  expect(JSON.parse((await call('get_project', { project: 'hotel.lila' })).text).formatVersion).toBe(3);
}, 120_000);
