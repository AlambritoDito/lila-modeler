import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BpmnModdle } from 'bpmn-moddle';
import { expect, test } from 'vitest';
import {
  isNCName,
  marcarExportador,
  newId,
  parseBpmn,
  sanitizeIds,
  sanitizeXmlIds,
} from '../../src/bpmn/index.js';

test('10 000 ids generados son NCName únicos', () => {
  const ids = new Set<string>();
  for (let i = 0; i < 10_000; i += 1) {
    const id = newId('Task');
    expect(isNCName(id)).toBe(true);
    ids.add(id);
  }
  expect(ids.size).toBe(10_000);
});

test('newId antepone el prefijo por tipo', () => {
  expect(newId('Gateway')).toMatch(/^Gateway_/);
  expect(newId('Flow')).toMatch(/^Flow_/);
});

test('un id "1abc" se sanitiza y se recupera', () => {
  const map = sanitizeIds(['1abc']);

  expect(map.size).toBe(1);
  const [sanitized] = [...map.keys()];
  expect(sanitized).toBeDefined();
  expect(isNCName(sanitized as string)).toBe(true);
  expect(map.get(sanitized as string)).toBe('1abc');
});

test('un id ya NCName no se toca ni aparece en el mapa', () => {
  const map = sanitizeIds(['Task_7f3k2q1']);
  expect(map.size).toBe(0);
});

test('la sanitización es determinista: mismo id de entrada, mismo id de salida', () => {
  const first = sanitizeIds(['1abc']);
  const second = sanitizeIds(['1abc']);
  expect([...first.keys()]).toEqual([...second.keys()]);
});

test('dos originales distintos nunca colisionan en el mismo sanitizado', () => {
  // "_1abc" ya es NCName válido y reserva ese nombre; "1abc" sanitiza al mismo
  // candidato ("_1abc") y debe desambiguarse.
  const map = sanitizeIds(['_1abc', '1abc']);

  expect(map.size).toBe(1);
  const [sanitized, original] = [...map.entries()][0] as [string, string];
  expect(original).toBe('1abc');
  expect(sanitized).not.toBe('_1abc');
  expect(isNCName(sanitized)).toBe(true);

  // El mapa se puede invertir sin ambigüedad: cada sanitizado -> exactamente un original.
  const reversed = new Map([...map.entries()].map(([s, o]) => [o, s]));
  expect(reversed.get('1abc')).toBe(sanitized);
});

test('varios ids no-NCName distintos que sanitizan al mismo candidato no colisionan', () => {
  const map = sanitizeIds(['1abc', '#abc', '@abc']);

  expect(map.size).toBe(3);
  const sanitizedIds = [...map.keys()];
  expect(new Set(sanitizedIds).size).toBe(3);
  for (const id of sanitizedIds) expect(isNCName(id)).toBe(true);

  // Cada sanitizado recupera exactamente su original.
  expect(map.get('_1abc')).toBe('1abc');
});

test('isNCName no arrastra estado entre llamadas (regex sin bandera g)', () => {
  expect(isNCName('a b c')).toBe(false);
  expect(isNCName('x y')).toBe(false);
  expect(isNCName('Task_1')).toBe(true);
  expect(isNCName('Task_1')).toBe(true);
});

test('sanitizeXmlIds reescribe un id no-NCName en su definición y en su referencia', () => {
  const xml =
    '<bpmn:startEvent id="1-inicio" /><bpmn:sequenceFlow id="Flow_1" sourceRef="1-inicio" targetRef="Task_1" />';

  const { xml: out, sanitizedToOriginal } = sanitizeXmlIds(xml);

  expect(sanitizedToOriginal.size).toBe(1);
  const [sanitized] = [...sanitizedToOriginal.keys()];
  expect(sanitized).toBeDefined();
  expect(sanitizedToOriginal.get(sanitized as string)).toBe('1-inicio');

  // El id sanitizado reemplaza tanto la definición (`id="..."`) como la referencia
  // (`sourceRef="..."`), y ninguna otra cosa del XML cambia.
  expect(out).toContain(`id="${sanitized}"`);
  expect(out).toContain(`sourceRef="${sanitized}"`);
  expect(out).toContain('targetRef="Task_1"');
  expect(out).not.toContain('id="1-inicio"');
  expect(out).not.toContain('sourceRef="1-inicio"');
});

test('sanitizeXmlIds admite comillas mixtas y conserva la comilla de cada atributo', () => {
  const xml =
    "<bpmn:startEvent id='1-inicio' />" +
    '<bpmn:sequenceFlow id="2-flujo" sourceRef="1-inicio" targetRef=\'3-fin\' />' +
    '<bpmn:endEvent id="3-fin" />';

  const { xml: out, sanitizedToOriginal } = sanitizeXmlIds(xml);
  const originalToSanitized = new Map(
    [...sanitizedToOriginal].map(([sanitized, original]) => [original, sanitized]),
  );

  expect(sanitizedToOriginal.size).toBe(3);
  expect(out).toContain(`id='${originalToSanitized.get('1-inicio')}'`);
  expect(out).toContain(`sourceRef="${originalToSanitized.get('1-inicio')}"`);
  expect(out).toContain(`targetRef='${originalToSanitized.get('3-fin')}'`);
  expect(out).toContain(`id="${originalToSanitized.get('3-fin')}"`);
  for (const [sanitized, original] of sanitizedToOriginal) {
    expect(originalToSanitized.get(original)).toBe(sanitized);
  }
});

