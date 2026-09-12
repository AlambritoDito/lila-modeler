// @vitest-environment jsdom
/**
 * #333 — the Simulate panel as Bizagi's four levels: one step at a time.
 *
 * What this suite pins is the promise of `docs/COMING-FROM-BIZAGI.md`: each step shows its own
 * parameters and only those, the step you are on survives picking elements on the canvas, and
 * the advanced JSON and the validation list are there in every step — so a step is a filter over
 * one scenario document, never a wizard that locks anything.
 *
 * The host and the gestures are the ones of `ScenarioPanel.diagrama.test.tsx`: the selection
 * comes from buttons because in the app it comes from the canvas.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ProcessIR } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';

import { ScenarioPanel } from './ScenarioPanel.js';
import { setLocale } from './i18n';
import { en } from './strings.en';

// English is the base language of the app; the step labels this suite clicks are the English ones.
setLocale('en');

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');
const CASO = 'examples/tarjeta-credito';

type Json = Record<string, unknown>;

let ir: ProcessIR;

beforeAll(async () => {
  const parsed = await parseBpmn(readFileSync(resolve(RAIZ, `${CASO}/model.bpmn`), 'utf8'));
  ir = parsed.ir;
}, 120_000);

/* ------------------------------------------------------------------ *
 * Montaje y gestos
 * ------------------------------------------------------------------ */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;

function montar(nodo: React.JSX.Element): void {
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz!.render(nodo);
  });
}

