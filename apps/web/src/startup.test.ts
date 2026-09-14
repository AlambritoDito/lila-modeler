// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { failStartup, finishStartup, setStartupLocale, startStartup } from './startup';

beforeEach(() => {
  vi.useFakeTimers();
  // Exercise the actual pre-React markup, including the inert editor and recovery link.
  const path = '../index.html';
  const html = readFileSync(new URL(path, import.meta.url), 'utf8');
  document.body.innerHTML = html.split('<body>')[1]!.split('</body>')[0]!;
  startStartup();
});
afterEach(() => { finishStartup(); localStorage.clear(); document.body.innerHTML = ''; vi.useRealTimers(); });
it('keeps the editor inaccessible while loading, then dismisses without a minimum delay', () => {
  expect(document.getElementById('root')?.hasAttribute('inert')).toBe(true);
  vi.advanceTimersByTime(5000);
  expect(document.getElementById('startup')?.dataset['state']).toBeUndefined();
  finishStartup();
  expect(document.getElementById('startup')).toBeNull();
  expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false);
  expect(document.getElementById('root')?.hasAttribute('aria-hidden')).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});
it('offers recovery after a hung load and still accepts late readiness', () => {
  vi.advanceTimersByTime(30_000);
  expect(document.getElementById('startup')?.dataset['state']).toBe('error');
  expect(document.getElementById('startup-reload')?.getAttribute('href')).toBe('');
  expect(document.getElementById('startup-status')?.getAttribute('role')).toBe('alert');
  finishStartup();
  expect(document.getElementById('startup')).toBeNull();
});
it('localizes loading and error copy using saved and resolved desktop preferences', () => {
  localStorage.setItem('lila.idioma', 'es');
  startStartup();
  expect(document.getElementById('startup-status')?.textContent).toContain('Preparando');
  failStartup();
  expect(document.getElementById('startup-status')?.textContent).toContain('no pudo');
  setStartupLocale('en');
  expect(document.getElementById('startup-status')?.textContent).toContain('could not');
});
it('handles bundle errors only during startup, and repeated readiness never resurrects the overlay', () => {
  window.dispatchEvent(new Event('error'));
  expect(document.getElementById('startup')?.dataset['state']).toBe('error');
  finishStartup(); finishStartup(); failStartup();
  window.dispatchEvent(new Event('error'));
  vi.advanceTimersByTime(60_000);
  expect(document.getElementById('startup')).toBeNull();
  expect(document.getElementById('root')?.hasAttribute('inert')).toBe(false);
});
