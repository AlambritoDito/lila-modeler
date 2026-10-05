/**
 * The agent tools of #99, #403 and #514 on a real `.lila`: annotate an element (and only it), the
 * RACI matrix the process document carries, a scenario sheet imported the way the app does it,
 * the template, and a new project written whole or not at all. Every refusal leaves the file
 * byte-identical, in English and in Spanish.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { strToU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { annotateElement, documentationHolder, parseBpmn, readAnnotations } from '../../src/bpmn/index.js';
import { main } from '../../src/cli.js';
import { AGENT_TOOL_MESSAGES } from '../../src/messages/index.js';
import { buildProcessDocument } from '../../src/process-document.js';
import { decodeLila, encodeLila, type ProcessDocument, type ProjectDocument } from '../../src/project/index.js';
import {
  annotateLilaElement,
  createLilaProject,
  importLilaScenarioSheet,
  lilaRaciMatrix,
  lilaScenarioTemplate,
  openLilaProcess,
  raciCsv,
} from '../../src/project-fs/index.js';
import { resolveExtends } from '../../src/scenario.js';
import { readWorkbook } from '../../src/xlsx-read.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const exampleLila = join(repo, 'examples/pedido.lila');
const pedidoXml = readFileSync(join(repo, 'examples/pedido/model.bpmn'), 'utf8');

let scratch: string;
let out: string[];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lila-agent-tools-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

/** Extended attributes declared on the collaboration, as the app declares them (#509). */
async function withDefinitions(xml: string): Promise<string> {
  return annotateElement(xml, 'Collaboration_Pedido', {
    attributeDefinitions: [
      { id: 'attr-cost', name: 'Cost center', type: 'number', appliesTo: 'task' },
      { id: 'attr-due', name: 'Due', type: 'date', appliesTo: 'task' },
      { id: 'attr-level', name: 'Level', type: 'list', appliesTo: 'task', options: ['low', 'high'] },
      { id: 'attr-owner', name: 'Owner', type: 'text', appliesTo: 'lane' },
    ],
  });
}

/** pedido as a version 2 repository: `pedido` and `copia`, both with the attribute definitions. */
async function repository(path: string): Promise<void> {
  const base = decodeLila(readFileSync(exampleLila));
  const xml = await withDefinitions(base.model.xml);
  const copia: ProcessDocument = {
    slug: 'copia',
    name: 'Copia',
    model: { ...base.model, id: 'copia', xml },
    scenarios: { 'solo.scenario.json': { ...base.scenarios['as-is.scenario.json'], name: 'Solo' } },
    scenarioRevisions: { 'solo.scenario.json': 3 },
    runs: [],
  };
  const document: ProjectDocument = {
    ...base,
    model: { ...base.model, xml },
    process: { slug: 'pedido', name: 'Pedido' },
    processes: [copia],
  };
  writeFileSync(path, encodeLila(document));
}

/** Every entry of the archive under `prefix`, as bytes. */
function entries(path: string, prefix: string): Record<string, Uint8Array> {
  const all = unzipSync(readFileSync(path));
  return Object.fromEntries(Object.entries(all).filter(([name]) => name.startsWith(prefix)));
}

test('both languages declare the same agent-tool messages', () => {
  expect(Object.keys(AGENT_TOOL_MESSAGES.es).sort()).toEqual(Object.keys(AGENT_TOOL_MESSAGES.en).sort());
});

