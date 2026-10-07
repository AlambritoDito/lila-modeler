/**
 * The installable web app (#571, #572, ADR-031): what Chrome and Edge read before they offer
 * «Install». The browser-side check (`Page.getInstallabilityErrors` on the Pages build) is
 * `tools/check-pwa.mjs`; this one keeps the manifest honest on every `npm test`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildHash, precacheList, serviceWorkerSource } from '../serviceWorker';

const read = (path: string): Buffer => readFileSync(new URL(path, import.meta.url));
interface Icon { src: string; sizes: string; type: string; purpose?: string }
const manifest = JSON.parse(read('../manifest.webmanifest').toString('utf8')) as {
  id: string; name: string; short_name: string; start_url: string; scope: string; display: string;
  theme_color: string; background_color: string; icons: Icon[];
  file_handlers: { action: string; accept: Record<string, string[]>; icons?: Icon[] }[];
  launch_handler?: { client_mode: string | string[] };
};

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): [number, number] {
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}
/** Manifest icons live in `branding/`, staged from `docs/design/branding/web/` by Vite. */
const iconFile = (src: string): Buffer => {
  expect(src).toMatch(/^branding\/[\w-]+\.png$/);
  return read(`../../../docs/design/branding/web/${src.slice('branding/'.length)}`);
};

describe('manifest.webmanifest', () => {
  it('is relative to its own URL, so one file serves `/` and `/lila-modeler/app/`', () => {
    for (const url of [manifest.id, manifest.start_url, manifest.scope, ...manifest.file_handlers.map((h) => h.action)]) {
      expect(url).toBe('./');
    }
    expect(manifest.display).toBe('standalone');
    expect(manifest.name).toBe('Lila Modeler');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(manifest.background_color).toBe('#ffffff');
  });

  it('has 192 and 512 icons and a maskable one, each the size it declares', () => {
    const declared = manifest.icons.map((i) => `${i.sizes}:${i.purpose ?? 'any'}`);
    expect(declared).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
    for (const icon of [...manifest.icons, ...manifest.file_handlers.flatMap((h) => h.icons ?? [])]) {
      expect(icon.type).toBe('image/png');
      expect(pngSize(iconFile(icon.src)).join('x')).toBe(icon.sizes);
    }
  });

  it('declares `.lila` as a file it opens (file_handlers)', () => {
    expect(manifest.file_handlers).toHaveLength(1);
    expect(manifest.file_handlers[0]!.accept).toEqual({ 'application/vnd.lila-modeler+zip': ['.lila'] });
  });

  it('sends a launched file to the window already open, where the unsaved-changes prompt is', () => {
    expect(manifest.launch_handler).toEqual({ client_mode: ['focus-existing', 'auto'] });
  });

  it('is linked from index.html with the same theme color', () => {
    const html = read('../index.html').toString('utf8');
    expect(html).toContain('<link rel="manifest" href="%BASE_URL%manifest.webmanifest" />');
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}" />`);
  });
});

