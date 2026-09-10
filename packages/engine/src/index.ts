export * from './core/ir.js';
export { compare } from './core/compare.js';
export type { CompareResult, CompareRow, CompareScope } from './core/compare.js';
export { simulate } from './core/run.js';
export type { SimulateOptions, SimulationProgress } from './core/run.js';
export type {
  BottleneckEntry,
  ElementMetrics,
  EventLogRow,
  FlowMetrics,
  KpiSummary,
  OutcomeMetrics,
  Percentiles,
  ProcessMetrics,
  ReplicationSummary,
  ResourceMetrics,
  RunResult,
  Stat,
  StatSd,
} from './core/result.js';
export type { AbortSignalLike, SimElement, SimResource, SimRun, SimScenario } from './core/sim.js';
// Solo el tipo: el catálogo completo vive en `@lila/engine/messages` y no entra al bundle del
// worker, que es `core/` (LILA-211).
export type { Locale } from './core/messages/index.js';

export { version } from './version.js';
