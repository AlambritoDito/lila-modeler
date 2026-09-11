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
import type { ProjectErrorCode } from '@lila/engine/project';
import {
  assertNotAnotherProject,
  assertPathsUnchanged,
  ProjectIOError,
  rememberSnapshot,
  type WriteProjectOptions,
} from './projectIO.js';
import type { ProjectDocument, ProjectProblem } from './projectTypes.js';

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
