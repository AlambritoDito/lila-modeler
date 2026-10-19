/**
 * Compact results for an agent's context (#629): `run_simulation` and `compare_scenarios` answer with
 * a summary by default and the whole `RunResult` / `CompareResult` with `detail: "full"`. A summary
 * keeps what decides a process change — the process KPIs, the bottlenecks, each resource's load,
 * wait and cost, the elements that wait most, and the warnings once each — and leaves out the
 * per-element and per-flow tables. `saveTo` and `saveRun` always store the full result.
 */
import type { CompareResult, CompareRow, RunResult } from '@lila-modeler/engine';
import { z } from 'zod';

export type Detail = 'summary' | 'full';

export const detailSchema = z
  .enum(['summary', 'full'])
  .optional()
  .describe(
    'summary (default): process KPIs, bottlenecks, per-resource utilization/wait/cost, the elements ' +
      'that wait most and grouped warnings. full: the whole result (every element and flow).',
  );

/** `detail` of `compare_scenarios` (#645): its summary is not `run_simulation`'s. */
export const compareDetailSchema = z
  .enum(['summary', 'full'])
  .optional()
  .describe(
    'summary (default): the process and resource rows, every other row marked significant for some ' +
      'scenario, and omittedRows (how many were left out). full: every row of the comparison.',
  );

/** How many elements `topWaits` lists. */
export const TOP_WAITS = 5;

/** A warning and how many times it came up; the message is the first occurrence. */
export interface GroupedWarning {
  message: string;
  count: number;
}

/** The elements of a scenario and the resources they request, as far as the summary needs them. */
interface ScenarioUses {
  elements?: Record<string, { resources?: ReadonlyArray<{ ref: string }> | undefined } | undefined> | undefined;
}

/** The IR's names, as far as the summary needs them. */
interface NamedNodes {
  nodes: Record<string, { name: string }>;
}

export interface RunSummary {
  detail: 'summary';
  process: RunResult['process'];
  bottlenecks: RunResult['bottlenecks'];
  resources: Record<string, { utilization: number; resourceWaitTotal: number; totalCost: number }>;
  topWaits: Array<{
    elementId: string;
    name: string;
    completed: number;
    resourceWaitMean: number;
    resourceWaitTotal: number;
    offHoursWaitMean: number;
    queueLengthMean: number;
  }>;
  replications?: number;
  cancelled?: true;
  completedReplications?: number;
  warnings: GroupedWarning[];
}

/**
 * Numbers that stand on their own («(2941 times)», «≈ 2.0», «1457 cases») are what changes between
 * the copies of one warning in each replication; numbers inside an id (`Task_1`) are not.
 */
const LOOSE_NUMBER = /(?<![\w.-])\d+(?:[.,]\d+)?(?![\w])/g;

/** A coded warning (`<code>: Join_1: …`): its code and the element (or pool, or flow) it is about. */
const CODED = /^([EW]-[A-Z0-9-]+): ([^:]+?): /;

/**
 * One entry per warning, in order of first appearance, its first message standing for the group. A
 * coded warning is one per code and subject (#645: `1 case was` and `3 cases were` of one join are
 * the same warning), so two different texts of one code about one element count as one too; the
 * full result keeps every text. Any other warning: copies that differ only in loose numbers count
 * as one.
 */
