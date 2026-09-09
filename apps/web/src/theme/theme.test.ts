import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyTheme, tokenToCssVar, type Theme } from './applyTheme';
import { COLOR_TOKEN_NAMES, TOKEN_NAMES, type TokenName } from './tokens';
import { saneaTemas } from './temas';

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
const readTheme = (rel: string): Theme => JSON.parse(read(rel)) as Theme;

const tokensCss = read('./tokens.css');
const themes: Array<[string, Theme]> = [
  ['eva-01', readTheme('./themes/eva-01.json')],
  ['papel', readTheme('./themes/papel.json')],
];

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Luminancia relativa WCAG 2.1 de un color `#rgb`/`#rrggbb`/`#rrggbbaa` (el alfa se ignora). */
function luminance(hex: string): number {
  const body = hex.slice(1);
  const full = body.length === 3 ? [...body].map((c) => c + c).join('') : body;
  const channels = [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

/** Ratio de contraste WCAG entre dos colores hex (1 … 21). */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('tokens.css', () => {
  it('declara una variable por cada token del brief', () => {
    const declared = new Set(
      [...tokensCss.matchAll(/^\s*(--[\w-]+)\s*:/gm)].map((m) => m[1]!),
    );
    const missing = TOKEN_NAMES.filter((name) => !declared.has(tokenToCssVar(name)));
    expect(missing).toEqual([]);
    expect(declared.size).toBe(TOKEN_NAMES.length);
  });

  it('sus valores por defecto son exactamente los de Eva-01', () => {
    // Si alguien retoca eva-01.json y no tokens.css, la app pinta otro tema
    // durante el primer frame y nadie se entera. Aquí sí.
    const eva = themes[0]![1];
    const declarados = Object.fromEntries(
      [...tokensCss.matchAll(/^\s*(--[\w-]+)\s*:\s*(.+?);\s*$/gm)].map((m) => [m[1]!, m[2]!]),
    );
    const distintos = TOKEN_NAMES.filter(
      (name) => declarados[tokenToCssVar(name)] !== eva.tokens[name],
    );
    expect(distintos).toEqual([]);
  });
});

describe.each(themes)('tema %s', (_slug, theme) => {
  it('tiene exactamente las claves del brief, ni más ni menos', () => {
    expect(Object.keys(theme.tokens).sort()).toEqual([...TOKEN_NAMES].sort());
  });

  it('tiene nombre', () => {
    expect(theme.name).toBeTruthy();
  });

  it('todos los tokens de color son hex válidos', () => {
    for (const name of COLOR_TOKEN_NAMES) {
      expect(theme.tokens[name], name).toMatch(HEX);
    }
  });

  it('el texto cumple contraste AA (>= 4.5) sobre los fondos y sobre el acento', () => {
    const t = theme.tokens;
    // Pares que de verdad llevan texto encima. `fg.disabled` queda fuera a
    // propósito: WCAG 1.4.3 exime a los controles inactivos. `fg.onAccent` solo
    // se garantiza sobre `accent.primary`; ver docs/design/README.md.
    const pares: Array<[string, string]> = [
      ['fg.primary', 'bg.base'],
      ['fg.primary', 'bg.surface'],
      ['fg.primary', 'bg.elevated'],
      ['fg.muted', 'bg.base'],
      ['fg.muted', 'bg.surface'],
      ['fg.muted', 'bg.elevated'],
      ['diagram.label', 'diagram.fill'],
      ['diagram.label', 'canvas.bg'],
      ['fg.onAccent', 'accent.primary'],
    ];
    for (const [fg, bg] of pares) {
      expect(contrast(t[fg as TokenName]!, t[bg as TokenName]!), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('tokenToCssVar', () => {
  it('convierte los nombres del brief', () => {
    expect(tokenToCssVar('bg.base')).toBe('--bg-base');
    expect(tokenToCssVar('diagram.marker.error')).toBe('--diagram-marker-error');
    expect(tokenToCssVar('font.size.base')).toBe('--font-size-base');
    expect(tokenToCssVar('density')).toBe('--density');
    expect(tokenToCssVar('fg.onAccent')).toBe('--fg-onAccent');
  });
});

// ponytail: un doble mínimo en vez de jsdom; applyTheme solo usa `style.setProperty`.
function doble(): { root: HTMLElement; written: Map<string, string> } {
  const written = new Map<string, string>();
  const root = {
    style: { setProperty: (k: string, v: string) => void written.set(k, v) },
  } as unknown as HTMLElement;
  return { root, written };
}

describe('applyTheme', () => {
  it('escribe cada token como variable CSS y cambiar de tema cambia los valores', () => {
    const { root, written } = doble();

    applyTheme(themes[0]![1], root);
    expect(written.size).toBe(TOKEN_NAMES.length);
    expect(written.get('--accent-primary')).toBe('#9EF01A');

    applyTheme(themes[1]![1], root);
    expect(written.get('--accent-primary')).toBe('#EC3013');
    expect(written.get('--bg-base')).toBe('#F3F2F2');
  });

  it('rechaza un token que no existe en vez de escribir una variable basura', () => {
    const { root, written } = doble();
    // La clave mala va la última: si validara sobre la marcha, el tema quedaría
    // aplicado a medias antes de lanzar.
    const roto = {
      name: 'roto',
      tokens: { 'bg.base': '#000000', 'foo.bar': '#ff00ff' },
    } as unknown as Theme;
    expect(() => applyTheme(roto, root)).toThrow(/foo\.bar/);
    expect(written.size).toBe(0);
  });

  it('rechaza un valor que no es texto en vez de escribir CSS inválido', () => {
    const { root, written } = doble();
    const roto = { name: 'roto', tokens: { 'bg.base': 123 } } as unknown as Theme;
    expect(() => applyTheme(roto, root)).toThrow(/bg\.base/);
    expect(written.size).toBe(0);
  });

  it('un tema parcial solo escribe lo que trae: el resto se queda con el default de tokens.css', () => {
    const { root, written } = doble();
    applyTheme({ name: 'parcial', tokens: { 'accent.primary': '#00FFAA' } }, root);
    expect([...written]).toEqual([['--accent-primary', '#00FFAA']]);
  });
});

/**
 * Lo que sale de `estado.json` o de `localStorage` puede estar a medias: hasta el QA de #277 un
 * solo token roto (una edición abandonada en `#12`) descartaba el tema entero y con él los otros
 * 39, en silencio y al recargar. Ahora se repara token a token.
 */
describe('saneaTemas', () => {
  const ORIGEN = { 'accent.primary': '#9EF01A', 'bg.base': '#12101A' };
  const guardado = (tokens: unknown, origen: unknown = ORIGEN): unknown[] => [
    { id: 'u:1', tema: { name: 'Mío', tokens }, origen },
  ];

  it('un token roto vuelve al origen del tema y el resto del tema sobrevive', () => {
    const [t] = saneaTemas(guardado({ 'accent.primary': '#12', 'bg.base': '#000000' }));
    expect(t?.tema.name).toBe('Mío');
    expect(t?.tema.tokens['accent.primary']).toBe('#9EF01A');
    expect(t?.tema.tokens['bg.base']).toBe('#000000');
  });

  it('sin origen válido el token se cae, y ausente lo pinta el default de tokens.css (Eva-01)', () => {
    const [t] = saneaTemas(guardado({ 'accent.primary': 'azul', 'density': 'enorme' }, {}));
    // El tema TIENE que seguir ahí: sin esta línea la prueba pasaba igual descartándolo entero,
    // que es justo lo que se está arreglando (QA ronda 2 de #277).
    expect(t?.tema.name).toBe('Mío');
    expect(t?.tema.tokens['accent.primary']).toBeUndefined();
    expect(t?.tema.tokens['density']).toBeUndefined();
  });

  it('un token que no existe no entra, ni desde el tema ni desde el origen', () => {
    const [t] = saneaTemas(guardado({ 'foo.bar': '#FFFFFF' }, { 'foo.bar': '#FFFFFF' }));
    expect(t?.tema.name).toBe('Mío');
    expect(t?.tema.tokens['foo.bar']).toBeUndefined();
    expect(t?.origen['foo.bar']).toBeUndefined();
  });

  it('39 tokens rotos y uno bueno: sobrevive el bueno, no se descarta el tema', () => {
    const tokens: Record<string, unknown> = {};
    for (const n of TOKEN_NAMES) tokens[n] = 42;
    tokens['bg.base'] = '#010203';
    const [t] = saneaTemas(guardado(tokens, {}));
    expect(t?.tema.tokens).toEqual({ 'bg.base': '#010203' });
  });

  it('el `origen` roto tampoco descarta el tema: se queda sin respaldo', () => {
    const [t] = saneaTemas(guardado({ 'bg.base': '#010203', 'accent.primary': '#12' }, 'no soy un objeto'));
    expect(t?.origen).toEqual({});
    expect(t?.tema.tokens).toEqual({ 'bg.base': '#010203' });
  });

  it.each([
    ['sin nombre', [{ id: 'u:1', tema: { tokens: {} }, origen: {} }]],
    ['con el nombre en blanco', [{ id: 'u:1', tema: { name: '   ', tokens: {} }, origen: {} }]],
    ['sin id del usuario', [{ id: 'eva-01', tema: { name: 'X', tokens: {} }, origen: {} }]],
    ['que no es una lista', {}],
  ])('descarta lo que no se puede reconstruir: %s', (_caso, dato) => {
    expect(saneaTemas(dato)).toEqual([]);
  });
});
