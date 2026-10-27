// @vitest-environment jsdom
/**
 * #704: the stable app (`/lila-modeler/app/`) and the beta (`/lila-modeler/beta/`) share one
 * origin on Pages. These tests hold the rule of `channel.ts`: every storage name differs between
 * the two, and the stable one is exactly today's, so existing users lose nothing.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { betaManifest, cachePrefix, channelOf, stableAppPath, storageKey } from './channel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP = '/lila-modeler/app/';
const BETA = '/lila-modeler/beta/';
const SRC = dirname(fileURLToPath(import.meta.url));

/** Every non-test source file of `apps/web/src`, with its text. */
function sources(): [string, string][] {
  return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((f) => [f, readFileSync(join(SRC, f), 'utf8')]);
}

describe('channel of a build', () => {
  it('is beta only for a base ending in /beta/', () => {
    expect(channelOf(BETA)).toBe('beta');
    expect(channelOf('/lila-modeler/beta')).toBe('beta');
    for (const base of ['/', APP, '/lila-modeler/', '/beta-x/']) expect(channelOf(base)).toBe('stable');
    expect(stableAppPath(BETA)).toBe(APP);
  });
});

describe('storage names (#704)', () => {
  // The names in use, read from the code itself: a key added later is covered without editing this.
  const nombres = [...new Set(sources().flatMap(([, text]) => [...text.matchAll(/storageKey\('([^']+)'\)/g)].map((m) => m[1]!)))];

  it('finds the keys the app uses', () => {
    expect(nombres).toEqual(expect.arrayContaining(['project.v1', 'tema', 'idioma', 'temas', 'paleta', 'avisoMovil', 'avisoBeta']));
  });

  it('with base /lila-modeler/beta/ every key differs from /lila-modeler/app/, and /app/ keys are unchanged', () => {
    for (const nombre of nombres) {
      expect(storageKey(nombre, APP)).toBe(`lila.${nombre}`);
      expect(storageKey(nombre, '/')).toBe(`lila.${nombre}`);
      const beta = storageKey(nombre, BETA);
      expect(beta).not.toBe(storageKey(nombre, APP));
      // Not a key of the stable app under any name: nothing it reads can be a beta value.
      expect(beta.startsWith('lila.')).toBe(false);
      expect(beta).toBe(`lila[${BETA}].${nombre}`);
    }
  });

  it('no storage call passes a literal key, and no code outside channel.ts spells a key out', () => {
    const literal = /(?:localStorage|sessionStorage|storage)\??\.(?:getItem|setItem|removeItem)\(\s*['"`]/;
    for (const [file, text] of sources()) expect(literal.test(text), file).toBe(false);
    // `lila.<name>` for a name in use, written in code (comments aside) instead of `storageKey(name)`.
    const codigo = (text: string) => text.split('\n').filter((l) => !/^\s*(?:\*|\/\/|\/\*)/.test(l)).join('\n');
    for (const [file, text] of sources()) {
      if (file === 'channel.ts') continue;
      for (const nombre of nombres) expect(codigo(text).includes(`lila.${nombre}'`), `${file}: lila.${nombre}`).toBe(false);
    }
    // Nor a cache or a database opened outside the service worker, whose names `cachePrefix` covers.
    for (const [file, text] of sources()) expect(/indexedDB\.open|caches\.open/.test(text), file).toBe(false);
  });

  it('the service worker caches of the two channels never share a prefix', () => {
    expect(cachePrefix(APP)).toBe('lila-modeler-');
    expect(cachePrefix('/')).toBe('lila-modeler-');
    expect(cachePrefix(BETA).startsWith(cachePrefix(APP))).toBe(false);
    expect(cachePrefix(APP).startsWith(cachePrefix(BETA))).toBe(false);
  });
});

describe('the beta session never overwrites or recovers the stable one', () => {
  // Every change mirrors the session and also downloads it, as in the browser.
  beforeEach(() => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); vi.restoreAllMocks(); localStorage.clear(); });

  async function storeAt(base: string) {
    vi.stubEnv('BASE_URL', base);
    vi.resetModules();
    return (await import('./store/BrowserStore')).BrowserStore;
  }

  it('each build reads and writes only its own key', async () => {
    const Stable = await storeAt(APP);
    const estable = new Stable();
    await estable.putProcess('p', '<estable/>');
    const guardadoEstable = localStorage.getItem('lila.project.v1');
    expect(guardadoEstable).toContain('<estable/>');

    const Beta = await storeAt(BETA);
    const beta = new Beta();
    expect(await beta.listProcesses()).toEqual([]);
    await beta.putProcess('p', '<beta/>');
    expect(localStorage.getItem(`lila[${BETA}].project.v1`)).toContain('<beta/>');
    expect(localStorage.getItem('lila.project.v1')).toBe(guardadoEstable);

    const OtraVezEstable = await storeAt(APP);
    expect((await new OtraVezEstable().getProcess('p'))?.xml).toBe('<estable/>');
    expect(await new (await storeAt(BETA))().getProcess('p')).toEqual({ xml: '<beta/>', name: 'p' });
  });
});

describe('beta manifest', () => {
  const stable = readFileSync(join(SRC, '../manifest.webmanifest'), 'utf8');

  it('renames the app and keeps every URL relative, so id and scope are the beta path', () => {
    const m = JSON.parse(betaManifest(stable)) as { id: string; scope: string; start_url: string; name: string; short_name: string };
    expect(m.name).toBe('Lila Modeler Beta');
    expect(m.short_name.length).toBeLessThanOrEqual(12);
    const resolve = (base: string, url: string) => new URL(url, new URL(`${base}manifest.webmanifest`, 'https://alambritodito.github.io')).href;
    expect(resolve(BETA, m.id)).toBe(`https://alambritodito.github.io${BETA}`);
    expect(resolve(BETA, m.scope)).not.toBe(resolve(APP, (JSON.parse(stable) as { scope: string }).scope));
    expect({ ...JSON.parse(betaManifest(stable)), name: 'Lila Modeler', short_name: 'Lila' }).toEqual(JSON.parse(stable));
  });
});

describe('beta notice', () => {
  afterEach(() => { sessionStorage.clear(); document.body.innerHTML = ''; });

  it('links to the stable app and stays closed for the tab once closed', async () => {
    const { AvisoBeta } = await import('./AvisoBeta');
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    await act(async () => { root.render(createElement(AvisoBeta, { base: BETA })); });
    expect(host.querySelector('a')?.getAttribute('href')).toBe(APP);
    await act(async () => { host.querySelector<HTMLButtonElement>('button')!.click(); });
    expect(host.querySelector('.aviso-beta')).toBeNull();
    await act(async () => { root.unmount(); });

    const otro = createRoot(host);
    await act(async () => { otro.render(createElement(AvisoBeta, { base: BETA })); });
    expect(host.querySelector('.aviso-beta')).toBeNull();
    await act(async () => { otro.unmount(); });
  });

  it('is mounted only by the beta build, never by the stable or desktop one', () => {
    const main = readFileSync(join(SRC, 'main.tsx'), 'utf8');
    expect(main).toMatch(/const beta = !desktop && channelOf\(\) === 'beta';/);
    // Over whichever view opens, the editor or the phone viewer.
    expect(main).toContain(`{beta ? <div className="canal-beta"><AvisoBeta />{vista}</div> : vista}`);
    expect(main.match(/<AvisoBeta/g)).toHaveLength(1);
  });
});
