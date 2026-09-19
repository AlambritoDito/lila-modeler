/**
 * Pure replay model (#331): turns the event log of ONE replication into something a clock can be
 * scrubbed over. No DOM, no bpmn-js, no React — `ReplayOverlay.ts` paints what this returns and
 * `Replay.tsx` drives the clock.
 *
 * Activity counters come directly from EventLogRow (docs/RESULTS_FORMAT.md § 7).
 * Silent transitions are inferred only where the graph and observed activity occurrences
 * identify them. Each completed occurrence can release a token; a case is not a linear list.
 * End counters count tokens (result.elements), not case outcomes (process.byEndEvent).
 * See README.md for the limits of inference without token, flow or boundary rows.
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
  /** `endedAt` when it completed; `observedUntil` for `inFlight`/`terminated`/`interrupted`. */
  endAt: number;
  completed: boolean;
  /** Pool units held between `startedAt` and `endAt`, one entry per allocation row. */
  allocations: readonly { resourceId: string; quantity: number }[];
}

/** A token crossing a silent node: a start, gateway, boundary or end event. */
export interface ReplayPassage {
  elementId: string;
  /** An AND join can receive a token without releasing one. Defaults to one of each. */
  started?: number;
  completed?: number;
  /** Instant the token is counted at. */
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
  /** Observed elements followed by inferred silent nodes: the elements that get a counter. */
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

/** Internal lifecycle evidence; the public activity view remains unchanged. */
interface Occurrence extends ReplayActivity {
  instanceId: string;
  status: EventLogRow['status'];
}

/** Only tasks and unattached timers emit rows. A boundary is an instantaneous transition. */
function emitsRow(ir: ProcessIR, id: string): boolean {
  const node = ir.nodes[id];
  return node?.type === 'task' || (node?.type === 'timer' && node.attachedTo === undefined);
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
  const byInstance = new Map<string, Occurrence>();
  const elementIds: string[] = [];
  const pools: Record<string, number> = {};

  for (const row of rows) {
    if (row.replication !== 0) continue;
    let activity = byInstance.get(row.activityInstanceId);
    if (activity === undefined) {
      activity = {
        instanceId: row.activityInstanceId,
        status: row.status,
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
  const moves: ReplayMove[] = [];
  const passages: ReplayPassage[] = [];
  const cross = (id: string, at: number, completed = 1): void => {
    if (!elementIds.includes(id)) elementIds.push(id);
    passages.push({ at, elementId: id, completed });
  };
  const hop = (flows: readonly string[], at: number): void => {
    if (flows.length > 0) moves.push({ flows, from: at, to: at + travel });
  };
  const outputs = (id: string): readonly string[] => {
    const node = ir.nodes[id];
    if (node === undefined) return [];
    const flows = node.outgoing ?? [];
    return ['and', 'or', 'xor', 'eventGateway'].includes(node.type) ? flows : flows.slice(0, 1);
  };

  // First observable activities beyond a silent path, with route multiplicity capped at two.
  // A join is a barrier: downstream enabledAt does not tell us when one input arrived.
  const frontierCache = new Map<string, ReadonlyMap<string, number>>();
  const frontier = (id: string): ReadonlyMap<string, number> => {
    const cached = frontierCache.get(id);
    if (cached !== undefined) return cached;
    const found = new Map<string, number>();
    const visit = (current: string, seen: ReadonlySet<string>): void => {
      const node = ir.nodes[current];
      if (node === undefined || seen.has(current)) return;
      if (emitsRow(ir, current)) {
        found.set(current, Math.min(2, (found.get(current) ?? 0) + 1));
        return;
      }
      if (node.type === 'end' || node.type === 'terminate'
        || ((node.type === 'and' || node.type === 'or') && node.incoming.length > 1)) return;
      const nextSeen = new Set(seen).add(current);
      for (const flow of outputs(current)) {
        const target = ir.flows[flow]?.to;
        if (target !== undefined) visit(target, nextSeen);
      }
    };
    visit(id, new Set());
    frontierCache.set(id, found);
    return found;
  };
  const reachable = (from: string, to: string): boolean => outputs(from)
    .some((flow) => frontier(ir.flows[flow]?.to ?? '').has(to));

  const byCase = new Map<string, Occurrence[]>();
  for (const activity of activities) {
    const list = byCase.get(activity.caseId) ?? [];
    list.push(activity);
    byCase.set(activity.caseId, list);
  }
  for (const list of byCase.values()) {
    const enabledAt = new Map<number, Occurrence[]>();
    for (const activity of list) {
      const group = enabledAt.get(activity.enabledAt) ?? [];
      group.push(activity);
      enabledAt.set(activity.enabledAt, group);
    }
    type Source = { id: string; at: number; crossing: boolean };
    const sources: Source[] = list.filter((a) => a.completed)
      .map((a) => ({ id: a.elementId, at: a.endAt, crossing: false }));
    const firstAt = Math.min(...list.map((a) => a.enabledAt));
    const starts = Object.keys(ir.nodes).filter((id) => ir.nodes[id]?.type === 'start'
      && enabledAt.get(firstAt)!.some((a) => reachable(id, a.elementId)));
    if (starts.length === 1) sources.push({ id: starts[0]!, at: firstAt, crossing: true });

    const boundaries = Object.entries(ir.nodes).filter(([, node]) => node.attachedTo !== undefined);
    const candidates: { host: Occurrence; id: string; at: number; evidence: Occurrence[] }[] = [];
    for (const host of list) {
      const attached = boundaries.filter(([, node]) => node.attachedTo === host.elementId);
      const interrupting = attached.filter(([, node]) => node.interrupting !== false);
      for (const [id, node] of attached) {
        const evidence = list.filter((a) => a !== host && a.enabledAt >= host.enabledAt
          && a.enabledAt <= host.endAt && reachable(id, a.elementId)
          && (node.interrupting === false || a.enabledAt === host.endAt));
        if (node.interrupting !== false) {
          if (host.status !== 'interrupted') continue;
          // The interruption itself proves the firing when there is only one possible boundary.
          if (interrupting.length === 1 || evidence.length > 0) {
            candidates.push({ host, id, at: host.endAt, evidence });
          }
        } else {
          const times = [...new Set(evidence.map((a) => a.enabledAt))];
          if (times.length === 1) candidates.push({ host, id, at: times[0]!, evidence });
        }
      }
    }
    for (const candidate of candidates) {
      const node = ir.nodes[candidate.id]!;
      if (node.interrupting !== false) {
        if (candidates.filter((c) => c.host === candidate.host
          && ir.nodes[c.id]?.interrupting !== false).length !== 1) continue;
      } else {
        // A witness must belong uniquely to this firing, not a normal continuation, another
        // overlapping host occurrence, or a second boundary that reaches the same activity.
        const unique = candidate.evidence.some((a) =>
          !sources.some((source) => source.at === a.enabledAt && reachable(source.id, a.elementId))
          && candidates.filter((c) => c.evidence.includes(a)).length === 1);
        if (!unique) continue;
      }
      sources.push({ id: candidate.id, at: candidate.at, crossing: true });
    }

    const joins = new Map<string, number>();
    // Source ties need no invented token order: activities are barriers, and an AND join's
    // release is independent of the order of equal-time arrivals.
    sources.sort((a, b) => a.at - b.at);
    for (const source of sources) {
      const observations = enabledAt.get(source.at) ?? [];
      const walk = (id: string, flows: readonly string[], seen: ReadonlySet<string>): void => {
        const node = ir.nodes[id];
        if (node === undefined || seen.has(id)) return;
        if (emitsRow(ir, id)) {
          if (observations.some((a) => a.elementId === id)) hop(flows, source.at);
          return;
        }
        const nextSeen = new Set(seen).add(id);
        if (node.type === 'or' && node.incoming.length > 1) {
          // The log has no OR activation marks. Do not guess how many arrivals release it.
          hop(flows, source.at);
          return;
        }
        if (node.type === 'and' && node.incoming.length > 1) {
          hop(flows, source.at);
          const arrived = (joins.get(id) ?? 0) + 1;
          const released = arrived === node.incoming.length;
          joins.set(id, released ? 0 : arrived);
          cross(id, source.at, released ? 1 : 0);
          if (released) follow(id, [], nextSeen);
          return;
        }
        cross(id, source.at);
        if (node.type === 'end' || node.type === 'terminate') hop(flows, source.at);
        else follow(id, flows, nextSeen);
      };
      const follow = (id: string, flows: readonly string[], seen: ReadonlySet<string>): void => {
        const node = ir.nodes[id]!;
        let selected = outputs(id);
        if (selected.length > 1 && node.type !== 'and') {
          const evidenced = selected.filter((flow) => {
            const targets = frontier(ir.flows[flow]?.to ?? '');
            return observations.some((a) => targets.get(a.elementId) === 1
              // Equal-time sources can share an observation without revealing which token
              // chose this branch. Do not reuse one witness for both choices.
              && !sources.some((other) => other !== source && other.at === source.at
                && reachable(other.id, a.elementId))
              && selected.filter((other) => frontier(ir.flows[other]?.to ?? '').has(a.elementId)).length === 1);
          });
          selected = node.type === 'or' ? evidenced : evidenced.length === 1 ? evidenced : [];
        }
        if (selected.length !== 1) hop(flows, source.at);
        for (const flow of selected) {
          const target = ir.flows[flow]?.to;
          if (target !== undefined) walk(target, [...(selected.length === 1 ? flows : []), flow], seen);
        }
      };
      if (source.crossing) cross(source.id, source.at);
      follow(source.id, [], new Set([source.id]));
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
 * tokens in flight over the flows. At `t >= horizon` the counters contain all observed
 * activities and unambiguous inferred transitions, not aggregate case outcomes.
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

  // Silent transitions, including AND arrivals that have not released a token yet.
  for (const passage of replay.passages) {
    const state = elements[passage.elementId];
    if (state === undefined || t < passage.at) continue;
    state.started += passage.started ?? 1;
    state.completed += passage.completed ?? 1;
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
