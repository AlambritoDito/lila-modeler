/**
 * Edits (#98): a list of operations applied to one process of a BPMN model, all or none. What
 * `edit_process` (MCP) and `lila process edit` (CLI) do, through `editLilaProcess` in
 * `project-fs/edit.ts`.
 *
 * The operations work on the `bpmn-moddle` tree of the whole document (with Lila's extension
 * loaded), so everything they do not touch is written back as it was read: documentation, `lila:`
 * extension elements (RACI, references, extended attributes), other vendors' extensions, text
 * annotations, data objects, other pools and message flows. Any model can be edited, not only one
 * `create_process` made: one drawn in the app or imported from Bizagi too. A document `bpmn-moddle`
 * could not read completely (it would drop content when writing) is refused.
 *
 * All or none: every operation is checked and applied in order on the tree in memory; then the
 * result is validated with `validateBpmnXml`. Any problem (a bad operation, or a validation error
 * the original model did not have) throws `EditError` with every issue and the index of the
 * operation it comes from, and nothing is returned to write.
 *
 * Ids never change: a renamed or retyped element keeps its scenario entries. Durations, resources
 * and branch probabilities given in `add` and `connect` go into the base scenario passed in
 * `scenario` (as in `create_process`). Scenario entries of removed elements are not deleted: the
 * caller reports them.
 *
 * Browser-safe, like `outline.ts`.
 */
import { BpmnModdle } from 'bpmn-moddle';
import { z } from 'zod';

import lila from './lila.moddle.json' with { type: 'json' };
import { isNCName, marcarExportador } from './ids.js';
import { OUTLINE_STEP_TYPES, OutlineSchema, parseDuration, type OutlineStepType } from './outline.js';
import { validateBpmnXml } from './validate-report.js';
import type { ValidationResult } from './validate.js';
import { Diagram, is, relayout, type El } from './edit-layout.js';
import { laneOfNode, lanesOf, LayoutError } from './layout.js';
import { messages, type CliMessages, type Locale } from '../messages/index.js';
import type { Distribution } from '../scenario.js';
import type { ScenarioDocument } from '../project/types.js';
import { processSlug } from '../project/repository.js';

/* ------------------------------------------------------------------ *
 * The operations
 * ------------------------------------------------------------------ */

const Id = z.string().min(1);

/** A step as in an outline (#97), without its connections: `add` places it with `after`/`between`. */
const EditStepSchema = OutlineSchema.shape.steps.element.omit({ next: true, branches: true, end: true });

export const EditOperationSchema = z.discriminatedUnion('op', [
  z
    .strictObject({
      op: z.literal('add'),
      step: EditStepSchema.describe('The new step: {id, name?, type?, lane?, duration?, resources?}, as in an outline.'),
      after: Id.optional().describe('Id of the step it follows: it takes over that step\'s outgoing flow.'),
      between: z.tuple([Id, Id]).optional().describe('[from, to]: inserted on the flow from → to.'),
    })
    .describe('Adds a step after a step, between two connected steps, or unconnected (connect it with `connect`).'),
  z
    .strictObject({
      op: z.literal('connect'),
      from: Id,
      to: Id,
      label: z.string().optional().describe('Name of the flow, e.g. "Yes".'),
      probability: z.number().min(0).max(1).optional().describe('Out of an xor/or gateway: the branch probability in the base scenario.'),
      id: Id.optional().describe('Id of the new flow. Default Flow_<from>_<to>.'),
    })
    .describe('Adds a sequence flow.'),
  z
    .strictObject({ op: z.literal('remove'), id: Id })
    .describe('Removes a step (its predecessors are reconnected to its successor when that is unambiguous) or a sequence flow.'),
  z.strictObject({ op: z.literal('rename'), id: Id, name: z.string() }).describe('Renames any element: step, flow, lane, pool or process. "" clears the name.'),
  z.strictObject({ op: z.literal('setType'), id: Id, type: z.enum(OUTLINE_STEP_TYPES) }).describe('Changes the type of a step; its id, name, flows and annotations stay.'),
  z.strictObject({ op: z.literal('moveToLane'), id: Id, lane: Id.describe('Lane name or id.') }).describe('Moves a step to another lane.'),
  z
    .strictObject({
      op: z.literal('addLane'),
      name: z.string().min(1),
      id: Id.optional().describe('Id of the new lane. Default Lane_<n>.'),
      after: Id.optional().describe('Lane (name or id) it goes below. Default: the last one.'),
      before: Id.optional().describe('Lane (name or id) it goes above.'),
    })
    .describe('Adds a lane. The first lane of a process without lanes holds all its steps (and the process gets a pool if it had none).'),
]);
export const EditOperationsSchema = z.array(EditOperationSchema).min(1);

export type EditOperation = z.input<typeof EditOperationSchema>;
type Op = z.output<typeof EditOperationSchema>;

export interface EditIssue {
  /** Index of the operation in the list; `null` when it is about the model as a whole. */
  readonly op: number | null;
  /** Where: `step.duration`, `between`, or `bpmn.<id>` for a validation error. */
  readonly path: string;
  readonly message: string;
}

/** Thrown by `editBpmn`: nothing was applied. */
export class EditError extends Error {
  readonly code = 'LILA-EDIT';
  constructor(
    message: string,
    readonly issues: readonly EditIssue[],
  ) {
    super(message);
    this.name = 'EditError';
  }
}

export interface EditChange {
  readonly op: number;
  /** One line for a person: what the operation did. */
  readonly message: string;
}

export interface EditBpmnOptions {
  locale?: Locale | undefined;
  /** `true` (default): lay the process out again. `false`: keep every position, place only what is new. */
  layout?: boolean | undefined;
  /** The base scenario that receives the durations, resources and probabilities given. */
  scenario?: ScenarioDocument | undefined;
  /** Its name, for messages. */
  scenarioName?: string | undefined;
}

