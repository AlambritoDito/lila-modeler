import { describe, expect, test } from 'vitest';

import { simulate as publicSimulate, type SimulateOptions } from '../../src/index.js';
import type { ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import { runReplication, type SimScenario } from '../../src/core/sim.js';

const IR: ProcessIR = {
  id: 'Process_Run',
  name: '',
  nodes: {
    Start: { type: 'start', name: '', incoming: [], outgoing: ['Flow_SA'] },
    A: { type: 'task', name: '', incoming: ['Flow_SA'], outgoing: ['Flow_AE'] },
    End: { type: 'end', name: '', incoming: ['Flow_AE'], outgoing: [] },
  },
  flows: {
    Flow_SA: { from: 'Start', to: 'A', name: '', isDefault: false },
    Flow_AE: { from: 'A', to: 'End', name: '', isDefault: false },
  },
  source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
};

function scenario(replications = 1): SimScenario {
  return {
    run: { duration: 100, warmup: 0, replications, seed: 42 },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 3 },
      A: { processingTime: { type: 'constant', value: 5 }, fixedCost: 2 },
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

describe('simulate (LILA-029)', () => {
  test('es pública, determinista y no muta IR, escenario ni opciones', () => {
    const ir = deepFreeze(structuredClone(IR));
    const input = deepFreeze(scenario(3));
    const options = deepFreeze({ log: true } satisfies SimulateOptions);
    const before = JSON.stringify({ ir, input, options });

    const first = publicSimulate(ir, input, options);
    const second = publicSimulate(ir, input, options);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify({ ir, input, options })).toBe(before);
    expect(first.cancelled).toBeUndefined();
    expect(first.completedReplications).toBeUndefined();
  });

  test('emite el log completo en orden; log false suprime el callback sin cambiar métricas', () => {
    const rows: string[] = [];
    const withLog = publicSimulate(IR, scenario(2), {
      onEvent: (row) => rows.push(`${row.replication}:${row.caseId}:${row.elementId}`),
    });
    let calls = 0;
    const withoutLog = publicSimulate(IR, scenario(2), {
      log: false,
      onEvent: () => calls++,
    });

    expect(rows).toEqual(['0:1:A', '0:2:A', '0:3:A', '1:1:A', '1:2:A', '1:3:A']);
    expect(calls).toBe(0);
    expect(withoutLog).toEqual(withLog);
  });

  test('una mutación desde onEvent no contamina las métricas internas', () => {
    // LILA-037 § 7: pasar `onEvent` suprime `result.log`, así que la línea base se pide sin log
    // para que la comparación sea de métricas y no del contrato de retención.
    const baseline = publicSimulate(IR, scenario(), { log: false });
    const result = publicSimulate(IR, scenario(), {
      onEvent: (row) => {
        row.cost = 999;
        row.endedAt = row.startedAt;
      },
    });

    expect(result).toEqual(baseline);
  });

  test('reporta progreso global monótono y termina exactamente en uno', () => {
    const progress: { fraction: number; completed: number; replication: number }[] = [];

    publicSimulate(IR, scenario(2), {
      onProgress: (item) =>
        progress.push({
          fraction: item.fraction,
          completed: item.completedReplications,
          replication: item.replication,
        }),
    });

    expect(progress[0]).toEqual({ fraction: 0, completed: 0, replication: 0 });
    expect(progress.at(-1)).toEqual({ fraction: 1, completed: 2, replication: 1 });
    expect(progress.every((item, index) => index === 0 || item.fraction > progress[index - 1]!.fraction)).toBe(true);
  });

  test('una señal ya abortada devuelve un resultado neutro marcado y sin IC', () => {
    const result = publicSimulate(IR, scenario(3), { signal: { aborted: true } });

    expect(result).toMatchObject({ cancelled: true, completedReplications: 0 });
    expect(result.process).toMatchObject({ started: 0, completed: 0, inFlight: 0 });
    expect(result.replications).toBeUndefined();
  });

  test('cancelar durante la primera replicación conserva el trabajo parcial', () => {
    const signal = { aborted: false };
    const result = publicSimulate(IR, scenario(3), {
      signal,
      onEvent: () => {
        signal.aborted = true;
      },
    });

    expect(result).toMatchObject({ cancelled: true, completedReplications: 0 });
    expect(result.elements.A).toMatchObject({ started: 1, completed: 1 });
    expect(result.process).toMatchObject({ started: 1, completed: 0, inFlight: 1 });
    expect(result.replications).toBeUndefined();
  });

  test('cancelar dentro de la segunda replicación incluye la parcial top-level pero no crea IC', () => {
    const signal = { aborted: false };
    const result = publicSimulate(IR, scenario(3), {
      signal,
      onEvent: (row) => {
        if (row.replication === 1) signal.aborted = true;
      },
    });

    expect(result).toMatchObject({ cancelled: true, completedReplications: 1 });
    // Primera réplica: 3 completadas; segunda parcial: 1. El top-level conserva ambas: media 2.
    expect(result.elements.A?.completed).toBe(2);
    expect(result.replications).toBeUndefined();
  });

  test('cancelar dentro de la tercera usa solo las dos completas para el IC', () => {
    const signal = { aborted: false };
    const result = publicSimulate(IR, scenario(4), {
      signal,
      onEvent: (row) => {
        if (row.replication === 2) signal.aborted = true;
      },
    });

    expect(result).toMatchObject({ cancelled: true, completedReplications: 2 });
    expect(result.elements.A?.completed).toBeCloseTo(7 / 3, 12);
    expect(result.replications).toMatchObject({ count: 2 });
    expect(result.replications?.kpis['elements.A.completed']).toEqual({ mean: 3, sd: 0, ci95: [3, 3] });
  });

  test('cancelar desde el progreso de cierre detiene entre replicaciones sin inventar una parcial', () => {
    const signal = { aborted: false };
    const result = publicSimulate(IR, scenario(3), {
      signal,
      onProgress: ({ completedReplications }) => {
        if (completedReplications === 1) signal.aborted = true;
      },
    });

    expect(result).toMatchObject({ cancelled: true, completedReplications: 1 });
    expect(result.elements.A?.completed).toBe(3);
    expect(result.replications).toBeUndefined();
  });

  test('los campos top-level son medias por réplica y coinciden con replications.kpis', () => {
    const input: SimScenario = {
      run: { replications: 2, seed: 17 },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 1 },
        A: { processingTime: { type: 'uniform', min: 1, max: 100 } },
      },
    };
    const perReplication = [0, 1].map((index) =>
      aggregateReplication(IR, runReplication(IR, input, index)),
    );
    const result = publicSimulate(IR, input);
    const expected =
      (perReplication[0]!.process.cycleTime.mean + perReplication[1]!.process.cycleTime.mean) / 2;

    expect(result.process.cycleTime.mean).toBe(expected);
    expect(result.process.cycleTime.mean).not.toBe(perReplication[0]!.process.cycleTime.mean);
    expect(result.replications?.kpis['process.cycleTime.mean']?.mean).toBe(expected);
  });

  test('agrega warnings iguales entre replicaciones sin duplicarlos', () => {
    const input = scenario(2);
    delete input.elements?.A?.processingTime;

    const result = publicSimulate(IR, input);

    // El escenario se queda sin ningún `processingTime`, así que el aviso es el agregado de
    // R-DEG-3 (LILA-198): uno solo, con los ids, y el mismo en las dos replicaciones.
    expect(result.warnings).toEqual([
      'W-TAREA-SIN-TIEMPO: A: el escenario no declara ningún processingTime; esas tareas duran 0 segundos.',
    ]);
  });

  test('promedia la utilización del cuello solo en las réplicas donde aparece', () => {
    const input: SimScenario = {
      run: { replications: 2, seed: 1 },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 2 },
        A: {
          processingTime: { type: 'uniform', min: 1, max: 20 },
          resources: [{ ref: 'agente' }],
        },
      },
      resources: { agente: { capacity: 1 } },
    };
    const perReplication = [0, 1].map((index) =>
      aggregateReplication(IR, runReplication(IR, input, index), input),
    );

    expect(perReplication.map((result) => result.bottlenecks.length)).toEqual([1, 0]);
    const result = publicSimulate(IR, input);

    expect(result.bottlenecks).toHaveLength(1);
    expect(result.bottlenecks[0]!.resourceWaitTotal).toBeCloseTo(
      perReplication[0]!.bottlenecks[0]!.resourceWaitTotal / 2,
      12,
    );
    expect(result.bottlenecks[0]!.utilization).toBe(perReplication[0]!.bottlenecks[0]!.utilization);
    expect(result.bottlenecks[0]!.utilization).toBe(1);
  });
});
