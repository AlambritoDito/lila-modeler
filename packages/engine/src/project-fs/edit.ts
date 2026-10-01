/**
 * `editBpmn` (#98) on one process of a `.lila`: what `edit_process` (MCP) and `lila process edit`
 * (CLI) do. The model is edited all or none, the durations, resources and probabilities the
 * operations give go into its base scenario `as-is.scenario.json`, and the archive is written
 * through `writeLilaProject` (cross-process lock, refused if the file changed since it was read).
 * Every other process, scenario and run is carried through unchanged.
 *
 * After an edit the process still simulates. Scenario entries that no longer apply — those of an
 * element the edit removed, and the fields a retyped element can no longer take (a duration on a
 * gateway, resources on a sub-process…) — are removed from every scenario of the process and
 * reported one by one with their previous values (`scenarioRemovals`), so nothing goes silently.
 * Then every scenario is resolved and validated against the edited model: an error it did not have
 * before refuses the edit.
 */
import { parseBpmn } from '../bpmn/parse.js';
import { bpmnToOutline, type NormalOutline } from '../bpmn/outline.js';
import { editBpmn, EditError, type EditChange, type EditIssue } from '../bpmn/edit.js';
import type { ValidationResult } from '../bpmn/validate.js';
import type { ProcessIR } from '../core/ir.js';
import { messages, type Locale } from '../messages/index.js';
import { processesOf, withProcesses, type ProcessDocument, type ScenarioDocument } from '../project/index.js';
import { parseScenario, resolveExtends, validateScenario } from '../scenario.js';
import { lilaScenarioPath, lilaScenarioReader, openLilaProcess, writeLilaProject, type LilaProcess } from './input.js';
import { BASE_SCENARIO } from './outline.js';

export interface EditLilaProcessOptions {
  /** Slug of the process; implicit when the `.lila` holds one. */
  process?: string | undefined;
  /** Check and build everything, write nothing. */
  dryRun?: boolean | undefined;
  /** `true` (default): lay the process out again. `false`: keep positions, place only what is new. */
  layout?: boolean | undefined;
  locale?: Locale | undefined;
}

/** One scenario entry the edit removed because it no longer applies to the model. */
export interface ScenarioRemoval {
  /** Entry name of the scenario, e.g. `as-is.scenario.json`. */
  readonly scenario: string;
  /** The element (or flow) id it was keyed on. */
  readonly id: string;
  /** The fields removed, with their previous values: the whole entry when the element is gone. */
  readonly removed: Readonly<Record<string, unknown>>;
  /** `true` when the whole `elements.<id>` entry went, `false` when only some of its fields. */
  readonly entry: boolean;
}

export interface EditedLilaProcess {
  /** Absolute path of the `.lila`, `/`-separated. */
  readonly file: string;
  readonly slug: string;
  readonly name: string;
  readonly dryRun: boolean;
  /** One line for a person: what was (or would be) edited where. */
  readonly summary: string;
  /** What each operation did, in order (`op` is its index). */
  readonly changes: readonly EditChange[];
  /** Every id removed from the model. */
  readonly removed: readonly string[];
  /** Scenario entries removed because they no longer apply, with their previous values. */
  readonly scenarioRemovals: readonly ScenarioRemoval[];
  /** Things worth a look: each scenario removal, branch probabilities that no longer add up. */
  readonly notes: readonly string[];
  /** Validator warnings on the edited model. */
  readonly warnings: ValidationResult['warnings'];
  /** The process after the edit, as an outline (normal form). */
  readonly outline: NormalOutline;
}

type Elements = Record<string, Record<string, unknown>>;

const elementsOf = (scenario: ScenarioDocument): Elements =>
  ((scenario as { elements?: Elements }).elements ?? {}) as Elements;

/** Codes of a scenario field that does not apply to its element's (new) type. */
const NOT_APPLICABLE = new Set(['E-CAMPO-NO-APLICA', 'E-SUBPROC-PARAMETRO', 'E-TIMER-RECURSO', 'E-PROB-EN-NODO', 'E-RESERVADO', 'E-ELEMENTO-DESCONOCIDO']);

