/**
 * `define_attribute` and `lila process attribute define|list` (#633) on a real `.lila`: a definition
 * created with a deterministic id (a dry run names it the same), found again by id or by name and
 * element type so a repeated call changes nothing, checked with the rules of the app's dialog,
 * written where the app writes it, and the values a removal, a retype, a move or fewer options
 * leave behind removed and reported. Every refusal leaves the file byte-identical.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { annotateElement, readAnnotations } from '../../src/bpmn/index.js';
import { main } from '../../src/cli.js';
import { decodeLila, encodeLila } from '../../src/project/index.js';
import { annotateLilaElement, defineLilaAttribute, lilaAttributeList, openLilaProcess } from '../../src/project-fs/index.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const exampleLila = join(repo, 'examples/pedido.lila');

let scratch: string;
let file: string;
let out: string[];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lila-attributes-'));
  file = join(scratch, 'pedido.lila');
  writeFileSync(file, readFileSync(exampleLila));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

async function modelXml(): Promise<string> {
  return (await openLilaProcess(file)).process.model.xml;
}

/** pedido with its model replaced by `edit(xml)`. */
async function withModel(edit: (xml: string) => Promise<string> | string): Promise<void> {
  const document = decodeLila(readFileSync(file));
  writeFileSync(file, encodeLila({ ...document, model: { ...document.model, xml: await edit(document.model.xml) } }));
}

const level = { name: 'Risk level', type: 'list', appliesTo: 'task', options: ['Low', 'High'] } as const;

