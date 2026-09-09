/**
 * Agregación de métricas de una replicación (LILA-028, nivel 3 en LILA-036).
 *
 * Este módulo transforma la salida intermedia del DES en el contrato `RunResult`. No ejecuta
 * simulaciones ni mantiene estado global: una misma `ReplicationRun` siempre produce el mismo
 * resultado (R-DURA-6). Replicaciones e intervalos de confianza pertenecen a LILA-027.
 *
 * `core/` no importa nada fuera de `core/` (ADR-009). Todos los tiempos permanecen en segundos y
 * todos los mapas usan ids BPMN como clave (R-DURA-1, R-DURA-4).
 */

import { openTime, type Calendar } from './calendar.js';
import type { ProcessIR } from './ir.js';
import { coded, coreMessages, type Locale } from './messages/index.js';
import type {
  BottleneckEntry,
  ElementMetrics,
  EventLogRow,
  Percentiles,
  ResourceMetrics,
  RunResult,
  Stat,
  StatSd,
} from './result.js';
import {
  activityCalendar,
  capacitySlices,
  compileCalendars,
  poolCalendar,
  poolCapacityBound,
} from './sim.js';
import type { ReplicationRun, SimScenario } from './sim.js';

const EMPTY_STAT: Readonly<Stat> = { min: 0, max: 0, mean: 0, total: 0 };
const EMPTY_STAT_SD: Readonly<StatSd> = { min: 0, max: 0, mean: 0, sd: 0, total: 0 };
const EMPTY_PERCENTILES: Readonly<Percentiles> = {
  min: 0,
  max: 0,
  mean: 0,
  sd: 0,
  p50: 0,
  p90: 0,
  p95: 0,
};

/** Desviación estándar muestral; con menos de dos observaciones es cero. */
function sampleSd(values: readonly number[], mean: number): number {
  if (values.length < 2) return 0;
  let squared = 0;
  for (const value of values) squared += (value - mean) ** 2;
  return Math.sqrt(squared / (values.length - 1));
}

/** Estadísticas min/max/media/total. El conjunto vacío tiene identidad numérica cero. */
function stat(values: readonly number[]): Stat {
  if (values.length === 0) return { ...EMPTY_STAT };
  let min = values[0]!;
  let max = min;
  let total = 0;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
    total += value;
  }
  return { min, max, mean: total / values.length, total };
}

/**
 * Estadísticas con desviación estándar muestral. Las claves se escriben en el orden de la
 * interfaz `StatSd`, el mismo de `EMPTY_STAT_SD`: `JSON.stringify` de un elemento sin
 * observaciones y de uno con observaciones tiene que producir el mismo orden de claves, o los
 * goldens byte a byte de LILA-030/LILA-039 dependerían de si el elemento se ejecutó.
 */
function statSd(values: readonly number[]): StatSd {
  if (values.length === 0) return { ...EMPTY_STAT_SD };
  const base = stat(values);
  return { min: base.min, max: base.max, mean: base.mean, sd: sampleSd(values, base.mean), total: base.total };
}

/**
 * Percentil empírico con interpolación lineal sobre la muestra ordenada.
 * Posición = `(n - 1) * p`, como prescribe docs/RESULTS_FORMAT.md.
 */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const left = sorted[lower]!;
  if (lower === upper) return left;
  return left + (sorted[upper]! - left) * (position - lower);
}

/** Estadísticas de proceso con p50/p90/p95 empíricos. */
function percentiles(values: readonly number[]): Percentiles {
  if (values.length === 0) return { ...EMPTY_PERCENTILES };
  const sorted = [...values].sort((a, b) => a - b);
  const base = stat(sorted);
  return {
    min: base.min,
    max: base.max,
    mean: base.mean,
    sd: sampleSd(sorted, base.mean),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
  };
}

/** Crea las métricas neutras que deben existir para todo nodo del IR. */
function emptyElementMetrics(started: number, completed: number): ElementMetrics {
  return {
    started,
    completed,
    processing: { ...EMPTY_STAT },
    resourceWait: { ...EMPTY_STAT_SD },
    offHoursWait: { ...EMPTY_STAT_SD },
    queueLength: { mean: 0, max: 0 },
    fixedCostTotal: 0,
  };
}

const NO_POOLS: readonly string[] = [];

/** Un intervalo de espera observada `[from, to)`; `to <= from` no llega hasta aquí. */
interface Interval {
  from: number;
  to: number;
}

