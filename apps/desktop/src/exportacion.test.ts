/**
 * `lila:exportar` is a trust boundary (#564): main writes what the renderer hands it. These pin
 * what the handler accepts — a plain file name, a known type, data of that type's kind, a size
 * cap — and the dialog filter it shows for each type, in both languages.
 */
import { describe, expect, it } from 'vitest';
import { filtroExportacion, MAX_EXPORTACION, requireExportacion } from './exportacion.js';
import { desktopStrings } from './strings/index.js';
import type { Exportacion } from './bridge.js';

const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
const rechaza = (value: unknown) => expect(() => requireExportacion(value)).toThrow(/^E-ARGUMENTO/);

describe('requireExportacion (#564)', () => {
  it('takes the results workbook and CSV and a theme, besides the diagram and the document', () => {
    expect(requireExportacion({ nombre: 'Base.template', tipo: 'xlsx', datos: bytes })).toEqual({ nombre: 'Base.template', tipo: 'xlsx', datos: bytes });
    expect(requireExportacion({ nombre: 'elements', tipo: 'csv', datos: 'a,b\n1,2\n' }).tipo).toBe('csv');
    expect(requireExportacion({ nombre: 'eva-01', tipo: 'json', datos: '{}' }).tipo).toBe('json');
    for (const tipo of ['svg', 'pdf', 'html'] as const) expect(requireExportacion({ nombre: 'd', tipo, datos: '<svg/>' }).tipo).toBe(tipo);
    for (const tipo of ['png', 'docx'] as const) expect(requireExportacion({ nombre: 'd', tipo, datos: bytes }).tipo).toBe(tipo);
  });

  it('bytes may come as an ArrayBuffer, and leave as a Uint8Array with the same content', () => {
    const { datos } = requireExportacion({ nombre: 'r', tipo: 'xlsx', datos: bytes.slice().buffer });
    expect(datos).toBeInstanceOf(Uint8Array);
    expect([...(datos as Uint8Array)]).toEqual([...bytes]);
  });

  it('refuses data of the wrong kind for its type', () => {
    rechaza({ nombre: 'r', tipo: 'xlsx', datos: 'PK' });
    rechaza({ nombre: 'r', tipo: 'xlsx', datos: [0x50, 0x4b] });
    rechaza({ nombre: 'r', tipo: 'csv', datos: bytes });
    rechaza({ nombre: 'r', tipo: 'json', datos: { name: 'x' } });
    rechaza({ nombre: 'r', tipo: 'xlsx' });
  });

  it('refuses an unknown type or none', () => {
    rechaza({ nombre: 'r', tipo: 'exe', datos: bytes });
    rechaza({ nombre: 'r', tipo: 'XLSX', datos: bytes });
    rechaza({ nombre: 'r', datos: 'x' });
    rechaza(null);
    rechaza('r.xlsx');
  });

  it('refuses a name that is not a plain file name', () => {
    for (const nombre of ['', '.', '..', '../evil', 'a/b', 'a\\b', 'C:x', 'r:Zone.Identifier', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0000b', 'a\nb', 'x'.repeat(201)]) {
      expect(() => requireExportacion({ nombre, tipo: 'csv', datos: 'x' }), JSON.stringify(nombre)).toThrow(/^E-ARGUMENTO/);
    }
    rechaza({ nombre: 7, tipo: 'csv', datos: 'x' });
    // What the renderer's `nombreArchivo` leaves is accepted: spaces, accents, dots inside.
    expect(requireExportacion({ nombre: 'Pedido vs Pedido rápido', tipo: 'xlsx', datos: bytes }).nombre).toBe('Pedido vs Pedido rápido');
    expect(requireExportacion({ nombre: 'x'.repeat(200), tipo: 'csv', datos: 'x' }).nombre).toHaveLength(200);
  });

  it('refuses data past the cap, as text or as bytes', () => {
    const grande = new Uint8Array(MAX_EXPORTACION + 1);
    rechaza({ nombre: 'r', tipo: 'xlsx', datos: grande });
    rechaza({ nombre: 'r', tipo: 'xlsx', datos: grande.buffer });
    rechaza({ nombre: 'r', tipo: 'csv', datos: 'x'.repeat(MAX_EXPORTACION + 1) });
    expect(requireExportacion({ nombre: 'r', tipo: 'xlsx', datos: grande.subarray(0, MAX_EXPORTACION) }).tipo).toBe('xlsx');
  });
});

describe('filtroExportacion (#564)', () => {
  const TIPOS: readonly Exportacion['tipo'][] = ['svg', 'png', 'pdf', 'docx', 'html', 'xlsx', 'csv', 'json'];

  it.each(['en', 'es'] as const)('names every type from the catalog, with its one extension (%s)', (locale) => {
    const D = desktopStrings(locale).dialogos;
    const filtros = TIPOS.map((tipo) => filtroExportacion(tipo, D));
    expect(filtros.map((f) => f.extensions)).toEqual(TIPOS.map((t) => [t]));
    for (const { name } of filtros) expect(Object.values(D)).toContain(name);
    expect(new Set(filtros.map((f) => f.name)).size).toBe(TIPOS.length);
  });

  it('the Spanish workbook filter is in Spanish', () => {
    expect(filtroExportacion('xlsx', desktopStrings('es').dialogos)).toEqual({ name: 'Libro de Excel', extensions: ['xlsx'] });
    expect(filtroExportacion('csv', desktopStrings('es').dialogos).name).toBe('Archivo CSV');
  });
});
