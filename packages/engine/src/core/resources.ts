/** Gestor determinista de pools, FIFO, adquisición AND atómica y selección OR (LILA-033/034/035). */

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
  /** Lo que concede esta entrada: todos los requisitos (AND) o una alternativa (OR). */
  readonly requirements: readonly ResourceRequirement[];
  /** Índice declarado en el escenario; desempata alternativas OR libres a la vez (R-REC-6). */
  readonly altIndex: number;
}

interface RequestClass {
  readonly waiters: Heap<QueuedRequest>;
  version: number;
}

interface PoolState {
  readonly capacity: number;
  used: number;
  readonly classes: Set<string>;
}

type RequestState =
  | { status: 'queued'; seq: number; classKeys: readonly string[] }
  | { status: 'active'; allocation: ResourceAllocation };

interface ReadyHead {
  readonly enabledAt: number;
  readonly seq: number;
  readonly altIndex: number;
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

  /**
   * `(enabledAt, seq)` ya es un orden total entre solicitudes distintas; `altIndex` solo desempata
   * las alternativas OR de una misma solicitud, que comparten `seq` a propósito (R-REC-6).
   */
  static #before(left: ReadyHead, right: ReadyHead): boolean {
    if (left.enabledAt !== right.enabledAt) return left.enabledAt < right.enabledAt;
    if (left.seq !== right.seq) return left.seq < right.seq;
    return left.altIndex < right.altIndex;
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
    // Un solo `seq` para todas las entradas: una OR ocupa la misma posición FIFO en cada pool.
    const seq = this.#nextSeq++;
    const classKeys: string[] = [];
    for (const entry of this.#entriesOf(request)) {
      let requestClass = this.#classes.get(entry.classKey);
      if (requestClass === undefined) {
        requestClass = { waiters: new Heap(), version: 0 };
        this.#classes.set(entry.classKey, requestClass);
        for (const requirement of entry.requirements) this.#pools.get(requirement.poolId)!.classes.add(entry.classKey);
      }
      requestClass.waiters.push({ t: request.enabledAt, seq, request, ...entry });
      classKeys.push(entry.classKey);
    }
    this.#requests.set(request.id, { status: 'queued', seq, classKeys });
    return this.#drain(new Set(classKeys), at);
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
        for (const classKey of state.classKeys) dirty.add(classKey);
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

  /** Entradas todavía en cola, lápidas incluidas: sirve para probar que OR no deja fugas. */
  get queuedEntryCount(): number {
    let total = 0;
    for (const requestClass of this.#classes.values()) total += requestClass.waiters.size;
    return total;
  }

  #validate(request: ResourceRequest): void {
    if (this.#requests.has(request.id)) throw new Error(`E-REC-SOLICITUD-DUPLICADA: ya existe la solicitud ${request.id}.`);
    if (request.requirements.length === 0) throw new Error(`E-REC-SIN-ASIGNACION: ${request.id}: falta un pool.`);
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

  /**
   * Firma de clase (ADR-026). Single-pool ignora `quantity` para conservar FIFO estricto por pool;
   * la firma AND se ordena por `(poolId, quantity)` para que dos tareas que declaran los mismos
   * pools en distinto orden compartan una única cola y no dupliquen clases equivalentes.
   */
  #classKey(requirements: readonly ResourceRequirement[]): string {
    if (requirements.length === 1) return `single:${JSON.stringify(requirements[0]!.poolId)}`;
    const signature = requirements
      .map((requirement) => [requirement.poolId, requirement.quantity] as const)
      .sort((left, right) => (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : left[1] - right[1]));
    return `and:${JSON.stringify(signature)}`;
  }

  /**
   * R-REC-6: una OR multi-pool se encola en **todas** sus alternativas. Cada alternativa es una
   * solicitud single-pool más en la cola de ese pool, así que OR, AND y single conviven en el
   * mismo FIFO. La primera entrada que se concede deja a las demás como lápidas: `#head` las
   * descarta al llegar a la cabeza, y conceder marca dirty las clases retiradas para que su nueva
   * cabeza se reevalúe en el acto.
   * // ponytail: la retirada es perezosa, como el resto de ADR-026. Techo: una alternativa que
   * // nunca vuelve a ser cabeza retiene su entrada hasta el final de la replicación (O(1) por
   * // alternativa). Camino de mejora: borrado posicional en `Heap`, si alguna vez pesa.
   */
  #entriesOf(request: ResourceRequest): readonly Omit<QueuedRequest, 't' | 'seq' | 'request'>[] {
    if (request.selection === 'or' && request.requirements.length > 1) {
      return request.requirements.map((requirement, altIndex) => ({
        classKey: this.#classKey([requirement]),
        requirements: [requirement],
        altIndex,
      }));
    }
    return [{ classKey: this.#classKey(request.requirements), requirements: request.requirements, altIndex: 0 }];
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

  /**
   * Descarta lápidas hasta dar con una cabeza viva. El `seq` desempata además el caso en que un
   * id se reencola tras liberarse: las entradas OR retiradas de otras colas llevan el `seq`
   * anterior y no pueden hacerse pasar por la nueva solicitud.
   */
  #head(requestClass: RequestClass): QueuedRequest | undefined {
    for (;;) {
      const head = requestClass.waiters.peek();
      if (head === undefined) return undefined;
      this.#headInspections++;
      const state = this.#requests.get(head.request.id);
      if (state?.status === 'queued' && state.seq === head.seq) return head;
      requestClass.waiters.pop();
    }
  }

  #satisfiable(requirements: readonly ResourceRequirement[]): boolean {
    for (const requirement of requirements) {
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
    if (head === undefined || head.t > at || !this.#satisfiable(head.requirements)) return;
    this.#ready.push({ enabledAt: head.t, seq: head.seq, altIndex: head.altIndex, classKey, requestId: head.request.id, version });
  }

  #drain(initialDirty: Set<string>, at: number): ResourceAllocation[] {
    for (const classKey of initialDirty) this.#evaluate(classKey, at);
    const granted: ResourceAllocation[] = [];
    while (this.#ready.size > 0) {
      const ready = this.#ready.pop()!;
      const requestClass = this.#classes.get(ready.classKey);
      if (requestClass === undefined || requestClass.version !== ready.version) continue;
      const head = this.#head(requestClass);
      if (head === undefined || head.request.id !== ready.requestId || head.t > at || !this.#satisfiable(head.requirements)) continue;

      requestClass.waiters.pop();
      for (const requirement of head.requirements) this.#pools.get(requirement.poolId)!.used += requirement.quantity;
      const allocation: ResourceAllocation = {
        requestId: head.request.id,
        enabledAt: head.request.enabledAt,
        startedAt: at,
        seq: head.seq,
        assignments: head.requirements,
      };
      const withdrawn = this.#requests.get(head.request.id);
      this.#requests.set(head.request.id, { status: 'active', allocation });
      granted.push(allocation);

      // Las alternativas OR que se retiran dejan una lápida en su cola: reevaluarlas aquí es lo
      // que impide que la cabeza que queda detrás se quede esperando a un evento del pool.
      const dirty = new Set<string>(withdrawn?.status === 'queued' ? withdrawn.classKeys : []);
      this.#markPoolsDirty(allocation.assignments, dirty);
      for (const classKey of dirty) this.#evaluate(classKey, at);
    }
    return granted;
  }
}
