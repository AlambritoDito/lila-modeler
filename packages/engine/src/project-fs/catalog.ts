/**
 * The catalog tools over a `.lila` (#672): list, read, create, update, delete and adopt catalog
 * objects, and "where used". Thin layers over the pure operations of
 * `@lila-modeler/engine/project` (`catalog-ops.ts`, `usage.ts`): open the file, run the
 * operation on the document, and write the result with `writeLilaProject` (atomic, under the
 * cross-process lock, refused when the file changed since it was read). A dry run, or an operation
 * that changes nothing, writes nothing. The MCP server (`list_catalog`, `get_catalog_object`,
 * `create_catalog_object`, `update_catalog_object`, `delete_catalog_object`, `find_usages`,
 * `adopt_reference`) calls these.
 *
 * Folder projects are not served here: they need the folder adapter of version 3 (#671).
 */
import { AnnotationContentLossError } from '../bpmn/index.js';
import { agentToolMessages, type Locale } from '../messages/index.js';
import {
  adoptReference,
  CATALOG_TYPES,
  CatalogError,
  catalogKey,
  createCatalogObject,
  deleteCatalogObject,
  getCatalogObject,
  listCatalog,
  updateCatalogObject,
  usageIndex,
  type CatalogChange,
  type CatalogFields,
  type CatalogObject,
  type CatalogOperationResult,
  type CatalogUse,
  type ProjectDocument,
  type UnresolvedReference,
  type UsageIndex,
} from '../project/index.js';
import { openLilaProject, writeLilaProject } from './input.js';
import { CATALOG_CODES } from './lilaFile.js';

/** The `.lila` a catalog tool works on. */
export interface LilaCatalogTarget {
  readonly file: string;
  readonly locale?: Locale | undefined;
}

/** The type fields each type accepts, for the message that lists them. */
const FIELDS_OF: Readonly<Record<string, string>> = {
  role: 'unitRef',
  unit: 'parentRef',
  system: 'ownerRef, url',
  document: 'ownerRef, url',
};

/** At most 20 uses in a message, then how many more. */
function useList(uses: readonly CatalogUse[], locale: Locale): string {
  const T = agentToolMessages(locale);
  const text = uses.map((use) => ('object' in use ? T.catalogUseInObject(use.object, use.field) : T.catalogUseInProcess(use.slug, use.element, use.relation)));
  return text.length > 20 ? `${text.slice(0, 20).join('; ')} (+${text.length - 20})` : text.join('; ');
}

/**
 * A `CatalogError` in the caller's language. `E-OBJETO-EN-USO` and `E-REVISION` (ADR-032) lead the
 * message and are its `code`, as `E-CAMBIO-EXTERNO` is for `writeLilaProject`; the other refusals
 * are plain messages. bpmn-moddle's content loss is worded as `annotate_element` words it.
 */
function localized(error: unknown, file: string, locale: Locale): unknown {
  const T = agentToolMessages(locale);
  if (error instanceof AnnotationContentLossError) return new Error(T.contentLoss(error.detail));
  if (!(error instanceof CatalogError)) return error;
  const p = error.problem;
  let message: string;
  switch (p.reason) {
    case 'no-object':
      message = T.catalogNoObject(p.id, p.type ?? null, file);
      break;
    case 'ambiguous-id':
      message = T.catalogAmbiguousId(p.id, p.types.join(', '));
      break;
    case 'revision':
      message = T.catalogRevision(p.id, p.expected, p.actual);
      break;
    case 'in-use':
      message = T.catalogInUse(`${p.type}/${p.id}`, p.uses.length, useList(p.uses, locale));
      break;
    case 'unknown-type':
      message = T.catalogUnknownType(p.type, CATALOG_TYPES.join(', '));
      break;
    case 'read-only':
      message = T.catalogReadOnly(`${p.type}/${p.id}`);
      break;
    case 'unknown-field':
      message = T.catalogUnknownField(p.type, p.field, FIELDS_OF[p.type] ?? T.none());
      break;
    case 'invalid':
      message = T.catalogInvalid(p.detail);
      break;
    case 'replace-and-remove':
      message = T.catalogReplaceAndRemove();
      break;
    case 'replace-self':
      message = T.catalogReplaceSelf(p.id);
      break;
    case 'replace-type':
      message = T.catalogReplaceType(`${p.type}/${p.id}`, p.replaceWith, p.replaceType);
      break;
    case 'already-resolved':
      message = T.catalogAlreadyResolved(`${p.type}/${p.id}`);
      break;
    case 'empty-ref':
      message = T.catalogEmptyRef();
      break;
  }
  const code = CATALOG_CODES[error.code];
  return code === null ? new Error(message) : Object.assign(new Error(`${code}: ${message}`), { code });
}

async function guarded<T>(file: string, locale: Locale, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw localized(error, file, locale);
  }
}

/* ------------------------------------------------------------------ *
 * Reading: list_catalog, get_catalog_object, find_usages
 * ------------------------------------------------------------------ */

export interface LilaCatalogList {
  readonly file: string;
  readonly formatVersion: 1 | 2 | 3;
  readonly objects: readonly CatalogObject[];
}

/** The catalog of `file` in catalog order (by type, then id); only `type`'s objects when given. */
export async function lilaCatalogList(target: LilaCatalogTarget & { readonly type?: string | undefined }): Promise<LilaCatalogList> {
  const project = await openLilaProject(target.file, { locale: target.locale });
  return { file: project.file, formatVersion: project.formatVersion, objects: listCatalog(project.document, { type: target.type }) };
}