export interface BpmnEdit {
  /** The edited model, validated (no errors it did not have before). */
  readonly xml: string;
  readonly changes: readonly EditChange[];
  /** Every id the edit removed (steps, flows, and what went with them). */
  readonly removed: readonly string[];
  /** The base scenario with what the operations gave it; `undefined` when it did not change. */
  readonly scenario: ScenarioDocument | undefined;
  /** The validator's warnings on the edited model. */
  readonly warnings: ValidationResult['warnings'];
  /** Things worth a look that are not errors (branch probabilities that no longer add up to 1…). */
  readonly notes: readonly string[];
}

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
const WORK: ReadonlySet<OutlineStepType> = new Set(['task', 'userTask', 'serviceTask', 'callActivity']);

/** Short name of a node's type, for messages: the outline's when it has one. */
function typeName(el: El): string {
  if (el.$type === 'bpmn:IntermediateCatchEvent' && isTimer(el)) return 'timer';
  const known = (Object.entries(BPMN_TYPE) as [OutlineStepType, string][]).find(([, t]) => t === el.$type);
  return known?.[0] ?? el.$type.replace(/^bpmn:/, '');
}

function isTimer(el: El): boolean {
  return ((el['eventDefinitions'] ?? []) as El[]).some((d) => d.$type === 'bpmn:TimerEventDefinition');
}

/** Every element of `root` reachable through its properties (semantic tree and DI), once. */
function* everything(root: unknown): Generator<El> {
  const seen = new Set<object>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value !== 'object' || value === null || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    const el = value as El;
    if (typeof el.$type !== 'string') continue;
    yield el;
    for (const key of Object.keys(el)) if (key !== '$parent') stack.push(el[key]);
  }
}

/** The process the simulator reads (`parseBpmn`'s rule): executable and non-empty, else non-empty, else first. */
function mainProcess(definitions: El): El | undefined {
  const processes = ((definitions['rootElements'] ?? []) as El[]).filter((el) => el.$type === 'bpmn:Process');
  const nonEmpty = (el: El): boolean => ((el['flowElements'] ?? []) as El[]).length > 0;
  return processes.find((el) => el['isExecutable'] === true && nonEmpty(el)) ?? processes.find(nonEmpty) ?? processes[0];
}

/* ------------------------------------------------------------------ *
 * The editor
 * ------------------------------------------------------------------ */

class Editor {
  readonly used = new Set<string>();
  readonly removed: string[] = [];
  /** element id → index of the last operation that touched it, to attribute validation errors */
  readonly touched = new Map<string, number>();
  readonly changes: EditChange[] = [];
  readonly issues: EditIssue[] = [];
  readonly diagram: Diagram;
  participant: El | undefined;
  scenario: Record<string, any> | undefined;
  scenarioChanged = false;
  /** gateways whose branches changed, for the probability note */
  readonly gateways = new Set<El>();
  op = 0;
  /** Incremental layout (`layout: false`): the operations keep the DI up to date as they go. */
  incremental = true;
  /** The pool's bounds before the edit. */
  readonly pool: { x: number; y: number; width: number; height: number } | undefined;

  constructor(
    readonly moddle: ReturnType<typeof BpmnModdle>,
    readonly definitions: El,
    readonly process: El,
    readonly C: CliMessages,
    scenario: ScenarioDocument | undefined,
    readonly scenarioName: string,
  ) {
    for (const el of everything(definitions)) if (typeof el.id === 'string') this.used.add(el.id);
    this.participant = ((definitions['rootElements'] ?? []) as El[])
      .filter((r) => r.$type === 'bpmn:Collaboration')
      .flatMap((c) => (c['participants'] ?? []) as El[])
      .find((p) => p['processRef'] === process);
    this.diagram = new Diagram(definitions, (type, attrs) => this.create(type, attrs), (base) => this.uniqueId(base));
    this.diagram.owns = (el) => el === this.participant || el === this.process || (el !== undefined && this.inProcess(el));
    const pool = this.participant === undefined ? undefined : this.diagram.bounds(this.participant.id);
    this.pool = pool === undefined ? undefined : { x: pool.x, y: pool.y, width: pool.width, height: pool.height };
    this.scenario = scenario === undefined ? undefined : (structuredClone(scenario) as Record<string, any>);
  }

  create(type: string, attrs: Record<string, unknown> = {}): El {
    return this.moddle.create(type, attrs) as unknown as El;
  }

  uniqueId(base: string): string {
    let id = base;
    for (let n = 2; this.used.has(id); n++) id = `${base}_${n}`;
    this.used.add(id);
    return id;
  }

  issue(path: string, message: string): void {
    this.issues.push({ op: this.op, path, message });
  }

  change(message: string): void {
    this.changes.push({ op: this.op, message });
  }

  touch(...els: (El | undefined)[]): void {
    for (const el of els) if (el !== undefined) this.touched.set(el.id, this.op);
  }

  /* --- lookups --- */

  find(id: string): El | undefined {
    for (const el of everything(this.definitions['rootElements'])) if (el.id === id) return el;
    return undefined;
  }

  /** A flow node of the document by id, or an issue at `path`. */
  node(id: string, path: string): El | undefined {
    const el = this.find(id);
    if (el === undefined) {
      this.issue(path, this.C.editUnknownId(id));
      return undefined;
    }
    if (!is(el, 'bpmn:FlowNode')) {
      this.issue(path, this.C.editNotAStep(id, el.$type));
      return undefined;
    }
    if (!this.inProcess(el)) {
      this.issue(path, this.C.editOtherProcess(id, this.process.id));
      return undefined;
    }
    return el;
  }

  inProcess(el: El): boolean {
    for (let p = el['$parent'] as El | undefined; p !== undefined; p = p['$parent']) if (p === this.process) return true;
    return false;
  }

