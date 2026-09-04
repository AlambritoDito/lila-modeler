import type { TokenName } from './tokens';

/**
 * Un tema es un objeto plano `{ name, tokens }`. Es el formato que exporta e
 * importa la pantalla Apariencia (LILA-114); está documentado en `docs/THEMES.md`.
 */
export interface Theme {
  name: string;
  tokens: Record<TokenName | string, string>;
}

/** `bg.base` -> `--bg-base`, `diagram.marker.error` -> `--diagram-marker-error`. */
export function tokenToCssVar(name: string): string {
  return `--${name.replaceAll('.', '-')}`;
}

/**
 * Escribe cada token del tema como variable CSS en `root`. Función pura sobre
 * el DOM: no toca estado global ni React (el `ThemeProvider` es LILA-113).
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(tokenToCssVar(name), value);
  }
}
