/**
 * `docs/MCP.md` and `docs/es/MCP.md` against the real server (#540): every tool `lila mcp` lists has
 * its signature (`tool({ … })`) and at least one call written as an agent sends it
 * (`{ "name": "tool", "arguments": … }`) in both languages, and neither doc names a tool that does
 * not exist. The signatures' argument lists are checked against the input schemas in
 * `smoke-m4.qa.test.ts`. Requires `dist/`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
let tools: string[];
let client: Client;

beforeAll(async () => {
  client = new Client({ name: 'lila-docs', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(repo, 'packages/engine/bin/lila.js'), 'mcp'], cwd: repo }));
  tools = (await client.listTools()).tools.map((tool) => tool.name).sort();
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe.each(['docs/MCP.md', 'docs/es/MCP.md'])('%s', (path) => {
  const doc = readFileSync(join(repo, path), 'utf8');
  const signatures = new Set([...doc.matchAll(/\*\*`(\w+)\(\{/g)].map((m) => m[1]!));
  const blocks = [...doc.matchAll(/```jsonc?\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const examples = new Set(blocks.flatMap((block) => [...block.matchAll(/"name": "(\w+)",\s*"arguments"/g)].map((m) => m[1]!)));

  test('every tool has its signature, and every signature is a tool', () => {
    expect([...signatures].sort()).toEqual(tools);
  });

  test('every tool has an example call', () => {
    expect(tools.filter((tool) => !examples.has(tool)), 'tools without a { "name", "arguments" } example').toEqual([]);
    expect([...examples].filter((name) => !tools.includes(name)), 'examples of tools that do not exist').toEqual([]);
  });
});
