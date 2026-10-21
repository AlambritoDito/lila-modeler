/**
 * Catalog objects of a repository (RM-01 § 2, ADR-032): roles, units, systems and documents, one
 * JSON file each at `catalog/<type>/<id>.json` of a version 3 repository. This module is the
 * object half — the envelope, the type fields, the ids and their grammar — and stays free of any
 * container: `lila.ts` reads and writes the files, `repository.ts` folds processes.
 *
 * Objects of a type this build does not know (`risk`, `control`, `kpi`…, RM-01 § 2.4) are loaded
 * with the envelope checked and every field kept, and are read-only. When the bytes they were read
 * with travel too (`LilaPreserved.objects`), an unchanged object is written back with them;
 * otherwise (a browser reload) it is written canonically, with the same fields.
 */
import { RESERVED } from './repository.js';

/** The catalog types of lot A1 (owner, 2026-10-16). Anything else is a type this build does not know. */
export const CATALOG_TYPES = ['role', 'unit', 'system', 'document'] as const;
export type KnownCatalogType = (typeof CATALOG_TYPES)[number];

/** A type token: the `<type>` folder of `catalog/<type>/<id>.json` (RM-01 § 2.4). */
const TYPE = /^[a-z][a-z0-9-]{0,31}$/;

/** The id grammar (RM-01 § 2.3): the process-slug grammar, so the id is a safe file name. */
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** One free extended attribute (RM-01 § 2.1). */
export interface CatalogAttribute {
  readonly name: string;
  readonly value: string;
}

/**
 * One catalog object (RM-01 § 2.1, § 5.2). The envelope fields are typed; the type fields of § 2.2
 * (`unitRef`, `parentRef`, `ownerRef`, `url`, `attachment`) and any field this build does not know
 * live in the index signature and are kept, in their order, by every write.
 */
export interface CatalogObject {
  readonly type: string;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly revision: number;
  readonly attributes?: readonly CatalogAttribute[];
  readonly [field: string]: unknown;
}

/** The known fields of each type, in the order a writer puts them (RM-01 § 2.1, § 2.2). */
const ENVELOPE = ['type', 'id', 'name', 'description', 'revision', 'attributes'] as const;
const TYPE_FIELDS: Readonly<Record<KnownCatalogType, readonly string[]>> = {
  role: ['unitRef'],
  unit: ['parentRef'],
  system: ['ownerRef', 'url'],
  document: ['ownerRef', 'url', 'attachment'],
};

export function isKnownCatalogType(value: unknown): value is KnownCatalogType {
  return typeof value === 'string' && (CATALOG_TYPES as readonly string[]).includes(value);
}

export function isCatalogType(value: unknown): value is string {
  return typeof value === 'string' && TYPE.test(value);
}

/** `true` for a value of the id grammar (RM-01 § 2.3). Reserved Windows names pass: see `isAdoptableId`. */
export function isCatalogId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

/**
 * `true` when a hand-typed reference (`rol-1`, `sys-crm`) may become an object with that very id
 * (RM-01 § 2.3): it matches the grammar and is not a name Windows refuses as a file (`con`, `nul`…).
 */
export function isAdoptableId(value: unknown): value is string {
  return isCatalogId(value) && !RESERVED.test(value);
}

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * 12 characters of `[0-9a-z]` from `crypto.getRandomValues` (in the browser and in Node alike).
 * Bytes of 252 and above are drawn again, so every character is equally likely (252 = 7 × 36).
 */
function randomSuffix(): string {
  let out = '';
  const bytes = new Uint8Array(16);
  while (out.length < 12) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < 252 && out.length < 12) out += ALPHABET[byte % 36];
    }
  }
  return out;
}

/** A new object id, `<type>-<12 of [0-9a-z]>` (RM-01 § 2.3). Throws on a type outside the grammar. */
export function newCatalogId(type: string): string {
  if (!isCatalogType(type)) throw new RangeError(`not a catalog type: ${JSON.stringify(type)}.`);
  return `${type}-${randomSuffix()}`;
}

