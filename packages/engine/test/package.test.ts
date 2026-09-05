import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * Lo que se publica en npm. `files` recorta el tarball y `exports` es el contrato
 * público: si un subpath apunta a algo que `files` no incluye —o que el build no
 * emite— el paquete se sube roto y la versión de npm ya no se puede corregir.
 */

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface EngineManifest {
  readonly exports: Record<string, string | Record<string, string>>;
  readonly files: readonly string[];
  readonly bin: Record<string, string>;
  readonly main: string;
  readonly types: string;
}

const manifest = JSON.parse(
  readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'),
) as EngineManifest;

/** Todos los ficheros a los que apunta `exports`, `main`, `types` y `bin`. */
function publishedTargets(): string[] {
  const targets = [manifest.main, manifest.types, ...Object.values(manifest.bin)];
  for (const entry of Object.values(manifest.exports)) {
    if (typeof entry === 'string') targets.push(entry);
    else targets.push(...Object.values(entry));
  }
  return [...new Set(targets)];
}

describe('lo que se publica', () => {
  test('todo destino de exports/main/types/bin existe tras el build', () => {
    const faltantes = publishedTargets().filter((target) => {
      try {
        return !statSync(join(PACKAGE_ROOT, target)).isFile();
      } catch {
        return true;
      }
    });
    expect(faltantes).toEqual([]);
  });

  test('todo destino queda dentro de `files`', () => {
    const raices = new Set(manifest.files);
    const fuera = publishedTargets().filter((target) => {
      const primero = target.replace(/^\.\//, '').split('/')[0] ?? '';
      return !raices.has(primero);
    });
    expect(fuera).toEqual([]);
  });

  test('`files` no arrastra fuentes ni pruebas', () => {
    expect(manifest.files).not.toContain('src');
    expect(manifest.files).not.toContain('test');
  });

  test('el bin es ejecutable y tiene shebang', () => {
    const bin = join(PACKAGE_ROOT, manifest.bin['lila'] ?? '');
    expect(readFileSync(bin, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
    expect(() => accessSync(bin, constants.X_OK)).not.toThrow();
  });
});
