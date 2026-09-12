// @vitest-environment jsdom
/**
 * #332 — parametrizar desde el diagrama: lo que el panel enseña depende de **qué** se ha
 * seleccionado en el lienzo, no del esquema entero.
 *
 * Cinco cosas, una por hueco de la auditoría del ticket: los campos por tipo de elemento, la
 * vista de compuerta, los selectores de grupo y calendario, la unidad de presentación de los
 * tiempos, `run.start` como fecha + desfase, y el JSON como vista avanzada.
 *
 * Los gestos son los de `ScenarioPanel.test.tsx` (setter nativo + evento); lo único nuevo es el
 * anfitrión, que trae botones para seleccionar cualquier id del IR: en la app la selección la da
 * el lienzo, y aquí hace falta poder tocar un `Gateway_…` que todavía no está en `elements`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ProcessIR } from '@lila/engine';
import { parseBpmn } from '@lila/engine/bpmn';
import { parseScenario, validateScenario } from '@lila/engine/schema';

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
 * Montaje y gestos (los de `ScenarioPanel.test.tsx`)
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

function elegir(id: string, valor: string): void {
  const campo = document.getElementById(id);
  if (!(campo instanceof HTMLSelectElement)) throw new Error(`no hay select con id ${id}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function areaTexto(etiqueta: string): HTMLTextAreaElement {
  const encontrada = [...document.querySelectorAll('textarea')].find(
    (t) => t.getAttribute('aria-label') === etiqueta,
  );
  if (encontrada === undefined) throw new Error(`no hay textarea «${etiqueta}»`);
  return encontrada;
}

function tecleaArea(etiqueta: string, texto: string): void {
  const campo = areaTexto(etiqueta);
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pulsar(texto: string): void {
  const destino = [...document.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (destino === undefined) throw new Error(`no hay botón «${texto}»`);
  act(() => {
    destino.click();
  });
}

/** El texto del `<option>` elegido de un `<select>`, por su id. */
function opciones(id: string): string[] {
  const campo = document.getElementById(id);
  if (!(campo instanceof HTMLSelectElement)) throw new Error(`no hay select con id ${id}`);
  return [...campo.options].map((o) => o.value);
}

function hay(id: string): boolean {
  return document.getElementById(id) !== null;
}

/* ------------------------------------------------------------------ *
 * Anfitrión con selección por id (en la app la da el lienzo)
 * ------------------------------------------------------------------ */

const ARCHIVO = 'as-is.scenario.json';

/** Prefijo del botón de selección: no puede chocar con ningún texto del panel. */
const SELECCIONAR = 'sel:';

let ultimo: Json = {};

function Anfitrion({ inicial, ir: irUsado = ir }: { inicial: Json; ir?: ProcessIR }): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>({
    [ARCHIVO]: inicial,
  });
  const [seleccion, setSeleccion] = useState<string | null>(null);
  ultimo = escenarios[ARCHIVO] ?? {};
  const ids = [...Object.keys(irUsado.nodes), ...Object.keys(irUsado.flows)];
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
        ir={irUsado}
        seleccion={seleccion}
        onSeleccionar={setSeleccion}
      />
    </>
  );
}

function seleccionar(id: string): void {
  pulsar(`${SELECCIONAR}${id}`);
}

/** El escenario mínimo del caso: sin él el panel no tiene ni `run` ni unidad de presentación. */
function base(extra: Json = {}): Json {
  return {
    version: 1,
    name: 'AS-IS',
    model: 'model.bpmn',
    run: { start: '2026-09-07T08:00:00-06:00', duration: 28_800, baseTimeUnit: 'min' },
    ...extra,
  };
}

/** Los códigos XOR que el motor saca del mismo escenario: el contraste del aviso del panel. */
function avisosXorDelMotor(escenario: Json): string[] {
  const parsed = parseScenario(escenario);
  if (!parsed.success) throw new Error(`el escenario del test no parsea: ${parsed.error.message}`);
  return validateScenario(parsed.data, ir)
    .filter((p) => p.code.includes('XOR'))
    .map((p) => p.code);
}

/* ------------------------------------------------------------------ *
 * 1 — Los campos que se ofrecen dependen del elemento (§ 2.5)
 * ------------------------------------------------------------------ */

