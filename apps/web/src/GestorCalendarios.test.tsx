// @vitest-environment jsdom
/**
 * Lote M (C3): the calendar manager of the Calendars step. Pure helpers first (templates, hours
 * per week, «Used by», rename), then the component inside the real `ScenarioPanel`, so the live
 * lint (E-CAL-VACIO, E-REF-DESCONOCIDA) is the engine's and not a stub.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ProcessIR } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';

import { celdaVecina, celda, type Intervalo } from './CalendarEditor.js';
import { copiarLunes } from './GestorCalendarios.js';
import { ScenarioPanel } from './ScenarioPanel.js';
import { cambiosDeDelta, problemasEscenario, renombrarCalendario } from './escenarioModelo.js';
import { setLocale } from './i18n';
import {
  aplicarPlantilla,
  horasSemana,
  intervalosDePlantilla,
  nombreLibre,
  vaciarSemana,
} from './plantillasCalendario.js';
import { en } from './strings.en';
import { es } from './strings.es';
import { recursosAsignables, usadoPor } from './usadoPor.js';

setLocale('es');
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Json = Record<string, unknown>;

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');
const CASO = 'packages/engine/test/fixtures/service-request';
const ARCHIVO = 'as-is.scenario.json';
const LV: Intervalo = { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '09:00', to: '18:00' };
const MENSUAL: Intervalo = { monthDays: [-1], from: '10:00', to: '12:00' };

let ir: ProcessIR;
beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(RAIZ, `${CASO}/model.bpmn`), 'utf8'))).ir;
}, 120_000);

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

describe('templates', () => {
  it('every template but «Blank» is born with hours, and they are the hours they say', () => {
    expect(horasSemana(intervalosDePlantilla('laborable'))).toBe(45);
    expect(horasSemana(intervalosDePlantilla('continuo'))).toBe(168);
    expect(horasSemana(intervalosDePlantilla('extendido'))).toBe(96);
    expect(intervalosDePlantilla('enBlanco')).toEqual([]);
    expect(intervalosDePlantilla('continuo')[0]!.to).toBe('24:00');
  });

  it('a template is valid for the engine: no E-CAL-VACIO, no schema defect', () => {
    for (const plantilla of ['laborable', 'continuo', 'extendido'] as const) {
      const escenario = { version: 1, name: 'x', calendars: { c: { intervals: intervalosDePlantilla(plantilla) } } };
      expect(problemasEscenario(escenario, null, 'en')).toEqual([]);
    }
    const vacio = { version: 1, name: 'x', calendars: { c: { intervals: [] } } };
    expect(problemasEscenario(vacio, null, 'en').map((p) => p.ruta)).toEqual(['calendars.c.intervals']);
  });

  it('applying a template or clearing replaces the weekly hours and keeps the repetitions', () => {
    expect(aplicarPlantilla([LV, MENSUAL], 'continuo')).toEqual([...intervalosDePlantilla('continuo'), MENSUAL]);
    expect(vaciarSemana([LV, MENSUAL])).toEqual([MENSUAL]);
  });

  it('hours per week are a union at minute resolution and ignore monthly entries', () => {
    expect(horasSemana([LV, LV])).toBe(45);
    expect(horasSemana([{ days: ['MON'], from: '09:30', to: '10:00' }, MENSUAL])).toBe(0.5);
    expect(horasSemana([{ days: ['MON'], from: '08:00', to: '12:00' }, { days: ['MON'], from: '10:00', to: '14:00' }])).toBe(6);
  });

  it('the first free name gets a number', () => {
    expect(nombreLibre('L–V 9–18', [])).toBe('L–V 9–18');
    expect(nombreLibre('L–V 9–18', ['L–V 9–18', 'L–V 9–18 2'])).toBe('L–V 9–18 3');
  });

  it('«Copy Monday to Mon–Fri» copies Monday and leaves the weekend alone', () => {
    const resultado = copiarLunes([
      { days: ['MON'], from: '08:00', to: '12:00' },
      { days: ['TUE'], from: '14:00', to: '20:00' },
      { days: ['SAT'], from: '10:00', to: '11:00' },
    ]);
    expect(horasSemana(resultado)).toBe(21);
    expect(resultado).toContainEqual({ days: ['SAT'], from: '10:00', to: '11:00' });
    expect(resultado).toContainEqual({ days: ['TUE', 'WED', 'THU', 'FRI'], from: '08:00', to: '12:00' });
  });

  it('the grid arrows stop at the edges', () => {
    expect(celdaVecina(0, 0, 'ArrowLeft')).toBe(celda(0, 0));
    expect(celdaVecina(6, 23, 'ArrowDown')).toBe(celda(6, 23));
    expect(celdaVecina(2, 9, 'ArrowUp')).toBe(celda(1, 9));
    expect(celdaVecina(2, 9, 'End')).toBe(celda(2, 23));
    expect(celdaVecina(2, 9, 'a')).toBeNull();
  });
});

const RESUELTO: Json = {
  version: 1,
  name: 'AS-IS',
  calendars: { oficina: { intervals: [LV] }, noche: { intervals: [{ days: ['MON'], from: '22:00', to: '24:00' }] } },
  resources: {
    analyst: { name: 'Analyst', capacity: 1, calendar: 'oficina' },
    clerk: { name: 'Clerk', capacity: [{ calendar: 'oficina', capacity: 2 }, { calendar: 'noche', capacity: 1 }] },
    boss: { capacity: 1 },
  },
  elements: { Task_RegisterRequest: { calendar: 'oficina' } },
};

describe('usadoPor', () => {
  it('counts a pool calendar, each shift and an element calendar', () => {
    const usos = usadoPor(RESUELTO, 'oficina', null);
    expect(usos.map((u) => [u.tipo, u.id])).toEqual([
      ['recurso', 'analyst'],
      ['turno', 'clerk'],
      ['elemento', 'Task_RegisterRequest'],
    ]);
    expect(usos[1]!.capacidad).toBe(2);
    expect(usadoPor(RESUELTO, 'nadie')).toEqual([]);
  });

  it('with the IR an element reads as a task, with its BPMN name', () => {
    const [, , tarea] = usadoPor(RESUELTO, 'oficina', ir);
    expect(tarea!.tipo).toBe('tarea');
    expect(tarea!.nombre).toBe(ir.nodes['Task_RegisterRequest']!.name);
  });

  it('only pools without per-shift capacity can take a pool calendar (R16)', () => {
    expect(recursosAsignables(RESUELTO, 'noche')).toEqual([
      { id: 'analyst', nombre: 'Analyst', actual: 'oficina' },
      { id: 'boss', nombre: 'boss' },
    ]);
    expect(recursosAsignables(RESUELTO, 'oficina').map((a) => a.id)).toEqual(['boss']);
  });
});

describe('renombrarCalendario', () => {
  it('moves the entry and rewrites every reference, shifts included', () => {
    const despues = renombrarCalendario(RESUELTO, RESUELTO, null, 'oficina', 'tienda');
    expect(Object.keys(despues['calendars'] as Json)).toEqual(['tienda', 'noche']);
    expect(usadoPor(despues, 'oficina')).toEqual([]);
    expect(usadoPor(despues, 'tienda')).toHaveLength(3);
    expect(((despues['resources'] as Json)['clerk'] as Json)['capacity']).toEqual([
      { calendar: 'tienda', capacity: 2 },
      { calendar: 'noche', capacity: 1 },
    ]);
  });

  it('refuses an empty, equal or existing name', () => {
    expect(renombrarCalendario(RESUELTO, RESUELTO, null, 'oficina', '')).toBe(RESUELTO);
    expect(renombrarCalendario(RESUELTO, RESUELTO, null, 'oficina', 'oficina')).toBe(RESUELTO);
    expect(renombrarCalendario(RESUELTO, RESUELTO, null, 'oficina', 'noche')).toBe(RESUELTO);
  });

  it('an inherited calendar is moved whole and deleted from the parent with null (§ 6)', () => {
    const padre: Json = { version: 1, name: 'AS-IS', calendars: { oficina: { intervals: [LV] } }, resources: { a: { capacity: 1, calendar: 'oficina' } } };
    const delta: Json = { version: 1, name: 'TO-BE', extends: 'as-is.scenario.json' };
    const despues = renombrarCalendario(delta, padre, padre, 'oficina', 'tienda');
    expect(despues['calendars']).toEqual({ tienda: { intervals: [LV] }, oficina: null });
    expect(despues['resources']).toEqual({ a: { calendar: 'tienda' } });
    expect(cambiosDeDelta(delta, despues).map((c) => c.ruta)).toEqual([['calendars'], ['resources']]);
  });
});

/* ------------------------------------------------------------------ *
 * The manager inside the panel
 * ------------------------------------------------------------------ */

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;
let actual: Json = {};

