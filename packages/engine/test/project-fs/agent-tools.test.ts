/**
 * The agent tools of #99, #403, #514 and #672 on a real `.lila`: annotate an element (and only it),
 * the RACI matrix the process document carries, a scenario sheet imported the way the app does it,
 * the template, a new project written whole or not at all, and the catalog tools. Every refusal leaves the file
 * byte-identical, in English and in Spanish.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { annotateElement, documentationHolder, parseBpmn, readAnnotations } from '../../src/bpmn/index.js';
import { renderSvg } from '../../src/bpmn/render-svg.js';
import { main } from '../../src/cli.js';
import { AGENT_TOOL_MESSAGES } from '../../src/messages/index.js';
import { buildProcessDocument } from '../../src/process-document.js';
import { decodeLila, encodeLila, type ProcessDocument, type ProjectDocument } from '../../src/project/index.js';
import {
  adoptLilaReference,
  annotateLilaElement,
  createLilaCatalogObject,
  createLilaProject,
  deleteLilaCatalogObject,
  importLilaScenarioSheet,
  lilaCatalogList,
  lilaCatalogObject,
  lilaRaciMatrix,
  lilaUsages,
  updateLilaCatalogObject,
  lilaScenarioTemplate,
  openLilaProcess,
  raciCsv,
} from '../../src/project-fs/index.js';
import { resolveExtends } from '../../src/scenario.js';
import { readWorkbook } from '../../src/xlsx-read.js';
import { HOTEL_PROCESSES, hotelLila } from '../project/fixtures/catalog-hotel.js';

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
    expect(result.laidOut).toBe(false);
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

  test('a model without a diagram gets one, drawn as edit_process lays it out (#630)', async () => {
    const bare = pedidoXml.replace(/<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, '');
    expect(bare).not.toContain('bpmndi:');
    await expect(renderSvg(bare)).rejects.toThrow(/has no diagram/);
    const path = join(scratch, 'bare.lila');
    const result = await createLilaProject({ path, name: 'Bare', bpmn: bare, scenarios: [{ name: 'as-is', scenario: asIs }] });
    expect(result.laidOut).toBe(true);
    expect(result.scenarios[0]!.runnable).toBe(true);
    const xml = decodeLila(readFileSync(path)).model.xml;
    // Every node of the simulated process has a shape, and the drawing renders.
    const { ir } = await parseBpmn(xml);
    for (const id of Object.keys(ir.nodes)) expect(xml, id).toContain(`bpmnElement="${id}"`);
    expect(await renderSvg(xml)).toContain('<svg');
    // The model is the same model: only the diagram was added.
    expect((await parseBpmn(xml)).ir.nodes).toEqual((await parseBpmn(bare)).ir.nodes);
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
    expect(out[0]).toBe('lila process: unknown subcommand "nope"; use create, show, edit, annotate, raci, export-bpmn, import or attribute.');
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

describe('catalog tools (#672)', () => {
  /** The archive's entries as base64, by name. */
  function entriesOf(file: string): Record<string, string> {
    return Object.fromEntries(Object.entries(unzipSync(readFileSync(file))).map(([name, data]) => [name, Buffer.from(data).toString('base64')]));
  }

  /** The names whose bytes differ between two entry maps (added and removed ones too). */
  function changedEntries(before: Record<string, string>, after: Record<string, string>): string[] {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((name) => before[name] !== after[name]).sort();
  }

  /** The refusal `work` throws. */
  async function failure(work: () => Promise<unknown>): Promise<Error & { code?: string }> {
    try {
      await work();
    } catch (error) {
      return error as Error & { code?: string };
    }
    throw new Error('expected a refusal');
  }

  test('the Receptionist scenario: create, use, rename, stale revision, delete in use, replace', async () => {
    const file = join(scratch, 'hotel.lila');
    writeFileSync(file, hotelLila(2));
    const original = readFileSync(file);

    const dry = await createLilaCatalogObject({ file, type: 'role', name: 'Receptionist', dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, written: false, changed: true, wouldUpgrade: true });
    expect(dry.note).toContain('1.0.0-beta.28');
    expect(readFileSync(file)).toEqual(original);

    const created = await createLilaCatalogObject({ file, type: 'role', name: 'Receptionist' });
    expect(created).toMatchObject({ written: true, wouldUpgrade: true });
    const id = created.object.id;
    expect(id).toMatch(/^role-[0-9a-z]{12}$/);
    expect((await lilaCatalogList({ file })).formatVersion).toBe(3);
    const second = await createLilaCatalogObject({ file, type: 'unit', name: 'Front office' });
    expect(second.wouldUpgrade).toBe(false);
    expect(second.note).toBeUndefined();

    for (const process of HOTEL_PROCESSES) {
      await annotateLilaElement({ file, process: process.slug, elementId: 'Task_1', responsibilities: [{ type: 'R', roleRef: id }] });
    }
    const usages = await lilaUsages({ file, id });
    expect(usages).toMatchObject({ resolved: true, type: 'role', id });
    const uses = (usages as { uses: { process: string; slug: string; relation: string }[] }).uses;
    expect(uses.map((u) => [u.slug, u.relation])).toEqual(HOTEL_PROCESSES.map((p) => [p.slug, 'responsibility:R']));
    expect(new Set(uses.map((u) => u.process)).size).toBe(3);

    const beforeRename = entriesOf(file);
    const renamed = await updateLilaCatalogObject({ file, id, baseRevision: 1, name: 'Front desk agent' });
    expect(renamed).toMatchObject({ written: true, updated: [`role/${id}`], processes: [] });
    expect(changedEntries(beforeRename, entriesOf(file))).toEqual([`catalog/role/${id}.json`]);
    for (const process of HOTEL_PROCESSES) {
      const matrix = await lilaRaciMatrix({ file, process: process.slug });
      expect(matrix.roles).toEqual([id]);
      expect(matrix.roleNames).toEqual({ [id]: 'Front desk agent' });
    }

    expect((await lilaCatalogObject({ file, id })).object).toMatchObject({ id, name: 'Front desk agent', revision: 2 });
    const settled = readFileSync(file);
    const stale = await failure(() => updateLilaCatalogObject({ file, id, baseRevision: 1, name: 'Night auditor' }));
    expect(stale.code).toBe('E-REVISION');
    expect(stale.message).toMatch(/^E-REVISION: /);
    expect(readFileSync(file)).toEqual(settled);

    for (const locale of ['en', 'es'] as const) {
      const inUse = await failure(() => deleteLilaCatalogObject({ file, id, locale }));
      expect(inUse.code).toBe('E-OBJETO-EN-USO');
      expect(inUse.message).toMatch(/^E-OBJETO-EN-USO: /);
      for (const process of HOTEL_PROCESSES) expect(inUse.message).toContain(`${process.slug} Task_1 responsibility:R`);
      expect(readFileSync(file)).toEqual(settled);
    }

    const agent = await createLilaCatalogObject({ file, type: 'role', name: 'Guest relations' });
    const beforeDelete = entriesOf(file);
    const replaced = await deleteLilaCatalogObject({ file, id, replaceWith: agent.object.id });
    expect(replaced.deleted).toEqual([`role/${id}`]);
    expect(replaced.processes.map((p) => p.slug)).toEqual(HOTEL_PROCESSES.map((p) => p.slug));
    expect(changedEntries(beforeDelete, entriesOf(file))).toEqual([
      `catalog/role/${id}.json`,
      'lila-project.json', // the model revisions
      ...HOTEL_PROCESSES.map((p) => `processes/${p.slug}/model.bpmn`),
    ].sort());
    const reopened = decodeLila(readFileSync(file));
    expect(reopened.catalog!.map((o) => o.id)).not.toContain(id);
    expect(reopened.model.xml).toContain(`roleRef="${agent.object.id}"`);

    const removed = await deleteLilaCatalogObject({ file, id: agent.object.id, removeReferences: true });
    expect(removed.processes).toHaveLength(3);
    expect(decodeLila(readFileSync(file)).model.xml).not.toContain('lila:responsibility');
  });

  test('adopt_reference: an id-shaped value is adopted as is, any other is rewritten; a version 1 file upgrades', async () => {
    const file = join(scratch, 'hand-typed.lila');
    writeFileSync(file, hotelLila(2, { handTyped: true }));
    let before = entriesOf(file);
    const cajero = await adoptLilaReference({ file, type: 'role', ref: 'cajero' });
    expect(cajero).toMatchObject({ object: { id: 'cajero', name: 'cajero' }, processes: [], wouldUpgrade: true });
    const touched = changedEntries(before, entriesOf(file));
    expect(touched.filter((name) => name.endsWith('model.bpmn'))).toEqual([]);
    expect(touched).toContain('catalog/role/cajero.json');

    before = entriesOf(file);
    const pos = await adoptLilaReference({ file, type: 'system', ref: 'POS', name: 'Point of sale' });
    expect(pos.wouldUpgrade).toBe(false);
    expect(pos.object.id).toMatch(/^system-/);
    expect(changedEntries(before, entriesOf(file)).filter((name) => name.endsWith('model.bpmn'))).toHaveLength(3);
    for (const p of processesOfFile(file)) {
      expect(p).toContain(`<lila:systemRef ref="${pos.object.id}" />`);
      expect(p).not.toContain('ref="POS"');
    }
    expect(await lilaUsages({ file, id: 'POS' })).toMatchObject({ resolved: false, uses: [] });

    const v1 = join(scratch, 'v1.lila');
    writeFileSync(v1, hotelLila(1, { handTyped: true }));
    const original = readFileSync(v1);
    const dry = await adoptLilaReference({ file: v1, type: 'role', ref: 'cajero', dryRun: true });
    expect(dry).toMatchObject({ wouldUpgrade: true, written: false });
    expect(dry.note).toBeDefined();
    expect(readFileSync(v1)).toEqual(original);
    expect(await lilaUsages({ file: v1, id: 'cajero', type: 'role' })).toMatchObject({
      resolved: false, uses: [{ slug: 'check-in', element: 'Task_1', relation: 'responsibility:R' }],
    });
  });

  test('a document with a url, unknown ids and bad arguments, in both languages', async () => {
    const file = join(scratch, 'docs.lila');
    writeFileSync(file, hotelLila(2));
    const created = await createLilaCatalogObject({ file, type: 'document', name: 'Registration card', url: 'https://intranet.example.com/card' });
    const id = created.object.id;
    await updateLilaCatalogObject({ file, id, baseRevision: 1, url: 'https://intranet.example.com/card-v2', description: 'Signed at arrival.' });
    expect((await lilaCatalogObject({ file, id })).object).toEqual({
      type: 'document', id, name: 'Registration card', description: 'Signed at arrival.', revision: 2, url: 'https://intranet.example.com/card-v2',
    });
    const same = await updateLilaCatalogObject({ file, id, baseRevision: 2, name: 'Registration card' });
    expect(same).toMatchObject({ changed: false, written: false });

    const settled = readFileSync(file);
    const unknown = await failure(() => lilaCatalogObject({ file, id: 'role-nothere00000' }));
    expect(unknown.code).toBeUndefined();
    expect(unknown.message).toContain('has no catalog object with the id "role-nothere00000"');
    const unknownEs = await failure(() => deleteLilaCatalogObject({ file, id: 'role-nothere00000', locale: 'es' }));
    expect(unknownEs.message).toContain('no tiene ningún objeto de catálogo');
    expect((await failure(() => createLilaCatalogObject({ file, type: 'risk', name: 'X' }))).message).toContain('role, unit, system, document');
    expect((await failure(() => createLilaCatalogObject({ file, type: 'role', name: 'X', url: 'https://x.example' }))).message).toContain('its fields: unitRef');
    expect((await failure(() => createLilaCatalogObject({ file, type: 'system', name: 'X', url: 'javascript:alert(1)', locale: 'es' }))).message).toContain('quedaría inválido');
    expect(readFileSync(file)).toEqual(settled);
  });
});