  flows(container: El): El[] {
    return ((container['flowElements'] ?? []) as El[]).filter((el) => el.$type === 'bpmn:SequenceFlow');
  }

  incoming(node: El): El[] {
    return this.flows(node['$parent']).filter((f) => f['targetRef'] === node);
  }

  outgoing(node: El): El[] {
    return this.flows(node['$parent']).filter((f) => f['sourceRef'] === node);
  }

  /** Message flows and associations of the whole document. */
  links(): El[] {
    const out: El[] = [];
    for (const el of everything(this.definitions['rootElements'])) {
      if (el.$type === 'bpmn:MessageFlow' || el.$type === 'bpmn:Association') out.push(el);
    }
    return out;
  }

  lane(ref: string, path: string): El | undefined {
    const all = lanesOf(this.process);
    const byId = all.find((l) => l.lane.id === ref);
    if (byId !== undefined) return byId.lane;
    const byName = all.filter((l) => l.lane['name'] === ref);
    if (byName.length === 1) return byName[0]!.lane;
    if (byName.length > 1) this.issue(path, this.C.editLaneAmbiguous(ref, byName.map((l) => l.lane.id).join(', ')));
    else this.issue(path, this.C.editLaneUnknown(ref, all.map((l) => (l.lane['name'] as string | undefined) ?? l.lane.id).join(', ')));
    return undefined;
  }

  /** `lane` and the lanes above it: where a node of `lane` is listed. */
  laneChain(lane: El): El[] {
    const chain: El[] = [];
    for (let l: El | undefined = lane; l !== undefined && l.$type === 'bpmn:Lane'; l = l['$parent']?.['$parent']) chain.push(l);
    return chain;
  }

  /* --- mutations --- */

  free(id: string): void {
    this.used.delete(id);
    for (const map of [this.diagram.shapes, this.diagram.edges]) {
      const di = map.get(id);
      if (di !== undefined) this.used.delete(di.id);
    }
    this.diagram.removeDi(id);
  }

  newFlow(source: El, target: El, options: { id?: string | undefined; name?: string | undefined } = {}): El {
    const container = source['$parent'] as El;
    const id = options.id ?? this.uniqueId(`Flow_${source.id}_${target.id}`);
    if (options.id !== undefined) this.used.add(options.id);
    const attrs: Record<string, unknown> = { id, sourceRef: source, targetRef: target };
    if (options.name !== undefined && options.name !== '') attrs['name'] = options.name;
    const flow = this.create('bpmn:SequenceFlow', attrs);
    flow['$parent'] = container;
    (container['flowElements'] as El[]).push(flow);
    (source['outgoing'] ??= []).push(flow);
    (target['incoming'] ??= []).push(flow);
    this.diagram.routeFlow(flow);
    this.touch(flow);
    if (is(source, 'bpmn:Gateway')) this.gateways.add(source);
    return flow;
  }

  retarget(flow: El, target: El): void {
    const old = flow['targetRef'] as El;
    old['incoming'] = ((old['incoming'] ?? []) as El[]).filter((f) => f !== flow);
    flow['targetRef'] = target;
    (target['incoming'] ??= []).push(flow);
    this.diagram.routeFlow(flow);
    this.touch(flow, target);
  }

  deleteFlow(flow: El): void {
    const container = flow['$parent'] as El;
    container['flowElements'] = (container['flowElements'] as El[]).filter((f) => f !== flow);
    const source = flow['sourceRef'] as El | undefined;
    const target = flow['targetRef'] as El | undefined;
    if (source !== undefined) {
      source['outgoing'] = ((source['outgoing'] ?? []) as El[]).filter((f) => f !== flow);
      if (source['default'] === flow) delete source['default'];
      if (is(source, 'bpmn:Gateway')) this.gateways.add(source);
      this.touch(source);
    }
    if (target !== undefined) {
      target['incoming'] = ((target['incoming'] ?? []) as El[]).filter((f) => f !== flow);
      this.touch(target);
    }
    this.free(flow.id);
    this.removed.push(flow.id);
  }

  /** Removes a message flow or an association from wherever it is listed. */
  deleteLink(link: El): void {
    const owner = link['$parent'] as El;
    for (const key of ['messageFlows', 'artifacts']) {
      if (Array.isArray(owner[key])) owner[key] = (owner[key] as El[]).filter((l) => l !== link);
    }
    this.free(link.id);
    this.removed.push(link.id);
  }

  /** Removes `node` with what hangs on it; its sequence flows must be handled before. Returns what else went. */
  deleteNode(node: El): string[] {
    const container = node['$parent'] as El;
    container['flowElements'] = (container['flowElements'] as El[]).filter((el) => el !== node);
    for (const { lane } of lanesOf(this.process)) {
      if (Array.isArray(lane['flowNodeRef'])) lane['flowNodeRef'] = (lane['flowNodeRef'] as El[]).filter((n) => n !== node);
    }
    const also: string[] = [];
    // Everything inside a sub-process goes with it, with its own diagram.
    const inner = [...everything(node['flowElements'] ?? []), ...everything(node['artifacts'] ?? [])].filter((el) => typeof el.id === 'string');
    const gone = new Set<El>([node, ...inner]);
    for (const el of inner) {
      this.free(el.id);
      this.removed.push(el.id);
      also.push(el.id);
    }
    const diagrams = (this.definitions['diagrams'] ?? []) as El[];
    for (const d of diagrams.filter((d) => gone.has(d['plane']?.['bpmnElement']))) {
      for (const di of everything(d)) if (typeof di.id === 'string') this.used.delete(di.id);
    }
    this.definitions['diagrams'] = diagrams.filter((d) => !gone.has(d['plane']?.['bpmnElement']));
    this.diagram.index();
    for (const link of this.links()) {
      if (gone.has(link['sourceRef']) || gone.has(link['targetRef'])) {
        this.deleteLink(link);
        also.push(link.id);
      }
    }
    this.free(node.id);
    this.removed.push(node.id);
    return also;
  }

