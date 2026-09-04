/**
 * QA adversarial de LILA-035 (selección OR de recursos), por un agente distinto al implementador.
 *
 * Cada bloque es un ataque al diseño de ADR-026 / R-REC-6: fuga de lápidas, head-of-line al
 * retirar una alternativa, simultaneidad, desempate documentado, fail-fast de `quantity`,
 * cancelación y terminate, pools repetidos, determinismo frente al orden de declaración de los
 * pools del escenario y degradación de los escenarios sin OR.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { parseBpmn } from '../../src/bpmn/parse.js';
import type { EventLogRow } from '../../src/core/result.js';
import type { Flow, Node, ProcessIR } from '../../src/core/ir.js';
import { ResourceManager, type ResourceRequest } from '../../src/core/resources.js';
import { runReplication, type SimScenario } from '../../src/core/sim.js';
import { simulate } from '../../src/core/run.js';
import { ScenarioSchema, scenarioErrors, validateScenario } from '../../src/scenario.js';

const edge = (from: string, to: string): Flow => ({ from, to, name: '', isDefault: false });

function single(id: string, enabledAt: number, poolId: string, quantity = 1): ResourceRequest {
  return { id, enabledAt, requirements: [{ poolId, quantity }] };
}

function orOf(id: string, enabledAt: number, alts: readonly (readonly [string, number])[]): ResourceRequest {
  return { id, enabledAt, selection: 'or', requirements: alts.map(([poolId, quantity]) => ({ poolId, quantity })) };
}

/** Proceso lineal Start → Task → End, para escenarios de una sola tarea con recursos. */
function linearIr(): ProcessIR {
  const nodes: Record<string, Node> = {
    Start: { type: 'start', name: '', incoming: [], outgoing: ['S_T'] },
    Task: { type: 'task', name: '', incoming: ['S_T'], outgoing: ['T_E'] },
    End: { type: 'end', name: '', incoming: ['T_E'], outgoing: [] },
  };
  return {
    id: 'P',
    name: '',
    nodes,
    flows: { S_T: edge('Start', 'Task'), T_E: edge('Task', 'End') },
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

/* --- 1. Fuga de lápidas y coste lineal ------------------------------------ */

/**
 * Vacía el backlog liberando siempre lo que se acaba de conceder y devuelve el coste observable
 * del scheduler. Si las lápidas de las alternativas OR se acumularan, `queuedEntryCount` no
 * volvería a 0 y `headInspections` crecería más que linealmente.
 */
function drainOrBacklog(n: number): { manager: ResourceManager; steps: number } {
  const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 }, c: { capacity: 1 } });
  let active: string[] = [];
  for (let i = 0; i < n; i++) {
    for (const allocation of manager.enqueue(orOf(`r${i}`, 0, [['a', 1], ['b', 1], ['c', 1]]), 0)) {
      active.push(allocation.requestId);
    }
  }
  let t = 0;
  let steps = 0;
  while (active.length > 0) {
    t++;
    steps++;
    active = manager.release(active, t).map((allocation) => allocation.requestId);
  }
  return { manager, steps };
}

describe('ataque 1: fuga de lápidas de las alternativas retiradas', () => {
  test('100 000 activaciones OR de 3 alternativas dejan las colas vacías', () => {
    const { manager } = drainOrBacklog(100_000);
    expect(manager.liveRequestCount).toBe(0);
    expect(manager.queuedEntryCount).toBe(0);
  });

  test('el coste del scheduler crece linealmente entre 10k y 100k', () => {
    const small = drainOrBacklog(10_000);
    const large = drainOrBacklog(100_000);
    // Con lápidas perezosas el techo es un número constante de inspecciones por activación: si la
    // retirada dejara basura acumulada, el coste por activación crecería con el tamaño del lote.
    const perSmall = small.manager.headInspections / 10_000;
    const perLarge = large.manager.headInspections / 100_000;
    expect(perLarge).toBeLessThan(perSmall * 1.5);
    expect(perLarge).toBeLessThan(20);
    // Rondas de liberación exactas: 3 concesiones por ronda, sin rondas en vacío ni deadlock.
    expect(small.steps).toBe(Math.ceil(10_000 / 3));
    expect(large.steps).toBe(Math.ceil(100_000 / 3));
  });
});

/* --- 2. Head-of-line al retirar una alternativa --------------------------- */