describe('los campos que se ofrecen son los del tipo de elemento', () => {
  it('una tarea ofrece tiempo y recursos, y no las llegadas ni la probabilidad', () => {
    montar(<Anfitrion inicial={base()} />);
    seleccionar('Task_FillApplication');
    expect(hay('campo-elements.Task_FillApplication.processingTime')).toBe(true);
    expect(hay('campo-elements.Task_FillApplication.interTriggerTimer')).toBe(false);
    expect(hay('campo-elements.Task_FillApplication.probability')).toBe(false);
  });

  it('un inicio ofrece las llegadas y no el tiempo de proceso', () => {
    montar(<Anfitrion inicial={base()} />);
    seleccionar('StartEvent_Application');
    expect(hay('campo-elements.StartEvent_Application.interTriggerTimer')).toBe(true);
    expect(hay('campo-elements.StartEvent_Application.triggerCount')).toBe(true);
    expect(hay('campo-elements.StartEvent_Application.processingTime')).toBe(false);
  });

  it('un flujo solo ofrece la probabilidad', () => {
    montar(<Anfitrion inicial={base()} />);
    seleccionar('Flow_BureauGood');
    expect(hay('campo-elements.Flow_BureauGood.probability')).toBe(true);
    expect(hay('campo-elements.Flow_BureauGood.processingTime')).toBe(false);
    expect(hay('campo-elements.Flow_BureauGood.resources')).toBe(false);
  });

  it('un fin solo ofrece su coste fijo', () => {
    montar(<Anfitrion inicial={base()} />);
    seleccionar('End_CardDelivered');
    expect(hay('campo-elements.End_CardDelivered.fixedCost')).toBe(true);
    expect(hay('campo-elements.End_CardDelivered.processingTime')).toBe(false);
  });

  it('un campo que no aplica pero **ya está escrito** se sigue viendo, con su error', () => {
    // Si no, un `probability` puesto por error en una tarea se volvería invisible y no habría
    // forma de borrarlo desde el panel; el error del linter seguiría ahí para siempre.
    montar(<Anfitrion inicial={base({ elements: { Task_FillApplication: { probability: 0.5 } } })} />);
    seleccionar('Task_FillApplication');
    expect(hay('campo-elements.Task_FillApplication.probability')).toBe(true);
    // Y sigue saliendo el error del linter (`E-PROB-EN-NODO`) pegado al campo.
    expect(document.body.textContent).toContain('elements.Task_FillApplication.probability');
  });
});

/* ------------------------------------------------------------------ *
 * 2 — La compuerta y sus ramas
 * ------------------------------------------------------------------ */

