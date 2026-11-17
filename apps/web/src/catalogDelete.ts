/**
 * Safe delete and adopt-with-rewrite of catalog objects (#675, RM-01 § 3.4): the logic between the
 * engine's operations (#672) and the catalog panel. Pure: no React, no bpmn-js, so
 * `catalogDelete.test.ts` covers it without a canvas.
 *
 * - Deleting an object in use is refused with its uses (`attemptDelete`); the caller asks again with
 *   one of the two choices, *replace with* or *remove references*. There is no forced delete.
 * - These operations, and adopting a value that cannot be an id, rewrite the BPMN of several
 *   processes. A process that is not on the canvas takes the engine's XML; the one on the canvas is
 *   changed in place (`Modelador.referencias`), so its ⌘Z history stays as it was. What to change
 *   there is `referenceChanges`: per element, the catalog references it must end up with.
 */
import {
  CatalogError,
  isAdoptableId,
  processesOf,
  usageIndex,
  type CatalogObject,
  type CatalogOperationResult,
  type CatalogUse,
  type ProcessDocument,
  type ProjectDocument,
  type UnresolvedReference,
  deleteCatalogObject,
} from '@lila-modeler/engine/project';
import type { CatalogIndexState } from './catalogo';

/** What happens to the references of an object in use when it is deleted (RM-01 § 3.4). */
export type DeleteChoice = { readonly replaceWith: string } | { readonly removeReferences: true };

/** A delete that went through, or one refused because the object is in use, with its uses. */
export type DeleteAttempt =
  | { readonly state: 'deleted'; readonly result: CatalogOperationResult }
  | { readonly state: 'in-use'; readonly uses: readonly CatalogUse[] };

/**
 * Deletes `object` from `document` — which must hold every process, or a use would be missed.
 * Without a `choice` an object in use is refused (`in-use`, the engine's `LILA-OBJECT-IN-USE`) and
 * nothing changes. Any other refusal (the object changed since it was read, the replacement is of
 * another type…) throws the engine's `CatalogError`.
 */
export async function attemptDelete(
  document: ProjectDocument,
  object: Pick<CatalogObject, 'id' | 'type' | 'revision'>,
  choice?: DeleteChoice,
): Promise<DeleteAttempt> {
  try {
    const result = await deleteCatalogObject(document, { id: object.id, type: object.type, baseRevision: object.revision, ...choice });
    return { state: 'deleted', result };
  } catch (e) {
    if (e instanceof CatalogError && e.problem.reason === 'in-use') return { state: 'in-use', uses: e.problem.uses };
    throw e;
  }
}

/**
 * Whether adopting `id` rewrites BPMN (RM-01 § 2.3): a value that is not of the id grammar, is a
 * reserved name, or is already the id of an object of another type cannot be the new object's id,
 * so the object gets a generated one and every reference with that value is rewritten to it.
 */
export function adoptionRewrites(catalog: readonly CatalogObject[], id: string): boolean {
  return !(isAdoptableId(id) && !catalog.some((o) => o.id === id));
}

/** The unresolved references adopting `id` as a `type` resolves, or why they are not known yet. */
export function adoptionPlaces(index: CatalogIndexState, type: string, id: string): readonly UnresolvedReference[] | 'pending' | 'unavailable' {
  if (typeof index === 'string') return index;
  return index.unresolved.filter((r) => r.type === type && r.id === id);
}

/** One catalog reference of an element: its relation (`responsibility:R`, `systemRef`…) and the id it holds. */
export interface ElementReference {
  readonly relation: string;
  readonly id: string;
}

/** By element id, the catalog references that element must end up with, in order (`[]`: none). */
export type ReferenceChanges = ReadonlyMap<string, readonly ElementReference[]>;

/** Every catalog reference of `xml` by element, in document order, as the engine's usage index reads them. */
async function referencesByElement(xml: string): Promise<Map<string, ElementReference[]>> {
  const index = await usageIndex({
    version: 1, id: 'scan', name: 'scan',
    model: { id: 'scan', name: 'model.bpmn', xml, revision: 0 },
    scenarios: {}, scenarioRevisions: {}, runs: [],
  });
  const out = new Map<string, ElementReference[]>();
  for (const reference of index.unresolved) {
    if (!('element' in reference)) continue;
    const list = out.get(reference.element) ?? [];
    list.push({ relation: reference.relation, id: reference.id });
    out.set(reference.element, list);
  }
  return out;
}

/**
 * What turns the references of `fromXml` into those of `toXml`: for each element whose references
 * differ, the ones it has in `toXml`. Elements whose references are the same are left out, so
 * applying the result to a diagram edited since touches only what the operation changed.
 */
export async function referenceChanges(fromXml: string, toXml: string): Promise<ReferenceChanges> {
  const [from, to] = [await referencesByElement(fromXml), await referencesByElement(toXml)];
  const changes = new Map<string, readonly ElementReference[]>();
  for (const element of new Set([...from.keys(), ...to.keys()])) {
    const target = to.get(element) ?? [];
    if (JSON.stringify(from.get(element) ?? []) !== JSON.stringify(target)) changes.set(element, target);
  }
  return changes;
}

/** A process an operation rewrote: as it is after it, and how to apply or revert it on a live canvas. */
export interface RewrittenProcess {
  readonly slug: string;
  /** The process in the document after the operation: its new XML, its revision one up. */
  readonly after: ProcessDocument;
  /** `referenceChanges` from the XML before to the XML after. */
  readonly apply: ReferenceChanges;
  /** The same elements with the references they had before: what «Undo last catalog change» puts back. */
  readonly revert: ReferenceChanges;
}

/** The processes `result` rewrote in `before` (`change.processes`), in that order. */
export async function rewrittenProcesses(before: ProjectDocument, result: Pick<CatalogOperationResult, 'document' | 'change'>): Promise<RewrittenProcess[]> {
  const was = new Map(processesOf(before).map((p) => [p.slug, p]));
  const is = new Map(processesOf(result.document).map((p) => [p.slug, p]));
  const out: RewrittenProcess[] = [];
  for (const { slug } of result.change.processes) {
    const [previous, after] = [was.get(slug), is.get(slug)];
    if (previous === undefined || after === undefined) continue;
    out.push({
      slug,
      after,
      apply: await referenceChanges(previous.model.xml, after.model.xml),
      revert: await referenceChanges(after.model.xml, previous.model.xml),
    });
  }
  return out;
}
