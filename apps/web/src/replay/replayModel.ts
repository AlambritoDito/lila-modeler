/**
 * Pure replay model (#331): turns the event log of ONE replication into something a clock can be
 * scrubbed over. No DOM, no bpmn-js, no React — `ReplayOverlay.ts` paints what this returns and
 * `Replay.tsx` drives the clock.
 *
 * The log is the engine's, not a toy walker: every number this module reports comes from
 * `EventLogRow` (docs/RESULTS_FORMAT.md § 7), so the counters at the end of the replay are the
 * same `elements[id].started/completed` the results table shows — that is the invariant
 * `replayModel.test.ts` pins on `examples/tarjeta-credito`.
 *
 * Two things the log does NOT carry and this module infers from the IR graph:
 *
 * - **Flows, and the counters of the nodes that emit no rows.** Only tasks and timers emit rows;
 *   start/end events, gateways and sequence flows emit nothing, so their counters are derived
 *   from the inferred path of each case (`passages`): the start when the first activity of the
 *   case is enabled, a gateway when a path crosses it, an end event when the last *completed*
 *   activity of the case hands the token over. The path a token took between two consecutive elements of a case is recovered
 *   with a BFS over `ir.flows`, which is the shortest route through the gateways in between.
 *   // ponytail: BFS = the shortest path, not necessarily the one the case really took when two
 *   // routes join the same pair of tasks. Upgrade path: an `onEvent` that also emits flows.
 * - **Where a case ended.** The log has no end-event id per case, so the closing hop goes to the
 *   first end event reachable from the last element the case completed.
 *
 * State is computed by a full scan of the activities on every `stateAt` call instead of an
 * incremental cursor: 461 rows for the reference example, ~1 000 for a big one, which is nothing
 * at 60 fps and means seeking backwards costs exactly the same as playing forwards.
 */
import type { ProcessIR } from '@lila/engine';
import type { ResolvedScenario } from '@lila/engine/schema';
import type { EventLogRow } from '@lila/engine';

/** One activity occurrence (all the log rows that share an `activityInstanceId`). */
export interface ReplayActivity {
  elementId: string;
  caseId: string;
  enabledAt: number;
  /** `null` while the token never got its resources before the horizon. */
  startedAt: number | null;
  /** `endedAt` when it completed; `observedUntil` for `inFlight`/`terminated`. */
  endAt: number;
  completed: boolean;
  /** Pool units held between `startedAt` and `endAt`, one entry per allocation row. */
  allocations: readonly { resourceId: string; quantity: number }[];
}

/** A case crossing a node that emits no log row: a start event, a gateway or an end event. */
export interface ReplayPassage {
  elementId: string;
  /** Instant the token is counted at; these nodes have no duration, so started === completed. */
  at: number;
}

/** A token walking a path of sequence flows between two points of the graph. */
export interface ReplayMove {
  flows: readonly string[];
  from: number;
  to: number;
}

export interface Replay {
  activities: readonly ReplayActivity[];
  moves: readonly ReplayMove[];
  /** Crossings of the nodes that emit no rows, recovered from the same inferred paths. */
  passages: readonly ReplayPassage[];
  /** Elements that appear in the log, in first-seen order: the ones that get a counter. */
  elementIds: readonly string[];
  /** Capacity per pool referenced by the log. */
  pools: Readonly<Record<string, number>>;
  /** Last instant of the replication, in simulated seconds from the run start. */
  horizon: number;
  /** `run.start` as epoch milliseconds, or `null` when the scenario has no start date. */
  startMs: number | null;
  /** `run.replications` of the scenario: the replay is always replication 1 of these. */
  replications: number;
  /** Log rows the replay was built from: what the truncation notice has to quote. */
  rows: number;
  /** `true` when the log sample hit its row cap and the tail of the replication is missing. */
  truncated: boolean;
}

export interface ElementState {
  started: number;
  completed: number;
  /** Tokens enabled but not started yet. */
  queue: number;
  /** Tokens being processed right now. */
  running: number;
}

export interface ReplayState {
  t: number;
  elements: Readonly<Record<string, ElementState>>;
  pools: Readonly<Record<string, { busy: number; capacity: number }>>;
  tokens: readonly { flowId: string; progress: number }[];
}

/**
 * How long a hop between two elements is shown when the graph routes it instantly, which is the
 * normal case: a gateway and its flows take no simulated time, so `from === to` and the token
 * would never be visible. A hundredth of the horizon is ~5 min of an 8 h run: half a second of
 * real time at 600×, a blink at 60×.
 *
 * // ponytail: fixed fraction, no setting. Upgrade path: a speed-aware duration if someone
 * // complains that the dots crawl at 1×.
 */
const TRAVEL_FRACTION = 100;

/**
 * Rows of replication 0 the worker keeps in memory (`DEFAULT_LOG_SAMPLE_LIMIT` in `worker.ts`).
 * It is repeated here instead of imported so the shell does not pull the worker module — and
 * with it the whole engine — into the main bundle just to read a number; the shell passes it to
 * `runInWorker`, so the two cannot drift apart in silence.
 */
