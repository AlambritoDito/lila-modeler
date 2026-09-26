import { mkdir, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { clearRecoveryFile, readRecoveryFile, recoveryChoice, recoveryDialogOptions, writeRecoveryFile } from './recovery.js';
import { desktopStrings } from './strings/index.js';

/** The disk half of the autosave copy (#459), on real temporary folders like `lilaFile.test.ts`. */
describe('recovery copy on disk', () => {
  it('writes, reads back, replaces and clears the copy, leaving no temporary file behind', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lila-recovery-'));
    // `userData` may not exist yet on a first launch: the writer creates it.
    const file = join(dir, 'userData', 'recovery.lila');
    expect(await readRecoveryFile(file)).toBeNull();

    await writeRecoveryFile(file, new Uint8Array([1, 2, 3]));
    await writeRecoveryFile(file, new Uint8Array([4, 5]));
    const leida = await readRecoveryFile(file);
    expect([...leida!.bytes]).toEqual([4, 5]);
    expect(leida!.savedAt).toBeInstanceOf(Date);
    expect(await readdir(join(dir, 'userData'))).toEqual(['recovery.lila']);

    await clearRecoveryFile(file);
    expect(await readRecoveryFile(file)).toBeNull();
    await clearRecoveryFile(file); // Clearing twice is fine: the document was clean already.
  });

  it('a failed write keeps the previous copy and removes its temporary file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lila-recovery-'));
    const file = join(dir, 'recovery.lila');
    await writeRecoveryFile(file, new Uint8Array([7]));
    // A folder where the copy should go makes the final `rename` fail.
    const bloqueado = join(dir, 'bloqueado.lila');
    await mkdir(join(bloqueado, 'dentro'), { recursive: true });
    await expect(writeRecoveryFile(bloqueado, new Uint8Array([8]))).rejects.toThrow();
    expect((await readdir(dir)).sort()).toEqual(['bloqueado.lila', 'recovery.lila']);
    expect([...(await readRecoveryFile(file))!.bytes]).toEqual([7]);
  });
});

describe('recovery offer', () => {
  it.each([
    ['en', ['Restore', 'Discard']],
    ['es', ['Restaurar', 'Descartar']],
  ] as const)('%s: Restore is button 0 and the default, Discard is 1 and the cancel', (locale, buttons) => {
    const opciones = recoveryDialogOptions(desktopStrings(locale), '26 Sep 2026, 10:00');
    expect(opciones).toMatchObject({ type: 'question', buttons, defaultId: 0, cancelId: 1 });
    expect(opciones.detail).toContain('26 Sep 2026, 10:00');
    expect(recoveryChoice(0)).toBe('restore');
    expect(recoveryChoice(1)).toBe('discard');
  });
});
