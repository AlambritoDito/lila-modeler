/**
 * Outlines (#97): a process described as data — lanes plus an ordered list of steps with
 * branches — and the BPMN it stands for. This is what an agent writes instead of BPMN XML.
 *
 * `outlineToBpmn` builds the semantic BPMN with `bpmn-moddle`, lays it out with `layoutProcess`
 * from `bpmn-auto-layout` and validates it with `validateBpmnXml`. `bpmnToOutline` reads it back.
 * Browser-safe: no `node:*` here; the `.lila` side lives in `project-fs/outline.ts`.
 *
 * Lanes. `bpmn-auto-layout` 1.3 lays out the flow (columns and rows) but draws no pool and no
 * lanes: it ignores the `laneSet` and keeps the plane on the process. With lanes, this module
 * keeps its columns, moves every node into its lane's band (keeping the layouter's row order
 * inside the lane), routes the flows again orthogonally (around the shapes in their way) and adds
 * the pool and the lane shapes. Without lanes, the layouter's DI is used as it comes. Either way
 * every named flow gets a label on its own segment, not on a trunk it shares with its siblings.
 *
 * Normal form. `normalizeOutline` turns any accepted outline into one canonical shape, which is
 * also what `bpmnToOutline` returns, so a round trip compares equal:
 * - every step names its lane (when there are lanes), and so does every start;
 * - `type` is omitted for `task`; `next` only when it is not simply the following step;
 * - `end: true` (or `"terminate"` for a terminate end event) on every step that finishes the process;
 * - gateway successors are `branches` (an `eventGateway` always has them, even with one branch), with
 *   `default: true` on the default flow of an xor/or;
 * - `starts` is left out in the trivial case, a single plain start `StartEvent` with no name in the
 *   lane of its step, wherever that step is in the list: the normal form then moves that step to
 *   the head of the list (the others keep their order) and no step has `from`, which is also how
 *   `bpmnToOutline` reads a model with one plain start. Otherwise every start is listed (`type` only
 *   for `timer`) and the steps keep their order; `from` lists a step's starts in the order of
 *   `starts`, one id as a string and several as a list;
 * - `boundary` keeps its order, with `interrupting` only when it is `false`;
 * - `notes` keeps its order (when read, the document order of the associations), each text once;
 * - `data` lists the reads (`in`) first and then the writes (`out`), each group in its order;
 * - durations are scenario distributions in seconds, and the XOR probabilities that were left out
 *   share what is left of 1.
 *
 * Ids. Starts, steps and boundary events share one space of ids: unique and NCName. Only step ids
 * can be named by `next` and `to`, and only start ids by `from` (a `next` naming a start or a
 * boundary is "not the id of a step"). The ids of the end events Lila adds (`EndEvent_<step>`,
 * `EndEvent_<boundary>`) are reserved; when two generated ids would clash, the later one takes the
 * first free `_<n>` suffix, as flows do.
 *
 * Reading. `bpmnToOutline` never returns an outline that `normalizeOutline` would refuse: what an
 * outline cannot say is left out with a warning (e.g. probabilities on the flows of an `and` or an
 * `eventGateway`), never silently. In particular:
 * - only an event-based gateway in the simulator's profile (R-EVG-1: `eventGatewayProfile` and
 *   `isBranchCatchEvent` in `parse.ts`; exclusive, not instantiating, every branch an intermediate
 *   timer or message catch event with one way in and one way out) reads as an `eventGateway`, and
 *   only its message branches read as `message` steps; any other event-based gateway (an
 *   instantiating or parallel one, one with a branch to a receive task or to a catch event with
 *   several ways in or out) and any other message catch event is left out (`outlineUnsupported`),
 *   with its flows;
 * - only a boundary timer the simulator runs (`boundaryTimerHost` in `parse.ts`: on a task or a
 *   call activity, no incoming flow, one way out) reads as a `boundary`; one on a sub-process
 *   (#639), with an incoming flow or with several outgoing flows is left out;
 * - the timer expressions in the XML (`timeDuration`, `timeDate`, `timeCycle`) of timer starts,
 *   timer steps and boundary timers are left out: durations live in the scenario, never in the XML;
 * - text annotations with no text are left out, and so are those that repeat a text already
 *   attached to the same step (the step's `notes` keep it once).
 */
import { BpmnModdle } from 'bpmn-moddle';
import { z } from 'zod';

import lila from './lila.moddle.json' with { type: 'json' };
import { isNCName, marcarExportador } from './ids.js';
import { autoLayout, labelFlows, layOutLanes, LayoutError, separateSubprocessPlanes, sortOutgoing, type Create, type El } from './layout.js';
import { Diagram, everything, placeArtifacts } from './edit-layout.js';
import { validateBpmnXml } from './validate-report.js';
import type { ValidationResult } from './validate.js';
import { messages, type CliMessages, type Locale } from '../messages/index.js';
import { DistributionSchema, type Distribution } from '../scenario.js';
import type { ScenarioDocument } from '../project/types.js';
import { processSlug } from '../project/repository.js';
import {
  DISTRIBUTION_ALIASES,
  DISTRIBUTIONS,
  normalized,
  TIME_PARAMETERS,
  UNIT_ALIASES,
  UNITS,
} from '../scenario-sheets.js';

/* ------------------------------------------------------------------ *
 * The format
 * ------------------------------------------------------------------ */

export const OUTLINE_STEP_TYPES = [
  'task',
  'userTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'manualTask',
  'scriptTask',
  'businessRuleTask',
  'xor',
  'and',
  'or',
  'eventGateway',
  'timer',
  'message',
  'subprocess',
  'callActivity',
] as const;
export type OutlineStepType = (typeof OUTLINE_STEP_TYPES)[number];

/** `starts[].type`: a plain start event or a timer start event. */
export const OUTLINE_START_TYPES = ['none', 'timer'] as const;
/** `boundary[].type`: only the timer, the boundary event the simulator runs (SEMANTICS R-BND). */
export const OUTLINE_BOUNDARY_TYPES = ['timer'] as const;
/** `data[].direction`: the activity reads the data object (`in`) or writes it (`out`). */
export const OUTLINE_DATA_DIRECTIONS = ['in', 'out'] as const;

export const GATEWAYS: ReadonlySet<OutlineStepType> = new Set(['xor', 'and', 'or', 'eventGateway']);
/** Steps that do work: they take a duration, resources and boundary events. */
export const WORK: ReadonlySet<OutlineStepType> = new Set([
  'task',
  'userTask',
  'serviceTask',
  'sendTask',
  'receiveTask',
  'manualTask',
  'scriptTask',
  'businessRuleTask',
  'callActivity',
]);

/** The BPMN element of each step type (`timer` and `message` differ by their event definition). */
export const BPMN_TYPE: Readonly<Record<OutlineStepType, string>> = {
  task: 'bpmn:Task',
  userTask: 'bpmn:UserTask',
  serviceTask: 'bpmn:ServiceTask',
  sendTask: 'bpmn:SendTask',
  receiveTask: 'bpmn:ReceiveTask',
  manualTask: 'bpmn:ManualTask',
  scriptTask: 'bpmn:ScriptTask',
  businessRuleTask: 'bpmn:BusinessRuleTask',
  callActivity: 'bpmn:CallActivity',
  xor: 'bpmn:ExclusiveGateway',
  and: 'bpmn:ParallelGateway',
  or: 'bpmn:InclusiveGateway',
  eventGateway: 'bpmn:EventBasedGateway',
  timer: 'bpmn:IntermediateCatchEvent',
  message: 'bpmn:IntermediateCatchEvent',
  subprocess: 'bpmn:SubProcess',
};

const OutlineResourceSchema = z.union([
  z.string().min(1),
  z.strictObject({ name: z.string().min(1), quantity: z.int().min(1).optional() }),
]);

const OutlineDurationSchema = z
  .union([z.string().min(1), z.number().nonnegative(), DistributionSchema])
  .describe(
    'Seconds, "20m", "normal(20m, 5m)", "triangular(1m, 2m, 5m)", "exponential(mean=4m)", or a scenario distribution object in seconds.',
  );

/** `end`: `true` adds a plain end event; `"terminate"` a terminate end event, which ends the whole case. */
const OutlineEndSchema = z.union([z.boolean(), z.literal('terminate')]);

const OutlineBranchSchema = z.strictObject({
  label: z.string().optional().describe('Name of the flow, e.g. "Yes".'),
  to: z.string().min(1).optional().describe('Id of the step this branch goes to.'),
  end: OutlineEndSchema.optional().describe('true (or "terminate") instead of `to`: this branch ends the process.'),
  probability: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('XOR/OR only: probability of this branch in the base scenario. Left-out XOR branches share the rest.'),
  default: z
    .boolean()
    .optional()
    .describe('XOR/OR only: true marks the default flow of the gateway (one per gateway). In an xor it does not change the split; in an or it is the fallback when no other branch is taken.'),
});

export const OutlineStartSchema = z.strictObject({
  id: z.string().min(1).describe('BPMN id of the start event; its arrivals in the scenario key on it.'),
  name: z.string().optional(),
  type: z
    .enum(OUTLINE_START_TYPES)
    .optional()
    .describe('Defaults to none (a plain start event); timer is a timer start event, notation only: its cases come from the scenario arrivals, as with none.'),
  lane: z.string().optional().describe('Lane name; defaults to the lane of the step it leads to.'),
});

export const OutlineBoundarySchema = z.strictObject({
  id: z.string().min(1).describe('BPMN id of the boundary event; its delay in the scenario keys on it.'),
  type: z.enum(OUTLINE_BOUNDARY_TYPES).describe('timer: a deadline on the step.'),
  name: z.string().optional(),
  label: z.string().optional().describe('Name of the flow out of the boundary event, e.g. "Over 48 h".'),
  duration: OutlineDurationSchema.optional().describe(
    'The deadline, counted from the moment a case reaches the step (waiting for resources included). Without it the boundary never fires.',
  ),
  interrupting: z
    .boolean()
    .optional()
    .describe('true (default): the deadline cuts the step short. false: the step keeps running and a parallel path starts.'),
  to: z.string().min(1).optional().describe('Id of the step the boundary leads to.'),
  end: OutlineEndSchema.optional().describe('true (or "terminate") instead of `to`: the boundary path ends the process.'),
});

export const OutlineDataSchema = z.strictObject({
  name: z.string().min(1).describe('Name of the data object; steps naming the same one share it.'),
  direction: z.enum(OUTLINE_DATA_DIRECTIONS).describe('in: the step reads it. out: the step writes it.'),
});

const OutlineStepSchema = z.strictObject({
  id: z.string().min(1).describe('BPMN id of the step; scenarios key on it.'),
  name: z.string().optional(),
  lane: z.string().optional().describe('Lane name; defaults to the previous step\'s lane.'),
  type: z.enum(OUTLINE_STEP_TYPES).optional().describe('Defaults to task.'),
  from: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
    .describe('With `starts`: id(s) of the start event(s) that lead to this step.'),
  next: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
    .describe('Id(s) of the following step(s) when it is not simply the next one in the list.'),
  branches: z
    .array(OutlineBranchSchema)
    .min(1)
    .optional()
    .describe('Gateways only: outgoing branches. Those of an eventGateway go to timer or message steps that have no other way in.'),
  end: OutlineEndSchema.optional().describe('true: the process ends after this step. "terminate": it ends with a terminate end event.'),
  duration: OutlineDurationSchema.optional().describe(
    'Processing time (tasks) or delay (timer, message): seconds, "20m", "normal(20m, 5m)", "triangular(1m, 2m, 5m)", ' +
      '"exponential(mean=4m)", or a scenario distribution object in seconds.',
  ),
  resources: z
    .array(OutlineResourceSchema)
    .min(1)
    .optional()
    .describe('Resource names the task needs (one unit each), or {name, quantity}.'),
  selection: z
    .enum(['and', 'or'])
    .optional()
    .describe('With several resources: "and" needs all of them (default), "or" any one.'),
  boundary: z
    .array(OutlineBoundarySchema)
    .min(1)
    .optional()
    .describe('Tasks (any variant) and call activities only, not sub-processes: boundary events on the step (deadlines).'),
  notes: z
    .array(z.string().min(1))
    .min(1)
    .optional()
    .describe('Text annotations attached to the step, in order; each text once per step.'),
  data: z
    .array(OutlineDataSchema)
    .min(1)
    .optional()
    .describe('Activities only (tasks, call activities, sub-processes): data objects the step reads or writes; a name and direction once per step.'),
});

