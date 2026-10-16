/**
 * Renaming and deleting the processes and scenarios of a `.lila` (#634): what `rename_process`,
 * `delete_process`, `rename_scenario` and `delete_scenario` (MCP) and `lila process rename|delete`
 * and `lila scenario rename|delete` (CLI) do. Both are thin layers over these four functions.
 *
 * The rules are the app's (`App.tsx` `renombrarProceso`/`borrarProceso`, `SelectorEscenario.tsx`):
 *
 * - A process is renamed by its `name`; its slug never changes. A one-process project has no
 *   process name of its own (it is written as version 1, named after the project), so a rename is
 *   refused there.
 * - The last process cannot be deleted, and neither can one that a call activity of another process
 *   names in its `calledElement`. Its scenarios and runs go with it. Deleting down to one process
 *   writes a version 1 archive (`withProcesses`).
 * - A scenario is renamed by its `"name"`; its entry stays. Its revision goes up, and so do those
 *   of the scenarios that extend it, as in the app (`nextScenarioRevisions`). A name another
 *   scenario of the process already answers to is refused: `findLilaScenario` would no longer find
 *   one scenario by it.
 * - The last scenario of a process cannot be deleted, and neither can one other scenarios extend.
 *   Its runs and its revision go with it.
 *
 * Every refusal throws before anything is written. Every write goes through `writeLilaProject`
 * (atomic, under the cross-process lock, refused when the file changed since it was read); every
 * other process is carried through unchanged, and nothing is written on a dry run.
 */
import { agentToolMessages, type Locale } from '../messages/index.js';
import { processesOf, processIds, withProcesses, type ProcessDocument, type ProjectDocument } from '../project/index.js';
import { resolveScenarioPath } from '../scenario.js';
import { findLilaScenario, lilaWritten, openLilaProcess, writeLilaProject, type LilaProcess } from './input.js';
import { BASE_SCENARIO } from './outline.js';

interface ManageTarget {
  /** Path to the `.lila`; it must exist. */
  readonly file: string;
  readonly dryRun?: boolean | undefined;
  readonly locale?: Locale | undefined;
}

/** What every operation returns. */
interface ManageResult {
  /** Absolute path of the `.lila`, `/`-separated. */
  readonly file: string;
  readonly dryRun: boolean;
  /** `true` when the `.lila` was saved. */
  readonly written: boolean;
  /** One line for a person: what was (or would be) done. */
  readonly summary: string;
  readonly notes: readonly string[];
}

export interface RenameLilaProcessRequest extends ManageTarget {
  /** Slug of the process. */
  readonly process: string;
  readonly name: string;
}

export interface RenameLilaProcessResult extends ManageResult {
  /** Slug of the process; a rename never changes it. */
  readonly process: string;
  readonly before: string;
  readonly after: string;
}

export interface DeleteLilaProcessRequest extends ManageTarget {
  /** Slug of the process. */
  readonly process: string;
}

export interface DeleteLilaProcessResult extends ManageResult {
  /** Slug of the deleted process. */
  readonly process: string;
  readonly name: string;
  /** The scenario entries that went with it. */
  readonly removedScenarios: readonly string[];
  /** The ids of the stored runs that went with it. */
  readonly removedRuns: readonly string[];
  /** Every slug of the project after the write (or, on a dry run, after it would be), in tab order. */
  readonly slugs: readonly string[];
}

export interface RenameLilaScenarioRequest extends ManageTarget {
  /** Slug of the process; implicit when the `.lila` holds one. */
  readonly process?: string | undefined;
  /** The scenario: its entry name (with or without `.scenario.json`) or its `"name"`. */
  readonly scenario: string;
  readonly name: string;
}

export interface RenameLilaScenarioResult extends ManageResult {
  /** Slug of the process, as it is in the file after the write. */
  readonly process: string;
  /** The entry name; a rename never changes it. */
  readonly entry: string;
  /** Its `"name"` before, or `null` when it had none. */
  readonly before: string | null;
  readonly after: string;
  /** Its revision after the write. */
  readonly revision: number;
}

export interface DeleteLilaScenarioRequest extends ManageTarget {
  /** Slug of the process; implicit when the `.lila` holds one. */
  readonly process?: string | undefined;
  /** The scenario: its entry name (with or without `.scenario.json`) or its `"name"`. */
  readonly scenario: string;
}

export interface DeleteLilaScenarioResult extends ManageResult {
  /** Slug of the process, as it is in the file after the write. */
  readonly process: string;
  readonly entry: string;
  /** The ids of the stored runs of the scenario, removed with it. */
  readonly removedRuns: readonly string[];
}

