import { describe, expect, test } from 'vitest';

import type { Flow, Node, ProcessIR } from '../../src/core/ir.js';
import { runReplications, summarizeKpi, summarizeKpis } from '../../src/core/replications.js';
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
    const run = runReplication(ir, scenario(50));

    expect(run.elements.A).toEqual({ started: 5, completed: 5 });
    expect(run.flows).toEqual({ Flow_SA: 5, Flow_AE: 5 });
    expect(run.cases.map((item) => item.caseId)).toEqual([6, 7, 8, 9, 10]);
    expect(run.rows).toHaveLength(10);
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
});
