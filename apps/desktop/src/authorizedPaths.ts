/**
 * Autorización de rutas elegidas por diálogo (issue #71, hallazgo 1 del segundo QA a #323).
 * Vive fuera de `main.ts` —que arrastra `electron` y no se puede probar— porque es la única
 * comprobación que separa al renderer del disco: aquí solo hay `node:fs`/`node:path`, así que se
 * prueba con carpetas reales (`mkdtemp`) y no con dobles.
 *
 * Dos formas de ruta autorizada, ambas guardadas siempre como `realpath`:
 *
 * - Una CARPETA de proyecto (ADR-018) o un `.lila` que YA existe: tiene `realpath` propio.
 * - Un `.lila` que TODAVÍA no existe, recién elegido en «Guardar como…»: no tiene `realpath`
 *   propio, así que su identidad es el `realpath` de su carpeta contenedora más su nombre — lo
 *   mismo que autorizó `lila:chooseSaveFile`. Sin este caso, la PRIMERA escritura al archivo
 *   nuevo (la única que importa al crearlo) se rechazaba con `E-NO-AUTORIZADO`.
 *
 * El ensanche está acotado a `.lila` inexistente: cualquier otra ruta que no resuelva sigue
 * siendo autorización revocada, y la identidad resultante tiene que coincidir EXACTAMENTE con la
 * ruta autorizada (contención por igualdad, no por prefijo).
 */
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { isLilaPath } from './openPath.js';

function isNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Identidad canónica de `p` ahora mismo, o `null` si no la tiene (no existe y no es un `.lila`
 * dentro de una carpeta que sí existe).
 */
export async function resolveAuthorizedPath(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch (error) {
    if (!isNotFound(error) || !isLilaPath(p)) return null;
    try {
      const parent = await realpath(path.dirname(p));
      // La contenedora tiene que ser una CARPETA de verdad: sin esto, una ruta "dentro" de otro
      // archivo (`suelto.lila/dentro.lila`) resolvería igual que un archivo nuevo legítimo.
      if (!(await stat(parent)).isDirectory()) return null;
      return path.join(parent, path.basename(p));
    } catch {
      return null;
    }
  }
}

/**
 * `dir` tal cual si está en `authorized` y su identidad de ahora sigue siendo ella misma; si no,
 * lanza el `E-…` correspondiente (mismos textos que tenía `requireAuthorizedDir` en `main.ts`).
 */
export async function requireAuthorizedPath(authorized: ReadonlySet<string>, dir: unknown): Promise<string> {
  if (typeof dir !== 'string' || dir.length === 0) {
    throw new Error('E-ARGUMENTO: "dir" debe ser una ruta de texto no vacía.');
  }
  if (!authorized.has(dir)) {
    throw new Error('E-NO-AUTORIZADO: la carpeta no fue autorizada por un diálogo.');
  }
  const real = await resolveAuthorizedPath(dir);
  if (real === null) {
    throw new Error('E-NO-AUTORIZADO: la carpeta autorizada ya no existe.');
  }
  if (real !== dir) {
    throw new Error('E-NO-AUTORIZADO: la carpeta cambió de identidad desde que se autorizó (symlink).');
  }
  return dir;
}