describe('catalog lint in `lila validate` (#95)', () => {
  /** `lila validate … --json`: the exit code and the report. */
  async function validateJson(...args: string[]): Promise<{ code: number; report: Record<string, unknown> }> {
    out = [];
    const code = await main(['validate', ...args, '--json']);
    return { code, report: JSON.parse(out.join('\n')) as Record<string, unknown> };
  }

  /** Replaces `from` with `to` in the model of `slug`, by hand: the archive's entry, nothing else. */
  function handEdit(file: string, slug: string, from: string, to: string): void {
    const entries = unzipSync(readFileSync(file));
    const name = `processes/${slug}/model.bpmn`;
    const xml = strFromU8(entries[name]!);
    expect(xml).toContain(from);
    entries[name] = strToU8(xml.replace(from, to));
    writeFileSync(file, zipSync(entries));
  }

  test('the Receptionist fixture: none, then one W-REF-SIN-CATALOGO after roleRef="ghost"; the exit code stays 0', async () => {
    const file = join(scratch, 'hotel.lila');
    writeFileSync(file, hotelLila(2));
    const { object } = await createLilaCatalogObject({ file, type: 'role', name: 'Receptionist' });
    for (const process of HOTEL_PROCESSES) {
      await annotateLilaElement({ file, process: process.slug, elementId: 'Task_1', responsibilities: [{ type: 'R', roleRef: object.id }] });
    }
    const before = await validateJson(file, '--process', 'check-out');
    expect(before.code).toBe(0);
    expect(before.report.catalogWarnings).toEqual([]);

    handEdit(file, 'check-out', `roleRef="${object.id}"`, 'roleRef="ghost"');
    const processId = (await openLilaProcess(file, { process: 'check-out' })).process.id!;
    const after = await validateJson(file, '--process', 'check-out');
    expect(after.code).toBe(0);
    expect(after.report.errors).toEqual(before.report.errors);
    expect(after.report.warnings).toEqual(before.report.warnings);
    expect(after.report.catalogWarnings).toEqual([
      {
        code: 'W-REF-SIN-CATALOGO',
        process: processId,
        slug: 'check-out',
        element: 'Task_1',
        relation: 'responsibility:R',
        type: 'role',
        ref: 'ghost',
        message: `Task_1 (process ${processId}): the responsibility:R reference "ghost" matches no role object in the catalog; it is kept as it is.`,
      },
    ]);
    // Only the process validated is listed: check-in still resolves.
    expect((await validateJson(file, '--process', 'check-in')).report.catalogWarnings).toEqual([]);

    out = [];
    expect(await main(['--lang', 'es', 'validate', file, '--process', 'check-out'])).toBe(0);
    expect(out.slice(-2)).toEqual([
      'Avisos del catálogo (1):',
      `aviso  W-REF-SIN-CATALOGO  Task_1 (proceso ${processId}): la referencia responsibility:R "ghost" no coincide con ningún objeto role del catálogo; se conserva tal cual.`,
    ]);
  });

  test('an activity without an R gets W-ACTIVIDAD-SIN-RESPONSABLE in the text section', async () => {
    const file = join(scratch, 'hotel.lila');
    writeFileSync(file, hotelLila(2));
    await createLilaCatalogObject({ file, type: 'role', name: 'Receptionist' });
    out = [];
    expect(await main(['validate', file, '--process', 'room-service'])).toBe(0);
    const processId = (await openLilaProcess(file, { process: 'room-service' })).process.id!;
    expect(out.slice(-3)).toEqual([
      '',
      'Catalog warnings (1):',
      `warning  W-ACTIVIDAD-SIN-RESPONSABLE  Task_1 (process ${processId}): the activity has no Responsible role (lila:responsibility type="R").`,
    ]);
  });

  test('a broken model in another process changes nothing; an unreadable validated one leaves catalogWarnings out', async () => {
    const file = join(scratch, 'hotel.lila');
    writeFileSync(file, hotelLila(2));
    const { object } = await createLilaCatalogObject({ file, type: 'role', name: 'Receptionist' });
    await annotateLilaElement({ file, process: 'check-in', elementId: 'Task_1', responsibilities: [{ type: 'R', roleRef: object.id }] });
    const before = await validateJson(file, '--process', 'check-in');
    expect(before.report.catalogWarnings).toEqual([]);

    handEdit(file, 'check-out', '<bpmn:definitions ', '<bpmn:definitions');
    const other = await validateJson(file, '--process', 'check-in');
    expect(other).toEqual(before);

    handEdit(file, 'check-in', 'id="End_1"', 'id="Task_1"');
    const { report } = await validateJson(file, '--process', 'check-in');
    expect(Object.keys(report)).toEqual(['ir', 'ignoredProcessIds', 'errors', 'warnings']);
  });

  test('version 1 and 2 projects with typed ids: no catalogWarnings, same output and exit code', async () => {
    for (const version of [1, 2] as const) {
      const file = join(scratch, `v${version}.lila`);
      writeFileSync(file, hotelLila(version, { handTyped: true }));
      const { code, report } = await validateJson(file, '--process', 'check-in');
      expect(code).toBe(0);
      expect(Object.keys(report)).toEqual(['ir', 'ignoredProcessIds', 'errors', 'warnings']);
      out = [];
      expect(await main(['validate', file, '--process', 'check-in'])).toBe(0);
      expect(out.at(-1)).toBe('0 errors, 0 warnings.');
    }
  });
});