  /** Durations and resources of a new step go into the base scenario. */
  scenarioElement(id: string): Record<string, any> | undefined {
    if (this.scenario === undefined) return undefined;
    const elements = (this.scenario['elements'] ??= {}) as Record<string, any>;
    this.scenarioChanged = true;
    return (elements[id] ??= {});
  }

  resourceRef(name: string, quantity: number): string {
    const resources = (this.scenario!['resources'] ??= {}) as Record<string, any>;
    const existing = Object.keys(resources).find((ref) => ref === name || resources[ref]?.name === name);
    if (existing !== undefined) return existing;
    const ref = processSlug(name, Object.keys(resources));
    resources[ref] = { name, capacity: Math.max(1, quantity) };
    return ref;
  }

  /** The inside of a new sub-process: start → end, as `create_process` makes it, on its own diagram. */
  fillSubprocess(el: El): void {
    const start = this.create('bpmn:StartEvent', { id: this.uniqueId(`${el.id}_start`) });
    const end = this.create('bpmn:EndEvent', { id: this.uniqueId(`${el.id}_end`) });
    const flow = this.create('bpmn:SequenceFlow', { id: this.uniqueId(`${el.id}_flow`), sourceRef: start, targetRef: end });
    start['outgoing'] = [flow];
    end['incoming'] = [flow];
    for (const child of [start, end, flow]) child['$parent'] = el;
    el['flowElements'] = [start, end, flow];
    if (!this.diagram.hasDi) return;
    const plane = this.create('bpmndi:BPMNPlane', { id: this.uniqueId(`BPMNPlane_${el.id}`), bpmnElement: el, planeElement: [] });
    ((this.definitions['diagrams'] ??= []) as El[]).push(this.create('bpmndi:BPMNDiagram', { id: this.uniqueId(`BPMNDiagram_${el.id}`), plane }));
    this.diagram.addShape(start, plane, { x: 180, y: 160, width: 36, height: 36 });
    this.diagram.addShape(end, plane, { x: 300, y: 160, width: 36, height: 36 });
    this.diagram.routeFlow(flow);
  }

  /** The pool of the process, created (with a collaboration) when it has none. */
  ensurePool(): El {
    if (this.participant !== undefined) return this.participant;
    const roots = this.definitions['rootElements'] as El[];
    let collaboration = roots.find((r) => r.$type === 'bpmn:Collaboration');
    if (collaboration === undefined) {
      collaboration = this.create('bpmn:Collaboration', { id: this.uniqueId('Collaboration_1'), participants: [] });
      collaboration['$parent'] = this.definitions;
      roots.unshift(collaboration);
    }
    const participant = this.create('bpmn:Participant', {
      id: this.uniqueId('Participant_1'),
      processRef: this.process,
      ...(this.process['name'] ? { name: this.process['name'] } : {}),
    });
    participant['$parent'] = collaboration;
    ((collaboration['participants'] ??= []) as El[]).push(participant);
    this.participant = participant;
    const plane = this.diagram.mainPlane(this.process);
    if (plane !== undefined && plane['bpmnElement'] === this.process) plane['bpmnElement'] = collaboration;
    if (this.incremental && this.diagram.hasDi && plane !== undefined) {
      const boxes = this.diagram
        .nodeShapes(plane)
        .filter((di) => this.inProcess(di['bpmnElement']))
        .map((di) => di['bounds']);
      if (boxes.length > 0) {
        const x = Math.min(...boxes.map((b) => b.x));
        const y = Math.min(...boxes.map((b) => b.y));
        const r = Math.max(...boxes.map((b) => b.x + b.width));
        const b = Math.max(...boxes.map((b) => b.y + b.height));
        this.diagram.addShape(participant, plane, { x: x - 100, y: y - 40, width: r - x + 140, height: b - y + 80 }, { isHorizontal: true });
      }
    }
    return participant;
  }

  /* --- the operations --- */

  apply(op: Op): void {
    const before = this.issues.length;
    switch (op.op) {
      case 'add':
        return this.add(op, before);
      case 'connect':
        return this.connect(op, before);
      case 'remove':
        return this.remove(op);
      case 'rename':
        return this.rename(op);
      case 'setType':
        return this.setType(op);
      case 'moveToLane':
        return this.moveToLane(op);
      case 'addLane':
        return this.addLane(op, before);
    }
  }

  checkNewId(id: string, path: string): boolean {
    if (!isNCName(id)) {
      this.issue(path, this.C.editBadId(id));
      return false;
    }
    if (this.used.has(id) || this.used.has(`${id}_di`)) {
      this.issue(path, this.C.editIdTaken(id));
      return false;
    }
    return true;
  }

