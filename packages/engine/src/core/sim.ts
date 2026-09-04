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
 * Alcance de M1: **capacidad infinita** (R-DEG-1). Una tarea arranca en cuanto se habilita,
 * así que `started = enabled` y `resourceWait = 0` (R-TOK-5). Colas, pools y calendarios son
 * M2/M3 y no viven aquí.
 *
 * Salida: un resultado intermedio (contadores por elemento y por flujo, tiempos por caso y
 * filas del event log). Las métricas formales son LILA-028 y la función pública `simulate()`
 * es LILA-029; ninguna de las dos se adelanta aquí.
 */

import { sample, type Distribution } from './distributions.js';
import { Heap } from './heap.js';
import type { ProcessIR, Node } from './ir.js';
import type { EventLogRow } from './result.js';
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
      readonly caseId: number;
      readonly nodeId: string;
      readonly marks: readonly number[];
      readonly enabledAt: number;
    };

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
export function runReplication(ir: ProcessIR, scenario: SimScenario, replication = 0): ReplicationRun {
  const spec = scenario.elements ?? {};
  // R-ARR-3: sin `run.duration` la corrida termina cuando se vacía el heap. Que no haya ni
  // `duration` ni ningún `triggerCount` es `E-SIN-PARADA`, y lo caza `validateScenario`.
  const tStop = scenario.run.duration ?? Infinity;
  const seed = scenario.run.seed ?? 1;
  const warmup = scenario.run.warmup ?? 0;

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

  /**
   * R-ARR-7: la inclusión depende únicamente del instante en que nació el caso. El caso
   * sigue atravesando el modelo y sus tareas siguen emitiendo filas; solo se excluye de los
   * acumuladores que alimentarán las métricas. Esto también evita el error sutil de incluir
   * un caso que nació antes del warmup pero terminó después.
   */
  const isMeasuredCase = (caseId: number): boolean => (caseStates[caseId - 1]?.startedAt ?? -Infinity) >= warmup;

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

  for (;;) {
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
      // Fin de la duración de una task o un timer. Capacidad infinita ⇒ started = enabled y
      // resourceWait = 0 (R-TOK-5, R-DEG-1). R-EVT-6: si el caso murió antes, la instancia
      // cuenta como `started` y no como `completed`, y no emite fila.
      if (isMeasuredCase(next.caseId)) counters.completed++;
      rows.push({
        replication,
        caseId: String(next.caseId),
        elementId: next.nodeId,
        resourceId: null,
        enabledAt: next.enabledAt,
        startedAt: next.enabledAt,
        endedAt: next.t,
        resourceWait: 0,
        offHoursWait: 0,
        cost: spec[next.nodeId]?.fixedCost ?? 0, // R-COST-3 sin recursos.
      });
      forward(node, next.caseId, next.marks, next.t);
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
        // R-EVT-1: el timer es un retardo sin recurso; con capacidad infinita se comporta
        // igual que una tarea. R-DEG-3 / R-EVT-2: sin `processingTime` la duración es 0.
        const dist = spec[next.nodeId]?.processingTime;
        if (dist === undefined) {
          warn(
            node.type === 'timer'
              ? `W-TIMER-SIN-TIEMPO: ${next.nodeId}: sin processingTime; retarda 0 segundos.`
              : `W-TAREA-SIN-TIEMPO: ${next.nodeId}: sin processingTime; dura 0 segundos.`,
          );
        }
        const duration = dist === undefined ? 0 : Math.max(0, sample(dist, rngFor(next.nodeId)));
        heap.push({
          t: next.t + duration,
          kind: 'done',
          caseId: next.caseId,
          nodeId: next.nodeId,
          marks: next.marks,
          enabledAt: next.t,
        });
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
        break;
    }
  }

  /* --- cierre ------------------------------------------------------- */

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
  };
}
