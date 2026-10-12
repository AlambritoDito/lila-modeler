// @vitest-environment jsdom
/**
 * Lote M, C2: the Resources step as master-detail. The acceptance is a count of gestures against
 * the beta.21 baseline (step 1: 5 clicks + 2 fields + a 1636 px jump), so the tests click and type
 * exactly what a person would, and count it.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ProcessIR } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';
import { ScenarioSchema, resolveExtends, scenarioErrors, validateScenario, type Scenario } from '@lila-modeler/engine/schema';

import { apply, publicarCarriles, elegirCarril, type FormaCarril, type LienzoCarriles } from './carrilClic.js';
import { ScenarioPanel } from './ScenarioPanel.js';
import { setLocale } from './i18n';
import { en } from './strings.en';
import { es } from './strings.es';

// This suite reads the Spanish labels unless a test switches to English.
setLocale('es');

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '../../..');

type Json = Record<string, unknown>;

function leerJson(archivo: string): Json {
  return JSON.parse(readFileSync(resolve(RAIZ, archivo), 'utf8')) as Json;
}

let irPedido: ProcessIR;
let irSolicitud: ProcessIR;
let xmlSolicitud: string;

beforeAll(async () => {
  irPedido = (await parseBpmn(readFileSync(resolve(RAIZ, 'examples/pedido/model.bpmn'), 'utf8'))).ir;
  xmlSolicitud = readFileSync(resolve(RAIZ, 'packages/engine/test/fixtures/service-request/model.bpmn'), 'utf8');
  irSolicitud = (await parseBpmn(xmlSolicitud)).ir;
}, 120_000);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;
let actual: Json = {};
let clics = 0;

afterEach(() => {
  if (raiz !== null) act(() => raiz!.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
  publicarCarriles(null);
  elegirCarril(null);
  setLocale('es');
});

function Anfitrion({ inicial, ir, avanzado = false, seleccion = null }: { inicial: Json; ir: ProcessIR; avanzado?: boolean; seleccion?: string | null }): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>({ 'e.scenario.json': inicial });
  actual = escenarios['e.scenario.json'] ?? {};
  return (
    <ScenarioPanel
      archivo="e.scenario.json"
      escenarios={escenarios}
      onCambio={(a, e) => {
        setEscenarios((previos) => ({ ...previos, [a]: e }));
      }}
      onGuardar={() => {}}
      onDuplicar={() => {}}
      ir={ir}
      seleccion={seleccion}
      onSeleccionar={() => {}}
      avanzado={avanzado}
    />
  );
}

function montar(inicial: Json, ir: ProcessIR = irPedido, avanzado = false, seleccion: string | null = null): void {
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz!.render(<Anfitrion inicial={inicial} ir={ir} avanzado={avanzado} seleccion={seleccion} />);
  });
  clics = 0;
}

/** A click, counted. */
function clic(elemento: Element | null | undefined): void {
  if (!(elemento instanceof HTMLElement)) throw new Error('nada que pulsar');
  clics++;
  act(() => {
    elemento.click();
  });
}

function botonTexto(texto: string): HTMLButtonElement {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === texto);
  if (b === undefined) throw new Error(`no hay botón «${texto}»`);
  return b;
}

