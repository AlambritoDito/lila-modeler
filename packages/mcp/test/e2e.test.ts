/**
 * E2E de LILA-056: el cliente MCP oficial contra `node packages/engine/bin/lila.js mcp`, el
 * subcomando real, por `StdioClientTransport` — procesos de verdad, no `InMemoryTransport`.
 * Requiere `dist/` (el `pretest` de la raíz y el CI construyen antes de los tests).
 *
 * Cubre los dos flujos de la aceptación del hito M4 tal como los haría un agente:
 * "simula examples/pedido con as-is y dime el cuello de botella" y "qué pasa si agrego un cajero".
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const asIs = 'examples/pedido/as-is.scenario.json';

let client: Client;
let temp: string;

/** Texto del primer bloque de contenido, que es donde viaja el JSON de todas las tools. */
function textOf(result: { content: unknown }): string {
  return (result.content as { type: string; text: string }[])[0]?.text ?? '';
}

function jsonOf(result: { content: unknown }): any {
  return JSON.parse(textOf(result));
}

beforeAll(async () => {
  temp = mkdtempSync(join(tmpdir(), 'lila-mcp-e2e-'));
  client = new Client({ name: 'lila-e2e', version: '0' });
  // cwd del servidor = raíz del repo: las rutas relativas de las tools se resuelven contra ahí.
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd: repo }),
  );
}, 120_000);

afterAll(async () => {
  await client.close();
  rmSync(temp, { recursive: true, force: true });
});

test('`lila mcp` sirve sus tools por stdio', async () => {
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    'annotate_element',
    'compare_scenarios',
    'create_process',
    'create_project',
    'define_attribute',
    'delete_process',
    'delete_scenario',
    'describe_process',
    'edit_process',
    'export_diagram',
    'export_document',
    'export_results',
    'export_scenario_template',
    'get_process_bpmn',
    'get_process_outline',
    'get_project',
    'get_raci_matrix',
    'get_scenario',
    'import_scenario_sheet',
    'patch_scenario',
    'put_process_bpmn',
    'rename_process',
    'rename_scenario',
    'run_simulation',
    'validate_bpmn',
  ]);
}, 120_000);

test('flujo "dime el cuello de botella": el mismo bottlenecks[0] que `lila run --json`', async () => {
  const result = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: asIs, seed: 42 },
  });
  expect(result.isError ?? false).toBe(false);

  const cli = join(temp, 'cli.json');
  execFileSync(process.execPath, [lilaBin, 'run', 'examples/pedido/model.bpmn', asIs, '--seed', '42', '--json', cli], {
    cwd: repo,
    stdio: 'ignore',
  });

  const viaTool = jsonOf(result).bottlenecks;
  const viaCli = JSON.parse(readFileSync(cli, 'utf8')).bottlenecks;
  expect(viaTool[0]).toEqual(viaCli[0]);
  expect(viaTool).toEqual(viaCli);
  expect(typeof viaTool[0].elementId).toBe('string');
}, 120_000);

test('flujo "qué pasa si agrego un cajero": patch_scenario con extends y compare_scenarios coherente', async () => {
  const saveTo = join(temp, 'to-be-3-cajeros.scenario.json');
  const patched = await client.callTool({
    name: 'patch_scenario',
    arguments: {
      scenario: asIs,
      // Un cajero más que el as-is (capacity 2).
      patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
      saveTo,
      extendsFrom: asIs,
      name: 'TO-BE 3 cashiers',
    },
  });
  expect(patched.isError ?? false).toBe(false);

  const escrito = JSON.parse(readFileSync(saveTo, 'utf8'));
  expect(escrito.extends).toBeTypeOf('string');
  expect(escrito.resources).toEqual({ cajero: { capacity: 3 } });
  expect(jsonOf(patched).scenario.resources.cajero.capacity).toBe(3);

  const compared = await client.callTool({
    name: 'compare_scenarios',
    arguments: { scenarios: [asIs, saveTo], seed: 42 },
  });
  expect(compared.isError ?? false).toBe(false);

  const rows = jsonOf(compared).comparison.rows as {
    kpi: string;
    base: number | null;
    values: (number | null)[];
    significant: boolean[];
  }[];
  const espera = rows.find((row) => row.kpi === 'elements.Task_TomarPedido.resourceWait.mean');
  expect(espera).toBeDefined();
  expect(espera!.values[1]).toBeLessThan(espera!.base!);
  expect(espera!.significant[1]).toBe(true);
}, 120_000);

