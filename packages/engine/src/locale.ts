/**
 * Resolución del idioma de la interfaz (LILA-211, parte 2).
 *
 * Vive fuera de `core/` y no importa nada: la CLI (`cli.ts`), el bin del servidor MCP
 * (`packages/mcp/src/bin.ts`) y cualquier consumidor futuro comparten esta única regla de
 * precedencia en vez de rehacerla cada uno. Se reexporta por `@lila/engine/messages`.
 */
import type { Locale } from './messages/types.js';

/** Los idiomas que el motor sabe hablar, en el orden en que se listan al usuario. */
export const LOCALES: readonly Locale[] = ['en', 'es'];

/** `en, es`: la lista que sale en el error de `--lang` y en la ayuda. */
export const LOCALE_LIST = LOCALES.join(', ');

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * `es_MX.UTF-8` -> `es`, `EN` -> `en`, `C`/`POSIX`/lo desconocido -> `undefined`.
 *
 * POSIX admite `idioma[_TERRITORIO][.codificación][@modificador]`; solo el idioma nos interesa.
 * `C` y `POSIX` no son idiomas sino la locale neutra del sistema, así que caen al idioma por
 * defecto **en silencio**: un usuario con `LANG=C` no pidió nada, no hay nada que avisarle.
 */
function parseTag(raw: string | undefined): Locale | undefined {
  if (raw === undefined) return undefined;
  const tag = raw.toLowerCase().split(/[_.@-]/)[0] ?? '';
  return isLocale(tag) ? tag : undefined;
}

/** Las variables de entorno que se consultan, en orden; POSIX manda `LC_ALL` antes que `LANG`. */
const ENV_KEYS = ['LILA_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG'] as const;

/**
 * Idioma efectivo: `--lang` (o el equivalente explícito de cada entrada) gana a `LILA_LANG`, que
 * gana a `LC_ALL`, `LC_MESSAGES` y `LANG` en ese orden. Sin nada utilizable, inglés.
 *
 * Nunca falla: un valor que no se reconoce se ignora y se sigue con la siguiente fuente. Rechazar
 * un `--lang` mal escrito es cosa de quien lo lee de la línea de comandos (`extractLang`), donde
 * sí hubo una petición explícita que contestar.
 */
export function resolveLocale(
  explicit: string | undefined,
  env: Readonly<Record<string, string | undefined>> = {},
): Locale {
  const chosen = parseTag(explicit);
  if (chosen !== undefined) return chosen;
  for (const key of ENV_KEYS) {
    const fromEnv = parseTag(env[key]);
    if (fromEnv !== undefined) return fromEnv;
  }
  return 'en';
}
