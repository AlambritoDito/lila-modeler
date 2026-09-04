export * from './core/ir.js';
export { simulate } from './core/run.js';
export type { SimulateOptions, SimulationProgress } from './core/run.js';
export type {
  BottleneckEntry,
  ElementMetrics,
  EventLogRow,
  FlowMetrics,
  KpiSummary,
  Percentiles,
  ProcessMetrics,
  ReplicationSummary,
  ResourceMetrics,
  RunResult,
  Stat,
  StatSd,
} from './core/result.js';
export type { AbortSignalLike, SimElement, SimResource, SimRun, SimScenario } from './core/sim.js';

export const version = '0.0.0';
