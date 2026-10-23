/**
 * `@lila-modeler/engine/project`: the project document contract (ADR-018) and the `.lila` container
 * (ADR-027), shared by `apps/web`, `apps/desktop` and anything else that reads a Lila project.
 */
export type { ProcessDocument, ProjectDocument, ProjectModel, ProjectProblem, ScenarioDocument, StoredRun } from './types.js';
export { isProcessSlug, processesOf, processIds, processSlug, withProcesses } from './repository.js';
export { ProjectFormatError, readProjectDocument, runProblem } from './document.js';
export type { ProjectErrorCode } from './document.js';
export { checkLimits, decodeLila, decodeLilaArchive, encodeLila, lilaEntryNames, readLilaPreserved, readRepositoryManifest, repositoryManifestOf, version3ManifestOf } from './lila.js';
export type { DecodedLila, LilaPreserved, ProcessManifest, RepositoryManifest } from './lila.js';
export {
  CATALOG_TYPES,
  canonicalCatalogObject,
  catalogObjectPath,
  catalogObjectProblem,
  catalogObjectText,
  compareCatalogObjects,
  isAdoptableId,
  isCatalogId,
  isCatalogType,
  isKnownCatalogType,
  newCatalogId,
  newProcessId,
  readCatalogObject,
  repeatedCatalogIds,
  sameCatalogObject,
} from './catalog.js';
export type { CatalogAttribute, CatalogObject, KnownCatalogType } from './catalog.js';
export { asVersion3, formatVersionOf, upgradesToVersion3, withCatalog } from './upgrade.js';
export { catalogKey, expectedTypeOf, REFERENCE_FIELDS, relationOf, usageIndex } from './usage.js';
export type { CatalogUse, ObjectUse, ProcessUse, UnresolvedReference, UsageIndex } from './usage.js';
export {
  adoptReference,
  CatalogError,
  catalogNames,
  createCatalogObject,
  deleteCatalogObject,
  getCatalogObject,
  listCatalog,
  updateCatalogObject,
} from './catalog-ops.js';
export type { CatalogChange, CatalogErrorCode, CatalogFields, CatalogOperationResult, CatalogProblem } from './catalog-ops.js';
export { isCurrentRun, storedRun, withStoredRun } from './runs.js';
export { DEFAULT_ARRIVALS, DEFAULT_PROCESSING_TIME, DEFAULT_RUN, defaultScenario } from './default-scenario.js';
export type { StoredRunInput } from './runs.js';
