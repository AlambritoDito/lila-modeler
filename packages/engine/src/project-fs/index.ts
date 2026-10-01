/**
 * `@lila-modeler/engine/project-fs`: the project on disk (#466), Node only. The folder reader and
 * writer (ADR-018, ADR-029), the `.lila` file (ADR-027) and the `.lila`-as-input helpers of the CLI
 * and MCP server. It moved here from `apps/desktop` so the desktop, the CLI and the MCP server
 * share one implementation.
 *
 * `@lila-modeler/engine/project` stays the browser-safe half (the document contract and the
 * in-memory codec, which the web app bundles); nothing in this subpath may be imported from there.
 */
export {
  assertNotAnotherProject,
  assertPathsUnchanged,
  hasProjectModel,
  isOwnSnapshot,
  isRecordableProject,
  occupiedSlugs,
  ProjectIOError,
  readProjectFolder,
  rememberSnapshot,
  writeProjectFolder,
} from './projectIO.js';
export type { WriteProjectFsImpl, WriteProjectOptions } from './projectIO.js';
export { readLilaFile, withLilaLock, writeLilaFile } from './lilaFile.js';
export type { WriteLilaOptions } from './lilaFile.js';
export { isLilaPath, isMiscasedModelFile, isSymlink } from './paths.js';
export {
  findLilaScenario,
  lilaScenarioEntryName,
  lilaScenarioPath,
  lilaScenarioReader,
  openLilaProcess,
  writeLilaProject,
  writeLilaScenario,
} from './input.js';
export type { LilaProcess, LilaSnapshot } from './input.js';
export {
  exportDiagram,
  exportDocument,
  exportResults,
  writeExportDirectory,
  writeExportFile,
} from './exports.js';
export type { DocumentExport, ExportedRun, ExportSource, ResultsExport, RunSelection, WriteExportOptions } from './exports.js';
export { saveLilaRun, saveSimulationRun } from './save-run.js';
export type { SavedRun } from './save-run.js';
export { BASE_SCENARIO, createLilaProcess, readLilaOutline } from './outline.js';
export type { CreatedLilaProcess, CreateLilaProcessOptions, LilaOutline } from './outline.js';
