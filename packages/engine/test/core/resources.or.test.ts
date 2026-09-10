/**
 * LILA-035 — selección OR de recursos (R-REC-6, ADR-026).
 *
 * Aceptación del ticket: con un pool saturado y otro libre, todas las tareas OR arrancan sin
 * esperar y el log registra el pool usado. El resto de pruebas fija el desempate, la retirada de
 * las colas alternativas, la convivencia con AND/single, la ausencia de fugas y la degradación
 * byte a byte de los escenarios que no usan OR.
 */

import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import type { Flow, Node, ProcessIR } from '../../src/core/ir.js';
import { ResourceManager, type ResourceRequest } from '../../src/core/resources.js';
import { runReplication, type SimScenario } from '../../src/core/sim.js';

const edge = (from: string, to: string): Flow => ({ from, to, name: '', isDefault: false });

function linearIr(): ProcessIR {
  const nodes: Record<string, Node> = {
    Start: { type: 'start', name: '', incoming: [], outgoing: ['S_T'] },
    Task: { type: 'task', name: '', incoming: ['S_T'], outgoing: ['T_E'] },
    End: { type: 'end', name: '', incoming: ['T_E'], outgoing: [] },
  };
  const flows: Record<string, Flow> = { S_T: edge('Start', 'Task'), T_E: edge('Task', 'End') };
  return { id: 'P_Or', name: '', nodes, flows, source: { exporter: 'test', exporterVersion: '0', originalIds: {} } };
}

/** `Hog` satura un pool desde el instante 0; `Task` es la tarea OR que no debería esperar. */
function saturatedIr(): ProcessIR {
  const nodes: Record<string, Node> = {
    StartHog: { type: 'start', name: '', incoming: [], outgoing: ['SH_H'] },
    Hog: { type: 'task', name: '', incoming: ['SH_H'], outgoing: ['H_E'] },
    HogEnd: { type: 'end', name: '', incoming: ['H_E'], outgoing: [] },
    Start: { type: 'start', name: '', incoming: [], outgoing: ['S_T'] },
    Task: { type: 'task', name: '', incoming: ['S_T'], outgoing: ['T_E'] },
    End: { type: 'end', name: '', incoming: ['T_E'], outgoing: [] },
  };
  const flows: Record<string, Flow> = {
    SH_H: edge('StartHog', 'Hog'), H_E: edge('Hog', 'HogEnd'),
    S_T: edge('Start', 'Task'), T_E: edge('Task', 'End'),
  };
  return { id: 'P_Sat', name: '', nodes, flows, source: { exporter: 'test', exporterVersion: '0', originalIds: {} } };
}

function or(id: string, enabledAt: number, pools: readonly string[], quantity = 1): ResourceRequest {
  return {
    id,
    enabledAt,
    selection: 'or',
    requirements: pools.map((poolId) => ({ poolId, quantity })),
  };
}

describe('aceptación LILA-035: un pool saturado no hace esperar a la tarea OR', () => {
  test('todas las tareas OR arrancan sin esperar y el log registra el pool libre', () => {
    const scenario: SimScenario = {
      run: { seed: 1 },
      resources: { saturado: { capacity: 1 }, libre: { capacity: 4 } },
      elements: {
        // Ocupa `saturado` desde t=0 hasta el final de la corrida.
        StartHog: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        Hog: { processingTime: { type: 'constant', value: 1000 }, resources: [{ ref: 'saturado' }] },
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 4 },
        Task: {
          processingTime: { type: 'constant', value: 50 },
          resources: [{ ref: 'saturado' }, { ref: 'libre' }],
          selection: 'or',
        },
      },
    };

    const run = runReplication(saturatedIr(), scenario);
    const orRows = run.rows.filter((row) => row.elementId === 'Task');

    expect(orRows).toHaveLength(4);
    expect(orRows.map((row) => row.resourceWait)).toEqual([0, 0, 0, 0]);
    expect(orRows.map((row) => row.startedAt)).toEqual(orRows.map((row) => row.enabledAt));
    // El log registra el pool efectivamente usado, nunca el saturado.
    expect(orRows.map((row) => row.resourceId)).toEqual(['libre', 'libre', 'libre', 'libre']);
    expect(orRows.map((row) => row.resourceQuantity)).toEqual([1, 1, 1, 1]);
    // Una fila por asignación real: la OR produce exactamente una (R-REC-11).
    expect(new Set(orRows.map((row) => row.activityInstanceId)).size).toBe(4);
    expect(orRows.map((row) => row.allocationIndex)).toEqual([1, 1, 1, 1]);
  });

  test('los costos son los del pool usado, no los de la alternativa descartada', () => {
    const scenario: SimScenario = {
      run: { seed: 1 },
      resources: {
        saturado: { capacity: 1, fixedCost: 100, costPerHour: 36000 },
        libre: { capacity: 1, fixedCost: 2, costPerHour: 3600 },
      },
      elements: {
        StartHog: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        Hog: { processingTime: { type: 'constant', value: 1000 }, resources: [{ ref: 'saturado' }] },
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        Task: {
          processingTime: { type: 'constant', value: 3600 },
          resources: [{ ref: 'saturado' }, { ref: 'libre' }],
          selection: 'or',
          fixedCost: 1,
        },
      },
    };

    const row = runReplication(saturatedIr(), scenario).rows.find((r) => r.elementId === 'Task');
    expect(row).toMatchObject({ resourceId: 'libre', elementCost: 1, resourceCost: 3602, cost: 3603 });
  });
});