describe('ataque 2: la retirada de una alternativa desbloquea la cola de ese pool', () => {
  /**
   * `x` es OR([b,1],[a,2]): con `b` saturado y una sola unidad libre de `a` ninguna alternativa
   * arranca, y como cabeza single-pool de `a` bloquea a `y` (R-REC-5). Al liberar `b`, `x` se
   * concede por `b` y la única cosa que puede arrancar a `y` es la reevaluación de la clase de la
   * que `x` se retira: el uso de `a` no ha cambiado, así que nada más marcaría esa cola sucia.
   */
  test('el siguiente de la cola arranca en el acto, sin esperar a una liberación del pool', () => {
    const manager = new ResourceManager({ a: { capacity: 2 }, b: { capacity: 1 } });
    manager.enqueue(single('hogA', 0, 'a'), 0);
    manager.enqueue(single('hogB', 0, 'b'), 0);
    expect(manager.enqueue(orOf('x', 1, [['b', 1], ['a', 2]]), 1)).toEqual([]);
    expect(manager.enqueue(single('y', 2, 'a'), 2)).toEqual([]);

    const granted = manager.release(['hogB'], 3);
    expect(granted.map((allocation) => [allocation.requestId, allocation.assignments[0]!.poolId, allocation.startedAt]))
      .toEqual([['x', 'b', 3], ['y', 'a', 3]]);
    expect(manager.used('a')).toBe(2);
    expect(manager.used('b')).toBe(1);
  });

  test('la alternativa retirada no deja pasar a nadie por delante en su pool (FIFO)', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue(single('hogA', 0, 'a'), 0);
    manager.enqueue(single('hogB', 0, 'b'), 0);
    manager.enqueue(orOf('x', 1, [['b', 1], ['a', 1]]), 1);
    manager.enqueue(single('y', 2, 'a'), 2);
    manager.enqueue(single('z', 3, 'a'), 3);

    // Libera `a` antes que `b`: `x` sigue siendo la cabeza de `a` y gana a `y`.
    expect(manager.release(['hogA'], 4).map((allocation) => allocation.requestId)).toEqual(['x']);
    // Y `y` mantiene su turno delante de `z` cuando `a` vuelve a quedar libre.
    expect(manager.release(['x'], 5).map((allocation) => allocation.requestId)).toEqual(['y']);
    expect(manager.release(['y'], 6).map((allocation) => allocation.requestId)).toEqual(['z']);
  });

  /**
   * Caso inverso: detrás de la alternativa bloqueada de `a` hay una AND (a, c). R-REC-5 dice que
   * el salto es entre firmas distintas, así que la AND no queda atrapada detrás de la cabeza OR.
   */
  test('una AND que comparte pool con la alternativa bloqueada salta por delante (R-REC-5)', () => {
    const manager = new ResourceManager({ a: { capacity: 2 }, b: { capacity: 1 }, c: { capacity: 1 } });
    manager.enqueue(single('hogA', 0, 'a'), 0);
    manager.enqueue(single('hogB', 0, 'b'), 0);
    manager.enqueue(orOf('x', 1, [['b', 1], ['a', 2]]), 1);

    const granted = manager.enqueue({ id: 'z', enabledAt: 2, requirements: [{ poolId: 'a', quantity: 1 }, { poolId: 'c', quantity: 1 }] }, 2);
    expect(granted.map((allocation) => allocation.requestId)).toEqual(['z']);

    // Y `x` sigue vivo: al liberar `z` y `hogA` cabe por su alternativa `a`.
    expect(manager.release(['z', 'hogA'], 3).map((a) => [a.requestId, a.assignments[0]!.poolId])).toEqual([['x', 'a']]);
  });
});

/* --- 3. Simultaneidad ------------------------------------------------------ */

