// @vitest-environment jsdom
/**
 * QA adversarial del panel de escenario (LILA-061).
 *
 * `ScenarioPanel.test.tsx` prueba el camino feliz de la aceptación. Esto prueba lo otro: lo que
 * el panel escribe cuando el escenario **hereda** (§ 6), cuando el id del lienzo no es el id del
 * IR, cuando la cadena de `extends` está rota y cuando se añade una clave que ya existe. El
 * criterio de todos es el mismo del ticket: lo que sale de «Guardar» tiene que ser un archivo
 * que `lila run` acepte.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ProcessIR } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';
import {
  ScenarioSchema,
  resolveExtends,
  resolveScenarioPath,
  scenarioErrors,
  validateScenario,
  type Scenario,
} from '@lila/engine/schema';

import { ScenarioPanel, duplicarEscenario } from './ScenarioPanel.js';
import { setLocale } from './i18n';

// This suite pins the Spanish translation. English is the app's base language since
// LILA-210, so the locale is set here instead of depending on the machine's.
setLocale('es');

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');

type Json = Record<string, unknown>;

function leerJson(archivo: string): Json {
  return JSON.parse(readFileSync(resolve(RAIZ, archivo), 'utf8')) as Json;
}

/** El AS-IS del benchmark con la corrida recortada: la duración no cambia nada de lo de aquí. */
function asIsCorto(): Json {
  const asIs = leerJson('examples/pedido/as-is.scenario.json');
  return { ...asIs, run: { ...(asIs['run'] as Json), duration: 7200, replications: 1 } };
}

/** Un modelo con un id que no es NCName: el IR lo sanea, bpmn-js no (§ 3 de BPMN_EXTENSION). */
const XML_ID_SANEADO = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_QA">
  <bpmn:process id="Process_QA" isExecutable="false">
    <bpmn:startEvent id="Start" />
    <bpmn:task id="1Task" name="Atender" />
    <bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start" targetRef="1Task" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="1Task" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;

let ir: ProcessIR;
let irSaneado: ProcessIR;

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(RAIZ, 'examples/pedido/model.bpmn'), 'utf8'))).ir;
  irSaneado = (await parseBpmn(XML_ID_SANEADO)).ir;
}, 120_000);

/* ------------------------------------------------------------------ *
 * Montaje y gestos (los mismos de `ScenarioPanel.test.tsx`)
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

function teclear(id: string, texto: string): void {
  const campo = document.getElementById(id);
  if (!(campo instanceof HTMLInputElement)) throw new Error(`no hay input con id ${id}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function tecleaEn(campo: HTMLInputElement, texto: string): void {
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

function boton(texto: string): HTMLButtonElement {
  const encontrado = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (encontrado === undefined) throw new Error(`no hay botón «${texto}»`);
  return encontrado;
}

function pulsar(texto: string): void {
  const destino = boton(texto);
  act(() => {
    destino.click();
  });
}

function pulsarNodo(destino: HTMLElement): void {
  act(() => {
    destino.click();
  });
}

/** Índice de la opción de un `<select>` por su texto, para no depender del orden del esquema. */
function opcion(id: string, texto: string): string {
  const campo = document.getElementById(id);
  if (!(campo instanceof HTMLSelectElement)) throw new Error(`no hay select con id ${id}`);
  const encontrada = [...campo.options].find((o) => o.textContent === texto);
  if (encontrada === undefined) throw new Error(`el select ${id} no ofrece «${texto}»`);
  return encontrada.value;
}

/* ------------------------------------------------------------------ *
 * Anfitrión
 * ------------------------------------------------------------------ */

interface Guardado {
  archivo: string;
  escenario: Json;
}

function Anfitrion({
  inicial,
  archivoInicial,
  guardados,
  irActual,
  seleccionInicial = null,
}: {
  inicial: Readonly<Record<string, Json>>;
  archivoInicial: string;
  guardados: Guardado[];
  irActual: ProcessIR | null;
  seleccionInicial?: string | null;
}): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>(inicial);
  const [archivo, setArchivo] = useState(archivoInicial);
  const [seleccion, setSeleccion] = useState<string | null>(seleccionInicial);
  return (
    <ScenarioPanel
      archivo={archivo}
      escenarios={escenarios}
      onCambio={(a, e) => {
        setEscenarios((previos) => ({ ...previos, [a]: e }));
      }}
      onGuardar={() => {
        guardados.push({ archivo, escenario: escenarios[archivo] ?? {} });
      }}
      onDuplicar={(a, e) => {
        setEscenarios((previos) => ({ ...previos, [a]: e }));
        setArchivo(a);
      }}
      ir={irActual}
      seleccion={seleccion}
      onSeleccionar={setSeleccion}
    />
  );
}

/** Lo que hace `lila run`: resolver `extends` y parsear con el esquema. */
function comoLilaRun(archivo: string, escenarios: Readonly<Record<string, Json>>): Scenario {
  const combinado = resolveExtends(archivo, (ruta) => {
    const crudo = escenarios[ruta];
    if (crudo === undefined) throw new Error(`escenario desconocido: ${ruta}`);
    return crudo;
  });
  return ScenarioSchema.parse(combinado);
}

