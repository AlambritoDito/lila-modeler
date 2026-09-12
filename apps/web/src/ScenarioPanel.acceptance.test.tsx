// @vitest-environment jsdom
/**
 * Aceptación de #332: `examples/tarjeta-credito` se parametriza **entero** desde el panel, sin
 * abrir el JSON ni una vez, y lo que sale es el mismo escenario que `as-is.scenario.json`.
 *
 * El punto de partida es lo que la app tiene en cuanto abres un `.bpmn` y creas un escenario: la
 * versión, el nombre, el modelo y el instante cero. Todo lo demás —la unidad, la duración, el
 * calendario de la tienda, los tres grupos de recursos, el tiempo y los recursos de las trece
 * tareas, las llegadas del inicio y las probabilidades de las dos compuertas— se teclea aquí con
 * los mismos gestos que haría una persona: seleccionar en el lienzo y rellenar el formulario.
 *
 * La comparación es sobre el escenario **resuelto y parseado** con el esquema del motor, que es
 * el que simula: así «igual» quiere decir «produce la misma simulación», no «el archivo tiene los
 * mismos bytes». `$schema` y `description` se quitan del de referencia porque son metadatos
 * editoriales del archivo, no parámetros de simulación, y el panel no los edita (§ 2.1).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it } from 'vitest';

import type { ProcessIR } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';
import { ScenarioSchema, validateScenario } from '@lila/engine/schema';

import { ScenarioPanel } from './ScenarioPanel.js';
import { setLocale } from './i18n';
import { es } from './strings.es';

setLocale('es');

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

afterEach(() => {
  if (raiz !== null) act(() => raiz!.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

function teclear(id: string, texto: string): void {
  const campo = document.getElementById(id);
  if (!(campo instanceof HTMLInputElement)) throw new Error(`no hay input con id ${id}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function elegir(id: string, valor: string): void {
  const campo = document.getElementById(id);
  if (!(campo instanceof HTMLSelectElement)) throw new Error(`no hay select con id ${id}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

/** Elige la opción de un `<select>` por lo que se lee en ella, no por su posición. */
function elegirPorTexto(id: string, texto: string): void {
  const campo = document.getElementById(id);
  if (!(campo instanceof HTMLSelectElement)) throw new Error(`no hay select con id ${id}`);
  const opcion = [...campo.options].find((o) => o.textContent === texto);
  if (opcion === undefined) throw new Error(`el select ${id} no ofrece «${texto}»`);
  elegir(id, opcion.value);
}

function pulsarEn(raizBusqueda: ParentNode, texto: string): void {
  const destino = [...raizBusqueda.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (destino === undefined) throw new Error(`no hay botón «${texto}»`);
  act(() => {
    destino.click();
  });
}

function pulsar(texto: string): void {
  pulsarEn(document, texto);
}

/** El `<details>` cuyo `<summary>` dice `titulo`: es lo que acota «Añadir» a una sección. */
function seccion(titulo: string): HTMLElement {
  const encontrada = [...document.querySelectorAll('details')].find(
    (d) => d.querySelector('summary')?.textContent?.trim() === titulo,
  );
  if (encontrada === undefined) throw new Error(`no hay sección «${titulo}»`);
  return encontrada;
}

/** Añade una clave a un registro (`calendars`, `resources`) desde su propia sección. */
function anadirClave(titulo: string, clave: string): void {
  const donde = seccion(titulo);
  const caja = [...donde.querySelectorAll('input')].find(
    (i) => i.getAttribute('aria-label') === es.escenario.claveNueva,
  );
  if (caja === undefined) throw new Error(`la sección «${titulo}» no tiene caja de clave nueva`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(caja, clave);
    caja.dispatchEvent(new Event('input', { bubbles: true }));
  });
  pulsarEn(donde, es.escenario.anadir);
}

/* ------------------------------------------------------------------ *
 * Anfitrión: el estado que en la app vive en `main.tsx`, más la selección del lienzo
 * ------------------------------------------------------------------ */

const ARCHIVO = 'as-is.scenario.json';
const SELECCIONAR = 'sel:';

let actual: Json = {};
let seleccionar: (id: string) => void = () => {};

function Anfitrion(): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>({
    // Lo que la app tiene nada más crear un escenario para un diagrama: ni recursos, ni
    // calendarios, ni un solo parámetro de elemento.
    [ARCHIVO]: {
      version: 1,
      name: 'AS-IS',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00' },
    },
  });
  const [seleccion, setSeleccion] = useState<string | null>(null);
  actual = escenarios[ARCHIVO] ?? {};
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

/* ------------------------------------------------------------------ *
 * Los datos del caso, tal y como los teclearía una persona
 * ------------------------------------------------------------------ */