afterEach(() => {
  if (raiz !== null) act(() => raiz!.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
  setLocale('es');
});

function escenarioBase(): Json {
  return {
    version: 1,
    name: 'AS-IS',
    model: 'model.bpmn',
    run: { start: '2026-09-07T08:00:00-06:00', duration: 86400 },
    calendars: { oficina: { intervals: [{ days: ['MON'], from: '08:00', to: '16:00' }] } },
    resources: {
      analyst: { name: 'Analyst', type: 'role', capacity: 1, calendar: 'oficina' },
      supervisor: { name: 'Supervisor', type: 'role', capacity: 2 },
    },
  };
}

let todos: Readonly<Record<string, Json>> = {};

function Anfitrion({ inicial, otros = {} }: { inicial: Json; otros?: Record<string, Json> }): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>({ [ARCHIVO]: inicial, ...otros });
  actual = escenarios[ARCHIVO] ?? {};
  todos = escenarios;
  return (
    <ScenarioPanel
      archivo={ARCHIVO}
      escenarios={escenarios}
      onCambio={(a, e) => {
        setEscenarios((previos) => ({ ...previos, [a]: e }));
      }}
      onGuardar={() => {}}
      onDuplicar={() => {}}
      ir={ir}
      seleccion={null}
      onSeleccionar={() => {}}
    />
  );
}

