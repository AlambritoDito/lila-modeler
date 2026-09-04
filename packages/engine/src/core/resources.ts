/** Gestor determinista de pools, FIFO y adquisición AND atómica (LILA-033/034). */

import { Heap } from './heap.js';

export interface ResourcePoolDefinition {
  readonly capacity: number;
}

export interface ResourceRequirement {
  readonly poolId: string;
  readonly quantity: number;
}

export interface ResourceRequest {
  readonly id: string;
  readonly enabledAt: number;
  readonly requirements: readonly ResourceRequirement[];
  readonly selection?: 'and' | 'or' | undefined;
}

export interface ResourceAllocation {
  readonly requestId: string;
  readonly enabledAt: number;
  readonly startedAt: number;
  readonly seq: number;
  /** Conserva exactamente el orden del array del escenario. */
  readonly assignments: readonly ResourceRequirement[];
}

interface QueuedRequest {
  readonly t: number;
  readonly seq: number;
  readonly request: ResourceRequest;
  readonly classKey: string;
}

interface RequestClass {
  readonly key: string;
  readonly waiters: Heap<QueuedRequest>;
  version: number;
}

interface PoolState {
  readonly capacity: number;
  used: number;
  readonly classes: Set<string>;
}

type RequestState =
  | { status: 'queued'; queued: QueuedRequest }
  | { status: 'active'; allocation: ResourceAllocation };

interface ReadyHead {
  readonly enabledAt: number;
  readonly seq: number;
  readonly classKey: string;
  readonly requestId: string;
  readonly version: number;
}

/** Heap con comparator explícito: reinsertar una clase nunca puede alterar el `seq` original. */
class ReadyHeap {
  readonly #items: ReadyHead[] = [];

  get size(): number {
    return this.#items.length;
  }

  push(value: ReadyHead): void {
    let index = this.#items.length;
    this.#items.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!ReadyHeap.#before(value, this.#items[parent]!)) break;
      this.#items[index] = this.#items[parent]!;
      index = parent;
    }
    this.#items[index] = value;
  }

  pop(): ReadyHead | undefined {
    const root = this.#items[0];
    const tail = this.#items.pop();
    if (root === undefined || tail === undefined || this.#items.length === 0) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= this.#items.length) break;
      const right = left + 1;
      let child = left;
      if (right < this.#items.length && ReadyHeap.#before(this.#items[right]!, this.#items[left]!)) child = right;
      if (!ReadyHeap.#before(this.#items[child]!, tail)) break;
      this.#items[index] = this.#items[child]!;
      index = child;
    }
    this.#items[index] = tail;
    return root;
  }

  static #before(left: ReadyHead, right: ReadyHead): boolean {
    return left.enabledAt < right.enabledAt || (left.enabledAt === right.enabledAt && left.seq < right.seq);
  }
}

function assertPositiveInteger(value: number, message: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(message);
}

/**
 * Estado puro, aislado por replicación. Las solicitudes single-pool comparten una clase por pool
 * (FIFO estricto incluso con quantities distintos); las AND se agrupan por firma de requisitos.
 * El scheduler inspecciona cabezas de clase, nunca recorre todos los casos en espera.
 */
export class ResourceManager {
  readonly #pools = new Map<string, PoolState>();
  readonly #classes = new Map<string, RequestClass>();
  readonly #requests = new Map<string, RequestState>();
  readonly #ready = new ReadyHeap();
  #nextSeq = 0;
  #headInspections = 0;

  constructor(definitions: Readonly<Record<string, ResourcePoolDefinition>>) {
    for (const [poolId, definition] of Object.entries(definitions)) {
      assertPositiveInteger(definition.capacity, `E-REC-CAPACIDAD: ${poolId}: capacity debe ser un entero mayor o igual que 1.`);
      this.#pools.set(poolId, { capacity: definition.capacity, used: 0, classes: new Set() });
    }
  }

