/**
 * What a `.lila` holds, read without writing anything (#628): the inventory of the project
 * (`get_project`, `lila project show`) and one scenario as stored or resolved, with what the
 * validator says of it (`get_scenario`, `lila scenario show`). An agent sees the processes,
 * scenarios and runs here instead of finding them through the errors of other tools, and reads a
 * scenario without patching it (#627).
 *
 * Nothing here writes: the file is read once and decoded with the engine's own codec. A run is
 * current or stale by `isCurrentRun`, the rule `export_results` and the app use.
 */
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

import { parseBpmn, type AttributeDefinition } from '../bpmn/index.js';
import { comparablePath, validatedModelOf } from '../cli-shared.js';
import { messages, type Locale } from '../messages/index.js';
import { isCurrentRun, type StoredRun } from '../project/index.js';
import type { ScenarioDocument } from '../project/index.js';
import { checkScenario, type LilaTarget } from './agent-tools.js';
import { attributeDefinitionsOf } from './attributes.js';
import { findLilaScenario, lilaScenarioPath, lilaScenarioReader, openLilaProcess, openLilaProject, type LilaProcess } from './input.js';

export interface LilaScenarioSummary {
  /** The entry name, `as-is.scenario.json`. */
  readonly entry: string;
  /** Its `"name"`, or `null` when it has none. */
  readonly name: string | null;
  /** Goes up by one with every save of the scenario; a run of an older revision is stale. */
  readonly revision: number;
  /** The scenario it inherits from, or `null`. */
  readonly extends: string | null;
}

export interface LilaRunSummary {
  readonly id: string;
  /** The entry name of the scenario it ran. */
  readonly scenario: string;
  /**
   * The simulated start (`run.start` of the scenario it ran). A `.lila` keeps no wall-clock date
   * of when a run was taken.
   */
  readonly start: string | null;
  /** The replications the run completed. */
  readonly replications: number;
  /** `false`: the model or the scenario changed after this run (stale). */
  readonly current: boolean;
}

export interface LilaProcessSummary {
  readonly slug: string;
  readonly name: string;
  /** The id of the `bpmn:process` the project simulates. */
  readonly processId: string;
  readonly modelRevision: number;
  /** Flow nodes of the process (tasks, events, gateways); `null` when the model cannot be read. */
  readonly elements: number | null;
  readonly scenarios: readonly LilaScenarioSummary[];
  readonly runs: readonly LilaRunSummary[];
  /**
   * The extended attributes the process defines (#633), what `annotate_element` can fill in;
   * `null` when the model cannot be read back whole (some Bizagi exports).
   */
  readonly attributes: readonly AttributeDefinition[] | null;
}

export interface LilaProjectInventory {
  readonly file: string;
  readonly name: string;
  /** The layout on disk: 2 for a repository (`processes/<slug>/`), 1 otherwise. */
  readonly formatVersion: 1 | 2;
  readonly processes: readonly LilaProcessSummary[];
}

function runSummary(lila: LilaProcess, run: StoredRun): LilaRunSummary {
  const start = (run.inputs.scenario as { run?: { start?: unknown } }).run?.start;
  return {
    id: run.id,
    scenario: run.scenarioName,
    start: typeof start === 'string' ? start : null,
    // What ran: a result keeps its replication summary only above one.
    replications: run.result.replications?.count ?? 1,
    current: isCurrentRun(run, lila.process.model.revision, lila.process.scenarioRevisions),
  };
}

async function elementCount(lila: LilaProcess): Promise<number | null> {
  try {
    // #546: the process its scenarios target, the one that runs.
    const { ir } = await parseBpmn(lila.process.model.xml, { scenarios: Object.values(lila.process.scenarios) });
    return Object.keys(ir.nodes).length;
  } catch {
    return null;
  }
}