/** The outline as an agent writes it (#97). Exported for the MCP tools' input schema. */
export const OutlineSchema = z.strictObject({
  name: z.string().min(1).describe('Name of the process.'),
  lanes: z.array(z.string().min(1)).optional().describe('Lane names, top to bottom.'),
  starts: z
    .array(OutlineStartSchema)
    .min(1)
    .optional()
    .describe('Start events, when there is more than one or one is a timer; steps name theirs with `from`. Default: one plain start before the first step.'),
  steps: z.array(OutlineStepSchema).min(1).describe('The steps in flow order.'),
});

export type Outline = z.input<typeof OutlineSchema>;
export type OutlineStep = z.input<typeof OutlineStepSchema>;

export type NormalResource = string | { name: string; quantity: number };
export type OutlineStart = z.input<typeof OutlineStartSchema>;
export type OutlineBoundary = z.input<typeof OutlineBoundarySchema>;
export type OutlineData = z.input<typeof OutlineDataSchema>;

/** How a path ends: a plain end event, or a terminate end event that ends the whole case. */
export type NormalEnd = true | 'terminate';
export interface NormalBranch {
  label?: string;
  /** The step it goes to; absent when the branch ends the process (`end`). */
  to?: string;
  end?: NormalEnd;
  probability?: number;
  /** The gateway's default flow. */
  default?: true;
}
export interface NormalStart {
  id: string;
  name?: string;
  /** Omitted for a plain start event. */
  type?: 'timer';
  lane?: string;
}
export interface NormalBoundary {
  id: string;
  type: 'timer';
  name?: string;
  /** Name of the flow out of it. */
  label?: string;
  duration?: Distribution;
  /** Present only when it is `false` (the default is interrupting). */
  interrupting?: false;
  to?: string;
  end?: NormalEnd;
}
export interface NormalStep {
  id: string;
  name?: string;
  type?: Exclude<OutlineStepType, 'task'>;
  lane?: string;
  /** With `starts`: the start(s) that lead here (one id, or a list). */
  from?: string | string[];
  next?: string | string[];
  branches?: NormalBranch[];
  end?: NormalEnd;
  duration?: Distribution;
  resources?: NormalResource[];
  selection?: 'and' | 'or';
  boundary?: NormalBoundary[];
  notes?: string[];
  data?: OutlineData[];
}
/** The canonical outline (see the header): what `normalizeOutline` and `bpmnToOutline` return. */
export interface NormalOutline {
  name: string;
  lanes?: string[];
  /** Omitted in the trivial case: one plain start event `StartEvent`, with no name. */
  starts?: NormalStart[];
  steps: NormalStep[];
}

export interface OutlineIssue {
  /** Where: `steps[2].duration`, `lanes`, or `bpmn` for the generated model. */
  readonly path: string;
  readonly message: string;
}

/** Thrown by `normalizeOutline` and `outlineToBpmn`; nothing was built. */
export class OutlineError extends Error {
  readonly code = 'LILA-OUTLINE';
  constructor(
    message: string,
    readonly issues: readonly OutlineIssue[],
  ) {
    super(message);
    this.name = 'OutlineError';
  }
}

/* ------------------------------------------------------------------ *
 * The graph: what both directions share
 * ------------------------------------------------------------------ */

const END = Symbol('end');
interface Successor {
  to: string | typeof END;
  label?: string | undefined;
  probability?: number | undefined;
  /** The default flow of an xor/or. */
  default?: boolean | undefined;
  /** With `to: END`: the end is a terminate end event. */
  terminate?: boolean | undefined;
  /** The flow's id, when read from a BPMN. */
  id?: string | undefined;
  /** Where the outline named it, for issues (`steps[2].branches[0].to`). */
  path?: string | undefined;
}
/** A boundary timer on a step: its one way out is `to` (a step, or `END`). */
interface GraphBoundary {
  id: string;
  name: string;
  label?: string | undefined;
  duration?: Distribution | undefined;
  interrupting: boolean;
  to: string | typeof END;
  terminate?: boolean | undefined;
}
interface GraphStep {
  id: string;
  name: string;
  type: OutlineStepType;
  lane?: string | undefined;
  succ: Successor[];
  duration?: Distribution | undefined;
  resources?: { name: string; quantity: number }[] | undefined;
  selection?: 'and' | 'or' | undefined;
  boundary?: GraphBoundary[] | undefined;
  notes?: string[] | undefined;
  data?: OutlineData[] | undefined;
}
/** A start event and the one step it leads to. */
interface GraphStart {
  id: string;
  name: string;
  timer: boolean;
  lane?: string | undefined;
  to: string;
}
interface Graph {
  name: string;
  lanes: string[];
  /** Absent: one plain start `StartEvent` before the first step. */
  starts?: GraphStart[] | undefined;
  steps: GraphStep[];
}

function fail(C: CliMessages, issues: OutlineIssue[], wrap: (detail: string) => string = C.outlineInvalid): never {
  throw new OutlineError(wrap(issues.map((i) => `  ${i.path}: ${i.message}`).join('\n')), issues);
}

/* ------------------------------------------------------------------ *
 * Durations: the scenario distributions, written short
 * ------------------------------------------------------------------ */

