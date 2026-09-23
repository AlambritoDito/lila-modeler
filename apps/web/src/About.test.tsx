// @vitest-environment jsdom
/**
 * Aceptación de LILA-381: el diálogo «Acerca de» enseña el icono aprobado, el nombre en negrita,
 * la versión de `package.json` y las dos líneas de marca del dueño —siempre en español, aunque la
 * interfaz esté en inglés—, el botón de cerrar cierra el `<dialog>`, y el huevo de pascua del
 * dueño (2026-09-22): seis clics en el icono, la clave correcta abre el enlace que le toca —o el
 * karaoke antes, para «brito»— y cualquier otra clave no revela nada.
 */
import type { RefObject } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { About, KARAOKE_DURACION_TOTAL_MS } from './About';
import { setLocale } from './i18n';
import { version } from '../package.json';

// jsdom no implementa `showModal`/`close` de `<dialog>` (LILA-066 nota aparte, mismo motivo por
// el que `App.test.tsx` estampa `showModal`): sin esto, `dialogRef.current?.close()` no hace nada
// y la aserción de cierre no comprobaría lo que dice comprobar. `close()` sí dispara el evento
// nativo `close` en un navegador de verdad, así que el estampado lo reproduce: es de lo que
// depende el reinicio del huevo de pascua (`onClose` en `About.tsx`).
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')); };

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

async function montar(): Promise<RefObject<HTMLDialogElement | null>> {
  const dialogRef: RefObject<HTMLDialogElement | null> = { current: null };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<About dialogRef={dialogRef} />));
  dialogRef.current!.showModal();
  return dialogRef;
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
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('enseña el icono aprobado, el nombre en negrita y la versión de package.json', async () => {
  await montar();
  const img = container.querySelector('img')!;
  expect(img.getAttribute('src')).toContain('branding/app-icon.png');
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

it('el botón de cerrar cierra el diálogo', async () => {
  const dialogRef = await montar();
  expect(dialogRef.current?.open).toBe(true);
  await act(async () => { container.querySelector<HTMLButtonElement>('.acerca-cerrar')!.click(); });
  expect(dialogRef.current?.open).toBe(false);
});

// ---------- huevo de pascua (LILA-381, pedido del dueño 2026-09-22) ----------

it('cinco clics en el icono no destapan nada', async () => {
  await montar();
  await clicarIcono(5);
  expect(container.querySelector('.acerca-clave')).toBeNull();
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
  // El campo se limpia: no se queda el intento a la vista.
  expect(container.querySelector<HTMLInputElement>('.acerca-clave input')!.value).toBe('');
});

it('«scuba» (con mayúsculas y espacios) abre su enlace al instante', async () => {
  await montar();
  await clicarIcono(6);
  await enviarClave('  Scuba  ');
  expect(window.open).toHaveBeenCalledWith('https://www.youtube.com/watch?v=1jvqMJ379rc', '_blank', 'noopener,noreferrer');
});

it('«brito» cierra Acerca de, monta el karaoke con las tres líneas y solo al final abre su enlace', async () => {
  vi.useFakeTimers();
  const dialogRef = await montar();
  await clicarIcono(6);
  await enviarClave('Brito');
  // El diálogo de Acerca de se cerró antes de montar el overlay (si no, su «top layer» lo taparía).
  expect(dialogRef.current?.open).toBe(false);
  const overlay = document.querySelector('.karaoke')!;
  expect(overlay).not.toBeNull();
  expect(overlay.textContent).toContain('Me eh dado la tarea de sobrepasar los niveles del modelado y simulación, ustedes saben ya.'.replaceAll(' ', ''));
  expect(overlay.querySelector('.karaoke-epica')?.textContent).toBe('"La Mente Maestra"');
  expect(window.open).not.toHaveBeenCalled();
  await act(async () => { vi.advanceTimersByTime(KARAOKE_DURACION_TOTAL_MS); });
  expect(window.open).toHaveBeenCalledWith(
    'https://www.youtube.com/watch?v=r7GBGZ004vQ&list=RDr7GBGZ004vQ&start_radio=1&t=203s',
    '_blank',
    'noopener,noreferrer',
  );
  expect(document.querySelector('.karaoke')).toBeNull();
});

it('el temporizador del karaoke sobrevive a que `About` se vuelva a renderizar (QA de #387, Medium)', async () => {
  // Antes del arreglo, `onFin`/`onCancelar` eran dependencias del `useEffect` que arma el
  // `setTimeout`: como son funciones nuevas en cada render de `About`, cualquier render ajeno al
  // karaoke —el progreso de una simulación en curso, en la app de verdad— lo reiniciaba, y el
  // enlace de «brito» no llegaba a abrirse nunca mientras la simulación seguía corriendo.
  vi.useFakeTimers();
  const dialogRef = await montar();
  await clicarIcono(6);
  await enviarClave('brito');
  expect(document.querySelector('.karaoke')).not.toBeNull();
  // Cinco renders «ajenos» (props nuevas cada vez, como haría `App.tsx` al re-renderizar), medio
  // segundo después de montar el overlay: si el efecto dependiera de esas props, el reloj se
  // reiniciaría aquí.
  const PASO_MS = 100;
  const RENDERS = 5;
  for (let i = 0; i < RENDERS; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(PASO_MS);
      root.render(<About dialogRef={dialogRef} onKaraoke={() => {}} />);
    });
  }
  // Solo lo que falta desde el montaje ORIGINAL, más un margen: si el reloj se hubiera reiniciado
  // en el último render (a los 500 ms), esto no alcanzaría para dispararlo, y `window.open`
  // seguiría sin llamarse.
  await act(async () => { vi.advanceTimersByTime(KARAOKE_DURACION_TOTAL_MS - RENDERS * PASO_MS + 50); });
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(window.open).toHaveBeenCalledWith(
    'https://www.youtube.com/watch?v=r7GBGZ004vQ&list=RDr7GBGZ004vQ&start_radio=1&t=203s',
    '_blank',
    'noopener,noreferrer',
  );
  expect(document.querySelector('.karaoke')).toBeNull();
});