describe('annotateLilaElement (#99)', () => {
  test('writes documentation, RACI, refs and attributes of one element; the other process stays byte-identical', async () => {
    const file = join(scratch, 'repo.lila');
    await repository(file);
    const copia = entries(file, 'processes/copia/');
    const result = await annotateLilaElement({
      file,
      process: 'pedido',
      elementId: 'Task_TomarPedido',
      documentation: 'Takes the order at the counter.',
      responsibilities: [{ type: 'R', roleRef: 'cajero' }, { type: 'A', roleRef: 'gerente' }],
      refs: { systemRef: ['POS'] },
      attributes: { 'Cost center': '120', 'attr-level': 'high' },
    });
    expect(result).toMatchObject({ process: 'pedido', elementId: 'Task_TomarPedido', changed: true, written: true, dryRun: false });
    expect(result.after).toEqual({
      documentation: 'Takes the order at the counter.',
      responsibilities: [{ type: 'R', roleRef: 'cajero' }, { type: 'A', roleRef: 'gerente' }],
      refs: { systemRef: ['POS'] },
      attributes: [{ ref: 'attr-cost', value: '120' }, { ref: 'attr-level', value: 'high' }],
    });

    const saved = await openLilaProcess(file, { process: 'pedido' });
    expect((await readAnnotations(saved.process.model.xml))['Task_TomarPedido']).toEqual(result.after);
    expect(saved.process.model.revision).toBe(2);
    expect(entries(file, 'processes/copia/')).toEqual(copia);

    // Attributes merge: one replaced in place, one removed with '', the rest kept.
    const again = await annotateLilaElement({ file, process: 'pedido', elementId: 'Task_TomarPedido', attributes: { 'attr-cost': '', Due: '2026-10-01' } });
    expect(again.after.attributes).toEqual([{ ref: 'attr-level', value: 'high' }, { ref: 'attr-due', value: '2026-10-01' }]);
    expect(again.after.documentation).toBe('Takes the order at the counter.');
  });

  test('a dry run and an annotation that changes nothing write nothing', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    const dry = await annotateLilaElement({ file, elementId: 'Task_Revisar', documentation: 'Checks the order.', dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, changed: true, written: false, before: {}, after: { documentation: 'Checks the order.' } });
    expect(readFileSync(file)).toEqual(readFileSync(exampleLila));

    const same = await annotateLilaElement({ file, elementId: 'Task_Revisar', documentation: '' });
    expect(same).toMatchObject({ changed: false, written: false });
    expect(readFileSync(file)).toEqual(readFileSync(exampleLila));
  });

  test.each([
    ['en', { elementId: 'Nope', documentation: 'x' }, /^no element of process pedido in .*pedido\.lila has the id "Nope"; nothing was written\.$/],
    ['es', { elementId: 'Nope', documentation: 'x' }, /^ningún elemento del proceso pedido de .*pedido\.lila tiene el id "Nope"; no se escribió nada\.$/],
    ['en', { elementId: 'Task_Revisar' }, /^pass at least one of documentation/],
    ['es', { elementId: 'Task_Revisar', responsibilities: [{ type: 'X', roleRef: 'a' }] }, /^"X" no es un tipo RACI; usa R, A, C o I\.$/],
    ['en', { elementId: 'Task_Revisar', responsibilities: [{ type: 'R', roleRef: ' ' }] }, /^every responsibility needs a roleRef\.$/],
    ['en', { elementId: 'Task_Revisar', refs: { teamRef: ['x'] } }, /^"teamRef" is not a kind of reference; use one of systemRef/],
    ['en', { elementId: 'Task_Revisar', attributes: { 'attr-cost': '1,5' } }, /^"1,5" is not a number for attribute "Cost center"/],
    ['es', { elementId: 'Task_Revisar', attributes: { Due: '2026-02-30' } }, /^"2026-02-30" no es una fecha para el atributo "Due"; escríbela como AAAA-MM-DD\.$/],
    ['en', { elementId: 'Task_Revisar', attributes: { Level: 'mid' } }, /^"mid" is not an option of attribute "Level"; use one of low, high\.$/],
    ['en', { elementId: 'Task_Revisar', attributes: { Owner: 'Ana' } }, /^attribute "Owner" applies to pools and lanes, not to Task_Revisar \(tasks\)\.$/],
    ['es', { elementId: 'Task_Revisar', attributes: { Owner: 'Ana' } }, /^el atributo "Owner" se aplica a pools y carriles, no a Task_Revisar \(tareas\)\.$/],
    ['en', { elementId: 'Process_Restaurante', responsibilities: [{ type: 'A', roleRef: 'owner' }] }, /^the responsibilities and references of process Process_Restaurante belong to its pool Participant_Restaurante, where the app shows them; annotate Participant_Restaurante instead\. Nothing was written\.$/],
    ['es', { elementId: 'Process_Restaurante', refs: { systemRef: ['POS'] } }, /^las responsabilidades y referencias del proceso Process_Restaurante van en su pool Participant_Restaurante/],
    ['es', { elementId: 'Task_Revisar', attributes: { Missing: '1' } }, /^ningún atributo extendido tiene el id o el nombre "Missing"; definidos: attr-cost \(Cost center\)/],
  ] as const)('%s: refuses %j and leaves the file unchanged', async (locale, request, expected) => {
    const file = join(scratch, 'pedido.lila');
    const base = decodeLila(readFileSync(exampleLila));
    writeFileSync(file, encodeLila({ ...base, model: { ...base.model, xml: await withDefinitions(base.model.xml) } }));
    const before = readFileSync(file);
    await expect(annotateLilaElement({ file, locale, ...request })).rejects.toThrow(expected);
    expect(readFileSync(file)).toEqual(before);
    expect(readdirSync(scratch)).toEqual(['pedido.lila']);
  });
});

