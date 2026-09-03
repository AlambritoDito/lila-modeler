import { describe, expect, test } from 'vitest';
import { Heap } from '../../src/core/heap.js';

interface Ev {
  readonly t: number;
  readonly label: string;
}

describe('Heap', () => {
  test('pop en cola vacía devuelve undefined', () => {
    const heap = new Heap<Ev>();
    expect(heap.pop()).toBeUndefined();
    expect(heap.size).toBe(0);
  });

  test('eventos con el mismo t salen en orden de inserción (FIFO estable)', () => {
    const heap = new Heap<Ev>();
    heap.push({ t: 5, label: 'a' });
    heap.push({ t: 5, label: 'b' });
    heap.push({ t: 5, label: 'c' });

    expect(heap.pop()?.label).toBe('a');
    expect(heap.pop()?.label).toBe('b');
    expect(heap.pop()?.label).toBe('c');
    expect(heap.pop()).toBeUndefined();
  });

  test('ordena por t con desempate FIFO entre t iguales entremezclados', () => {
    const heap = new Heap<Ev>();
    heap.push({ t: 3, label: 'c1' });
    heap.push({ t: 1, label: 'a1' });
    heap.push({ t: 2, label: 'b1' });
    heap.push({ t: 1, label: 'a2' });
    heap.push({ t: 3, label: 'c2' });
    heap.push({ t: 2, label: 'b2' });
    heap.push({ t: 1, label: 'a3' });

    const order = [];
    let ev;
    while ((ev = heap.pop()) !== undefined) order.push(ev.label);

    expect(order).toEqual(['a1', 'a2', 'a3', 'b1', 'b2', 'c1', 'c2']);
  });

  test('peek no saca el elemento', () => {
    const heap = new Heap<Ev>();
    heap.push({ t: 10, label: 'x' });
    expect(heap.peek()?.label).toBe('x');
    expect(heap.size).toBe(1);
    expect(heap.pop()?.label).toBe('x');
  });

  test('size refleja push/pop', () => {
    const heap = new Heap<Ev>();
    expect(heap.size).toBe(0);
    heap.push({ t: 1, label: 'a' });
    heap.push({ t: 2, label: 'b' });
    expect(heap.size).toBe(2);
    heap.pop();
    expect(heap.size).toBe(1);
  });

  test('funciona con t no enteros y negativos', () => {
    const heap = new Heap<Ev>();
    heap.push({ t: -1.5, label: 'neg' });
    heap.push({ t: 0, label: 'zero' });
    heap.push({ t: 0.001, label: 'small' });
    expect(heap.pop()?.label).toBe('neg');
    expect(heap.pop()?.label).toBe('zero');
    expect(heap.pop()?.label).toBe('small');
  });

  // Aceptación LILA-023: 1 000 000 de push/pop. El objetivo local es < 300 ms
  // (medido en esta máquina de desarrollo); el umbral del test es más
  // holgado (1 s) para no ser inestable en runners de CI más lentos o
  // compartidos. Ver PR para la cifra medida localmente.
  test('1 000 000 de push/pop en menos de 1 s (margen de CI; objetivo local 300 ms)', () => {
    const n = 1_000_000;
    const heap = new Heap<Ev>();

    const start = performance.now();
    for (let i = 0; i < n; i++) {
      heap.push({ t: Math.floor(i / 3), label: String(i) });
    }
    let count = 0;
    while (heap.pop() !== undefined) count++;
    const elapsedMs = performance.now() - start;

    expect(count).toBe(n);
    expect(elapsedMs).toBeLessThan(1000);
  });
});
