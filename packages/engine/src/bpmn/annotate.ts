/**
 * Lectura y escritura de `bpmn:documentation` y de los elementos `lila:` dentro de
 * `bpmn:extensionElements` (ADR-013, `docs/BPMN_EXTENSION.md`).
 *
 * Vive fuera de `core/`, así que puede usar bpmn-moddle. Igual que `parse.ts`, trabaja con el
 * XML como cadena: no lee disco ni red.
 *
 * El `id` BPMN es la única clave: `annotateElement` localiza el elemento por su `id`, nunca
 * por su nombre.
 */
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';
import lila from './lila.moddle.json' with { type: 'json' };
import type { AttributeDefinition, AttributeValue } from './attributes.js';

/** Una responsabilidad RACI: `lila:responsibility type="R" roleRef="rol-1"`. */
export interface Responsibility {
  type: string;
  roleRef: string;
}

/** Los `lila:*Ref` que son una simple referencia al catálogo, agrupados por tipo. */
export type Refs = Partial<Record<RefKind, string[]>>;

/** The `lila:*Ref` kinds an element can carry, in the order `annotateElement` writes them. */
export const REF_KINDS = [
  'systemRef',
  'documentRef',
  'riskRef',
  'controlRef',
  'kpiRef',
  'input',
  'output',
] as const;

export type RefKind = (typeof REF_KINDS)[number];

/** `lila:` de un elemento, más su `bpmn:documentation`. */
export interface Annotations {
  documentation?: string;
  responsibilities?: Responsibility[];
  refs?: Refs;
  /** `lila:versionTag`, que cuelga del `bpmn:process`. */
  versionTag?: string;
  /**
   * `lila:attributeDefinition` (#509): the extended attributes declared on this element — the
   * `bpmn:collaboration` that hosts them, or the only `bpmn:process` of a diagram without one
   * (older files may carry them on a pool's process; readers take them from any root element).
   */
  attributeDefinitions?: AttributeDefinition[];
  /** `lila:attributeValue` (#509): this element's extended attribute values, in file order. */
  attributes?: AttributeValue[];
}

