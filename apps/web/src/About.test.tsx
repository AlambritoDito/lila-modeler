// @vitest-environment jsdom
/**
 * Acceptance of LILA-381 and #408: the About content shows the rounded Lila image, the name in
 * bold, the version from `package.json` and the owner's two brand lines — always in Spanish, even
 * with the UI in English —, the close button asks to close the window, and the owner's Easter egg
 * (2026-09-22): six clicks on the image (each one pulsing it), the right key opens its link — or
 * hands over to the karaoke first, for «brito» — and any other key reveals nothing. The window
 * itself (opening, Esc, closing resets the egg, the karaoke guard) is covered in `App.test.tsx`.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { About, Karaoke, KARAOKE_DURACION_TOTAL_MS } from './About';
import { setLocale } from './i18n';
import { version } from '../package.json';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let onCerrar: ReturnType<typeof vi.fn>;
let onKaraoke: ReturnType<typeof vi.fn>;

async function montar(): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onCerrar = vi.fn();
  onKaraoke = vi.fn();
  await act(async () => root.render(<About onCerrar={onCerrar} onKaraoke={onKaraoke} />));
}

/** Mounts only the karaoke, as `App.tsx` does after closing the About window. */
async function montarKaraoke(onTerminar: () => void = () => {}): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Karaoke onTerminar={onTerminar} />));
}

/** The clicks that reveal the key (LILA-381): one by one, each wrapped in `act`. */
async function clicarIcono(veces: number): Promise<void> {
  const icono = container.querySelector<HTMLImageElement>('.acerca-icono')!;
  for (let i = 0; i < veces; i += 1) {
    await act(async () => { icono.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  }
}

/** Types the key into the field (a controlled input: it needs an `input` event, not just
 * `.value =`) and submits the form with «Entrar». */
async function enviarClave(texto: string): Promise<void> {
  const campo = container.querySelector<HTMLInputElement>('.acerca-clave input')!;
  const receptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    receptor.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('.acerca-clave button[type="submit"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => { setLocale('en'); vi.stubGlobal('open', vi.fn()); });
const BRITO = 'https://www.youtube.com/watch?v=r7GBGZ004vQ&list=RDr7GBGZ004vQ&start_radio=1&t=203s';
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('shows the rounded Lila app icon, the name in bold and the version from package.json', async () => {
  await montar();
  const img = container.querySelector('img')!;
  expect(img.getAttribute('src')).toContain('branding/app-icon.png');
  expect(img.classList.contains('acerca-icono')).toBe(true);
  expect(container.querySelector('dialog')).toBeNull();
  expect(container.querySelector('strong')?.textContent).toBe('Lila Modeler');
  expect(container.querySelector('.acerca-version')?.textContent).toBe(`v${version}`);
});

it('the two brand lines are exact with the UI in English', async () => {
  setLocale('en');
  await montar();
  const lineas = [...container.querySelectorAll('.acerca-marca')].map((p) => p.textContent);
  expect(lineas).toEqual(['Lila Modeler® — Hecho en México 🇲🇽', 'De Tabachines para el mundo.']);
});

it('the two brand lines are exact with the UI in Spanish (they do not depend on the language)', async () => {
  setLocale('es');
  await montar();
  const lineas = [...container.querySelectorAll('.acerca-marca')].map((p) => p.textContent);
  expect(lineas).toEqual(['Lila Modeler® — Hecho en México 🇲🇽', 'De Tabachines para el mundo.']);
  // The name does come from the catalog, and it is the same proper noun in both.
  expect(container.querySelector('strong')?.textContent).toBe('Lila Modeler');
});

it('the close button asks to close the window', async () => {
  await montar();
  await act(async () => { container.querySelector<HTMLButtonElement>('.acerca-cerrar')!.click(); });
  expect(onCerrar).toHaveBeenCalledOnce();
});

// ---------- Easter egg (LILA-381, owner request 2026-09-22) ----------

it('five clicks on the image reveal nothing', async () => {
  await montar();
  await clicarIcono(5);
  expect(container.querySelector('.acerca-clave')).toBeNull();
});

it('every click pulses the image and counts, even while the pulse is still playing (#408)', async () => {
  await montar();
  const icono = container.querySelector<HTMLImageElement>('.acerca-icono')!;
  await clicarIcono(1);
  expect(icono.classList.contains('pulso')).toBe(true);
  // jsdom has no `AnimationEvent`, so React listens for the prefixed name there; a browser fires
  // (and React listens for) `animationend`. Both are sent so the test does not depend on which.
  await act(async () => {
    for (const nombre of ['animationend', 'webkitAnimationEnd']) icono.dispatchEvent(new Event(nombre, { bubbles: true }));
  });
  expect(icono.classList.contains('pulso')).toBe(false);
  // Five more without letting any pulse finish: none of them is swallowed.
  await clicarIcono(5);
  expect(icono.classList.contains('pulso')).toBe(true);
  expect(container.querySelector('.acerca-clave')).not.toBeNull();
});

it('the sixth click reveals the key form, without any hint', async () => {
  await montar();
  await clicarIcono(6);
  const form = container.querySelector('.acerca-clave')!;
  expect(form).not.toBeNull();
  expect(form.querySelector('label')?.textContent).toBe('Clave secreta');
  expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Entrar');
  // Not a single hint attribute (placeholder, title…) on the field.
  const campo = form.querySelector('input')!;
  expect(campo.getAttribute('placeholder')).toBeNull();
  expect(campo.getAttribute('title')).toBeNull();
});

it('a wrong key opens nothing and does not tell which keys exist', async () => {
  await montar();
  await clicarIcono(6);
  await enviarClave('lo que sea');
  expect(window.open).not.toHaveBeenCalled();
  expect(onKaraoke).not.toHaveBeenCalled();
  // The field is cleared: the attempt does not stay in view.
  expect(container.querySelector<HTMLInputElement>('.acerca-clave input')!.value).toBe('');
});

it('«scuba» (with capitals and spaces) opens its link at once', async () => {
  await montar();
  await clicarIcono(6);
  await enviarClave('  Scuba  ');
  expect(window.open).toHaveBeenCalledWith('https://www.youtube.com/watch?v=1jvqMJ379rc', '_blank', 'noopener,noreferrer');
});

it('«brito» hands over to the karaoke and opens nothing itself', async () => {
  await montar();
  await clicarIcono(6);
  await enviarClave('Brito');
  expect(onKaraoke).toHaveBeenCalledOnce();
  expect(window.open).not.toHaveBeenCalled();
});

it('the key field offers no autocomplete or spellcheck (QA of #387, Low)', async () => {
  await montar();
  await clicarIcono(6);
  const campo = container.querySelector<HTMLInputElement>('.acerca-clave input')!;
  expect(campo.getAttribute('autocomplete')).toBe('off');
  expect(campo.getAttribute('spellcheck')).toBe('false');
});

// ---------- karaoke ----------

it('the karaoke shows the three lines and only at the end opens its link and finishes', async () => {
  vi.useFakeTimers();
  const onTerminar = vi.fn();
  await montarKaraoke(onTerminar);
  const overlay = document.querySelector('.karaoke')!;
  expect(overlay.parentElement).toBe(document.body);
  expect(overlay.textContent).toContain('Me eh dado la tarea de sobrepasar los niveles del modelado y simulación, ustedes saben ya.'.replaceAll(' ', ''));
  expect(overlay.querySelector('.karaoke-epica')?.textContent).toBe('"La Mente Maestra"');
  expect(window.open).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(KARAOKE_DURACION_TOTAL_MS); });
  expect(window.open).toHaveBeenCalledWith(BRITO, '_blank', 'noopener,noreferrer');
  expect(onTerminar).toHaveBeenCalledOnce();
});

it('the karaoke timer survives re-renders (QA of #387, Medium)', async () => {
  // Before the fix the callbacks were dependencies of the effect that arms the `setTimeout`: any
  // unrelated render — a running simulation's progress, in the real app — restarted it.
  vi.useFakeTimers();
  await montarKaraoke();
  const PASO_MS = 100;
  const RENDERS = 5;
  for (let i = 0; i < RENDERS; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(PASO_MS);
      root.render(<Karaoke onTerminar={() => {}} />);
    });
  }
  // Only what is left since the ORIGINAL mount, plus a margin: a restarted clock would not fire.
  await act(async () => { vi.advanceTimersByTime(KARAOKE_DURACION_TOTAL_MS - RENDERS * PASO_MS + 50); });
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(window.open).toHaveBeenCalledWith(BRITO, '_blank', 'noopener,noreferrer');
});

