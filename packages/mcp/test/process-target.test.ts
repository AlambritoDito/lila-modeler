/**
 * #546 — the MCP tools on a `.lila` whose Customer pool is first in the document: every tool
 * picks the process its scenarios target (Restaurant), as `lila run` and the app do.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { customerFirstLila } from '../../engine/test/customer-first.js';
import { createServer } from '../src/server.js';

let client: Client;
let dir: string;
let file: string;

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, text: (result.content as { text: string }[])[0]?.text ?? '' };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lila-mcp-546-'));
  file = join(dir, 're.lila');
  await customerFirstLila(file, { run: true });
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-546', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

test('describe_process and validate_bpmn describe Restaurant, with or without a scenario', async () => {
  for (const args of [{ path: file }, { path: file, scenario: 'as-is' }]) {
    const described = await call('describe_process', args);
    expect(described.isError).toBe(false);
    expect((JSON.parse(described.text) as { ir: { id: string } }).ir.id).toBe('Process_Restaurante');
  }
  const validated = await call('validate_bpmn', { path: file });
  expect((JSON.parse(validated.text) as { ir: { id: string } }).ir.id).toBe('Process_Restaurante');
});

test('run_simulation runs Restaurant and export_results names its elements', async () => {
  const run = await call('run_simulation', { model: file, scenario: 'as-is', replications: 1 });
  expect(run.isError).toBe(false);
  expect(run.text).toContain('StartEvent_Pedido');
  const csv = await call('export_results', { project: file, format: 'csv', saveTo: join(dir, 'csv') });
  expect(csv.isError).toBe(false);
  expect(readFileSync(join(dir, 'csv', 'elements.csv'), 'utf8')).toMatch(/^StartEvent_Pedido,Order received,start,/m);
});
