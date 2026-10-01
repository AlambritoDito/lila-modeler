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
 * inside the lane), routes the flows again orthogonally and adds the pool and the lane shapes.
 * Without lanes, the layouter's DI is used as it comes.
 *
 * Normal form. `normalizeOutline` turns any accepted outline into one canonical shape, which is
 * also what `bpmnToOutline` returns, so a round trip compares equal: every step names its lane
 * (when there are lanes), `type` is omitted for `task`, `next` only when it is not simply the
 * following step, `end: true` on every step that finishes the process, gateway successors are
 * `branches`, durations are scenario distributions in seconds, and the XOR probabilities that
 * were left out share what is left of 1.
 */
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';
import { layoutProcess } from 'bpmn-auto-layout';
import { z } from 'zod';

import lila from './lila.moddle.json' with { type: 'json' };
import { isNCName, marcarExportador } from './ids.js';
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
  'xor',
  'and',
  'or',
  'timer',
  'subprocess',
  'callActivity',
] as const;
export type OutlineStepType = (typeof OUTLINE_STEP_TYPES)[number];

const GATEWAYS: ReadonlySet<OutlineStepType> = new Set(['xor', 'and', 'or']);
/** Steps that do work: they take a duration and resources. */
const WORK: ReadonlySet<OutlineStepType> = new Set(['task', 'userTask', 'serviceTask', 'callActivity']);

const OutlineResourceSchema = z.union([
  z.string().min(1),
  z.strictObject({ name: z.string().min(1), quantity: z.int().min(1).optional() }),
]);

const OutlineBranchSchema = z.strictObject({
  label: z.string().optional().describe('Name of the flow, e.g. "Yes".'),
  to: z.string().min(1).optional().describe('Id of the step this branch goes to.'),
  end: z.boolean().optional().describe('true instead of `to`: this branch ends the process.'),
  probability: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe('XOR/OR only: probability of this branch in the base scenario. Left-out XOR branches share the rest.'),
});

const OutlineStepSchema = z.strictObject({
  id: z.string().min(1).describe('BPMN id of the step; scenarios key on it.'),
  name: z.string().optional(),
  lane: z.string().optional().describe('Lane name; defaults to the previous step\'s lane.'),
  type: z.enum(OUTLINE_STEP_TYPES).optional().describe('Defaults to task.'),
  next: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
    .describe('Id(s) of the following step(s) when it is not simply the next one in the list.'),
  branches: z.array(OutlineBranchSchema).min(1).optional().describe('Gateways only: outgoing branches.'),
  end: z.boolean().optional().describe('true: the process ends after this step.'),
  duration: z
    .union([z.string().min(1), z.number().nonnegative(), DistributionSchema])
    .optional()
    .describe(
      'Processing time (tasks) or delay (timer): seconds, "20m", "normal(20m, 5m)", "triangular(1m, 2m, 5m)", ' +
        '"exponential(mean=4m)", or a scenario distribution object in seconds.',
    ),
  resources: z
    .array(OutlineResourceSchema)
    .min(1)
    .optional()
    .describe('Resource names the task needs (one unit each), or {name, quantity}.'),
});

/** The outline as an agent writes it (#97). Exported for the MCP tools' input schema. */
export const OutlineSchema = z.strictObject({
  name: z.string().min(1).describe('Name of the process.'),
  lanes: z.array(z.string().min(1)).optional().describe('Lane names, top to bottom.'),
  steps: z.array(OutlineStepSchema).min(1).describe('The steps in flow order.'),
});

export type Outline = z.input<typeof OutlineSchema>;
export type OutlineStep = z.input<typeof OutlineStepSchema>;

