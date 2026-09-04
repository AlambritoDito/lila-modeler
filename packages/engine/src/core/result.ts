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
}

/**
 * Una fila del event log (sección 7 de docs/RESULTS_FORMAT.md): una por instancia de
 * elemento por caso por replicación. Timestamps en segundos desde `run.start`.
 */
export interface EventLogRow {
  /** Índice de la replicación, 0..scenario.run.replications-1. */
  replication: number;
  /** Identificador del caso (instancia de proceso), único dentro de la replicación. */
  caseId: string;
  /** id BPMN del elemento (nunca el nombre). */
  elementId: string;
  /** id del pool de recursos que atendió la instancia; null si el elemento no requiere recurso. */
  resourceId: string | null;
  enabledAt: number;
  startedAt: number;
  endedAt: number;
  /** startedAt − enabledAt menos la porción atribuible a calendario cerrado (ver offHoursWait). */
  resourceWait: number;
  /** Porción de startedAt − enabledAt en la que el calendario estaba cerrado. */
  offHoursWait: number;
  /** En run.currency: fixedCost del elemento (si esta fila lo completa) + porción de unitCost del recurso. */
  cost: number;
}
