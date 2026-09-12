/**
 * #81 — temporizador de borde interruptor sobre una tarea (R-BND-1…9 de `docs/SEMANTICS.md` § 9).
 *
 * Todo con distribuciones constantes, una replicación y `seed: 42`: lo que se comprueba es la
 * semántica del corte, no el muestreo.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { parseBpmn } from '../src/bpmn/parse.js';
import { validate } from '../src/bpmn/validate.js';
import type { ProcessIR } from '../src/core/ir.js';
import { simulate, type SimulationProgress } from '../src/core/run.js';
import type { EventLogRow, RunResult } from '../src/core/result.js';
import { validateScenario } from '../src/scenario.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(here, 'fixtures/boundary-timer.bpmn');

const seconds = (value: number) => ({ type: 'constant' as const, value });

type Scenario = Parameters<typeof simulate>[1];

async function irOf(xml: string): Promise<ProcessIR> {
  const { ir, unsupported } = await parseBpmn(xml);
  expect(validate(ir, { unsupported }).errors).toEqual([]);
  return ir;
}

const model = async (): Promise<ProcessIR> => irOf(readFileSync(fixture, 'utf8'));

/** El instante en que paró la replicación: `run.stoppedAt` solo se asoma por `onProgress`. */
function runWithStop(ir: ProcessIR, scenario: Scenario): { result: RunResult; stoppedAt: number } {
  let stoppedAt = 0;
  const onProgress = (progress: SimulationProgress): void => {
    stoppedAt = progress.simulatedTime;
  };
  return { result: simulate(ir, scenario, { onProgress }), stoppedAt };
}

const rowsOf = (result: RunResult, elementId: string): EventLogRow[] =>
  (result.log ?? []).filter((row) => row.elementId === elementId);

test('el borde no vence antes que la tarea: la tarea completa y el reloj no llega al plazo', async () => {
  const ir = await model();
  const { result, stoppedAt } = runWithStop(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Task_Revisar: { processingTime: seconds(50) },
      Boundary_3a1f: { processingTime: seconds(100) },
      Task_Cancelar: { processingTime: seconds(5) },
    },
  });

  expect(result.elements['Task_Revisar']?.completed).toBe(1);
  expect(result.elements['Boundary_3a1f']?.started).toBe(0);
  expect(result.process.byEndEvent['End_Proceso']?.completed).toBe(1);
  expect(result.process.byEndEvent['End_Cancelado']?.completed).toBe(0);
  // R-BND-9 / R-ARR-3: el borde muerto se descarta sin adelantar el reloj hasta 100.
  expect(stoppedAt).toBe(50);
});

test('el borde vence primero: corta la tarea, cuenta un disparo y sigue por su rama', async () => {
  const ir = await model();
  const scenario = {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Task_Revisar: { processingTime: seconds(200) },
      Boundary_3a1f: { processingTime: seconds(100) },
      Task_Cancelar: { processingTime: seconds(5) },
    },
  };
  const result = simulate(ir, scenario);

  const [revisar] = rowsOf(result, 'Task_Revisar');
  expect(revisar?.status).toBe('interrupted');
  expect(revisar?.endedAt).toBeNull();
  expect(revisar?.observedUntil).toBe(100);
  // R-BND-5: el host ya contó `started`; no completa. El borde cuenta un disparo entero.
  expect(result.elements['Task_Revisar']).toMatchObject({ started: 1, completed: 0 });
  expect(result.elements['Boundary_3a1f']).toMatchObject({ started: 1, completed: 1 });
  expect(result.elements['Task_Cancelar']?.completed).toBe(1);
  expect(result.process.byEndEvent['End_Cancelado']?.completed).toBe(1);
  expect(result.process.byEndEvent['End_Proceso']?.completed).toBe(0);
  // El borde no emite fila de log propia (techo declarado de esta entrega).
  expect(rowsOf(result, 'Boundary_3a1f')).toEqual([]);
  // Con `processingTime` declarado, el borde no es un elemento sin parámetros.
  const lint = validateScenario(scenario as never, ir);
  expect(lint.filter((problem) => problem.path === 'elements.Boundary_3a1f')).toEqual([]);
});

