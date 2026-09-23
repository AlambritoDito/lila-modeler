// @vitest-environment jsdom
/**
 * Aceptación de LILA-381: el diálogo «Acerca de» enseña el icono aprobado, el nombre en negrita,
 * la versión de `package.json` y las dos líneas de marca del dueño —siempre en español, aunque la
 * interfaz esté en inglés—, y el botón de cerrar cierra el `<dialog>`.
 */
import type { RefObject } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { About } from './About';
import { setLocale } from './i18n';
import { version } from '../package.json';

// jsdom no implementa `showModal`/`close` de `<dialog>` (LILA-066 nota aparte, mismo motivo por
// el que `App.test.tsx` estampa `showModal`): sin esto, `dialogRef.current?.close()` no hace nada
// y la aserción de cierre no comprobaría lo que dice comprobar.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) { this.open = true; };
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) { this.open = false; };

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

beforeEach(() => { setLocale('en'); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

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
