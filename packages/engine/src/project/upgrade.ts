/**
 * Which version a document is written as (RM-01 § 1.3), and the one-way step to version 3.
 *
 * A document becomes version 3 the first time it needs to — its first catalog object, created or
 * adopted — and then stays version 3: removing the last object does not take it back. Pure
 * functions over the document, so the app, the CLI and the MCP server answer "would this change
 * upgrade the file?" identically (#672 reports it as `wouldUpgrade`).
 */
import type { CatalogObject } from './catalog.js';
import { newProcessId } from './catalog.js';
import { processesOf, withProcesses } from './repository.js';
import type { ProjectDocument } from './types.js';

/**
 * The version `document` is written as: 3 when it is or has to be a version 3 repository (marked
 * `formatVersion: 3`, or holding a catalog object or `limits`), 2 with more than one process, 1
 * otherwise. A version 2 manifest that lists a single process is written as version 1 (#517).
 */
export function formatVersionOf(document: ProjectDocument): 1 | 2 | 3 {
  if (document.formatVersion === 3 || (document.catalog?.length ?? 0) > 0 || document.limits !== undefined) return 3;
  return (document.processes?.length ?? 0) > 0 ? 2 : 1;
}

/**
 * `true` when going from `before` to `after` takes the document from version 1 or 2 to version 3:
 * the change older builds (1.0.0-beta.15 to beta.28) can no longer open. Never `true` for a
 * document that already was version 3, whatever the change.
 */
export function upgradesToVersion3(before: ProjectDocument, after: ProjectDocument): boolean {
  return formatVersionOf(before) !== 3 && formatVersionOf(after) === 3;
}

/**
 * `document` as a version 3 repository: `formatVersion: 3`, `catalog` (empty when it had none), and
 * a process id for every process that has none yet — fresh, since a version 1 or 2 file has no ids
 * anything could point at. The slugs stay; a one-process document keeps its slug in `process`.
 * Idempotent: a version 3 document with ids comes back equal.
 */
export function asVersion3(document: ProjectDocument): ProjectDocument {
  const processes = processesOf(document).map((p) => (p.id !== undefined ? p : { ...p, id: newProcessId() }));
  return withProcesses({ ...document, formatVersion: 3, catalog: document.catalog ?? [] }, processes);
}

/**
 * `document` with its catalog replaced by `catalog`. A non-empty catalog makes it version 3
 * (`asVersion3`); an empty one keeps the version it had — a version 3 document stays version 3.
 */
export function withCatalog(document: ProjectDocument, catalog: readonly CatalogObject[]): ProjectDocument {
  if (catalog.length > 0 || document.formatVersion === 3) return asVersion3({ ...document, catalog });
  const { catalog: _catalog, ...rest } = document;
  return rest;
}
