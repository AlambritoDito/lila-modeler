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
 * Create and adopt (#93) rewrite no process; rename (#674) registers here too. A delete with
 * *replace with* or *remove references* and an adopt that rewrites (#675) change several processes:
 * the snapshot holds them all, and undoing restores each one. The one on the canvas is put back in
 * place; one that is not, and was edited since, makes the caller refuse the undo (`editedSince`)
 * rather than lose that edit to the snapshot.
 */
import type { ReferenceChanges, RewrittenProcess } from './catalogDelete';
import { processesOf, withCatalog, withProcesses, type CatalogChange, type CatalogOperationResult, type ProcessDocument, type ProjectDocument } from '@lila-modeler/engine/project';

/** The one change that can be undone: the document before it and what it changed. */
export interface CatalogUndoEntry {
  readonly before: ProjectDocument;
  readonly change: CatalogChange;
  /**
   * #675: by slug, each process the change rewrote (`catalogDelete.rewrittenProcesses`): the
   * references its elements had before, and the revision the change left its model at.
   * - The process on the canvas when the change is undone is put back with `revert`, in place,
   *   instead of being loaded again from `before` — that would empty its ⌘Z history and drop what
   *   was drawn since.
   * - A process that is not on the canvas goes back to its BPMN of `before`; `revision` tells
   *   whether it was edited since (`editedSince`), when that would drop the edit.
   */
  readonly rewritten?: ReadonlyMap<string, { readonly revert: ReferenceChanges; readonly revision: number }>;
}

/** The entry for the change from `before` to `result`, or `null` when nothing changed (nothing to undo). */
export function recordCatalogChange(
  before: ProjectDocument,
  result: Pick<CatalogOperationResult, 'changed' | 'change'>,
  rewritten: readonly Pick<RewrittenProcess, 'slug' | 'revert' | 'after'>[] = [],
): CatalogUndoEntry | null {
  if (!result.changed) return null;
  if (rewritten.length === 0) return { before, change: result.change };
  return { before, change: result.change, rewritten: new Map(rewritten.map((r) => [r.slug, { revert: r.revert, revision: r.after.model.revision }])) };
}

/**
 * The processes of `current` that `entry` rewrote and that were edited after it (their model is
 * not at the revision the change left it at), `canvas` aside: undoing by snapshot would put back
 * their BPMN of before the change and drop that edit. The caller refuses the undo and names them;
 * with one of them on the canvas the undo is done in place there and nothing is lost.
 */
export function editedSince(current: ProjectDocument, entry: CatalogUndoEntry, canvas?: string): ProcessDocument[] {
  return processesOf(current).filter((p) => {
    const left = entry.rewritten?.get(p.slug);
    return left !== undefined && p.slug !== canvas && p.model.revision !== left.revision;
  });
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
