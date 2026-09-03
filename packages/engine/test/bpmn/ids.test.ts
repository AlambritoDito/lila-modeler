import { expect, test } from 'vitest';
import { isNCName, newId, sanitizeIds, sanitizeXmlIds } from '../../src/bpmn/ids.js';

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
