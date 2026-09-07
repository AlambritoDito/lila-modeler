/**
 * Funciones puras de rutas para OP-02: sin `electron`, para poder cubrirlas con vitest sin un
 * proceso de Electron detrás. Las usan tanto `protocol.handle('lila', …)` (servir la SPA
 * compilada) como los manejadores de `lila:readFile`/`lila:writeFile` (el puente de archivos).
 */
import { lstat } from 'node:fs/promises';
import { extname, isAbsolute, resolve, sep } from 'node:path';

/** Se lanza cuando una ruta pedida resolvería fuera de la carpeta autorizada. */
export class PathEscapeError extends Error {
  constructor(message = 'La ruta resuelve fuera de la carpeta permitida.') {
    super(message);
    this.name = 'PathEscapeError';
  }
}

/**
 * Decodifica secuencias `%xx` (p. ej. `%2e%2e` → `..`) para que una ruta codificada no esquive
 * la comprobación de abajo. Una secuencia mal formada se deja tal cual: que falle después al
 * resolver es preferible a lanzar aquí por un input que ya era inválido.
 */
function safeDecode(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

/**
 * Resuelve `rel` dentro de `root` y rechaza (`PathEscapeError`) cualquier resultado que no quede
 * estrictamente dentro de `root`: un `rel` absoluto, con `..` que se salga, o codificado
 * (`%2e%2e`) que decodificado haga lo mismo. La comprobación de prefijo añade el separador de
 * plataforma a `root` — así `/root2/x` no cuela como si estuviera "dentro" de `/root` solo por
 * compartir el prefijo de caracteres.
 */
export function resolveWithin(root: string, rel: string): string {
  const decoded = safeDecode(rel);
  if (isAbsolute(decoded)) throw new PathEscapeError();

  const rootResolved = resolve(root);
  const target = resolve(rootResolved, decoded);
  const rootWithSep = rootResolved.endsWith(sep) ? rootResolved : rootResolved + sep;

  if (target !== rootResolved && !target.startsWith(rootWithSep)) {
    throw new PathEscapeError();
  }
  return target;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.bpmn': 'application/xml',
};

/** Tipo MIME por extensión de `path`; `application/octet-stream` si no está en el mapa. */
export function mimeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * `true` si `target` existe y es un symlink (`lstat`, que a diferencia de `stat` no sigue el
 * enlace). `false` si no existe — quien llama decide qué hacer con "no existe" por separado; esto
 * solo distingue "existe y es un enlace" de todo lo demás (OP-14, revisión de A sobre OP-02:
 * "sigue symlinks fuera de la carpeta autorizada", issue #71). Usado por `projectIO.ts` para
 * excluir en lectura (con `problems`) y rechazar en escritura cualquier archivo/carpeta de
 * proyecto que resulte ser un enlace hacia fuera de la carpeta autorizada, sin necesidad de
 * resolver el enlace primero (evita tocar el destino externo).
 */
export async function isSymlink(target: string): Promise<boolean> {
  try {
    const info = await lstat(target);
    return info.isSymbolicLink();
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