/** `20m`, `1.5 h`, `90` (seconds): a time in seconds, or `null`. */
function seconds(text: string): number | null {
  // `1h30m`, `2 h 15 min`: several number-unit pairs add up.
  const parts = [...text.trim().matchAll(/([0-9]*\.?[0-9]+)\s*([a-zA-Zíá]+)\s*/g)];
  if (parts.length > 1 && parts.map((m) => m[0]).join('') === text.trim().replace(/^\s+/, '')) {
    let total = 0;
    for (const part of parts) {
      const one = seconds(`${part[1]}${part[2]}`);
      if (one === null) return null;
      total += one;
    }
    return total;
  }
  const match = /^([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*([a-zA-Zíá]*)$/.exec(text.trim());
  if (match === null) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  if (match[2] === '') return value;
  const unit = UNIT_ALIASES[normalized(match[2]!)];
  return unit === undefined ? null : value * UNITS[unit]!;
}

/**
 * `normal(20m, 5m)` → `{ type: 'normal', mean: 1200, sd: 300 }`. The names and spellings are the
 * scenario import's (`scenario-sheets.ts`: Spanish and Bizagi aliases, units), the parameters
 * positional in the order of `docs/SCENARIO_SCHEMA.md` § 3 or named (`mean=4m`), and the result
 * goes through the scenario's own `DistributionSchema`. `user` needs the object form.
 */
export function parseDuration(value: string | number | Distribution): Distribution | null {
  if (typeof value === 'number') return value >= 0 ? { type: 'constant', value } : null;
  if (typeof value !== 'string') {
    const parsed = DistributionSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  }
  const text = value.trim();
  const call = /^([A-Za-zÀ-ÿ ]+)\((.*)\)$/.exec(text);
  if (call === null) {
    const constant = seconds(text);
    return constant === null ? null : { type: 'constant', value: constant };
  }
  const type = DISTRIBUTION_ALIASES[normalized(call[1]!)];
  if (type === undefined || type === 'user') return null;
  const names = DISTRIBUTIONS[type]!;
  const args = call[2]!.trim() === '' ? [] : call[2]!.split(',').map((part) => part.trim());
  if (args.length !== names.length) return null;
  const distribution: Record<string, unknown> = { type };
  for (const [index, arg] of args.entries()) {
    const eq = arg.indexOf('=');
    const name = eq === -1 ? names[index]! : arg.slice(0, eq).trim();
    const raw = eq === -1 ? arg : arg.slice(eq + 1).trim();
    if (!names.includes(name) || name in distribution) return null;
    const number = TIME_PARAMETERS.has(name) ? seconds(raw) : /^-?[0-9]*\.?[0-9]+$/.test(raw) ? Number(raw) : null;
    if (number === null) return null;
    distribution[name] = number;
  }
  const parsed = DistributionSchema.safeParse(distribution);
  return parsed.success ? parsed.data : null;
}

/* ------------------------------------------------------------------ *
 * Outline → graph (with every check) and graph → normal form
 * ------------------------------------------------------------------ */

interface RawBranch {
  label?: string | undefined;
  to?: string | undefined;
  end?: boolean | 'terminate' | undefined;
  probability?: number | undefined;
  default?: boolean | undefined;
}
interface RawStart {
  id: string;
  name?: string | undefined;
  type?: (typeof OUTLINE_START_TYPES)[number] | undefined;
  lane?: string | undefined;
}
/** A boundary event as read, in an outline step or in `edit_process`'s `addBoundary`. */
export interface RawBoundary {
  id: string;
  type?: (typeof OUTLINE_BOUNDARY_TYPES)[number] | undefined;
  name?: string | undefined;
  label?: string | undefined;
  duration?: unknown;
  interrupting?: boolean | undefined;
  to?: string | undefined;
  end?: boolean | 'terminate' | undefined;
}
interface RawData {
  name: string;
  direction: (typeof OUTLINE_DATA_DIRECTIONS)[number];
}
interface RawStep {
  id: string;
  name?: string | undefined;
  lane?: string | undefined;
  type?: OutlineStepType | undefined;
  from?: string[] | undefined;
  /** `from` was written as one id (paths say `from`, not `from[0]`). */
  fromSingle?: boolean;
  next?: string[] | undefined;
  /** `next` was written as one id (paths say `next`, not `next[0]`). */
  nextSingle?: boolean;
  branches?: RawBranch[] | undefined;
  end?: boolean | 'terminate' | undefined;
  duration?: unknown;
  resources?: { name: string; quantity: number }[] | undefined;
  selection?: 'and' | 'or' | undefined;
  boundary?: RawBoundary[] | undefined;
  notes?: string[] | undefined;
  data?: RawData[] | undefined;
}
interface RawOutline {
  name: string;
  lanes?: string[] | undefined;
  starts?: RawStart[] | undefined;
  steps: RawStep[];
}

const STEP_KEYS = new Set([
  'id', 'name', 'lane', 'type', 'from', 'next', 'branches', 'end', 'duration', 'resources', 'selection', 'boundary', 'notes', 'data',
]);
const BRANCH_KEYS = new Set(['label', 'to', 'end', 'probability', 'default']);
const ROOT_KEYS = new Set(['name', 'lanes', 'starts', 'steps']);
const START_KEYS = new Set(['id', 'name', 'type', 'lane']);
const BOUNDARY_KEYS = new Set(['id', 'type', 'name', 'label', 'duration', 'interrupting', 'to', 'end']);
const DATA_KEYS = new Set(['name', 'direction']);

/** Probabilities in the normal form carry no floating-point noise (0.7, not 0.7000000000000001). */
const round9 = (value: number): number => Math.round(value * 1e9) / 1e9;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
/** `end` as read: `true` or `"terminate"` end the path; `false` or absent do not. */
const ends = (value: boolean | 'terminate' | undefined): boolean => value === true || value === 'terminate';

/**
 * The field readers `readOutline` is made of; each problem goes to `bad` (path, catalog message)
 * and the field reads as `undefined`. Shared with `edit.ts`: `addBoundary` takes a boundary as in
 * an outline.
 */
export function outlineReaders(C: CliMessages, bad: (path: string, message: string) => undefined) {
  const unknownKeys = (value: Record<string, unknown>, keys: ReadonlySet<string>, path: string): void => {
    for (const key of Object.keys(value)) if (!keys.has(key)) bad(path === '' ? key : `${path}.${key}`, C.outlineUnknownKey(key));
  };
  const text = (value: unknown, path: string): string | undefined =>
    value === undefined ? undefined : isText(value) ? value : bad(path, C.outlineNotText());
  /** A required non-empty text; `''` when it is missing or wrong. */
  const required = (value: unknown, path: string): string => (isText(value) ? value : (bad(path, C.outlineNotText()) ?? ''));
  const optionalString = (value: unknown, path: string): string | undefined =>
    value === undefined ? undefined : typeof value === 'string' ? value : bad(path, C.outlineNotText());
  const boolean = (value: unknown, path: string): boolean | undefined =>
    value === undefined ? undefined : typeof value === 'boolean' ? value : bad(path, C.outlineNotBoolean());
  const end = (value: unknown, path: string): boolean | 'terminate' | undefined =>
    value === undefined || typeof value === 'boolean' || value === 'terminate' ? value : bad(path, C.outlineBadEnd());
  /** One of `accepted`; required (a missing value is an issue too). */
  const choice = <T extends string>(value: unknown, accepted: readonly T[], path: string): T | undefined =>
    (accepted as readonly unknown[]).includes(value) ? (value as T) : bad(path, C.outlineBadChoice(accepted.join(', ')));
  /** A non-empty list, each entry read by `entry` (and left out when it is wrong). */
  const list = <T>(
    value: unknown,
    path: string,
    entry: (item: unknown, at: string) => T | undefined,
    notList: string = C.outlineNotList(),
  ): T[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length === 0) return bad(path, notList);
    const out: T[] = [];
    value.forEach((item, k) => {
      const read = entry(item, `${path}[${k}]`);
      if (read !== undefined) out.push(read);
    });
    return out;
  };
  const boundary = (value: unknown, at: string): RawBoundary | undefined => {
    if (!isObject(value)) return bad(at, C.outlineNotObject());
    unknownKeys(value, BOUNDARY_KEYS, at);
    const read: RawBoundary = {
      id: required(value['id'], `${at}.id`),
      type: choice(value['type'], OUTLINE_BOUNDARY_TYPES, `${at}.type`),
      name: optionalString(value['name'], `${at}.name`),
      label: optionalString(value['label'], `${at}.label`),
      duration: value['duration'],
      interrupting: boolean(value['interrupting'], `${at}.interrupting`),
      to: text(value['to'], `${at}.to`),
      end: end(value['end'], `${at}.end`),
    };
    // Exactly one way out: `to` a step, or `end`. Only checked when both fields read well.
    const readWell = (value['to'] === undefined || read.to !== undefined) && (value['end'] === undefined || read.end !== undefined);
    if (readWell && ends(read.end) === (read.to !== undefined)) {
      bad(at, C.outlineBoundaryTarget(read.id));
    }
    return read;
  };
  return { unknownKeys, text, required, optionalString, boolean, end, choice, list, boundary };
}

/**
 * Reads `input` in one pass, recording every problem as an issue with a catalog message and a
 * `steps[i].field` path, and dropping only the field that is wrong so the checks of `toGraph` still
 * run on the rest (QA of #553: every problem at once, in the caller's language).
 */
function readOutline(input: unknown, C: CliMessages, issues: OutlineIssue[]): RawOutline {
  const bad = (path: string, message: string): undefined => {
    issues.push({ path, message });
    return undefined;
  };
  const { unknownKeys, text, required, optionalString, boolean, end, choice, list, boundary } = outlineReaders(C, bad);

  if (!isObject(input)) {
    bad('(root)', C.outlineNotObject());
    return { name: '', steps: [] };
  }
  unknownKeys(input, ROOT_KEYS, '');
  const name = isText(input['name']) ? input['name'] : (bad('name', C.outlineNotText()) ?? '');
  let lanes: string[] | undefined;
  if (input['lanes'] !== undefined) {
    if (!Array.isArray(input['lanes'])) bad('lanes', C.outlineNotTextList());
    else {
      lanes = [];
      input['lanes'].forEach((lane, i) => (isText(lane) ? lanes!.push(lane) : bad(`lanes[${i}]`, C.outlineNotText())));
    }
  }
  const starts = list(input['starts'], 'starts', (value, at): RawStart | undefined => {
    if (!isObject(value)) return bad(at, C.outlineNotObject());
    unknownKeys(value, START_KEYS, at);
    return {
      id: required(value['id'], `${at}.id`),
      name: optionalString(value['name'], `${at}.name`),
      type: value['type'] === undefined ? undefined : choice(value['type'], OUTLINE_START_TYPES, `${at}.type`),
      lane: text(value['lane'], `${at}.lane`),
    };
  });
  if (!Array.isArray(input['steps']) || input['steps'].length === 0) {
    bad('steps', C.outlineNoSteps());
    return { name, lanes, starts, steps: [] };
  }

  const steps = (input['steps'] as unknown[]).map((value, index): RawStep => {
    const at = `steps[${index}]`;
    if (!isObject(value)) {
      bad(at, C.outlineNotObject());
      return { id: '' };
    }
    unknownKeys(value, STEP_KEYS, at);
    const step: RawStep = { id: isText(value['id']) ? value['id'] : (bad(`${at}.id`, C.outlineNotText()) ?? '') };
    step.name = optionalString(value['name'], `${at}.name`);
    step.lane = text(value['lane'], `${at}.lane`);
    if (value['type'] !== undefined) {
      if ((OUTLINE_STEP_TYPES as readonly unknown[]).includes(value['type'])) step.type = value['type'] as OutlineStepType;
      else bad(`${at}.type`, C.outlineBadType(String(value['type']), OUTLINE_STEP_TYPES.join(', ')));
    }
    const from = value['from'];
    if (isText(from)) {
      step.from = [from];
      step.fromSingle = true;
    } else if (Array.isArray(from) && from.length > 0 && from.every(isText)) step.from = from as string[];
    else if (from !== undefined) bad(`${at}.from`, C.outlineBadFrom());
    const next = value['next'];
    if (isText(next)) {
      step.next = [next];
      step.nextSingle = true;
    } else if (Array.isArray(next) && next.length > 0 && next.every(isText)) step.next = next as string[];
    else if (next !== undefined) bad(`${at}.next`, C.outlineBadNext());
    if (value['branches'] !== undefined) {
      if (!Array.isArray(value['branches']) || value['branches'].length === 0) bad(`${at}.branches`, C.outlineNoSteps());
      else {
        step.branches = (value['branches'] as unknown[]).map((b, k): RawBranch => {
          const bat = `${at}.branches[${k}]`;
          if (!isObject(b)) return bad(bat, C.outlineNotObject()) ?? {};
          unknownKeys(b, BRANCH_KEYS, bat);
          const probability = b['probability'];
          return {
            label: optionalString(b['label'], `${bat}.label`),
            to: text(b['to'], `${bat}.to`),
            end: end(b['end'], `${bat}.end`),
            probability:
              probability === undefined
                ? undefined
                : typeof probability === 'number' && probability >= 0 && probability <= 1
                  ? probability
                  : bad(`${bat}.probability`, C.outlineNotProbability()),
            default: boolean(b['default'], `${bat}.default`),
          };
        });
      }
    }
    step.end = end(value['end'], `${at}.end`);
    step.duration = value['duration'];
    if (value['resources'] !== undefined) {
      if (!Array.isArray(value['resources']) || value['resources'].length === 0) bad(`${at}.resources`, C.outlineBadResource());
      else {
        step.resources = [];
        (value['resources'] as unknown[]).forEach((r, k) => {
          const rat = `${at}.resources[${k}]`;
          if (isText(r)) return void step.resources!.push({ name: r, quantity: 1 });
          if (!isObject(r) || !isText(r['name'])) return void bad(rat, C.outlineBadResource());
          unknownKeys(r, new Set(['name', 'quantity']), rat);
          const quantity = r['quantity'] ?? 1;
          if (!Number.isInteger(quantity) || (quantity as number) < 1) return void bad(`${rat}.quantity`, C.outlineNotQuantity());
          step.resources!.push({ name: r['name'], quantity: quantity as number });
        });
      }
    }
    if (value['selection'] !== undefined) {
      if (value['selection'] === 'and' || value['selection'] === 'or') step.selection = value['selection'];
      else bad(`${at}.selection`, C.outlineBadSelection());
    }
    step.boundary = list(value['boundary'], `${at}.boundary`, boundary);
    step.notes = list(value['notes'], `${at}.notes`, (note, nat) => (isText(note) ? note : bad(nat, C.outlineNotText())), C.outlineNotTextList());
    step.data = list(value['data'], `${at}.data`, (entry, dat): RawData | undefined => {
      if (!isObject(entry)) return bad(dat, C.outlineNotObject());
      unknownKeys(entry, DATA_KEYS, dat);
      const dataName = required(entry['name'], `${dat}.name`);
      const direction = choice(entry['direction'], OUTLINE_DATA_DIRECTIONS, `${dat}.direction`);
      return dataName === '' || direction === undefined ? undefined : { name: dataName, direction };
    });
    return step;
  });
  return { name, lanes, starts, steps };
}

function toGraph(input: unknown, C: CliMessages): Graph {
  const issues: OutlineIssue[] = [];
  const outline = readOutline(input, C, issues);
  const at = (index: number, field?: string): string => `steps[${index}]${field === undefined ? '' : `.${field}`}`;

  const lanes = [...(outline.lanes ?? [])];
  const seenLanes = new Set<string>();
  for (const lane of lanes) {
    if (seenLanes.has(lane)) issues.push({ path: 'lanes', message: C.outlineDuplicateLane(lane) });
    seenLanes.add(lane);
  }
  const declared = outline.lanes !== undefined;

  // Starts, steps and boundary events share one space of ids; only step ids are targets.
  const ids = new Set<string>();
  const taken = new Set<string>();
  const claim = (id: string, path: string): void => {
    if (id === '') return;
    if (!isNCName(id)) issues.push({ path, message: C.outlineBadId(id) });
    if (taken.has(id)) issues.push({ path, message: C.outlineDuplicateId(id) });
    taken.add(id);
  };
  outline.starts?.forEach((start, i) => claim(start.id, `starts[${i}].id`));
  for (const [index, step] of outline.steps.entries()) {
    claim(step.id, at(index, 'id'));
    if (step.id !== '') ids.add(step.id);
    step.boundary?.forEach((b, k) => claim(b.id, at(index, `boundary[${k}].id`)));
  }

  // Starts: their lanes follow the steps' rule; each one leads to exactly one step (`from`).
  const startIds = new Set((outline.starts ?? []).map((start) => start.id));
  outline.starts?.forEach((start, i) => {
    if (start.lane === undefined || seenLanes.has(start.lane)) return;
    if (declared) issues.push({ path: `starts[${i}].lane`, message: C.outlineStartUnknownLane(start.id, start.lane) });
    else {
      lanes.push(start.lane);
      seenLanes.add(start.lane);
    }
  });
  const ledBy = new Map<string, string[]>();
  outline.steps.forEach((step, index) => {
    if (step.from === undefined) return;
    if (outline.starts === undefined) return void issues.push({ path: at(index, 'from'), message: C.outlineFromWithoutStarts(step.id) });
    step.from.forEach((start, k) => {
      const path = at(index, step.fromSingle === true ? 'from' : `from[${k}]`);
      if (!startIds.has(start)) issues.push({ path, message: C.outlineUnknownStart(step.id, start) });
      else (ledBy.get(start) ?? ledBy.set(start, []).get(start)!).push(step.id);
    });
  });
  outline.starts?.forEach((start, i) => {
    if (start.id === '') return;
    const led = ledBy.get(start.id) ?? [];
    if (led.length === 0) issues.push({ path: `starts[${i}]`, message: C.outlineStartUnused(start.id) });
    else if (led.length > 1) issues.push({ path: `starts[${i}]`, message: C.outlineStartManySteps(start.id, led.join(', ')) });
  });

  let previousLane: string | undefined;
  const steps: GraphStep[] = outline.steps.map((step, index) => {
    const type = step.type ?? 'task';
    const gateway = GATEWAYS.has(type);

    let lane = step.lane ?? previousLane;
    if (step.lane !== undefined && !seenLanes.has(step.lane)) {
      if (declared) issues.push({ path: at(index, 'lane'), message: C.outlineUnknownLane(step.id, step.lane) });
      else {
        lanes.push(step.lane);
        seenLanes.add(step.lane);
      }
    }
    if (lane === undefined && lanes.length > 0) lane = lanes[0];
    previousLane = lane;

    if (ends(step.end) && (step.next !== undefined || step.branches !== undefined)) {
      issues.push({ path: at(index, 'end'), message: C.outlineEndWithNext(step.id) });
    }
    if (step.branches !== undefined && !gateway) {
      issues.push({ path: at(index, 'branches'), message: C.outlineBranchesNeedGateway(step.id, type) });
    }
    if (step.branches !== undefined && step.next !== undefined) {
      issues.push({ path: at(index, 'next'), message: C.outlineEndWithNext(step.id) });
    }
    const nextList = step.next;
    if (nextList !== undefined && nextList.length > 1 && !gateway) {
      issues.push({ path: at(index, 'next'), message: C.outlineManyNextNeedGateway(step.id) });
    }

    let succ: Successor[];
    if (ends(step.end)) succ = [{ to: END, terminate: step.end === 'terminate' || undefined, path: at(index, 'end') }];
    else if (step.branches !== undefined) {
      succ = step.branches.map((b, k) => {
        if (ends(b.end) === (b.to !== undefined)) {
          issues.push({ path: at(index, `branches[${k}]`), message: C.outlineBranchTarget(step.id) });
        }
        // `default` marks the fallback flow of an xor/or; the branches of an eventGateway carry no
        // probability: the first event to happen wins (R-EVG).
        if (b.default === true && type !== 'xor' && type !== 'or') {
          issues.push({ path: at(index, `branches[${k}].default`), message: C.outlineFieldNotApplicable(step.id, 'default', type) });
        }
        if (b.probability !== undefined && type === 'eventGateway') {
          issues.push({ path: at(index, `branches[${k}].probability`), message: C.outlineFieldNotApplicable(step.id, 'probability', type) });
        }
        const path = at(index, `branches[${k}].${b.to === undefined ? 'end' : 'to'}`);
        return {
          to: b.to ?? END,
          label: b.label,
          probability: b.probability,
          default: b.default === true || undefined,
          terminate: (b.to === undefined && b.end === 'terminate') || undefined,
          path,
        };
      });
      if (step.branches.filter((b) => b.default === true).length > 1) {
        issues.push({ path: at(index, 'branches'), message: C.outlineManyDefaults(step.id) });
      }
    } else if (nextList !== undefined) {
      succ = nextList.map((to, k) => ({ to, path: at(index, step.nextSingle === true ? 'next' : `next[${k}]`) }));
    }
    else {
      const following = outline.steps[index + 1];
      succ = [{ to: following === undefined ? END : following.id }];
    }
    for (const s of succ) {
      if (s.to !== END && !ids.has(s.to)) {
        issues.push({ path: s.path ?? at(index, 'next'), message: C.outlineUnknownTarget(step.id, s.to) });
      }
    }

    // Branch probabilities: never on AND; the XOR ones left out share what is left of 1.
    const given = succ.filter((s) => s.probability !== undefined);
    if (given.length > 0 && type === 'and') {
      issues.push({ path: at(index, 'branches'), message: C.outlineProbabilityOnAnd(step.id) });
    }
    if (given.length > 0 && type === 'xor') {
      const sum = given.reduce((total, s) => total + s.probability!, 0);
      if (sum > 1 + 1e-9) issues.push({ path: at(index, 'branches'), message: C.outlineProbabilitySum(step.id, Math.round(sum * 1e9) / 1e9) });
      const open = succ.filter((s) => s.probability === undefined);
      for (const s of open) s.probability = round9(Math.max(0, 1 - sum) / open.length);
    }

    let duration: Distribution | undefined;
    if (step.duration !== undefined) {
      if (!WORK.has(type) && type !== 'timer' && type !== 'message') {
        issues.push({ path: at(index, 'duration'), message: C.outlineFieldNotApplicable(step.id, 'duration', type) });
      }
      duration = parseDuration(step.duration as string | number | Distribution) ?? undefined;
      if (duration === undefined) {
        issues.push({
          path: at(index, 'duration'),
          message: C.outlineBadDuration(step.id, typeof step.duration === 'string' ? step.duration : JSON.stringify(step.duration)),
        });
      }
    }
    if (step.resources !== undefined && !WORK.has(type)) {
      issues.push({ path: at(index, 'resources'), message: C.outlineFieldNotApplicable(step.id, 'resources', type) });
    }
    if (step.selection !== undefined && (step.resources === undefined || !WORK.has(type))) {
      issues.push({ path: at(index, 'selection'), message: C.outlineFieldNotApplicable(step.id, 'selection', type) });
    }
    let boundary: GraphBoundary[] | undefined;
    if (step.boundary !== undefined) {
      // A task (any variant) or a call activity; a sub-process is #639.
      if (!WORK.has(type)) issues.push({ path: at(index, 'boundary'), message: C.outlineFieldNotApplicable(step.id, 'boundary', type) });
      boundary = step.boundary.map((b, k): GraphBoundary => {
        const bat = at(index, `boundary[${k}]`);
        if (b.to !== undefined && !ids.has(b.to)) issues.push({ path: `${bat}.to`, message: C.outlineUnknownTarget(step.id, b.to) });
        let delay: Distribution | undefined;
        if (b.duration !== undefined) {
          delay = parseDuration(b.duration as string | number | Distribution) ?? undefined;
          if (delay === undefined) {
            const shown = typeof b.duration === 'string' ? b.duration : JSON.stringify(b.duration);
            issues.push({ path: `${bat}.duration`, message: C.outlineBadDuration(b.id, shown) });
          }
        }
        return {
          id: b.id,
          name: b.name ?? '',
          label: b.label,
          duration: delay,
          interrupting: b.interrupting !== false,
          to: b.to ?? END,
          terminate: (b.to === undefined && b.end === 'terminate') || undefined,
        };
      });
    }
    if (step.data !== undefined) {
      if (!WORK.has(type) && type !== 'subprocess') {
        issues.push({ path: at(index, 'data'), message: C.outlineFieldNotApplicable(step.id, 'data', type) });
      }
      const seen = new Set<string>();
      step.data.forEach((d, k) => {
        const key = `${d.direction}:${d.name}`;
        if (seen.has(key)) issues.push({ path: at(index, `data[${k}]`), message: C.outlineDuplicateData(step.id, d.name, d.direction) });
        seen.add(key);
      });
    }
    if (step.notes !== undefined) {
      // One annotation per text and step, so `removeAnnotation { on, text }` is never ambiguous.
      const seen = new Set<string>();
      step.notes.forEach((note, k) => {
        if (seen.has(note)) issues.push({ path: at(index, `notes[${k}]`), message: C.outlineDuplicateNote(step.id, note) });
        seen.add(note);
      });
    }

    return {
      id: step.id,
      name: step.name ?? '',
      type,
      lane,
      succ,
      duration,
      resources: step.resources,
      selection: step.selection,
      boundary,
      notes: step.notes,
      data: step.data,
    };
  });

  // The event gateway (R-EVG-1): every way out (a branch, `next` or the following step) goes to a
  // timer or message step whose only way in is that gateway; and a message step only ever follows
  // one. Ways in: the flows of steps, the `from` of starts (or the implicit start before the first
  // step), and the `to` of boundary events.
  const byId = new Map(steps.map((step) => [step.id, step]));
  const waysIn = new Map<string, string[]>();
  const wayIn = (to: string, from: string): void => void (waysIn.get(to) ?? waysIn.set(to, []).get(to)!).push(from);
  if (outline.starts === undefined && steps[0] !== undefined) wayIn(steps[0].id, START_ID);
  outline.steps.forEach((step) => step.from?.forEach((start) => wayIn(step.id, start)));
  for (const step of steps) for (const s of step.succ) if (s.to !== END) wayIn(s.to, step.id);
  outline.steps.forEach((step) => step.boundary?.forEach((b) => b.to !== undefined && wayIn(b.to, b.id)));
  steps.forEach((step, index) => {
    if (step.type === 'eventGateway') {
      for (const s of step.succ) {
        const target = s.to === END ? undefined : byId.get(s.to);
        if (s.to !== END && target === undefined) continue; // reported as an unknown target
        if (target === undefined || (target.type !== 'timer' && target.type !== 'message')) {
          issues.push({ path: s.path ?? at(index), message: C.outlineEventGatewayTarget(step.id, s.to === END ? 'end' : String(s.to)) });
        } else if ((waysIn.get(target.id) ?? []).length !== 1) {
          issues.push({ path: s.path ?? at(index), message: C.outlineEventTargetWaysIn(target.id, step.id, waysIn.get(target.id)!.join(', ')) });
        }
      }
    }
    if (step.type === 'message' && !(waysIn.get(step.id) ?? []).some((from) => byId.get(from)?.type === 'eventGateway')) {
      issues.push({ path: at(index, 'type'), message: C.outlineMessageNeedsEventGateway(step.id) });
    }
  });

  // A step from which no path reaches an end would trap its cases forever (QA of #553): reverse
  // reachability from the ends, one issue per stuck step. Only meaningful once every target is known.
  if (issues.length === 0) {
    const reaches = new Set<string>();
    for (let grew = true; grew; ) {
      grew = false;
      for (const step of steps) {
        if (reaches.has(step.id)) continue;
        if (step.succ.some((s) => s.to === END || reaches.has(s.to))) {
          reaches.add(step.id);
          grew = true;
        }
      }
    }
    steps.forEach((step, index) => {
      if (!reaches.has(step.id)) issues.push({ path: at(index), message: C.outlineNoWayOut(step.id) });
    });
  }

  if (issues.length > 0) fail(C, issues);
  // Lanes named only further down the list: the steps before them go to the first lane.
  if (lanes.length > 0) for (const step of steps) step.lane ??= lanes[0];
  // Each start goes to the lane of its step unless it names one.
  const starts = outline.starts?.map((start): GraphStart => {
    const to = ledBy.get(start.id)![0]!;
    return { id: start.id, name: start.name ?? '', timer: start.type === 'timer', lane: start.lane ?? byId.get(to)!.lane, to };
  });
  return { name: outline.name, lanes, starts, steps };
}

/** How a path that ends is written: `true`, or `"terminate"` for a terminate end event. */
const endOf = (s: { terminate?: boolean | undefined }): NormalEnd => (s.terminate === true ? 'terminate' : true);

/**
 * The trivial start (see the header): one plain start `StartEvent` with no name, in the lane of its
 * step. The outline leaves it out and puts its step first.
 */
function trivialStart(graph: Graph): GraphStart | undefined {
  const only = graph.starts?.length === 1 ? graph.starts[0]! : undefined;
  if (only === undefined || only.id !== START_ID || only.name !== '' || only.timer) return undefined;
  const step = graph.steps.find((s) => s.id === only.to);
  return step !== undefined && (graph.lanes.length === 0 || only.lane === step.lane) ? only : undefined;
}

function toNormal(graph: Graph): NormalOutline {
  // The order of the steps only matters for the implicit start: `next` is written whenever the
  // successor is not the following step, so moving the trivial start's step first changes nothing.
  const trivial = trivialStart(graph);
  const ordered = trivial === undefined ? graph.steps : [...graph.steps].sort((a, b) => Number(b.id === trivial.to) - Number(a.id === trivial.to));
  const starts = graph.starts !== undefined && graph.starts.length > 0 && trivial === undefined ? graph.starts : undefined;
  const steps = ordered.map((step, index): NormalStep => {
    const out: NormalStep = { id: step.id };
    if (step.name !== '') out.name = step.name;
    if (step.type !== 'task') out.type = step.type;
    if (graph.lanes.length > 0 && step.lane !== undefined) out.lane = step.lane;
    const from = (starts ?? []).filter((s) => s.to === step.id).map((s) => s.id);
    if (from.length > 0) out.from = from.length === 1 ? from[0]! : from;

    const following = ordered[index + 1]?.id;
    const decorated = step.succ.some((s) => s.label !== undefined || s.probability !== undefined || s.default === true);
    const toSteps = step.succ.filter((s): s is Successor & { to: string } => s.to !== END);
    // An eventGateway always lists its branches, even a single one: its targets are branch targets.
    if (GATEWAYS.has(step.type) && (step.type === 'eventGateway' || step.succ.length > 1 || decorated)) {
      out.branches = step.succ.map((s) => {
        const branch: NormalBranch = s.to === END ? { end: endOf(s) } : { to: s.to };
        if (s.label !== undefined && s.label !== '') branch.label = s.label;
        if (s.probability !== undefined) branch.probability = round9(s.probability);
        if (s.default === true) branch.default = true;
        return branch;
      });
    } else if (toSteps.length === 0) {
      // Only the end, or no successor at all (a dead end in a foreign BPMN): never "the next one".
      out.end = step.succ.some((s) => s.terminate === true) ? 'terminate' : true;
    } else if (toSteps.length === 1 && toSteps[0]!.to === following) {
      // the implicit successor
    } else if (toSteps.length === 1) out.next = toSteps[0]!.to;
    else if (toSteps.length > 1) out.next = toSteps.map((s) => s.to);

    if (step.duration !== undefined) out.duration = step.duration;
    if (step.resources !== undefined && step.resources.length > 0) {
      out.resources = step.resources.map((r) => (r.quantity === 1 ? r.name : { name: r.name, quantity: r.quantity }));
    }
    if (step.selection !== undefined) out.selection = step.selection;
    if (step.boundary !== undefined && step.boundary.length > 0) {
      out.boundary = step.boundary.map((b) => {
        const boundary: NormalBoundary = { id: b.id, type: 'timer' };
        if (b.name !== '') boundary.name = b.name;
        if (b.label !== undefined && b.label !== '') boundary.label = b.label;
        if (b.duration !== undefined) boundary.duration = b.duration;
        if (!b.interrupting) boundary.interrupting = false;
        if (b.to === END) boundary.end = endOf(b);
        else boundary.to = b.to;
        return boundary;
      });
    }
    if (step.notes !== undefined && step.notes.length > 0) out.notes = [...step.notes];
    if (step.data !== undefined && step.data.length > 0) {
      // Reads first, then writes, each group in its order.
      out.data = [...step.data.filter((d) => d.direction === 'in'), ...step.data.filter((d) => d.direction === 'out')].map((d) => ({
        name: d.name,
        direction: d.direction,
      }));
    }
    return out;
  });
  const normal = { name: graph.name } as NormalOutline;
  if (graph.lanes.length > 0) normal.lanes = [...graph.lanes];
  if (starts !== undefined) {
    normal.starts = starts.map((s) => {
      const start: NormalStart = { id: s.id };
      if (s.name !== '') start.name = s.name;
      if (s.timer) start.type = 'timer';
      if (graph.lanes.length > 0 && s.lane !== undefined) start.lane = s.lane;
      return start;
    });
  }
  normal.steps = steps;
  return normal;
}

/** Checks `input` and returns its normal form (see the header). Throws `OutlineError`. */
export function normalizeOutline(input: unknown, options: { locale?: Locale | undefined } = {}): NormalOutline {
  return toNormal(toGraph(input, messages(options.locale ?? 'en').cli));
}

/* ------------------------------------------------------------------ *
 * Outline → BPMN
 * ------------------------------------------------------------------ */


const START_ID = 'StartEvent';
/** The naive id of the `k`-th end event after `step` (a gateway may have several branches that end). */
const endId = (step: string, k = 1): string => (k === 1 ? `EndEvent_${step}` : `EndEvent_${step}_${k}`);
const endCount = (step: GraphStep): number => step.succ.filter((s) => s.to === END).length;


export interface OutlineToBpmnOptions {
  locale?: Locale | undefined;
  /** Id of the `bpmn:process`. Default `Process_1`. */
  processId?: string | undefined;
}

export interface OutlineBpmn {
  /** The laid-out BPMN, already validated (no errors). */
  readonly xml: string;
  /** The base scenario (`as-is.scenario.json`): arrivals plus every duration, resource and probability given. */
  readonly scenario: ScenarioDocument;
  /** The validator's warnings on the generated model. */
  readonly warnings: ValidationResult['warnings'];
  /** Lila's own warnings on the outline, e.g. a parallel join behind an exclusive split. */
  readonly notes: readonly string[];
  /** The outline in normal form. */
  readonly outline: NormalOutline;
}

/**
 * A parallel join that waits for branches of one exclusive split, which only ever sends a case
 * down one of them: the simulation reports it (W-JOIN-BLOQUEADO) but only after running. Each
 * incoming path is followed back through plain one-in steps to the gateway it comes from. An
 * exclusive split is an `xor` or an `eventGateway` (the first event wins), and so is a task with
 * an interrupting boundary event: its normal way out and the boundary's path never both run.
 */
function joinNotes(graph: Graph, C: CliMessages): string[] {
  const incoming = new Map<string, string[]>();
  const wayIn = (to: string, from: string): void => void (incoming.get(to) ?? incoming.set(to, []).get(to)!).push(from);
  for (const step of graph.steps) for (const s of step.succ) if (s.to !== END) wayIn(s.to, step.id);
  // The path out of a boundary event comes from its host: the host is where the paths split.
  for (const step of graph.steps) for (const b of step.boundary ?? []) if (b.to !== END) wayIn(b.to, step.id);
  const byId = new Map(graph.steps.map((step) => [step.id, step]));
  const splits = (id: string): boolean => GATEWAYS.has(byId.get(id)!.type) || (byId.get(id)!.boundary ?? []).length > 0;
  const notes: string[] = [];
  for (const join of graph.steps) {
    const from = incoming.get(join.id) ?? [];
    if (join.type !== 'and' || from.length < 2) continue;
    const origins = from.map((id) => {
      let current = id;
      const seen = new Set<string>();
      while (!splits(current) && (incoming.get(current) ?? []).length === 1 && !seen.has(current)) {
        seen.add(current);
        current = incoming.get(current)![0]!;
      }
      return current;
    });
    const exclusive = (id: string): boolean => {
      const step = byId.get(id)!;
      return step.type === 'xor' || step.type === 'eventGateway' || (step.boundary ?? []).some((b) => b.interrupting);
    };
    const split = origins.find((id, i) => exclusive(id) && origins.indexOf(id) !== i);
    if (split !== undefined) notes.push(C.outlineXorAndJoin(join.id, split));
  }
  return notes;
}

/**
 * Default arrivals of the base scenario: the web app's `defaultElement('start')` (`apps/web/src/
 * project.ts`, #420), so a generated process runs out of the box like one drawn with «New».
 */
const DEFAULT_ARRIVALS = { triggerCount: 20, interTriggerTimer: { type: 'constant', value: 60 } } as const;
/** The web app's `defaultScenarios` run block, without the currency. */
const DEFAULT_RUN = {
  start: '2026-09-07T08:00:00Z',
  duration: 3600,
  warmup: 0,
  replications: 3,
  seed: 42,
  baseTimeUnit: 'min',
} as const;

/** `base`, or `base_2`, `base_3`… the first one not in `used` (which then holds it). */
function freeId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  used.add(id);
  return id;
}