describe('ataque 3: dos OR habilitadas y liberaciones simultáneas', () => {
  test('el orden total es (enabledAt, seq, altIndex) con un solo hueco por pool', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue(single('hogA', 0, 'a'), 0);
    manager.enqueue(single('hogB', 0, 'b'), 0);
    manager.enqueue(orOf('x', 5, [['a', 1], ['b', 1]]), 5);
    manager.enqueue(orOf('y', 5, [['a', 1], ['b', 1]]), 5);

    const granted = manager.release(['hogA', 'hogB'], 9);
    expect(granted.map((a) => [a.requestId, a.assignments[0]!.poolId])).toEqual([['x', 'a'], ['y', 'b']]);
  });

  test('el orden de declaración de cada tarea manda por separado', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue(single('hogA', 0, 'a'), 0);
    manager.enqueue(single('hogB', 0, 'b'), 0);
    manager.enqueue(orOf('x', 5, [['b', 1], ['a', 1]]), 5);
    manager.enqueue(orOf('y', 5, [['b', 1], ['a', 1]]), 5);

    const granted = manager.release(['hogB', 'hogA'], 9);
    expect(granted.map((a) => [a.requestId, a.assignments[0]!.poolId])).toEqual([['x', 'b'], ['y', 'a']]);
  });

  test('liberar en orden inverso da el mismo resultado: no depende de qué liberación llegó', () => {
    const build = (order: readonly string[]) => {
      const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
      manager.enqueue(single('hogA', 0, 'a'), 0);
      manager.enqueue(single('hogB', 0, 'b'), 0);
      manager.enqueue(orOf('x', 5, [['a', 1], ['b', 1]]), 5);
      manager.enqueue(orOf('y', 5, [['a', 1], ['b', 1]]), 5);
      return manager.release(order, 9).map((a) => [a.requestId, a.assignments[0]!.poolId]);
    };
    expect(build(['hogA', 'hogB'])).toEqual(build(['hogB', 'hogA']));
  });

  test('una OR nunca se concede dos veces aunque las dos alternativas queden libres a la vez', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue(single('hogA', 0, 'a'), 0);
    manager.enqueue(single('hogB', 0, 'b'), 0);
    manager.enqueue(orOf('x', 1, [['a', 1], ['b', 1]]), 1);

    const granted = manager.release(['hogA', 'hogB'], 2);
    expect(granted).toHaveLength(1);
    expect(manager.used('a') + manager.used('b')).toBe(1);
    expect(manager.liveRequestCount).toBe(1);
  });
});

/* --- 3 bis. Casos degenerados de `selection: "or"` ------------------------- */

describe('ataque 3 bis: OR con una sola alternativa y OR que nunca arranca', () => {
  test('con un solo pool `or` y `and` son equivalentes byte a byte (R-REC-2)', () => {
    const base: SimScenario = {
      run: { seed: 2, duration: 500 },
      resources: { a: { capacity: 1, costPerHour: 90, fixedCost: 0.25 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 5 }, triggerCount: 40 },
        Task: { processingTime: { type: 'constant', value: 9 }, resources: [{ ref: 'a' }] },
      },
    };
    const withOr: SimScenario = {
      ...base,
      elements: { ...base.elements, Task: { ...base.elements!.Task!, selection: 'or' } },
    };
    const withAnd: SimScenario = {
      ...base,
      elements: { ...base.elements, Task: { ...base.elements!.Task!, selection: 'and' } },
    };
    expect(JSON.stringify(runReplication(linearIr(), withOr)))
      .toBe(JSON.stringify(runReplication(linearIr(), withAnd)));
  });

  test('una OR que sigue en cola al parar emite una sola fila sentinel, no una por alternativa', () => {
    const scenario: SimScenario = {
      run: { seed: 5, duration: 30 },
      resources: { a: { capacity: 1 }, b: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 20 },
        Task: {
          processingTime: { type: 'constant', value: 1000 },
          resources: [{ ref: 'a' }, { ref: 'b' }],
          selection: 'or',
        },
      },
    };
    const { rows } = runReplication(linearIr(), scenario);
    const waiting = rows.filter((row) => row.startedAt === null);
    expect(waiting.length).toBeGreaterThan(0);
    for (const row of waiting) {
      expect([row.resourceId, row.resourceQuantity, row.allocationIndex]).toEqual([null, null, null]);
    }
    const perInstance = new Map<string, number>();
    for (const row of rows) perInstance.set(row.activityInstanceId, (perInstance.get(row.activityInstanceId) ?? 0) + 1);
    expect([...perInstance.values()].every((count) => count === 1)).toBe(true);
  });

  test('el warmup no altera la selección OR ni las filas del log', () => {
    const build = (warmup: number): SimScenario => ({
      run: { seed: 6, duration: 400, warmup },
      resources: { a: { capacity: 1 }, b: { capacity: 2 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 4 }, triggerCount: 60 },
        Task: {
          processingTime: { type: 'constant', value: 7 },
          resources: [{ ref: 'a' }, { ref: 'b' }],
          selection: 'or',
        },
      },
    });
    const cold = runReplication(linearIr(), build(0)).rows;
    const warm = runReplication(linearIr(), build(120)).rows;
    expect(warm.map((row) => [row.activityInstanceId, row.resourceId, row.startedAt]))
      .toEqual(cold.map((row) => [row.activityInstanceId, row.resourceId, row.startedAt]));
  });
});

/* --- 4. Desempate documentado, no "el más barato" -------------------------- */

