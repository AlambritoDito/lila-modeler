import { describe, expect, test } from 'vitest';

import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import { runReplication, type ReplicationRun, type SimScenario } from '../../src/core/sim.js';

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
    id: 'Process_Metrics',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

const LINEAR_IR = makeIr(
  { Start: 'start', A: 'task', B: 'task', End: 'end' },
  {
    Flow_SA: ['Start', 'A'],
    Flow_AB: ['A', 'B'],
    Flow_BE: ['B', 'End'],
  },
);

const LINEAR_SCENARIO: SimScenario = {
  run: { seed: 42 },
  elements: {
    Start: { interTriggerTimer: { type: 'constant', value: 1000 }, triggerCount: 5 },
    A: { processingTime: { type: 'constant', value: 60 }, fixedCost: 2 },
    B: { processingTime: { type: 'constant', value: 120 }, fixedCost: 3 },
  },
};

describe('aceptación LILA-028: proceso lineal constante', () => {
  const run = runReplication(LINEAR_IR, LINEAR_SCENARIO);
  const result = aggregateReplication(LINEAR_IR, run);

  test('el ciclo es exactamente la suma y p50 = p95', () => {
    expect(result.process.cycleTime).toEqual({
      min: 180,
      max: 180,
      mean: 180,
      sd: 0,
      p50: 180,
      p90: 180,
      p95: 180,
    });
  });

  test('agrega started/completed y processing min/max/mean/total por elemento', () => {
    expect(result.elements.A).toMatchObject({
      started: 5,
      completed: 5,
      processing: { min: 60, max: 60, mean: 60, total: 300 },
      fixedCostTotal: 10,
    });
    expect(result.elements.B).toMatchObject({
      started: 5,
      completed: 5,
      processing: { min: 120, max: 120, mean: 120, total: 600 },
      fixedCostTotal: 15,
    });
    expect(result.elements.Start?.processing).toEqual({ min: 0, max: 0, mean: 0, total: 0 });
    expect(result.elements.End?.processing).toEqual({ min: 0, max: 0, mean: 0, total: 0 });
  });

  test('cuenta todos los flujos por id BPMN', () => {
    expect(result.flows).toEqual({
      Flow_SA: { count: 5 },
      Flow_AB: { count: 5 },
      Flow_BE: { count: 5 },
    });
  });

  test('calcula conteos del proceso y throughput sobre la duración efectiva', () => {
    expect(result.process.started).toBe(5);
    expect(result.process.completed).toBe(5);
    expect(result.process.inFlight).toBe(0);
    expect(result.process.throughputPerHour).toBe(5 / (run.stoppedAt / 3600));
    expect(result.process.waitTime).toEqual({ min: 0, max: 0, mean: 0, sd: 0, p50: 0, p90: 0, p95: 0 });
    expect(result.process.totalCost).toBe(25);
    expect(result.process.costPerCase).toBe(5);
  });
});

