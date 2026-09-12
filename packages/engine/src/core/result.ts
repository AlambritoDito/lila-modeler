// Tipos de `RunResult` y `EventLogRow` (docs/RESULTS_FORMAT.md). Solo tipos TypeScript:
// packages/engine/src/core/ no importa nada fuera de core/ (ni zod, ni bpmn-moddle, ni
// node:*, ni React). El esquema zod que valida un RunResult en tiempo de ejecución vive
// en packages/engine/src/result.schema.ts, fuera de core/.
//
// Unidades (docs/RESULTS_FORMAT.md): todo tiempo en segundos (float64); todo dinero en
// `run.currency`. El `id` usado como clave en cada Record es siempre el id BPMN, nunca
// el nombre visible.

/** min, max, mean, total — sin desviación estándar. */
export interface Stat {
  min: number;
  max: number;
  mean: number;
  total: number;
}

/** min, max, mean, total, y sd (desviación estándar muestral). */
export interface StatSd {
  min: number;
  max: number;
  mean: number;
  sd: number;
  total: number;
}

/** min, max, mean, sd, y percentiles empíricos 50/90/95. */
export interface Percentiles {
  min: number;
  max: number;
  mean: number;
  sd: number;
  p50: number;
  p90: number;
  p95: number;
}

/** Métricas por elemento del proceso (`RunResult.elements[id]`), sección 2 de RESULTS_FORMAT.md. */
export interface ElementMetrics {
  started: number;
  completed: number;
  processing: Stat;
  resourceWait: StatSd;
  offHoursWait: StatSd;
  queueLength: { mean: number; max: number };
  fixedCostTotal: number;
}

/** Métricas por sequence flow (`RunResult.flows[id]`), sección 3. */
export interface FlowMetrics {
  count: number;
}

/** Métricas por pool de recursos (`RunResult.resources[id]`), sección 4. */
export interface ResourceMetrics {
  /** Fracción 0..1: busyTime / (capacity × horas disponibles según calendario). */
  utilization: number;
  busyTime: number;
  fixedCost: number;
  unitCost: number;
  totalCost: number;
}

/**
 * Métricas de un desenlace: los casos completados que terminaron en un `end` (o `terminate`)
 * concreto (`RunResult.process.byEndEvent[id]`, sección 5). Todo nodo final del IR aparece,
 * aunque ningún caso lo haya alcanzado, para que las claves sean estables entre replicaciones.
 */
export interface OutcomeMetrics {
  /** Casos completados que terminaron en este nodo final. Suma = `process.completed`. */
  completed: number;
  cycleTime: Percentiles;
  waitTime: Percentiles;
  /** Fracción 0..1 de esos casos con `cycleTime <= run.serviceLevel`. Solo con `run.serviceLevel`. */
  withinServiceLevel?: number;
}

/** Métricas agregadas de todo el proceso (`RunResult.process`), sección 5. */
export interface ProcessMetrics {
  started: number;
  completed: number;
  inFlight: number;
  cycleTime: Percentiles;
  waitTime: Percentiles;
  throughputPerHour: number;
  costPerCase: number;
  totalCost: number;
  /**
   * Desglose por desenlace, keyed por id BPMN del `end`/`terminate` que cerró cada caso (#316).
   * Los casos en vuelo no cuentan en ninguna entrada.
   */
  byEndEvent: Record<string, OutcomeMetrics>;
  /** Fracción 0..1 de casos completados con `cycleTime <= run.serviceLevel`. Solo con `run.serviceLevel`. */
  withinServiceLevel?: number;
}

/** Una entrada del ranking de cuellos de botella (`RunResult.bottlenecks`), sección 6. */
export interface BottleneckEntry {
  elementId: string;
  /** = elements[elementId].resourceWait.total, segundos. */
  resourceWaitTotal: number;
  /** Del recurso principal asignado al elemento, 0..1. */
  utilization: number;
}