const flowId = (source: string, target: string, used: Set<string>): string => freeId(`Flow_${source}_${target}`, used);

interface Built {
  definitions: El;
  /** step id (or start/end id) → lane name */
  laneOf: Map<string, string>;
  /** semantic flows in creation order, with what the scenario needs */
  flows: { id: string; source: string; probability?: number | undefined }[];
}

function buildSemantic(graph: Graph, processId: string, C: CliMessages): Built {
  const moddle = BpmnModdle({ lila });
  const create = (type: string, attrs: Record<string, unknown> = {}): El => moddle.create(type, attrs) as El;

  // Ids Lila generates must not clash with an id of the outline (a start, a step, a boundary event),
  // nor with the `<id>_di` of the diagram.
  const fixed = new Set<string>(['Definitions_1', processId, 'Collaboration_1', 'Participant_1', 'LaneSet_1']);
  if (graph.starts === undefined) fixed.add(START_ID);
  graph.lanes.forEach((_, i) => fixed.add(`Lane_${i + 1}`));
  for (const step of graph.steps) {
    if (step.type === 'subprocess') for (const part of ['start', 'end', 'flow']) fixed.add(`${step.id}_${part}`);
  }
  const generated = new Set<string>(fixed);
  for (const step of graph.steps) {
    for (let k = 1; k <= endCount(step); k++) generated.add(endId(step.id, k));
    for (const b of step.boundary ?? []) if (b.to === END) generated.add(endId(b.id));
  }
  const issues: OutlineIssue[] = [];
  const own: { id: string; path: string }[] = [
    ...(graph.starts ?? []).map((start, i) => ({ id: start.id, path: `starts[${i}].id` })),
    ...graph.steps.flatMap((step, index) => [
      { id: step.id, path: `steps[${index}].id` },
      ...(step.boundary ?? []).map((b, k) => ({ id: b.id, path: `steps[${index}].boundary[${k}].id` })),
    ]),
  ];
  const ownIds = new Set(own.map((o) => o.id));
  for (const { id, path } of own) {
    const base = id.endsWith('_di') ? id.slice(0, -3) : undefined;
    const clash = generated.has(id) || /^(Flow|BPMNPlane|BPMNDiagram)_/.test(id) || (base !== undefined && (ownIds.has(base) || generated.has(base)));
    if (clash) issues.push({ path, message: C.outlineReservedId(id) });
  }
  if (issues.length > 0) fail(C, issues);

  const process = create('bpmn:Process', { id: processId, name: graph.name, isExecutable: false, flowElements: [] });
  const nodes = new Map<string, El>();
  const laneOf = new Map<string, string>();
  const add = (el: El, lane: string | undefined): El => {
    process['flowElements'].push(el);
    nodes.set(el.id, el);
    if (lane !== undefined) laneOf.set(el.id, lane);
    return el;
  };
  const definition = (type: string): El[] => [create(type)];

  const first = graph.steps[0]!;
  const starts: GraphStart[] = graph.starts ?? [{ id: START_ID, name: '', timer: false, lane: first.lane, to: first.id }];
  for (const start of starts) {
    const attrs: Record<string, unknown> = { id: start.id };
    if (start.name !== '') attrs['name'] = start.name;
    if (start.timer) attrs['eventDefinitions'] = definition('bpmn:TimerEventDefinition');
    add(create('bpmn:StartEvent', attrs), start.lane);
  }
  for (const step of graph.steps) {
    const attrs: Record<string, unknown> = { id: step.id };
    if (step.name !== '') attrs['name'] = step.name;
    if (step.type === 'timer') attrs['eventDefinitions'] = definition('bpmn:TimerEventDefinition');
    if (step.type === 'message') attrs['eventDefinitions'] = definition('bpmn:MessageEventDefinition');
    const el = add(create(BPMN_TYPE[step.type], attrs), step.lane);
    if (step.type === 'subprocess') {
      // The simulator flattens an embedded sub-process through its start and end (SEMANTICS § 4):
      // an empty one would have nowhere to go, so it gets a pass-through start → end.
      const start = create('bpmn:StartEvent', { id: `${step.id}_start` });
      const end = create('bpmn:EndEvent', { id: `${step.id}_end` });
      const flow = create('bpmn:SequenceFlow', { id: `${step.id}_flow`, sourceRef: start, targetRef: end });
      start['outgoing'] = [flow];
      end['incoming'] = [flow];
      el['flowElements'] = [start, end, flow];
    }
  }
  // Boundary timers sit in the lane of their host; `cancelActivity="false"` only when they do not
  // interrupt it (the attribute's default is true).
  for (const step of graph.steps) {
    for (const b of step.boundary ?? []) {
      const attrs: Record<string, unknown> = { id: b.id, attachedToRef: nodes.get(step.id), eventDefinitions: definition('bpmn:TimerEventDefinition') };
      if (b.name !== '') attrs['name'] = b.name;
      if (!b.interrupting) attrs['cancelActivity'] = false;
      add(create('bpmn:BoundaryEvent', attrs), step.lane);
    }
  }
  // The end ids, allocated so they never clash with each other: the second end of `x` and the first
  // of a step `x_2` are both `EndEvent_x_2`, so the later one takes a free suffix (`EndEvent_x_2_2`).
  const used = new Set<string>([...fixed, ...ownIds]);
  const endsOf = new Map<string, string[]>();
  const newEnd = (base: string, terminate: boolean | undefined, lane: string | undefined): string => {
    const id = freeId(`EndEvent_${base}`, used);
    add(create('bpmn:EndEvent', terminate === true ? { id, eventDefinitions: definition('bpmn:TerminateEventDefinition') } : { id }), lane);
    return id;
  };
  for (const step of graph.steps) {
    endsOf.set(step.id, step.succ.filter((s) => s.to === END).map((s) => newEnd(step.id, s.terminate, step.lane)));
    for (const b of step.boundary ?? []) if (b.to === END) endsOf.set(b.id, [newEnd(b.id, b.terminate, step.lane)]);
  }
  for (const id of generated) used.add(id);
  const flows: Built['flows'] = [];
  const connect = (source: El, target: El, label?: string, probability?: number): El => {
    const id = flowId(source.id, target.id, used);
    const attrs: Record<string, unknown> = { id, sourceRef: source, targetRef: target };
    if (label !== undefined && label !== '') attrs['name'] = label;
    const flow = create('bpmn:SequenceFlow', attrs);
    (source['outgoing'] ??= []).push(flow);
    (target['incoming'] ??= []).push(flow);
    process['flowElements'].push(flow);
    flows.push({ id, source: source.id, probability });
    return flow;
  };
  for (const start of starts) connect(nodes.get(start.id)!, nodes.get(start.to)!);
  for (const step of graph.steps) {
    let ended = 0;
    for (const s of step.succ) {
      const target = s.to === END ? nodes.get(endsOf.get(step.id)![ended++]!)! : nodes.get(s.to)!;
      const flow = connect(nodes.get(step.id)!, target, s.label, s.probability);
      if (s.default === true) nodes.get(step.id)!['default'] = flow;
    }
    for (const b of step.boundary ?? []) {
      connect(nodes.get(b.id)!, nodes.get(b.to === END ? endsOf.get(b.id)![0]! : b.to)!, b.label);
    }
  }

  // bpmn-auto-layout needs `outgoing` in the order the targets appear (see `layout.ts`).
  sortOutgoing(nodes.values(), (process['flowElements'] as El[]).map((el) => el.id));

  const rootElements: El[] = [];
  if (graph.lanes.length > 0) {
    const lanes = graph.lanes.map((name, i) =>
      create('bpmn:Lane', {
        id: `Lane_${i + 1}`,
        name,
        flowNodeRef: [...nodes.values()].filter((el) => laneOf.get(el.id) === name),
      }),
    );
    process['laneSets'] = [create('bpmn:LaneSet', { id: 'LaneSet_1', lanes })];
    const participant = create('bpmn:Participant', { id: 'Participant_1', name: graph.name, processRef: process });
    rootElements.push(create('bpmn:Collaboration', { id: 'Collaboration_1', participants: [participant] }));
  }
  rootElements.push(process);
  const definitions = create('bpmn:Definitions', {
    id: 'Definitions_1',
    targetNamespace: 'https://lila-modeler.org/bpmn',
    rootElements,
  });
  return { definitions, laneOf, flows };
}

