/**
 * Reading and writing a `.lila` project file (ADR-027): the same ADR-018 project, zipped into one
 * file instead of spread over a folder. The format itself lives in `@lila-modeler/engine/project` — this
 * module is only the disk half, kept apart from `projectIO.ts` so that the folder reader stays
 * the pure `node:fs` module its header promises.
 *
 * Same rule as `projectIO.ts` about who validates what: in the desktop, `main.ts` has already
 * checked that `file` is an authorized path before getting here. Nothing in this module decides
 * whether a path may be touched. Moved from `apps/desktop/src/` with `projectIO.ts` (#466).
 */
import { link, open, readFile, rename, stat, unlink, utimes, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { decodeLila, encodeLila, ProjectFormatError } from '../project/index.js';
import type { ProjectDocument, ProjectErrorCode, ProjectProblem } from '../project/index.js';
import {
  assertNotAnotherProject,
  assertPathsUnchanged,
  ProjectIOError,
  rememberSnapshot,
  type WriteProjectOptions,
} from './projectIO.js';

/**
 * Traduce un error de formato del motor al `ProjectIOError` que el puente ya sabe reportar. El
 * mapa es explícito a propósito (hallazgo 6 del QA a #323): el vocabulario `E-…` del puente es
 * público y no puede derivarse por cirugía de texto sobre un enum interno del motor —así, añadir
 * un `LILA-…` allí rompe el typecheck aquí en vez de estrenar un código `E-…` sin que nadie lo
 * decida. El mensaje también es propio: todos los demás `ProjectIOError` del escritorio están en
 * español (`projectIO.ts`), y el del motor está en inglés por ser la capa sin idioma.
 */
const CODES: Record<ProjectErrorCode, { readonly code: string; readonly message: string }> = {
  'LILA-DOCUMENT': {
    code: 'E-DOCUMENTO',
    message: 'El documento de proyecto es inválido o de una versión no soportada.',
  },
  'LILA-PROBLEMS': { code: 'E-DIAGNOSTICO', message: 'El diagnóstico del proyecto es inválido.' },
  'LILA-RUN': { code: 'E-CORRIDA', message: 'Hay una corrida guardada inválida.' },
  'LILA-RUN-INPUTS': { code: 'E-ENTRADAS-CORRIDA', message: 'Las entradas de una corrida guardada son inválidas.' },
  'LILA-ENTRY-PATH': {
    code: 'E-ENTRY-PATH',
    message: 'El archivo .lila tiene una entrada con una ruta que no es válida dentro de un proyecto.',
  },
  'LILA-ZIP': { code: 'E-ZIP', message: 'El archivo no es un .lila legible (no se pudo descomprimir).' },
  'LILA-NO-MANIFEST': {
    code: 'E-NO-MANIFEST',
    message: 'Al archivo le falta "lila-project.json": no es un proyecto .lila.',
  },
  'LILA-MANIFEST': {
    code: 'E-MANIFEST',
    message: 'El "lila-project.json" del archivo es inválido o de una versión no soportada.',
  },
  'LILA-NO-MODEL': { code: 'E-NO-MODEL', message: 'Al archivo le falta "model.bpmn": no es un proyecto .lila.' },
};

function asProjectIOError(error: unknown): never {
  if (error instanceof ProjectFormatError) {
    const { code, message } = CODES[error.code];
    throw new ProjectIOError(code, message);
  }
  throw error;
}

/**
 * Reads `file` as a `.lila`. Returns the same triple as `readProjectFolder` so both openers can
 * feed the identical IPC reply: `problems` carries the scenarios and runs the archive lost, and
 * `loose` is always `false` — a `.lila` is a project by construction, never a stray diagram.
 */
export async function readLilaFile(
  file: string,
): Promise<{ document: ProjectDocument; problems: readonly ProjectProblem[]; loose: boolean }> {
  let bytes: Buffer;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') {
      throw new ProjectIOError('E-SIN-MODELO', `No existe el archivo de proyecto: ${file}`);
    }
    throw error;
  }
  let document: ProjectDocument;
  try {
    document = decodeLila(new Uint8Array(bytes));
  } catch (error) {
    asProjectIOError(error);
  }
  // El `.lila` acaba de verse tal y como está en disco: ese es el punto de partida de
  // `E-CAMBIO-EXTERNO` para el próximo guardado (mismo mapa que la carpeta, ver `projectIO.ts`).
  await rememberSnapshot(file);
  return { document, problems: document.problems ?? [], loose: false };
}

/**
 * Lee el `id` del proyecto que YA está en `file`, o `null` si no hay archivo, no se puede leer, o
 * no es un `.lila` interpretable. Mismo criterio que `readManifest` con un manifiesto roto: sin
 * forma de saber de quién es, no se bloquea el guardado por un falso positivo.
 */
async function existingProjectId(file: string): Promise<string | null> {
  try {
    return decodeLila(new Uint8Array(await readFile(file))).id;
  } catch {
    return null;
  }
}

