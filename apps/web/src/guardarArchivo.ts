/**
 * Saving an export the person asked for — the results' XLSX and CSV, the comparison workbook, the
 * scenario template, a theme — on either shell (#564).
 *
 * The desktop app hands the file to its main process, which asks where with its own native save
 * dialog and writes it, like the diagram and the process document (`window.lila.exportar`). These
 * used to go through a `blob:` link even there, so Chromium's download manager saved them: its
 * dialog was titled `blob:lila://app/<uuid>` and, on Windows, the file got the Internet zone mark
 * that opens it in Excel's Protected View. The web keeps the browser download.
 */
import { XLSX_MIME_TYPE } from '@lila-modeler/engine/xlsx-report';
import type { Exportacion } from '../../desktop/src/bridge.js';
import { nombreArchivo } from './exportarDiagrama';

/** What can be saved this way: text for CSV and JSON, bytes for the workbook. */
export type ArchivoExportado =
  | { readonly tipo: 'csv' | 'json'; readonly datos: string }
  | { readonly tipo: 'xlsx'; readonly datos: Uint8Array };

const MIME: Readonly<Record<ArchivoExportado['tipo'], string>> = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json',
  xlsx: XLSX_MIME_TYPE,
};

/**
 * Saves `archivo` as `nombre` (with its extension). Resolves to the path written on the desktop,
 * or `null` when the dialog was cancelled and on the web. The web download starts before this
 * returns, inside the click that asked for it.
 */
export function guardarArchivo(nombre: string, archivo: ArchivoExportado): Promise<string | null> {
  const lila = typeof window === 'undefined' ? undefined : window.lila;
  if (lila === undefined) {
    // `slice()` on the bytes: their `buffer` may be larger than the view.
    const datos = typeof archivo.datos === 'string' ? archivo.datos : archivo.datos.slice();
    // Revoked right after the click, as these exports always did (unlike the diagram's
    // `descargar`, which waits a task): the download has already taken the blob by then.
    const url = URL.createObjectURL(new Blob([datos], { type: MIME[archivo.tipo] }));
    try {
      const enlace = document.createElement('a');
      enlace.href = url;
      enlace.download = nombre;
      enlace.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    return Promise.resolve(null);
  }
  // The bridge takes the name without its extension, cleaned the way main checks it.
  const extension = `.${archivo.tipo}`;
  const base = nombre.toLowerCase().endsWith(extension) ? nombre.slice(0, -extension.length) : nombre;
  return lila.exportar({ nombre: nombreArchivo(base), ...archivo } satisfies Exportacion);
}

/**
 * {@link guardarArchivo} for a button: there is nowhere to show an error next to these, so a failed
 * write (on Windows, a workbook still open in Excel) is logged instead of left unhandled.
 */
export function guardarDesdeBoton(nombre: string, archivo: ArchivoExportado): Promise<void> {
  return guardarArchivo(nombre, archivo).then(() => undefined, (e: unknown) => {
    console.error(e);
  });
}
