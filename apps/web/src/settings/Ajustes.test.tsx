// @vitest-environment jsdom
/**
 * #441 (artboard 09): language and density are segmented controls — one WAI-ARIA radio group
 * each, a single Tab stop, arrows that move and choose — instead of native selects. The App suite
 * still drives the hidden `<select>` mirrors (`selectIdioma()`, the density select); this file
 * is the one that covers what a person actually meets.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LOCALES, setLocale, type Preferencia } from '../i18n';
import type { Densidad } from '../ids';
import { en as T } from '../strings.en';
import { Ajustes } from './Ajustes';

setLocale('en');
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const cambiarIdioma = vi.fn<(p: Preferencia) => void>();
const onDensidad = vi.fn<(d: Densidad) => void>();

/** What `App.tsx` does with the two preferences, in small: keep them and pass them back down. */
function Banco(): React.JSX.Element {
  const [idioma, setIdioma] = useState<Preferencia>('auto');
  const [densidad, setDensidad] = useState<Densidad>('normal');
  return (
    <dialog open>
      <Ajustes
        idioma={idioma} cambiarIdioma={(p) => { cambiarIdioma(p); setIdioma(p); }} LOCALES={LOCALES}
        temaId="eva-01" tema={{ name: 'Eva-01', tokens: {} }} temas={[]}
        densidad={densidad} onDensidad={(d) => { onDensidad(d); setDensidad(d); }}
        avanzado={false} onAvanzado={() => {}}
        onTemas={() => {}} onSeleccionar={() => {}}
        seguir={false} onSeguir={() => {}} ranuras={{ claro: 'lila-light', oscuro: 'lila-dark' }} onRanura={() => {}}
        abrirAcerca={() => {}} cerrarDialogo={() => {}}
      />
    </dialog>
  );
}

beforeEach(async () => {
  cambiarIdioma.mockClear();
  onDensidad.mockClear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<Banco />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

/** The radio group whose `aria-labelledby` reads `etiqueta`, as a screen reader names it. */
function grupo(etiqueta: string): HTMLElement {
  const g = [...container.querySelectorAll<HTMLElement>('[role="radiogroup"]')]
    .find((x) => document.getElementById(x.getAttribute('aria-labelledby') ?? '')?.textContent === etiqueta);
  expect(g, etiqueta).toBeDefined();
  return g!;
}
const radios = (g: HTMLElement): HTMLElement[] => [...g.querySelectorAll<HTMLElement>('[role="radio"]')];
/** Text, `aria-checked` and Tab stop of each option: what a screen reader and the Tab key see. */
const estado = (g: HTMLElement) => radios(g).map((r) => [r.textContent, r.getAttribute('aria-checked'), r.tabIndex]);
async function tecla(el: HTMLElement, key: string, init: KeyboardEventInit = {}): Promise<boolean> {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(async () => { el.dispatchEvent(e); });
  return e.defaultPrevented;
}

it('language and density are radio groups with one Tab stop, and no select is left on screen (#441)', () => {
  expect(estado(grupo(T.app.idioma))).toEqual([
    [T.app.idiomaAuto, 'true', 0], [T.app.idiomas.en, 'false', -1], [T.app.idiomas.es, 'false', -1],
  ]);
  expect(estado(grupo(T.app.densidad))).toEqual([
    [T.app.densidades.compacta, 'false', -1], [T.app.densidades.normal, 'true', 0], [T.app.densidades.comoda, 'false', -1],
  ]);
  // The native selects stay, hidden, for whatever drives Settings by script; none is on screen.
  const general = container.querySelector('#ajustes-panel-general')!;
  const visibles = [...general.querySelectorAll('select')].filter((s) => s.closest('[hidden]') === null);
  expect(visibles).toEqual([]);
});

it('the arrows move the focus AND choose, wrapping at both ends; Home/End jump (#441)', async () => {
  const densidad = grupo(T.app.densidad);
  const normal = radios(densidad)[1]!;
  normal.focus();
  expect(await tecla(normal, 'ArrowRight')).toBe(true);
  expect(onDensidad).toHaveBeenLastCalledWith('comoda');
  expect(document.activeElement).toBe(radios(densidad)[2]);
  expect(estado(densidad).map(([, c, t]) => [c, t])).toEqual([['false', -1], ['false', -1], ['true', 0]]);
  // → on the last one wraps to the first; ← and ↑ go back; ↓ forward.
  await tecla(radios(densidad)[2]!, 'ArrowRight');
  expect(onDensidad).toHaveBeenLastCalledWith('compacta');
  expect(document.activeElement).toBe(radios(densidad)[0]);
  await tecla(radios(densidad)[0]!, 'ArrowLeft');
  expect(onDensidad).toHaveBeenLastCalledWith('comoda');
  await tecla(radios(densidad)[2]!, 'ArrowUp');
  expect(onDensidad).toHaveBeenLastCalledWith('normal');
  await tecla(radios(densidad)[1]!, 'ArrowDown');
  expect(onDensidad).toHaveBeenLastCalledWith('comoda');
  await tecla(radios(densidad)[2]!, 'Home');
  expect(onDensidad).toHaveBeenLastCalledWith('compacta');
  await tecla(radios(densidad)[0]!, 'End');
  expect(onDensidad).toHaveBeenLastCalledWith('comoda');
  expect(document.activeElement).toBe(radios(densidad)[2]);
});

it('a click chooses; the chosen option and a modified arrow say nothing (#441)', async () => {
  const idioma = grupo(T.app.idioma);
  await act(async () => { radios(idioma)[2]!.click(); });
  expect(cambiarIdioma).toHaveBeenCalledExactlyOnceWith('es');
  expect(radios(idioma)[2]!.getAttribute('aria-checked')).toBe('true');
  // Like a select's `change`: picking what is already picked is not a change.
  await act(async () => { radios(idioma)[2]!.click(); });
  expect(cambiarIdioma).toHaveBeenCalledOnce();
  // Alt+← is the browser's Back, ⌘← the start of the line: not ours.
  expect(await tecla(radios(idioma)[2]!, 'ArrowLeft', { altKey: true })).toBe(false);
  expect(await tecla(radios(idioma)[2]!, 'ArrowLeft', { metaKey: true })).toBe(false);
  expect(cambiarIdioma).toHaveBeenCalledOnce();
  // Keys that are not the group's (Tab, letters) are left alone.
  expect(await tecla(radios(idioma)[2]!, 'Tab')).toBe(false);
  expect(await tecla(radios(idioma)[2]!, 'a')).toBe(false);
});

it('the section arrows start from the tab that has the focus, not from the selected one (#441)', async () => {
  // Every tab is a Tab stop (QA nit N1 of #407), so the focus can rest on one that is not selected.
  const pestana = (id: string) => container.querySelector<HTMLElement>(`#ajustes-tab-${id}`)!;
  pestana('atajos').focus();
  expect(await tecla(pestana('atajos'), 'ArrowDown')).toBe(true);
  expect(document.activeElement).toBe(pestana('general'));
  expect(pestana('general').getAttribute('aria-selected')).toBe('true');
  await tecla(pestana('general'), 'ArrowUp');
  expect(document.activeElement).toBe(pestana('atajos'));
  expect(pestana('atajos').getAttribute('aria-selected')).toBe('true');
});
