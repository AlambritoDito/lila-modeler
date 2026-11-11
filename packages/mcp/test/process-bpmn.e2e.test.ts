/**
 * #632 acceptance, through the official MCP client against the real `lila mcp` over stdio: a Bizagi
 * export is added as the second process of an existing `.lila` (`put_process_bpmn`), simulated and
 * kept (`run_simulation` with `saveRun`), exported (`export_diagram`, `export_document`) and read
 * back byte for byte (`get_process_bpmn`); a model the simulator cannot run is refused, and kept for
 * documentation with `allowUnsimulatable`. Requires `dist/` (the root `pretest` and the CI build first).
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeLila, processesOf } from '@lila-modeler/engine/project';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, expect, test } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const credit = JSON.parse(readFileSync(join(repo, 'examples/outline/credit-application.json'), 'utf8')) as Record<string, unknown>;
const bizagi = (name: string): string => join(repo, `examples/bizagi-exports/bizagi-miwg-${name}-roundtrip.bpmn`);

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
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'lila-mcp-process-bpmn-')));
  client = new Client({ name: 'lila-process-bpmn', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd }));
}, 120_000);

afterAll(async () => {
  await client?.close();
  rmSync(cwd, { recursive: true, force: true });
});

test('#632: a Bizagi BPMN becomes the second process of a .lila, runs, exports and reads back as stored', async () => {
  await answer('create_process', { outline: credit, project: 'credit.lila' });

  const added = await answer<{ slug: string; processId: string; revision: number; slugs: string[]; notes: string[]; laidOut: boolean }>(
    'put_process_bpmn',
    { project: 'credit.lila', mode: 'add', bpmn: bizagi('A.1.0'), name: 'MIWG A.1.0' },
  );
  expect(added).toMatchObject({ slug: 'miwg-a-1-0', processId: 'WFP-6-', revision: 1, notes: [], laidOut: false });
  expect(added.slugs).toEqual(['credit-application', 'miwg-a-1-0']);

  const project = await answer<{ formatVersion: number; processes: { slug: string; name: string; scenarios: { entry: string }[] }[] }>(
    'get_project',
    { project: 'credit.lila' },
  );
  expect(project.formatVersion).toBe(2);
  expect(project.processes.map((p) => [p.slug, p.name])).toEqual([
    ['credit-application', 'Credit application'],
    ['miwg-a-1-0', 'MIWG A.1.0'],
  ]);
  expect(project.processes[1]!.scenarios.map((s) => s.entry)).toEqual(['as-is.scenario.json']);

  const run = await call('run_simulation', { model: 'credit.lila', process: 'miwg-a-1-0', scenario: 'as-is', replications: 2, saveRun: true });
  expect(run.isError, run.text).toBe(false);
  expect(run.text).toContain('"completed"');

  const diagram = await answer<{ file: string }>('export_diagram', { project: 'credit.lila', process: 'miwg-a-1-0', saveTo: 'out/miwg.svg' });
  expect(readFileSync(diagram.file, 'utf8')).toMatch(/^<svg[\s\S]*<\/svg>\s*$/);
  const document = await answer<{ file: string; run: { current: boolean } }>('export_document', {
    project: 'credit.lila',
    process: 'miwg-a-1-0',
    format: 'html',
    saveTo: 'out/miwg.html',
  });
  expect(document.run.current).toBe(true);
  expect(readFileSync(document.file, 'utf8')).toContain('MIWG A.1.0');

  const bytes = readFileSync(join(cwd, 'credit.lila'));
  const read = await answer<{ file: string; process: string; processId: string; revision: number; xml: string }>('get_process_bpmn', {
    project: 'credit.lila',
    process: 'miwg-a-1-0',
  });
  const stored = processesOf(decodeLila(new Uint8Array(bytes))).find((p) => p.slug === 'miwg-a-1-0')!;
  expect(read).toEqual({ file: join(cwd, 'credit.lila'), process: 'miwg-a-1-0', processId: 'WFP-6-', revision: 1, xml: stored.model.xml });
  expect(read.xml).toBe(readFileSync(bizagi('A.1.0'), 'utf8'));
  // Read only: the file is untouched.
  expect(readFileSync(join(cwd, 'credit.lila')).equals(bytes)).toBe(true);
}, 120_000);

test('#632: A.3.0 is refused as it is, and kept for documentation with allowUnsimulatable', async () => {
  await answer('create_process', { outline: credit, project: 'docs.lila' });
  const bytes = readFileSync(join(cwd, 'docs.lila'));
  const refused = await call('put_process_bpmn', { project: 'docs.lila', mode: 'add', bpmn: bizagi('A.3.0') });
  expect(refused.isError).toBe(true);
  expect(refused.text).toMatch(/^put_process_bpmn: the model has 7 validation errors; nothing was written: E-NOSOP: /);
  expect(readFileSync(join(cwd, 'docs.lila')).equals(bytes)).toBe(true);

  const kept = await answer<{ slug: string; notes: string[] }>('put_process_bpmn', {
    project: 'docs.lila',
    mode: 'add',
    bpmn: bizagi('A.3.0'),
    process: 'escalations',
    allowUnsimulatable: true,
  });
  expect(kept.slug).toBe('escalations');
  expect(kept.notes[0]).toMatch(/^does not simulate: E-NOSOP: /);

  const scenario = await answer<{ runnable: boolean; notes: string[] }>('get_scenario', { project: 'docs.lila', process: 'escalations', scenario: 'as-is' });
  expect(scenario.runnable).toBe(false);
  expect(scenario.notes[0]).toMatch(/^E-NOSOP: /);
  const run = await call('run_simulation', { model: 'docs.lila', process: 'escalations', scenario: 'as-is', replications: 1 });
  expect(run.isError).toBe(true);
  expect(run.text).toContain('E-NOSOP');

  // A replace in Spanish, with a name: refused in the caller's language.
  const renamed = await call('put_process_bpmn', { project: 'docs.lila', process: 'escalations', mode: 'replace', bpmn: bizagi('A.1.0'), name: 'X', locale: 'es' });
  expect(renamed.isError).toBe(true);
  expect(renamed.text).toMatch(/^put_process_bpmn: con mode "replace" el proceso conserva su nombre/);

  // #645: `mode` is an enum in the schema; a blank `bpmn` is not read as a path.
  const badMode = await call('put_process_bpmn', { project: 'docs.lila', mode: 'append', bpmn: bizagi('A.1.0') });
  expect(badMode.isError).toBe(true);
  expect(badMode.text).toContain('mode');
  const blank = await call('put_process_bpmn', { project: 'docs.lila', mode: 'add', bpmn: '' });
  expect(blank.isError).toBe(true);
  expect(blank.text).toMatch(/^put_process_bpmn: `bpmn` is empty/);
}, 120_000);

test('#724: annotate_element and edit_process write the Bizagi exports that bpmn-moddle reads with warnings', async () => {
  // A.4.0 and B.1.0 name messages and data stores the export left out; B.2.0 has <LoopCounter>, which is not BPMN.
  for (const name of ['A.4.0', 'B.1.0', 'B.2.0']) {
    const project = `writeback-${name}.lila`;
    await answer('create_project', { path: project, name: `MIWG ${name}`, bpmn: bizagi(name), allowUnsimulatable: true });
    const source = readFileSync(bizagi(name), 'utf8');
    const kept = source.match(/(?:messageRef|dataStoreRef)="[^"]+"|<LoopCounter>0<\/LoopCounter>/g) ?? [];
    expect(kept.length).toBeGreaterThan(0);
    const before = await answer<{ xml: string; processId: string }>('get_process_bpmn', { project });
    const task = /<(?:task|userTask|serviceTask)\b[^>]*\bid="([^"]+)"/.exec(before.xml.slice(before.xml.indexOf(`<process id="${before.processId}"`)))![1]!;

    await answer('annotate_element', { project, elementId: task, documentation: 'Checked by an agent.' });
    const edited = await answer<{ dryRun: boolean }>('edit_process', { project, operations: [{ op: 'rename', id: task, name: 'Renamed by an agent' }], layout: false });
    expect(edited.dryRun).toBe(false);

    const after = (await answer<{ xml: string }>('get_process_bpmn', { project })).xml;
    expect(after).toContain('Checked by an agent.');
    expect(after).toContain('name="Renamed by an agent"');
    const count = (text: string, piece: string): number => text.split(piece).length - 1;
    for (const piece of new Set(kept)) expect(count(after, piece), piece).toBe(count(source, piece));
  }

  // What cannot be carried is refused by name, in the caller's language, and nothing is written.
  const twice = readFileSync(bizagi('A.1.0'), 'utf8').replace('</process>', '<task id="Task_twice" /><task id="Task_twice" /></process>');
  await answer('create_project', { path: 'twice.lila', name: 'Twice', bpmn: twice, allowUnsimulatable: true });
  const bytes = readFileSync(join(cwd, 'twice.lila'));
  const refused = await call('edit_process', { project: 'twice.lila', operations: [{ op: 'rename', id: 'Task_twice', name: 'x' }] });
  expect(refused.isError).toBe(true);
  expect(refused.text).toMatch(/line \d+: <task> repeats the id "Task_twice" of an earlier element, .*give one of the two an id of its own/);
  const rechazado = await call('annotate_element', { project: 'twice.lila', elementId: 'Task_twice', documentation: 'x', locale: 'es' });
  expect(rechazado.isError).toBe(true);
  expect(rechazado.text).toMatch(/línea \d+: <task> repite el id "Task_twice" de un elemento anterior/);
  expect(readFileSync(join(cwd, 'twice.lila')).equals(bytes)).toBe(true);
}, 120_000);
