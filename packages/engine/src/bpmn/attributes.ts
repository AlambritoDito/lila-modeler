/**
 * Extended attributes (#509): user-defined properties per element type, the way Bizagi Modeler
 * has them. A `lila:attributeDefinition` declares one (name, type, element type it applies to,
 * optional default and, for a list, its options) and a `lila:attributeValue` fills it in on one
 * element (`docs/BPMN_EXTENSION.md` § 2.1).
 *
 * Pure and shared: the engine's reader/writer (`annotate.ts`), the process document and the web's
 * properties panel all use these rules, so a value that is valid in one place is valid in all.
 */

/** The value types an attribute can have. */
export const ATTRIBUTE_TYPES = ['text', 'number', 'list', 'date'] as const;
export type AttributeType = (typeof ATTRIBUTE_TYPES)[number];

/** The element types an attribute can apply to. `lane` covers pools (participants) and lanes. */
export const ELEMENT_CATEGORIES = ['task', 'gateway', 'event', 'subProcess', 'lane', 'process'] as const;
export type ElementCategory = (typeof ELEMENT_CATEGORIES)[number];

/** `lila:attributeDefinition`. `type` and `appliesTo` stay strings: a file may say anything. */
export interface AttributeDefinition {
  id: string;
  name: string;
  type: string;
  appliesTo: string;
  default?: string;
  /** Only meaningful for `type: 'list'`. */
  options?: string[];
}

/** `lila:attributeValue`: the value of the definition `ref` on the element that holds it. */
export interface AttributeValue {
  ref: string;
  value: string;
}

/** Why a value does not fit its definition. `null` from `validateAttributeValue` means it fits. */
export type AttributeValueProblem = 'number' | 'date' | 'option';

/** The element type of a BPMN `$type`, or `undefined` for what cannot carry attributes (flows, data, text). */
export function categoryOf(type: string): ElementCategory | undefined {
  if (type === 'bpmn:Process') return 'process';
  if (type === 'bpmn:Participant' || type === 'bpmn:Lane') return 'lane';
  if (/^bpmn:(SubProcess|Transaction|AdHocSubProcess|CallActivity)$/.test(type)) return 'subProcess';
  if (/^bpmn:\w*Task$/.test(type)) return 'task';
  if (/^bpmn:\w*Gateway$/.test(type)) return 'gateway';
  if (/^bpmn:\w*Event$/.test(type)) return 'event';
  return undefined;
}

/** A plain decimal: an optional `-`, digits, an optional `.` and more digits. `4.`, `+5`, `.5`, `1e3` and `4,5` are not. */
const NUMBER = /^-?\d+(\.\d+)?$/;
/** A calendar date, `YYYY-MM-DD`, the value an `<input type="date">` gives. */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Whether `value` fits `definition`. The empty string always fits (it means "not filled in").
 * Nothing is coerced: `1,5` is not read as `1.5`, and `2026-02-30` is not rolled over to March.
 */
export function validateAttributeValue(
  definition: Pick<AttributeDefinition, 'type' | 'options'>,
  value: string,
): AttributeValueProblem | null {
  if (value === '') return null;
  switch (definition.type) {
    case 'number':
      return NUMBER.test(value) ? null : 'number';
    case 'date': {
      const match = DATE.exec(value);
      if (match === null) return 'date';
      const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
      // `setUTCFullYear`, not `Date.UTC`: the latter maps years 0–99 to 1900–1999.
      const date = new Date(0);
      date.setUTCFullYear(year, month - 1, day);
      return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
        ? null
        : 'date';
    }
    case 'list':
      return (definition.options ?? []).includes(value) ? null : 'option';
    default:
      return null;
  }
}

/**
 * The attributes of one element as the reader sees them: every definition that applies to its
 * element type, with the element's own value or else the definition's default, in definition
 * order, leaving out the ones that end up empty; then the values whose definition is gone, under
 * their `ref`, so a value is never hidden just because its definition was removed by hand.
 */