it('the overlay is `role="presentation"`/`aria-live="polite"` and makes `#root` inert while it plays (QA of #387, Low)', async () => {
  const raiz = document.createElement('div');
  raiz.id = 'root';
  document.body.append(raiz);
  vi.useFakeTimers();
  try {
    const onTerminar = vi.fn();
    await montarKaraoke(onTerminar);
    const overlay = document.querySelector('.karaoke')!;
    expect(overlay.getAttribute('role')).toBe('presentation');
    expect(overlay.getAttribute('aria-live')).toBe('polite');
    expect(raiz.hasAttribute('inert')).toBe(true);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(onTerminar).toHaveBeenCalledOnce();
    await act(async () => root.render(<></>));
    expect(raiz.hasAttribute('inert')).toBe(false);
  } finally {
    raiz.remove();
  }
});

it('Escape during the karaoke ends it and the link never opens, even if it stays mounted', async () => {
  vi.useFakeTimers();
  const onTerminar = vi.fn();
  await montarKaraoke(onTerminar);
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(onTerminar).toHaveBeenCalledOnce();
  // `onTerminar` is a spy here, so the overlay stays mounted: only its own `clearTimeout` stops it.
  await act(async () => { vi.advanceTimersByTime(KARAOKE_DURACION_TOTAL_MS); });
  expect(window.open).not.toHaveBeenCalled();
  expect(onTerminar).toHaveBeenCalledOnce();
});

it('under reduced motion a click still counts but adds no pulse class (#408)', async () => {
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }));
  await montar();
  await clicarIcono(6);
  expect(container.querySelector('.acerca-icono')!.classList.contains('pulso')).toBe(false);
  expect(container.querySelector('.acerca-clave')).not.toBeNull();
});
