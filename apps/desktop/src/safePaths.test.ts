import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PathEscapeError, isFlatName, isSymlink, mimeFor, resolveWithin } from './safePaths.js';

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

describe('isSymlink', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lila-isSymlink-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('false para un archivo regular', async () => {
    const archivo = join(dir, 'normal.txt');
    await writeFile(archivo, 'contenido', 'utf8');
    expect(await isSymlink(archivo)).toBe(false);
  });

  it('false para una ruta que no existe', async () => {
    expect(await isSymlink(join(dir, 'no-existe.txt'))).toBe(false);
  });

  it('true para un symlink, incluso si apunta a algo que no existe', async () => {
    const enlace = join(dir, 'enlace.txt');
    await symlink(join(dir, 'objetivo-inexistente.txt'), enlace);
    expect(await isSymlink(enlace)).toBe(true);
  });

  it('true para un symlink que apunta a un archivo real fuera de la carpeta', async () => {
    const fuera = await mkdtemp(join(tmpdir(), 'lila-isSymlink-fuera-'));
    try {
      const externo = join(fuera, 'secreto.txt');
      await writeFile(externo, 'secreto', 'utf8');
      const enlace = join(dir, 'enlace-fuera.txt');
      await symlink(externo, enlace);
      expect(await isSymlink(enlace)).toBe(true);
    } finally {
      await rm(fuera, { recursive: true, force: true });
    }
  });
});

describe('isFlatName (LILA-072, hallazgo 8 del QA)', () => {
  it('acepta un nombre con dos puntos seguidos: no es una subida de carpeta', () => {
    expect(isFlatName('ventas..v2.bpmn')).toBe(true);
    expect(isFlatName('informe..final.bpmn')).toBe(true);
    expect(isFlatName('..oculto.bpmn')).toBe(true);
    expect(isFlatName('.bpmn')).toBe(true); // un archivo llamado solo ".bpmn" es legítimo
  });

  it('rechaza separadores, vacío y las entradas de directorio . y ..', () => {
    expect(isFlatName('')).toBe(false);
    expect(isFlatName('.')).toBe(false);
    expect(isFlatName('..')).toBe(false);
    expect(isFlatName('sub/ventas.bpmn')).toBe(false);
    expect(isFlatName('..\\..\\etc\\passwd')).toBe(false);
    expect(isFlatName('../secreto.bpmn')).toBe(false);
  });
});
