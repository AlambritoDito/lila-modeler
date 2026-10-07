/**
 * Lila Modeler's service worker (#574, ADR-031): lets the installed web app open without a
 * connection. This file is a template — `vite build` writes the real `sw.js` next to `index.html`
 * (`serviceWorker.ts`), with the app version and the list of built files filled in below.
 *
 * - One cache per version, `lila-modeler-<version>`. A new version is a new `sw.js` (its text
 *   changes), so the browser installs it, it precaches that version's files, and once every window
 *   of the old version has closed it takes over and deletes the caches of older versions. There is
 *   no `skipWaiting()`: an open window keeps the files it started with.
 * - Navigations go to the network first, so a connected visit always gets the current
 *   `index.html`; offline they fall back to the cached one.
 * - Everything else under the app's scope is served from the cache, and what was not precached
 *   is cached the first time it is fetched. Other origins (the update check on GitHub) and
 *   non-GET requests are left alone.
 */
const VERSION = '__LILA_VERSION__';
const PRECACHE = /* __LILA_PRECACHE__ */ [];
const PREFIX = 'lila-modeler-';
const CACHE = PREFIX + VERSION;
const scope = () => self.registration.scope;
const enScope = (url) => new URL(url, scope()).href;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map(enScope))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const claves = await caches.keys();
    await Promise.all(claves.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(scope())) return;
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch (error) {
        const cache = await caches.open(CACHE);
        const indice = await cache.match(enScope('./'));
        if (indice) return indice;
        throw error;
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardada = await cache.match(request);
    if (guardada) return guardada;
    const respuesta = await fetch(request);
    if (respuesta.ok && respuesta.type === 'basic') await cache.put(request, respuesta.clone());
    return respuesta;
  })());
});
