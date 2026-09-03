/**
 * Cola de prioridad binaria ordenada por `(t, seq)` (ADR-017, R-TOK-3 en
 * `docs/SEMANTICS.md`). `seq` es un contador monótono asignado en `push`, así
 * que dos elementos con el mismo `t` salen en orden de inserción (FIFO
 * estable): es la única fuente de desempate, nunca el orden de un `Map` ni
 * ids alfabéticos.
 *
 * `core/` no importa nada fuera de sí mismo.
 */

/** Cualquier valor con un instante de tiempo virtual, en segundos. */
export interface Timed {
  readonly t: number;
}

interface Entry<T> {
  readonly t: number;
  readonly seq: number;
  readonly value: T;
}

export class Heap<T extends Timed> {
  #entries: Entry<T>[] = [];
  #nextSeq = 0;

  get size(): number {
    return this.#entries.length;
  }

  push(value: T): void {
    const entries = this.#entries;
    entries.push({ t: value.t, seq: this.#nextSeq++, value });
    this.#siftUp(entries.length - 1);
  }

  pop(): T | undefined {
    const entries = this.#entries;
    const top = entries[0];
    if (top === undefined) return undefined;
    const last = entries.pop();
    if (entries.length > 0 && last !== undefined) {
      entries[0] = last;
      this.#siftDown(0);
    }
    return top.value;
  }

  peek(): T | undefined {
    return this.#entries[0]?.value;
  }

  #before(a: Entry<T>, b: Entry<T>): boolean {
    return a.t !== b.t ? a.t < b.t : a.seq < b.seq;
  }

  #swap(i: number, j: number): void {
    const entries = this.#entries;
    const tmp = entries[i]!;
    entries[i] = entries[j]!;
    entries[j] = tmp;
  }

  #siftUp(start: number): void {
    const entries = this.#entries;
    let i = start;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.#before(entries[i]!, entries[parent]!)) break;
      this.#swap(i, parent);
      i = parent;
    }
  }

  #siftDown(start: number): void {
    const entries = this.#entries;
    const n = entries.length;
    let i = start;
    for (;;) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.#before(entries[left]!, entries[smallest]!)) smallest = left;
      if (right < n && this.#before(entries[right]!, entries[smallest]!)) smallest = right;
      if (smallest === i) break;
      this.#swap(i, smallest);
      i = smallest;
    }
  }
}
