/**
 * `create_process` and `get_process_outline` (#97) through the official MCP client against the
 * real `lila mcp` over stdio, as an agent would call them. Requires `dist/` (the root `pretest` and
 * the CI build first). The server runs in a scratch directory, so relative paths land there.
 */
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeLila, processesOf } from '@lila-modeler/engine/project';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, expect, test } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const credit = JSON.parse(readFileSync(join(repo, 'examples/outline/credit-application.json'), 'utf8')) as Record<string, unknown>;

let client: Client;
let cwd: string;

function textOf(result: { content: unknown }): string {
  return (result.content as { type: string; text: string }[])[0]?.text ?? '';
}

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, text: textOf(result) };
}

beforeAll(async () => {
  // realpath: on macOS the server's cwd is /private/var/…, not the /var/… of tmpdir().
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'lila-mcp-outline-')));
  client = new Client({ name: 'lila-outline', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd }));
}, 120_000);

afterAll(async () => {
  await client.close();
  rmSync(cwd, { recursive: true, force: true });
});

test('create_process writes a new .lila; get_process_outline reads the same outline back', async () => {
  const created = await call('create_process', { outline: credit, project: 'credit.lila' });
  expect(created.isError, created.text).toBe(false);
  const result = JSON.parse(created.text);
  expect(result).toMatchObject({ slug: 'credit-application', newFile: true, dryRun: false, warnings: [] });
  expect(result.file).toBe(join(cwd, 'credit.lila').replaceAll('\\', '/'));
  expect(result.summary).toContain('Created process "Credit application"');

  const read = await call('get_process_outline', { project: 'credit.lila' });
  expect(read.isError, read.text).toBe(false);
  const outline = JSON.parse(read.text);
  expect(outline.outline).toEqual(result.outline);
  expect(outline.outline.steps[1].duration).toEqual({ type: 'normal', mean: 1200, sd: 300 });
  expect(outline.outline.steps[2].branches).toEqual([
    { to: 'issue', label: 'Yes', probability: 0.7 },
    { to: 'reject', label: 'No', probability: 0.3 },
  ]);

  // The process it wrote runs: the other MCP tools take it as it is.
  const validated = await call('validate_bpmn', { path: 'credit.lila' });
  expect(JSON.parse(validated.text).errors).toEqual([]);
}, 120_000);

test('into a repository: other processes byte-identical; the same process twice is refused', async () => {
  copyFileSync(join(repo, 'examples/pedido.lila'), join(cwd, 'pedido.lila'));
  await call('create_process', { outline: credit, project: 'pedido.lila', process: 'first' });
  const before = unzipSync(new Uint8Array(readFileSync(join(cwd, 'pedido.lila'))));

  const second = await call('create_process', { outline: { ...credit, name: 'Second' }, project: 'pedido.lila' });
  expect(second.isError, second.text).toBe(false);
  const after = unzipSync(new Uint8Array(readFileSync(join(cwd, 'pedido.lila'))));
  for (const [name, bytes] of Object.entries(before)) if (name !== 'lila-project.json') expect(after[name], name).toEqual(bytes);
  expect(processesOf(decodeLila(new Uint8Array(readFileSync(join(cwd, 'pedido.lila'))))).map((p) => p.slug)).toEqual([
    'pedido',
    'first',
    'second',
  ]);

  const bytes = readFileSync(join(cwd, 'pedido.lila'));
  const again = await call('create_process', { outline: credit, project: 'pedido.lila', process: 'first', locale: 'es' });
  expect(again.isError).toBe(true);
  expect(again.text).toBe(`create_process: ${join(cwd, 'pedido.lila')} ya tiene un proceso "first"; no se escribió nada. Elige otro nombre u otro slug.`);
  expect(readFileSync(join(cwd, 'pedido.lila')).equals(bytes)).toBe(true);

  const show = await call('get_process_outline', { project: 'pedido.lila' });
  expect(show.isError).toBe(true);
  expect(show.text).toContain('get_process_outline: ');
}, 120_000);

test('dryRun writes nothing; a malformed outline is an error with every issue', async () => {
  const dry = await call('create_process', { outline: credit, project: 'dry.lila', dryRun: true });
  expect(JSON.parse(dry.text)).toMatchObject({ dryRun: true, newFile: true });
  expect(() => readFileSync(join(cwd, 'dry.lila'))).toThrow();

  const bad = await call('create_process', {
    outline: { name: 'Bad', steps: [{ id: 'a', next: 'nowhere' }, { id: 'b', duration: 'soon' }] },
    project: 'bad.lila',
  });
  expect(bad.isError).toBe(true);
  expect(bad.text).toContain('create_process: the outline is invalid:');
  expect(bad.text).toContain('steps[0].next: step "a": "nowhere" is not the id of a step.');
  expect(bad.text).toContain('steps[1].duration: step "b": duration "soon" is not a distribution.');

  // QA of #553: a typo does not stop the SDK before the handler; every problem comes back at once,
  // in the call's language.
  const typo = await call('create_process', {
    outline: { name: 'Bad', steps: [{ id: 'a', duraton: '5m', next: 'zz' }] },
    project: 'bad.lila',
    locale: 'es',
  });
  expect(typo.isError).toBe(true);
  expect(typo.text).toBe(
    'create_process: el esquema del proceso no es válido:\n' +
      '  steps[0].duraton: campo desconocido "duraton".\n' +
      '  steps[0].next: paso "a": "zz" no es el id de ningún paso.',
  );

  const empty = await call('create_process', { outline: { name: 'Bad', steps: [] }, project: 'bad.lila' });
  expect(empty.text).toContain('steps: must be a non-empty list of steps.');
}, 120_000);
