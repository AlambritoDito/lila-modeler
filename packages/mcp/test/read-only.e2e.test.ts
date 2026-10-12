/**
 * What an agent does to look at a `.lila` without changing it, through the official MCP client
 * against the real `lila mcp` over stdio: a `patch_scenario` that changes nothing keeps the saved
 * runs current (#627). Requires `dist/` (the root `pretest` and the CI build first).
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, expect, test } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const credit = JSON.parse(readFileSync(join(repo, 'examples/outline/credit-application.json'), 'utf8')) as Record<string, unknown>;

let client: Client;
let cwd: string;

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, text: (result.content as { text: string }[])[0]?.text ?? '' };
}

/** The tool's JSON answer, failing the test with the tool's own message when it is an error. */
async function answer<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const { isError, text } = await call(name, args);
  expect(isError, `${name}: ${text}`).toBe(false);
  return JSON.parse(text) as T;
}

beforeAll(async () => {
  // realpath: on macOS the server's cwd is /private/var/…, not the /var/… of tmpdir().
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'lila-mcp-read-only-')));
  client = new Client({ name: 'lila-read-only', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd }));
}, 120_000);

afterAll(async () => {
  await client?.close();
  rmSync(cwd, { recursive: true, force: true });
});

test('#627: a test-only patch_scenario leaves the saved run current (the steps of the issue)', async () => {
  // 1. create_process, then run_simulation with saveRun.
  await answer('create_process', { outline: credit, project: 'credit.lila' });
  const run = await call('run_simulation', { model: 'credit.lila', scenario: 'as-is', replications: 2, saveRun: true });
  expect(run.isError, run.text).toBe(false);
  // 2. export_results of that scenario works.
  await answer('export_results', { project: 'credit.lila', scenario: 'as-is', format: 'xlsx', saveTo: 'out/before.xlsx' });

  // 3. A patch with only `test`: nothing is written.
  const bytes = readFileSync(join(cwd, 'credit.lila'));
  const patched = await answer<{ written: boolean; notes: string[] }>('patch_scenario', {
    project: 'credit.lila',
    scenario: 'as-is',
    patch: [{ op: 'test', path: '/version', value: 1 }],
  });
  expect(patched.written).toBe(false);
  expect(patched.notes[0]).toMatch(/^the patch changes nothing/);
  expect(readFileSync(join(cwd, 'credit.lila')).equals(bytes)).toBe(true);

  // 4. export_results again: the run is still the current one.
  const after = await answer<{ run: { current: boolean } }>('export_results', {
    project: 'credit.lila',
    scenario: 'as-is',
    format: 'xlsx',
    saveTo: 'out/after.xlsx',
  });
  expect(after.run.current).toBe(true);
}, 120_000);
