import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { parseBpmn } from '../../src/bpmn/parse.js';
import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import type { EventLogRow, RunResult } from '../../src/core/result.js';
import { simulate } from '../../src/core/run.js';
import { runReplication, type ReplicationRun, type SimScenario } from '../../src/core/sim.js';

/**
 * QA adversarial de LILA-036 (agente distinto al implementador).
 *
 * Cada cifra está recalculada a mano en el comentario que la precede, sobre un caso **distinto**
 * al de `metrics-level3.test.ts`. Todo es `constant`: no hay tolerancia estadística salvo en los
 * dos sitios donde el float64 la exige.
 */

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

function makeIr(
  nodes: Record<string, NodeType>,
  flows: Record<string, readonly [from: string, to: string]>,
): ProcessIR {
  const irNodes: Record<string, Node> = {};
  for (const [id, type] of Object.entries(nodes)) {
    irNodes[id] = { type, name: '', incoming: [], outgoing: [] };
  }
  const irFlows: Record<string, Flow> = {};
  for (const [id, [from, to]] of Object.entries(flows)) {
    irFlows[id] = { from, to, name: '', isDefault: false };
    irNodes[from]!.outgoing.push(id);
    irNodes[to]!.incoming.push(id);
  }
  return {
    id: 'Process_Qa036',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

/** Recorre todo número publicado y devuelve los paths con NaN o ±Infinity. */
function nonFinitePaths(result: RunResult): string[] {
  const found: string[] = [];
  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) found.push(path);
      return;
    }
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, path === '' ? key : `${path}.${key}`);
  };
  visit(result, '');
  return found;
}

/** Construye una `ReplicationRun` sintética para atacar el agregador sin pasar por el DES. */
function syntheticRun(
  rows: readonly Partial<EventLogRow>[],
  options: { stoppedAt: number; statisticsDuration: number; elementIds: readonly string[] },
): ReplicationRun {
  const full: EventLogRow[] = rows.map((row, index) => ({
    replication: 0,
    caseId: String(index + 1),
    activityInstanceId: String(index + 1),
    elementId: 'Task',
    resourceId: null,
    allocationIndex: null,
    resourceQuantity: null,
    status: 'completed' as const,
    enabledAt: 0,
    startedAt: 0,
    endedAt: 0,
    observedUntil: 0,
    resourceWait: 0,
    offHoursWait: 0,
    elementCost: 0,
    resourceCost: 0,
    cost: 0,
    ...row,
  }));
  const caseIds = [...new Set(full.map((row) => row.caseId))];
  const elements: Record<string, { started: number; completed: number }> = {};
  for (const id of options.elementIds) elements[id] = { started: 0, completed: 0 };
  return {
    replication: 0,
    stoppedAt: options.stoppedAt,
    statisticsDuration: options.statisticsDuration,
    cases: caseIds.map((caseId) => ({
      caseId: Number(caseId),
      startId: 'Start',
      startedAt: 0,
      endedAt: options.stoppedAt,
    })),
    rows: full,
    flows: {},
    elements,
    warnings: [],
  };
}

/* ------------------------------------------------------------------ *
 * 1. Caso a mano distinto: cadena de tres tareas, dos pools, 1 y 2 unidades
 * ------------------------------------------------------------------ */

const CHAIN_IR = makeIr(
  { Start: 'start', A: 'task', B: 'task', C: 'task', End: 'end' },
  { F1: ['Start', 'A'], F2: ['A', 'B'], F3: ['B', 'C'], F4: ['C', 'End'] },
);

/**
 * Llegadas constantes cada 5 s (0, 5, 10). `pica` capacidad 1 (cantidad 1, 4 s de proceso) y
 * `mesa` capacidad 2 (cantidad 2, 6 s de proceso, o sea el pool entero por instancia). `C` no
 * pide recursos (2 s).
 *
 * Traza a mano:
 *   caso 1: A [0,4)  B [4,10)  C [10,12)
 *   caso 2: A [5,9)  B espera 9→10, [10,16) C [16,18)
 *   caso 3: A [10,14) B espera 14→16, [16,22) C [22,24)
 * El heap se vacía en 24 ⇒ `stoppedAt = statisticsDuration = 24`.
 */
const CHAIN_SCENARIO: SimScenario = {
  run: { seed: 11 },
  resources: {
    pica: { capacity: 1, fixedCost: 3, costPerHour: 1800 },
    mesa: { capacity: 2, fixedCost: 7, costPerHour: 900 },
  },
  elements: {
    Start: { interTriggerTimer: { type: 'constant', value: 5 }, triggerCount: 3 },
    A: { processingTime: { type: 'constant', value: 4 }, fixedCost: 11, resources: [{ ref: 'pica', quantity: 1 }] },
    B: { processingTime: { type: 'constant', value: 6 }, fixedCost: 0.5, resources: [{ ref: 'mesa', quantity: 2 }] },
    C: { processingTime: { type: 'constant', value: 2 }, fixedCost: 2 },
  },
};

