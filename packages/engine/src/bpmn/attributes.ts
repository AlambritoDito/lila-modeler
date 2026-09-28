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

/** A plain decimal: optional sign, digits, an optional `.` fraction. No thousands separators, no exponent. */
const NUMBER = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;
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
      const date = new Date(Date.UTC(year, month - 1, day));
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
  const known = new Set(definitions.map((d) => d.id));
  if (category !== undefined) {
    for (const definition of definitions) {
      if (definition.appliesTo !== category) continue;
      const own = values.find((v) => v.ref === definition.id)?.value;
      const value = own ?? definition.default ?? '';
      if (value !== '') out.push({ name: definition.name || definition.id, value });
    }
  }
  for (const orphan of values) {
    if (!known.has(orphan.ref) && orphan.value !== '') out.push({ name: orphan.ref, value: orphan.value });
  }
  return out;
}