describe('ataque 4: con las dos alternativas libres gana la declarada primero', () => {
  test('elige el pool caro y estrecho si es el primero del array (R-REC-6)', () => {
    const scenario: SimScenario = {
      run: { seed: 1 },
      resources: {
        caro: { capacity: 1, costPerHour: 3600 },
        barato: { capacity: 10, costPerHour: 36 },
      },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 100 }, triggerCount: 1 },
        Task: {
          processingTime: { type: 'constant', value: 3600 },
          resources: [{ ref: 'caro' }, { ref: 'barato' }],
          selection: 'or',
        },
      },
    };
    const row = runReplication(linearIr(), scenario).rows[0]!;
    expect([row.resourceId, row.allocationIndex, row.resourceCost]).toEqual(['caro', 0, 3600]);

    const inverted: SimScenario = {
      ...scenario,
      elements: {
        ...scenario.elements,
        Task: { ...scenario.elements!.Task!, resources: [{ ref: 'barato' }, { ref: 'caro' }] },
      },
    };
    const invertedRow = runReplication(linearIr(), inverted).rows[0]!;
    expect([invertedRow.resourceId, invertedRow.allocationIndex, invertedRow.resourceCost]).toEqual(['barato', 0, 36]);
  });
});

/* --- 4 bis. `elementCost` cuando gana la segunda alternativa ---------------- */

describe('ataque 4 bis: el fijo del elemento no se pierde al elegir una alternativa distinta de la 0', () => {
  test('la única fila emitida lleva el `fixedCost` aunque su allocationIndex sea 1', () => {
    const scenario: SimScenario = {
      run: { seed: 1, duration: 500 },
      resources: { estrecho: { capacity: 1 }, ancho: { capacity: 5 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 4 },
        Task: {
          processingTime: { type: 'constant', value: 100 },
          resources: [{ ref: 'estrecho' }, { ref: 'ancho' }],
          selection: 'or',
          fixedCost: 7,
        },
      },
    };
    const rows = runReplication(linearIr(), scenario).rows.filter((row) => row.status === 'completed');
    expect(rows.map((row) => row.allocationIndex)).toEqual([0, 1, 1, 1]);
    // RESULTS_FORMAT § 7: el fijo vive en la fila canónica de menor allocationIndex *emitida*.
    for (const row of rows) expect(row.elementCost).toBe(7);
    expect(rows.reduce((total, row) => total + row.elementCost, 0)).toBe(28);
  });
});

/* --- 5. quantity > capacity en una alternativa OR -------------------------- */

describe('ataque 5: quantity mayor que capacity en una alternativa', () => {
  const scenario: SimScenario = {
    run: { seed: 1 },
    resources: { a: { capacity: 1 }, b: { capacity: 4 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 3 },
      Task: {
        processingTime: { type: 'constant', value: 5 },
        resources: [{ ref: 'a', quantity: 2 }, { ref: 'b', quantity: 1 }],
        selection: 'or',
      },
    },
  };

  test('es E-REC-CANTIDAD, no un arranque silencioso por la otra alternativa (R-REC-2)', () => {
    expect(() => runReplication(linearIr(), scenario)).toThrow(/E-REC-CANTIDAD/);
  });

  test('el fail-fast ocurre antes de cualquier callback público', () => {
    const rows: EventLogRow[] = [];
    const progress: unknown[] = [];
    expect(() =>
      simulate(linearIr(), scenario, { onEvent: (row) => rows.push(row), onProgress: (p) => progress.push(p) }),
    ).toThrow(/E-REC-CANTIDAD/);
    expect(rows).toEqual([]);
    expect(progress).toEqual([]);
  });
});

/* --- 6. Cancelación, terminate y warmup ------------------------------------ */

