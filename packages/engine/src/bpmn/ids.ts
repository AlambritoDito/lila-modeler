// Generador y sanitizador de ids BPMN (política de ids, ADR-012 / docs/BPMN_EXTENSION.md
// sección 3). Vive fuera de packages/engine/src/core/, así que no hay restricción de
// dependencias — pero no necesita ninguna.

/** NCName válido: XML Name sin ":" (empieza por letra/"_", sigue con letras/dígitos/"_"/"-"/"."). */
const NCNAME_START = /^[A-Za-z_]/;
const NCNAME_INVALID_CHAR = /[^A-Za-z0-9_.-]/g;
// Sin la bandera `g`: un regex global guarda `lastIndex` entre llamadas y `test()` se
// vuelve intermitente. El de arriba solo se usa con `replace`, que sí la necesita.
const NCNAME_HAS_INVALID_CHAR = /[^A-Za-z0-9_.-]/;

export function isNCName(id: string): boolean {
  return id.length > 0 && NCNAME_START.test(id) && !NCNAME_HAS_INVALID_CHAR.test(id);
}

const SUFFIX_LENGTH = 12;

// ponytail: el sufijo usa Math.random, no un generador criptográfico ni un contador
// centralizado. Está bien: este archivo no es parte del motor determinista (esa
// prohibición de Math.random aplica solo a packages/engine/src/core/), y un id de
// elemento no necesita ser impredecible, solo no colisionar en la práctica (12
// caracteres base36 ⇒ colisión en 10 000 ids generados es, en la práctica, imposible).
function randomSuffix(): string {
  let suffix = '';
  while (suffix.length < SUFFIX_LENGTH) {
    suffix += Math.random().toString(36).slice(2);
  }
  return suffix.slice(0, SUFFIX_LENGTH);
}

/**
 * Genera un id NCName nuevo con prefijo por tipo, p. ej. `newId('Task')` -> `Task_7f3k2q1a9c4`.
 * `type` es el prefijo (sin "_"): `Start`, `End`, `Task`, `Gateway`, `Timer`, `Flow`,
 * `SubProcess`, u otro que el IR necesite (lista no exhaustiva, crece con el IR).
 * Nunca se regenera un id existente (ver BPMN_EXTENSION.md sección 3); esta función solo
 * produce ids para elementos nuevos.
 */
export function newId(type: string): string {
  return `${type}_${randomSuffix()}`;
}

/**
 * Sanitiza a NCName los ids de `ids` que no son NCName válidos (p. ej. ids que empiezan
 * por dígito, como los que puede emitir Bizagi) y devuelve el mapa `idSanitizado ->
 * idOriginal` (solo para los ids que se tocaron; un id ya válido no aparece en el mapa,
 * conserva su valor). La sanitización es determinista: mismo id de entrada, mismo id de
 * salida. Dos ids originales distintos nunca terminan en el mismo id sanitizado — ante
 * colisión se agrega un sufijo numérico (`_2`, `_3`, ...).
 */
export function sanitizeIds(ids: readonly string[]): Map<string, string> {
  const sanitizedToOriginal = new Map<string, string>();
  // Los ids ya válidos reservan su propio nombre: un id sanitizado nunca puede
  // pisar a un id original que no necesitó sanitizarse.
  const used = new Set<string>(ids.filter(isNCName));

  for (const original of ids) {
    if (isNCName(original)) continue;

    let candidate = original.replace(NCNAME_INVALID_CHAR, '_');
    if (candidate.length === 0 || !NCNAME_START.test(candidate)) {
      candidate = `_${candidate}`;
    }

    let sanitized = candidate;
    let attempt = 2;
    while (used.has(sanitized)) {
      sanitized = `${candidate}_${attempt}`;
      attempt += 1;
    }

    used.add(sanitized);
    sanitizedToOriginal.set(sanitized, original);
  }

  return sanitizedToOriginal;
}

/** Cualquier valor de atributo XML `algo="..."`, para recolectar candidatos a id. */
const ID_ATTR = /\bid="([^"]*)"/g;

/**
 * Sanitiza los ids no-NCName directamente en el texto del XML, antes de dárselo a
 * bpmn-moddle.
 *
 * bpmn-moddle (vía `moddle-xml`) valida el atributo `id` contra la gramática XML Name en el
 * momento de leer cada elemento y, si no es válido, descarta el elemento entero como
 * "unparsable content" (queda como warning, no como excepción — pero el elemento y todo su
 * contenido, incluidas sus `bizagi:*` de `extensionElements`, desaparecen del árbol). Un id
 * inválido nunca llega a existir como `ModdleElement.id`, así que sanitizar después de
 * `fromXML` no tiene nada que sanitizar: hay que reescribir el XML primero.
 *
 * Devuelve el XML con cada id no-NCName reemplazado por su versión sanitizada (determinista,
 * vía `sanitizeIds`) en toda posición donde aparece como valor completo de atributo
 * (`id="..."`, pero también `sourceRef="..."`, `targetRef="..."`, `default="..."`,
 * `bpmnElement="..."`, etc. — cualquier atributo que referencie el id) o como contenido de
 * texto de un elemento (`<bpmn:flowNodeRef>...</bpmn:flowNodeRef>`), junto con el mapa
 * `idSanitizado -> idOriginal` (vacío si no había nada que sanitizar).
 *
 * ponytail: reemplazo de texto con regex, no un recorrido XML real. Techo: no reescribe un id
 * dentro de una lista separada por espacios (p. ej. `dataInputRefs="a b c"` con `b` inválido);
 * no aparece en los fixtures de Bizagi conocidos. Camino: si aparece un caso real, tokenizar
 * esos atributos por espacio antes de reemplazar.
 */
export function sanitizeXmlIds(xml: string): {
  xml: string;
  sanitizedToOriginal: Map<string, string>;
} {
  const ids = new Set<string>();
  for (const match of xml.matchAll(ID_ATTR)) ids.add(match[1] as string);

  const sanitizedToOriginal = sanitizeIds([...ids]);
  if (sanitizedToOriginal.size === 0) return { xml, sanitizedToOriginal };

  let out = xml;
  for (const [candidate, original] of sanitizedToOriginal) {
    const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out
      .replace(new RegExp(`="${escaped}"`, 'g'), `="${candidate}"`)
      .replace(new RegExp(`>${escaped}<`, 'g'), `>${candidate}<`);
  }

  return { xml: out, sanitizedToOriginal };
}
