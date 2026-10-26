/**
 * What each `.lila` the desktop opened or saved keeps beside its document (RM-01 § 1.4, § 2.4):
 * entries this build does not understand, catalog objects that failed to load, reserved names such
 * as `maps/`. A normal save gets them from the file it overwrites, inside its lock
 * (`writeLilaFile`). A «Save as» writes a new path, so the main process remembers them by project
 * id when it reads or writes a `.lila` and passes them along (#690), as the browser does
 * (`apps/web/src/project.ts`).
 *
 * Kept apart from `main.ts`, like `authorizedPaths.ts`, so that the handlers' path can be tested
 * with real files and no Electron.
 */
import { readFile } from 'node:fs/promises';
import { readLilaPreserved, type LilaPreserved, type ProjectDocument } from '@lila-modeler/engine/project';
import { readLilaFile, writeLilaFile, type WriteLilaOptions } from '@lila-modeler/engine/project-fs';

/** The entries kept by the last `.lila` read or written for each project id. */
export type KeptEntries = Map<string, LilaPreserved>;

/** `readLilaFile`, remembering what the archive keeps beside the document. */
export async function readLilaKeeping(
  kept: KeptEntries,
  file: string,
): Promise<Omit<Awaited<ReturnType<typeof readLilaFile>>, 'preserved'>> {
  const { preserved, ...read } = await readLilaFile(file);
  kept.set(read.document.id, preserved);
  return read;
}

/**
 * `writeLilaFile`. A «Save as» carries what the `.lila` this project came from keeps; any other
 * save leaves it to `writeLilaFile`. Afterwards the entries are read back from what was written,
 * so a later «Save as» does not bring back the files of a process deleted since the project was
 * opened.
 */
export async function writeLilaKeeping(
  kept: KeptEntries,
  file: string,
  document: ProjectDocument,
  options: WriteLilaOptions,
): Promise<void> {
  const preserved = options.saveAs === true ? kept.get(document.id) : undefined;
  await writeLilaFile(file, document, preserved === undefined ? options : { ...options, preserved });
  let written: ReturnType<typeof readLilaPreserved> | null = null;
  try {
    written = readLilaPreserved(new Uint8Array(await readFile(file)));
  } catch {
    // Unreadable right after the write: forget, and a later «Save as» behaves as before #690.
  }
  if (written?.id === document.id) kept.set(document.id, written.preserved);
  else kept.delete(document.id);
}