describe('ataque 6: cancelar una OR retira las entradas de todas las alternativas', () => {
  test('cancelar en cola no deja lápidas capaces de robar un hueco', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue(single('hogA', 0, 'a'), 0);
    manager.enqueue(single('hogB', 0, 'b'), 0);
    manager.enqueue(orOf('x', 1, [['a', 1], ['b', 1]]), 1);
    manager.enqueue(single('y', 2, 'b'), 2);

    expect(manager.cancel(['x'], 3)).toEqual([]);
    const granted = manager.release(['hogB'], 4);
    expect(granted.map((a) => a.requestId)).toEqual(['y']);

    manager.release(['hogA', 'y'], 5);
    expect(manager.used('a')).toBe(0);
    expect(manager.used('b')).toBe(0);
    expect(manager.liveRequestCount).toBe(0);
    expect(manager.queuedEntryCount).toBe(0);
  });

  test('reencolar el mismo id tras cancelar no revive la alternativa vieja', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue(single('hogA', 0, 'a'), 0);
    manager.enqueue(single('hogB', 0, 'b'), 0);
    manager.enqueue(orOf('x', 1, [['a', 1], ['b', 1]]), 1);
    manager.cancel(['x'], 2);
    expect(manager.enqueue(orOf('x', 3, [['a', 1], ['b', 1]]), 3)).toEqual([]);

    const granted = manager.release(['hogA'], 4);
    expect(granted.map((a) => [a.requestId, a.assignments[0]!.poolId, a.enabledAt])).toEqual([['x', 'a', 3]]);
    expect(manager.queuedEntryCount).toBe(0);
  });

  test('un terminate con OR en curso devuelve la ocupación reconstruida del log a 0', () => {
    const nodes: Record<string, Node> = {
      Start: { type: 'start', name: '', incoming: [], outgoing: ['S_T'] },
      Task: { type: 'task', name: '', incoming: ['S_T'], outgoing: ['T_K'] },
      Kill: { type: 'terminate', name: '', incoming: ['T_K'], outgoing: [] },
    };
    const ir: ProcessIR = {
      id: 'P',
      name: '',
      nodes,
      flows: { S_T: edge('Start', 'Task'), T_K: edge('Task', 'Kill') },
      source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
    };
    const scenario: SimScenario = {
      run: { seed: 3, duration: 100, warmup: 20 },
      resources: { a: { capacity: 1 }, b: { capacity: 2 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 7 }, triggerCount: 12 },
        Task: {
          processingTime: { type: 'constant', value: 9 },
          resources: [{ ref: 'a' }, { ref: 'b' }],
          selection: 'or',
        },
      },
    };
    const { rows } = runReplication(ir, scenario);
    expect(rows.length).toBeGreaterThan(0);

    // Una sola fila por instancia: la OR nunca duplica filas por alternativa.
    const perInstance = new Map<string, number>();
    for (const row of rows) perInstance.set(row.activityInstanceId, (perInstance.get(row.activityInstanceId) ?? 0) + 1);
    expect([...perInstance.values()].every((count) => count === 1)).toBe(true);

    // Ocupación reconstruida: cada fila iniciada ocupa desde `startedAt` hasta `observedUntil`.
    const events: { t: number; delta: number; pool: string }[] = [];
    for (const row of rows) {
      if (row.startedAt === null || row.resourceId === null) continue;
      events.push({ t: row.startedAt, delta: row.resourceQuantity!, pool: row.resourceId });
      events.push({ t: row.observedUntil, delta: -row.resourceQuantity!, pool: row.resourceId });
    }
    const used = new Map<string, number>();
    let peakA = 0;
    let peakB = 0;
    for (const event of events.sort((left, right) => left.t - right.t || left.delta - right.delta)) {
      const next = (used.get(event.pool) ?? 0) + event.delta;
      expect(next).toBeGreaterThanOrEqual(0);
      used.set(event.pool, next);
      peakA = Math.max(peakA, used.get('a') ?? 0);
      peakB = Math.max(peakB, used.get('b') ?? 0);
    }
    expect(used.get('a') ?? 0).toBe(0);
    expect(used.get('b') ?? 0).toBe(0);
    expect(peakA).toBeLessThanOrEqual(1);
    expect(peakB).toBeLessThanOrEqual(2);
  });

  test('una señal de aborto durante una corrida con OR no deja filas incoherentes', () => {
    const signal = { aborted: false };
    const seen: EventLogRow[] = [];
    const scenario: SimScenario = {
      run: { seed: 4, duration: 10_000 },
      resources: { a: { capacity: 1 }, b: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 3 }, triggerCount: 5000 },
        Task: {
          processingTime: { type: 'constant', value: 4 },
          resources: [{ ref: 'a' }, { ref: 'b' }],
          selection: 'or',
        },
      },
    };
    const result = simulate(linearIr(), scenario, {
      signal,
      onEvent: (row) => {
        seen.push(row);
        if (seen.length === 20) signal.aborted = true;
      },
    });
    expect(result.cancelled).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(20);
    for (const row of seen) {
      if (row.resourceId !== null) expect(['a', 'b']).toContain(row.resourceId);
      expect(row.allocationIndex === null || row.allocationIndex === 0 || row.allocationIndex === 1).toBe(true);
    }
  });
});

/* --- 6 bis. Reencolar un id cuya lápida OR sigue enterrada ----------------- */

