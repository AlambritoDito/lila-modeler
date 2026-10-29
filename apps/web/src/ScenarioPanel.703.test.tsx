// @vitest-environment jsdom
/**
 * #703 (ADR-033 § 3–5): the Simulate panel edits the loop of a task with a loop marker, the
 * instances of a multi-instance task and the error probability of an error boundary event.
 *
 * Each field is driven the way a person does it — select the element, pick a mode, type a number —
 * and checked on the delta the panel writes: the scenario field, the validation error next to the
 * field for an out-of-range value, and «undo» (picking «Not set» or emptying the number), which
 * leaves the delta as it was but for the emptied element entry (`sinVacias`). The app has no undo
 * stack for scenario edits (its Undo is the canvas command stack), so taking the edit back is what
 * undo means here. The last part
 * runs the scenario the panel wrote through the same gate as «▶ Simulate» (`prepareSimulation`),
 * with no `E-NOSOP`, and checks that signal and escalation events are still flagged.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { simulate, type ProcessIR } from '@lila-modeler/engine';
import { validateBpmnModel } from '@lila-modeler/engine/bpmn';
import { parseScenario, resolveExtends } from '@lila-modeler/engine/schema';

import { setLocale } from './i18n';
import { ImportarExcel } from './ImportarExcel.js';
import { ScenarioPanel } from './ScenarioPanel.js';
import { prepareSimulation } from './simulationGate.js';
import { en } from './strings.en';

setLocale('en');
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Json = Record<string, unknown>;

/** A loop task, a multi-instance task, and a task with two error boundary events; one plain task. */
const MODELO = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_703" isExecutable="true">
    <bpmn:startEvent id="Start" name="Order" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Task_Plain" />
    <bpmn:task id="Task_Plain" name="Register" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_Plain" targetRef="Task_Loop" />
    <bpmn:task id="Task_Loop" name="Review"><bpmn:standardLoopCharacteristics /></bpmn:task>
    <bpmn:sequenceFlow id="F3" sourceRef="Task_Loop" targetRef="Task_Multi" />
    <bpmn:task id="Task_Multi" name="Pack items"><bpmn:multiInstanceLoopCharacteristics /></bpmn:task>
    <bpmn:sequenceFlow id="F4" sourceRef="Task_Multi" targetRef="Task_Work" />
    <bpmn:task id="Task_Work" name="Ship" />
    <bpmn:sequenceFlow id="F5" sourceRef="Task_Work" targetRef="End_Ok" />
    <bpmn:endEvent id="End_Ok" />
    <bpmn:boundaryEvent id="Err_Work" name="Rejected" attachedToRef="Task_Work"><bpmn:errorEventDefinition /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F6" sourceRef="Err_Work" targetRef="End_Err" />
    <bpmn:boundaryEvent id="Err_Late" name="Late" attachedToRef="Task_Work"><bpmn:errorEventDefinition /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F7" sourceRef="Err_Late" targetRef="End_Err" />
    <bpmn:endEvent id="End_Err" />
  </bpmn:process>