/** The model of every process of the `.lila` at `file`. */
function processesOfFile(file: string): string[] {
  return Object.entries(unzipSync(readFileSync(file)))
    .filter(([name]) => name.endsWith('model.bpmn'))
    .map(([, data]) => Buffer.from(data).toString('utf8'));
}

describe('lila catalog (#673)', () => {
  function entriesOf(file: string): Record<string, string> {
    return Object.fromEntries(Object.entries(unzipSync(readFileSync(file))).map(([name, data]) => [name, Buffer.from(data).toString('base64')]));
  }

  function changedEntries(before: Record<string, string>, after: Record<string, string>): string[] {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((name) => before[name] !== after[name]).sort();
  }

  /** Ids drawn from a fixed byte sequence, so two runs of the same steps generate the same ids. */
  function seededIds(): void {
    let next = 0;
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      const bytes = array as unknown as Uint8Array;
      for (let i = 0; i < bytes.length; i++) bytes[i] = (next++ * 97 + 13) % 252;
      return array;
    });
  }

  /** `lila …` through `main()`: its exit code and what it printed. */
  async function lila(...argv: string[]): Promise<{ code: number; text: string }> {
    out.length = 0;
    const code = await main(argv);
    return { code, text: out.join('\n') };
  }

  /** `lila … --json`, which has to exit 0; its output parsed. */
  async function lilaJson(...argv: string[]): Promise<Record<string, any>> {
    const { code, text } = await lila(...argv, '--json');
    expect(code, text).toBe(0);
    return JSON.parse(text) as Record<string, any>;
  }

  /** One step of the Receptionist scenario: the CLI command and the call the MCP tool makes. */
  interface Step {
    readonly cli: (file: string, ids: Record<string, string>) => string[];
    readonly mcp: (file: string, ids: Record<string, string>) => Promise<unknown>;
    readonly id?: string;
  }

  const roleOf = (ids: Record<string, string>) => [{ type: 'R', roleRef: ids.receptionist! }];
  const STEPS: readonly Step[] = [
    { cli: (f) => ['catalog', 'create', f, '--type', 'role', '--name', 'Receptionist', '--dry-run'], mcp: (file) => createLilaCatalogObject({ file, type: 'role', name: 'Receptionist', dryRun: true }) },
    { cli: (f) => ['catalog', 'create', f, '--type', 'role', '--name', 'Receptionist'], mcp: (file) => createLilaCatalogObject({ file, type: 'role', name: 'Receptionist' }), id: 'receptionist' },
    { cli: (f) => ['catalog', 'create', f, '--type', 'role', '--name', 'Guest relations'], mcp: (file) => createLilaCatalogObject({ file, type: 'role', name: 'Guest relations' }), id: 'guest' },
    ...HOTEL_PROCESSES.map((p): Step => ({
      cli: (f, ids) => ['process', 'annotate', f, 'Task_1', '--process', p.slug, '--responsibility', `R:${ids.receptionist}`],
      mcp: (file, ids) => annotateLilaElement({ file, process: p.slug, elementId: 'Task_1', responsibilities: roleOf(ids) }),
    })),
    { cli: (f, ids) => ['catalog', 'usages', f, ids.receptionist!], mcp: (file, ids) => lilaUsages({ file, id: ids.receptionist }) },
    {
      cli: (f, ids) => ['catalog', 'update', f, ids.receptionist!, '--base-revision', '1', '--name', 'Front desk agent'],
      mcp: (file, ids) => updateLilaCatalogObject({ file, id: ids.receptionist!, baseRevision: 1, name: 'Front desk agent' }),
    },
    { cli: (f, ids) => ['catalog', 'show', f, ids.receptionist!], mcp: (file, ids) => lilaCatalogObject({ file, id: ids.receptionist! }) },
    { cli: (f) => ['catalog', 'list', f, '--type', 'role'], mcp: (file) => lilaCatalogList({ file, type: 'role' }) },
    {
      cli: (f, ids) => ['catalog', 'delete', f, ids.receptionist!, '--replace-with', ids.guest!],
      mcp: (file, ids) => deleteLilaCatalogObject({ file, id: ids.receptionist!, replaceWith: ids.guest }),
    },
    {
      cli: (f, ids) => ['catalog', 'delete', f, ids.guest!, '--remove-references'],
      mcp: (file, ids) => deleteLilaCatalogObject({ file, id: ids.guest!, removeReferences: true }),
    },
    {
      cli: (f) => ['catalog', 'create', f, '--type', 'document', '--name', 'Registration card', '--url', 'https://intranet.example.com/card'],
      mcp: (file) => createLilaCatalogObject({ file, type: 'document', name: 'Registration card', url: 'https://intranet.example.com/card' }),
    },
    { cli: (f) => ['catalog', 'usages', f], mcp: (file) => lilaUsages({ file }) },
  ];

  /** Runs the steps on a fresh version 2 hotel at `file`; each step's result and the entries it changed. */
  async function receptionist(file: string, via: 'cli' | 'mcp'): Promise<{ results: unknown[]; changed: string[][] }> {
    writeFileSync(file, hotelLila(2));
    seededIds();
    const ids: Record<string, string> = {};
    const results: unknown[] = [];
    const changed: string[][] = [];
    for (const step of STEPS) {
      const before = entriesOf(file);
      // The MCP tool answers with `JSON.stringify` of what the function returns.
      const result = via === 'cli' ? await lilaJson(...step.cli(file, ids)) : JSON.parse(JSON.stringify(await step.mcp(file, ids)));
      if (step.id !== undefined) ids[step.id] = (result as { object: { id: string } }).object.id;
      results.push(JSON.parse(JSON.stringify(result).replaceAll(file, '<file>')));
      changed.push(changedEntries(before, entriesOf(file)));
    }
    vi.mocked(globalThis.crypto.getRandomValues).mockRestore();
    return { results, changed };
  }

  test('the Receptionist scenario of #672 with `lila catalog` only gives what the MCP tools give', async () => {
    const viaCli = join(scratch, 'cli.lila');
    const viaMcp = join(scratch, 'mcp.lila');
    const cli = await receptionist(viaCli, 'cli');
    const mcp = await receptionist(viaMcp, 'mcp');
    expect(cli.results).toEqual(mcp.results);
    expect(cli.changed).toEqual(mcp.changed);
    expect(readFileSync(viaCli)).toEqual(readFileSync(viaMcp));

    // The same scenario, checked on its own terms.
    const [dry, created, , , , , usages, renamed, shown, , replaced, removed] = cli.results as Record<string, any>[];
    const id = created!.object.id as string;
    expect(dry).toMatchObject({ dryRun: true, written: false, wouldUpgrade: true });
    expect(cli.changed[0]).toEqual([]);
    expect(created).toMatchObject({ written: true, wouldUpgrade: true, created: [`role/${id}`] });
    expect(usages!.uses.map((u: { slug: string; relation: string }) => [u.slug, u.relation])).toEqual(HOTEL_PROCESSES.map((p) => [p.slug, 'responsibility:R']));
    expect(renamed).toMatchObject({ updated: [`role/${id}`], processes: [] });
    expect(cli.changed[7]).toEqual([`catalog/role/${id}.json`]);
    expect(shown!.object).toMatchObject({ id, name: 'Front desk agent', revision: 2 });
    expect(replaced!.processes.map((p: { slug: string }) => p.slug)).toEqual(HOTEL_PROCESSES.map((p) => p.slug));
    expect(removed!.deleted).toHaveLength(1);
  });

  test('refusals exit 1 and write nothing: a stale --base-revision, a delete in use (with its uses), in both languages', async () => {
    const file = join(scratch, 'hotel.lila');
    writeFileSync(file, hotelLila(2));
    const id = (await lilaJson('catalog', 'create', file, '--type', 'role', '--name', 'Receptionist')).object.id as string;
    for (const p of HOTEL_PROCESSES) expect((await lila('process', 'annotate', file, 'Task_1', '--process', p.slug, '--responsibility', `R:${id}`)).code).toBe(0);
    expect((await lila('catalog', 'update', file, id, '--base-revision', '1', '--name', 'Front desk agent')).code).toBe(0);
    const settled = readFileSync(file);

    const stale = await lila('catalog', 'update', file, id, '--base-revision', '1', '--name', 'Night auditor');
    expect(stale.code).toBe(1);
    expect(stale.text).toMatch(/^lila catalog: E-REVISION: /);

    const inUse = await lila('catalog', 'delete', file, id);
    expect(inUse.code).toBe(1);
    expect(inUse.text).toMatch(/^lila catalog delete: E-OBJETO-EN-USO: role\/\S+ is in use \(3 uses: /);
    for (const p of HOTEL_PROCESSES) expect(inUse.text).toContain(`${p.slug} Task_1 responsibility:R`);
    expect(inUse.text).toContain('From the CLI: --replace-with <id>');
    const inUseEs = await lila('catalog', 'delete', file, id, '--json', '--locale', 'es');
    expect(inUseEs.code).toBe(1);
    expect(inUseEs.text).toMatch(/E-OBJETO-EN-USO: .* está en uso \(3 usos: /);
    expect(inUseEs.text).toContain('Desde la CLI');
    expect(readFileSync(file)).toEqual(settled);

    const other = (await lilaJson('catalog', 'create', file, '--type', 'role', '--name', 'Guest relations')).object.id as string;
    const replaced = await lila('catalog', 'delete', file, id, '--replace-with', other);
    expect(replaced.code, replaced.text).toBe(0);
    expect(replaced.text).toContain(`Deleted role/${id} in ${file}.`);
    for (const p of HOTEL_PROCESSES) expect(replaced.text).toContain(`model of ${p.slug}: 1 reference rewritten`);
  });

  test('create --dry-run on a version 2 file prints the upgrade note and writes nothing; --json carries wouldUpgrade', async () => {
    const file = join(scratch, 'hotel.lila');
    writeFileSync(file, hotelLila(2));
    const original = readFileSync(file);
    const dry = await lila('catalog', 'create', file, '--type', 'role', '--name', 'Receptionist', '--dry-run');
    expect(dry.code).toBe(0);
    expect(dry.text).toMatch(/^Dry run: would create role\/role-[0-9a-z]{12} in .*\. Nothing was written\./);
    expect(dry.text).toContain('warning This change saves the file as repository version 3');
    expect(dry.text).toContain('1.0.0-beta.15 to 1.0.0-beta.28');
    const es = await lila('catalog', 'create', file, '--type', 'role', '--name', 'Recepcionista', '--dry-run', '--locale', 'es');
    expect(es.text).toMatch(/^Simulacro: se crearía role\/role-/);
    expect(es.text).toContain('aviso Este cambio guarda el archivo como repositorio versión 3');
    expect((await lilaJson('catalog', 'adopt', file, 'cajero', '--type', 'role', '--dry-run'))).toMatchObject({ wouldUpgrade: true, written: false });
    expect(readFileSync(file)).toEqual(original);

    expect((await lilaJson('catalog', 'create', file, '--type', 'unit', '--name', 'Front office')).wouldUpgrade).toBe(true);
    const second = await lila('catalog', 'create', file, '--type', 'role', '--name', 'Receptionist');
    expect(second.text).not.toContain('version 3');
    expect((await lilaJson('catalog', 'list', file)).formatVersion).toBe(3);
  });

  test('fields from the command line: attributes, refs, "" removes a field, adopt, text output', async () => {
    const file = join(scratch, 'hand.lila');
    writeFileSync(file, hotelLila(2, { handTyped: true }));
    const adopted = await lilaJson('catalog', 'adopt', file, 'cajero', '--type', 'role', '--name', 'Cashier');
    expect(adopted).toMatchObject({ object: { id: 'cajero', name: 'Cashier' }, processes: [] });
    const unresolved = await lila('catalog', 'usages', file, 'POS');
    expect(unresolved.text).toMatch(/^"POS" is not the id of any catalog object: 3 unresolved references to it:/);
    const pos = await lila('catalog', 'adopt', file, 'POS', '--type', 'system', '--name', 'Point of sale');
    expect(pos.text).toMatch(/^Adopted system\/system-[0-9a-z]{12} in /);
    expect(pos.text).toContain('model of check-in: 1 reference rewritten');

    const unit = (await lilaJson('catalog', 'create', file, '--type', 'unit', '--name', 'Front office')).object.id as string;
    const updated = await lilaJson(
      'catalog', 'update', file, 'cajero', '--base-revision', '1', '--unit-ref', unit,
      '--description', 'Takes payments.', '--attribute', 'Shift=morning', '--attribute', 'Desk=A=1',
    );
    expect(updated.object).toEqual({
      type: 'role', id: 'cajero', name: 'Cashier', description: 'Takes payments.', revision: 2,
      attributes: [{ name: 'Shift', value: 'morning' }, { name: 'Desk', value: 'A=1' }], unitRef: unit,
    });
    const shown = await lila('catalog', 'show', file, 'cajero');
    expect(shown.text.split('\n')).toEqual([
      'role/cajero  "Cashier"  revision 2', '  description: Takes payments.', '  attributes:', '    Shift: morning', '    Desk: A=1', `  unitRef: ${unit}`,
    ]);
    const cleared = await lilaJson('catalog', 'update', file, 'cajero', '--base-revision', '2', '--description', '', '--unit-ref', '', '--clear-attributes');
    expect(cleared.object).toEqual({ type: 'role', id: 'cajero', name: 'Cashier', revision: 3 });
    const same = await lila('catalog', 'update', file, 'cajero', '--base-revision', '3', '--name', 'Cashier');
    expect(same.text).toBe('Nothing changes: role/cajero already says this. Nothing was written.\nrole/cajero  "Cashier"  revision 3');

    const list = await lila('catalog', 'list', file);
    expect(list.text).toMatch(/format version 3: 3 catalog objects:\n {2}role\/cajero {2}"Cashier" {2}revision 3\n/);
    const index = await lila('catalog', 'usages', file);
    expect(index.text).toContain(`unit/${unit}: 0 uses.`);
    expect(index.text).toContain('0 unresolved references.');

    // A delete names the other objects whose reference fields it changes, and says when references go.
    await lilaJson('catalog', 'update', file, 'cajero', '--base-revision', '3', '--unit-ref', unit);
    const dropUnit = await lila('catalog', 'delete', file, unit, '--remove-references', '--dry-run');
    expect(dropUnit.text).toContain('  also updated: role/cajero (a reference field)');
    const posId = (await lilaJson('catalog', 'list', file, '--type', 'system')).objects[0].id as string;
    const dropPos = await lila('catalog', 'delete', file, posId, '--remove-references');
    expect(dropPos.text).toContain('model of check-in: 1 reference removed');
    expect((await lila('catalog', 'delete', file, unit, '--remove-references', '--dry-run', '--locale', 'es')).text)
      .toContain('  también se actualizó: role/cajero (un campo de referencia)');

    // Attribute names are kept as written; a blank one is refused.
    const spaced = await lilaJson('catalog', 'update', file, 'cajero', '--base-revision', '4', '--attribute', ' Shift =x');
    expect(spaced.object.attributes).toEqual([{ name: ' Shift ', value: 'x' }]);
    const blank = await lila('catalog', 'update', file, 'cajero', '--base-revision', '5', '--attribute', ' =v');
    expect(blank.code).toBe(1);
    expect(blank.text).toContain('--attribute takes key=value; got " =v".');
  });

  test('usage errors exit 1 and write nothing', async () => {
    const file = join(scratch, 'hotel.lila');
    writeFileSync(file, hotelLila(2));
    const original = readFileSync(file);
    const cases: [string[], string][] = [
      [['catalog'], 'unknown subcommand ""; use list, show, create, update, delete, usages, adopt.'],
      [['catalog', 'remove', file], 'unknown subcommand "remove"'],
      [['catalog', 'create', file, '--name', 'X'], 'missing --type role|unit|system|document.'],
      [['catalog', 'create', file, '--type', 'role'], 'missing --name <name>.'],
      [['catalog', 'create', file, '--type', 'risk', '--name', 'X'], 'role, unit, system, document'],
      [['catalog', 'create', file, '--type', 'role', '--name', 'X', '--url', 'https://x.example'], 'its fields: unitRef'],
      [['catalog', 'create', file, '--type', 'role', '--name', 'X', '--attribute', 'novalue'], '--attribute takes key=value; got "novalue".'],
      [['catalog', 'update', file, 'role-x'], 'missing --base-revision <n>.'],
      [['catalog', 'update', file, 'role-x', '--base-revision', 'one'], '--base-revision requires an integer; got "one".'],
      [['catalog', 'update', file, 'role-x', '--base-revision', '1', '--attribute', 'a=b', '--clear-attributes'], 'give --attribute or --clear-attributes, not both.'],
      [['catalog', 'delete', file, 'role-x', '--replace-with', 'role-y', '--remove-references'], 'give --replace-with or --remove-references, not both.'],
      [['catalog', 'delete', file, 'role-nothere00000'], 'has no catalog object with the id "role-nothere00000"'],
      [['catalog', 'show', file], 'expected <project.lila> <id>.'],
      [['catalog', 'list', file, '--locale', 'fr'], '--locale only accepts: en, es; got "fr".'],
    ];
    for (const [argv, message] of cases) {
      const { code, text } = await lila(...argv);
      expect(code, argv.join(' ')).toBe(1);
      expect(text).toContain(message);
    }
    expect((await lila('catalog', 'show', file, 'role-nothere00000', '--locale', 'es_MX.UTF-8')).text).toContain('no tiene ningún objeto de catálogo');
    expect(readFileSync(file)).toEqual(original);
    expect((await lila('catalog', '--help')).code).toBe(0);
    expect(out.join('\n')).toContain('lila catalog adopt <project.lila> <ref> --type type');
    expect(out.join('\n')).toContain('--locale en|es');
    expect((await lila('catalog', '--help', '--locale', 'es')).text).toContain('lila catalog adopt <proyecto.lila> <ref> --type tipo');
  });
});
