import { expect, it } from 'vitest';
import { novedades } from '../novedades';

const CHANGELOG = `# Changelog

Intro of the file.

## [1.0.0-beta.4] - 2026-09-24

Lote B: the About window
and the welcome.

### Added

- Something.

## [1.0.0-beta.3] - 2026-09-23

### Fixed

- Only a list.
`;

it('takes the first paragraph of the version section, joined into one line (#425)', () => {
  expect(novedades(CHANGELOG, '1.0.0-beta.4')).toBe('Lote B: the About window and the welcome.');
  expect(novedades(CHANGELOG, '1.0.0-beta.3')).toBe('');
  expect(novedades(CHANGELOG, '9.9.9')).toBe('');
});

it('reduces inline markdown to plain text (#425)', () => {
  const md = '## [2.0.0] - 2026-10-01\n\nTry it at <https://example.org/app/>, read **the notes**, run `lila run`\nor see [the guide](https://example.org/guide).\n';
  expect(novedades(md, '2.0.0')).toBe('Try it at https://example.org/app/, read the notes, run lila run or see the guide.');
});

it('handles a heading at the very start, trailing spaces and a section at the end of the file (#425)', () => {
  expect(novedades('## [2.0.0] - 2026-10-01\n\nRight.   \n', '2.0.0')).toBe('Right.');
  expect(novedades('## [2.0.0] - 2026-10-01\nRight away.', '2.0.0')).toBe('Right away.');
  expect(novedades('## [2.0.0]', '2.0.0')).toBe('');
});
