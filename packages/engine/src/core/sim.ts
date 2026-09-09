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
 * LILA-033 añade pools simples, cantidad y FIFO; LILA-034, la adquisición AND multi-pool
 * atómica. La selección OR multi-pool sigue en fail-fast hasta LILA-035; timers y tareas sin
 * asignación conservan capacidad infinita (R-REC-10).
 *
 * Salida: un resultado intermedio (contadores por elemento y por flujo, tiempos por caso y
 * filas del event log). Las métricas formales son LILA-028 y la función pública `simulate()`
 * es LILA-029; ninguna de las dos se adelanta aquí.
 */

import {
  addWorkingTime,
  capacityAt,
  compileCalendar,
  compileCapacity,
  intersect,
  nextCapacityRise,
  nextOpen,
  openTime,
  union,
  weekOffsetSeconds,
  type Calendar,
  type CalendarDef,
  type CapacitySchedule,
} from './calendar.js';
import { sample, type Distribution } from './distributions.js';
import { Heap } from './heap.js';
import type { ProcessIR, Node } from './ir.js';
import { coded, coreMessages, type CoreCodeMessages, type Locale } from './messages/index.js';
import type { EventLogRow } from './result.js';
import {
  ResourceManager,
  type ResourceAllocation,
  type ResourcePoolDefinition,
  type ResourceRequirement,
} from './resources.js';
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
  /** Calendario propio del elemento (llegadas, timer o tarea); se intersecta con el de sus pools. */
  calendar?: string | undefined;
}

/** Un tramo de `resources[pool].capacity` por intervalos: `capacity` unidades durante `calendar`. */
export interface SimCapacityInterval {
  readonly calendar: string;
  readonly capacity: number;
}

export interface SimResource {
  /**
   * Entero ≥ 1, o la lista de tramos `{ calendar, capacity }` de R-CAL-11 (LILA-164): 3 enfermeras
   * de día y 1 de noche es **un** pool con dos tramos, no dos pools. Excluyente con `calendar`.
   */
  capacity: number | readonly SimCapacityInterval[];
  type?: 'role' | 'equipment' | undefined;
  fixedCost?: number | undefined;
  costPerHour?: number | undefined;
  /** Clave de `calendars`; ausente ⇒ `default` si existe, y si no 24×7 (R-CAL-10). */
  calendar?: string | undefined;
}

/** Forma interna única de la capacidad de un pool (R-CAL-11): siempre una lista de tramos. */
export interface CapacitySlice {
  readonly calendar: string | undefined;
  readonly capacity: number;
}

/**
 * Los tramos de capacidad de un pool. Es el **único** camino por el que `core/` lee `capacity`:
 * la forma numérica es el tramo único `{ calendar: pool.calendar, capacity }`, así que ni el
 * planificador ni las métricas distinguen las dos formas del contrato.
 */
export function capacitySlices(pool: SimResource): readonly CapacitySlice[] {
  return typeof pool.capacity === 'number'
    ? [{ calendar: pool.calendar, capacity: pool.capacity }]
    : pool.capacity;
}

/**
 * Tope de capacidad del pool en toda la semana: el bound contra el que se valida `quantity`
 * (R-REC-2). Con capacidad por intervalos es el máximo de la función escalonada, que **no**
 * depende del `offset` y por eso se puede calcular sin `run.start`. Si un calendario citado no
 * existe o no compila, degrada a la suma declarada: ese caso ya lo reporta `E-CAL-DESCONOCIDO`
 * (o `E-REF-DESCONOCIDA` en el lint) y no toca inventar un segundo error encima.
 */
export function poolCapacityBound(
  pool: SimResource,
  calendars: Readonly<Record<string, CalendarDef>> = {},
): number {
  if (typeof pool.capacity === 'number') return pool.capacity;
  const slices = pool.capacity;
  try {
    return compileCapacity(
      slices.map((slice) => {
        const def = calendars[slice.calendar];
        return { calendar: def === undefined ? undefined : compileCalendar(def, 0), capacity: slice.capacity };
      }),
      0,
    ).max;
  } catch {
    return slices.reduce((total, slice) => total + slice.capacity, 0);
  }
}