export function groupWarnings(warnings: readonly string[]): GroupedWarning[] {
  const groups = new Map<string, GroupedWarning>();
  for (const message of warnings) {
    const coded = CODED.exec(message);
    const key = coded === null ? message.replace(LOOSE_NUMBER, '#') : `${coded[1]} ${coded[2]}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { message, count: 1 });
    else group.count += 1;
  }
  return [...groups.values()];
}

export function summarizeRun(result: RunResult, ir: NamedNodes, scenario: ScenarioUses): RunSummary {
  const resources: RunSummary['resources'] = {};
  for (const [id, metrics] of Object.entries(result.resources)) {
    let resourceWaitTotal = 0;
    for (const [elementId, element] of Object.entries(scenario.elements ?? {})) {
      if (!(element?.resources ?? []).some((use) => use.ref === id)) continue;
      resourceWaitTotal += result.elements[elementId]?.resourceWait.total ?? 0;
    }
    resources[id] = { utilization: metrics.utilization, resourceWaitTotal, totalCost: metrics.totalCost };
  }

  const topWaits = Object.entries(result.elements)
    .map(([elementId, metrics]) => ({ elementId, metrics, wait: metrics.resourceWait.total + metrics.offHoursWait.total }))
    .filter(({ wait }) => wait > 0)
    .sort((left, right) => right.wait - left.wait || (left.elementId < right.elementId ? -1 : 1))
    .slice(0, TOP_WAITS)
    .map(({ elementId, metrics }) => ({
      elementId,
      name: ir.nodes[elementId]?.name ?? '',
      completed: metrics.completed,
      resourceWaitMean: metrics.resourceWait.mean,
      resourceWaitTotal: metrics.resourceWait.total,
      offHoursWaitMean: metrics.offHoursWait.mean,
      queueLengthMean: metrics.queueLength.mean,
    }));

  return {
    detail: 'summary',
    process: result.process,
    bottlenecks: result.bottlenecks,
    resources,
    topWaits,
    ...(result.replications === undefined ? {} : { replications: result.replications.count }),
    ...(result.cancelled === true ? { cancelled: true as const, completedReplications: result.completedReplications ?? 0 } : {}),
    warnings: groupWarnings(result.warnings),
  };
}

export interface ComparisonSummary {
  detail: 'summary';
  count: number;
  rows: CompareRow[];
  /** Rows of `full` left out: element and flow KPIs with no significant difference. */
  omittedRows: number;
}

/** The process and resource KPI rows, plus every other row marked significant for some scenario. */
export function summarizeComparison(comparison: CompareResult): ComparisonSummary {
  const rows = comparison.rows.filter(
    (row) => row.scope === 'process' || row.scope === 'resources' || row.significant.some(Boolean),
  );
  return { detail: 'summary', count: comparison.count, rows, omittedRows: comparison.rows.length - rows.length };
}

const percentiles = z.object({
  min: z.number(),
  max: z.number(),
  mean: z.number(),
  sd: z.number(),
  p50: z.number(),
  p90: z.number(),
  p95: z.number(),
});

/** `outputSchema` of the summary branch of `run_simulation`; the full branch is `runResultSchema`. */
export const runSummarySchema = z.object({
  detail: z.literal('summary'),
  process: z.object({
    started: z.number(),
    completed: z.number(),
    inFlight: z.number(),
    cycleTime: percentiles,
    waitTime: percentiles,
    throughputPerHour: z.number(),
    costPerCase: z.number(),
    totalCost: z.number(),
    byEndEvent: z
      .record(
        z.string(),
        z.object({ completed: z.number(), cycleTime: percentiles, waitTime: percentiles, withinServiceLevel: z.number().optional() }),
      )
      .optional(),
    withinServiceLevel: z.number().optional(),
  }),
  bottlenecks: z.array(z.object({ elementId: z.string(), resourceWaitTotal: z.number(), utilization: z.number() })),
  resources: z
    .record(z.string(), z.object({ utilization: z.number(), resourceWaitTotal: z.number(), totalCost: z.number() }))
    .describe(
      'Per resource. resourceWaitTotal is the resource wait (seconds) of every element that lists it (with ' +
        'selection "or", every alternative): an element that lists two resources counts its whole wait for ' +
        'each, so the totals of two resources can hold the same wait and do not add up to the process wait.',
    ),
  topWaits: z.array(
    z.object({
      elementId: z.string(),
      name: z.string(),
      completed: z.number(),
      resourceWaitMean: z.number(),
      resourceWaitTotal: z.number(),
      offHoursWaitMean: z.number(),
      queueLengthMean: z.number(),
    }),
  ),
  replications: z.number().int().optional(),
  cancelled: z.literal(true).optional(),
  completedReplications: z.number().int().optional(),
  warnings: z.array(z.object({ message: z.string(), count: z.number().int().min(1) })),
});