describe('QA LILA-036 · caso recalculado a mano: tres tareas, dos pools', () => {
  const run = runReplication(CHAIN_IR, CHAIN_SCENARIO);
  const result = aggregateReplication(CHAIN_IR, run, CHAIN_SCENARIO);

  test('la traza es la esperada: arranques 0/5/10 en A y 4/10/16 en B', () => {
    expect(run.stoppedAt).toBe(24);
    expect(run.statisticsDuration).toBe(24);
    const starts = (elementId: string): (number | null)[] =>
      run.rows.filter((row) => row.elementId === elementId).map((row) => row.startedAt);
    expect(starts('A')).toEqual([0, 5, 10]);
    // B ocupa las 2 unidades del pool, así que se serializa: 4, 10, 16.
    expect(starts('B')).toEqual([4, 10, 16]);
    expect(starts('C')).toEqual([10, 16, 22]);
  });

  test('resourceWait por elemento, con sd muestral calculada a mano', () => {
    // A nunca espera: {0, 0, 0}.
    expect(result.elements.A?.resourceWait).toEqual({ min: 0, max: 0, mean: 0, sd: 0, total: 0 });
    // B espera {0, 1, 2}: media 1, sd = sqrt(((0−1)² + 0 + (2−1)²)/2) = 1, total 3.
    expect(result.elements.B?.resourceWait).toEqual({ min: 0, max: 2, mean: 1, sd: 1, total: 3 });
    // C no pide recursos: espera cero, y por tanto tampoco forma cola.
    expect(result.elements.C?.resourceWait).toEqual({ min: 0, max: 0, mean: 0, sd: 0, total: 0 });
  });

  test('processing por elemento sale de la identidad R-CAL-8, no de endedAt − startedAt', () => {
    expect(result.elements.A?.processing).toEqual({ min: 4, max: 4, mean: 4, total: 12 });
    expect(result.elements.B?.processing).toEqual({ min: 6, max: 6, mean: 6, total: 18 });
    expect(result.elements.C?.processing).toEqual({ min: 2, max: 2, mean: 2, total: 6 });
  });

  test('queueLength ponderada por tiempo sobre la ventana de 24 s', () => {
    // B: intervalos [9,10) y [14,16) ⇒ integral 1 + 2 = 3 ⇒ mean 3/24 = 0.125, max 1.
    expect(result.elements.B?.queueLength).toEqual({ mean: 0.125, max: 1 });
    // A y C nunca esperan: intervalo de longitud cero, que no forma cola.
    expect(result.elements.A?.queueLength).toEqual({ mean: 0, max: 0 });
    expect(result.elements.C?.queueLength).toEqual({ mean: 0, max: 0 });
  });

  test('utilización, busyTime y costos por pool', () => {
    // pica: 3 filas × 1 unidad × 4 s = 12 s-unidad; capacidad 1 × 24 s ⇒ 0.5.
    // fijo 3 × 3 usos = 9; hora 1800 × 12/3600 = 6.
    expect(result.resources.pica).toEqual({
      utilization: 0.5,
      busyTime: 12,
      fixedCost: 9,
      unitCost: 6,
      totalCost: 15,
    });
    // mesa: 3 filas × 2 unidades × 6 s = 36 s-unidad; capacidad 2 × 24 s = 48 ⇒ 0.75.
    // usos = Σ quantity = 6 ⇒ fijo 7 × 6 = 42; hora 900 × 36/3600 = 9.
    expect(result.resources.mesa).toEqual({
      utilization: 0.75,
      busyTime: 36,
      fixedCost: 42,
      unitCost: 9,
      totalCost: 51,
    });
  });

  test('las identidades de costo cierran contra el log fila por fila', () => {
    const sum = (pick: (row: EventLogRow) => number): number => run.rows.reduce((total, row) => total + pick(row), 0);
    const resourceTotal = result.resources.pica!.totalCost + result.resources.mesa!.totalCost;
    // Σ resources[*].totalCost = Σ row.resourceCost (R-COST-4).
    expect(sum((row) => row.resourceCost)).toBeCloseTo(resourceTotal, 10);
    expect(resourceTotal).toBeCloseTo(66, 10);
    // fixedCostTotal = Σ row.elementCost, nunca Σ row.cost.
    expect(result.elements.A?.fixedCostTotal).toBe(33); // 11 × 3
    expect(result.elements.B?.fixedCostTotal).toBe(1.5); // 0.5 × 3
    expect(result.elements.C?.fixedCostTotal).toBe(6); // 2 × 3
    expect(sum((row) => row.elementCost)).toBeCloseTo(40.5, 10);
    // process.totalCost = Σ row.cost = Σ elementCost + Σ resourceCost.
    expect(result.process.totalCost).toBeCloseTo(106.5, 10);
    expect(result.process.totalCost).toBeCloseTo(sum((row) => row.cost), 10);
    expect(result.process.costPerCase).toBeCloseTo(35.5, 10); // 106.5 / 3 casos
  });

  test('métricas de proceso: ciclo 12/13/14, espera 0/1/2, throughput sobre la ventana', () => {
    expect(result.process.cycleTime).toEqual({ min: 12, max: 14, mean: 13, sd: 1, p50: 13, p90: 13.8, p95: 13.9 });
    expect(result.process.waitTime).toEqual({ min: 0, max: 2, mean: 1, sd: 1, p50: 1, p90: 1.8, p95: 1.9 });
    expect(result.process.throughputPerHour).toBeCloseTo(450, 10); // 3 / (24/3600)
    expect(result.process.inFlight).toBe(0);
  });

  test('el ranking señala a B con la utilización de su pool, y A no aparece', () => {
    expect(result.bottlenecks).toEqual([{ elementId: 'B', resourceWaitTotal: 3, utilization: 0.75 }]);
  });

  test('ningún número publicado es NaN ni infinito', () => {
    expect(nonFinitePaths(result)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 2. sd con n = 1 y n = 0
 * ------------------------------------------------------------------ */

describe('QA LILA-036 · sd con muestras degeneradas', () => {
  const ir = makeIr({ Start: 'start', Task: 'task', End: 'end' }, { F1: ['Start', 'Task'], F2: ['Task', 'End'] });

  test('n = 1 da sd 0, no NaN (la varianza muestral divide entre n − 1)', () => {
    const scenario: SimScenario = {
      run: { seed: 3 },
      resources: { solo: { capacity: 1, costPerHour: 60 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        Task: { processingTime: { type: 'constant', value: 7 }, resources: [{ ref: 'solo' }] },
      },
    };
    const result = aggregateReplication(ir, runReplication(ir, scenario), scenario);
    expect(result.elements.Task?.resourceWait).toEqual({ min: 0, max: 0, mean: 0, sd: 0, total: 0 });
    expect(result.elements.Task?.processing).toEqual({ min: 7, max: 7, mean: 7, total: 7 });
    expect(result.process.cycleTime.sd).toBe(0);
    expect(result.process.waitTime.sd).toBe(0);
    expect(nonFinitePaths(result)).toEqual([]);
  });

  test('n = 0 (ninguna instancia completada) deja todo en cero, no en NaN', () => {
    const scenario: SimScenario = {
      run: { seed: 3, duration: 2 },
      resources: { solo: { capacity: 1, costPerHour: 60 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        Task: { processingTime: { type: 'constant', value: 100 }, resources: [{ ref: 'solo' }] },
      },
    };
    const result = aggregateReplication(ir, runReplication(ir, scenario), scenario);
    expect(result.process.completed).toBe(0);
    expect(result.elements.Task?.resourceWait.sd).toBe(0);
    expect(result.elements.Task?.processing).toEqual({ min: 0, max: 0, mean: 0, total: 0 });
    expect(result.process.cycleTime).toEqual({ min: 0, max: 0, mean: 0, sd: 0, p50: 0, p90: 0, p95: 0 });
    // costPerCase con cero casos completados: 0, ni NaN ni Infinity.
    expect(result.process.costPerCase).toBe(0);
    expect(nonFinitePaths(result)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 3. queueLength: eventos simultáneos y recorte por warmup
 * ------------------------------------------------------------------ */

describe('QA LILA-036 · integral de cola en los bordes', () => {
  const ir = makeIr({ Start: 'start', Task: 'task', End: 'end' }, { F1: ['Start', 'Task'], F2: ['Task', 'End'] });
  const elementIds = ['Start', 'Task', 'End'];

  test('tres instancias con el mismo enabledAt: la cola arranca en 3 y decae de una en una', () => {
    // [0,5), [0,10), [0,15) sobre una ventana de 20 s.
    // Integral = 3·5 + 2·5 + 1·5 = 30 ⇒ mean 1.5, max 3.
    const run = syntheticRun(
      [
        { enabledAt: 0, startedAt: 5, endedAt: 5, observedUntil: 5, resourceWait: 5 },
        { enabledAt: 0, startedAt: 10, endedAt: 10, observedUntil: 10, resourceWait: 10 },
        { enabledAt: 0, startedAt: 15, endedAt: 15, observedUntil: 15, resourceWait: 15 },
      ],
      { stoppedAt: 20, statisticsDuration: 20, elementIds },
    );
    const result = aggregateReplication(ir, run, { run: {} });
    expect(result.elements.Task?.queueLength).toEqual({ mean: 1.5, max: 3 });
  });

  test('salidas y entradas simultáneas: el máximo nunca cuenta al que sale con el que entra', () => {
    // [0,10), [10,20), [10,20): en t = 10 salen 1 y entran 2 ⇒ la cola vale 2, no 3.
    // Integral = 1·10 + 2·10 = 30 sobre 20 s ⇒ mean 1.5, max 2.
    const run = syntheticRun(
      [
        { enabledAt: 0, startedAt: 10, endedAt: 10, observedUntil: 10, resourceWait: 10 },
        { enabledAt: 10, startedAt: 20, endedAt: 20, observedUntil: 20, resourceWait: 10 },
        { enabledAt: 10, startedAt: 20, endedAt: 20, observedUntil: 20, resourceWait: 10 },
      ],
      { stoppedAt: 20, statisticsDuration: 20, elementIds },
    );
    const result = aggregateReplication(ir, run, { run: {} });
    expect(result.elements.Task?.queueLength).toEqual({ mean: 1.5, max: 2 });
  });

  test('el warmup corta la cola a mitad: solo cuenta la parte dentro de [warmup, t_stop]', () => {
    // Ventana [5, 20). Instancia encolada [2, 8) ⇒ recortada a [5, 8) = 3 s.
    // Instancia encolada [12, 16) ⇒ íntegra, 4 s. Integral = 7 sobre 15 s.
    const run = syntheticRun(
      [
        { enabledAt: 2, startedAt: 8, endedAt: 8, observedUntil: 8, resourceWait: 6 },
        { enabledAt: 12, startedAt: 16, endedAt: 16, observedUntil: 16, resourceWait: 4 },
      ],
      { stoppedAt: 20, statisticsDuration: 15, elementIds },
    );
    const result = aggregateReplication(ir, run, { run: {} });
    expect(result.elements.Task?.queueLength.mean).toBeCloseTo(7 / 15, 12);
    expect(result.elements.Task?.queueLength.max).toBe(1);
  });

  test('una instancia todavía en cola al cortar aporta [enabledAt, observedUntil)', () => {
    const run = syntheticRun(
      [{ enabledAt: 4, startedAt: null, endedAt: null, observedUntil: 10, status: 'inFlight', resourceWait: 6 }],
      { stoppedAt: 10, statisticsDuration: 10, elementIds },
    );
    const result = aggregateReplication(ir, run, { run: {} });
    expect(result.elements.Task?.queueLength).toEqual({ mean: 0.6, max: 1 });
    // Pero su espera censurada no entra en las estadísticas por instancia.
    expect(result.elements.Task?.resourceWait.total).toBe(0);
  });

  test('con la ventana en cero la cola es cero, no una división por cero', () => {
    const run = syntheticRun(
      [{ enabledAt: 0, startedAt: 5, endedAt: 5, observedUntil: 5, resourceWait: 5 }],
      { stoppedAt: 5, statisticsDuration: 0, elementIds },
    );
    const result = aggregateReplication(ir, run, { run: {} });
    expect(result.elements.Task?.queueLength.mean).toBe(0);
    expect(nonFinitePaths(result)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Utilización en los bordes: warmup + duration, capacity 0, pool ocioso
 * ------------------------------------------------------------------ */

describe('QA LILA-036 · utilización en los bordes', () => {
  const ir = makeIr({ Start: 'start', Task: 'task', End: 'end' }, { F1: ['Start', 'Task'], F2: ['Task', 'End'] });

  test('la ventana es statisticsDuration, no la corrida completa (warmup + duration)', () => {
    // Llegadas cada 6 s, proceso 6 s, capacidad 1, warmup 12, duration 30 ⇒ ventana [12, 30) = 18 s.
    // Casos medidos: los que nacen en 12, 18 y 24; cada uno ocupa 6 s dentro de la ventana
    // salvo el de 24, que ocupa [24,30) completo. busyTime = 18 ⇒ utilización 1.
    const scenario: SimScenario = {
      run: { seed: 4, warmup: 12, duration: 30 },
      resources: { w: { capacity: 1, costPerHour: 3600 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 6 }, triggerCount: 100 },
        Task: { processingTime: { type: 'constant', value: 6 }, resources: [{ ref: 'w' }] },
      },
    };
    const run = runReplication(ir, scenario);
    const result = aggregateReplication(ir, run, scenario);
    expect(run.stoppedAt).toBe(30);
    expect(run.statisticsDuration).toBe(18);
    expect(result.resources.w?.busyTime).toBe(18);
    expect(result.resources.w?.utilization).toBe(1);
    // 3600/h × 18 s = 18 de costo por hora; sin fijo declarado, R-COST-5 lo deja en 0.
    expect(result.resources.w?.totalCost).toBeCloseTo(18, 10);
    expect(nonFinitePaths(result)).toEqual([]);
  });

  test('capacity 0 no produce NaN aunque el preflight del DES la rechace', () => {
    // `assertSupportedResourceScenario` exige capacity >= 1, así que este camino solo se
    // alcanza llamando al agregador directamente: la guarda de división debe seguir viva.
    const run = syntheticRun(
      [{ elementId: 'Task', enabledAt: 0, startedAt: 0, endedAt: 4, observedUntil: 4, resourceId: 'w', resourceQuantity: 1, allocationIndex: 0 }],
      { stoppedAt: 10, statisticsDuration: 10, elementIds: ['Start', 'Task', 'End'] },
    );
    const result = aggregateReplication(ir, run, { run: {}, resources: { w: { capacity: 0 } } });
    expect(result.resources.w?.utilization).toBe(0);
    expect(result.resources.w?.busyTime).toBe(4);
    expect(nonFinitePaths(result)).toEqual([]);
  });

  test('un pool declarado y jamás usado aparece con utilización 0 (tabla Resources de Bizagi)', () => {
    const scenario: SimScenario = {
      run: { seed: 4 },
      resources: { usado: { capacity: 1, costPerHour: 3600 }, ocioso: { capacity: 5, fixedCost: 99, costPerHour: 99 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 2 },
        Task: { processingTime: { type: 'constant', value: 3 }, resources: [{ ref: 'usado' }] },
      },
    };
    const result = aggregateReplication(ir, runReplication(ir, scenario), scenario);
    expect(result.resources.ocioso).toEqual({ utilization: 0, busyTime: 0, fixedCost: 0, unitCost: 0, totalCost: 0 });
    expect(Object.keys(result.resources)).toEqual(['usado', 'ocioso']);
  });
});

/* ------------------------------------------------------------------ *
 * 5. AND multi-pool: una instancia en la cola, dos filas en los usos
 * ------------------------------------------------------------------ */

describe('QA LILA-036 · AND con dos pools', () => {
  const ir = makeIr({ Start: 'start', Task: 'task', End: 'end' }, { F1: ['Start', 'Task'], F2: ['Task', 'End'] });

  /**
   * `uno` capacidad 1 cantidad 1, `dos` capacidad 4 cantidad 2. Llegadas en 0/2/4, proceso 8 s.
   * `uno` serializa: arranques 0, 8, 16; esperas 0, 6, 12. Corrida hasta 24 s.
   */
  const scenario: SimScenario = {
    run: { seed: 9 },
    resources: {
      uno: { capacity: 1, fixedCost: 4, costPerHour: 1800 },
      dos: { capacity: 4, fixedCost: 2, costPerHour: 450 },
    },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 2 }, triggerCount: 3 },
      Task: {
        processingTime: { type: 'constant', value: 8 },
        resources: [{ ref: 'uno', quantity: 1 }, { ref: 'dos', quantity: 2 }],
      },
    },
  };
  const run = runReplication(ir, scenario);
  const result = aggregateReplication(ir, run, scenario);

  test('cada instancia emite dos filas pero la cola la cuenta una sola vez', () => {
    expect(run.rows.filter((row) => row.elementId === 'Task')).toHaveLength(6);
    // Esperas por instancia: [2,8) y [4,16). Integral = 1·(4−2) + 2·(8−4) + 1·(16−8) = 18.
    // Si las filas se contaran por separado el máximo sería 4 y la integral 36.
    expect(result.elements.Task?.queueLength).toEqual({ mean: 18 / 24, max: 2 });
    expect(result.elements.Task?.resourceWait).toEqual({ min: 0, max: 12, mean: 6, sd: 6, total: 18 });
  });

  test('los usos sí se cuentan por fila y por quantity', () => {
    // uno: 3 filas × 1 unidad × 8 s = 24 s-unidad, capacidad 1 × 24 s ⇒ 1. Usos = 3.
    expect(result.resources.uno).toEqual({
      utilization: 1,
      busyTime: 24,
      fixedCost: 12, // 4 × 3 usos
      unitCost: 12, // 1800/h × 24 s
      totalCost: 24,
    });
    // dos: 3 filas × 2 unidades × 8 s = 48 s-unidad, capacidad 4 × 24 s = 96 ⇒ 0.5. Usos = 6.
    expect(result.resources.dos).toEqual({
      utilization: 0.5,
      busyTime: 48,
      fixedCost: 12, // 2 × 6 usos
      unitCost: 6, // 450/h × 48 s
      totalCost: 18,
    });
  });

  test('el desempate del ranking usa la mayor utilización entre los pools de la instancia', () => {
    expect(result.bottlenecks).toEqual([{ elementId: 'Task', resourceWaitTotal: 18, utilization: 1 }]);
  });
});

/* ------------------------------------------------------------------ *
 * 6. Lifecycle parcial cortado por `duration`
 * ------------------------------------------------------------------ */

describe('QA LILA-036 · duration corta tareas en vuelo', () => {
  const ir = makeIr({ Start: 'start', Task: 'task', End: 'end' }, { F1: ['Start', 'Task'], F2: ['Task', 'End'] });
  /**
   * Capacidad 2, llegadas cada 3 s, proceso 10 s, corte en 13 s.
   * Caso 1 (t=0) arranca en 0 y completa en 10, el único caso completo.
   * Caso 2 (t=3) arranca en 3 y su `done` cae exactamente en `t_stop = 13`, que R-ARR-5
   *   descarta: queda `inFlight` con 10 s observados de ocupación.
   * Caso 3 (t=6) espera a la liberación de 10, arranca 10 y queda a medias en 13.
   * Casos 4 (t=9) y 5 (t=12) nunca arrancan: sentinel en cola [9,13) y [12,13).
   */
  const scenario: SimScenario = {
    run: { seed: 6, duration: 13 },
    resources: { w: { capacity: 2, fixedCost: 10, costPerHour: 3600 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 3 }, triggerCount: 50 },
      Task: { processingTime: { type: 'constant', value: 10 }, fixedCost: 5, resources: [{ ref: 'w' }] },
    },
  };
  const run = runReplication(ir, scenario);
  const result = aggregateReplication(ir, run, scenario);

  test('las estadísticas por instancia solo agregan completadas', () => {
    const rows = run.rows.filter((row) => row.elementId === 'Task');
    expect(rows.map((row) => row.status)).toEqual(['completed', 'inFlight', 'inFlight', 'inFlight', 'inFlight']);
    // Solo el caso 1 completó: una sola observación, así que `sd` vale 0 y no NaN.
    expect(result.elements.Task?.started).toBe(5);
    expect(result.elements.Task?.completed).toBe(1);
    expect(result.elements.Task?.processing).toEqual({ min: 10, max: 10, mean: 10, total: 10 });
    expect(result.elements.Task?.resourceWait).toEqual({ min: 0, max: 0, mean: 0, sd: 0, total: 0 });
    // La espera censurada de los casos 4 y 5 no fabrica un cuello de botella.
    expect(result.bottlenecks).toEqual([]);
  });

  test('las integrales y los costos sí incluyen las filas parciales', () => {
    // Cola observada: caso 3 [6,10), caso 4 [9,13), caso 5 [12,13). Barrido:
    // [6,9) → 1, [9,10) → 2, [10,12) → 1, [12,13) → 2 ⇒ integral 3 + 2 + 2 + 2 = 9 sobre 13 s.
    expect(result.elements.Task?.queueLength).toEqual({ mean: 9 / 13, max: 2 });
    // busyTime: casos 1 [0,10) = 10, 2 [3,13) = 10, 3 [10,13) = 3 ⇒ 23 s-unidad.
    expect(result.resources.w?.busyTime).toBe(23);
    expect(result.resources.w?.utilization).toBeCloseTo(23 / 26, 12);
    // Usos: 3 filas que llegaron a ocupar × 1 unidad ⇒ fijo 30; hora 3600 × 23/3600 = 23.
    expect(result.resources.w).toEqual({
      utilization: 23 / 26,
      busyTime: 23,
      fixedCost: 30,
      unitCost: 23,
      totalCost: 53,
    });
    // El fijo del elemento solo se carga al completar: 5 × 1 = 5.
    expect(result.elements.Task?.fixedCostTotal).toBe(5);
    expect(result.process.totalCost).toBeCloseTo(58, 10); // 5 + 53
    expect(result.process.totalCost).toBeCloseTo(
      run.rows.reduce((total, row) => total + row.cost, 0),
      10,
    );
    // costPerCase promedia solo el caso completado: 5 de fijo + 10 de fijo del pool + 10 s
    // de ocupación a 3600/h = 25.
    expect(result.process.completed).toBe(1);
    expect(result.process.costPerCase).toBeCloseTo(25, 10);
    expect(nonFinitePaths(result)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 7. Ranking: empate total y orden determinista
 * ------------------------------------------------------------------ */

describe('QA LILA-036 · empates del ranking', () => {
  test('con espera y utilización idénticas el orden lo fija elementId ascendente', () => {
    const ir = makeIr(
      { Start: 'start', Zeta: 'task', Alfa: 'task', End: 'end' },
      { F1: ['Start', 'Zeta'], F2: ['Zeta', 'Alfa'], F3: ['Alfa', 'End'] },
    );
    // Dos elementos que usan el mismo pool y esperan exactamente lo mismo: el desempate por
    // utilización tampoco los separa. El IR los declara Zeta antes que Alfa a propósito.
    const run = syntheticRun(
      [
        {
          caseId: '1',
          activityInstanceId: '1',
          elementId: 'Zeta',
          enabledAt: 0,
          startedAt: 5,
          endedAt: 10,
          observedUntil: 10,
          resourceWait: 5,
          resourceId: 'p',
          resourceQuantity: 1,
          allocationIndex: 0,
        },
        {
          caseId: '1',
          activityInstanceId: '2',
          elementId: 'Alfa',
          enabledAt: 10,
          startedAt: 15,
          endedAt: 20,
          observedUntil: 20,
          resourceWait: 5,
          resourceId: 'p',
          resourceQuantity: 1,
          allocationIndex: 0,
        },
      ],
      { stoppedAt: 20, statisticsDuration: 20, elementIds: ['Start', 'Zeta', 'Alfa', 'End'] },
    );
    const scenario: SimScenario = { run: {}, resources: { p: { capacity: 1 } } };
    const result = aggregateReplication(ir, run, scenario);
    expect(result.elements.Zeta?.resourceWait.total).toBe(5);
    expect(result.elements.Alfa?.resourceWait.total).toBe(5);
    expect(result.bottlenecks.map((entry) => entry.elementId)).toEqual(['Alfa', 'Zeta']);
    // El orden no puede depender del orden de declaración del IR.
    const mirrored = makeIr(
      { Start: 'start', Alfa: 'task', Zeta: 'task', End: 'end' },
      { F1: ['Start', 'Alfa'], F2: ['Alfa', 'Zeta'], F3: ['Zeta', 'End'] },
    );
    expect(aggregateReplication(mirrored, run, scenario).bottlenecks.map((entry) => entry.elementId)).toEqual([
      'Alfa',
      'Zeta',
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * 8. examples/pedido degradado a un pool por tarea
 * ------------------------------------------------------------------ */

const PEDIDO_BPMN = readFileSync(new URL('../../../../examples/pedido/model.bpmn', import.meta.url), 'utf8');

describe('QA LILA-036 · identidades de costo sobre examples/pedido', () => {
  /**
   * El AS-IS tal cual no corre todavía: `Task_Revisar` declara `selection: "or"` con dos pools
   * y el preflight lo rechaza con `E-REC-OR-PENDIENTE` hasta LILA-035. Se degrada a single-pool
   * (y sin calendarios, que son M3) conservando capacidades, costos y distribuciones.
   */
  const scenario: SimScenario = {
    run: { seed: 42, duration: 86_400, warmup: 3600 },
    resources: {
      cajero: { capacity: 2, costPerHour: 220, fixedCost: 0 },
      cocinero: { capacity: 3, costPerHour: 180, fixedCost: 1.5 },
      horno: { capacity: 1, costPerHour: 40, fixedCost: 0.25 },
    },
    elements: {
      StartEvent_Pedido: { interTriggerTimer: { type: 'exponential', mean: 240 }, triggerCount: 10_000 },
      Task_TomarPedido: {
        processingTime: { type: 'triangular', min: 60, mode: 120, max: 300 },
        resources: [{ ref: 'cajero', quantity: 1 }],
        fixedCost: 2.5,
      },
      Task_Preparar: {
        processingTime: { type: 'normal', mean: 480, sd: 90 },
        resources: [{ ref: 'cocinero' }, { ref: 'horno' }],
        selection: 'and',
      },
      Task_Empacar: { processingTime: { type: 'constant', value: 120 }, resources: [{ ref: 'horno' }] },
      Task_Revisar: { processingTime: { type: 'constant', value: 90 }, resources: [{ ref: 'cajero' }] },
      Timer_Reposo: { processingTime: { type: 'constant', value: 600 } },
      Flow_Aprobado: { probability: 0.78 },
      Flow_Rechazado: { probability: 0.22 },
    },
  };

  test('Σ resources[*].totalCost = Σ row.resourceCost y process.totalCost = Σ row.cost', async () => {
    const { ir } = await parseBpmn(PEDIDO_BPMN);
    const run = runReplication(ir, scenario);
    const result = aggregateReplication(ir, run, scenario);

    const measured = new Set(run.cases.map((record) => String(record.caseId)));
    const rows = run.rows.filter((row) => measured.has(row.caseId));
    expect(rows.length).toBeGreaterThan(100); // el caso tiene que ser no trivial

    const resourceTotal = Object.values(result.resources).reduce((total, pool) => total + pool.totalCost, 0);
    expect(resourceTotal).toBeCloseTo(
      rows.reduce((total, row) => total + row.resourceCost, 0),
      6,
    );
    expect(result.process.totalCost).toBeCloseTo(
      rows.reduce((total, row) => total + row.cost, 0),
      6,
    );
    // La otra mitad de la identidad: costo total = fijo de elementos + total de recursos.
    const elementFixed = Object.values(result.elements).reduce((total, element) => total + element.fixedCostTotal, 0);
    expect(result.process.totalCost).toBeCloseTo(elementFixed + resourceTotal, 6);
    // Y la reconstrucción a mano: Σ fijo × usos + Σ porHora × horas ocupadas.
    let byHand = 0;
    for (const row of rows) {
      if (row.resourceId === null || row.startedAt === null) continue;
      const pool = scenario.resources![row.resourceId]!;
      const hours = ((row.endedAt ?? row.observedUntil) - row.startedAt) / 3600;
      byHand += (pool.fixedCost ?? 0) * row.resourceQuantity! + (pool.costPerHour ?? 0) * row.resourceQuantity! * hours;
    }
    expect(byHand).toBeCloseTo(resourceTotal, 6);
    expect(nonFinitePaths(result)).toEqual([]);
    // Todo pool declarado aparece, aunque su utilización sea baja, y ninguna supera 1.
    for (const pool of Object.values(result.resources)) {
      expect(pool.utilization).toBeGreaterThanOrEqual(0);
      expect(pool.utilization).toBeLessThanOrEqual(1);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 9. Replicaciones y determinismo
 * ------------------------------------------------------------------ */

describe('QA LILA-036 · replicaciones y determinismo', () => {
  const ir = makeIr({ Start: 'start', Task: 'task', End: 'end' }, { F1: ['Start', 'Task'], F2: ['Task', 'End'] });
  const scenario: SimScenario = {
    run: { seed: 21, duration: 600, replications: 5 },
    resources: { w: { capacity: 2, fixedCost: 1, costPerHour: 360 }, ocioso: { capacity: 1, costPerHour: 10 } },
    elements: {
      Start: { interTriggerTimer: { type: 'exponential', mean: 20 }, triggerCount: 10_000 },
      Task: { processingTime: { type: 'exponential', mean: 35 }, fixedCost: 1, resources: [{ ref: 'w' }] },
    },
  };

  test('las métricas nuevas entran en los KPI resumidos, con ci95 coherente', () => {
    const result = simulate(ir, scenario);
    const kpis = result.replications?.kpis ?? {};
    for (const key of [
      'resources.w.utilization',
      'resources.w.busyTime',
      'resources.w.totalCost',
      'resources.ocioso.utilization',
      'elements.Task.queueLength.mean',
      'elements.Task.queueLength.max',
      'elements.Task.resourceWait.sd',
      'process.totalCost',
      'process.costPerCase',
    ]) {
      const kpi = kpis[key];
      expect(kpi, key).toBeDefined();
      expect(Number.isFinite(kpi!.mean)).toBe(true);
      expect(kpi!.ci95[0]).toBeLessThanOrEqual(kpi!.mean);
      expect(kpi!.ci95[1]).toBeGreaterThanOrEqual(kpi!.mean);
    }
    // El pool ocioso existe en todas las replicaciones: si faltara en alguna, `summarizeKpis`
    // habría lanzado E-KPI-INCONSISTENTE antes de llegar aquí.
    expect(kpis['resources.ocioso.utilization']!.mean).toBe(0);
    expect(kpis['resources.ocioso.utilization']!.sd).toBe(0);
    expect(result.replications?.count).toBe(5);
    // El top-level es la media de las replicaciones, no la primera.
    expect(result.resources.w?.utilization).toBeCloseTo(kpis['resources.w.utilization']!.mean, 12);
    expect(nonFinitePaths(result)).toEqual([]);
  });

  test('determinismo byte a byte entre dos corridas independientes', () => {
    expect(JSON.stringify(simulate(ir, scenario))).toBe(JSON.stringify(simulate(ir, scenario)));
  });

  test('el orden de las claves de resources sigue al escenario y es estable', () => {
    const result = simulate(ir, scenario);
    expect(Object.keys(result.resources)).toEqual(['w', 'ocioso']);
  });
});

/* ------------------------------------------------------------------ *
 * 10. Restricciones arquitectónicas del módulo
 * ------------------------------------------------------------------ */

describe('QA LILA-036 · metrics.ts respeta las reglas de core/', () => {
  const source = readFileSync(new URL('../../src/core/metrics.ts', import.meta.url), 'utf8');

  test('no importa nada fuera de core/', () => {
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier.startsWith('./')).toBe(true);
  });

  test('no usa el tipo `any`', () => {
    expect(source).not.toMatch(/\bany\b/);
  });
});

/* ------------------------------------------------------------------ *
 * 11. Forma serializada: el orden de claves no puede depender de la muestra
 * ------------------------------------------------------------------ */

describe('QA LILA-036 · el JSON tiene el mismo orden de claves se ejecute o no el elemento', () => {
  test('StatSd serializa min/max/mean/sd/total tanto con muestra como sin ella', () => {
    const ir = makeIr({ Start: 'start', Task: 'task', End: 'end' }, { F1: ['Start', 'Task'], F2: ['Task', 'End'] });
    const scenario: SimScenario = {
      run: { seed: 8 },
      resources: { w: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 3 },
        Task: { processingTime: { type: 'constant', value: 5 }, resources: [{ ref: 'w' }] },
      },
    };
    const result = aggregateReplication(ir, runReplication(ir, scenario), scenario);
    // `Start` no tiene observaciones de espera y `Task` sí; el consumidor del JSON (CSV,
    // diffs byte a byte de LILA-030/LILA-039) tiene que ver el mismo orden en los dos.
    const order = (elementId: string, field: 'resourceWait' | 'offHoursWait'): string[] =>
      Object.keys(result.elements[elementId]![field]);
    expect(order('Task', 'resourceWait')).toEqual(['min', 'max', 'mean', 'sd', 'total']);
    expect(order('Start', 'resourceWait')).toEqual(order('Task', 'resourceWait'));
    expect(order('Start', 'offHoursWait')).toEqual(order('Task', 'offHoursWait'));
    // Y el mismo orden que declara la interfaz Percentiles para las métricas de proceso.
    expect(Object.keys(result.process.cycleTime)).toEqual(['min', 'max', 'mean', 'sd', 'p50', 'p90', 'p95']);
    expect(Object.keys(result.process.waitTime)).toEqual(Object.keys(result.process.cycleTime));
  });
});

/* ------------------------------------------------------------------ *
 * 12. Escala: la agregación es O(n log n), no cuadrática
 * ------------------------------------------------------------------ */

describe('QA LILA-036 · escala del barrido de la integral de cola', () => {
  test('100 000 instancias encoladas se agregan en tiempo lineal-logarítmico', () => {
    const ir = makeIr({ Start: 'start', Task: 'task', End: 'end' }, { F1: ['Start', 'Task'], F2: ['Task', 'End'] });
    // Capacidad 1 con llegadas más rápidas que el servicio: la cola crece hasta 50 000, así
    // que el barrido ve 200 000 eventos y `max` es la mitad de las instancias.
    const scenario: SimScenario = {
      run: { seed: 1 },
      resources: { w: { capacity: 1, fixedCost: 1, costPerHour: 10 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 100_000 },
        Task: { processingTime: { type: 'constant', value: 2 }, resources: [{ ref: 'w' }] },
      },
    };
    const run = runReplication(ir, scenario);
    const startedAt = performance.now();
    const result = aggregateReplication(ir, run, scenario);
    const elapsed = performance.now() - startedAt;
    expect(run.rows).toHaveLength(100_000);
    expect(result.elements.Task?.queueLength.max).toBe(50_000);
    // Un barrido cuadrático sobre 10^5 intervalos no bajaría de varios minutos.
    expect(elapsed).toBeLessThan(3000);
  });
});