describe('desempate y retirada de las colas alternativas', () => {
  test('con varias alternativas libres gana la primera declarada (R-REC-6)', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 }, c: { capacity: 1 } });
    expect(manager.enqueue(or('x', 0, ['c', 'a', 'b']), 0)).toMatchObject([
      { requestId: 'x', assignments: [{ poolId: 'c', quantity: 1 }] },
    ]);
    expect(manager.used('c')).toBe(1);
    expect(manager.used('a')).toBe(0);
    expect(manager.used('b')).toBe(0);
  });

  test('el desempate depende del orden declarado, no del alfabético ni del de `resources`', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    expect(manager.enqueue(or('x', 0, ['b', 'a']), 0)[0]?.assignments[0]?.poolId).toBe('b');
  });

  test('gana la primera alternativa libre, aunque otra anterior esté ocupada', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 }, c: { capacity: 1 } });
    manager.enqueue({ id: 'hold-a', enabledAt: 0, requirements: [{ poolId: 'a', quantity: 1 }] }, 0);
    expect(manager.enqueue(or('x', 1, ['a', 'b', 'c']), 1)[0]?.assignments[0]?.poolId).toBe('b');
  });

  test('cada alternativa lleva su propia quantity', () => {
    const manager = new ResourceManager({ pequeno: { capacity: 1 }, grande: { capacity: 4 } });
    const request: ResourceRequest = {
      id: 'x', enabledAt: 0, selection: 'or',
      requirements: [{ poolId: 'pequeno', quantity: 1 }, { poolId: 'grande', quantity: 3 }],
    };
    manager.enqueue({ id: 'hold', enabledAt: 0, requirements: [{ poolId: 'pequeno', quantity: 1 }] }, 0);
    expect(manager.enqueue(request, 0)).toMatchObject([
      { requestId: 'x', assignments: [{ poolId: 'grande', quantity: 3 }] },
    ]);
    expect(manager.used('grande')).toBe(3);
  });

  test('arrancar retira la solicitud de las demás colas sin fuga', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue(or('x', 0, ['a', 'b']), 0);
    expect(manager.queuedEntryCount).toBe(0);
    expect(manager.used('b')).toBe(0);

    manager.release(['x'], 5);
    expect(manager.used('a')).toBe(0);
    expect(manager.used('b')).toBe(0);
    expect(manager.liveRequestCount).toBe(0);
    expect(manager.queuedEntryCount).toBe(0);
  });

  test('la cabeza que quedaba detrás de la alternativa retirada arranca en el acto', () => {
    // `a` tiene 1 unidad libre de 2, así que la OR no cabe en `a` con quantity 2 pero sí en `b`.
    // Al concederse en `b`, la lápida que deja en la cola de `a` no puede bloquear a `detras`.
    const manager = new ResourceManager({ a: { capacity: 2 }, b: { capacity: 1 } });
    manager.enqueue({ id: 'hold-a', enabledAt: 0, requirements: [{ poolId: 'a', quantity: 1 }] }, 0);
    const request: ResourceRequest = {
      id: 'x', enabledAt: 1, selection: 'or',
      requirements: [{ poolId: 'a', quantity: 2 }, { poolId: 'b', quantity: 1 }],
    };
    expect(manager.enqueue(request, 1)).toMatchObject([{ requestId: 'x', assignments: [{ poolId: 'b' }] }]);
    expect(manager.enqueue({ id: 'detras', enabledAt: 2, requirements: [{ poolId: 'a', quantity: 1 }] }, 2))
      .toMatchObject([{ requestId: 'detras', startedAt: 2 }]);
    expect(manager.queuedEntryCount).toBe(0);
  });

  test('una OR que no cabe en ninguna alternativa espera y arranca en la primera liberación', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue({ id: 'hold-a', enabledAt: 0, requirements: [{ poolId: 'a', quantity: 1 }] }, 0);
    manager.enqueue({ id: 'hold-b', enabledAt: 0, requirements: [{ poolId: 'b', quantity: 1 }] }, 0);
    expect(manager.enqueue(or('x', 1, ['a', 'b']), 1)).toEqual([]);

    expect(manager.release(['hold-b'], 4)).toMatchObject([
      { requestId: 'x', startedAt: 4, enabledAt: 1, assignments: [{ poolId: 'b' }] },
    ]);
    expect(manager.release(['hold-a'], 5)).toEqual([]);
    expect(manager.queuedEntryCount).toBe(0);
  });

  test('liberaciones simultáneas de las dos alternativas: gana igualmente la declarada primero', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue({ id: 'hold-a', enabledAt: 0, requirements: [{ poolId: 'a', quantity: 1 }] }, 0);
    manager.enqueue({ id: 'hold-b', enabledAt: 0, requirements: [{ poolId: 'b', quantity: 1 }] }, 0);
    manager.enqueue(or('x', 1, ['a', 'b']), 1);

    expect(manager.release(['hold-b', 'hold-a'], 9)).toMatchObject([
      { requestId: 'x', assignments: [{ poolId: 'a' }] },
    ]);
  });
});

