// @vitest-environment jsdom
/**
 * LILA-334. The acceptance is a gesture, so it is tested on the panel itself: the credit-card
 * scenario with its `resources` stripped, three clicks (one per lane), and the result has to be
 * the file that ships in `examples/tarjeta-credito`, with `validateScenario` finding nothing.
 *
 * Same mounting helpers as `ScenarioPanel.test.tsx` (`react-dom/client` + `act`, native setters):
 * no `@testing-library` is added for this.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ProcessIR } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';
import { ScenarioSchema, validateScenario, type ResolvedScenario } from '@lila/engine/schema';

import { tasksByLane } from './laneToPool.js';
import { ScenarioPanel } from './ScenarioPanel.js';
import { setLocale } from './i18n';
import { en } from './strings.en';

// English is the base language; this suite reads the English labels.
setLocale('en');

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');

type Json = Record<string, unknown>;

let ir: ProcessIR;
let asIs: Json;

beforeAll(async () => {
  const xml = readFileSync(resolve(RAIZ, 'examples/tarjeta-credito/model.bpmn'), 'utf8');
  ir = (await parseBpmn(xml)).ir;
  asIs = JSON.parse(
    readFileSync(resolve(RAIZ, 'examples/tarjeta-credito/as-is.scenario.json'), 'utf8'),
  ) as Json;
}, 120_000);

function recursos(escenario: Json): Record<string, unknown> {
  const salida: Record<string, unknown> = {};
  for (const [id, elemento] of Object.entries(escenario['elements'] as Record<string, Json>)) {
    if (elemento['resources'] !== undefined) salida[id] = elemento['resources'];
  }
  return salida;
}

function sinRecursos(escenario: Json): Json {
  const elementos: Record<string, Json> = {};
  for (const [id, elemento] of Object.entries(escenario['elements'] as Record<string, Json>)) {
    const { resources: _fuera, ...resto } = elemento;
    elementos[id] = resto;
  }
  return { ...escenario, elements: elementos };
}

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

function elegir(id: string, valor: string): void {
  const campo = document.getElementById(id);
  if (!(campo instanceof HTMLSelectElement)) throw new Error(`no hay select con id ${id}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function botones(texto: string): HTMLButtonElement[] {
  return [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === texto);
}

function pulsar(texto: string): void {
  const destino = botones(texto)[0];
  if (destino === undefined) throw new Error(`no hay botón «${texto}»`);
  act(() => {
    destino.click();
  });
}

/**
 * #333: the panel opens on step 1, so a section of another step has to be asked for first. The
 * label is written by hand —this is a test— and is the English one `setLocale` pins.
 */
function irAPaso(paso: 'validation' | 'times' | 'resources' | 'calendars'): void {
  pulsar(
    {
      validation: '1 · Process validation',
      times: '2 · Time analysis',
      resources: '3 · Resource analysis',
      calendars: '4 · Calendar analysis',
    }[paso],
  );
}

const ARCHIVO = 'as-is.scenario.json';

function Anfitrion({ inicial }: { inicial: Json }): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>({
    [ARCHIVO]: inicial,
  });
  const [seleccion, setSeleccion] = useState<string | null>(null);
  return (
    <ScenarioPanel
      archivo={ARCHIVO}
      escenarios={escenarios}
      onCambio={(a, e) => {
        setEscenarios((previos) => ({ ...previos, [a]: e }));
        actual = e;
      }}
      onGuardar={() => {}}
      onDuplicar={() => {}}
      ir={ir}
      seleccion={seleccion}
      onSeleccionar={setSeleccion}
    />
  );
}

/** El último escenario que el panel escribió; `onCambio` es la única salida del componente. */
let actual: Json = {};

/** One gesture: pick the lane, pick the pool, press «Assign lane». */
function asignar(carril: string, pool: string): void {
  elegir('carril-a-pool-carril', carril);
  elegir('carril-a-pool-pool', pool);
  pulsar(en.escenario.carrilAsignar);
}

/* ------------------------------------------------------------------ *
 * 1 — Aceptación: tres clics parametrizan el caso de la tarjeta
 * ------------------------------------------------------------------ */

describe('acceptance of LILA-334', () => {
  it('three assignments produce the resources of the AS-IS and validate clean', () => {
    const inicial = sinRecursos(asIs);
    actual = inicial;
    montar(<Anfitrion inicial={inicial} />);
    irAPaso('resources');

    asignar('Account Executive', 'executive');
    asignar('Credit Analyst', 'analyst');
    asignar('Production Operator', 'operator');

    expect(recursos(actual)).toEqual(recursos(asIs));
    const resuelto = ScenarioSchema.parse(actual) as ResolvedScenario;
    expect(validateScenario(resuelto, ir).filter((p) => p.severity === 'error')).toEqual([]);
  });

  it('never writes resources on an event or a gateway', () => {
    const inicial = sinRecursos(asIs);
    actual = inicial;
    montar(<Anfitrion inicial={inicial} />);
    irAPaso('resources');
    asignar('Credit Analyst', 'analyst');
    for (const id of Object.keys(recursos(actual))) expect(ir.nodes[id]?.type).toBe('task');
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Sobrescribir pide confirmación
 * ------------------------------------------------------------------ */

describe('overwriting an assigned lane', () => {
  it('lists the assigned tasks and does nothing until «Overwrite»', () => {
    actual = asIs;
    montar(<Anfitrion inicial={asIs} />);
    irAPaso('resources');

    asignar('Credit Analyst', 'executive');
    // Nothing written yet: the scenario is still the file as it shipped.
    expect(recursos(actual)).toEqual(recursos(asIs));
    const aviso = document.querySelector('.carril-a-pool [role="alert"]');
    expect(aviso?.textContent).toBe(en.escenario.carrilYaAsignadas(tasksByLane(ir).get('Credit Analyst')!.length));
    const listados = [...document.querySelectorAll('.carril-a-pool li')].map(
      (li) => li.textContent?.trim().split(' ')[0] ?? '',
    );
    expect(listados).toEqual(tasksByLane(ir).get('Credit Analyst'));

    pulsar(en.escenario.carrilSobrescribir);
    for (const id of listados) {
      expect((actual['elements'] as Record<string, Json>)[id]!['resources']).toEqual([
        { ref: 'executive', quantity: 1 },
      ]);
    }
  });

  it('«Cancel» leaves the scenario untouched and closes the list', () => {
    actual = asIs;
    montar(<Anfitrion inicial={asIs} />);
    irAPaso('resources');

    asignar('Credit Analyst', 'executive');
    pulsar(en.escenario.carrilCancelar);

    expect(actual).toEqual(asIs);
    expect(document.querySelector('.carril-a-pool [role="alert"]')).toBeNull();
    expect(botones(en.escenario.carrilSobrescribir)).toHaveLength(0);
  });

  it('changing the lane or the pool cancels a pending confirmation', () => {
    actual = asIs;
    montar(<Anfitrion inicial={asIs} />);
    irAPaso('resources');

    asignar('Credit Analyst', 'executive');
    elegir('carril-a-pool-pool', 'analyst');
    expect(botones(en.escenario.carrilSobrescribir)).toHaveLength(0);
    expect(actual).toEqual(asIs);
  });
});
