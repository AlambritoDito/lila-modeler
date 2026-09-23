import { describe, expect, test } from 'vitest';

import { simulate as publicSimulate, type SimulateOptions } from '../../src/index.js';
import type { ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import { numericKpis } from '../../src/core/replications.js';
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
    expect(result.replications?.kpis['elements.A.completed']).toEqual({ mean: 3, n: 2, sd: 0, ci95: [3, 3] });
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
      'W-TAREA-SIN-TIEMPO: A: the scenario declares no processingTime at all; those tasks take 0 seconds.',
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

/* ------------------------------------------------------------------ *
 * #356 · replicaciones sin observaciones (ADR-024, adenda 2026-09-22)
 * ------------------------------------------------------------------ */

/** Una llegada por réplica, XOR 50/50 hacia una tarea constante de 360 s (reproducción del issue). */
const AUDIT_IR: ProcessIR = {
  id: 'AuditEmptyReplications',
  name: 'Synthetic audit',
  nodes: {
    Start: { type: 'start', name: 'Start', incoming: [], outgoing: ['s'] },
    Choice: { type: 'xor', name: 'Choice', incoming: ['s'], outgoing: ['a', 'skip'] },
    Task: { type: 'task', name: 'Constant 360 seconds', incoming: ['a'], outgoing: ['done'] },
    End: { type: 'end', name: 'End', incoming: ['skip', 'done'], outgoing: [] },
  },
  flows: {
    s: { from: 'Start', to: 'Choice', name: '', isDefault: false },
    a: { from: 'Choice', to: 'Task', name: '', isDefault: false },
    skip: { from: 'Choice', to: 'End', name: '', isDefault: false },
    done: { from: 'Task', to: 'End', name: '', isDefault: false },
  },
  source: { exporter: 'beta-audit', exporterVersion: '1', originalIds: {} },
};

function auditScenario(overrides: {
  replications?: number;
  seed?: number;
  arrivals?: number;
  toTask?: number;
  processingTime?: NonNullable<NonNullable<SimScenario['elements']>[string]>['processingTime'];
} = {}): SimScenario {
  const toTask = overrides.toTask ?? 0.5;
  return {
    run: { duration: 600, warmup: 0, replications: overrides.replications ?? 30, seed: overrides.seed ?? 42 },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: overrides.arrivals ?? 1 },
      a: { probability: toTask },
      skip: { probability: 1 - toTask },
      Task: { processingTime: overrides.processingTime ?? { type: 'constant', value: 360 } },
    },
  };
}

const NO_OBSERVATIONS = 'W-REPLICACIONES-SIN-OBSERVACIONES';
const observationWarnings = (warnings: readonly string[]): string[] =>
  warnings.filter((warning) => warning.startsWith(`${NO_OBSERVATIONS}:`));

function perReplication(ir: ProcessIR, input: SimScenario): ReturnType<typeof aggregateReplication>[] {
  return Array.from({ length: input.run.replications ?? 1 }, (_, index) =>
    aggregateReplication(ir, runReplication(ir, input, index), input),
  );
}

