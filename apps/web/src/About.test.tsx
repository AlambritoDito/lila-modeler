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

/** Los seis clics que destapan la clave (LILA-381): uno por uno, envueltos en `act`. */
async function clicarIcono(veces: number): Promise<void> {
  const icono = container.querySelector<HTMLImageElement>('.acerca-icono')!;
  for (let i = 0; i < veces; i += 1) {
    await act(async () => { icono.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  }
}

/** Teclea la clave en el campo (input controlado: hay que disparar `input`, no solo `.value =`) y
 * envía el formulario pulsando «Entrar». */
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

it('shows the rounded transparent Lila image, the name in bold and the version from package.json', async () => {
  await montar();
  const img = container.querySelector('img')!;
  expect(img.getAttribute('src')).toContain('branding/lila-transparent.png');
  expect(img.classList.contains('acerca-icono')).toBe(true);
  expect(container.querySelector('dialog')).toBeNull();
  expect(container.querySelector('strong')?.textContent).toBe('Lila Modeler');
  expect(container.querySelector('.acerca-version')?.textContent).toBe(`v${version}`);
});

it('las dos líneas de marca son exactas en inglés', async () => {
  setLocale('en');
  await montar();
  const lineas = [...container.querySelectorAll('.acerca-marca')].map((p) => p.textContent);
  expect(lineas).toEqual(['Lila Modeler® — Hecho en México 🇲🇽', 'De Tabachines para el mundo.']);
});

it('las dos líneas de marca son exactas en español (no dependen del idioma)', async () => {
  setLocale('es');
  await montar();
  const lineas = [...container.querySelectorAll('.acerca-marca')].map((p) => p.textContent);
  expect(lineas).toEqual(['Lila Modeler® — Hecho en México 🇲🇽', 'De Tabachines para el mundo.']);
  // Y el nombre, que sí sale del catálogo, sigue siendo el mismo nombre propio en los dos.
  expect(container.querySelector('strong')?.textContent).toBe('Lila Modeler');
});

it('the close button asks to close the window', async () => {
  await montar();
  await act(async () => { container.querySelector<HTMLButtonElement>('.acerca-cerrar')!.click(); });
  expect(onCerrar).toHaveBeenCalledOnce();
});

// ---------- huevo de pascua (LILA-381, pedido del dueño 2026-09-22) ----------

it('cinco clics en el icono no destapan nada', async () => {
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

it('el sexto clic destapa el formulario de la clave, sin ninguna pista', async () => {
  await montar();
  await clicarIcono(6);
  const form = container.querySelector('.acerca-clave')!;
  expect(form).not.toBeNull();
  expect(form.querySelector('label')?.textContent).toBe('Clave secreta');
  expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Entrar');
  // Ni un atributo de pista (placeholder, title…) en el campo.
  const campo = form.querySelector('input')!;
  expect(campo.getAttribute('placeholder')).toBeNull();
  expect(campo.getAttribute('title')).toBeNull();
});

it('una clave equivocada no abre nada ni dice qué claves existen', async () => {
  await montar();
  await clicarIcono(6);
  await enviarClave('lo que sea');
  expect(window.open).not.toHaveBeenCalled();
  expect(onKaraoke).not.toHaveBeenCalled();
  // El campo se limpia: no se queda el intento a la vista.
  expect(container.querySelector<HTMLInputElement>('.acerca-clave input')!.value).toBe('');
});

it('«scuba» (con mayúsculas y espacios) abre su enlace al instante', async () => {
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

it('el campo de la clave no ofrece autocompletar ni corrector (QA de #387, Low)', async () => {
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

it('el temporizador del karaoke sobrevive a que se vuelva a renderizar (QA de #387, Medium)', async () => {
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

it('el overlay es `role="presentation"`/`aria-live="polite"` y deja `#root` inerte mientras suena (QA de #387, Low)', async () => {
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

it('Escape durante el karaoke lo termina sin abrir el enlace', async () => {
  vi.useFakeTimers();
  const onTerminar = vi.fn();
  await montarKaraoke(onTerminar);
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(onTerminar).toHaveBeenCalledOnce();
  expect(window.open).not.toHaveBeenCalled();
});
