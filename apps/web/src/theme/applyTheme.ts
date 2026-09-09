import { TOKEN_NAMES, type TokenName } from './tokens';

/**
 * Un tema es un objeto plano `{ name, tokens }`. Es el formato que exporta e
 * importa la pantalla Apariencia (LILA-114); está documentado en `docs/THEMES.md`.
 *
 * `tokens` es parcial a propósito: un tema puede traer solo los tokens que
 * cambia y el resto se queda con el valor por defecto de `tokens.css`.
 */
export interface Theme {
  name: string;
  tokens: Partial<Record<TokenName, string>>;
}

const KNOWN_TOKENS: ReadonlySet<string> = new Set(TOKEN_NAMES);

/** `bg.base` -> `--bg-base`, `diagram.marker.error` -> `--diagram-marker-error`. */
export function tokenToCssVar(name: string): string {
  return `--${name.replaceAll('.', '-')}`;
}

/**
 * Escribe cada token del tema como variable CSS en `root`. Función pura sobre
 * el DOM: no toca estado global ni React. No hay `ThemeProvider` (LILA-113
 * decidió que sobra un contexto para esto); quien cambia de tema llama a esto y
 * luego a `Modelador.repintar()`, ver `docs/THEMES.md`.
 *
 * Falla con un mensaje claro si el tema trae una clave que no es un token del
 * brief o un valor que no es cadena: los temas llegan de un JSON de disco o de
 * un importador (LILA-114), así que escribir a ciegas dejaría variables basura
 * (`--foo-bar`) o valores CSS inválidos sin que nadie se entere. Los tokens
 * ausentes no son error: se quedan con el valor por defecto de `tokens.css`.
 *
 * Valida todo antes de escribir nada: un tema malo deja el anterior intacto en
 * vez de aplicarse a medias.
 */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  const entradas = Object.entries(theme.tokens);
  for (const [name, value] of entradas) {
    if (!KNOWN_TOKENS.has(name)) {
      throw new Error(`Tema "${theme.name}": el token "${name}" no existe en Lila Modeler.`);
    }
    if (typeof value !== 'string') {
      throw new Error(`Tema "${theme.name}": el token "${name}" no tiene un valor de texto.`);
    }
  }
  for (const [name, value] of entradas) {
    root.style.setProperty(tokenToCssVar(name), value as string);
  }
}