describe('vista de compuerta', () => {
  it('lista los salientes, escribe elements[flujo].probability y suma', () => {
    montar(<Anfitrion inicial={base()} />);
    seleccionar('Gateway_Bureau');
    // La compuerta no tiene campos propios: lo que se parametriza son sus ramas.
    expect(hay('campo-elements.Gateway_Bureau.processingTime')).toBe(false);
    expect(document.body.textContent).toContain(es.escenario.seccionCompuerta);

    teclear('campo-elements.Flow_BureauBad.probability', '0.4');
    teclear('campo-elements.Flow_BureauGood.probability', '0.6');
    expect(ultimo['elements']).toEqual({
      Flow_BureauBad: { probability: 0.4 },
      Flow_BureauGood: { probability: 0.6 },
    });
    expect(document.body.textContent).toContain(es.escenario.compuertaSuma(1));
    expect(document.body.textContent).not.toContain(es.escenario.compuertaSumaAviso);
  });

  it('avisa cuando las ramas declaradas de una XOR no suman 1 (R10)', () => {
    montar(<Anfitrion inicial={base()} />);
    seleccionar('Gateway_Bureau');
    teclear('campo-elements.Flow_BureauBad.probability', '0.4');
    teclear('campo-elements.Flow_BureauGood.probability', '0.4');
    expect(document.body.textContent).toContain(es.escenario.compuertaSuma(0.8));
    expect(document.body.textContent).toContain(es.escenario.compuertaSumaAviso);
  });

  it('sin ninguna probabilidad declarada no avisa: el reparto por igual es legítimo', () => {
    montar(<Anfitrion inicial={base()} />);
    seleccionar('Gateway_Debt');
    expect(document.body.textContent).not.toContain(es.escenario.compuertaSumaAviso);
  });

  // R-XOR-2: una rama declarada y la otra sin número no es un escenario mal escrito; el motor le
  // da el residuo a la que falta y no avisa. El panel tiene que decir lo mismo que la lista de
  // validación que sale tres líneas más abajo, que es la del motor.
  it('una rama declarada y la otra sin número suman 1, sin aviso, como el motor', () => {
    const escenario = base({ elements: { Flow_BureauBad: { probability: 0.4 } } });
    montar(<Anfitrion inicial={escenario} />);
    seleccionar('Gateway_Bureau');
    expect(document.body.textContent).toContain(es.escenario.compuertaSuma(1));
    expect(document.body.textContent).toContain(es.escenario.compuertaImplicita(0.6));
    expect(document.body.textContent).not.toContain(es.escenario.compuertaSumaAviso);
    expect(avisosXorDelMotor(escenario)).toEqual([]);
  });

  it('con flujo por defecto el resto es suyo: total 1 y ningún aviso', () => {
    const conDefecto: ProcessIR = {
      ...ir,
      flows: { ...ir.flows, Flow_BureauGood: { ...ir.flows['Flow_BureauGood']!, isDefault: true } },
    };
    const escenario = base({ elements: { Flow_BureauBad: { probability: 0.4 } } });
    montar(<Anfitrion inicial={escenario} ir={conDefecto} />);
    seleccionar('Gateway_Bureau');
    expect(document.body.textContent).toContain(es.escenario.compuertaPorDefecto);
    expect(document.body.textContent).toContain(es.escenario.compuertaSuma(1));
    expect(document.body.textContent).not.toContain(es.escenario.compuertaSumaAviso);
  });

  it('avisa cuando las declaradas se pasan de 1, igual que el motor', () => {
    const escenario = base({
      elements: { Flow_BureauBad: { probability: 0.5 }, Flow_BureauGood: { probability: 0.6 } },
    });
    montar(<Anfitrion inicial={escenario} />);
    seleccionar('Gateway_Bureau');
    expect(document.body.textContent).toContain(es.escenario.compuertaSuma(1.1));
    expect(document.body.textContent).toContain(es.escenario.compuertaSumaAviso);
    expect(avisosXorDelMotor(escenario)).toEqual(['W-XOR-NORMALIZADA']);
  });

  it('todas declaradas y sumando 1 no avisa', () => {
    const escenario = base({
      elements: { Flow_BureauBad: { probability: 0.4 }, Flow_BureauGood: { probability: 0.6 } },
    });
    montar(<Anfitrion inicial={escenario} />);
    seleccionar('Gateway_Bureau');
    expect(document.body.textContent).toContain(es.escenario.compuertaSuma(1));
    expect(document.body.textContent).not.toContain(es.escenario.compuertaSumaAviso);
    expect(avisosXorDelMotor(escenario)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 3 — Las referencias (R9), como selector
 * ------------------------------------------------------------------ */

describe('grupos y calendarios se eligen de lo declarado', () => {
  const conPools = base({
    calendars: { tienda: { intervals: [{ days: ['MON'], from: '08:00', to: '16:00' }] } },
    resources: { executive: { capacity: 3 }, analyst: { capacity: 2 } },
  });

  it('resources[].ref ofrece los grupos del escenario, no una caja de texto', () => {
    montar(<Anfitrion inicial={conPools} />);
    seleccionar('Task_FillApplication');
    pulsar(es.escenario.anadirEtiqueta(es.escenario.campos['resources']!));
    const id = 'campo-elements.Task_FillApplication.resources[0].ref';
    expect(opciones(id)).toEqual(['', 'executive', 'analyst']);
    elegir(id, 'analyst');
    expect(ultimo['elements']).toEqual({
      // Añadir la fila escribe ya el `quantity: 1` del § 2.5: el formulario enseña el mismo
      // número que acabará en el archivo, en vez de una casilla vacía.
      Task_FillApplication: { resources: [{ ref: 'analyst', quantity: 1 }] },
    });
  });

  it('elements[].calendar y resources[].calendar ofrecen los calendarios declarados', () => {
    montar(<Anfitrion inicial={conPools} />);
    seleccionar('Task_FillApplication');
    expect(opciones('campo-elements.Task_FillApplication.calendar')).toEqual(['', 'tienda']);
    elegir('campo-elements.Task_FillApplication.calendar', 'tienda');
    expect(ultimo['elements']).toEqual({ Task_FillApplication: { calendar: 'tienda' } });
  });

  it('una referencia rota se conserva como opción, para poder verla y quitarla', () => {
    montar(
      <Anfitrion
        inicial={base({
          calendars: { tienda: { intervals: [{ days: ['MON'], from: '08:00', to: '16:00' }] } },
          elements: { Task_FillApplication: { calendar: 'almacen' } },
        })}
      />,
    );
    seleccionar('Task_FillApplication');
    expect(opciones('campo-elements.Task_FillApplication.calendar')).toEqual([
      '',
      'almacen',
      'tienda',
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * 4 — La unidad de presentación (R1, R2)
 * ------------------------------------------------------------------ */

describe('los tiempos se teclean en baseTimeUnit y se guardan en segundos', () => {
  it('con baseTimeUnit «min», teclear 5 guarda 300', () => {
    montar(<Anfitrion inicial={base()} />);
    seleccionar('Task_FillApplication');
    // `constant` es la primera variante del `discriminatedUnion`.
    elegir('campo-elements.Task_FillApplication.processingTime', '0');
    teclear('campo-elements.Task_FillApplication.processingTime.value', '5');
    expect(ultimo['elements']).toEqual({
      Task_FillApplication: { processingTime: { type: 'constant', value: 300 } },
    });
    expect(document.body.textContent).toContain(es.escenario.unidades['min']);
  });

  it('lo guardado en segundos se enseña en la unidad, y cambiar la unidad no toca el archivo', () => {
    montar(
      <Anfitrion
        inicial={base({
          elements: { Task_FillApplication: { processingTime: { type: 'constant', value: 300 } } },
        })}
      />,
    );
    seleccionar('Task_FillApplication');
    const campo = document.getElementById(
      'campo-elements.Task_FillApplication.processingTime.value',
    ) as HTMLInputElement;
    expect(campo.value).toBe('5');
    elegir('campo-run.baseTimeUnit', 'h');
    expect((ultimo['elements'] as Json)['Task_FillApplication']).toEqual({
      processingTime: { type: 'constant', value: 300 },
    });
  });

  it('la duración de la corrida también, y la semilla no', () => {
    montar(<Anfitrion inicial={base()} />);
    teclear('campo-run.duration', '480');
    teclear('campo-run.seed', '42');
    expect(ultimo['run']).toMatchObject({ duration: 28_800, seed: 42 });
  });
});

/* ------------------------------------------------------------------ *
 * 5 — `run.start` (R8) y la vista avanzada
 * ------------------------------------------------------------------ */

describe('run.start se compone de fecha y desfase (R8)', () => {
  it('la fecha y el desfase producen el instante ISO del formato', () => {
    montar(<Anfitrion inicial={{ version: 1, name: 'AS-IS', model: 'model.bpmn', run: {} }} />);
    teclear('campo-run.start', '2026-09-07T08:00:00');
    elegir('campo-run.start-desfase', '-06:00');
    expect(ultimo['run']).toEqual({ start: '2026-09-07T08:00:00-06:00' });
  });

  it('un instante ya escrito llega repartido entre los dos controles', () => {
    montar(<Anfitrion inicial={base()} />);
    // jsdom (como los navegadores sin `step` de segundos) normaliza el valor sin los segundos;
    // `componerInstante` los repone al escribir, que es lo que el esquema exige.
    expect((document.getElementById('campo-run.start') as HTMLInputElement).value).toBe(
      '2026-09-07T08:00',
    );
    expect((document.getElementById('campo-run.start-desfase') as HTMLSelectElement).value).toBe(
      '-06:00',
    );
  });
});

describe('la vista avanzada sigue siendo el JSON', () => {
  it('aplica un delta válido y rechaza el que no parsea, sin tocar el escenario', () => {
    montar(<Anfitrion inicial={base()} />);
    const etiqueta = es.escenario.seccionJson;
    expect(areaTexto(etiqueta).value).toContain('"baseTimeUnit": "min"');

    tecleaArea(etiqueta, '{ "version": 1, "name": ');
    pulsar(es.escenario.aplicarJson);
    expect(document.querySelector('[role="alert"]')?.textContent ?? '').toContain(
      es.escenario.jsonInvalido(''),
    );
    expect(ultimo['name']).toBe('AS-IS');

    tecleaArea(etiqueta, '{ "version": 1, "name": "OTRO", "model": "model.bpmn" }');
    pulsar(es.escenario.aplicarJson);
    expect(ultimo).toEqual({ version: 1, name: 'OTRO', model: 'model.bpmn' });
  });
});