  add(op: Extract<Op, { op: 'add' }>, before: number): void {
    const { step } = op;
    const type: OutlineStepType = step.type ?? 'task';
    this.checkNewId(step.id, 'step.id');
    if (op.after !== undefined && op.between !== undefined) this.issue('between', this.C.editAfterAndBetween());

    let anchor: El | undefined;
    let next: El | undefined;
    let split: El | undefined;
    if (op.after !== undefined) {
      anchor = this.node(op.after, 'after');
      if (anchor !== undefined && is(anchor, 'bpmn:EndEvent')) this.issue('after', this.C.editAfterEnd(op.after));
      else if (anchor !== undefined) {
        const outs = this.outgoing(anchor);
        if (outs.length > 1) this.issue('after', this.C.editAfterAmbiguous(op.after, outs.length));
        split = outs[0];
        next = split?.['targetRef'];
      }
    } else if (op.between !== undefined) {
      anchor = this.node(op.between[0], 'between[0]');
      next = this.node(op.between[1], 'between[1]');
      if (anchor !== undefined && next !== undefined) {
        split = this.outgoing(anchor).find((f) => f['targetRef'] === next);
        if (split === undefined) this.issue('between', this.C.editNoFlowBetween(op.between[0], op.between[1]));
      }
    }
    const container = (anchor?.['$parent'] as El | undefined) ?? this.process;

    let lane: El | undefined;
    if (step.lane !== undefined) {
      if (container !== this.process) this.issue('step.lane', this.C.editLaneOutsideProcess(step.id));
      else lane = this.lane(step.lane, 'step.lane');
    } else if (container === this.process) {
      lane = anchor === undefined ? lanesOf(this.process).find((l) => l.leaf)?.lane : laneOfNode(this.process, anchor);
    }

    let duration: Distribution | undefined;
    if (step.duration !== undefined) {
      if (!WORK.has(type) && type !== 'timer') this.issue('step.duration', this.C.outlineFieldNotApplicable(step.id, 'duration', type));
      duration = parseDuration(step.duration as string | number | Distribution) ?? undefined;
      if (duration === undefined) {
        const text = typeof step.duration === 'string' ? step.duration : JSON.stringify(step.duration);
        this.issue('step.duration', this.C.outlineBadDuration(step.id, text));
      }
      if (this.scenario === undefined) this.issue('step.duration', this.C.editNeedsScenario('duration', this.scenarioName));
    }
    if (step.selection !== undefined && (step.resources === undefined || !WORK.has(type))) {
      this.issue('step.selection', this.C.outlineFieldNotApplicable(step.id, 'selection', type));
    }
    if (step.resources !== undefined) {
      if (!WORK.has(type)) this.issue('step.resources', this.C.outlineFieldNotApplicable(step.id, 'resources', type));
      if (this.scenario === undefined) this.issue('step.resources', this.C.editNeedsScenario('resources', this.scenarioName));
    }
    if (this.issues.length > before) return;

    const attrs: Record<string, unknown> = { id: step.id };
    if (step.name !== undefined && step.name !== '') attrs['name'] = step.name;
    if (type === 'timer') attrs['eventDefinitions'] = [this.create('bpmn:TimerEventDefinition', { id: this.uniqueId(`TimerEventDefinition_${step.id}`) })];
    const el = this.create(BPMN_TYPE[type], attrs);
    el['$parent'] = container;
    this.used.add(step.id);
    const elements = container['flowElements'] as El[];
    const at = anchor === undefined ? -1 : elements.indexOf(anchor);
    elements.splice(at === -1 ? elements.length : at + 1, 0, el);
    if (lane !== undefined) for (const l of this.laneChain(lane)) ((l['flowNodeRef'] ??= []) as El[]).push(el);
    this.touch(el, anchor, next);

    const plane = this.diagram.hasDi && this.incremental ? this.diagram.planeFor(container, this.process) : undefined;
    if (plane !== undefined) {
      this.diagram.place(el, plane, { anchor, next, lane, pool: container === this.process ? this.participant : undefined });
      if (type === 'subprocess') this.diagram.shapes.get(el.id)!['isExpanded'] = false;
    }
    if (type === 'subprocess') this.fillSubprocess(el);

    if (split !== undefined && next !== undefined) {
      // The flow into the old successor now ends at the new step (it keeps its id, name and
      // probability); a new flow goes on from the new step.
      this.retarget(split, el);
      this.newFlow(el, next);
    } else if (anchor !== undefined) {
      this.newFlow(anchor, el);
    }

    if (duration !== undefined || step.resources !== undefined) {
      const entry = this.scenarioElement(step.id)!;
      if (duration !== undefined) entry['processingTime'] = duration;
      if (step.resources !== undefined) {
        entry['resources'] = step.resources.map((r) => {
          const name = typeof r === 'string' ? r : r.name;
          const quantity = typeof r === 'string' ? 1 : (r.quantity ?? 1);
          return { ref: this.resourceRef(name, quantity), quantity };
        });
        if (step.selection !== undefined) entry['selection'] = step.selection;
      }
    }

    let position = this.C.editPositionAlone();
    if (op.between !== undefined) position = this.C.editPositionBetween(op.between[0], op.between[1]);
    else if (op.after !== undefined) position = this.C.editPositionAfter(op.after);
    if (lane !== undefined) position += ' ' + this.C.editPositionLane((lane['name'] as string | undefined) ?? lane.id);
    this.change(this.C.editAdded(step.id, type, position));
  }

  connect(op: Extract<Op, { op: 'connect' }>, before: number): void {
    const from = this.node(op.from, 'from');
    const to = this.node(op.to, 'to');
    if (from !== undefined && is(from, 'bpmn:EndEvent')) this.issue('from', this.C.editFromEnd(op.from));
    if (to !== undefined && (is(to, 'bpmn:StartEvent') || is(to, 'bpmn:BoundaryEvent'))) this.issue('to', this.C.editToStart(op.to));
    if (from !== undefined && to !== undefined && from['$parent'] !== to['$parent']) this.issue('to', this.C.editOtherContainer(op.from, op.to));
    if (op.id !== undefined) this.checkNewId(op.id, 'id');
    if (op.probability !== undefined) {
      if (from !== undefined && !is(from, 'bpmn:ExclusiveGateway') && !is(from, 'bpmn:InclusiveGateway')) {
        this.issue('probability', this.C.editProbabilityNeedsChoice(op.from));
      }
      if (this.scenario === undefined) this.issue('probability', this.C.editNeedsScenario('probability', this.scenarioName));
    }
    if (this.issues.length > before || from === undefined || to === undefined) return;
    const flow = this.newFlow(from, to, { id: op.id, name: op.label });
    this.touch(from, to);
    if (op.probability !== undefined) this.scenarioElement(flow.id)!['probability'] = op.probability;
    this.change(this.C.editConnected(op.from, op.to, flow.id));
  }

