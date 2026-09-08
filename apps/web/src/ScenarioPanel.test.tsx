// @vitest-environment jsdom
/**
 * LILA-061. El panel se prueba en un DOM real (jsdom, ya en las devDependencies de la raíz y
 * usado por `BottleneckOverlay.test.ts`) porque su aceptación es una interacción: *editar*
 * `capacity` y *guardar*. Sin `@testing-library` —no se añade una dependencia por esto—: se
 * monta con `react-dom/client`, se escribe con el setter nativo del `<input>` y se dispara el
 * evento que React escucha, que es lo que hace `fireEvent` por dentro.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { simulate, type ProcessIR } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';
import {
  ScenarioSchema,
  parseScenario,
  resolveExtends,
  scenarioErrors,
  validateScenario,
  type ResolvedScenario,
} from '@lila/engine/schema';

import {
  Campo,
  duplicarEscenario,
  borrar,
  escribir,
  esquemaDe,
  problemasEscenario,
  valorVacio,
  type Contexto,
  type EsquemaJson,
  ScenarioPanel,
} from './ScenarioPanel.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');

type Json = Record<string, unknown>;

function leerJson(archivo: string): Json {
  return JSON.parse(readFileSync(resolve(RAIZ, archivo), 'utf8')) as Json;
}

/**
 * El AS-IS del benchmark, recortado: 2 h de reloj virtual y una réplica. La estructura es la
 * real (mismos recursos, calendarios y elementos), pero 30 días × 30 réplicas en un test
 * unitario son minutos de CPU para comprobar algo que no depende de la duración.
 */
function asIsCorto(): Json {
  const asIs = leerJson('examples/pedido/as-is.scenario.json');
  return { ...asIs, run: { ...(asIs['run'] as Json), duration: 7200, replications: 1 } };
}

let ir: ProcessIR;

beforeAll(async () => {
  const parsed = await parseBpmn(readFileSync(resolve(RAIZ, 'examples/pedido/model.bpmn'), 'utf8'));
  ir = parsed.ir;
}, 120_000);

/* ------------------------------------------------------------------ *
 * Montaje y gestos
 * ------------------------------------------------------------------ */

// React 19 exige la bandera para que `act` no avise en cada render.
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

/** El setter nativo + el evento `input` es lo que React traduce a `onChange` en un `<input>`. */
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

/* ------------------------------------------------------------------ *
 * Anfitrión: el estado que en la app vive en `main.tsx`
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
}: {
  inicial: Readonly<Record<string, Json>>;
  archivoInicial: string;
  guardados: Guardado[];
  irActual: ProcessIR | null;
}): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>(inicial);
  const [archivo, setArchivo] = useState(archivoInicial);
  const [seleccion, setSeleccion] = useState<string | null>(null);
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

/** Lo que hace `lila run`: resolver `extends`, parsear con el esquema y validar contra el IR. */
function comoLilaRun(archivo: string, escenarios: Readonly<Record<string, Json>>): ResolvedScenario {
  const combinado = resolveExtends(archivo, (ruta) => {
    const crudo = escenarios[ruta];
    if (crudo === undefined) throw new Error(`escenario desconocido: ${ruta}`);
    return crudo;
  });
  return ScenarioSchema.parse(combinado) as ResolvedScenario;
}

/* ------------------------------------------------------------------ *
 * 1 — Aceptación: editar `capacity`, guardar, y que `lila run` lo acepte
 * ------------------------------------------------------------------ */

describe('aceptación de LILA-061', () => {
  it('editar capacity y guardar produce un archivo que lila run acepta', () => {
    const guardados: Guardado[] = [];
    const inicial = { 'as-is.scenario.json': asIsCorto() };
    montar(
      <Anfitrion
        inicial={inicial}
        archivoInicial="as-is.scenario.json"
        guardados={guardados}
        irActual={ir}
      />,
    );

    teclear('campo-resources.cajero.capacity', '3');
    pulsar('Guardar');

    expect(guardados).toHaveLength(1);
    const guardado = guardados[0]!;
    expect((guardado.escenario['resources'] as Json)['cajero']).toMatchObject({ capacity: 3 });

    // El archivo escrito es exactamente lo que come la CLI: esquema + reglas + motor.
    const escenario = comoLilaRun(guardado.archivo, {
      'as-is.scenario.json': guardado.escenario,
    });
    expect(scenarioErrors(validateScenario(escenario, ir))).toEqual([]);
    const resultado = simulate(ir, escenario, { log: false });
    expect(resultado.process.completed).toBeGreaterThan(0);
  }, 120_000);
});