describe('OR conviviendo con AND y single sobre los mismos pools', () => {
  test('OR, AND y single comparten el FIFO `(enabled, seq)` de cada pool', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    // `hold-a` ocupa `a`; la OR llega antes que la single de `b` y se la queda por FIFO.
    manager.enqueue({ id: 'hold-a', enabledAt: 0, requirements: [{ poolId: 'a', quantity: 1 }] }, 0);
    expect(manager.enqueue(or('or-1', 1, ['a', 'b']), 1)).toMatchObject([
      { requestId: 'or-1', assignments: [{ poolId: 'b' }] },
    ]);
    expect(manager.enqueue({ id: 'single-b', enabledAt: 2, requirements: [{ poolId: 'b', quantity: 1 }] }, 2)).toEqual([]);
    expect(manager.enqueue({ id: 'and', enabledAt: 3, selection: 'and', requirements: [{ poolId: 'a', quantity: 1 }, { poolId: 'b', quantity: 1 }] }, 3)).toEqual([]);

    // Al liberar `b`, la single que esperaba desde t=2 va antes que la AND de t=3.
    expect(manager.release(['or-1'], 10)).toMatchObject([{ requestId: 'single-b', startedAt: 10 }]);
    // Con los dos pools libres a la vez, la AND por fin arranca y toma ambos.
    expect(manager.release(['hold-a', 'single-b'], 20)).toMatchObject([
      { requestId: 'and', startedAt: 20, assignments: [{ poolId: 'a' }, { poolId: 'b' }] },
    ]);
    expect(manager.queuedEntryCount).toBe(0);
    expect(manager.liveRequestCount).toBe(1);
  });

  test('una OR en cabeza que no cabe en ningún pool bloquea el FIFO de ambos (R-REC-5)', () => {
    const manager = new ResourceManager({ a: { capacity: 2 }, b: { capacity: 2 } });
    manager.enqueue({ id: 'hold-a', enabledAt: 0, requirements: [{ poolId: 'a', quantity: 1 }] }, 0);
    manager.enqueue({ id: 'hold-b', enabledAt: 0, requirements: [{ poolId: 'b', quantity: 1 }] }, 0);
    const big: ResourceRequest = {
      id: 'or-grande', enabledAt: 1, selection: 'or',
      requirements: [{ poolId: 'a', quantity: 2 }, { poolId: 'b', quantity: 2 }],
    };
    expect(manager.enqueue(big, 1)).toEqual([]);
    // FIFO estricto por pool: las que van detrás no adelantan a la cabeza aunque quepan.
    expect(manager.enqueue({ id: 'detras-a', enabledAt: 2, requirements: [{ poolId: 'a', quantity: 1 }] }, 2)).toEqual([]);
    expect(manager.enqueue({ id: 'detras-b', enabledAt: 2, requirements: [{ poolId: 'b', quantity: 1 }] }, 2)).toEqual([]);

    // Al liberar `a`, la OR toma `a` y `detras-b` puede pasar porque su cabeza se retiró.
    expect(manager.release(['hold-a'], 7).map((grant) => grant.requestId)).toEqual(['or-grande', 'detras-b']);
    expect(manager.used('a')).toBe(2);
    expect(manager.used('b')).toBe(2);
    // La única entrada que queda es `detras-a` esperando de verdad: la lápida de `or-grande` en
    // la cola de `b` se retiró al conceder, no se acumula.
    expect(manager.queuedEntryCount).toBe(1);
    expect(manager.release(['or-grande'], 8)).toMatchObject([{ requestId: 'detras-a', startedAt: 8 }]);
    expect(manager.queuedEntryCount).toBe(0);
  });

  test('OR de un solo pool es idéntica a una single (R-REC-2)', () => {
    const manager = new ResourceManager({ a: { capacity: 1 } });
    expect(manager.enqueue({ id: 'x', enabledAt: 0, selection: 'or', requirements: [{ poolId: 'a', quantity: 1 }] }, 0))
      .toMatchObject([{ requestId: 'x', assignments: [{ poolId: 'a' }] }]);
    expect(manager.enqueue({ id: 'y', enabledAt: 1, requirements: [{ poolId: 'a', quantity: 1 }] }, 1)).toEqual([]);
  });

  test('una alternativa con quantity mayor que la capacity sigue siendo error (R-REC-2)', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 4 } });
    expect(() => manager.enqueue({
      id: 'x', enabledAt: 0, selection: 'or',
      requirements: [{ poolId: 'a', quantity: 3 }, { poolId: 'b', quantity: 1 }],
    }, 0)).toThrow(/E-REC-CANTIDAD/);
    expect(manager.liveRequestCount).toBe(0);
    expect(manager.queuedEntryCount).toBe(0);
  });
});

