/**
 * Extended attribute definitions of a process of a `.lila`, without the app (#633): define one
 * (`define_attribute`, `lila process attribute define`), list them (`lila process attribute list`,
 * and `get_project` per process). `annotate_element` fills the values in.
 *
 * The rules are the app's attribute dialog's (`attributeDefinitionProblems`), and so is where they
 * are written (`writeAttributeDefinitions`): the collaboration, else the process, with copies
 * elsewhere consolidated there. Retyping a definition, moving it to another element type or taking
 * options away removes the values that no longer fit, as the dialog's «clear» does, and removing a
 * definition removes its values; both are reported in `removedValues`, by a dry run too. A rename
 * keeps every value: values point to the definition by id.
 */
import {
  AnnotationContentLossError,
  ATTRIBUTE_TYPES,
  ELEMENT_CATEGORIES,
  annotatableElements,
  attributeDefinitionProblems,
  attributeIdFor,
  categoryOf,
  normalizeAttributeDefinition,
  readAnnotations,
  uniqueDefinitions,
  validateAttributeValue,
  writeAttributeDefinitions,
  type AnnotatableElement,
  type Annotations,
  type AttributeDefinition,
} from '../bpmn/index.js';
import { agentToolMessages, type Locale } from '../messages/index.js';
import { definitionList, readElements, withModelXml, type LilaTarget } from './agent-tools.js';
import { lilaWritten, openLilaProcess, writeLilaProject } from './input.js';

export interface DefineAttributeRequest extends LilaTarget {
  /** The definition to change or remove. Left out: found by `name` and `appliesTo`, or created. */
  readonly id?: string | undefined;
  readonly name?: string | undefined;
  /** `text`, `number`, `list` or `date`. */
  readonly type?: string | undefined;
  /** `task`, `gateway`, `event`, `subProcess`, `lane` (pools and lanes) or `process`. */
  readonly appliesTo?: string | undefined;
  /** A `list`'s options (trimmed, empty and repeated ones dropped); refused on any other type. */
  readonly options?: readonly string[] | undefined;
  /** What an element without its own value shows; it has to fit the definition. */
  readonly default?: string | undefined;
  /** Removes the definition and every value it has. */
  readonly remove?: boolean | undefined;
  readonly dryRun?: boolean | undefined;
}

/** A value `define_attribute` removed (or, on a dry run, would remove). */
export interface RemovedAttributeValue {
  readonly elementId: string;
  readonly value: string;
}

export interface DefineAttributeResult {
  readonly file: string;
  readonly process: string;
  readonly dryRun: boolean;
  /** `false`: the project already said this, and nothing was (or would be) written. */
  readonly changed: boolean;
  /** `true` when the `.lila` was saved. */
  readonly written: boolean;
  /** The definition before the call; `null` when it is new. */
  readonly before: AttributeDefinition | null;
  /** The definition after it; `null` when it was removed. */
  readonly after: AttributeDefinition | null;
  readonly removedValues: readonly RemovedAttributeValue[];
  /** Every definition of the process after the call. */
  readonly definitions: readonly AttributeDefinition[];
}

/** Where the definitions live: the collaboration's id, else the first process's (`writeAttributeDefinitions`). */
function hostOf(elements: Readonly<Record<string, AnnotatableElement>>): string | undefined {
  const ids = Object.keys(elements);
  return ids.find((id) => elements[id]!.type === 'bpmn:Collaboration') ?? ids.find((id) => elements[id]!.type === 'bpmn:Process');
}

/**
 * The definitions of a model as the app reads them: each id once, the canonical place's copy
 * first, then the collaborations', the processes' and the rest, in file order. `stray` is whether
 * any copy sits outside the canonical place or repeats an id: saving tidies that up.
 */
function definitionsIn(
  elements: Readonly<Record<string, AnnotatableElement>>,
  annotations: Readonly<Record<string, Annotations>>,
): { definitions: AttributeDefinition[]; stray: boolean } {
  const host = hostOf(elements);
  const rank = (id: string): number =>
    id === host ? 0 : elements[id]?.type === 'bpmn:Collaboration' ? 1 : elements[id]?.type === 'bpmn:Process' ? 2 : 3;
  const owners = Object.keys(annotations)
    .filter((id) => (annotations[id]!.attributeDefinitions ?? []).length > 0)
    .sort((a, b) => rank(a) - rank(b));
  const all = owners.flatMap((id) => annotations[id]!.attributeDefinitions!);
  const definitions = uniqueDefinitions(all);
  return { definitions, stray: owners.some((id) => id !== host) || all.length !== definitions.length };
}

