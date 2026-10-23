/**
 * Operations on the catalog of a repository (#672, RM-01 § 2.3, § 3.4, § 5.4): list, read, create,
 * update, delete and adopt catalog objects. One mechanism for the four types of lot A1 (role, unit,
 * system, document).
 *
 * Every operation is pure: it takes a document and returns a new one plus a change summary, and
 * never mutates its input, so a caller can keep the previous document as an undo snapshot (#93)
 * and a file wrapper can write the result or, on a dry run, not. The first object created or adopted
 * takes a version 1 or 2 document to version 3 (`withCatalog`); the summary says so (`wouldUpgrade`).
 *
 * Failures are `CatalogError`s with a stable `LILA-…` code (the seam `ProjectFormatError` uses), so
 * each front end words them in its own language; the disk wrappers map `LILA-OBJECT-IN-USE` and
 * `LILA-REVISION` to the public codes of ADR-032.
 */
import { rewriteCatalogReferences, type CatalogReference } from '../bpmn/annotate.js';
import {
  canonicalCatalogObject,
  catalogObjectProblem,
  compareCatalogObjects,
  isAdoptableId,
  isCatalogId,
  isKnownCatalogType,
  newCatalogId,
  type CatalogAttribute,
  type CatalogObject,
} from './catalog.js';
import { processesOf, withProcesses } from './repository.js';
import type { ProcessDocument, ProjectDocument } from './types.js';
import { upgradesToVersion3, withCatalog } from './upgrade.js';
import { catalogKey, expectedTypeOf, REFERENCE_FIELDS, usageIndex, type CatalogUse } from './usage.js';

/** Stable codes of a refused catalog operation (see the header). */
export type CatalogErrorCode = 'LILA-NO-OBJECT' | 'LILA-REVISION' | 'LILA-OBJECT-IN-USE' | 'LILA-CATALOG';

/** What exactly was refused, for the caller to word. */
export type CatalogProblem =
  | { readonly reason: 'no-object'; readonly id: string; readonly type?: string }
  | { readonly reason: 'ambiguous-id'; readonly id: string; readonly types: readonly string[] }
  | { readonly reason: 'revision'; readonly id: string; readonly expected: number; readonly actual: number }
  | { readonly reason: 'in-use'; readonly type: string; readonly id: string; readonly uses: readonly CatalogUse[] }
  | { readonly reason: 'unknown-type'; readonly type: string }
  | { readonly reason: 'read-only'; readonly type: string; readonly id: string }
  | { readonly reason: 'unknown-field'; readonly type: string; readonly field: string }
  | { readonly reason: 'invalid'; readonly detail: string }
  | { readonly reason: 'replace-and-remove' }
  | { readonly reason: 'replace-self'; readonly id: string }
  | { readonly reason: 'replace-type'; readonly id: string; readonly type: string; readonly replaceWith: string; readonly replaceType: string }
  | { readonly reason: 'already-resolved'; readonly type: string; readonly id: string }
  | { readonly reason: 'empty-ref' };

const CODE_OF: Readonly<Record<CatalogProblem['reason'], CatalogErrorCode>> = {
  'no-object': 'LILA-NO-OBJECT',
  'ambiguous-id': 'LILA-NO-OBJECT',
  revision: 'LILA-REVISION',
  'in-use': 'LILA-OBJECT-IN-USE',
  'unknown-type': 'LILA-CATALOG',
  'read-only': 'LILA-CATALOG',
  'unknown-field': 'LILA-CATALOG',
  invalid: 'LILA-CATALOG',
  'replace-and-remove': 'LILA-CATALOG',
  'replace-self': 'LILA-CATALOG',
  'replace-type': 'LILA-CATALOG',
  'already-resolved': 'LILA-CATALOG',
  'empty-ref': 'LILA-CATALOG',
};