/** Media en orden de replicación, con la misma suma que el motor. */
function plainMean(values: readonly number[]): number {
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

describe('replicaciones sin observaciones (#356)', () => {
  test('reproducción: la tarea de 360 s publica 360 s, n = 18 y un aviso con 12 de 30', () => {
    const result = publicSimulate(AUDIT_IR, auditScenario(), { log: false });

    expect(result.replications?.count).toBe(30);
    expect(result.elements.Task!.processing).toMatchObject({ min: 360, max: 360, mean: 360 });
    expect(result.replications?.kpis['elements.Task.processing.mean']).toEqual({
      mean: 360,
      n: 18,
      sd: 0,
      ci95: [360, 360],
    });
    // Una sola instancia por réplica: la sd de la espera nunca tiene dos observaciones.
    expect(result.replications?.kpis['elements.Task.resourceWait.sd']).toEqual({ mean: 0, n: 0 });
    expect(result.replications?.kpis['process.cycleTime.sd']).toEqual({ mean: 0, n: 0 });
    expect(observationWarnings(result.warnings)).toEqual([
      'W-REPLICACIONES-SIN-OBSERVACIONES: Task: no instance completed in 12 of 30 replications; its time statistics average only the other 18.',
    ]);
    const spanish = publicSimulate(AUDIT_IR, auditScenario(), { log: false, locale: 'es' });
    expect(observationWarnings(spanish.warnings)).toEqual([
      'W-REPLICACIONES-SIN-OBSERVACIONES: Task: ninguna instancia se completó en 12 de 30 replicaciones; sus estadísticas de tiempo promedian solo las otras 18.',
    ]);
  });

  test('las claves de cada resumen van en el orden {mean, n, sd, ci95}', () => {
    const result = publicSimulate(AUDIT_IR, auditScenario(), { log: false });
    expect(Object.keys(result.replications!.kpis['elements.Task.processing.mean']!)).toEqual(['mean', 'n', 'sd', 'ci95']);
    expect(Object.keys(result.replications!.kpis['elements.Task.resourceWait.sd']!)).toEqual(['mean', 'n']);
  });

  test('R-ARR-9: con réplicas vacías, todo campo top-level es el mean de su KPI', () => {
    const result = publicSimulate(AUDIT_IR, auditScenario(), { log: false });
    const headline = numericKpis(result);
    const kpis = result.replications!.kpis;

    expect(Object.keys(kpis)).toEqual(Object.keys(headline));
    for (const [path, value] of Object.entries(headline)) expect(value, path).toBe(kpis[path]!.mean);
  });

  test('conteos, totales y flujos no cambian: media sobre todas las réplicas y n = count', () => {
    const input = auditScenario();
    const replications = perReplication(AUDIT_IR, input);
    const result = publicSimulate(AUDIT_IR, input, { log: false });
    const kpis = result.replications!.kpis;
    const records = replications.map((entry) => numericKpis(entry));

    for (const path of [
      'elements.Task.started',
      'elements.Task.completed',
      'elements.Task.processing.total',
      'elements.Task.resourceWait.total',
      'elements.Task.queueLength.mean',
      'flows.a.count',
      'flows.skip.count',
      'process.started',
      'process.completed',
      'process.inFlight',
      'process.throughputPerHour',
      'process.totalCost',
      'process.byEndEvent.End.completed',
    ]) {
      const expected = plainMean(records.map((record) => record[path]!));
      expect(numericKpis(result)[path], path).toBe(expected);
      expect(kpis[path]!.n, path).toBe(30);
    }
    expect(result.elements.Task!.completed).toBe(0.6);
    expect(result.elements.Task!.processing.total).toBe(216);
  });

  test('la media es de las medias por réplica, no de las observaciones agrupadas', () => {
    const input = auditScenario({
      replications: 10,
      seed: 7,
      arrivals: 2,
      processingTime: { type: 'uniform', min: 10, max: 100 },
    });
    const replications = perReplication(AUDIT_IR, input);
    const observed = replications.filter((entry) => entry.elements.Task!.completed > 0);
    // El escenario tiene que mezclar réplicas con una y con dos instancias para que la prueba sirva.
    expect(new Set(observed.map((entry) => entry.elements.Task!.completed)).size).toBeGreaterThan(1);

    const byReplication = plainMean(observed.map((entry) => entry.elements.Task!.processing.mean));
    const pooled =
      observed.reduce((total, entry) => total + entry.elements.Task!.processing.total, 0) /
      observed.reduce((total, entry) => total + entry.elements.Task!.completed, 0);
    expect(byReplication).not.toBeCloseTo(pooled, 6);

    const result = publicSimulate(AUDIT_IR, input, { log: false });
    expect(result.elements.Task!.processing.mean).toBe(byReplication);
    expect(result.replications!.kpis['elements.Task.processing.mean']).toMatchObject({
      mean: byReplication,
      n: observed.length,
    });
    // `resourceWait.sd` exige dos instancias en la réplica.
    expect(result.replications!.kpis['elements.Task.resourceWait.sd']!.n).toBe(
      replications.filter((entry) => entry.elements.Task!.completed >= 2).length,
    );
  });

  test('sin ninguna réplica que observe la tarea: {mean: 0, n: 0} y ningún aviso', () => {
    const result = publicSimulate(AUDIT_IR, auditScenario({ replications: 5, toTask: 0 }), { log: false });

    expect(result.elements.Task!.completed).toBe(0);
    expect(result.elements.Task!.processing.mean).toBe(0);
    expect(result.replications!.kpis['elements.Task.processing.mean']).toEqual({ mean: 0, n: 0 });
    expect(result.replications!.kpis['elements.Task.processing.total']).toEqual({
      mean: 0,
      n: 5,
      sd: 0,
      ci95: [0, 0],
    });
    expect(observationWarnings(result.warnings)).toEqual([]);
  });

  test('una sola réplica que observa la tarea: {mean, n: 1}, sin sd ni IC', () => {
    const input = auditScenario({
      replications: 10,
      seed: 1,
      toTask: 0.1,
      processingTime: { type: 'uniform', min: 10, max: 20 },
    });
    const observed = perReplication(AUDIT_IR, input).filter((entry) => entry.elements.Task!.completed > 0);
    expect(observed).toHaveLength(1);

    const result = publicSimulate(AUDIT_IR, input, { log: false });
    const value = observed[0]!.elements.Task!.processing.mean;
    expect(result.elements.Task!.processing.mean).toBe(value);
    expect(result.replications!.kpis['elements.Task.processing.mean']).toEqual({ mean: value, n: 1 });
    expect(observationWarnings(result.warnings)).toEqual([
      'W-REPLICACIONES-SIN-OBSERVACIONES: Task: no instance completed in 9 of 10 replications; its time statistics average only the other 1.',
    ]);
  });

  test('una tarea de duración cero que sí se completa es una observación legítima', () => {
    const input = scenario(4);
    input.elements!.A!.processingTime = { type: 'constant', value: 0 };
    const result = publicSimulate(IR, input, { log: false });

    expect(result.elements.A!.completed).toBe(3);
    expect(result.replications!.kpis['elements.A.processing.mean']).toEqual({
      mean: 0,
      n: 4,
      sd: 0,
      ci95: [0, 0],
    });
    expect(observationWarnings(result.warnings)).toEqual([]);
  });

  test('gateways, start, end y bordes nunca producen duraciones: n = count siempre', () => {
    const audit = publicSimulate(AUDIT_IR, auditScenario(), { log: false });
    for (const id of ['Start', 'Choice', 'End']) {
      expect(audit.replications!.kpis[`elements.${id}.processing.mean`]!.n, id).toBe(30);
      expect(audit.replications!.kpis[`elements.${id}.resourceWait.sd`]!.n, id).toBe(30);
    }

    const boundaryIr: ProcessIR = {
      id: 'Boundary',
      name: '',
      nodes: {
        Start: { type: 'start', name: '', incoming: [], outgoing: ['s'] },
        T: { type: 'task', name: '', incoming: ['s'], outgoing: ['t'] },
        B: { type: 'timer', name: '', incoming: [], outgoing: ['b'], attachedTo: 'T' },
        End: { type: 'end', name: '', incoming: ['t'], outgoing: [] },
        Late: { type: 'end', name: '', incoming: ['b'], outgoing: [] },
      },
      flows: {
        s: { from: 'Start', to: 'T', name: '', isDefault: false },
        t: { from: 'T', to: 'End', name: '', isDefault: false },
        b: { from: 'B', to: 'Late', name: '', isDefault: false },
      },
      source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
    };
    const input: SimScenario = {
      run: { replications: 10, seed: 3 },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 100 }, triggerCount: 1 },
        T: { processingTime: { type: 'uniform', min: 1, max: 20 } },
        B: { processingTime: { type: 'constant', value: 10 } },
      },
    };
    const fired = perReplication(boundaryIr, input).filter((entry) => entry.elements.B!.completed > 0).length;
    // El borde tiene que disparar en unas réplicas y no en otras para que la prueba sirva.
    expect(fired).toBeGreaterThan(0);
    expect(fired).toBeLessThan(10);

    const result = publicSimulate(boundaryIr, input, { log: false });
    expect(result.replications!.kpis['elements.B.processing.mean']!.n).toBe(10);
    expect(result.replications!.kpis['elements.B.resourceWait.sd']!.n).toBe(10);
    expect(observationWarnings(result.warnings).some((warning) => warning.includes(': B:'))).toBe(false);
    // En cambio el desenlace `Late` sí es condicional: solo lo observan las réplicas donde disparó.
    expect(result.replications!.kpis['process.byEndEvent.Late.cycleTime.mean']!.n).toBe(fired);
    expect(observationWarnings(result.warnings)).toContain(
      `W-REPLICACIONES-SIN-OBSERVACIONES: Late: no case ended here in ${10 - fired} of 10 replications; its time statistics average only the other ${fired}.`,
    );
  });

  test('cancelación: el top-level incluye la parcial, los KPI solo las completas, y el aviso sale', () => {
    const input = auditScenario();
    const replications = perReplication(AUDIT_IR, input);
    // La réplica que se corta tiene que llegar a la tarea: su fila es la que activa la señal.
    const cut = replications.findIndex((entry, index) => index >= 5 && entry.elements.Task!.completed > 0);
    expect(cut).toBeGreaterThan(0);

    const signal = { aborted: false };
    const result = publicSimulate(AUDIT_IR, input, {
      signal,
      onEvent: (row) => {
        if (row.replication === cut) signal.aborted = true;
      },
    });

    expect(result).toMatchObject({ cancelled: true, completedReplications: cut });
    expect(result.replications!.count).toBe(cut);
    const observedComplete = replications
      .slice(0, cut)
      .filter((entry) => entry.elements.Task!.completed > 0).length;
    expect(result.replications!.kpis['elements.Task.processing.mean']!.n).toBe(observedComplete);
    // El top-level promedia `cut + 1` réplicas: las completas y la parcial.
    expect(result.elements.Task!.completed).toBeCloseTo((observedComplete + 1) / (cut + 1), 12);
    const missing = cut - observedComplete;
    // La parcial se cortó con el caso todavía en vuelo (la fila de la tarea activa la señal antes
    // de que el token llegue al end): esa réplica sí observó la tarea, pero no el proceso ni `End`.
    expect(result.process.completed).toBeCloseTo(cut / (cut + 1), 12);
    expect(observationWarnings(result.warnings)).toEqual([
      `W-REPLICACIONES-SIN-OBSERVACIONES: Task: no instance completed in ${missing} of ${cut + 1} replications; its time statistics average only the other ${observedComplete + 1}.`,
      `W-REPLICACIONES-SIN-OBSERVACIONES: process: no case completed in 1 of ${cut + 1} replications; its cycle time, wait time, cost per case and service level average only the other ${cut}.`,
      `W-REPLICACIONES-SIN-OBSERVACIONES: End: no case ended here in 1 of ${cut + 1} replications; its time statistics average only the other ${cut}.`,
    ]);
    // Los KPI del proceso solo cuentan réplicas completas, todas con su caso terminado.
    expect(result.replications!.kpis['process.cycleTime.mean']!.n).toBe(cut);
  });
});
