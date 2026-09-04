import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyTheme, tokenToCssVar, type Theme } from './applyTheme';
import { COLOR_TOKEN_NAMES, TOKEN_NAMES } from './tokens';

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
    expect(contrast(t['fg.primary']!, t['bg.base']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['fg.primary']!, t['bg.surface']!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t['fg.onAccent']!, t['accent.primary']!)).toBeGreaterThanOrEqual(4.5);
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

describe('applyTheme', () => {
  it('escribe cada token como variable CSS y cambiar de tema cambia los valores', () => {
    const written = new Map<string, string>();
    // ponytail: un doble mínimo en vez de jsdom; applyTheme solo usa `style.setProperty`.
    const root = {
      style: { setProperty: (k: string, v: string) => void written.set(k, v) },
    } as unknown as HTMLElement;

    applyTheme(themes[0]![1], root);
    expect(written.size).toBe(TOKEN_NAMES.length);
    expect(written.get('--accent-primary')).toBe('#9EF01A');

    applyTheme(themes[1]![1], root);
    expect(written.get('--accent-primary')).toBe('#EC3013');
    expect(written.get('--bg-base')).toBe('#F4F1EC');
  });
});