  remove(op: Extract<Op, { op: 'remove' }>): void {
    const el = this.find(op.id);
    if (el === undefined) return this.issue('id', this.C.editUnknownId(op.id));
    if (!this.inProcess(el)) return this.issue('id', this.C.editOtherProcess(op.id, this.process.id));
    if (el.$type === 'bpmn:SequenceFlow') {
      this.deleteFlow(el);
      return this.change(this.C.editRemovedFlow(op.id));
    }
    if (!is(el, 'bpmn:FlowNode')) return this.issue('id', this.C.editCannotRemove(op.id, el.$type));
    const boundaries = ((el['$parent']['flowElements'] ?? []) as El[]).filter((b) => b['attachedToRef'] === el);
    if (boundaries.length > 0) return this.issue('id', this.C.editRemoveBoundary(op.id, boundaries.map((b) => b.id).join(', ')));

    const ins = this.incoming(el);
    const outs = this.outgoing(el);
    const reconnected: string[] = [];
    if (outs.length <= 1) {
      const successor = outs[0]?.['targetRef'] as El | undefined;
      if (outs[0] !== undefined) this.deleteFlow(outs[0]);
      for (const flow of ins) {
        if (successor !== undefined && successor !== el) {
          this.retarget(flow, successor);
          reconnected.push(`${flow['sourceRef'].id} → ${successor.id}`);
        } else this.deleteFlow(flow);
      }
    } else if (ins.length === 0) {
      for (const flow of outs) this.deleteFlow(flow);
    } else {
      return this.issue('id', this.C.editRemoveAmbiguous(op.id, ins.length, outs.length));
    }
    for (const flow of [...ins, ...outs]) this.touch(flow['sourceRef'], flow['targetRef']);
    const also = this.deleteNode(el);
    this.change(this.C.editRemovedStep(op.id, reconnected.join(', '), also.join(', ')));
  }

  rename(op: Extract<Op, { op: 'rename' }>): void {
    const el = this.find(op.id);
    if (el === undefined) return this.issue('id', this.C.editUnknownId(op.id));
    const before = (el['name'] as string | undefined) ?? '';
    if (op.name === '') delete el['name'];
    else el['name'] = op.name;
    this.touch(el);
    this.change(this.C.editRenamed(op.id, before, op.name));
  }

