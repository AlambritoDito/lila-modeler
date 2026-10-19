/**
 * The raw BPMN of one process of a `.lila` (#632): what `get_process_bpmn`/`put_process_bpmn` (MCP)
 * and `lila process export-bpmn|import` (CLI) do. Both are thin layers over these two functions.
 *
 * `readLilaProcessBpmn` returns the model XML as stored, and writes nothing.
 *
 * `putLilaProcessBpmn` adds a BPMN as a new process of an existing `.lila` (`mode: "add"`: a
 * version 1 project becomes a repository, ADR-029, and the process gets a default
 * `as-is.scenario.json`) or replaces the model of one process (`mode: "replace"`: its revision goes
 * up, so its saved runs are stale; scenario entries that no longer apply are removed and reported as
 * `edit_process` reports them, and a scenario error the old model did not cause refuses the call).
 * The model is validated like `create_project` validates it: with errors it is refused unless
 * `allowUnsimulatable`, which keeps it as a diagram that does not simulate, the errors in `notes`.
 * A file that is not XML, not BPMN or has no `bpmn:process` is always refused. A model without a
 * diagram is laid out (`layout`, default `true`). Every write goes through `writeLilaProject`
 * (atomic, under the cross-process lock, refused when the file changed since it was read); every
 * other process is carried through unchanged, and nothing is written on an error or a dry run.
 */
import { basename, extname, resolve } from 'node:path';

import { annotatableElements } from '../bpmn/annotate.js';
import { parseBpmn } from '../bpmn/parse.js';
import { validateBpmnModel, type ValidatedBpmnModel } from '../bpmn/validate-report.js';
import type { ProcessIR } from '../core/ir.js';
import { agentToolMessages, messages, type Locale } from '../messages/index.js';
import {
  defaultScenario,
  isProcessSlug,
  processesOf,
  processSlug,
  withProcesses,
  type ProcessDocument,
  type ProjectDocument,
} from '../project/index.js';
import { readBpmnArgument, withDiagram } from './agent-tools.js';
import { pruneScenarios, scenarioErrors, type ScenarioRemoval } from './edit.js';
import { lilaWritten, openLilaProcess, writeLilaProject, type LilaProcess } from './input.js';
import { BASE_SCENARIO, existing } from './outline.js';
import { isLilaPath } from './paths.js';

const MODEL_ENTRY = 'model.bpmn';

/** `/`-separated absolute path, the rule of the rest of `project-fs`. */
function absolute(file: string): string {
  return resolve(file).replaceAll('\\', '/');
}

function problemText(problem: { code: string; message: string }): string {
  return `${problem.code}: ${problem.message}`;
}

export interface LilaProcessBpmn {
  /** Absolute path of the `.lila`, `/`-separated. */
  readonly file: string;
  /** Slug of the process. */
  readonly process: string;
  /** The `bpmn:process` the project simulates (as `get_project` lists it). */
  readonly processId: string;
  /** Revision of the model. */
  readonly revision: number;
  /** The model as stored, byte for byte. */
  readonly xml: string;
}

/** The model XML of one process of `file`, as stored. Writes nothing. */
export async function readLilaProcessBpmn(
  file: string,
  options: { process?: string | undefined; locale?: Locale | undefined } = {},
): Promise<LilaProcessBpmn> {
  const input = await openLilaProcess(file, options);
  const { model } = input.process;
  return { file: input.file, process: input.process.slug, processId: model.id, revision: model.revision, xml: model.xml };
}

export interface PutLilaProcessBpmnRequest {
  /** Path to the `.lila`; it must exist. */
  readonly file: string;
  /** `"add"`: a new process. `"replace"`: the model of an existing one. */
  readonly mode: 'add' | 'replace' | string;
  /** The model: BPMN XML (it starts with `<`) or a path to a `.bpmn`. */
  readonly bpmn: string;
  /** `add`: the slug of the new process (default: from the name). `replace`: the process replaced. */
  readonly process?: string | undefined;
  /** `add` only: the name of the new process. Default: its pool's, its process's, or the file's. */
  readonly name?: string | undefined;
  /** `true` (default): lay out a model that has no diagram. `false`: keep it as given. */
  readonly layout?: boolean | undefined;
  /** Save a model with validation errors, or that breaks a scenario, with the errors in `notes`. */
  readonly allowUnsimulatable?: boolean | undefined;
  /** Check and build everything, write nothing. */
  readonly dryRun?: boolean | undefined;
  readonly locale?: Locale | undefined;
}