function teclear(campo: HTMLInputElement, texto: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** A native `<select>` is two clicks: open it and pick the option. */
function elegir(id: string, valor: string): void {
  const campo = document.getElementById(id);
  if (!(campo instanceof HTMLSelectElement)) throw new Error(`no hay select ${id}`);
  clics += 2;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function tecla(destino: Element, key: string): void {
  act(() => {
    destino.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

function recursos(): Record<string, Json> {
  return (actual['resources'] ?? {}) as Record<string, Json>;
}

function fila(clave: string): HTMLButtonElement {
  const b = document.querySelector<HTMLButtonElement>(`button.rec-fila[data-clave="${clave}"]`);
  if (b === null) throw new Error(`no hay fila ${clave}`);
  return b;
}

const pedido = (): Json => leerJson('examples/pedido/as-is.scenario.json');

describe('acceptance (baseline step 1: 5 clicks + 2 fields + 1636 px)', () => {
  it('a new resource with two units: step + «New resource» + name + «+» = 3 clicks and 1 field', () => {
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clic(botonTexto(es.recursos.nuevo));

    // The sheet opened in place and the name has the focus: typing it needs no click.
    const nombre = document.activeElement as HTMLInputElement;
    expect(nombre.id).toBe('campo-resources.recurso-1.name');
    teclear(nombre, 'Supervisor');
    clic(document.querySelector(`[aria-label="${es.recursos.sumar}"]`));

    expect(clics).toBe(3);
    expect(recursos()['recurso-1']).toEqual({ capacity: 2, name: 'Supervisor' });
    const errores = scenarioErrors(validateScenario(ScenarioSchema.parse(actual), irPedido));
    expect(errores).toEqual([]);
    // The list is gone: the sheet replaced it, it was not appended below it.
    expect(document.querySelector('button.rec-fila')).toBeNull();
  });

  it('the capacity label is translated in both languages, never the raw «capacity»', () => {
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clic(fila('horno'));
    expect(document.querySelector('.rec-modo legend')?.textContent).toBe('Capacidad');
    expect(document.querySelector('.rec-ficha')?.textContent).not.toMatch(/capacity/);
    act(() => raiz!.unmount());
    raiz = null;

    setLocale('en');
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clic(fila('horno'));
    expect(document.querySelector('.rec-modo legend')?.textContent).toBe(en.recursos.capacidad);
    expect(document.querySelector('.rec-ficha')?.textContent).not.toMatch(/capacity/);
  });
});

describe('the list', () => {
  it('shows name, calendar, capacity and cost per hour, in the scenario currency', () => {
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    expect(fila('cajero').textContent).toBe(`Cashieroficina×2220.00 ${es.recursos.colCosto('MXN')}`);
    expect(fila('horno').textContent).toBe(`Oven${es.recursos.siempre}×10.00 ${es.recursos.colCosto('MXN')}`);
    expect(document.querySelector('.rec-lista')?.textContent).toContain(es.recursos.colCosto('MXN'));
  });

  it('#554: «Resources by element» and a task\'s resource choice name each pool as the list does', () => {
    const sinNombre = pedido();
    (sinNombre['resources'] as Record<string, Json>)['horno']!['name'] = '';
    montar(sinNombre);
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    const porElemento = document.querySelector('.lista-paso')!;
    expect(porElemento.textContent).toContain(es.escenario.listaRecursos);
    const resumenes = [...porElemento.querySelectorAll('.resumen')].map((r) => r.textContent);
    // A pool without a name reads as its key, as its row in the list above.
    expect(resumenes).toEqual(['Cashier ×1', 'Cook ×1, horno ×1', es.escenario.sinResumen, 'Cashier ×1, Cook ×1']);
    act(() => raiz!.unmount());
    raiz = null;
    contenedor?.remove();

    montar(pedido(), irPedido, false, 'Task_Revisar');
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    const campo = document.getElementById('campo-elements.Task_Revisar.resources[0].ref') as HTMLSelectElement;
    expect([...campo.options].map((o) => [o.value, o.textContent])).toEqual([
      ['', es.escenario.sinDefinir], ['cajero', 'Cashier'], ['cocinero', 'Cook'], ['horno', 'Oven'],
    ]);
    expect(campo.value).toBe('cajero');
  });

  it('empty state: says what a resource is for and creates the first one', () => {
    const sin = pedido();
    delete sin['resources'];
    sin['elements'] = {};
    montar(sin);
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    expect(document.querySelector('.rec-vacio')?.textContent).toContain(es.recursos.vacioTitulo);
    clic(botonTexto(es.recursos.nuevo));
    expect(Object.keys(recursos())).toEqual(['recurso-1']);
  });

  it('keyboard: ↑/↓/Home/End move along the rows, Escape in the sheet comes back to its row', () => {
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    const lista = document.querySelector('.rec-lista ul')!;
    expect(fila('cajero').tabIndex).toBe(0);
    expect(fila('cocinero').tabIndex).toBe(-1);
    act(() => fila('cajero').focus());
    tecla(lista, 'ArrowDown');
    expect(document.activeElement).toBe(fila('cocinero'));
    tecla(lista, 'End');
    expect(document.activeElement).toBe(fila('horno'));
    tecla(lista, 'ArrowUp');
    expect(document.activeElement).toBe(fila('cocinero'));
    tecla(lista, 'Home');
    expect(document.activeElement).toBe(fila('cajero'));

    clic(fila('cocinero'));
    const ficha = document.querySelector('.rec-ficha')!;
    expect(ficha.getAttribute('data-clave')).toBe('cocinero');
    tecla(document.getElementById('campo-resources.cocinero.name')!, 'Escape');
    expect(document.querySelector('.rec-ficha')).toBeNull();
    expect(document.activeElement).toBe(fila('cocinero'));
    // Tab now lands on the last row opened.
    expect(fila('cocinero').tabIndex).toBe(0);
  });

  it('a resource with an error is marked in the list, and the sheet shows the error on its tab', () => {
    const malo = pedido();
    (malo['resources'] as Record<string, Json>)['horno']!['capacity'] = 0;
    montar(malo);
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    expect(fila('horno').classList.contains('error')).toBe(true);
    expect(fila('cajero').classList.contains('error')).toBe(false);

    clic(fila('horno'));
    expect(document.getElementById('rec-tab-cap')?.textContent).toContain('! 1');
    expect(document.querySelector('.rec-capacidad [role="alert"]')).not.toBeNull();
    // The error is visible from another tab too: the badge stays on «Capacity».
    clic(document.getElementById('rec-tab-cost'));
    expect(document.getElementById('rec-tab-cap')?.textContent).toContain('! 1');
  });
});

describe('the sheet', () => {
  it('tabs are a tablist moved with ←/→', () => {
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clic(fila('cajero'));
    const tabs = [...document.querySelectorAll('.rec-pestanas [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(['Capacidad', 'Costos', 'Calendario y uso']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
    tecla(tabs[0]!, 'ArrowRight');
    expect(document.getElementById('rec-tab-cost')?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement?.id).toBe('rec-tab-cost');
    tecla(document.activeElement!, 'ArrowLeft');
    tecla(document.activeElement!, 'ArrowLeft');
    expect(document.activeElement?.id).toBe('rec-tab-uso');
  });

  it('costs: per hour and fixed per use, labelled with the currency', () => {
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clic(fila('horno'));
    clic(document.getElementById('rec-tab-cost'));
    expect(document.querySelector('label[for="campo-resources.horno.costPerHour"]')?.textContent).toBe(es.recursos.porHora('MXN'));
    teclear(document.getElementById('campo-resources.horno.costPerHour') as HTMLInputElement, '32');
    teclear(document.getElementById('campo-resources.horno.fixedCost') as HTMLInputElement, '5');
    expect(recursos()['horno']).toMatchObject({ costPerHour: 32, fixedCost: 5 });
    expect(document.querySelector('.rec-vista')?.textContent).toBe(es.recursos.costoEjemplo('37.00', 'MXN'));
  });

  it('calendar and use: calendar, type and the tasks that use it, with quantity', () => {
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clic(fila('cocinero'));
    clic(document.getElementById('rec-tab-uso'));
    expect((document.getElementById('campo-resources.cocinero.calendar') as HTMLSelectElement).value).toBe('oficina');
    expect(document.querySelector('.rec-tareas')?.textContent).toContain('Prepare food');
    elegir('campo-resources.cocinero.type', 'equipment');
    expect(recursos()['cocinero']!['type']).toBe('equipment');
  });

  it('fixed → by shifts moves the calendar into the first shift (R16) and back, each as one write', () => {
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clic(fila('cajero'));
    clic(document.getElementById('campo-resources.cajero.capacity-turno'));
    expect(recursos()['cajero']!['capacity']).toEqual([{ calendar: 'oficina', capacity: 2 }]);
    expect(recursos()['cajero']!['calendar']).toBeUndefined();
    expect(scenarioErrors(validateScenario(ScenarioSchema.parse(actual), irPedido))).toEqual([]);

    clic(botonTexto(es.recursos.anadirTurno));
    expect((recursos()['cajero']!['capacity'] as unknown[]).length).toBe(2);
    clic(document.querySelector(`[aria-label="${es.recursos.quitarTurno(2)}"]`));

    clic(document.getElementById('campo-resources.cajero.capacity-fija'));
    expect(recursos()['cajero']).toMatchObject({ capacity: 2, calendar: 'oficina' });
  });

  it('− never goes below 0, and 0 is shown as the engine’s error, not silently fixed', () => {
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clic(fila('horno'));
    const menos = document.querySelector(`[aria-label="${es.recursos.restar}"]`);
    clic(menos);
    clic(menos);
    expect(recursos()['horno']!['capacity']).toBe(0);
    expect(document.querySelector('.rec-capacidad [role="alert"]')).not.toBeNull();
  });

  it('with «Advanced», the id is renamed together with every task that used it', () => {
    montar(pedido(), irPedido, true);
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clic(fila('cajero'));
    const caja = document.getElementById('campo-resources.cajero.__clave') as HTMLInputElement;
    teclear(caja, 'caja');
    tecla(caja, 'Enter');
    expect(Object.keys(recursos())).toEqual(['caja', 'cocinero', 'horno']);
    const usos = JSON.stringify(actual['elements']);
    expect(usos).not.toContain('"cajero"');
    expect(usos).toContain('"caja"');
    expect(document.querySelector('.rec-ficha')?.getAttribute('data-clave')).toBe('caja');
    expect(scenarioErrors(validateScenario(ScenarioSchema.parse(actual), irPedido))).toEqual([]);
  });

  it('without «Advanced» there is no id field', () => {
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clic(fila('cajero'));
    expect(document.getElementById('campo-resources.cajero.__clave')).toBeNull();
  });

  it('«Delete resource» removes it and goes back to the list', () => {
    montar(pedido());
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clic(fila('horno'));
    clic(botonTexto(es.recursos.eliminar));
    // «Prepare food» uses the oven: deleting asks first (QA of #601).
    expect(Object.keys(recursos())).toEqual(['cajero', 'cocinero', 'horno']);
    expect(document.querySelector('.rec-confirmar')?.textContent).toContain(es.recursos.eliminarUsado(1));
    clic(botonTexto(es.recursos.eliminarConfirmar));
    expect(Object.keys(recursos())).toEqual(['cajero', 'cocinero']);
    expect(document.querySelector('.rec-ficha')).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * Lanes
 * ------------------------------------------------------------------ */

/** The service-request canvas: its three lanes, declared in reverse and drawn top to bottom. */
function lienzoSolicitud(ir: ProcessIR): { lienzo: LienzoCarriles; clicEn: (id: string) => void } {
  const nombres = ['Service Coordinator', 'Technical Reviewer', 'Service Operator'];
  const formas: FormaCarril[] = nombres
    .map((nombre, i) => ({
      id: `Lane_${i}`,
      type: 'bpmn:Lane',
      x: 0,
      y: i * 100,
      width: 800,
      height: 100,
      businessObject: {
        // The operator lane has no name on this canvas: it must not read «Lane_2».
        ...(i === 2 ? {} : { name: nombre }),
        flowNodeRef: Object.entries(ir.nodes).filter(([, n]) => n.lane === nombre).map(([id]) => ({ id })),
      },
    }))
    .reverse();
  let clicar: ((e: { element?: FormaCarril }) => unknown) | null = null;
  const lienzo: LienzoCarriles = {
    servicios: {
      elementRegistry: { filter: (p) => formas.filter(p) },
      canvas: { viewbox: () => ({ x: 0, y: 0, scale: 1 }), getContainer: () => document.body },
    },
    suscribir(eventos, escuchar) {
      if (eventos.includes('element.click')) clicar = escuchar;
      return () => {};
    },
  };
  return {
    lienzo,
    clicEn: (id) => {
      clics++;
      act(() => {
        clicar?.({ element: formas.find((f) => f.id === id)! });
      });
    },
  };
}

function sinRecursosDeTareas(escenario: Json): Json {
  const elementos: Record<string, Json> = {};
  for (const [id, el] of Object.entries(escenario['elements'] as Record<string, Json>)) {
    const { resources: _fuera, ...resto } = el;
    elementos[id] = resto;
  }
  return { ...escenario, elements: elementos };
}

describe('lanes', () => {
  const solicitud = (): Json => sinRecursosDeTareas(leerJson('packages/engine/test/fixtures/service-request/as-is.scenario.json'));

  it('a click on a lane name, the resource and «Assign»: 4 clicks, and it says what it did', () => {
    montar(solicitud(), irSolicitud);
    const { lienzo, clicEn } = lienzoSolicitud(irSolicitud);
    const quitar = apply(lienzo);
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clics = 0;

    clicEn('Lane_1');
    const bloque = document.querySelector('.rec-carril-elegido')!;
    const tareas = Object.entries(irSolicitud.nodes).filter(([, n]) => n.lane === 'Technical Reviewer' && n.type === 'task');
    expect(bloque.textContent).toContain(es.recursos.carrilTitulo('Technical Reviewer', tareas.length));
    elegir('carril-elegido-recurso', 'analyst');
    clic(botonTexto(es.recursos.asignar));

    expect(clics).toBe(4);
    for (const [id] of tareas) {
      expect((actual['elements'] as Record<string, Json>)[id]!['resources']).toEqual([{ ref: 'analyst', quantity: 1 }]);
    }
    expect(bloque.querySelector('[role="status"]')?.textContent).toContain(
      es.recursos.carrilHecho(tareas.length, 'Technical Reviewer', 'Technical Reviewer'),
    );
    quitar();
  });

  it('the lane selectors follow the canvas order, and an unnamed lane is numbered, not its id', () => {
    montar(solicitud(), irSolicitud);
    const quitar = apply(lienzoSolicitud(irSolicitud).lienzo);
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    const opciones = [...(document.getElementById('carril-a-pool-carril') as HTMLSelectElement).options];
    expect(opciones.map((o) => o.text)).toEqual(['Service Coordinator', 'Technical Reviewer', es.recursos.carrilSinNombre(1)]);
    expect(document.body.textContent).not.toContain('Lane_2');
    quitar();
  });

  it('from the sheet: row, tab «Calendar and use», the lane and «Assign» = 5 clicks from the list', () => {
    montar(solicitud(), irSolicitud);
    clic(document.querySelector('.pasos button[data-paso="resources"]'));
    clics = 0;
    clic(fila('operator'));
    clic(document.getElementById('rec-tab-uso'));
    elegir('carril-a-recurso-carril', 'Service Operator');
    clic(botonTexto(es.recursos.asignar));
    expect(clics).toBe(5);
    const operador = Object.entries(irSolicitud.nodes).filter(([, n]) => n.lane === 'Service Operator' && n.type === 'task');
    for (const [id] of operador) {
      expect((actual['elements'] as Record<string, Json>)[id]!['resources']).toEqual([{ ref: 'operator', quantity: 1 }]);
    }
    // And the sheet lists them now as the tasks it performs.
    expect(document.querySelectorAll('.rec-tareas li')).toHaveLength(operador.length);
  });
});

/* ------------------------------------------------------------------ *
 * QA of #601: scenarios that extend the one being edited, and the R16 round trip
 * ------------------------------------------------------------------ */

const HIJO = 'to-be-3-cajeros.scenario.json';
let todos: Readonly<Record<string, Json>> = {};

/** Several scenarios, like the rail: `onCambio` writes whichever file it is told to. */
function Varios({ inicial, archivo }: { inicial: Record<string, Json>; archivo: string }): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>(inicial);
  todos = escenarios;
  actual = escenarios[archivo] ?? {};
  return (
    <ScenarioPanel
      archivo={archivo}
      escenarios={escenarios}
      onCambio={(a, e) => {
        setEscenarios((previos) => ({ ...previos, [a]: e }));
      }}
      onGuardar={() => {}}
      onDuplicar={() => {}}
      ir={irPedido}
      seleccion={null}
      onSeleccionar={() => {}}
      avanzado
    />
  );
}

function montarVarios(inicial: Record<string, Json>, archivo: string): void {
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => {
    raiz!.render(<Varios inicial={inicial} archivo={archivo} />);
  });
}

type Resuelto = Scenario & { resources: Record<string, Json>; elements: Record<string, Json> };

function comoLilaRun(archivo: string): Resuelto {
  return ScenarioSchema.parse(
    resolveExtends(archivo, (ruta) => {
      const crudo = todos[ruta];
      if (crudo === undefined) throw new Error(`escenario desconocido: ${ruta}`);
      return crudo;
    }),
  ) as Resuelto;
}

function conHijo(): Record<string, Json> {
  const hijo = leerJson(`examples/pedido/${HIJO}`);
  // The child also names the cashier in a task of its own.
  hijo['elements'] = { Task_Revisar: { resources: [{ ref: 'cajero', quantity: 2 }], selection: 'or' } };
  return { 'as-is.scenario.json': pedido(), [HIJO]: hijo };
}

function renombrar(nueva: string): void {
  const caja = document.querySelector<HTMLInputElement>('.rec-ficha input[id$=".__clave"]')!;
  teclear(caja, nueva);
  tecla(caja, 'Enter');
}

function pasoRecursos(): void {
  clic(document.querySelector('.pasos button[data-paso="resources"]'));
}

describe('QA of #601', () => {
  it('renaming in the parent carries the child: its override and its own references move to the new id', () => {
    montarVarios(conHijo(), 'as-is.scenario.json');
    const antes = comoLilaRun(HIJO);
    pasoRecursos();
    clic(fila('cajero'));
    renombrar('caja');

    expect(todos[HIJO]!['resources']).toEqual({ caja: { capacity: 3 } });
    const hijo = comoLilaRun(HIJO);
    expect(scenarioErrors(validateScenario(hijo, irPedido))).toEqual([]);
    expect(Object.keys(hijo.resources)).toEqual(['caja', 'cocinero', 'horno']);
    expect(hijo.resources['caja']).toEqual(antes.resources['cajero']);
    expect(hijo.elements['Task_Revisar']).toMatchObject({ selection: 'or', resources: [{ ref: 'caja', quantity: 2 }] });
    expect(JSON.stringify(hijo)).not.toContain('"cajero"');
  });

  it('a name the child already declares is refused, and nothing is written', () => {
    const inicial = conHijo();
    inicial[HIJO]!['resources'] = { cajero: { capacity: 3 }, caja: { capacity: 1 } };
    montarVarios(inicial, 'as-is.scenario.json');
    pasoRecursos();
    clic(fila('cajero'));
    renombrar('caja');
    expect(document.querySelector('.rec-ficha [role="alert"]')?.textContent).toBe(es.recursos.claveMotivo['enDerivado']);
    expect(Object.keys(recursos())).toEqual(['cajero', 'cocinero', 'horno']);
  });

  it('a resource a child names cannot be deleted from the parent', () => {
    montarVarios(conHijo(), 'as-is.scenario.json');
    pasoRecursos();
    clic(fila('cajero'));
    const borrar = botonTexto(es.recursos.eliminar);
    expect(borrar.disabled).toBe(true);
    expect(document.querySelector('.rec-ficha')?.textContent).toContain(es.recursos.eliminarBloqueado(HIJO));
  });

  it('renaming an inherited resource from the child is refused', () => {
    montarVarios(conHijo(), HIJO);
    pasoRecursos();
    clic(fila('horno'));
    renombrar('horno2');
    expect(document.querySelector('.rec-ficha [role="alert"]')?.textContent).toBe(es.recursos.claveMotivo['heredada']);
    expect(Object.keys(comoLilaRun(HIJO).resources)).toContain('horno');
  });

  it('R16 round trip in the child comes back to the same resolved resource', () => {
    montarVarios(conHijo(), HIJO);
    const antes = comoLilaRun(HIJO);
    pasoRecursos();
    clic(fila('cajero'));
    clic(document.getElementById('campo-resources.cajero.capacity-turno'));
    expect(scenarioErrors(validateScenario(comoLilaRun(HIJO), irPedido))).toEqual([]);
    clic(document.getElementById('campo-resources.cajero.capacity-fija'));
    const vuelta = comoLilaRun(HIJO);
    expect(vuelta.resources['cajero']).toEqual(antes.resources['cajero']);
    expect(vuelta.elements).toEqual(antes.elements);
  });

  it('R16 round trip on a 24/7 resource never gives it a calendar', () => {
    montar(pedido());
    pasoRecursos();
    clic(fila('horno'));
    clic(document.getElementById('campo-resources.horno.capacity-turno'));
    // The shift starts with no calendar to choose, not with the office hours.
    expect(recursos()['horno']!['capacity']).toEqual([{ calendar: '', capacity: 1 }]);
    clic(document.getElementById('campo-resources.horno.capacity-fija'));
    expect(recursos()['horno']).toEqual(pedido()['resources'] && (pedido()['resources'] as Record<string, Json>)['horno']);
  });

  it('By shifts → Fixed with two shifts asks before discarding the second', () => {
    montar(pedido());
    pasoRecursos();
    clic(fila('cajero'));
    clic(document.getElementById('campo-resources.cajero.capacity-turno'));
    clic(botonTexto(es.recursos.anadirTurno));
    clic(document.getElementById('campo-resources.cajero.capacity-fija'));
    expect((recursos()['cajero']!['capacity'] as unknown[]).length).toBe(2);
    expect(document.querySelector('.rec-confirmar')?.textContent).toContain(es.recursos.descartarTurnos(1));
    clic(botonTexto(es.recursos.descartarCancelar));
    expect((recursos()['cajero']!['capacity'] as unknown[]).length).toBe(2);
    clic(document.getElementById('campo-resources.cajero.capacity-fija'));
    clic(botonTexto(es.recursos.descartarConfirmar));
    expect(recursos()['cajero']).toMatchObject({ capacity: 2, calendar: 'oficina' });
  });
});
