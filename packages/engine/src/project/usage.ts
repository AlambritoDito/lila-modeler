/**
 * The usage index, "where used" (RM-01 § 4, #672): every reference of the repository to a catalog
 * object, from the BPMN of each process (`lila:responsibility roleRef`, `lila:systemRef`…) and from
 * the reference fields of other objects (`unitRef`, `parentRef`, `ownerRef`). Derived on demand and
 * never persisted. A pure function of the document, so the app, the CLI and the MCP server answer
 * "where used" identically.
 */
import { readCatalogReferences, type CatalogReference } from '../bpmn/annotate.js';
import type { CatalogObject } from './catalog.js';
import { isKnownCatalogType } from './catalog.js';
import { processesOf, processIds } from './repository.js';
import type { ProjectDocument } from './types.js';

/** The catalog type each BPMN reference expects (RM-01 § 3.1). */
const EXPECTED_TYPE: Readonly<Record<CatalogReference['kind'], string>> = {
  responsibility: 'role',
  systemRef: 'system',
  documentRef: 'document',
  input: 'document',
  output: 'document',
  riskRef: 'risk',
  controlRef: 'control',
  kpiRef: 'kpi',
};

/** The reference fields of the known types and the type each one expects (RM-01 § 2.2, § 3.1). */
export const REFERENCE_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  role: { unitRef: 'unit' },
  unit: { parentRef: 'unit' },
  system: { ownerRef: 'role' },
  document: { ownerRef: 'role' },
};

/** The type a BPMN reference of `kind` points at. */
export function expectedTypeOf(kind: CatalogReference['kind']): string {
  return EXPECTED_TYPE[kind];
}

/** A use in a process: `relation` is `responsibility:<R|A|C|I>` or the reference kind (`systemRef`, `input`…). */
export interface ProcessUse {
  /** The process id (RM-01 § 3.2); absent in a version 1 or 2 document, which has none yet. */
  readonly process?: string;
  readonly slug: string;
  readonly element: string;
  readonly relation: string;
}

/** A use in another catalog object: `object` is its `<type>/<id>`. */
export interface ObjectUse {
  readonly object: string;
  readonly field: string;
}

export type CatalogUse = ProcessUse | ObjectUse;

/** A reference that matches no object of the type it expects: where it is, plus that type and id. */
export type UnresolvedReference = CatalogUse & { readonly type: string; readonly id: string };

export interface UsageIndex {
  /**
   * Uses by `<type>/<id>`, one key for every object of the catalog (`[]` when it has none): process
   * uses in process order and then document order, then the uses in other objects, in catalog order.
   */
  readonly uses: Readonly<Record<string, readonly CatalogUse[]>>;
  readonly unresolved: readonly UnresolvedReference[];
  /** BPMN process ids declared by more than one process (RM-01 § 3.2), with the slugs that declare each. */
  readonly duplicateProcessIds: readonly { readonly id: string; readonly slugs: readonly string[] }[];
}

/** The key of an object in `UsageIndex.uses`: `<type>/<id>`. */
export function catalogKey(object: Pick<CatalogObject, 'type' | 'id'>): string {
  return `${object.type}/${object.id}`;
}

/** The relation a BPMN reference is listed with. */
export function relationOf(reference: CatalogReference): string {
  return reference.kind === 'responsibility' ? `responsibility:${reference.type ?? ''}` : reference.kind;
}

/**
 * Builds the usage index of `document` (RM-01 § 4). Reads every process's model; throws
 * `AnnotationContentLossError` when one cannot be read without losing content, as `annotateElement`
 * would, rather than answer "unused" for an object a model it could not read may use.
 */
export async function usageIndex(document: ProjectDocument): Promise<UsageIndex> {
  const catalog = document.catalog ?? [];
  const uses: Record<string, CatalogUse[]> = Object.create(null) as Record<string, CatalogUse[]>;
  for (const object of catalog) uses[catalogKey(object)] = [];
  const unresolved: UnresolvedReference[] = [];
  const add = (type: string, id: string, use: CatalogUse): void => {
    const key = catalogKey({ type, id });
    if (Object.hasOwn(uses, key)) uses[key]!.push(use);
    else unresolved.push({ ...use, type, id });
  };

  const declared = new Map<string, string[]>();
  for (const process of processesOf(document)) {
    for (const reference of await readCatalogReferences(process.model.xml)) {
      add(expectedTypeOf(reference.kind), reference.ref, {
        ...(process.id !== undefined ? { process: process.id } : {}),
        slug: process.slug,
        element: reference.elementId,
        relation: relationOf(reference),
      });
    }
    for (const id of new Set(processIds(process.model.xml))) declared.set(id, [...(declared.get(id) ?? []), process.slug]);
  }
  for (const object of catalog) {
    if (!isKnownCatalogType(object.type)) continue;
    for (const [field, type] of Object.entries(REFERENCE_FIELDS[object.type]!)) {
      const value = object[field];
      if (typeof value === 'string') add(type, value, { object: catalogKey(object), field });
    }
  }
  const duplicateProcessIds = [...declared].filter(([, slugs]) => slugs.length > 1).map(([id, slugs]) => ({ id, slugs }));
  return { uses, unresolved, duplicateProcessIds };
}
