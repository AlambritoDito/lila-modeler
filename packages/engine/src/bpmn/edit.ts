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
 * `scenario` (as in `create_process`). Scenario entries that no longer apply (of removed elements,
 * and the fields a retyped one cannot take) are left to the caller, which removes and reports them
 * (`project-fs/edit.ts`).
 *
 * Browser-safe, like `outline.ts`.
 */
import { BpmnModdle } from 'bpmn-moddle';
import { z } from 'zod';

import lila from './lila.moddle.json' with { type: 'json' };
import { isNCName, marcarExportador } from './ids.js';
import {
  associationsOf,
  attachData,
  attachNote,
  BPMN_TYPE,
  dataName,
  dataOf,
  notesOf,
  OUTLINE_DATA_DIRECTIONS,
  OUTLINE_STEP_TYPES,
  OutlineBoundarySchema,
  outlineReaders,
  OutlineSchema,
  parseDuration,
  WORK,
  type OutlineStepType,
} from './outline.js';
import type { ParseBpmnOptions } from './parse.js';
import { validateBpmnXml } from './validate-report.js';
import type { ValidationResult } from './validate.js';
import { Diagram, everything, is, placeArtifacts, relayout, enclosedData, seatedData, type Box, type El, type Point } from './edit-layout.js';
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
const EditStepSchema = OutlineSchema.shape.steps.element.omit({
  from: true,
  next: true,
  branches: true,
  end: true,
  boundary: true,
  notes: true,
  data: true,
});

/** What `setType` accepts: the outline's step types, and `end`/`terminate` to retype an end event. */
export const EDIT_TYPES = [...OUTLINE_STEP_TYPES, 'end', 'terminate'] as const;

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
      default: z
        .boolean()
        .optional()
        .describe(
          'Out of an xor/or gateway: true makes the new flow the gateway\'s default flow. Refused when the gateway already has one. ' +
            'To mark an existing flow (or clear the mark), connect the same steps again and remove the old flow: it gets a new id.',
        ),
      id: Id.optional().describe('Id of the new flow. Default Flow_<from>_<to>.'),
    })
    .describe('Adds a sequence flow.'),
  z
    .strictObject({ op: z.literal('remove'), id: Id })
    .describe(
      'Removes a step (its predecessors are reconnected to its successor when that is unambiguous), a sequence flow, a boundary ' +
        'event, or an artifact: text annotation, data object or store, group, association. An end event left with no incoming flow goes too.',
    ),
  z
    .strictObject({ op: z.literal('rename'), id: Id.describe('Id of the element, or the name of a lane.'), name: z.string() })
    .describe('Renames any element: step, flow, lane, pool or process. A lane can be named by its name. "" clears the name.'),
  z
    .strictObject({
      op: z.literal('setType'),
      id: Id.describe(
        'Id of the step. With end/terminate: the id of an end event, or of a step that leads to exactly one end event, whose end is ' +
          'then retyped (not the step); anything else is refused.',
      ),
      type: z.enum(EDIT_TYPES),
    })
    .describe(
      'Changes the type of a step (its id, name, flows and annotations stay), or turns an end event into a terminate end (and back). ' +
        'Turning an xor/or into an and or an eventGateway drops the probabilities of its outgoing flows from the scenarios.',
    ),
  z
    .strictObject({ op: z.literal('moveToLane'), id: Id, lane: Id.describe('Lane name or id.') })
    .describe('Moves a step to another lane, with its boundary events and the ends they lead to.'),
  z
    .strictObject({
      op: z.literal('addLane'),
      name: z.string().min(1),
      id: Id.optional().describe('Id of the new lane. Default Lane_<n>.'),
      after: Id.optional().describe('Lane (name or id) it goes below. Default: the last one.'),
      before: Id.optional().describe('Lane (name or id) it goes above.'),
    })
    .describe('Adds a lane. The first lane of a process without lanes holds all its steps (and the process gets a pool if it had none).'),
  z
    .strictObject({
      op: z.literal('removeLane'),
      lane: Id.describe('Lane name or id.'),
      moveStepsTo: Id.optional().describe(
        'Lane (name or id, another lane with no sub-lanes) that takes its nodes: steps, starts, end events, boundary events. ' +
          'Required when it holds any, except for the only lane of the process.',
      ),
    })
    .describe(
      'Removes a lane without sub-lanes. Removing the only lane removes the lane set: its nodes stay in the pool, without lanes, ' +
        'and moveStepsTo is not needed.',
    ),
  z
    .strictObject({
      op: z.literal('moveLane'),
      lane: Id.describe('Lane name or id.'),
      before: Id.optional().describe('Sibling lane (name or id) it goes above.'),
      after: Id.optional().describe('Sibling lane (name or id) it goes below.'),
    })
    .describe('Reorders a lane among its siblings: exactly one of before and after.'),
  z
    .strictObject({
      op: z.literal('addBoundary'),
      on: Id.describe('Id of the task (any variant) or call activity it is attached to; not a sub-process.'),
      boundary: OutlineBoundarySchema.describe('As in an outline: {id, type: "timer", name?, label?, duration?, interrupting?, to | end}.'),
    })
    .describe('Attaches a boundary timer to a task or call activity. Its duration goes into the base scenario.'),
  z
    .strictObject({ op: z.literal('annotate'), on: Id.describe('Id of the step.'), text: z.string().min(1) })
    .describe(
      'Attaches a BPMN text annotation to a step (read back as its `notes`; not annotate_element); not to a start, end or boundary event. The same text on the same step again changes nothing.',
    ),
  z
    .strictObject({ op: z.literal('removeAnnotation'), on: Id.describe('Id of the step.'), text: z.string().min(1) })
    .describe('Removes the text annotation with that text attached to the step (every one, if a model repeats it), and its association.'),
  z
    .strictObject({
      op: z.literal('addDataObject'),
      name: z.string().min(1).describe('Name of the data object; an existing one with that name is reused.'),
      on: Id.describe('Id of the activity (task, call activity or sub-process) that reads or writes it.'),
      direction: z.enum(OUTLINE_DATA_DIRECTIONS).describe('in: the activity reads it. out: the activity writes it.'),
    })
    .describe('Connects a data object to an activity, creating the object when the process has none with that name.'),
  z
    .strictObject({
      op: z.literal('removeDataObject'),
      name: z.string().min(1).describe('Name of the data object.'),
      on: Id.optional().describe('Only its connection to this activity; without it, every connection.'),
    })
    .describe('Disconnects a data object (from one activity, or from all); the object goes when nothing uses it any more.'),
  z
    .strictObject({
      op: z.literal('setCalledProcess'),
      id: Id.describe('Id of a call activity of the edited process.'),
      process: z
        .string()
        .min(1)
        .nullable()
        .describe('Slug of another process of the .lila, whose BPMN process id becomes the calledElement; null removes it.'),
    })
    .describe('Sets the process a call activity calls (its calledElement), by the slug of another process of the .lila; only in a .lila.'),
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
  /** #546: the process to edit (the one its scenarios target, `parseBpmn`); default, the document-order rule. */
  processId?: string | undefined;
  /** #546: the process's scenarios, so the before/after validation checks the process that runs. */
  scenarios?: ParseBpmnOptions['scenarios'];
  /**
   * #664: the processes of the `.lila` a call activity can call, slug → its BPMN process id and its
   * name (`editLilaProcess` passes every process of the project). Without it, `setCalledProcess`
   * is refused: a bare model has no other process to name.
   */
  callTargets?: ReadonlyMap<string, CallTarget> | undefined;
}

/** A process `setCalledProcess` can name (#664). */
export interface CallTarget {
  /**
   * The BPMN process id the call activity's `calledElement` gets; `undefined` when none of the ids
   * its model declares can be told to be the process (the operation is then refused).
   */
  readonly processId: string | undefined;
  /** The process's name, for messages. */
  readonly name: string;
  /** `true` for the process being edited: a call activity does not call its own process. */
  readonly self?: boolean | undefined;
  /** The other processes of the project whose model declares `processId` too: the call would be ambiguous. */
  readonly sharedWith?: readonly string[] | undefined;
  /** The BPMN process ids its model declares, for messages. */
  readonly declared?: readonly string[] | undefined;
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
  /**
   * Ids of the elements whose type changed, and of the flows out of an xor/or that became something
   * else: their scenario entries may no longer apply.
   */
  readonly retyped: readonly string[];
  /** Element id → index of the last operation that touched it, to attribute later problems. */
  readonly touched: ReadonlyMap<string, number>;
}

