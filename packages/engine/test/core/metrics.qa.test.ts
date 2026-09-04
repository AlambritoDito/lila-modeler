import { describe, expect, test } from 'vitest';

import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import type { EventLogRow } from '../../src/core/result.js';
import type { ReplicationRun } from '../../src/core/sim.js';

function makeIr(
  nodes: Record<string, NodeType>,
  flows: Record<string, readonly [from: string, to: string]>,
): ProcessIR {
  const irNodes: Record<string, Node> = {};
  for (const [id, type] of Object.entries(nodes)) irNodes[id] = { type, name: '', incoming: [], outgoing: [] };
  const irFlows: Record<string, Flow> = {};
  for (const [id, [from, to]] of Object.entries(flows)) {
    irFlows[id] = { from, to, name: '', isDefault: false };
    irNodes[from]!.outgoing.push(id);
    irNodes[to]!.incoming.push(id);
  }
  return {
    id: 'Process_QA',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'qa', exporterVersion: '0', originalIds: {} },
  };
}

const IR = makeIr(
  { Start: 'start', Gate: 'xor', Task: 'task', Timer: 'timer', End: 'end', Never: 'task' },
  {
    Flow_SG: ['Start', 'Gate'],
    Flow_GT: ['Gate', 'Task'],
    Flow_TT: ['Task', 'Timer'],
    Flow_TE: ['Timer', 'End'],
    Flow_Never: ['Gate', 'Never'],
  },
);

function row(caseId: number, elementId: string, processing: number, resourceWait = 0, offHoursWait = 0, cost = 0): EventLogRow {
  const enabledAt = 0;
  return {
    replication: 0,
    caseId: String(caseId),
    elementId,
    resourceId: null,
    enabledAt,
    startedAt: enabledAt + resourceWait,
    endedAt: enabledAt + resourceWait + offHoursWait + processing,
    resourceWait,
    offHoursWait,
    cost,
  };
}

function allNumbers(value: unknown): number[] {
  if (typeof value === 'number') return [value];
  if (value === null || typeof value !== 'object') return [];
  return Object.values(value).flatMap(allNumbers);
}

describe('QA adversarial LILA-028', () => {
  test('conserva todos los ids, deja ceros finitos y no inventa processing para gateways', () => {
    const run: ReplicationRun = {
      replication: 0,
      stoppedAt: 20,
      statisticsDuration: 20,
      cases: [{ caseId: 1, startId: 'Start', startedAt: 0, endedAt: 20 }],
      rows: [row(1, 'Task', 5), row(1, 'Timer', 15)],
      flows: { Flow_SG: 1, Flow_GT: 1, Flow_TT: 1, Flow_TE: 1, Flow_Never: 0 },
      elements: {
        Start: { started: 1, completed: 1 },
        Gate: { started: 1, completed: 1 },
        Task: { started: 1, completed: 1 },
        Timer: { started: 1, completed: 1 },
        End: { started: 1, completed: 1 },
        Never: { started: 0, completed: 0 },
      },
      warnings: [],
    };

    const result = aggregateReplication(IR, run);
    expect(Object.keys(result.elements)).toEqual(Object.keys(IR.nodes));
    expect(Object.keys(result.flows)).toEqual(Object.keys(IR.flows));
    expect(result.elements.Task?.processing.total).toBe(5);
    expect(result.elements.Timer?.processing.total).toBe(15);
    expect(result.elements.Gate?.processing.total).toBe(0);
    expect(result.elements.Never?.processing).toEqual({ min: 0, max: 0, mean: 0, total: 0 });
    expect(allNumbers(result).every(Number.isFinite)).toBe(true);
  });

  test('sd es muestral para N y cero para una observación', () => {
    const run: ReplicationRun = {
      replication: 0,
      stoppedAt: 30,
      statisticsDuration: 30,
      cases: [
        { caseId: 1, startId: 'Start', startedAt: 0, endedAt: 11 },
        { caseId: 2, startId: 'Start', startedAt: 0, endedAt: 12 },
        { caseId: 3, startId: 'Start', startedAt: 0, endedAt: 13 },
      ],
      rows: [row(1, 'Task', 10, 1), row(2, 'Task', 10, 2), row(3, 'Task', 10, 3), row(1, 'Timer', 1, 7)],
      flows: {},
      elements: {
        Task: { started: 3, completed: 3 },
        Timer: { started: 1, completed: 1 },
      },
      warnings: [],
    };

    const result = aggregateReplication(makeIr({ Task: 'task', Timer: 'timer' }, {}), run);
    expect(result.elements.Task?.resourceWait).toEqual({ min: 1, max: 3, mean: 2, sd: 1, total: 6 });
    expect(result.elements.Timer?.resourceWait.sd).toBe(0);
  });

  test('interpola percentiles en ambos bordes de una muestra par', () => {
    const run: ReplicationRun = {
      replication: 0,
      stoppedAt: 30,
      statisticsDuration: 30,
      cases: [0, 10, 20, 30].map((endedAt, index) => ({
        caseId: index + 1,
        startId: 'Start',
        startedAt: 0,
        endedAt,
      })),
      rows: [],
      flows: {},
      elements: {},
      warnings: [],
    };

    const cycle = aggregateReplication(makeIr({ Start: 'start' }, {}), run).process.cycleTime;
    expect(cycle).toMatchObject({ min: 0, max: 30, p50: 15, p90: 27 });
    expect(cycle.p95).toBeCloseTo(28.5, 12);
  });

  test('throughput usa solo [warmup, stoppedAt] y evita dividir entre una ventana vacía', () => {
    const run: ReplicationRun = {
      replication: 0,
      stoppedAt: 100,
      statisticsDuration: 50,
      cases: [{ caseId: 6, startId: 'Start', startedAt: 50, endedAt: 60 }],
      rows: [],
      flows: {},
      elements: {},
      warnings: [],
    };

    expect(
      aggregateReplication(makeIr({ Start: 'start' }, {}), run).process.throughputPerHour,
    ).toBe(72);
    run.statisticsDuration = 0;
    expect(
      aggregateReplication(makeIr({ Start: 'start' }, {}), run).process.throughputPerHour,
    ).toBe(0);
  });

  test('costPerCase excluye costos de casos en vuelo, pero totalCost los conserva (R-COST-4)', () => {
    const run: ReplicationRun = {
      replication: 0,
      stoppedAt: 20,
      statisticsDuration: 20,
      cases: [
        { caseId: 1, startId: 'Start', startedAt: 0, endedAt: 10 },
        { caseId: 2, startId: 'Start', startedAt: 0, endedAt: null },
      ],
      rows: [row(1, 'Task', 10, 0, 0, 2), row(2, 'Task', 10, 0, 0, 100)],
      flows: {},
      elements: { Task: { started: 2, completed: 2 } },
      warnings: [],
    };

    const process = aggregateReplication(makeIr({ Task: 'task' }, {}), run).process;
    expect(process).toMatchObject({ started: 2, completed: 1, inFlight: 1, totalCost: 102, costPerCase: 2 });
  });
});
