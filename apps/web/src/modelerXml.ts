import { marcarExportador, sanitizeXmlIds } from '@lila/engine/bpmn';

const XML_ATTR = /(\s[A-Za-z_][A-Za-z0-9_.:-]*\s*=\s*)(?:"([^"]*)"|'([^']*)')/g;
const XML_ATTR_NOMBRADO = /\s([A-Za-z_][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const XML_TEXT = />([^<>]*)</g;
const TOPOLOGY_PROPERTIES = new Set([
  'bpmn:sourceRef',
  'bpmn:targetRef',
  'bpmn:attachedToRef',
  'bpmn:flowNodeRef',
  'bpmn:default',
]);
/**
 * Referencias que bpmn-moddle resuelve por id y descarta si no las encuentra: no llegan al
 * árbol, así que al reserializar desaparecen del archivo (LILA-192).
 */
const REFERENCIAS_POR_ID = new Set(['messageRef', 'dataStoreRef', 'categoryValueRef', 'dataObjectRef']);

export interface ImportableBpmn {
  importXML(xml: string): Promise<{ warnings: readonly unknown[] }>;
  destroy(): void;
}

export interface ImportacionPreparada<T> {
  candidato: T;
  originalIds: Map<string, string>;
  avisos: readonly unknown[];
  perdidas: string[];
  /** Ids que el original referencia sin declararlos: se pierden al exportar (LILA-192). */
  refsRotas: string[];
}

export interface OpcionesExportacion {
  /** Solo una acción explícita del usuario puede pedir la decisión visible. */
  interactivo?: boolean;
}

function warningMessage(warning: unknown): string {
  if (typeof warning === 'string') return warning;
  if (warning instanceof Error) return warning.message;
  if (typeof warning === 'object' && warning !== null && 'message' in warning) {
    return String(warning.message);
  }
  return String(warning);
}

/** Avisos que implican pérdida semántica al volver a serializar el árbol importado. */
export function advertenciasDePerdida(warnings: readonly unknown[]): string[] {
  return warnings.flatMap((warning) => {
    const record = typeof warning === 'object' && warning !== null ? warning : {};
    const property = 'property' in record ? String(record.property) : undefined;
    const message = warningMessage(warning).replace(/\s+/g, ' ').trim();
    const discarded = /unparsable content .*nested error: (?:illegal|duplicate) ID </i.test(message);
    const diagramOnly = /<(?:bpmndi|di|dc|dd):/i.test(message);
    if ((!diagramOnly && discarded) || (property !== undefined && TOPOLOGY_PROPERTIES.has(property))) {
      return [message];
    }
    return [];
  });
}

/**
 * Ids referenciados por `messageRef`, `dataStoreRef` o `categoryValueRef` que el propio archivo
 * no declara (LILA-192). bpmn-moddle no los puede resolver y los deja fuera del árbol, así que
 * el XML exportado ya no los lleva: el usuario tiene que enterarse antes de descargar. Se lee el
 * XML de origen —no el árbol— justamente porque ahí es donde todavía están.
 *
 * ponytail: comparación textual de atributos, como el resto de este módulo; no hay parser XML
 * en la app web. Techo: un id declarado dentro de un CDATA o de un comentario contaría como
 * declarado. Siguiente paso, si molesta: leerlos del `rootElement` de moddle.
 */
export function referenciasRotas(xml: string): string[] {
  const declarados = new Set<string>();
  const referidos: string[] = [];
  for (const coincidencia of xml.matchAll(XML_ATTR_NOMBRADO)) {
    const valor = (coincidencia[2] ?? coincidencia[3]) as string;
    const local = (coincidencia[1] as string).replace(/^[^:]*:/, '');
    if (local === 'id') declarados.add(valor);
    else if (REFERENCIAS_POR_ID.has(local)) referidos.push(valor);
  }
  return [...new Set(referidos)].filter((id) => !declarados.has(id));
}

/**
 * Importa en una instancia candidata. El llamador conserva la instancia activa hasta que esta
 * promesa resuelva, y por tanto un fallo no puede borrar ni su XML ni su command stack.
 */
export async function prepararImportacionTransaccional<T extends ImportableBpmn>(
  xml: string,
  crearCandidato: () => T,
): Promise<ImportacionPreparada<T>> {
  const preparado = sanitizeXmlIds(xml);
  const candidato = crearCandidato();
  try {
    const { warnings } = await candidato.importXML(preparado.xml);
    return {
      candidato,
      originalIds: preparado.sanitizedToOriginal,
      avisos: warnings,
      perdidas: advertenciasDePerdida(warnings),
      refsRotas: referenciasRotas(xml),
    };
  } catch (error: unknown) {
    candidato.destroy();
    throw error;
  }
}

function preservarEntidadesYEscapar(value: string, quote?: '"' | "'"): string {
  return value
    .replace(/&(?!(?:#\d+|#x[\da-f]+|[A-Za-z_:][A-Za-z0-9_.:-]*);)/gi, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&apos;');
}

/** Restaura ids y referencias exactas, incluidas las referencias BPMNDI y las textuales. */
export function restaurarXmlIds(xml: string, originalIds: ReadonlyMap<string, string>): string {
  if (originalIds.size === 0) return xml;

  return xml
    .replace(XML_ATTR, (attribute, prefix, doubleQuoted, singleQuoted) => {
      const value = (doubleQuoted ?? singleQuoted) as string;
      const original = originalIds.get(value);
      if (original === undefined) return attribute;
      const quote: '"' | "'" = doubleQuoted === undefined ? "'" : '"';
      return `${prefix}${quote}${preservarEntidadesYEscapar(original, quote)}${quote}`;
    })
    .replace(XML_TEXT, (text, value) => {
      const original = originalIds.get(value as string);
      return original === undefined ? text : `>${preservarEntidadesYEscapar(original)}<`;
    });
}

/**
 * Bloquea snapshots y simulaciones silenciosamente ante pérdida. La exportación explícita la
 * autoriza el usuario en el diálogo de `App.tsx` (LILA-192), que es donde puede leer la lista
 * de lo que se pierde; aquí solo se corta lo que ocurriría a sus espaldas.
 */
export function autorizarExportacion(
  perdidas: readonly string[],
  opciones: OpcionesExportacion = {},
): void {
  if (perdidas.length === 0 || opciones.interactivo === true) return;
  const detalle = perdidas.map((warning) => `• ${warning}`).join('\n');
  throw new Error(`Exportación bloqueada por contenido perdido:\n${detalle}`);
}

/**
 * Restituye identidad externa y marca inequívocamente la versión que escribió el archivo. La
 * marca la pone `marcarExportador` del motor (LILA-194): un único sitio escribe
 * `exporter`/`exporterVersion`, con la versión de `@lila/engine`, no la de esta app.
 */
export function finalizarExportacion(
  xml: string,
  originalIds: ReadonlyMap<string, string>,
): string {
  return marcarExportador(restaurarXmlIds(xml, originalIds));
}
