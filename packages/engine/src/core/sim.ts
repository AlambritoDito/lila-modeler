/**
 * Bucle DES v1 (LILA-026): llegadas, tokens, gateways, timers y parada.
 *
 * Implementa `docs/SEMANTICS.md` regla por regla; cada decisión no obvia cita el id de la
 * regla (`R-ARR-n`, `R-TOK-n`, `R-XOR-n`, `R-OR-n`, `R-AND-n`, `R-EVT-n`, `R-DET-n`).
 *
 * Este archivo es `core/`: no importa nada fuera de `core/` (ni zod, ni bpmn-moddle, ni
 * `node:*`, ni React). Todo el azar sale de `stream(...)`; nunca `Math.random`, `Date` ni
 * `performance.now` (R-DET-5). Todos los tiempos son segundos desde `run.start`, que vale 0
 * (R-DURA-1, R-TOK-1). El `id` BPMN es la única clave (R-DURA-4).
 *
 * LILA-033 añade pools simples, cantidad y FIFO. Las selecciones multi-pool AND/OR se mantienen
 * fuera de este módulo hasta LILA-034/035; timers y tareas sin asignación conservan capacidad
 * infinita (R-REC-10).
 *
 * Salida: un resultado intermedio (contadores por elemento y por flujo, tiempos por caso y
 * filas del event log). Las métricas formales son LILA-028 y la función pública `simulate()`
 * es LILA-029; ninguna de las dos se adelanta aquí.
 */

import { sample, type Distribution } from './distributions.js';
import { Heap } from './heap.js';
import type { ProcessIR, Node } from './ir.js';
import type { EventLogRow } from './result.js';
import { ResourceManager, type ResourceAllocation, type ResourceRequirement } from './resources.js';
import { stream, type Rng } from './rng.js';

/* ------------------------------------------------------------------ *
 * Entrada
 * ------------------------------------------------------------------ */

/**
 * Subconjunto de `elements[id]` que consume el motor. Se declara aquí, y no se importa de
 * `src/scenario.ts`, porque ese módulo depende de zod y `core/` no importa nada fuera de
 * `core/`. Un `ResolvedScenario` encaja estructuralmente.
 */
export interface SimElement {
  processingTime?: Distribution | undefined;
  interTriggerTimer?: Distribution | undefined;
  triggerCount?: number | undefined;
  probability?: number | undefined;
  fixedCost?: number | undefined;
  resources?: readonly { readonly ref: string; readonly quantity?: number | undefined }[] | undefined;
  selection?: 'and' | 'or' | undefined;
}

export interface SimResource {
  capacity: number;
  type?: 'role' | 'equipment' | undefined;
  fixedCost?: number | undefined;
  costPerHour?: number | undefined;
}

/** Subconjunto de `run` que consume el motor. `warmup` y `replications` son LILA-027. */
export interface SimRun {
  duration?: number | undefined;
  seed?: number | undefined;
  /** Segundos iniciales excluidos de todas las estadísticas (R-ARR-7). */
  warmup?: number | undefined;
  /** Número de corridas independientes; `runReplication` ejecuta una sola (R-ARR-8). */
  replications?: number | undefined;
}

/** Escenario visto por el motor. */
export interface SimScenario {
  run: SimRun;
  resources?: Record<string, SimResource> | undefined;
  elements?: Record<string, SimElement> | undefined;
}

/* ------------------------------------------------------------------ *
 * Salida
 * ------------------------------------------------------------------ */

/** Tokens que entraron y que salieron de un elemento (LILA-028 agrega desde aquí). */
export interface ElementCounters {
  started: number;
  completed: number;
}

/** Un caso: instante de llegada e instante en que se quedó sin tokens. */
export interface CaseRecord {
  caseId: number;
  /** Id del `start` que lo generó (R-PERF-5: hay un generador por start). */
  startId: string;
  startedAt: number;
  /** `null` = seguía en vuelo al parar la corrida: cuenta en `started`, no en `completed` (R-ARR-5). */
  endedAt: number | null;
}

