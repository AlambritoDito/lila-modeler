/**
 * QA adversarial de LILA-034 (asignación AND multi-pool atómica).
 *
 * Ataca invariantes que las pruebas de aceptación no fijan: atomicidad bajo carga aleatoria,
 * orden adverso de ids, fugas de capacidad tras release/cancel, coste por pool reconstruido
 * desde el event log y determinismo byte a byte.
 */

import { describe, expect, test } from 'vitest';

import type { Flow, Node, ProcessIR } from '../../src/core/ir.js';
import type { EventLogRow } from '../../src/core/result.js';
import { simulate } from '../../src/core/run.js';
import { runReplication, type SimScenario } from '../../src/core/sim.js';
import { ResourceManager, type ResourceRequirement } from '../../src/core/resources.js';

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

/** PRNG determinista y local: el test no puede depender de `Math.random`. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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
  return {
    id: 'Process_QA034',
    name: '',
    nodes,
    flows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

/**
 * Reconstruye la ocupación por pool desde el event log y devuelve el máximo simultáneo.
 * Las liberaciones se aplican antes que las adquisiciones del mismo instante, que es
 * exactamente lo que hace el bucle DES.
 */
function peakOccupancy(rows: readonly EventLogRow[]): Map<string, number> {
  const deltas: Array<{ t: number; delta: number; pool: string }> = [];
  for (const row of rows) {
    if (row.resourceId === null || row.startedAt === null || row.resourceQuantity === null) continue;
    deltas.push({ t: row.startedAt, delta: row.resourceQuantity, pool: row.resourceId });
    deltas.push({ t: row.observedUntil, delta: -row.resourceQuantity, pool: row.resourceId });
  }
  deltas.sort((left, right) => left.t - right.t || left.delta - right.delta);
  const used = new Map<string, number>();
  const peak = new Map<string, number>();
  for (const event of deltas) {
    const next = (used.get(event.pool) ?? 0) + event.delta;
    used.set(event.pool, next);
    expect(next).toBeGreaterThanOrEqual(0);
    peak.set(event.pool, Math.max(peak.get(event.pool) ?? 0, next));
  }
  for (const [pool, remaining] of used) expect([pool, remaining]).toEqual([pool, 0]);
  return peak;
}

/* ------------------------------------------------------------------ *
 * ResourceManager: atomicidad e invariantes
 * ------------------------------------------------------------------ */

