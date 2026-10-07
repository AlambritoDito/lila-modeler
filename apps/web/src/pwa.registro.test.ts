// @vitest-environment jsdom
/** #574: when the service worker is registered, and when it is not. */
import { afterEach, expect, it, vi } from 'vitest';
import { registrarServiceWorker } from './pwa';

function conServiceWorker(register = vi.fn().mockResolvedValue({ scope: 'x' })) {
  Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true });
  return register;
}
afterEach(() => {
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  delete (window as { lila?: unknown }).lila;
  vi.restoreAllMocks();
});

it('registers sw.js at the base, scoped to it, in a production build over http(s)', async () => {
  const register = conServiceWorker();
  await registrarServiceWorker('/lila-modeler/app/', true);
  expect(register).toHaveBeenCalledWith('/lila-modeler/app/sw.js', { scope: '/lila-modeler/app/' });
});

it('does nothing in development, in Electron, or without service workers', async () => {
  const register = conServiceWorker();
  await expect(registrarServiceWorker('/', false)).resolves.toBeNull();
  (window as { lila?: unknown }).lila = {};
  await expect(registrarServiceWorker('/', true)).resolves.toBeNull();
  expect(register).not.toHaveBeenCalled();
  delete (window as { lila?: unknown }).lila;
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  await expect(registrarServiceWorker('/', true)).resolves.toBeNull();
});

it('a failed registration is logged, not thrown', async () => {
  conServiceWorker(vi.fn().mockRejectedValue(new Error('SecurityError')));
  const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(registrarServiceWorker('/', true)).resolves.toBeNull();
  expect(aviso).toHaveBeenCalledOnce();
});