/**
 * Longitud de cola ponderada por tiempo (LILA-036). `mean` es la integral de la longitud
 * instantánea sobre la ventana estadística dividida entre su duración; `max` es el máximo
 * instantáneo. Los intervalos son semiabiertos `[from, to)`, así que una instancia que arranca
 * en el mismo instante en que otra sale de la cola no las cuenta juntas y una espera de
 * duración cero nunca llega a formar cola (docs/RESULTS_FORMAT.md § 2).
 */
function queueLength(intervals: readonly Interval[], windowDuration: number): { mean: number; max: number } {
  if (intervals.length === 0) return { mean: 0, max: 0 };
  // ponytail: barrido offline O(n log n) sobre los intervalos ya materializados, en vez de
  // acumular la integral durante la simulación. Techo: memoria proporcional al número de
  // instancias del elemento — el mismo orden que este módulo ya paga por `run.rows`. Camino de
  // mejora, si LILA-037 llega a corridas que no caben en memoria: acumular en el kernel DES.
  // `-1` antes que `+1` con el mismo `t`: el que sale de la cola no coexiste con el que entra.
  const events: { t: number; delta: number }[] = [];
  for (const interval of intervals) {
    events.push({ t: interval.from, delta: 1 });
    events.push({ t: interval.to, delta: -1 });
  }
  events.sort((left, right) => left.t - right.t || left.delta - right.delta);

  let integral = 0;
  let max = 0;
  let open = 0;
  let previous = events[0]!.t;
  for (const event of events) {
    if (event.t > previous) {
      integral += open * (event.t - previous);
      previous = event.t;
    }
    open += event.delta;
    if (open > max) max = open;
  }
  return { mean: windowDuration > 0 ? integral / windowDuration : 0, max };
}

/* ------------------------------------------------------------------ *
 * LILA-191 · saturación de un pool
 * ------------------------------------------------------------------ */

/**
 * Evidencia de saturación de un pool en **una** replicación, ya reducida a escalares para que
 * `simulate` pueda promediarla entre réplicas antes de decidir (LILA-191). Nada de esto entra en
 * `RunResult`: solo alimenta el aviso.
 */
export interface PoolLoad {
  /** Unidades pedidas por instancias que esperaron a este pool **estando lleno**. */
  demand: number;
  /** Unidades que el pool concedió dentro de la ventana (`usesByPool`). */
  served: number;
  /** Unidades atribuidas que seguían en cola al cortar la corrida. */
  pending: number;
  /** Capacidad media del pool **dentro de su calendario**: `disponible / horas abiertas`. */
  capacity: number;
  /** Instancias atribuidas en cola, en media sobre el tiempo que el pool estuvo lleno. */
  firstHalf: number;
  secondHalf: number;
}

/** ρ ≥ este valor: por debajo, la demanda atribuida no supera al rendimiento y no hay saturación. */
const SATURATION_RHO = 1.1;
/** La cola de la segunda mitad tiene que ser al menos esto por la de la primera para «crecer». */
const SATURATION_GROWTH = 1.5;
/** …o quedar pendiente esta fracción de lo atendido, que es el mismo hecho medido al corte. */
const SATURATION_PENDING = 0.25;

/**
 * El aviso de LILA-191, o `undefined` si el pool alcanza estado estacionario.
 *
 * La señal es «el pool estuvo **lleno** mientras había instancias esperándolo»: `load` solo
 * cuenta esperas atribuidas a pools que de verdad no tenían una unidad libre, así que un pool
 * ocioso atado por AND (R-REC-4) o una alternativa OR libre (R-REC-6) llegan aquí con `demand`
 * cero por más larga que sea la cola de la instancia. Sobre esa demanda se pide (a) ρ ≥ 1,1,
 * (b) que la cola crezca entre mitades de la ventana por encima de la capacidad, **o** que el
 * pendiente al corte sea una fracción clara de lo atendido sin que la cola haya bajado. Una cola
 * estacionaria larga no avisa: M/M/1 con ρ = 0,8 tiene `Lq = 3,2` y las dos mitades miden lo mismo.
 */
export function saturationWarning(
  poolId: string,
  load: PoolLoad,
  locale: Locale = 'en',
): string | undefined {
  if (load.served <= 0 || load.capacity <= 0) return undefined;
  const rho = load.demand / load.served;
  if (rho < SATURATION_RHO) return undefined;
  const growing = load.secondHalf > load.capacity && load.secondHalf >= SATURATION_GROWTH * load.firstHalf;
  // …y la cola no puede estar drenando: con todas las llegadas en `t = 0` (R-ARR-1) queda mucho
  // pendiente al corte mientras la cola **baja**, que es un lote despachándose, no un pool sin
  // estado estacionario.
  const backlogged = load.pending >= SATURATION_PENDING * load.served && load.secondHalf >= load.firstHalf;
  if (!growing && !backlogged) return undefined;
  return coded(
    'W-RECURSO-SATURADO',
    coreMessages(locale).codes['W-RECURSO-SATURADO'](poolId, rho.toFixed(1)),
  );
}

