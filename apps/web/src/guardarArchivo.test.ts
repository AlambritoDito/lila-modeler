// @vitest-environment jsdom
/**
 * #564: an export goes through the desktop app's own save dialog (`window.lila.exportar`) when the
 * bridge is there, and through the browser download when it is not. Before, the results' XLSX and
 * CSV, the comparison, the scenario template and a theme went through a `blob:` link on both, so
 * on the desktop Chromium's download manager saved them (a `blob:` dialog title, and on Windows the
 * Internet zone mark that opens Excel in Protected View).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XLSX_MIME_TYPE } from '@lila-modeler/engine/xlsx-report';
import type { Exportacion } from '../../desktop/src/bridge.js';
import { guardarArchivo, guardarDesdeBoton } from './guardarArchivo';
import { downloadCsv, downloadXlsx } from './ResultsView';

const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
let blobs: Blob[];
let enlaces: HTMLAnchorElement[];

beforeEach(() => {
  blobs = [];
  enlaces = [];
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (b: Blob) => { blobs.push(b); return 'blob:lila://app/x'; },
    revokeObjectURL: () => {},
  }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { enlaces.push(this); });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A desktop bridge whose `exportar` answers `ruta`. */
function escritorio(ruta: string | null = '/Users/x/r.xlsx') {
  const exportar = vi.fn(async (_exportacion: Exportacion) => ruta);
  vi.stubGlobal('lila', { exportar });
  return exportar;
}

describe('on the web (no bridge)', () => {
  it('downloads through a blob link, inside the click, with the type and the name it is given', async () => {
    const promesa = guardarArchivo('Base.xlsx', { tipo: 'xlsx', datos: bytes });
    // Started before the promise settles: a browser only allows the download inside the click.
    expect(enlaces.map((a) => a.download)).toEqual(['Base.xlsx']);
    expect(await promesa).toBeNull();
    expect(blobs[0]!.type).toBe(XLSX_MIME_TYPE);
    expect(new Uint8Array(await blobs[0]!.arrayBuffer())).toEqual(bytes);
  });

  it('CSV and a theme carry their own types', async () => {
    await guardarArchivo('elements.csv', { tipo: 'csv', datos: 'a,b\n' });
    await guardarArchivo('eva-01.json', { tipo: 'json', datos: '{}\n' });
    expect(blobs.map((b) => b.type)).toEqual(['text/csv;charset=utf-8', 'application/json']);
    expect(enlaces.map((a) => a.download)).toEqual(['elements.csv', 'eva-01.json']);
  });
});

describe('in the desktop app (bridge present)', () => {
  it('hands the bytes to main through `exportar`, without the extension, and downloads nothing', async () => {
    const exportar = escritorio('/Users/x/Base.template.xlsx');
    expect(await guardarArchivo('Base.template.xlsx', { tipo: 'xlsx', datos: bytes })).toBe('/Users/x/Base.template.xlsx');
    expect(exportar).toHaveBeenCalledWith({ nombre: 'Base.template', tipo: 'xlsx', datos: bytes });
    expect(blobs).toEqual([]);
    expect(enlaces).toEqual([]);
  });

  it('cleans the name the way main checks it: no separators, no reserved characters', async () => {
    const exportar = escritorio();
    await guardarArchivo('A/B vs C:D.xlsx', { tipo: 'xlsx', datos: bytes });
    await guardarArchivo('elements', { tipo: 'csv', datos: 'a\n' });
    expect(exportar.mock.calls.map(([e]) => e.nombre)).toEqual(['A-B vs C-D', 'elements']);
  });

  it('the results buttons take that path: XLSX and CSV reach `exportar`', async () => {
    const exportar = escritorio();
    await downloadXlsx('Base.xlsx', bytes);
    await downloadCsv('elements.csv', 'a,b\n');
    expect(exportar.mock.calls.map(([e]) => [e.tipo, e.nombre]))
      .toEqual([['xlsx', 'Base'], ['csv', 'elements']]);
    expect(blobs).toEqual([]);
  });

  it('a failed write from a button is logged, not left unhandled', async () => {
    vi.stubGlobal('lila', { exportar: vi.fn(async () => { throw new Error('EBUSY: resource busy or locked'); }) });
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(guardarDesdeBoton('Base.xlsx', { tipo: 'xlsx', datos: bytes })).resolves.toBeUndefined();
    expect(consola).toHaveBeenCalledWith(expect.objectContaining({ message: 'EBUSY: resource busy or locked' }));
    await expect(guardarArchivo('Base.xlsx', { tipo: 'xlsx', datos: bytes })).rejects.toThrow('EBUSY');
  });
});