/** Subconjunto de `run` que consume el motor. `warmup` y `replications` son LILA-027. */
export interface SimRun {
  /**
   * `run.start` en ISO 8601. Único uso en `core/`: situar el patrón semanal de los calendarios
   * dentro de la semana (R-CAL-1). Sin calendarios no se lee nunca.
   */
  start?: string | undefined;
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
  calendars?: Record<string, CalendarDef> | undefined;
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
  /**
   * Idioma de los avisos y de los errores del preflight (LILA-211). Viaja como cadena para que
   * `SimulateOptions` siga siendo serializable y pueda cruzar el Web Worker por `postMessage`;
   * se resuelve **una sola vez** al entrar, nunca dentro del bucle de eventos.
   */
  locale?: Locale | undefined;
}

/**
 * Preflight de recursos que debe ocurrir antes de cualquier callback público: una asignación
 * imposible (capacity inválida, `ref` colgante, pool repetido o `quantity > capacity`) nunca
 * puede emitir filas ni progreso antes de fallar, y el mensaje cita el `id` BPMN de la tarea,
 * no el id interno de la instancia (R-REC-2, R-DURA-4). `validateScenario` reporta los mismos
 * códigos fuera de `core/`; este guard los repite porque `core/` no importa el validador zod.
 * Se exporta solo desde el módulo interno para que `simulate` y `runReplication` compartan
 * exactamente el mismo guard; no forma parte del barrel de `@lila/engine`.
 */