test('sanitizeXmlIds reescribe un id no-NCName en el contenido de texto de un elemento (flowNodeRef)', () => {
  const xml =
    '<bpmn:startEvent id="1-inicio" />' +
    '<bpmn:lane id="Lane_1"><bpmn:flowNodeRef>1-inicio</bpmn:flowNodeRef></bpmn:lane>';

  const { xml: out, sanitizedToOriginal } = sanitizeXmlIds(xml);
  const [sanitized] = [...sanitizedToOriginal.keys()];
  expect(sanitized).toBeDefined();

  expect(out).toContain(`<bpmn:flowNodeRef>${sanitized}</bpmn:flowNodeRef>`);
});

test('sanitizeXmlIds no toca el XML si todos los ids ya son NCName', () => {
  const xml = '<bpmn:startEvent id="Start_1" /><bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" />';

  const { xml: out, sanitizedToOriginal } = sanitizeXmlIds(xml);

  expect(sanitizedToOriginal.size).toBe(0);
  expect(out).toBe(xml);
});

// LILA-194: `marcarExportador` es el único sitio que escribe exporter/exporterVersion.

const RAIZ = new URL('../../../../', import.meta.url);
const leer = (rel: string): string => readFileSync(new URL(rel, RAIZ), 'utf8');
const VERSION_MOTOR = (JSON.parse(leer('packages/engine/package.json')) as { version: string })
  .version;
const BIZAGI = readdirSync(fileURLToPath(new URL('examples/bizagi-exports', RAIZ)))
  .filter((f) => f.endsWith('.bpmn'))
  .map((f) => `examples/bizagi-exports/${f}`);

test('un export de Bizagi guardado por Lila queda marcado, y el original conserva su exporter', async () => {
  const bizagi = leer('examples/bizagi-exports/bizagi-miwg-A.1.0-roundtrip.bpmn');
  const marcado = marcarExportador(bizagi);

  expect(marcado).toContain('exporter="Lila Modeler"');
  expect(marcado).toContain(`exporterVersion="${VERSION_MOTOR}"`);
  expect((await parseBpmn(marcado)).ir.source).toMatchObject({
    exporter: 'Lila Modeler',
    exporterVersion: VERSION_MOTOR,
  });

  // Bizagi no declara estos atributos (BPMN_EXTENSION.md sección 3): el archivo de origen se
  // lee tal cual, sin que la marca lo contamine.
  expect((await parseBpmn(bizagi)).ir.source.exporter).toBe('');
});

test('la marca reemplaza el exporter que ya traía el archivo', async () => {
  const propio = leer('examples/pedido/model.bpmn');
  expect((await parseBpmn(propio)).ir.source.exporter).toBe('Lila Modeler examples (hand-written)');

  const marcado = marcarExportador(propio);
  expect(marcado).not.toContain('hand-written');
  expect((await parseBpmn(marcado)).ir.source).toMatchObject({
    exporter: 'Lila Modeler',
    exporterVersion: VERSION_MOTOR,
  });
});

// QA LILA-194: la marca es sustitución de texto sobre la etiqueta `definitions`. Estas son las
// formas de esa etiqueta que sí produce una herramienta real.
test.each([
  ['sin prefijo', '<definitions xmlns="urn:x" id="D"></definitions>'],
  ['prefijo bpmn2', '<bpmn2:definitions xmlns:bpmn2="urn:x" id="D"></bpmn2:definitions>'],
  ['prefijo semantic', '<semantic:definitions xmlns:semantic="urn:x" id="D"></semantic:definitions>'],
  ['atributos en varias líneas', '<bpmn:definitions\n  xmlns:bpmn="urn:x"\n  id="D">\n</bpmn:definitions>'],
  ['exporter ajeno con comillas simples', `<definitions id="D" exporter='Camunda Modeler'></definitions>`],
  ['exporterVersion antes que exporter', '<definitions exporterVersion="9.9" exporter="Camunda" id="D"></definitions>'],
])('marca la etiqueta definitions %s una sola vez', (_caso, xml) => {
  const marcado = marcarExportador(xml);

  expect(marcado).toContain(`exporter="Lila Modeler"`);
  expect(marcado).toContain(`exporterVersion="${VERSION_MOTOR}"`);
  expect(marcado.match(/\sexporter=/g)).toHaveLength(1);
  expect(marcado.match(/\sexporterVersion=/g)).toHaveLength(1);
  // Volver a marcar un archivo ya marcado no duplica atributos ni cambia nada.
  expect(marcarExportador(marcado)).toBe(marcado);
});

test('marcar una etiqueta `definitions` autocerrada deja XML que moddle sigue leyendo', async () => {
  // Un `<definitions ... />` sin hijos es lo que serializa bpmn-moddle para un modelo vacío;
  // escribir el atributo antes del `>` a secas dejaba `... / exporter="…">`, ya no XML.
  const vacio =
    '<?xml version="1.0" encoding="UTF-8"?>\n<bpmn:definitions ' +
    'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" ' +
    'targetNamespace="urn:lila:test" />';
  const marcado = marcarExportador(vacio);

  expect(marcado).toContain(`exporterVersion="${VERSION_MOTOR}" />`);
  await expect(BpmnModdle().fromXML(marcado)).resolves.toBeDefined();
});

test('marcar un export de Bizagi no cambia nada del IR salvo el exporter', async () => {
  for (const archivo of [
    'examples/pedido/model.bpmn',
    ...BIZAGI,
  ]) {
    const original = leer(archivo);
    const antes = await parseBpmn(original);
    const despues = await parseBpmn(marcarExportador(original));
    const sinExporter = (p: typeof antes): unknown => ({
      ...p,
      ir: { ...p.ir, source: { ...p.ir.source, exporter: '', exporterVersion: '' } },
    });

    expect(sinExporter(despues), archivo).toEqual(sinExporter(antes));
    expect(despues.ir.source.exporterVersion, archivo).toBe(VERSION_MOTOR);
  }
});