function baseScenario(graph: Graph, built: Built): ScenarioDocument {
  const resources: Record<string, { name: string; capacity: number }> = {};
  const idOf = new Map<string, string>();
  // Each start gets the default arrivals: two starts bring two streams of cases.
  const elements: Record<string, Record<string, unknown>> = {};
  for (const start of graph.starts ?? [{ id: START_ID }]) elements[start.id] = { ...DEFAULT_ARRIVALS };
  for (const step of graph.steps) {
    const element: Record<string, unknown> = {};
    if (step.duration !== undefined) element['processingTime'] = step.duration;
    if (step.resources !== undefined) {
      element['resources'] = step.resources.map((r) => {
        let ref = idOf.get(r.name);
        if (ref === undefined) {
          ref = processSlug(r.name, Object.keys(resources));
          idOf.set(r.name, ref);
          resources[ref] = { name: r.name, capacity: 1 };
        }
        // Capacity covers the largest single request, so a task asking for 2 can ever start.
        resources[ref]!.capacity = Math.max(resources[ref]!.capacity, r.quantity);
        return { ref, quantity: r.quantity };
      });
    }
    if (step.selection !== undefined) element['selection'] = step.selection;
    if (Object.keys(element).length > 0) elements[step.id] = element;
    // A boundary timer's deadline is its delay (R-BND): never in the XML.
    for (const b of step.boundary ?? []) if (b.duration !== undefined) elements[b.id] = { processingTime: b.duration };
  }
  for (const flow of built.flows) if (flow.probability !== undefined) elements[flow.id] = { probability: flow.probability };
  return {
    version: 1,
    name: 'AS-IS',
    model: 'model.bpmn',
    run: { ...DEFAULT_RUN },
    ...(Object.keys(resources).length > 0 ? { resources } : {}),
    elements,
  };
}