describe('ataque 6 bis: lápida OR enterrada + reencolado del mismo id', () => {
  /**
   * Hallazgo de QA: la guarda `state.seq === head.seq` de `#head` no estaba cubierta. Sin ella,
   * la lápida que `x` dejó en la cola de `b` al concederse por `a` vuelve a considerarse viva
   * cuando `x` se reencola, y `x` arranca con su `(enabledAt, seq)` *viejo*, adelantando a `y`.
   * No es alcanzable desde `simulate` (los `activityInstanceId` no se reutilizan), pero sí desde
   * la API interna del manager, que es la que fija el invariante FIFO.
   */
  test('la entrada vieja no puede hacerse pasar por la nueva solicitud', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue(single('hogB', 0, 'b'), 0);
    manager.enqueue(single('w', 1, 'b'), 1);
    // `x` se concede por `a` y deja una lápida enterrada detrás de `w` en la cola de `b`.
    expect(manager.enqueue(orOf('x', 2, [['a', 1], ['b', 1]]), 2).map((g) => g.assignments[0]!.poolId)).toEqual(['a']);
    manager.release(['x'], 3);
    manager.enqueue(single('hogA', 4, 'a'), 4);
    manager.enqueue(single('y', 5, 'b'), 5);
    expect(manager.enqueue(orOf('x', 6, [['a', 1], ['b', 1]]), 6)).toEqual([]);

    expect(manager.release(['hogB'], 7).map((g) => g.requestId)).toEqual(['w']);
    // `y` (enabledAt 5) va antes que la `x` reencolada (enabledAt 6), nunca al revés.
    expect(manager.release(['w'], 8).map((g) => [g.requestId, g.enabledAt, g.assignments[0]!.poolId]))
      .toEqual([['y', 5, 'b']]);
  });
});

/* --- 7. Pools repetidos en la lista de alternativas ------------------------ */

describe('ataque 7: la misma ref dos veces en una OR', () => {
  test('el manager lo rechaza con E-REC-DUPLICADO', () => {
    const manager = new ResourceManager({ a: { capacity: 3 } });
    expect(() => manager.enqueue(orOf('x', 0, [['a', 1], ['a', 2]]), 0)).toThrow(/E-REC-DUPLICADO/);
  });

  test('el preflight del motor lo rechaza antes de simular', () => {
    const scenario: SimScenario = {
      run: { seed: 1 },
      resources: { a: { capacity: 3 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        Task: {
          processingTime: { type: 'constant', value: 1 },
          resources: [{ ref: 'a', quantity: 1 }, { ref: 'a', quantity: 2 }],
          selection: 'or',
        },
      },
    };
    expect(() => runReplication(linearIr(), scenario)).toThrow(/E-REC-DUPLICADO/);
  });

  test('validateScenario también lo marca (R-REC-9)', () => {
    const scenario = ScenarioSchema.parse({
      version: 1,
      name: 'dup',
      run: { start: '2026-01-01T00:00:00-06:00', duration: 10 },
      resources: { a: { capacity: 3 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        Task: {
          processingTime: { type: 'constant', value: 1 },
          resources: [{ ref: 'a' }, { ref: 'a', quantity: 2 }],
          selection: 'or',
        },
      },
    });
    const problems = scenarioErrors(validateScenario(scenario, linearIr()));
    expect(problems.map((problem) => problem.code)).toContain('E-REC-DUPLICADO');
  });
});

/* --- 8. Determinismo frente al orden de `resources` del escenario ---------- */

describe('ataque 8: el orden de declaración de los pools del escenario es irrelevante', () => {
  function orScenario(resources: SimScenario['resources']): SimScenario {
    return {
      run: { seed: 11, duration: 4000 },
      resources,
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 3 }, triggerCount: 400 },
        Task: {
          processingTime: { type: 'constant', value: 11 },
          resources: [{ ref: 'p1' }, { ref: 'p2', quantity: 2 }, { ref: 'p3' }],
          selection: 'or',
        },
      },
    };
  }
  const straight = { p1: { capacity: 1, costPerHour: 10 }, p2: { capacity: 2, costPerHour: 20 }, p3: { capacity: 3, costPerHour: 30 } };
  const reversed = { p3: { capacity: 3, costPerHour: 30 }, p2: { capacity: 2, costPerHour: 20 }, p1: { capacity: 1, costPerHour: 10 } };

  test('el ReplicationRun es idéntico byte a byte', () => {
    const a = JSON.stringify(runReplication(linearIr(), orScenario(straight)));
    const b = JSON.stringify(runReplication(linearIr(), orScenario(reversed)));
    expect(a).toBe(b);
  });

  test('y la corrida con OR es reproducible consigo misma', () => {
    const a = JSON.stringify(runReplication(linearIr(), orScenario(straight)));
    const b = JSON.stringify(runReplication(linearIr(), orScenario(straight)));
    expect(a).toBe(b);
  });
});

/* --- 9. Invariante del scheduler bajo mezcla aleatoria de OR/AND/single ---- */

