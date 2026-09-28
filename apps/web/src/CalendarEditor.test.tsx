// @vitest-environment jsdom
/**
 * #448 — the range picker above the weekly grid: day presets, per-day checkboxes, from/to and
 * «Add range», plus the list of the current intervals. Section 8 of `ScenarioPanel.test.tsx`
 * keeps covering the grid itself and its conversions.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import {
  CalendarEditor,
  DIAS,
  Festivos,
  franjaNueva,
  franjaRepetida,
  resumenDias,
  resumenSelector,
  type Intervalo,
} from './CalendarEditor';
import { setLocale } from './i18n';
import { en as T } from './strings.en';
import { es } from './strings.es';

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

/* ------------------------------------------------------------------ *
 * #82: monthly/yearly repetition and holidays
 * ------------------------------------------------------------------ */

/** Picks `valor` in the `<select>` whose label starts with `rotulo`. */
function elegir(rotulo: string, valor: string): void {
  const select = [...document.querySelectorAll('.franjas-repeticion label')]
    .find((l) => l.textContent!.startsWith(rotulo))!
    .querySelector('select')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(select, valor);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('adds a monthly range on the last day of the month', () => {
  const onCambio = montar([{ days: ['MON'], from: '09:00', to: '18:00' }]);
  elegir(T.calendario.repeticion, 'diaDelMes');
  // The weekly day pickers only belong to the weekly repetition.
  expect(document.querySelector('.franjas-dias')).toBeNull();
  elegir(T.calendario.diaDelMes, '-1');
  pulsar(T.calendario.anadir);
  expect(onCambio).toHaveBeenLastCalledWith([
    { days: ['MON'], from: '09:00', to: '18:00' },
    { monthDays: [-1], from: '09:00', to: '18:00' },
  ]);
});

it('adds a monthly range on the last Friday', () => {
  const onCambio = montar([]);
  elegir(T.calendario.repeticion, 'diaSemanaDelMes');
  elegir(T.calendario.semanaDelMes, '-1');
  elegir(T.calendario.diaSemana, 'FRI');
  escribir(T.calendario.desde, '14:00');
  pulsar(T.calendario.anadir);
  expect(onCambio).toHaveBeenLastCalledWith([{ monthWeekdays: [{ nth: -1, day: 'FRI' }], from: '14:00', to: '18:00' }]);
});

it('adds a yearly date; February 30 does not exist and keeps the button disabled', () => {
  const onCambio = montar([]);
  elegir(T.calendario.repeticion, 'anual');
  elegir(T.calendario.mes, '2');
  elegir(T.calendario.dia, '30');
  expect(boton(T.calendario.anadir).disabled).toBe(true);
  elegir(T.calendario.dia, '29');
  pulsar(T.calendario.anadir);
  expect(onCambio).toHaveBeenLastCalledWith([{ dates: ['02-29'], from: '09:00', to: '18:00' }]);
});

it('does not add the same monthly range twice', () => {
  const ya: Intervalo = { monthDays: [1], from: '09:00', to: '18:00' };
  expect(franjaRepetida({ tipo: 'diaDelMes', dia: 1 }, '09:00', '18:00', [ya])).toBeNull();
  expect(franjaRepetida({ tipo: 'diaDelMes', dia: 2 }, '09:00', '18:00', [ya])).toEqual({
    monthDays: [2],
    from: '09:00',
    to: '18:00',
  });
  // A weekly range with the same hours is a different entry.
  expect(franjaRepetida({ tipo: 'semanal', dias: new Set(['MON'] as const) }, '09:00', '18:00', [ya])).not.toBeNull();
});

it('describes monthly and yearly ranges in the list', () => {
  const C = T.calendario;
  expect(resumenSelector({ monthDays: [1, -1], from: '09:00', to: '12:00' }, C)).toBe('Day 1, last day of each month');
  expect(resumenSelector({ monthDays: [-1], from: '09:00', to: '12:00' }, C)).toBe('Last day of each month');
  expect(resumenSelector({ monthWeekdays: [{ nth: -2, day: 'FRI' }], from: '09:00', to: '12:00' }, C)).toBe(
    'Second-to-last Fri of each month',
  );
  const E = es.calendario;
  expect(resumenSelector({ monthDays: [-1], from: '09:00', to: '12:00' }, E)).toBe('Último día de cada mes');
  expect(resumenSelector({ monthWeekdays: [{ nth: -2, day: 'FRI' }], from: '09:00', to: '12:00' }, E)).toBe(
    'Penúltimo Vie de cada mes',
  );
  expect(resumenSelector({ monthWeekdays: [{ nth: 2, day: 'SAT' }], from: '09:00', to: '12:00' }, E)).toBe(
    '2.º Sáb de cada mes',
  );
  expect(resumenSelector({ monthWeekdays: [{ nth: -1, day: 'FRI' }], from: '09:00', to: '12:00' }, C)).toBe(
    'Last Fri of each month',
  );
  expect(resumenSelector({ dates: ['12-24'], from: '09:00', to: '12:00' }, C)).toBe('Every year on Dec 24');
  montar([{ monthWeekdays: [{ nth: 2, day: 'SAT' }], from: '10:00', to: '14:00' }]);
  expect(document.querySelector('.franjas-lista')!.textContent).toContain(
    C.franja('2nd Sat of each month', '10:00', '14:00'),
  );
});

it('painting the grid keeps monthly and yearly ranges as written', () => {
  const mensual: Intervalo = { monthDays: [15], from: '09:00', to: '12:00' };
  const onCambio = montar([mensual]);
  const celda = document.querySelector<HTMLButtonElement>(`[aria-label="${T.calendario.celda('MON', '09:00')}"]`)!;
  act(() => celda.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(onCambio).toHaveBeenLastCalledWith([mensual, { days: ['MON'], from: '09:00', to: '10:00' }]);
});

function montarFestivos(holidays: string[]) {
  const onCambio = vi.fn<(nuevos: string[]) => void>();
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz!.render(<Festivos holidays={holidays} onCambio={onCambio} />));
  return onCambio;
}

function fecha(valor: string): void {
  const campo = document.querySelector<HTMLInputElement>('.festivos input[type="date"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(campo, valor);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

it('adds a one-off holiday and an annual one', () => {
  const onCambio = montarFestivos(['2026-01-01']);
  expect(boton(T.calendario.anadirFestivo).disabled).toBe(true);
  fecha('2026-12-25');
  pulsar(T.calendario.anadirFestivo);
  expect(onCambio).toHaveBeenLastCalledWith(['2026-01-01', '2026-12-25']);

  const casilla = [...document.querySelectorAll('.festivos label')]
    .find((l) => l.textContent === T.calendario.festivoCadaAno)!
    .querySelector('input')!;
  act(() => casilla.click());
  pulsar(T.calendario.anadirFestivo);
  expect(onCambio).toHaveBeenLastCalledWith(['2026-01-01', '12-25']);
});

it('does not add a holiday twice, and removes one from the list', () => {
  const onCambio = montarFestivos(['2026-12-25', '01-01']);
  fecha('2026-12-25');
  expect(boton(T.calendario.anadirFestivo).disabled).toBe(true);
  expect(document.querySelector('.festivos .franjas-lista')!.textContent).toContain(T.calendario.festivoAnual('01-01'));
  const quitar = [...document.querySelectorAll<HTMLButtonElement>('.festivos li button')].find(
    (b) => b.getAttribute('aria-label') === T.calendario.quitarFestivo('2026-12-25'),
  )!;
  act(() => quitar.click());
  expect(onCambio).toHaveBeenLastCalledWith(['01-01']);
});
