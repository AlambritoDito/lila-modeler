/**
 * The desktop shell's catalogs and the way to pick one (LILA-213).
 *
 * There is no store and no subscription here, unlike the web app's `i18n.ts`: the main process
 * reads its texts at exactly two moments — when it builds the menu (`menu.ts`) and when it shows
 * a close dialog (`closeGuard.ts`) — so `main.ts` keeps the active locale in a variable and
 * rebuilds the menu when `lila:writeSettings` brings a different `idioma`.
 */
import type { DesktopLocale } from '../locale.js';
import { en } from './en.js';
import { es } from './es.js';
import type { Strings } from './types.js';

export type { Strings } from './types.js';

const CATALOGOS: Readonly<Record<DesktopLocale, Strings>> = { en, es };

/** The catalog for a locale. `en` is the base language; `es` is its translation. */
export function desktopStrings(locale: DesktopLocale): Strings {
  return CATALOGOS[locale];
}