/** Resultado intermedio de una replicación. */
export interface ReplicationRun {
  replication: number;
  /** Instante en que paró la corrida: `run.duration` o el vaciado del heap (R-ARR-3). */
  stoppedAt: number;
  /** Segundos que pueden alimentar estadísticas: `max(0, stoppedAt - warmup)` (R-ARR-7). */
  statisticsDuration: number;
  /**
   * Casos incluidos en estadísticas (inicio >= warmup), en orden de llegada. `caseId`
   * conserva el id real del log y por eso puede empezar después de 1 (R-ARR-7, R-TOK-2).
   */
  cases: CaseRecord[];
  /** Una fila por instancia de `task` o `timer` completada (R-TOK-5). */
  rows: EventLogRow[];
  /** Tokens que recorrieron cada sequence flow (R-TOK-4). Todo flujo del IR aparece. */
  flows: Record<string, number>;
  /** Todo nodo del IR aparece, aunque su conteo sea cero. */
  elements: Record<string, ElementCounters>;
  warnings: string[];
  /** Presente solo cuando la señal detuvo cooperativamente esta replicación. */
  cancelled?: true;
}

/** Subconjunto estructural de AbortSignal; mantiene `core/` utilizable sin DOM ni Node. */
export interface AbortSignalLike {
  readonly aborted: boolean;
}

/** Hooks internos que `simulate` conecta con su API pública. */
export interface ReplicationOptions {
  signal?: AbortSignalLike | undefined;
  onEvent?: ((row: EventLogRow) => void) | undefined;
  onStep?: ((simulatedTime: number) => void) | undefined;
  /** `false` suprime el stream externo; las filas internas siguen alimentando métricas. */
  log?: boolean | undefined;
}

/**
 * Preflight de capacidades de M2 que debe ocurrir antes de cualquier callback público.
 * Se exporta solo desde el módulo interno para que `simulate` y `runReplication` compartan
 * exactamente el mismo guard; no forma parte del barrel de `@lila/engine`.
 */