const HIJO = 'to-be-3-cajeros.scenario.json';

function conHijo(): Record<string, Json> {
  return {
    'as-is.scenario.json': asIsCorto(),
    [HIJO]: leerJson('examples/pedido/to-be-3-cajeros.scenario.json'),
  };
}

/* ------------------------------------------------------------------ *
 * 1 — Cambiar de variante en un hijo: el delta tiene que borrar lo heredado
 * ------------------------------------------------------------------ */

describe('uniones sobre un escenario que hereda', () => {
  it('cambiar la distribución de triangular a normal no deja campos huérfanos del padre', () => {
    const guardados: Guardado[] = [];
    const escenarios = conHijo();
    montar(
      <Anfitrion
        inicial={escenarios}
        archivoInicial={HIJO}
        guardados={guardados}
        irActual={ir}
      />,
    );

    pulsar('Task_TomarPedido');
    const campo = 'campo-elements.Task_TomarPedido.processingTime';
    elegir(campo, opcion(campo, 'normal'));
    pulsar('Guardar');

    // El padre define `triangular {min, mode, max}`. Si el hijo solo escribe la variante nueva,
    // el merge profundo de § 6 deja `min`/`mode`/`max` pegados a la `normal` y el archivo ya no
    // es válido: `strictObject` los rechaza y `lila run` no arranca. § 6 dice cómo se borra lo
    // heredado —con `null`—, y es el panel quien tiene que escribirlo.
    const resuelto = comoLilaRun(HIJO, { ...escenarios, [HIJO]: guardados[0]!.escenario });
    expect(resuelto.elements?.['Task_TomarPedido']?.processingTime).toEqual({
      type: 'normal',
      mean: 0,
      sd: 0,
    });

    // Y el panel no puede quedarse marcando un error que no ofrece forma de arreglar.
    expect(document.body.textContent).not.toContain('clave desconocida');
  });
});

/* ------------------------------------------------------------------ *
 * 2 — Cadena de `extends` rota o cíclica
 * ------------------------------------------------------------------ */

