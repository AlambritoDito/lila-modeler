// @vitest-environment jsdom
/**
 * #442: with Settings open in a browser, ⌘O/⌘S/⇧⌘S/⌘P no longer reach the browser («Open file»,
 * «Save page as», «Print»). The app's dispatcher stays quiet behind any open dialog (#413), so
 * Settings keeps them itself — only while its `<dialog>` is open.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { LOCALES } from '../i18n';
import { Ajustes } from './Ajustes';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(
    <dialog className="ajustes">
      <Ajustes
        idioma="auto" cambiarIdioma={() => {}} LOCALES={LOCALES}
        temaId="eva-01" tema={{ name: 'Eva-01', tokens: {} }} temas={[]}
        densidad="normal" onDensidad={() => {}} avanzado={false} onAvanzado={() => {}}
        onTemas={() => {}} onSeleccionar={() => {}}
        seguir={false} onSeguir={() => {}} ranuras={{ claro: 'lila-light', oscuro: 'lila-dark' }} onRanura={() => {}}
        abrirAcerca={() => {}} cerrarDialogo={() => {}}
      />
    </dialog>,
  ));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const pulsar = (el: Element, init: KeyboardEventInit): boolean => {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(e);
  return e.defaultPrevented;
};

it('Settings open keeps ⌘O/⌘S/⇧⌘S/⌘P from the browser; closed, it leaves every key alone (#442)', () => {
  const dialogo = container.querySelector('dialog')!;
  // Closed (the dialog is always mounted in `App.tsx`): nothing is held.
  expect(pulsar(document.body, { key: 's', metaKey: true })).toBe(false);
  dialogo.open = true;
  const boton = dialogo.querySelector('button')!;
  expect(pulsar(boton, { key: 's', metaKey: true })).toBe(true);
  expect(pulsar(boton, { key: 'o', ctrlKey: true })).toBe(true);
  expect(pulsar(document.body, { key: 'S', shiftKey: true, metaKey: true })).toBe(true);
  expect(pulsar(document.body, { key: 'p', ctrlKey: true })).toBe(true);
  // Not the File keys: left to the dialog and the browser.
  expect(pulsar(boton, { key: 's' })).toBe(false);
  expect(pulsar(boton, { key: 'k', metaKey: true })).toBe(false);
  dialogo.open = false;
  expect(pulsar(document.body, { key: 'o', metaKey: true })).toBe(false);
});