export const LOG_SAMPLE_LIMIT = 10_000;

/** Capacity of a pool: the integer, or the biggest slice of a per-interval capacity (R-CAL-11). */
function capacityOf(scenario: ResolvedScenario, id: string): number {
  const capacity = scenario.resources?.[id]?.capacity;
  if (typeof capacity === 'number') return capacity;
  if (Array.isArray(capacity)) return Math.max(...capacity.map((slice) => slice.capacity));
  return 0;
}

/** `from -> to` adjacency as flow ids, built once per `buildReplay`. */
function outgoing(ir: ProcessIR): ReadonlyMap<string, readonly { flowId: string; to: string }[]> {
  const map = new Map<string, { flowId: string; to: string }[]>();
  // `ir.flows ?? {}`: the shell also builds a replay from whatever `parseBpmn` returned, and an
  // IR without a graph (a stub, a model that failed to import) must leave the dots empty, not throw.
  for (const [flowId, flow] of Object.entries(ir.flows ?? {})) {
    const list = map.get(flow.from) ?? [];
    list.push({ flowId, to: flow.to });
    map.set(flow.from, list);
  }
  return map;
}

/**
 * Shortest list of flow ids from `from` to `to` (BFS), or `null` when the graph does not connect
 * them — a log row of an element the diagram no longer has, say. `to` as a predicate covers "any
 * end event", which is how a case's closing hop is found.
 */
function path(
  edges: ReadonlyMap<string, readonly { flowId: string; to: string }[]>,
  from: string,
  reached: (id: string) => boolean,
): readonly string[] | null {
  if (reached(from)) return [];
  const queue: { node: string; flows: string[] }[] = [{ node: from, flows: [] }];
  const seen = new Set<string>([from]);
  while (queue.length > 0) {
    const current = queue.shift() as { node: string; flows: string[] };
    for (const edge of edges.get(current.node) ?? []) {
      if (seen.has(edge.to)) continue;
      seen.add(edge.to);
      const flows = [...current.flows, edge.flowId];
      if (reached(edge.to)) return flows;
      queue.push({ node: edge.to, flows });
    }
  }
  return null;
}

/**
 * Groups the rows of one replication into activities and recovers the hops between them.
 *
 * `rows` may come in any order — the engine emits them as each activity finishes, not
 * chronologically — and may be a prefix of the replication (`truncated`). Rows of other
 * replications are ignored: the replay is always replication 1.
 */
