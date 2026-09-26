// @vitest-environment jsdom
/**
 * #448 — the range picker above the weekly grid: day presets, per-day checkboxes, from/to and
 * «Add range», plus the list of the current intervals. Section 8 of `ScenarioPanel.test.tsx`
 * keeps covering the grid itself and its conversions.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { CalendarEditor, DIAS, franjaNueva, resumenDias, type Intervalo } from './CalendarEditor';
import { setLocale } from './i18n';
import { en as T } from './strings.en';

setLocale('en');
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;
afterEach(() => {
  if (raiz !== null) act(() => raiz!.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

function montar(intervals: Intervalo[], rejilla = true) {
  const onCambio = vi.fn<(nuevos: Intervalo[]) => void>();
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz!.render(<CalendarEditor intervals={intervals} onCambio={onCambio} rejilla={rejilla} />));
  return onCambio;
}

function boton(texto: string): HTMLButtonElement {
  const encontrado = [...document.querySelectorAll('button')].find((b) => b.textContent === texto);
  if (encontrado === undefined) throw new Error(`no button «${texto}»`);
  return encontrado;
}

function pulsar(texto: string): void {
  act(() => boton(texto).click());
}

/** React listens to `input`; the native setter is what makes it see the new value. */
function escribir(rotulo: string, valor: string): void {
  const campo = [...document.querySelectorAll('.franjas-horas label')]
    .find((l) => l.textContent === rotulo)!
    .querySelector('input')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(campo, valor);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function marcar(dia: string): void {
  const casilla = [...document.querySelectorAll('.franjas-dias label')]
    .find((l) => l.textContent === dia)!
    .querySelector('input')!;
  act(() => casilla.click());
}

const LABORABLES = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

it('Mon–Fri 09:00–18:00 in one gesture writes one entry with five days', () => {
  const onCambio = montar([]);
  pulsar(T.calendario.presets.laborables);
  escribir(T.calendario.desde, '09:00');
  escribir(T.calendario.hasta, '18:00');
  pulsar(T.calendario.anadir);
  expect(onCambio).toHaveBeenCalledTimes(1);
  expect(onCambio).toHaveBeenLastCalledWith([{ days: LABORABLES, from: '09:00', to: '18:00' }]);
});

it('stacks a new range on the existing ones, with "24:00" allowed in «to»', () => {
  const sabado: Intervalo = { days: ['SAT'], from: '10:00', to: '14:00' };
  const onCambio = montar([sabado]);
  pulsar(T.calendario.presets.todos);
  escribir(T.calendario.desde, '00:00');
  escribir(T.calendario.hasta, '24:00');
  pulsar(T.calendario.anadir);
  expect(onCambio).toHaveBeenLastCalledWith([sabado, { days: [...DIAS], from: '00:00', to: '24:00' }]);
});

it('per-day checkboxes pick the days, in the canonical order', () => {
  const onCambio = montar([]);
  pulsar(T.calendario.presets.finDeSemana);
  marcar(T.calendario.dias.MON);
  pulsar(T.calendario.anadir);
  expect(onCambio).toHaveBeenLastCalledWith([{ days: ['MON', 'SAT', 'SUN'], from: '09:00', to: '18:00' }]);
});

it('disables «Add range» while the form is not a valid interval', () => {
  montar([]);
  escribir(T.calendario.desde, '24:00');
  escribir(T.calendario.hasta, '24:00');
  expect(boton(T.calendario.anadir).disabled).toBe(true);
  escribir(T.calendario.desde, '23:00');
  expect(boton(T.calendario.anadir).disabled).toBe(false);
  pulsar(T.calendario.presets.finDeSemana);
  marcar(T.calendario.dias.SAT);
  marcar(T.calendario.dias.SUN);
  expect(boton(T.calendario.anadir).disabled).toBe(true);

  const lunes = new Set(['MON'] as const);
  expect(franjaNueva(lunes, '24:00', '24:00')).toBeNull(); // "24:00" never opens a day
  expect(franjaNueva(lunes, '18:00', '09:00')).toBeNull(); // overnight: two intervals (R13)
  expect(franjaNueva(lunes, '09:00', '09:00')).toBeNull();
  expect(franjaNueva(lunes, '9:00', '18:00')).toBeNull(); // not fixed behind the user's back
  expect(franjaNueva(lunes, '09:00', '24:30')).toBeNull();
  expect(franjaNueva(new Set(), '09:00', '18:00')).toBeNull();
  // An identical range already present (days in any order) is not added twice.
  expect(franjaNueva(new Set(['MON', 'TUE'] as const), '09:00', '18:00', [{ days: ['TUE', 'MON'], from: '09:00', to: '18:00' }])).toBeNull();
});

it('keeps minute slots as typed; the grid goes away and the list stays', () => {
  const onCambio = montar([]);
  pulsar(T.calendario.presets.laborables);
  marcar(T.calendario.dias.TUE);
  marcar(T.calendario.dias.WED);
  marcar(T.calendario.dias.THU);
  marcar(T.calendario.dias.FRI);
  escribir(T.calendario.desde, '09:30');
  escribir(T.calendario.hasta, '13:45');
  pulsar(T.calendario.anadir);
  const nuevos = onCambio.mock.lastCall![0];
  expect(nuevos).toEqual([{ days: ['MON'], from: '09:30', to: '13:45' }]);

  act(() => raiz!.render(<CalendarEditor intervals={nuevos} onCambio={onCambio} />));
  expect(document.querySelector('.calendario')).toBeNull();
  expect(document.querySelector('.franjas')).not.toBeNull();
  expect(document.querySelector('.franjas-lista')!.textContent).toContain(
    T.calendario.franja(T.calendario.dias.MON, '09:30', '13:45'),
  );
});

it('removes one range from the list and leaves the others as written', () => {
  const primero: Intervalo = { days: ['MON', 'TUE'], from: '09:00', to: '13:00' };
  const segundo: Intervalo = { days: ['MON', 'TUE'], from: '14:00', to: '18:00' };
  const onCambio = montar([primero, segundo]);
  expect(document.querySelectorAll('.franjas-lista li')).toHaveLength(2);
  const quitar = document.querySelector<HTMLButtonElement>('.franjas-lista li button')!;
  expect(quitar.getAttribute('aria-label')).toBe(
    T.calendario.quitarFranja(T.calendario.franja('Mon, Tue', '09:00', '13:00')),
  );
  act(() => quitar.click());
  expect(onCambio).toHaveBeenLastCalledWith([segundo]);
});

it('«Edit as list» hides only the grid: the range picker stays', () => {
  montar([{ days: ['MON'], from: '09:00', to: '18:00' }], false);
  expect(document.querySelector('.calendario')).toBeNull();
  expect(document.querySelector('.franjas')).not.toBeNull();
  expect(document.querySelector('.franjas-lista li')).not.toBeNull();
});

it('shows runs of three or more days as a span in the list', () => {
  const dias = T.calendario.dias;
  expect(resumenDias(['MON', 'TUE', 'WED', 'THU', 'FRI'], dias)).toBe('Mon–Fri');
  expect(resumenDias(['SAT', 'MON', 'WED'], dias)).toBe('Mon, Wed, Sat');
  expect(resumenDias(['MON', 'TUE', 'WED', 'SAT', 'SUN'], dias)).toBe('Mon–Wed, Sat, Sun');
  expect(resumenDias(['MON', 'XYZ'], dias)).toBe('MON, XYZ');
});

it('puts the list below the grid, so painting never shifts the cells under the pointer', () => {
  montar([{ days: ['MON'], from: '09:00', to: '18:00' }]);
  const rejilla = document.querySelector('.calendario')!;
  const lista = document.querySelector('.franjas-lista')!;
  expect(document.querySelector('.franjas')!.compareDocumentPosition(rejilla)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(rejilla.compareDocumentPosition(lista)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});
