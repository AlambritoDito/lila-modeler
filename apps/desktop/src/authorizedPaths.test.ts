/**
 * Tests de `authorizedPaths.ts` con carpetas reales (`mkdtemp`), sin Electron: es la costura que
 * el segundo QA a #323 atravesó con la app real por CDP (H1-H4) y que ninguna prueba cubría,
 * porque todas llamaban a `writeLilaFile` directamente y nunca al camino del handler.
 */
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireAuthorizedPath, resolveAuthorizedPath } from './authorizedPaths.js';

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'lila-auth-')));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Lo mismo que `lila:chooseSaveFile` mete en el conjunto de rutas autorizadas. */
async function autorizar(file: string): Promise<string> {
  return join(await realpath(dirname(file)), basename(file));
}

describe('requireAuthorizedPath', () => {
  it('autoriza un .lila que TODAVIA no existe dentro de una carpeta que si (hallazgo 1 del QA)', async () => {
    const nuevo = join(dir, 'nuevo.lila');
    const autorizado = await autorizar(nuevo);
    expect(autorizado).toBe(nuevo);
    await expect(requireAuthorizedPath(new Set([autorizado]), autorizado)).resolves.toBe(autorizado);
  });

  it('sigue autorizando el mismo .lila una vez escrito', async () => {
    const nuevo = join(dir, 'nuevo.lila');
    await expect(requireAuthorizedPath(new Set([nuevo]), nuevo)).resolves.toBe(nuevo);
    await writeFile(nuevo, 'PK', 'utf8');
    await expect(requireAuthorizedPath(new Set([nuevo]), nuevo)).resolves.toBe(nuevo);
  });

  it('rechaza una ruta hermana en la misma carpeta y una de otra carpeta (H3/H4 del QA)', async () => {
    const autorizadas = new Set([join(dir, 'nuevo.lila')]);
    const otra = await realpath(await mkdtemp(join(tmpdir(), 'lila-auth-otra-')));
    await expect(requireAuthorizedPath(autorizadas, join(dir, 'hermano.lila'))).rejects.toThrow('E-NO-AUTORIZADO');
    await expect(requireAuthorizedPath(autorizadas, join(otra, 'nuevo.lila'))).rejects.toThrow('E-NO-AUTORIZADO');
    await rm(otra, { recursive: true, force: true });
  });

  it('rechaza una carpeta autorizada que ya no existe, y un .lila cuya carpeta desaparecio', async () => {
    const sub = join(dir, 'sub');
    await mkdir(sub);
    const archivo = join(sub, 'nuevo.lila');
    await rm(sub, { recursive: true, force: true });
    await expect(requireAuthorizedPath(new Set([sub]), sub)).rejects.toThrow('ya no existe');
    await expect(requireAuthorizedPath(new Set([archivo]), archivo)).rejects.toThrow('ya no existe');
  });

  it('rechaza una ruta que cambio de identidad (symlink) y un argumento que no es ruta', async () => {
    const real = join(dir, 'real');
    await mkdir(real);
    const enlace = join(dir, 'enlace');
    await symlink(real, enlace);
    await expect(requireAuthorizedPath(new Set([enlace]), enlace)).rejects.toThrow('symlink');
    await expect(requireAuthorizedPath(new Set([dir]), 42)).rejects.toThrow('E-ARGUMENTO');
    await expect(requireAuthorizedPath(new Set([dir]), '')).rejects.toThrow('E-ARGUMENTO');
  });
});

describe('resolveAuthorizedPath', () => {
  it('resuelve un .lila inexistente por su carpeta, pero no una ruta cualquiera inexistente', async () => {
    expect(await resolveAuthorizedPath(join(dir, 'x.lila'))).toBe(join(dir, 'x.lila'));
    expect(await resolveAuthorizedPath(join(dir, 'x'))).toBeNull();
    expect(await resolveAuthorizedPath(join(dir, 'sin-carpeta', 'x.lila'))).toBeNull();
  });

  it('el ensanche no alcanza a un .lila "dentro" de otro archivo (ENOTDIR)', async () => {
    const archivo = join(dir, 'suelto.lila');
    await writeFile(archivo, 'PK', 'utf8');
    expect(await resolveAuthorizedPath(join(archivo, 'dentro.lila'))).toBeNull();
  });
});
