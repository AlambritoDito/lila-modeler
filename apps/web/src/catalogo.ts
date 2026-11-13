/**
 * The catalog panel's logic (#674, RM-01 § 2.3, § 2.4, § 3.4, § 4): how the objects are grouped and
 * searched, when a new name repeats one, and the usage index the panel counts and lists from. Pure:
 * no React, no bpmn-js, so `catalogo.test.ts` covers it without a canvas.
 *
 * The index is the engine's (#672): every process is read by `usageIndex`, one at a time, so a
 * process whose BPMN did not change is not read again (§ 4: «editing a process re-scans that process
 * only»), and resolving the references against the catalog is a synchronous step, so an edited
 * object needs no scan at all. `catalogo.test.ts` holds the result equal to `usageIndex` of the
 * whole document.
 */
import {
  CATALOG_TYPES,
  catalogKey,
  isKnownCatalogType,
  REFERENCE_FIELDS,
  usageIndex,
  type CatalogObject,
  type CatalogUse,
  type ProcessUse,
  type UnresolvedReference,
} from '@lila-modeler/engine/project';

/** Accents and case ignored, as the pickers and ⌘K search. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** The objects of one type, as the panel lists them. */
export interface CatalogGroup {
  readonly type: string;
  /** A type this build does not know (`risk`, `control`…): listed, never edited (RM-01 § 2.4). */
  readonly readOnly: boolean;
  /** By name and then id. */
  readonly objects: readonly CatalogObject[];
}

/**
 * `catalog` by type: the four known types first, in their order, then the unknown ones by token.
 * `query` keeps the objects whose name or id contains it (accents and case ignored). Without a
 * query a known type with no objects is still listed, empty; with one, only the groups that match.
 */
export function groupCatalog(catalog: readonly CatalogObject[], query = ''): CatalogGroup[] {
  const needle = fold(query);
  const unknown = [...new Set(catalog.map((o) => o.type).filter((t) => !isKnownCatalogType(t)))].sort();
  return [...CATALOG_TYPES, ...unknown]
    .map((type): CatalogGroup => ({
      type,
      readOnly: !isKnownCatalogType(type),
      objects: catalog
        .filter((o) => o.type === type && (needle === '' || fold(o.name).includes(needle) || o.id.includes(needle)))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    }))
    .filter((group) => needle === '' ? !group.readOnly || group.objects.length > 0 : group.objects.length > 0);
}

/**
 * Whether `name` repeats the name of another object of `type` (RM-01 § 2.3: names are not unique;
 * the UI warns, nothing more). `exceptId` is the object being renamed.
 */
export function repeatsName(catalog: readonly CatalogObject[], type: string, name: string, exceptId?: string): boolean {
  const folded = fold(name);
  return folded !== '' && catalog.some((o) => o.type === type && o.id !== exceptId && fold(o.name) === folded);
}

/**
 * The ids of the units under `id`: every unit whose `parentRef` chain reaches it. None of them may
 * become its parent, or the hierarchy would close into a cycle (RM-01 § 2.2).
 */
export function unitDescendants(catalog: readonly CatalogObject[], id: string): Set<string> {
  const under = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const o of catalog) {
      if (o.type !== 'unit' || o.id === id || under.has(o.id)) continue;
      if (o.parentRef === id || (typeof o.parentRef === 'string' && under.has(o.parentRef))) { under.add(o.id); grew = true; }
    }
  }
  return under;
}

/** A process as the index reads it: its slug, its process id when it has one, and its BPMN. */
export interface ProcessSource {
  readonly slug: string;
  readonly id?: string | undefined;
  readonly xml: string;
}

/** Every catalog reference of one process, in document order, each with the type and id it points at. */
export interface ProcessScan {
  readonly slug: string;
  readonly references: readonly (ProcessUse & { readonly type: string; readonly id: string })[];
}

/** What `scanProcesses` remembers between calls: the BPMN each slug was last read from, and what it held. */
export type ScanCache = Map<string, { readonly source: ProcessSource; readonly scan: ProcessScan }>;