export function effectiveAttributes(
  definitions: readonly AttributeDefinition[],
  category: ElementCategory | undefined,
  values: readonly AttributeValue[],
): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  const unique = uniqueDefinitions(definitions);
  const known = new Set(unique.map((d) => d.id));
  const own = (ref: string): string[] => values.filter((v) => v.ref === ref && v.value !== '').map((v) => v.value);
  if (category !== undefined) {
    for (const definition of unique) {
      if (definition.appliesTo !== category) continue;
      // Several values for one attribute (a hand-edited file) are all shown, never just the first.
      const mine = own(definition.id);
      const value = mine.length > 0 ? mine.join(', ') : (definition.default ?? '');
      if (value !== '') out.push({ name: definition.name || definition.id, value });
    }
  }
  for (const ref of new Set(values.map((v) => v.ref))) {
    const orphan = own(ref);
    if (!known.has(ref) && orphan.length > 0) out.push({ name: ref, value: orphan.join(', ') });
  }
  return out;
}

/**
 * The definitions with each `id` once, the first one winning: a pasted pool or a file edited by
 * hand can repeat a definition, and a repeat must not show an attribute twice.
 */
export function uniqueDefinitions<T extends Pick<AttributeDefinition, 'id'>>(definitions: readonly T[]): T[] {
  const seen = new Set<string>();
  return definitions.filter((d) => !seen.has(d.id) && seen.add(d.id) !== undefined);
}

/**
 * Why a definition cannot be saved, the rules of the app's attribute dialog (#633). `null` from
 * `attributeDefinitionProblems` means it can.
 * - `name`: the name is empty.
 * - `duplicate`: another definition for the same element type has that name (ignoring case).
 * - `type`, `appliesTo`: not a value of `ATTRIBUTE_TYPES` / `ELEMENT_CATEGORIES`.
 * - `options`: a `list` without options.
 * - `optionsNotList`: options on a type that is not `list`.
 * - `default`: the default does not fit (`validateAttributeValue`).
 */
export type AttributeDefinitionProblem =
  | { kind: 'name' | 'type' | 'appliesTo' | 'options' | 'optionsNotList' }
  | { kind: 'duplicate'; id: string }
  | { kind: 'default'; problem: AttributeValueProblem };

/**
 * `definition` as the app's dialog saves it: the name and the options trimmed, empty and repeated
 * options dropped (and `options` with them when none is left), an empty default left out.
 */
export function normalizeAttributeDefinition(definition: AttributeDefinition): AttributeDefinition {
  const { options, default: fallback, ...rest } = definition;
  const kept = [...new Set((options ?? []).map((o) => o.trim()).filter((o) => o !== ''))];
  return {
    ...rest,
    name: definition.name.trim(),
    ...(fallback === undefined || fallback === '' ? {} : { default: fallback }),
    ...(kept.length === 0 ? {} : { options: kept }),
  };
}

/**
 * The first reason `definition` (normalized) cannot sit next to `others`, or `null`. Only the
 * definition being saved is checked: a problem the file already had elsewhere does not block it.
 */
export function attributeDefinitionProblems(
  definition: AttributeDefinition,
  others: readonly AttributeDefinition[],
): AttributeDefinitionProblem | null {
  if (definition.name.trim() === '') return { kind: 'name' };
  if (!(ATTRIBUTE_TYPES as readonly string[]).includes(definition.type)) return { kind: 'type' };
  if (!(ELEMENT_CATEGORIES as readonly string[]).includes(definition.appliesTo)) return { kind: 'appliesTo' };
  if (definition.type === 'list' && (definition.options ?? []).length === 0) return { kind: 'options' };
  if (definition.type !== 'list' && definition.options !== undefined) return { kind: 'optionsNotList' };
  const name = definition.name.trim().toLowerCase();
  const twin = others.find((d) => d.id !== definition.id && d.appliesTo === definition.appliesTo && d.name.trim().toLowerCase() === name);
  if (twin !== undefined) return { kind: 'duplicate', id: twin.id };
  const problem = validateAttributeValue(definition, definition.default ?? '');
  return problem === null ? null : { kind: 'default', problem };
}

/**
 * The id of a new definition named `name` (#633): `Attr_` and the name as lowercase ASCII (accents
 * dropped, anything else `_`), then `_2`, `_3`… past the ids in `taken`. Deterministic, so a dry
 * run and the write that follows it name the attribute alike; always an NCName (ADR-012).
 */
export function attributeIdFor(name: string, taken: ReadonlySet<string>): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const base = `Attr_${slug === '' ? 'attribute' : slug}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}
