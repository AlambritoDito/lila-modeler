/**
 * Structural validation of a `ProjectDocument`, moved here from `apps/web/src/project.ts`
 * (`readProject`) so that the browser store, the desktop folder reader and the `.lila` container
 * all agree on what a project is. Messages are English and every failure carries a stable
 * `code`, so `apps/web` can keep showing its own localized wording without parsing text.
 *
 * Deliberately shallow where the format is deliberately loose: a `*.scenario.json` may hold a
 * draft that does not validate yet, so scenarios are only required to be JSON objects. Runs are
 * the opposite — a stored run is an engine output plus the inputs that produced it, and both are
 * validated in full: a run nobody can replay is worse than a run that is not there.
 */
import { ScenarioSchema } from '../scenario.js';
import { runResultSchema } from '../result.schema.js';
import { isProcessSlug, processesOf } from './repository.js';
import type { ProjectDocument } from './types.js';

/**
 * Stable codes so the UI can localize without matching on the message. The `LILA-` prefix and not
 * the `E-` of the rest of the app on purpose: `E-`/`W-` is the namespace of the engine's
 * *localized* problem catalog (`messages/`), and `messages.test.ts` sweeps `packages/engine/src`
 * to prove nothing invents a code outside it. These are not user-facing messages — they are the
 * seam that lets each front end pick its own wording. `apps/desktop` maps them back to its own
 * `E-…` shape at the IPC boundary (`lilaFile.ts`).
 */
export type ProjectErrorCode =
  | 'LILA-DOCUMENT'
  | 'LILA-PROBLEMS'
  | 'LILA-RUN'
  | 'LILA-RUN-INPUTS'
  | 'LILA-ENTRY-PATH'
  | 'LILA-ZIP'
  | 'LILA-NO-MANIFEST'
  | 'LILA-MANIFEST'
  | 'LILA-NO-MODEL';

export class ProjectFormatError extends Error {
  constructor(
    public readonly code: ProjectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectFormatError';
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Checks one `runs/*.result.json`. Returns `null` when it is valid, or the reason why not —
 * callers that read a container (folder or zip) turn that reason into a `problems` entry instead
 * of refusing to open the project, exactly like an unreadable scenario.
 */
export function runProblem(run: unknown): ProjectFormatError | null {
  if (
    !isPlainObject(run) ||
    typeof run.id !== 'string' ||
    typeof run.scenarioName !== 'string' ||
    !isPlainObject(run.inputs) ||
    !isRevision(run.inputs.modelRevision) ||
    !isRevision(run.inputs.scenarioRevision) ||
    typeof run.inputs.xml !== 'string' ||
    !isPlainObject(run.inputs.scenario) ||
    !runResultSchema.safeParse(run.result).success
  ) {
    return new ProjectFormatError('LILA-RUN', 'a stored run has an invalid shape (id/scenarioName/inputs/result).');
  }
  const scenario = ScenarioSchema.safeParse(run.inputs.scenario);
  if (!scenario.success || scenario.data.model === undefined || scenario.data.run === undefined) {
    return new ProjectFormatError('LILA-RUN-INPUTS', 'a stored run keeps inputs that no longer describe a runnable scenario.');
  }
  return null;
}

/** The four fields a process carries, whether top-level or in `processes` (ADR-029). */
function isProcessContent(value: Record<string, unknown>): boolean {
  return (
    isPlainObject(value.model) &&
    typeof value.model.id === 'string' &&
    typeof value.model.name === 'string' &&
    typeof value.model.xml === 'string' &&
    isRevision(value.model.revision) &&
    isPlainObject(value.scenarios) &&
    Object.values(value.scenarios).every(isPlainObject) &&
    isPlainObject(value.scenarioRevisions) &&
    Object.values(value.scenarioRevisions).every(isRevision) &&
    Array.isArray(value.runs)
  );
}

/** `process` and `processes` of a repository document (ADR-029): shapes and unique slugs. */
function hasValidProcesses(value: Record<string, unknown>): boolean {
  if (value.process !== undefined) {
    if (!isPlainObject(value.process) || !isProcessSlug(value.process.slug) || typeof value.process.name !== 'string') {
      return false;
    }
  }
  if (value.processes === undefined) return true;
  if (!Array.isArray(value.processes)) return false;
  if (!value.processes.every((p) => isPlainObject(p) && isProcessSlug(p.slug) && typeof p.name === 'string' && isProcessContent(p))) {
    return false;
  }
  const slugs = processesOf(value as unknown as ProjectDocument).map((p) => p.slug);
  return new Set(slugs).size === slugs.length;
}

/** Structural validation; scenarios may hold drafts that do not validate yet. */
export function readProjectDocument(value: unknown): ProjectDocument {
  if (
    !isPlainObject(value) ||
    value.version !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isProcessContent(value) ||
    !hasValidProcesses(value)
  ) {
    throw new ProjectFormatError('LILA-DOCUMENT', 'the value is not a Lila project document.');
  }
  if (
    value.problems !== undefined &&
    (!Array.isArray(value.problems) ||
      !value.problems.every((p) => isPlainObject(p) && typeof p.file === 'string' && typeof p.message === 'string'))
  ) {
    throw new ProjectFormatError('LILA-PROBLEMS', 'the project diagnostics have an invalid shape.');
  }
  for (const process of processesOf(value as unknown as ProjectDocument)) {
    for (const run of process.runs) {
      const problem = runProblem(run);
      if (problem !== null) throw problem;
    }
  }
  return value as unknown as ProjectDocument;
}
