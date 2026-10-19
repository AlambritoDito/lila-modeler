/**
 * The modelling tools an agent needs besides the process itself (#99, #403, #514): annotate an
 * element (documentation, RACI, catalog references, extended attributes), read the RACI matrix,
 * import a scenario sheet into a scenario of the project, hand out that sheet as a template, and
 * create a `.lila` from a BPMN and its scenarios. The CLI (`lila process annotate|raci`,
 * `lila scenario import|template`) and the MCP server (`annotate_element`, `get_raci_matrix`,
 * `import_scenario_sheet`, `export_scenario_template`, `create_project`) are thin layers over
 * these functions.
 *
 * Every write goes through the shared `.lila` writers: `writeLilaProject`/`writeLilaScenario` for
 * an opened project (atomic, under the cross-process lock, refused when the file changed since it
 * was read) and `writeLilaFile` for a new one. Nothing is written before everything is validated,
 * and a dry run never writes.
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import {
  AnnotationContentLossError,
  REF_KINDS,
  annotatableElements,
  annotateElement,
  categoryOf,
  documentationHolder,
  poolOfProcess,
  parseBpmn,
  readAnnotations,
  uniqueDefinitions,
  validateAttributeValue,
  validateBpmnXml,
  type AnnotatableElement,
  type Annotations,
  type AttributeDefinition,
  type AttributeValue,
  type RefKind,
  type Refs,
  type Responsibility,
  type ValidateBpmnReport,
} from '../bpmn/index.js';
import { drawMissingDiagram } from '../bpmn/edit.js';
import { LayoutError } from '../bpmn/layout.js';
import type { ProcessIR } from '../core/ir.js';
import { toCsv } from '../csv.js';
import { agentToolMessages, messages, type Locale } from '../messages/index.js';
import { raciMatrix, type RaciMatrix } from '../process-document.js';
import {
  encodeLila,
  ProjectFormatError,
  processesOf,
  withProcesses,
  type ProcessDocument,
  type ProjectDocument,
  type ScenarioDocument,
} from '../project/index.js';
import {
  parseScenario,
  resolveExtends,
  resolveScenarioPath,
  schemaIssueLines,
  validateScenario,
  type ResolvedScenario,
  type ScenarioReader,
  type ValidateScenarioOptions,
} from '../scenario.js';
import {
  describeImportValue,
  planScenarioImport,
  readScenarioFile,
  scenarioTemplate,
  WorkbookReadError,
  type ImportPlan,
  type ImportIssue,
  type TableId,
} from '../scenario-sheets.js';
import {
  findLilaScenario,
  lilaScenarioEntryName,
  lilaScenarioPath,
  lilaScenarioReader,
  lilaWritten,
  openLilaProcess,
  writeLilaProject,
  writeLilaScenario,
  type LilaProcess,
} from './input.js';
import { writeLilaFile } from './lilaFile.js';
import { isLilaPath } from './paths.js';
import { ProjectIOError } from './projectIO.js';

/** `/`-separated absolute path, the rule of the rest of `project-fs`. */
function absolute(file: string): string {
  return resolve(file).replaceAll('\\', '/');
}

/** One process of a `.lila`, named the way every tool names it. */
export interface LilaTarget {
  /** Path to the `.lila`. */
  readonly file: string;
  /** Slug of the process; implicit when the project holds one. */
  readonly process?: string | undefined;
  readonly locale?: Locale | undefined;
}

const RACI_TYPES = ['R', 'A', 'C', 'I'] as const;

/** `annotatableElements` and `readAnnotations`, with bpmn-moddle's content loss in the caller's language. */
export async function readElements(
  xml: string,
  locale: Locale,
): Promise<{ elements: Record<string, AnnotatableElement>; annotations: Record<string, Annotations> }> {
  try {
    return { elements: await annotatableElements(xml), annotations: await readAnnotations(xml) };
  } catch (error) {
    if (error instanceof AnnotationContentLossError) throw new Error(agentToolMessages(locale).contentLoss(error.detail));
    throw error;
  }
}

/** `lila:attributeDefinition` of the whole model, each id once (the first one wins, as everywhere). */
function definitionsOf(annotations: Readonly<Record<string, Annotations>>): AttributeDefinition[] {
  return uniqueDefinitions(Object.values(annotations).flatMap((a) => a.attributeDefinitions ?? []));
}

