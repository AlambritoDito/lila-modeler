// @vitest-environment jsdom
/**
 * #333/#396, Lote M — the Simulate panel as six steps (Arrivals, Times, Routes, Resources,
 * Calendars, Run): one step at a time.
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

import type { ProcessIR } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';

import { PASO_IDS, type PasoId } from './ids';
import { ScenarioPanel } from './ScenarioPanel.js';
import { setLocale } from './i18n';
import { en } from './strings.en';

// English is the base language of the app; the step labels this suite clicks are the English ones.
setLocale('en');

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');
const CASO = 'packages/engine/test/fixtures/service-request';

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

/** An element row by its id (`data-id`, #447), else any button by its exact text. */
function boton(texto: string): HTMLButtonElement {
  const encontrado =
    document.querySelector<HTMLButtonElement>(`button[data-id="${texto}"]`) ??
    [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
  if (encontrado === undefined) throw new Error(`no hay botón «${texto}»`);
  return encontrado;
}

function pulsar(texto: string): void {
  act(() => {
    boton(texto).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** A step's button, by `data-paso`: its text also carries the step's «! n» (Lote M). */
function botonPaso(paso: PasoId): HTMLButtonElement {
  const encontrado = document.querySelector<HTMLButtonElement>(`nav.pasos button[data-paso="${paso}"]`);
  if (encontrado === null) throw new Error(`no step ${paso}`);
  return encontrado;
}

function irAPaso(paso: PasoId): void {
  act(() => {
    botonPaso(paso).click();
  });
}

function hay(id: string): boolean {
  return document.getElementById(id) !== null;
}

/**
 * The section titles drawn now. Since #396 a step is named like its main section («Resources»,
 * «Calendars»), so the panel's whole text always contains both through the step bar.
 */
function secciones(): string[] {
  return [...document.querySelectorAll('.escenario details > summary')].map((s) => s.textContent ?? '');
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

/** El AS-IS del fixture de solicitudes, que trae calendario, pools y carriles: el panel completo. */
function asIs(): Json {
  return JSON.parse(readFileSync(resolve(RAIZ, `${CASO}/as-is.scenario.json`), 'utf8')) as Json;
}

/* ------------------------------------------------------------------ *
 * 1 — Un paso enseña lo suyo y esconde lo de los demás
 * ------------------------------------------------------------------ */

describe('los seis pasos del panel de simulación', () => {
  it('abre en Tiempos: la lista de tiempos, sin corrida, calendarios ni pools', () => {
    montar(<Anfitrion inicial={asIs()} />);

    expect(botonPaso('times').getAttribute('aria-pressed')).toBe('true');
    expect(botonPaso('times').getAttribute('aria-current')).toBe('step');
    expect(botonPaso('calendars').getAttribute('aria-pressed')).toBe('false');
    expect(texto()).toContain(en.escenario.listaTiempos);

    // #360: this fully configured fixture has no actionable lint warnings.
    expect(texto()).not.toContain(en.escenario.seccionValidacion(0).split(' (')[0]!);

    // Ni la corrida ni Recursos ni Calendarios: no plegados, fuera del DOM.
    expect(hay('campo-run.duration')).toBe(false);
    expect(secciones()).not.toContain(en.escenario.seccionCalendarios);
    expect(secciones()).not.toContain(en.escenario.seccionRecursos);
    expect(hay('campo-resources.executive.capacity')).toBe(false);
    expect(hay('campo-calendars.tienda.intervals[0].from')).toBe(false);
  });

  it('Ejecución trae la corrida entera (R8 incluido), réplicas y semilla con ella', () => {
    montar(<Anfitrion inicial={asIs()} />);
    irAPaso('run');
    expect(hay('campo-run.duration')).toBe(true);
    expect(hay('campo-run.replications')).toBe(true);
    expect(hay('campo-run.start')).toBe(true);
    expect(secciones()).toContain(en.escenario.seccionCorrida);
    expect(texto()).not.toContain(en.escenario.listaTiempos);
  });

  it('the step bar reads Arrivals, Times, Routes, Resources, Calendars, Run, in that order (Lote M)', () => {
    montar(<Anfitrion inicial={asIs()} />);
    const rotulos = [...document.querySelectorAll('nav.pasos button')].map((b) => b.textContent);
    expect(rotulos).toEqual(['Arrivals', 'Times', 'Routes', 'Resources', 'Calendars', 'Run']);
  });

  it('a step with problems carries «! n» and the step without them does not (Lote M)', () => {
    // The AS-IS without the time of one task: Times is held back by one problem, and nothing else.
    const escenario = asIs();
    const elementos = { ...(escenario['elements'] as Json) };
    const sinTiempo = { ...(elementos['Task_PrepareService'] as Json) };
    delete sinTiempo['processingTime'];
    elementos['Task_PrepareService'] = sinTiempo;
    montar(<Anfitrion inicial={{ ...escenario, elements: elementos }} />);
    expect(botonPaso('times').textContent).toBe('Times ! 1');
    expect(botonPaso('times').querySelector('.paso-problemas')?.getAttribute('aria-label')).toBe(en.escenario.pasoProblemas(1));
    for (const paso of PASO_IDS.filter((p) => p !== 'times')) {
      expect(botonPaso(paso).querySelector('.paso-problemas'), paso).toBeNull();
    }
  });

  it('Recursos trae los pools y la acción de carril, y ya no la corrida', () => {
    montar(<Anfitrion inicial={asIs()} />);
    irAPaso('resources');

    expect(secciones()).toContain(en.escenario.seccionRecursos);
    expect(hay('campo-resources.executive.capacity')).toBe(true);
    // La acción «asignar carril a pool» (#334) va con los pools.
    expect(document.querySelector('.carril-a-pool')).not.toBeNull();
    expect(boton(en.escenario.carrilAsignar)).toBeInstanceOf(HTMLButtonElement);

    // «Run» is also the label of the sixth step, so the section is looked for among the summaries.
    expect(secciones()).not.toContain(en.escenario.seccionCorrida);
    expect(hay('campo-run.duration')).toBe(false);
  });

  it('Calendarios trae la rejilla y ya no repite los pools: dice dónde están (#396)', () => {
    montar(<Anfitrion inicial={asIs()} />);
    irAPaso('calendars');

    expect(secciones()).toContain(en.escenario.seccionCalendarios);
    expect(document.querySelector('.calendario')).not.toBeNull();
    expect(hay('campo-run.duration')).toBe(false);
    // Each control lives in exactly one step: the pool editor is in Resources only.
    expect(hay('campo-resources.executive.capacity')).toBe(false);
    expect(document.querySelector('.carril-a-pool')).toBeNull();
    // Lote M (C3): the «Used by» tab replaced the «Go to Resources» hint and jumps to the pool.
    act(() => {
      (document.getElementById('gcal-tab-uso') as HTMLButtonElement).click();
    });
    const salto = document.querySelector<HTMLButtonElement>('.gcal-usos button');
    expect(salto).not.toBeNull();
    act(() => {
      salto!.click();
    });
    expect(botonPaso('resources').getAttribute('aria-pressed')).toBe('true');
    expect(hay('campo-resources.executive.capacity')).toBe(true);
  });

  it('una tarea en Tiempos enseña su tiempo y no sus recursos', () => {
    montar(<Anfitrion inicial={asIs()} />);
    seleccionar('Task_RegisterRequest');

    expect(hay('campo-elements.Task_RegisterRequest.processingTime')).toBe(true);
    expect(hay('campo-elements.Task_RegisterRequest.resources[0].ref')).toBe(false);
    expect(hay('campo-elements.Task_RegisterRequest.calendar')).toBe(false);

    // Y en Recursos, al revés: los mismos datos, la otra mitad de la ficha.
    irAPaso('resources');
    expect(hay('campo-elements.Task_RegisterRequest.resources[0].ref')).toBe(true);
    expect(hay('campo-elements.Task_RegisterRequest.processingTime')).toBe(false);
  });

  it('un evento de inicio enseña sus dos llegadas en Llegadas y nada en Tiempos', () => {
    montar(<Anfitrion inicial={asIs()} />);
    seleccionar('StartEvent_Request');
    expect(hay('campo-elements.StartEvent_Request.interTriggerTimer')).toBe(false);

    irAPaso('arrivals');
    expect(hay('campo-elements.StartEvent_Request.interTriggerTimer')).toBe(true);
    expect(texto()).toContain(en.escenario.listaLlegadas);
  });

  it('las probabilidades de una compuerta son de Rutas', () => {
    montar(<Anfitrion inicial={asIs()} />);
    seleccionar('Gateway_Screening');
    expect(texto()).not.toContain(en.escenario.seccionCompuerta);
    irAPaso('routes');
    expect(texto()).toContain(en.escenario.seccionCompuerta);
    expect(texto()).toContain(en.escenario.listaRutas);
    expect(hay('campo-elements.Flow_ScreeningGood.probability')).toBe(true);

    irAPaso('resources');
    expect(texto()).not.toContain(en.escenario.seccionCompuerta);
  });
});

/* ------------------------------------------------------------------ *
 * 2 — El paso no se pierde por el camino
 * ------------------------------------------------------------------ */

describe('a step asked for from outside (#396 «Edit in …»)', () => {
  function Pedido({ montado }: { montado: boolean }): React.JSX.Element {
    const [pedido, setPedido] = useState<PasoId | null>(null);
    return (
      <>
        <button type="button" onClick={() => { setPedido('resources'); }}>ask:resources</button>
        {montado && (
          <ScenarioPanel
            archivo={ARCHIVO}
            escenarios={{ [ARCHIVO]: asIs() }}
            onCambio={() => {}}
            onGuardar={() => {}}
            onDuplicar={() => {}}
            ir={ir}
            seleccion={null}
            onSeleccionar={() => {}}
            pasoPedido={pedido}
            onPasoAtendido={() => { setPedido(null); }}
          />
        )}
      </>
    );
  }

  it('opens that step once, and twice in a row; a remount afterwards opens on Times again', () => {
    montar(<Pedido montado />);
    pulsar('ask:resources');
    expect(botonPaso('resources').getAttribute('aria-pressed')).toBe('true');
    irAPaso('arrivals');
    pulsar('ask:resources');
    expect(botonPaso('resources').getAttribute('aria-pressed')).toBe('true');

    // Detaching or switching tabs remounts the panel: the ask was consumed, it does not come back.
    // Same root, so the host keeps its state: only the panel unmounts and mounts again.
    act(() => { raiz!.render(<Pedido montado={false} />); });
    act(() => { raiz!.render(<Pedido montado />); });
    expect(botonPaso('times').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('el paso elegido sobrevive', () => {
  it('seleccionar un elemento tras otro no devuelve el panel al primer paso', () => {
    montar(<Anfitrion inicial={asIs()} />);
    irAPaso('arrivals');

    for (const id of ['Task_RegisterRequest', 'Task_PrepareService', 'StartEvent_Request']) {
      seleccionar(id);
      expect(botonPaso('arrivals').getAttribute('aria-pressed')).toBe('true');
    }
    // El campo que se ve sigue siendo el del paso, no el del elemento entero.
    expect(hay('campo-elements.StartEvent_Request.interTriggerTimer')).toBe(true);
    expect(hay('campo-elements.StartEvent_Request.calendar')).toBe(false);
  });

  it('an actionable lint warning shows the validation list in every step (#360)', () => {
    // The AS-IS without one task entry: the one R3 warning that still fires after #360.
    const escenario = asIs();
    const elementos = { ...(escenario['elements'] as Json) };
    delete elementos['Task_PrepareService'];
    montar(<Anfitrion inicial={{ ...escenario, elements: elementos }} />);
    for (const paso of PASO_IDS) {
      irAPaso(paso);
      expect(texto()).toContain(en.escenario.seccionValidacion(0));
    }
  });

  it('el JSON avanzado está en los seis pasos', () => {
    montar(<Anfitrion inicial={asIs()} />);
    for (const paso of PASO_IDS) {
      irAPaso(paso);
      expect(texto()).toContain(en.escenario.seccionJson);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3 — La lista de elementos del paso: qué falta por rellenar
 * ------------------------------------------------------------------ */

describe('la lista de elementos del paso', () => {
  it('Tiempos resume el tiempo de cada actividad, y «—» la que no tiene', () => {
    // El AS-IS sin el tiempo de una tarea: es exactamente lo que la lista tiene que delatar.
    const escenario = asIs();
    const elementos = { ...(escenario['elements'] as Json) };
    const sinTiempo = { ...(elementos['Task_PrepareService'] as Json) };
    delete sinTiempo['processingTime'];
    elementos['Task_PrepareService'] = sinTiempo;
    montar(<Anfitrion inicial={{ ...escenario, elements: elementos }} />);

    // Rows are found by their `data-id` (#447): the visible text is the element's name.
    const fila = (id: string): string =>
      document.querySelector(`.lista-paso li:has(button[data-id="${id}"])`)?.textContent ?? '';
    expect(fila('Task_PrepareService')).toContain(en.escenario.sinResumen);
    // La que sí lo tiene lo enseña con el nombre de su distribución.
    expect(fila('Task_RegisterRequest')).toContain(en.escenario.distribuciones['constant']);
  });

  it('una fila de la lista selecciona el elemento en el lienzo', () => {
    montar(<Anfitrion inicial={asIs()} />);
    irAPaso('resources');
    const fila = document.querySelector<HTMLButtonElement>('.lista-paso li button[data-id="Task_PrepareService"]')!;
    expect(fila).toBeInstanceOf(HTMLButtonElement);
    act(() => {
      fila.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(hay('campo-elements.Task_PrepareService.resources[0].ref')).toBe(true);
  });
});
