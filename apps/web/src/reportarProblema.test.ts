/**
 * #651: «Report a problem…» opens GitHub's bug form with the version and environment filled in,
 * and nothing else: no model, no file names, no full user agent.
 */
import { describe, expect, it } from 'vitest';
import { entorno, urlReporte } from './reportarProblema';

const UA = {
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.2792.79',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  operaWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  raro: 'curl/8.7.1',
};

describe('urlReporte', () => {
  it('carries exactly template, version and environment, percent-encoded (a space is %20, never +)', () => {
    const url = urlReporte('1.0.0-beta.27', 'macOS 15.1.0 arm64 · desktop app');
    expect(url).toBe(
      'https://github.com/AlambritoDito/lila-modeler/issues/new?template=bug_report.yml'
      + '&version=1.0.0-beta.27&environment=macOS%2015.1.0%20arm64%20%C2%B7%20desktop%20app',
    );
    expect(url).not.toContain('+');
    const u = new URL(url);
    expect([...u.searchParams.keys()]).toEqual(['template', 'version', 'environment']);
    expect(u.searchParams.get('template')).toBe('bug_report.yml');
    expect(u.searchParams.get('version')).toBe('1.0.0-beta.27');
    expect(u.searchParams.get('environment')).toBe('macOS 15.1.0 arm64 · desktop app');
  });

  it('encodes what would break the query (&, =, #, +)', () => {
    const u = new URL(urlReporte('1+2', 'a&b=c#d'));
    expect([...u.searchParams.keys()]).toEqual(['template', 'version', 'environment']);
    expect(u.searchParams.get('version')).toBe('1+2');
    expect(u.searchParams.get('environment')).toBe('a&b=c#d');
    expect(u.hash).toBe('');
  });
});

describe('entorno', () => {
  it.each([
    [{ platform: 'darwin', arch: 'arm64', version: '15.1.0' }, 'macOS 15.1.0 arm64 · desktop app'],
    [{ platform: 'win32', arch: 'x64', version: '10.0.22631' }, 'Windows 10.0.22631 x64 · desktop app'],
    [{ platform: 'linux', arch: 'x64', version: '6.8.0' }, 'Linux 6.8.0 x64 · desktop app'],
    [{ platform: 'freebsd', arch: 'x64', version: '' }, 'freebsd x64 · desktop app'],
  ])('desktop app: the OS, its version and the architecture from the bridge (%o)', (system, esperado) => {
    // The user agent is ignored when there is a bridge: the desktop app is never «browser».
    expect(entorno({ bridge: { system }, userAgent: UA.chromeMac, standalone: false })).toBe(esperado);
  });

  it.each([
    ['chromeMac', false, 'macOS · browser (Chrome)'],
    ['edgeWin', true, 'Windows · PWA (Edge)'],
    ['edgeWin', false, 'Windows · browser (Edge)'],
    ['firefoxLinux', false, 'Linux · browser (Firefox)'],
    ['safariMac', false, 'macOS · browser (Safari)'],
    ['operaWin', false, 'Windows · browser (Opera)'],
    ['chromeAndroid', true, 'Android · PWA (Chrome)'],
    ['safariIphone', true, 'iOS · PWA (Safari)'],
    ['chromeOs', false, 'ChromeOS · browser (Chrome)'],
    ['raro', false, 'unknown OS · browser (other)'],
  ] as const)('web (%s, standalone %s): the OS family, the surface and only the browser family', (ua, standalone, esperado) => {
    const texto = entorno({ userAgent: UA[ua], standalone });
    expect(texto).toBe(esperado);
    // Never the user agent itself, nor a browser version.
    expect(texto).not.toMatch(/Mozilla|\d+\.\d/);
  });
});