test('resources (#637): the guide and the formats, read over stdio', async () => {
  const { resources } = await client.listResources();
  expect(resources.map((resource) => resource.uri).sort()).toEqual([
    'lila://guide',
    'lila://outline-format',
    'lila://scenario-format',
    'lila://scenario-schema',
  ]);
  const guide = await client.readResource({ uri: 'lila://guide' });
  expect(guide.contents[0]).toMatchObject({ uri: 'lila://guide', mimeType: 'text/markdown' });
  // The server's language is English here (`lila mcp` without --lang): docs/AGENT_GUIDE.md as is.
  expect((guide.contents[0] as { text: string }).text).toBe(readFileSync(join(repo, 'docs/AGENT_GUIDE.md'), 'utf8'));

  const { prompts } = await client.listPrompts();
  expect(prompts.map((prompt) => prompt.name)).toEqual(['interview-to-process']);
}, 120_000);

test('a 30-replication run reports its progress and can be cancelled (#637)', async () => {
  const progress: number[] = [];
  const run = await client.callTool(
    { name: 'run_simulation', arguments: { scenario: asIs, seed: 3, replications: 30 } },
    { onprogress: ({ progress: done, total }) => { expect(total).toBe(30); progress.push(done); } },
  );
  expect(run.isError ?? false).toBe(false);
  expect(progress).toEqual(Array.from({ length: 30 }, (_, index) => index + 1));

  // Cancel after the third replication: the call rejects, the server answers a ping at once and
  // keeps serving.
  const controller = new AbortController();
  const seen: number[] = [];
  const cancelled = client.callTool(
    { name: 'run_simulation', arguments: { scenario: asIs, seed: 4, replications: 30 } },
    {
      signal: controller.signal,
      onprogress: ({ progress: done }) => {
        seen.push(done);
        if (done === 3) controller.abort(new Error('enough'));
      },
    },
  );
  await expect(cancelled).rejects.toThrow('enough');
  expect(seen.slice(0, 3)).toEqual([1, 2, 3]);
  expect(seen.length).toBeLessThan(30);
  await client.ping();
  const after = await client.callTool({ name: 'run_simulation', arguments: { scenario: asIs, seed: 4, replications: 1 } });
  expect(after.isError ?? false).toBe(false);
}, 120_000);

/** The text blocks after the answer, parsed: where `logTo` and `saveRun` went (#665). */
function writtenOf(result: { content: unknown }): unknown[] {
  return (result.content as { text: string }[]).slice(1).map((block) => JSON.parse(block.text));
}

test('logTo (#665): the same bytes as the log.csv of `lila run --csv`, published with saveTo', async () => {
  const logTo = join(temp, 'log-mcp', 'run.log.csv');
  const saveTo = join(temp, 'log-mcp', 'run.json');
  const run = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: asIs, seed: 42, replications: 2, logTo, saveTo },
  });
  expect(run.isError ?? false).toBe(false);
  expect(writtenOf(run)).toEqual([{ log: logTo }]);

  const csv = join(temp, 'log-cli');
  const json = join(temp, 'log-cli.json');
  execFileSync(
    process.execPath,
    [lilaBin, 'run', 'examples/pedido/model.bpmn', asIs, '--seed', '42', '--replications', '2', '--csv', csv, '--json', json],
    { cwd: repo, stdio: 'ignore' },
  );
  const viaCli = readFileSync(join(csv, 'log.csv'));
  expect(viaCli.length).toBeGreaterThan(1000);
  expect(readFileSync(logTo).equals(viaCli)).toBe(true);
  // Streaming the log changes nothing in the run: the same `RunResult` as the CLI's and as a call
  // without `logTo`, whose answer still has one block.
  expect(readFileSync(saveTo, 'utf8')).toBe(readFileSync(json, 'utf8'));
  expect(readdirSync(join(temp, 'log-mcp')).sort()).toEqual(['run.json', 'run.log.csv']);
  const plain = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: asIs, seed: 42, replications: 2, detail: 'full' },
  });
  expect((plain.content as unknown[]).length).toBe(1);
  expect(plain.structuredContent).toEqual(JSON.parse(readFileSync(saveTo, 'utf8')));

  // `logTo` never replaces `saveTo` or an input of the call.
  for (const taken of [saveTo, asIs]) {
    const refused = await client.callTool({
      name: 'run_simulation',
      arguments: { scenario: asIs, seed: 42, logTo: taken, saveTo },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('`logTo`');
  }
  expect(readFileSync(saveTo, 'utf8')).toBe(readFileSync(json, 'utf8'));
}, 120_000);

