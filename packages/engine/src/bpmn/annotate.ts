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
  /** `lila:versionTag`, que cuelga del `bpmn:process`. */
  versionTag?: string;
}

/** `lila:responsibility` -> `lila:Responsibility`, `lila:systemRef` -> `lila:SystemRef`. */
function moddleType(tag: string): string {
  return `lila:${tag.charAt(0).toUpperCase()}${tag.slice(1)}`;
}

const RESPONSIBILITY_TYPE = moddleType('responsibility');
const VERSION_TAG_TYPE = moddleType('versionTag');
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
  throw new Error(
    `el archivo tiene contenido que bpmn-moddle no sabe reescribir y se perdería al guardarlo: ${detail}`,
  );
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
  for (const value of el.extensionElements?.values ?? []) {
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
    annotations.versionTag !== undefined
  ) {
    const existing = target.extensionElements?.values ?? [];
    const kept = existing.filter((value) => {
      if (value.$type === RESPONSIBILITY_TYPE) return annotations.responsibilities === undefined;
      if (value.$type === VERSION_TAG_TYPE) return annotations.versionTag === undefined;
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

    target.extensionElements = moddle.create('bpmn:ExtensionElements', {
      values: [...kept, ...added],
    });
  }

  const { xml: out } = await moddle.toXML(definitions, { format: true });
  return out;
}