export interface PutLilaProcessBpmnResult {
  /** Absolute path of the `.lila`, `/`-separated. */
  readonly file: string;
  readonly mode: 'add' | 'replace';
  /** Slug of the process added or replaced, as it is in the file after the write. */
  readonly slug: string;
  readonly name: string;
  /** The `bpmn:process` the process simulates. */
  readonly processId: string;
  /** Revision of the model after the write: 1 for an added process. */
  readonly revision: number;
  readonly dryRun: boolean;
  /** The model had no diagram (BPMN DI) and got one drawn by the auto-layout. */
  readonly laidOut: boolean;
  /** One line for a person: what was (or would be) written where. */
  readonly summary: string;
  /** `replace`: scenario entries removed because they no longer apply, with their previous values. */
  readonly scenarioRemovals: readonly ScenarioRemoval[];
  /** The model's validation errors (with `allowUnsimulatable`), scenario removals and scenario errors. */
  readonly notes: readonly string[];
  /** The model's validation warnings (`code: message`). */
  readonly warnings: readonly string[];
  /** Every slug of the project after the write, in tab order. */
  readonly slugs: readonly string[];
}

/** Every id the model `ir` gives a scenario entry to: nodes, flows, flattened sub-processes, original ids. */
function idsOf(ir: ProcessIR): Map<string, string> {
  const ids = new Map<string, string>();
  for (const [id, node] of Object.entries(ir.nodes)) {
    ids.set(id, node.type);
    if (node.subprocessId !== undefined && !ids.has(node.subprocessId)) ids.set(node.subprocessId, 'subProcess');
  }
  for (const id of Object.keys(ir.flows)) ids.set(id, 'flow');
  for (const [irId, original] of Object.entries(ir.source.originalIds)) if (!ids.has(original)) ids.set(original, ids.get(irId) ?? '');
  return ids;
}

/** The pool's name, else the process's, else the file's (without extension), for an added process. */
async function nameOf(xml: string, ir: ProcessIR, file: string | undefined): Promise<string> {
  try {
    const pool = Object.values(await annotatableElements(xml)).find((e) => e.type === 'bpmn:Participant' && e.processRef === ir.id);
    if (pool !== undefined && pool.name.trim() !== '') return pool.name.trim();
  } catch {
    // a model bpmn-moddle cannot read completely still has a process name or a file name
  }
  if (ir.name.trim() !== '') return ir.name.trim();
  if (file !== undefined) return basename(file, extname(file));
  return '';
}

/**
 * Adds or replaces the BPMN of one process of `file` (see the header). Throws `Error` with a catalog
 * message (and, for a file that changed on disk or is busy, a `code`); nothing is written then.
 */
