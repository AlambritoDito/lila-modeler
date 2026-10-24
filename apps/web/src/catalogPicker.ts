/**
 * The catalog picker of the properties panel (#93, RM-01 § 3.1, § 3.4): which objects a reference
 * field offers, how each one reads, and what the value the BPMN holds resolves to. Pure: no React,
 * no bpmn-js, so `catalogPicker.test.ts` covers it without a canvas.
 *
 * The BPMN keeps the id and never the name (§ 3.1): the picker shows names and writes ids. A value
 * that matches no object is kept and shown as it is (§ 3.4); adopting it is the user's call.
 */
import { isAdoptableId, type CatalogObject, type KnownCatalogType } from '@lila-modeler/engine/project';

/** The catalog type each `lila:` reference of the panel expects (RM-01 § 3.1); risks, controls and KPIs are reserved. */
const KIND_OF: Readonly<Record<string, KnownCatalogType>> = {
  'lila:Responsibility': 'role',
  'lila:SystemRef': 'system',
  'lila:DocumentRef': 'document',
  'lila:Input': 'document',
  'lila:Output': 'document',
};

/** The catalog type the moddle `$type` points at, or `null` for a reference that stays free text. */
export function pickerKindOf(moddleType: string): KnownCatalogType | null {
  return Object.hasOwn(KIND_OF, moddleType) ? KIND_OF[moddleType]! : null;
}

/** Accents and case ignored, as the shape palette and ⌘K search. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** One row of the picker: the object and how it reads. */
export interface PickerOption {
  readonly object: CatalogObject;
  /** The name; `name (id)` when another object of the same type has the same name. */
  readonly label: string;
}

/** `catalog`'s objects of `kind`, by name and then id, each with its label. */
function optionsOf(catalog: readonly CatalogObject[], kind: KnownCatalogType): PickerOption[] {
  const objects = catalog.filter((o) => o.type === kind);
  const count = new Map<string, number>();
  for (const o of objects) count.set(fold(o.name), (count.get(fold(o.name)) ?? 0) + 1);
  return objects
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((object) => ({ object, label: (count.get(fold(object.name)) ?? 0) > 1 ? `${object.name} (${object.id})` : object.name }));
}

/**
 * The rows for `query`: every object of `kind`, sorted by name, whose name or id contains it
 * (accents and case ignored). An empty query lists them all.
 */
export function pickerOptions(catalog: readonly CatalogObject[], kind: KnownCatalogType, query = ''): PickerOption[] {
  const needle = fold(query);
  return optionsOf(catalog, kind).filter((o) => needle === '' || fold(o.object.name).includes(needle) || o.object.id.includes(needle));
}

/**
 * The name «Create «…»» offers for `query`: the text as typed (trimmed), or `null` when it is empty
 * or an object of `kind` already has that name — then picking that object is the way.
 */
export function createName(catalog: readonly CatalogObject[], kind: KnownCatalogType, query: string): string | null {
  const name = query.trim();
  if (name === '') return null;
  return catalog.some((o) => o.type === kind && fold(o.name) === fold(name)) ? null : name;
}

/** What the value a reference holds resolves to. */
export type Resolution =
  | { readonly state: 'empty' }
  | { readonly state: 'object'; readonly object: CatalogObject; readonly label: string }
  /**
   * An id no object of `kind` has. `adoptable` when adopting it keeps it as the new object's id and
   * rewrites no BPMN (RM-01 § 2.3, `adoptReference`): of the id grammar, not a reserved name, and
   * no object of any type has it yet. The other values are rewritten across processes (#675).
   */
  | { readonly state: 'unresolved'; readonly id: string; readonly adoptable: boolean };

/**
 * Resolves `value` (a `roleRef` or `ref`) against the objects of `kind`, exactly as the engine's
 * usage index and lint do: a hand-written `" role-1 "` is not `role-1`, and is not adoptable either.
 * A value of spaces only is empty.
 */
export function resolveReference(catalog: readonly CatalogObject[], kind: KnownCatalogType, value: string | undefined): Resolution {
  const id = value ?? '';
  if (id.trim() === '') return { state: 'empty' };
  const option = optionsOf(catalog, kind).find((o) => o.object.id === id);
  if (option !== undefined) return { state: 'object', object: option.object, label: option.label };
  return { state: 'unresolved', id, adoptable: isAdoptableId(id) && !catalog.some((o) => o.id === id) };
}
