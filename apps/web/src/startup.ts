/** Tiny pre-React startup controller. The HTML overlay survives the React root mounting. */
import { startupEn } from './strings.en';
import { startupEs } from './strings.es';
const copy = { en: startupEn, es: startupEs };
let timer: ReturnType<typeof setTimeout> | undefined;
let finished = false;
let failed = false;
let locale: keyof typeof copy = 'en';

export function setStartupLocale(language: string): void {
  locale = /^es(?:[-_]|$)/i.test(language) ? 'es' : 'en';
  const overlay = document.getElementById('startup');
  if (!overlay) return;
  overlay.lang = locale;
  const status = document.getElementById('startup-status');
  if (status) status.textContent = copy[locale][failed ? 'error' : 'loading'];
  const reload = document.getElementById('startup-reload');
  if (reload) reload.textContent = copy[locale].reload;
}

export function failStartup(): void {
  if (finished || !document.getElementById('startup')) return;
  failed = true;
  clearTimeout(timer);
  document.getElementById('startup')?.setAttribute('data-state', 'error');
  document.getElementById('startup-status')?.setAttribute('role', 'alert');
  setStartupLocale(locale);
}

export function finishStartup(): void {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onError);
  document.getElementById('startup')?.remove();
  const root = document.getElementById('root');
  root?.removeAttribute('inert');
  root?.removeAttribute('aria-hidden');
  root?.removeAttribute('aria-busy');
}

function onError(): void { failStartup(); }

export function startStartup(): void {
  if (!document.getElementById('startup')) return;
  clearTimeout(timer);
  finished = false;
  failed = false;
  let preferred = navigator.language;
  try {
    const saved = localStorage.getItem('lila.idioma');
    if (saved === 'en' || saved === 'es') preferred = saved;
  } catch { /* Browser storage can be disabled. */ }
  setStartupLocale(preferred);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  // A hung request must offer recovery. Readiness can still dismiss the overlay later.
  timer = setTimeout(failStartup, 30_000);
}