describe('cancelación, terminate, warmup y señal no dejan fugas', () => {
  test('cancelar una OR en espera la retira de todas sus colas', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue({ id: 'hold-a', enabledAt: 0, requirements: [{ poolId: 'a', quantity: 1 }] }, 0);
    manager.enqueue({ id: 'hold-b', enabledAt: 0, requirements: [{ poolId: 'b', quantity: 1 }] }, 0);
    manager.enqueue(or('x', 1, ['a', 'b']), 1);
    manager.enqueue({ id: 'detras', enabledAt: 2, requirements: [{ poolId: 'a', quantity: 1 }] }, 2);

    expect(manager.cancel(['x'], 3)).toEqual([]);
    expect(manager.release(['hold-a'], 4)).toMatchObject([{ requestId: 'detras', startedAt: 4 }]);
    expect(manager.release(['hold-b'], 5)).toEqual([]);
    expect(manager.queuedEntryCount).toBe(0);
  });

  test('cancelar una OR ya activa devuelve solo las unidades del pool usado', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue(or('x', 0, ['a', 'b']), 0);
    manager.cancel(['x'], 1);
    expect(manager.used('a')).toBe(0);
    expect(manager.used('b')).toBe(0);
    expect(manager.liveRequestCount).toBe(0);
    expect(manager.queuedEntryCount).toBe(0);
  });

  test('terminate cierra la OR en espera con una sola fila sentinel y libera todo', () => {
    const nodes: Record<string, Node> = {
      StartKill: { type: 'start', name: '', incoming: [], outgoing: ['SK_F'] },
      Fork: { type: 'and', name: '', incoming: ['SK_F'], outgoing: ['F_Work', 'F_Timer'] },
      Work: { type: 'task', name: '', incoming: ['F_Work'], outgoing: ['W_E'] },
      Timer: { type: 'timer', name: '', incoming: ['F_Timer'], outgoing: ['T_K'] },
      Kill: { type: 'terminate', name: '', incoming: ['T_K'], outgoing: [] },
      WorkEnd: { type: 'end', name: '', incoming: ['W_E'], outgoing: [] },
    };
    const flows: Record<string, Flow> = {
      SK_F: edge('StartKill', 'Fork'), F_Work: edge('Fork', 'Work'), F_Timer: edge('Fork', 'Timer'),
      W_E: edge('Work', 'WorkEnd'), T_K: edge('Timer', 'Kill'),
    };
    const ir: ProcessIR = { id: 'P_Kill', name: '', nodes, flows, source: { exporter: 'test', exporterVersion: '0', originalIds: {} } };
    const scenario: SimScenario = {
      run: { seed: 1 },
      resources: { a: { capacity: 1 }, b: { capacity: 1 } },
      elements: {
        StartKill: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 2 },
        Work: {
          processingTime: { type: 'constant', value: 100 },
          resources: [{ ref: 'a' }, { ref: 'b' }],
          selection: 'or',
        },
        Timer: { processingTime: { type: 'constant', value: 5 } },
      },
    };

    const run = runReplication(ir, scenario);
    const work = run.rows.filter((row) => row.elementId === 'Work');
    // Ambas OR arrancan (una en `a`, otra en `b`) y el terminate las cierra a los 5 s.
    expect(work.map((row) => [row.resourceId, row.status])).toEqual([
      ['a', 'terminated'],
      ['b', 'terminated'],
    ]);
    expect(work.map((row) => row.observedUntil)).toEqual([5, 6]);
  });

  test('una OR que sigue en cola al cerrarse emite exactamente una sentinel', () => {
    const scenario: SimScenario = {
      run: { seed: 1, duration: 3 },
      resources: { a: { capacity: 1 }, b: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 3 },
        Task: {
          processingTime: { type: 'constant', value: 100 },
          resources: [{ ref: 'a' }, { ref: 'b' }],
          selection: 'or',
        },
      },
    };
    const run = runReplication(linearIr(), scenario);
    const pending = run.rows.filter((row) => row.status === 'inFlight' && row.startedAt === null);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ resourceId: null, resourceQuantity: null, allocationIndex: null });
  });

  test('warmup: los casos previos ocupan y liberan las alternativas OR igual', () => {
    const scenario: SimScenario = {
      run: { seed: 1, warmup: 4 },
      resources: { a: { capacity: 1 }, b: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 2 }, triggerCount: 4 },
        Task: {
          processingTime: { type: 'constant', value: 1 },
          resources: [{ ref: 'a' }, { ref: 'b' }],
          selection: 'or',
        },
      },
    };
    const run = runReplication(linearIr(), scenario);
    // Cada caso encuentra `a` libre porque el anterior ya la soltó: siempre gana la primera.
    expect(run.rows.map((row) => row.resourceId)).toEqual(['a', 'a', 'a', 'a']);
    expect(run.cases.map((record) => record.caseId)).toEqual([3, 4]);
  });

  test('una señal abortada corta la corrida sin dejar asignaciones colgadas', () => {
    const scenario: SimScenario = {
      run: { seed: 1 },
      resources: { a: { capacity: 1 }, b: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 5 },
        Task: {
          processingTime: { type: 'constant', value: 10 },
          resources: [{ ref: 'a' }, { ref: 'b' }],
          selection: 'or',
        },
      },
    };
    let seen = 0;
    const signal = { get aborted(): boolean { return seen >= 2; } };
    const run = runReplication(linearIr(), scenario, 0, {
      signal,
      onEvent: () => { seen++; },
    });
    expect(run.cancelled).toBe(true);
    // Toda instancia abierta se cierra: no queda ninguna fila sin `observedUntil`.
    expect(run.rows.every((row) => Number.isFinite(row.observedUntil))).toBe(true);
    expect(run.rows.filter((row) => row.elementId === 'Task').every((row) => row.resourceId === null || row.resourceId === 'a' || row.resourceId === 'b')).toBe(true);
  });
});

