/**
 * Desktop autosave (#459): a copy of the open project, written to `userData/recovery.lila` a few
 * seconds after each change and offered back on the next launch.
 *
 * One file and no flag anywhere else: the copy EXISTING is the signal that the last session did
 * not end cleanly. `main.ts` deletes it whenever the document stops being dirty (a save, a
 * discard in the close dialog, «Discard» in the offer), so after a clean exit there is nothing to
 * offer. Its name lives inside the `.lila` itself and its date is the file's `mtime`.
 *
 * The disk half and the dialog options live here, pure like `closeGuard.ts`, so they can be
 * tested without Electron; the IPC, the queue and the launch-time protection live in `main.ts`.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { MessageBoxOptions } from 'electron';
import type { Strings } from './strings/index.js';

/** What the user answered to the launch offer. */
export type RecoveryChoice = 'restore' | 'discard';

/**
 * Writes `bytes` to `file` atomically: a temporary file in the same folder, then `rename`, so a
 * crash mid-write leaves the previous copy (or none), never half a zip. The temporary file is
 * removed if anything fails.
 */
export async function writeRecoveryFile(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/**
 * The copy and when it was written, or `null` if there is none. Called once, at launch, when no
 * write can be in flight: it also removes the temporary files a crash between `writeFile` and
 * `rename` left behind.
 */
export async function readRecoveryFile(file: string): Promise<{ bytes: Uint8Array; savedAt: Date } | null> {
  const dir = path.dirname(file);
  const huerfanos = (await readdir(dir).catch(() => [])).filter((n) => n.startsWith(`${path.basename(file)}.tmp-`));
  await Promise.all(huerfanos.map((n) => rm(path.join(dir, n), { force: true })));
  try {
    const [bytes, info] = await Promise.all([readFile(file), stat(file)]);
    return { bytes: new Uint8Array(bytes), savedAt: info.mtime };
  } catch (error) {
    if ((error as { code?: unknown }).code === 'ENOENT') return null;
    throw error;
  }
}

/** Deletes the copy; a missing one is fine. */
export async function clearRecoveryFile(file: string): Promise<void> {
  await rm(file, { force: true });
}

/**
 * Options of the launch offer. `buttons[0]` is Restore and `buttons[1]` Discard in every
 * language: `recoveryChoice` reads the index, so reordering them would change the user's answer.
 * Esc answers Restore (`cancelId` 0): Discard deletes the work, so it takes an explicit click. A
 * restored project opens dirty and can still be discarded afterwards.
 */
export function recoveryDialogOptions(strings: Strings, when: string): MessageBoxOptions {
  const S = strings.recuperacion;
  return {
    type: 'question',
    buttons: [S.restaurar, S.descartar],
    defaultId: 0,
    cancelId: 0,
    message: S.mensaje,
    detail: S.detalle(when),
  };
}

/** Maps the index `dialog.showMessageBox` resolves to onto the answer. */
export function recoveryChoice(response: number): RecoveryChoice {
  return response === 0 ? 'restore' : 'discard';
}
