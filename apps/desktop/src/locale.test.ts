import { describe, expect, it } from 'vitest';
import { resolveDesktopLocale } from './locale.js';

/**
 * The table of LILA-213. Two axes: what Settings persisted (`ajustes.idioma`) and what the system
 * says (`app.getLocale()`). A named language always wins; everything else — `'auto'`, nothing at
 * all, or a value no version of the app ever wrote — falls back to the system, and only Spanish
 * is Spanish. These are the same rules as the web app's `detectLocale`, on purpose: the menu bar
 * and the window have to end up in the same language.
 */
const CASOS: readonly (readonly [string | undefined, string, 'en' | 'es'])[] = [
  ['auto', 'es-MX', 'es'],
  ['auto', 'en-US', 'en'],
  ['en', 'es-MX', 'en'],
  ['es', 'en-US', 'es'],
  [undefined, 'es-419', 'es'],
  ['fr', 'fr-FR', 'en'],
  ['', 'es', 'es'],
];

describe('resolveDesktopLocale', () => {
  it.each(CASOS)('(%o, %o) → %s', (preferencia, sistema, esperado) => {
    expect(resolveDesktopLocale(preferencia, sistema)).toBe(esperado);
  });

  it('a chosen language wins over the system, and "auto" follows it', () => {
    // The two halves of the same decision: the preference is what is persisted, so a machine that
    // changes its system language later has to follow it while the preference says `auto`.
    expect(resolveDesktopLocale('en', 'es-ES')).toBe('en');
    expect(resolveDesktopLocale('auto', 'es-ES')).toBe('es');
    expect(resolveDesktopLocale('auto', 'en-GB')).toBe('en');
  });

  it('recognises Spanish however it is spelled, and does not mistake other languages for it', () => {
    for (const sistema of ['es', 'es-MX', 'es-419', 'es_MX.UTF-8', 'ES-es', '  es-CL  ']) {
      expect(resolveDesktopLocale('auto', sistema)).toBe('es');
    }
    // `estonian` starts with «es» but is not Spanish: the cut demands a separator or end of string.
    for (const sistema of ['et-EE', 'eskimo', 'espanol', 'en-US', 'pt-BR', '']) {
      expect(resolveDesktopLocale('auto', sistema)).toBe('en');
    }
  });

  it('an invalid preference falls back to the system instead of breaking', () => {
    // `estado.json` can be hand-edited, and an older version could have written something else.
    for (const rara of ['EN', 'es-MX', 'null', '{}', 'auto ']) {
      expect(resolveDesktopLocale(rara, 'es-ES')).toBe('es');
      expect(resolveDesktopLocale(rara, 'en-US')).toBe('en');
    }
  });
});