/** PRNG determinista: el fuzz tiene que ser reproducible byte a byte (R-DET-1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MirrorRequest {
  readonly id: string;
  readonly t: number;
  readonly seq: number;
  readonly selection: 'and' | 'or';
  readonly reqs: readonly { poolId: string; quantity: number }[];
}

/** Réplica externa de la firma de clase de ADR-026, para reconstruir las cabezas sin tocar internos. */
function mirrorClassKey(reqs: readonly { poolId: string; quantity: number }[]): string {
  if (reqs.length === 1) return `single:${JSON.stringify(reqs[0]!.poolId)}`;
  const signature = reqs
    .map((r) => [r.poolId, r.quantity] as const)
    .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] - right[1]));
  return `and:${JSON.stringify(signature)}`;
}

function mirrorEntries(r: MirrorRequest): readonly { classKey: string; reqs: readonly { poolId: string; quantity: number }[] }[] {
  if (r.selection === 'or' && r.reqs.length > 1) {
    return r.reqs.map((req) => ({ classKey: mirrorClassKey([req]), reqs: [req] }));
  }
  return [{ classKey: mirrorClassKey(r.reqs), reqs: r.reqs }];
}

/**
 * Mezcla aleatoria de single / AND / OR sobre tres pools, con release y cancel intercalados.
 * Invariante: tras cada operación ninguna cabeza viva de una clase puede arrancar. Si la retirada
 * de una alternativa OR dejara una cola sin reevaluar, ese caso quedaría congelado y aparecería
 * aquí. Devuelve la primera violación como texto, o `null`.
 */
function fuzzScheduler(seed: number, ops: number): string | null {
  const rnd = mulberry32(seed);
  const poolIds = ['a', 'b', 'c'] as const;
  const caps: Record<string, number> = { a: 1 + Math.floor(rnd() * 3), b: 1 + Math.floor(rnd() * 3), c: 1 + Math.floor(rnd() * 3) };
  const manager = new ResourceManager({ a: { capacity: caps.a! }, b: { capacity: caps.b! }, c: { capacity: caps.c! } });

  const queued = new Map<string, MirrorRequest>();
  const active = new Map<string, { readonly assignments: readonly { poolId: string; quantity: number }[] }>();
  let nextId = 0;
  let seq = 0;
  let t = 0;

  const check = (at: number, label: string): string | null => {
    const used: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (const allocation of active.values()) {
      for (const assignment of allocation.assignments) used[assignment.poolId] = used[assignment.poolId]! + assignment.quantity;
    }
    for (const pool of poolIds) {
      if (manager.used(pool) !== used[pool]) return `${label}: used(${pool}) = ${manager.used(pool)} != ${used[pool]}`;
      if (used[pool]! > caps[pool]!) return `${label}: used(${pool}) = ${used[pool]} > capacity ${caps[pool]}`;
    }
    const heads = new Map<string, MirrorRequest & { reqs: readonly { poolId: string; quantity: number }[] }>();
    for (const request of queued.values()) {
      for (const entry of mirrorEntries(request)) {
        const current = heads.get(entry.classKey);
        if (current === undefined || request.t < current.t || (request.t === current.t && request.seq < current.seq)) {
          heads.set(entry.classKey, { ...request, reqs: entry.reqs });
        }
      }
    }
    for (const [classKey, head] of heads) {
      if (head.t > at) continue;
      if (head.reqs.every((r) => caps[r.poolId]! - used[r.poolId]! >= r.quantity)) {
        return `${label}: la cabeza viva de ${classKey} (${head.id}) cabía y no se concedió en at=${at}`;
      }
    }
    return null;
  };

  const absorb = (granted: readonly { requestId: string; startedAt: number; assignments: readonly { poolId: string; quantity: number }[] }[], at: number): string | null => {
    for (const allocation of granted) {
      const request = queued.get(allocation.requestId);
      if (request === undefined) return `concesión de un id que no estaba en cola: ${allocation.requestId}`;
      queued.delete(allocation.requestId);
      active.set(allocation.requestId, allocation);
      if (allocation.startedAt !== at) return `${allocation.requestId}: startedAt ${allocation.startedAt} != ${at}`;
      if (request.selection === 'or' && request.reqs.length > 1) {
        if (allocation.assignments.length !== 1) return `${allocation.requestId}: una OR ocupó ${allocation.assignments.length} pools`;
        const chosen = allocation.assignments[0]!;
        if (!request.reqs.some((r) => r.poolId === chosen.poolId && r.quantity === chosen.quantity)) {
          return `${allocation.requestId}: la OR ocupó un pool no declarado`;
        }
      } else if (allocation.assignments.length !== request.reqs.length) {
        return `${allocation.requestId}: asignación parcial de una AND`;
      }
    }
    return null;
  };

  for (let i = 0; i < ops; i++) {
    t += Math.floor(rnd() * 3);
    const roll = rnd();
    if (roll < 0.5 || (queued.size === 0 && active.size === 0)) {
      const shuffled = [...poolIds].sort(() => rnd() - 0.5);
      const kind = rnd();
      const qty = (pool: string): number => 1 + Math.floor(rnd() * caps[pool]!);
      let reqs: { poolId: string; quantity: number }[];
      let selection: 'and' | 'or' = 'and';
      if (kind < 0.35) reqs = [{ poolId: shuffled[0]!, quantity: 1 }];
      else if (kind < 0.5) reqs = [{ poolId: shuffled[0]!, quantity: qty(shuffled[0]!) }];
      else if (kind < 0.7) reqs = shuffled.slice(0, 2).map((pool) => ({ poolId: pool, quantity: qty(pool) }));
      else if (kind < 0.9) { reqs = shuffled.slice(0, 2).map((pool) => ({ poolId: pool, quantity: qty(pool) })); selection = 'or'; }
      else { reqs = shuffled.map((pool) => ({ poolId: pool, quantity: qty(pool) })); selection = 'or'; }
      const request: MirrorRequest = { id: `r${nextId++}`, t, seq: seq++, selection, reqs };
      queued.set(request.id, request);
      const granted = manager.enqueue({ id: request.id, enabledAt: t, selection, requirements: reqs }, t);
      const bad = absorb(granted, t) ?? check(t, `op ${i} enqueue ${request.id}`);
      if (bad !== null) return bad;
    } else if (roll < 0.85 && active.size > 0) {
      const ids = [...active.keys()].slice(0, 1 + Math.floor(rnd() * 3));
      for (const id of ids) active.delete(id);
      const granted = manager.release(ids, t);
      const bad = absorb(granted, t) ?? check(t, `op ${i} release ${ids.join(',')}`);
      if (bad !== null) return bad;
    } else {
      const ids = [...queued.keys(), ...active.keys()];
      if (ids.length === 0) continue;
      const id = ids[Math.floor(rnd() * ids.length)]!;
      queued.delete(id);
      active.delete(id);
      const granted = manager.cancel([id], t);
      const bad = absorb(granted, t) ?? check(t, `op ${i} cancel ${id}`);
      if (bad !== null) return bad;
    }
  }
  return null;
}

