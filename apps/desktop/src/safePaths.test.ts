import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PathEscapeError, mimeFor, resolveWithin } from './safePaths.js';

const ROOT = sep === '\\' ? 'C:\\root' : '/root';

describe('resolveWithin', () => {
  it('acepta un archivo directamente dentro de la carpeta', () => {
    expect(resolveWithin(ROOT, 'archivo.txt')).toBe(`${ROOT}${sep}archivo.txt`);
  });

  it('acepta subcarpetas con tildes y espacios', () => {
    expect(resolveWithin(ROOT, 'carpeta ñoño/archivo con espacios.txt')).toBe(
      `${ROOT}${sep}carpeta ñoño${sep}archivo con espacios.txt`,
    );
  });

  it('rechaza ".." que se sale de la carpeta', () => {
    expect(() => resolveWithin(ROOT, '../secreto.txt')).toThrow(PathEscapeError);
  });

  it('rechaza ".." que se sale aunque vuelva a entrar', () => {
    expect(() => resolveWithin(ROOT, '../../etc/passwd')).toThrow(PathEscapeError);
  });

  it('rechaza una ruta absoluta', () => {
    const absoluta = sep === '\\' ? 'C:\\Windows\\System32\\config' : '/etc/passwd';
    expect(() => resolveWithin(ROOT, absoluta)).toThrow(PathEscapeError);
  });

  it('rechaza "%2e%2e" codificado que decodificado se sale de la carpeta', () => {
    expect(() => resolveWithin(ROOT, '%2e%2e/secreto.txt')).toThrow(PathEscapeError);
  });

  it('rechaza una mezcla de segmentos válidos y "%2e%2e" codificado', () => {
    expect(() => resolveWithin(ROOT, 'sub/%2e%2e/%2e%2e/secreto.txt')).toThrow(PathEscapeError);
  });

  it('rechaza el prefijo engañoso: una carpeta hermana no está "dentro"', () => {
    // /root2 comparte el prefijo de caracteres "/root" pero no es una subcarpeta de /root.
    expect(() => resolveWithin(ROOT, `../${ROOT.slice(ROOT.lastIndexOf(sep) + 1)}2/archivo.txt`)).toThrow(
      PathEscapeError,
    );
  });

  it('acepta la propia carpeta raíz (rel vacío resuelve a root)', () => {
    expect(resolveWithin(ROOT, '.')).toBe(ROOT);
  });
});

describe('mimeFor', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8'],
    ['app.js', 'text/javascript; charset=utf-8'],
    ['worker.mjs', 'text/javascript; charset=utf-8'],
    ['tokens.css', 'text/css; charset=utf-8'],
    ['eva-01.json', 'application/json; charset=utf-8'],
    ['icon.svg', 'image/svg+xml'],
    ['logo.png', 'image/png'],
    ['favicon.ico', 'image/x-icon'],
    ['bpmn.woff', 'font/woff'],
    ['bpmn.woff2', 'font/woff2'],
    ['bpmn.ttf', 'font/ttf'],
    ['app.js.map', 'application/json; charset=utf-8'],
    ['motor.wasm', 'application/wasm'],
    ['model.bpmn', 'application/xml'],
  ])('%s -> %s', (path, expected) => {
    expect(mimeFor(path)).toBe(expected);
  });

  it('usa application/octet-stream para extensiones desconocidas o ausentes', () => {
    expect(mimeFor('archivo.raro')).toBe('application/octet-stream');
    expect(mimeFor('archivo-sin-extension')).toBe('application/octet-stream');
  });
});