// #574: the worker is a template filled at build time; here it runs against in-memory doubles of
// `caches`, `fetch` and the worker's `self`.
describe('service worker (#574)', () => {
  const SCOPE = 'https://alambritodito.github.io/lila-modeler/app/';
  const template = read('../sw.js').toString('utf8');

  it('precaches the build as shipped: index as ./, no worker, no legacy font formats', () => {
    expect(precacheList(['index.html', 'sw.js', 'assets/main-abc.js', 'assets/f.woff2', 'assets/f.woff', 'assets/f.ttf', 'assets/f.eot', 'manifest.webmanifest']))
      .toEqual(['./', 'assets/f.woff2', 'assets/main-abc.js', 'manifest.webmanifest']);
  });

  it('fills in the version and the list, and refuses a template without its placeholders', () => {
    const src = serviceWorkerSource(template, '1.0.0-beta.22', ['index.html']);
    expect(src).toContain('const VERSION = "1.0.0-beta.22";');
    expect(src).toContain('const PRECACHE = ["./"];');
    expect(() => serviceWorkerSource('self.addEventListener()', '1', [])).toThrow(/placeholders/);
    // The build hash joins the version in the cache name: a deploy without a bump still renews it.
    expect(serviceWorkerSource(template, '1.0.0', ['index.html'], 'abcd1234')).toContain('const VERSION = "1.0.0-abcd1234";');
  });

  it('the build hash follows the content of the files, not only their names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lila-sw-'));
    writeFileSync(join(dir, 'index.html'), 'a');
    writeFileSync(join(dir, 'lila-dark.json'), '{}');
    const primero = buildHash(dir, ['index.html', 'lila-dark.json']);
    expect(primero).toMatch(/^[0-9a-f]{8}$/);
    expect(buildHash(dir, ['index.html', 'lila-dark.json'])).toBe(primero);
    writeFileSync(join(dir, 'lila-dark.json'), '{"x":1}');
    expect(buildHash(dir, ['index.html', 'lila-dark.json'])).not.toBe(primero);
    rmSync(dir, { recursive: true, force: true });
  });

  /** Runs the worker for `version` with in-memory caches (shared across versions, like a browser). */
  function worker(version: string, files: string[], store = new Map<string, Map<string, string>>()) {
    const listeners: Record<string, (event: unknown) => void> = {};
    /** The `cache` mode of every precache request. */
    const modos: RequestCache[] = [];
    const fetchMock = vi.fn(async (req: { url: string } | string) => {
      const url = typeof req === 'string' ? req : req.url;
      return { ok: true, type: 'basic', body: `net:${url}`, clone() { return this; } };
    });
    const cacheOf = (name: string) => {
      const entries = store.get(name) ?? new Map<string, string>();
      store.set(name, entries);
      return {
        addAll: async (reqs: Request[]) => {
          for (const r of reqs) { modos.push(r.cache); entries.set(r.url, `pre:${r.url}`); }
        },
        match: async (req: { url: string } | string) => {
          const body = entries.get(typeof req === 'string' ? req : req.url);
          return body === undefined ? undefined : { body };
        },
        put: async (req: { url: string }, res: { body: string }) => { entries.set(req.url, res.body); },
      };
    };
    const caches = {
      open: async (name: string) => cacheOf(name),
      keys: async () => [...store.keys()],
      delete: async (name: string) => store.delete(name),
    };
    const self = {
      registration: { scope: SCOPE },
      clients: { claim: vi.fn(async () => undefined) },
      addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type] = fn; },
    };
    new Function('self', 'caches', 'fetch', serviceWorkerSource(template, version, files))(self, caches, fetchMock);
    const dispatch = async (type: string, extra: object = {}) => {
      let pending: Promise<unknown> | undefined;
      const event = { ...extra, waitUntil: (p: Promise<unknown>) => { pending = p; }, respondWith: (p: Promise<unknown>) => { pending = p; } };
      listeners[type]!(event);
      return pending === undefined ? undefined : await pending;
    };
    return { store, fetchMock, self, dispatch, modos };
  }
  const get = (path: string, mode = 'cors') => ({ request: { url: new URL(path, SCOPE).href, method: 'GET', mode } });

  it('install precaches every listed file under a cache named after the version', async () => {
    const w = worker('1.0.0', ['index.html', 'assets/main.js']);
    await w.dispatch('install');
    expect([...w.store.keys()]).toEqual(['lila-modeler-1.0.0']);
    expect([...w.store.get('lila-modeler-1.0.0')!.keys()]).toEqual([SCOPE, `${SCOPE}assets/main.js`]);
    // Past the HTTP cache: Pages' max-age could hand back the previous version's index.html.
    expect(w.modos).toEqual(['reload', 'reload']);
  });

  it('activating a new version deletes older Lila caches, and only those', async () => {
    const store = new Map([['lila-modeler-0.9.0', new Map()], ['another-app', new Map()]]);
    const w = worker('1.0.0', ['index.html'], store);
    await w.dispatch('install');
    await w.dispatch('activate');
    expect([...store.keys()].sort()).toEqual(['another-app', 'lila-modeler-1.0.0']);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });

  it('serves hashed assets from the cache, and caches what was not precached on first use', async () => {
    const w = worker('1.0.0', ['assets/main.js']);
    await w.dispatch('install');
    expect(await w.dispatch('fetch', get('assets/main.js'))).toEqual({ body: `pre:${SCOPE}assets/main.js` });
    expect(w.fetchMock).not.toHaveBeenCalled();
    await w.dispatch('fetch', get('assets/lazy.js'));
    expect(await w.dispatch('fetch', get('assets/lazy.js'))).toEqual({ body: `net:${SCOPE}assets/lazy.js` });
    expect(w.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('files with a fixed name (themes, manifest) go to the network first and to the cache offline', async () => {
    const w = worker('1.0.0', ['lila-dark.json']);
    await w.dispatch('install');
    expect(await w.dispatch('fetch', get('lila-dark.json'))).toMatchObject({ body: `net:${SCOPE}lila-dark.json` });
    w.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await w.dispatch('fetch', get('lila-dark.json'))).toEqual({ body: `pre:${SCOPE}lila-dark.json` });
  });

  it('navigations go to the network first and fall back to the cached index offline', async () => {
    const w = worker('1.0.0', ['index.html']);
    await w.dispatch('install');
    expect(await w.dispatch('fetch', get('./', 'navigate'))).toMatchObject({ body: `net:${SCOPE}` });
    w.fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await w.dispatch('fetch', get('./?file=x', 'navigate'))).toEqual({ body: `pre:${SCOPE}` });
  });

  it('leaves other origins, other paths and non-GET requests to the browser', async () => {
    const w = worker('1.0.0', []);
    for (const request of [
      { url: 'https://api.github.com/repos/x/releases', method: 'GET', mode: 'cors' },
      { url: 'https://alambritodito.github.io/lila-modeler/docs/', method: 'GET', mode: 'navigate' },
      { url: `${SCOPE}x`, method: 'POST', mode: 'cors' },
    ]) expect(await w.dispatch('fetch', { request })).toBeUndefined();
  });
});
