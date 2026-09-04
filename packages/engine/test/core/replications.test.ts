import { describe, expect, test } from 'vitest';

import type { Flow, Node, ProcessIR } from '../../src/core/ir.js';
import { numericKpis, runReplications, summarizeKpi, summarizeKpis } from '../../src/core/replications.js';
import type { ElementMetrics, RunResult } from '../../src/core/result.js';
import { runReplication, type SimScenario } from '../../src/core/sim.js';

const ir: ProcessIR = {
  id: 'Process_Warmup',
  name: '',
  nodes: {
    Start: { type: 'start', name: '', incoming: [], outgoing: ['Flow_SA'] } satisfies Node,
    A: { type: 'task', name: '', incoming: ['Flow_SA'], outgoing: ['Flow_AE'] } satisfies Node,
    End: { type: 'end', name: '', incoming: ['Flow_AE'], outgoing: [] } satisfies Node,
  },
  flows: {
    Flow_SA: { from: 'Start', to: 'A', name: '', isDefault: false } satisfies Flow,
    Flow_AE: { from: 'A', to: 'End', name: '', isDefault: false } satisfies Flow,
  },
  source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
};

function scenario(warmup: number, replications = 1): SimScenario {
  return {
    run: { duration: 100, warmup, replications, seed: 42 },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 10 },
      A: { processingTime: { type: 'constant', value: 1 } },
    },
  };
}

describe('warmup (R-ARR-7)', () => {
  test('warmup igual al fin deja todos los contadores y flujos en cero, pero conserva el log', () => {
    const run = runReplication(ir, scenario(100));

    expect(run.elements).toEqual({
      Start: { started: 0, completed: 0 },
      A: { started: 0, completed: 0 },
      End: { started: 0, completed: 0 },
    });
    expect(run.flows).toEqual({ Flow_SA: 0, Flow_AE: 0 });
    expect(run.rows).toHaveLength(10);
    expect(run.cases).toEqual([]);
  });

  test('la inclusión depende del inicio del caso, no de cuándo termina', () => {
    const input = scenario(50);
    input.run.duration = 200;
    input.elements!.A!.processingTime = { type: 'constant', value: 60 };
    const run = runReplication(ir, input);

    expect(run.elements.A).toEqual({ started: 5, completed: 5 });
    expect(run.flows).toEqual({ Flow_SA: 5, Flow_AE: 5 });
    expect(run.cases.map((item) => item.caseId)).toEqual([6, 7, 8, 9, 10]);
    expect(run.rows).toHaveLength(10);
    expect(run.rows.slice(0, 5).every((row) => Number(row.caseId) <= 5 && row.endedAt >= 60)).toBe(true);
  });

  test('el log conserva filas pre-warmup y permite distinguirlas de los caseIds medidos', () => {
    const run = runReplication(ir, scenario(50));
    const measuredCaseIds = new Set(run.cases.map((item) => String(item.caseId)));

    expect(run.rows.some((row) => !measuredCaseIds.has(row.caseId))).toBe(true);
    expect(run.rows.filter((row) => measuredCaseIds.has(row.caseId))).toHaveLength(5);
    expect(run.elements.A).toEqual({ started: 5, completed: 5 });
  });

  test('expone la duración estadística tanto al parar por duration como por heap vacío', () => {
    const durationScenario = scenario(40);
    durationScenario.elements!.Start!.triggerCount = 100;
    durationScenario.elements!.A!.processingTime = { type: 'constant', value: 20 };
    const durationRun = runReplication(ir, durationScenario);
    const heapScenario = scenario(5);
    heapScenario.run.duration = undefined;
    heapScenario.elements!.Start!.triggerCount = 3;

    const heapRun = runReplication(ir, heapScenario);

    expect(durationRun).toMatchObject({ stoppedAt: 100, statisticsDuration: 60 });
    expect(heapRun).toMatchObject({ stoppedAt: 21, statisticsDuration: 16 });

    heapScenario.run.warmup = 30;
    expect(runReplication(ir, heapScenario)).toMatchObject({ stoppedAt: 21, statisticsDuration: 0, cases: [] });
  });

  test('varios starts comparten ids de caso pero conservan su generador y el borde inclusivo', () => {
    const multiStartIr: ProcessIR = {
      ...ir,
      nodes: {
        StartA: { type: 'start', name: '', incoming: [], outgoing: ['Flow_A'] },
        StartB: { type: 'start', name: '', incoming: [], outgoing: ['Flow_B'] },
        A: { type: 'task', name: '', incoming: ['Flow_A', 'Flow_B'], outgoing: ['Flow_End'] },
        End: { type: 'end', name: '', incoming: ['Flow_End'], outgoing: [] },
      },
      flows: {
        Flow_A: { from: 'StartA', to: 'A', name: '', isDefault: false },
        Flow_B: { from: 'StartB', to: 'A', name: '', isDefault: false },
        Flow_End: { from: 'A', to: 'End', name: '', isDefault: false },
      },
    };
    const input: SimScenario = {
      run: { warmup: 10, seed: 9 },
      elements: {
        StartA: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 3 },
        StartB: { interTriggerTimer: { type: 'constant', value: 15 }, triggerCount: 2 },
        A: { processingTime: { type: 'constant', value: 1 } },
      },
    };

    const run = runReplication(multiStartIr, input);

    expect(run.cases.map(({ caseId, startId, startedAt }) => ({ caseId, startId, startedAt }))).toEqual([
      { caseId: 3, startId: 'StartA', startedAt: 10 },
      { caseId: 4, startId: 'StartB', startedAt: 15 },
      { caseId: 5, startId: 'StartA', startedAt: 20 },
    ]);
    expect(run.flows).toEqual({ Flow_A: 2, Flow_B: 1, Flow_End: 3 });
    expect(run.rows).toHaveLength(5);
    expect(JSON.stringify(runReplication(multiStartIr, input))).toBe(JSON.stringify(run));
  });
});

