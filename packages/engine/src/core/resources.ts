/**
 * Gestor determinista de pools (LILA-033).
 *
 * Mantiene FIFO global por `(enabledAt, seq)` dentro de cada pool. El estado vive en la instancia:
 * cada replicación crea un manager nuevo y no comparte capacidad, cola ni contadores.
 */

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
  /** Reservado para LILA-034/035; con una asignación ambos valores son equivalentes. */
  readonly selection?: 'and' | 'or' | undefined;
}

export interface ResourceAllocation {
  readonly requestId: string;
  readonly enabledAt: number;
  readonly startedAt: number;
  readonly seq: number;
  readonly assignments: readonly ResourceRequirement[];
}

interface PoolState {
  readonly capacity: number;
  used: number;
  readonly waiters: Heap<QueuedRequest>;
}

interface QueuedRequest {
  /** `Heap` ordena primero por este instante y luego por inserción estable. */
  readonly t: number;
  readonly seq: number;
  readonly request: ResourceRequest;
}

type RequestState =
  | { status: 'queued'; queued: QueuedRequest }
  | { status: 'active'; allocation: ResourceAllocation };

function assertPositiveInteger(value: number, message: string): void {
  if (!Number.isInteger(value) || value < 1) throw new RangeError(message);
}

/** API pura de I/O y aislada por replicación para capacidad y FIFO global. */
export class ResourceManager {
  readonly #pools = new Map<string, PoolState>();
  readonly #requests = new Map<string, RequestState>();
  #nextSeq = 0;
  #headInspections = 0;

  constructor(definitions: Readonly<Record<string, ResourcePoolDefinition>>) {
    for (const [poolId, definition] of Object.entries(definitions)) {
      assertPositiveInteger(
        definition.capacity,
        `E-REC-CAPACIDAD: ${poolId}: capacity debe ser un entero mayor o igual que 1.`,
      );
      this.#pools.set(poolId, { capacity: definition.capacity, used: 0, waiters: new Heap() });
    }
  }

  /** Encola y devuelve todas las solicitudes que pueden arrancar en `at`. */
  enqueue(request: ResourceRequest, at = request.enabledAt): ResourceAllocation[] {
    if (this.#requests.has(request.id)) {
      throw new Error(`E-REC-SOLICITUD-DUPLICADA: ya existe la solicitud ${request.id}.`);
    }
    if (request.requirements.length === 0) {
      throw new Error(`E-REC-SIN-ASIGNACION: ${request.id}: falta un pool.`);
    }

    const seen = new Set<string>();
    for (const requirement of request.requirements) {
      if (seen.has(requirement.poolId)) {
        throw new Error(`E-REC-DUPLICADO: ${request.id}: el pool ${requirement.poolId} aparece más de una vez.`);
      }
      seen.add(requirement.poolId);
      const pool = this.#pools.get(requirement.poolId);
      if (pool === undefined) {
        throw new Error(`E-REC-DESCONOCIDO: ${request.id}: el pool ${requirement.poolId} no existe.`);
      }
      assertPositiveInteger(
        requirement.quantity,
        `E-REC-CANTIDAD: ${request.id}: quantity de ${requirement.poolId} debe ser un entero mayor o igual que 1.`,
      );
      if (requirement.quantity > pool.capacity) {
        throw new RangeError(
          `E-REC-CANTIDAD: ${request.id}: quantity ${requirement.quantity} excede capacity ${pool.capacity} de ${requirement.poolId}.`,
        );
      }
    }
    if (request.requirements.length !== 1) {
      throw new Error(`E-REC-MULTIPOOL-PENDIENTE: ${request.id}: LILA-034/035 implementan AND/OR multi-pool.`);
    }

    const queued: QueuedRequest = {
      t: request.enabledAt,
      seq: this.#nextSeq++,
      request,
    };
    this.#requests.set(request.id, { status: 'queued', queued });
    this.#pools.get(request.requirements[0]!.poolId)!.waiters.push(queued);
    return this.#drainPool(request.requirements[0]!.poolId, at);
  }