describe('casos adversos de agregación', () => {
  test('excluye casos en vuelo de ciclo y percentiles, pero los cuenta como started/inFlight', () => {
    const run = runReplication(
      makeIr({ Start: 'start', A: 'task', End: 'end' }, { Flow_SA: ['Start', 'A'], Flow_AE: ['A', 'End'] }),
      {
        run: { duration: 25, seed: 1 },
        elements: {
          Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 10 },
          A: { processingTime: { type: 'constant', value: 20 } },
        },
      },
    );
    const ir = makeIr(
      { Start: 'start', A: 'task', End: 'end' },
      { Flow_SA: ['Start', 'A'], Flow_AE: ['A', 'End'] },
    );
    const result = aggregateReplication(ir, run);

    expect(result.process).toMatchObject({ started: 3, completed: 1, inFlight: 2 });
    expect(result.process.cycleTime).toEqual({ min: 20, max: 20, mean: 20, sd: 0, p50: 20, p90: 20, p95: 20 });
    expect(result.elements.A).toMatchObject({ started: 3, completed: 1, processing: { total: 20 } });
  });

  test('usa desviación muestral e interpolación lineal de percentiles', () => {
    const ir = makeIr({ Start: 'start', End: 'end' }, { Flow_SE: ['Start', 'End'] });
    const manual: ReplicationRun = {
      replication: 0,
      stoppedAt: 20,
      statisticsDuration: 20,
      cases: [
        { caseId: 1, startId: 'Start', startedAt: 0, endedAt: 10 },
        { caseId: 2, startId: 'Start', startedAt: 0, endedAt: 20 },
      ],
      rows: [],
      flows: { Flow_SE: 2 },
      elements: { Start: { started: 2, completed: 2 }, End: { started: 2, completed: 2 } },
      warnings: [],
    };
    const result = aggregateReplication(ir, manual);

    expect(result.process.cycleTime.sd).toBeCloseTo(Math.sqrt(50), 12);
    expect(result.process.cycleTime.p50).toBe(15);
    expect(result.process.cycleTime.p90).toBe(19);
    expect(result.process.cycleTime.p95).toBe(19.5);
  });

  test('filtra del agregado las filas conservadas solo para el event log de warmup', () => {
    const ir = makeIr({ Start: 'start', A: 'task', End: 'end' }, { Flow_SA: ['Start', 'A'], Flow_AE: ['A', 'End'] });
    const manual: ReplicationRun = {
      replication: 0,
      stoppedAt: 100,
      statisticsDuration: 50,
      // LILA-027 deja aquí solo el caso observable; la fila del caso 1 se conserva en el log.
      cases: [{ caseId: 2, startId: 'Start', startedAt: 50, endedAt: 60 }],
      rows: [
        {
          replication: 0,
          caseId: '1',
          activityInstanceId: '1-A',
          elementId: 'A',
          resourceId: null,
          allocationIndex: null,
          resourceQuantity: null,
          status: 'completed',
          enabledAt: 0,
          startedAt: 0,
          endedAt: 40,
          observedUntil: 40,
          resourceWait: 0,
          offHoursWait: 0,
          elementCost: 100,
          resourceCost: 0,
          cost: 100,
        },
        {
          replication: 0,
          caseId: '2',
          activityInstanceId: '2-A',
          elementId: 'A',
          resourceId: null,
          allocationIndex: null,
          resourceQuantity: null,
          status: 'completed',
          enabledAt: 50,
          startedAt: 50,
          endedAt: 60,
          observedUntil: 60,
          resourceWait: 0,
          offHoursWait: 0,
          elementCost: 3,
          resourceCost: 0,
          cost: 3,
        },
      ],
      flows: { Flow_SA: 1, Flow_AE: 1 },
      elements: {
        Start: { started: 1, completed: 1 },
        A: { started: 1, completed: 1 },
        End: { started: 1, completed: 1 },
      },
      warnings: ['aviso estable'],
    };
    const result = aggregateReplication(ir, manual);

    expect(result.elements.A?.processing).toEqual({ min: 10, max: 10, mean: 10, total: 10 });
    expect(result.elements.A?.fixedCostTotal).toBe(3);
    expect(result.process.totalCost).toBe(3);
    expect(result.process.throughputPerHour).toBe(72);
    expect(result.warnings).toEqual(['aviso estable']);
  });

  test('separa processing de esperas de recurso y de calendario (R-CAL-8)', () => {
    const ir = makeIr({ Start: 'start', A: 'task', End: 'end' }, { Flow_SA: ['Start', 'A'], Flow_AE: ['A', 'End'] });
    const manual: ReplicationRun = {
      replication: 0,
      stoppedAt: 100,
      statisticsDuration: 100,
      cases: [{ caseId: 1, startId: 'Start', startedAt: 0, endedAt: 100 }],
      rows: [
        {
          replication: 0,
          caseId: '1',
          activityInstanceId: '1-A',
          elementId: 'A',
          resourceId: null,
          allocationIndex: null,
          resourceQuantity: null,
          status: 'completed',
          enabledAt: 0,
          startedAt: 10,
          endedAt: 100,
          observedUntil: 100,
          resourceWait: 10,
          // Incluye un cierre durante el processing: endedAt - startedAt no sería processing.
          offHoursWait: 30,
          elementCost: 0,
          resourceCost: 0,
          cost: 0,
        },
      ],
      flows: { Flow_SA: 1, Flow_AE: 1 },
      elements: {
        Start: { started: 1, completed: 1 },
        A: { started: 1, completed: 1 },
        End: { started: 1, completed: 1 },
      },
      warnings: [],
    };
    const result = aggregateReplication(ir, manual);

    expect(result.elements.A?.processing).toEqual({ min: 60, max: 60, mean: 60, total: 60 });
    expect(result.process.waitTime).toEqual({ min: 40, max: 40, mean: 40, sd: 0, p50: 40, p90: 40, p95: 40 });
  });

  test('devuelve ceros finitos cuando no hay observaciones ni ventana efectiva', () => {
    const ir = makeIr({ Start: 'start', A: 'task', End: 'end' }, { Flow_SA: ['Start', 'A'], Flow_AE: ['A', 'End'] });
    const manual: ReplicationRun = {
      replication: 0,
      stoppedAt: 0,
      statisticsDuration: 0,
      cases: [],
      rows: [],
      flows: { Flow_SA: 0, Flow_AE: 0 },
      elements: {
        Start: { started: 0, completed: 0 },
        A: { started: 0, completed: 0 },
        End: { started: 0, completed: 0 },
      },
      warnings: [],
    };
    const result = aggregateReplication(ir, manual);

    expect(result.elements.A).toEqual({
      started: 0,
      completed: 0,
      processing: { min: 0, max: 0, mean: 0, total: 0 },
      resourceWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
      offHoursWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
      queueLength: { mean: 0, max: 0 },
      fixedCostTotal: 0,
    });
    expect(Object.values(result.process).every((value) => typeof value !== 'number' || Number.isFinite(value))).toBe(true);
    expect(result.process.throughputPerHour).toBe(0);
    expect(result.process.costPerCase).toBe(0);
  });

  test('no muta la salida intermedia al ordenar los percentiles', () => {
    const run = runReplication(LINEAR_IR, LINEAR_SCENARIO);
    const before = JSON.stringify(run);
    aggregateReplication(LINEAR_IR, run);
    expect(JSON.stringify(run)).toBe(before);
  });
});

