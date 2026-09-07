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
export const LOCAL_TARGET_MS = 1_000;
export const CI_REGRESSION_MS = 3_000;

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
  source: { exporter: 'Lila benchmark', exporterVersion: '1', originalIds: {}, warnings: [] },
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

interface VerifiedWorkload {
  completedCases: number;
  completedTaskExecutions: number;
}

function runAndVerify(caseCount: number): VerifiedWorkload {
  const result = simulate(LINEAR_IR, linearScenario(caseCount), { log: false });
  if (result.process.started !== caseCount || result.process.completed !== caseCount) {
    throw new Error(
      `E-BENCH-INCOMPLETO: se esperaban ${caseCount} casos; ` +
        `iniciados=${result.process.started}, completados=${result.process.completed}.`,
    );
  }
  let completedTaskExecutions = 0;
  for (let task = 1; task <= BENCHMARK_TASKS; task++) {
    const id = `Task_${task}`;
    const metrics = result.elements[id];
    if (metrics?.started !== caseCount || metrics.completed !== caseCount) {
      throw new Error(
        `E-BENCH-INCOMPLETO: ${id} inició ${String(metrics?.started)} y completó ` +
          `${String(metrics?.completed)} de ${caseCount} casos.`,
      );
    }
    if (
      metrics.processing.min !== 1 ||
      metrics.processing.max !== 1 ||
      metrics.processing.mean !== 1 ||
      metrics.processing.total !== caseCount
    ) {
      throw new Error(`E-BENCH-TRABAJO: ${id} no ejecutó ${caseCount} segundos de processing.`);
    }
    completedTaskExecutions += metrics.completed;
  }
  for (const [flowId, metrics] of Object.entries(result.flows)) {
    if (metrics.count !== caseCount) {
      throw new Error(`E-BENCH-TRABAJO: ${flowId} recibió ${metrics.count} de ${caseCount} tokens.`);
    }
  }
  if (
    result.process.cycleTime.min !== BENCHMARK_TASKS ||
    result.process.cycleTime.max !== BENCHMARK_TASKS ||
    result.process.cycleTime.mean !== BENCHMARK_TASKS
  ) {
    throw new Error(`E-BENCH-TRABAJO: el ciclo lineal no duró exactamente ${BENCHMARK_TASKS} segundos.`);
  }

  return { completedCases: result.process.completed, completedTaskExecutions };
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
  completedCases: number;
  completedTaskExecutions: number;
  elapsedMs: number;
}

/** Ejecuta calentamiento de JIT fuera de la medición y una corrida medida. */
export function runLinearBenchmark(options: LinearBenchmarkOptions = {}): LinearBenchmarkResult {
  const caseCount = options.caseCount ?? BENCHMARK_CASES;
  const warmupCases = options.warmupCases ?? JIT_WARMUP_CASES;
  const warmupRuns = options.warmupRuns ?? JIT_WARMUP_RUNS;

  if (!Number.isInteger(caseCount) || caseCount < 1) {
    throw new RangeError('E-BENCH-CASOS: caseCount debe ser un entero >= 1.');
  }
  if (!Number.isInteger(warmupCases) || warmupCases < 1) {
    throw new RangeError('E-BENCH-CASOS: warmupCases debe ser un entero >= 1.');
  }
  if (!Number.isInteger(warmupRuns) || warmupRuns < 0) {
    throw new RangeError('E-BENCH-WARMUP: warmupRuns debe ser un entero >= 0.');
  }

  for (let run = 0; run < warmupRuns; run++) runAndVerify(warmupCases);

  const startedAt = performance.now();
  if (!Number.isFinite(startedAt) || startedAt < 0) {
    throw new Error('E-BENCH-RELOJ: performance.now() devolvió un inicio inválido.');
  }
  const verified = runAndVerify(caseCount);
  const endedAt = performance.now();
  if (!Number.isFinite(endedAt) || endedAt < startedAt) {
    throw new Error('E-BENCH-RELOJ: performance.now() no fue finito y monótono.');
  }
  const elapsedMs = endedAt - startedAt;

  return {
    caseCount,
    taskCount: BENCHMARK_TASKS,
    warmupCases,
    warmupRuns,
    ...verified,
    elapsedMs,
  };
}
