/**
 * Stored runs (#538): the one definition of what a run saved in a project is and when it is
 * current, shared by the app (`apps/web/src/App.tsx`, which stores a run after each simulation)
 * and by agents (`lila run --save`, `run_simulation` with `saveRun`), so the two cannot drift.
 * Browser-safe: no `node:*`.
 *
 * There is no retention rule: the app keeps every run in the project (only the in-memory event
 * logs are capped, at ten), so these helpers append and never drop one.
 */
import type { RunResult } from '../core/result.js';
import { processesOf, withProcesses } from './repository.js';
import type { ProcessDocument, ProjectDocument, StoredRun } from './types.js';

export interface StoredRunInput {
  readonly id: string;
  /** The scenario's entry name in the process (`as-is.scenario.json`). */
  readonly scenarioName: string;
  readonly result: RunResult;
  /** The model XML that ran. */
  readonly xml: string;
  /** The resolved scenario that ran (with `model` and `run`), as plain JSON. */
  readonly scenario: Readonly<Record<string, unknown>>;
  /** The model and scenario revisions the run was taken on. */
  readonly modelRevision: number;
  readonly scenarioRevision: number;
}

/** A run as the project stores it. */
export function storedRun(input: StoredRunInput): StoredRun {
  return {
    id: input.id,
    scenarioName: input.scenarioName,
    result: input.result,
    inputs: {
      modelRevision: input.modelRevision,
      scenarioRevision: input.scenarioRevision,
      xml: input.xml,
      scenario: input.scenario as StoredRun['inputs']['scenario'],
    },
  };
}

/**
 * Whether `run` is of the model and scenario as they are now: the run the app shows for its
 * scenario. A run of an older revision of either is stale.
 */
export function isCurrentRun(
  run: StoredRun,
  modelRevision: number,
  scenarioRevisions: Readonly<Record<string, number>>,
): boolean {
  return run.inputs.modelRevision === modelRevision && run.inputs.scenarioRevision === (scenarioRevisions[run.scenarioName] ?? 0);
}

/** `document` with `run` appended to the runs of its process `slug`; every other part unchanged. */
export function withStoredRun(document: ProjectDocument, slug: string, run: StoredRun): ProjectDocument {
  const processes = processesOf(document);
  if (!processes.some((p) => p.slug === slug)) throw new RangeError(`no process "${slug}" in the project.`);
  return withProcesses(
    document,
    processes.map((p): ProcessDocument => (p.slug === slug ? { ...p, runs: [...p.runs, run] } : p)),
  );
}