afterEach(() => {
  if (raiz !== null) act(() => raiz!.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

function boton(texto: string): HTMLButtonElement {
  const encontrado = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (encontrado === undefined) throw new Error(`no hay botón «${texto}»`);
  return encontrado;
}

function pulsar(texto: string): void {
  act(() => {
    boton(texto).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function irAPaso(paso: 'validation' | 'times' | 'resources' | 'calendars'): void {
  pulsar(en.escenario.paso[paso]!);
}

function hay(id: string): boolean {
  return document.getElementById(id) !== null;
}

/** Texto del panel entero: lo que se ve, con las secciones de otros pasos ya fuera del DOM. */
function texto(): string {
  return document.querySelector('.escenario')?.textContent ?? '';
}

/* ------------------------------------------------------------------ *
 * Anfitrión: el panel más los botones que hacen de lienzo
 * ------------------------------------------------------------------ */

const ARCHIVO = 'as-is.scenario.json';
const SELECCIONAR = 'sel:';

function Anfitrion({ inicial }: { inicial: Json }): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>({
    [ARCHIVO]: inicial,
  });
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const ids = [...Object.keys(ir.nodes), ...Object.keys(ir.flows)];
  return (
    <>
      {ids.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            setSeleccion(id);
          }}
        >
          {SELECCIONAR}
          {id}
        </button>
      ))}
      <ScenarioPanel
        archivo={ARCHIVO}
        escenarios={escenarios}
        onCambio={(a, e) => {
          setEscenarios((previos) => ({ ...previos, [a]: e }));
        }}
        onGuardar={() => {}}
        onDuplicar={() => {}}
        ir={ir}
        seleccion={seleccion}
        onSeleccionar={setSeleccion}
      />
    </>
  );
}

function seleccionar(id: string): void {
  pulsar(`${SELECCIONAR}${id}`);
}

/** El AS-IS del caso de la tarjeta, que trae calendario, pools y carriles: el panel completo. */
function asIs(): Json {
  return JSON.parse(readFileSync(resolve(RAIZ, `${CASO}/as-is.scenario.json`), 'utf8')) as Json;
}

/* ------------------------------------------------------------------ *
 * 1 — Un paso enseña lo suyo y esconde lo de los demás
 * ------------------------------------------------------------------ */

describe('los cuatro pasos del panel de simulación', () => {
  it('abre en el paso 1: la corrida y la validación, sin calendarios ni pools', () => {
    montar(<Anfitrion inicial={asIs()} />);

    expect(boton(en.escenario.paso['validation']!).getAttribute('aria-pressed')).toBe('true');
    expect(boton(en.escenario.paso['validation']!).getAttribute('aria-current')).toBe('step');
    expect(boton(en.escenario.paso['calendars']!).getAttribute('aria-pressed')).toBe('false');

    // La corrida entera es del paso 1 (R8 incluido), y la lista de validación vive con ella.
    expect(hay('campo-run.duration')).toBe(true);
    expect(hay('campo-run.replications')).toBe(true);
    expect(hay('campo-run.start')).toBe(true);
    expect(texto()).toContain(en.escenario.seccionValidacion(0).split(' (')[0]!);

    // Y nada de los pasos 3 y 4: no plegado, fuera del DOM.
    expect(texto()).not.toContain(en.escenario.seccionCalendarios);
    expect(texto()).not.toContain(en.escenario.seccionRecursos);
    expect(hay('campo-resources.executive.capacity')).toBe(false);
    expect(hay('campo-calendars.tienda.intervals[0].from')).toBe(false);
  });

  it('el paso 3 trae los pools y la acción de carril, y ya no la corrida', () => {
    montar(<Anfitrion inicial={asIs()} />);
    irAPaso('resources');

    expect(texto()).toContain(en.escenario.seccionRecursos);
    expect(hay('campo-resources.executive.capacity')).toBe(true);
    // La acción «asignar carril a pool» (#334) es del paso 3, con los pools.
    expect(document.querySelector('.carril-a-pool')).not.toBeNull();
    expect(boton(en.escenario.carrilAsignar)).toBeInstanceOf(HTMLButtonElement);

    expect(texto()).not.toContain(en.escenario.seccionCorrida);
    expect(hay('campo-run.duration')).toBe(false);
  });

  it('el paso 4 trae la rejilla de calendarios', () => {
    montar(<Anfitrion inicial={asIs()} />);
    irAPaso('calendars');

    expect(texto()).toContain(en.escenario.seccionCalendarios);
    expect(document.querySelector('.calendario')).not.toBeNull();
    expect(hay('campo-run.duration')).toBe(false);
  });

  it('una tarea en el paso 2 enseña su tiempo y no sus recursos', () => {
    montar(<Anfitrion inicial={asIs()} />);
    irAPaso('times');
    seleccionar('Task_FillApplication');

    expect(hay('campo-elements.Task_FillApplication.processingTime')).toBe(true);
    expect(hay('campo-elements.Task_FillApplication.resources[0].ref')).toBe(false);
    expect(hay('campo-elements.Task_FillApplication.calendar')).toBe(false);

    // Y en el paso 3, al revés: los mismos datos, la otra mitad de la ficha.
    irAPaso('resources');
    expect(hay('campo-elements.Task_FillApplication.resources[0].ref')).toBe(true);
    expect(hay('campo-elements.Task_FillApplication.processingTime')).toBe(false);
  });

  it('las probabilidades de una compuerta son del paso 1', () => {
    montar(<Anfitrion inicial={asIs()} />);
    seleccionar('Gateway_Bureau');
    expect(texto()).toContain(en.escenario.seccionCompuerta);
    expect(hay('campo-elements.Flow_BureauGood.probability')).toBe(true);

    irAPaso('times');
    expect(texto()).not.toContain(en.escenario.seccionCompuerta);
  });
});

/* ------------------------------------------------------------------ *
 * 2 — El paso no se pierde por el camino
 * ------------------------------------------------------------------ */

describe('el paso elegido sobrevive', () => {
  it('seleccionar un elemento tras otro no devuelve el panel al paso 1', () => {
    montar(<Anfitrion inicial={asIs()} />);
    irAPaso('times');

    for (const id of ['Task_FillApplication', 'Task_PrintCard', 'StartEvent_Application']) {
      seleccionar(id);
      expect(boton(en.escenario.paso['times']!).getAttribute('aria-pressed')).toBe('true');
    }
    // El campo que se ve sigue siendo el del paso 2, no el del elemento entero.
    expect(hay('campo-elements.StartEvent_Application.interTriggerTimer')).toBe(true);
    expect(hay('campo-elements.StartEvent_Application.triggerCount')).toBe(false);
  });

  it('el JSON avanzado está en los cuatro pasos', () => {
    montar(<Anfitrion inicial={asIs()} />);
    for (const paso of ['validation', 'times', 'resources', 'calendars'] as const) {
      irAPaso(paso);
      expect(texto()).toContain(en.escenario.seccionJson);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3 — La lista de elementos del paso: qué falta por rellenar
 * ------------------------------------------------------------------ */

describe('la lista de elementos del paso', () => {
  it('el paso 2 resume el tiempo de cada elemento, y «—» el que no tiene', () => {
    // El AS-IS sin el tiempo de una tarea: es exactamente lo que la lista tiene que delatar.
    const escenario = asIs();
    const elementos = { ...(escenario['elements'] as Json) };
    const sinTiempo = { ...(elementos['Task_PrintCard'] as Json) };
    delete sinTiempo['processingTime'];
    elementos['Task_PrintCard'] = sinTiempo;
    montar(<Anfitrion inicial={{ ...escenario, elements: elementos }} />);
    irAPaso('times');

    const filas = [...document.querySelectorAll('.lista-paso li')].map(
      (li) => li.textContent?.trim() ?? '',
    );
    expect(filas.some((f) => f.startsWith('Task_PrintCard'))).toBe(true);
    expect(filas.find((f) => f.startsWith('Task_PrintCard'))).toContain(en.escenario.sinResumen);
    // La que sí lo tiene lo enseña con el nombre de su distribución.
    expect(filas.find((f) => f.startsWith('Task_FillApplication'))).toContain(
      en.escenario.distribuciones['constant'],
    );
  });

  it('una fila de la lista selecciona el elemento en el lienzo', () => {
    montar(<Anfitrion inicial={asIs()} />);
    irAPaso('resources');
    const fila = [...document.querySelectorAll('.lista-paso li button')].find(
      (b) => b.textContent?.trim() === 'Task_PrintCard',
    ) as HTMLButtonElement;
    expect(fila).toBeInstanceOf(HTMLButtonElement);
    act(() => {
      fila.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(hay('campo-elements.Task_PrintCard.resources[0].ref')).toBe(true);
  });
});
