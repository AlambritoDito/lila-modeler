import { describe, expect, it } from 'vitest';
import { desktopStrings } from './strings/index.js';
import { compareVersions, pickUpdate, updateDialogOptions } from './updateCheck.js';

const rel = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/AlambritoDito/lila-modeler/releases/tag/${tag}`,
  draft: false,
  ...extra,
});

describe('#487 · compareVersions', () => {
  it.each([
    ['1.0.0-beta.10', '1.0.0-beta.9'],
    ['1.0.0', '1.0.0-beta.9'],
    ['1.0.1', '1.0.0'],
    ['v1.1.0-alpha.1', '1.0.9'],
    ['1.0.0-beta.1', '1.0.0-alpha.1'],
    ['1.0.0-beta.1.1', '1.0.0-beta.1'],
  ])('%s > %s', (a, b) => {
    expect(compareVersions(a, b)).toBeGreaterThan(0);
    expect(compareVersions(b, a)).toBeLessThan(0);
  });

  it('the same version with or without the v is equal', () => {
    expect(compareVersions('v1.0.0-beta.9', '1.0.0-beta.9')).toBe(0);
  });
});

describe('#487 · pickUpdate', () => {
  it('an older published release is never offered (beta.9 app, only beta.1 public)', () => {
    expect(pickUpdate([rel('v1.0.0-beta.1')], '1.0.0-beta.9')).toBeNull();
  });

  it('picks the highest newer release, whatever the order of the list', () => {
    const list = [rel('v1.0.0-beta.10'), rel('v1.0.0'), rel('v1.0.0-beta.1')];
    expect(pickUpdate(list, '1.0.0-beta.9')?.tagName).toBe('v1.0.0');
  });

  it('the current version is not an update', () => {
    expect(pickUpdate([rel('v1.0.0-beta.9')], '1.0.0-beta.9')).toBeNull();
  });

  it('skips drafts, non-semver tags, foreign URLs and junk', () => {
    const list = [
      rel('v2.0.0', { draft: true }),
      rel('nightly'),
      rel('v3.0.0', { html_url: 'https://evil.example/lila' }),
      null,
      42,
      { tag_name: 5 },
    ];
    expect(pickUpdate(list, '1.0.0-beta.9')).toBeNull();
    expect(pickUpdate({ message: 'rate limited' }, '1.0.0-beta.9')).toBeNull();
  });
});

describe('#487 · updateDialogOptions', () => {
  it.each(['en', 'es'] as const)('%s · Download first, Later cancels, version in the texts', (locale) => {
    const S = desktopStrings(locale).actualizacion;
    const o = updateDialogOptions(desktopStrings(locale), { tagName: 'v1.0.0-beta.10', url: 'https://github.com/x' }, '1.0.0-beta.9');
    expect(o.buttons).toEqual([S.descargar, S.despues]);
    expect(o.defaultId).toBe(0);
    expect(o.cancelId).toBe(1);
    expect(o.message).toContain('1.0.0-beta.10');
    expect(o.message).not.toContain('v1.0.0');
    expect(o.detail).toContain('1.0.0-beta.9');
  });
});
