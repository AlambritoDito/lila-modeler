import { describe, expect, it } from 'vitest';
import { counterpart, rewriteHref, sidebar, stripLangLine } from './build-docs.mjs';

const BLOB = 'https://github.com/AlambritoDito/lila-modeler/blob/main/';
const published = new Set(['PROJECT_FORMAT.md', 'es/SEMANTICS.md', 'SEMANTICS.md']);

describe('rewriteHref', () => {
  it('points published docs at their HTML page, keeping the anchor', () => {
    expect(rewriteHref('PROJECT_FORMAT.md#x', 'SEMANTICS.md', published)).toBe('PROJECT_FORMAT.html#x');
    expect(rewriteHref('../SEMANTICS.md', 'es/SEMANTICS.md', published)).toBe('../SEMANTICS.html');
    expect(rewriteHref('es/SEMANTICS.md', 'SEMANTICS.md', published)).toBe('es/SEMANTICS.html');
  });

  it('sends source files and internal docs to GitHub', () => {
    expect(rewriteHref('../packages/a.ts', 'SEMANTICS.md', published)).toBe(`${BLOB}packages/a.ts`);
    expect(rewriteHref('PAGES.md', 'SEMANTICS.md', published)).toBe(`${BLOB}docs/PAGES.md`);
  });

  it('leaves absolute URLs and in-page anchors alone', () => {
    expect(rewriteHref('https://x.org/a.md', 'SEMANTICS.md', published)).toBe('https://x.org/a.md');
    expect(rewriteHref('#top', 'SEMANTICS.md', published)).toBe('#top');
  });
});

describe('sidebar and counterpart', () => {
  const docs = ['MCP.md', 'SHORTCUTS.md', 'SCENARIO_FORMAT.md', 'ZZ_NEW.md', 'es/ATAJOS.md', 'es/MCP.md', 'releases/v1.md'];

  it('orders each language by the mock groups, with unmapped docs under More and releases last', () => {
    const flat = (lang) => sidebar(docs, lang).flatMap((g) => g.items.map((i) => i.doc));
    expect(flat('en')).toEqual(['index', 'SHORTCUTS.md', 'SCENARIO_FORMAT.md', 'MCP.md', 'ZZ_NEW.md', 'releases/v1.md']);
    expect(flat('es')).toEqual(['es/index', 'es/ATAJOS.md', 'es/MCP.md', 'releases/v1.md']);
  });

  it('links each page to its translation, through the Spanish aliases, or to the other index', () => {
    const published = new Set(docs);
    expect(counterpart('SHORTCUTS.md', published)).toBe('es/ATAJOS.md');
    expect(counterpart('es/ATAJOS.md', published)).toBe('SHORTCUTS.md');
    expect(counterpart('SCENARIO_FORMAT.md', published)).toBe('es/index');
    expect(counterpart('index', published)).toBe('es/index');
  });
});

describe('stripLangLine', () => {
  it('removes the Markdown language switch, which the site header replaces', () => {
    expect(stripLangLine('# T\n\n> Read this in: [Español](es/T.md)\n\nBody')).toBe('# T\n\nBody');
    expect(stripLangLine('# T\n\n> Leer en: [English](../T.md)\n\nCuerpo')).toBe('# T\n\nCuerpo');
    expect(stripLangLine('> Note: keep me')).toBe('> Note: keep me');
  });
});
