/**
 * Reading and writing a `.lila` project file (ADR-027): the same ADR-018 project, zipped into one
 * file instead of spread over a folder. The format itself lives in `@lila/engine/project` — this
 * module is only the disk half, kept apart from `projectIO.ts` so that the folder reader stays
 * the pure `node:fs` module its header promises.
 *
 * Same rule as `projectIO.ts` about who validates what: `main.ts` is the only caller and it has
 * already checked that `file` is an authorized path before getting here. Nothing in this module
 * decides whether a path may be touched.
 */
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { decodeLila, encodeLila, ProjectFormatError } from '@lila/engine/project';
import {
  assertNotAnotherProject,
  assertPathsUnchanged,
  ProjectIOError,
  rememberSnapshot,
  type WriteProjectOptions,
} from './projectIO.js';
import type { ProjectDocument, ProjectProblem } from './projectTypes.js';

/**
 * Traduce un error de formato al `ProjectIOError` que el puente ya sabe reportar. El motor usa el
 * prefijo `LILA-` para sus códigos (el `E-`/`W-` de `packages/engine/src` es el catálogo de
 * problemas de modelo/escenario, con su propia prueba de cobertura); aquí se le devuelve la forma
 * `E-…` que usan el resto de errores del puente, que es lo que `main.ts` antepone al mensaje.
 */
function asProjectIOError(error: unknown): never {
  if (error instanceof ProjectFormatError) {
    throw new ProjectIOError(`E-${error.code.replace(/^LILA-/, '')}`, error.message);
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
 * Writes `document` over `file` with the same guarantee `commitWithRollback` gives the folder
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
export async function writeLilaFile(
  file: string,
  document: ProjectDocument,
  options: WriteProjectOptions = {},
): Promise<void> {
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
