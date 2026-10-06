// @vitest-environment jsdom
/**
 * #579. Una usuaria beta no supo añadir un segundo calendario: el único control era una caja sin
 * rótulo y un «Añadir» al final del paso, debajo del editor entero de cada calendario. Ahora el
 * control para crear va arriba en Calendarios y en Recursos, con rótulo visible, y la entrada
 * nueva recibe el foco. Sin @testing-library (el repo no la trae): `porRotulo` hace lo que
 * `getByLabelText` —sigue el `<label for>`—, así que un `aria-label` invisible no lo satisface.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it } from 'vitest';

import type { ProcessIR } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';

import { ScenarioPanel } from './ScenarioPanel.js';
import { setLocale } from './i18n';
import { en } from './strings.en';
import { es } from './strings.es';

setLocale('es');

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');
const CASO = 'packages/engine/test/fixtures/service-request';
const ARCHIVO = 'as-is.scenario.json';

type Json = Record<string, unknown>;

let ir: ProcessIR;

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(RAIZ, `${CASO}/model.bpmn`), 'utf8'))).ir;
}, 120_000);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

function Anfitrion(): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>({
    [ARCHIVO]: {
      version: 1,
      name: 'AS-IS',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00' },
      calendars: {
        oficina: { intervals: [{ days: ['MON'], from: '08:00', to: '16:00' }] },
      },
      resources: { analyst: { name: 'Analyst', type: 'role', capacity: 1, calendar: 'oficina' } },
    },
  });
  actual = escenarios[ARCHIVO] ?? {};
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

function montar(): void {
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz!.render(<Anfitrion />);
  });
}

function pulsar(texto: string): void {
  const boton = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
  if (boton === undefined) throw new Error(`no hay botón «${texto}»`);
  act(() => {
    boton.click();
  });
}

/** El equivalente de `getByLabelText`: el control al que apunta un `<label>` visible. */
function porRotulo(texto: string): HTMLInputElement {
  const etiqueta = [...document.querySelectorAll('label')].find((l) => l.textContent?.trim() === texto);
  if (etiqueta === undefined) throw new Error(`no hay rótulo «${texto}»`);
  const control = document.getElementById(etiqueta.htmlFor);
  if (!(control instanceof HTMLInputElement)) throw new Error(`«${texto}» no rotula un input`);
  return control;
}

function teclear(campo: HTMLInputElement, texto: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** `a` va antes que `b` en el documento. */
function antes(a: Node, b: Node): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

it('en Calendarios el control para crear va arriba, con rótulo visible y ejemplo', () => {
  montar();
  pulsar('Calendarios');
  const caja = porRotulo(es.escenario.nuevoCalendario);
  expect(caja.placeholder).toBe('turno-noche');
  expect(caja.getAttribute('aria-label')).toBeNull();
  // Lote M (C3): the calendars are a compact list under the creation controls.
  const primero = document.querySelector('.gcal-fila[data-clave="oficina"]');
  expect(primero).not.toBeNull();
  expect(antes(caja, primero!)).toBe(true);
  const boton = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === es.escenario.crearCalendario,
  );
  expect(boton).toBeDefined();
  expect(antes(boton!, primero!)).toBe(true);
});

it('crear «turno-noche» lo añade, le da el foco y queda elegible en resources.<x>.calendar', () => {
  montar();
  pulsar('Calendarios');
  teclear(porRotulo(es.escenario.nuevoCalendario), 'turno-noche');
  pulsar(es.escenario.crearCalendario);

  expect(Object.keys(actual['calendars'] as Json)).toEqual(['oficina', 'turno-noche']);
  const nuevo = document.querySelector('.gcal-editor[data-clave="turno-noche"]');
  expect(nuevo).not.toBeNull();
  expect(nuevo!.contains(document.activeElement)).toBe(true);
  expect(porRotulo(es.escenario.nuevoCalendario).value).toBe('');

  pulsar('Recursos');
  const select = document.getElementById('campo-resources.analyst.calendar');
  expect(select).toBeInstanceOf(HTMLSelectElement);
  const opciones = [...(select as HTMLSelectElement).options].map((o) => o.value);
  expect(opciones).toContain('turno-noche');
});

it('en Recursos el control para crear va arriba y el recurso nuevo recibe el foco', () => {
  montar();
  pulsar('Recursos');
  const caja = porRotulo(es.escenario.nuevoRecurso);
  expect(caja.placeholder).toBe('analista');
  expect(antes(caja, document.querySelector('fieldset[data-clave="analyst"]')!)).toBe(true);
  teclear(caja, 'operador');
  pulsar(es.escenario.crearRecurso);
  expect(Object.keys(actual['resources'] as Json)).toEqual(['analyst', 'operador']);
  expect(document.querySelector('fieldset[data-clave="operador"]')!.contains(document.activeElement)).toBe(true);
});

it('Enter en la caja crea desde la primera plantilla, con horas (Lote M)', () => {
  montar();
  pulsar('Calendarios');
  const caja = porRotulo(es.escenario.nuevoCalendario);
  teclear(caja, 'sabado');
  act(() => {
    caja.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(Object.keys(actual['calendars'] as Json)).toEqual(['oficina', 'sabado']);
  expect((actual['calendars'] as Json)['sabado']).toEqual({
    intervals: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '09:00', to: '18:00' }],
  });
});

it('una clave repetida no se crea y se avisa', () => {
  montar();
  pulsar('Calendarios');
  teclear(porRotulo(es.escenario.nuevoCalendario), 'oficina');
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(es.escenario.claveRepetida('oficina'));
  pulsar(es.escenario.crearCalendario);
  expect(Object.keys(actual['calendars'] as Json)).toEqual(['oficina']);
});

it('en inglés: «New calendar» y «+ Blank»; la franja dice «Add range»', () => {
  setLocale('en');
  montar();
  pulsar('Calendars');
  expect(porRotulo(en.escenario.nuevoCalendario).placeholder).toBe('night-shift');
  expect(en.escenario.crearCalendario).toBe('+ Blank');
  expect(en.escenario.nuevoRecurso).toBe('New resource');
  expect(en.calendario.anadir).toBe('Add range');
  expect(es.calendario.anadir).toBe('Añadir franja');
});