/* ------------------------------------------------------------------ *
 * 2 — Un valor inválido se marca y se escribe igual
 * ------------------------------------------------------------------ */

describe('validación en vivo', () => {
  it('probability 1.5 se marca con el mensaje del validador y aun así se escribe', () => {
    const guardados: Guardado[] = [];
    montar(
      <Anfitrion
        inicial={{ 'as-is.scenario.json': asIsCorto() }}
        archivoInicial="as-is.scenario.json"
        guardados={guardados}
        irActual={ir}
      />,
    );

    // Sin selección, el panel lista los ids con parámetros; se elige el flujo desde ahí.
    pulsar('Flow_Aprobado');
    teclear('campo-elements.Flow_Aprobado.probability', '1.5');

    // El texto es el del validador, no uno inventado por el panel. Desde LILA-198 el rango de
    // `probability` lo comprueba el lint (`E-PROB-RANGO`, § 17 de SEMANTICS) y no el esquema.
    const roto = escribir(asIsCorto(), ['elements', 'Flow_Aprobado', 'probability'], 1.5);
    const parsed = ScenarioSchema.safeParse(roto);
    expect(parsed.success).toBe(true);
    const esperado = validateScenario(parsed.data!, ir).find(
      (problema) => problema.path === 'elements.Flow_Aprobado.probability',
    )!;
    expect(esperado.code).toBe('E-PROB-RANGO');
    expect(document.body.textContent).toContain(esperado.message);
    // La ruta viaja con el problema (es la que marca el campo y la que imprimen CLI y MCP).
    expect(problemasEscenario(roto, ir)).toContainEqual({
      ruta: 'elements.Flow_Aprobado.probability',
      mensaje: esperado.message,
      severidad: 'error',
    });

    // La escritura no se bloquea: el valor inválido está en el archivo y «Guardar» lo publica.
    expect(boton('Guardar').disabled).toBe(false);
    pulsar('Guardar');
    expect(
      (((guardados[0]!.escenario['elements'] as Json)['Flow_Aprobado']) as Json)['probability'],
    ).toBe(1.5);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Uniones genéricas: el esquema sintético de LILA-164
 * ------------------------------------------------------------------ */

/** `capacity: number | Array<{calendar, capacity}>`, la forma que traerá LILA-164. */
const CAPACIDAD_164: EsquemaJson = {
  anyOf: [
    { type: 'integer', minimum: 1 },
    {
      type: 'array',
      items: {
        type: 'object',
        properties: { calendar: { type: 'string' }, capacity: { type: 'integer', minimum: 1 } },
        required: ['calendar', 'capacity'],
      },
    },
  ],
};

function Sonda({ esquema, salida }: { esquema: EsquemaJson; salida: Json[] }): React.JSX.Element {
  const [resuelto, setResuelto] = useState<Json>({});
  const ctx: Contexto = {
    resuelto,
    problemas: new Map(),
    editar(ruta, valor) {
      setResuelto((previo) => {
        const nuevo = escribir(previo, ruta, valor);
        salida.push(nuevo);
        return nuevo;
      });
    },
    quitar(ruta) {
      setResuelto((previo) => {
        const nuevo = borrar(previo, ruta);
        salida.push(nuevo);
        return nuevo;
      });
    },
  };
  return (
    <Campo esquema={esquema} ruta={['capacity']} etiqueta="capacity" requerido ctx={ctx} />
  );
}

describe('uniones del esquema', () => {
  it('un anyOf sin discriminador se dibuja con selector de variante y produce las dos formas', () => {
    const salida: Json[] = [];
    montar(<Sonda esquema={CAPACIDAD_164} salida={salida} />);

    const selector = document.getElementById('campo-capacity');
    expect(selector).toBeInstanceOf(HTMLSelectElement);
    expect([...(selector as HTMLSelectElement).options].map((o) => o.textContent)).toEqual([
      '(sin definir)',
      'número entero',
      'lista',
    ]);

    // Variante escalar: el `minimum` del esquema es el valor de arranque.
    elegir('campo-capacity', '0');
    expect(salida.at(-1)).toEqual({ capacity: 1 });
    teclear('campo-capacity-valor', '4');
    expect(salida.at(-1)).toEqual({ capacity: 4 });

    // Variante lista: el botón de añadir construye el objeto requerido desde el esquema.
    elegir('campo-capacity', '1');
    expect(salida.at(-1)).toEqual({ capacity: [] });
    pulsar('Añadir capacity');
    expect(salida.at(-1)).toEqual({ capacity: [{ calendar: '', capacity: 1 }] });
    teclear('campo-capacity[0].calendar', 'noche');
    expect(salida.at(-1)).toEqual({ capacity: [{ calendar: 'noche', capacity: 1 }] });
  });

  it('la distribución discriminada del escenario cambia de variante y trae sus campos', () => {
    montar(
      <Anfitrion
        inicial={{ 'as-is.scenario.json': asIsCorto() }}
        archivoInicial="as-is.scenario.json"
        guardados={[]}
        irActual={ir}
      />,
    );
    pulsar('Task_TomarPedido');
    const selector = document.getElementById(
      'campo-elements.Task_TomarPedido.processingTime',
    ) as HTMLSelectElement;
    // La variante activa se detecta por el discriminador `type`, no por el orden.
    expect(selector.options[Number(selector.value) + 1]?.textContent).toBe('triangular');
    expect(document.getElementById('campo-elements.Task_TomarPedido.processingTime.mode')).not.toBe(
      null,
    );

    // `constant` es la primera variante del `discriminatedUnion`.
    elegir('campo-elements.Task_TomarPedido.processingTime', '0');
    expect(document.getElementById('campo-elements.Task_TomarPedido.processingTime.value')).not.toBe(
      null,
    );
    expect(document.getElementById('campo-elements.Task_TomarPedido.processingTime.mode')).toBe(
      null,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 4 — `extends`: se enseña lo resuelto y se escribe solo el delta
 * ------------------------------------------------------------------ */

describe('extends', () => {
  const escenarios = (): Record<string, Json> => ({
    'as-is.scenario.json': asIsCorto(),
    'to-be-3-cajeros.scenario.json': leerJson('examples/pedido/to-be-3-cajeros.scenario.json'),
  });

  // LILA-198 quitó el `.default(1)` de `run.seed` del esquema zod para poder avisar `W-SIN-SEED`.
  // El panel no lee el default de zod sino el del JSON Schema publicado, que es una **anotación**:
  // sin él `valorVacio` cae al `minimum` del entero seguro y añadir la semilla escribiría
  // -9007199254740991 en el archivo. El default sigue en el JSON Schema por `.meta({ default: 1 })`.
  it('añadir `run.seed` escribe 1, no el mínimo del entero seguro (LILA-198)', () => {
    const seed = esquemaDe('run').properties?.['seed'];
    expect(seed?.default).toBe(1);
    expect(valorVacio(seed!)).toBe(1);
    // Y el default sigue siendo solo anotación: zod no lo aplica, que es lo que hace posible el aviso.
    const resuelto = ScenarioSchema.parse({ version: 1, name: 'x', model: 'model.bpmn', run: { start: '2026-09-07T08:00:00Z', duration: 10 } });
    expect(resuelto.run?.seed).toBeUndefined();
  });

  it('editar un valor heredado deja en el hijo solo ese campo', () => {
    const guardados: Guardado[] = [];
    montar(
      <Anfitrion
        inicial={escenarios()}
        archivoInicial="to-be-3-cajeros.scenario.json"
        guardados={guardados}
        irActual={ir}
      />,
    );

    // `run` entero viene del padre: el panel lo enseña resuelto.
    expect((document.getElementById('campo-run.seed') as HTMLInputElement).value).toBe('42');

    teclear('campo-run.seed', '7');
    pulsar('Guardar');

    const delta = guardados[0]!.escenario;
    // Solo el campo tocado: `run` no se copia entero al hijo.
    expect(delta['run']).toEqual({ seed: 7 });
    expect(delta['extends']).toBe('as-is.scenario.json');
    expect(delta['resources']).toEqual({ cajero: { capacity: 3 } });

    // Y el resuelto sigue completo, con lo heredado intacto.
    const resuelto = comoLilaRun('to-be-3-cajeros.scenario.json', {
      ...escenarios(),
      'to-be-3-cajeros.scenario.json': delta,
    });
    expect(resuelto.run.seed).toBe(7);
    expect(resuelto.run.start).toBe('2026-09-07T08:00:00-06:00');
    expect(resuelto.resources?.['cajero']?.capacity).toBe(3);
  });

  it('tocar un array escribe el array entero en el delta, no un índice suelto (§ 6)', () => {
    const guardados: Guardado[] = [];
    montar(
      <Anfitrion
        inicial={escenarios()}
        archivoInicial="to-be-3-cajeros.scenario.json"
        guardados={guardados}
        irActual={ir}
      />,
    );

    pulsar('Task_TomarPedido');
    teclear('campo-elements.Task_TomarPedido.resources[0].quantity', '2');
    pulsar('Guardar');

    // Los arrays se reemplazan enteros: un `{ "0": { … } }` en el hijo no significaría nada.
    expect(guardados[0]!.escenario['elements']).toEqual({
      Task_TomarPedido: { resources: [{ ref: 'cajero', quantity: 2 }] },
    });
    const resuelto = comoLilaRun('to-be-3-cajeros.scenario.json', {
      ...escenarios(),
      'to-be-3-cajeros.scenario.json': guardados[0]!.escenario,
    });
    expect(resuelto.elements?.['Task_TomarPedido']?.resources).toEqual([
      { ref: 'cajero', quantity: 2 },
    ]);
    // Lo demás del elemento se sigue heredando del padre.
    expect(resuelto.elements?.['Task_TomarPedido']?.processingTime).toEqual({
      type: 'triangular',
      min: 60,
      mode: 120,
      max: 300,
    });
  });

  it('vaciar un campo que define el padre escribe null en el delta (§ 6)', () => {
    const guardados: Guardado[] = [];
    montar(
      <Anfitrion
        inicial={escenarios()}
        archivoInicial="to-be-3-cajeros.scenario.json"
        guardados={guardados}
        irActual={ir}
      />,
    );

    teclear('campo-run.currency', '');
    pulsar('Guardar');

    expect(guardados[0]!.escenario['run']).toEqual({ currency: null });
    const resuelto = comoLilaRun('to-be-3-cajeros.scenario.json', {
      ...escenarios(),
      'to-be-3-cajeros.scenario.json': guardados[0]!.escenario,
    });
    expect(resuelto.run.currency).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * 5 — Duplicar
 * ------------------------------------------------------------------ */

describe('duplicar', () => {
  it('crea «<nombre> (copia).scenario.json» con extends al original y delta vacío', () => {
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
    pulsar('Guardar');

    expect(guardados[0]).toEqual({
      archivo: 'as-is (copia).scenario.json',
      escenario: { version: 1, name: 'AS-IS (copia)', extends: 'as-is.scenario.json' },
    });
    // La copia hereda todo: el panel la enseña ya resuelta.
    expect((document.getElementById('campo-run.seed') as HTMLInputElement).value).toBe('42');
  });

  it('duplicarEscenario no depende del DOM', () => {
    expect(duplicarEscenario('to-be.scenario.json', { name: 'TO-BE' })).toEqual({
      archivo: 'to-be (copia).scenario.json',
      escenario: { version: 1, name: 'TO-BE (copia)', extends: 'to-be.scenario.json' },
    });
  });
});

/* ------------------------------------------------------------------ *
 * 6 — OP-11: capacidad de recursos, Fija y Por turno (LILA-164)
 * ------------------------------------------------------------------ */

describe('capacidad de recursos: Fija y Por turno', () => {
  it('«Por turno» produce capacity: [{calendar, capacity}] válido y «Fija» no deja la lista detrás', () => {
    const guardados: Guardado[] = [];
    montar(
      <Anfitrion
        inicial={{ 'as-is.scenario.json': asIsCorto() }}
        archivoInicial="as-is.scenario.json"
        guardados={guardados}
        irActual={ir}
      />,
    );

    // `horno` no trae `calendar` de pool (R16 los hace excluyentes): es el candidato limpio.
    const variante = 'campo-resources.horno.capacity-variante';
    elegir(variante, 'turno');
    pulsar('Añadir tramo');
    elegir('campo-resources.horno.capacity[0].calendar', 'oficina');
    teclear('campo-resources.horno.capacity[0].capacity', '2');
    pulsar('Guardar');

    const porTurno = guardados.at(-1)!.escenario;
    expect((porTurno['resources'] as Json)['horno']).toMatchObject({
      capacity: [{ calendar: 'oficina', capacity: 2 }],
    });

    // Lo que valida el motor, no una réplica de su semántica en el test.
    const resueltoTurno = resolveExtends('as-is.scenario.json', (ruta) => {
      if (ruta !== 'as-is.scenario.json') throw new Error(`escenario desconocido: ${ruta}`);
      return porTurno;
    });
    const parsed = ScenarioSchema.safeParse(resueltoTurno);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(scenarioErrors(validateScenario(parsed.data, ir))).toEqual([]);
    }

    // Volver a «Fija»: el id original reaparece y no queda el array de tramos escondido detrás.
    elegir(variante, 'fija');
    pulsar('Guardar');
    const fija = guardados.at(-1)!.escenario;
    const horno = (fija['resources'] as Json)['horno'] as Json;
    expect(typeof horno['capacity']).toBe('number');
    expect(Array.isArray(horno['capacity'])).toBe(false);
    expect((document.getElementById('campo-resources.horno.capacity') as HTMLInputElement).value).toBe(
      '1',
    );
  });
});

/* ------------------------------------------------------------------ *
 * 7 — OP-11: campos reservados heredados, eliminación explícita con null
 * ------------------------------------------------------------------ */

describe('campos reservados: quitar heredado', () => {
  it('«Quitar heredado» escribe priority: null y el escenario resuelto valida sin el campo', () => {
    const guardados: Guardado[] = [];
    const recursosPadre = asIsCorto()['resources'] as Json;
    const padre: Json = {
      ...asIsCorto(),
      resources: {
        ...recursosPadre,
        cajero: { ...(recursosPadre['cajero'] as Json), priority: 1 },
      },
    };
    const hijo: Json = { version: 1, name: 'Hijo', extends: 'as-is.scenario.json' };

    montar(
      <Anfitrion
        inicial={{ 'as-is.scenario.json': padre, 'hijo.scenario.json': hijo }}
        archivoInicial="hijo.scenario.json"
        guardados={guardados}
        irActual={ir}
      />,
    );

    // Estado visible antes de tocar nada: heredado del padre, con su valor.
    expect(document.body.textContent).toContain('heredado: 1');

    pulsar('Quitar heredado');
    pulsar('Guardar');

    const delta = guardados[0]!.escenario;
    expect((delta['resources'] as Json)['cajero']).toMatchObject({ priority: null });

    const resuelto = comoLilaRun('hijo.scenario.json', {
      'as-is.scenario.json': padre,
      'hijo.scenario.json': delta,
    });
    expect(resuelto.resources?.['cajero']?.priority).toBeUndefined();
    expect(scenarioErrors(validateScenario(resuelto, ir))).toEqual([]);
  });
});
