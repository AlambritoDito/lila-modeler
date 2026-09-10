/**
 * `@lila/engine/project`: the project document contract (ADR-018) and the `.lila` container
 * (ADR-027), shared by `apps/web`, `apps/desktop` and anything else that reads a Lila project.
 */
export type { ProjectDocument, ProjectProblem, ScenarioDocument, StoredRun } from './types.js';
export { ProjectFormatError, readProjectDocument, runProblem } from './document.js';
export type { ProjectErrorCode } from './document.js';
export { decodeLila, encodeLila, lilaEntryNames } from './lila.js';
