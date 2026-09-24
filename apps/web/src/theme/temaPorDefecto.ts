import type { Strings } from '../strings.types';

/** A built-in theme's id (`theme/themes/*.json`, `strings.*.ts`'s `app.temas`). */
export type TemaId = keyof Strings['app']['temas'];

/**
 * Theme used while no valid one is saved (#404): Lila Dark when the OS prefers dark, else Lila
 * Light. It is never persisted, so until the user picks one in Settings the app follows the OS on
 * every launch. Without `matchMedia` (jsdom, very old engines) it is Lila Light.
 * ponytail: read once at startup, no `change` listener — switching the OS scheme applies on the
 * next launch.
 *
 * Moved out of `App.tsx` (#422) so `settings/Apariencia.tsx` can fall back to it too when the
 * active user theme is deleted, instead of the fixed `'eva-01'` it used to pick.
 */
export function temaPorDefecto(): TemaId {
  const oscuro = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return oscuro ? 'lila-dark' : 'lila-light';
}