/**
 * The fields of `entry` (the scenario entry of `id`) that the element `id` of `ir` can no longer
 * take, found with the scenario validator itself on a scenario that holds only this entry (and
 * the process's resources and calendars, so references resolve). `null` means the whole entry.
 */
function inapplicable(id: string, entry: Record<string, unknown>, ir: ProcessIR, context: Record<string, unknown>): string[] | null {
  const fields = new Set<string>();
  let current = { ...entry };
  for (let round = 0; round < 3; round++) {
    const parsed = parseScenario({ ...context, elements: { [id]: current } });
    if (!parsed.success) return [...fields];
    let found = false;
    for (const problem of validateScenario(parsed.data, ir)) {
      if (problem.severity !== 'error' || !NOT_APPLICABLE.has(problem.code)) continue;
      if (problem.path === `elements.${id}`) return null;
      if (!problem.path.startsWith(`elements.${id}.`)) continue;
      const field = /^([A-Za-z]+)/.exec(problem.path.slice(`elements.${id}.`.length))?.[1];
      if (field === undefined || !(field in current)) continue;
      fields.add(field);
      found = true;
    }
    if (!found) break;
    current = Object.fromEntries(Object.entries(current).filter(([k]) => !fields.has(k)));
  }
  return [...fields];
}

interface ScenarioError {
  scenario: string;
  path: string;
  code: string;
  message: string;
}

/** Errors of every scenario of `process` (resolved through `extends`) against `ir`, keyed `name\0code\0path`. */
function scenarioErrors(input: LilaProcess, process: ProcessDocument, ir: ProcessIR, locale: Locale): Map<string, ScenarioError> {
  const view: LilaProcess = { ...input, process };
  const read = lilaScenarioReader(
    view,
    () => {
      throw new Error('outside the .lila');
    },
    locale,
  );
  const out = new Map<string, ScenarioError>();
  for (const name of Object.keys(process.scenarios)) {
    let resolved: Record<string, unknown>;
    try {
      resolved = resolveExtends(lilaScenarioPath(view, name), read);
    } catch {
      continue; // a scenario that cannot be read is not this edit's doing
    }
    const parsed = parseScenario(resolved, { locale });
    if (!parsed.success) continue;
    for (const p of validateScenario(parsed.data, ir, { locale })) {
      if (p.severity === 'error') out.set(`${name}\0${p.code}\0${p.path}`, { scenario: name, path: p.path, code: p.code, message: p.message });
    }
  }
  return out;
}

/**
 * Applies `operations` to one process of `file` (see `editBpmn` and the header). Throws
 * `EditError` when an operation is wrong, the model would not validate or a scenario would not
 * simulate, and `Error` with a catalog message for everything else (no file, unknown process, the
 * file changed meanwhile); nothing is written.
 */
