import { describe, expect, test } from 'vitest';

import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import type { EventLogRow, RunResult } from '../../src/core/result.js';
import { runReplication, type SimScenario } from '../../src/core/sim.js';

/**
 * LILA-036 · métricas de nivel 3 (colas, recursos, costos y cuellos de botella).
 *
 * Todos los casos son deterministas con distribuciones `constant`, así que cada número está
 * calculado a mano en el comentario que lo precede. Los oráculos M/M/1 y M/M/c son LILA-050.
 */

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
    id: 'Process_Level3',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

function aggregate(ir: ProcessIR, scenario: SimScenario): RunResult {
  return aggregateReplication(ir, runReplication(ir, scenario), scenario);
}

const LINEAR_IR = makeIr(
  { Start: 'start', Task: 'task', End: 'end' },
  { Flow_ST: ['Start', 'Task'], Flow_TE: ['Task', 'End'] },
);

/* ------------------------------------------------------------------ *
 * Aceptación: dos pools, cantidades conocidas, todo calculado a mano
 * ------------------------------------------------------------------ */

/**
 * `cashier` (capacidad 1, cantidad 1) satura; `terminal` (capacidad 4, cantidad 2) sobra.
 * Llegadas en 0/1/2 s, procesamiento 10 s ⇒ arranques 0/10/20, finales 10/20/30, esperas
 * 0/9/18. La corrida para al vaciarse el heap: `stoppedAt = 30`, ventana = 30 s.
 */
const TWO_POOL_SCENARIO: SimScenario = {
  run: { seed: 1 },
  resources: {
    cashier: { capacity: 1, fixedCost: 5, costPerHour: 3600 },
    terminal: { capacity: 4, fixedCost: 1, costPerHour: 7200 },
  },
  elements: {
    Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 3 },
    Task: {
      processingTime: { type: 'constant', value: 10 },
      fixedCost: 2,
      resources: [
        { ref: 'cashier', quantity: 1 },
        { ref: 'terminal', quantity: 2 },
      ],
    },
  },
};

