/**
 * The app's language (LILA-210): which catalog is active, how it is chosen, and how the UI
 * repaints when it changes. No library — the whole store is the twenty lines below.
 *
 * **Preference vs locale.** What the user picks in Settings is a *preference*: `'auto'` (follow
 * the system) or a language. What the app renders is the resolved *locale*, always `'en'` or
 * `'es'`. Only the preference is persisted: a machine that changes its system language later has
 * to follow it, which it would not if `'auto'` had been stored resolved.
 *
 * **Why `useSyncExternalStore` and not a React context.** The catalog is read from ~23 modules,
 * and several of them are not components at all (`project.ts`, `simulationGate.ts`,
 * `store/DesktopStore.ts`, the bpmn-js overlays): a context would leave those out. The store is
 * plain module state, components subscribe with `useStrings()` — so changing the language
 * repaints the whole tree, without a reload — and everything else calls `strings()` **inside** a
 * function, never at module load, so it reads the catalog that is active when the text is built.
 *
 * Two things this deliberately does NOT do:
 *
 * - **No `Proxy` over the catalog.** It would keep object identity stable across languages, which
 *   sounds convenient until a `useMemo`/`useEffect` dependency array holds a piece of `S` and
 *   stops seeing the change.
 * - **No `t('app.guardar')` dotted keys.** ~81 entries of the catalog are functions with typed
 *   parameters; a string key throws all of that away and turns a rename into a runtime surprise.
 */
import { useSyncExternalStore } from 'react';
import { en } from './strings.en';
import { es } from './strings.es';
import type { Strings } from './strings.types';

/** The languages the app ships with. `en` is the base catalog; `es` is a translation of it. */
export type Locale = 'en' | 'es';
/** What Settings stores: a language, or «follow the system». */
export type Preferencia = 'auto' | Locale;

const CATALOGOS: Readonly<Record<Locale, Strings>> = { en, es };

/** `'es'`, `'es-MX'`, `'es-419'`, `'es_MX.UTF-8'` — anything Spanish, however it is spelled. */
const ES = /^es(?:[-_]|$)/i;

/**
 * The locale to use. `guardada` is the persisted preference and wins when it names a language;
 * `'auto'`, `undefined` or anything else (a value from an older version, or a hand-edited
 * `estado.json`) falls back to the system language. Anything not Spanish is English, which is the
 * base catalog: an unknown language reads the app in the language it was written in.
 */
export function detectLocale(navigatorLanguage: string, guardada?: string): Locale {
  if (guardada === 'en' || guardada === 'es') return guardada;
  return ES.test(navigatorLanguage.trim()) ? 'es' : 'en';
}

/**
 * The system language, guarded for an environment without `navigator` (a worker) or with one that
 * does not carry `language` (older Node): no language at all reads as English, the base catalog.
 */
function idiomaDelSistema(): string {
  const idioma = typeof navigator === 'undefined' ? undefined : (navigator as { language?: string }).language;
  return typeof idioma === 'string' ? idioma : '';
}

let preferencia: Preferencia = 'auto';
let locale: Locale = detectLocale(idiomaDelSistema());
const suscriptores = new Set<() => void>();

/** The active locale. */
export function getLocale(): Locale {
  return locale;
}

/** The preference behind it: `'auto'` until Settings says otherwise. */
export function getPreferencia(): Preferencia {
  return preferencia;
}

/**
 * Applies a preference. Resolves it, writes `<html lang>` — the browser reads it for hyphenation
 * and spellchecking, and a screen reader for pronunciation — and wakes up every subscriber, which
 * is what repaints the app without reloading it.
 */
export function setLocale(preferida: Preferencia): void {
  preferencia = preferida;
  const siguiente = preferida === 'auto' ? detectLocale(idiomaDelSistema()) : preferida;
  if (typeof document !== 'undefined') document.documentElement.lang = siguiente;
  if (siguiente === locale) return;
  locale = siguiente;
  for (const avisar of [...suscriptores]) avisar();
}

/** Subscribes to language changes; returns the unsubscribe, as `useSyncExternalStore` wants. */
export function subscribe(escuchar: () => void): () => void {
  suscriptores.add(escuchar);
  return () => {
    suscriptores.delete(escuchar);
  };
}

/**
 * The active catalog, for everything that is not a component. Call it **inside** the function
 * that builds the text, never at module load: a `const X = strings().app.guardar` at the top of a
 * module freezes whatever language was active when the module was first imported.
 */
export function strings(): Strings {
  return CATALOGOS[locale];
}

/** The name the ticket uses for the same thing. */
export const t = strings;

/** The active catalog for a component; re-renders it when the language changes. */
export function useStrings(): Strings {
  return CATALOGOS[useSyncExternalStore(subscribe, getLocale, getLocale)];
}

/**
 * The active locale for a component. It is what an effect that talks to an imperative surface —
 * bpmn-js overlays, the minimap tooltip — puts in its dependency array to re-apply the text.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}