/** Resumen de un KPI numérico entre replicaciones (media, sd, intervalo de confianza 95 %). */
export interface KpiSummary {
  mean: number;
  sd: number;
  /** [límite inferior, límite superior] del intervalo de confianza al 95 %. */
  ci95: [number, number];
}

/** Resumen entre replicaciones (`RunResult.replications`), sección 8. Solo si `scenario.run.replications > 1`. */
export interface ReplicationSummary {
  /** Replicaciones completas resumidas; igual a las solicitadas salvo cancelación. */
  count: number;
  /** Keyed por nombre de KPI, p. ej. "process.cycleTime.mean". */
  kpis: Record<string, KpiSummary>;
}

/**
 * Salida de `simulate(ir, scenario, opts)` (packages/engine/src/core/run.ts).
 * Sección 1 de docs/RESULTS_FORMAT.md.
 */
export interface RunResult {
  /** Keyed por id BPMN del elemento. Todo elemento del IR aparece, aunque su conteo sea cero. */
  elements: Record<string, ElementMetrics>;
  /** Keyed por id BPMN del sequence flow. */
  flows: Record<string, FlowMetrics>;
  /** Keyed por id del pool de recursos. */
  resources: Record<string, ResourceMetrics>;
  process: ProcessMetrics;
  /** Ranking descendente por resourceWaitTotal; elementos con resourceWaitTotal = 0 no aparecen. */
  bottlenecks: BottleneckEntry[];
  /** Solo presente si scenario.run.replications > 1. */
  replications?: ReplicationSummary;
  /** Presente y siempre `true` cuando `opts.signal` detuvo la simulación. */
  cancelled?: true;
  /** Solo con `cancelled`: número de replicaciones completas incluidas en el agregado. */
  completedReplications?: number;
  warnings: string[];
  /**
   * Event log completo de la corrida, en orden de simulación y de replicación (sección 7 de
   * docs/RESULTS_FORMAT.md). Presente **solo** cuando nadie más se hizo cargo de las filas: sin
   * `opts.onEvent` y sin `opts.log: false`. Con `onEvent` el consumidor ya las recibe una a una
   * y retenerlas aquí duplicaría hasta 6 M de objetos; con `log: false` no hay log. *(LILA-037)*
   */
  log?: EventLogRow[];
}

/**
 * Una fila plana por asignación de pool (ADR-025). Varias filas pueden pertenecer a la misma
 * instancia de actividad; sin recurso existe una única fila sentinel.
 */
export interface EventLogRow {
  /** Índice de la replicación, 0..scenario.run.replications-1. */
  replication: number;
  /** Identificador del caso (instancia de proceso), único dentro de la replicación. */
  caseId: string;
  /** Identificador estable de la ocurrencia; agrupa asignaciones de una misma tarea/timer. */
  activityInstanceId: string;
  /** id BPMN del elemento (nunca el nombre). */
  elementId: string;
  /** id del pool de esta asignación; null en la fila sentinel. */
  resourceId: string | null;
  /** Posición de la asignación en `elements[id].resources`; null para el sentinel. */
  allocationIndex: number | null;
  /** Unidades del pool; null en la fila sentinel. */
  resourceQuantity: number | null;
  /** Estado observable al emitir la fila. */
  status: 'completed' | 'terminated' | 'interrupted' | 'inFlight';
  enabledAt: number;
  startedAt: number | null;
  endedAt: number | null;
  /** Fin normal o instante de corte/terminate para lifecycle parcial. */
  observedUntil: number;
  /** startedAt − enabledAt menos la porción atribuible a calendario cerrado (ver offHoursWait). */
  resourceWait: number;
  /** Porción de startedAt − enabledAt en la que el calendario estaba cerrado. */
  offHoursWait: number;
  /** Fijo del elemento, cargado una sola vez por actividad completada. */
  elementCost: number;
  /** Costo fijo y por tiempo de esta asignación de pool. */
  resourceCost: number;
  /** Identidad exacta `elementCost + resourceCost`. */
  cost: number;
}
