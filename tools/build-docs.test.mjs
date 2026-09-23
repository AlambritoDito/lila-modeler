import { describe, expect, it } from 'vitest';
import { rewriteHref } from './build-docs.mjs';

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
