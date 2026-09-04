import { describe, expect, test } from 'vitest';

import * as publicApi from '../../src/index.js';
import type { ProcessIR } from '../../src/core/ir.js';
import { ResourceManager } from '../../src/core/resources.js';
import type { SimScenario } from '../../src/core/sim.js';

const IR: ProcessIR = {
  id: 'Process_QA_Resources',
  name: '',
  nodes: {
    Start: { type: 'start', name: '', incoming: [], outgoing: ['Flow_ST'] },
    Task: { type: 'task', name: '', incoming: ['Flow_ST'], outgoing: ['Flow_TE'] },
    End: { type: 'end', name: '', incoming: ['Flow_TE'], outgoing: [] },
  },
  flows: {
    Flow_ST: { from: 'Start', to: 'Task', name: '', isDefault: false },
    Flow_TE: { from: 'Task', to: 'End', name: '', isDefault: false },
  },
  source: { exporter: 'qa', exporterVersion: '0', originalIds: {} },
};

describe('QA adversarial de recursos (LILA-033)', () => {
  test('simulate acepta OR multi-pool y emite una sola fila con el pool elegido (LILA-035)', () => {
    const scenario: SimScenario = {
      run: { seed: 1 },
      resources: { a: { capacity: 1 }, b: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        Task: {
          processingTime: { type: 'constant', value: 1 },
          resources: [{ ref: 'a' }, { ref: 'b' }],
          selection: 'or',
        },
      },
    };
    const rows: { resourceId: string | null }[] = [];

    expect(() =>
      publicApi.simulate(IR, scenario, { onEvent: (row) => rows.push(row) }),
    ).not.toThrow();
    expect(rows.map((row) => row.resourceId)).toEqual(['a']);
  });

  test('FIFO estricto no deja que quantity=1 adelante al head quantity=2', () => {
    const manager = new ResourceManager({ worker: { capacity: 2 } });
    expect(manager.enqueue({
      id: 'holder', enabledAt: 0, requirements: [{ poolId: 'worker', quantity: 1 }],
    })).toHaveLength(1);
    expect(manager.enqueue({
      id: 'head', enabledAt: 1, requirements: [{ poolId: 'worker', quantity: 2 }],
    })).toEqual([]);
    expect(manager.enqueue({
      id: 'small', enabledAt: 2, requirements: [{ poolId: 'worker', quantity: 1 }],
    })).toEqual([]);

    expect(manager.release(['holder'], 3).map((allocation) => allocation.requestId)).toEqual(['head']);
    expect(manager.release(['head'], 4).map((allocation) => allocation.requestId)).toEqual(['small']);
  });

  test('cancelar un tombstone conserva seq/FIFO de los waiters restantes', () => {
    const manager = new ResourceManager({ worker: { capacity: 1 } });
    manager.enqueue({ id: 'holder', enabledAt: 0, requirements: [{ poolId: 'worker', quantity: 1 }] });
    manager.enqueue({ id: 'first', enabledAt: 1, requirements: [{ poolId: 'worker', quantity: 1 }] });
    manager.enqueue({ id: 'second', enabledAt: 1, requirements: [{ poolId: 'worker', quantity: 1 }] });

    expect(manager.cancel(['first'], 1)).toEqual([]);
    expect(manager.release(['holder'], 2)).toMatchObject([{ requestId: 'second', seq: 2 }]);
  });

  test('sin resources conserva exactamente el RunResult M1', () => {
    const result = publicApi.simulate(
      IR,
      {
        run: { seed: 7 },
        elements: {
          Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 2 },
          Task: { processingTime: { type: 'constant', value: 5 }, fixedCost: 2 },
        },
      },
      // `log: false` mantiene el RunResult en la forma exacta de M1: sin `log` (LILA-037 § 7).
      { log: false },
    );

    expect(result).toEqual({
      elements: {
        Start: {
          started: 2, completed: 2,
          processing: { min: 0, max: 0, mean: 0, total: 0 },
          resourceWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
          offHoursWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
          queueLength: { mean: 0, max: 0 }, fixedCostTotal: 0,
        },
        Task: {
          started: 2, completed: 2,
          processing: { min: 5, max: 5, mean: 5, total: 10 },
          resourceWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
          offHoursWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
          queueLength: { mean: 0, max: 0 }, fixedCostTotal: 4,
        },
        End: {
          started: 2, completed: 2,
          processing: { min: 0, max: 0, mean: 0, total: 0 },
          resourceWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
          offHoursWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
          queueLength: { mean: 0, max: 0 }, fixedCostTotal: 0,
        },
      },
      flows: { Flow_ST: { count: 2 }, Flow_TE: { count: 2 } },
      resources: {},
      process: {
        started: 2, completed: 2, inFlight: 0,
        cycleTime: { min: 5, max: 5, mean: 5, sd: 0, p50: 5, p90: 5, p95: 5 },
        waitTime: { min: 0, max: 0, mean: 0, sd: 0, p50: 0, p90: 0, p95: 0 },
        throughputPerHour: 480,
        costPerCase: 2,
        totalCost: 4,
      },
      bottlenecks: [],
      warnings: [],
    });
  });

  test('ResourceManager sigue siendo detalle interno, no segunda puerta pública', () => {
    expect('ResourceManager' in publicApi).toBe(false);
  });
});
