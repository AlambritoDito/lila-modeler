/**
 * The whole agent flow of #527 with no UI (#540), through the official MCP client against the real
 * `lila mcp` over stdio: an interview transcript → an outline → `create_process` into a new .lila →
 * a scenario filled with `patch_scenario` (and, once the server has `import_scenario_sheet`, with a
 * filled-in template) → `run_simulation` with `saveRun` → `export_document` as
 * Word and HTML. There is no LLM here: the outline is the one an agent would derive from the
 * transcript, written by hand. Requires `dist/` (the root `pretest` and the CI build first).
 *
 * This is the flow `docs/AGENT_GUIDE.md` walks through; keep the two in step.
 */
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { workbook } from '../../engine/src/xlsx.js';
import { readWorkbook } from '../../engine/src/xlsx-read.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const transcript = readFileSync(new URL('./fixtures/entrevista-tarjeta.txt', import.meta.url), 'utf8');

/**
 * What an agent reads off the transcript: who does what (the lanes), the steps in order and the two
 * decisions with their odds ("una de cada siete", "dos de cada tres"). Times, staff and arrivals go
 * into the scenario afterwards, the way the guide recommends: the outline is the map, the scenario
 * the numbers.
 */
const outline = {
  name: 'Solicitud de tarjeta de crédito',
  lanes: ['Ejecutivo de sucursal', 'Analista de crédito', 'Mesa de control'],
  steps: [
    { id: 'recibir', name: 'Recibir solicitud', lane: 'Ejecutivo de sucursal' },
    { id: 'validar', name: 'Validar documentos' },
    {
      id: 'completos',
      type: 'xor',
      name: '¿Documentos completos?',
      branches: [
        { label: 'Sí', to: 'consultar' },
        { label: 'No', to: 'faltantes', probability: 0.15 },
      ],
    },
    { id: 'faltantes', name: 'Solicitar documentos faltantes', next: 'validar' },
    { id: 'consultar', type: 'serviceTask', name: 'Consultar buró de crédito', lane: 'Analista de crédito' },
    { id: 'evaluar', name: 'Evaluar capacidad de pago' },
    {
      id: 'aprobada',
      type: 'xor',
      name: '¿Aprobada?',
      branches: [
        { label: 'Sí', to: 'emitir' },
        { label: 'No', to: 'rechazo', probability: 0.35 },
      ],
    },
    { id: 'emitir', name: 'Emitir tarjeta', lane: 'Mesa de control', end: true },
    { id: 'rechazo', name: 'Notificar rechazo', lane: 'Ejecutivo de sucursal', end: true },
  ],
};
const taskNames = outline.steps.filter((s) => s.type !== 'xor').map((s) => s.name);

/** Minutes as the scenario's seconds. */
const min = (m: number): number => m * 60;
const uses = (ref: string) => [{ ref, quantity: 1 }];

/** The numbers of the interview as one JSON Patch on the base scenario `create_process` wrote. */
const patch = [
  // «unas cuatro solicitudes por hora»: Poisson arrivals over one working day, no fixed count.
  { op: 'replace', path: '/run/duration', value: min(8 * 60) },
  { op: 'replace', path: '/run/replications', value: 2 },
  { op: 'remove', path: '/elements/StartEvent/triggerCount' },
  { op: 'replace', path: '/elements/StartEvent/interTriggerTimer', value: { type: 'exponential', mean: min(15) } },
  // «tres ejecutivas, dos analistas y una persona en la mesa de control».
  // An outline without `resources` leaves the scenario without the key: add it whole.
  {
    op: 'add',
    path: '/resources',
    value: {
      ejecutiva: { name: 'Ejecutiva', capacity: 3 },
      analista: { name: 'Analista', capacity: 2 },
      mesa: { name: 'Mesa de control', capacity: 1 },
    },
  },
  { op: 'add', path: '/elements/recibir', value: { processingTime: { type: 'triangular', min: min(5), mode: min(10), max: min(20) }, resources: uses('ejecutiva') } },
  { op: 'add', path: '/elements/validar', value: { processingTime: { type: 'normal', mean: min(8), sd: min(2) }, resources: uses('ejecutiva') } },
  { op: 'add', path: '/elements/faltantes', value: { processingTime: { type: 'constant', value: min(5) }, resources: uses('ejecutiva') } },
  { op: 'add', path: '/elements/consultar', value: { processingTime: { type: 'exponential', mean: min(3) } } },
  { op: 'add', path: '/elements/evaluar', value: { processingTime: { type: 'normal', mean: min(25), sd: min(8) }, resources: uses('analista') } },
  { op: 'add', path: '/elements/emitir', value: { processingTime: { type: 'constant', value: min(10) }, resources: uses('mesa') } },
  { op: 'add', path: '/elements/rechazo', value: { processingTime: { type: 'constant', value: min(4) }, resources: uses('ejecutiva') } },
];

