/**
 * `editBpmn` (#98) on one process of a `.lila`: what `edit_process` (MCP) and `lila process edit`
 * (CLI) do. The model is edited all or none, the durations, resources and probabilities the
 * operations give go into its base scenario `as-is.scenario.json`, and the archive is written
 * through `writeLilaProject` (cross-process lock, refused if the file changed since it was read).
 * Every other process, scenario and run is carried through unchanged.
 */
import { bpmnToOutline, type NormalOutline } from '../bpmn/outline.js';
import { editBpmn, type EditChange } from '../bpmn/edit.js';
import type { ValidationResult } from '../bpmn/validate.js';
import { messages, type Locale } from '../messages/index.js';
import { processesOf, withProcesses, type ProcessDocument } from '../project/index.js';
import { openLilaProcess, writeLilaProject } from './input.js';
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
  /** Scenarios that still have entries for removed ids (they are kept, not deleted). */
  readonly scenarioEntries: readonly { readonly scenario: string; readonly ids: readonly string[] }[];
  /** Things worth a look: kept scenario entries, branch probabilities that no longer add up. */
  readonly notes: readonly string[];
  /** Validator warnings on the edited model. */
  readonly warnings: ValidationResult['warnings'];
  /** The process after the edit, as an outline (normal form). */
  readonly outline: NormalOutline;
}

/**
 * Applies `operations` to one process of `file` (see `editBpmn`). Throws `EditError` when an
 * operation is wrong or the result would not validate, and `Error` with a catalog message for
 * everything else (no file, unknown process, the file changed meanwhile); nothing is written.
 */
export async function editLilaProcess(file: string, operations: unknown, options: EditLilaProcessOptions = {}): Promise<EditedLilaProcess> {
  const locale = options.locale ?? 'en';
  const C = messages(locale).cli;
  const input = await openLilaProcess(file, { process: options.process, locale });
  const current = input.process;
  const base = current.scenarios[BASE_SCENARIO];
  const edit = await editBpmn(current.model.xml, operations, {
    locale,
    layout: options.layout,
    scenario: base,
    scenarioName: BASE_SCENARIO,
  });

  const scenarioEntries: { scenario: string; ids: string[] }[] = [];
  const scenarios = { ...current.scenarios, ...(edit.scenario === undefined ? {} : { [BASE_SCENARIO]: edit.scenario }) };
  for (const [name, scenario] of Object.entries(scenarios)) {
    const elements = ((scenario as { elements?: Record<string, unknown> }).elements ?? {}) as Record<string, unknown>;
    const ids = edit.removed.filter((id) => elements[id] !== undefined);
    if (ids.length > 0) scenarioEntries.push({ scenario: name, ids });
  }
  const notes = [...edit.notes, ...scenarioEntries.map((e) => C.editScenarioEntries(e.scenario, e.ids.join(', ')))];

  const edited: ProcessDocument = {
    ...current,
    model: { ...current.model, xml: edit.xml, revision: current.model.revision + 1 },
    scenarios,
    scenarioRevisions:
      edit.scenario === undefined
        ? current.scenarioRevisions
        : { ...current.scenarioRevisions, [BASE_SCENARIO]: (current.scenarioRevisions[BASE_SCENARIO] ?? 0) + 1 },
  };
  const next = withProcesses(
    input.document,
    processesOf(input.document).map((p) => (p.slug === current.slug ? edited : p)),
  );

  const dryRun = options.dryRun === true;
  if (!dryRun) await writeLilaProject(input, next, locale);
  const count = Array.isArray(operations) ? operations.length : 0;
  const { outline } = await bpmnToOutline(edit.xml, { scenario: scenarios[BASE_SCENARIO], locale });
  return {
    file: input.file,
    slug: current.slug,
    name: current.name,
    dryRun,
    summary: (dryRun ? C.processEditDryRun : C.processEdited)(current.name, current.slug, input.file, count, edit.removed.length),
    changes: edit.changes,
    removed: edit.removed,
    scenarioEntries,
    notes,
    warnings: edit.warnings,
    outline,
  };
}
