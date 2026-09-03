import { expect, test } from 'vitest';
import { isNCName, newId, sanitizeIds } from '../../src/bpmn/ids.js';

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
