import { describe, expect, test } from 'vitest';

import type { Flow, Node, ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import { runReplication, type SimScenario } from '../../src/core/sim.js';

function linearIr(): ProcessIR {
  const nodes: Record<string, Node> = {
    Start: { type: 'start', name: '', incoming: [], outgoing: ['Flow_ST'] },
    Task: { type: 'task', name: '', incoming: ['Flow_ST'], outgoing: ['Flow_TE'] },
    End: { type: 'end', name: '', incoming: ['Flow_TE'], outgoing: [] },
  };
  const flows: Record<string, Flow> = {
    Flow_ST: { from: 'Start', to: 'Task', name: '', isDefault: false },
    Flow_TE: { from: 'Task', to: 'End', name: '', isDefault: false },
  };
  return { id: 'Process_Resource', name: '', nodes, flows, source: { exporter: 'test', exporterVersion: '0', originalIds: {} } };
}

function terminateIr(): ProcessIR {
  const nodes: Record<string, Node> = {
    StartKill: { type: 'start', name: '', incoming: [], outgoing: ['SK_F'] },
    Fork: { type: 'and', name: '', incoming: ['SK_F'], outgoing: ['F_Work', 'F_Timer'] },
    Work: { type: 'task', name: '', incoming: ['F_Work'], outgoing: ['Work_End'] },
    Timer: { type: 'timer', name: '', incoming: ['F_Timer'], outgoing: ['Timer_Kill'] },
    Kill: { type: 'terminate', name: '', incoming: ['Timer_Kill'], outgoing: [] },
    DeadEnd: { type: 'end', name: '', incoming: ['Work_End'], outgoing: [] },
    StartOther: { type: 'start', name: '', incoming: [], outgoing: ['SO_Delay'] },
    Delay: { type: 'timer', name: '', incoming: ['SO_Delay'], outgoing: ['Delay_Other'] },
    Other: { type: 'task', name: '', incoming: ['Delay_Other'], outgoing: ['Other_End'] },
    OtherEnd: { type: 'end', name: '', incoming: ['Other_End'], outgoing: [] },
  };
  const edge = (from: string, to: string): Flow => ({ from, to, name: '', isDefault: false });
  const flows: Record<string, Flow> = {
    SK_F: edge('StartKill', 'Fork'), F_Work: edge('Fork', 'Work'), F_Timer: edge('Fork', 'Timer'),
    Work_End: edge('Work', 'DeadEnd'), Timer_Kill: edge('Timer', 'Kill'),
    SO_Delay: edge('StartOther', 'Delay'), Delay_Other: edge('Delay', 'Other'), Other_End: edge('Other', 'OtherEnd'),
  };
  return { id: 'Process_Terminate', name: '', nodes, flows, source: { exporter: 'test', exporterVersion: '0', originalIds: {} } };
}

function scenario(overrides: Partial<SimScenario['run']> = {}): SimScenario {
  return {
    run: { seed: 1, ...overrides },
    resources: { worker: { capacity: 2 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 3 },
      Task: { processingTime: { type: 'constant', value: 10 }, resources: [{ ref: 'worker', quantity: 2 }] },
    },
  };
}

describe('integración de recursos LILA-033', () => {
  test('aceptación exacta: capacity=2, quantity=2 y FIFO produce 0/9/18 s de espera', () => {
    const run = runReplication(linearIr(), scenario());
    const taskRows = run.rows.filter((row) => row.elementId === 'Task');

    expect(taskRows.map((row) => row.enabledAt)).toEqual([0, 1, 2]);
    expect(taskRows.map((row) => row.startedAt)).toEqual([0, 10, 20]);
    expect(taskRows.map((row) => row.endedAt)).toEqual([10, 20, 30]);
    expect(taskRows.map((row) => row.resourceWait)).toEqual([0, 9, 18]);
    expect(taskRows.map((row) => row.resourceQuantity)).toEqual([2, 2, 2]);
    expect(new Set(taskRows.map((row) => row.activityInstanceId)).size).toBe(3);
    expect(run.cases.map((record) => record.endedAt)).toEqual([10, 20, 30]);
    expect(run.stoppedAt).toBe(30);

    const result = aggregateReplication(linearIr(), run);
    expect(result.elements.Task?.resourceWait).toEqual({ min: 0, max: 18, mean: 9, sd: 9, total: 27 });
  });

  test('casos pre-warmup ocupan capacidad pero quedan fuera de contadores, esperas y costos', () => {
    const input: SimScenario = {
      run: { seed: 1, warmup: 5 },
      resources: { worker: { capacity: 1, fixedCost: 3, costPerHour: 3600 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 5 }, triggerCount: 2 },
        Task: {
          processingTime: { type: 'constant', value: 10 },
          resources: [{ ref: 'worker' }],
          fixedCost: 2,
        },
      },
    };
    const run = runReplication(linearIr(), input);
    expect(run.rows).toHaveLength(2);
    expect(run.cases.map((record) => record.caseId)).toEqual([2]);
    expect(run.rows.find((row) => row.caseId === '2')).toMatchObject({
      enabledAt: 5,
      startedAt: 10,
      endedAt: 20,
      resourceWait: 5,
      elementCost: 2,
      resourceCost: 13,
      cost: 15,
    });

    const result = aggregateReplication(linearIr(), run);
    expect(result.process).toMatchObject({ started: 1, completed: 1, totalCost: 15, costPerCase: 15 });
    expect(result.elements.Task?.resourceWait.total).toBe(5);
    expect(result.elements.Task?.fixedCostTotal).toBe(2);
  });

  test('el corte emite lifecycle parcial para activo y queued sin inventar completados', () => {
    const run = runReplication(linearIr(), {
      run: { seed: 1, duration: 15 },
      resources: { worker: { capacity: 1, fixedCost: 4, costPerHour: 3600 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 5 }, triggerCount: 2 },
        Task: { processingTime: { type: 'constant', value: 20 }, resources: [{ ref: 'worker' }], fixedCost: 7 },
      },
    });
    const taskRows = run.rows.filter((row) => row.elementId === 'Task');
    expect(taskRows).toMatchObject([
      { status: 'inFlight', enabledAt: 0, startedAt: 0, endedAt: null, observedUntil: 15, elementCost: 0, resourceCost: 19 },
      { status: 'inFlight', resourceId: null, resourceQuantity: null, allocationIndex: null, enabledAt: 5, startedAt: null, endedAt: null, observedUntil: 15, resourceWait: 10, cost: 0 },
    ]);
    expect(run.elements.Task).toEqual({ started: 2, completed: 0 });
    expect(aggregateReplication(linearIr(), run).process).toMatchObject({ completed: 0, inFlight: 2, totalCost: 19 });
  });

  test('cada replicación recrea manager, secuencia e ids de actividad', () => {
    const first = runReplication(linearIr(), scenario(), 0);
    const second = runReplication(linearIr(), scenario(), 1);
    expect(second.rows[0]).toMatchObject({ replication: 1, activityInstanceId: '1', startedAt: 0 });
    expect(second.rows.map(({ replication: _replication, ...row }) => row)).toEqual(
      first.rows.map(({ replication: _replication, ...row }) => row),
    );
  });

  test('terminate cierra el activo, libera una vez y arranca el queued de otro caso en ese instante', () => {
    const run = runReplication(terminateIr(), {
      run: { seed: 1 },
      resources: { worker: { capacity: 1 } },
      elements: {
        StartKill: { interTriggerTimer: { type: 'constant', value: 100 }, triggerCount: 1 },
        StartOther: { interTriggerTimer: { type: 'constant', value: 100 }, triggerCount: 1 },
        Work: { processingTime: { type: 'constant', value: 100 }, resources: [{ ref: 'worker' }] },
        Timer: { processingTime: { type: 'constant', value: 5 } },
        Delay: { processingTime: { type: 'constant', value: 1 } },
        Other: { processingTime: { type: 'constant', value: 10 }, resources: [{ ref: 'worker' }] },
      },
    });
    expect(run.rows.find((row) => row.elementId === 'Work')).toMatchObject({
      status: 'terminated', startedAt: 0, endedAt: null, observedUntil: 5,
    });
    expect(run.rows.find((row) => row.elementId === 'Other')).toMatchObject({
      status: 'completed', enabledAt: 1, startedAt: 5, endedAt: 15, resourceWait: 4,
    });
    expect(run.elements.Other).toEqual({ started: 1, completed: 1 });
    expect(run.cases.map((record) => record.endedAt)).toEqual([5, 15]);
  });

  test('AbortSignal cierra active+queued y el callback parcial no puede mutar las filas internas', () => {
    const signal = { aborted: false };
    const streamed: Array<{ status: string; cost: number }> = [];
    const run = runReplication(linearIr(), {
      run: { seed: 1 },
      resources: { worker: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 3 },
        Task: { processingTime: { type: 'constant', value: 100 }, resources: [{ ref: 'worker' }] },
      },
    }, 0, {
      signal,
      onStep: (time) => { if (time >= 2) signal.aborted = true; },
      onEvent: (row) => {
        streamed.push({ status: row.status, cost: row.cost });
        row.status = 'completed';
        row.cost = 999;
      },
    });
    expect(run.cancelled).toBe(true);
    expect(streamed).toEqual([{ status: 'inFlight', cost: 0 }, { status: 'inFlight', cost: 0 }]);
    expect(run.rows.map((row) => ({ status: row.status, cost: row.cost }))).toEqual([
      { status: 'inFlight', cost: 0 },
      { status: 'inFlight', cost: 0 },
    ]);
  });

  test.each(['and', 'or'] as const)('multi-pool %s no se degrada silenciosamente a infinito', (selection) => {
    const input = scenario();
    input.resources = { a: { capacity: 1 }, b: { capacity: 1 } };
    input.elements!.Task!.resources = [{ ref: 'a' }, { ref: 'b' }];
    input.elements!.Task!.selection = selection;
    const events: unknown[] = [];
    expect(() => runReplication(linearIr(), input, 0, { onEvent: (row) => events.push(row) })).toThrow(
      /E-REC-MULTIPOOL-PENDIENTE/,
    );
    expect(events).toEqual([]);
  });
});
