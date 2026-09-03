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

/** Una responsabilidad RACI: `lila:responsibility type="R" roleRef="rol-1"`. */
export interface Responsibility {
  type: string;
  roleRef: string;
}

/** Los `lila:*Ref` que son una simple referencia al catálogo, agrupados por tipo. */
export type Refs = Partial<Record<RefKind, string[]>>;

const REF_KINDS = [
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
}

/** `lila:responsibility` -> `lila:Responsibility`, `lila:systemRef` -> `lila:SystemRef`. */
function moddleType(tag: string): string {
  return `lila:${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;
}

const RESPONSIBILITY_TYPE = moddleType('responsibility');
const REF_TYPE_TO_KIND = new Map<string, RefKind>(REF_KINDS.map((k) => [moddleType(k), k]));

/** Recorre el árbol y devuelve todo elemento que tenga `id`, incluidos los anidados. */
function* walk(el: ModdleElement): Generator<ModdleElement> {
  if (typeof el.id === 'string') yield el;
  for (const child of [...(el.rootElements ?? []), ...(el.flowElements ?? [])]) {
    yield* walk(child);
  }
}

function readOne(el: ModdleElement): Annotations {
  const annotations: Annotations = {};

  const text = el.documentation?.[0]?.text;
  if (text !== undefined && text !== '') annotations.documentation = text;

  const responsibilities: Responsibility[] = [];
  const refs: Refs = {};
  for (const value of el.extensionElements?.values ?? []) {
    if (value.$type === RESPONSIBILITY_TYPE) {
      responsibilities.push({ type: value.type ?? '', roleRef: value.roleRef ?? '' });
      continue;
    }
    const kind = REF_TYPE_TO_KIND.get(value.$type);
    if (kind !== undefined) (refs[kind] ??= []).push(value.ref ?? '');
  }
  if (responsibilities.length > 0) annotations.responsibilities = responsibilities;
  if (Object.keys(refs).length > 0) annotations.refs = refs;

  return annotations;
}

/**
 * Lee las anotaciones de todo el archivo, keyed por id. Solo aparecen los elementos que tienen
 * algo que contar: un elemento sin documentación ni `lila:` no entra en el resultado.
 */
export async function readAnnotations(xml: string): Promise<Record<string, Annotations>> {
  const moddle = BpmnModdle({ lila });
  const { rootElement: definitions } = await moddle.fromXML(xml);

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
  const { rootElement: definitions } = await moddle.fromXML(xml);

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
    target.documentation = [
      moddle.create('bpmn:Documentation', { text: annotations.documentation }),
    ];
  }

  if (annotations.responsibilities !== undefined || annotations.refs !== undefined) {
    const existing = target.extensionElements?.values ?? [];
    const kept = existing.filter((value) => {
      if (value.$type === RESPONSIBILITY_TYPE) return annotations.responsibilities === undefined;
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

    target.extensionElements = moddle.create('bpmn:ExtensionElements', {
      values: [...kept, ...added],
    });
  }

  const { xml: out } = await moddle.toXML(definitions, { format: true });
  return out;
}