it('el overlay es `role="presentation"`/`aria-live="polite"` y dejar `#root` inerte mientras suena (QA de #387, Low)', async () => {
  const raiz = document.createElement('div');
  raiz.id = 'root';
  document.body.append(raiz);
  vi.useFakeTimers();
  try {
    await montar();
    await clicarIcono(6);
    await enviarClave('brito');
    const overlay = document.querySelector('.karaoke')!;
    expect(overlay.getAttribute('role')).toBe('presentation');
    expect(overlay.getAttribute('aria-live')).toBe('polite');
    expect(raiz.hasAttribute('inert')).toBe(true);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
    expect(raiz.hasAttribute('inert')).toBe(false);
  } finally {
    raiz.remove();
  }
});

it('el campo de la clave no ofrece autocompletar ni corrector (QA de #387, Low)', async () => {
  await montar();
  await clicarIcono(6);
  const campo = container.querySelector<HTMLInputElement>('.acerca-clave input')!;
  expect(campo.getAttribute('autocomplete')).toBe('off');
  expect(campo.getAttribute('spellcheck')).toBe('false');
});

it('Escape durante el karaoke lo quita sin abrir el enlace', async () => {
  vi.useFakeTimers();
  await montar();
  await clicarIcono(6);
  await enviarClave('brito');
  expect(document.querySelector('.karaoke')).not.toBeNull();
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(document.querySelector('.karaoke')).toBeNull();
  // Y aunque se deje correr el reloj después, ya no hay temporizador vivo que abra nada.
  await act(async () => { vi.advanceTimersByTime(KARAOKE_DURACION_TOTAL_MS); });
  expect(window.open).not.toHaveBeenCalled();
});

it('el contador de clics se reinicia al cerrar el diálogo', async () => {
  const dialogRef = await montar();
  await clicarIcono(6);
  expect(container.querySelector('.acerca-clave')).not.toBeNull();
  await act(async () => { dialogRef.current!.close(); });
  await act(async () => { dialogRef.current!.showModal(); });
  expect(container.querySelector('.acerca-clave')).toBeNull();
  // Y hacen falta los seis de nuevo: no se quedó a medio camino.
  await clicarIcono(5);
  expect(container.querySelector('.acerca-clave')).toBeNull();
  await clicarIcono(1);
  expect(container.querySelector('.acerca-clave')).not.toBeNull();
});
