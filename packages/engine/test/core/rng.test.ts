import { describe, expect, test } from 'vitest';
import { createRng, stream } from '../../src/core/rng.js';

function take(rng: { next(): number }, n: number): number[] {
  const values: number[] = [];
  for (let i = 0; i < n; i++) values.push(rng.next());
  return values;
}

describe('createRng', () => {
  test('la misma semilla produce la misma secuencia de 1000 números', () => {
    const a = take(createRng(42), 1000);
    const b = take(createRng(42), 1000);
    expect(a).toEqual(b);
    expect(a.length).toBe(1000);
  });

  test('produce uniformes en [0, 1)', () => {
    for (const value of take(createRng(7), 1000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test('semillas distintas producen secuencias distintas', () => {
    const a = take(createRng(1), 50);
    const b = take(createRng(2), 50);
    expect(a).not.toEqual(b);
  });
});

describe('stream', () => {
  test('mismos (seed, replication, elementId) producen la misma secuencia de 1000 números', () => {
    const a = take(stream(1, 0, 'Task_A'), 1000);
    const b = take(stream(1, 0, 'Task_A'), 1000);
    expect(a).toEqual(b);
    expect(a.length).toBe(1000);
  });

  test('dos elementos distintos producen streams distintos', () => {
    const a = take(stream(1, 0, 'Task_A'), 1000);
    const b = take(stream(1, 0, 'Task_B'), 1000);
    expect(a).not.toEqual(b);
  });

  test('consumir del stream de A no cambia el de B (common random numbers)', () => {
    // B se genera primero y se toma una muestra de referencia sin tocar A.
    const bReference = take(stream(1, 0, 'Task_B'), 1000);

    // Ahora se consume mucho de A...
    const a = stream(1, 0, 'Task_A');
    take(a, 5000);

    // ...y se vuelve a generar B desde cero: debe coincidir con la
    // referencia tomada antes de tocar A. Añadir/consumir de A no debe
    // desplazar ni un número de B.
    const bAfter = take(stream(1, 0, 'Task_B'), 1000);
    expect(bAfter).toEqual(bReference);
  });

  test('distinta replication produce un stream distinto para el mismo elemento', () => {
    const a = take(stream(1, 0, 'Task_A'), 100);
    const b = take(stream(1, 1, 'Task_A'), 100);
    expect(a).not.toEqual(b);
  });

  test('distinta seed produce un stream distinto para el mismo elemento y replication', () => {
    const a = take(stream(1, 0, 'Task_A'), 100);
    const b = take(stream(2, 0, 'Task_A'), 100);
    expect(a).not.toEqual(b);
  });
});
