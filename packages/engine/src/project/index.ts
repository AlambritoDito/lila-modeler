/**
 * `@lila-modeler/engine/project`: the project document contract (ADR-018) and the `.lila` container
 * (ADR-027), shared by `apps/web`, `apps/desktop` and anything else that reads a Lila project.
 */
export type { ProcessDocument, ProjectDocument, ProjectModel, ProjectProblem, ScenarioDocument, StoredRun } from './types.js';
export { isProcessSlug, processesOf, processSlug, withProcesses } from './repository.js';
export { ProjectFormatError, readProjectDocument, runProblem } from './document.js';
export type { ProjectErrorCode } from './document.js';
export { decodeLila, encodeLila, lilaEntryNames, readRepositoryManifest, repositoryManifestOf } from './lila.js';
export type { ProcessManifest, RepositoryManifest } from './lila.js';
export { isCurrentRun, storedRun, withStoredRun } from './runs.js';
export type { StoredRunInput } from './runs.js';