/* ------------------------------------------------------------------ *
 * Notes and data (#638): text annotations and data objects of a step
 * ------------------------------------------------------------------ */

/** The `name` bpmn-js gives the property a data input association targets. */
const TARGET_PLACEHOLDER = '__targetRef_placeholder';

/**
 * Attaches a text annotation with `text` to `node`, through an association from the node, in the
 * artifacts of the node's container (the process, or its sub-process), as bpmn-js draws one.
 */
export function attachNote(node: El, text: string, create: Create, uniqueId: (base: string) => string): { annotation: El; association: El } {
  const container = node['$parent'] as El;
  const annotation = create('bpmn:TextAnnotation', { id: uniqueId(`TextAnnotation_${node.id}`), text });
  const association = create('bpmn:Association', { id: uniqueId(`Association_${node.id}`), sourceRef: node, targetRef: annotation });
  annotation['$parent'] = container;
  association['$parent'] = container;
  ((container['artifacts'] ??= []) as El[]).push(annotation, association);
  return { annotation, association };
}

/** The data object references of `container` named `name`, in document order. */
export function dataObjectsNamed(container: El, name: string): El[] {
  return ((container['flowElements'] ?? []) as El[]).filter((el) => el.$type === 'bpmn:DataObjectReference' && dataName(el) === name);
}

/** The name a data object reference goes by: its own, else its data object's. */
export function dataName(ref: El): string | undefined {
  const name = (ref['name'] as string | undefined) || (ref['dataObjectRef']?.['name'] as string | undefined);
  return name === '' ? undefined : name;
}

/**
 * Connects the data object named `name` to the activity `node`, as bpmn-js does: `in` is a data
 * input association from the object to the activity (to its `__targetRef_placeholder` property),
 * `out` a data output association from the activity to the object. An object with that name in the
 * node's container is reused; otherwise a `bpmn:DataObject` and its reference are created.
 */
export function attachData(
  node: El,
  name: string,
  direction: 'in' | 'out',
  create: Create,
  uniqueId: (base: string) => string,
): { reference: El; created: El[]; association: El } {
  const container = node['$parent'] as El;
  const created: El[] = [];
  let reference = dataObjectsNamed(container, name)[0];
  if (reference === undefined) {
    const object = create('bpmn:DataObject', { id: uniqueId(`DataObject_${node.id}`) });
    reference = create('bpmn:DataObjectReference', { id: uniqueId(`DataObjectReference_${node.id}`), name, dataObjectRef: object });
    for (const el of [object, reference]) {
      el['$parent'] = container;
      ((container['flowElements'] ??= []) as El[]).push(el);
    }
    created.push(object, reference);
  }
  let association: El;
  if (direction === 'in') {
    const properties = (node['properties'] ??= []) as El[];
    let property = properties.find((p) => p['name'] === TARGET_PLACEHOLDER);
    if (property === undefined) {
      property = create('bpmn:Property', { id: uniqueId(`Property_${node.id}`), name: TARGET_PLACEHOLDER });
      property['$parent'] = node;
      properties.push(property);
    }
    association = create('bpmn:DataInputAssociation', { id: uniqueId(`DataInputAssociation_${node.id}`), sourceRef: [reference], targetRef: property });
    ((node['dataInputAssociations'] ??= []) as El[]).push(association);
  } else {
    association = create('bpmn:DataOutputAssociation', { id: uniqueId(`DataOutputAssociation_${node.id}`), targetRef: reference });
    ((node['dataOutputAssociations'] ??= []) as El[]).push(association);
  }
  association['$parent'] = node;
  return { reference, created, association };
}

/** The data object references `node` reads (`in`) and writes (`out`), in the order of its associations. */
export function dataOf(node: El): { reference: El; direction: 'in' | 'out'; association: El }[] {
  const out: { reference: El; direction: 'in' | 'out'; association: El }[] = [];
  for (const a of (node['dataInputAssociations'] ?? []) as El[]) {
    for (const ref of (a['sourceRef'] ?? []) as El[]) out.push({ reference: ref, direction: 'in', association: a });
  }
  for (const a of (node['dataOutputAssociations'] ?? []) as El[]) {
    if (a['targetRef'] !== undefined) out.push({ reference: a['targetRef'], direction: 'out', association: a });
  }
  return out;
}

/** The texts of the annotations attached to `node` (either way), with their associations, in document order. */
export function notesOf(node: El, associations: readonly El[]): { annotation: El; association: El }[] {
  const out: { annotation: El; association: El }[] = [];
  for (const a of associations) {
    const other = a['sourceRef'] === node ? a['targetRef'] : a['targetRef'] === node ? a['sourceRef'] : undefined;
    if (other?.$type === 'bpmn:TextAnnotation') out.push({ annotation: other, association: a });
  }
  return out;
}

/** The associations of `process` and of the collaborations of `definitions`. */
export function associationsOf(definitions: El, process: El): El[] {
  const roots = ((definitions['rootElements'] ?? []) as El[]).filter((r) => r.$type === 'bpmn:Collaboration');
  return [process, ...roots].flatMap((el) => ((el['artifacts'] ?? []) as El[]).filter((a) => a.$type === 'bpmn:Association'));
}

/** Adds the notes and data of the steps of `graph` to the laid-out `definitions`, and draws them. */
function addArtifacts(graph: Graph, definitions: El, create: Create): void {
  if (!graph.steps.some((step) => step.notes !== undefined || step.data !== undefined)) return;
  const process = ((definitions['rootElements'] ?? []) as El[]).find((el) => el.$type === 'bpmn:Process')!;
  const used = new Set<string>();
  for (const el of everything(definitions)) if (typeof el.id === 'string') used.add(el.id);
  const uniqueId = (base: string): string => freeId(base, used);
  const nodes = ((process['flowElements'] ?? []) as El[]).filter((el) => el.$type !== 'bpmn:SequenceFlow');
  const byId = new Map(nodes.map((el) => [el.id, el]));
  for (const step of graph.steps) {
    const node = byId.get(step.id)!;
    for (const note of step.notes ?? []) attachNote(node, note, create, uniqueId);
    // In normal-form order (reads, then writes), so the normal form builds the same model.
    const data = step.data ?? [];
    for (const d of [...data.filter((x) => x.direction === 'in'), ...data.filter((x) => x.direction === 'out')]) {
      attachData(node, d.name, d.direction, create, uniqueId);
    }
  }
  const diagram = new Diagram(definitions, create, uniqueId);
  const plane = diagram.mainPlane(process)!;
  const dataAssociations = nodes.flatMap((n) => dataOf(n).map((d) => d.association));
  placeArtifacts(diagram, plane, process, nodes, associationsOf(definitions, process), [...new Set(dataAssociations)]);
}

/**
 * Builds, lays out and validates the BPMN of `outline`. Throws `OutlineError` when the outline is
 * malformed or the model it describes does not validate (the validator's errors are the issues).
 */