test('a pool is annotated where the app reads it: description on its process, RACI on the pool', async () => {
  const file = join(scratch, 'pedido.lila');
  writeFileSync(file, readFileSync(exampleLila));
  const pool = await annotateLilaElement({
    file,
    elementId: 'Participant_Restaurante',
    documentation: 'The restaurant pool.',
    responsibilities: [{ type: 'A', roleRef: 'owner' }],
  });
  expect(pool).toMatchObject({
    documentationOn: 'Process_Restaurante',
    changed: true,
    after: { documentation: 'The restaurant pool.', responsibilities: [{ type: 'A', roleRef: 'owner' }] },
  });
  const xml = (await openLilaProcess(file)).process.model.xml;
  const annotations = await readAnnotations(xml);
  expect(annotations['Participant_Restaurante']).toEqual({ responsibilities: [{ type: 'A', roleRef: 'owner' }] });
  expect(annotations['Process_Restaurante']?.documentation).toBe('The restaurant pool.');
  // What the app's pool panel shows (`procesoRelacionado`) and what the process document opens with.
  expect(documentationHolder({ id: 'Participant_Restaurante', type: 'bpmn:Participant', processRef: 'Process_Restaurante' })).toBe('Process_Restaurante');
  const parsed = await parseBpmn(xml);
  const doc = buildProcessDocument({ ...parsed, annotations, title: 't', date: 'd' });
  const description = doc.blocks.findIndex((block) => block.kind === 'heading' && block.text === 'Process description');
  expect(doc.blocks[description + 1]).toEqual({ kind: 'paragraph', text: 'The restaurant pool.' });

  // The process's own description can still be written on it; a second pool call changes nothing.
  expect((await annotateLilaElement({ file, elementId: 'Process_Restaurante', documentation: 'The restaurant pool.' })).changed).toBe(false);
  expect((await annotateLilaElement({ file, elementId: 'Participant_Restaurante', documentation: 'The restaurant pool.' })).changed).toBe(false);
});

describe('lilaRaciMatrix (#99)', () => {
  test('lists what the process document lists, in its order', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    expect(await lilaRaciMatrix({ file })).toMatchObject({ process: 'pedido', roles: [], rows: [] });

    await annotateLilaElement({ file, elementId: 'Task_Revisar', responsibilities: [{ type: 'A', roleRef: 'gerente' }, { type: 'C', roleRef: 'gerente' }] });
    await annotateLilaElement({ file, elementId: 'Task_TomarPedido', responsibilities: [{ type: 'R', roleRef: 'cajero' }, { type: 'I', roleRef: 'gerente' }] });
    const matrix = await lilaRaciMatrix({ file });
    expect(matrix.roles).toEqual(['cajero', 'gerente']);
    expect(matrix.rows.map((row) => [row.id, row.name, row.cells])).toEqual([
      ['Task_TomarPedido', 'Take order', { cajero: 'R', gerente: 'I' }],
      ['Task_Revisar', 'Review order', { gerente: 'A, C' }],
    ]);

    // The same elements, order and text as the «Responsibilities (RACI)» lines of the document.
    const xml = (await openLilaProcess(file)).process.model.xml;
    const parsed = await parseBpmn(xml);
    const doc = buildProcessDocument({ ...parsed, annotations: await readAnnotations(xml), title: 't', date: 'd' });
    const lines = doc.blocks.filter((block) => block.kind === 'paragraph' && block.label === 'Responsibilities (RACI)').map((block) => (block as { text: string }).text);
    expect(lines).toEqual(matrix.rows.map((row) => row.responsibilities.map((r) => `${r.type}: ${r.roleRef}`).join(', ')));

    expect(raciCsv(matrix)).toBe('id,name,lane,cajero,gerente\r\nTask_TomarPedido,Take order,,R,I\r\nTask_Revisar,Review order,,,"A, C"\r\n');
  });
});