test('logTo (#665): a directory is refused and a cancelled run leaves neither the log nor a temporary', async () => {
  const dir = join(temp, 'log-dir');
  mkdirSync(join(dir, 'taken.csv'), { recursive: true });
  const refused = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: asIs, seed: 1, logTo: join(dir, 'taken.csv') },
  });
  expect(refused.isError).toBe(true);
  expect(readdirSync(dir)).toEqual(['taken.csv']);

  const logTo = join(dir, 'cancelled.csv');
  const controller = new AbortController();
  let staged: string[] = [];
  const cancelled = client.callTool(
    { name: 'run_simulation', arguments: { scenario: asIs, seed: 4, replications: 30, logTo } },
    {
      signal: controller.signal,
      onprogress: ({ progress: done }) => {
        if (done !== 3) return;
        staged = readdirSync(dir).filter((name) => name.startsWith('cancelled.csv.tmp-'));
        controller.abort(new Error('enough'));
      },
    },
  );
  await expect(cancelled).rejects.toThrow('enough');
  // The log was being written to its temporary file when the run was cancelled…
  expect(staged).toHaveLength(1);
  // …and the server removes it once the worker has stopped.
  await vi.waitFor(() => expect(readdirSync(dir)).toEqual(['taken.csv']), { timeout: 10_000 });
  expect(existsSync(logTo)).toBe(false);
  const after = await client.callTool({ name: 'run_simulation', arguments: { scenario: asIs, seed: 4, replications: 1 } });
  expect(after.isError ?? false).toBe(false);
}, 120_000);

test('logTo (#665): a failed call keeps the old file, a successful one replaces it; inputs and aliases are refused', async () => {
  const dir = join(temp, 'log-replace');
  mkdirSync(join(dir, 'a-directory'), { recursive: true });
  const logTo = join(dir, 'run.csv');
  writeFileSync(logTo, 'old\n');

  // The run succeeds, then `saveTo` (a directory) fails: the log is not published, nothing is left.
  const failed = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: asIs, seed: 3, logTo, saveTo: join(dir, 'a-directory') },
  });
  expect(failed.isError).toBe(true);
  expect(readFileSync(logTo, 'utf8')).toBe('old\n');
  expect(readdirSync(dir).sort()).toEqual(['a-directory', 'run.csv']);

  // A relative `logTo` resolves against the server's cwd and comes back absolute.
  const replaced = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: asIs, seed: 3, logTo: relative(repo, logTo) },
  });
  expect(replaced.isError ?? false).toBe(false);
  expect(writtenOf(replaced)).toEqual([{ log: logTo.replaceAll('\\', '/') }]);
  expect(readFileSync(logTo, 'utf8')).toMatch(/^[^\n]+,[^\n]+\n/);
  expect(readdirSync(dir).sort()).toEqual(['a-directory', 'run.csv']);

  // The model is an input too, and a symlinked directory names the same file as its target.
  const model = 'examples/pedido/model.bpmn';
  const before = readFileSync(join(repo, model));
  const onModel = await client.callTool({
    name: 'run_simulation',
    arguments: { model, scenario: asIs, seed: 3, logTo: model },
  });
  expect(onModel.isError).toBe(true);
  expect(textOf(onModel)).toContain('`logTo`');
  expect(readFileSync(join(repo, model)).equals(before)).toBe(true);

  mkdirSync(join(dir, 'real'));
  symlinkSync(join(dir, 'real'), join(dir, 'link'), 'dir');
  const aliased = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: asIs, seed: 3, saveTo: join(dir, 'link', 'r.json'), logTo: join(dir, 'real', 'r.json') },
  });
  expect(aliased.isError).toBe(true);
  expect(textOf(aliased)).toContain('`logTo`');
  expect(readdirSync(join(dir, 'real'))).toEqual([]);
}, 120_000);