/** Cambio de ocupación de un pool: `+q` al conceder, `-q` al liberar. */
interface OccupancyEvent {
  t: number;
  delta: number;
}

/**
 * Tramos «lleno» de un pool con sus sumas de prefijos: `prefix[i]` es el tiempo lleno acumulado
 * antes del tramo `i`, de modo que `fullBefore` resuelve `F(t)` con una búsqueda binaria.
 */
interface FullOccupancy {
  intervals: readonly Interval[];
  prefix: readonly number[];
}

const EMPTY_FULL: FullOccupancy = { intervals: [], prefix: [0] };

/**
 * Tramos maximales en que el pool no tuvo ni una unidad **concedible** libre. Con la ocupación
 * reconstruida del propio log no hace falta contador nuevo en el kernel: `sim.ts` ya escribe
 * `startedAt`/`endedAt` y `resourceQuantity` de cada asignación.
 *
 * «Lleno» es `used > capacity − minQuantity`, no `used >= capacity`: el kernel nunca concede por
 * encima del último múltiplo de la `quantity` pedida, así que un pool de `capacity` 3 pedido de
 * dos en dos se queda en dos unidades ocupadas y una libre que nadie puede tomar. Con `quantity`
 * 1 —y `capacity` es entero (R-REC-2)— la condición es literalmente `used >= capacity`.
 *
 * // ponytail: la capacidad de referencia es el tope semanal (`poolCapacityBound`), no la del
 * // instante. Con `capacity` por tramos (LILA-164) un pool lleno durante el turno flojo no se
 * // detecta como lleno; el aviso deja de salir, nunca sale de más. Camino de mejora, si aparece
 * // un caso real: intercalar aquí los cambios de `compileCapacity`.
 */
function fullIntervals(events: OccupancyEvent[], capacity: number, minQuantity: number): FullOccupancy {
  if (capacity <= 0 || events.length === 0) return EMPTY_FULL;
  const threshold = capacity - minQuantity;
  // Las tomas antes que las liberaciones en el mismo instante: quien releva a otro no abre un
  // hueco de duración cero que partiría el tramo en dos.
  events.sort((left, right) => left.t - right.t || right.delta - left.delta);
  const intervals: Interval[] = [];
  let used = 0;
  let openedAt = Number.NaN;
  for (const event of events) {
    const wasFull = used > threshold;
    used += event.delta;
    const isFull = used > threshold;
    if (!wasFull && isFull) openedAt = event.t;
    else if (wasFull && !isFull) {
      if (event.t > openedAt) intervals.push({ from: openedAt, to: event.t });
      openedAt = Number.NaN;
    }
  }
  const prefix: number[] = new Array<number>(intervals.length + 1);
  prefix[0] = 0;
  for (let index = 0; index < intervals.length; index++) {
    prefix[index + 1] = prefix[index]! + (intervals[index]!.to - intervals[index]!.from);
  }
  return { intervals, prefix };
}

