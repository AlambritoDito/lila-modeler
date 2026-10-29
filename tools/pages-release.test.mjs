import { describe, expect, it } from 'vitest';
import { downloadsFrom, isNoLatestRelease, newestPublished } from './pages-release.mjs';

describe('newestPublished (#704)', () => {
  it('takes the newest published release and never a draft', () => {
    expect(newestPublished([
      { tagName: 'v1.0.0-beta.16', isDraft: false, publishedAt: '2026-09-29T01:35:31Z' },
      { tagName: 'v1.0.0-beta.27', isDraft: true, publishedAt: '' },
      { tagName: 'v1.0.0-beta.26', isDraft: false, publishedAt: '2026-10-14T14:08:19Z' },
      { tagName: 'v1.0.0-beta.28', isDraft: false, publishedAt: null },
    ])).toBe('v1.0.0-beta.26');
  });

  it('is null with nothing published', () => {
    expect(newestPublished([])).toBeNull();
    expect(newestPublished(null)).toBeNull();
    expect(newestPublished([{ tagName: 'v1', isDraft: true, publishedAt: '2026-01-01T00:00:00Z' }])).toBeNull();
  });
});

describe('isNoLatestRelease', () => {
  it('tells «no latest Release» apart from a network or auth failure', () => {
    expect(isNoLatestRelease('release not found\n')).toBe(true);
    expect(isNoLatestRelease('error connecting to api.github.com')).toBe(false);
    expect(isNoLatestRelease('')).toBe(false);
  });
});

describe('downloadsFrom', () => {
  it('picks the .dmg and the .exe, and is undefined without either', () => {
    const base = 'https://github.com/AlambritoDito/lila-modeler/releases/download/v1.0.0-beta.26/';
    expect(downloadsFrom([
      { name: 'Lila-Modeler-1.0.0-beta.26-mac-arm64.dmg', url: `${base}Lila-Modeler-1.0.0-beta.26-mac-arm64.dmg` },
      { name: 'Lila-Modeler-1.0.0-beta.26-win-x64.exe', url: `${base}Lila-Modeler-1.0.0-beta.26-win-x64.exe` },
      { name: 'SHA256SUMS', url: `${base}SHA256SUMS` },
    ])).toEqual({ dmg: `${base}Lila-Modeler-1.0.0-beta.26-mac-arm64.dmg`, exe: `${base}Lila-Modeler-1.0.0-beta.26-win-x64.exe` });
    expect(downloadsFrom([{ name: 'SHA256SUMS', url: 'x' }])).toBeUndefined();
    expect(downloadsFrom(undefined)).toBeUndefined();
  });
});