  setType(op: Extract<Op, { op: 'setType' }>): void {
    const el = this.node(op.id, 'id');
    if (el === undefined) return;
    if (is(el, 'bpmn:BoundaryEvent')) return this.issue('id', this.C.editNotAStep(op.id, el.$type));
    const from = typeName(el);
    if (from === op.type) return this.change(this.C.editRetyped(op.id, from, op.type));
    const type = BPMN_TYPE[op.type];
    const container = el['$parent'] as El;
    const boundaries = ((container['flowElements'] ?? []) as El[]).filter((b) => b['attachedToRef'] === el);
    const replacement = this.create(type, { id: el.id });
    if (boundaries.length > 0 && !is(replacement, 'bpmn:Activity')) {
      return this.issue('type', this.C.editBoundaryNeedsActivity(op.id, boundaries.map((b) => b.id).join(', ')));
    }

    // Every property the new type also has is carried over: name, documentation, extension
    // elements, flows, default flow, loop characteristics, data associations…
    // References (`incoming`, `outgoing`, `default`) are not enumerable on a moddle element, so the
    // properties are walked through the type's descriptor, not `Object.keys`.
    const target = (replacement as any).$descriptor as { propertiesByName: Record<string, unknown> };
    const source = (el as any).$descriptor as { properties: { name: string }[] };
    const skip = new Set(['id', 'flowElements', 'artifacts', 'laneSets', 'eventDefinitions', 'triggeredByEvent']);
    for (const { name } of source.properties) {
      const value = el[name];
      if (skip.has(name) || target.propertiesByName[name] === undefined || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      replacement['set'](name, Array.isArray(value) ? [...value] : value);
    }
    Object.assign(replacement['$attrs'] ?? {}, el['$attrs'] ?? {});
    if (op.type === 'timer') {
      replacement['eventDefinitions'] = isTimer(el)
        ? el['eventDefinitions']
        : [this.create('bpmn:TimerEventDefinition', { id: this.uniqueId(`TimerEventDefinition_${el.id}`) })];
    }
    replacement['$parent'] = container;

    // What was inside a sub-process goes with it.
    const also: string[] = [];
    if (is(el, 'bpmn:SubProcess')) {
      const inner = [...everything(el['flowElements'] ?? []), ...everything(el['artifacts'] ?? [])].filter((x) => typeof x.id === 'string');
      for (const x of inner) {
        this.free(x.id);
        this.removed.push(x.id);
        also.push(x.id);
      }
      const diagrams = (this.definitions['diagrams'] ?? []) as El[];
      this.definitions['diagrams'] = diagrams.filter((d) => d['plane']?.['bpmnElement'] !== el);
      this.diagram.index();
      const gone = new Set(inner);
      for (const link of this.links()) if (gone.has(link['sourceRef']) || gone.has(link['targetRef'])) this.deleteLink(link);
    }

    // Swap it in everywhere the old element is referenced.
    const elements = container['flowElements'] as El[];
    elements[elements.indexOf(el)] = replacement;
    for (const flow of this.flows(container)) {
      if (flow['sourceRef'] === el) flow['sourceRef'] = replacement;
      if (flow['targetRef'] === el) flow['targetRef'] = replacement;
    }
    for (const b of boundaries) b['attachedToRef'] = replacement;
    for (const { lane } of lanesOf(this.process)) {
      const refs = (lane['flowNodeRef'] ?? []) as El[];
      const index = refs.indexOf(el);
      if (index !== -1) refs[index] = replacement;
    }
    for (const link of this.links()) {
      if (link['sourceRef'] === el) link['sourceRef'] = replacement;
      if (link['targetRef'] === el) link['targetRef'] = replacement;
    }
    if (is(el, 'bpmn:Gateway') && !is(replacement, 'bpmn:Gateway')) delete replacement['default'];
    const shape = this.diagram.shapes.get(el.id);
    if (shape !== undefined) {
      shape['bpmnElement'] = replacement;
      if (op.type === 'subprocess') shape['isExpanded'] = false;
      else delete shape['isExpanded'];
      this.diagram.resize(replacement);
    }
    if (op.type === 'subprocess') this.fillSubprocess(replacement);
    for (const flow of [...this.incoming(replacement), ...this.outgoing(replacement)]) this.diagram.routeFlow(flow);
    this.diagram.rerouteAround(replacement.id, this.links());
    if (is(replacement, 'bpmn:Gateway')) this.gateways.add(replacement);
    this.touch(replacement);
    this.change(this.C.editRetyped(op.id, from, op.type) + (also.length > 0 ? this.C.editAlsoRemoved(also.join(', ')) : ''));
  }

  moveToLane(op: Extract<Op, { op: 'moveToLane' }>): void {
    const el = this.node(op.id, 'id');
    if (lanesOf(this.process).length === 0) return this.issue('lane', this.C.editLaneUnknown(op.lane, ''));
    const lane = this.lane(op.lane, 'lane');
    if (el === undefined || lane === undefined) return;
    if (el['$parent'] !== this.process) return this.issue('id', this.C.editLaneOutsideProcess(op.id));
    for (const { lane: l } of lanesOf(this.process)) {
      if (Array.isArray(l['flowNodeRef'])) l['flowNodeRef'] = (l['flowNodeRef'] as El[]).filter((n) => n !== el);
    }
    for (const l of this.laneChain(lane)) ((l['flowNodeRef'] ??= []) as El[]).push(el);

    const before = this.incremental ? this.diagram.bounds(el.id) : undefined;
    const from = before === undefined ? undefined : { x: before.x, y: before.y };
    if (this.incremental) this.diagram.moveIntoLane(el, lane, this.participant);
    const after = this.diagram.bounds(el.id);
    const attached = ((this.process['flowElements'] ?? []) as El[]).filter((b) => b['attachedToRef'] === el);
    if (from !== undefined && after !== undefined) {
      for (const b of attached) {
        const box = this.diagram.bounds(b.id);
        if (box !== undefined) this.diagram.setBounds(b.id, { ...box, x: box.x + after.x - from.x, y: box.y + after.y - from.y });
      }
    }
    for (const node of [el, ...attached]) {
      for (const flow of [...this.incoming(node), ...this.outgoing(node)]) this.diagram.routeFlow(flow);
      this.diagram.rerouteAround(node.id, this.links());
    }
    this.touch(el, lane);
    this.change(this.C.editMoved(op.id, (lane['name'] as string | undefined) ?? lane.id));
  }

  addLane(op: Extract<Op, { op: 'addLane' }>, before: number): void {
    if (op.id !== undefined) this.checkNewId(op.id, 'id');
    if (op.after !== undefined && op.before !== undefined) this.issue('before', this.C.editAfterAndBefore());
    const ref = op.after ?? op.before;
    const neighbour = ref === undefined ? undefined : this.lane(ref, op.after !== undefined ? 'after' : 'before');
    if (this.issues.length > before) return;

    const first = lanesOf(this.process).length === 0;
    const lane = this.create('bpmn:Lane', { id: op.id ?? this.uniqueId(`Lane_${lanesOf(this.process).length + 1}`), name: op.name, flowNodeRef: [] });
    if (op.id !== undefined) this.used.add(op.id);
    const pool = this.ensurePool();
    let laneSet: El;
    if (first) {
      laneSet = this.create('bpmn:LaneSet', { id: this.uniqueId('LaneSet_1'), lanes: [] });
      laneSet['$parent'] = this.process;
      this.process['laneSets'] = [laneSet];
      // The first lane holds every step of the process.
      lane['flowNodeRef'] = ((this.process['flowElements'] ?? []) as El[]).filter((el) => is(el, 'bpmn:FlowNode'));
    } else {
      laneSet = (neighbour?.['$parent'] as El | undefined) ?? (this.process['laneSets'] as El[])[0]!;
    }
    lane['$parent'] = laneSet;
    const lanes = (laneSet['lanes'] ??= []) as El[];
    const index = neighbour === undefined ? lanes.length : lanes.indexOf(neighbour) + (op.after !== undefined ? 1 : 0);
    lanes.splice(index, 0, lane);
    this.touch(lane);

    const plane = this.diagram.mainPlane(this.process);
    const poolBox = this.diagram.bounds(pool.id);
    if (this.incremental && plane !== undefined && poolBox !== undefined) {
      const depth = this.laneChain(lane).length;
      const x = poolBox.x + 30 * depth;
      if (first) {
        this.diagram.addShape(lane, plane, { x, y: poolBox.y, width: poolBox.x + poolBox.width - x, height: poolBox.height }, { isHorizontal: true });
      } else {
        const siblings = lanes.filter((l) => l !== lane).map((l) => this.diagram.bounds(l.id)).filter((b) => b !== undefined);
        const at = neighbour === undefined ? undefined : this.diagram.bounds(neighbour.id);
        let y: number;
        if (at !== undefined) y = op.after !== undefined ? at.y + at.height : at.y;
        else if (siblings.length > 0) y = Math.max(...siblings.map((b) => b.y + b.height));
        else y = poolBox.y + poolBox.height;
        const height = 140;
        const pool = this.participant === undefined ? new Set<El>() : this.diagram.growing(neighbour?.['$parent']?.['$parent'], this.participant);
        if (neighbour !== undefined) pool.delete(neighbour);
        this.diagram.shiftDown(plane, y, height, new Set(), pool);
        this.diagram.addShape(lane, plane, { x, y, width: poolBox.x + poolBox.width - x, height }, { isHorizontal: true });
      }
    }
    this.change(this.C.editLaneAdded(op.name, lane.id));
  }
}

/* ------------------------------------------------------------------ *
 * The entry point
 * ------------------------------------------------------------------ */

function fail(C: CliMessages, issues: EditIssue[], wrap: (detail: string) => string = C.editInvalid): never {
  const line = (i: EditIssue): string => `  ${i.op === null ? '' : `operations[${i.op}] `}${i.path}: ${i.message}`;
  throw new EditError(wrap(issues.map(line).join('\n')), issues);
}

/**
 * Applies `operations` to the main process of `xml` (the one the simulator reads), all or none
 * (see the header). Throws `EditError`.
 */
export async function editBpmn(xml: string, operations: unknown, options: EditBpmnOptions = {}): Promise<BpmnEdit> {
  const locale = options.locale ?? 'en';
  const C = messages(locale).cli;
  const parsed = EditOperationsSchema.safeParse(operations);
  if (!parsed.success) {
    fail(
      C,
      parsed.error.issues.map((issue) => {
        const [first, ...rest] = issue.path;
        const op = typeof first === 'number' ? first : null;
        return { op, path: (op === null ? issue.path : rest).join('.') || '(root)', message: issue.message };
      }),
    );
  }

  const moddle = BpmnModdle({ lila });
  const { rootElement, warnings } = await moddle.fromXML(xml);
  if (warnings.length > 0) {
    const detail = warnings.map((w) => w.message).join('; ');
    fail(C, [{ op: null, path: 'bpmn', message: C.editContentLoss(detail) }]);
  }
  const definitions = rootElement as unknown as El;
  const process = mainProcess(definitions);
  if (process === undefined) fail(C, [{ op: null, path: 'bpmn', message: C.outlineNoProcess() }]);

  const editor = new Editor(moddle, definitions, process, C, options.scenario, options.scenarioName ?? 'as-is.scenario.json');
  editor.incremental = options.layout === false;
  for (const [index, op] of parsed.data.entries()) {
    editor.op = index;
    editor.apply(op);
  }
  if (editor.issues.length > 0) fail(C, editor.issues);

  if (options.layout !== false) {
    try {
      await relayout({ definitions, process, participant: editor.participant, pool: editor.pool, diagram: editor.diagram });
    } catch (error) {
      if (!(error instanceof LayoutError)) throw error;
      fail(C, [{ op: null, path: 'layout', message: C.editLayoutFailed(error.message) }]);
    }
  } else {
    // Flows that now run through a new or moved shape go around it; the flows drawn again get
    // their labels on their own segment, as `create_process` does.
    editor.diagram.untangle([...everything(process['flowElements'] ?? [])].filter((el) => el.$type === 'bpmn:SequenceFlow'));
    editor.diagram.label(editor.diagram.rerouted);
    // Pools right of this one make way if it grew wider (pools below already did, row by row).
    const plane = editor.diagram.mainPlane(process);
    const now = editor.participant === undefined ? undefined : editor.diagram.bounds(editor.participant.id);
    if (plane !== undefined && editor.pool !== undefined && now !== undefined) editor.diagram.pushAside(plane, editor.pool, now, false);
    // Message flows and associations whose ends moved are drawn again.
    for (const link of editor.links()) {
      if (editor.diagram.moved.has(link['sourceRef']?.id) || editor.diagram.moved.has(link['targetRef']?.id)) editor.diagram.routeOther(link);
    }
  }
  const { xml: raw } = await moddle.toXML(rootElement, { format: true });
  const out = marcarExportador(raw);

  // Only errors the edit brought in count: a model may already carry some (it is still editable).
  const known = new Set((await validateBpmnXml(xml, { locale })).errors.map((e) => `${e.code}\u0000${e.id}`));
  const report = await validateBpmnXml(out, { locale });
  const fresh = report.errors.filter((e) => !known.has(`${e.code}\u0000${e.id}`));
  if (fresh.length > 0) {
    fail(
      C,
      fresh.map((e) => ({ op: editor.touched.get(e.id) ?? (parsed.data.length === 1 ? 0 : null), path: `bpmn.${e.id}`, message: `${e.code}: ${e.message}` })),
      C.editBpmnInvalid,
    );
  }

  const notes: string[] = [];
  const elements = (editor.scenario?.['elements'] ?? {}) as Record<string, any>;
  for (const gateway of editor.gateways) {
    if (!is(gateway, 'bpmn:ExclusiveGateway') || gateway['$parent'] === undefined) continue;
    const outs = editor.outgoing(gateway);
    const given = outs.map((f) => elements[f.id]?.['probability']).filter((p): p is number => typeof p === 'number');
    if (given.length === 0 || outs.length < 2) continue;
    const sum = Math.round(given.reduce((a, b) => a + b, 0) * 1e9) / 1e9;
    if (sum > 1 + 1e-9 || (given.length === outs.length && sum < 1 - 1e-9)) {
      notes.push(C.editProbabilityNote(gateway.id, options.scenarioName ?? 'as-is.scenario.json', sum));
    }
  }

  return {
    xml: out,
    changes: editor.changes,
    removed: editor.removed,
    scenario: editor.scenarioChanged ? (editor.scenario as ScenarioDocument) : undefined,
    warnings: report.warnings,
    notes,
  };
}
