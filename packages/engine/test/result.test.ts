import { expect, test } from 'vitest';
import { runResultSchema, eventLogRowSchema } from '../src/result.schema.js';
import type { RunResult } from '../src/core/result.js';

function exampleRunResult(): RunResult {
  return {
    elements: {
      Task_7f3k2q1: {
        started: 120,
        completed: 118,
        processing: { min: 30, max: 300, mean: 120, total: 14160 },
        resourceWait: { min: 0, max: 600, mean: 45, sd: 60, total: 5310 },
        offHoursWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
        queueLength: { mean: 1.2, max: 5 },
        fixedCostTotal: 295,
      },
    },
    flows: {
      Flow_a1: { count: 120 },
    },
    resources: {
      cajero: {
        utilization: 0.62,
        busyTime: 43200,
        fixedCost: 0,
        unitCost: 2640,
        totalCost: 2640,
      },
    },
    process: {
      started: 120,
      completed: 118,
      inFlight: 2,
      cycleTime: { min: 60, max: 1200, mean: 300, sd: 120, p50: 280, p90: 550, p95: 700 },
      waitTime: { min: 0, max: 900, mean: 80, sd: 90, p50: 60, p90: 200, p95: 300 },
      throughputPerHour: 4.9,
      costPerCase: 25,
      totalCost: 2950,
    },
    bottlenecks: [{ elementId: 'Task_7f3k2q1', resourceWaitTotal: 5310, utilization: 0.62 }],
    replications: {
      count: 30,
      kpis: {
        'process.cycleTime.mean': { mean: 300, sd: 20, ci95: [292, 308] },
      },
    },
    warnings: ['probabilidades de Gateway_a9 normalizadas: sumaban 0.9'],
  };
}

test('un RunResult de ejemplo válido pasa la validación', () => {
  const result = runResultSchema.safeParse(exampleRunResult());
  expect(result.success).toBe(true);
});

test('un RunResult sin `replications` también es válido (campo opcional)', () => {
  const { replications, ...withoutReplications } = exampleRunResult();
  const result = runResultSchema.safeParse(withoutReplications);
  expect(result.success).toBe(true);
});

test('un RunResult con un campo faltante falla la validación', () => {
  const example = exampleRunResult() as Record<string, unknown>;
  delete example.process;

  const result = runResultSchema.safeParse(example);
  expect(result.success).toBe(false);
});

test('un RunResult con un campo anidado faltante falla la validación', () => {
  const example = exampleRunResult();
  // @ts-expect-error -- se borra a propósito para probar que falla
  delete example.elements.Task_7f3k2q1.processing;

  const result = runResultSchema.safeParse(example);
  expect(result.success).toBe(false);
});

test('una fila de event log válida pasa la validación', () => {
  const result = eventLogRowSchema.safeParse({
    replication: 0,
    caseId: 'case-1',
    elementId: 'Task_7f3k2q1',
    resourceId: 'cajero',
    enabledAt: 10,
    startedAt: 15,
    endedAt: 135,
    resourceWait: 5,
    offHoursWait: 0,
    cost: 25,
  });
  expect(result.success).toBe(true);
});

test('una fila de event log sin recurso usa resourceId: null', () => {
  const result = eventLogRowSchema.safeParse({
    replication: 0,
    caseId: 'case-1',
    elementId: 'Timer_reposo',
    resourceId: null,
    enabledAt: 10,
    startedAt: 10,
    endedAt: 610,
    resourceWait: 0,
    offHoursWait: 0,
    cost: 0,
  });
  expect(result.success).toBe(true);
});

test('una fila de event log con un campo faltante falla', () => {
  const result = eventLogRowSchema.safeParse({
    replication: 0,
    caseId: 'case-1',
    elementId: 'Task_7f3k2q1',
    resourceId: 'cajero',
    enabledAt: 10,
    startedAt: 15,
    // endedAt falta
    resourceWait: 5,
    offHoursWait: 0,
    cost: 25,
  });
  expect(result.success).toBe(false);
});