export async function putLilaProcessBpmn(request: PutLilaProcessBpmnRequest): Promise<PutLilaProcessBpmnResult> {
  const locale = request.locale ?? 'en';
  const C = messages(locale).cli;
  const T = agentToolMessages(locale);
  if (request.mode !== 'add' && request.mode !== 'replace') throw new Error(T.putMode(String(request.mode)));
  const mode: 'add' | 'replace' = request.mode;
  const path = absolute(request.file);
  if (!isLilaPath(path)) throw new Error(C.processNotLila(path));
  if (mode === 'replace' && request.name !== undefined) throw new Error(T.putReplaceName());
  if (mode === 'add' && request.name !== undefined && request.name.trim() === '') throw new Error(T.putEmptyName());
  if (mode === 'add' && request.process !== undefined && !isProcessSlug(request.process)) throw new Error(C.processBadSlug(request.process));
  const allow = request.allowUnsimulatable === true;
  const dryRun = request.dryRun === true;

  const source = readBpmnArgument(request.bpmn, locale);
  // `add` needs the file; `replace` opens the process it replaces.
  const opened: LilaProcess | null = mode === 'add' ? await existing(path, locale) : await openLilaProcess(path, { process: request.process, locale });
  if (opened === null) throw new Error(T.putNoProject(path));
  const current = mode === 'replace' ? opened.process : undefined;

  let report: ValidatedBpmnModel;
  try {
    // #546: a replaced model is read as the process its scenarios target, the one that will run.
    report = await validateBpmnModel(source.xml, { locale, scenarios: current === undefined ? [] : Object.values(current.scenarios) });
  } catch (error) {
    throw new Error(T.createModelUnparsable(error instanceof Error ? error.message : String(error)));
  }
  if (report.errors.length > 0 && !allow) {
    throw new Error(T.createModelInvalid(report.errors.length, report.errors.map(problemText).join('; ')));
  }
  const ir = report.ir;
  const notes: string[] = report.errors.map((problem) => T.unsimulatableNote(problemText(problem)));

  // #630: a model without a diagram gets one; one left undrawn is kept as given, with a note (#645).
  let xml = source.xml;
  let laidOut = false;
  if (request.layout !== false) {
    const drawing = await withDiagram(xml, ir.id, locale);
    [xml, laidOut] = [drawing.xml, drawing.laidOut];
    if (drawing.note !== undefined) notes.push(drawing.note);
  }

  const { problems: _problems, loose: _loose, ...document } = opened.document;
  const others = processesOf(document);
  let next: ProjectDocument;
  let target: ProcessDocument;
  let scenarioRemovals: ScenarioRemoval[] = [];

  if (current === undefined) {
    const name = request.name ?? ((await nameOf(source.xml, ir, source.file)) || (request.process ?? 'Process'));
    const slug = request.process ?? processSlug(name);
    if (others.some((p) => p.slug === slug)) throw new Error(C.processExists(slug, path));
    target = {
      slug,
      name,
      model: { id: ir.id, name: MODEL_ENTRY, xml, revision: 1 },
      scenarios: { [BASE_SCENARIO]: defaultScenario(ir) },
      scenarioRevisions: { [BASE_SCENARIO]: 1 },
      runs: [],
    };
    next = withProcesses(document, [...others, target]);
    // The default scenario of a model that does not simulate cannot run either: say so.
    for (const problem of scenarioErrors(opened, target, ir, locale).values()) {
      notes.push(T.putScenarioNote(problem.scenario, `${problem.path}: ${problem.code}: ${problem.message}`));
    }
  } else {
    // What the old model had that the new one does not (or has as something else) leaves the scenarios.
    let before: ProcessIR | undefined;
    try {
      before = (await parseBpmn(current.model.xml, { scenarios: Object.values(current.scenarios) })).ir;
    } catch {
      before = undefined; // a stored model that cannot be read: nothing to compare against
    }
    const oldIds = before === undefined ? new Map<string, string>() : idsOf(before);
    const newIds = idsOf(ir);
    const removed = new Set([...oldIds.keys()].filter((id) => !newIds.has(id)));
    const retyped = [...oldIds].filter(([id, type]) => newIds.has(id) && newIds.get(id) !== type).map(([id]) => id);
    const pruned = pruneScenarios(current.scenarios, ir, removed, retyped);
    scenarioRemovals = pruned.scenarioRemovals;
    const scenarioRevisions = { ...current.scenarioRevisions };
    for (const name of pruned.changed) scenarioRevisions[name] = (current.scenarioRevisions[name] ?? 0) + 1;
    target = {
      ...current,
      model: { ...current.model, id: ir.id, xml, revision: current.model.revision + 1 },
      scenarios: pruned.scenarios,
      scenarioRevisions,
    };
    notes.push(...scenarioRemovals.map((r) => C.editScenarioRemoved(r.scenario, r.id, JSON.stringify(r.removed))));

    // The process must still simulate: no scenario may get an error it did not have, unless allowed.
    const old = before === undefined ? new Map() : scenarioErrors(opened, current, before, locale);
    const fresh = [...scenarioErrors(opened, target, ir, locale)].filter(([key]) => !old.has(key)).map(([, p]) => p);
    const lines = fresh.map((p) => `${p.scenario}: ${p.path}: ${p.code}: ${p.message}`);
    if (fresh.length > 0 && !allow) throw new Error(T.putScenarioBroken(lines.map((line) => `  ${line}`).join('\n')));
    notes.push(...fresh.map((p) => T.putScenarioNote(p.scenario, `${p.path}: ${p.code}: ${p.message}`)));
    next = withProcesses(document, others.map((p) => (p.slug === current.slug ? target : p)));
  }

  // #613: a one-process version 2 archive is written as version 1, and its process then takes the
  // project's name and the slug that follows it; a dry run reports what the write would give (#645).
  const landed = current === undefined ? target : processesOf(next)[others.findIndex((p) => p.slug === current.slug)]!;
  let { slug, name } = landed;
  let slugs = processesOf(next).map((p) => p.slug);
  if (!dryRun) {
    const written = await writeLilaProject(opened, next, locale);
    if (current !== undefined) slug = lilaWritten(opened, written).slug;
    name = processesOf(written).find((p) => p.slug === slug)?.name ?? name;
    slugs = processesOf(written).map((p) => p.slug);
  }
  return {
    file: path,
    mode,
    slug,
    name,
    processId: ir.id,
    revision: target.model.revision,
    dryRun,
    laidOut,
    summary: T.putSummary(mode, dryRun, name, slug, path, target.model.revision),
    scenarioRemovals,
    notes,
    warnings: report.warnings.map(problemText),
    slugs,
  };
}