test('compare_scenarios (#665): format "xlsx" is the workbook of `lila compare --xlsx`, all is detail "full"', async () => {
  const toBe = 'examples/pedido/to-be-3-cajeros.scenario.json';
  const saveTo = join(temp, 'compare-mcp.xlsx');
  const xlsx = await client.callTool({
    name: 'compare_scenarios',
    arguments: { scenarios: [asIs, toBe], seed: 42, replications: 2, format: 'xlsx', saveTo },
  });
  expect(xlsx.isError ?? false).toBe(false);
  const cli = join(temp, 'compare-cli.xlsx');
  execFileSync(
    process.execPath,
    [lilaBin, 'compare', 'examples/pedido/model.bpmn', asIs, toBe, '--seed', '42', '--replications', '2', '--xlsx', cli],
    { cwd: repo, stdio: 'ignore' },
  );
  expect(readFileSync(saveTo).equals(readFileSync(cli))).toBe(true);

  const full = await client.callTool({ name: 'compare_scenarios', arguments: { scenarios: [asIs, toBe], seed: 42, replications: 2, detail: 'full' } });
  const all = await client.callTool({ name: 'compare_scenarios', arguments: { scenarios: [asIs, toBe], seed: 42, replications: 2, all: true } });
  const both = await client.callTool({
    name: 'compare_scenarios',
    arguments: { scenarios: [asIs, toBe], seed: 42, replications: 2, all: true, detail: 'full' },
  });
  const summary = await client.callTool({ name: 'compare_scenarios', arguments: { scenarios: [asIs, toBe], seed: 42, replications: 2 } });
  expect(jsonOf(all).comparison.rows.length).toBe(jsonOf(full).comparison.rows.length);
  expect(jsonOf(all)).toEqual(jsonOf(full));
  expect(jsonOf(both)).toEqual(jsonOf(full));
  expect(jsonOf(summary).comparison.rows.length).toBeLessThan(jsonOf(full).comparison.rows.length);

  const conflict = await client.callTool({
    name: 'compare_scenarios',
    arguments: { scenarios: [asIs, toBe], all: true, detail: 'summary' },
  });
  expect(conflict.isError).toBe(true);
  expect(textOf(conflict)).toContain('`all: true`');
  const noTarget = await client.callTool({ name: 'compare_scenarios', arguments: { scenarios: [asIs, toBe], format: 'xlsx' } });
  expect(noTarget.isError).toBe(true);
  expect(textOf(noTarget)).toContain('saveTo');
}, 120_000);

test('el servidor sobrevive a un error de tool y sigue respondiendo', async () => {
  const roto = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: 'examples/pedido/no-existe.scenario.json' },
  });
  expect(roto.isError).toBe(true);

  const { tools } = await client.listTools();
  // Still serving: the same tools as before the failed call (the full list is asserted above).
  expect(tools.map((tool) => tool.name)).toContain('edit_process');
}, 120_000);

test('nada de esto deja archivos nuevos en examples/pedido', () => {
  expect(readdirSync(join(repo, 'examples/pedido')).sort()).toEqual([
    'README.md',
    'as-is.scenario.json',
    'model.bpmn',
    'to-be-3-cajeros.scenario.json',
  ]);
});