/** `id (name)` of every definition, for an error that has to list them. */
export function definitionList(definitions: readonly AttributeDefinition[], locale: Locale): string {
  if (definitions.length === 0) return agentToolMessages(locale).none();
  return definitions.map((d) => (d.name === '' || d.name === d.id ? d.id : `${d.id} (${d.name})`)).join(', ');
}

/** `document` with `slug`'s model replaced by `xml`, its revision one up (as the app's save does). */
export function withModelXml(document: ProjectDocument, slug: string, xml: string): ProjectDocument {
  const processes = processesOf(document).map((p): ProcessDocument =>
    p.slug !== slug ? p : { ...p, model: { ...p.model, xml, revision: p.model.revision + 1 } },
  );
  return withProcesses(document, processes);
}

/* ------------------------------------------------------------------ *
 * annotate_element (#99)
 * ------------------------------------------------------------------ */

export interface AnnotateRequest extends LilaTarget {
  /** The BPMN id of the element: a node, a flow, a lane, a pool, the process… */
  readonly elementId: string;
  /** Replaces the element's `bpmn:documentation`; `''` removes it. */
  readonly documentation?: string | undefined;
  /** Replaces the element's whole RACI list; `[]` clears it. */
  readonly responsibilities?: readonly Responsibility[] | undefined;
  /** Each kind given replaces that kind's list (`[]` clears it); the kinds left out stay. */
  readonly refs?: Readonly<Record<string, readonly string[]>> | undefined;
  /**
   * Extended attribute values by definition id (or by name, when only one definition has it; the
   * exact spelling first, else regardless of case and outer spaces).
   * Merged into what the element has: `''` removes a value, the attributes left out stay.
   */
  readonly attributes?: Readonly<Record<string, string>> | undefined;
  readonly dryRun?: boolean | undefined;
}

export interface AnnotateResult {
  readonly file: string;
  readonly process: string;
  readonly elementId: string;
  /** For a pool: the process its description is written on (and read from), as in the app. */
  readonly documentationOn?: string;
  readonly dryRun: boolean;
  /** `false`: the element already said this, and nothing was (or would be) written. */
  readonly changed: boolean;
  /** `true` when the `.lila` was saved. */
  readonly written: boolean;
  readonly before: Annotations;
  readonly after: Annotations;
}

/** The checks that need no model: RACI types, roles, reference kinds. Throws the first problem. */
function checkAnnotationShape(request: AnnotateRequest, locale: Locale): void {
  const T = agentToolMessages(locale);
  const { documentation, responsibilities, refs, attributes } = request;
  if (documentation === undefined && responsibilities === undefined && refs === undefined && attributes === undefined) {
    throw new Error(T.nothingToAnnotate());
  }
  for (const { type, roleRef } of responsibilities ?? []) {
    if (!(RACI_TYPES as readonly string[]).includes(type)) throw new Error(T.raciType(type));
    if (typeof roleRef !== 'string' || roleRef.trim() === '') throw new Error(T.emptyRoleRef());
  }
  for (const [kind, list] of Object.entries(refs ?? {})) {
    if (!(REF_KINDS as readonly string[]).includes(kind)) throw new Error(T.unknownRefKind(kind, REF_KINDS.join(', ')));
    if (list.some((ref) => typeof ref !== 'string' || ref.trim() === '')) throw new Error(T.emptyRef(kind));
  }
}

/**
 * The element's attribute values after `changes`: a value given replaces that attribute's values in
 * place (`''` drops them), a new one goes last, and the rest stay as they were. Every value is
 * checked against its definition (`validateAttributeValue`) and the element's type.
 */