describe('aceptación LILA-036: dos pools con cantidades conocidas', () => {
  const run = runReplication(LINEAR_IR, TWO_POOL_SCENARIO);
  const result = aggregateReplication(LINEAR_IR, run, TWO_POOL_SCENARIO);

  test('la corrida es la esperada: 0/10/20 y ventana de 30 s', () => {
    expect(run.stoppedAt).toBe(30);
    expect(run.statisticsDuration).toBe(30);
    const rows = run.rows.filter((row) => row.resourceId === 'cashier');
    expect(rows.map((row) => row.startedAt)).toEqual([0, 10, 20]);
    expect(rows.map((row) => row.endedAt)).toEqual([10, 20, 30]);
    // Cada instancia AND emite una fila por pool: 3 instancias × 2 pools.
    expect(run.rows).toHaveLength(6);
  });

  test('resourceWait min/max/mean/sd/total por elemento', () => {
    // Muestra {0, 9, 18}: media 9, sd muestral sqrt((81 + 0 + 81) / 2) = 9, total 27.
    expect(result.elements.Task?.resourceWait).toEqual({ min: 0, max: 18, mean: 9, sd: 9, total: 27 });
    expect(result.elements.Start?.resourceWait).toEqual({ min: 0, max: 0, mean: 0, sd: 0, total: 0 });
  });

  test('queueLength ponderada por tiempo, sin duplicar la instancia AND', () => {
    // Intervalos de espera [1,10) y [2,20); [0,0) no forma cola. Integral = 1·(2−1) +
    // 2·(10−2) + 1·(20−10) = 1 + 16 + 10 = 27 s·instancia ⇒ mean = 27/30 = 0.9, max = 2.
    // Si las dos filas de la AND se contaran por separado, max saldría 4.
    expect(result.elements.Task?.queueLength).toEqual({ mean: 0.9, max: 2 });
  });

  test('utilización, busyTime y costos por recurso', () => {
    // cashier: 3 usos × 1 unidad × 10 s = 30 s ocupados; capacidad 1 × 30 s ⇒ 100 %.
    // terminal: 3 usos × 2 unidades × 10 s = 60 s; capacidad 4 × 30 s = 120 ⇒ 50 %.
    expect(result.resources.cashier).toEqual({
      utilization: 1,
      busyTime: 30,
      fixedCost: 15, // 5 × 3 usos
      unitCost: 30, // 3600/h × 30 s
      totalCost: 45,
    });
    expect(result.resources.terminal).toEqual({
      utilization: 0.5,
      busyTime: 60,
      fixedCost: 6, // 1 × 6 usos (quantity 2 son 2 usos, R-COST-2)
      unitCost: 120, // 7200/h × 60 s
      totalCost: 126,
    });
  });

  test('totalCost se reconstruye desde el log: Σ fijo × usos + Σ hora × horas ocupadas', () => {
    const pools = { cashier: TWO_POOL_SCENARIO.resources!.cashier!, terminal: TWO_POOL_SCENARIO.resources!.terminal! };
    let fixed = 0;
    let hourly = 0;
    let fromRows = 0;
    for (const row of run.rows) {
      fromRows += row.resourceCost;
      if (row.resourceId === null || row.startedAt === null) continue;
      const pool = pools[row.resourceId as 'cashier' | 'terminal'];
      const uses = row.resourceQuantity!;
      const hours = ((row.endedAt ?? row.observedUntil) - row.startedAt) / 3600;
      fixed += (pool.fixedCost ?? 0) * uses;
      hourly += (pool.costPerHour ?? 0) * uses * hours;
    }
    const resourceTotal = result.resources.cashier!.totalCost + result.resources.terminal!.totalCost;
    expect(fixed).toBeCloseTo(21, 10); // 15 + 6
    expect(hourly).toBeCloseTo(150, 10); // 30 + 120
    expect(fixed + hourly).toBeCloseTo(resourceTotal, 10);
    expect(fromRows).toBeCloseTo(resourceTotal, 10);
    // R-COST-4: el fijo del elemento sale de Σ elementCost, nunca de Σ cost.
    expect(result.elements.Task?.fixedCostTotal).toBe(6); // 2 × 3 completadas
    expect(result.process.totalCost).toBeCloseTo(177, 10); // 6 + 171
    expect(result.process.totalCost).toBeCloseTo(
      run.rows.reduce((total, row) => total + row.cost, 0),
      10,
    );
  });

  test('waitTime y costPerCase por proceso', () => {
    // Esperas por caso {0, 9, 18}: p90 interpola en (n−1)·0.9 = 1.8 ⇒ 9 + 9·0.8 = 16.2.
    expect(result.process.waitTime).toEqual({
      min: 0,
      max: 18,
      mean: 9,
      sd: 9,
      p50: 9,
      p90: 16.2,
      p95: 17.1,
    });
    expect(result.process.costPerCase).toBeCloseTo(59, 10); // 177 / 3 casos completados
  });

  test('bottlenecks señala el elemento y reporta la utilización del pool saturado', () => {
    expect(result.bottlenecks).toEqual([{ elementId: 'Task', resourceWaitTotal: 27, utilization: 1 }]);
  });
});

/* ------------------------------------------------------------------ *
 * Ranking: orden por espera total, desempate por utilización
 * ------------------------------------------------------------------ */

const FORK_IR = makeIr(
  {
    Start: 'start',
    Fork: 'and',
    TaskZ: 'task',
    TaskA: 'task',
    Manual: 'task',
    Join: 'and',
    End: 'end',
  },
  {
    Flow_SF: ['Start', 'Fork'],
    Flow_FZ: ['Fork', 'TaskZ'],
    Flow_FA: ['Fork', 'TaskA'],
    Flow_FM: ['Fork', 'Manual'],
    Flow_ZJ: ['TaskZ', 'Join'],
    Flow_AJ: ['TaskA', 'Join'],
    Flow_MJ: ['Manual', 'Join'],
    Flow_JE: ['Join', 'End'],
  },
);