export async function editLilaProcess(file: string, operations: unknown, options: EditLilaProcessOptions = {}): Promise<EditedLilaProcess> {
  const locale = options.locale ?? 'en';
  const C = messages(locale).cli;
  const input = await openLilaProcess(file, { process: options.process, locale });
  const current = input.process;
  const base = current.scenarios[BASE_SCENARIO];
  // #546: the process its scenarios target is the one edited, checked and read back.
  const simulated = (await parseBpmn(current.model.xml, { scenarios: Object.values(current.scenarios) })).ir;
  const edit = await editBpmn(current.model.xml, operations, {
    locale,
    layout: options.layout,
    scenario: base,
    scenarioName: BASE_SCENARIO,
    processId: simulated.id,
  });

  // Scenario entries that no longer apply go, each one reported with what it held.
  const ir = (await parseBpmn(edit.xml, { scenarios: Object.values(current.scenarios) })).ir;
  const scenarios: Record<string, ScenarioDocument> = {
    ...current.scenarios,
    ...(edit.scenario === undefined ? {} : { [BASE_SCENARIO]: edit.scenario }),
  };
  const context: Record<string, unknown> = {
    version: 1,
    name: 'check',
    run: { start: '2026-01-01T00:00:00Z', duration: 3600, warmup: 0, replications: 1, seed: 1, baseTimeUnit: 'min' },
    resources: Object.assign({}, ...Object.values(scenarios).map((s) => (s as { resources?: object }).resources ?? {})),
    calendars: Object.assign({}, ...Object.values(scenarios).map((s) => (s as { calendars?: object }).calendars ?? {})),
  };
  const removed = new Set(edit.removed);
  const scenarioRemovals: ScenarioRemoval[] = [];
  const changedScenarios = new Set<string>(edit.scenario === undefined ? [] : [BASE_SCENARIO]);
  for (const [name, scenario] of Object.entries(scenarios)) {
    const elements = elementsOf(scenario);
    let next: Elements | undefined;
    for (const [id, entry] of Object.entries(elements)) {
      let fields: string[] | null = [];
      if (removed.has(id)) fields = null;
      else if (edit.retyped.includes(id)) fields = inapplicable(id, entry, ir, context);
      if (fields !== null && fields.length === 0) continue;
      next ??= { ...elements };
      if (fields === null || fields.length === Object.keys(entry).length) {
        delete next[id];
        scenarioRemovals.push({ scenario: name, id, removed: entry, entry: true });
      } else {
        const gone = fields;
        next[id] = Object.fromEntries(Object.entries(entry).filter(([k]) => !gone.includes(k)));
        scenarioRemovals.push({ scenario: name, id, removed: Object.fromEntries(gone.map((k) => [k, entry[k]])), entry: false });
      }
    }
    if (next !== undefined) {
      scenarios[name] = { ...scenario, elements: next } as ScenarioDocument;
      changedScenarios.add(name);
    }
  }

  const scenarioRevisions = { ...current.scenarioRevisions };
  for (const name of changedScenarios) scenarioRevisions[name] = (current.scenarioRevisions[name] ?? 0) + 1;
  const edited: ProcessDocument = {
    ...current,
    model: { ...current.model, xml: edit.xml, revision: current.model.revision + 1 },
    scenarios,
    scenarioRevisions,
  };

  // The process must still simulate: no scenario may get an error it did not have.
  const before = scenarioErrors(input, current, simulated, locale);
  const after = scenarioErrors(input, edited, ir, locale);
  const fresh = [...after].filter(([key]) => !before.has(key)).map(([, p]) => p);
  if (fresh.length > 0) {
    const count = Array.isArray(operations) ? operations.length : 0;
    const issues: EditIssue[] = fresh.map((p) => {
      const id = /^elements\.([^.[]+)/.exec(p.path)?.[1];
      return {
        op: (id === undefined ? undefined : edit.touched.get(id)) ?? (count === 1 ? 0 : null),
        path: `scenarios["${p.scenario}"].${p.path}`,
        message: `${p.code}: ${p.message}`,
      };
    });
    const line = (i: EditIssue): string => `  ${i.op === null ? '' : `operations[${i.op}].`}${i.path}: ${i.message}`;
    throw new EditError(C.editScenarioBroken(issues.map(line).join('\n')), issues);
  }

  const next = withProcesses(
    input.document,
    processesOf(input.document).map((p) => (p.slug === current.slug ? edited : p)),
  );
  const dryRun = options.dryRun === true;
  if (!dryRun) await writeLilaProject(input, next, locale);
  const count = Array.isArray(operations) ? operations.length : 0;
  const notes = [...edit.notes, ...scenarioRemovals.map((r) => C.editScenarioRemoved(r.scenario, r.id, JSON.stringify(r.removed)))];
  const { outline } = await bpmnToOutline(edit.xml, { scenario: scenarios[BASE_SCENARIO], locale, processId: ir.id });
  return {
    file: input.file,
    slug: current.slug,
    name: current.name,
    dryRun,
    summary: (dryRun ? C.processEditDryRun : C.processEdited)(current.name, current.slug, input.file, count, edit.removed.length),
    changes: edit.changes,
    removed: edit.removed,
    scenarioRemovals,
    notes,
    warnings: edit.warnings,
    outline,
  };
}