describe('escala y reutilización de ids', () => {
  test('reencolar un id ya liberado no revive la entrada OR retirada', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue({ id: 'hold-a', enabledAt: 0, requirements: [{ poolId: 'a', quantity: 1 }] }, 0);
    // `x` se encola en `a` (bloqueada) y en `b` (libre): arranca en `b` y deja lápida en `a`.
    manager.enqueue(or('x', 1, ['a', 'b']), 1);
    manager.release(['x'], 2);
    // El mismo id vuelve a entrar: la lápida antigua no puede hacerse pasar por la nueva cabeza.
    expect(manager.enqueue(or('x', 3, ['b', 'a']), 3)).toMatchObject([
      { requestId: 'x', enabledAt: 3, assignments: [{ poolId: 'b' }] },
    ]);
    manager.release(['hold-a', 'x'], 4);
    expect(manager.liveRequestCount).toBe(0);
    expect(manager.queuedEntryCount).toBe(0);
  });

  test('20 000 OR sobre dos pools no producen deadlock ni reescaneo cuadrático', () => {
    const total = 20_000;
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    for (let i = 0; i < total; i++) manager.enqueue(or(`or-${i}`, i, ['a', 'b']), i);

    let started = 2; // Las dos primeras arrancan al encolarse, una por pool.
    for (let i = 0; i < total; i++) {
      const granted = manager.release([`or-${i}`], total + i);
      started += granted.length;
    }
    expect(started).toBe(total);
    expect(manager.liveRequestCount).toBe(0);
    expect(manager.used('a')).toBe(0);
    expect(manager.used('b')).toBe(0);
    expect(manager.queuedEntryCount).toBe(0);
    // Cota lineal holgada: sin ella, cada liberación recorrería la cola entera.
    expect(manager.headInspections).toBeLessThan(total * 20);
  });
});