export async function outlineToBpmn(outline: unknown, options: OutlineToBpmnOptions = {}): Promise<OutlineBpmn> {
  const locale = options.locale ?? 'en';
  const C = messages(locale).cli;
  const graph = toGraph(outline, C);
  const built = buildSemantic(graph, options.processId ?? 'Process_1', C);

  const moddle = BpmnModdle({ lila });
  const { xml: semantic } = await moddle.toXML(built.definitions);
  let laidOut: string;
  try {
    laidOut = await autoLayout(semantic);
  } catch (error) {
    if (!(error instanceof LayoutError)) throw error;
    fail(C, [{ path: 'steps', message: C.outlineLayoutFailed(error.message) }]);
  }
  const { rootElement: definitions } = await moddle.fromXML(laidOut);
  const create = (type: string, attrs: Record<string, unknown> = {}): El => moddle.create(type, attrs) as El;
  separateSubprocessPlanes(definitions as El, create);
  if (graph.lanes.length > 0) {
    const roots = (definitions as El)['rootElements'] as El[];
    const process = roots.find((el) => el.$type === 'bpmn:Process')!;
    const participant = roots.find((el) => el.$type === 'bpmn:Collaboration')!['participants'][0] as El;
    layOutLanes((definitions as El)['diagrams'][0]['plane'] as El, process, participant, create);
  }
  labelFlows((definitions as El)['diagrams'][0]['plane'] as El, create);
  addArtifacts(graph, definitions as El, create);
  const { xml: raw } = await moddle.toXML(definitions, { format: true });
  const xml = marcarExportador(raw);

  const report = await validateBpmnXml(xml, { locale });
  if (report.errors.length > 0) {
    fail(
      C,
      report.errors.map((e) => {
        const index = graph.steps.findIndex((step) => step.id === e.id);
        return { path: index === -1 ? `bpmn.${e.id}` : `steps[${index}]`, message: `${e.code}: ${e.message}` };
      }),
      C.outlineBpmnInvalid,
    );
  }
  return { xml, scenario: baseScenario(graph, built), warnings: report.warnings, notes: joinNotes(graph, C), outline: toNormal(graph) };
}

/* ------------------------------------------------------------------ *
 * BPMN → outline
 * ------------------------------------------------------------------ */

/** The step type of a BPMN element; intermediate catch events go by their event definition. */
const OUTLINE_TYPE: Readonly<Record<string, OutlineStepType>> = Object.fromEntries(
  (Object.entries(BPMN_TYPE) as [OutlineStepType, string][]).filter(([type]) => type !== 'timer' && type !== 'message').map(([type, bpmn]) => [bpmn, type]),
);

export interface BpmnToOutlineOptions {
  locale?: Locale | undefined;
  /**
   * A scenario of the process (e.g. its `as-is.scenario.json`): its `processingTime`, `resources`
   * and flow `probability` come back as `duration`, `resources` and branch `probability`.
   */
  scenario?: Record<string, unknown> | undefined;
  /** Name to use when the BPMN names neither the pool nor the process (before the process id). */
  name?: string | undefined;
  /** #546: the process to read (the one its scenarios target, `parseBpmn`); default, the first pool's. */
  processId?: string | undefined;
}

export interface OutlineReading {
  /** The outline, in normal form. */
  readonly outline: NormalOutline;
  /** What the outline could not carry (other event types, extra start events, nested lanes…). */
  readonly warnings: readonly string[];
}

/**
 * The kinds of scenario content an outline does not carry: arrivals other than the defaults a
 * created process gets, calendars, costs, resource capacities or types other than the ones
 * `baseScenario` derives, and conditional routing. The scenario itself is never changed.
 */
function scenarioOutside(scenario: Record<string, any>, startIds: readonly string[], steps: readonly GraphStep[]): string[] {
  const kinds: string[] = [];
  const elements = record(scenario['elements']);
  const resources = record(scenario['resources']);
  const entries = [...Object.values(elements), ...Object.values(resources)].map(record);
  const arrivals = startIds.map((id) => elements[id]).filter((e) => e !== undefined);
  // By value, not by key order: a scenario written back by patch_scenario may list the keys otherwise.
  if (arrivals.some((e) => canonical(e) !== canonical(DEFAULT_ARRIVALS))) kinds.push('arrivals');
  if (Object.keys(record(scenario['calendars'])).length > 0 || entries.some((e) => e['calendar'] !== undefined)) kinds.push('calendars');
  if (entries.some((e) => (e['fixedCost'] ?? 0) !== 0 || (e['costPerHour'] ?? 0) !== 0)) kinds.push('costs');
  const largest = new Map<string, number>();
  for (const step of steps) for (const r of step.resources ?? []) largest.set(r.name, Math.max(largest.get(r.name) ?? 1, r.quantity));
  const derived = Object.entries(resources).some(([ref, value]) => {
    const r = record(value);
    const name = typeof r['name'] === 'string' ? r['name'] : ref;
    const keys = Object.keys(r).filter((k) => !['name', 'capacity', 'type', 'costPerHour', 'fixedCost', 'calendar'].includes(k));
    return (
      keys.length > 0 ||
      (r['type'] !== undefined && r['type'] !== 'role') ||
      typeof r['capacity'] !== 'number' ||
      r['capacity'] !== (largest.get(name) ?? 1)
    );
  });
  if (derived) kinds.push('capacities');
  if (Object.values(elements).some((e) => record(e)['conditions'] !== undefined)) kinds.push('conditions');
  return kinds;
}

/** JSON with the keys of every object sorted, to compare values whatever their key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    typeof v === 'object' && v !== null && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  );
}

function record(value: unknown): Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

/** The `$type`s of the event definitions of `el`. */
const definitionsOf = (el: El): string[] => ((el['eventDefinitions'] ?? []) as El[]).map((d) => d.$type);

/**
 * Reads the first process of `xml` (the pool's, when there is a collaboration) as an outline, in
 * normal form (see the header): the end events become implicit, and so does the start in the
 * trivial case; the steps keep the document order.
 */