describe('extends roto', () => {
  it('un padre que no existe se dice en el panel, no se traga', () => {
    montar(
      <Anfitrion
        inicial={{
          'hijo.scenario.json': { version: 1, name: 'Hijo', extends: 'no-existe.scenario.json' },
        }}
        archivoInicial="hijo.scenario.json"
        guardados={[]}
        irActual={ir}
      />,
    );

    // Sin esto el panel enseña el delta como si fuera el escenario entero y llena la cabecera de
    // errores que son consecuencia de la cadena rota (falta `run`, falta `model`), sin decir en
    // ningún sitio que el padre no se pudo leer.
    expect(document.body.textContent).toContain('escenario desconocido: no-existe.scenario.json');
  });

  it('un ciclo se dice con los archivos implicados', () => {
    montar(
      <Anfitrion
        inicial={{
          'a.scenario.json': { version: 1, name: 'A', extends: 'b.scenario.json' },
          'b.scenario.json': { version: 1, name: 'B', extends: 'a.scenario.json' },
        }}
        archivoInicial="a.scenario.json"
        guardados={[]}
        irActual={ir}
      />,
    );

    expect(document.body.textContent).toContain('ciclo en la cadena de herencia');
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Duplicar
 * ------------------------------------------------------------------ */

describe('duplicar', () => {
  it('el extends de la copia es relativo al directorio del original', () => {
    const copia = duplicarEscenario('escenarios/as-is.scenario.json', { name: 'AS-IS' });
    expect(copia.archivo).toBe('escenarios/as-is (copia).scenario.json');
    // § 6: `extends` se resuelve **relativo al archivo del hijo**. Una ruta con el directorio
    // dentro lo duplica y el padre deja de encontrarse.
    expect(resolveScenarioPath(copia.archivo, copia.escenario['extends'] as string)).toBe(
      'escenarios/as-is.scenario.json',
    );
  });

  it('duplicar dos veces no colisiona con la primera copia', () => {
    const guardados: Guardado[] = [];
    montar(
      <Anfitrion
        inicial={{ 'as-is.scenario.json': asIsCorto() }}
        archivoInicial="as-is.scenario.json"
        guardados={guardados}
        irActual={ir}
      />,
    );
    pulsar('Duplicar');
    pulsar('Duplicar');
    pulsar('Guardar');
    expect(guardados[0]!.archivo).toBe('as-is (copia) (copia).scenario.json');
    expect(guardados[0]!.escenario['extends']).toBe('as-is (copia).scenario.json');
  });
});

/* ------------------------------------------------------------------ *
 * 4 — Registros: añadir una clave que ya existe
 * ------------------------------------------------------------------ */

describe('registros', () => {
  it('añadir un recurso con un id que ya existe no lo machaca en silencio', () => {
    const guardados: Guardado[] = [];
    montar(
      <Anfitrion
        inicial={{ 'as-is.scenario.json': asIsCorto() }}
        archivoInicial="as-is.scenario.json"
        guardados={guardados}
        irActual={ir}
      />,
    );

    // El segundo `.anadir` del panel es el de «Recursos» (el primero es el de «Calendarios»).
    const anadir = document.querySelectorAll('.anadir')[1] as HTMLElement;
    tecleaEn(anadir.querySelector('input') as HTMLInputElement, 'cajero');
    pulsarNodo(anadir.querySelector('button') as HTMLButtonElement);
    pulsar('Guardar');

    // Un id repetido es un error del usuario, no una orden de tirar el recurso: `valorVacio`
    // escribía `{ capacity: 1 }` encima y se llevaba por delante nombre, coste y calendario.
    const cajero = (guardados[0]!.escenario['resources'] as Json)['cajero'] as Json;
    expect(cajero['costPerHour']).toBe(220);
    expect(cajero['capacity']).toBe(2);
  });
});

/* ------------------------------------------------------------------ *
 * 5 — El id del lienzo no siempre es el id del IR
 * ------------------------------------------------------------------ */

describe('selección del lienzo', () => {
  it('un id saneado por el IR se edita bajo la clave que el motor entiende', () => {
    const guardados: Guardado[] = [];
    const base: Json = {
      version: 1,
      name: 'QA',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00', duration: 3600 },
    };
    // bpmn-js carga el XML tal cual, así que la selección llega con el id del archivo (`1Task`);
    // el IR lo saneó a `_1Task` y es esa la clave que valida `validateScenario` (R3).
    expect(irSaneado.source.originalIds['_1Task']).toBe('1Task');

    montar(
      <Anfitrion
        inicial={{ 'qa.scenario.json': base }}
        archivoInicial="qa.scenario.json"
        guardados={guardados}
        irActual={irSaneado}
        seleccionInicial="1Task"
      />,
    );

    const campo = document.querySelector('input[id$=".fixedCost"]') as HTMLInputElement;
    expect(campo).not.toBe(null);
    tecleaEn(campo, '5');
    pulsar('Guardar');

    const resuelto = comoLilaRun('qa.scenario.json', { 'qa.scenario.json': guardados[0]!.escenario });
    expect(Object.keys(resuelto.elements ?? {})).toEqual(['_1Task']);
    expect(scenarioErrors(validateScenario(resuelto, irSaneado))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 6 — Los mensajes salen junto al campo que los provoca
 * ------------------------------------------------------------------ */

describe('rutas de los problemas', () => {
  /** El AS-IS con dos infracciones de § 5 metidas a mano: R14 en un timer y R4 en una tarea. */
  function conInfracciones(): Json {
    const base = asIsCorto();
    const elementos = { ...(base['elements'] as Json) };
    elementos['Timer_Reposo'] = { ...(elementos['Timer_Reposo'] as Json), selection: 'and' };
    elementos['Task_TomarPedido'] = { ...(elementos['Task_TomarPedido'] as Json), probability: 0.5 };
    return { ...base, elements: elementos };
  }

  function montarEn(id: string): void {
    montar(
      <Anfitrion
        inicial={{ 'as-is.scenario.json': conInfracciones() }}
        archivoInicial="as-is.scenario.json"
        guardados={[]}
        irActual={ir}
        seleccionInicial={id}
      />,
    );
  }

  it('R14 se marca en el propio campo `selection`', () => {
    montarEn('Timer_Reposo');
    expect(
      document.getElementById('campo-elements.Timer_Reposo.selection')?.closest('.campo-schema')
        ?.textContent,
    ).toContain('solo tiene sentido con resources');
  });

  it('R4 se marca en el propio campo `probability`', () => {
    montarEn('Task_TomarPedido');
    expect(
      document
        .getElementById('campo-elements.Task_TomarPedido.probability')
        ?.closest('.campo-schema')?.textContent,
    ).toContain('solo se admite en un sequence flow');
  });
});

/* ------------------------------------------------------------------ *
 * 7 — Tipos: lo que se escribe en un campo numérico
 * ------------------------------------------------------------------ */

describe('campos numéricos', () => {
  it('texto en un número no produce NaN y vaciarlo quita la clave', () => {
    const guardados: Guardado[] = [];
    montar(
      <Anfitrion
        inicial={{ 'as-is.scenario.json': asIsCorto() }}
        archivoInicial="as-is.scenario.json"
        guardados={guardados}
        irActual={ir}
      />,
    );

    teclear('campo-run.seed', 'abc');
    teclear('campo-run.warmup', '');
    pulsar('Guardar');

    const run = guardados[0]!.escenario['run'] as Json;
    // `NaN` no es JSON: si se colara, `JSON.stringify` lo escribiría como `null` y el archivo
    // diría algo distinto de lo que la persona tecleó.
    expect(run['seed']).toBe('abc');
    expect('warmup' in run).toBe(false);
    // Y se marca, sin bloquear la escritura, en español (LILA-202).
    expect(document.body.textContent).toContain('debe ser un número, no un texto');
  });
});