/** The inventory of a `.lila` (#628): its processes, their scenarios and their stored runs. */
export async function lilaProjectInventory(target: Omit<LilaTarget, 'process'>): Promise<LilaProjectInventory> {
  const project = await openLilaProject(target.file, { locale: target.locale });
  const processes: LilaProcessSummary[] = [];
  for (const lila of project.processes) {
    const { process } = lila;
    processes.push({
      slug: process.slug,
      name: process.name,
      processId: process.model.id,
      modelRevision: process.model.revision,
      elements: await elementCount(lila),
      scenarios: Object.keys(process.scenarios).sort().map((entry): LilaScenarioSummary => {
        const scenario = process.scenarios[entry] as ScenarioDocument & { name?: unknown; extends?: unknown };
        return {
          entry,
          name: typeof scenario.name === 'string' ? scenario.name : null,
          revision: process.scenarioRevisions[entry] ?? 0,
          extends: typeof scenario.extends === 'string' ? scenario.extends : null,
        };
      }),
      runs: process.runs.map((run) => runSummary(lila, run)),
      attributes: await attributeDefinitionsOf(process.model.xml),
    });
  }
  return { file: project.file, name: project.document.name, formatVersion: project.formatVersion, processes };
}

export interface LilaScenarioView {
  readonly file: string;
  readonly process: string;
  readonly entry: string;
  readonly revision: number;
  /** `true`: `scenario` is resolved through `extends`, with the defaults the engine applies. */
  readonly resolved: boolean;
  /**
   * The scenario as stored in the archive, or resolved: the object `patch_scenario` patches, with
   * `model` relative to the scenario as it is stored. `null` when resolution failed (see `notes`).
   */
  readonly scenario: Record<string, unknown> | null;
  /** `false` when `notes` has an error: `run_simulation` would refuse it. */
  readonly runnable: boolean;
  /** The validator against the process model: errors (`E-…`) first, then warnings (`W-…`). */
  readonly notes: readonly string[];
}

/**
 * One scenario of a process of a `.lila` (#628), as stored or `resolved`, plus the validator's
 * notes against that process's model, the checks `run_simulation` makes before it simulates.
 */
export async function lilaScenarioView(
  target: LilaTarget & { readonly scenario: string; readonly resolved?: boolean | undefined },
): Promise<LilaScenarioView> {
  const locale = target.locale ?? 'en';
  const lila = await openLilaProcess(target.file, { process: target.process, locale });
  const entry = findLilaScenario(lila, target.scenario, locale);
  const path = lilaScenarioPath(lila, entry);
  const read = lilaScenarioReader(lila, (file) => JSON.parse(readFileSync(file, 'utf8')) as unknown, locale);
  let model: Awaited<ReturnType<typeof validatedModelOf>>;
  try {
    model = await validatedModelOf({ path: lila.modelPath, xml: lila.process.model.xml, lila }, locale, [
      lila.process.scenarios[entry]!,
    ]);
  } catch (error) {
    // #645: a `model.bpmn` that does not parse leaves nothing to check the scenario against; it is
    // a note of a scenario that cannot run, not a failure of the read.
    return {
      file: lila.file,
      process: lila.process.slug,
      entry,
      revision: lila.process.scenarioRevisions[entry] ?? 0,
      resolved: target.resolved === true,
      scenario: target.resolved === true ? null : (lila.process.scenarios[entry] as Record<string, unknown>),
      runnable: false,
      notes: [messages(locale).mcp.modelInvalid(error instanceof Error ? error.message : String(error))],
    };
  }
  const check = checkScenario(path, read, model.ir, { locale, elsewhere: model.elsewhere });
  const modelErrors = model.validation.errors.map((problem) => `${problem.code}: ${problem.message}`);
  // In a `.lila` the model is the process's own `model.bpmn`, as `run_simulation` requires.
  const mismatch =
    check.scenario !== undefined && comparablePath(check.scenario.model) !== comparablePath(lila.modelPath)
      ? [messages(locale).mcp.modelMismatch(lila.modelPath, check.scenario.model)]
      : [];
  const errors = [...modelErrors, ...mismatch, ...check.errors];
  const relative = (scenario: Record<string, unknown>): Record<string, unknown> =>
    typeof scenario['model'] === 'string' && scenario['model'].startsWith(`${lila.file}/`)
      ? { ...scenario, model: posix.relative(posix.dirname(path), scenario['model']) }
      : scenario;
  const resolved = target.resolved === true;
  const shown = !resolved
    ? (lila.process.scenarios[entry] as Record<string, unknown>)
    : check.scenario !== undefined
      ? relative(check.scenario as unknown as Record<string, unknown>)
      : check.merged !== undefined
        ? relative(check.merged)
        : null;
  return {
    file: lila.file,
    process: lila.process.slug,
    entry,
    revision: lila.process.scenarioRevisions[entry] ?? 0,
    resolved,
    scenario: shown,
    runnable: errors.length === 0,
    notes: [...errors, ...check.warnings],
  };
}
