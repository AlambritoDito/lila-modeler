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

// ---------- #442: the palette is a proper modal ----------

/** Mounts the palette the way `App.tsx` does: on whatever has the focus at that moment. */
async function montar(): Promise<{ contenedor: HTMLDivElement; raiz: ReturnType<typeof createRoot>; campo: HTMLInputElement; cerrada: { n: number } }> {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const contenedor = document.createElement('div');
  document.body.append(contenedor);
  const raiz = createRoot(contenedor);
  const cerrada = { n: 0 };
  await act(async () => raiz.render(<PaletaComandos comandos={fuentes} onCerrar={() => { cerrada.n += 1; }} />));
  return { contenedor, raiz, campo: contenedor.querySelector<HTMLInputElement>('input[role="combobox"]')!, cerrada };
}
function pulsar(el: Element, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => { el.dispatchEvent(e); });
  return e;
}

it('with the palette open, ⌘O/⌘S/⇧⌘S/⌘P never reach the browser, from the field or from the body (#442)', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { contenedor, raiz, campo } = await montar();
  // The app's dispatcher stays quiet behind a dialog: without this, Chrome's «Save page as» and
  // file dialog answered (QA of #439).
  expect(pulsar(campo, { key: 's', metaKey: true }).defaultPrevented).toBe(true);
  expect(pulsar(campo, { key: 'o', ctrlKey: true }).defaultPrevented).toBe(true);
  expect(pulsar(document.body, { key: 'S', shiftKey: true, metaKey: true }).defaultPrevented).toBe(true);
  expect(pulsar(document.body, { key: 'p', metaKey: true }).defaultPrevented).toBe(true);
  // Typing is typing.
  expect(pulsar(campo, { key: 's' }).defaultPrevented).toBe(false);
  await act(async () => raiz.unmount());
  contenedor.remove();
  // Closed, the keys are the dispatcher's again.
  expect(pulsar(document.body, { key: 's', metaKey: true }).defaultPrevented).toBe(false);
});

it('Tab and ⇧Tab keep the focus in the palette\'s field, as in a modal (#442)', async () => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { contenedor, raiz, campo } = await montar();
  expect(document.activeElement).toBe(campo);
  expect(pulsar(campo, { key: 'Tab' }).defaultPrevented).toBe(true);
  expect(pulsar(campo, { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(campo);
  // Chrome makes the scrollable list focusable; from there Tab comes back to the field too.
  const lista = contenedor.querySelector<HTMLElement>('[role="listbox"]')!;
  lista.tabIndex = -1;
  lista.focus();
  expect(pulsar(lista, { key: 'Tab' }).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(campo);
  await act(async () => raiz.unmount());
  contenedor.remove();
});

it('Esc back to a text field puts the caret where it was, not at the start (#442)', async () => {
  // What Chrome does (measured by CDP, «Filter shapes»: 3 → 0): `close()` gives the focus back to
  // the element that had it before `showModal`, with the caret at the start, and the palette's own
  // `focus()` after it is then a no-op.
  let antes: HTMLElement | null = null;
  HTMLDialogElement.prototype.showModal = function () { antes = document.activeElement as HTMLElement; this.open = true; };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    antes?.focus();
    if (antes instanceof HTMLInputElement) antes.setSelectionRange(0, 0);
  };
  const filtro = document.createElement('input');
  document.body.append(filtro);
  filtro.value = 'abcdef';
  filtro.focus();
  filtro.setSelectionRange(3, 5, 'backward');
  const { contenedor, raiz, campo, cerrada } = await montar();
  expect(document.activeElement).toBe(campo);
  pulsar(campo, { key: 'Escape' });
  expect(cerrada.n).toBe(1);
  expect(document.activeElement).toBe(filtro);
  expect([filtro.selectionStart, filtro.selectionEnd, filtro.selectionDirection]).toEqual([3, 5, 'backward']);
  await act(async () => raiz.unmount());
  contenedor.remove();
  filtro.remove();
});