function mergedAttributes(
  request: AnnotateRequest & { readonly attributes: Readonly<Record<string, string>> },
  element: AnnotatableElement,
  current: readonly AttributeValue[],
  definitions: readonly AttributeDefinition[],
  locale: Locale,
): AttributeValue[] {
  const T = agentToolMessages(locale);
  const category = categoryOf(element.type);
  const given = new Map<string, string>();
  for (const [key, value] of Object.entries(request.attributes)) {
    let definition = definitions.find((d) => d.id === key);
    if (definition === undefined) {
      // By name: the exact spelling first, else regardless of case and outer spaces, as
      // define_attribute tells names apart (#645). The definition keeps its own spelling.
      const exact = definitions.filter((d) => d.name === key);
      const folded = key.trim().toLowerCase();
      const named = exact.length > 0 ? exact : definitions.filter((d) => d.name.trim().toLowerCase() === folded);
      if (named.length > 1) throw new Error(T.ambiguousAttribute(key, named.map((d) => d.id).join(', ')));
      definition = named[0];
    }
    if (definition === undefined) throw new Error(T.unknownAttribute(key, definitionList(definitions, locale)));
    const label = definition.name || definition.id;
    if (definition.appliesTo !== category) {
      throw new Error(T.attributeNotApplicable(label, definition.appliesTo, request.elementId, category ?? ''));
    }
    const problem = validateAttributeValue(definition, value);
    if (problem === 'number') throw new Error(T.attributeNumber(label, value));
    if (problem === 'date') throw new Error(T.attributeDate(label, value));
    if (problem === 'option') throw new Error(T.attributeOption(label, value, (definition.options ?? []).join(', ') || T.none()));
    given.set(definition.id, value);
  }
  const out: AttributeValue[] = [];
  const placed = new Set<string>();
  for (const attribute of current) {
    if (!given.has(attribute.ref)) {
      out.push(attribute);
    } else if (!placed.has(attribute.ref)) {
      placed.add(attribute.ref);
      if (given.get(attribute.ref) !== '') out.push({ ref: attribute.ref, value: given.get(attribute.ref)! });
    }
  }
  for (const [ref, value] of given) if (!placed.has(ref) && value !== '') out.push({ ref, value });
  return out;
}

/** Annotates one element of one process of a `.lila` (#99); see `AnnotateRequest` for what each field does. */
export async function annotateLilaElement(request: AnnotateRequest): Promise<AnnotateResult> {
  const locale = request.locale ?? 'en';
  const T = agentToolMessages(locale);
  checkAnnotationShape(request, locale);
  const lila = await openLilaProcess(request.file, { process: request.process, locale });
  const xml = lila.process.model.xml;
  const { elements, annotations } = await readElements(xml, locale);
  const id = request.elementId;
  if (!Object.hasOwn(elements, id)) throw new Error(T.unknownElement(id, lila.process.slug, lila.file));
  // Write where the app reads (`annotation-holders.ts`): a pool's description is its process's,
  // and a process inside a pool has its RACI and references on the pool.
  const element = { id, ...elements[id]! };
  const holder = documentationHolder(element);
  if (element.type === 'bpmn:Process' && (request.responsibilities !== undefined || request.refs !== undefined)) {
    const pool = poolOfProcess(id, Object.entries(elements).map(([key, value]) => ({ id: key, ...value })));
    if (pool !== undefined) throw new Error(T.processRaciOnPool(id, pool));
  }
  const own = (key: string): Annotations => (Object.hasOwn(annotations, key) ? annotations[key]! : {});
  /** The element as the app shows it: its own annotations, with the description of its holder. */
  const view = (all: Readonly<Record<string, Annotations>>): Annotations => {
    const { documentation: _own, ...rest } = Object.hasOwn(all, id) ? all[id]! : {};
    const documentation = Object.hasOwn(all, holder) ? all[holder]!.documentation : undefined;
    return { ...(documentation === undefined ? {} : { documentation }), ...rest };
  };
  const before = view(annotations);

  const change: Annotations = {};
  if (request.documentation !== undefined && holder === id) change.documentation = request.documentation;
  if (request.responsibilities !== undefined) {
    change.responsibilities = request.responsibilities.map(({ type, roleRef }) => ({ type, roleRef: roleRef.trim() }));
  }
  if (request.refs !== undefined) {
    const refs: Refs = {};
    for (const [kind, list] of Object.entries(request.refs)) refs[kind as RefKind] = list.map((ref) => ref.trim());
    change.refs = refs;
  }
  if (request.attributes !== undefined) {
    change.attributes = mergedAttributes(
      { ...request, attributes: request.attributes },
      elements[id]!,
      own(id).attributes ?? [],
      definitionsOf(annotations),
      locale,
    );
  }

  let next = xml;
  try {
    if (Object.keys(change).length > 0) next = await annotateElement(next, id, change);
    if (request.documentation !== undefined && holder !== id) {
      next = await annotateElement(next, holder, { documentation: request.documentation });
    }
  } catch (error) {
    if (error instanceof AnnotationContentLossError) throw new Error(T.contentLoss(error.detail));
    throw error;
  }
  const after = view(await readAnnotations(next));
  const changed = JSON.stringify(after) !== JSON.stringify(before);
  const dryRun = request.dryRun === true;
  const written = changed && !dryRun ? await writeLilaProject(lila, withModelXml(lila.document, lila.process.slug, next), locale) : null;
  return {
    file: lila.file,
    // The slug in the file as written (#613): a one-process version 2 archive is version 1 after it.
    process: written === null ? lila.process.slug : lilaWritten(lila, written).slug,
    elementId: id,
    ...(holder === id ? {} : { documentationOn: holder }),
    dryRun,
    changed,
    written: changed && !dryRun,
    before,
    after,
  };
}