/** Every `id="…"` of the file, so a new definition's id never repeats one (bpmn-moddle drops repeats). */
function idsOf(xml: string): Set<string> {
  return new Set([...xml.matchAll(/\sid\s*=\s*(["'])(.*?)\1/g)].map((match) => match[2]!));
}

function same(a: AttributeDefinition | null, b: AttributeDefinition | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.type === b.type &&
    a.appliesTo === b.appliesTo &&
    (a.default ?? '') === (b.default ?? '') &&
    JSON.stringify(a.options ?? []) === JSON.stringify(b.options ?? [])
  );
}

/** Throws, in the caller's language, the first reason `definition` cannot be saved next to `others`. */
function checkDefinition(definition: AttributeDefinition, others: readonly AttributeDefinition[], locale: Locale): void {
  const T = agentToolMessages(locale);
  const problem = attributeDefinitionProblems(definition, others);
  if (problem === null) return;
  const { name } = definition;
  switch (problem.kind) {
    case 'name':
      throw new Error(T.attributeNameEmpty());
    case 'type':
      throw new Error(T.attributeTypeUnknown(definition.type, ATTRIBUTE_TYPES.join(', ')));
    case 'appliesTo':
      throw new Error(T.attributeAppliesToUnknown(definition.appliesTo, ELEMENT_CATEGORIES.join(', ')));
    case 'options':
      throw new Error(T.attributeNoOptions(name));
    case 'optionsNotList':
      throw new Error(T.attributeOptionsNotList(name, definition.type));
    case 'duplicate':
      throw new Error(T.attributeDuplicate(name, definition.appliesTo, problem.id));
    case 'default': {
      const value = definition.default ?? '';
      if (problem.problem === 'number') throw new Error(T.attributeNumber(name, value));
      if (problem.problem === 'date') throw new Error(T.attributeDate(name, value));
      throw new Error(T.attributeOption(name, value, (definition.options ?? []).join(', ') || T.none()));
    }
  }
}

/** Defines, changes or removes one extended attribute of one process of a `.lila` (#633); see `DefineAttributeRequest`. */
export async function defineLilaAttribute(request: DefineAttributeRequest): Promise<DefineAttributeResult> {
  const locale = request.locale ?? 'en';
  const T = agentToolMessages(locale);
  const remove = request.remove === true;
  const { id, name, type, appliesTo } = request;
  if (remove && id === undefined && (name === undefined || appliesTo === undefined)) throw new Error(T.attributeRemoveTarget());
  if (!remove && (name === undefined || type === undefined || appliesTo === undefined)) throw new Error(T.attributeIncomplete());
  const lila = await openLilaProcess(request.file, { process: request.process, locale });
  const xml = lila.process.model.xml;
  const { elements, annotations } = await readElements(xml, locale);
  const { definitions: current, stray } = definitionsIn(elements, annotations);

  const key = name?.trim().toLowerCase();
  const before =
    (id !== undefined
      ? current.find((d) => d.id === id)
      : current.find((d) => d.appliesTo === appliesTo && d.name.trim().toLowerCase() === key)) ?? null;
  if (id !== undefined && before === null && !remove) throw new Error(T.attributeUnknownId(id, definitionList(current, locale)));
  const others = current.filter((d) => d !== before);

  let after: AttributeDefinition | null = null;
  if (!remove) {
    after = normalizeAttributeDefinition({
      id: before?.id ?? attributeIdFor(name!, idsOf(xml)),
      name: name!,
      type: type!,
      appliesTo: appliesTo!,
      ...(request.default === undefined ? {} : { default: request.default }),
      ...(request.options === undefined ? {} : { options: [...request.options] }),
    });
    checkDefinition(after, others, locale);
  }

  // Values that no longer fit: all of a removed definition's; after a retype, a move to another
  // element type or options taken away, the ones that do not fit any more (the dialog's «clear»).
  const reshaped =
    before !== null &&
    (after === null ||
      after.type !== before.type ||
      after.appliesTo !== before.appliesTo ||
      (before.options ?? []).some((option) => !(after!.options ?? []).includes(option)));
  const drops = (elementId: string, ref: string, value: string): boolean =>
    reshaped &&
    ref === before!.id &&
    (after === null ||
      categoryOf(elements[elementId]?.type ?? '') !== after.appliesTo ||
      validateAttributeValue(after, value) !== null);
  const removedValues: RemovedAttributeValue[] = [];
  for (const [elementId, own] of Object.entries(annotations)) {
    for (const { ref, value } of own.attributes ?? []) if (drops(elementId, ref, value)) removedValues.push({ elementId, value });
  }

  const definitions = after === null ? others : before === null ? [...current, after] : current.map((d) => (d === before ? after! : d));
  // Copies outside the canonical place (or repeated) are consolidated by any save, as in the app.
  const changed = !same(before, after) || removedValues.length > 0 || stray;
  const dryRun = request.dryRun === true;
  let written: ReturnType<typeof lilaWritten> | null = null;
  if (changed) {
    let next: string;
    try {
      next = await writeAttributeDefinitions(xml, definitions, (value) => drops(value.elementId, value.ref, value.value));
    } catch (error) {
      if (error instanceof AnnotationContentLossError) throw new Error(T.contentLoss(error.detail));
      throw error;
    }
    if (!dryRun) written = lilaWritten(lila, await writeLilaProject(lila, withModelXml(lila.document, lila.process.slug, next), locale));
  }
  return {
    file: lila.file,
    // The slug in the file as written (#613): a one-process version 2 archive is version 1 after it.
    process: written === null ? lila.process.slug : written.slug,
    dryRun,
    changed,
    written: written !== null,
    before,
    after,
    removedValues,
    definitions,
  };
}

export interface LilaAttributeList {
  readonly file: string;
  readonly process: string;
  readonly definitions: readonly AttributeDefinition[];
}

/** The extended attributes one process of a `.lila` defines, as the app reads them (`lila process attribute list`). */
export async function lilaAttributeList(target: LilaTarget): Promise<LilaAttributeList> {
  const locale = target.locale ?? 'en';
  const lila = await openLilaProcess(target.file, { process: target.process, locale });
  const { elements, annotations } = await readElements(lila.process.model.xml, locale);
  return { file: lila.file, process: lila.process.slug, definitions: definitionsIn(elements, annotations).definitions };
}

/**
 * The definitions of a model for `get_project` (#633); `null` when the model cannot be read back
 * whole (bpmn-moddle would lose content, as with some Bizagi exports) or cannot be read at all.
 */
export async function attributeDefinitionsOf(xml: string): Promise<AttributeDefinition[] | null> {
  try {
    return definitionsIn(await annotatableElements(xml), await readAnnotations(xml)).definitions;
  } catch {
    return null;
  }
}