function englishOf(problem: CatalogProblem): string {
  switch (problem.reason) {
    case 'no-object':
      return `no catalog object ${problem.type === undefined ? '' : `of type ${problem.type} `}has the id "${problem.id}".`;
    case 'ambiguous-id':
      return `"${problem.id}" is the id of objects of several types (${problem.types.join(', ')}); give the type.`;
    case 'revision':
      return `${problem.id} is at revision ${problem.actual}, not ${problem.expected}: it changed since it was read.`;
    case 'in-use':
      return `${problem.type}/${problem.id} is in use (${problem.uses.length}); delete it with replaceWith or removeReferences.`;
    case 'unknown-type':
      return `"${problem.type}" is not a catalog type of this build (role, unit, system, document).`;
    case 'read-only':
      return `${problem.type}/${problem.id} is of a type this build does not know; it is read-only.`;
    case 'unknown-field':
      return `a ${problem.type} has no field "${problem.field}".`;
    case 'invalid':
      return problem.detail;
    case 'replace-and-remove':
      return 'give replaceWith or removeReferences, not both.';
    case 'replace-self':
      return `${problem.id} cannot replace itself.`;
    case 'replace-type':
      return `${problem.replaceWith} is a ${problem.replaceType}, not a ${problem.type} like ${problem.id}.`;
    case 'already-resolved':
      return `${problem.type}/${problem.id} is already in the catalog.`;
    case 'empty-ref':
      return 'the reference to adopt is empty.';
  }
}

/** A refused catalog operation. Nothing was changed: operations are pure. */
export class CatalogError extends Error {
  readonly code: CatalogErrorCode;
  constructor(readonly problem: CatalogProblem) {
    super(englishOf(problem));
    this.name = 'CatalogError';
    this.code = CODE_OF[problem.reason];
  }
}

/** What an operation changed, by `<type>/<id>` and by process (#672). */
export interface CatalogChange {
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly deleted: readonly string[];
  /** The processes whose model was rewritten, with how many references changed in each. */
  readonly processes: readonly { readonly slug: string; readonly process?: string; readonly references: number }[];
  /** `true` when the operation takes a version 1 or 2 document to version 3 (RM-01 § 1.3). */
  readonly wouldUpgrade: boolean;
}

export interface CatalogOperationResult {
  /** The document after the operation; the input itself when nothing changed. */
  readonly document: ProjectDocument;
  /** The object created, updated, adopted or (for a delete) removed, as it is (or was) in the catalog. */
  readonly object: CatalogObject;
  readonly changed: boolean;
  readonly change: CatalogChange;
}

/**
 * The editable fields of an object. On create a field left out is not set; on update a field left
 * out stays, and `null` removes an optional one. The type fields are those of RM-01 § 2.2.
 */
export interface CatalogFields {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly attributes?: readonly CatalogAttribute[] | null | undefined;
  readonly unitRef?: string | null | undefined;
  readonly parentRef?: string | null | undefined;
  readonly ownerRef?: string | null | undefined;
  readonly url?: string | null | undefined;
}

/** The type fields an agent may set, by type (`attachment` is for #93's attachments, not here). */
const SETTABLE: Readonly<Record<string, readonly string[]>> = {
  role: ['unitRef'],
  unit: ['parentRef'],
  system: ['ownerRef', 'url'],
  document: ['ownerRef', 'url'],
};
const TYPE_FIELD_NAMES = ['unitRef', 'parentRef', 'ownerRef', 'url'] as const;

function fail(problem: CatalogProblem): never {
  throw new CatalogError(problem);
}

/** The catalog of `document`, in catalog order (by type, then id); only `type`'s objects when given. */
export function listCatalog(document: ProjectDocument, options: { readonly type?: string | undefined } = {}): CatalogObject[] {
  return (document.catalog ?? []).filter((object) => options.type === undefined || object.type === options.type).sort(compareCatalogObjects);
}

/** The object `id` (of `type`, when given). Throws `LILA-NO-OBJECT` when there is none, or several types share the id. */
export function getCatalogObject(document: ProjectDocument, target: { readonly id: string; readonly type?: string | undefined }): CatalogObject {
  const found = (document.catalog ?? []).filter((o) => o.id === target.id && (target.type === undefined || o.type === target.type));
  if (found.length === 0) fail({ reason: 'no-object', id: target.id, ...(target.type === undefined ? {} : { type: target.type }) });
  if (found.length > 1) fail({ reason: 'ambiguous-id', id: target.id, types: found.map((o) => o.type).sort() });
  return found[0]!;
}

