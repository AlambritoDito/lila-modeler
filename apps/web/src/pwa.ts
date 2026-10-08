/**
 * Registers the service worker that lets the installed web app open offline (#574, ADR-031).
 * Only in a production build served over http(s) — the Pages site, or a local server of it — and
 * never in Electron, whose `lila://` app has everything on disk already and whose preload exposes
 * `window.lila`. A failure is only logged: the app works the same without the worker.
 */
export function registrarServiceWorker(
  base: string = import.meta.env.BASE_URL,
  prod: boolean = import.meta.env.PROD,
): Promise<ServiceWorkerRegistration | null> {
  const escritorio = (window as { lila?: unknown }).lila !== undefined;
  if (!prod || escritorio || !('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) {
    return Promise.resolve(null);
  }
  return navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch((error: unknown) => {
    console.warn('[lila] service worker not registered; the app keeps working online only', error);
    return null;
  });
}