/** Índice del primer tramo que termina después de `t`; los tramos son disjuntos y crecientes. */
function firstEndingAfter(intervals: readonly Interval[], t: number): number {
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (intervals[middle]!.to <= t) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** `F(t)`: tiempo lleno acumulado antes de `t`, en O(log n) sobre las sumas de prefijos. */
function fullBefore(full: FullOccupancy, t: number): number {
  const index = firstEndingAfter(full.intervals, t);
  const interval = full.intervals[index];
  return full.prefix[index]! + (interval !== undefined && t > interval.from ? t - interval.from : 0);
}

/**
 * Solape de `[from, to)` con los tramos llenos, partido por `middle`. Cada término es una
 * diferencia `F(b) − F(a)`, así que cuesta O(log tramos) por espera y no O(tramos cruzados):
 * recorrerlos hacía el cálculo cuadrático en cuanto un pool acumulaba tramos cortos y las
 * esperas del pool saturado que lo acompaña en un AND los cruzaban enteros.
 */
function overlap(
  full: FullOccupancy,
  from: number,
  to: number,
  middle: number,
): { total: number; first: number; second: number } {
  const before = fullBefore(full, from);
  const after = fullBefore(full, to);
  // `middle` acotado a la espera: fuera de ella una de las dos mitades se lleva el solape entero.
  const split = fullBefore(full, Math.min(Math.max(middle, from), to));
  return { total: after - before, first: split - before, second: after - split };
}

/** Una espera observada de una instancia, con el tiempo **abierto** que pasó esperando recurso. */
interface WaitRecord {
  elementId: string;
  from: number;
  to: number;
  /** `row.resourceWait`: la espera sin el tiempo de calendario cerrado (RESULTS_FORMAT § 7). */
  open: number;
}

/**
 * Convierte una replicación del kernel DES en un `RunResult` completo.
 *
 * LILA-028 posee las métricas de elemento, flujo y proceso; LILA-036 añade las de nivel 3
 * (colas, recursos y cuellos de botella). La agregación entre replicaciones se hace después,
 * en `replications.ts` (LILA-027).
 *
 * Regla de lifecycle parcial, fijada por LILA-036 y documentada en `docs/RESULTS_FORMAT.md`:
 * las estadísticas **por instancia** (`processing`, `resourceWait`, `offHoursWait` y
 * `process.waitTime`) agregan solo actividades con `status = "completed"`, porque la espera de
 * una fila `terminated`/`inFlight` es una observación censurada en `observedUntil` y sesgaría la
 * media a la baja. Las **integrales de estado y los costos** (`queueLength`, `busyTime`,
 * `utilization`, costos de recurso y `process.totalCost`) sí incluyen el lifecycle parcial:
 * miden ocupación realmente observada dentro de la ventana, y R-COST-4 exige que el costo ya
 * incurrido por un caso en vuelo no desaparezca.
 *
 * `scenario` solo aporta las definiciones de pool (capacidad y costos); sin `resources` el
 * resultado conserva exactamente la forma de M1 (`resources: {}`, `bottlenecks: []`) para no
 * romper el golden de degradación (R-DEG-1, LILA-039).
 *
 * `loads` es la salida opcional de LILA-191: recibe la evidencia de saturación **sin decidir**,
 * para que `simulate` promedie entre réplicas y emita el aviso una sola vez. Sin `loads` la
 * decisión se toma aquí con las cantidades de esta réplica, que es la misma cuenta con R = 1.
 * // ponytail: parámetro de salida en vez de un campo nuevo en `RunResult`. Techo: quien llame a
 * // `aggregateReplication` a mano tiene que pasar el mapa si quiere agregar. Camino de mejora,
 * // si algún consumidor más lo necesita: publicarlo en el contrato de resultados.
 */
export function aggregateReplication(
  ir: ProcessIR,
  run: ReplicationRun,
  scenario: SimScenario = { run: {} },
  loads?: Map<string, PoolLoad>,
  locale: Locale = 'en',
): RunResult {
  // Precondición de frontera con LILA-027: el productor entrega `cases`, `elements` y `flows`
  // pertenecientes a una misma ventana estadística. Puede conservar en `rows` eventos previos al
  // warmup para el event log; filtrar por los caseId recibidos impide que contaminen el agregado.
  // En LILA-028, `runReplication` de main equivale a esa precondición con warmup = 0.
  const includedCaseIds = new Set(run.cases.map((record) => String(record.caseId)));
  const includedRows = run.rows.filter((row) => includedCaseIds.has(row.caseId));

  const processingByElement = new Map<string, number[]>();
  const resourceWaitByElement = new Map<string, number[]>();
  const offHoursWaitByElement = new Map<string, number[]>();
  const fixedCostByElement = new Map<string, number>();
  const waitByCase = new Map<string, number>();
  const costByCase = new Map<string, number>();
  const rowsByActivity = new Map<string, EventLogRow[]>();
  const queueByElement = new Map<string, Interval[]>();
  const poolsByElement = new Map<string, Set<string>>();
  const busyByPool = new Map<string, number>();
  const usesByPool = new Map<string, number>();
  // LILA-191: ocupación por pool y esperas por instancia. La atribución necesita las dos cosas
  // completas —una espera se atribuye a un pool según lo lleno que estuviera **ese** pool— así
  // que se resuelve en una segunda pasada, ya cerrada la ocupación. Sin `resources` en el
  // escenario no se acumula nada: el camino de M1/M2 no paga por esto (R-DEG-1).
  const tracksSaturation = scenario.resources !== undefined;
  const occupancyByPool = new Map<string, OccupancyEvent[]>();
  const waits: WaitRecord[] = [];

  // R-ARR-7: la ventana estadística es `[warmup, stoppedAt]`. Se deriva del propio
  // `ReplicationRun` para que la integral no dependa de que el escenario recibido aquí sea el
  // mismo con el que se corrió la replicación.
  const windowEnd = run.stoppedAt;
  const windowDuration = Math.max(0, run.statisticsDuration);
  const windowStart = windowEnd - windowDuration;

  // R-CAL-6 y R-CAL-9: los calendarios solo cambian dos cosas aquí, el tiempo **abierto** que
  // cada fila ocupó y el denominador de la utilización. Sin `calendars` el mapa queda vacío,
  // `undefined` es 24×7 y las dos expresiones son literalmente las de M2 (R-DEG-2).
  const calendars = compileCalendars(scenario);
  const hasCalendars = calendars.size > 0;

  for (const row of includedRows) {
    const activityRows = rowsByActivity.get(row.activityInstanceId) ?? [];
    activityRows.push(row);
    rowsByActivity.set(row.activityInstanceId, activityRows);

    fixedCostByElement.set(
      row.elementId,
      (fixedCostByElement.get(row.elementId) ?? 0) + row.elementCost,
    );
    costByCase.set(row.caseId, (costByCase.get(row.caseId) ?? 0) + row.cost);

  }

  // Una actividad AND tendrá varias filas: processing/esperas pertenecen a la instancia y se
  // agregan una sola vez; costos por pool sí se sumaron fila por fila arriba (ADR-025).
  for (const activityRows of rowsByActivity.values()) {
    const row = activityRows[0]!;

    // Ocupación y usos se agregan **por fila** (ADR-025): una tarea AND con dos pools ocupa los
    // dos, y una fila con `resourceId = null` (sentinel) o que nunca arrancó no ocupa nada. El
    // calendario efectivo de la actividad se reconstruye desde sus propias filas —los pools que
    // de hecho ocupó— para que sea exactamente el que usó `sim.ts` al calcular `resourceCost`,
    // y así se conserve la identidad de R-COST-4. Las filas de una actividad son contiguas en el
    // log, así que recorrerlas agrupadas suma los flotantes en el mismo orden que antes.
    const usedPools = hasCalendars
      ? activityRows.flatMap((entry) => (entry.resourceId === null ? [] : [entry.resourceId]))
      : NO_POOLS;
    let calendar: Calendar | undefined;
    for (const entry of activityRows) {
      if (entry.resourceId === null) continue;
      const pools = poolsByElement.get(entry.elementId) ?? new Set<string>();
      pools.add(entry.resourceId);
      poolsByElement.set(entry.elementId, pools);
      if (entry.startedAt === null) continue;
      if (hasCalendars && calendar === undefined) {
        calendar = activityCalendar(scenario, calendars, entry.elementId, usedPools);
      }
      const quantity = entry.resourceQuantity ?? 1;
      const occupiedFrom = Math.max(entry.startedAt, windowStart);
      const occupiedTo = Math.min(entry.endedAt ?? entry.observedUntil, windowEnd);
      const occupied = calendar === undefined
        ? Math.max(0, occupiedTo - occupiedFrom)
        : openTime(calendar, occupiedFrom, occupiedTo);
      busyByPool.set(entry.resourceId, (busyByPool.get(entry.resourceId) ?? 0) + quantity * occupied);
      usesByPool.set(entry.resourceId, (usesByPool.get(entry.resourceId) ?? 0) + quantity);
      // LILA-191: la ocupación se mide en tiempo de reloj, no en tiempo abierto: un pool que
      // conserva la unidad durante el cierre del calendario (R-CAL-8) sigue sin tenerla libre.
      if (tracksSaturation && occupiedTo > occupiedFrom) {
        const events = occupancyByPool.get(entry.resourceId) ?? [];
        events.push({ t: occupiedFrom, delta: quantity }, { t: occupiedTo, delta: -quantity });
        occupancyByPool.set(entry.resourceId, events);
      }
    }

    // La cola pertenece a la instancia, no a la fila: todas las filas de una AND comparten
    // `enabledAt`/`startedAt`. Una instancia que seguía esperando al corte sí estuvo en la cola
    // hasta `observedUntil`, así que su intervalo observado entra en la integral.
    const waitFrom = Math.max(row.enabledAt, windowStart);
    const waitTo = Math.min(row.startedAt ?? row.observedUntil, windowEnd);
    if (waitTo > waitFrom) {
      const intervals = queueByElement.get(row.elementId) ?? [];
      intervals.push({ from: waitFrom, to: waitTo });
      queueByElement.set(row.elementId, intervals);
    }
    // LILA-191: la espera se guarda entera y se reparte entre pools en la segunda pasada. Se
    // lee la declaración del elemento y no el log porque la instancia que seguía en cola al
    // cortar no asignó nada y su única fila es el sentinel `resourceId = null` (R-REC-11):
    // mirando el log desaparecería justo la evidencia de la saturación.
    if (tracksSaturation && waitTo > waitFrom && scenario.elements?.[row.elementId]?.resources !== undefined) {
      // `row.resourceWait` ya descuenta el calendario cerrado; el `min` solo lo acota a la parte
      // de la espera que cae dentro de la ventana estadística.
      waits.push({
        elementId: row.elementId,
        from: waitFrom,
        to: waitTo,
        open: Math.min(row.resourceWait, waitTo - waitFrom),
      });
    }

    if (row.status !== 'completed' || row.startedAt === null || row.endedAt === null) continue;
    // R-CAL-8: esta identidad sigue siendo correcta cuando una tarea se pausa durante el
    // cierre de calendario. En M1 las esperas valen cero y se reduce a endedAt - startedAt.
    const processing = row.endedAt - row.enabledAt - row.resourceWait - row.offHoursWait;
    const processingValues = processingByElement.get(row.elementId) ?? [];
    processingValues.push(processing);
    processingByElement.set(row.elementId, processingValues);

    const resourceWaitValues = resourceWaitByElement.get(row.elementId) ?? [];
    resourceWaitValues.push(row.resourceWait);
    resourceWaitByElement.set(row.elementId, resourceWaitValues);

    const offHoursWaitValues = offHoursWaitByElement.get(row.elementId) ?? [];
    offHoursWaitValues.push(row.offHoursWait);
    offHoursWaitByElement.set(row.elementId, offHoursWaitValues);

    waitByCase.set(row.caseId, (waitByCase.get(row.caseId) ?? 0) + row.resourceWait + row.offHoursWait);
  }

  const elements: Record<string, ElementMetrics> = {};
  for (const nodeId of Object.keys(ir.nodes)) {
    const counters = run.elements[nodeId] ?? { started: 0, completed: 0 };
    const metrics = emptyElementMetrics(counters.started, counters.completed);
    metrics.processing = stat(processingByElement.get(nodeId) ?? []);
    metrics.resourceWait = statSd(resourceWaitByElement.get(nodeId) ?? []);
    metrics.offHoursWait = statSd(offHoursWaitByElement.get(nodeId) ?? []);
    metrics.queueLength = queueLength(queueByElement.get(nodeId) ?? [], windowDuration);
    metrics.fixedCostTotal = fixedCostByElement.get(nodeId) ?? 0;
    elements[nodeId] = metrics;
  }

  // LILA-191, segunda pasada: repartir cada espera entre los pools que estuvieron llenos durante
  // la mayor parte de ella. Es lo único que distingue al pool que de verdad frena la cola de los
  // que la comparten por construcción: con AND (R-REC-4) la cola es la de la instancia y la
  // heredan todos sus pools; con OR (R-REC-6) la instancia se encola en todas las alternativas.
  const middle = windowStart + windowDuration / 2;
  const fullByPool = new Map<string, FullOccupancy>();
  const demandByPool = new Map<string, number>();
  const pendingByPool = new Map<string, number>();
  const firstHalfByPool = new Map<string, number>();
  const secondHalfByPool = new Map<string, number>();
  if (tracksSaturation) {
    // La menor `quantity` con que alguna tarea pide el pool: es lo que tiene que quedar libre
    // para que el kernel pueda conceder, y por debajo de eso el pool está lleno aunque `used`
    // no llegue a `capacity` (R-REC-2 lo acota, así que siempre hay al menos una).
    //
    // ponytail: el umbral es del **pool**, no de la petición. Si dos tareas piden el mismo pool
    // con `quantity` distinta manda la menor, así que la que pide de dos en dos puede estar
    // bloqueada (`capacity` 3, `used` 2) sin que el pool cuente como lleno: su espera no se le
    // atribuye y el aviso deja de salir, nunca sale de más. Camino de mejora, si aparece un caso
    // real: tramos «lleno» por `quantity` pedida, cuidando que el denominador de las colas
    // (`fullFirst`/`fullSecond`) siga siendo el del pool.
    const minQuantityByPool = new Map<string, number>();
    for (const element of Object.values(scenario.elements ?? {})) {
      for (const request of element.resources ?? []) {
        const quantity = request.quantity ?? 1;
        minQuantityByPool.set(request.ref, Math.min(minQuantityByPool.get(request.ref) ?? quantity, quantity));
      }
    }
    for (const [poolId, events] of occupancyByPool) {
      const pool = scenario.resources?.[poolId];
      if (pool === undefined) continue;
      const capacity = poolCapacityBound(pool, scenario.calendars ?? {});
      fullByPool.set(poolId, fullIntervals(events, capacity, minQuantityByPool.get(poolId) ?? 1));
    }
    const attributed: { ref: string; quantity: number; first: number; second: number }[] = [];
    for (const wait of waits) {
      const element = scenario.elements![wait.elementId]!;
      attributed.length = 0;
      if (wait.open > 0) {
        for (const request of element.resources!) {
          const full = fullByPool.get(request.ref);
          if (full === undefined) continue;
          const shared = overlap(full, wait.from, wait.to, middle);
          // «La mayor parte de la espera»: la mitad del tiempo abierto que la instancia pasó
          // esperando recurso. Por debajo, el pool tenía unidades libres y no es quien la frena.
          if (shared.total >= wait.open / 2) {
            attributed.push({ ref: request.ref, quantity: request.quantity ?? 1, first: shared.first, second: shared.second });
          }
        }
      }
      if (attributed.length === 0) continue;
      // Una OR consume **una** alternativa (R-REC-6): repartir su demanda entre las que estaban
      // llenas evita el ρ = 1/cuota que salía de contarla entera en cada una.
      const share = element.selection === 'or' && attributed.length > 1 ? 1 / attributed.length : 1;
      const pending = wait.to >= windowEnd;
      for (const entry of attributed) {
        const weight = entry.quantity * share;
        demandByPool.set(entry.ref, (demandByPool.get(entry.ref) ?? 0) + weight);
        if (pending) pendingByPool.set(entry.ref, (pendingByPool.get(entry.ref) ?? 0) + weight);
        firstHalfByPool.set(entry.ref, (firstHalfByPool.get(entry.ref) ?? 0) + entry.first * share);
        secondHalfByPool.set(entry.ref, (secondHalfByPool.get(entry.ref) ?? 0) + entry.second * share);
      }
    }
  }

  // R-COST-2 y R-CAL-9. Todo pool declarado aparece aunque no se haya usado, para que los mapas
  // de KPI de todas las replicaciones tengan el mismo conjunto de claves (LILA-027). Sin
  // `resources` en el escenario el mapa queda `{}`, igual que en M1 (R-DEG-1).
  const resources: Record<string, ResourceMetrics> = {};
  const warnings = [...run.warnings];
  // ponytail: el mapa se construye solo desde los pools declarados; una `ref` a un pool
  // inexistente no llega hasta aquí porque `validateScenario` la rechaza con
  // `E-REC-DESCONOCIDO`. Techo: un pool que apareciese en el log sin estar declarado quedaría
  // fuera del mapa (su ocupación sí seguiría en las filas del log).
  for (const [poolId, pool] of Object.entries(scenario.resources ?? {})) {
    const busyTime = busyByPool.get(poolId) ?? 0;
    // R-CAL-9: el denominador son las horas **abiertas** del calendario del pool dentro de la
    // ventana `[warmup, t_stop]`; sin calendario, la ventana entera. R-CAL-11: con capacidad por
    // intervalos se integra tramo a tramo, `Σ capacity_i × openTime_i`; con `capacity` numérica
    // el sumatorio tiene un solo término y es literalmente la expresión de M3.
    let available = 0;
    for (const slice of capacitySlices(pool)) {
      const calendar = calendars.size === 0 ? undefined : calendars.get(slice.calendar ?? 'default');
      available += slice.capacity
        * (calendar === undefined ? windowDuration : openTime(calendar, windowStart, windowEnd));
    }
    const fixedCost = (pool.fixedCost ?? 0) * (usesByPool.get(poolId) ?? 0);
    const unitCost = ((pool.costPerHour ?? 0) * busyTime) / 3600;
    const utilization = available > 0 ? busyTime / available : 0;
    resources[poolId] = {
      utilization,
      busyTime,
      fixedCost,
      unitCost,
      totalCost: fixedCost + unitCost,
    };
    // R-CAL-9: una bajada de capacidad no interrumpe tareas ya iniciadas (R-CAL-11), por lo que
    // su ocupación puede superar la capacidad integrada durante la ventana. El valor conserva
    // esa evidencia; el aviso evita que un consumidor lo interprete como un porcentaje acotado.
    if (utilization > 1 + Number.EPSILON * 16) {
      warnings.push(
        coded('W-UTILIZACION-MAYOR-UNO', coreMessages(locale).codes['W-UTILIZACION-MAYOR-UNO'](poolId)),
      );
    }
    // LILA-191: pool que nunca alcanza estado estacionario. `utilization` está acotada por la
    // capacidad y no distingue «justo al límite» de «el doble de lo que puede atender»; la cola
    // atribuida sí. El aviso no toca ninguna métrica: advierte de que `resourceWait` y
    // `bottlenecks` de este pool crecen con la duración de la corrida y no comparan con nada.
    if (tracksSaturation) {
      // Capacidad **efectiva**: `available` ya integra `Σ capacity_i × horas abiertas_i`, así que
      // dividirla entre las horas abiertas del pool devuelve unidades, no unidades diluidas por
      // el calendario (con un solo tramo es exactamente `capacity`).
      const calendar = poolCalendar(calendars, pool);
      const open = calendar === undefined ? windowDuration : openTime(calendar, windowStart, windowEnd);
      const full = fullByPool.get(poolId) ?? EMPTY_FULL;
      const fullFirst = overlap(full, windowStart, middle, middle).total;
      const fullSecond = overlap(full, middle, windowEnd, middle).total;
      const load: PoolLoad = {
        demand: demandByPool.get(poolId) ?? 0,
        served: usesByPool.get(poolId) ?? 0,
        pending: pendingByPool.get(poolId) ?? 0,
        capacity: open > 0 ? available / open : 0,
        // Cola media **mientras el pool estuvo lleno**: es el único tiempo en que la cola de un
        // pool significa algo, y deja fuera el `offHoursWait` sin tener que restarlo aparte.
        firstHalf: fullFirst > 0 ? (firstHalfByPool.get(poolId) ?? 0) / fullFirst : 0,
        secondHalf: fullSecond > 0 ? (secondHalfByPool.get(poolId) ?? 0) / fullSecond : 0,
      };
      loads?.set(poolId, load);
      // Con una sola replicación esta es ya la decisión final; `simulate` rehace la cuenta sobre
      // la media de las `load` cuando hay varias (R-ARR-8).
      const warning = loads === undefined ? saturationWarning(poolId, load, locale) : undefined;
      if (warning !== undefined) warnings.push(warning);
    }
  }

  // Ranking de cuellos de botella (sección 6 de RESULTS_FORMAT.md): `resourceWait.total`
  // descendente, desempate por la mayor utilización entre los pools que el elemento usó de
  // hecho — leídos del log, no del escenario, así que AND y OR se ordenan igual.
  const bottlenecks: BottleneckEntry[] = Object.entries(elements)
    .filter(([, metrics]) => metrics.resourceWait.total > 0)
    .map(([elementId, metrics]) => {
      let utilization = 0;
      for (const poolId of poolsByElement.get(elementId) ?? []) {
        utilization = Math.max(utilization, resources[poolId]?.utilization ?? 0);
      }
      return { elementId, resourceWaitTotal: metrics.resourceWait.total, utilization };
    })
    .sort(
      (left, right) =>
        right.resourceWaitTotal - left.resourceWaitTotal ||
        right.utilization - left.utilization ||
        (left.elementId < right.elementId ? -1 : left.elementId > right.elementId ? 1 : 0),
    );

  const flows: RunResult['flows'] = {};
  for (const flowId of Object.keys(ir.flows)) flows[flowId] = { count: run.flows[flowId] ?? 0 };

  const completedCases = run.cases.filter((record) => record.endedAt !== null);
  const cycleTimes = completedCases.map((record) => record.endedAt! - record.startedAt);
  const waitTimes = completedCases.map((record) => waitByCase.get(String(record.caseId)) ?? 0);
  const completedCaseCosts = completedCases.map((record) => costByCase.get(String(record.caseId)) ?? 0);
  const totalCost = includedRows.reduce((total, row) => total + row.cost, 0);
  const effectiveSeconds = Math.max(0, run.statisticsDuration);

  return {
    elements,
    flows,
    resources,
    process: {
      started: run.cases.length,
      completed: completedCases.length,
      inFlight: run.cases.length - completedCases.length,
      cycleTime: percentiles(cycleTimes),
      waitTime: percentiles(waitTimes),
      throughputPerHour: effectiveSeconds > 0 ? completedCases.length / (effectiveSeconds / 3600) : 0,
      costPerCase:
        completedCaseCosts.length > 0
          ? completedCaseCosts.reduce((total, cost) => total + cost, 0) / completedCaseCosts.length
          : 0,
      totalCost,
    },
    bottlenecks,
    warnings,
  };
}