function montar(inicial: Json = escenarioBase(), otros: Record<string, Json> = {}): void {
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz!.render(<Anfitrion inicial={inicial} otros={otros} />);
  });
}

function renombrarA(nuevo: string): void {
  const nombre = document.querySelector<HTMLInputElement>('.gcal-cabecera input')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    nombre.focus();
    setter?.call(nombre, nuevo);
    nombre.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    nombre.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

/** A step tab of the Simulate panel, by `data-paso`: its text also carries number and ✓ / «! n» (C1). */
function botonPaso(paso: string): HTMLButtonElement {
  const encontrado = document.querySelector<HTMLButtonElement>(`.pasos button[data-paso="${paso}"]`);
  if (encontrado === null) throw new Error(`no step ${paso}`);
  return encontrado;
}

function boton(texto: string, dentro: ParentNode = document): HTMLButtonElement {
  const encontrado = [...dentro.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
  if (encontrado === undefined) throw new Error(`no hay botón «${texto}»`);
  return encontrado;
}

function pulsar(el: HTMLElement): void {
  act(() => {
    el.click();
  });
}

function pestana(id: string): HTMLButtonElement {
  return document.getElementById(`gcal-tab-${id}`) as HTMLButtonElement;
}

function calendarios(): Json {
  return actual['calendars'] as Json;
}

function erroresDe(ruta: string): string[] {
  return problemasEscenario(actual, ir, 'es')
    .filter((p) => p.ruta.startsWith(ruta))
    .map((p) => p.mensaje);
}

it('acceptance: a 2nd calendar from a template, assigned from «Used by» in 4 clicks, without E-CAL-VACIO', () => {
  montar();
  pulsar(botonPaso('calendars'));
  let clics = 0;
  const clic = (el: HTMLElement): void => {
    clics += 1;
    pulsar(el);
  };

  clic(boton(es.gcal.plantillas.extendido, document.querySelector('.gcal-plantillas')!));
  expect(Object.keys(calendarios())).toEqual(['oficina', 'L–S 6–22']);
  expect(calendarios()['L–S 6–22']).toEqual({ intervals: intervalosDePlantilla('extendido') });
  expect(erroresDe('calendars')).toEqual([]);
  // The new calendar is the one in the editor, and its name field has the focus.
  expect(document.querySelector('.gcal-editor')?.getAttribute('data-clave')).toBe('L–S 6–22');
  expect(document.querySelector('.gcal-editor')!.contains(document.activeElement)).toBe(true);
  expect(document.body.textContent).not.toContain(es.gcal.sinHoras);

  clic(pestana('uso'));
  expect(document.body.textContent).toContain(es.gcal.nadieLoUsa);
  const select = document.querySelector<HTMLSelectElement>('.gcal-asignar select')!;
  // Both pools are offered; the one that already has a calendar says which.
  expect([...select.options].map((o) => o.textContent)).toEqual([es.gcal.ahoraUsa('Analyst', 'oficina'), 'Supervisor']);
  // A native select is open + option: two clicks in the count of the baseline.
  clics += 2;
  act(() => {
    select.value = 'supervisor';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  clic(boton(es.gcal.asignar));

  expect(clics).toBe(5);
  expect((actual['resources'] as Json)['supervisor']).toMatchObject({ calendar: 'L–S 6–22' });
  expect(document.querySelector('[role="status"]')?.textContent).toBe(es.gcal.asignado('Supervisor'));
  expect(document.querySelector('.gcal-usos')?.textContent).toContain('Supervisor');
  expect(problemasEscenario(actual, ir, 'es').filter((p) => p.severidad === 'error')).toEqual([]);
});

it('«Blank» is born empty and says so; the row is marked and the lint is E-CAL-VACIO', () => {
  montar();
  pulsar(botonPaso('calendars'));
  pulsar(boton(es.escenario.crearCalendario));
  expect(calendarios()[es.gcal.nombreEnBlanco]).toEqual({ intervals: [] });
  expect(document.querySelector('[role="alert"].gcal-sin-horas')?.textContent).toBe(es.gcal.sinHoras);
  expect(document.querySelector(`.gcal-fila[data-clave="${es.gcal.nombreEnBlanco}"]`)?.classList.contains('con-error')).toBe(true);
  expect(erroresDe(`calendars.${es.gcal.nombreEnBlanco}`)).toHaveLength(1);
  // Painting one template from the Week tab fixes it.
  pulsar(boton(es.gcal.plantillas.continuo, document.querySelector('.gcal-acciones')!));
  expect(erroresDe('calendars')).toEqual([]);
});

it('empty state: no calendars, the 24 h note and the templates', () => {
  const sin = escenarioBase();
  delete sin['calendars'];
  (sin['resources'] as Json)['analyst'] = { name: 'Analyst', type: 'role', capacity: 1 };
  montar(sin);
  pulsar(botonPaso('calendars'));
  expect(document.querySelector('.gcal-vacio')?.textContent).toContain(es.gcal.vacioTexto);
  expect(document.querySelector('.gcal-editor')).toBeNull();
  pulsar(boton(es.gcal.plantillas.laborable));
  expect(Object.keys(calendarios())).toEqual(['L–V 9–18']);
  expect(document.querySelector('.gcal-vacio')).toBeNull();
});

it('one editor at a time: a row opens its calendar', () => {
  const dos = escenarioBase();
  (dos['calendars'] as Json)['noche'] = { intervals: [{ days: ['SAT'], from: '22:00', to: '24:00' }] };
  montar(dos);
  pulsar(botonPaso('calendars'));
  expect(document.querySelectorAll('.gcal-editor')).toHaveLength(1);
  expect(document.querySelector('.gcal-editor')?.getAttribute('data-clave')).toBe('oficina');
  pulsar(document.querySelector<HTMLButtonElement>('.gcal-fila[data-clave="noche"]')!);
  expect(document.querySelector('.gcal-editor')?.getAttribute('data-clave')).toBe('noche');
  expect(document.querySelector('.gcal-fila[data-clave="noche"]')?.getAttribute('aria-current')).toBe('true');
  expect(document.querySelector('.gcal-fila[data-clave="noche"]')?.textContent).toContain(es.gcal.sinUso);
});

it('renaming rewrites the references and keeps the editor on the calendar', () => {
  montar();
  pulsar(botonPaso('calendars'));
  const nombre = document.querySelector<HTMLInputElement>('.gcal-cabecera input')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(nombre, 'tienda');
    nombre.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    nombre.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(Object.keys(calendarios())).toEqual(['tienda']);
  expect((actual['resources'] as Json)['analyst']).toMatchObject({ calendar: 'tienda' });
  expect(document.querySelector('.gcal-editor')?.getAttribute('data-clave')).toBe('tienda');
  expect(problemasEscenario(actual, ir, 'es').filter((p) => p.severidad === 'error')).toEqual([]);
});

it('a calendar in use cannot be deleted; an unused one can', () => {
  montar();
  pulsar(botonPaso('calendars'));
  expect(boton(es.gcal.eliminar).disabled).toBe(true);
  pulsar(boton(es.gcal.plantillas.continuo, document.querySelector('.gcal-plantillas')!));
  expect(boton(es.gcal.eliminar).disabled).toBe(false);
  pulsar(boton(es.gcal.eliminar));
  expect(Object.keys(calendarios())).toEqual(['oficina']);
});

it('the tabs are a tablist with arrow keys, and Holidays and Repetitions write the calendar', () => {
  montar();
  pulsar(botonPaso('calendars'));
  expect(document.querySelector('.gcal-pestanas[role="tablist"]')?.querySelectorAll('[role="tab"]')).toHaveLength(4);
  expect(pestana('semana').getAttribute('aria-selected')).toBe('true');
  act(() => {
    pestana('semana').focus();
    pestana('semana').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  });
  expect(pestana('festivos').getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(pestana('festivos'));
  expect(document.querySelector('[role="tabpanel"]:not(#sim-cuerpo)')?.getAttribute('aria-labelledby')).toBe('gcal-tab-festivos');
  expect(document.querySelector('.festivos')).not.toBeNull();

  pulsar(pestana('repeticiones'));
  // No weekly picker here: the repetition select offers only the dated kinds, last day included.
  const tipo = document.querySelector<HTMLSelectElement>('.franjas-repeticion select')!;
  expect([...tipo.options].map((o) => o.value)).toEqual(['diaDelMes', 'diaSemanaDelMes', 'anual']);
  const dia = document.querySelectorAll<HTMLSelectElement>('.franjas-repeticion select')[1]!;
  act(() => {
    dia.value = '-1';
    dia.dispatchEvent(new Event('change', { bubbles: true }));
  });
  pulsar(boton(es.calendario.anadir));
  expect((calendarios()['oficina'] as Json)['intervals']).toEqual([
    { days: ['MON'], from: '08:00', to: '16:00' },
    { monthDays: [-1], from: '09:00', to: '18:00' },
  ]);
  // The weekly list does not show the monthly entry, the repetitions list does.
  expect(document.querySelector('.franjas-lista')?.textContent).toContain(es.calendario.cadaMesDias(es.calendario.desdeElFinal(1, es.calendario.diaCosa)).slice(1));
  pulsar(pestana('semana'));
  expect(document.querySelector('.franjas-lista')?.textContent).not.toContain(es.calendario.cadaMesDias(es.calendario.desdeElFinal(1, es.calendario.diaCosa)).slice(1));
});

it('grid keyboard: one tab stop, arrows move, Space toggles, Shift+arrow paints one entry', () => {
  setLocale('en');
  montar();
  pulsar(botonPaso('calendars'));
  const celdas = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.calendario .hora')];
  expect(celdas().filter((c) => c.tabIndex === 0)).toHaveLength(1);
  // Translated accessible names: «Monday 08:00», never the format's «MON 08:00».
  const primera = celdas().find((c) => c.tabIndex === 0)!;
  expect(primera.getAttribute('aria-label')).toBe(en.calendario.celda(en.calendario.diasLargos.MON, '08:00'));
  const tecla = (key: string, shiftKey = false): void => {
    act(() => {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
    });
  };
  act(() => {
    primera.focus();
  });
  for (let i = 0; i < 5; i++) tecla('ArrowDown');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Saturday 08:00');
  tecla(' ');
  tecla('ArrowRight', true);
  tecla('ArrowRight', true);
  expect((calendarios()['oficina'] as Json)['intervals']).toEqual([
    { days: ['MON'], from: '08:00', to: '16:00' },
    { days: ['SAT'], from: '08:00', to: '11:00' },
  ]);
  expect(celdas().filter((c) => c.tabIndex === 0).map((c) => c.getAttribute('aria-label'))).toEqual(['Saturday 10:00']);
});

it('«Used by» jumps to that resource in Resources and lists shifts; pools with shifts are not offered', async () => {
  const turnos = escenarioBase();
  (turnos['resources'] as Json)['supervisor'] = { name: 'Supervisor', type: 'role', capacity: [{ calendar: 'oficina', capacity: 2 }] };
  montar(turnos);
  pulsar(botonPaso('calendars'));
  pulsar(pestana('uso'));
  const filas = [...document.querySelectorAll('.gcal-usos li')].map((li) => li.textContent);
  expect(filas).toEqual([
    `${es.gcal.tiposUso.recurso}Analyst→`,
    `${es.gcal.tiposUso.turno}Supervisor${es.gcal.turnoCapacidad(2)}→`,
  ]);
  expect(document.body.textContent).toContain(es.gcal.todosAsignados);
  pulsar(document.querySelector<HTMLButtonElement>(`[aria-label="${es.gcal.irA('Analyst')}"]`)!);
  expect(botonPaso('resources').getAttribute('aria-selected')).toBe('true');
  // Minor of the QA: it lands on THAT pool, not just on the step.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 80));
  });
  expect(document.querySelector('[data-clave="analyst"]')!.contains(document.activeElement)).toBe(true);
});

it('QA of #599: renaming in a parent rewrites the children that override or name it, in the same gesture', () => {
  const override = { intervals: [{ days: ['SAT'], from: '07:00', to: '20:00' }] };
  montar(escenarioBase(), {
    'tobe.scenario.json': { version: 1, name: 'TO-BE', extends: ARCHIVO, calendars: { oficina: override } },
    'otro.scenario.json': { version: 1, name: 'Otro', extends: ARCHIVO, resources: { nuevo: { capacity: 1, calendar: 'oficina' } } },
    'suelto.scenario.json': { version: 1, name: 'Suelto', calendars: { oficina: override } },
  });
  pulsar(botonPaso('calendars'));
  renombrarA('tienda');
  expect(Object.keys(calendarios())).toEqual(['tienda']);
  expect(todos['tobe.scenario.json']!['calendars']).toEqual({ tienda: override });
  expect(todos['otro.scenario.json']!['resources']).toEqual({ nuevo: { capacity: 1, calendar: 'tienda' } });
  // A scenario that does not extend this one is left alone.
  expect(todos['suelto.scenario.json']!['calendars']).toEqual({ oficina: override });
  // Minor of the QA: the focus comes back to the name field of the renamed calendar.
  expect(document.activeElement).toBe(document.querySelector('.gcal-cabecera input'));
});

it('QA of #599: a name a child already declares is refused, and a calendar only a child uses cannot be deleted', () => {
  const sinUso = escenarioBase();
  (sinUso['calendars'] as Json)['noche'] = { intervals: [{ days: ['SAT'], from: '22:00', to: '24:00' }] };
  montar(sinUso, {
    'tobe.scenario.json': {
      version: 1,
      name: 'TO-BE',
      extends: ARCHIVO,
      calendars: { tienda: { intervals: [{ days: ['SUN'], from: '10:00', to: '12:00' }] } },
      resources: { nuevo: { capacity: 1, calendar: 'noche' } },
    },
  });
  pulsar(botonPaso('calendars'));
  renombrarA('tienda');
  expect(Object.keys(calendarios())).toEqual(['oficina', 'noche']);
  pulsar(document.querySelector<HTMLButtonElement>('.gcal-fila[data-clave="noche"]')!);
  expect(boton(es.gcal.eliminar).disabled).toBe(true);
  pulsar(pestana('uso'));
  expect(document.querySelector('.gcal-derivados')?.textContent).toBe(es.gcal.usadoEnDerivados('tobe.scenario.json'));
});

it('creating from a template does not scroll the panel', () => {
  montar();
  pulsar(botonPaso('calendars'));
  let desplazado = 0;
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = () => {
    desplazado += 1;
  };
  try {
    pulsar(boton(es.gcal.plantillas.continuo, document.querySelector('.gcal-plantillas')!));
  } finally {
    Element.prototype.scrollIntoView = original;
  }
  expect(desplazado).toBe(0);
});
