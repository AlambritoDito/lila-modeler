import type { Strings } from '../strings.types';

/** A built-in theme's id (`theme/themes/*.json`, `strings.*.ts`'s `app.temas`). */
export type TemaId = keyof Strings['app']['temas'];

/** Whether the OS prefers dark right now. Without `matchMedia` (jsdom, very old engines) it is light. */
export function sistemaOscuro(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/**
 * The Lila theme of the current OS scheme (#404): Lila Dark when the OS prefers dark, else Lila
 * Light. It is the default of each theme slot while the app follows the system (#472) and the
 * fallback when the active user theme is deleted.
 *
 * Moved out of `App.tsx` (#422) so `settings/Apariencia.tsx` can fall back to it too when the
 * active user theme is deleted, instead of the fixed `'eva-01'` it used to pick.
 */
export function temaPorDefecto(): TemaId {
  return sistemaOscuro() ? 'lila-dark' : 'lila-light';
}