export function buildReplay(
  rows: readonly EventLogRow[],
  ir: ProcessIR,
  scenario: ResolvedScenario,
  options: { truncated?: boolean } = {},
): Replay {
  const byInstance = new Map<string, ReplayActivity>();
  const elementIds: string[] = [];
  const pools: Record<string, number> = {};

  for (const row of rows) {
    if (row.replication !== 0) continue;
    let activity = byInstance.get(row.activityInstanceId);
    if (activity === undefined) {
      activity = {
        allocations: [],
        caseId: row.caseId,
        completed: row.status === 'completed',
        elementId: row.elementId,
        enabledAt: row.enabledAt,
        endAt: row.endedAt ?? row.observedUntil,
        startedAt: row.startedAt,
      };
      byInstance.set(row.activityInstanceId, activity);
      if (!elementIds.includes(row.elementId)) elementIds.push(row.elementId);
    }
    // An AND task with two pools emits one row per allocation, all sharing the instance id: the
    // first one is canonical for the lifecycle and every row contributes its units to the pool.
    if (row.resourceId !== null && row.resourceQuantity !== null) {
      (activity.allocations as { resourceId: string; quantity: number }[]).push({
        quantity: row.resourceQuantity,
        resourceId: row.resourceId,
      });
      pools[row.resourceId] ??= capacityOf(scenario, row.resourceId);
    }
  }

  const activities = [...byInstance.values()];
  const horizon = activities.reduce((max, a) => Math.max(max, a.endAt), 0);
  const travel = Math.max(horizon / TRAVEL_FRACTION, Number.EPSILON);
  const edges = outgoing(ir);
  const cache = new Map<string, readonly string[] | null>();
  const between = (from: string, to: string): readonly string[] | null => {
    const key = `${from}>${to}`;
    if (!cache.has(key)) cache.set(key, path(edges, from, (id) => id === to));
    return cache.get(key) ?? null;
  };
  const toEnd = (from: string): readonly string[] | null => {
    const key = `${from}>*end`;
    if (!cache.has(key)) cache.set(key, path(edges, from, (id) => ir.nodes[id]?.type === 'end'));
    return cache.get(key) ?? null;
  };
  const starts = Object.entries(ir.nodes ?? {})
    .filter(([, node]) => node.type === 'start')
    .map(([id]) => id);

  const moves: ReplayMove[] = [];
  const passages: ReplayPassage[] = [];
  /** Counts one crossing of `id`, and gives it a counter on the diagram if it had none. */
  const cruzar = (id: string, at: number): void => {
    if (ir.nodes[id] === undefined) return;
    if (!elementIds.includes(id)) elementIds.push(id);
    passages.push({ at, elementId: id });
  };
  const hop = (flows: readonly string[] | null, from: number, to: number): void => {
    if (flows === null || flows.length === 0) return;
    moves.push({ flows, from, to: Math.max(to, from + travel) });
    // Every node in the middle of the path is a gateway (or another pass-through node) the case
    // went by: it is counted when the token reaches the far end of the hop. The two ends of the
    // path are NOT counted here — they are the activities, or the start/end events the callers
    // below count once each.
    for (const flowId of flows.slice(0, -1)) {
      const middle = ir.flows[flowId]?.to;
      if (middle !== undefined) cruzar(middle, to);
    }
  };

  const byCase = new Map<string, ReplayActivity[]>();
  for (const activity of activities) {
    const list = byCase.get(activity.caseId) ?? [];
    list.push(activity);
    byCase.set(activity.caseId, list);
  }
  for (const list of byCase.values()) {
    list.sort((a, b) => a.enabledAt - b.enabledAt);
    const first = list[0] as ReplayActivity;
    for (const start of starts) {
      const flows = between(start, first.elementId);
      // The start event has no duration: the case is counted there the instant its first
      // activity is enabled, which is the same instant the token leaves the start.
      if (flows !== null) { cruzar(start, first.enabledAt); hop(flows, first.enabledAt, first.enabledAt); break; }
    }
    for (let i = 1; i < list.length; i++) {
      const previous = list[i - 1] as ReplayActivity;
      const next = list[i] as ReplayActivity;
      hop(between(previous.elementId, next.elementId), previous.endAt, next.enabledAt);
    }
    const last = list[list.length - 1] as ReplayActivity;
    // Only a case whose last activity completed reached an end event: one still in flight (or
    // terminated) at the horizon must never bump an end counter.
    if (last.completed) {
      const flows = toEnd(last.elementId);
      // `flows` ends at the end event itself, which `hop` leaves out of the middle nodes.
      // // ponytail: with several reachable ends the BFS takes the first one, so a diagram whose
      // // last task can reach two ends splits the cases by a guess. In `examples/tarjeta-credito`
      // // every end is reachable from exactly one last task, so the counters there are exact.
      const end = flows === null || flows.length === 0 ? undefined : ir.flows[flows[flows.length - 1] as string]?.to;
      if (end !== undefined) cruzar(end, last.endAt);
      hop(flows, last.endAt, last.endAt);
    }
  }

  const startMs = scenario.run.start === undefined ? null : Date.parse(scenario.run.start);

  return {
    activities,
    elementIds,
    horizon,
    moves,
    passages,
    pools,
    replications: scenario.run.replications,
    rows: rows.length,
    startMs: startMs === null || Number.isNaN(startMs) ? null : startMs,
    truncated: options.truncated ?? false,
  };
}

/**
 * The whole picture at simulated second `t`: counters per element, busy units per pool and the
 * tokens in flight over the flows. At `t >= horizon` the counters are the final ones, which are
 * the engine's `elements[id].started/completed` for a single-replication run.
 */
export function stateAt(replay: Replay, t: number): ReplayState {
  const elements: Record<string, ElementState> = {};
  for (const id of replay.elementIds) elements[id] = { completed: 0, queue: 0, running: 0, started: 0 };
  const pools: Record<string, { busy: number; capacity: number }> = {};
  for (const [id, capacity] of Object.entries(replay.pools)) pools[id] = { busy: 0, capacity };

  for (const activity of replay.activities) {
    const state = elements[activity.elementId];
    if (state === undefined || t < activity.enabledAt) continue;
    state.started += 1;
    const running = activity.startedAt !== null && t >= activity.startedAt && t < activity.endAt;
    if (running) {
      state.running += 1;
      for (const allocation of activity.allocations) {
        const pool = pools[allocation.resourceId];
        if (pool !== undefined) pool.busy += allocation.quantity;
      }
    } else if (t < (activity.startedAt ?? activity.endAt)) {
      state.queue += 1;
    }
    if (activity.completed && t >= activity.endAt) state.completed += 1;
  }

  // The nodes with no duration: crossing one counts as started and completed at the same instant.
  for (const passage of replay.passages) {
    const state = elements[passage.elementId];
    if (state === undefined || t < passage.at) continue;
    state.started += 1;
    state.completed += 1;
  }

  const tokens: { flowId: string; progress: number }[] = [];
  for (const move of replay.moves) {
    if (t < move.from || t >= move.to) continue;
    const overall = (t - move.from) / (move.to - move.from);
    const index = Math.min(move.flows.length - 1, Math.floor(overall * move.flows.length));
    tokens.push({
      flowId: move.flows[index] as string,
      progress: overall * move.flows.length - index,
    });
  }

  return { elements, pools, t, tokens };
}