describe('QA LILA-034 · atomicidad del ResourceManager', () => {
  test('carga aleatoria mixta: used siempre coincide con las asignaciones completas vivas', () => {
    const capacities = { a: 3, b: 2, c: 4 } as const;
    const manager = new ResourceManager({
      a: { capacity: capacities.a },
      b: { capacity: capacities.b },
      c: { capacity: capacities.c },
    });
    const random = mulberry32(20260904);
    const shapes: ResourceRequirement[][] = [
      [{ poolId: 'a', quantity: 1 }],
      [{ poolId: 'a', quantity: 3 }],
      [{ poolId: 'b', quantity: 2 }],
      [{ poolId: 'a', quantity: 2 }, { poolId: 'b', quantity: 1 }],
      [{ poolId: 'b', quantity: 1 }, { poolId: 'a', quantity: 2 }],
      [{ poolId: 'c', quantity: 3 }, { poolId: 'a', quantity: 1 }, { poolId: 'b', quantity: 2 }],
      [{ poolId: 'c', quantity: 1 }],
    ];
    const active = new Map<string, ResourceRequirement[]>();
    const expected = { a: 0, b: 0, c: 0 };

    const track = (allocations: ReturnType<ResourceManager['enqueue']>): void => {
      for (const allocation of allocations) {
        expect(active.has(allocation.requestId)).toBe(false);
        active.set(allocation.requestId, [...allocation.assignments]);
        for (const assignment of allocation.assignments) {
          expected[assignment.poolId as 'a' | 'b' | 'c'] += assignment.quantity;
        }
      }
    };
    const drop = (id: string): void => {
      for (const assignment of active.get(id) ?? []) {
        expected[assignment.poolId as 'a' | 'b' | 'c'] -= assignment.quantity;
      }
      active.delete(id);
    };
    const assertInvariants = (): void => {
      for (const pool of ['a', 'b', 'c'] as const) {
        expect(manager.used(pool)).toBe(expected[pool]);
        expect(manager.used(pool)).toBeGreaterThanOrEqual(0);
        expect(manager.used(pool)).toBeLessThanOrEqual(capacities[pool]);
      }
    };

    let clock = 0;
    let nextId = 0;
    const queued = new Set<string>();
    for (let step = 0; step < 4000; step++) {
      clock += 1;
      const roll = random();
      if (roll < 0.55 || active.size === 0) {
        const id = `r-${nextId++}`;
        queued.add(id);
        track(manager.enqueue({ id, enabledAt: clock, requirements: shapes[Math.floor(random() * shapes.length)]! }, clock));
      } else if (roll < 0.9) {
        const ids = [...active.keys()];
        const victim = ids[Math.floor(random() * ids.length)]!;
        const allocations = manager.release([victim], clock);
        drop(victim);
        queued.delete(victim);
        track(allocations);
      } else {
        const ids = [...active.keys(), ...[...queued].filter((id) => !active.has(id))];
        const victim = ids[Math.floor(random() * ids.length)]!;
        const allocations = manager.cancel([victim], clock);
        drop(victim);
        queued.delete(victim);
        track(allocations);
      }
      for (const id of active.keys()) queued.delete(id);
      assertInvariants();
    }

    // Sin deadlock: al soltar todo lo activo la cola termina de vaciarse y no queda capacidad viva.
    clock += 1;
    let guard = 0;
    while (active.size > 0) {
      expect(guard++).toBeLessThan(10_000);
      clock += 1;
      const victim = [...active.keys()][0]!;
      const allocations = manager.release([victim], clock);
      drop(victim);
      track(allocations);
      assertInvariants();
    }
    expect(manager.liveRequestCount).toBe(0);
    for (const pool of ['a', 'b', 'c'] as const) expect(manager.used(pool)).toBe(0);
  });

  test('una AND bloqueada no retiene ninguno de sus pools mientras espera', () => {
    const manager = new ResourceManager({ a: { capacity: 2 }, b: { capacity: 1 } });
    manager.enqueue({ id: 'holder-b', enabledAt: 0, requirements: [{ poolId: 'b', quantity: 1 }] }, 0);
    expect(
      manager.enqueue(
        { id: 'and', enabledAt: 1, requirements: [{ poolId: 'a', quantity: 2 }, { poolId: 'b', quantity: 1 }] },
        1,
      ),
    ).toEqual([]);
    // Ni una sola unidad de `a` queda reservada por la AND en espera.
    expect(manager.used('a')).toBe(0);
    expect(
      manager.enqueue({ id: 'single-a', enabledAt: 2, requirements: [{ poolId: 'a', quantity: 2 }] }, 2),
    ).toMatchObject([{ requestId: 'single-a' }]);
    expect(manager.used('a')).toBe(2);
    expect(manager.release(['holder-b'], 3)).toEqual([]);
    expect(manager.used('b')).toBe(0);
    expect(manager.release(['single-a'], 4)).toMatchObject([{ requestId: 'and', startedAt: 4 }]);
    expect(manager.used('a')).toBe(2);
    expect(manager.used('b')).toBe(1);
  });

  test('cancelar una AND encolada no deja tombstones que bloqueen su clase', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    const requirements = [{ poolId: 'a', quantity: 1 }, { poolId: 'b', quantity: 1 }] as const;
    manager.enqueue({ id: 'holder', enabledAt: 0, requirements }, 0);
    manager.enqueue({ id: 'dead-1', enabledAt: 1, requirements }, 1);
    manager.enqueue({ id: 'dead-2', enabledAt: 2, requirements }, 2);
    manager.enqueue({ id: 'alive', enabledAt: 3, requirements }, 3);

    expect(manager.cancel(['dead-1', 'dead-2'], 4)).toEqual([]);
    expect(manager.release(['holder'], 5)).toMatchObject([{ requestId: 'alive', startedAt: 5 }]);
    expect(manager.cancel(['alive'], 6)).toEqual([]);
    expect(manager.used('a')).toBe(0);
    expect(manager.used('b')).toBe(0);
    expect(manager.liveRequestCount).toBe(0);
  });

  test('cancel de todo el lote deja los pools en cero aunque mezcle activos y encolados', () => {
    const manager = new ResourceManager({ a: { capacity: 2 }, b: { capacity: 2 } });
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) {
      const id = `r-${i}`;
      ids.push(id);
      manager.enqueue(
        {
          id,
          enabledAt: i,
          requirements:
            i % 2 === 0
              ? [{ poolId: 'a', quantity: 2 }, { poolId: 'b', quantity: 1 }]
              : [{ poolId: 'b', quantity: 2 }, { poolId: 'a', quantity: 1 }],
        },
        i,
      );
    }
    expect(manager.cancel(ids, 100)).toEqual([]);
    expect(manager.used('a')).toBe(0);
    expect(manager.used('b')).toBe(0);
    expect(manager.liveRequestCount).toBe(0);
  });

  test('quantity > 1 en cada pool respeta el techo exacto de capacidad', () => {
    const manager = new ResourceManager({ a: { capacity: 4 }, b: { capacity: 6 } });
    const requirements = [{ poolId: 'a', quantity: 2 }, { poolId: 'b', quantity: 3 }] as const;
    expect(manager.enqueue({ id: 'one', enabledAt: 0, requirements }, 0)).toHaveLength(1);
    expect(manager.enqueue({ id: 'two', enabledAt: 0, requirements }, 0)).toHaveLength(1);
    expect(manager.used('a')).toBe(4);
    expect(manager.used('b')).toBe(6);
    expect(manager.enqueue({ id: 'three', enabledAt: 0, requirements }, 0)).toEqual([]);
    expect(manager.release(['one'], 1)).toMatchObject([{ requestId: 'three' }]);
    expect(manager.used('a')).toBe(4);
    expect(manager.used('b')).toBe(6);
  });

  test('el orden declarado de los requisitos no cambia a quién se concede primero', () => {
    const forward = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    const reverse = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    const ab = [{ poolId: 'a', quantity: 1 }, { poolId: 'b', quantity: 1 }] as const;
    const ba = [{ poolId: 'b', quantity: 1 }, { poolId: 'a', quantity: 1 }] as const;

    for (const [manager, shapes] of [[forward, [ab, ab, ab]], [reverse, [ab, ba, ab]]] as const) {
      manager.enqueue({ id: 'r0', enabledAt: 0, requirements: shapes[0] }, 0);
      manager.enqueue({ id: 'r1', enabledAt: 1, requirements: shapes[1] }, 1);
      manager.enqueue({ id: 'r2', enabledAt: 2, requirements: shapes[2] }, 2);
    }
    expect(forward.release(['r0'], 10).map((grant) => grant.requestId)).toEqual(['r1']);
    expect(reverse.release(['r0'], 10).map((grant) => grant.requestId)).toEqual(['r1']);
    expect(forward.release(['r1'], 20).map((grant) => grant.requestId)).toEqual(['r2']);
    expect(reverse.release(['r1'], 20).map((grant) => grant.requestId)).toEqual(['r2']);
  });

  test('FIFO estricto single-pool: una cabeza grande no la adelanta una petición pequeña', () => {
    // Documenta ADR-026 explícitamente: la clase single-pool es única por pool, sin salto.
    const manager = new ResourceManager({ a: { capacity: 2 } });
    manager.enqueue({ id: 'holder', enabledAt: 0, requirements: [{ poolId: 'a', quantity: 1 }] }, 0);
    manager.enqueue({ id: 'big', enabledAt: 1, requirements: [{ poolId: 'a', quantity: 2 }] }, 1);
    expect(
      manager.enqueue({ id: 'small', enabledAt: 2, requirements: [{ poolId: 'a', quantity: 1 }] }, 2),
    ).toEqual([]);
    expect(manager.used('a')).toBe(1);
    expect(manager.release(['holder'], 3).map((grant) => grant.requestId)).toEqual(['big']);
  });

  test('dos tareas con los mismos pools en distinto orden comparten una sola cola FIFO', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    const ab = [{ poolId: 'a', quantity: 1 }, { poolId: 'b', quantity: 1 }] as const;
    const ba = [{ poolId: 'b', quantity: 1 }, { poolId: 'a', quantity: 1 }] as const;
    manager.enqueue({ id: 'holder', enabledAt: 0, requirements: ab }, 0);
    manager.enqueue({ id: 'reversed', enabledAt: 1, requirements: ba }, 1);
    manager.enqueue({ id: 'forward', enabledAt: 2, requirements: ab }, 2);

    // ADR-026: la firma se ordena, así que `reversed` es la cabeza única y `forward` va detrás.
    expect(manager.release(['holder'], 5).map((grant) => grant.requestId)).toEqual(['reversed']);
    // El orden declarado sobrevive intacto en las asignaciones que ve el event log.
    expect(manager.release(['reversed'], 6)).toMatchObject([
      { requestId: 'forward', assignments: [{ poolId: 'a' }, { poolId: 'b' }] },
    ]);
  });

  test('100 000 AND con ids adversos no producen deadlock ni reescaneo cuadrático', () => {
    const manager = new ResourceManager({ zzz: { capacity: 1 }, aaa: { capacity: 1 } });
    const adverse = [{ poolId: 'zzz', quantity: 1 }, { poolId: 'aaa', quantity: 1 }] as const;
    const natural = [{ poolId: 'aaa', quantity: 1 }, { poolId: 'zzz', quantity: 1 }] as const;
    const total = 100_000;
    manager.enqueue({ id: 'holder', enabledAt: 0, requirements: adverse }, 0);
    for (let i = 0; i < total; i++) {
      manager.enqueue({ id: `q-${i}`, enabledAt: i + 1, requirements: i % 2 === 0 ? adverse : natural }, i + 1);
    }
    let active = 'holder';
    for (let i = 0; i < total; i++) {
      const grants = manager.release([active], total + 1 + i);
      expect(grants).toHaveLength(1);
      expect(grants[0]!.requestId).toBe(`q-${i}`);
      active = `q-${i}`;
    }
    manager.release([active], 2 * total + 2);
    expect(manager.liveRequestCount).toBe(0);
    expect(manager.used('aaa')).toBe(0);
    expect(manager.used('zzz')).toBe(0);
    // Sin reescaneo cuadrático: unas pocas inspecciones de cabeza por solicitud.
    expect(manager.headInspections).toBeLessThan(20 * total);
  }, 20_000);
});