  enqueue(request: ResourceRequest, at = request.enabledAt): ResourceAllocation[] {
    this.#validate(request);
    const classKey = this.#classKey(request);
    let requestClass = this.#classes.get(classKey);
    if (requestClass === undefined) {
      requestClass = { key: classKey, waiters: new Heap(), version: 0 };
      this.#classes.set(classKey, requestClass);
      for (const requirement of request.requirements) this.#pools.get(requirement.poolId)!.classes.add(classKey);
    }

    const queued: QueuedRequest = { t: request.enabledAt, seq: this.#nextSeq++, request, classKey };
    this.#requests.set(request.id, { status: 'queued', queued });
    requestClass.waiters.push(queued);
    return this.#drain(new Set([classKey]), at);
  }

  /** Valida todo el lote antes de mutar; luego libera y planifica una sola vez. */
  release(requestIds: readonly string[], at: number): ResourceAllocation[] {
    const ids = [...new Set(requestIds)];
    const allocations: ResourceAllocation[] = [];
    for (const id of ids) {
      const state = this.#requests.get(id);
      if (state?.status !== 'active') throw new Error(`E-REC-LIBERACION: ${id} no tiene una asignación activa.`);
      allocations.push(state.allocation);
    }

    const dirty = new Set<string>();
    for (let i = 0; i < ids.length; i++) {
      const allocation = allocations[i]!;
      this.#free(allocation);
      this.#requests.delete(ids[i]!);
      this.#markPoolsDirty(allocation.assignments, dirty);
    }
    return this.#drain(dirty, at);
  }

  /** Cancela activos/queued en bloque; no concede hasta liberar todo el lote. */
  cancel(requestIds: readonly string[], at: number): ResourceAllocation[] {
    const dirty = new Set<string>();
    for (const id of new Set(requestIds)) {
      const state = this.#requests.get(id);
      if (state === undefined) continue;
      if (state.status === 'active') {
        this.#free(state.allocation);
        this.#markPoolsDirty(state.allocation.assignments, dirty);
      } else {
        dirty.add(state.queued.classKey);
      }
      this.#requests.delete(id);
    }
    return this.#drain(dirty, at);
  }

  used(poolId: string): number {
    const pool = this.#pools.get(poolId);
    if (pool === undefined) throw new Error(`E-REC-DESCONOCIDO: el pool ${poolId} no existe.`);
    return pool.used;
  }

  get headInspections(): number {
    return this.#headInspections;
  }

  get liveRequestCount(): number {
    return this.#requests.size;
  }

  #validate(request: ResourceRequest): void {
    if (this.#requests.has(request.id)) throw new Error(`E-REC-SOLICITUD-DUPLICADA: ya existe la solicitud ${request.id}.`);
    if (request.requirements.length === 0) throw new Error(`E-REC-SIN-ASIGNACION: ${request.id}: falta un pool.`);
    if (request.requirements.length > 1 && request.selection === 'or') {
      throw new Error(`E-REC-OR-PENDIENTE: ${request.id}: LILA-035 implementa selección OR multi-pool.`);
    }
    const seen = new Set<string>();
    for (const requirement of request.requirements) {
      if (seen.has(requirement.poolId)) throw new Error(`E-REC-DUPLICADO: ${request.id}: el pool ${requirement.poolId} aparece más de una vez.`);
      seen.add(requirement.poolId);
      const pool = this.#pools.get(requirement.poolId);
      if (pool === undefined) throw new Error(`E-REC-DESCONOCIDO: ${request.id}: el pool ${requirement.poolId} no existe.`);
      assertPositiveInteger(requirement.quantity, `E-REC-CANTIDAD: ${request.id}: quantity de ${requirement.poolId} debe ser un entero mayor o igual que 1.`);
      if (requirement.quantity > pool.capacity) {
        throw new RangeError(`E-REC-CANTIDAD: ${request.id}: quantity ${requirement.quantity} excede capacity ${pool.capacity} de ${requirement.poolId}.`);
      }
    }
  }

  #classKey(request: ResourceRequest): string {
    if (request.requirements.length === 1) return `single:${JSON.stringify(request.requirements[0]!.poolId)}`;
    return `and:${JSON.stringify(request.requirements)}`;
  }

  #free(allocation: ResourceAllocation): void {
    for (const assignment of allocation.assignments) {
      const pool = this.#pools.get(assignment.poolId)!;
      pool.used -= assignment.quantity;
      if (pool.used < 0) throw new Error(`E-REC-ESTADO: uso negativo en ${assignment.poolId}.`);
    }
  }

  #markPoolsDirty(requirements: readonly ResourceRequirement[], dirty: Set<string>): void {
    for (const requirement of requirements) {
      for (const classKey of this.#pools.get(requirement.poolId)!.classes) dirty.add(classKey);
    }
  }

  #head(requestClass: RequestClass): QueuedRequest | undefined {
    for (;;) {
      const head = requestClass.waiters.peek();
      if (head === undefined) return undefined;
      this.#headInspections++;
      if (this.#requests.get(head.request.id)?.status === 'queued') return head;
      requestClass.waiters.pop();
    }
  }

  #satisfiable(request: ResourceRequest): boolean {
    for (const requirement of request.requirements) {
      const pool = this.#pools.get(requirement.poolId)!;
      if (pool.capacity - pool.used < requirement.quantity) return false;
    }
    return true;
  }

  #evaluate(classKey: string, at: number): void {
    const requestClass = this.#classes.get(classKey);
    if (requestClass === undefined) return;
    const version = ++requestClass.version;
    const head = this.#head(requestClass);
    if (head === undefined || head.t > at || !this.#satisfiable(head.request)) return;
    this.#ready.push({ enabledAt: head.t, seq: head.seq, classKey, requestId: head.request.id, version });
  }

  #drain(initialDirty: Set<string>, at: number): ResourceAllocation[] {
    for (const classKey of initialDirty) this.#evaluate(classKey, at);
    const granted: ResourceAllocation[] = [];
    while (this.#ready.size > 0) {
      const ready = this.#ready.pop()!;
      const requestClass = this.#classes.get(ready.classKey);
      if (requestClass === undefined || requestClass.version !== ready.version) continue;
      const head = this.#head(requestClass);
      if (head === undefined || head.request.id !== ready.requestId || head.t > at || !this.#satisfiable(head.request)) continue;

      requestClass.waiters.pop();
      for (const requirement of head.request.requirements) this.#pools.get(requirement.poolId)!.used += requirement.quantity;
      const allocation: ResourceAllocation = {
        requestId: head.request.id,
        enabledAt: head.request.enabledAt,
        startedAt: at,
        seq: head.seq,
        assignments: head.request.requirements,
      };
      this.#requests.set(head.request.id, { status: 'active', allocation });
      granted.push(allocation);

      const dirty = new Set<string>();
      this.#markPoolsDirty(allocation.assignments, dirty);
      for (const classKey of dirty) this.#evaluate(classKey, at);
    }
    return granted;
  }
}