/** The name, trimmed; an empty one is refused. */
function newName(name: string, locale: Locale): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed === '') throw new Error(agentToolMessages(locale).manageEmptyName());
  return trimmed;
}

/** `input`'s project with `process` replaced by `change(process)`; the other processes unchanged. */
function withProcess(input: LilaProcess, change: (process: ProcessDocument) => ProcessDocument): ProjectDocument {
  return withProcesses(
    input.document,
    processesOf(input.document).map((p) => (p.slug === input.process.slug ? change(p) : p)),
  );
}

/** Writes `next` unless `dryRun`; returns the slug of `input`'s process as it is in the file then. */
async function save(input: LilaProcess, next: ProjectDocument, dryRun: boolean, locale: Locale): Promise<string> {
  if (dryRun) return input.process.slug;
  // #613: a one-process version 2 archive is written as version 1, and its slug follows its name.
  return lilaWritten(input, await writeLilaProject(input, next, locale)).slug;
}

/** Renames a process of `file` (see the header). Throws, writing nothing, on a refusal. */
export async function renameLilaProcess(request: RenameLilaProcessRequest): Promise<RenameLilaProcessResult> {
  const locale = request.locale ?? 'en';
  const T = agentToolMessages(locale);
  const dryRun = request.dryRun === true;
  const input = await openLilaProcess(request.file, { process: request.process, locale });
  if (input.slugs.length < 2) throw new Error(T.manageSingleProcess(input.file));
  const after = newName(request.name, locale);
  const before = input.process.name;
  const changed = after !== before;
  if (changed) await save(input, withProcess(input, (p) => ({ ...p, name: after })), dryRun, locale);
  return {
    file: input.file,
    dryRun,
    written: changed && !dryRun,
    process: input.process.slug,
    before,
    after,
    summary: changed ? T.processRenamed(dryRun, input.process.slug, before, after, input.file) : T.manageNoChange(),
    notes: [],
  };
}