describe('replicaciones e IC 95 % (R-ARR-8)', () => {
  test('cada replicación recibe su índice y parte de estado vacío', () => {
    const runs = runReplications(ir, scenario(0, 3));

    expect(runs.map((run) => run.replication)).toEqual([0, 1, 2]);
    expect(runs.map((run) => run.cases[0]?.caseId)).toEqual([1, 1, 1]);
    expect(runs.map((run) => run.elements.A)).toEqual([
      { started: 10, completed: 10 },
      { started: 10, completed: 10 },
      { started: 10, completed: 10 },
    ]);
  });

  test('replicaciones sin llegadas también parten vacías y son deterministas', () => {
    const empty: SimScenario = { run: { duration: 10, replications: 3, seed: 42 }, elements: {} };
    const first = runReplications(ir, empty);
    const second = runReplications(ir, empty);

    expect(first.map((run) => run.cases)).toEqual([[], [], []]);
    expect(first.map((run) => run.statisticsDuration)).toEqual([0, 0, 0]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test('calcula media, sd muestral e IC con t de Student', () => {
    const summary = summarizeKpis([
      { 'process.cycleTime.mean': 0 },
      { 'process.cycleTime.mean': 2 },
      { 'process.cycleTime.mean': 0 },
      { 'process.cycleTime.mean': 2 },
      { 'process.cycleTime.mean': 0 },
    ]);

    expect(summary.count).toBe(5);
    expect(summary.kpis['process.cycleTime.mean']?.mean).toBeCloseTo(0.8, 12);
    expect(summary.kpis['process.cycleTime.mean']?.sd).toBeCloseTo(1.095445115, 9);
    expect(summary.kpis['process.cycleTime.mean']?.ci95).toEqual([
      expect.closeTo(-0.560174761, 9),
      expect.closeTo(2.160174761, 9),
    ]);
  });

  test('con 30 replicaciones el IC es más estrecho que con 5', () => {
    const values = Array.from({ length: 30 }, (_, index) => (index % 2 === 0 ? 0 : 2));
    const five = summarizeKpi(values.slice(0, 5)).ci95;
    const thirty = summarizeKpi(values).ci95;
    const width = (ci: readonly [number, number]): number => ci[1] - ci[0];

    expect(width(thirty)).toBeLessThan(width(five));
  });

  test('replicaciones distintas derivan streams distintos de (seed, r, elementId)', () => {
    const stochastic: SimScenario = {
      run: { replications: 2, seed: 42 },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 100 }, triggerCount: 1 },
        A: { processingTime: { type: 'uniform', min: 1, max: 100 } },
      },
    };
    const [first, second] = runReplications(ir, stochastic);

    expect(first?.rows[0]?.endedAt).not.toBe(second?.rows[0]?.endedAt);
  });

  test('rechaza conjuntos de KPI distintos y valores no finitos', () => {
    expect(() => summarizeKpis([{ a: 1 }, { a: 2, b: 3 }])).toThrow('E-KPI-INCONSISTENTE');
    expect(() => summarizeKpis([{ a: 1 }, { b: 2 }])).toThrow('E-KPI-INCONSISTENTE');
    expect(() => summarizeKpis([{ a: 1 }, { a: Number.NaN }])).toThrow('E-KPI-NO-FINITO');
  });
});

function elementMetrics(processingMean: number): ElementMetrics {
  return {
    started: 1,
    completed: 1,
    processing: { min: processingMean, max: processingMean, mean: processingMean, total: processingMean },
    resourceWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
    offHoursWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
    queueLength: { mean: 0, max: 0 },
    fixedCostTotal: 0,
  };
}

test('los paths KPI escapan puntos de ids BPMN sin alterar ids normales', () => {
  const result: RunResult = {
    elements: {
      Task: elementMetrics(10),
      'Task.processing': elementMetrics(20),
    },
    flows: {},
    resources: {},
    process: {
      started: 2,
      completed: 2,
      inFlight: 0,
      cycleTime: { min: 10, max: 20, mean: 15, sd: 0, p50: 15, p90: 20, p95: 20 },
      waitTime: { min: 0, max: 0, mean: 0, sd: 0, p50: 0, p90: 0, p95: 0 },
      throughputPerHour: 2,
      costPerCase: 0,
      totalCost: 0,
    },
    bottlenecks: [],
    warnings: [],
  };

  const kpis = numericKpis(result);

  expect(kpis['elements.Task.processing.mean']).toBe(10);
  expect(kpis['elements.Task\\.processing.processing.mean']).toBe(20);
  expect(Object.keys(kpis)).toHaveLength(38 + 20);
});
