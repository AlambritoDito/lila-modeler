/**
 * Catalog references on the live canvas (#675): sets the `lila:responsibility` / `lila:*Ref` values
 * of an element's business object to a given list, **outside the command stack**. A catalog delete
 * (*replace with*, *remove references*), an adopt that rewrites and their undo change the process
 * on the canvas this way, so its ⌘Z history is neither extended nor emptied (RM-01 § 3.4: the
 * catalog change is one operation of its own, undone by «Undo last catalog change»).
 *
 * Works on plain moddle objects — `Modeler.tsx` passes bpmn-js's — so `catalogLive.test.ts` covers
 * it without a canvas. The engine does the same rewrite on the XML of the processes that are not
 * on the canvas (`rewriteCatalogReferences`); what both must agree on is the list each element
 * ends up with, which is what `catalogDelete.referenceChanges` reads from the engine's result.
 */
import type { ElementReference, ReferenceChanges } from './catalogDelete';

/** A moddle element, as far as this file reads and writes it. */
export interface ModdleNode {
  $type: string;
  $parent?: unknown;
  id?: string;
  extensionElements?: (ModdleNode & { values?: ModdleNode[] }) | undefined;
  [property: string]: unknown;
}

const RESPONSIBILITY = 'lila:Responsibility';
/** The `lila:*` reference elements of RM-01 § 3.1 and the relation each is listed with. */
const RELATION_OF: Readonly<Record<string, string>> = {
  'lila:SystemRef': 'systemRef', 'lila:DocumentRef': 'documentRef', 'lila:Input': 'input', 'lila:Output': 'output',
  'lila:RiskRef': 'riskRef', 'lila:ControlRef': 'controlRef', 'lila:KpiRef': 'kpiRef',
};
const TYPE_OF: Readonly<Record<string, string>> = Object.fromEntries(Object.entries(RELATION_OF).map(([type, relation]) => [relation, type]));

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The reference a moddle value is, as the engine's usage index lists it, or `null` when it is none. */
export function referenceOf(value: ModdleNode): ElementReference | null {
  if (value.$type === RESPONSIBILITY) return { relation: `responsibility:${text(value['type'])}`, id: text(value['roleRef']) };
  const relation = Object.hasOwn(RELATION_OF, value.$type) ? RELATION_OF[value.$type] : undefined;
  return relation === undefined ? null : { relation, id: text(value['ref']) };
}

/** The moddle type and attributes of `reference`, or `null` for a relation this build does not write. */
function moddleOf(reference: ElementReference): { type: string; attributes: Record<string, string | undefined> } | null {
  if (reference.relation.startsWith('responsibility:')) {
    const raci = reference.relation.slice('responsibility:'.length);
    return { type: RESPONSIBILITY, attributes: { type: raci !== '' ? raci : undefined, roleRef: reference.id } };
  }
  const type = Object.hasOwn(TYPE_OF, reference.relation) ? TYPE_OF[reference.relation] : undefined;
  return type === undefined ? null : { type, attributes: { ref: reference.id } };
}

const same = (a: ElementReference, b: ElementReference): boolean => a.relation === b.relation && a.id === b.id;

/**
 * Makes the catalog references of `element` be `target`, in that order. A value that already says
 * what is wanted is kept as the object it is; one of the same kind is rewritten in place (it keeps
 * its other attributes); only then is a new one made with `create`. The other extension elements
 * stay where they are, the references where the first one was. An `extensionElements` left empty is
 * removed, as the engine removes it. Returns whether anything changed.
 */
export function setReferences(element: ModdleNode, target: readonly ElementReference[], create: (type: string, attributes: Record<string, unknown>) => ModdleNode): boolean {
  const holder = element.extensionElements;
  const values = holder?.values ?? [];
  const live = values.filter((value) => referenceOf(value) !== null);
  if (live.length === target.length && live.every((value, i) => same(referenceOf(value)!, target[i]!))) return false;

  const free = [...live];
  const take = (wanted: (value: ModdleNode) => boolean): ModdleNode | undefined => {
    const at = free.findIndex(wanted);
    return at < 0 ? undefined : free.splice(at, 1)[0];
  };
  const next: (ModdleNode | undefined)[] = target.map((reference) => take((value) => same(referenceOf(value)!, reference)));
  target.forEach((reference, i) => {
    if (next[i] !== undefined) return;
    const written = moddleOf(reference);
    if (written === null) return;
    const reused = take((value) => value.$type === written.type);
    if (reused !== undefined) Object.assign(reused, written.attributes);
    next[i] = reused ?? create(written.type, written.attributes);
  });

  const first = values.findIndex((value) => referenceOf(value) !== null);
  const others = values.filter((value) => referenceOf(value) === null);
  const at = first < 0 ? others.length : first;
  const merged = [...others.slice(0, at), ...next.filter((value) => value !== undefined), ...others.slice(at)];
  if (merged.length === 0) {
    delete element.extensionElements;
    return true;
  }
  const into = holder ?? create('bpmn:ExtensionElements', {});
  into.values = merged;
  into.$parent = element;
  for (const value of merged) value.$parent = into;
  element.extensionElements = into;
  return true;
}

/** Every element with an id under `node`, as the engine's reference scan walks a diagram. */
function* walk(node: ModdleNode, seen = new Set<ModdleNode>()): Generator<ModdleNode> {
  if (seen.has(node)) return;
  seen.add(node);
  if (typeof node.id === 'string') yield node;
  for (const property of ['rootElements', 'flowElements', 'participants', 'messageFlows', 'artifacts', 'laneSets', 'lanes', 'childLaneSet']) {
    const children = node[property];
    for (const child of Array.isArray(children) ? children : children === undefined ? [] : [children]) {
      if (child !== null && typeof child === 'object') yield* walk(child as ModdleNode, seen);
    }
  }
}

/**
 * Applies `changes` to the diagram under `definitions`. `idOf` gives the id an element has in the
 * exported XML (the canvas may hold a sanitised one). Returns the elements that changed.
 */
export function applyReferenceChanges(
  definitions: ModdleNode,
  changes: ReferenceChanges,
  create: (type: string, attributes: Record<string, unknown>) => ModdleNode,
  idOf: (element: ModdleNode) => string = (element) => element.id ?? '',
): ModdleNode[] {
  const changed: ModdleNode[] = [];
  if (changes.size === 0) return changed;
  for (const element of walk(definitions)) {
    const target = changes.get(idOf(element));
    if (target !== undefined && setReferences(element, target, create)) changed.push(element);
  }
  return changed;
}