describe('ranking de cuellos de botella (LILA-036)', () => {
  /**
   * Tres ramas paralelas con llegadas en 0/1/2 s y procesamiento 10 s.
   * `alpha` (capacidad 1, cantidad 1) y `beta` (capacidad 3, cantidad 2) serializan igual, así
   * que TaskZ y TaskA empatan en espera total (0 + 9 + 18 = 27) y solo las separa la
   * utilización: alpha 30/(1×30) = 100 %, beta 60/(3×30) = 66.6 %. `Manual` no pide recursos.
   */
  const scenario: SimScenario = {
    run: { seed: 1 },
    resources: { alpha: { capacity: 1 }, beta: { capacity: 3 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 3 },
      TaskZ: { processingTime: { type: 'constant', value: 10 }, resources: [{ ref: 'alpha', quantity: 1 }] },
      TaskA: { processingTime: { type: 'constant', value: 10 }, resources: [{ ref: 'beta', quantity: 2 }] },
      Manual: { processingTime: { type: 'constant', value: 1 } },
    },
  };
  const result = aggregate(FORK_IR, scenario);

  test('el empate en resourceWait.total lo rompe la utilización, no el orden alfabético', () => {
    expect(result.elements.TaskZ?.resourceWait.total).toBe(27);
    expect(result.elements.TaskA?.resourceWait.total).toBe(27);
    expect(result.resources.alpha?.utilization).toBe(1);
    expect(result.resources.beta?.utilization).toBeCloseTo(2 / 3, 10);
    expect(result.bottlenecks.map((entry) => entry.elementId)).toEqual(['TaskZ', 'TaskA']);
  });

  test('un elemento sin espera de recurso no entra en el ranking', () => {
    expect(result.elements.Manual?.resourceWait.total).toBe(0);
    expect(result.bottlenecks.some((entry) => entry.elementId === 'Manual')).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Lifecycle parcial: qué entra y qué no entra en los agregados
 * ------------------------------------------------------------------ */

describe('filas terminated / inFlight (regla fijada por LILA-036)', () => {
  /**
   * `w` con capacidad 1: el caso 1 arranca en 0 y el caso 2 se queda en cola. La corrida se
   * corta en `duration = 5`, así que el caso 1 queda `inFlight` a medio procesar y el caso 2
   * `inFlight` sin haber arrancado nunca (fila sentinel con 4 s de espera observada).
   */
  const scenario: SimScenario = {
    run: { seed: 1, duration: 5 },
    resources: { w: { capacity: 1, fixedCost: 5, costPerHour: 3600 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 2 },
      Task: { processingTime: { type: 'constant', value: 10 }, fixedCost: 7, resources: [{ ref: 'w' }] },
    },
  };
  const run = runReplication(LINEAR_IR, scenario);
  const result = aggregateReplication(LINEAR_IR, run, scenario);
  const rows = run.rows.filter((row) => row.elementId === 'Task');

  test('el log crudo conserva la espera observada de la fila parcial', () => {
    expect(rows.map((row) => row.status)).toEqual(['inFlight', 'inFlight']);
    expect(rows.map((row) => row.startedAt)).toEqual([0, null]);
    expect(rows.map((row) => row.resourceWait)).toEqual([0, 4]); // observedUntil 5 − enabledAt 1
    expect(rows[1]?.resourceId).toBeNull(); // sentinel: nunca hubo asignación
  });

  test('esa espera observada NO entra en las estadísticas por instancia', () => {
    expect(result.elements.Task?.started).toBe(2);
    expect(result.elements.Task?.completed).toBe(0);
    expect(result.elements.Task?.resourceWait).toEqual({ min: 0, max: 0, mean: 0, sd: 0, total: 0 });
    expect(result.elements.Task?.processing).toEqual({ min: 0, max: 0, mean: 0, total: 0 });
    expect(result.process.waitTime).toEqual({ min: 0, max: 0, mean: 0, sd: 0, p50: 0, p90: 0, p95: 0 });
    // Consecuencia deliberada: una espera censurada no fabrica un cuello de botella.
    expect(result.bottlenecks).toEqual([]);
  });

  test('pero sí entra en las integrales de estado y en los costos ya incurridos', () => {
    // Cola: solo el caso 2, [1, 5) ⇒ integral 4 sobre una ventana de 5 s.
    expect(result.elements.Task?.queueLength).toEqual({ mean: 0.8, max: 1 });
    // Ocupación del caso 1: [0, 5) con 1 unidad ⇒ 5 s, capacidad 1 × 5 s ⇒ 100 %.
    expect(result.resources.w).toEqual({
      utilization: 1,
      busyTime: 5,
      fixedCost: 5, // un solo uso: el sentinel no ocupa el pool
      unitCost: 5,
      totalCost: 10,
    });
    // R-COST-4: el costo de un caso en vuelo cuenta en totalCost; el fijo del elemento no,
    // porque solo se carga al completar.
    expect(result.elements.Task?.fixedCostTotal).toBe(0);
    expect(result.process.totalCost).toBe(10);
    expect(result.process.costPerCase).toBe(0); // ningún caso completado
  });
});

describe('filas terminated por un terminate (LILA-036)', () => {
  const ir = makeIr(
    {
      Start: 'start',
      Fork: 'and',
      Work: 'task',
      Bomb: 'timer',
      Kill: 'terminate',
      End: 'end',
    },
    {
      Flow_SF: ['Start', 'Fork'],
      Flow_FW: ['Fork', 'Work'],
      Flow_FB: ['Fork', 'Bomb'],
      Flow_WE: ['Work', 'End'],
      Flow_BK: ['Bomb', 'Kill'],
    },
  );
  const scenario: SimScenario = {
    run: { seed: 1 },
    resources: { w: { capacity: 1, fixedCost: 2, costPerHour: 3600 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
      Work: { processingTime: { type: 'constant', value: 10 }, fixedCost: 9, resources: [{ ref: 'w' }] },
      Bomb: { processingTime: { type: 'constant', value: 3 } },
    },
  };
  const run = runReplication(ir, scenario);
  const result = aggregateReplication(ir, run, scenario);

  test('la tarea muerta a los 3 s ocupa y cuesta, pero no aporta processing ni resourceWait', () => {
    const work = run.rows.find((row) => row.elementId === 'Work')!;
    expect(work.status).toBe('terminated');
    expect(work.observedUntil).toBe(3);
    expect(work.endedAt).toBeNull();
    expect(result.elements.Work?.processing.total).toBe(0);
    expect(result.elements.Work?.resourceWait.total).toBe(0);
    expect(result.elements.Work?.fixedCostTotal).toBe(0);
    // 3 s ocupados con 1 unidad; 1 uso × 2 de fijo + 3600/h × 3 s = 2 + 3.
    expect(result.resources.w?.busyTime).toBe(3);
    expect(result.resources.w?.totalCost).toBe(5);
    expect(result.process.totalCost).toBe(5);
  });
});

/* ------------------------------------------------------------------ *
 * Warmup y degradación
 * ------------------------------------------------------------------ */

describe('warmup: las integrales de nivel 3 solo miran la cohorte medida', () => {
  /**
   * Llegadas en 0 y 5 s con `warmup = 5`: el caso 1 es pre-warmup pero ocupa el pool de 0 a 10,
   * lo que retrasa al caso 2 (enabled 5, arranca 10, termina 20). Ventana medida = [5, 20].
   */
  const scenario: SimScenario = {
    run: { seed: 1, warmup: 5 },
    resources: { w: { capacity: 1, fixedCost: 3, costPerHour: 3600 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 5 }, triggerCount: 2 },
      Task: { processingTime: { type: 'constant', value: 10 }, fixedCost: 2, resources: [{ ref: 'w' }] },
    },
  };
  const run = runReplication(LINEAR_IR, scenario);
  const result = aggregateReplication(LINEAR_IR, run, scenario);

  test('la ocupación pre-warmup dentro de la ventana no se cuenta, pero sí retrasa', () => {
    expect(run.stoppedAt).toBe(20);
    expect(run.statisticsDuration).toBe(15);
    expect(result.elements.Task?.resourceWait.total).toBe(5); // solo el caso medido
    // Ocupación medida: [10, 20) ⇒ 10 s sobre capacidad 1 × 15 s. Los 5 s en que el caso
    // pre-warmup ocupó el pool dentro de la ventana quedan fuera (R-ARR-7).
    expect(result.resources.w?.busyTime).toBe(10);
    expect(result.resources.w?.utilization).toBeCloseTo(2 / 3, 10);
    expect(result.elements.Task?.queueLength).toEqual({ mean: 1 / 3, max: 1 });
    expect(result.resources.w?.totalCost).toBe(13); // 3 × 1 uso + 3600/h × 10 s
    expect(result.process.totalCost).toBe(15); // + 2 de fijo del elemento
  });
});

describe('degradación sin recursos (R-DEG-1)', () => {
  const scenario: SimScenario = {
    run: { seed: 1 },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 3 },
      Task: { processingTime: { type: 'constant', value: 10 }, fixedCost: 2 },
    },
  };
  const result = aggregate(LINEAR_IR, scenario);

  test('el JSON no gana claves nuevas y las métricas de nivel 3 quedan neutras', () => {
    expect(result.resources).toEqual({});
    expect(result.bottlenecks).toEqual([]);
    expect(Object.keys(result.elements.Task!)).toEqual([
      'started',
      'completed',
      'processing',
      'resourceWait',
      'offHoursWait',
      'queueLength',
      'fixedCostTotal',
    ]);
    // Sin recursos ninguna instancia espera, así que la cola nunca llega a existir.
    expect(result.elements.Task?.queueLength).toEqual({ mean: 0, max: 0 });
    expect(result.elements.Task?.resourceWait.total).toBe(0);
  });

  test('un pool declarado pero nunca usado aparece en cero, no ausente', () => {
    const withIdlePool: SimScenario = { ...scenario, resources: { idle: { capacity: 2, costPerHour: 100 } } };
    const idle = aggregate(LINEAR_IR, withIdlePool).resources.idle;
    expect(idle).toEqual({ utilization: 0, busyTime: 0, fixedCost: 0, unitCost: 0, totalCost: 0 });
  });
});

/* ------------------------------------------------------------------ *
 * Integral de cola: casos límite del sweep
 * ------------------------------------------------------------------ */

describe('queueLength: aritmética del sweep', () => {
  function rowsToRun(rows: readonly Partial<EventLogRow>[], stoppedAt: number) {
    const full = rows.map((row, index) => ({
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
    return {
      replication: 0,
      stoppedAt,
      statisticsDuration: stoppedAt,
      cases: full.map((row, index) => ({
        caseId: index + 1,
        startId: 'Start',
        startedAt: 0,
        endedAt: row.endedAt,
      })),
      rows: full,
      flows: { Flow_ST: 0, Flow_TE: 0 },
      elements: { Start: { started: 0, completed: 0 }, Task: { started: full.length, completed: full.length }, End: { started: 0, completed: 0 } },
      warnings: [],
    };
  }

  test('la instancia que sale de la cola no coexiste con la que entra en el mismo instante', () => {
    // [0,10) y [10,20): en t = 10 la cola vale 1, no 2.
    const run = rowsToRun(
      [
        { enabledAt: 0, startedAt: 10, endedAt: 10, observedUntil: 10, resourceWait: 10 },
        { enabledAt: 10, startedAt: 20, endedAt: 20, observedUntil: 20, resourceWait: 10 },
      ],
      20,
    );
    const result = aggregateReplication(LINEAR_IR, run, { run: {} });
    expect(result.elements.Task?.queueLength).toEqual({ mean: 1, max: 1 });
  });

  test('una espera de duración cero no forma cola', () => {
    const run = rowsToRun([{ enabledAt: 4, startedAt: 4, endedAt: 4, observedUntil: 4 }], 10);
    const result = aggregateReplication(LINEAR_IR, run, { run: {} });
    expect(result.elements.Task?.queueLength).toEqual({ mean: 0, max: 0 });
  });
});
