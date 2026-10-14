/**
 * #631 acceptance, through the official MCP client against the real `lila mcp` over stdio: each
 * construct the outline gained (task variants, terminate ends, several and timer starts, default
 * flows, boundary timers, the event gateway) goes `create_process` → `run_simulation`, and
 * `get_process_outline` gives back the outline `create_process` stored. The 48-hour escalation of
 * the docs (`examples/outline/claim-escalation.json`) goes `create_process` → `patch_scenario`
 * (`run.duration`: at the default 1 h the deadline would never fire) → `run_simulation` →
 * `export_document` as HTML. #638: `edit_process` reorders and removes lanes, annotates a step and
 * connects a data object, both laid out again and in place, and the outline reads them back with no
 * warning. Requires `dist/` (the root `pretest` and the CI build first).
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { CONSTRUCTS } from '../../engine/test/fixtures/outlines.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const escalation = JSON.parse(readFileSync(join(repo, 'examples/outline/claim-escalation.json'), 'utf8')) as Record<string, unknown>;

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

interface Created {
  slug: string;
  warnings: unknown[];
  outline: Record<string, unknown>;
}
interface Summary {
  process: { completed?: number; byEndEvent: Record<string, { completed: number }> };
}

beforeAll(async () => {
  // realpath: on macOS the server's cwd is /private/var/…, not the /var/… of tmpdir().
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'lila-mcp-constructs-')));
  client = new Client({ name: 'lila-outline-constructs', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd }));
}, 120_000);

afterAll(async () => {
  await client?.close();
  rmSync(cwd, { recursive: true, force: true });
});

test.each(Object.entries(CONSTRUCTS))('%s: create_process → run_simulation, and get_process_outline reads it back', async (label, outline) => {
  const project = `${label.replaceAll(' ', '-')}.lila`;
  const created = await answer<Created>('create_process', { outline, project });
  expect(created.warnings).toEqual([]);
  const read = await answer<{ outline: unknown; warnings: unknown[] }>('get_process_outline', { project });
  expect(read.warnings).toEqual([]);
  expect(read.outline).toEqual(created.outline);
  const run = await answer<Summary>('run_simulation', { model: project, scenario: 'as-is', replications: 2, seed: 7 });
  const ends = Object.values(run.process.byEndEvent);
  expect(ends.length).toBeGreaterThan(0);
  expect(ends.reduce((total, e) => total + e.completed, 0)).toBeGreaterThan(0);
}, 120_000);

test('the 48-hour escalation: create_process → patch_scenario run.duration → run_simulation → export_document', async () => {
  const project = 'claims.lila';
  const created = await answer<Created>('create_process', { outline: escalation, project });
  expect(created.warnings).toEqual([]);
  const read = await answer<{ outline: { steps: { id: string; boundary?: unknown }[] }; warnings: unknown[] }>('get_process_outline', { project });
  expect(read.warnings).toEqual([]);
  expect(read.outline).toEqual(created.outline);
  expect(read.outline.steps.find((s) => s.id === 'assess')!.boundary).toEqual([
    { id: 'sla', type: 'timer', name: '48 h', label: 'No decision in 48 h', duration: { type: 'constant', value: 172800 }, interrupting: false, to: 'escalate' },
  ]);

  // The base scenario runs for 1 h: a 48 h deadline and a 10-day wait would never fire.
  await answer('patch_scenario', {
    project,
    scenario: 'as-is',
    patch: [{ op: 'replace', path: '/run/duration', value: 60 * 86_400 }],
  });
  const run = await answer<Summary & { elements: Record<string, { completed: number }> }>('run_simulation', {
    model: project,
    scenario: 'as-is',
    replications: 2,
    seed: 7,
    saveRun: true,
    detail: 'full',
  });
  const ends = run.process.byEndEvent;
  // Every end is an outcome: paid, rejected, the customer's 5-day deadline (terminate) and the
  // escalation (a parallel path: the case ends where its last path ends, usually not there).
  expect(Object.keys(ends).sort()).toEqual(['EndEvent_deadline', 'EndEvent_escalate', 'EndEvent_pay', 'EndEvent_reject']);
  expect(ends['EndEvent_pay']!.completed, JSON.stringify(ends)).toBeGreaterThan(0);
  // The deadline fired and the escalation ran; with one adjuster, most claims wait past 48 h.
  expect(run.elements['sla']!.completed).toBeGreaterThan(0);
  expect(run.elements['escalate']!.completed).toBe(run.elements['sla']!.completed);

  const doc = await answer<{ file: string; notes: unknown[] }>('export_document', { project, format: 'html', saveTo: 'claims.html' });
  const html = readFileSync(doc.file, 'utf8');
  for (const text of ['Assess claim', 'Escalate to supervisor', 'Customer replies?', '48 h']) expect(html).toContain(text);
}, 180_000);

test.each([true, false])('#638 lanes, notes and data through edit_process (layout %s), read back by get_process_outline', async (layout) => {
  const project = `claims-638-${layout}.lila`;
  await answer<Created>('create_process', { outline: escalation, project });
  const edit = await answer<{ changes: { message: string }[]; warnings: unknown[] }>('edit_process', {
    project,
    layout,
    operations: [
      { op: 'moveLane', lane: 'Supervisor', before: 'Customer service' },
      { op: 'removeLane', lane: 'Adjuster', moveStepsTo: 'Customer service' },
      { op: 'rename', id: 'Customer service', name: 'Claims desk' },
      { op: 'annotate', on: 'assess', text: 'Photos required' },
      { op: 'addDataObject', name: 'Claim file', on: 'register', direction: 'out' },
      { op: 'addDataObject', name: 'Claim file', on: 'assess', direction: 'in' },
    ],
  });
  expect(edit.changes.map((c) => c.message)).toEqual([
    'moved lane "Supervisor" above "Customer service"',
    'removed lane "Adjuster" (Lane_2); assess, covered, pay, sla, EndEvent_pay moved to lane "Customer service"',
    'renamed "Lane_1": "Customer service" → "Claims desk"',
    'annotated "assess": "Photos required" (TextAnnotation_assess)',
    '"register" writes data object "Claim file" (DataObjectReference_register, new)',
    '"assess" reads data object "Claim file" (DataObjectReference_register)',
  ]);
  const read = await answer<{ outline: { lanes: string[]; steps: { id: string; lane?: string; notes?: string[]; data?: unknown[] }[] }; warnings: unknown[] }>(
    'get_process_outline',
    { project },
  );
  expect(read.warnings).toEqual([]);
  expect(read.outline.lanes).toEqual(['Supervisor', 'Claims desk']);
  const step = (id: string) => read.outline.steps.find((s) => s.id === id)!;
  expect(step('assess')).toMatchObject({ lane: 'Claims desk', notes: ['Photos required'], data: [{ name: 'Claim file', direction: 'in' }] });
  expect(step('register').data).toEqual([{ name: 'Claim file', direction: 'out' }]);
  // As above: at the default 1 h no claim gets through a multi-hour assessment.
  await answer('patch_scenario', { project, scenario: 'as-is', patch: [{ op: 'replace', path: '/run/duration', value: 60 * 86_400 }] });
  const run = await answer<Summary>('run_simulation', { model: project, scenario: 'as-is', replications: 1, seed: 7 });
  expect(Object.values(run.process.byEndEvent).reduce((total, e) => total + e.completed, 0)).toBeGreaterThan(0);
}, 120_000);
