// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { PaletaComandos, filtrarComandos, type Comando } from './PaletaComandos';

const nada = (): void => {};
const elemento = (nombre: string, id: string, tipo = 'Task'): Comando => ({ grupo: 'elementos', nombre, id, tipo, elegir: nada });
const fuentes: Comando[] = [
  { grupo: 'acciones', nombre: 'Save', elegir: nada },
  elemento('Prepare order', 'Task_Prep'),
  elemento('Revisión', 'Task_Rev'),
  elemento('Enviar', 'Gateway_1', 'Exclusive'),
  { grupo: 'modos', nombre: 'Model', elegir: nada },
  { grupo: 'escenarios', nombre: 'AS-IS', elegir: nada },
  elemento('Re-check', 'Task_Recheck'),
];
const nombres = (consulta: string, lista = fuentes): string[] => filtrarComandos(consulta, lista).map((c) => c.nombre);

it('an empty query lists scenarios, modes and actions in group order, without elements', () => {
  expect(nombres('')).toEqual(['AS-IS', 'Model', 'Save']);
  expect(nombres('   ')).toEqual(['AS-IS', 'Model', 'Save']);
});

it('ignores accents and case, and also matches the id and the type', () => {
  expect(nombres('REVISION')).toEqual(['Revisión']);
  expect(nombres('gateway_1')).toEqual(['Enviar']);
  expect(nombres('exclus')).toEqual(['Enviar']);
});

it('ranks name prefix over name substring over id/type, groups first', () => {
  // «re»: «Revisión»/«Re-check» start with it, «Prepare order» contains it; nothing else matches.
  expect(nombres('re')).toEqual(['Revisión', 'Re-check', 'Prepare order']);
  // «task» only matches ids and types: every task, in their original order, after nothing else.
  expect(nombres('task')).toEqual(['Prepare order', 'Revisión', 'Re-check']);
  // Elements come before scenarios, modes and actions whatever their rank.
  expect(nombres('s')).toEqual(['Revisión', 'Prepare order', 'Enviar', 'Re-check', 'AS-IS', 'Save']);
});

it('keeps at most 8 elements and 30 rows', () => {
  const muchos = [
    ...Array.from({ length: 20 }, (_, i) => elemento(`Step ${i}`, `Task_${i}`)),
    ...Array.from({ length: 40 }, (_, i): Comando => ({ grupo: 'escenarios', nombre: `Step scenario ${i}`, elegir: nada })),
  ];
  const filas = filtrarComandos('step', muchos);
  expect(filas.filter((c) => c.grupo === 'elementos')).toHaveLength(8);
  expect(filas).toHaveLength(30);
});

it.each([false, true])('typing an id finds the element whether or not ids are shown (#447, mostrarIds=%s)', async (mostrarIds) => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no `showModal`/`close`.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  const contenedor = document.createElement('div');
  document.body.append(contenedor);
  const raiz = createRoot(contenedor);
  await act(async () => raiz.render(<PaletaComandos comandos={fuentes} mostrarIds={mostrarIds} onCerrar={nada} />));
  const campo = contenedor.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(campo, 'task_rev'); campo.dispatchEvent(new Event('input', { bubbles: true })); });
  const filas = [...contenedor.querySelectorAll('[role="option"]')];
  expect(filas.map((f) => f.querySelector('.nombre')?.textContent)).toEqual(['Revisión']);
  expect(filas[0]!.querySelector('.id.mono')?.textContent).toBe(mostrarIds ? 'Task_Rev' : undefined);
  await act(async () => raiz.unmount());
  contenedor.remove();
});