/* ------------------------------------------------------------------ *
 * get_raci_matrix (#99)
 * ------------------------------------------------------------------ */

export interface LilaRaciMatrix extends RaciMatrix {
  readonly file: string;
  readonly process: string;
}

/**
 * The RACI matrix of one process of a `.lila`: `raciMatrix` over the same inputs `exportDocument`
 * gives `buildProcessDocument`, so it lists what the process document lists, in its order.
 */
export async function lilaRaciMatrix(target: LilaTarget): Promise<LilaRaciMatrix> {
  const locale = target.locale ?? 'en';
  const lila = await openLilaProcess(target.file, { process: target.process, locale });
  const xml = lila.process.model.xml;
  // #546: the process its scenarios target, the one the process document describes.
  const { ir, subprocesses, lanes, nodeLanes, laneParents, pool, poolName, types } = await parseBpmn(xml, {
    scenarios: Object.values(lila.process.scenarios),
  });
  const { annotations } = await readElements(xml, locale);
  const matrix = raciMatrix({
    ir, annotations, subprocesses, lanes, nodeLanes, laneParents, pool, poolName, types, title: '', date: '', locale,
  });
  return { file: lila.file, process: lila.process.slug, ...matrix };
}

/** The matrix as RFC 4180 CSV: `id`, `name`, `lane`, then one column per role. */
export function raciCsv(matrix: RaciMatrix): string {
  return toCsv(
    ['id', 'name', 'lane', ...matrix.roles],
    matrix.rows.map((row) => [row.id, row.name, row.lane ?? '', ...matrix.roles.map((role) => row.cells[role] ?? '')]),
  );
}

