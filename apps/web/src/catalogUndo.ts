/**
 * «Undo last catalog change» (#93, owner decision 3 of 2026-10-16; RM-01 § 3.4): one level, by
 * snapshot, separate from the canvas undo.
 *
 * The catalog operations (#672) are pure and return a new document, so the document before a change
 * is its snapshot. The entry keeps it with the change summary; undoing puts back the catalog and the
 * processes that change rewrote, and nothing else. The version 3 upgrade is never undone
 * (`withCatalog` keeps a version 3 document at version 3, RM-01 § 1.3). After an undo there is
 * nothing to undo until the next catalog change. Memory only: closing or opening a project drops it.
 *
 * Create and adopt (#93) rewrite no process; rename (#674) and delete (#675) register here too.
 */
import { processesOf, withCatalog, withProcesses, type CatalogChange, type CatalogOperationResult, type ProjectDocument } from '@lila-modeler/engine/project';

/** The one change that can be undone: the document before it and what it changed. */
export interface CatalogUndoEntry {
  readonly before: ProjectDocument;
  readonly change: CatalogChange;
}

/** The entry for the change from `before` to `result`, or `null` when nothing changed (nothing to undo). */
export function recordCatalogChange(before: ProjectDocument, result: Pick<CatalogOperationResult, 'changed' | 'change'>): CatalogUndoEntry | null {
  return result.changed ? { before, change: result.change } : null;
}

/**
 * `current` with the catalog of `entry.before`, and the BPMN of each process the change rewrote (by
 * slug) as it was before, its revision one up as any other model change (its runs become stale).
 * Everything else of `current` — scenarios, other processes — stays. A version 3 document stays
 * version 3.
 */
export function undoCatalogChange(current: ProjectDocument, entry: CatalogUndoEntry): ProjectDocument {
  const touched = new Set(entry.change.processes.map((p) => p.slug));
  let document = current;
  if (touched.size > 0) {
    const previous = new Map(processesOf(entry.before).map((p) => [p.slug, p.model.xml]));
    const processes = processesOf(current).map((p) => {
      const xml = touched.has(p.slug) ? previous.get(p.slug) : undefined;
      return xml === undefined || xml === p.model.xml ? p : { ...p, model: { ...p.model, xml, revision: p.model.revision + 1 } };
    });
    document = withProcesses(current, processes, { repository: current.process !== undefined });
  }
  return withCatalog(document, entry.before.catalog ?? []);
}