describe('importLilaScenarioSheet (#514)', () => {
  test('writes the changes into the delta of a scenario that extends another, as the app does', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    const sheet = join(scratch, 'Elements.csv');
    writeFileSync(sheet, 'id,distribution,unit,mean,sd\nTask_TomarPedido,normal,min,3,1\n');
    const resources = join(scratch, 'Resources.csv');
    writeFileSync(resources, 'id;capacity;costPerHour\ncajero;4;250\n');

    const dry = await importLilaScenarioSheet({ file, scenario: 'to-be-3-cajeros', sheet, dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, written: false, scenario: 'to-be-3-cajeros.scenario.json' });
    expect(dry.changes.map((change) => change.text)).toEqual([
      'Take order (Task_TomarPedido) · processingTime: triangular(min=1, mode=2, max=5) min → normal(mean=3, sd=1) min',
    ]);
    expect(readFileSync(file)).toEqual(readFileSync(exampleLila));

    expect((await importLilaScenarioSheet({ file, scenario: 'to-be-3-cajeros', sheet })).written).toBe(true);
    expect((await importLilaScenarioSheet({ file, scenario: 'TO-BE 3 cashiers', sheet: resources })).written).toBe(true);

    const lila = await openLilaProcess(file);
    const delta = lila.process.scenarios['to-be-3-cajeros.scenario.json']!;
    expect(delta).toEqual({
      version: 1,
      name: 'TO-BE 3 cashiers',
      extends: 'as-is.scenario.json',
      resources: { cajero: { capacity: 4, costPerHour: 250 } },
      elements: { Task_TomarPedido: { processingTime: { min: null, mode: null, max: null, type: 'normal', mean: 180, sd: 60 } } },
    });
    expect(lila.process.scenarios['as-is.scenario.json']).toEqual(decodeLila(readFileSync(exampleLila)).scenarios['as-is.scenario.json']);
    const resolved = resolveExtends(`${lila.root}to-be-3-cajeros.scenario.json`, (path) => lila.process.scenarios[path.slice(lila.root.length)]);
    expect((resolved['elements'] as Record<string, { processingTime: unknown }>)['Task_TomarPedido']!.processingTime).toEqual({ type: 'normal', mean: 180, sd: 60 });
    expect(lila.process.scenarioRevisions['to-be-3-cajeros.scenario.json']).toBe(3);
  });

  test('a plan the scenario would not pass is refused, en and es; unreadable sheets too', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    const sheet = join(scratch, 'Elements.csv');
    writeFileSync(sheet, 'id,probability\nTask_TomarPedido,0.5\n');
    const preview = await importLilaScenarioSheet({ file, scenario: 'as-is', sheet, dryRun: true });
    expect(preview.issues.some((issue) => issue.kind === 'lint')).toBe(true);
    await expect(importLilaScenarioSheet({ file, scenario: 'as-is', sheet })).rejects.toThrow(/^the import would leave the scenario with \d+ errors?; nothing was written: /);
    await expect(importLilaScenarioSheet({ file, scenario: 'as-is', sheet, locale: 'es' })).rejects.toThrow(/^la importación dejaría el escenario con \d+ errore?s?; no se escribió nada: /);

    const bad = join(scratch, 'bad.xlsx');
    writeFileSync(bad, 'not a zip');
    await expect(importLilaScenarioSheet({ file, scenario: 'as-is', sheet: bad, locale: 'es' })).rejects.toThrow(/bad\.xlsx no se puede leer como hoja de cálculo/);
    await expect(importLilaScenarioSheet({ file, scenario: 'as-is', sheet: join(scratch, 'none.csv') })).rejects.toThrow(/none\.csv does not exist/);
    await expect(importLilaScenarioSheet({ file, scenario: 'nope', sheet })).rejects.toThrow(/nope/);
    expect(readFileSync(file)).toEqual(readFileSync(exampleLila));
  });

  test('the template imports back with no change', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    const template = await lilaScenarioTemplate({ file, scenario: 'as-is' });
    expect(readWorkbook(template.data).map((sheet) => sheet.name)).toEqual(['Elements', 'Arrivals', 'Resources', 'Assignments', 'Calendars']);
    const path = join(scratch, 'as-is.xlsx');
    writeFileSync(path, template.data);
    const back = await importLilaScenarioSheet({ file, scenario: 'as-is', sheet: path });
    expect(back).toMatchObject({ changes: [], written: false });
    expect(readFileSync(file)).toEqual(readFileSync(exampleLila));
  });
});

