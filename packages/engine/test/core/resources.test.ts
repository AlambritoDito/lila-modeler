import { describe, expect, test } from 'vitest';

import { ResourceManager } from '../../src/core/resources.js';

function request(id: string, enabledAt: number, poolId = 'worker', quantity = 1) {
  return { id, enabledAt, requirements: [{ poolId, quantity }] } as const;
}

describe('ResourceManager (LILA-033)', () => {
  test('respeta quantity y FIFO exacto por enabledAt/seq', () => {
    const manager = new ResourceManager({ worker: { capacity: 2 } });

    expect(manager.enqueue(request('a', 0, 'worker', 2), 0)).toMatchObject([
      { requestId: 'a', startedAt: 0, seq: 0 },
    ]);
    expect(manager.enqueue(request('b', 1, 'worker', 2), 1)).toEqual([]);
    expect(manager.enqueue(request('c', 2, 'worker', 2), 2)).toEqual([]);
    expect(manager.release(['a'], 10)).toMatchObject([{ requestId: 'b', startedAt: 10, seq: 1 }]);
    expect(manager.release(['b'], 20)).toMatchObject([{ requestId: 'c', startedAt: 20, seq: 2 }]);
    expect(manager.release(['c'], 30)).toEqual([]);
    expect(manager.used('worker')).toBe(0);
  });

  test('a igual enabledAt conserva el orden de encolado', () => {
    const manager = new ResourceManager({ worker: { capacity: 1 } });
    manager.enqueue(request('holder', 0), 0);
    manager.enqueue(request('first', 1), 1);
    manager.enqueue(request('second', 1), 1);

    expect(manager.release(['holder'], 2)).toMatchObject([{ requestId: 'first' }]);
    expect(manager.release(['first'], 3)).toMatchObject([{ requestId: 'second' }]);
  });

  test('una cabeza bloqueada no congela otro pool', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue(request('holder-a', 0, 'a'), 0);
    manager.enqueue(request('waiting-a', 1, 'a'), 1);

    expect(manager.enqueue(request('free-b', 2, 'b'), 2)).toMatchObject([
      { requestId: 'free-b', startedAt: 2 },
    ]);
  });

  test('cancelar en bloque libera activos, retira esperas y concede una sola vez', () => {
    const manager = new ResourceManager({ worker: { capacity: 1 } });
    manager.enqueue(request('active', 0), 0);
    manager.enqueue(request('cancelled', 1), 1);
    manager.enqueue(request('next', 2), 2);

    expect(manager.cancel(['active', 'cancelled'], 5)).toMatchObject([
      { requestId: 'next', startedAt: 5 },
    ]);
    expect(manager.used('worker')).toBe(1);
  });

  test('release es atómico cuando el lote contiene un id inválido', () => {
    const manager = new ResourceManager({ worker: { capacity: 2 } });
    manager.enqueue(request('a', 0), 0);
    manager.enqueue(request('b', 0), 0);

    expect(() => manager.release(['a', 'bogus'], 1)).toThrow(/E-REC-LIBERACION/);
    expect(manager.used('worker')).toBe(2);
    expect(manager.liveRequestCount).toBe(2);
  });

  test('una cola saturada inspecciona O(1) heads por llegada, no vuelve a recorrer Q', () => {
    const manager = new ResourceManager({ worker: { capacity: 1 } });
    manager.enqueue(request('holder', 0), 0);
    const before = manager.headInspections;
    for (let i = 0; i < 10_000; i++) manager.enqueue(request(`q-${i}`, i + 1), i + 1);

    expect(manager.headInspections - before).toBe(10_000);
  });

  test('no conserva estados cerrados en ciclos secuenciales largos', () => {
    const manager = new ResourceManager({ worker: { capacity: 1 } });
    for (let i = 0; i < 10_000; i++) {
      const id = `r-${i}`;
      manager.enqueue(request(id, i), i);
      manager.release([id], i + 1);
    }
    expect(manager.liveRequestCount).toBe(0);
    expect(manager.used('worker')).toBe(0);
  });

  test('AND adquiere todos los pools atómicamente y conserva el orden del escenario', () => {
    const manager = new ResourceManager({ a: { capacity: 2 }, b: { capacity: 3 } });
    const grants = manager.enqueue({
      id: 'and', enabledAt: 0, selection: 'and',
      requirements: [{ poolId: 'b', quantity: 2 }, { poolId: 'a', quantity: 1 }],
    }, 0);
    expect(grants).toMatchObject([{ requestId: 'and', assignments: [
      { poolId: 'b', quantity: 2 }, { poolId: 'a', quantity: 1 },
    ] }]);
    expect(manager.used('a')).toBe(1);
    expect(manager.used('b')).toBe(2);
  });

  test('salta una AND bloqueada sin retener capacidad ni romper FIFO single-pool', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 }, c: { capacity: 1 } });
    manager.enqueue(request('holder-b', 0, 'b'), 0);
    expect(manager.enqueue({
      id: 'older', enabledAt: 1,
      requirements: [{ poolId: 'a', quantity: 1 }, { poolId: 'b', quantity: 1 }],
    }, 1)).toEqual([]);
    expect(manager.used('a')).toBe(0);

    expect(manager.enqueue({
      id: 'younger', enabledAt: 2,
      requirements: [{ poolId: 'a', quantity: 1 }, { poolId: 'c', quantity: 1 }],
    }, 2)).toMatchObject([{ requestId: 'younger', startedAt: 2 }]);
    manager.release(['younger'], 3);
    expect(manager.used('a')).toBe(0);
    expect(manager.release(['holder-b'], 10)).toMatchObject([{ requestId: 'older', startedAt: 10 }]);
  });

  test('release de lote libera todo antes de elegir y no deja que un single robe capacidad', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    manager.enqueue(request('active-a', 0, 'a'), 0);
    manager.enqueue(request('active-b', 0, 'b'), 0);
    manager.enqueue({
      id: 'older-and', enabledAt: 1,
      requirements: [{ poolId: 'a', quantity: 1 }, { poolId: 'b', quantity: 1 }],
    }, 1);
    manager.enqueue(request('younger-a', 2, 'a'), 2);

    expect(manager.release(['active-a', 'active-b'], 5).map((grant) => grant.requestId)).toEqual(['older-and']);
    expect(manager.used('a')).toBe(1);
    expect(manager.used('b')).toBe(1);
    expect(manager.release(['older-and'], 6).map((grant) => grant.requestId)).toEqual(['younger-a']);
  });

  test('OR multi-pool sigue fallando antes de mutar hasta LILA-035', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    expect(() => manager.enqueue({
      id: 'or', enabledAt: 0, selection: 'or',
      requirements: [{ poolId: 'a', quantity: 1 }, { poolId: 'b', quantity: 1 }],
    }, 0)).toThrow(/E-REC-OR-PENDIENTE/);
    expect(manager.liveRequestCount).toBe(0);
  });

  test('100 000 AND comparten clase, mantienen orden y no reescanean toda Q', () => {
    const manager = new ResourceManager({ a: { capacity: 1 }, b: { capacity: 1 } });
    const requirements = [{ poolId: 'a', quantity: 1 }, { poolId: 'b', quantity: 1 }] as const;
    manager.enqueue({ id: 'holder', enabledAt: 0, requirements }, 0);
    for (let i = 0; i < 100_000; i++) {
      manager.enqueue({ id: `q-${i}`, enabledAt: i + 1, requirements }, i + 1);
    }
    let active = 'holder';
    for (let i = 0; i < 100_000; i++) {
      const grants = manager.release([active], 100_001 + i);
      expect(grants[0]?.requestId).toBe(`q-${i}`);
      active = `q-${i}`;
    }
    manager.release([active], 200_002);
    expect(manager.liveRequestCount).toBe(0);
    expect(manager.headInspections).toBeLessThan(700_000);
  }, 15_000);

  test('cada manager empieza con capacidad y secuencia vacías', () => {
    const first = new ResourceManager({ worker: { capacity: 1 } });
    const second = new ResourceManager({ worker: { capacity: 1 } });
    first.enqueue(request('one', 0), 0);

    expect(second.used('worker')).toBe(0);
    expect(second.enqueue(request('two', 0), 0)).toMatchObject([{ requestId: 'two', seq: 0 }]);
  });

  test.each([
    ['pool desconocido', () => new ResourceManager({}).enqueue(request('x', 0), 0), /E-REC-DESCONOCIDO/],
    ['capacity inválida', () => new ResourceManager({ worker: { capacity: 0 } }), /E-REC-CAPACIDAD/],
    [
      'quantity mayor que capacity',
      () => new ResourceManager({ worker: { capacity: 1 } }).enqueue(request('x', 0, 'worker', 2), 0),
      /E-REC-CANTIDAD/,
    ],
    [
      'pool duplicado',
      () =>
        new ResourceManager({ worker: { capacity: 2 } }).enqueue(
          {
            id: 'x',
            enabledAt: 0,
            requirements: [
              { poolId: 'worker', quantity: 1 },
              { poolId: 'worker', quantity: 1 },
            ],
          },
          0,
        ),
      /E-REC-DUPLICADO/,
    ],
  ])('rechaza %s', (_name, action, expected) => {
    expect(action).toThrow(expected);
  });
});
