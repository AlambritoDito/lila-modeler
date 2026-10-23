/**
 * What an agent does to look at a `.lila` without changing it, through the official MCP client
 * against the real `lila mcp` over stdio: a `patch_scenario` that changes nothing keeps the saved
 * runs current (#627), and `get_project`/`get_scenario` read the inventory and a scenario with no
 * write at all (#628). Requires `dist/` (the root `pretest` and the CI build first).
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readLilaFile, writeLilaFile } from '@lila-modeler/engine/project-fs';
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

test('#628: get_project and get_scenario read the .lila and write nothing', async () => {
  // The .lila of the test above: one process, one scenario, one saved run.
  const bytes = readFileSync(join(cwd, 'credit.lila'));
  const project = await answer<{
    formatVersion: number;
    processes: { slug: string; scenarios: { entry: string; revision: number }[]; runs: { scenario: string; replications: number; current: boolean }[] }[];
  }>('get_project', { project: 'credit.lila' });
  expect(project.formatVersion).toBe(1);
  expect(project.processes).toHaveLength(1);
  expect(project.processes[0]).toMatchObject({
    slug: 'credit-application',
    scenarios: [{ entry: 'as-is.scenario.json', revision: 1 }],
    runs: [{ scenario: 'as-is.scenario.json', replications: 2, current: true }],
  });

  const stored = await answer<{ scenario: Record<string, unknown>; runnable: boolean; notes: string[] }>('get_scenario', {
    project: 'credit.lila',
    scenario: 'AS-IS',
  });
  expect(stored).toMatchObject({ entry: 'as-is.scenario.json', resolved: false, runnable: true });
  const resolved = await answer<{ scenario: { run: { warmup: number } } }>('get_scenario', { project: 'credit.lila', scenario: 'as-is', resolved: true });
  // The engine's defaults are in the resolved scenario, the object patch_scenario patches.
  expect(resolved.scenario.run.warmup).toBe(0);

  const missing = await call('get_scenario', { project: 'credit.lila', scenario: 'nope', locale: 'es' });
  expect(missing.isError).toBe(true);
  expect(missing.text).toMatch(/^get_scenario: no hay un escenario "nope"/);
  expect(readFileSync(join(cwd, 'credit.lila')).equals(bytes)).toBe(true);
}, 120_000);

test('#632: get_process_bpmn reads the model as stored and writes nothing', async () => {
  const bytes = readFileSync(join(cwd, 'credit.lila'));
  const read = await answer<{ process: string; processId: string; revision: number; xml: string }>('get_process_bpmn', { project: 'credit.lila' });
  expect(read).toMatchObject({ process: 'credit-application', processId: 'Process_credit_application' });
  expect(read.xml).toMatch(/^<\?xml[\s\S]*<bpmn:process id="Process_credit_application"/);
  const missing = await call('get_process_bpmn', { project: 'credit.lila', process: 'nope' });
  expect(missing.isError).toBe(true);
  expect(missing.text).toMatch(/^get_process_bpmn: .* has no process "nope"/);
  expect(readFileSync(join(cwd, 'credit.lila')).equals(bytes)).toBe(true);
}, 120_000);

test('#645: the tools that only read declare readOnlyHint, and the rest do not', async () => {
  const { tools } = await client.listTools();
  const readOnly = tools.filter((tool) => tool.annotations?.readOnlyHint === true).map((tool) => tool.name).sort();
  expect(readOnly).toEqual([
    'describe_process',
    'find_usages',
    'get_catalog_object',
    'get_process_bpmn',
    'get_process_outline',
    'get_project',
    'get_raci_matrix',
    'get_scenario',
    'list_catalog',
    'validate_bpmn',
  ]);
  // #645: compare_scenarios describes its own summary, not run_simulation's.
  const detail = (name: string): string =>
    ((tools.find((tool) => tool.name === name)!.inputSchema.properties as Record<string, { description?: string }>)['detail']?.description) ?? '';
  expect(detail('compare_scenarios')).toContain('omittedRows');
  expect(detail('compare_scenarios')).not.toContain('bottlenecks');
  expect(detail('run_simulation')).toContain('bottlenecks');
}, 120_000);

test('#645: get_project and get_scenario refuse a folder or an empty project, in the caller\'s language', async () => {
  for (const project of ['', '.', cwd]) {
    const inventory = await call('get_project', { project });
    expect(inventory.isError, project).toBe(true);
    expect(inventory.text).toBe(`get_project: \`project\` must be a .lila file; got ${project}.`);
    const scenario = await call('get_scenario', { project, scenario: 'as-is', locale: 'es' });
    expect(scenario.isError, project).toBe(true);
    expect(scenario.text).toBe(`get_scenario: \`project\` tiene que ser un archivo .lila; se recibió ${project}.`);
  }
}, 120_000);

test('#645: get_scenario of a process whose model.bpmn does not parse is runnable: false, the error in notes', async () => {
  const { document } = await readLilaFile(join(cwd, 'credit.lila'));
  const broken = join(cwd, 'broken.lila');
  await writeLilaFile(broken, { ...document, model: { ...document.model, xml: '<bpmn:definitions' } } as typeof document);
  const bytes = readFileSync(broken);
  for (const resolved of [false, true]) {
    const view = await answer<{ entry: string; scenario: unknown; runnable: boolean; notes: string[] }>('get_scenario', {
      project: 'broken.lila',
      scenario: 'as-is',
      resolved,
    });
    expect(view).toMatchObject({ entry: 'as-is.scenario.json', resolved, runnable: false });
    expect(view.notes).toHaveLength(1);
    expect(view.notes[0]).toMatch(/^the model does not pass validation: /);
    if (resolved) expect(view.scenario).toBeNull();
    else expect(view.scenario).toMatchObject({ name: 'AS-IS' });
  }
  expect(readFileSync(broken).equals(bytes)).toBe(true);
}, 120_000);