/** `lila:responsibility` -> `lila:Responsibility`, `lila:systemRef` -> `lila:SystemRef`. */
function moddleType(tag: string): string {
  return `lila:${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;
}

const RESPONSIBILITY_TYPE = moddleType('responsibility');
const VERSION_TAG_TYPE = moddleType('versionTag');
const DEFINITION_TYPE = moddleType('attributeDefinition');
const VALUE_TYPE = moddleType('attributeValue');

function readDefinition(value: ModdleElement): AttributeDefinition {
  const options = (value.options ?? []).map((option) => option.value ?? '');
  // `default` is typed as the gateway's default flow; on a `lila:attributeDefinition` it is text.
  const fallback: unknown = value.default;
  return {
    id: value.id ?? '',
    name: value.name ?? '',
    type: value.type ?? '',
    appliesTo: value.appliesTo ?? '',
    ...(typeof fallback === 'string' ? { default: fallback } : {}),
    ...(options.length === 0 ? {} : { options }),
  };
}
const REF_TYPE_TO_KIND = new Map<string, RefKind>(REF_KINDS.map((k) => [moddleType(k), k]));

/**
 * Recorre el árbol y devuelve todo elemento que tenga `id`, incluidos los anidados. Cubre lo que
 * `docs/BPMN_EXTENSION.md` §2 declara anotable: procesos, nodos de flujo (también dentro de
 * subprocesos), sequence flows, colaboraciones, participantes, message flows, lanes y artefactos.
 */
function* walk(el: ModdleElement): Generator<ModdleElement> {
  if (typeof el.id === 'string') yield el;
  const children = [
    ...(el.rootElements ?? []),
    ...(el.flowElements ?? []),
    ...(el.participants ?? []),
    ...(el.messageFlows ?? []),
    ...(el.artifacts ?? []),
    ...(el.laneSets ?? []),
    ...(el.lanes ?? []),
    ...(el.childLaneSet === undefined ? [] : [el.childLaneSet]),
  ];
  for (const child of children) yield* walk(child);
}

/**
 * bpmn-moddle DESCARTA en silencio lo que no sabe parsear (un elemento con un id duplicado, o
 * contenido no reconocido dentro de una extensión ajena) y lo reporta solo como `warning`. Si
 * reserializáramos ese árbol, el archivo del usuario perdería contenido sin que nadie se entere,
 * que es justo lo que ADR-021 prohíbe. Así que se convierte en error.
 *
 * ponytail: se aborta en vez de conservar el fragmento intacto. Techo: hay archivos reales de
 * Bizagi (`bizagi-miwg-B.2.0`) que hoy no se pueden anotar. Camino de mejora, cuando haga falta:
 * parchear el XML por rangos de texto en vez de reserializar el documento entero.
 */
function assertNoContentLoss(warnings: readonly unknown[]): void {
  if (warnings.length === 0) return;
  const detail = warnings
    .map((w) => (w instanceof Error ? w.message : String(w)))
    .join('; ');
  throw new AnnotationContentLossError(detail);
}

/**
 * The file has content bpmn-moddle cannot write back (see `assertNoContentLoss`). Its own class, so
 * a caller that speaks another language (the MCP server, #99) can say so in its own words; `detail`
 * is bpmn-moddle's text.
 */
export class AnnotationContentLossError extends Error {
  constructor(readonly detail: string) {
    super(`el archivo tiene contenido que bpmn-moddle no sabe reescribir y se perdería al guardarlo: ${detail}`);
    this.name = 'AnnotationContentLossError';
  }
}

/** An element `annotateElement` can reach: its BPMN `$type` and its `name` (`''` when it has none). */
export interface AnnotatableElement {
  type: string;
  name: string;
}

/**
 * Every element `annotateElement` can annotate, keyed by id (#99): what a caller checks an id
 * against before writing, and where the element type of an extended attribute comes from.
 * Throws `AnnotationContentLossError` where `annotateElement` would.
 */
export async function annotatableElements(xml: string): Promise<Record<string, AnnotatableElement>> {
  const moddle = BpmnModdle({ lila });
  const { rootElement: definitions, warnings } = await moddle.fromXML(xml);
  assertNoContentLoss(warnings);
  const result: Record<string, AnnotatableElement> = Object.create(null) as Record<string, AnnotatableElement>;
  for (const el of walk(definitions)) {
    if (!Object.hasOwn(result, el.id)) result[el.id] = { type: el.$type, name: typeof el.name === 'string' ? el.name : '' };
  }
  return result;
}

function readOne(el: ModdleElement): Annotations {
  const annotations: Annotations = {};

  // BPMN admite varios `bpmn:documentation` por elemento; se leen todos, en orden.
  const text = (el.documentation ?? [])
    .map((doc) => doc.text ?? '')
    .filter((t) => t !== '')
    .join('\n');
  if (text !== '') annotations.documentation = text;

  const responsibilities: Responsibility[] = [];
  const refs: Refs = {};
  const definitions: AttributeDefinition[] = [];
  const attributes: AttributeValue[] = [];
  for (const value of el.extensionElements?.values ?? []) {
    if (value.$type === DEFINITION_TYPE) {
      definitions.push(readDefinition(value));
      continue;
    }
    if (value.$type === VALUE_TYPE) {
      attributes.push({ ref: value.ref ?? '', value: value.value ?? '' });
      continue;
    }
    if (value.$type === RESPONSIBILITY_TYPE) {
      responsibilities.push({ type: value.type ?? '', roleRef: value.roleRef ?? '' });
      continue;
    }
    if (value.$type === VERSION_TAG_TYPE) {
      annotations.versionTag = value.value ?? '';
      continue;
    }
    const kind = REF_TYPE_TO_KIND.get(value.$type);
    if (kind !== undefined) (refs[kind] ??= []).push(value.ref ?? '');
  }
  if (responsibilities.length > 0) annotations.responsibilities = responsibilities;
  if (Object.keys(refs).length > 0) annotations.refs = refs;
  if (definitions.length > 0) annotations.attributeDefinitions = definitions;
  if (attributes.length > 0) annotations.attributes = attributes;

  return annotations;
}

/**
 * Lee las anotaciones de todo el archivo, keyed por id. Solo aparecen los elementos que tienen
 * algo que contar: un elemento sin documentación ni `lila:` no entra en el resultado.
 */
export async function readAnnotations(xml: string): Promise<Record<string, Annotations>> {
  const moddle = BpmnModdle({ lila });
  const { rootElement: definitions, warnings } = await moddle.fromXML(xml);
  assertNoContentLoss(warnings);

  const result: Record<string, Annotations> = {};
  for (const el of walk(definitions)) {
    const annotations = readOne(el);
    if (Object.keys(annotations).length > 0) result[el.id] = annotations;
  }
  return result;
}

/**
 * Escribe las anotaciones del elemento `id` y devuelve el XML resultante.
 *
 * Cada clave presente en `annotations` REEMPLAZA lo que hubiera de ese tipo; una clave ausente
 * deja intacto lo que ya estaba. Los elementos de extensión ajenos (`bizagi:`, `bpsim:`, …) se
 * conservan siempre: solo se tocan los `lila:` y la `bpmn:documentation`.
 *
 * ponytail: bpmn-moddle reserializa el documento entero, así que el "diff mínimo" que pide
 * LILA-022 es mínimo respecto de otra salida de bpmn-moddle, no respecto del XML escrito a
 * mano por otra herramienta. Techo: el primer guardado de un archivo ajeno reformatea el
 * documento. Camino de mejora, si algún día molesta: parchear el XML por rangos de texto en
 * vez de reserializar.
 */
export async function annotateElement(
  xml: string,
  id: string,
  annotations: Annotations,
): Promise<string> {
  const moddle = BpmnModdle({ lila });
  const { rootElement: definitions, warnings } = await moddle.fromXML(xml);
  assertNoContentLoss(warnings);

  let target: ModdleElement | undefined;
  for (const el of walk(definitions)) {
    if (el.id === id) {
      target = el;
      break;
    }
  }
  if (target === undefined) {
    throw new Error(`${id}: no existe ningún elemento con ese id en el archivo.`);
  }

  if (annotations.documentation !== undefined) {
    // La cadena vacía BORRA la documentación; si no, `readAnnotations` devolvería `undefined`
    // para algo que sí está escrito en el archivo.
    target.documentation =
      annotations.documentation === ''
        ? []
        : [moddle.create('bpmn:Documentation', { text: annotations.documentation })];
  }

  if (
    annotations.responsibilities !== undefined ||
    annotations.refs !== undefined ||
    annotations.versionTag !== undefined ||
    annotations.attributeDefinitions !== undefined ||
    annotations.attributes !== undefined
  ) {
    const existing = target.extensionElements?.values ?? [];
    const kept = existing.filter((value) => {
      if (value.$type === RESPONSIBILITY_TYPE) return annotations.responsibilities === undefined;
      if (value.$type === VERSION_TAG_TYPE) return annotations.versionTag === undefined;
      if (value.$type === DEFINITION_TYPE) return annotations.attributeDefinitions === undefined;
      if (value.$type === VALUE_TYPE) return annotations.attributes === undefined;
      const kind = REF_TYPE_TO_KIND.get(value.$type);
      if (kind === undefined) return true; // extensión ajena: intacta
      return annotations.refs?.[kind] === undefined;
    });

    const added: ModdleElement[] = [];
    for (const responsibility of annotations.responsibilities ?? []) {
      added.push(moddle.create(RESPONSIBILITY_TYPE, { ...responsibility }));
    }
    for (const kind of REF_KINDS) {
      for (const ref of annotations.refs?.[kind] ?? []) {
        added.push(moddle.create(moddleType(kind), { ref }));
      }
    }
    if (annotations.versionTag !== undefined && annotations.versionTag !== '') {
      added.push(moddle.create(VERSION_TAG_TYPE, { value: annotations.versionTag }));
    }
    for (const { options, ...definition } of annotations.attributeDefinitions ?? []) {
      // `default` goes in as text: see `readDefinition`.
      added.push(
        moddle.create(DEFINITION_TYPE, {
          ...definition,
          ...(options === undefined
            ? {}
            : { options: options.map((value) => moddle.create(moddleType('option'), { value })) }),
        }),
      );
    }
    for (const attribute of annotations.attributes ?? []) {
      added.push(moddle.create(VALUE_TYPE, { ...attribute }));
    }

    target.extensionElements = moddle.create('bpmn:ExtensionElements', {
      values: [...kept, ...added],
    });
  }

  const { xml: out } = await moddle.toXML(definitions, { format: true });
  return out;
}
