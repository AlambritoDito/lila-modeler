// @vitest-environment jsdom
/**
 * Acceptance of #407's Shortcuts section: `Atajos` paints one heading and one table per group,
 * each row as «label | key», and nothing more — it is a read-only view of whatever `grupos` it is
 * handed (`Ajustes.tsx` builds that list; `atajos.ts`, #413, will at integration).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { Atajos, type GrupoAtajos } from './Atajos';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

const GRUPOS: readonly GrupoAtajos[] = [
  { titulo: 'Archivo', filas: [{ etiqueta: 'Guardar', tecla: '⌘S' }, { etiqueta: 'Guardar como', tecla: '⇧⌘S' }] },
  { titulo: 'Lienzo', filas: [{ etiqueta: 'Renombrar', tecla: 'F2' }] },
];

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Atajos grupos={GRUPOS} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

it('paints one heading and one table per group, in the same order', () => {
  const encabezados = [...container.querySelectorAll('h3')].map((h) => h.textContent);
  expect(encabezados).toEqual(['Archivo', 'Lienzo']);
  expect(container.querySelectorAll('table')).toHaveLength(2);
});

it('each row carries the label and the key in a mono `<kbd>`', () => {
  const filas = [...container.querySelectorAll('table')[0]!.querySelectorAll('tbody tr')];
  expect(filas.map((f) => f.querySelector('td')?.textContent)).toEqual(['Guardar', 'Guardar como']);
  const teclas = filas.map((f) => f.querySelector('kbd'));
  expect(teclas.every((k) => k !== null)).toBe(true);
  expect(teclas.map((k) => k!.textContent)).toEqual(['⌘S', '⇧⌘S']);
});

it('a group with no rows paints its empty table without blowing up', async () => {
  await act(async () => root.render(<Atajos grupos={[{ titulo: 'Vacío', filas: [] }]} />));
  expect(container.querySelector('h3')?.textContent).toBe('Vacío');
  expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
});