export async function bpmnToOutline(xml: string, options: BpmnToOutlineOptions = {}): Promise<OutlineReading> {
  const C = messages(options.locale ?? 'en').cli;
  const moddle = BpmnModdle({ lila });
  const { rootElement } = await moddle.fromXML(xml);
  const roots = ((rootElement as El)['rootElements'] ?? []) as El[];
  const participant = roots
    .filter((el) => el.$type === 'bpmn:Collaboration')
    .flatMap((el) => (el['participants'] ?? []) as El[])
    .find((p) => p['processRef'] !== undefined && (options.processId === undefined || (p['processRef'] as El).id === options.processId));
  const process = (participant?.['processRef'] as El | undefined) ??
    roots.find((el) => el.$type === 'bpmn:Process' && (options.processId === undefined || el.id === options.processId));
  if (process === undefined) throw new OutlineError(C.outlineNoProcess(), [{ path: 'bpmn', message: C.outlineNoProcess() }]);

  const warnings: string[] = [];
  // What the outline cannot carry is said once per kind, never dropped silently (QA of #553).
  const collaborations = roots.filter((el) => el.$type === 'bpmn:Collaboration');
  const otherPools = [
    ...collaborations.flatMap((c) => (c['participants'] ?? []) as El[]).filter((p) => p !== participant),
    ...roots.filter((el) => el.$type === 'bpmn:Process' && el !== process && !collaborations.some((c) => ((c['participants'] ?? []) as El[]).some((p) => p['processRef'] === el))),
  ];
  if (otherPools.length > 0) warnings.push(C.outlineDroppedPools(otherPools.map((p) => (p['name'] as string | undefined) || p.id).join(', ')));
  const messageFlows = collaborations.reduce((n, c) => n + ((c['messageFlows'] ?? []) as El[]).length, 0);
  if (messageFlows > 0) warnings.push(C.outlineDroppedMessageFlows(messageFlows));
  const laneOf = new Map<string, string>();
  const lanes: string[] = [];
  for (const lane of ((process['laneSets']?.[0]?.['lanes'] ?? []) as El[])) {
    const name = (lane['name'] as string | undefined) ?? lane.id;
    lanes.push(name);
    for (const ref of (lane['flowNodeRef'] ?? []) as El[]) laneOf.set(ref.id, name);
    if (lane['childLaneSet'] !== undefined) warnings.push(C.outlineUnsupported(lane.id, 'bpmn:childLaneSet'));
  }

  const scenario = record(options.scenario);
  const elements = record(scenario['elements']);
  const resourceDefs = record(scenario['resources']);

  const flowElements = (process['flowElements'] ?? []) as El[];
  const byId = new Map(flowElements.map((el) => [el.id, el]));
  const kept = new Map<string, OutlineStepType>();
  /** end event id → how it ends a path */
  const ends = new Map<string, NormalEnd>();
  const starts: El[] = [];
  const boundaries: El[] = [];
  /** data object references: read as the `data` of the steps that use them (#638) */
  const dataRefs: El[] = [];
  for (const el of flowElements) {
    if (el.$type === 'bpmn:SequenceFlow' || el.$type === 'bpmn:DataObject') continue;
    if (el.$type === 'bpmn:DataObjectReference') {
      dataRefs.push(el);
      continue;
    }
    const definitions = definitionsOf(el);
    if (el.$type === 'bpmn:StartEvent') starts.push(el);
    else if (el.$type === 'bpmn:EndEvent') ends.set(el.id, definitions.includes('bpmn:TerminateEventDefinition') ? 'terminate' : true);
    else if (el.$type === 'bpmn:BoundaryEvent') boundaries.push(el);
    else if (el.$type === 'bpmn:IntermediateCatchEvent' && definitions.includes('bpmn:TimerEventDefinition')) kept.set(el.id, 'timer');
    else if (el.$type === 'bpmn:IntermediateCatchEvent' && definitions.length === 1 && definitions[0] === 'bpmn:MessageEventDefinition') {
      kept.set(el.id, 'message');
    } else if (
      el.$type === 'bpmn:EventBasedGateway' &&
      // R-EVG-1: only an exclusive gateway that does not instantiate the process.
      (el['instantiate'] === true || (el['eventGatewayType'] !== undefined && el['eventGatewayType'] !== 'Exclusive'))
    ) {
      warnings.push(C.outlineUnsupported(el.id, el.$type));
    } else if (OUTLINE_TYPE[el.$type] !== undefined) kept.set(el.id, OUTLINE_TYPE[el.$type]!);
    else warnings.push(C.outlineUnsupported(el.id, el.$type));
  }
  // Triggers the outline has no word for read as plain events, with a warning. A timer start and a
  // terminate end are outline constructs (#631), not losses.
  for (const el of [...starts, ...flowElements.filter((e) => ends.has(e.id))]) {
    const read = el.$type === 'bpmn:StartEvent' ? 'bpmn:TimerEventDefinition' : 'bpmn:TerminateEventDefinition';
    const dropped = definitionsOf(el).filter((t) => t !== read);
    if (dropped.length > 0) warnings.push(C.outlineDroppedTrigger(el.id, dropped.join(', ')));
  }
  const namedEnds = flowElements.filter((el) => ends.has(el.id) && typeof el['name'] === 'string' && el['name'] !== '');
  if (namedEnds.length > 0) warnings.push(C.outlineDroppedEventNames(namedEnds.map((el) => `${el.id} "${el['name']}"`).join(', ')));

  const sequenceFlows = flowElements.filter((el) => el.$type === 'bpmn:SequenceFlow');
  const outOf = (el: El): El[] => sequenceFlows.filter((f) => f['sourceRef'] === el && f['targetRef'] !== undefined);
  const flowName = (flow: El): string | undefined => (flow['name'] as string | undefined) || undefined;

  // Boundary timers on a task (any variant) or a call activity, with one way out and no way in.
  const keptBoundaries = new Map<string, GraphBoundary[]>();
  const readBoundaries = new Set<El>();
  for (const b of boundaries) {
    const host = b['attachedToRef'] as El | undefined;
    const outs = outOf(b);
    const target = outs[0]?.['targetRef'] as El | undefined;
    const ok =
      host !== undefined &&
      WORK.has(kept.get(host.id)!) &&
      definitionsOf(b).length === 1 &&
      definitionsOf(b)[0] === 'bpmn:TimerEventDefinition' &&
      outs.length === 1 &&
      target !== undefined &&
      (kept.has(target.id) || ends.has(target.id)) &&
      !sequenceFlows.some((f) => f['targetRef'] === b);
    if (!ok) {
      warnings.push(C.outlineUnsupported(b.id, b.$type));
      continue;
    }
    readBoundaries.add(b);
    const delay = record(elements[b.id])['processingTime'];
    const boundary: GraphBoundary = {
      id: b.id,
      name: (b['name'] as string | undefined) ?? '',
      label: flowName(outs[0]!),
      duration: delay === undefined ? undefined : parseDuration(delay) ?? undefined,
      interrupting: b['cancelActivity'] !== false,
      to: ends.has(target!.id) ? END : target!.id,
      terminate: ends.get(target!.id) === 'terminate' || undefined,
    };
    (keptBoundaries.get(host!.id) ?? keptBoundaries.set(host!.id, []).get(host!.id)!).push(boundary);
  }

  // A start leads to one step: further flows out of it, and the names of its flows, are not carried.
  const graphStarts: GraphStart[] = [];
  const startIds = new Set<string>();
  for (const start of starts) {
    const outs = outOf(start);
    const target = outs[0]?.['targetRef'] as El | undefined;
    if (target === undefined || !kept.has(target.id)) {
      warnings.push(C.outlineUnsupported(start.id, start.$type));
      continue;
    }
    if (outs.length > 1) warnings.push(C.outlineStartManyFlows(start.id, outs.slice(1).map((f) => f.id).join(', ')));
    const named = outs.filter((f) => flowName(f) !== undefined);
    if (named.length > 0) warnings.push(C.outlineDroppedFlowNames(named.map((f) => `${f.id} "${f['name']}"`).join(', ')));
    startIds.add(start.id);
    graphStarts.push({
      id: start.id,
      name: (start['name'] as string | undefined) ?? '',
      timer: definitionsOf(start).includes('bpmn:TimerEventDefinition'),
      lane: laneOf.get(start.id) ?? laneOf.get(target.id),
      to: target.id,
    });
  }

  // The flows out of the steps; the rest is said lost (flows of starts and boundary events were read above).
  const flowsFrom = new Map<string, El[]>();
  for (const flow of sequenceFlows) {
    const source = flow['sourceRef'] as El | undefined;
    const target = flow['targetRef'] as El | undefined;
    if (source !== undefined && (starts.includes(source) || boundaries.includes(source))) {
      if (!startIds.has(source.id) && !readBoundaries.has(source)) warnings.push(C.outlineLostFlow(flow.id));
      continue;
    }
    if (source === undefined || target === undefined || !kept.has(source.id) || !(kept.has(target.id) || ends.has(target.id))) {
      warnings.push(C.outlineLostFlow(flow.id));
      continue;
    }
    (flowsFrom.get(source.id) ?? flowsFrom.set(source.id, []).get(source.id)!).push(flow);
  }

  // Branch probabilities the outline would refuse are left out with a warning, never read: those on
  // flows that do not leave an xor or an or, and those of an xor that add up to more than 1. So are
  // default-flow marks out of anything but an xor or an or, and broken ones.
  const droppedProbabilities: string[] = [];
  const droppedDefaults: string[] = [];
  // Notes (#638): the text annotations attached to a step, once per text; data: the named data
  // objects an activity reads or writes. What is read is not said lost below.
  const associations = associationsOf(rootElement as El, process);
  const readArtifacts = new Set<El>();
  const mergedNotes: string[] = [];
  const usedRefs = new Set<El>();
  /** name → the data object reference read under it: another one with that name is said lost */
  const refByName = new Map<string, El>();
  const lostData: El[] = [];
  const notesFor = (el: El): string[] | undefined => {
    const texts: string[] = [];
    for (const { annotation, association } of notesOf(el, associations)) {
      const text = annotation['text'] as string | undefined;
      if (text === undefined || text.trim() === '') continue;
      readArtifacts.add(annotation).add(association);
      if (texts.includes(text)) mergedNotes.push(`${el.id} "${text}"`);
      else texts.push(text);
    }
    return texts.length > 0 ? texts : undefined;
  };
  const dataFor = (el: El, type: OutlineStepType): OutlineData[] | undefined => {
    if (!WORK.has(type) && type !== 'subprocess') return undefined;
    const data: { name: string; direction: 'in' | 'out' }[] = [];
    for (const { reference, direction } of dataOf(el)) {
      const name = reference.$type === 'bpmn:DataObjectReference' ? dataName(reference) : undefined;
      if (name === undefined) continue;
      if ((refByName.get(name) ?? refByName.set(name, reference).get(name)) !== reference) continue;
      usedRefs.add(reference);
      if (!data.some((d) => d.name === name && d.direction === direction)) data.push({ name, direction });
    }
    return data.length > 0 ? data : undefined;
  };
  const steps: GraphStep[] = [...kept.keys()].map((id) => {
    const el = byId.get(id)!;
    const type = kept.get(id)!;
    const choice = type === 'xor' || type === 'or';
    const outs = flowsFrom.get(id) ?? [];
    if (el['default'] !== undefined && !(choice && outs.includes(el['default']))) droppedDefaults.push(id);
    const succ: Successor[] = outs.map((flow) => {
      const target = flow['targetRef'].id as string;
      const probability = record(elements[flow.id])['probability'];
      const read = typeof probability === 'number' && probability >= 0 && probability <= 1;
      if (typeof probability === 'number' && !(read && choice)) droppedProbabilities.push(flow.id);
      return {
        to: ends.has(target) ? END : target,
        terminate: ends.get(target) === 'terminate' || undefined,
        label: flowName(flow),
        probability: read && choice ? probability : undefined,
        default: (choice && el['default'] === flow) || undefined,
        id: flow.id,
      };
    });
    const sum = succ.reduce((total, s) => total + (s.probability ?? 0), 0);
    if (type === 'xor' && sum > 1 + 1e-9) {
      for (const s of succ) if (s.probability !== undefined) (droppedProbabilities.push(s.id!), (s.probability = undefined));
    }
    const element = record(elements[id]);
    const duration = element['processingTime'] === undefined ? undefined : parseDuration(element['processingTime']) ?? undefined;
    const resources = Array.isArray(element['resources'])
      ? (element['resources'] as unknown[]).map((entry) => {
          const ref = String(record(entry)['ref']);
          const quantity = record(entry)['quantity'];
          const name = record(resourceDefs[ref])['name'];
          return { name: typeof name === 'string' ? name : ref, quantity: typeof quantity === 'number' ? quantity : 1 };
        })
      : undefined;
    const selection = element['selection'] === 'and' || element['selection'] === 'or' ? (element['selection'] as 'and' | 'or') : undefined;
    return {
      id,
      name: (el['name'] as string | undefined) ?? '',
      type,
      lane: laneOf.get(id),
      succ,
      duration,
      resources,
      selection,
      boundary: keptBoundaries.get(id),
      notes: notesFor(el),
      data: dataFor(el, type),
    };
  });
  if (mergedNotes.length > 0) warnings.push(C.outlineMergedNotes(mergedNotes.join(', ')));
  for (const ref of dataRefs) if (!usedRefs.has(ref)) warnings.push(C.outlineUnsupported(ref.id, ref.$type));
  // Data associations of what is not a step the outline reads as an activity (an event, a gateway…).
  for (const el of flowElements) {
    const type = kept.get(el.id);
    if (type !== undefined && (WORK.has(type) || type === 'subprocess')) continue;
    for (const { association } of dataOf(el)) if (!lostData.includes(association)) lostData.push(association);
  }
  for (const a of lostData) warnings.push(C.outlineUnsupported(a.id, a.$type));
  const artifacts = [process, ...collaborations].reduce(
    (n, el) => n + ((el['artifacts'] ?? []) as El[]).filter((a) => !readArtifacts.has(a)).length,
    0,
  );
  if (artifacts > 0) warnings.push(C.outlineDroppedArtifacts(artifacts));
  if (droppedDefaults.length > 0) warnings.push(C.outlineDroppedDefaults(droppedDefaults.join(', ')));
  if (droppedProbabilities.length > 0) warnings.push(C.outlineDroppedProbabilities(droppedProbabilities.join(', ')));
  const kinds = scenarioOutside(scenario, graphStarts.map((s) => s.id), steps);
  if (kinds.length > 0) warnings.push(C.outlineScenarioOutside(kinds.join(',')));

  const graph: Graph = { name: '', lanes, starts: graphStarts, steps };
  eventGatewayRule(graph, C, warnings);
  // Durations live in the scenario: timer expressions of the timers the outline keeps are said lost.
  const timers = [
    ...starts.filter((el) => (graph.starts ?? []).some((start) => start.id === el.id)),
    ...graph.steps.filter((step) => step.type === 'timer').map((step) => byId.get(step.id)!),
    ...[...readBoundaries].filter((b) => graph.steps.some((step) => step.boundary?.some((g) => g.id === b.id))),
  ];
  const expressions = timers
    .filter((el) => ((el['eventDefinitions'] ?? []) as El[]).some((d) => ['timeDuration', 'timeDate', 'timeCycle'].some((k) => d[k] !== undefined)))
    .map((el) => el.id);
  if (expressions.length > 0) warnings.push(C.outlineDroppedTimerExpressions(expressions.join(', ')));
  // Bizagi exports often have no names at all: the process id is still a name (QA of #553).
  graph.name = (participant?.['name'] as string | undefined) || (process['name'] as string | undefined) || options.name || process.id;
  return { outline: toNormal(graph), warnings };
}

/**
 * R-EVG-1 on a reading: every way out of an event gateway goes to a timer or message step whose only
 * way in is that gateway, and a message step only follows one. What breaks the rule is left out with
 * a warning, repeatedly: the flows of a gateway that go elsewhere (and the gateway, when none is
 * left), and the message steps that follow anything else (with their flows).
 */
function eventGatewayRule(graph: Graph, C: CliMessages, warnings: string[]): void {
  const removeStep = (step: GraphStep): void => {
    warnings.push(C.outlineUnsupported(step.id, BPMN_TYPE[step.type]));
    graph.steps.splice(graph.steps.indexOf(step), 1);
    for (const other of graph.steps) {
      other.succ = other.succ.filter((s) => {
        if (s.to !== step.id) return true;
        if (s.id !== undefined) warnings.push(C.outlineLostFlow(s.id));
        return false;
      });
      other.boundary = other.boundary?.filter((b) => {
        if (b.to === step.id) warnings.push(C.outlineUnsupported(b.id, 'bpmn:BoundaryEvent'));
        return b.to !== step.id;
      });
      if (other.boundary?.length === 0) delete other.boundary;
    }
    graph.starts = graph.starts?.filter((start) => {
      if (start.to === step.id) warnings.push(C.outlineUnsupported(start.id, 'bpmn:StartEvent'));
      return start.to !== step.id;
    });
  };
  for (let changed = true; changed; ) {
    changed = false;
    const waysIn = new Map<string, string[]>();
    const wayIn = (to: string, from: string): void => void (waysIn.get(to) ?? waysIn.set(to, []).get(to)!).push(from);
    for (const start of graph.starts ?? []) wayIn(start.to, start.id);
    for (const step of graph.steps) for (const s of step.succ) if (s.to !== END) wayIn(s.to, step.id);
    for (const step of graph.steps) for (const b of step.boundary ?? []) if (b.to !== END) wayIn(b.to, b.id);
    const byId = new Map(graph.steps.map((step) => [step.id, step]));
    for (const step of [...graph.steps]) {
      if (step.type === 'message') {
        const from = waysIn.get(step.id) ?? [];
        if (from.length !== 1 || byId.get(from[0]!)?.type !== 'eventGateway') {
          removeStep(step);
          changed = true;
          break;
        }
      }
      if (step.type === 'eventGateway') {
        const fit = (s: Successor): boolean => {
          const target = s.to === END ? undefined : byId.get(s.to);
          return target !== undefined && (target.type === 'timer' || target.type === 'message') && (waysIn.get(target.id) ?? []).length === 1;
        };
        const bad = step.succ.filter((s) => !fit(s));
        if (bad.length === 0) continue;
        for (const s of bad) if (s.id !== undefined) warnings.push(C.outlineLostFlow(s.id));
        step.succ = step.succ.filter(fit);
        if (step.succ.length === 0) removeStep(step);
        changed = true;
        break;
      }
    }
  }
}