/** `[id, minutos, grupo]` de cada tarea. Los minutos son lo que se teclea: el archivo va en s. */
const TAREAS: readonly [string, string, string][] = [
  ['Task_FillApplication', '5', 'executive'],
  ['Task_CopyId', '2', 'executive'],
  ['Task_CheckBureau', '1', 'analyst'],
  ['Task_DenyBureau', '2', 'analyst'],
  ['Task_InformBureauDenial', '1', 'executive'],
  ['Task_AssessDebt', '20', 'analyst'],
  ['Task_DenyDebt', '2', 'analyst'],
  ['Task_InformDebtDenial', '1', 'executive'],
  ['Task_OpenAccount', '3', 'analyst'],
  ['Task_ComputePaymentCapacity', '2', 'analyst'],
  ['Task_AssignCreditLimit', '1', 'analyst'],
  ['Task_PrintCard', '10', 'operator'],
  ['Task_DeliverCard', '5', 'executive'],
];

/** `[clave, nombre, capacidad, coste por hora]` de cada grupo; todos con el calendario de tienda. */
const GRUPOS: readonly [string, string, string, string][] = [
  ['executive', 'Account Executive', '3', '100'],
  ['analyst', 'Credit Analyst', '2', '120'],
  ['operator', 'Production Operator', '1', '80'],
];

const DIAS_LABORABLES = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

it('el AS-IS de la tarjeta de crédito se teclea entero desde el panel, sin tocar el JSON', () => {
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz!.render(<Anfitrion />);
  });
  seleccionar = (id) => {
    pulsar(`${SELECCIONAR}${id}`);
  };

  /* --- La corrida. La unidad primero: a partir de ahí los tiempos se teclean en minutos. --- */
  elegir('campo-run.baseTimeUnit', 'min');
  teclear('campo-run.duration', '480');
  teclear('campo-run.warmup', '0');
  teclear('campo-run.replications', '30');
  teclear('campo-run.seed', '42');
  teclear('campo-run.serviceLevel', '30');
  teclear('campo-run.currency', 'MXN');

  /* --- El calendario de la tienda, como lista (L-V de 08:00 a 16:00). --- */
  anadirClave(es.escenario.seccionCalendarios, 'tienda');
  pulsar(es.escenario.editarComoLista);
  pulsar(es.escenario.anadirEtiqueta('intervals'));
  for (const [i, dia] of DIAS_LABORABLES.entries()) {
    pulsar(es.escenario.anadirEtiqueta(es.escenario.campos['days']!));
    elegir(`campo-calendars.tienda.intervals[0].days[${i}]`, dia);
  }
  teclear('campo-calendars.tienda.intervals[0].from', '08:00');
  teclear('campo-calendars.tienda.intervals[0].to', '16:00');

  /* --- Los tres grupos de recursos. --- */
  for (const [clave, nombre, capacidad, coste] of GRUPOS) {
    anadirClave(es.escenario.seccionRecursos, clave);
    teclear(`campo-resources.${clave}.name`, nombre);
    elegir(`campo-resources.${clave}.type`, 'role');
    teclear(`campo-resources.${clave}.capacity`, capacidad);
    teclear(`campo-resources.${clave}.costPerHour`, coste);
    elegir(`campo-resources.${clave}.calendar`, 'tienda');
  }

  /* --- El inicio: llegadas exponenciales de media 6 min, en el calendario de la tienda. --- */
  seleccionar('StartEvent_Application');
  elegirPorTexto(
    'campo-elements.StartEvent_Application.interTriggerTimer',
    es.escenario.distribuciones['exponential']!,
  );
  teclear('campo-elements.StartEvent_Application.interTriggerTimer.mean', '6');
  elegir('campo-elements.StartEvent_Application.calendar', 'tienda');

  /* --- Las trece tareas: tiempo constante y un grupo de recursos. --- */
  for (const [id, minutos, grupo] of TAREAS) {
    seleccionar(id);
    elegirPorTexto(`campo-elements.${id}.processingTime`, es.escenario.distribuciones['constant']!);
    teclear(`campo-elements.${id}.processingTime.value`, minutos);
    pulsar(es.escenario.anadirEtiqueta(es.escenario.campos['resources']!));
    elegir(`campo-elements.${id}.resources[0].ref`, grupo);
  }

  /* --- Las dos compuertas, desde su vista: la probabilidad de cada rama y su suma. --- */
  seleccionar('Gateway_Bureau');
  teclear('campo-elements.Flow_BureauBad.probability', '0.4');
  teclear('campo-elements.Flow_BureauGood.probability', '0.6');
  expect(document.body.textContent).toContain(es.escenario.compuertaSuma(1));

  seleccionar('Gateway_Debt');
  teclear('campo-elements.Flow_DebtNotEligible.probability', '0.3');
  teclear('campo-elements.Flow_DebtEligible.probability', '0.7');
  expect(document.body.textContent).toContain(es.escenario.compuertaSuma(1));

  /* --- Lo tecleado es, semánticamente, el AS-IS del ejemplo. --- */
  const referencia = JSON.parse(
    readFileSync(resolve(RAIZ, `${CASO}/as-is.scenario.json`), 'utf8'),
  ) as Json;
  delete referencia['$schema'];
  delete referencia['description'];

  const tecleado = ScenarioSchema.parse(actual);
  expect(tecleado).toEqual(ScenarioSchema.parse(referencia));
  // Y el motor lo acepta sin un solo error: es un escenario, no un objeto que se le parece.
  expect(validateScenario(tecleado, ir).filter((p) => p.severity === 'error')).toEqual([]);
});