/** A new process id, `process-<12 of [0-9a-z]>` (RM-01 § 3.2). */
export function newProcessId(): string {
  return `process-${randomSuffix()}`;
}

/** The entry of `object` in a version 3 repository: `catalog/<type>/<id>.json`. */
export function catalogObjectPath(object: Pick<CatalogObject, 'type' | 'id'>): string {
  return `catalog/${object.type}/${object.id}.json`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * An absolute `http`/`https` URL with a host and no whitespace (RM-01 § 2.2: shown as a link, never
 * fetched). A pattern and not `new URL`, so it does not depend on the global the host provides.
 */
function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\/[a-z0-9[][^\s/?#@]*(?:[/?#]\S*)?$/i.test(value);
}

/**
 * Why `value` is not a catalog object, or `null` when it is one (RM-01 § 2.1, § 2.2). `path`, when
 * given, is the entry it was read from: its `<type>` folder and file name must agree with `type`
 * and `id`. Type fields are checked for the known types only; an unknown type is the envelope.
 */
export function catalogObjectProblem(value: unknown, path?: { readonly type: string; readonly id: string }): string | null {
  if (!isPlainObject(value)) return 'the content is not a JSON object.';
  if (!isCatalogType(value.type)) return '"type" must be a type token (a-z, 0-9, -).';
  if (!isCatalogId(value.id)) return '"id" must match ^[a-z0-9][a-z0-9-]{0,63}$.';
  if (path !== undefined && (value.type !== path.type || value.id !== path.id)) {
    return `"type" and "id" must match the entry path (catalog/${path.type}/${path.id}.json).`;
  }
  if (typeof value.name !== 'string' || value.name.trim() === '') return '"name" must be text that is not empty.';
  if (value.description !== undefined && typeof value.description !== 'string') return '"description" must be text.';
  if (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 1) {
    return '"revision" must be an integer of at least 1.';
  }
  if (
    value.attributes !== undefined &&
    (!Array.isArray(value.attributes) ||
      !value.attributes.every((a) => isPlainObject(a) && typeof a.name === 'string' && typeof a.value === 'string'))
  ) {
    return '"attributes" must be a list of { "name", "value" } text pairs.';
  }
  if (!isKnownCatalogType(value.type)) return null;
  for (const field of ['unitRef', 'parentRef', 'ownerRef'] as const) {
    if (TYPE_FIELDS[value.type].includes(field) && value[field] !== undefined && typeof value[field] !== 'string') {
      return `"${field}" must be text: the id of an object.`;
    }
  }
  if (TYPE_FIELDS[value.type].includes('url') && value.url !== undefined && !isHttpUrl(value.url)) {
    return '"url" must be an http or https URL.';
  }
  return null;
}

/**
 * `object` with its known fields first, in the order of RM-01 § 2.1 and § 2.2, and every other
 * field after them in its original order. What a writer puts on disk.
 */
export function canonicalCatalogObject(object: CatalogObject): CatalogObject {
  const known = [...ENVELOPE, ...(isKnownCatalogType(object.type) ? TYPE_FIELDS[object.type] : [])];
  const out: Record<string, unknown> = {};
  // `defineProperty` and `Object.hasOwn`, not `out[field] =` and `in`: a field named like a member of
  // `Object.prototype` (`constructor`, `__proto__`) is a field like any other and must survive.
  const put = (field: string, value: unknown): void => {
    Object.defineProperty(out, field, { value, enumerable: true, writable: true, configurable: true });
  };
  for (const field of known) if (Object.hasOwn(object, field) && object[field] !== undefined) put(field, object[field]);
  for (const [field, value] of Object.entries(object)) if (!Object.hasOwn(out, field) && value !== undefined) put(field, value);
  return out as CatalogObject;
}

/** Catalog order (RM-01 § 1.5): by type, then by id. */
export function compareCatalogObjects(a: Pick<CatalogObject, 'type' | 'id'>, b: Pick<CatalogObject, 'type' | 'id'>): number {
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