describe('ataque 9: invariante bajo mezcla aleatoria de OR, AND y single', () => {
  test('200 semillas deterministas sin ninguna cabeza viva satisfacible sin conceder', () => {
    const findings: string[] = [];
    for (let seed = 1; seed <= 200; seed++) {
      const bad = fuzzScheduler(seed, 200);
      if (bad !== null) findings.push(`semilla ${seed}: ${bad}`);
    }
    expect(findings).toEqual([]);
  });
});

/* --- 10. examples/pedido as-is -------------------------------------------- */

describe('ataque 10: examples/pedido as-is ya valida y corre', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const exampleDir = resolve(here, '../../../../examples/pedido');
  const raw = JSON.parse(readFileSync(resolve(exampleDir, 'as-is.scenario.json'), 'utf8')) as Record<string, unknown>;

  test('valida sin errores y corre 3 replicaciones con seed 42', async () => {
    const { ir } = await parseBpmn(readFileSync(resolve(exampleDir, 'model.bpmn'), 'utf8'));
    const scenario = ScenarioSchema.parse(raw);
    expect(scenarioErrors(validateScenario(scenario, ir))).toEqual([]);

    const sim = scenario as unknown as SimScenario;
    const runnable: SimScenario = {
      ...sim,
      run: { ...sim.run, seed: 42, replications: 3, duration: 200_000 },
    };
    const rows: EventLogRow[] = [];
    const result = simulate(ir, runnable, { onEvent: (row) => rows.push(row) });
    expect(result.cancelled).toBeUndefined();
    expect(result.replications?.count).toBe(3);

    const revisar = rows.filter((row) => row.elementId === 'Task_Revisar' && row.startedAt !== null);
    expect(revisar.length).toBeGreaterThan(0);
    for (const row of revisar) {
      expect(['cajero', 'cocinero']).toContain(row.resourceId);
      expect(row.allocationIndex).toBe(row.resourceId === 'cajero' ? 0 : 1);
    }
    // Sin filas duplicadas por instancia de actividad dentro de cada replicación.
    const keys = new Set(rows.map((row) => `${row.replication}#${row.activityInstanceId}#${row.resourceId}`));
    expect(keys.size).toBe(rows.length);
  }, 120_000);
});