/**
 * Writes `document` over `file`, holding `${file}.lock` (`withLilaLock`), with the same guarantee `commitWithRollback` gives the folder
 * writer: a temporary file next to the destination and a `rename` on top of it, so a crash or a
 * full disk leaves the previous project intact instead of a truncated archive. A single file
 * needs no rollback bookkeeping — `rename` within a directory is atomic, and the whole project is
 * that one entry.
 *
 * `options` are the SAME as the folder writer's and mean the same thing (hallazgo 3 del QA a
 * #323): `saveAs` runs the "destination already holds another project" guard (`E-CARPETA-OCUPADA`)
 * and, unless `overwrite`, the file is refused if it changed on disk since this process last read
 * or wrote it (`E-CAMBIO-EXTERNO`). `modelFile`/`diagramOnly` have no meaning in a container that
 * is the whole project or nothing, and are ignored.
 */
/** `writeLilaFile`'s options: the folder writer's, plus a check that runs while the lock is held. */
export interface WriteLilaOptions extends WriteProjectOptions {
  /**
   * Runs inside the lock, before anything is written; throwing aborts the write. This is where a
   * caller compares the disk with what it read (`writeLilaProject`), so that no other writer can
   * slip in between that comparison and the `rename`.
   */
  readonly beforeWrite?: (() => Promise<void>) | undefined;
}

/** How long to wait for another writer's lock, and when a lock is old enough to be a crash's. */
const LOCK_WAIT_MS = 3_000;
const LOCK_RETRY_MS = 20;
const LOCK_STALE_MS = 10_000;

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code;
}

/** How often a holder touches its lock, so a long write never looks like a crash's leftover. */
const LOCK_REFRESH_MS = 2_000;

/** The token a lock file holds, or `null` when there is no lock to read. */
async function lockToken(lock: string): Promise<string | null> {
  try {
    return await readFile(lock, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Runs `work` holding `${file}.lock`, a sibling file created with `wx` (exclusive create) that
 * holds a random token, so two writers of the same `.lila` — the desktop, the CLI, two MCP
 * servers — never interleave their check-then-write, whatever process they run in.
 *
 * - Another writer's lock: wait up to `LOCK_WAIT_MS`, then refuse with `E-ARCHIVO-OCUPADO`
 *   (somebody else is saving the file right now; nothing was written).
 * - A lock untouched for `LOCK_STALE_MS` is a crash's leftover and is removed. The holder touches
 *   its lock every `LOCK_REFRESH_MS`, so a slow write is never mistaken for one.
 * - A writer only ever removes a lock whose token it has just read (its own, or the stale one it
 *   checked), never one somebody else took in between.
 * - Always released in a `finally`. It lives next to the archive, never inside it.
 */
export async function withLilaLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  const token = crypto.randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(lock, 'wx');
      try {
        await handle.writeFile(token, 'utf8');
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
    try {
      const seen = await lockToken(lock);
      if (seen !== null && Date.now() - (await stat(lock)).mtimeMs > LOCK_STALE_MS) {
        // Renamed away before deleting, and checked after: of two writers that both found it
        // stale only one wins the rename, and a lock somebody took in between is put back.
        const stale = `${lock}.stale-${token}`;
        await rename(lock, stale);
        if ((await lockToken(stale)) !== seen) await link(stale, lock).catch(() => {});
        await unlink(stale).catch(() => {});
        continue;
      }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') continue; // released meanwhile: try again at once
      throw error;
    }
    if (Date.now() >= deadline) {
      throw new ProjectIOError(
        'E-ARCHIVO-OCUPADO',
        `Otro programa está guardando este archivo ahora mismo; no se guardó nada: ${basename(file)}.`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
  }
  const refresh = setInterval(() => {
    const now = new Date();
    void utimes(lock, now, now).catch(() => {});
  }, LOCK_REFRESH_MS);
  refresh.unref();
  try {
    return await work();
  } finally {
    clearInterval(refresh);
    if ((await lockToken(lock).catch(() => null)) === token) await unlink(lock).catch(() => {});
  }
}

export async function writeLilaFile(
  file: string,
  document: ProjectDocument,
  options: WriteLilaOptions = {},
): Promise<void> {
  await withLilaLock(file, () => writeLilaFileLocked(file, document, options));
}

/** `writeLilaFile` with the lock already held. */
async function writeLilaFileLocked(file: string, document: ProjectDocument, options: WriteLilaOptions): Promise<void> {
  await options.beforeWrite?.();
  if (options.saveAs === true) {
    assertNotAnotherProject(await existingProjectId(file), document.id, 'El archivo');
  }
  await assertPathsUnchanged([file], options.overwrite === true);
  let bytes: Uint8Array;
  try {
    bytes = encodeLila(document);
  } catch (error) {
    asProjectIOError(error);
  }
  const tmp = `${file}.tmp-${crypto.randomUUID()}`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
  await rememberSnapshot(file);
}