/** `ids` → the name of the object of `type` each one resolves to; ids that match none are left out. */
export function catalogNames(document: ProjectDocument, type: string, ids: readonly string[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const id of ids) {
    const object = (document.catalog ?? []).find((o) => o.type === type && o.id === id);
    if (object !== undefined) names[id] = object.name;
  }
  return names;
}

function assertEditable(object: CatalogObject): void {
  if (!isKnownCatalogType(object.type)) fail({ reason: 'read-only', type: object.type, id: object.id });
}

/** `base` with `fields` applied (see `CatalogFields`), checked and in canonical order. */
function applyFields(base: CatalogObject, fields: CatalogFields): CatalogObject {
  const out: Record<string, unknown> = { ...base };
  const settable = SETTABLE[base.type] ?? [];
  const set = (field: string, value: unknown): void => {
    if (value === undefined) return;
    if (value === null) delete out[field];
    else out[field] = value;
  };
  if (fields.name !== undefined) out['name'] = typeof fields.name === 'string' ? fields.name.trim() : fields.name;
  set('description', fields.description);
  set('attributes', fields.attributes === undefined || fields.attributes === null ? fields.attributes : fields.attributes.map((a) => ({ name: a.name, value: a.value })));
  for (const field of TYPE_FIELD_NAMES) {
    const value = fields[field];
    if (value === undefined) continue;
    if (!settable.includes(field)) fail({ reason: 'unknown-field', type: base.type, field });
    if (field !== 'url' && value !== null && !isCatalogId(value)) {
      fail({ reason: 'invalid', detail: `"${field}" must be the id of an object (^[a-z0-9][a-z0-9-]{0,63}$).` });
    }
    set(field, value);
  }
  const object = canonicalCatalogObject(out as CatalogObject);
  const problem = catalogObjectProblem(object);
  if (problem !== null) fail({ reason: 'invalid', detail: problem });
  return object;
}

function sameContent(a: CatalogObject, b: CatalogObject): boolean {
  return JSON.stringify(canonicalCatalogObject(a)) === JSON.stringify(canonicalCatalogObject(b));
}

/** The summary of an operation from `before` to `after`. */
function changeOf(
  before: ProjectDocument,
  after: ProjectDocument,
  parts: { created?: string[]; updated?: string[]; deleted?: string[]; processes?: ReadonlyMap<string, number> },
): CatalogChange {
  const ids = new Map(processesOf(after).map((p) => [p.slug, p.id]));
  return {
    created: parts.created ?? [],
    updated: parts.updated ?? [],
    deleted: parts.deleted ?? [],
    processes: [...(parts.processes ?? new Map<string, number>())].map(([slug, references]) => {
      const process = ids.get(slug);
      return { slug, ...(process === undefined ? {} : { process }), references };
    }),
    wouldUpgrade: upgradesToVersion3(before, after),
  };
}

/**
 * Rewrites the BPMN references of every process through `rewrite` (`rewriteCatalogReferences`).
 * A model with a change gets its revision one up, as the app's save does, so its runs become
 * stale; the others are untouched. Returns the document and the references changed per slug.
 */
async function rewriteProcesses(
  document: ProjectDocument,
  rewrite: (reference: CatalogReference) => string | null | undefined,
): Promise<{ document: ProjectDocument; touched: Map<string, number> }> {
  const touched = new Map<string, number>();
  const processes: ProcessDocument[] = [];
  for (const process of processesOf(document)) {
    const { xml, changed } = await rewriteCatalogReferences(process.model.xml, rewrite);
    if (changed === 0) {
      processes.push(process);
      continue;
    }
    touched.set(process.slug, changed);
    processes.push({ ...process, model: { ...process.model, xml, revision: process.model.revision + 1 } });
  }
  if (touched.size === 0) return { document, touched };
  return { document: withProcesses(document, processes, { repository: document.process !== undefined }), touched };
}