/** One object of `file`'s catalog, by id (and type, when several types share the id). */
export async function lilaCatalogObject(
  target: LilaCatalogTarget & { readonly id: string; readonly type?: string | undefined },
): Promise<{ readonly file: string; readonly object: CatalogObject }> {
  const locale = target.locale ?? 'en';
  const project = await openLilaProject(target.file, { locale });
  return guarded(project.file, locale, async () => ({ file: project.file, object: getCatalogObject(project.document, target) }));
}

/** The uses of one id: the object's when it is in the catalog, else the unresolved references to it. */
export interface LilaObjectUsages {
  readonly file: string;
  readonly type?: string;
  readonly id: string;
  /** `false`: no object of the catalog has this id (and type); `uses` are unresolved references to it. */
  readonly resolved: boolean;
  readonly uses: readonly CatalogUse[];
}

/**
 * "Where used" (RM-01 § 4) over `file`. Without `id`: the whole usage index. With `id`: the uses
 * of that object, or, when no object has that id, every unresolved reference to it — what an agent
 * checks before `adopt_reference`.
 */
export async function lilaUsages(
  target: LilaCatalogTarget & { readonly id?: string | undefined; readonly type?: string | undefined },
): Promise<(UsageIndex & { readonly file: string }) | LilaObjectUsages> {
  const locale = target.locale ?? 'en';
  const project = await openLilaProject(target.file, { locale });
  return guarded(project.file, locale, async () => {
    const index = await usageIndex(project.document);
    if (target.id === undefined) return { file: project.file, ...index };
    const { id, type } = target;
    const objects = (project.document.catalog ?? []).filter((o) => o.id === id && (type === undefined || o.type === type));
    if (objects.length > 0) {
      const object = getCatalogObject(project.document, { id, type });
      return { file: project.file, type: object.type, id, resolved: true, uses: index.uses[catalogKey(object)] ?? [] };
    }
    const uses = index.unresolved
      .filter((u) => u.id === id && (type === undefined || u.type === type))
      .map(({ type: _type, id: _id, ...use }: UnresolvedReference): CatalogUse => use);
    return { file: project.file, ...(type === undefined ? {} : { type }), id, resolved: false, uses };
  });
}

/* ------------------------------------------------------------------ *
 * Writing: create, update, delete, adopt
 * ------------------------------------------------------------------ */

export interface LilaCatalogWrite extends CatalogChange {
  readonly file: string;
  readonly dryRun: boolean;
  /** `false`: the operation left everything as it was (an update to the same values). */
  readonly changed: boolean;
  /** `true` when the `.lila` was saved. */
  readonly written: boolean;
  readonly object: CatalogObject;
  /** With `wouldUpgrade`: that older builds cannot open the upgraded file. */
  readonly note?: string;
}

/** Runs `operation` on the document of `target.file` and writes the result unless `dryRun`. */
async function writeOperation(
  target: LilaCatalogTarget & { readonly dryRun?: boolean | undefined },
  operation: (document: ProjectDocument) => Promise<CatalogOperationResult>,
): Promise<LilaCatalogWrite> {
  const locale = target.locale ?? 'en';
  const project = await openLilaProject(target.file, { locale });
  const result = await guarded(project.file, locale, () => operation(project.document));
  const dryRun = target.dryRun === true;
  const written = result.changed && !dryRun;
  // `processes[0]` carries the file and the snapshot taken when it was read: the write is refused
  // if the file changed since (`E-CAMBIO-EXTERNO`).
  if (written) await writeLilaProject(project.processes[0]!, result.document, locale);
  return {
    file: project.file,
    dryRun,
    changed: result.changed,
    written,
    object: result.object,
    ...result.change,
    ...(result.change.wouldUpgrade ? { note: agentToolMessages(locale).catalogUpgradeNote() } : {}),
  };
}

/** `create_catalog_object`: a new object of `type` with a generated id (RM-01 § 2.3). */
export async function createLilaCatalogObject(
  request: LilaCatalogTarget & CatalogFields & { readonly type: string; readonly dryRun?: boolean | undefined },
): Promise<LilaCatalogWrite> {
  const { file: _file, locale: _locale, dryRun: _dryRun, ...fields } = request;
  return writeOperation(request, async (document) => createCatalogObject(document, fields));
}

/** `update_catalog_object`: rename or change fields; `baseRevision` is the revision read (RM-01 § 5.4). */
export async function updateLilaCatalogObject(
  request: LilaCatalogTarget &
    CatalogFields & { readonly id: string; readonly type?: string | undefined; readonly baseRevision: number; readonly dryRun?: boolean | undefined },
): Promise<LilaCatalogWrite> {
  const { file: _file, locale: _locale, dryRun: _dryRun, ...fields } = request;
  return writeOperation(request, async (document) => updateCatalogObject(document, fields));
}

/** `delete_catalog_object`: refused while in use unless `replaceWith` or `removeReferences` (RM-01 § 3.4). */
export async function deleteLilaCatalogObject(
  request: LilaCatalogTarget & {
    readonly id: string;
    readonly type?: string | undefined;
    readonly baseRevision?: number | undefined;
    readonly replaceWith?: string | undefined;
    readonly removeReferences?: boolean | undefined;
    readonly dryRun?: boolean | undefined;
  },
): Promise<LilaCatalogWrite> {
  const { file: _file, locale: _locale, dryRun: _dryRun, ...options } = request;
  return writeOperation(request, (document) => deleteCatalogObject(document, options));
}

/** `adopt_reference`: a hand-typed reference becomes an object (RM-01 § 2.3). */
export async function adoptLilaReference(
  request: LilaCatalogTarget & { readonly type: string; readonly ref: string; readonly name?: string | undefined; readonly dryRun?: boolean | undefined },
): Promise<LilaCatalogWrite> {
  const { file: _file, locale: _locale, dryRun: _dryRun, ...options } = request;
  return writeOperation(request, (document) => adoptReference(document, options));
}