/* ------------------------------------------------------------------ *
 * import_scenario_sheet / export_scenario_template (#514)
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function readAt(root: unknown, path: readonly string[]): unknown {
  let at: unknown = root;
  for (const key of path) {
    if (!isRecord(at) || !Object.hasOwn(at, key)) return undefined;
    at = at[key];
  }
  return at;
}

/** A copy of `root` with `value` at `path`, creating the objects that are missing (the app's `escribir`). */
function writeAt(root: unknown, path: readonly string[], value: unknown): unknown {
  if (path.length === 0) return value;
  const [key, ...rest] = path as [string, ...string[]];
  const copy: Record<string, unknown> = isRecord(root) ? { ...root } : {};
  Object.defineProperty(copy, key, {
    value: writeAt(Object.hasOwn(copy, key) ? copy[key] : undefined, rest, value),
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return copy;
}

/**
 * What the delta needs so that the resolved scenario is exactly `value` (the app's `conBorrados`,
 * scenario § 6): the keys the parent has and `value` lacks are set to `null`, or a merge would
 * leave a `triangular`'s `min`/`mode`/`max` stuck to the `normal` that replaced it.
 */
function withDeletions(value: unknown, inherited: unknown): unknown {
  if (!isRecord(value) || !isRecord(inherited)) return value;
  const deletions: Record<string, unknown> = {};
  for (const key of Object.keys(inherited)) if (!Object.hasOwn(value, key)) deletions[key] = null;
  return { ...deletions, ...value };
}

/** The opened scenario of a process: its entry, the file content (delta), the resolved scenario and its parent. */
interface OpenedScenario {
  readonly lila: LilaProcess;
  readonly entry: string;
  readonly delta: Record<string, unknown>;
  readonly resolved: Record<string, unknown>;
  readonly parent: Record<string, unknown> | null;
  readonly ir: Awaited<ReturnType<typeof parseBpmn>>['ir'];
}

async function openScenario(target: LilaTarget & { readonly scenario: string }): Promise<OpenedScenario> {
  const locale = target.locale ?? 'en';
  const lila = await openLilaProcess(target.file, { process: target.process, locale });
  const entry = findLilaScenario(lila, target.scenario, locale);
  const path = lilaScenarioPath(lila, entry);
  const read = lilaScenarioReader(lila, (file) => JSON.parse(readFileSync(file, 'utf8')) as unknown, locale);
  const delta = lila.process.scenarios[entry] as Record<string, unknown>;
  const resolved = resolveExtends(path, read, locale);
  const parent = typeof delta['extends'] === 'string' ? resolveExtends(resolveScenarioPath(path, delta['extends']), read, locale) : null;
  const { ir } = await parseBpmn(lila.process.model.xml, { scenarios: Object.values(lila.process.scenarios) });
  return { lila, entry, delta, resolved, parent, ir };
}

export interface SheetImportRequest extends LilaTarget {
  /** The scenario of the process: entry name, that name without `.scenario.json`, or its `"name"`. */
  readonly scenario: string;
  /** Path to the `.xlsx`, `.csv` or `.txt` to import. */
  readonly sheet: string;
  readonly dryRun?: boolean | undefined;
}

/** One planned change, with the report line the app shows for it. */
export interface SheetImportChange {
  readonly table: TableId;
  readonly sheet: string;
  readonly row: number;
  readonly target: string;
  /** The field that changes; `''` when the whole entry is new. */
  readonly field: string;
  readonly path: readonly string[];
  readonly before: unknown;
  readonly after: unknown;
  /** `target · field: before → after` (`new` for a new entry), in the unit the row was written in. */
  readonly text: string;
}

export interface SheetImportResult {
  readonly file: string;
  readonly process: string;
  /** The scenario's entry name. */
  readonly scenario: string;
  readonly sheet: string;
  readonly dryRun: boolean;
  /** `true` when the scenario was saved into the `.lila`. */
  readonly written: boolean;
  readonly tables: ImportPlan['tables'];
  readonly changes: readonly SheetImportChange[];
  /**
   * Rows not applied (`error`, `unmatched`, `ambiguous`), notes (`warning`) and errors the import
   * would leave in the scenario (`lint`): a plan with `lint` is never written.
   */
  readonly issues: readonly ImportIssue[];
}

function readSheet(file: string, locale: Locale): ReturnType<typeof readScenarioFile> {
  const T = agentToolMessages(locale);
  const path = absolute(file);
  if (!existsSync(path) || lstatSync(path).isDirectory()) throw new Error(messages(locale).mcp.fileMissing(path));
  try {
    return readScenarioFile(basename(path), new Uint8Array(readFileSync(path)));
  } catch (error) {
    if (!(error instanceof WorkbookReadError)) throw error;
    throw new Error(
      error.reason === 'too-large' ? T.sheetTooLarge(path) : error.reason === 'out-of-bounds' ? T.sheetOutOfBounds(path) : T.sheetUnreadable(path),
    );
  }
}

/**
 * Imports a scenario sheet (#514) into a scenario of a `.lila`, the way the app's «Import
 * Excel/CSV…» does: `readScenarioFile`, then `planScenarioImport` against the **resolved**
 * scenario, then each change written into the scenario's own file (its delta when it `extends`
 * another) with the parent's keys a new value lacks set to `null`. Nothing is written on a dry run,
 * when nothing changes, or when the plan has `lint` issues (it throws then, listing them).
 */
export async function importLilaScenarioSheet(request: SheetImportRequest): Promise<SheetImportResult> {
  const locale = request.locale ?? 'en';
  const sheets = readSheet(request.sheet, locale);
  const opened = await openScenario(request);
  const plan = planScenarioImport(sheets, opened.resolved, opened.ir, { locale });
  const changes = plan.changes.map((change): SheetImportChange => ({
    table: change.table,
    sheet: change.sheet,
    row: change.row,
    target: change.target,
    field: change.field,
    path: change.path,
    before: change.before,
    after: change.after,
    text: `${change.target} · ${change.field === '' ? agentToolMessages(locale).newEntry() : change.field}: ${describeImportValue(change.before, { unit: change.unit, locale })} → ${describeImportValue(change.after, { unit: change.unit, locale })}`,
  }));
  const dryRun = request.dryRun === true;
  const lint = plan.issues.filter((issue) => issue.kind === 'lint');
  const result = {
    file: opened.lila.file,
    process: opened.lila.process.slug,
    scenario: opened.entry,
    sheet: absolute(request.sheet),
    dryRun,
    tables: plan.tables,
    changes,
    issues: plan.issues,
  };
  if (dryRun || changes.length === 0) return { ...result, written: false };
  if (lint.length > 0) {
    throw new Error(agentToolMessages(locale).importLint(lint.length, lint.map((issue) => issue.text).join('; ')));
  }
  let delta: unknown = opened.delta;
  for (const change of plan.changes) {
    delta = writeAt(delta, change.path, withDeletions(clone(change.after), readAt(opened.parent, change.path)));
  }
  const written = await writeLilaScenario(opened.lila, opened.entry, delta as ScenarioDocument, locale);
  return { ...result, process: lilaWritten(opened.lila, written).slug, written: true };
}

/**
 * The scenario sheet of a scenario of a `.lila` (#514): the app's «Download template»
 * (`scenarioTemplate` of the resolved scenario), for an agent to hand to a person to fill in.
 */
export async function lilaScenarioTemplate(
  target: LilaTarget & { readonly scenario: string },
): Promise<{ readonly data: Uint8Array; readonly file: string; readonly process: string; readonly scenario: string }> {
  const opened = await openScenario(target);
  return {
    data: scenarioTemplate(opened.resolved, opened.ir),
    file: opened.lila.file,
    process: opened.lila.process.slug,
    scenario: opened.entry,
  };
}

/* ------------------------------------------------------------------ *
 * create_project (#403)
 * ------------------------------------------------------------------ */

export interface CreateProjectRequest {
  /** Where to write the new `.lila`. */
  readonly path: string;
  readonly name: string;
  /** The model: BPMN XML (it starts with `<`) or a path to a `.bpmn`. */
  readonly bpmn: string;
  /** Scenarios by name; each is saved as `<name>.scenario.json`. */
  readonly scenarios?: readonly { readonly name: string; readonly scenario: unknown }[] | undefined;
  /** Replace an existing file. Default: an existing file is never touched. */
  readonly overwrite?: boolean | undefined;
  /**
   * #632: save a model with validation errors too (a diagram kept for documentation), with the
   * errors in `notes`. Default: such a model is refused. An unreadable file is always refused.
   */
  readonly allowUnsimulatable?: boolean | undefined;
  readonly locale?: Locale | undefined;
}

/** Whether a scenario of the new project can be simulated as it is, and why not. */
export interface CreatedScenario {
  readonly entry: string;
  /** `false`: a draft, saved as given; `errors` says what it lacks before it can run. */
  readonly runnable: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface CreateProjectResult {
  readonly file: string;
  readonly name: string;
  /** The `bpmn:process` the project simulates. */
  readonly processId: string;
  /** #630: the model had no diagram (BPMN DI) and the project's has one drawn by the auto-layout. */
  readonly laidOut: boolean;
  /** The model's validation warnings (`code: message`). */
  readonly warnings: readonly string[];
  /**
   * #632: with `allowUnsimulatable`, the model's validation errors (`code: message`); #645: then
   * why the process it simulates was left without a (full) diagram, when it was.
   */
  readonly notes: readonly string[];
  readonly scenarios: readonly CreatedScenario[];
}

const MODEL_ENTRY = 'model.bpmn';

/** Removes `folder` and its parents up to `top` (included) while they are empty; anything else stays. */
function removeEmptyFolders(folder: string, top: string): void {
  for (let at = resolve(folder); ; at = dirname(at)) {
    try {
      rmdirSync(at);
    } catch {
      return;
    }
    if (at === resolve(top) || dirname(at) === at) return;
  }
}

function problemText(problem: { code: string; message: string }): string {
  return `${problem.code}: ${problem.message}`;
}

/**
 * #630, #645: `xml` with the process it simulates (`processId`) drawn when it had no diagram for
 * it (`laidOut`), else as given; `note` says why a process without a (full) drawing was left so.
 */
export async function withDiagram(
  xml: string,
  processId: string,
  locale: Locale,
): Promise<{ readonly xml: string; readonly laidOut: boolean; readonly note?: string }> {
  const T = agentToolMessages(locale);
  try {
    const { xml: drawn, gap } = await drawMissingDiagram(xml, { processId, locale });
    if (drawn !== undefined) return { xml: drawn, laidOut: true };
    if (gap === undefined) return { xml, laidOut: false };
    return { xml, laidOut: false, note: gap.kind === 'unreadable' ? T.diagramUnreadable(gap.detail) : T.diagramPartial(gap.missing) };
  } catch (error) {
    if (!(error instanceof LayoutError)) throw error;
    return { xml, laidOut: false, note: T.diagramLayoutFailed(error.message) };
  }
}

/**
 * The `bpmn` argument of `create_project` and `put_process_bpmn` (#632): inline XML when it starts
 * with `<`, otherwise a path to a `.bpmn`, read as UTF-8 (`file` is then its absolute path). A
 * blank one is neither (#645).
 */
export function readBpmnArgument(bpmn: string, locale: Locale): { readonly xml: string; readonly file?: string } {
  if (bpmn.trim() === '') throw new Error(agentToolMessages(locale).bpmnEmpty());
  if (bpmn.trimStart().startsWith('<')) return { xml: bpmn };
  const source = absolute(bpmn);
  if (!existsSync(source) || lstatSync(source).isDirectory()) throw new Error(messages(locale).mcp.fileMissing(source));
  return { xml: readFileSync(source, 'utf8'), file: source };
}

/** What `checkScenario` found: the scenario as far as it could be read, and its problems. */
export interface ScenarioCheck {
  /** The scenario with `extends` merged, unparsed; absent when the chain could not be read. */
  readonly merged?: Record<string, unknown>;
  /** The parsed scenario (defaults applied), when it has a valid shape with `model` and `run`. */
  readonly scenario?: ResolvedScenario;
  /** `code: message` of every problem that keeps it from running. */
  readonly errors: readonly string[];
  /** `code: message` of the lint warnings. */
  readonly warnings: readonly string[];
}

/**
 * The scenario at `path` checked the way it will run: `extends` resolved through `read`, the shape
 * (`parseScenario`), `model` and `run` present, then `validateScenario` against `ir`. Every problem
 * is reported instead of thrown, so a draft can be listed with what it lacks (`create_project`,
 * `get_scenario`).
 */
export function checkScenario(
  path: string,
  read: ScenarioReader,
  ir: ProcessIR,
  options: { readonly locale: Locale; readonly elsewhere?: ValidateScenarioOptions['elsewhere'] },
): ScenarioCheck {
  const { locale } = options;
  let merged: Record<string, unknown>;
  try {
    merged = resolveExtends(path, read, locale);
  } catch (error) {
    return { errors: [error instanceof Error ? error.message : String(error)], warnings: [] };
  }
  const parsed = parseScenario(merged, { locale });
  if (!parsed.success) return { merged, errors: schemaIssueLines(parsed.error.issues, { locale }), warnings: [] };
  const missing = [
    ...(parsed.data.model === undefined ? [messages(locale).mcp.patchedMissingModel()] : []),
    ...(parsed.data.run === undefined ? [messages(locale).mcp.patchedMissingRun()] : []),
  ];
  if (missing.length > 0) return { merged, errors: missing, warnings: [] };
  const scenario = parsed.data as ResolvedScenario;
  const problems = validateScenario(scenario, ir, { locale, ...(options.elsewhere === undefined ? {} : { elsewhere: options.elsewhere }) });
  return {
    merged,
    scenario,
    errors: problems.filter((p) => p.severity === 'error').map(problemText),
    warnings: problems.filter((p) => p.severity === 'warning').map(problemText),
  };
}

/** A scenario's diagnostics against the new model, its `extends` read from the scenarios given. */
function scenarioDiagnostics(
  root: string,
  entry: string,
  scenarios: Readonly<Record<string, ScenarioDocument>>,
  report: ValidateBpmnReport,
  locale: Locale,
): CreatedScenario {
  const C = messages(locale).cli;
  const read = (path: string): unknown => {
    const name = path.startsWith(root) ? path.slice(root.length) : '';
    if (!Object.hasOwn(scenarios, name)) {
      throw new Error(C.lilaScenarioUnknown(path.startsWith(root) ? name : path, 'model', root.slice(0, -1), Object.keys(scenarios).sort().join(', ')));
    }
    return scenarios[name];
  };
  const { errors, warnings } = checkScenario(`${root}${entry}`, read, report.ir, { locale });
  return { entry, runnable: errors.length === 0, errors, warnings };
}

/**
 * Creates a `.lila` (#403): one process, the model validated with `validateBpmnXml` (a model with
 * errors is refused unless `allowUnsimulatable`, #632), the scenarios saved as given (a draft that cannot run yet is kept, and its
 * diagnostics come back). The document is encoded before anything touches the disk, and written by
 * `writeLilaFile` (a temporary file and a `rename`, under the `.lila` lock), so an error never
 * leaves a partial file. An existing file is refused, inside the lock, unless `overwrite`.
 */
export async function createLilaProject(request: CreateProjectRequest): Promise<CreateProjectResult> {
  const locale = request.locale ?? 'en';
  const T = agentToolMessages(locale);
  const target = absolute(request.path);
  if (!isLilaPath(target)) throw new Error(T.createNotLila(target));
  const name = request.name.trim();
  if (name === '') throw new Error(T.createEmptyName());

  let { xml } = readBpmnArgument(request.bpmn, locale);
  let report: ValidateBpmnReport;
  try {
    // #546: validated as the process its scenarios target, the one that will run.
    report = await validateBpmnXml(xml, {
      locale,
      scenarios: (request.scenarios ?? []).map((entry) => entry.scenario as { readonly elements?: unknown } | null),
    });
  } catch (error) {
    throw new Error(T.createModelUnparsable(error instanceof Error ? error.message : String(error)));
  }
  // #632: with `allowUnsimulatable` a model with errors is kept, for documentation; they go to `notes`.
  if (report.errors.length > 0 && request.allowUnsimulatable !== true) {
    throw new Error(T.createModelInvalid(report.errors.length, report.errors.map(problemText).join('; ')));
  }
  // #630: a model without a diagram gets one, as `edit_process` with `layout: true` draws it, so
  // `export_diagram` and the apps show it. A model left undrawn is kept as given, with a note.
  const drawing = await withDiagram(xml, report.ir.id, locale);
  xml = drawing.xml;
  const laidOut = drawing.laidOut;

  const scenarios: Record<string, ScenarioDocument> = {};
  for (const { name: scenarioName, scenario } of request.scenarios ?? []) {
    const entry = lilaScenarioEntryName(scenarioName, locale);
    if (Object.hasOwn(scenarios, entry)) throw new Error(T.createScenarioDuplicate(entry));
    if (!isRecord(scenario)) throw new Error(T.createScenarioNotObject(scenarioName));
    const model = scenario['model'];
    if (model !== undefined && (typeof model !== 'string' || model.replace(/^\.\//, '') !== MODEL_ENTRY)) {
      throw new Error(T.createScenarioModel(scenarioName, String(model)));
    }
    // A scenario that extends none needs its model; inside the archive it is always `model.bpmn`.
    scenarios[entry] = model === undefined && scenario['extends'] === undefined ? { model: MODEL_ENTRY, ...scenario } : { ...scenario };
  }

  const document: ProjectDocument = {
    version: 1,
    id: crypto.randomUUID(),
    name,
    model: { id: report.ir.id, name: MODEL_ENTRY, xml, revision: 1 },
    scenarios,
    scenarioRevisions: Object.fromEntries(Object.keys(scenarios).map((entry) => [entry, 1])),
    runs: [],
  };
  try {
    encodeLila(document); // every format problem surfaces here, before the disk is touched
  } catch (error) {
    if (error instanceof ProjectFormatError) throw new Error(messages(locale).cli.lilaUnreadable(target, `${error.code}: ${error.message}`));
    throw error;
  }

  const overwrite = request.overwrite === true;
  const refuseExisting = (): void => {
    if (!existsSync(target)) return;
    if (lstatSync(target).isDirectory()) throw new Error(T.createDirectory(target));
    if (!overwrite) throw new Error(T.createExists(target));
  };
  refuseExisting();
  // The first folder this call creates, if any: removed again when the write fails (QA of #559).
  const created = mkdirSync(dirname(target), { recursive: true });
  try {
    // Checked again inside the lock: another writer may have created the file in between.
    await writeLilaFile(target, document, { overwrite: true, beforeWrite: async () => refuseExisting() });
  } catch (error) {
    if (created !== undefined) removeEmptyFolders(dirname(target), created);
    if (error instanceof ProjectIOError && error.code === 'E-ARCHIVO-OCUPADO') throw new Error(messages(locale).cli.lilaBusy(target));
    if (error instanceof ProjectIOError) throw new Error(`${target}: ${error.code}: ${error.message}`);
    throw error;
  }

  const root = `${target}/`;
  return {
    file: target,
    name,
    processId: report.ir.id,
    laidOut,
    warnings: report.warnings.map(problemText),
    notes: [...report.errors.map((problem) => T.unsimulatableNote(problemText(problem))), ...(drawing.note === undefined ? [] : [drawing.note])],
    scenarios: Object.keys(scenarios).sort().map((entry) => scenarioDiagnostics(root, entry, scenarios, report, locale)),
  };
}