  /** Libera solicitudes activas en bloque y planifica una sola vez al final. */
  release(requestIds: readonly string[], at: number): ResourceAllocation[] {
    const uniqueIds = [...new Set(requestIds)];
    // La validación completa precede toda mutación: un id inválido no puede dejar una
    // liberación parcial que abra capacidad de forma accidental.
    for (const requestId of uniqueIds) {
      const state = this.#requests.get(requestId);
      if (state?.status !== 'active') {
        throw new Error(`E-REC-LIBERACION: ${requestId} no tiene una asignación activa.`);
      }
    }
    const releasedPools = new Set<string>();
    for (const requestId of uniqueIds) {
      const state = this.#requests.get(requestId)!;
      if (state.status !== 'active') throw new Error('E-REC-ESTADO: estado cambió durante release.');
      this.#free(state.allocation);
      for (const assignment of state.allocation.assignments) releasedPools.add(assignment.poolId);
      this.#requests.delete(requestId);
    }
    return this.#drainPools(releasedPools, at);
  }

  /**
   * Retira solicitudes de un caso al ejecutar `terminate` o cortar la corrida. Las activas se
   * liberan juntas antes de conceder otras, y las encoladas se descartan perezosamente del heap.
   */
  cancel(requestIds: readonly string[], at: number): ResourceAllocation[] {
    const touchedPools = new Set<string>();
    for (const requestId of new Set(requestIds)) {
      const state = this.#requests.get(requestId);
      if (state === undefined) continue;
      if (state.status === 'active') {
        this.#free(state.allocation);
        for (const assignment of state.allocation.assignments) touchedPools.add(assignment.poolId);
      } else {
        touchedPools.add(state.queued.request.requirements[0]!.poolId);
      }
      this.#requests.delete(requestId);
    }
    return this.#drainPools(touchedPools, at);
  }

  used(poolId: string): number {
    const pool = this.#pools.get(poolId);
    if (pool === undefined) throw new Error(`E-REC-DESCONOCIDO: el pool ${poolId} no existe.`);
    return pool.used;
  }

  /** Instrumentación determinista para probar que una cola bloqueada no se reescanea. */
  get headInspections(): number {
    return this.#headInspections;
  }

  /** Solicitudes vivas; no incluye tombstones del heap y debe volver a cero tras liberar. */
  get liveRequestCount(): number {
    return this.#requests.size;
  }

  #free(allocation: ResourceAllocation): void {
    for (const assignment of allocation.assignments) {
      const pool = this.#pools.get(assignment.poolId)!;
      pool.used -= assignment.quantity;
      if (pool.used < 0) throw new Error(`E-REC-ESTADO: uso negativo en ${assignment.poolId}.`);
    }
  }

  #drainPools(poolIds: ReadonlySet<string>, at: number): ResourceAllocation[] {
    const granted: ResourceAllocation[] = [];
    for (const poolId of poolIds) granted.push(...this.#drainPool(poolId, at));
    return granted.sort((left, right) => left.enabledAt - right.enabledAt || left.seq - right.seq);
  }

  #drainPool(poolId: string, at: number): ResourceAllocation[] {
    const granted: ResourceAllocation[] = [];
    const pool = this.#pools.get(poolId)!;

    for (;;) {
      const queued = pool.waiters.peek();
      if (queued === undefined) break;
      this.#headInspections++;
      const state = this.#requests.get(queued.request.id);
      if (state?.status !== 'queued') {
        pool.waiters.pop(); // tombstone de cancelación
        continue;
      }

      const assignment = queued.request.requirements[0]!;
      // FIFO estricto: si el head todavía no está habilitado o no cabe, ningún sucesor del
      // mismo pool puede adelantarlo. Así cada enqueue inspecciona O(1) heads, no toda Q.
      if (queued.t > at || pool.capacity - pool.used < assignment.quantity) break;
      pool.waiters.pop();

      pool.used += assignment.quantity;
      const allocation: ResourceAllocation = {
        requestId: queued.request.id,
        enabledAt: queued.request.enabledAt,
        startedAt: at,
        seq: queued.seq,
        assignments: queued.request.requirements,
      };
      this.#requests.set(queued.request.id, { status: 'active', allocation });
      granted.push(allocation);
    }
    return granted;
  }
}