let client: Client;
let cwd: string;

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; texts: string[] }> {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, texts: (result.content as { text: string }[]).map((c) => c.text) };
}

/** The tool's JSON answer, failing the test with the tool's own message when it is an error. */
async function answer<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  const { isError, texts } = await call(name, args);
  expect(isError, `${name}: ${texts[0]}`).toBe(false);
  return JSON.parse(texts[0]!) as T;
}

beforeAll(async () => {
  // realpath: on macOS the server's cwd is /private/var/…, not the /var/… of tmpdir().
  cwd = realpathSync(mkdtempSync(join(tmpdir(), 'lila-agent-flow-')));
  client = new Client({ name: 'lila-agent-flow', version: '0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp', '--lang', 'es'], cwd }));
}, 60_000);

afterAll(async () => {
  await client?.close();
  rmSync(cwd, { recursive: true, force: true });
});

test('the outline only names what the interview says: its lanes are the roles that speak', () => {
  const said = transcript.toLowerCase();
  // «Ejecutiva de sucursal» in the interview, «Ejecutivo de sucursal» as the lane: the role, not the person.
  for (const lane of outline.lanes) expect(said, lane).toContain(lane.toLowerCase().replace(/^ejecutivo/, 'ejecutiva'));
});

test('interview → create_process → patch_scenario → run_simulation saveRun → export_document', async () => {
  // b. A new .lila from the outline.
  const created = await answer<{ slug: string; newFile: boolean; outline: unknown; warnings: string[] }>('create_process', {
    outline,
    project: 'tarjeta.lila',
  });
  expect(created).toMatchObject({ slug: 'solicitud-de-tarjeta-de-credito', newFile: true, warnings: [] });

  // The outline round-trips: what the file holds reads back as the normal form create_process returned.
  const read = await answer<{ outline: { steps: { id: string; name: string; lane: string }[] } }>('get_process_outline', {
    project: 'tarjeta.lila',
  });
  expect(read.outline).toEqual(created.outline);
  expect(read.outline.steps.map((s) => s.id)).toEqual(outline.steps.map((s) => s.id));
  expect(read.outline.steps.find((s) => s.id === 'evaluar')?.lane).toBe('Analista de crédito');

  // c. The numbers of the interview into the base scenario, in place.
  const patched = await answer<{ scenario: { resources: Record<string, { capacity: number }> } }>('patch_scenario', {
    project: 'tarjeta.lila',
    scenario: 'as-is',
    patch,
  });
  expect(patched.scenario.resources.ejecutiva?.capacity).toBe(3);

  // c'. When the numbers come from a person: hand out the template, take it back filled in. The
  // analyst's manager says there will be three, not two.
  const { tools } = await client.listTools();
  if (tools.some((tool) => tool.name === 'import_scenario_sheet')) {
    await answer('export_scenario_template', { project: 'tarjeta.lila', scenario: 'as-is', saveTo: 'out/plantilla.xlsx' });
    const sheets = readWorkbook(readFileSync(join(cwd, 'out/plantilla.xlsx')));
    const resources = sheets.find((sheet) => sheet.name === 'Resources')!;
    const [header, ...rows] = resources.rows;
    const capacity = header!.findIndex((cell) => cell === 'capacity');
    const analista = rows.find((row) => row[0] === 'analista')!;
    expect(analista[capacity]).toBe(2);
    analista[capacity] = 3;
    writeFileSync(
      join(cwd, 'out/plantilla-llena.xlsx'),
      workbook(sheets.map((sheet) => ({ name: sheet.name, headers: (sheet.rows[0] ?? []) as string[], rows: sheet.rows.slice(1) as never }))),
    );
    const sheet = { project: 'tarjeta.lila', scenario: 'as-is', sheet: 'out/plantilla-llena.xlsx' };
    const dry = await answer<{ written: boolean; changes: unknown[]; issues: unknown[] }>('import_scenario_sheet', { ...sheet, dryRun: true });
    expect(dry).toMatchObject({ written: false, issues: [] });
    expect(dry.changes).toHaveLength(1);
    expect(await answer('import_scenario_sheet', sheet)).toMatchObject({ written: true });
  }

  // d. Run it and keep the run in the project, as the app does.
  const run = await call('run_simulation', { model: 'tarjeta.lila', scenario: 'as-is', seed: 7, replications: 2, saveRun: true });
  expect(run.isError, run.texts[0]).toBe(false);
  const result = JSON.parse(run.texts[0]!) as {
    elements: Record<string, { completed: number }>;
    resources: Record<string, { utilization: number }>;
  };
  expect(result.elements.evaluar?.completed).toBeGreaterThan(0);
  expect(result.resources.analista?.utilization).toBeGreaterThan(0);
  const { savedRun } = JSON.parse(run.texts[1]!) as { savedRun: { id: string; scenario: string } };
  expect(savedRun.scenario).toBe('as-is.scenario.json');

  // e. The document, both ways, with that run as the current one.
  const html = await answer<{ run: { id: string; current: boolean } | null; file: string }>('export_document', {
    project: 'tarjeta.lila',
    format: 'html',
    saveTo: 'out/tarjeta.html',
  });
  expect(html.run).toEqual({ id: savedRun.id, scenario: 'as-is.scenario.json', current: true });
  const page = readFileSync(join(cwd, 'out/tarjeta.html'), 'utf8');
  const embedded = /<img src="data:image\/svg\+xml;base64,([^"]+)"/.exec(page)?.[1];
  expect(embedded, 'the HTML embeds the diagram').toBeDefined();
  const svg = Buffer.from(embedded!, 'base64').toString('utf8');
  expect(svg.startsWith('<svg')).toBe(true);
  // Names wrap into <tspan>s: look for every step by its element id instead.
  for (const step of outline.steps) expect(svg, step.id).toContain(`data-element-id="${step.id}"`);
  expect(page).toContain('Resultados');
  expect(page).toContain('Solicitud de tarjeta de crédito');

  const docx = await answer<{ run: { id: string; current: boolean } | null; notes: string[] }>('export_document', {
    project: 'tarjeta.lila',
    format: 'docx',
    saveTo: 'out/tarjeta.docx',
  });
  expect(docx.run).toEqual({ id: savedRun.id, scenario: 'as-is.scenario.json', current: true });
  expect(docx.notes[0]).toMatch(/^El documento Word va sin diagrama/);
  const parts = unzipSync(readFileSync(join(cwd, 'out/tarjeta.docx')));
  // Word may split a paragraph into runs: compare the text of the runs, joined.
  const words = [...strFromU8(parts['word/document.xml']!).matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join('');
  expect(words).toContain('Solicitud de tarjeta de crédito');
  for (const name of taskNames) expect(words, name).toContain(name);
  // The results section: the run's summary table (metric names stay in English by design).
  expect(words).toContain('Resultados');
  expect(words).toContain('Instances completed');
  expect(words).toContain('EndEvent_emitir');
}, 30_000);
