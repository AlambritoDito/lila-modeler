/**
 * #635: `patch_scenario` `dryRun` (both modes, on disk and in a `.lila`) validates and writes
 * nothing, and `get_project` reads a `.lila` that `lila project create` wrote. The patch logic
 * itself is pinned by `patch-scenario.test.ts` and `patch-scenario.qa.test.ts`, unchanged by the
 * move into the engine. Requires `dist/` (the CLI runs from `packages/engine/bin/lila.js`).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { createServer } from '../src/server.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const pedidoBpmn = `${repo}examples/pedido/model.bpmn`;
const pedidoScenario = `${repo}examples/pedido/as-is.scenario.json`;
const FOUR_COOKS = [{ op: 'replace', path: '/resources/cocinero/capacity', value: 4 }];

let client: Client;
let scratch: string;

beforeEach(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  scratch = mkdtempSync(join(tmpdir(), 'lila-mcp-dry-run-'));
});

afterEach(async () => {
  await client.close();
  rmSync(scratch, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, text: (result.content as { text: string }[])[0]?.text ?? '' };
}

function copyAsIs(): string {
  const raw = JSON.parse(readFileSync(pedidoScenario, 'utf8')) as Record<string, unknown>;
  const path = join(scratch, 'copia.scenario.json');
  writeFileSync(path, JSON.stringify({ ...raw, model: pedidoBpmn }));
  return path;
}

test('dryRun on disk: in place and with saveTo, nothing is written', async () => {
  const path = copyAsIs();
  const bytes = readFileSync(path);
  const inPlace = await call('patch_scenario', { scenario: path, patch: FOUR_COOKS, dryRun: true });
  expect(inPlace.isError, inPlace.text).toBe(false);
  const answer = JSON.parse(inPlace.text) as { written: boolean; dryRun: boolean; file: string; notes: string[]; scenario: { resources: Record<string, { capacity: number }> } };
  expect(answer).toMatchObject({ written: false, dryRun: true, file: path });
  expect(answer.scenario.resources['cocinero']!.capacity).toBe(4);
  expect(answer.notes[0]).toMatch(/^Dry run: the result validates/);
  expect(readFileSync(path).equals(bytes)).toBe(true);

  const saveTo = join(scratch, 'hijo.scenario.json');
  const child = await call('patch_scenario', { scenario: path, patch: FOUR_COOKS, saveTo, dryRun: true, locale: 'es' });
  expect(child.isError, child.text).toBe(false);
  expect(JSON.parse(child.text)).toMatchObject({ written: false, dryRun: true, file: saveTo });
  expect((JSON.parse(child.text) as { notes: string[] }).notes[0]).toMatch(/^Simulacro: el resultado valida/);
  expect(existsSync(saveTo)).toBe(false);
});

test('dryRun refuses an invalid patch like the write', async () => {
  const path = copyAsIs();
  const bytes = readFileSync(path);
  const refused = await call('patch_scenario', { scenario: path, patch: [{ op: 'replace', path: '/resources/cocinero/capacity', value: 0 }], dryRun: true });
  expect(refused.isError).toBe(true);
  expect(refused.text).toMatch(/^patch_scenario: invalid scenario after the patch/);
  expect(readFileSync(path).equals(bytes)).toBe(true);
});

test('dryRun in a .lila leaves the archive byte for byte; without it, the same call writes', async () => {
  const file = join(scratch, 'pedido.lila');
  copyFileSync(`${repo}examples/pedido.lila`, file);
  const bytes = readFileSync(file);
  const dry = await call('patch_scenario', { project: file, scenario: 'as-is', patch: FOUR_COOKS, saveTo: 'to-be-4-cocineros', dryRun: true });
  expect(dry.isError, dry.text).toBe(false);
  expect(JSON.parse(dry.text)).toMatchObject({ written: false, dryRun: true, process: 'pedido', entry: 'to-be-4-cocineros.scenario.json' });
  expect(readFileSync(file).equals(bytes)).toBe(true);

  const written = await call('patch_scenario', { project: file, scenario: 'as-is', patch: FOUR_COOKS, saveTo: 'to-be-4-cocineros' });
  expect(written.isError, written.text).toBe(false);
  expect(JSON.parse(written.text)).toMatchObject({ written: true, dryRun: false, entry: 'to-be-4-cocineros.scenario.json' });
  const project = JSON.parse((await call('get_project', { project: file })).text) as { processes: { scenarios: { entry: string }[] }[] };
  expect(project.processes[0]!.scenarios.map((s) => s.entry)).toContain('to-be-4-cocineros.scenario.json');
});

test('get_project reads a .lila that lila project create wrote', async () => {
  const file = join(scratch, 'orders.lila');
  execFileSync(process.execPath, [
    join(repo, 'packages/engine/bin/lila.js'), 'project', 'create', file,
    '--name', 'Orders', '--bpmn', pedidoBpmn, '--scenario', `as-is=${pedidoScenario}`,
  ]);
  const read = await call('get_project', { project: file });
  expect(read.isError, read.text).toBe(false);
  expect(JSON.parse(read.text)).toMatchObject({
    name: 'Orders',
    formatVersion: 1,
    processes: [{ processId: 'Process_Restaurante', scenarios: [{ entry: 'as-is.scenario.json', revision: 1 }] }],
  });
}, 60_000);
