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