describe('createLilaProject (#403)', () => {
  const asIs = JSON.parse(readFileSync(join(repo, 'examples/pedido/as-is.scenario.json'), 'utf8')) as Record<string, unknown>;

  test('writes a project decodeLila reads back, with drafts flagged and not refused', async () => {
    const path = join(scratch, 'new/pedido.lila');
    const { model: _model, ...withoutModel } = asIs;
    const result = await createLilaProject({
      path,
      name: 'Pedido',
      bpmn: join(repo, 'examples/pedido/model.bpmn'),
      scenarios: [
        { name: 'as-is', scenario: withoutModel },
        { name: 'more', scenario: { version: 1, name: 'More', extends: 'as-is.scenario.json', resources: { cajero: { capacity: 3 } } } },
        { name: 'draft', scenario: { version: 1, name: 'Draft' } },
      ],
    });
    expect(result.file).toBe(path.replaceAll('\\', '/'));
    expect(result.processId).toBe('Process_Restaurante');
    expect(result.scenarios.map((s) => [s.entry, s.runnable])).toEqual([
      ['as-is.scenario.json', true],
      ['draft.scenario.json', false],
      ['more.scenario.json', true],
    ]);
    const document = decodeLila(readFileSync(path));
    expect(document.name).toBe('Pedido');
    expect(document.model.xml).toBe(pedidoXml);
    expect(document.scenarios['as-is.scenario.json']).toEqual({ model: 'model.bpmn', ...withoutModel });
    expect(document.scenarios['draft.scenario.json']).toEqual({ model: 'model.bpmn', version: 1, name: 'Draft' });
    expect(readdirSync(join(scratch, 'new'))).toEqual(['pedido.lila']);

    // It runs as any .lila does.
    expect(await main(['run', path, 'more', '--replications', '1'])).toBe(0);
  });

  test('refuses an existing file unless overwrite, an invalid model and bad scenarios, writing nothing', async () => {
    const path = join(scratch, 'p.lila');
    writeFileSync(path, 'keep');
    await expect(createLilaProject({ path, name: 'P', bpmn: pedidoXml })).rejects.toThrow(/p\.lila already exists; nothing was written/);
    await expect(createLilaProject({ path, name: 'P', bpmn: pedidoXml, locale: 'es' })).rejects.toThrow(/p\.lila ya existe; no se escribió nada/);
    expect(readFileSync(path, 'utf8')).toBe('keep');
    await createLilaProject({ path, name: 'P', bpmn: pedidoXml, overwrite: true });
    expect(decodeLila(readFileSync(path)).name).toBe('P');

    const fresh = join(scratch, 'q.lila');
    const broken = pedidoXml.replace('<bpmn:startEvent id="StartEvent_Pedido"', '<bpmn:task id="StartEvent_Pedido"').replace('</bpmn:startEvent>', '</bpmn:task>');
    await expect(createLilaProject({ path: fresh, name: 'Q', bpmn: broken })).rejects.toThrow(/^the model has \d+ validation errors?; nothing was written: E-/);
    await expect(createLilaProject({ path: fresh, name: 'Q', bpmn: '<nope' , locale: 'es' })).rejects.toThrow(/^el BPMN no se puede leer; no se escribió nada/);
    await expect(createLilaProject({ path: fresh, name: 'Q', bpmn: pedidoXml, scenarios: [{ name: 'a', scenario: [] }] })).rejects.toThrow('scenario "a" must be a JSON object.');
    await expect(createLilaProject({ path: fresh, name: 'Q', bpmn: pedidoXml, scenarios: [{ name: 'a', scenario: {} }, { name: 'a.scenario.json', scenario: {} }] })).rejects.toThrow('two scenarios would be saved as a.scenario.json.');
    await expect(createLilaProject({ path: fresh, name: 'Q', bpmn: pedidoXml, scenarios: [{ name: 'a', scenario: { model: '../x.bpmn' } }] })).rejects.toThrow(/points to the model "\.\.\/x\.bpmn"/);
    await expect(createLilaProject({ path: fresh, name: 'Q', bpmn: pedidoXml, scenarios: [{ name: '../a', scenario: {} }] })).rejects.toThrow();
    await expect(createLilaProject({ path: join(scratch, 'q.zip'), name: 'Q', bpmn: pedidoXml })).rejects.toThrow(/q\.zip is not a \.lila path/);
    await expect(createLilaProject({ path: fresh, name: ' ', bpmn: pedidoXml })).rejects.toThrow('the project needs a name.');
    await expect(createLilaProject({ path: fresh, name: 'Q', bpmn: join(scratch, 'none.bpmn') })).rejects.toThrow(/none\.bpmn does not exist/);
    expect(existsSync(fresh)).toBe(false);
    expect(readdirSync(scratch).sort()).toEqual(['p.lila']);
  });
});

