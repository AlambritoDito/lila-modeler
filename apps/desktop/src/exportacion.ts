/**
 * The argument of `lila:exportar` (#451, #454, #564), checked where it crosses from the renderer.
 * Main writes what it is handed to the path the person picks in the native save dialog (or to
 * `LILA_E2E_EXPORT_FILE`), so the name, the type and the bytes are checked here, not trusted.
 * Pure, so it is tested without Electron; `main.ts` calls it from the IPC handler.
 */
import type { FileFilter } from 'electron';
import type { Exportacion } from './bridge.js';
import type { Strings } from './strings/index.js';

/** 64 MB: a PNG of a very large diagram at 2x is a few MB; anything past this is not an export. */
export const MAX_EXPORTACION = 64 * 1024 * 1024;

/** Types whose `datos` is text: SVG, and the SVG main prints to PDF; HTML; CSV; a theme's JSON. */
const TEXTO: ReadonlySet<string> = new Set(['svg', 'pdf', 'html', 'csv', 'json']);
/** Types whose `datos` is bytes: PNG, Word and Excel. */
const BYTES: ReadonlySet<string> = new Set(['png', 'docx', 'xlsx']);

/**
 * What no file name may hold: Windows' reserved characters and the control characters. A
 * separator would point the dialog's suggestion at another folder, and a `:` names an NTFS
 * stream. The renderer's `nombreArchivo` (`apps/web/src/exportarDiagrama.ts`) replaces exactly
 * these, so a name that arrives with one did not come through it.
 */
const PROHIBIDOS = /[\\/:*?"<>|\u0000-\u001f]/u;

/** 200: the extension main appends still fits in the 255 a file name can have. */
const MAX_NOMBRE = 200;

/**
 * Validates and normalises the argument of `lila:exportar`: a plain file name without its
 * extension, a known type, and `datos` of that type's kind under {@link MAX_EXPORTACION}. Bytes
 * may come as a `Uint8Array` or as an `ArrayBuffer`; they leave as a `Uint8Array`.
 */
export function requireExportacion(value: unknown): Exportacion {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const { nombre, tipo } = v;
  const datos = v.datos instanceof ArrayBuffer ? new Uint8Array(v.datos) : v.datos;
  const valido = typeof nombre === 'string' && nombre.length > 0 && nombre.length <= MAX_NOMBRE
    && !PROHIBIDOS.test(nombre) && nombre !== '.' && nombre !== '..'
    && typeof tipo === 'string'
    && (BYTES.has(tipo) ? datos instanceof Uint8Array : TEXTO.has(tipo) && typeof datos === 'string')
    && (datos as { length: number }).length <= MAX_EXPORTACION;
  if (!valido) {
    throw new Error('E-ARGUMENTO: "exportacion" debe ser { nombre, tipo: svg|png|pdf|docx|html|xlsx|csv|json, datos }.');
  }
  return { nombre, tipo, datos } as Exportacion;
}

/** The save dialog's file-type filter for an export, named in the app's language (#564). */
export function filtroExportacion(tipo: Exportacion['tipo'], D: Strings['dialogos']): FileFilter {
  const nombres: Record<Exportacion['tipo'], string> = {
    svg: D.tipoSvg, png: D.tipoPng, pdf: D.tipoPdf, docx: D.tipoDocx,
    html: D.tipoHtml, xlsx: D.tipoXlsx, csv: D.tipoCsv, json: D.tipoJson,
  };
  return { name: nombres[tipo], extensions: [tipo] };
}