/** Short name of a node's type, for messages: the outline's when it has one. */
function typeName(el: El): string {
  if (el.$type === 'bpmn:IntermediateCatchEvent') {
    if (isTimer(el)) return 'timer';
    if (((el['eventDefinitions'] ?? []) as El[]).some((d) => d.$type === 'bpmn:MessageEventDefinition')) return 'message';
    return 'IntermediateCatchEvent';
  }
  const known = (Object.entries(BPMN_TYPE) as [OutlineStepType, string][]).find(([, t]) => t === el.$type);
  return known?.[0] ?? el.$type.replace(/^bpmn:/, '');
}

function isTimer(el: El): boolean {
  return ((el['eventDefinitions'] ?? []) as El[]).some((d) => d.$type === 'bpmn:TimerEventDefinition');
}

/** The process the simulator reads (`parseBpmn`'s rule): executable and non-empty, else non-empty, else first. */
function mainProcess(definitions: El, processId?: string): El | undefined {
  const processes = ((definitions['rootElements'] ?? []) as El[]).filter((el) => el.$type === 'bpmn:Process');
  const chosen = processId === undefined ? undefined : processes.find((el) => el.id === processId);
  if (chosen !== undefined) return chosen;
  const nonEmpty = (el: El): boolean => ((el['flowElements'] ?? []) as El[]).length > 0;
  return processes.find((el) => el['isExecutable'] === true && nonEmpty(el)) ?? processes.find(nonEmpty) ?? processes[0];
}

/* ------------------------------------------------------------------ *
 * The editor
 * ------------------------------------------------------------------ */