export function assertSupportedResourceScenario(scenario: SimScenario): void {
  for (const [elementId, element] of Object.entries(scenario.elements ?? {})) {
    if ((element.resources?.length ?? 0) > 1) {
      throw new Error(`E-REC-MULTIPOOL-PENDIENTE: ${elementId}: múltiples pools requieren LILA-034/035.`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Eventos del scheduler
 * ------------------------------------------------------------------ */

/**
 * `arrive` nace un caso; `enter` es un token que llega a un nodo; `done` es el final de la
 * duración de una `task` o un `timer`. El tránsito por flujos y el paso por gateways consumen
 * 0 segundos (R-TOK-4), así que también viajan por el heap: con `t` igual, el orden lo fija
 * `seq` (R-TOK-3) y no hay ningún otro criterio de desempate.
 */
type SimEvent =
  | { readonly t: number; readonly kind: 'arrive'; readonly startId: string }
  | {
      readonly t: number;
      readonly kind: 'enter';
      readonly caseId: number;
      readonly nodeId: string;
      readonly marks: readonly number[];
    }
  | {
      readonly t: number;
      readonly kind: 'done';
      readonly activityInstanceId: string;
      readonly caseId: number;
      readonly nodeId: string;
    };

interface ActivityState {
  readonly id: string;
  readonly caseId: number;
  readonly nodeId: string;
  readonly marks: readonly number[];
  readonly enabledAt: number;
  readonly duration: number;
  readonly requirements: readonly ResourceRequirement[];
  requestId?: string;
  allocation?: ResourceAllocation;
  startedAt: number | null;
  closed: boolean;
}

/** Estado vivo de un caso mientras corre. */
interface CaseState {
  readonly id: number;
  readonly startId: string;
  readonly startedAt: number;
  /** Tokens vivos; los que esperan en un join siguen contando (R-EVT-4). */
  tokens: number;
  endedAt: number | null;
  /** `false` tras un `terminate`: sus eventos futuros se descartan al salir del heap (R-EVT-5). */
  alive: boolean;
  /** Contador del AND join por `joinId` (R-AND-2). */
  andCounts: Map<string, number>;
  /** Contador del OR join por `"joinId#activationId"` (R-OR-5, R-OR-7). */
  orCounts: Map<string, number>;
  /** Instancias abiertas para que terminate libere/cierre recursos del caso. */
  activityIds: Set<string>;
}

const NO_MARKS: readonly number[] = [];

/* ------------------------------------------------------------------ *
 * Bucle
 * ------------------------------------------------------------------ */

/**
 * Corre una replicación completa. Determinista: dos llamadas con la misma entrada devuelven
 * el mismo resultado (R-DURA-6, R-DET-6).
 *
 * No valida: `validateIr`, `bpmn/validate.ts` y `validateScenario` ya rechazan lo que no se
 * puede simular (elementos fuera del perfil, `E-SIN-PARADA`, `E-XOR-SUMA-CERO`…).
 */
export function runReplication(
  ir: ProcessIR,
  scenario: SimScenario,
  replication = 0,
  options: ReplicationOptions = {},
): ReplicationRun {
  const spec = scenario.elements ?? {};
  // Función (en vez de acceso inline) porque los callbacks pueden activar la señal entre checks.
  const isAborted = (): boolean => options.signal?.aborted === true;
  // R-ARR-3: sin `run.duration` la corrida termina cuando se vacía el heap. Que no haya ni
  // `duration` ni ningún `triggerCount` es `E-SIN-PARADA`, y lo caza `validateScenario`.
  const tStop = scenario.run.duration ?? Infinity;
  const seed = scenario.run.seed ?? 1;
  const warmup = scenario.run.warmup ?? 0;

  // La API core no depende del validador zod. Mantiene el mismo fail-fast para que un escenario
  // multi-pool no emita callbacks ni avance tiempo antes de fallar (#34/#35).
  assertSupportedResourceScenario(scenario);

  // R-DET-2: un stream por elemento (common random numbers, R-DET-3).
  const rngs = new Map<string, Rng>();
  const rngFor = (elementId: string): Rng => {
    let rng = rngs.get(elementId);
    if (rng === undefined) {
      rng = stream(seed, replication, elementId);
      rngs.set(elementId, rng);
    }
    return rng;
  };

  // Los avisos repetidos se agregan con un contador en vez de una línea por ocurrencia (§ 17).
  const warningCounts = new Map<string, number>();
  const warn = (message: string): void => {
    warningCounts.set(message, (warningCounts.get(message) ?? 0) + 1);
  };

  const flows: Record<string, number> = {};
  for (const flowId of Object.keys(ir.flows)) flows[flowId] = 0;
  const elements: Record<string, ElementCounters> = {};
  for (const nodeId of Object.keys(ir.nodes)) elements[nodeId] = { started: 0, completed: 0 };

  const rows: EventLogRow[] = [];
  const caseStates: CaseState[] = [];
  const heap = new Heap<SimEvent>();
  const resources = scenario.resources ?? {};
  const resourceManager = new ResourceManager(resources);
  const activities = new Map<string, ActivityState>();
  let nextActivityInstanceId = 1;

  /**
   * R-ARR-7: la inclusión depende únicamente del instante en que nació el caso. El caso
   * sigue atravesando el modelo y sus tareas siguen emitiendo filas; solo se excluye de los
   * acumuladores que alimentarán las métricas. Esto también evita el error sutil de incluir
   * un caso que nació antes del warmup pero terminó después.
   */
  const isMeasuredCase = (caseId: number): boolean => (caseStates[caseId - 1]?.startedAt ?? -Infinity) >= warmup;

  /** Inicia concesiones devueltas por el manager y agenda su fin. */
  const startAllocations = (allocations: readonly ResourceAllocation[]): void => {
    for (const allocation of allocations) {
      const activity = activities.get(allocation.requestId);
      if (activity === undefined || activity.closed) continue;
      activity.allocation = allocation;
      activity.startedAt = allocation.startedAt;
      heap.push({
        t: allocation.startedAt + activity.duration,
        kind: 'done',
        activityInstanceId: activity.id,
        caseId: activity.caseId,
        nodeId: activity.nodeId,
      });
    }
  };

  /** Convierte lifecycle normal/parcial en filas planas y cierra una actividad una sola vez. */
  const closeActivity = (
    activity: ActivityState,
    observedUntil: number,
    status: EventLogRow['status'],
  ): void => {
    if (activity.closed) return;
    activity.closed = true;
    activities.delete(activity.id);
    const caseState = caseStates[activity.caseId - 1];
    caseState?.activityIds.delete(activity.id);

    const assignments = activity.requirements.length === 0 || activity.startedAt === null
      ? [{ poolId: null, quantity: null, allocationIndex: null }]
      : (activity.allocation?.assignments ?? activity.requirements).map((assignment) => ({
          ...assignment,
          allocationIndex: activity.requirements.findIndex((candidate) => candidate.poolId === assignment.poolId),
        }));
    for (let index = 0; index < assignments.length; index++) {
      const assignment = assignments[index]!;
      const startedAt = activity.startedAt;
      const endedAt = status === 'completed' ? observedUntil : null;
      const occupied = startedAt === null ? 0 : Math.max(0, observedUntil - startedAt);
      const pool = assignment.poolId === null ? undefined : resources[assignment.poolId];
      const elementCost = status === 'completed' && index === 0 ? (spec[activity.nodeId]?.fixedCost ?? 0) : 0;
      const resourceCost = startedAt === null || pool === undefined
        ? 0
        : (pool.fixedCost ?? 0) * assignment.quantity!
          + ((pool.costPerHour ?? 0) * assignment.quantity! * occupied) / 3600;
      const row: EventLogRow = {
        replication,
        caseId: String(activity.caseId),
        activityInstanceId: activity.id,
        elementId: activity.nodeId,
        resourceId: assignment.poolId,
        allocationIndex: assignment.allocationIndex,
        resourceQuantity: assignment.quantity,
        status,
        enabledAt: activity.enabledAt,
        startedAt,
        endedAt,
        observedUntil,
        resourceWait: startedAt === null ? Math.max(0, observedUntil - activity.enabledAt) : startedAt - activity.enabledAt,
        offHoursWait: 0,
        elementCost,
        resourceCost,
        cost: elementCost + resourceCost,
      };
      rows.push(row);
      if (options.log !== false) options.onEvent?.({ ...row });
    }
  };

  /* --- ramaje: pesos por gateway, calculados una vez --------------- */

  const xorCache = new Map<string, number[]>();
  const xorWeights = (gatewayId: string, outs: readonly string[]): number[] => {
    const cached = xorCache.get(gatewayId);
    if (cached !== undefined) return cached;
    const declared = outs.map((flowId) => spec[flowId]?.probability);
    const missing = declared.filter((p) => p === undefined).length;
    const declaredSum = declared.reduce<number>((acc, p) => acc + (p ?? 0), 0);
    // R-XOR-1: ninguna declarada ⇒ 1/n. R-XOR-2: |U| = 1 ⇒ ese flujo recibe el residuo (es el
    // caso del `isDefault`). R-XOR-3: |U| ≥ 2 ⇒ el residuo se reparte por igual, con aviso.
    const share = missing === outs.length ? 1 / outs.length : Math.max(0, 1 - declaredSum) / missing;
    if (missing >= 2 && missing < outs.length) {
      warn(
        `W-XOR-RESIDUO-COMPARTIDO: ${gatewayId}: el residuo se reparte entre ${outs
          .filter((_, i) => declared[i] === undefined)
          .join(', ')}.`,
      );
    }
    const weights = declared.map((p) => p ?? share);
    const total = weights.reduce<number>((acc, w) => acc + w, 0);
    // R-XOR-4: si la suma no es 1 se normaliza, con aviso. R-XOR-5: suma 0 es
    // `E-XOR-SUMA-CERO` (lo caza la validación); aquí no se normaliza para no producir NaN y
    // el sorteo cae en el descarte de R-XOR-7.
    if (total > 0 && Math.abs(total - 1) > 1e-9) {
      warn(`W-XOR-NORMALIZADA: ${gatewayId}: las probabilidades sumaban ${total}; se normalizan.`);
      for (let i = 0; i < weights.length; i++) weights[i] = weights[i]! / total;
    }
    xorCache.set(gatewayId, weights);
    return weights;
  };

  const orCache = new Map<string, number[]>();
  const orWeights = (gatewayId: string, outs: readonly string[]): number[] => {
    const cached = orCache.get(gatewayId);
    if (cached !== undefined) return cached;
    const declared = outs.map((flowId) => spec[flowId]?.probability);
    // R-OR-2: una salida sin `probability` vale 1; un OR sin ninguna se comporta como un AND fork.
    if (declared.every((p) => p === undefined)) {
      warn(`W-OR-SIN-PROBABILIDAD: ${gatewayId}: ninguna salida declara probability; todas valen 1.`);
    }
    const weights = declared.map((p) => p ?? 1);
    orCache.set(gatewayId, weights);
    return weights;
  };

  /** R-XOR-7: un uniforme del stream del gateway y probabilidad acumulada en orden de documento. */
  const drawXor = (gatewayId: string, outs: readonly string[]): string => {
    const weights = xorWeights(gatewayId, outs);
    const u = rngFor(gatewayId).next();
    let acc = 0;
    for (let i = 0; i < outs.length; i++) {
      acc += weights[i]!;
      if (u < acc) return outs[i]!;
    }
    // Descarte por error de redondeo: el último con p > 0.
    for (let i = outs.length - 1; i >= 0; i--) if (weights[i]! > 0) return outs[i]!;
    return outs[outs.length - 1]!;
  };

  /** R-OR-1: un uniforme por salida, independientes, sin normalizar. R-OR-3: al menos una. */
  const drawOr = (gatewayId: string, outs: readonly string[]): string[] => {
    const weights = orWeights(gatewayId, outs);
    const rng = rngFor(gatewayId);
    const active: string[] = [];
    for (let i = 0; i < outs.length; i++) if (rng.next() < weights[i]!) active.push(outs[i]!);
    if (active.length > 0) return active;
    warn(`W-OR-VACIO: ${gatewayId}: ningún sorteo activó una salida.`);
    let pick = outs.findIndex((flowId) => ir.flows[flowId]?.isDefault === true);
    if (pick < 0) {
      pick = 0;
      for (let i = 1; i < outs.length; i++) if (weights[i]! > weights[pick]!) pick = i;
    }
    return [outs[pick]!];
  };

  /* --- movimiento de tokens ---------------------------------------- */

  /** Recorre los flujos (0 segundos, R-TOK-4) y encola la llegada al nodo destino. */
  const emit = (flowIds: readonly string[], caseId: number, marks: readonly number[], t: number): void => {
    for (const flowId of flowIds) {
      if (isMeasuredCase(caseId)) flows[flowId] = (flows[flowId] ?? 0) + 1;
      const to = ir.flows[flowId]?.to;
      if (to !== undefined) heap.push({ t, kind: 'enter', caseId, nodeId: to, marks });
    }
  };

  /** Pass-through: reenvía por la única salida (start, XOR convergente, fin de task/timer). */
  const forward = (node: Node, caseId: number, marks: readonly number[], t: number): void => {
    const flowId = node.outgoing[0];
    if (flowId !== undefined) emit([flowId], caseId, marks, t);
  };

  /* --- generadores de llegadas (R-PERF-5) --------------------------- */

  const emitted = new Map<string, number>();
  // Se recorre `ir.nodes` en orden de documento; solo fija el `seq` de las llegadas de t = 0
  // cuando hay varios starts, nunca una decisión (R-DET-1).
  for (const [nodeId, node] of Object.entries(ir.nodes)) {
    if (node.type !== 'start') continue;
    if (spec[nodeId]?.interTriggerTimer === undefined) {
      warn(`W-START-SIN-LLEGADAS: ${nodeId}: el start no declara interTriggerTimer y no genera casos.`);
      continue;
    }
    emitted.set(nodeId, 0);
    // R-ARR-1: la primera llegada ocurre en t = 0.
    if (0 < tStop) heap.push({ t: 0, kind: 'arrive', startId: nodeId });
  }

  // R-AND-1: `probability` en las salidas de un AND no se usa.
  for (const [nodeId, node] of Object.entries(ir.nodes)) {
    if (node.type !== 'and') continue;
    for (const flowId of node.outgoing) {
      if (spec[flowId]?.probability !== undefined) {
        warn(`W-PROB-IGNORADA: ${flowId}: sale de un gateway paralelo (${nodeId}); probability se ignora.`);
      }
    }
  }

  /* --- bucle principal --------------------------------------------- */

  let nextActivationId = 1;
  /** Cuántas salidas activó cada fork OR: es la `k` que espera su join (R-OR-4). */
  const activationSize = new Map<number, number>();
  let clock = 0;
  let stoppedAt = 0;
  let cancelled = false;

  simulation: for (;;) {
    if (isAborted()) {
      cancelled = true;
      stoppedAt = clock;
      break;
    }
    const next = heap.peek();
    if (next === undefined) {
      stoppedAt = clock;
      break;
    }
    // R-ARR-5: en `t_stop` se descartan los eventos pendientes.
    if (next.t >= tStop) {
      stoppedAt = tStop;
      break;
    }
    heap.pop();
    clock = next.t;
    options.onStep?.(clock);
    if (isAborted()) {
      cancelled = true;
      stoppedAt = clock;
      break;
    }

    if (next.kind === 'arrive') {
      const caseId = caseStates.length + 1; // R-TOK-2: entero monótono en orden de llegada.
      caseStates.push({
        id: caseId,
        startId: next.startId,
        startedAt: next.t,
        tokens: 1,
        endedAt: null,
        alive: true,
        andCounts: new Map(),
        orCounts: new Map(),
        activityIds: new Set(),
      });
      heap.push({ t: next.t, kind: 'enter', caseId, nodeId: next.startId, marks: NO_MARKS });

      // R-ARR-2: el generador para al emitir `triggerCount` casos o cuando la siguiente
      // llegada cae en `t ≥ t_stop`, lo primero que ocurra.
      const count = (emitted.get(next.startId) ?? 0) + 1;
      emitted.set(next.startId, count);
      const element = spec[next.startId];
      const interTrigger = element?.interTriggerTimer;
      if (interTrigger !== undefined && count < (element?.triggerCount ?? Infinity)) {
        const at = next.t + Math.max(0, sample(interTrigger, rngFor(next.startId)));
        if (at < tStop) heap.push({ t: at, kind: 'arrive', startId: next.startId });
      }
      continue;
    }

    const state = caseStates[next.caseId - 1];
    // ponytail: cancelación perezosa de los eventos de un caso muerto por `terminate`
    // (R-EVT-5): se descartan al salir del heap en vez de buscarlos y borrarlos. Techo: el
    // heap carga eventos zombis de casos terminados. Camino de mejora: índice de eventos por
    // caso, si alguna vez `terminate` deja de ser marginal.
    if (state === undefined || !state.alive) continue;
    const node = ir.nodes[next.nodeId];
    if (node === undefined) continue;
    const counters = elements[next.nodeId]!;

    if (next.kind === 'done') {
      const activity = activities.get(next.activityInstanceId);
      if (activity === undefined || activity.closed) continue;
      if (isMeasuredCase(next.caseId)) counters.completed++;
      closeActivity(activity, next.t, 'completed');
      if (activity.requestId !== undefined) {
        startAllocations(resourceManager.release([activity.requestId], next.t));
      }
      // Completar una tarea incluye recorrer sus flujos salientes instantáneos (R-TOK-4).
      // Una cancelación activada por onEvent se observa después de cerrar esa transición
      // atómica, nunca entre el contador/row de la tarea y su forward.
      forward(node, next.caseId, activity.marks, next.t);
      if (isAborted()) {
        cancelled = true;
        stoppedAt = clock;
        break simulation;
      }
      continue;
    }

    if (isMeasuredCase(next.caseId)) counters.started++;

    switch (node.type) {
      case 'start':
        // El start no consume tiempo ni recursos: reenvía el token.
        if (isMeasuredCase(next.caseId)) counters.completed++;
        forward(node, next.caseId, next.marks, next.t);
        break;

      case 'task':
      case 'timer': {
        // R-EVT-1: timer sin recurso. R-DEG-3 / R-EVT-2: sin processingTime dura 0.
        const dist = spec[next.nodeId]?.processingTime;
        if (dist === undefined) {
          warn(
            node.type === 'timer'
              ? `W-TIMER-SIN-TIEMPO: ${next.nodeId}: sin processingTime; retarda 0 segundos.`
              : `W-TAREA-SIN-TIEMPO: ${next.nodeId}: sin processingTime; dura 0 segundos.`,
          );
        }
        const duration = dist === undefined ? 0 : Math.max(0, sample(dist, rngFor(next.nodeId)));
        const declaredResources = node.type === 'task' ? (spec[next.nodeId]?.resources ?? []) : [];
        // LILA-033 implementa exactamente un pool. Rechazar explícitamente multi-pool evita
        // simular capacidad infinita y cobrar recursos que nunca se reservaron (#34/#35).
        const requirements: ResourceRequirement[] = declaredResources.map((use) => ({
          poolId: use.ref,
          quantity: use.quantity ?? 1,
        }));
        const activity: ActivityState = {
          id: String(nextActivityInstanceId++),
          caseId: next.caseId,
          nodeId: next.nodeId,
          marks: next.marks,
          enabledAt: next.t,
          duration,
          requirements,
          startedAt: requirements.length === 0 ? next.t : null,
          closed: false,
        };
        activities.set(activity.id, activity);
        state.activityIds.add(activity.id);
        if (requirements.length === 0) {
          heap.push({
            t: next.t + duration,
            kind: 'done',
            activityInstanceId: activity.id,
            caseId: activity.caseId,
            nodeId: activity.nodeId,
          });
        } else {
          activity.requestId = activity.id;
          startAllocations(resourceManager.enqueue({
            id: activity.id,
            enabledAt: next.t,
            requirements,
            selection: spec[next.nodeId]?.selection,
          }, next.t));
        }
        break;
      }

      case 'xor':
        if (isMeasuredCase(next.caseId)) counters.completed++;
        // R-PERF-2: un XOR convergente (una sola salida) es una mezcla sin espera.
        if (node.outgoing.length <= 1) forward(node, next.caseId, next.marks, next.t);
        else emit([drawXor(next.nodeId, node.outgoing)], next.caseId, next.marks, next.t);
        break;

      case 'and': {
        if (node.incoming.length > 1) {
          // R-AND-2: contador por `(caso, join)`; el token que espera sigue vivo, así que el
          // caso no se da por terminado mientras haya joins a medias. R-AND-3: al disparar se
          // reinicia a 0, que es lo que hace correctos los bucles.
          const got = (state.andCounts.get(next.nodeId) ?? 0) + 1;
          if (got < node.incoming.length) {
            state.andCounts.set(next.nodeId, got);
            break;
          }
          state.andCounts.delete(next.nodeId);
          state.tokens -= node.incoming.length - 1;
        }
        if (isMeasuredCase(next.caseId)) counters.completed++;
        state.tokens += node.outgoing.length - 1; // R-AND-1: un token por salida, sin sorteo.
        emit(node.outgoing, next.caseId, next.marks, next.t);
        break;
      }

      case 'or': {
        let marks = next.marks;
        if (node.incoming.length > 1) {
          const activation = marks[marks.length - 1];
          if (activation === undefined) {
            // R-OR-6: sin marca activa el join es pass-through (mezcla).
            warn(`W-OR-JOIN-SIN-FORK: ${next.nodeId}: llegó un token sin marca de fork; se comporta como mezcla.`);
          } else {
            // R-OR-5: el join espera los `k` tokens que activó el fork emparejado, contando
            // por la marca más reciente. R-OR-7: la clave incluye el `activationId`, así que
            // una vuelta nueva del ciclo estrena contador.
            const key = `${next.nodeId}#${activation}`;
            const expected = activationSize.get(activation) ?? 1;
            const got = (state.orCounts.get(key) ?? 0) + 1;
            if (got < expected) {
              state.orCounts.set(key, got);
              break;
            }
            state.orCounts.delete(key);
            state.tokens -= expected - 1;
            marks = marks.slice(0, -1); // se desapila la marca (R-OR-4, LIFO).
          }
        }
        if (isMeasuredCase(next.caseId)) counters.completed++;
        if (node.outgoing.length <= 1) {
          forward(node, next.caseId, marks, next.t);
          break;
        }
        // R-OR-4: el fork registra `(caso, forkId, activationId, k)` y marca cada token emitido.
        const active = drawOr(next.nodeId, node.outgoing);
        const activationId = nextActivationId++;
        activationSize.set(activationId, active.length);
        state.tokens += active.length - 1;
        emit(active, next.caseId, [...marks, activationId], next.t);
        break;
      }

      case 'end':
        // R-EVT-4: el end consume el token; el caso termina cuando se queda sin tokens, no
        // cuando el primero toca un end.
        if (isMeasuredCase(next.caseId)) counters.completed++;
        state.tokens -= 1;
        if (state.tokens <= 0) state.endedAt = next.t;
        break;

      case 'terminate':
        // R-EVT-5: mata todos los tokens del caso, sus contadores de join y sus marcas; el
        // caso cuenta como completado en ese instante y no afecta a los demás.
        if (isMeasuredCase(next.caseId)) counters.completed++;
        state.tokens = 0;
        state.alive = false;
        state.andCounts.clear();
        state.orCounts.clear();
        state.endedAt = next.t;
        {
          const requestIds: string[] = [];
          for (const activityId of [...state.activityIds]) {
            const activity = activities.get(activityId);
            if (activity === undefined || activity.closed) continue;
            closeActivity(activity, next.t, 'terminated');
            if (activity.requestId !== undefined) requestIds.push(activity.requestId);
          }
          startAllocations(resourceManager.cancel(requestIds, next.t));
        }
        break;
    }
  }

  /* --- cierre ------------------------------------------------------- */

  // R-TOK-6: el corte conserva lifecycle de todas las tareas abiertas. Se cancelan juntas para
  // que ninguna concesión artificial ocurra mientras se está desmantelando la réplica.
  const openRequestIds: string[] = [];
  for (const activity of activities.values()) {
    if (activity.closed) continue;
    closeActivity(activity, stoppedAt, 'inFlight');
    if (activity.requestId !== undefined) openRequestIds.push(activity.requestId);
  }
  resourceManager.cancel(openRequestIds, stoppedAt);

  // R-OR-8 / R-AND-4: los tokens que quedan esperando en un join al parar cuentan como caso
  // en vuelo y avisan.
  const blocked = new Map<string, number>();
  for (const state of caseStates) {
    if (state.endedAt !== null) continue;
    const joins = new Set<string>();
    for (const [joinId, got] of state.andCounts) if (got > 0) joins.add(joinId);
    for (const key of state.orCounts.keys()) joins.add(key.slice(0, key.lastIndexOf('#')));
    for (const joinId of joins) blocked.set(joinId, (blocked.get(joinId) ?? 0) + 1);
  }
  for (const nodeId of Object.keys(ir.nodes)) {
    const affected = blocked.get(nodeId);
    if (affected !== undefined) {
      warn(`W-JOIN-BLOQUEADO: ${nodeId}: ${affected} casos quedaron con tokens esperando en el join.`);
    }
  }

  return {
    replication,
    stoppedAt,
    statisticsDuration: Math.max(0, stoppedAt - warmup),
    cases: caseStates
      .filter((state) => state.startedAt >= warmup)
      .map((state) => ({
        caseId: state.id,
        startId: state.startId,
        startedAt: state.startedAt,
        endedAt: state.endedAt,
      })),
    rows,
    flows,
    elements,
    warnings: [...warningCounts].map(([message, count]) => (count > 1 ? `${message} (${count} veces)` : message)),
    ...(cancelled ? { cancelled: true as const } : {}),
  };
}