/**
 * The catalog with the reference fields of other objects that point at `type`/`id` rewritten to
 * `to` (`null` removes the field), each such object one revision up. Returns the keys it changed.
 * The object `to` itself loses the field instead: pointing it at itself (a unit its own parent)
 * would make a cycle.
 */
function rewriteObjectFields(
  catalog: readonly CatalogObject[],
  type: string,
  id: string,
  to: string | null,
): { catalog: CatalogObject[]; updated: string[] } {
  const updated: string[] = [];
  const out = catalog.map((object) => {
    if (!isKnownCatalogType(object.type)) return object;
    const fields = Object.entries(REFERENCE_FIELDS[object.type]!).filter(([field, expected]) => expected === type && object[field] === id);
    if (fields.length === 0) return object;
    const next: Record<string, unknown> = { ...object, revision: object.revision + 1 };
    const target = object.type === type && object.id === to ? null : to;
    for (const [field] of fields) {
      if (target === null) delete next[field];
      else next[field] = target;
    }
    updated.push(catalogKey(object));
    return canonicalCatalogObject(next as CatalogObject);
  });
  return { catalog: out, updated };
}

function freshId(document: ProjectDocument, type: string): string {
  const taken = new Set((document.catalog ?? []).map((o) => o.id));
  for (;;) {
    const id = newCatalogId(type);
    if (!taken.has(id)) return id;
  }
}

/**
 * Creates an object of `type` (one of the four of lot A1) with a generated id (RM-01 § 2.3) and
 * revision 1. The first object of a version 1 or 2 document makes it version 3 (`wouldUpgrade`).
 */
export function createCatalogObject(
  document: ProjectDocument,
  request: CatalogFields & { readonly type: string },
): CatalogOperationResult {
  const { type, ...fields } = request;
  if (!isKnownCatalogType(type)) fail({ reason: 'unknown-type', type });
  if (fields.name === undefined) fail({ reason: 'invalid', detail: '"name" must be text that is not empty.' });
  const object = applyFields({ type, id: freshId(document, type), name: '', revision: 1 }, fields);
  const after = withCatalog(document, [...(document.catalog ?? []), object]);
  return { document: after, object, changed: true, change: changeOf(document, after, { created: [catalogKey(object)] }) };
}

/**
 * Updates the object `id`: `fields` as in `CatalogFields`. `baseRevision` must be the revision the
 * caller read (RM-01 § 5.4), or the update is refused (`LILA-REVISION`). An update that leaves the
 * object as it was changes nothing and keeps the revision; any other one adds one to it.
 * Objects of types this build does not know are read-only.
 */
export function updateCatalogObject(
  document: ProjectDocument,
  request: CatalogFields & { readonly id: string; readonly type?: string | undefined; readonly baseRevision: number },
): CatalogOperationResult {
  const { id, type, baseRevision, ...fields } = request;
  const current = getCatalogObject(document, { id, type });
  assertEditable(current);
  if (current.revision !== baseRevision) fail({ reason: 'revision', id, expected: baseRevision, actual: current.revision });
  const edited = applyFields(current, fields);
  if (sameContent(edited, current)) {
    return { document, object: current, changed: false, change: changeOf(document, document, {}) };
  }
  const object = canonicalCatalogObject({ ...edited, revision: current.revision + 1 });
  const after = withCatalog(document, (document.catalog ?? []).map((o) => (o === current ? object : o)));
  return { document: after, object, changed: true, change: changeOf(document, after, { updated: [catalogKey(object)] }) };
}

/**
 * Deletes the object `id` (RM-01 § 3.4). An object in use is refused (`LILA-OBJECT-IN-USE`, with
 * its uses) unless the caller says what happens to the references: `replaceWith` another object of
 * the same type (every reference rewritten to it) or `removeReferences`. Rewritten models get their
 * revision one up; other objects whose reference fields change get theirs. `baseRevision`, when
 * given, is checked as on update.
 */