/**
 * The references of each of `processes`, in their order. A process whose BPMN (and ids) are the
 * ones `cache` last saw is not read again; the others are, through the engine's `usageIndex` with
 * an empty catalog, which lists every reference as it is written. Slugs no longer listed are
 * forgotten. Throws what `usageIndex` throws when a model cannot be read without losing content.
 */
export async function scanProcesses(processes: readonly ProcessSource[], cache: ScanCache): Promise<ProcessScan[]> {
  const scans: ProcessScan[] = [];
  for (const source of processes) {
    const known = cache.get(source.slug);
    if (known !== undefined && known.source.xml === source.xml && known.source.id === source.id) {
      scans.push(known.scan);
      continue;
    }
    const index = await usageIndex({
      version: 1, id: 'scan', name: source.slug,
      model: { id: source.slug, name: 'model.bpmn', xml: source.xml, revision: 0 },
      scenarios: {}, scenarioRevisions: {}, runs: [],
      process: { slug: source.slug, name: source.slug, ...(source.id !== undefined ? { id: source.id } : {}) },
    });
    const scan: ProcessScan = { slug: source.slug, references: index.unresolved.filter((r): r is ProcessUse & { type: string; id: string } => 'element' in r) };
    cache.set(source.slug, { source, scan });
    scans.push(scan);
  }
  const listed = new Set(processes.map((p) => p.slug));
  for (const slug of [...cache.keys()]) if (!listed.has(slug)) cache.delete(slug);
  return scans;
}

/** The uses and the unresolved references of a repository: `UsageIndex` without the duplicate process ids. */
export interface CatalogIndex {
  /** By `<type>/<id>`, one key per object: process uses in process and document order, then uses in other objects. */
  readonly uses: Readonly<Record<string, readonly CatalogUse[]>>;
  readonly unresolved: readonly UnresolvedReference[];
}

/**
 * The index of `catalog` over `scans`, as the engine's `usageIndex` builds it (RM-01 § 4): a
 * reference counts for the object of the type it expects with that id, and is unresolved otherwise;
 * then the reference fields of the known types (`unitRef`, `parentRef`, `ownerRef`), in catalog order.
 */
export function buildIndex(catalog: readonly CatalogObject[], scans: readonly ProcessScan[]): CatalogIndex {
  const uses: Record<string, CatalogUse[]> = Object.create(null) as Record<string, CatalogUse[]>;
  for (const object of catalog) uses[catalogKey(object)] = [];
  const unresolved: UnresolvedReference[] = [];
  const add = (type: string, id: string, use: CatalogUse): void => {
    const key = catalogKey({ type, id });
    if (Object.hasOwn(uses, key)) uses[key]!.push(use);
    else unresolved.push({ ...use, type, id });
  };
  for (const scan of scans) {
    for (const { type, id, ...use } of scan.references) add(type, id, use);
  }
  for (const object of catalog) {
    if (!isKnownCatalogType(object.type)) continue;
    for (const [field, type] of Object.entries(REFERENCE_FIELDS[object.type]!)) {
      const value = object[field];
      if (typeof value === 'string') add(type, value, { object: catalogKey(object), field });
    }
  }
  return { uses, unresolved };
}

/**
 * The index as the panel holds it: `'pending'` until the first build finishes (RM-01 § 4: counts
 * show as pending, never as zero), `'unavailable'` when a model could not be read.
 */
export type CatalogIndexState = CatalogIndex | 'pending' | 'unavailable';

/** The uses of `object`, or the reason there is no answer yet. Never `[]` for an index that is not built. */
export function usesOf(index: CatalogIndexState, object: Pick<CatalogObject, 'type' | 'id'>): readonly CatalogUse[] | 'pending' | 'unavailable' {
  if (typeof index === 'string') return index;
  return index.uses[catalogKey(object)] ?? 'pending';
}

/** Whether `use` is in a process (it can be opened on the canvas) rather than in another object. */
export function isProcessUse(use: CatalogUse): use is ProcessUse {
  return 'element' in use;
}