export type NormalResource = string | { name: string; quantity: number };
export interface NormalBranch {
  label?: string;
  /** The step it goes to; absent when the branch ends the process (`end: true`). */
  to?: string;
  end?: true;
  probability?: number;
}
export interface NormalStep {
  id: string;
  name?: string;
  type?: Exclude<OutlineStepType, 'task'>;
  lane?: string;
  next?: string | string[];
  branches?: NormalBranch[];
  end?: true;
  duration?: Distribution;
  resources?: NormalResource[];
}
/** The canonical outline (see the header): what `normalizeOutline` and `bpmnToOutline` return. */
export interface NormalOutline {
  name: string;
  lanes?: string[];
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
}
interface GraphStep {
  id: string;
  name: string;
  type: OutlineStepType;
  lane?: string | undefined;
  succ: Successor[];
  duration?: Distribution | undefined;
  resources?: { name: string; quantity: number }[] | undefined;
}
interface Graph {
  name: string;
  lanes: string[];
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

function toGraph(input: unknown, C: CliMessages): Graph {
  const parsed = OutlineSchema.safeParse(input);
  if (!parsed.success) {
    fail(
      C,
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.') || '(root)', message: issue.message })),
    );
  }
  const outline = parsed.data;
  const issues: OutlineIssue[] = [];
  const at = (index: number, field?: string): string => `steps[${index}]${field === undefined ? '' : `.${field}`}`;

  const lanes = [...(outline.lanes ?? [])];
  const seenLanes = new Set<string>();
  for (const lane of lanes) {
    if (seenLanes.has(lane)) issues.push({ path: 'lanes', message: C.outlineDuplicateLane(lane) });
    seenLanes.add(lane);
  }
  const declared = outline.lanes !== undefined;

  const ids = new Set<string>();
  for (const [index, step] of outline.steps.entries()) {
    if (!isNCName(step.id)) issues.push({ path: at(index, 'id'), message: C.outlineBadId(step.id) });
    if (ids.has(step.id)) issues.push({ path: at(index, 'id'), message: C.outlineDuplicateId(step.id) });
    ids.add(step.id);
  }

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

    if (step.end === true && (step.next !== undefined || step.branches !== undefined)) {
      issues.push({ path: at(index, 'end'), message: C.outlineEndWithNext(step.id) });
    }
    if (step.branches !== undefined && !gateway) {
      issues.push({ path: at(index, 'branches'), message: C.outlineBranchesNeedGateway(step.id, type) });
    }
    if (step.branches !== undefined && step.next !== undefined) {
      issues.push({ path: at(index, 'next'), message: C.outlineEndWithNext(step.id) });
    }
    const nextList = step.next === undefined ? undefined : Array.isArray(step.next) ? step.next : [step.next];
    if (nextList !== undefined && nextList.length > 1 && !gateway) {
      issues.push({ path: at(index, 'next'), message: C.outlineManyNextNeedGateway(step.id) });
    }

    let succ: Successor[];
    if (step.end === true) succ = [{ to: END }];
    else if (step.branches !== undefined) {
      succ = step.branches.map((b, k) => {
        if ((b.end === true) === (b.to !== undefined)) {
          issues.push({ path: at(index, `branches[${k}]`), message: C.outlineBranchTarget(step.id) });
        }
        return { to: b.to ?? END, label: b.label, probability: b.probability };
      });
    } else if (nextList !== undefined) succ = nextList.map((to) => ({ to }));
    else {
      const following = outline.steps[index + 1];
      succ = [{ to: following === undefined ? END : following.id }];
    }
    for (const s of succ) {
      if (s.to !== END && !ids.has(s.to)) {
        issues.push({ path: at(index, step.branches ? 'branches' : 'next'), message: C.outlineUnknownTarget(step.id, s.to) });
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
      for (const s of open) s.probability = Math.max(0, 1 - sum) / open.length;
    }

    let duration: Distribution | undefined;
    if (step.duration !== undefined) {
      if (!WORK.has(type) && type !== 'timer') {
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
    const resources = step.resources?.map((r) =>
      typeof r === 'string' ? { name: r, quantity: 1 } : { name: r.name, quantity: r.quantity ?? 1 },
    );

    return { id: step.id, name: step.name ?? '', type, lane, succ, duration, resources };
  });

  if (issues.length > 0) fail(C, issues);
  // Lanes named only further down the list: the steps before them go to the first lane.
  if (lanes.length > 0) for (const step of steps) step.lane ??= lanes[0];
  return { name: outline.name, lanes, steps };
}

function toNormal(graph: Graph): NormalOutline {
  const steps = graph.steps.map((step, index): NormalStep => {
    const out: NormalStep = { id: step.id };
    if (step.name !== '') out.name = step.name;
    if (step.type !== 'task') out.type = step.type;
    if (graph.lanes.length > 0 && step.lane !== undefined) out.lane = step.lane;

    const following = graph.steps[index + 1]?.id;
    const decorated = step.succ.some((s) => s.label !== undefined || s.probability !== undefined);
    const toSteps = step.succ.filter((s): s is Successor & { to: string } => s.to !== END);
    if (GATEWAYS.has(step.type) && (step.succ.length > 1 || decorated)) {
      out.branches = step.succ.map((s) => {
        const branch: NormalBranch = s.to === END ? { end: true } : { to: s.to };
        if (s.label !== undefined && s.label !== '') branch.label = s.label;
        if (s.probability !== undefined) branch.probability = s.probability;
        return branch;
      });
    } else if (toSteps.length === 0) {
      // Only the end, or no successor at all (a dead end in a foreign BPMN): never "the next one".
      out.end = true;
    } else if (toSteps.length === 1 && toSteps[0]!.to === following) {
      // the implicit successor
    } else if (toSteps.length === 1) out.next = toSteps[0]!.to;
    else if (toSteps.length > 1) out.next = toSteps.map((s) => s.to);

    if (step.duration !== undefined) out.duration = step.duration;
    if (step.resources !== undefined && step.resources.length > 0) {
      out.resources = step.resources.map((r) => (r.quantity === 1 ? r.name : { name: r.name, quantity: r.quantity }));
    }
    return out;
  });
  return graph.lanes.length > 0 ? { name: graph.name, lanes: [...graph.lanes], steps } : { name: graph.name, steps };
}

/** Checks `input` and returns its normal form (see the header). Throws `OutlineError`. */
export function normalizeOutline(input: unknown, options: { locale?: Locale | undefined } = {}): NormalOutline {
  return toNormal(toGraph(input, messages(options.locale ?? 'en').cli));
}

/* ------------------------------------------------------------------ *
 * Outline → BPMN
 * ------------------------------------------------------------------ */

type El = { $type: string; id: string } & Record<string, any>;

const START_ID = 'StartEvent';
/** Id of the `k`-th end event after `step` (a gateway may have several branches that end). */
const endId = (step: string, k = 1): string => (k === 1 ? `EndEvent_${step}` : `EndEvent_${step}_${k}`);
const endCount = (step: GraphStep): number => step.succ.filter((s) => s.to === END).length;

const BPMN_TYPE: Readonly<Record<OutlineStepType, string>> = {
  task: 'bpmn:Task',
  userTask: 'bpmn:UserTask',
  serviceTask: 'bpmn:ServiceTask',
  callActivity: 'bpmn:CallActivity',
  xor: 'bpmn:ExclusiveGateway',
  and: 'bpmn:ParallelGateway',
  or: 'bpmn:InclusiveGateway',
  timer: 'bpmn:IntermediateCatchEvent',
  subprocess: 'bpmn:SubProcess',
};

/** Layout grid of `bpmn-auto-layout` 1.3 (its `DEFAULT_CELL_HEIGHT`). */
const CELL_HEIGHT = 140;
/** The pool's label strip plus the lane's label strip, as bpmn-js draws them. */
const HEADER = 30;
const MARGIN = 40;

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
  /** The outline in normal form. */
  readonly outline: NormalOutline;
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

function flowId(source: string, target: string, used: Set<string>): string {
  const base = `Flow_${source}_${target}`;
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  used.add(id);
  return id;
}

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

  // Ids Lila generates must not clash with a step id, nor with the `<id>_di` of the diagram.
  const generated = new Set<string>(['Definitions_1', processId, START_ID, 'Collaboration_1', 'Participant_1', 'LaneSet_1']);
  graph.lanes.forEach((_, i) => generated.add(`Lane_${i + 1}`));
  for (const step of graph.steps) {
    for (let k = 1; k <= endCount(step); k++) generated.add(endId(step.id, k));
    if (step.type === 'subprocess') for (const part of ['start', 'end', 'flow']) generated.add(`${step.id}_${part}`);
  }
  const issues: OutlineIssue[] = [];
  const stepIds = new Set(graph.steps.map((s) => s.id));
  graph.steps.forEach((step, index) => {
    const base = step.id.endsWith('_di') ? step.id.slice(0, -3) : undefined;
    const clash =
      generated.has(step.id) ||
      /^(Flow|BPMNPlane|BPMNDiagram)_/.test(step.id) ||
      (base !== undefined && (stepIds.has(base) || generated.has(base)));
    if (clash) issues.push({ path: `steps[${index}].id`, message: C.outlineReservedId(step.id) });
  });
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

  const first = graph.steps[0]!;
  add(create('bpmn:StartEvent', { id: START_ID }), first.lane);
  for (const step of graph.steps) {
    const attrs: Record<string, unknown> = { id: step.id };
    if (step.name !== '') attrs['name'] = step.name;
    if (step.type === 'timer') attrs['eventDefinitions'] = [create('bpmn:TimerEventDefinition')];
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
  for (const step of graph.steps) {
    for (let k = 1; k <= endCount(step); k++) add(create('bpmn:EndEvent', { id: endId(step.id, k) }), step.lane);
  }

  const used = new Set<string>([...generated, ...stepIds]);
  const flows: Built['flows'] = [];
  const connect = (source: El, target: El, label?: string, probability?: number): void => {
    const id = flowId(source.id, target.id, used);
    const attrs: Record<string, unknown> = { id, sourceRef: source, targetRef: target };
    if (label !== undefined && label !== '') attrs['name'] = label;
    const flow = create('bpmn:SequenceFlow', attrs);
    (source['outgoing'] ??= []).push(flow);
    (target['incoming'] ??= []).push(flow);
    process['flowElements'].push(flow);
    flows.push({ id, source: source.id, probability });
  };
  connect(nodes.get(START_ID)!, nodes.get(first.id)!);
  for (const step of graph.steps) {
    let ended = 0;
    for (const s of step.succ) {
      const target = s.to === END ? nodes.get(endId(step.id, ++ended))! : nodes.get(s.to)!;
      connect(nodes.get(step.id)!, target, s.label, s.probability);
    }
  }

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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * An orthogonal route from `s` to `t`: straight when they share a row; out of a gateway's top or
 * bottom and into a gateway's top or bottom when the rows differ (as bpmn-js draws a split and a
 * join); a backward flow (a loop) goes under both shapes.
 */
function route(s: Box, t: Box, sourceGateway: boolean, targetGateway: boolean): { x: number; y: number }[] {
  const sy = s.y + s.height / 2;
  const ty = t.y + t.height / 2;
  const sx = s.x + s.width / 2;
  const tx = t.x + t.width / 2;
  if (t.x >= s.x + s.width) {
    if (Math.abs(sy - ty) < 1) return [{ x: s.x + s.width, y: sy }, { x: t.x, y: ty }];
    if (sourceGateway) {
      return [{ x: sx, y: ty > sy ? s.y + s.height : s.y }, { x: sx, y: ty }, { x: t.x, y: ty }];
    }
    if (targetGateway) {
      return [{ x: s.x + s.width, y: sy }, { x: tx, y: sy }, { x: tx, y: sy > ty ? t.y + t.height : t.y }];
    }
    const x = t.x - 25;
    return [{ x: s.x + s.width, y: sy }, { x, y: sy }, { x, y: ty }, { x: t.x, y: ty }];
  }
  const below = Math.max(s.y + s.height, t.y + t.height) + 25;
  return [{ x: sx, y: s.y + s.height }, { x: sx, y: below }, { x: tx, y: below }, { x: tx, y: t.y + t.height }];
}

/**
 * Moves every node of the main plane into its lane's band and adds the pool and lane shapes (see
 * the header). Each lane is as tall as the layouter rows its nodes use, compacted; columns stay.
 */
function layOutLanes(definitions: El, graph: Graph, laneOf: Map<string, string>, create: (type: string, attrs?: Record<string, unknown>) => El): void {
  const process = (definitions['rootElements'] as El[]).find((el) => el.$type === 'bpmn:Process')!;
  const collaboration = (definitions['rootElements'] as El[]).find((el) => el.$type === 'bpmn:Collaboration')!;
  const participant = collaboration['participants'][0] as El;
  const diagram = (definitions['diagrams'] as El[]).find((d) => d['plane']['bpmnElement'] === process)!;
  const plane = diagram['plane'] as El;
  const planeElements = plane['planeElement'] as El[];
  const shapeOf = new Map<string, El>();
  for (const di of planeElements) if (di.$type === 'bpmndi:BPMNShape') shapeOf.set(di['bpmnElement'].id, di);

  const nodes = (process['flowElements'] as El[]).filter((el) => el.$type !== 'bpmn:SequenceFlow');
  const rowOf = (shape: El): number => Math.round((shape['bounds'].y + shape['bounds'].height / 2 - CELL_HEIGHT / 2) / CELL_HEIGHT);

  // Rows each lane uses, compacted top to bottom; an empty lane still gets one row.
  let top = 0;
  const bands = new Map<string, { top: number; rows: Map<number, number>; height: number }>();
  for (const lane of graph.lanes) {
    const rows = [...new Set(nodes.filter((n) => laneOf.get(n.id) === lane).map((n) => rowOf(shapeOf.get(n.id)!)))].sort((a, b) => a - b);
    const height = Math.max(1, rows.length) * CELL_HEIGHT;
    bands.set(lane, { top, rows: new Map(rows.map((row, index) => [row, index])), height });
    top += height;
  }

  let right = 0;
  for (const node of nodes) {
    const shape = shapeOf.get(node.id)!;
    const band = bands.get(laneOf.get(node.id)!)!;
    const bounds = shape['bounds'];
    const index = band.rows.get(rowOf(shape))!;
    bounds.x += 2 * HEADER;
    bounds.y = band.top + index * CELL_HEIGHT + (CELL_HEIGHT - bounds.height) / 2;
    right = Math.max(right, bounds.x + bounds.width);
  }

  const gateway = (el: El): boolean => el.$type.endsWith('Gateway');
  for (const di of planeElements) {
    if (di.$type !== 'bpmndi:BPMNEdge') continue;
    const flow = di['bpmnElement'] as El;
    const source = shapeOf.get(flow['sourceRef'].id)!['bounds'];
    const target = shapeOf.get(flow['targetRef'].id)!['bounds'];
    di['waypoint'] = route(source, target, gateway(flow['sourceRef']), gateway(flow['targetRef'])).map((p) =>
      create('dc:Point', { x: Math.round(p.x), y: Math.round(p.y) }),
    );
  }

  const width = right + MARGIN;
  const shapes: El[] = [
    create('bpmndi:BPMNShape', {
      id: `${participant.id}_di`,
      bpmnElement: participant,
      isHorizontal: true,
      bounds: create('dc:Bounds', { x: 0, y: 0, width, height: top }),
    }),
  ];
  for (const lane of process['laneSets'][0]['lanes'] as El[]) {
    const band = bands.get(lane['name'])!;
    shapes.push(
      create('bpmndi:BPMNShape', {
        id: `${lane.id}_di`,
        bpmnElement: lane,
        isHorizontal: true,
        bounds: create('dc:Bounds', { x: HEADER, y: band.top, width: width - HEADER, height: band.height }),
      }),
    );
  }
  plane['planeElement'] = [...shapes, ...planeElements];
  plane['bpmnElement'] = collaboration;
}

/**
 * `bpmn-auto-layout` 1.3 draws a sub-process collapsed but leaves the DI of its content on the
 * main plane, where bpmn-js would paint it over the process. Each sub-process gets its own
 * diagram instead (the drill-down plane bpmn-js opens), and its content's DI moves there.
 */
function separateSubprocessPlanes(definitions: El, create: (type: string, attrs?: Record<string, unknown>) => El): void {
  const main = (definitions['diagrams'] as El[])[0]!['plane'] as El;
  const moved = new Map<El, El[]>();
  const keep: El[] = [];
  for (const di of main['planeElement'] as El[]) {
    const parent = di['bpmnElement']?.['$parent'] as El | undefined;
    if (parent?.$type === 'bpmn:SubProcess') (moved.get(parent) ?? moved.set(parent, []).get(parent)!).push(di);
    else keep.push(di);
  }
  if (moved.size === 0) return;
  main['planeElement'] = keep;
  for (const [subprocess, elements] of moved) {
    const plane = create('bpmndi:BPMNPlane', { id: `BPMNPlane_${subprocess.id}`, bpmnElement: subprocess, planeElement: elements });
    (definitions['diagrams'] as El[]).push(create('bpmndi:BPMNDiagram', { id: `BPMNDiagram_${subprocess.id}`, plane }));
  }
}

function baseScenario(graph: Graph, built: Built): ScenarioDocument {
  const resources: Record<string, { name: string; capacity: number }> = {};
  const idOf = new Map<string, string>();
  const elements: Record<string, Record<string, unknown>> = { [START_ID]: { ...DEFAULT_ARRIVALS } };
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
    if (Object.keys(element).length > 0) elements[step.id] = element;
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
  const laidOut = await layoutProcess(semantic);
  const { rootElement: definitions } = await moddle.fromXML(laidOut);
  const create = (type: string, attrs: Record<string, unknown> = {}): El => moddle.create(type, attrs) as El;
  separateSubprocessPlanes(definitions as El, create);
  if (graph.lanes.length > 0) layOutLanes(definitions as El, graph, built.laneOf, create);
  const { xml: raw } = await moddle.toXML(definitions, { format: true });
  const xml = marcarExportador(raw);

  const report = await validateBpmnXml(xml, { locale });
  if (report.errors.length > 0) {
    fail(
      C,
      report.errors.map((e) => ({ path: `bpmn.${e.id}`, message: `${e.code}: ${e.message}` })),
      C.outlineBpmnInvalid,
    );
  }
  return { xml, scenario: baseScenario(graph, built), warnings: report.warnings, outline: toNormal(graph) };
}

/* ------------------------------------------------------------------ *
 * BPMN → outline
 * ------------------------------------------------------------------ */

const OUTLINE_TYPE: Readonly<Record<string, OutlineStepType>> = {
  'bpmn:Task': 'task',
  'bpmn:UserTask': 'userTask',
  'bpmn:ServiceTask': 'serviceTask',
  'bpmn:CallActivity': 'callActivity',
  'bpmn:ExclusiveGateway': 'xor',
  'bpmn:ParallelGateway': 'and',
  'bpmn:InclusiveGateway': 'or',
  'bpmn:SubProcess': 'subprocess',
  // Other task flavours keep their behaviour in the simulator (all are tasks, R-PERF-1).
  'bpmn:ManualTask': 'task',
  'bpmn:ScriptTask': 'task',
  'bpmn:BusinessRuleTask': 'task',
  'bpmn:SendTask': 'task',
  'bpmn:ReceiveTask': 'task',
};

export interface BpmnToOutlineOptions {
  locale?: Locale | undefined;
  /**
   * A scenario of the process (e.g. its `as-is.scenario.json`): its `processingTime`, `resources`
   * and flow `probability` come back as `duration`, `resources` and branch `probability`.
   */
  scenario?: Record<string, unknown> | undefined;
}

export interface OutlineReading {
  /** The outline, in normal form. */
  readonly outline: NormalOutline;
  /** What the outline could not carry (other event types, extra start events, nested lanes…). */
  readonly warnings: readonly string[];
}

function record(value: unknown): Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

/**
 * Reads the first process of `xml` (the pool's, when there is a collaboration) as an outline. The
 * start event and the end events become implicit; steps keep the document order.
 */
export async function bpmnToOutline(xml: string, options: BpmnToOutlineOptions = {}): Promise<OutlineReading> {
  const C = messages(options.locale ?? 'en').cli;
  const moddle = BpmnModdle({ lila });
  const { rootElement } = await moddle.fromXML(xml);
  const roots = ((rootElement as El)['rootElements'] ?? []) as El[];
  const participant = roots
    .filter((el) => el.$type === 'bpmn:Collaboration')
    .flatMap((el) => (el['participants'] ?? []) as El[])
    .find((p) => p['processRef'] !== undefined);
  const process = (participant?.['processRef'] as El | undefined) ?? roots.find((el) => el.$type === 'bpmn:Process');
  if (process === undefined) throw new OutlineError(C.outlineNoProcess(), [{ path: 'bpmn', message: C.outlineNoProcess() }]);

  const warnings: string[] = [];
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
  const kept = new Map<string, OutlineStepType>();
  const ends = new Set<string>();
  const starts: El[] = [];
  for (const el of flowElements) {
    if (el.$type === 'bpmn:SequenceFlow') continue;
    if (el.$type === 'bpmn:StartEvent') starts.push(el);
    else if (el.$type === 'bpmn:EndEvent') ends.add(el.id);
    else if (
      el.$type === 'bpmn:IntermediateCatchEvent' &&
      ((el['eventDefinitions'] ?? []) as El[]).some((d) => d.$type === 'bpmn:TimerEventDefinition')
    ) {
      kept.set(el.id, 'timer');
    } else if (OUTLINE_TYPE[el.$type] !== undefined) kept.set(el.id, OUTLINE_TYPE[el.$type]!);
    else warnings.push(C.outlineUnsupported(el.id, el.$type));
  }
  for (const extra of starts.slice(1)) warnings.push(C.outlineUnsupported(extra.id, extra.$type));

  const flowsFrom = new Map<string, El[]>();
  for (const flow of flowElements.filter((el) => el.$type === 'bpmn:SequenceFlow')) {
    const source = flow['sourceRef'] as El | undefined;
    const target = flow['targetRef'] as El | undefined;
    if (source === undefined || target === undefined) continue;
    const known = (id: string): boolean => kept.has(id) || ends.has(id) || id === starts[0]?.id;
    if (!known(source.id) || !known(target.id) || (starts.length > 0 && starts.slice(1).some((s) => s.id === source.id))) {
      warnings.push(C.outlineLostFlow(flow.id));
      continue;
    }
    (flowsFrom.get(source.id) ?? flowsFrom.set(source.id, []).get(source.id)!).push(flow);
  }

  // The start's target leads the list; the rest keep the document order.
  const order = [...kept.keys()];
  const firstId = (flowsFrom.get(starts[0]?.id ?? '') ?? [])[0]?.['targetRef']?.id as string | undefined;
  if (firstId !== undefined && kept.has(firstId)) order.splice(order.indexOf(firstId), 1), order.unshift(firstId);

  const steps: GraphStep[] = order.map((id) => {
    const el = flowElements.find((e) => e.id === id)!;
    const type = kept.get(id)!;
    const succ: Successor[] = (flowsFrom.get(id) ?? []).map((flow) => {
      const target = flow['targetRef'].id as string;
      const probability = record(elements[flow.id])['probability'];
      return {
        to: ends.has(target) ? END : target,
        label: (flow['name'] as string | undefined) || undefined,
        probability: GATEWAYS.has(type) && typeof probability === 'number' ? probability : undefined,
      };
    });
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
    return { id, name: (el['name'] as string | undefined) ?? '', type, lane: laneOf.get(id), succ, duration, resources };
  });

  const name = (participant?.['name'] as string | undefined) ?? (process['name'] as string | undefined) ?? '';
  return { outline: toNormal({ name, lanes, steps }), warnings };
}