export function assertSupportedResourceScenario(scenario: SimScenario, locale: Locale = 'en'): void {
  const M = coreMessages(locale).codes;
  const pools = scenario.resources ?? {};
  const bounds = new Map<string, number>();
  for (const [poolId, pool] of Object.entries(pools)) {
    // R-CAL-11: `capacity` por intervalos y `calendar` del pool son excluyentes; el calendario del
    // pool ya está en cada tramo y declarar los dos deja sin definir cuál manda.
    if (typeof pool.capacity !== 'number' && pool.calendar !== undefined) {
      throw new RangeError(
        coded('E-CAPACIDAD-Y-CALENDARIO', M['E-CAPACIDAD-Y-CALENDARIO'](poolId)),
      );
    }
    if (typeof pool.capacity !== 'number' && pool.capacity.length === 0) {
      throw new RangeError(coded('E-REC-CAPACIDAD', M['E-REC-CAPACIDAD/sin-tramos'](poolId)));
    }
    for (const slice of capacitySlices(pool)) {
      if (!Number.isInteger(slice.capacity) || slice.capacity < 1) {
        throw new RangeError(coded('E-REC-CAPACIDAD', M['E-REC-CAPACIDAD/entero'](poolId)));
      }
    }
    bounds.set(poolId, poolCapacityBound(pool, scenario.calendars ?? {}));
  }
  for (const [elementId, element] of Object.entries(scenario.elements ?? {})) {
    const uses = element.resources ?? [];
    const seen = new Set<string>();
    for (const use of uses) {
      const pool = pools[use.ref];
      if (pool === undefined) {
        throw new Error(coded('E-REC-DESCONOCIDO', M['E-REC-DESCONOCIDO/en-elemento'](elementId, use.ref)));
      }
      if (seen.has(use.ref)) {
        throw new Error(coded('E-REC-DUPLICADO', M['E-REC-DUPLICADO/pool'](elementId, use.ref)));
      }
      seen.add(use.ref);
      const quantity = use.quantity ?? 1;
      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new RangeError(coded('E-REC-CANTIDAD', M['E-REC-CANTIDAD/entero'](elementId, use.ref)));
      }
      // R-CAL-11: con capacidad variable el tope es el máximo de la semana; una `quantity` mayor
      // no cabe nunca, en ningún turno.
      const bound = bounds.get(use.ref)!;
      if (quantity > bound) {
        throw new RangeError(
          coded('E-REC-CANTIDAD', M['E-REC-CANTIDAD/excede'](elementId, quantity, bound, use.ref)),
        );
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Calendarios (§12, LILA-041)
 * ------------------------------------------------------------------ */

/**
 * Compila `scenario.calendars` una vez. Sin `calendars` el mapa queda **vacío** y todo el motor
 * toma literalmente el camino de M2: `undefined` es 24×7 y no se llama a ninguna primitiva de
 * calendario, que es lo que hace posible la igualdad bit a bit de R-DEG-2.
 */
export function compileCalendars(
  scenario: SimScenario,
  locale: Locale = 'en',
): Map<string, Calendar> {
  const compiled = new Map<string, Calendar>();
  const defs = Object.entries(scenario.calendars ?? {});
  if (defs.length === 0) return compiled;
  // R-CAL-1: el patrón semanal se ancla en `run.start`. Sin `start` (solo ocurre en pruebas de
  // `core/`, el esquema lo exige) el instante 0 es lunes 00:00, el offset neutro.
  const offset = scenario.run.start === undefined ? 0 : weekOffsetSeconds(scenario.run.start);
  for (const [name, def] of defs) {
    if (def.intervals.length === 0) {
      throw new RangeError(
        coded('E-CAL-VACIO', coreMessages(locale).codes['E-CAL-VACIO/sin-intervalos'](name)),
      );
    }
    compiled.set(name, compileCalendar(def, offset, locale));
  }
  return compiled;
}

/**
 * R-CAL-10: el pool usa su `calendar`; si no lo declara, el llamado `default`; si no, 24×7.
 *
 * R-CAL-11: con capacidad por intervalos el pool está abierto cuando lo está **cualquiera** de
 * sus tramos, así que su calendario es la **unión** de los de los tramos (los tres turnos que
 * cubren las 24 h dan un 24×7, sin `offHoursWait`). Un tramo cuyo calendario no existe abre
 * siempre y por tanto absorbe la unión entera; ese escenario ya es error por R9.
 */
export function poolCalendar(
  calendars: ReadonlyMap<string, Calendar>,
  pool: SimResource | undefined,
): Calendar | undefined {
  if (calendars.size === 0 || pool === undefined) return undefined;
  let result: Calendar | undefined;
  for (const slice of capacitySlices(pool)) {
    const calendar = calendars.get(slice.calendar ?? 'default');
    if (calendar === undefined) return undefined;
    result = result === undefined ? calendar : union(result, calendar);
  }
  return result;
}

/**
 * Calendario efectivo de una actividad (R-CAL-4): intersección de los calendarios de los pools
 * que ocupa —todos en AND, el elegido en OR— con el de `elements[id].calendar`. `undefined` es
 * 24×7. Una intersección vacía es `E-CAL-VACIO` citando el elemento.
 *
 * A diferencia de los pools, un elemento **no** hereda el calendario `default`: R-CAL-10 habla de
 * la matriz recurso × calendario, y R-EVT-3 exige que un timer corra 24×7 salvo calendario propio.
 */
export function activityCalendar(
  scenario: SimScenario,
  calendars: ReadonlyMap<string, Calendar>,
  elementId: string,
  poolIds: readonly string[],
  locale: Locale = 'en',
): Calendar | undefined {
  if (calendars.size === 0) return undefined;
  const own = scenario.elements?.[elementId]?.calendar;
  let result = own === undefined ? undefined : calendars.get(own);
  for (const poolId of poolIds) {
    const pool = poolCalendar(calendars, scenario.resources?.[poolId]);
    if (pool === undefined) continue;
    if (result === undefined) {
      result = pool;
      continue;
    }
    try {
      result = intersect(result, pool);
    } catch {
      throw new RangeError(
        coded('E-CAL-VACIO', coreMessages(locale).codes['E-CAL-VACIO/interseccion'](elementId)),
      );
    }
  }
  return result;
}

/**
 * Preflight de calendarios, hermano de `assertSupportedResourceScenario` y con el mismo contrato:
 * ocurre **antes de cualquier callback público** (R-CAL-4, R-CAL-10). Devuelve el mapa compilado
 * para que `runReplication` no lo compile dos veces.
 *
 * `validateScenario` reporta `E-REF-DESCONOCIDA` para lo mismo (R9 de SCENARIO_FORMAT), pero
 * `core/` no importa el validador zod y tiene que defenderse solo.
 */
export function assertSupportedCalendarScenario(
  scenario: SimScenario,
  locale: Locale = 'en',
): Map<string, Calendar> {
  const M = coreMessages(locale).codes;
  const calendars = compileCalendars(scenario, locale);

  for (const [poolId, pool] of Object.entries(scenario.resources ?? {})) {
    // R-CAL-11: se comprueban los calendarios de todos los tramos, que en la forma numérica es
    // exactamente el `calendar` del pool.
    for (const slice of capacitySlices(pool)) {
      if (slice.calendar !== undefined && !calendars.has(slice.calendar)) {
        throw new Error(
          coded('E-CAL-DESCONOCIDO', M['E-CAL-DESCONOCIDO'](`resources.${poolId}`, slice.calendar)),
        );
      }
    }
  }
  for (const [elementId, element] of Object.entries(scenario.elements ?? {})) {
    if (element.calendar !== undefined && !calendars.has(element.calendar)) {
      throw new Error(
        coded('E-CAL-DESCONOCIDO', M['E-CAL-DESCONOCIDO'](elementId, element.calendar)),
      );
    }
  }
  if (calendars.size === 0) return calendars;

  for (const [elementId, element] of Object.entries(scenario.elements ?? {})) {
    const uses = element.resources ?? [];
    // R-CAL-4: en OR cada alternativa se comprueba por separado (una tarea puede arrancar por
    // cualquiera de ellas); en AND y sin recursos, la única combinación posible.
    if (element.selection === 'or') {
      for (const use of uses) activityCalendar(scenario, calendars, elementId, [use.ref], locale);
    } else {
      activityCalendar(scenario, calendars, elementId, uses.map((use) => use.ref), locale);
    }
  }
  return calendars;
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
    }
  /** R-CAL-11: la capacidad del pool acaba de subir; hay que despertar su cola. */
  | { readonly t: number; readonly kind: 'capacity'; readonly poolId: string };

interface ActivityState {
  readonly id: string;
  readonly caseId: number;
  readonly nodeId: string;
  readonly marks: readonly number[];
  readonly enabledAt: number;
  readonly duration: number;
  readonly requirements: readonly ResourceRequirement[];
  /** Calendario efectivo (R-CAL-4); `undefined` es 24×7. Se afina al conceder los recursos. */
  calendar: Calendar | undefined;
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
/** Sin pools: el calendario de la actividad es solo el del elemento (R-CAL-4). */
const NO_POOLS: readonly string[] = [];

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
  // El catálogo se resuelve aquí y se pasa a los helpers: nada de esto ocurre en el camino
  // caliente del bucle de eventos (LILA-211).
  const locale = options.locale;
  const M: CoreCodeMessages = coreMessages(locale).codes;
  const chrome = coreMessages(locale).chrome;
  // Función (en vez de acceso inline) porque los callbacks pueden activar la señal entre checks.
  const isAborted = (): boolean => options.signal?.aborted === true;
  // R-ARR-3: sin `run.duration` la corrida termina cuando se vacía el heap. Que no haya ni
  // `duration` ni ningún `triggerCount` es `E-SIN-PARADA`, y lo caza `validateScenario`.
  const tStop = scenario.run.duration ?? Infinity;
  const seed = scenario.run.seed ?? 1;
  const warmup = scenario.run.warmup ?? 0;

  // La API core no depende del validador zod; comparte el preflight de recursos con `simulate`.
  assertSupportedResourceScenario(scenario, locale);
  // R-CAL-4 / R-CAL-10: compilado una sola vez por replicación. Vacío ⇒ 24×7 en todas partes.
  const calendars = assertSupportedCalendarScenario(scenario, locale);

  // Cache por `(nodeId, pools)`: una tarea AND con los mismos dos pools intersecta una vez, no
  // una vez por instancia. Con el mapa vacío ni siquiera se construye la clave.
  // Sin calendarios ni siquiera se llama a `calendarFor`: el camino caliente de M2 no gana un
  // solo `map` ni una sola llamada (R-DEG-2, y el benchmark de LILA-031 no se mueve).
  const hasCalendars = calendars.size > 0;
  const calendarCache = new Map<string, Calendar | undefined>();
  const calendarFor = (nodeId: string, poolIds: readonly string[]): Calendar | undefined => {
    const key = poolIds.length === 0 ? nodeId : `${nodeId}\u0000${poolIds.join('\u0000')}`;
    if (calendarCache.has(key)) return calendarCache.get(key);
    const calendar = activityCalendar(scenario, calendars, nodeId, poolIds, locale);
    calendarCache.set(key, calendar);
    return calendar;
  };

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

  // R-DEG-3 (LILA-198): un escenario que no declara **ni un** `processingTime` —validación de
  // rutas, como el nivel 1 de Bizagi— sacaba un `W-TAREA-SIN-TIEMPO` por tarea en cada corrida:
  // ruido por diseño, no un olvido. Ahí el aviso es uno solo y lista los ids. Si el escenario
  // declara algún tiempo, cada tarea sin el suyo sigue avisando por separado: eso sí es un olvido.
  const noDeclaraTiempos = Object.values(spec).every((element) => element.processingTime === undefined);
  const tareasSinTiempo = noDeclaraTiempos
    ? Object.keys(ir.nodes).filter((nodeId) => ir.nodes[nodeId]!.type === 'task')
    : [];
  if (tareasSinTiempo.length > 0) {
    warn(coded('W-TAREA-SIN-TIEMPO', M['W-TAREA-SIN-TIEMPO/ninguno'](tareasSinTiempo.join(', '))));
  }

  const flows: Record<string, number> = {};
  for (const flowId of Object.keys(ir.flows)) flows[flowId] = 0;
  const elements: Record<string, ElementCounters> = {};
  for (const nodeId of Object.keys(ir.nodes)) elements[nodeId] = { started: 0, completed: 0 };

  const rows: EventLogRow[] = [];
  const caseStates: CaseState[] = [];
  const heap = new Heap<SimEvent>();
  const resources = scenario.resources ?? {};
  // R-CAL-11: la capacidad de un pool es una función escalonada de la semana. Con `capacity`
  // numérica (o sin calendarios) esa función es constante y **no** se pasa `capacityAt`: el
  // planificador toma literalmente el camino de M2, sin una sola llamada extra (R-DEG-2).
  const capacityOffset = scenario.run.start === undefined ? 0 : weekOffsetSeconds(scenario.run.start);
  const capacitySchedules = new Map<string, CapacitySchedule>();
  const poolDefinitions: Record<string, ResourcePoolDefinition> = {};
  for (const [poolId, pool] of Object.entries(resources)) {
    const schedule = hasCalendars
      ? compileCapacity(
          capacitySlices(pool).map((slice) => ({
            calendar: calendars.get(slice.calendar ?? 'default'),
            capacity: slice.capacity,
          })),
          capacityOffset,
          locale,
        )
      : undefined;
    if (schedule === undefined || schedule.constant !== undefined) {
      poolDefinitions[poolId] = { capacity: schedule?.constant ?? poolCapacityBound(pool, scenario.calendars ?? {}) };
      continue;
    }
    capacitySchedules.set(poolId, schedule);
    poolDefinitions[poolId] = { capacity: schedule.max, capacityAt: (t) => capacityAt(schedule, t) };
  }
  const resourceManager = new ResourceManager(poolDefinitions, locale);
  const activities = new Map<string, ActivityState>();
  let nextActivityInstanceId = 1;

  /**
   * R-CAL-11: los eventos de subida de capacidad se agendan **solo cuando hay alguien esperando**
   * en ese pool, y a lo sumo uno vivo por pool. Agendarlos de oficio dejaría el heap lleno para
   * siempre y una corrida sin `run.duration` (que para al vaciarse el heap, R-ARR-3) no
   * terminaría nunca.
   */
  const pendingCapacity = new Set<string>();
  // ponytail: el barrido es O(actividades vivas) por evento de capacidad. Medido (LILA-204, con un
  // contador temporal sobre esta función): con llegadas repartidas en el tiempo cuesta ≤ 2,5 % de
  // la corrida (0,0–4,4 ms de 28–382 ms en 10–50 pools con turnos y 2000–5000 casos); solo con
  // 5000 casos inyectados a la vez —cola permanente de miles— sube al 25–29 % (64 ms de 254 y
  // 191 ms de 668). Techo: modelos saturados con muchos pools de capacidad variable. Siguiente
  // paso si aparece uno real: un contador de esperas por pool mantenido en el alta, la concesión
  // y el cierre de la actividad, en vez de recorrer el mapa.
  const waitsOnPool = (poolId: string): boolean => {
    for (const activity of activities.values()) {
      if (activity.closed || activity.allocation !== undefined) continue;
      for (const requirement of activity.requirements) if (requirement.poolId === poolId) return true;
    }
    return false;
  };
  const scheduleCapacityRise = (poolId: string, from: number): void => {
    const schedule = capacitySchedules.get(poolId);
    if (schedule === undefined || pendingCapacity.has(poolId)) return;
    const at = nextCapacityRise(schedule, from);
    if (at >= tStop) return;
    pendingCapacity.add(poolId);
    heap.push({ t: at, kind: 'capacity', poolId });
  };

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
      // R-CAL-4: el calendario de la tarea sale de los pools **efectivamente** concedidos, así
      // que una OR toma el del pool elegido. R-CAL-6: la unidad se reserva desde el instante de
      // concesión (`allocation.startedAt`) aunque el trabajo no empiece hasta la apertura.
      //
      // ponytail: reservar desde la concesión es lo que impide que dos tokens arranquen a la vez
      // al abrir, y tiene un techo conocido: si la tarea mezcla un pool 24×7 con uno de horario
      // reducido, el pool 24×7 queda retenido toda la noche sin acumular `busyTime`, así que otra
      // tarea que solo lo necesita a él espera hasta la mañana. Bizagi no documenta qué hace aquí;
      // se corrige cuando LILA-044 compare contra su nivel 4, no antes.
      const calendar = hasCalendars
        ? calendarFor(activity.nodeId, allocation.assignments.map((assignment) => assignment.poolId))
        : undefined;
      activity.calendar = calendar;
      const startedAt = calendar === undefined ? allocation.startedAt : nextOpen(calendar, allocation.startedAt);
      activity.startedAt = startedAt;
      heap.push({
        t: calendar === undefined ? startedAt + activity.duration : addWorkingTime(calendar, startedAt, activity.duration),
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
      // Una concesión que cae en tiempo cerrado fija `started` en la siguiente apertura, que
      // puede quedar **después** del corte de la corrida. La fila se recorta a `observedUntil`
      // para que nunca informe un arranque posterior al fin de la observación; sin calendarios
      // la concesión ya es el arranque y el recorte no toca nada (R-DEG-2).
      const startedAt = activity.startedAt === null ? null : Math.min(activity.startedAt, observedUntil);
      const endedAt = status === 'completed' ? observedUntil : null;
      const calendar = activity.calendar;
      // R-CAL-6: durante el cierre la unidad sigue reservada pero no acumula ocupación ni costo.
      const occupied = startedAt === null
        ? 0
        : calendar === undefined
          ? Math.max(0, observedUntil - startedAt)
          : openTime(calendar, startedAt, observedUntil);
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
        // R-REC-8 y R-CAL-7: la espera se parte en abierta (falta de recurso) y cerrada. Sin
        // calendario las dos expresiones son literalmente las de M2 (R-DEG-2).
        resourceWait: calendar === undefined
          ? (startedAt === null ? Math.max(0, observedUntil - activity.enabledAt) : startedAt - activity.enabledAt)
          : openTime(calendar, activity.enabledAt, startedAt ?? observedUntil),
        offHoursWait: calendar === undefined
          ? 0
          : Math.max(0, observedUntil - activity.enabledAt - openTime(calendar, activity.enabledAt, observedUntil)),
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
        coded(
          'W-XOR-RESIDUO-COMPARTIDO',
          M['W-XOR-RESIDUO-COMPARTIDO'](
            gatewayId,
            outs.filter((_, i) => declared[i] === undefined).join(', '),
          ),
        ),
      );
    }
    const weights = declared.map((p) => p ?? share);
    const total = weights.reduce<number>((acc, w) => acc + w, 0);
    // R-XOR-4: si la suma no es 1 se normaliza, con aviso. R-XOR-5: suma 0 es
    // `E-XOR-SUMA-CERO` (lo caza la validación); aquí no se normaliza para no producir NaN y
    // el sorteo cae en el descarte de R-XOR-7.
    if (total > 0 && Math.abs(total - 1) > 1e-9) {
      warn(coded('W-XOR-NORMALIZADA', M['W-XOR-NORMALIZADA'](gatewayId, total)));
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
      warn(coded('W-OR-SIN-PROBABILIDAD', M['W-OR-SIN-PROBABILIDAD'](gatewayId)));
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
    warn(coded('W-OR-VACIO', M['W-OR-VACIO'](gatewayId)));
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

  /** R-ARR-1: `triggerCount` sin `interTriggerTimer` = N llegadas en `t = 0`. */
  const ARRIVALS_AT_ZERO: Distribution = { type: 'constant', value: 0 };

  /**
   * Cadencia efectiva del start (R-ARR-1). Un `triggerCount` sin `interTriggerTimer` significa
   * N llegadas instantáneas en `t = 0`: es el nivel 1 de Bizagi, que solo pide "Max. arrival
   * count" y los porcentajes de los gateways, sin ningún campo de tiempo con el que espaciarlas
   * (help.bizagi.com/platform/en/level_1_example.htm). `undefined` = el start no genera nada.
   */
  const arrivalTimer = (nodeId: string): Distribution | undefined => {
    const element = spec[nodeId];
    if (element?.interTriggerTimer !== undefined) return element.interTriggerTimer;
    return element?.triggerCount === undefined ? undefined : ARRIVALS_AT_ZERO;
  };

  // Se recorre `ir.nodes` en orden de documento; solo fija el `seq` de las llegadas de t = 0
  // cuando hay varios starts, nunca una decisión (R-DET-1).
  for (const [nodeId, node] of Object.entries(ir.nodes)) {
    if (node.type !== 'start') continue;
    if (arrivalTimer(nodeId) === undefined) {
      warn(coded('W-START-SIN-LLEGADAS', M['W-START-SIN-LLEGADAS'](nodeId)));
      continue;
    }
    emitted.set(nodeId, 0);
    // R-ARR-1 / R-ARR-6: la primera llegada ocurre en t = 0, desplazada a la siguiente apertura
    // si el start declara calendario. El corte contra `tStop` se aplica al valor ya desplazado.
    const calendar = hasCalendars ? calendarFor(nodeId, NO_POOLS) : undefined;
    const first = calendar === undefined ? 0 : nextOpen(calendar, 0);
    if (first < tStop) heap.push({ t: first, kind: 'arrive', startId: nodeId });
  }

  // R-AND-1: `probability` en las salidas de un AND no se usa.
  for (const [nodeId, node] of Object.entries(ir.nodes)) {
    if (node.type !== 'and') continue;
    for (const flowId of node.outgoing) {
      if (spec[flowId]?.probability !== undefined) {
        warn(coded('W-PROB-IGNORADA', M['W-PROB-IGNORADA'](flowId, nodeId)));
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
    // R-ARR-3 / R-CAL-11: una subida de capacidad a la que ya no espera nadie —porque la cola se
    // drenó antes con una liberación— no es un evento del modelo. Consumirla sin adelantar el
    // reloj evita que una corrida sin `run.duration` se alargue hasta esa subida y que
    // `stoppedAt` —y con él la ventana de todas las métricas— dependa del horario del pool.
    if (next.kind === 'capacity' && !waitsOnPool(next.poolId)) {
      pendingCapacity.delete(next.poolId);
      continue;
    }
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
      const interTrigger = arrivalTimer(next.startId);
      if (interTrigger !== undefined && count < (element?.triggerCount ?? Infinity)) {
        // La cadencia se mide en tiempo de reloj y **después** se desplaza a la apertura
        // (R-ARR-6): el muestreo consume el mismo uniforme haya calendario o no (R-DET-3).
        const sampled = next.t + Math.max(0, sample(interTrigger, rngFor(next.startId)));
        const calendar = hasCalendars ? calendarFor(next.startId, NO_POOLS) : undefined;
        const at = calendar === undefined ? sampled : nextOpen(calendar, sampled);
        if (at < tStop) heap.push({ t: at, kind: 'arrive', startId: next.startId });
      }
      continue;
    }

    if (next.kind === 'capacity') {
      // R-CAL-11: la capacidad acaba de subir; se reevalúa la cola del pool. Una bajada no genera
      // evento: las tareas en curso no se interrumpen y `used` puede quedar por encima de la
      // capacidad hasta que terminen.
      pendingCapacity.delete(next.poolId);
      startAllocations(resourceManager.refresh([next.poolId], next.t));
      if (waitsOnPool(next.poolId)) scheduleCapacityRise(next.poolId, next.t);
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
          if (node.type === 'timer') {
            warn(coded('W-TIMER-SIN-TIEMPO', M['W-TIMER-SIN-TIEMPO'](next.nodeId)));
          } else if (tareasSinTiempo.length === 0) {
            warn(coded('W-TAREA-SIN-TIEMPO', M['W-TAREA-SIN-TIEMPO/elemento'](next.nodeId)));
          }
        }
        const duration = dist === undefined ? 0 : Math.max(0, sample(dist, rngFor(next.nodeId)));
        const declaredResources = node.type === 'task' ? (spec[next.nodeId]?.resources ?? []) : [];
        // R-REC-4 / R-REC-6: los requisitos conservan el orden declarado en el escenario. La
        // adquisición AND es atómica en `ResourceManager` (no hay retención parcial que deshacer)
        // y la selección OR concede una sola alternativa, la primera declarada que esté libre.
        const requirements: ResourceRequirement[] = declaredResources.map((use) => ({
          poolId: use.ref,
          quantity: use.quantity ?? 1,
        }));
        // R-CAL-4: mientras la tarea espera no se sabe qué pool la atenderá, así que una OR
        // arrastra solo el calendario del elemento; `startAllocations` lo afina al conceder. En
        // AND y sin recursos la combinación ya es definitiva.
        const calendar = hasCalendars
          ? calendarFor(
              next.nodeId,
              spec[next.nodeId]?.selection === 'or' ? NO_POOLS : requirements.map((requirement) => requirement.poolId),
            )
          : undefined;
        // R-CAL-5 / R-EVT-3: sin recursos (y en un timer) el trabajo arranca en la apertura.
        const startedAt = requirements.length > 0
          ? null
          : calendar === undefined
            ? next.t
            : nextOpen(calendar, next.t);
        const activity: ActivityState = {
          id: String(nextActivityInstanceId++),
          caseId: next.caseId,
          nodeId: next.nodeId,
          marks: next.marks,
          enabledAt: next.t,
          duration,
          requirements,
          calendar,
          startedAt,
          closed: false,
        };
        activities.set(activity.id, activity);
        state.activityIds.add(activity.id);
        if (requirements.length === 0) {
          heap.push({
            t: calendar === undefined ? next.t + duration : addWorkingTime(calendar, startedAt!, duration),
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
          // R-CAL-11: si se quedó en cola, hay que despertarla cuando suba la capacidad de alguno
          // de sus pools; sin capacidad variable no agenda nada.
          if (activity.allocation === undefined) {
            for (const requirement of requirements) scheduleCapacityRise(requirement.poolId, next.t);
          }
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
            warn(coded('W-OR-JOIN-SIN-FORK', M['W-OR-JOIN-SIN-FORK'](next.nodeId)));
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
      warn(coded('W-JOIN-BLOQUEADO', M['W-JOIN-BLOQUEADO'](nodeId, affected)));
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
    warnings: [...warningCounts].map(([message, count]) =>
      count > 1 ? chrome.repeated(message, count) : message,
    ),
    ...(cancelled ? { cancelled: true as const } : {}),
  };
}
