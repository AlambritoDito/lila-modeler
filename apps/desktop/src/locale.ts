/**
 * Which language the desktop shell speaks (LILA-213). Pure: no `electron` import, so it can be
 * tested without Electron behind it — `main.ts` is the one that calls `app.getLocale()`.
 *
 * **Preference vs locale.** What the user picks in Settings is a *preference* — `'auto'` (follow
 * the system) or a language — and that is the only thing `estado.json` stores (`ajustes.idioma`,
 * LILA-210). What the menu renders is the resolved *locale*, always `'en'` or `'es'`. Storing the
 * preference resolved would freeze the choice of a machine that later changes its system
 * language.
 *
 * The rules are the same as the web app's `detectLocale` (`apps/web/src/i18n.ts`) — deliberately,
 * so the menu bar and the window never end up in different languages — with the system locale
 * passed in from `app.getLocale()` instead of read from `navigator.language`.
 */

/** The languages the desktop shell ships with. `en` is the base catalog; `es` is a translation. */
export const DESKTOP_LOCALES = ['en', 'es'] as const;
export type DesktopLocale = (typeof DESKTOP_LOCALES)[number];

/** `'es'`, `'es-MX'`, `'es-419'`, `'es_MX.UTF-8'` — anything Spanish, however it is spelled. */
const ES = /^es(?:[-_]|$)/i;

/**
 * The locale to use. `preferencia` is the persisted `ajustes.idioma` and wins when it names a
 * language; `'auto'`, `undefined` or anything else — a value from an older version, or a
 * hand-edited `estado.json` — falls back to `systemLocale`. Anything not Spanish is English,
 * which is the base catalog: an unknown language reads the app in the language it was written in.
 */
export function resolveDesktopLocale(preferencia: string | undefined, systemLocale: string): DesktopLocale {
  if (preferencia === 'en' || preferencia === 'es') return preferencia;
  return ES.test(systemLocale.trim()) ? 'es' : 'en';
}
