import { sanitizeXmlIds } from '@lila/engine/bpmn';
import webPackage from '../package.json' with { type: 'json' };

const XML_ATTR = /(\s[A-Za-z_][A-Za-z0-9_.:-]*\s*=\s*)(?:"([^"]*)"|'([^']*)')/g;
const XML_TEXT = />([^<>]*)</g;
const DEFINITIONS = /<(?:[A-Za-z_][A-Za-z0-9_.-]*:)?definitions\b[^>]*>/;
const TOPOLOGY_PROPERTIES = new Set([
  'bpmn:sourceRef',
  'bpmn:targetRef',
  'bpmn:attachedToRef',
  'bpmn:flowNodeRef',
  'bpmn:default',
]);

export interface ImportableBpmn {
  importXML(xml: string): Promise<{ warnings: readonly unknown[] }>;
  destroy(): void;
}

export interface ImportacionPreparada<T> {
  candidato: T;
  originalIds: Map<string, string>;
  avisos: readonly unknown[];
  perdidas: string[];
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
 * Bloquea snapshots y simulaciones silenciosamente ante pérdida. Solo una exportación explícita
 * puede abrir la decisión visible y continuar después de aceptarla.
 */
export function autorizarExportacion(
  perdidas: readonly string[],
  opciones: OpcionesExportacion = {},
  confirmar: (mensaje: string) => boolean = (mensaje) => window.confirm(mensaje),
): void {
  if (perdidas.length === 0) return;
  const detalle = perdidas.map((warning) => `• ${warning}`).join('\n');
  if (opciones.interactivo !== true) {
    throw new Error(`Exportación bloqueada por contenido perdido:\n${detalle}`);
  }
  const continuar = confirmar(
    `El archivo original contenía referencias o elementos que no se pudieron importar. ` +
      `Si exportas ahora, ese contenido se perderá:\n\n${detalle}\n\n¿Exportar de todos modos?`,
  );
  if (!continuar) throw new Error(`Exportación cancelada por contenido perdido:\n${detalle}`);
}

function escribirAtributo(tag: string, name: string, value: string): string {
  const attribute = new RegExp(`(\\s${name}\\s*=\\s*)(?:"[^"]*"|'[^']*')`);
  if (attribute.test(tag)) return tag.replace(attribute, `$1"${value}"`);
  return tag.replace(/>$/, ` ${name}="${value}">`);
}

/** Restituye identidad externa y marca inequívocamente la versión que escribió el archivo. */
export function finalizarExportacion(
  xml: string,
  originalIds: ReadonlyMap<string, string>,
): string {
  const restaurado = restaurarXmlIds(xml, originalIds);
  return restaurado.replace(DEFINITIONS, (tag) =>
    escribirAtributo(
      escribirAtributo(tag, 'exporter', 'Lila Modeler'),
      'exporterVersion',
      webPackage.version,
    ),
  );
}