class Editor {
  readonly used = new Set<string>();
  readonly removed: string[] = [];
  readonly retyped: string[] = [];
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
  /** What `setCalledProcess` can name (#664); `undefined` outside a `.lila`. */
  callTargets: ReadonlyMap<string, CallTarget> | undefined;
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
    // Its data associations go with it, and so do the data objects nothing else uses (#638).
    const data = dataOf(node);
    const dataIds = this.dropDataAssociations([...new Set(data.map((d) => d.association))]);
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
    // Its notes go too: a text annotation left with no association would hang on nothing (#638).
    const notes = new Set<El>();
    for (const link of this.links()) {
      if (gone.has(link['sourceRef']) || gone.has(link['targetRef'])) {
        this.deleteLink(link);
        also.push(link.id);
        for (const end of [link['sourceRef'], link['targetRef']] as (El | undefined)[]) {
          if (end?.$type === 'bpmn:TextAnnotation' && !gone.has(end)) notes.add(end);
        }
      }
    }
    for (const note of notes) {
      if (this.associations().some((a) => a['sourceRef'] === note || a['targetRef'] === note)) continue;
      also.push(...this.removeArtifact(note));
    }
    this.free(node.id);
    this.removed.push(node.id);
    also.unshift(...dataIds);
    also.push(...this.dropUnusedData(data.map((d) => d.reference)));
    return also;
  }

  /* --- artifacts (#638) --- */

  /** Every association (`bpmn:Association`) of the document. */
  associations(): El[] {
    return this.links().filter((l) => l.$type === 'bpmn:Association');
  }

  /** Every data input or output association in the process (sub-processes included). */
  dataLinks(): El[] {
    return [...everything(this.process['flowElements'] ?? [])].filter(
      (el) => el.$type === 'bpmn:DataInputAssociation' || el.$type === 'bpmn:DataOutputAssociation',
    );
  }

  /** Whether any data association of the document reads or writes `ref`. */
  dataUsed(ref: El): boolean {
    for (const el of everything(this.definitions['rootElements'])) {
      if (el.$type === 'bpmn:DataInputAssociation' && ((el['sourceRef'] ?? []) as El[]).includes(ref)) return true;
      if (el.$type === 'bpmn:DataOutputAssociation' && el['targetRef'] === ref) return true;
    }
    return false;
  }

  /**
   * Removes data associations from their activity, with their edges, and the activity's
   * `__targetRef_placeholder` property when no input association targets it any more. Returns their ids.
   */
  dropDataAssociations(associations: readonly El[]): string[] {
    const gone: string[] = [];
    for (const a of associations) {
      const node = a['$parent'] as El;
      for (const key of ['dataInputAssociations', 'dataOutputAssociations']) {
        if (Array.isArray(node[key])) node[key] = (node[key] as El[]).filter((x) => x !== a);
      }
      this.free(a.id);
      this.removed.push(a.id);
      gone.push(a.id);
      const property = a['targetRef'] as El | undefined;
      if (a.$type === 'bpmn:DataInputAssociation' && property?.$type === 'bpmn:Property' && Array.isArray(node['properties'])) {
        if (!((node['dataInputAssociations'] ?? []) as El[]).some((x) => x['targetRef'] === property)) {
          node['properties'] = (node['properties'] as El[]).filter((x) => x !== property);
          this.free(property.id);
        }
      }
      this.touch(node);
    }
    return gone;
  }

  /** Removes the data object references of `refs` that nothing reads or writes any more, and their data objects. */
  dropUnusedData(refs: readonly El[]): string[] {
    const gone: string[] = [];
    for (const ref of new Set(refs)) {
      if (ref.$type !== 'bpmn:DataObjectReference' || !((ref['$parent']?.['flowElements'] ?? []) as El[]).includes(ref)) continue;
      if (this.dataUsed(ref)) continue;
      gone.push(...this.removeArtifact(ref));
    }
    return gone;
  }

  /**
   * Removes an artifact or a data element, with what hangs on it: the associations of an annotation,
   * group or data reference; the data associations of a data reference; every reference of a data
   * object; a data object nothing refers to any more. Returns every id that went, its own first.
   */
  removeArtifact(el: El): string[] {
    const owner = el['$parent'] as El;
    if (el.$type === 'bpmn:Association') {
      this.deleteLink(el);
      // A text annotation it was the last link of would hang on nothing: it goes too (#645).
      const loose = ([el['sourceRef'], el['targetRef']] as (El | undefined)[]).filter(
        (end) => end?.$type === 'bpmn:TextAnnotation' && !this.associations().some((a) => a['sourceRef'] === end || a['targetRef'] === end),
      ) as El[];
      return [el.id, ...loose.flatMap((note) => this.removeArtifact(note))];
    }
    if (el.$type === 'bpmn:DataInputAssociation' || el.$type === 'bpmn:DataOutputAssociation') {
      const ref = el.$type === 'bpmn:DataInputAssociation' ? ((el['sourceRef'] ?? []) as El[])[0] : (el['targetRef'] as El | undefined);
      const gone = this.dropDataAssociations([el]);
      return [...gone, ...this.dropUnusedData(ref === undefined ? [] : [ref])];
    }
    if (el.$type === 'bpmn:DataObject') {
      const refs = [...everything(this.definitions['rootElements'])].filter((r) => r.$type === 'bpmn:DataObjectReference' && r['dataObjectRef'] === el);
      const gone = refs.flatMap((r) => this.removeArtifact(r));
      if (((owner['flowElements'] ?? []) as El[]).includes(el)) gone.unshift(...this.deleteNode(el), el.id);
      return [el.id, ...gone.filter((id) => id !== el.id)];
    }
    if (el.$type === 'bpmn:DataObjectReference' || el.$type === 'bpmn:DataStoreReference') {
      const links = this.dataLinks().filter((a) =>
        a.$type === 'bpmn:DataInputAssociation' ? ((a['sourceRef'] ?? []) as El[]).includes(el) : a['targetRef'] === el,
      );
      const gone = this.dropDataAssociations(links);
      gone.push(...this.deleteNode(el));
      const object = el['dataObjectRef'] as El | undefined;
      const shared = [...everything(this.definitions['rootElements'])].some((r) => r.$type === 'bpmn:DataObjectReference' && r['dataObjectRef'] === object);
      if (object !== undefined && !shared && ((object['$parent']?.['flowElements'] ?? []) as El[]).includes(object)) {
        gone.push(object.id, ...this.deleteNode(object));
      }
      return [el.id, ...gone];
    }
    // A text annotation or a group: its associations go too.
    const gone: string[] = [el.id];
    for (const link of this.associations()) {
      if (link['sourceRef'] === el || link['targetRef'] === el) {
        this.deleteLink(link);
        gone.push(link.id);
      }
    }
    for (const key of ['artifacts', 'flowElements']) {
      if (Array.isArray(owner[key])) owner[key] = (owner[key] as El[]).filter((x) => x !== el);
    }
    this.free(el.id);
    this.removed.push(el.id);
    return gone;
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
      case 'addBoundary':
        return this.addBoundary(op, before);
      case 'removeLane':
        return this.removeLane(op, before);
      case 'moveLane':
        return this.moveLane(op, before);
      case 'annotate':
        return this.annotate(op);
      case 'removeAnnotation':
        return this.removeAnnotation(op);
      case 'addDataObject':
        return this.addDataObject(op);
      case 'removeDataObject':
        return this.removeDataObject(op, before);
      case 'setCalledProcess':
        return this.setCalledProcess(op);
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
      if (!WORK.has(type) && type !== 'timer' && type !== 'message') this.issue('step.duration', this.C.outlineFieldNotApplicable(step.id, 'duration', type));
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
    if (type === 'timer' || type === 'message') attrs['eventDefinitions'] = [this.eventDefinition(type, step.id)];
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
    if (op.default === true && from !== undefined) {
      if (!is(from, 'bpmn:ExclusiveGateway') && !is(from, 'bpmn:InclusiveGateway')) {
        this.issue('default', this.C.outlineFieldNotApplicable(op.from, 'default', typeName(from)));
      } else if (from['default'] !== undefined) this.issue('default', this.C.outlineManyDefaults(op.from));
    }
    if (this.issues.length > before || from === undefined || to === undefined) return;
    const flow = this.newFlow(from, to, { id: op.id, name: op.label });
    if (op.default === true) from['default'] = flow;
    this.touch(from, to);
    if (op.probability !== undefined) this.scenarioElement(flow.id)!['probability'] = op.probability;
    this.change(this.C.editConnected(op.from, op.to, flow.id));
  }

  remove(op: Extract<Op, { op: 'remove' }>): void {
    const el = this.find(op.id);
    if (el === undefined) return this.issue('id', this.C.editUnknownId(op.id));
    // A text annotation, a group or an association of this pool can be listed in the collaboration.
    const pooled = this.participant !== undefined && el['$parent'] === this.participant['$parent'] && ARTIFACTS.has(el.$type);
    if (!this.inProcess(el) && !pooled) return this.issue('id', this.C.editOtherProcess(op.id, this.process.id));
    if (ARTIFACTS.has(el.$type)) {
      const also = this.removeArtifact(el).filter((id) => id !== el.id);
      return this.change(this.C.editRemovedElement(op.id, el.$type.replace(/^bpmn:/, ''), also.join(', ')));
    }
    if (el.$type === 'bpmn:SequenceFlow') {
      const target = el['targetRef'] as El | undefined;
      this.deleteFlow(el);
      const also = this.dropOrphanEnds([target]);
      return this.change(this.C.editRemovedFlow(op.id) + (also.length > 0 ? this.C.editAlsoRemoved(also.join(', ')) : ''));
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
    // An end event left with no way in goes too (the end of a removed boundary event, of a step
    // that had no incoming flow…).
    also.push(...this.dropOrphanEnds(outs.map((f) => f['targetRef'] as El)));
    this.change(this.C.editRemovedStep(op.id, reconnected.join(', '), also.join(', ')));
  }

  /** Removes the end events of `candidates` that have no incoming flow any more; returns what went. */
  dropOrphanEnds(candidates: (El | undefined)[]): string[] {
    const gone: string[] = [];
    for (const end of new Set(candidates)) {
      if (end === undefined || !is(end, 'bpmn:EndEvent') || !((end['$parent']?.['flowElements'] ?? []) as El[]).includes(end)) continue;
      if (this.incoming(end).length > 0) continue;
      gone.push(end.id, ...this.deleteNode(end));
    }
    return gone;
  }

  /** A new timer or message event definition for the event `owner`. */
  eventDefinition(type: 'timer' | 'message' | 'terminate', owner: string): El {
    const name = { timer: 'TimerEventDefinition', message: 'MessageEventDefinition', terminate: 'TerminateEventDefinition' }[type];
    return this.create(`bpmn:${name}`, { id: this.uniqueId(`${name}_${owner}`) });
  }

  rename(op: Extract<Op, { op: 'rename' }>): void {
    let el = this.find(op.id);
    if (el === undefined) {
      // No element has that id: a lane by its name.
      const named = lanesOf(this.process).filter((l) => l.lane['name'] === op.id);
      if (named.length > 1) return this.issue('id', this.C.editLaneAmbiguous(op.id, named.map((l) => l.lane.id).join(', ')));
      el = named[0]?.lane;
    }
    if (el === undefined) return this.issue('id', this.C.editUnknownId(op.id));
    const before = (el['name'] as string | undefined) ?? '';
    if (op.name === '') delete el['name'];
    else el['name'] = op.name;
    this.touch(el);
    this.change(this.C.editRenamed(el.id, before, op.name));
  }

  setType(op: Extract<Op, { op: 'setType' }>): void {
    if (op.type === 'end' || op.type === 'terminate') return this.setEndType(op.id, op.type);
    const el = this.node(op.id, 'id');
    if (el === undefined) return;
    if (is(el, 'bpmn:BoundaryEvent')) return this.issue('id', this.C.editNotAStep(op.id, el.$type));
    const from = typeName(el);
    if (from === op.type) return this.change(this.C.editRetyped(op.id, from, op.type));
    const type = BPMN_TYPE[op.type as OutlineStepType];
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
    // Data associations the new type cannot hold (a gateway, say) go, with the data objects nothing
    // else uses (#638).
    const dropped: string[] = [];
    const lostData = (['dataInputAssociations', 'dataOutputAssociations'] as const).filter(
      (key) => target.propertiesByName[key] === undefined && ((el[key] ?? []) as El[]).length > 0,
    );
    if (lostData.length > 0) {
      const refs = dataOf(el).map((d) => d.reference);
      dropped.push(...this.dropDataAssociations(lostData.flatMap((key) => el[key] as El[])));
      dropped.push(...this.dropUnusedData(refs));
    }
    for (const { name } of source.properties) {
      const value: unknown = el[name];
      if (skip.has(name) || target.propertiesByName[name] === undefined || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      replacement['set'](name, Array.isArray(value) ? [...value] : value);
      // What it contains (data associations, properties…) now belongs to the replacement.
      for (const child of (Array.isArray(value) ? value : [value]) as unknown[]) {
        if (typeof child === 'object' && child !== null && (child as El)['$parent'] === el) (child as El)['$parent'] = replacement;
      }
    }
    Object.assign(replacement['$attrs'] ?? {}, el['$attrs'] ?? {});
    if (op.type === 'timer') replacement['eventDefinitions'] = isTimer(el) ? el['eventDefinitions'] : [this.eventDefinition('timer', el.id)];
    if (op.type === 'message') replacement['eventDefinitions'] = [this.eventDefinition('message', el.id)];
    replacement['$parent'] = container;

    // What was inside a sub-process goes with it.
    const also: string[] = [...dropped];
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
    if (!this.retyped.includes(replacement.id)) this.retyped.push(replacement.id);
    // Out of anything but an xor or an or, a branch probability no longer applies: the flows are
    // listed with the retyped ids so their probabilities leave the scenarios (scenarioRemovals).
    const choice = (x: El): boolean => is(x, 'bpmn:ExclusiveGateway') || is(x, 'bpmn:InclusiveGateway');
    if (choice(el) && !choice(replacement)) {
      for (const flow of this.outgoing(replacement)) if (!this.retyped.includes(flow.id)) this.retyped.push(flow.id);
    }
    this.change(this.C.editRetyped(op.id, from, op.type) + (also.length > 0 ? this.C.editAlsoRemoved(also.join(', ')) : ''));
  }

  /**
   * `setType` to `end` or `terminate`: `id` is an end event, or a step that leads to exactly one end
   * event (the outline does not show the ids of the ends).
   */
  setEndType(id: string, type: 'end' | 'terminate'): void {
    const el = this.node(id, 'id');
    if (el === undefined) return;
    let end = el;
    if (!is(el, 'bpmn:EndEvent')) {
      const ends = this.outgoing(el).map((f) => f['targetRef'] as El).filter((t) => is(t, 'bpmn:EndEvent'));
      if (ends.length !== 1) return this.issue('id', this.C.editNotOneEnd(id, ends.map((t) => t.id).join(', ')));
      end = ends[0]!;
    }
    const definitions = (end['eventDefinitions'] ?? []) as El[];
    const terminate = definitions.some((d) => d.$type === 'bpmn:TerminateEventDefinition');
    const from = terminate ? 'terminate' : 'end';
    if (from === type && definitions.length === (terminate ? 1 : 0)) return this.change(this.C.editRetyped(end.id, from, type));
    for (const d of definitions) if (typeof d.id === 'string') this.free(d.id);
    if (type === 'terminate') end['eventDefinitions'] = [this.eventDefinition('terminate', end.id)];
    else delete end['eventDefinitions'];
    this.touch(end);
    this.change(this.C.editRetyped(end.id, from, type));
  }

  /** Attaches a boundary timer to a task or call activity (as in an outline). */
  addBoundary(op: Extract<Op, { op: 'addBoundary' }>, before: number): void {
    const b = op.boundary;
    const host = this.node(op.on, 'on');
    if (host !== undefined && (!is(host, 'bpmn:Task') && !is(host, 'bpmn:CallActivity'))) {
      this.issue('on', this.C.outlineFieldNotApplicable(op.on, 'boundary', typeName(host)));
    }
    this.checkNewId(b.id, 'boundary.id');
    let target: El | undefined;
    if (b.to !== undefined) {
      target = this.node(b.to, 'boundary.to');
      if (target !== undefined && (is(target, 'bpmn:StartEvent') || is(target, 'bpmn:BoundaryEvent'))) this.issue('boundary.to', this.C.editToStart(b.to));
      if (target !== undefined && host !== undefined && target['$parent'] !== host['$parent']) this.issue('boundary.to', this.C.editOtherContainer(op.on, b.to));
    }
    let duration: Distribution | undefined;
    if (b.duration !== undefined) {
      duration = parseDuration(b.duration as string | number | Distribution) ?? undefined;
      if (duration === undefined) {
        const text = typeof b.duration === 'string' ? b.duration : JSON.stringify(b.duration);
        this.issue('boundary.duration', this.C.outlineBadDuration(b.id, text));
      }
      if (this.scenario === undefined) this.issue('boundary.duration', this.C.editNeedsScenario('duration', this.scenarioName));
    }
    if (this.issues.length > before || host === undefined) return;

    const container = host['$parent'] as El;
    const attrs: Record<string, unknown> = { id: b.id, attachedToRef: host, eventDefinitions: [this.eventDefinition('timer', b.id)] };
    if (b.name !== undefined && b.name !== '') attrs['name'] = b.name;
    if (b.interrupting === false) attrs['cancelActivity'] = false;
    const boundary = this.create('bpmn:BoundaryEvent', attrs);
    boundary['$parent'] = container;
    this.used.add(b.id);
    const elements = container['flowElements'] as El[];
    elements.splice(elements.indexOf(host) + 1, 0, boundary);
    const lane = container === this.process ? laneOfNode(this.process, host) : undefined;
    const inLane = (el: El): void => {
      if (lane !== undefined) for (const l of this.laneChain(lane)) ((l['flowNodeRef'] ??= []) as El[]).push(el);
    };
    inLane(boundary);
    const plane = this.diagram.hasDi && this.incremental ? this.diagram.planeFor(container, this.process) : undefined;
    const hostBox = this.diagram.bounds(host.id);
    if (plane !== undefined && hostBox !== undefined) {
      // On the host's border, clear of the boundary events already there (wherever they were drawn).
      const others = elements
        .filter((e) => e !== boundary && e['attachedToRef'] === host)
        .map((e) => this.diagram.bounds(e.id))
        .filter((box) => box !== undefined);
      this.diagram.addShape(boundary, plane, this.diagram.boundarySpot(hostBox, others));
    }
    if (target === undefined) {
      const end = this.create('bpmn:EndEvent', { id: this.uniqueId(`EndEvent_${b.id}`) });
      if (b.end === 'terminate') end['eventDefinitions'] = [this.eventDefinition('terminate', end.id)];
      end['$parent'] = container;
      elements.splice(elements.indexOf(boundary) + 1, 0, end);
      inLane(end);
      if (plane !== undefined) this.diagram.place(end, plane, { anchor: boundary, lane, pool: container === this.process ? this.participant : undefined });
      target = end;
    }
    this.newFlow(boundary, target, { name: b.label });
    this.touch(host, boundary, target);
    if (duration !== undefined) this.scenarioElement(b.id)!['processingTime'] = duration;
    this.change(this.C.editBoundaryAdded(b.id, op.on, b.interrupting !== false, target.id));
  }

  moveToLane(op: Extract<Op, { op: 'moveToLane' }>): void {
    const el = this.node(op.id, 'id');
    if (lanesOf(this.process).length === 0) return this.issue('lane', this.C.editLaneUnknown(op.lane, ''));
    const lane = this.lane(op.lane, 'lane');
    if (el === undefined || lane === undefined) return;
    if (el['$parent'] !== this.process) return this.issue('id', this.C.editLaneOutsideProcess(op.id));
    // The end events the outline made for this step (`EndEvent_<id>`, `EndEvent_<id>_2`, …) go with it
    // while nothing else leads to them and they still sit in its lane (one moved by hand stays).
    const attached = ((this.process['flowElements'] ?? []) as El[]).filter((b) => b['attachedToRef'] === el);
    const from = laneOfNode(this.process, el);
    const ownEnd = (source: El) => (t: El): boolean => {
      const base = `EndEvent_${source.id}`;
      return (
        is(t, 'bpmn:EndEvent') &&
        t.id.startsWith(base) &&
        /^(_\d+)?$/.test(t.id.slice(base.length)) &&
        this.incoming(t).every((f) => f['sourceRef'] === source) &&
        laneOfNode(this.process, t) === from
      );
    };
    // The boundary events go with their host, and so do the ends they lead to (`EndEvent_<boundary>`).
    const ends = [el, ...attached].flatMap((source) => this.outgoing(source).map((f) => f['targetRef'] as El).filter(ownEnd(source)));
    const moving = [el, ...attached, ...ends];
    for (const { lane: l } of lanesOf(this.process)) {
      if (Array.isArray(l['flowNodeRef'])) l['flowNodeRef'] = (l['flowNodeRef'] as El[]).filter((n) => !moving.includes(n));
    }
    for (const l of this.laneChain(lane)) ((l['flowNodeRef'] ??= []) as El[]).push(...moving);

    if (this.incremental) this.moveShapesIntoLane([el, ...ends], lane);
    else for (const node of moving) for (const flow of [...this.incoming(node), ...this.outgoing(node)]) this.diagram.routeFlow(flow);
    this.touch(el, lane, ...ends);
    this.change(this.C.editMoved(op.id, (lane['name'] as string | undefined) ?? lane.id));
  }

  /* --- lanes and artifacts on the diagram (#638) --- */

  /**
   * Incremental layout: moves the shapes of `nodes` into the band of `lane`, each keeping its x;
   * their boundary events ride along, and the annotations and data objects hung on them follow.
   * Their flows and links are drawn again.
   */
  moveShapesIntoLane(nodes: readonly El[], lane: El): void {
    const deltas = new Map<El, Point>();
    for (const node of nodes) {
      if (node['attachedToRef'] !== undefined) continue;
      const from = this.diagram.bounds(node.id);
      if (from === undefined) continue;
      const before = { x: from.x, y: from.y };
      this.diagram.moveIntoLane(node, lane, this.participant);
      const after = this.diagram.bounds(node.id)!;
      deltas.set(node, { x: after.x - before.x, y: after.y - before.y });
    }
    const riders = ((this.process['flowElements'] ?? []) as El[]).filter((b) => deltas.has(b['attachedToRef']));
    for (const b of riders) this.shiftShape(b, deltas.get(b['attachedToRef'])!);
    this.followAnchors(deltas);
    for (const node of [...nodes, ...riders]) {
      for (const flow of [...this.incoming(node), ...this.outgoing(node)]) this.diagram.routeFlow(flow);
      this.diagram.rerouteAround(node.id, this.links());
    }
  }

  shiftShape(el: El, by: Point): void {
    const box = this.diagram.bounds(el.id);
    if (box !== undefined && (by.x !== 0 || by.y !== 0)) this.diagram.setBounds(el.id, { ...box, x: box.x + by.x, y: box.y + by.y });
  }

  /** The text annotations and data objects hung on a node of `deltas` move with it (once, with the first). */
  followAnchors(deltas: ReadonlyMap<El, Point>): void {
    const done = new Set<El>(deltas.keys());
    const follow = (artifact: El | undefined, node: El): void => {
      if (artifact === undefined || done.has(artifact) || !deltas.has(node)) return;
      done.add(artifact);
      this.shiftShape(artifact, deltas.get(node)!);
    };
    for (const a of this.associations()) {
      if (deltas.has(a['sourceRef'])) follow(a['targetRef'], a['sourceRef']);
      else if (deltas.has(a['targetRef'])) follow(a['sourceRef'], a['targetRef']);
    }
    for (const node of deltas.keys()) for (const { reference } of dataOf(node)) follow(reference, node);
  }

  laneName(lane: El): string {
    return (lane['name'] as string | undefined) || lane.id;
  }

  removeLane(op: Extract<Op, { op: 'removeLane' }>, before: number): void {
    if (lanesOf(this.process).length === 0) return this.issue('lane', this.C.editLaneUnknown(op.lane, ''));
    const lane = this.lane(op.lane, 'lane');
    if (lane === undefined) return;
    const children = (lane['childLaneSet']?.['lanes'] ?? []) as El[];
    if (children.length > 0) return this.issue('lane', this.C.editLaneHasSubLanes(this.laneName(lane), children.map((l) => this.laneName(l)).join(', ')));
    const only = lanesOf(this.process).length === 1;
    const nodes = ((lane['flowNodeRef'] ?? []) as El[]).filter((n) => n['$parent'] === this.process);
    let target: El | undefined;
    if (op.moveStepsTo !== undefined) {
      target = this.lane(op.moveStepsTo, 'moveStepsTo');
      const grandchildren = (target?.['childLaneSet']?.['lanes'] ?? []) as El[];
      if (target === lane) this.issue('moveStepsTo', this.C.editLaneSameTarget(this.laneName(lane)));
      else if (target !== undefined && grandchildren.length > 0) {
        this.issue('moveStepsTo', this.C.editLaneTargetNotLeaf(this.laneName(target), grandchildren.map((l) => this.laneName(l)).join(', ')));
      }
    } else if (!only && nodes.length > 0) {
      this.issue('moveStepsTo', this.C.editLaneNotEmpty(this.laneName(lane), nodes.map((n) => n.id).join(', ')));
    }
    if (this.issues.length > before) return;

    const plane = this.incremental && this.diagram.hasDi ? this.diagram.mainPlane(this.process) : undefined;
    const old = this.diagram.bounds(lane.id);
    const band = old === undefined ? undefined : { x: old.x, y: old.y, width: old.width, height: old.height };
    // Its nodes go to the target lane (and the lanes above it).
    if (target !== undefined && nodes.length > 0) {
      for (const { lane: l } of lanesOf(this.process)) {
        if (Array.isArray(l['flowNodeRef'])) l['flowNodeRef'] = (l['flowNodeRef'] as El[]).filter((n) => !nodes.includes(n));
      }
      for (const l of this.laneChain(target)) ((l['flowNodeRef'] ??= []) as El[]).push(...nodes);
      if (plane !== undefined) this.moveShapesIntoLane(nodes, target);
    }
    // The lane leaves its lane set; an emptied lane set leaves its owner (the process, or a parent lane).
    const laneSet = lane['$parent'] as El;
    laneSet['lanes'] = ((laneSet['lanes'] ?? []) as El[]).filter((l) => l !== lane);
    const owner = laneSet['$parent'] as El;
    const emptied = (laneSet['lanes'] as El[]).length === 0;
    if (emptied) {
      if (owner.$type === 'bpmn:Lane') delete owner['childLaneSet'];
      else {
        owner['laneSets'] = ((owner['laneSets'] ?? []) as El[]).filter((ls) => ls !== laneSet);
        if ((owner['laneSets'] as El[]).length === 0) delete owner['laneSets'];
      }
      this.free(laneSet.id);
      this.removed.push(laneSet.id);
    }
    // Its sequence flows that cross the band are drawn again once the band is gone.
    const crossing =
      plane === undefined || band === undefined
        ? []
        : this.flows(this.process).filter((f) =>
            ((this.diagram.edges.get(f.id)?.['waypoint'] ?? []) as Point[]).some((p) => p.y > band.y && p.y < band.y + band.height),
          );
    this.free(lane.id);
    this.removed.push(lane.id);
    // The lanes below move up into its band, unless it was the last lane of its set (the parent lane,
    // or the pool, keeps the room).
    if (plane !== undefined && band !== undefined && !emptied) {
      const parent = owner.$type === 'bpmn:Lane' ? owner : undefined;
      this.diagram.shiftDown(plane, band.y + band.height, -band.height, new Set(), this.diagram.growing(parent, this.participant));
      for (const flow of [...crossing, ...nodes.flatMap((n) => [...this.incoming(n), ...this.outgoing(n)])]) this.diagram.routeFlow(flow);
    }
    this.touch(target, ...nodes);
    if (only) this.change(this.C.editLastLaneRemoved(this.laneName(lane), lane.id));
    else this.change(this.C.editLaneRemoved(this.laneName(lane), lane.id, target === undefined ? '' : this.laneName(target), nodes.map((n) => n.id).join(', ')));
  }

  moveLane(op: Extract<Op, { op: 'moveLane' }>, before: number): void {
    if (lanesOf(this.process).length === 0) return this.issue('lane', this.C.editLaneUnknown(op.lane, ''));
    const where = op.before !== undefined ? 'before' : 'after';
    const lane = this.lane(op.lane, 'lane');
    const other = this.lane((op.before ?? op.after)!, where);
    if (lane !== undefined && other !== undefined) {
      if (lane === other) this.issue(where, this.C.editLaneSelf(this.laneName(lane)));
      else if (lane['$parent'] !== other['$parent']) this.issue(where, this.C.editLaneNotSibling(this.laneName(lane), this.laneName(other)));
    }
    if (this.issues.length > before || lane === undefined || other === undefined) return;
    const lanes = lane['$parent']['lanes'] as El[];
    const order = [...lanes];
    lanes.splice(lanes.indexOf(lane), 1);
    lanes.splice(lanes.indexOf(other) + (where === 'after' ? 1 : 0), 0, lane);
    this.touch(lane, other);
    const plane = this.incremental && this.diagram.hasDi ? this.diagram.mainPlane(this.process) : undefined;
    if (plane !== undefined) this.restack(plane, order, lanes);
    this.change(this.C.editLaneMoved(this.laneName(lane), where, this.laneName(other)));
  }

  /**
   * Incremental layout of a lane reorder: each sibling's band moves whole to its new place, with
   * every shape whose centre lies in it (steps keep their x); edges inside one band move with it, and
   * the sequence flows that cross bands are routed again.
   */
  restack(plane: El, order: readonly El[], lanes: readonly El[]): void {
    const boxes = order.map((l) => this.diagram.bounds(l.id));
    if (boxes.some((b) => b === undefined)) return;
    const bands = new Map<El, Box>(order.map((l, i) => [l, { ...boxes[i]! }]));
    let y = Math.min(...boxes.map((b) => b!.y));
    const dy = new Map<El, number>();
    for (const l of lanes) {
      dy.set(l, y - bands.get(l)!.y);
      y += bands.get(l)!.height;
    }
    const left = Math.min(...boxes.map((b) => b!.x)) - 30;
    const right = Math.max(...boxes.map((b) => b!.x + b!.width));
    const bandOf = (p: Point): El | undefined =>
      p.x < left || p.x > right ? undefined : order.find((l) => p.y >= bands.get(l)!.y && p.y < bands.get(l)!.y + bands.get(l)!.height);
    // The lanes above the siblings stay: their centre lies in one of the siblings' bands.
    const ancestors = new Set<El>();
    for (let l = order[0]?.['$parent']?.['$parent'] as El | undefined; l?.$type === 'bpmn:Lane'; l = l['$parent']?.['$parent']) ancestors.add(l);
    const cross: El[] = [];
    for (const di of (plane['planeElement'] ?? []) as El[]) {
      const el = di['bpmnElement'] as El | undefined;
      if (el === undefined || is(el, 'bpmn:Participant') || ancestors.has(el)) continue;
      if (di.$type === 'bpmndi:BPMNShape') {
        const b = di['bounds'] as Box;
        const lane = bandOf({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
        const by = lane === undefined ? 0 : dy.get(lane)!;
        if (by === 0) continue;
        b.y += by;
        if (di['label']?.['bounds'] !== undefined) di['label']['bounds'].y += by;
        this.diagram.moved.add(el.id);
      } else if (di.$type === 'bpmndi:BPMNEdge') {
        const points = (di['waypoint'] ?? []) as Point[];
        const owners = new Set(points.map(bandOf));
        const only = owners.size === 1 ? [...owners][0] : undefined;
        if (only !== undefined) {
          const by = dy.get(only)!;
          for (const p of points) p.y += by;
          if (di['label']?.['bounds'] !== undefined) di['label']['bounds'].y += by;
        } else if (el.$type === 'bpmn:SequenceFlow' && points.some((p) => bandOf(p) !== undefined)) cross.push(el);
      }
    }
    for (const flow of cross) this.diagram.routeFlow(flow);
  }

  annotate(op: Extract<Op, { op: 'annotate' }>): void {
    const node = this.node(op.on, 'on');
    if (node === undefined) return;
    // The outline reads notes back only from steps: a note on a start, end or boundary event (or on
    // anything else the outline has no step type for) would come back as a loss warning (#645).
    if (!Object.hasOwn(BPMN_TYPE, typeName(node))) {
      return this.issue('on', this.C.editNoteNotStep(op.on, typeName(node)));
    }
    if (notesOf(node, this.associations()).some((n) => n.annotation['text'] === op.text)) return this.change(this.C.editNoteExists(op.on, op.text));
    const { annotation, association } = attachNote(node, op.text, (type, attrs) => this.create(type, attrs), (base) => this.uniqueId(base));
    this.touch(node, annotation, association);
    this.change(this.C.editNoteAdded(op.on, op.text, annotation.id));
  }

  removeAnnotation(op: Extract<Op, { op: 'removeAnnotation' }>): void {
    const node = this.node(op.on, 'on');
    if (node === undefined) return;
    const notes = notesOf(node, this.associations());
    const matches = notes.filter((n) => n.annotation['text'] === op.text);
    if (matches.length === 0) {
      const texts = [...new Set(notes.map((n) => `"${(n.annotation['text'] as string | undefined) ?? ''}"`))].join(', ');
      return this.issue('text', this.C.editNoNote(op.on, op.text, texts));
    }
    const gone: string[] = [];
    for (const { annotation, association } of matches) {
      this.deleteLink(association);
      gone.push(association.id);
      // An annotation another element still points at stays.
      if (!this.associations().some((a) => a['sourceRef'] === annotation || a['targetRef'] === annotation)) gone.push(...this.removeArtifact(annotation));
    }
    this.touch(node);
    this.change(this.C.editNoteRemoved(op.on, op.text, gone.join(', ')));
  }

  addDataObject(op: Extract<Op, { op: 'addDataObject' }>): void {
    const node = this.node(op.on, 'on');
    if (node === undefined) return;
    if (!is(node, 'bpmn:Activity')) return this.issue('on', this.C.outlineFieldNotApplicable(op.on, 'data', typeName(node)));
    if (dataOf(node).some((d) => d.direction === op.direction && dataName(d.reference) === op.name)) {
      return this.change(this.C.editDataExists(op.name, op.on, op.direction));
    }
    const { reference, created, association } = attachData(node, op.name, op.direction, (type, attrs) => this.create(type, attrs), (base) => this.uniqueId(base));
    this.touch(node, reference, association);
    this.change(this.C.editDataAdded(op.name, op.on, op.direction, reference.id, created.length > 0));
  }

  removeDataObject(op: Extract<Op, { op: 'removeDataObject' }>, before: number): void {
    const all = [...everything(this.process['flowElements'] ?? [])].filter((el) => el.$type === 'bpmn:DataObjectReference');
    const refs = all.filter((el) => dataName(el) === op.name);
    if (refs.length === 0) {
      const names = [...new Set(all.map(dataName).filter((n) => n !== undefined))].map((n) => `"${n}"`).join(', ');
      this.issue('name', this.C.editNoDataObject(op.name, names));
    }
    const node = op.on === undefined ? undefined : this.node(op.on, 'on');
    if (this.issues.length > before) return;
    const links = this.dataLinks().filter(
      (a) =>
        (node === undefined || a['$parent'] === node) &&
        refs.some((r) => (a.$type === 'bpmn:DataInputAssociation' ? ((a['sourceRef'] ?? []) as El[]).includes(r) : a['targetRef'] === r)),
    );
    if (node !== undefined && links.length === 0) return this.issue('on', this.C.editDataNotConnected(op.name, op.on!));
    const gone = this.dropDataAssociations(links);
    gone.push(...this.dropUnusedData(refs));
    this.touch(node);
    this.change(this.C.editDataRemoved(op.name, op.on, gone.join(', ')));
  }

  /** #664: writes (or, with `process: null`, removes) the `calledElement` of a call activity. */
  setCalledProcess(op: Extract<Op, { op: 'setCalledProcess' }>): void {
    const node = this.node(op.id, 'id');
    if (node === undefined) return;
    if (node.$type !== 'bpmn:CallActivity') return this.issue('id', this.C.editNotACallActivity(op.id, typeName(node)));
    const targets = this.callTargets;
    if (targets === undefined) return this.issue('process', this.C.editCallNeedsLila());
    if (op.process === null) {
      delete node['calledElement'];
      this.touch(node);
      return this.change(this.C.editCallCleared(op.id));
    }
    const target = targets.get(op.process);
    if (target === undefined) {
      const others = [...targets].filter(([, t]) => t.self !== true).map(([slug]) => slug);
      return this.issue('process', this.C.editCallUnknownProcess(op.process, others.join(', ')));
    }
    if (target.self === true) return this.issue('process', this.C.editCallSelf(op.process, this.process.id));
    if (target.processId === undefined) return this.issue('process', this.C.editCallUnresolved(op.process, (target.declared ?? []).join(', ')));
    // Another process declaring the same id: the app would open the first one, and delete_process guard both.
    const shared = target.sharedWith ?? [];
    if (shared.length > 0) return this.issue('process', this.C.editCallShared(op.process, target.processId, shared.map((s) => `"${s}"`).join(', '), shared.length));
    if (target.processId === this.process.id) return this.issue('process', this.C.editCallSelf(op.process, target.processId));
    node['calledElement'] = target.processId;
    this.touch(node);
    this.change(this.C.editCalled(op.id, target.name, op.process));
  }

  /**
   * The annotations and data objects without a shape (new ones, #638) get one beside their node,
   * and associations without an edge get one, on the plane of each container.
   */
  placeArtifacts(): void {
    for (const { plane, container, nodes, own, data } of this.artifactPlanes()) {
      placeArtifacts(this.diagram, plane, container, nodes, own, data, this.seated, this.enclosed);
    }
  }

  /**
   * The data objects and stores drawn in the band of a step that uses them before any operation runs
   * (QA of #661, round 4): only those go back into a band when an edit takes them out of it.
   */
  readonly seated = new Set<El>();
  /** Those drawn inside some pool or lane before any operation runs (round 5): they stay inside one. */
  readonly enclosed = new Set<El>();

  noteSeated(): void {
    for (const { plane, data } of this.artifactPlanes()) {
      for (const el of seatedData(this.diagram, plane, data)) this.seated.add(el);
      for (const el of enclosedData(this.diagram, plane, data)) this.enclosed.add(el);
    }
  }

  /** Each container (the process, its sub-processes) drawn on a plane, with its nodes, associations and data associations. */
  artifactPlanes(): { plane: El; container: El; nodes: El[]; own: El[]; data: El[] }[] {
    if (!this.diagram.hasDi) return [];
    const containers = [this.process, ...[...everything(this.process['flowElements'] ?? [])].filter((el) => el.$type === 'bpmn:SubProcess')];
    const associations = associationsOf(this.definitions, this.process);
    return containers.flatMap((container) => {
      const plane = this.diagram.planeFor(container, this.process);
      if (plane === undefined) return [];
      const nodes = ((container['flowElements'] ?? []) as El[]).filter((el) => is(el, 'bpmn:FlowNode'));
      const own = container === this.process ? associations : ((container['artifacts'] ?? []) as El[]).filter((a) => a.$type === 'bpmn:Association');
      return [{ plane, container, nodes, own, data: nodes.flatMap((n) => dataOf(n).map((d) => d.association)) }];
    });
  }

  addLane(op: Extract<Op, { op: 'addLane' }>, before: number): void {
    if (op.id !== undefined) this.checkNewId(op.id, 'id');
    if (op.after !== undefined && op.before !== undefined) this.issue('before', this.C.editAfterAndBefore());
    if (lanesOf(this.process).some((l) => l.lane['name'] === op.name)) this.issue('name', this.C.editDuplicateLane(op.name));
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
        // The lane's title band must not run under the steps (or their labels): what is too far
        // left moves right, and the pool widens.
        const left = Math.min(
          ...this.diagram
            .nodeShapes(plane)
            .filter((di) => this.inProcess(di['bpmnElement']))
            .flatMap((di) => [di['bounds'].x as number, ...(di['label']?.['bounds'] ? [di['label']['bounds'].x as number] : [])]),
        );
        const room = x + 30 + 20 - left;
        if (Number.isFinite(room) && room > 0) this.diagram.makeRoom(plane, poolBox.x + 1, room, { top: poolBox.y, bottom: poolBox.y + poolBox.height });
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

/* ------------------------------------------------------------------ *
 * Reading the operations: one pass, every problem, catalog messages
 * ------------------------------------------------------------------ */

/** What `remove` takes besides steps, flows and boundary events (#638). */
const ARTIFACTS: ReadonlySet<string> = new Set([
  'bpmn:TextAnnotation',
  'bpmn:Group',
  'bpmn:Association',
  'bpmn:DataObject',
  'bpmn:DataObjectReference',
  'bpmn:DataStoreReference',
  'bpmn:DataInputAssociation',
  'bpmn:DataOutputAssociation',
]);

const OP_KEYS: Readonly<Record<Op['op'], readonly string[]>> = {
  add: ['op', 'step', 'after', 'between'],
  connect: ['op', 'from', 'to', 'label', 'probability', 'default', 'id'],
  remove: ['op', 'id'],
  rename: ['op', 'id', 'name'],
  setType: ['op', 'id', 'type'],
  moveToLane: ['op', 'id', 'lane'],
  addLane: ['op', 'name', 'id', 'after', 'before'],
  removeLane: ['op', 'lane', 'moveStepsTo'],
  moveLane: ['op', 'lane', 'before', 'after'],
  addBoundary: ['op', 'on', 'boundary'],
  annotate: ['op', 'on', 'text'],
  removeAnnotation: ['op', 'on', 'text'],
  addDataObject: ['op', 'name', 'on', 'direction'],
  removeDataObject: ['op', 'name', 'on'],
  setCalledProcess: ['op', 'id', 'process'],
};
const STEP_KEYS = new Set(['id', 'name', 'lane', 'type', 'duration', 'resources', 'selection']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/**
 * Reads `input` in one pass (the same rule as `outline.ts`): every malformed field is an issue with
 * its operation's index, its path and a catalog message, and only that operation is dropped, so the
 * semantic checks still run on every well-formed one and all the problems come back at once.
 */
function readOperations(input: unknown, C: CliMessages, issues: EditIssue[]): (Op | undefined)[] {
  if (!Array.isArray(input) || input.length === 0) {
    issues.push({ op: null, path: 'operations', message: C.editNotList() });
    return [];
  }
  return input.map((value, index): Op | undefined => {
    const before = issues.length;
    const bad = (path: string, message: string): undefined => {
      issues.push({ op: index, path, message });
      return undefined;
    };
    if (!isObject(value)) return bad('(operation)', C.outlineNotObject());
    const kind = value['op'];
    if (typeof kind !== 'string' || !Object.hasOwn(OP_KEYS, kind)) {
      return bad('op', C.editUnknownOp(String(kind), Object.keys(OP_KEYS).join(', ')));
    }
    const keys = OP_KEYS[kind as Op['op']];
    for (const key of Object.keys(value)) if (!keys.includes(key)) bad(key, C.outlineUnknownKey(key));
    const text = (key: string, required: boolean): string | undefined => {
      const v = value[key];
      if (v === undefined) return required ? bad(key, C.outlineNotText()) : undefined;
      return isText(v) ? v : bad(key, C.outlineNotText());
    };
    const string = (key: string, required: boolean): string | undefined => {
      const v = value[key];
      if (v === undefined) return required ? bad(key, C.outlineNotText()) : undefined;
      return typeof v === 'string' ? v : bad(key, C.outlineNotText());
    };
    const readers = outlineReaders(C, bad);
    const type = (v: unknown, path: string): OutlineStepType | undefined =>
      (OUTLINE_STEP_TYPES as readonly unknown[]).includes(v) ? (v as OutlineStepType) : bad(path, C.outlineBadType(String(v), OUTLINE_STEP_TYPES.join(', ')));

    let op: Record<string, unknown> = { op: kind };
    switch (kind) {
      case 'add': {
        const step = value['step'];
        let read: Record<string, unknown> | undefined;
        if (!isObject(step)) bad('step', C.outlineNotObject());
        else {
          for (const key of Object.keys(step)) if (!STEP_KEYS.has(key)) bad(`step.${key}`, C.outlineUnknownKey(key));
          read = { id: isText(step['id']) ? step['id'] : bad('step.id', C.outlineNotText()) };
          if (step['name'] !== undefined) read['name'] = typeof step['name'] === 'string' ? step['name'] : bad('step.name', C.outlineNotText());
          if (step['lane'] !== undefined) read['lane'] = isText(step['lane']) ? step['lane'] : bad('step.lane', C.outlineNotText());
          if (step['type'] !== undefined) read['type'] = type(step['type'], 'step.type');
          if (step['duration'] !== undefined) read['duration'] = step['duration'];
          if (step['resources'] !== undefined) {
            const list = step['resources'];
            if (!Array.isArray(list) || list.length === 0) bad('step.resources', C.outlineBadResource());
            else {
              read['resources'] = list.map((r, k) => {
                const at = `step.resources[${k}]`;
                if (isText(r)) return r;
                if (!isObject(r) || !isText(r['name'])) return bad(at, C.outlineBadResource());
                for (const key of Object.keys(r)) if (key !== 'name' && key !== 'quantity') bad(`${at}.${key}`, C.outlineUnknownKey(key));
                const quantity = r['quantity'] ?? 1;
                if (!Number.isInteger(quantity) || (quantity as number) < 1) return bad(`${at}.quantity`, C.outlineNotQuantity());
                return { name: r['name'], quantity };
              });
            }
          }
          if (step['selection'] !== undefined) {
            read['selection'] = step['selection'] === 'and' || step['selection'] === 'or' ? step['selection'] : bad('step.selection', C.outlineBadSelection());
          }
        }
        op = { ...op, step: read, after: text('after', false) };
        const between = value['between'];
        if (between !== undefined) {
          if (Array.isArray(between) && between.length === 2 && between.every(isText)) op['between'] = between;
          else bad('between', C.editBadBetween());
        }
        break;
      }
      case 'connect': {
        op = { ...op, from: text('from', true), to: text('to', true), label: string('label', false), id: text('id', false) };
        const p = value['probability'];
        if (p !== undefined) op['probability'] = typeof p === 'number' && p >= 0 && p <= 1 ? p : bad('probability', C.outlineNotProbability());
        op['default'] = readers.boolean(value['default'], 'default');
        break;
      }
      case 'remove':
        op = { ...op, id: text('id', true) };
        break;
      case 'rename':
        op = { ...op, id: text('id', true), name: string('name', true) };
        break;
      case 'setType': {
        const t = value['type'];
        op = {
          ...op,
          id: text('id', true),
          type: (EDIT_TYPES as readonly unknown[]).includes(t) ? t : bad('type', C.outlineBadType(String(t), EDIT_TYPES.join(', '))),
        };
        break;
      }
      case 'moveToLane':
        op = { ...op, id: text('id', true), lane: text('lane', true) };
        break;
      case 'addLane':
        op = { ...op, name: text('name', true), id: text('id', false), after: text('after', false), before: text('before', false) };
        break;
      case 'removeLane':
        op = { ...op, lane: text('lane', true), moveStepsTo: text('moveStepsTo', false) };
        break;
      case 'moveLane':
        op = { ...op, lane: text('lane', true), before: text('before', false), after: text('after', false) };
        if (value['before'] !== undefined && value['after'] !== undefined) bad('before', C.editAfterAndBefore());
        else if (value['before'] === undefined && value['after'] === undefined) bad('before', C.editBeforeOrAfter());
        break;
      case 'addBoundary':
        op = {
          ...op,
          on: text('on', true),
          boundary: value['boundary'] === undefined ? bad('boundary', C.outlineNotObject()) : readers.boundary(value['boundary'], 'boundary'),
        };
        break;
      case 'annotate':
      case 'removeAnnotation':
        op = { ...op, on: text('on', true), text: text('text', true) };
        break;
      case 'addDataObject':
        op = {
          ...op,
          name: text('name', true),
          on: text('on', true),
          direction: readers.choice(value['direction'], OUTLINE_DATA_DIRECTIONS, 'direction'),
        };
        break;
      case 'removeDataObject':
        op = { ...op, name: text('name', true), on: text('on', false) };
        break;
      case 'setCalledProcess': {
        const target = value['process'];
        op = { ...op, id: text('id', true), process: target === null || isText(target) ? target : bad('process', C.editBadCalledProcess()) };
        break;
      }
    }
    if (issues.length > before) return undefined;
    for (const key of Object.keys(op)) if (op[key] === undefined) delete op[key];
    return op as Op;
  });
}

function fail(C: CliMessages, issues: EditIssue[], wrap: (detail: string) => string = C.editInvalid): never {
  const line = (i: EditIssue): string => `  ${i.op === null ? '' : `operations[${i.op}].`}${i.path}: ${i.message}`;
  throw new EditError(wrap(issues.map(line).join('\n')), issues);
}

/**
 * Why `drawMissingDiagram` left the simulated process without a full drawing (#645):
 * `unreadable`, bpmn-moddle cannot read the model whole (`detail`, its warnings), so writing it
 * back would lose content; `partial`, only some of its nodes have a shape (`missing`, the others),
 * and the drawing there is kept rather than redrawn.
 */
export type DiagramGap =
  | { readonly kind: 'unreadable'; readonly detail: string }
  | { readonly kind: 'partial'; readonly missing: readonly string[] };

/**
 * #630: a model whose main process (`processId`, else the document-order rule) has no diagram
 * gets one, drawn by the same layout as `editBpmn` with `layout: true`. "No diagram" is about that
 * process (#645): a model whose only DI draws another pool is laid out too. Returns the drawn XML
 * in `xml`; nothing when the process is drawn already or has no node; `gap` when it is not drawn
 * (or only partly) and was left as it is. Throws `LayoutError` when the layouter cannot place it.
 */
export async function drawMissingDiagram(
  xml: string,
  options: { processId?: string | undefined; locale?: Locale | undefined } = {},
): Promise<{ readonly xml?: string; readonly gap?: DiagramGap }> {
  const moddle = BpmnModdle({ lila });
  const { rootElement, warnings } = await moddle.fromXML(xml);
  const definitions = rootElement as unknown as El;
  const process = mainProcess(definitions, options.processId);
  if (process === undefined) return {};
  const nodes = ((process['flowElements'] ?? []) as El[]).filter((el) => is(el, 'bpmn:FlowNode'));
  if (nodes.length === 0) return {};
  const drawn = new Diagram(definitions, (type, attrs) => moddle.create(type, attrs) as unknown as El, (base) => base);
  const missing = nodes.filter((node) => !drawn.shapes.has(node.id)).map((node) => node.id);
  if (missing.length === 0) return {};
  // Writing back what the reader could not take whole would lose it: such a model stays as it is.
  if (warnings.length > 0) return { gap: { kind: 'unreadable', detail: warnings.map((w) => w.message).join('; ') } };
  if (missing.length < nodes.length) return { gap: { kind: 'partial', missing } };
  const editor = new Editor(moddle, definitions, process, messages(options.locale ?? 'en').cli, undefined, 'as-is.scenario.json');
  await relayout({ definitions, process, participant: editor.participant, pool: editor.pool, diagram: editor.diagram });
  const { xml: out } = await moddle.toXML(rootElement, { format: true });
  return { xml: marcarExportador(out) };
}

/** `drawMissingDiagram`'s XML alone: `undefined` when it drew nothing. Throws `LayoutError`. */
export async function layoutMissingDiagram(xml: string, options: { processId?: string | undefined; locale?: Locale | undefined } = {}): Promise<string | undefined> {
  return (await drawMissingDiagram(xml, options)).xml;
}

/**
 * Applies `operations` to the main process of `xml` (the one the simulator reads), all or none
 * (see the header). Throws `EditError`.
 */
export async function editBpmn(xml: string, operations: unknown, options: EditBpmnOptions = {}): Promise<BpmnEdit> {
  const locale = options.locale ?? 'en';
  const C = messages(locale).cli;
  const shapeIssues: EditIssue[] = [];
  const ops = readOperations(operations, C, shapeIssues);
  if (ops.length === 0) fail(C, shapeIssues);

  const moddle = BpmnModdle({ lila });
  const { rootElement, warnings } = await moddle.fromXML(xml);
  if (warnings.length > 0) {
    const detail = warnings.map((w) => w.message).join('; ');
    fail(C, [{ op: null, path: 'bpmn', message: C.editContentLoss(detail) }]);
  }
  const definitions = rootElement as unknown as El;
  const process = mainProcess(definitions, options.processId);
  if (process === undefined) fail(C, [{ op: null, path: 'bpmn', message: C.outlineNoProcess() }]);

  const editor = new Editor(moddle, definitions, process, C, options.scenario, options.scenarioName ?? 'as-is.scenario.json');
  editor.incremental = options.layout === false;
  editor.callTargets = options.callTargets;
  editor.noteSeated();
  editor.issues.push(...shapeIssues);
  for (const [index, op] of ops.entries()) {
    if (op === undefined) continue;
    editor.op = index;
    editor.apply(op);
  }
  if (editor.issues.length > 0) fail(C, [...editor.issues].sort((a, b) => (a.op ?? -1) - (b.op ?? -1)));

  if (options.layout !== false) {
    try {
      await relayout({ definitions, process, participant: editor.participant, pool: editor.pool, diagram: editor.diagram });
    } catch (error) {
      if (!(error instanceof LayoutError)) throw error;
      fail(C, [{ op: null, path: 'layout', message: C.editLayoutFailed(error.message) }]);
    }
    // The content of sub-processes keeps its drawing: new annotations and data objects there get a shape.
    editor.placeArtifacts();
  } else {
    // New annotations and data objects get a shape beside their node (#638).
    editor.placeArtifacts();
    // Flows that now run through a new or moved shape go around it; the flows drawn again get
    // their labels on their own segment, as `create_process` does.
    editor.diagram.untangle([...everything(process['flowElements'] ?? [])].filter((el) => el.$type === 'bpmn:SequenceFlow'));
    editor.diagram.label(editor.diagram.rerouted);
    // Pools right of this one make way if it grew wider (pools below already did, row by row).
    const plane = editor.diagram.mainPlane(process);
    const now = editor.participant === undefined ? undefined : editor.diagram.bounds(editor.participant.id);
    if (plane !== undefined && editor.pool !== undefined && now !== undefined) editor.diagram.pushAside(plane, editor.pool, now, false);
    // Message flows and associations whose ends moved are drawn again.
    const links = editor.links();
    const touched = (link: El): boolean => editor.diagram.moved.has(link['sourceRef']?.id) || editor.diagram.moved.has(link['targetRef']?.id);
    for (const link of links) if (link.$type !== 'bpmn:MessageFlow' && touched(link)) editor.diagram.routeOther(link);
    for (const link of editor.dataLinks()) {
      const ref = link.$type === 'bpmn:DataInputAssociation' ? ((link['sourceRef'] ?? []) as El[])[0] : (link['targetRef'] as El | undefined);
      if (editor.diagram.moved.has(link['$parent'].id) || (ref !== undefined && editor.diagram.moved.has(ref.id))) editor.diagram.routeOther(link);
    }
    if (links.some((link) => link.$type === 'bpmn:MessageFlow' && touched(link))) editor.diagram.routeMessages(definitions);
  }
  const { xml: raw } = await moddle.toXML(rootElement, { format: true });
  const out = marcarExportador(raw);

  // Only errors the edit brought in count: a model may already carry some (it is still editable).
  const scenarios = options.scenarios === undefined ? undefined : [...options.scenarios];
  const known = new Set((await validateBpmnXml(xml, { locale, scenarios })).errors.map((e) => `${e.code}\u0000${e.id}`));
  const report = await validateBpmnXml(out, { locale, scenarios });
  const fresh = report.errors.filter((e) => !known.has(`${e.code}\u0000${e.id}`));
  if (fresh.length > 0) {
    fail(
      C,
      fresh.map((e) => ({ op: editor.touched.get(e.id) ?? (ops.length === 1 ? 0 : null), path: `bpmn.${e.id}`, message: `${e.code}: ${e.message}` })),
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
      notes.push(C.editProbabilityNote(gateway.id, options.scenarioName ?? 'as-is.scenario.json', sum, outs.map((f) => f.id).join(', ')));
    }
  }

  return {
    xml: out,
    changes: editor.changes,
    removed: editor.removed,
    scenario: editor.scenarioChanged ? (editor.scenario as ScenarioDocument) : undefined,
    warnings: report.warnings,
    notes,
    retyped: editor.retyped,
    touched: editor.touched,
  };
}
