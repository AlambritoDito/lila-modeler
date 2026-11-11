/**
 * #725 through the MCP server: a `.lila` whose base scenario is unreadable and that holds a loose
 * `notes.md` keeps both, byte for byte, across a tool that writes the archive, and `get_project`
 * reports them. In-memory transport, like `server.test.ts`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { createServer } from '../src/server.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const exampleLila = `${repo}examples/pedido.lila`;
const BROKEN = '{ "version": 1, "name": "AS-IS", ';
const NOTES = '# Notes\n\nKept by every write.\n';

let client: Client;
let scratch: string;
let file: string;

beforeEach(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  scratch = mkdtempSync(join(tmpdir(), 'lila-mcp-kept-'));
  file = join(scratch, 'pedido.lila');
  const entries = unzipSync(new Uint8Array(readFileSync(exampleLila)));
  entries['as-is.scenario.json'] = strToU8(BROKEN);
  entries['notes.md'] = strToU8(NOTES);
  writeFileSync(file, zipSync(entries));
});

afterEach(async () => {
  await client.close();
  rmSync(scratch, { recursive: true, force: true });
});

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
  return { isError: result.isError === true, text };
}

function entry(name: string): string | undefined {
  const bytes = unzipSync(new Uint8Array(readFileSync(file)))[name];
  return bytes === undefined ? undefined : Buffer.from(bytes).toString('utf8');
}

describe('entries the reader could not use, over MCP (#725)', () => {
  test('get_project reports them', async () => {
    const result = await call('get_project', { project: file });
    expect(result.isError, result.text).toBe(false);
    const inventory = JSON.parse(result.text) as { problems: { file: string; message: string }[] };
    expect(inventory.problems.map((p) => p.file).sort()).toEqual(['as-is.scenario.json', 'notes.md']);
  });

  test('a write keeps them byte for byte', async () => {
    const toBe = entry('to-be-3-cajeros.scenario.json');
    const result = await call('define_attribute', { project: file, name: 'SLA (h)', type: 'number', appliesTo: 'task' });
    expect(result.isError, result.text).toBe(false);
    expect(entry('as-is.scenario.json')).toBe(BROKEN);
    expect(entry('notes.md')).toBe(NOTES);
    expect(entry('to-be-3-cajeros.scenario.json')).toBe(toBe);
  });
});