describe('defineLilaAttribute', () => {
  test('creates a definition with a deterministic id; a dry run names it the same and writes nothing', async () => {
    const bytes = readFileSync(file);
    const dry = await defineLilaAttribute({ file, ...level, options: [...level.options], default: 'Low', dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, changed: true, written: false, before: null, removedValues: [] });
    expect(readFileSync(file).equals(bytes)).toBe(true);

    const saved = await defineLilaAttribute({ file, ...level, options: [...level.options], default: 'Low' });
    const definition = { id: 'Attr_risk_level', name: 'Risk level', type: 'list', appliesTo: 'task', default: 'Low', options: ['Low', 'High'] };
    expect(saved).toEqual({
      file: file.replaceAll('\\', '/'),
      process: 'pedido',
      dryRun: false,
      changed: true,
      written: true,
      before: null,
      after: definition,
      removedValues: [],
      definitions: [definition],
    });
    expect(dry.after).toEqual(saved.after);
    // Where the app writes it: on the collaboration.
    expect((await readAnnotations(await modelXml()))['Collaboration_Pedido']?.attributeDefinitions).toEqual([definition]);
    expect((await lilaAttributeList({ file })).definitions).toEqual([definition]);
  });

  test('calling it again changes nothing; the name is matched ignoring case, per element type', async () => {
    await defineLilaAttribute({ file, ...level, options: [...level.options] });
    const bytes = readFileSync(file);
    const again = await defineLilaAttribute({ file, ...level, options: [' Low ', 'High', 'High'] });
    expect(again).toMatchObject({ changed: false, written: false, removedValues: [] });
    expect(again.before).toEqual(again.after);
    expect(readFileSync(file).equals(bytes)).toBe(true);

    // The same name for gateways is another attribute, with the next id.
    const gateways = await defineLilaAttribute({ file, name: 'RISK LEVEL', type: 'text', appliesTo: 'gateway' });
    expect(gateways.after?.id).toBe('Attr_risk_level_2');
    expect(gateways.definitions.map((d) => d.id)).toEqual(['Attr_risk_level', 'Attr_risk_level_2']);
  });

  test('a new id never repeats an id of the file', async () => {
    await withModel((xml) => xml.replaceAll('Task_TomarPedido', 'Attr_sla'));
    const result = await defineLilaAttribute({ file, name: 'SLA', type: 'number', appliesTo: 'task' });
    expect(result.after?.id).toBe('Attr_sla_2');
  });

  test('a rename by id keeps every value; fewer options remove the values that no longer fit, a dry run says which', async () => {
    const { after } = await defineLilaAttribute({ file, ...level, options: ['Low', 'Mid', 'High'] });
    await annotateLilaElement({ file, elementId: 'Task_TomarPedido', attributes: { 'Risk level': 'High' } });
    await annotateLilaElement({ file, elementId: 'Task_Revisar', attributes: { 'Risk level': 'Mid' } });

    const renamed = await defineLilaAttribute({ file, id: after!.id, name: 'Risk', type: 'list', appliesTo: 'task', options: ['Low', 'Mid', 'High'] });
    expect(renamed).toMatchObject({ changed: true, removedValues: [], after: { id: 'Attr_risk_level', name: 'Risk' } });

    const bytes = readFileSync(file);
    const fewer = { file, id: after!.id, name: 'Risk', type: 'list', appliesTo: 'task', options: ['Low', 'High'] };
    const dry = await defineLilaAttribute({ ...fewer, dryRun: true });
    expect(dry.removedValues).toEqual([{ elementId: 'Task_Revisar', value: 'Mid' }]);
    expect(readFileSync(file).equals(bytes)).toBe(true);
    expect((await defineLilaAttribute(fewer)).removedValues).toEqual(dry.removedValues);
    const annotations = await readAnnotations(await modelXml());
    expect(annotations['Task_TomarPedido']?.attributes).toEqual([{ ref: 'Attr_risk_level', value: 'High' }]);
    expect(annotations['Task_Revisar']).toBeUndefined();
  });

  test('a retype or another element type removes the values that no longer fit', async () => {
    await defineLilaAttribute({ file, name: 'Code', type: 'text', appliesTo: 'task' });
    await annotateLilaElement({ file, elementId: 'Task_TomarPedido', attributes: { Code: '12' } });
    await annotateLilaElement({ file, elementId: 'Task_Revisar', attributes: { Code: 'A-7' } });
    const retyped = await defineLilaAttribute({ file, name: 'Code', type: 'number', appliesTo: 'task' });
    expect(retyped.removedValues).toEqual([{ elementId: 'Task_Revisar', value: 'A-7' }]);
    const moved = await defineLilaAttribute({ file, id: 'Attr_code', name: 'Code', type: 'number', appliesTo: 'gateway' });
    expect(moved.removedValues).toEqual([{ elementId: 'Task_TomarPedido', value: '12' }]);
  });

  test('remove: the definition and its values go; removing what is not there changes nothing', async () => {
    await defineLilaAttribute({ file, ...level, options: [...level.options] });
    await annotateLilaElement({ file, elementId: 'Task_TomarPedido', attributes: { 'Risk level': 'High' } });
    const removed = await defineLilaAttribute({ file, name: 'risk level', appliesTo: 'task', remove: true });
    expect(removed).toMatchObject({ changed: true, written: true, after: null, definitions: [] });
    expect(removed.before?.id).toBe('Attr_risk_level');
    expect(removed.removedValues).toEqual([{ elementId: 'Task_TomarPedido', value: 'High' }]);
    const annotations = await readAnnotations(await modelXml());
    expect(Object.values(annotations).some((a) => a.attributeDefinitions !== undefined || a.attributes !== undefined)).toBe(false);

    const bytes = readFileSync(file);
    expect(await defineLilaAttribute({ file, id: 'Attr_risk_level', remove: true })).toMatchObject({ changed: false, before: null, after: null });
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('copies outside the collaboration are consolidated there, the first one winning', async () => {
    const sla = { id: 'Attr_sla', name: 'SLA', type: 'number', appliesTo: 'task' };
    await withModel(async (xml) => {
      const onProcess = await annotateElement(xml, 'Process_Restaurante', { attributeDefinitions: [sla] });
      return annotateElement(onProcess, 'Process_Cliente', { attributeDefinitions: [{ ...sla, name: 'Ignored copy' }] });
    });
    const result = await defineLilaAttribute({ file, name: 'Owner', type: 'text', appliesTo: 'lane' });
    expect(result.definitions).toEqual([sla, { id: 'Attr_owner', name: 'Owner', type: 'text', appliesTo: 'lane' }]);
    const annotations = await readAnnotations(await modelXml());
    expect(annotations['Collaboration_Pedido']?.attributeDefinitions).toEqual(result.definitions);
    expect(annotations['Process_Restaurante']?.attributeDefinitions).toBeUndefined();
    expect(annotations['Process_Cliente']?.attributeDefinitions).toBeUndefined();
  });

  test.each([
    ['en', { name: 'SLA', type: 'number' }, /^pass the whole definition of the attribute: name, type and appliesTo/],
    ['en', { remove: true, name: 'SLA' }, /^to remove an attribute, pass its id, or its name and appliesTo\.$/],
    ['en', { id: 'Attr_nope', name: 'SLA', type: 'number', appliesTo: 'task' }, /^no extended attribute has the id "Attr_nope"; defined: Attr_cost \(Cost\), Attr_other \(Other\)\. Leave id out/],
    ['es', { name: ' ', type: 'number', appliesTo: 'task' }, /^un atributo extendido necesita un nombre\.$/],
    ['en', { name: 'SLA', type: 'money', appliesTo: 'task' }, /^"money" is not an attribute type; use one of text, number, list, date\.$/],
    ['es', { name: 'SLA', type: 'number', appliesTo: 'flow' }, /^"flow" no es un tipo de elemento para atributos; usa uno de task, gateway, event, subProcess, lane, process\.$/],
    ['en', { name: 'L', type: 'list', appliesTo: 'task', options: [' '] }, /^attribute "L" is a list and needs at least one option\.$/],
    ['es', { name: 'SLA', type: 'number', appliesTo: 'task', options: ['1'] }, /^el atributo "SLA" es de tipo number; solo una lista lleva opciones\.$/],
    ['en', { name: 'SLA', type: 'number', appliesTo: 'task', default: '4,5' }, /^"4,5" is not a number for attribute "SLA"/],
    ['en', { name: 'L', type: 'list', appliesTo: 'task', options: ['a'], default: 'b' }, /^"b" is not an option of attribute "L"; use one of a\.$/],
    ['en', { id: 'Attr_cost', name: 'Other', type: 'number', appliesTo: 'task' }, /^an attribute for tasks is already named "Other" \(Attr_other\); pass its id to change it\.$/],
    ['es', { id: 'Attr_cost', name: 'OTHER', type: 'number', appliesTo: 'task' }, /^ya hay un atributo para tareas llamado "OTHER" \(Attr_other\); pasa su id para cambiarlo\.$/],
  ] as const)('%s refuses %j, writing nothing', async (locale, request, message) => {
    await defineLilaAttribute({ file, name: 'Cost', type: 'number', appliesTo: 'task' });
    await defineLilaAttribute({ file, name: 'Other', type: 'number', appliesTo: 'task' });
    const bytes = readFileSync(file);
    const options = 'options' in request ? [...request.options] : undefined;
    await expect(defineLilaAttribute({ file, locale, ...request, options })).rejects.toThrow(message);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('a model bpmn-moddle cannot write back whole is refused with its reason, not "[object Object]"', async () => {
    const b20 = readFileSync(join(repo, 'examples/bizagi-exports/bizagi-miwg-B.2.0-roundtrip.bpmn'), 'utf8');
    await withModel(() => b20);
    const bytes = readFileSync(file);
    const error = await defineLilaAttribute({ file, name: 'SLA', type: 'number', appliesTo: 'task' }).catch((e: unknown) => e as Error);
    expect(error.message).toMatch(/^the model has content that cannot be written back without losing it/);
    expect(error.message).not.toContain('[object Object]');
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });
});

describe('lila process attribute define|list', () => {
  test('define prints the definition and the values removed; list prints them all; --json is the result', async () => {
    expect(await main(['process', 'attribute', 'define', file, '--name', 'SLA (h)', '--type', 'number', '--applies-to', 'task', '--default', '24'])).toBe(0);
    expect(out).toEqual([
      `Saved attribute "SLA (h)" (Attr_sla_h) in ${file.replaceAll('\\', '/')}.`,
      '  Attr_sla_h  "SLA (h)"  number, for tasks, default 24',
    ]);
    out.length = 0;
    expect(await main(['process', 'attribute', 'define', file, '--name', 'Nivel', '--type', 'list', '--applies-to', 'task', '--option', 'Bajo', '--option', 'Alto', '--dry-run', '--lang', 'es'])).toBe(0);
    expect(out).toEqual([
      'Simulacro: el atributo quedaría así; no se escribió nada.',
      '  Attr_nivel  "Nivel"  list, para tareas, opciones Bajo, Alto',
    ]);
    out.length = 0;
    await annotateLilaElement({ file, elementId: 'Task_TomarPedido', attributes: { 'SLA (h)': '12' } });
    expect(await main(['process', 'attribute', 'define', file, '--id', 'Attr_sla_h', '--remove'])).toBe(0);
    expect(out).toEqual([`Removed attribute Attr_sla_h from ${file.replaceAll('\\', '/')}.`, '1 value removed:', '  Task_TomarPedido: 12']);
    out.length = 0;
    expect(await main(['process', 'attribute', 'list', file])).toBe(0);
    expect(out).toEqual(['Process pedido defines no extended attributes.']);
    out.length = 0;
    await defineLilaAttribute({ file, name: 'Owner', type: 'text', appliesTo: 'lane' });
    expect(await main(['process', 'attribute', 'list', file, '--json'])).toBe(0);
    expect(JSON.parse(out.join('\n'))).toEqual({
      file: file.replaceAll('\\', '/'),
      process: 'pedido',
      definitions: [{ id: 'Attr_owner', name: 'Owner', type: 'text', appliesTo: 'lane' }],
    });
  });

  test('an unknown subcommand or a missing project is a usage error', async () => {
    expect(await main(['process', 'attribute', 'show', file])).toBe(1);
    expect(out[0]).toBe('lila process attribute: unknown subcommand "show"; use define, list.');
    expect(await main(['process', 'attribute', 'list'])).toBe(1);
  });
});