/* ------------------------------------------------------------------ *
 * Integración con el bucle DES
 * ------------------------------------------------------------------ */

function andScenario(overrides: Partial<SimScenario> = {}): SimScenario {
  return {
    run: { seed: 7 },
    resources: { zzz: { capacity: 2 }, aaa: { capacity: 1 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 8 },
      Task: {
        processingTime: { type: 'constant', value: 3 },
        resources: [{ ref: 'zzz', quantity: 2 }, { ref: 'aaa', quantity: 1 }],
      },
    },
    ...overrides,
  };
}

describe('QA LILA-034 · integración DES', () => {
  test('la ocupación reconstruida del log nunca supera capacity y cierra en cero', () => {
    const run = runReplication(linearIr(), andScenario());
    const peak = peakOccupancy(run.rows);
    expect(peak.get('zzz')).toBe(2);
    expect(peak.get('aaa')).toBe(1);
    expect(run.rows.filter((row) => row.status === 'completed').length).toBe(16);
  });

  test('costos por pool reconstruidos del log coinciden con el cálculo a mano', () => {
    const run = runReplication(linearIr(), {
      run: { seed: 1 },
      resources: {
        zzz: { capacity: 2, fixedCost: 5, costPerHour: 3600 },
        aaa: { capacity: 1, fixedCost: 2, costPerHour: 7200 },
      },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 100 }, triggerCount: 2 },
        Task: {
          processingTime: { type: 'constant', value: 10 },
          fixedCost: 11,
          resources: [{ ref: 'zzz', quantity: 2 }, { ref: 'aaa', quantity: 1 }],
        },
      },
    });
    const perPool = new Map<string, number>();
    for (const row of run.rows) {
      if (row.resourceId === null) continue;
      perPool.set(row.resourceId, (perPool.get(row.resourceId) ?? 0) + row.resourceCost);
    }
    // zzz: (5 fijo + 1 €/s × 10 s) × 2 unidades × 2 casos = 60. aaa: (2 + 2 × 10) × 1 × 2 = 44.
    expect(perPool.get('zzz')).toBeCloseTo(60, 10);
    expect(perPool.get('aaa')).toBeCloseTo(44, 10);
    // El costo de elemento se cobra una sola vez por actividad, en la fila de menor índice.
    expect(run.rows.map((row) => row.elementCost)).toEqual([11, 0, 11, 0]);
    expect(run.rows.map((row) => row.allocationIndex)).toEqual([0, 1, 0, 1]);
    expect(run.rows.map((row) => row.resourceId)).toEqual(['zzz', 'aaa', 'zzz', 'aaa']);
  });

  test('100 000 casos AND con pools en orden adverso terminan sin deadlock y en menos de 3 s', () => {
    const started = Date.now();
    const run = runReplication(linearIr(), {
      run: { seed: 3 },
      resources: { zzz: { capacity: 1 }, aaa: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 100_000 },
        Task: {
          processingTime: { type: 'constant', value: 1 },
          resources: [{ ref: 'zzz', quantity: 1 }, { ref: 'aaa', quantity: 1 }],
        },
      },
    }, 0, { log: false });
    const elapsed = Date.now() - started;
    expect(run.elements.Task).toEqual({ started: 100_000, completed: 100_000 });
    expect(run.rows.filter((row) => row.status !== 'completed')).toEqual([]);
    expect(elapsed).toBeLessThan(3000);
  }, 30_000);

  test('determinismo byte a byte entre dos corridas independientes', () => {
    const first = JSON.stringify(simulate(linearIr(), andScenario()));
    const second = JSON.stringify(simulate(linearIr(), andScenario()));
    expect(first).toBe(second);
    const firstRows = JSON.stringify(runReplication(linearIr(), andScenario()).rows);
    const secondRows = JSON.stringify(runReplication(linearIr(), andScenario()).rows);
    expect(firstRows).toBe(secondRows);
  });

  test('las replicaciones no comparten capacidad ni secuencia del manager', () => {
    const scenario = andScenario({ run: { seed: 7, replications: 3 } });
    const result = simulate(linearIr(), scenario);
    expect(result.replications?.count).toBe(3);
    const runs = [0, 1, 2].map((replication) => runReplication(linearIr(), scenario, replication));
    for (const run of runs) {
      peakOccupancy(run.rows);
      expect(run.rows.map((row) => row.startedAt)).toEqual(runs[0]!.rows.map((row) => row.startedAt));
    }
  });

  test('sin resources el resultado es idéntico con y sin la sección de pools declarada', () => {
    const bare: SimScenario = {
      run: { seed: 5 },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 20 },
        Task: { processingTime: { type: 'constant', value: 4 } },
      },
    };
    const withPools: SimScenario = { ...bare, resources: { zzz: { capacity: 1 }, aaa: { capacity: 3 } } };
    expect(JSON.stringify(simulate(linearIr(), withPools))).toBe(JSON.stringify(simulate(linearIr(), bare)));
    // Capacidad infinita: todas las tareas arrancan en su enabledAt.
    const run = runReplication(linearIr(), bare);
    expect(run.rows.every((row) => row.startedAt === row.enabledAt)).toBe(true);
    expect(run.rows.every((row) => row.resourceId === null && row.allocationIndex === null)).toBe(true);
  });

  test('el corte por warmup no altera la ocupación ni deja filas AND sin cerrar', () => {
    const run = runReplication(linearIr(), {
      run: { seed: 2, warmup: 10, duration: 25 },
      resources: { zzz: { capacity: 1 }, aaa: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 2 }, triggerCount: 20 },
        Task: {
          processingTime: { type: 'constant', value: 4 },
          resources: [{ ref: 'zzz', quantity: 1 }, { ref: 'aaa', quantity: 1 }],
        },
      },
    });
    peakOccupancy(run.rows);
    const queued = run.rows.filter((row) => row.startedAt === null);
    // Una AND que sigue en cola al corte emite exactamente una sentinel por actividad.
    for (const row of queued) {
      expect(row.resourceId).toBeNull();
      expect(row.resourceQuantity).toBeNull();
      expect(row.allocationIndex).toBeNull();
      expect(run.rows.filter((other) => other.activityInstanceId === row.activityInstanceId)).toHaveLength(1);
    }
    expect(run.rows.every((row) => row.status !== 'completed' || row.endedAt !== null)).toBe(true);
  });

  test('un ref colgante falla antes de cualquier callback y cita el id BPMN de la tarea', () => {
    const events: EventLogRow[] = [];
    const progress: unknown[] = [];
    const scenario: SimScenario = {
      run: { seed: 1, duration: 50 },
      resources: { real: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 5 },
        Task: { processingTime: { type: 'constant', value: 1 }, resources: [{ ref: 'real' }, { ref: 'fantasma' }] },
      },
    };
    expect(() => runReplication(linearIr(), scenario, 0, { onEvent: (row) => events.push(row) })).toThrow(
      'E-REC-DESCONOCIDO: Task: el pool fantasma no existe.',
    );
    expect(events).toEqual([]);
    expect(() => simulate(linearIr(), scenario, { onProgress: (p) => progress.push(p) })).toThrow(
      /E-REC-DESCONOCIDO/,
    );
    expect(progress).toEqual([]);
  });

  test('capacity inválida, pool repetido y quantity > capacity fallan en el preflight', () => {
    const withResources = (
      resources: SimScenario['resources'],
      uses: NonNullable<SimScenario['elements']>[string]['resources'],
    ): SimScenario => ({
      run: { seed: 1, duration: 50 },
      resources,
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 5 },
        Task: { processingTime: { type: 'constant', value: 1 }, resources: uses },
      },
    });

    const cases: Array<[SimScenario, string]> = [
      [withResources({ bad: { capacity: 0 } }, [{ ref: 'bad' }]), 'E-REC-CAPACIDAD: bad'],
      [
        withResources({ a: { capacity: 2 } }, [{ ref: 'a' }, { ref: 'a' }]),
        'E-REC-DUPLICADO: Task: el pool a aparece más de una vez.',
      ],
      [
        withResources({ a: { capacity: 1 }, b: { capacity: 3 } }, [{ ref: 'b', quantity: 2 }, { ref: 'a', quantity: 5 }]),
        'E-REC-CANTIDAD: Task: quantity 5 excede capacity 1 de a.',
      ],
    ];
    for (const [scenario, message] of cases) {
      const progress: unknown[] = [];
      const events: EventLogRow[] = [];
      expect(() => simulate(linearIr(), scenario, { onProgress: (p) => progress.push(p), onEvent: (row) => events.push(row) }))
        .toThrow(message);
      expect(progress).toEqual([]);
      expect(events).toEqual([]);
    }
  });

  test('cancelación por signal cierra la AND activa y la encolada sin dejar filas huérfanas', () => {
    const signal = { aborted: false };
    const run = runReplication(linearIr(), {
      run: { seed: 1 },
      resources: { zzz: { capacity: 1 }, aaa: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 4 },
        Task: {
          processingTime: { type: 'constant', value: 100 },
          resources: [{ ref: 'zzz', quantity: 1 }, { ref: 'aaa', quantity: 1 }],
        },
      },
    }, 0, { signal, onStep: (time) => { if (time >= 2) signal.aborted = true; } });

    expect(run.cancelled).toBe(true);
    peakOccupancy(run.rows);
    const byInstance = new Map<string, EventLogRow[]>();
    for (const row of run.rows) {
      byInstance.set(row.activityInstanceId, [...(byInstance.get(row.activityInstanceId) ?? []), row]);
    }
    for (const rows of byInstance.values()) {
      expect(rows.every((row) => row.status === 'inFlight')).toBe(true);
      expect(rows.length).toBe(rows[0]!.startedAt === null ? 1 : 2);
    }
  });
});
