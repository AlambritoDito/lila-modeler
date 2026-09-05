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
import { activityCalendar, compileCalendars, poolCalendar } from './sim.js';
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
 */
export function aggregateReplication(
  ir: ProcessIR,
  run: ReplicationRun,
  scenario: SimScenario = { run: {} },
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
    const usedPools = activityRows.flatMap((entry) => (entry.resourceId === null ? [] : [entry.resourceId]));
    let calendar: Calendar | undefined;
    for (const entry of activityRows) {
      if (entry.resourceId === null) continue;
      const pools = poolsByElement.get(entry.elementId) ?? new Set<string>();
      pools.add(entry.resourceId);
      poolsByElement.set(entry.elementId, pools);
      if (entry.startedAt === null) continue;
      if (calendar === undefined) calendar = activityCalendar(scenario, calendars, entry.elementId, usedPools);
      const quantity = entry.resourceQuantity ?? 1;
      const occupiedFrom = Math.max(entry.startedAt, windowStart);
      const occupiedTo = Math.min(entry.endedAt ?? entry.observedUntil, windowEnd);
      const occupied = calendar === undefined
        ? Math.max(0, occupiedTo - occupiedFrom)
        : openTime(calendar, occupiedFrom, occupiedTo);
      busyByPool.set(entry.resourceId, (busyByPool.get(entry.resourceId) ?? 0) + quantity * occupied);
      usesByPool.set(entry.resourceId, (usesByPool.get(entry.resourceId) ?? 0) + quantity);
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

  // R-COST-2 y R-CAL-9. Todo pool declarado aparece aunque no se haya usado, para que los mapas
  // de KPI de todas las replicaciones tengan el mismo conjunto de claves (LILA-027). Sin
  // `resources` en el escenario el mapa queda `{}`, igual que en M1 (R-DEG-1).
  const resources: Record<string, ResourceMetrics> = {};
  // ponytail: el mapa se construye solo desde los pools declarados; una `ref` a un pool
  // inexistente no llega hasta aquí porque `validateScenario` la rechaza con
  // `E-REC-DESCONOCIDO`. Techo: un pool que apareciese en el log sin estar declarado quedaría
  // fuera del mapa (su ocupación sí seguiría en las filas del log).
  for (const [poolId, pool] of Object.entries(scenario.resources ?? {})) {
    const busyTime = busyByPool.get(poolId) ?? 0;
    // R-CAL-9: el denominador son las horas **abiertas** del calendario del pool dentro de la
    // ventana `[warmup, t_stop]`; sin calendario, la ventana entera.
    const calendar = poolCalendar(calendars, pool);
    const available = pool.capacity
      * (calendar === undefined ? windowDuration : openTime(calendar, windowStart, windowEnd));
    const fixedCost = (pool.fixedCost ?? 0) * (usesByPool.get(poolId) ?? 0);
    const unitCost = ((pool.costPerHour ?? 0) * busyTime) / 3600;
    resources[poolId] = {
      utilization: available > 0 ? busyTime / available : 0,
      busyTime,
      fixedCost,
      unitCost,
      totalCost: fixedCost + unitCost,
    };
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
    warnings: [...run.warnings],
  };
}