/* ------------------------------------------------------------------ *
 * #316 — desglose por desenlace (`process.byEndEvent`)
 * ------------------------------------------------------------------ */

/**
 * Dos ramas independientes, cada una con su propio `end`: los casos rápidos (60 s) y los lentos
 * (600 s) tienen tiempos de ciclo distintos entre sí y distintos de la media global, que es la
 * mezcla ponderada de ambos. La duración corta la corrida a mitad de la rama lenta, así que dos
 * casos quedan en vuelo y no pueden contar en ningún desenlace.
 */
const OUTCOME_IR = makeIr(
  {
    StartFast: 'start',
    StartSlow: 'start',
    Fast: 'task',
    Slow: 'task',
    EndFast: 'end',
    EndSlow: 'end',
  },
  {
    Flow_SF: ['StartFast', 'Fast'],
    Flow_FE: ['Fast', 'EndFast'],
    Flow_SS: ['StartSlow', 'Slow'],
    Flow_SE: ['Slow', 'EndSlow'],
  },
);

/** Llegadas en 0, 100, …, 400 por rama; la rápida cierra en +60 y la lenta en +600. */
const OUTCOME_SCENARIO: SimScenario = {
  run: { seed: 42, duration: 850 },
  elements: {
    StartFast: { interTriggerTimer: { type: 'constant', value: 100 }, triggerCount: 5 },
    StartSlow: { interTriggerTimer: { type: 'constant', value: 100 }, triggerCount: 5 },
    Fast: { processingTime: { type: 'constant', value: 60 } },
    Slow: { processingTime: { type: 'constant', value: 600 } },
  },
};

describe('#316: métricas por desenlace', () => {
  const run = runReplication(OUTCOME_IR, OUTCOME_SCENARIO);
  const result = aggregateReplication(OUTCOME_IR, run, OUTCOME_SCENARIO);

  test('cada desenlace tiene su propia media de ciclo, distinta de la global', () => {
    expect(result.process.byEndEvent.EndFast?.cycleTime.mean).toBe(60);
    expect(result.process.byEndEvent.EndSlow?.cycleTime.mean).toBe(600);
    // La media global es la mezcla ponderada: (5 × 60 + 3 × 600) / 8.
    expect(result.process.cycleTime.mean).toBe(262.5);
  });

  test('los conteos por desenlace suman `process.completed`', () => {
    const outcomes = Object.values(result.process.byEndEvent);
    expect(outcomes.reduce((total, outcome) => total + outcome.completed, 0)).toBe(
      result.process.completed,
    );
    expect(result.process.completed).toBe(8);
  });

  test('los casos en vuelo no cuentan en ningún desenlace', () => {
    // Los dos casos lentos que cerrarían en 900 y 1000 siguen vivos al parar en 850.
    expect(result.process.inFlight).toBe(2);
    expect(result.process.started).toBe(10);
    expect(result.process.byEndEvent.EndSlow?.completed).toBe(3);
    expect(result.process.byEndEvent.EndSlow?.cycleTime.max).toBe(600);
  });

  test('todo `end` del IR estrena entrada, aunque ningún caso lo alcance', () => {
    const sinLlegadas = aggregateReplication(
      OUTCOME_IR,
      runReplication(OUTCOME_IR, { run: { seed: 42, duration: 1 } }),
      { run: { seed: 42, duration: 1 } },
    );
    expect(Object.keys(sinLlegadas.process.byEndEvent)).toEqual(['EndFast', 'EndSlow']);
    expect(sinLlegadas.process.byEndEvent.EndFast).toEqual({
      completed: 0,
      cycleTime: { min: 0, max: 0, mean: 0, sd: 0, p50: 0, p90: 0, p95: 0 },
      waitTime: { min: 0, max: 0, mean: 0, sd: 0, p50: 0, p90: 0, p95: 0 },
    });
  });

  test('sin `run.serviceLevel` no se publica `withinServiceLevel`', () => {
    expect(result.process.withinServiceLevel).toBeUndefined();
    expect(result.process.byEndEvent.EndFast?.withinServiceLevel).toBeUndefined();
  });

  test('`run.serviceLevel` publica la fracción cumplida, global y por desenlace', () => {
    const scenario: SimScenario = {
      ...OUTCOME_SCENARIO,
      run: { ...OUTCOME_SCENARIO.run, serviceLevel: 300 },
    };
    const conUmbral = aggregateReplication(OUTCOME_IR, runReplication(OUTCOME_IR, scenario), scenario);

    // 5 de los 8 casos completados (los rápidos, 60 s) bajan del umbral de 300 s.
    expect(conUmbral.process.withinServiceLevel).toBe(0.625);
    expect(conUmbral.process.byEndEvent.EndFast?.withinServiceLevel).toBe(1);
    expect(conUmbral.process.byEndEvent.EndSlow?.withinServiceLevel).toBe(0);
  });
});