describe('CLI', () => {
  test('lila process annotate, then raci as text, JSON and CSV', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    expect(await main(['process', 'annotate', file, 'Task_Revisar', '--responsibility', 'R:cocinero', '--responsibility', 'a:gerente', '--ref', 'systemRef=POS', '--dry-run'])).toBe(0);
    expect(out[0]).toBe('Dry run: Task_Revisar would be annotated as shown; nothing was written.');
    expect(readFileSync(file)).toEqual(readFileSync(exampleLila));

    out = [];
    expect(await main(['process', 'annotate', file, 'Task_Revisar', '--responsibility', 'R:cocinero', '--responsibility', 'a:gerente', '--documentation', 'Checks it.'])).toBe(0);
    expect(out).toEqual([
      `Annotated Task_Revisar in ${file.replaceAll('\\', '/')}.`,
      '  Description: Checks it.',
      '  Responsibilities (RACI): R: cocinero, A: gerente',
    ]);

    out = [];
    expect(await main(['--lang', 'es', 'process', 'raci', file])).toBe(0);
    expect(out).toEqual(['Elemento                     cocinero  gerente', 'Review order (Task_Revisar)  R         A']);
    out = [];
    expect(await main(['process', 'raci', file, '--json'])).toBe(0);
    expect(JSON.parse(out.join('\n')).roles).toEqual(['cocinero', 'gerente']);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await main(['process', 'raci', file, '--csv'])).toBe(0);
    expect(write).toHaveBeenCalledWith('id,name,lane,cocinero,gerente\r\nTask_Revisar,Review order,,R,A\r\n');

    out = [];
    expect(await main(['--lang', 'es', 'process', 'annotate', file, 'Task_Revisar', '--responsibility', 'X:a'])).toBe(1);
    expect(out).toEqual(['lila process: "X" no es un tipo RACI; usa R, A, C o I.']);
    out = [];
    expect(await main(['process', 'annotate', file, 'Task_Revisar', '--responsibility', 'cocinero'])).toBe(1);
    expect(out[0]).toMatch(/--responsibility takes TYPE:role/);
    // Options before the subcommand (QA of #559).
    out = [];
    expect(await main(['process', '--documentation', 'x', 'annotate', file, 'Task_Revisar', '--dry-run'])).toBe(0);
    expect(out[0]).toBe('Dry run: Task_Revisar would be annotated as shown; nothing was written.');
    out = [];
    expect(await main(['process', 'nope'])).toBe(1);
    expect(out[0]).toBe('lila process: unknown subcommand "nope"; use create, show, edit, annotate or raci.');
  });

  test('lila scenario template, then import (dry run and for real)', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    const template = join(scratch, 't.xlsx');
    expect(await main(['scenario', 'template', file, 'as-is', '--out', template])).toBe(0);
    expect(out).toEqual([`Template: ${template.replaceAll('\\', '/')}`]);
    expect(await main(['scenario', 'template', file, 'as-is', '--out', template])).toBe(1);

    const sheet = join(scratch, 'recursos.csv');
    writeFileSync(sheet, strToU8('name;capacity\nCashier;5\nNobody;1\n'));
    out = [];
    expect(await main(['scenario', 'import', file, 'as-is', sheet, '--dry-run'])).toBe(0);
    expect(out).toEqual([
      '1 change:',
      '  Cashier (cajero) · capacity: 2 → 5',
      '1 row not applied:',
      '  recursos, row 3, column name: "Nobody" does not match anything in the model or the scenario; the row was not applied.',
      'Dry run: nothing was written.',
    ]);
    expect(readFileSync(file)).toEqual(readFileSync(exampleLila));
    out = [];
    expect(await main(['--lang', 'es', 'scenario', 'import', file, 'as-is', sheet])).toBe(0);
    expect(out.at(-1)).toBe(`Guardado as-is.scenario.json en ${file.replaceAll('\\', '/')}.`);
    expect(((await openLilaProcess(file)).process.scenarios['as-is.scenario.json']!['resources'] as Record<string, { capacity: number }>)['cajero']!.capacity).toBe(5);
  });
});
