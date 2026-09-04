/**
 * Fixture y runner compartidos por el benchmark reproducible de LILA-031 y su prueba de
 * regresión. El modelo evita parser, disco y azar deliberadamente: mide solo la API pública
 * `simulate` sobre un flujo lineal de cinco tareas y 100 000 casos.
 */

import { simulate } from '../src/index.js';
import type { ProcessIR, SimScenario } from '../src/index.js';

export const BENCHMARK_CASES = 100_000;
export const BENCHMARK_TASKS = 5;
export const JIT_WARMUP_CASES = 2_000;
export const JIT_WARMUP_RUNS = 3;

export const LINEAR_IR: ProcessIR = {
  id: 'Process_Performance',
  name: 'Benchmark lineal de cinco tareas',
  nodes: {
    Start: { type: 'start', name: 'Inicio', incoming: [], outgoing: ['Flow_Start_Task1'] },
    Task_1: {
      type: 'task',
      name: 'Tarea 1',
      incoming: ['Flow_Start_Task1'],
      outgoing: ['Flow_Task1_Task2'],
    },
    Task_2: {
      type: 'task',
      name: 'Tarea 2',
      incoming: ['Flow_Task1_Task2'],
      outgoing: ['Flow_Task2_Task3'],
    },
    Task_3: {
      type: 'task',
      name: 'Tarea 3',
      incoming: ['Flow_Task2_Task3'],
      outgoing: ['Flow_Task3_Task4'],
    },
    Task_4: {
      type: 'task',
      name: 'Tarea 4',
      incoming: ['Flow_Task3_Task4'],
      outgoing: ['Flow_Task4_Task5'],
    },
    Task_5: {
      type: 'task',
      name: 'Tarea 5',
      incoming: ['Flow_Task4_Task5'],
      outgoing: ['Flow_Task5_End'],
    },
    End: { type: 'end', name: 'Fin', incoming: ['Flow_Task5_End'], outgoing: [] },
  },
  flows: {
    Flow_Start_Task1: { from: 'Start', to: 'Task_1', name: '', isDefault: false },
    Flow_Task1_Task2: { from: 'Task_1', to: 'Task_2', name: '', isDefault: false },
    Flow_Task2_Task3: { from: 'Task_2', to: 'Task_3', name: '', isDefault: false },
    Flow_Task3_Task4: { from: 'Task_3', to: 'Task_4', name: '', isDefault: false },
    Flow_Task4_Task5: { from: 'Task_4', to: 'Task_5', name: '', isDefault: false },
    Flow_Task5_End: { from: 'Task_5', to: 'End', name: '', isDefault: false },
  },
  source: { exporter: 'Lila benchmark', exporterVersion: '1', originalIds: {} },
};

function linearScenario(caseCount: number): SimScenario {
  return {
    run: { seed: 42 },
    elements: {
      Start: {
        interTriggerTimer: { type: 'constant', value: 1 },
        triggerCount: caseCount,
      },
      Task_1: { processingTime: { type: 'constant', value: 1 } },
      Task_2: { processingTime: { type: 'constant', value: 1 } },
      Task_3: { processingTime: { type: 'constant', value: 1 } },
      Task_4: { processingTime: { type: 'constant', value: 1 } },
      Task_5: { processingTime: { type: 'constant', value: 1 } },
    },
  };
}

function runAndVerify(caseCount: number): void {
  const result = simulate(LINEAR_IR, linearScenario(caseCount), { log: false });
  if (result.process.started !== caseCount || result.process.completed !== caseCount) {
    throw new Error(
      `E-BENCH-INCOMPLETO: se esperaban ${caseCount} casos; ` +
        `iniciados=${result.process.started}, completados=${result.process.completed}.`,
    );
  }
  for (let task = 1; task <= BENCHMARK_TASKS; task++) {
    const completed = result.elements[`Task_${task}`]?.completed;
    if (completed !== caseCount) {
      throw new Error(`E-BENCH-INCOMPLETO: Task_${task} completó ${String(completed)} de ${caseCount} casos.`);
    }
  }
}

export interface LinearBenchmarkOptions {
  caseCount?: number | undefined;
  warmupCases?: number | undefined;
  warmupRuns?: number | undefined;
}

export interface LinearBenchmarkResult {
  caseCount: number;
  taskCount: number;
  warmupCases: number;
  warmupRuns: number;
  elapsedMs: number;
}

/** Ejecuta calentamiento de JIT fuera de la medición y una corrida medida. */
export function runLinearBenchmark(options: LinearBenchmarkOptions = {}): LinearBenchmarkResult {
  const caseCount = options.caseCount ?? BENCHMARK_CASES;
  const warmupCases = options.warmupCases ?? JIT_WARMUP_CASES;
  const warmupRuns = options.warmupRuns ?? JIT_WARMUP_RUNS;

  for (let run = 0; run < warmupRuns; run++) runAndVerify(warmupCases);

  const startedAt = performance.now();
  runAndVerify(caseCount);
  const elapsedMs = performance.now() - startedAt;

  return { caseCount, taskCount: BENCHMARK_TASKS, warmupCases, warmupRuns, elapsedMs };
}