test('la interrupción libera el recurso: el caso que esperaba arranca en ese mismo instante', async () => {
  const ir = await model();
  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    resources: { revisor: { capacity: 1, costPerHour: 36 } },
    elements: {
      Start_Proceso: { interTriggerTimer: seconds(10), triggerCount: 2 },
      Task_Revisar: { processingTime: seconds(200), resources: [{ ref: 'revisor' }] },
      Boundary_3a1f: { processingTime: seconds(100) },
      Task_Cancelar: { processingTime: seconds(5) },
    },
  });

  const [primero, segundo] = rowsOf(result, 'Task_Revisar');
  expect(primero).toMatchObject({ caseId: '1', status: 'interrupted', startedAt: 0, observedUntil: 100 });
  // R-BND-5: se cobra la ocupación hasta el instante del corte, no la duración prevista.
  expect(primero?.resourceCost).toBeCloseTo(1, 10);
  // El segundo caso estaba en cola desde t = 10 y la cancelación le concede la unidad en t = 100.
  expect(segundo).toMatchObject({ caseId: '2', enabledAt: 10, startedAt: 100 });
});

test('un `terminate` cierra la tarea antes del plazo y el borde zombi no mueve el reloj', async () => {
  const ir = await irOf(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_Terminate" isExecutable="true">
    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Fork" sourceRef="Start_Proceso" targetRef="Gateway_Fork" />
    <bpmn:parallelGateway id="Gateway_Fork" />
    <bpmn:sequenceFlow id="Flow_Fork_Revisar" sourceRef="Gateway_Fork" targetRef="Task_Revisar" />
    <bpmn:sequenceFlow id="Flow_Fork_Espera" sourceRef="Gateway_Fork" targetRef="Timer_Espera" />
    <bpmn:task id="Task_Revisar" name="Revisar" />
    <bpmn:sequenceFlow id="Flow_Revisar_Fin" sourceRef="Task_Revisar" targetRef="End_Proceso" />
    <bpmn:boundaryEvent id="Boundary_3a1f" name="Vence el plazo" attachedToRef="Task_Revisar">
      <bpmn:timerEventDefinition id="Timer_Plazo" />
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_Boundary_Cancelar" sourceRef="Boundary_3a1f" targetRef="End_Cancelado" />
    <bpmn:intermediateCatchEvent id="Timer_Espera">
      <bpmn:timerEventDefinition id="Timer_Espera_Def" />
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_Espera_Terminate" sourceRef="Timer_Espera" targetRef="End_Terminate" />
    <bpmn:endEvent id="End_Terminate">
      <bpmn:terminateEventDefinition id="Terminate_Def" />
    </bpmn:endEvent>
    <bpmn:endEvent id="End_Cancelado" />
    <bpmn:endEvent id="End_Proceso" />
  </bpmn:process>
</bpmn:definitions>`);

  const { result, stoppedAt } = runWithStop(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Task_Revisar: { processingTime: seconds(50) },
      Boundary_3a1f: { processingTime: seconds(100) },
      Timer_Espera: { processingTime: seconds(10) },
    },
  });

  expect(rowsOf(result, 'Task_Revisar')[0]).toMatchObject({ status: 'terminated', observedUntil: 10 });
  expect(result.elements['Boundary_3a1f']?.started).toBe(0);
  expect(result.process.byEndEvent['End_Terminate']?.completed).toBe(1);
  // El `done` zombi de la tarea sí llega al heap en t = 50 (R-EVT-5 lo descarta allí); lo que
  // R-BND-9 garantiza es que el borde no estire la corrida hasta su plazo de 100.
  expect(stoppedAt).toBe(50);
});

test('un borde sin `processingTime` avisa una vez y nunca interrumpe', async () => {
  const ir = await model();
  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { interTriggerTimer: seconds(500), triggerCount: 2 },
      Task_Revisar: { processingTime: seconds(50) },
      Task_Cancelar: { processingTime: seconds(5) },
    },
  });

  const avisos = result.warnings.filter((warning) => warning.startsWith('W-BORDE-SIN-TIEMPO'));
  expect(avisos).toHaveLength(1);
  expect(avisos[0]).toContain('Boundary_3a1f');
  expect(avisos[0]).toContain('Task_Revisar');
  expect(result.elements['Task_Revisar']?.completed).toBe(2);
  expect(result.elements['Boundary_3a1f']?.started).toBe(0);
});

test('`resources` en un borde es `E-TIMER-RECURSO`, como en cualquier otro timer', async () => {
  const ir = await model();
  const problems = validateScenario(
    {
      run: { seed: 42, replications: 1 },
      resources: { revisor: { capacity: 1 } },
      elements: {
        Start_Proceso: { triggerCount: 1 },
        Task_Revisar: { processingTime: seconds(50) },
        Boundary_3a1f: { processingTime: seconds(100), resources: [{ ref: 'revisor' }] },
        Task_Cancelar: { processingTime: seconds(5) },
      },
    } as never,
    ir,
  );

  expect(problems.filter((problem) => problem.code === 'E-TIMER-RECURSO')).toMatchObject([
    { path: 'elements.Boundary_3a1f.resources', severity: 'error' },
  ]);
});