</bpmn:definitions>`;

const ARCHIVO = 'as-is.scenario.json';
const PADRE = 'base.scenario.json';
const INICIAL: Json = {
  version: 1,
  name: 'AS-IS',
  model: 'model.bpmn',
  run: { start: '2026-09-07T08:00:00-06:00', seed: 7 },
  elements: { Start: { triggerCount: 4 } },
};

let ir: ProcessIR;

beforeAll(async () => {
  ir = (await validateBpmnModel(MODELO)).ir;
}, 120_000);

/* ------------------------------------------------------------------ *
 * Host and gestures
 * ------------------------------------------------------------------ */

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;
let actual: Json = {};
let seleccionar: (id: string | null) => void = () => {};

afterEach(() => {
  if (raiz !== null) act(() => raiz!.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

function Anfitrion({ escenarios: iniciales }: { escenarios: Record<string, Json> }): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Readonly<Record<string, Json>>>(iniciales);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  actual = escenarios[ARCHIVO] ?? {};
  seleccionar = setSeleccion;
  return (
    <ScenarioPanel
      archivo={ARCHIVO}
      escenarios={escenarios}
      onCambio={(a, e) => { setEscenarios((previos) => ({ ...previos, [a]: e })); }}
      onDuplicar={() => {}}
      ir={ir}
      seleccion={seleccion}
      onSeleccionar={setSeleccion}
    />
  );
}

function montar(escenarios: Record<string, Json> = { [ARCHIVO]: INICIAL }): void {
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => { raiz!.render(<Anfitrion escenarios={escenarios} />); });
}

function elegir(id: string, valor: string): void {
  const campo = document.getElementById(id);
  if (!(campo instanceof HTMLSelectElement)) throw new Error(`no select with id ${id}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(campo, valor);
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function teclear(id: string, texto: string): void {
  const campo = document.getElementById(id);
  if (!(campo instanceof HTMLInputElement)) throw new Error(`no input with id ${id}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function irAPaso(paso: 'times' | 'routes'): void {
  const boton = document.querySelector<HTMLButtonElement>(`.pasos button[data-paso="${paso}"]`);
  if (boton === null) throw new Error(`no step ${paso}`);
  act(() => { boton.click(); });
}

function elegirElemento(id: string | null): void {
  act(() => { seleccionar(id); });
}

/** The error messages drawn in the field box of the control `id`. */
function erroresDe(id: string): string[] {
  const caja = document.getElementById(id)?.closest('.campo-schema');
  if (caja == null) throw new Error(`no field box for ${id}`);
  return [...caja.querySelectorAll(':scope > p.error')].map((p) => p.textContent ?? '');
}

const elemento = (id: string): unknown => (actual['elements'] as Json | undefined)?.[id];

/**
 * `actual` without the element entries left empty. Taking a field back removes its key, and the
 * entry it leaves is `{}`, as for every field of the panel: an empty entry means the same as none
 * (`SCENARIO_FORMAT.md` § 2.5, «a map of exceptions»).
 */
function sinVacias(escenario: Json): Json {
  const elementos = Object.entries((escenario['elements'] as Json | undefined) ?? {}).filter(
    ([, valor]) => !(typeof valor === 'object' && valor !== null && Object.keys(valor).length === 0),
  );
  return { ...escenario, elements: Object.fromEntries(elementos) };
}

/* ------------------------------------------------------------------ *
 * Which element offers which field
 * ------------------------------------------------------------------ */

describe('the new fields are offered only where the engine takes them (ADR-033 § 1.7)', () => {
  it('Times: loop on the loop task, instances on the multi-instance task, neither on a plain task', () => {
    montar();
    irAPaso('times');
    elegirElemento('Task_Loop');
    expect(document.getElementById('campo-elements.Task_Loop.loop')).not.toBeNull();
    expect(document.getElementById('campo-elements.Task_Loop.instances')).toBeNull();
    elegirElemento('Task_Multi');
    expect(document.getElementById('campo-elements.Task_Multi.instances')).not.toBeNull();
    expect(document.getElementById('campo-elements.Task_Multi.loop')).toBeNull();
    elegirElemento('Task_Plain');
    expect(document.getElementById('campo-elements.Task_Plain.loop')).toBeNull();
    expect(document.getElementById('campo-elements.Task_Plain.instances')).toBeNull();
    expect(document.getElementById('campo-elements.Task_Plain.processingTime')).not.toBeNull();
  });

  it('an error boundary event is set in Routes, and Routes lists it with its probability', () => {
    montar();
    irAPaso('times');
    elegirElemento('Err_Work');
    expect(document.body.textContent).toContain(en.pasosSim.consejos['errorBoundary']);
    expect(document.getElementById('campo-elements.Err_Work.errorProbability')).toBeNull();
    elegirElemento(null);
    irAPaso('routes');
    const fila = document.querySelector<HTMLButtonElement>('.lista-paso button[data-id="Err_Work"]');
    expect(fila?.closest('li')?.textContent).toContain(en.escenario.sinProbabilidadError);
    act(() => { fila!.click(); });
    expect(document.getElementById('campo-elements.Err_Work.errorProbability')).not.toBeNull();
    // The reserved `conditions` is not written here: no field, and no help standing alone.
    expect(document.body.textContent).not.toContain(en.escenario.ayudas['conditions']);
  });
});

/* ------------------------------------------------------------------ *
 * Editing writes the field, shows its errors, and comes back
 * ------------------------------------------------------------------ */

describe('loop (ADR-033 § 3)', () => {
  it('a fixed number of times writes loop.count; 0 is an error; Not set takes it back', () => {
    montar();
    irAPaso('times');
    elegirElemento('Task_Loop');
    elegir('campo-elements.Task_Loop.loop', 'count');
    expect(elemento('Task_Loop')).toEqual({ loop: { count: 1 } });
    teclear('campo-elements.Task_Loop.loop.count', '3');
    expect(elemento('Task_Loop')).toEqual({ loop: { count: 3 } });
    expect(erroresDe('campo-elements.Task_Loop.loop.count')).toEqual([]);
    teclear('campo-elements.Task_Loop.loop.count', '0');
    expect(elemento('Task_Loop')).toEqual({ loop: { count: 0 } });
    expect(erroresDe('campo-elements.Task_Loop.loop.count')).toHaveLength(1);
    elegir('campo-elements.Task_Loop.loop', 'ninguno');
    expect(sinVacias(actual)).toEqual(INICIAL);
  });

  it('a probability writes loop.probability; out of range and 1 without loopMaximum are errors; emptying it removes the loop and keeps the box', () => {
    montar();
    irAPaso('times');
    elegirElemento('Task_Loop');
    elegir('campo-elements.Task_Loop.loop', 'probability');
    expect(elemento('Task_Loop')).toEqual({ loop: { probability: 0 } });
    teclear('campo-elements.Task_Loop.loop.probability', '1.5');
    expect(erroresDe('campo-elements.Task_Loop.loop.probability').join(' ')).toContain('outside [0, 1]');
    teclear('campo-elements.Task_Loop.loop.probability', '1');
    expect(erroresDe('campo-elements.Task_Loop.loop.probability').join(' ')).toContain('loopMaximum');
    teclear('campo-elements.Task_Loop.loop.probability', '0.5');
    expect(elemento('Task_Loop')).toEqual({ loop: { probability: 0.5 } });
    expect(erroresDe('campo-elements.Task_Loop.loop.probability')).toEqual([]);
    // Emptying the number to retype it: the loop goes, the mode and the box stay (QA of #703).
    teclear('campo-elements.Task_Loop.loop.probability', '');
    expect(sinVacias(actual)).toEqual(INICIAL);
    expect((document.getElementById('campo-elements.Task_Loop.loop') as HTMLSelectElement).value).toBe('probability');
    teclear('campo-elements.Task_Loop.loop.probability', '0.25');
    expect(elemento('Task_Loop')).toEqual({ loop: { probability: 0.25 } });
    elegir('campo-elements.Task_Loop.loop', 'ninguno');
    expect(sinVacias(actual)).toEqual(INICIAL);
    expect(document.getElementById('campo-elements.Task_Loop.loop.probability')).toBeNull();
  });

  it('retyping the number over an inherited loop of the other mode still leaves exactly one key', () => {
    const padre: Json = { ...INICIAL, elements: { ...(INICIAL['elements'] as Json), Task_Loop: { loop: { count: 3 } } } };
    montar({ [PADRE]: padre, [ARCHIVO]: { version: 1, name: 'TO-BE', extends: PADRE } });
    irAPaso('times');
    elegirElemento('Task_Loop');
    elegir('campo-elements.Task_Loop.loop', 'probability');
    teclear('campo-elements.Task_Loop.loop.probability', '');
    teclear('campo-elements.Task_Loop.loop.probability', '0.4');
    expect(elemento('Task_Loop')).toEqual({ loop: { count: null, probability: 0.4 } });
    expect(erroresDe('campo-elements.Task_Loop.loop')).toEqual([]);
  });

  it('the loopMaximum of the diagram is said under the control', async () => {
    const conTope = MODELO.replace('<bpmn:standardLoopCharacteristics />', '<bpmn:standardLoopCharacteristics loopMaximum="5" />');
    const original = ir;
    ir = (await validateBpmnModel(conTope)).ir;
    try {
      montar();
      irAPaso('times');
      elegirElemento('Task_Loop');
      expect(document.body.textContent).toContain(en.escenario.bucle.tope(5));
    } finally {
      ir = original;
    }
  });

  it('switching mode over an inherited loop writes the other key as null, so the resolved loop has exactly one', () => {
    const padre: Json = { ...INICIAL, elements: { ...(INICIAL['elements'] as Json), Task_Loop: { loop: { probability: 0.5 } } } };
    const hijo: Json = { version: 1, name: 'TO-BE', extends: PADRE };
    montar({ [PADRE]: padre, [ARCHIVO]: hijo });
    irAPaso('times');
    elegirElemento('Task_Loop');
    expect((document.getElementById('campo-elements.Task_Loop.loop') as HTMLSelectElement).value).toBe('probability');
    elegir('campo-elements.Task_Loop.loop', 'count');
    expect(elemento('Task_Loop')).toEqual({ loop: { probability: null, count: 1 } });
    expect(erroresDe('campo-elements.Task_Loop.loop')).toEqual([]);
    expect(document.getElementById('campo-elements.Task_Loop.loop.count')).not.toBeNull();
  });

  it('a loop written with both keys falls back to the generic fieldset, with its error, so it can be fixed', () => {
    montar({ [ARCHIVO]: { ...INICIAL, elements: { ...(INICIAL['elements'] as Json), Task_Loop: { loop: { count: 2, probability: 0.5 } } } } });
    irAPaso('times');
    elegirElemento('Task_Loop');
    expect(document.querySelector('select#campo-elements\\.Task_Loop\\.loop')).toBeNull();
    expect(document.getElementById('campo-elements.Task_Loop.loop.count')).not.toBeNull();
    expect(document.getElementById('campo-elements.Task_Loop.loop.probability')).not.toBeNull();
    const caja = document.getElementById('campo-elements.Task_Loop.loop.count')!.closest('fieldset')!;
    expect(caja.querySelector(':scope > p.error')).not.toBeNull();
  });
});

describe('instances (ADR-033 § 4)', () => {
  it('a constant writes instances; a value that is not a number is an error; Not set takes it back', () => {
    montar();
    irAPaso('times');
    elegirElemento('Task_Multi');
    const select = document.getElementById('campo-elements.Task_Multi.instances') as HTMLSelectElement;
    const constante = [...select.options].find((o) => o.textContent === en.escenario.distribuciones['constant'])!;
    elegir('campo-elements.Task_Multi.instances', constante.value);
    teclear('campo-elements.Task_Multi.instances.value', '3');
    expect(elemento('Task_Multi')).toEqual({ instances: { type: 'constant', value: 3 } });
    expect(erroresDe('campo-elements.Task_Multi.instances.value')).toEqual([]);
    // Not a time: no unit beside it, and 3 is stored as 3, whatever `baseTimeUnit` says.
    expect(document.getElementById('campo-elements.Task_Multi.instances.value')!.closest('.campo-schema')!.querySelector('.unidad')).toBeNull();
    teclear('campo-elements.Task_Multi.instances.value', 'abc');
    expect(erroresDe('campo-elements.Task_Multi.instances.value')).toHaveLength(1);
    elegir('campo-elements.Task_Multi.instances', '-1');
    expect(sinVacias(actual)).toEqual(INICIAL);
  });
});

describe('errorProbability (ADR-033 § 5)', () => {
  it('writes errorProbability; out of [0, 1] is an error (E-PROB-RANGO); emptying it takes it back', () => {
    montar();
    irAPaso('routes');
    elegirElemento('Err_Work');
    teclear('campo-elements.Err_Work.errorProbability', '0.25');
    expect(elemento('Err_Work')).toEqual({ errorProbability: 0.25 });
    expect(erroresDe('campo-elements.Err_Work.errorProbability')).toEqual([]);
    teclear('campo-elements.Err_Work.errorProbability', '1.5');
    expect(erroresDe('campo-elements.Err_Work.errorProbability').join(' ')).toContain('outside [0, 1]');
    teclear('campo-elements.Err_Work.errorProbability', '');
    expect(sinVacias(actual)).toEqual(INICIAL);
  });
});

describe('E-PROB-ERROR-SUMA is fixed in Routes, on the activity that hosts the boundaries', () => {
  it('▶ Simulate opens Routes on the host, which lists its boundaries marked, with the sum error', () => {
    montar({ [ARCHIVO]: { ...INICIAL, elements: { ...(INICIAL['elements'] as Json), Err_Work: { errorProbability: 0.7 }, Err_Late: { errorProbability: 0.6 } } } });
    irAPaso('times');
    const simular = document.querySelector<HTMLButtonElement>('button.sim-simular')!;
    act(() => { simular.click(); });
    expect(document.querySelector('.pasos button[data-paso="routes"]')?.getAttribute('aria-selected')).toBe('true');
    const filas = [...document.querySelectorAll('.lista-paso li')];
    expect(filas.map((li) => li.querySelector('button')?.dataset['id'])).toEqual(['Err_Work', 'Err_Late']);
    expect(filas.map((li) => li.querySelector('.resumen')?.textContent)).toEqual([en.escenario.errorEn('70 %', 'Ship'), en.escenario.errorEn('60 %', 'Ship')]);
    expect(filas.every((li) => li.querySelector('.resumen.falta') !== null)).toBe(true);
    expect(document.body.textContent).toContain('1.3');
    // One row opens its boundary; fixing it clears the mark.
    act(() => { filas[1]!.querySelector('button')!.click(); });
    teclear('campo-elements.Err_Late.errorProbability', '0.3');
    elegirElemento('Task_Work');
    expect(document.querySelectorAll('.lista-paso .resumen.falta')).toHaveLength(0);
  });
});

describe('the spreadsheet import carries the new fields (#449)', () => {
  it('a loopCount over an inherited loop probability writes the other key as null; Undo import takes it back', async () => {
    const padre: Json = { ...INICIAL, elements: { ...(INICIAL['elements'] as Json), Task_Loop: { loop: { probability: 0.5 } } } };
    const hijo: Json = { version: 1, name: 'TO-BE', extends: PADRE };
    let delta: Json = hijo;
    function Arnes(): React.JSX.Element {
      const [escenarios, setEscenarios] = useState<Record<string, Json>>({ [PADRE]: padre, [ARCHIVO]: hijo });
      delta = escenarios[ARCHIVO]!;
      const leerEscenario = (ruta: string): Json => escenarios[ruta]!;
      return (
        <ImportarExcel
          archivo={ARCHIVO}
          resuelto={resolveExtends(ARCHIVO, leerEscenario) as Json}
          delta={delta}
          padre={resolveExtends(PADRE, leerEscenario) as Json}
          ir={ir}
          onCambio={(a, e) => { setEscenarios((previos) => ({ ...previos, [a]: e })); }}
        />
      );
    }
    contenedor = document.createElement('div');
    document.body.appendChild(contenedor);
    raiz = createRoot(contenedor);
    act(() => { raiz!.render(<Arnes />); });
    const entrada = contenedor.querySelector<HTMLInputElement>('input[type="file"]')!;
    const csv = 'id;loopCount;instances;errorProbability\nTask_Loop;4;;\nTask_Multi;;2;\nErr_Work;;;0,1\n';
    Object.defineProperty(entrada, 'files', { configurable: true, value: [new File([csv], 'elements.csv')] });
    await act(async () => {
      entrada.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 20 && contenedor!.querySelector('.informe-importar') === null; i++) {
        await new Promise((resolver) => setTimeout(resolver, 5));
      }
    });
    expect(contenedor.querySelector('.informe-importar')?.textContent).toContain(en.escenario.importarCambios(3));
    const pulsar = (texto: string): void => {
      const boton = [...contenedor!.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto)!;
      act(() => { boton.click(); });
    };
    pulsar(en.escenario.importarAplicar);
    expect((delta['elements'] as Json)['Task_Loop']).toEqual({ loop: { probability: null, count: 4 } });
    expect((delta['elements'] as Json)['Task_Multi']).toEqual({ instances: { type: 'constant', value: 2 } });
    expect((delta['elements'] as Json)['Err_Work']).toEqual({ errorProbability: 0.1 });
    const resuelto = parseScenario(resolveExtends(ARCHIVO, (ruta) => (ruta === PADRE ? padre : delta)));
    expect(resuelto.success && resuelto.data.elements?.['Task_Loop']?.loop).toEqual({ count: 4 });
    pulsar(en.escenario.importarDeshacer);
    expect(delta).toEqual(hijo);
  });
});

/* ------------------------------------------------------------------ *
 * The model runs, and what stays unsupported is still flagged
 * ------------------------------------------------------------------ */

describe('the model runs from the app with no E-NOSOP', () => {
  it('the live check finds nothing, and the scenario typed in the panel passes the Run gate and simulates', async () => {
    const informe = await validateBpmnModel(MODELO);
    expect(informe.errors.filter((p) => p.code === 'E-NOSOP')).toEqual([]);

    montar();
    irAPaso('times');
    elegirElemento('Task_Loop');
    elegir('campo-elements.Task_Loop.loop', 'count');
    teclear('campo-elements.Task_Loop.loop.count', '3');
    elegirElemento('Task_Multi');
    const select = document.getElementById('campo-elements.Task_Multi.instances') as HTMLSelectElement;
    elegir('campo-elements.Task_Multi.instances', [...select.options].find((o) => o.textContent === en.escenario.distribuciones['constant'])!.value);
    teclear('campo-elements.Task_Multi.instances.value', '2');
    irAPaso('routes');
    elegirElemento('Err_Work');
    teclear('campo-elements.Err_Work.errorProbability', '0.25');

    const preparado = await prepareSimulation(MODELO, ARCHIVO, { [ARCHIVO]: actual });
    const resultado = simulate(preparado.ir, preparado.scenario as Parameters<typeof simulate>[1]);
    const cuenta = (id: string): number => resultado.elements[id]!.started;
    // 4 cases: 3 iterations each of the loop, 2 instances each of the multi-instance task.
    expect(cuenta('Task_Loop')).toBe(12);
    expect(cuenta('Task_Multi')).toBe(8);
    expect(cuenta('Task_Work')).toBe(4);
    expect(resultado.process.completed).toBe(4);
  });

  it('signal and escalation events are still E-NOSOP', async () => {
    const informe = await validateBpmnModel(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_S" isExecutable="true">
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Task_A" />
    <bpmn:task id="Task_A" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_A" targetRef="Throw_Escalation" />
    <bpmn:intermediateThrowEvent id="Throw_Escalation"><bpmn:escalationEventDefinition /></bpmn:intermediateThrowEvent>
    <bpmn:sequenceFlow id="F3" sourceRef="Throw_Escalation" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:boundaryEvent id="Signal_A" attachedToRef="Task_A"><bpmn:signalEventDefinition /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F4" sourceRef="Signal_A" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`);
    const ids = informe.errors.filter((p) => p.code === 'E-NOSOP').map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['Throw_Escalation', 'Signal_A']));
  });
});