/** `&amp;` and the other four XML entities, for a name read out of the XML by a pattern. */
function unescapeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}=(["'])(.*?)\\1`).exec(tag);
  return match === null ? undefined : unescapeXml(match[2]!);
}

/**
 * The call activities of `xml` whose `calledElement` is one of `ids`, as `id (name)`. A pattern over
 * the XML, as `processIds`: a `tns:Process_B` names `Process_B`, as on the app's double-click.
 */
function callersOf(xml: string, ids: readonly string[]): string[] {
  const callers: string[] = [];
  for (const [tag] of xml.matchAll(/<(?:[\w.-]+:)?callActivity\b[^>]*>/g)) {
    const target = attribute(tag, 'calledElement')?.trim() ?? '';
    if (target === '' || !(ids.includes(target) || ids.includes(target.slice(target.lastIndexOf(':') + 1)))) continue;
    const id = attribute(tag, 'id') ?? '';
    const name = attribute(tag, 'name')?.trim() ?? '';
    callers.push(name === '' ? id : `${id} (${name})`);
  }
  return callers;
}

/** Deletes a process of `file` with its scenarios and runs (see the header). Throws, writing nothing, on a refusal. */
export async function deleteLilaProcess(request: DeleteLilaProcessRequest): Promise<DeleteLilaProcessResult> {
  const locale = request.locale ?? 'en';
  const T = agentToolMessages(locale);
  const dryRun = request.dryRun === true;
  const input = await openLilaProcess(request.file, { process: request.process, locale });
  const deleted = input.process;
  if (input.slugs.length < 2) throw new Error(T.manageLastProcess(deleted.slug, input.file));
  const all = processesOf(input.document);
  const ids = processIds(deleted.model.xml);
  const callers = all
    .filter((p) => p.slug !== deleted.slug)
    .flatMap((p) => callersOf(p.model.xml, ids).map((caller) => `${p.slug}/${caller}`));
  if (callers.length > 0) throw new Error(T.manageProcessCalled(deleted.slug, callers.join(', ')));
  const rest = all.filter((p) => p.slug !== deleted.slug);
  const next = withProcesses(input.document, rest);
  if (!dryRun) await writeLilaProject(input, next, locale);
  // Down to one process the project is version 1, whose process is named after the project.
  const slugs = processesOf(next).map((p) => p.slug);
  const removedScenarios = Object.keys(deleted.scenarios).sort();
  const removedRuns = deleted.runs.map((run) => run.id);
  return {
    file: input.file,
    dryRun,
    written: !dryRun,
    process: deleted.slug,
    name: deleted.name,
    removedScenarios,
    removedRuns,
    slugs,
    summary: T.processDeleted(dryRun, deleted.slug, deleted.name, input.file, removedScenarios.length, removedRuns.length),
    notes: rest.length === 1 ? [T.manageOneProcessLeft(rest[0]!.name, slugs[0]!)] : [],
  };
}

/** The scenarios of `scenarios` whose `extends` is `entry`. */
function childrenOf(scenarios: ProcessDocument['scenarios'], entry: string): string[] {
  return Object.keys(scenarios)
    .sort()
    .filter((name) => {
      const parent = scenarios[name]?.['extends'];
      return name !== entry && typeof parent === 'string' && resolveScenarioPath(name, parent) === entry;
    });
}

/** `entry` and every scenario that extends it, directly or not. */
function withDescendants(scenarios: ProcessDocument['scenarios'], entry: string): Set<string> {
  const affected = new Set([entry]);
  const pending = [entry];
  while (pending.length > 0) {
    for (const child of childrenOf(scenarios, pending.pop()!)) {
      if (affected.has(child)) continue;
      affected.add(child);
      pending.push(child);
    }
  }
  return affected;
}

/** Renames a scenario of a process of `file` (see the header). Throws, writing nothing, on a refusal. */
export async function renameLilaScenario(request: RenameLilaScenarioRequest): Promise<RenameLilaScenarioResult> {
  const locale = request.locale ?? 'en';
  const T = agentToolMessages(locale);
  const dryRun = request.dryRun === true;
  const input = await openLilaProcess(request.file, { process: request.process, locale });
  const entry = findLilaScenario(input, request.scenario, locale);
  const after = newName(request.name, locale);
  const { scenarios, scenarioRevisions } = input.process;
  const own = scenarios[entry]!['name'];
  const before = typeof own === 'string' ? own : null;
  // Any other scenario `findLilaScenario` would find by this name: by its entry, or by its "name".
  const other = Object.keys(scenarios)
    .sort()
    .find((name) => name !== entry && (name === after || name === `${after}.scenario.json` || scenarios[name]?.['name'] === after));
  if (other !== undefined) throw new Error(T.manageScenarioNameTaken(after, other));
  const changed = after !== before;
  let slug = input.process.slug;
  let revision = scenarioRevisions[entry] ?? 0;
  if (changed) {
    const revisions = { ...scenarioRevisions };
    for (const name of withDescendants(scenarios, entry)) revisions[name] = (scenarioRevisions[name] ?? 0) + 1;
    revision = revisions[entry]!;
    const next = withProcess(input, (p) => ({
      ...p,
      scenarios: { ...p.scenarios, [entry]: { ...p.scenarios[entry], name: after } },
      scenarioRevisions: revisions,
    }));
    slug = await save(input, next, dryRun, locale);
  }
  return {
    file: input.file,
    dryRun,
    written: changed && !dryRun,
    process: slug,
    entry,
    before,
    after,
    revision,
    summary: changed ? T.scenarioRenamed(dryRun, entry, slug, after, input.file) : T.manageNoChange(),
    notes: [],
  };
}

/** Deletes a scenario of a process of `file` with its runs (see the header). Throws, writing nothing, on a refusal. */
export async function deleteLilaScenario(request: DeleteLilaScenarioRequest): Promise<DeleteLilaScenarioResult> {
  const locale = request.locale ?? 'en';
  const T = agentToolMessages(locale);
  const dryRun = request.dryRun === true;
  const input = await openLilaProcess(request.file, { process: request.process, locale });
  const entry = findLilaScenario(input, request.scenario, locale);
  const { scenarios } = input.process;
  if (Object.keys(scenarios).length < 2) throw new Error(T.manageLastScenario(entry, input.process.slug));
  const children = childrenOf(scenarios, entry);
  if (children.length > 0) throw new Error(T.manageScenarioExtended(entry, children.join(', ')));
  const removedRuns = input.process.runs.filter((run) => run.scenarioName === entry).map((run) => run.id);
  const next = withProcess(input, (p) => {
    const { [entry]: _scenario, ...kept } = p.scenarios;
    const { [entry]: _revision, ...revisions } = p.scenarioRevisions;
    return { ...p, scenarios: kept, scenarioRevisions: revisions, runs: p.runs.filter((run) => run.scenarioName !== entry) };
  });
  const slug = await save(input, next, dryRun, locale);
  return {
    file: input.file,
    dryRun,
    written: !dryRun,
    process: slug,
    entry,
    removedRuns,
    summary: T.scenarioDeleted(dryRun, entry, slug, input.file, removedRuns.length),
    notes: entry === BASE_SCENARIO ? [T.manageBaseScenarioNote(entry)] : [],
  };
}