describe('determinismo y degradación', () => {
  const orScenario = (): SimScenario => ({
    run: { seed: 11, warmup: 2 },
    resources: {
      a: { capacity: 1, fixedCost: 1, costPerHour: 36 },
      b: { capacity: 2, fixedCost: 2, costPerHour: 72 },
    },
    elements: {
      Start: { interTriggerTimer: { type: 'exponential', mean: 3 }, triggerCount: 40 },
      Task: {
        processingTime: { type: 'exponential', mean: 5 },
        resources: [{ ref: 'a' }, { ref: 'b' }],
        selection: 'or',
        fixedCost: 0.25,
      },
    },
  });

  test('dos corridas del mismo escenario OR son byte a byte idénticas', () => {
    const first = JSON.stringify(runReplication(linearIr(), orScenario()));
    const second = JSON.stringify(runReplication(linearIr(), orScenario()));
    expect(second).toBe(first);
    // Y el reparto entre pools no es trivial: la OR usa las dos alternativas.
    expect(new Set(JSON.parse(first).rows.map((row: { resourceId: string }) => row.resourceId)))
      .toEqual(new Set(['a', 'b']));
  });

  test('invertir el orden declarado cambia el pool elegido, no el resto del reparto', () => {
    const inverted = orScenario();
    inverted.elements!['Task']!.resources = [{ ref: 'b' }, { ref: 'a' }];
    const direct = runReplication(linearIr(), orScenario());
    const swapped = runReplication(linearIr(), inverted);
    expect(swapped.rows[0]?.resourceId).toBe('b');
    expect(direct.rows[0]?.resourceId).toBe('a');
  });

  /**
   * Degradación: un escenario sin OR (single + AND) tiene que dar exactamente el mismo
   * `ReplicationRun` que antes de LILA-035. El hash se capturó con este mismo motor en
   * `lila-34-and-resources` 84e1b5e; regenerarlo solo tiene sentido si cambia el contrato del
   * formato de resultados, nunca para "arreglar" este test. Se regeneró en #316, que añade
   * `CaseRecord.endId` —el desenlace de cada caso— a la `ReplicationRun` que aquí se hashea.
   */
  test('un escenario single + AND sigue dando el mismo resultado byte a byte que en 84e1b5e', () => {
    const nodes: Record<string, Node> = {
      Start: { type: 'start', name: '', incoming: [], outgoing: ['S_A'] },
      Single: { type: 'task', name: '', incoming: ['S_A'], outgoing: ['A_B'] },
      Both: { type: 'task', name: '', incoming: ['A_B'], outgoing: ['B_E'] },
      End: { type: 'end', name: '', incoming: ['B_E'], outgoing: [] },
    };
    const flows: Record<string, Flow> = {
      S_A: edge('Start', 'Single'), A_B: edge('Single', 'Both'), B_E: edge('Both', 'End'),
    };
    const ir: ProcessIR = { id: 'P', name: '', nodes, flows, source: { exporter: 'test', exporterVersion: '0', originalIds: {} } };
    const scenario: SimScenario = {
      run: { seed: 7, warmup: 3 },
      resources: {
        alpha: { capacity: 2, fixedCost: 1.5, costPerHour: 36 },
        beta: { capacity: 1, costPerHour: 72 },
      },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 2 }, triggerCount: 6 },
        Single: { processingTime: { type: 'constant', value: 5 }, resources: [{ ref: 'alpha' }], fixedCost: 0.5 },
        Both: {
          processingTime: { type: 'constant', value: 4 },
          resources: [{ ref: 'alpha', quantity: 2 }, { ref: 'beta' }],
          selection: 'and',
        },
      },
    };

    const digest = createHash('sha256').update(JSON.stringify(runReplication(ir, scenario))).digest('hex');
    expect(digest).toBe('4c5e8792a72592d42ef244bddaa2a4cbf3fd69576308067e9ba4b921ba556a56');
  });
});