export async function deleteCatalogObject(
  document: ProjectDocument,
  request: {
    readonly id: string;
    readonly type?: string | undefined;
    readonly baseRevision?: number | undefined;
    readonly replaceWith?: string | undefined;
    readonly removeReferences?: boolean | undefined;
  },
): Promise<CatalogOperationResult> {
  const current = getCatalogObject(document, { id: request.id, type: request.type });
  assertEditable(current);
  if (request.baseRevision !== undefined && current.revision !== request.baseRevision) {
    fail({ reason: 'revision', id: current.id, expected: request.baseRevision, actual: current.revision });
  }
  const remove = request.removeReferences === true;
  if (request.replaceWith !== undefined && remove) fail({ reason: 'replace-and-remove' });
  let to: string | null = null;
  if (request.replaceWith !== undefined) {
    if (request.replaceWith === current.id) fail({ reason: 'replace-self', id: current.id });
    const candidates = (document.catalog ?? []).filter((o) => o.id === request.replaceWith);
    const replacement = candidates.find((o) => o.type === current.type);
    if (replacement === undefined) {
      if (candidates.length === 0) fail({ reason: 'no-object', id: request.replaceWith, type: current.type });
      fail({ reason: 'replace-type', id: current.id, type: current.type, replaceWith: request.replaceWith, replaceType: candidates[0]!.type });
    }
    to = replacement.id;
  }
  // A unit that is its own parent does not keep itself in use.
  const uses = ((await usageIndex(document)).uses[catalogKey(current)] ?? []).filter((use) => !('object' in use && use.object === catalogKey(current)));
  if (uses.length > 0 && request.replaceWith === undefined && !remove) {
    fail({ reason: 'in-use', type: current.type, id: current.id, uses });
  }

  const { document: rewritten, touched } = await rewriteProcesses(document, (reference) =>
    expectedTypeOf(reference.kind) === current.type && reference.ref === current.id ? to : undefined,
  );
  const { catalog, updated } = rewriteObjectFields(
    (document.catalog ?? []).filter((o) => o !== current),
    current.type,
    current.id,
    to,
  );
  const after = withCatalog(rewritten, catalog);
  return {
    document: after,
    object: current,
    changed: true,
    change: changeOf(document, after, { deleted: [catalogKey(current)], updated, processes: touched }),
  };
}

/**
 * Turns a reference typed before the catalog existed into an object of `type` (RM-01 § 2.3, § 3.4).
 * A value of the id grammar that is not a reserved Windows name, and no object's id yet, becomes
 * the object's id, and no BPMN is rewritten. Any other value gets a generated id, and every
 * reference of that type with that value — in every process and in other objects' reference
 * fields — is rewritten to it. `name` defaults to the reference itself.
 */
export async function adoptReference(
  document: ProjectDocument,
  request: { readonly type: string; readonly ref: string; readonly name?: string | undefined },
): Promise<CatalogOperationResult> {
  const { type, ref } = request;
  if (!isKnownCatalogType(type)) fail({ reason: 'unknown-type', type });
  if (ref.trim() === '') fail({ reason: 'empty-ref' });
  const catalog = document.catalog ?? [];
  if (catalog.some((o) => o.type === type && o.id === ref)) fail({ reason: 'already-resolved', type, id: ref });
  const adopted = isAdoptableId(ref) && !catalog.some((o) => o.id === ref);
  const id = adopted ? ref : freshId(document, type);
  const object = applyFields({ type, id, name: '', revision: 1 }, { name: request.name ?? ref });

  let rewritten = document;
  let touched = new Map<string, number>();
  let fields: { catalog: CatalogObject[]; updated: string[] } = { catalog: [...catalog], updated: [] };
  if (!adopted) {
    ({ document: rewritten, touched } = await rewriteProcesses(document, (reference) =>
      expectedTypeOf(reference.kind) === type && reference.ref === ref ? id : undefined,
    ));
    fields = rewriteObjectFields(catalog, type, ref, id);
  }
  const after = withCatalog(rewritten, [...fields.catalog, object]);
  return {
    document: after,
    object,
    changed: true,
    change: changeOf(document, after, { created: [catalogKey(object)], updated: fields.updated, processes: touched }),
  };
}
