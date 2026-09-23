// @vitest-environment jsdom
/**
 * Design 2c: the scenario panel detached to its own window. The child is the window of an
 * `about:blank` iframe — same origin, its own document, like the popup (and no `@types/jsdom`
 * needed to build a second jsdom by hand). What matters is that React renders into ANOTHER
 * document from the same tree, that events there reach React, and that the look (theme
 * variables, `lang`, stylesheets) follows the main document.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { abrirVentanaFlotante, VentanaFlotante } from './VentanaFlotante';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let hijo: Window;
let marco: HTMLIFrameElement;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  marco = document.createElement('iframe');
  document.body.append(marco);
  hijo = marco.contentWindow!;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  marco.remove();
  document.head.replaceChildren();
  document.documentElement.removeAttribute('style');
  vi.restoreAllMocks();
});

async function montar(props: Partial<Parameters<typeof VentanaFlotante>[0]> = {}): Promise<void> {
  await act(async () =>
    root.render(
      <VentanaFlotante ventana={hijo} titulo="Scenario AS-IS — Lila Modeler" tema={undefined} densidad="normal" onAcoplar={() => {}} {...props}>
        {props.children ?? <button type="button">inside</button>}
      </VentanaFlotante>,
    ),
  );
}

it('renders the children in the child document, and its clicks reach React', async () => {
  const pulsado = vi.fn();
  await montar({ children: <button type="button" onClick={pulsado}>inside</button> });
  const boton = [...hijo.document.body.querySelectorAll('button')].find((b) => b.textContent === 'inside');
  expect(boton).toBeDefined();
  expect(container.textContent).toBe('');
  await act(async () => {
    boton!.dispatchEvent(new (hijo as unknown as typeof globalThis).MouseEvent('click', { bubbles: true }));
  });
  expect(pulsado).toHaveBeenCalledOnce();
});

it('mirrors the theme variables and the language of the main document', async () => {
  await montar();
  await act(async () => {
    document.documentElement.style.setProperty('--bg-base', '#123');
    document.documentElement.lang = 'es';
  });
  await act(async () => {});
  expect(hijo.document.documentElement.style.getPropertyValue('--bg-base')).toBe('#123');
  expect(hijo.document.documentElement.lang).toBe('es');
});

it('titles the child window', async () => {
  await montar();
  expect(hijo.document.title).toBe('Scenario AS-IS — Lila Modeler');
});

it('docks when the child goes away, closes the child when the app does, and forwards keys', async () => {
  const onAcoplar = vi.fn();
  const onTecla = vi.fn();
  const onGeometria = vi.fn();
  // jsdom's `close()` empties the body (its own teardown) under React's feet; a browser closes
  // asynchronously and keeps the nodes, so here it is only watched.
  const cerrar = vi.spyOn(hijo, 'close').mockImplementation(() => {});
  await montar({ onAcoplar, onTecla, onGeometria });

  hijo.dispatchEvent(new (hijo as unknown as typeof globalThis).KeyboardEvent('keydown', { key: 's', metaKey: true }));
  expect(onTecla).toHaveBeenCalledOnce();
  expect((onTecla.mock.calls[0]![0] as KeyboardEvent).metaKey).toBe(true);

  hijo.dispatchEvent(new (hijo as unknown as typeof globalThis).Event('pagehide'));
  expect(onAcoplar).toHaveBeenCalledOnce();
  expect(onGeometria).toHaveBeenCalled();

  window.dispatchEvent(new Event('pagehide'));
  expect(cerrar).toHaveBeenCalled();
});

it('the «Dock» button of the title strip docks', async () => {
  const onAcoplar = vi.fn();
  await montar({ onAcoplar });
  await act(async () => {
    hijo.document.querySelector<HTMLButtonElement>('.ventana-titulo button')!.dispatchEvent(
      new (hijo as unknown as typeof globalThis).MouseEvent('click', { bubbles: true }),
    );
  });
  expect(onAcoplar).toHaveBeenCalledOnce();
});

it('abrirVentanaFlotante dresses the child like the app, with the saved geometry', () => {
  const estilo = document.createElement('style');
  estilo.textContent = '.app { color: red; }';
  document.head.append(estilo);
  const abrir = vi.spyOn(window, 'open').mockReturnValue(hijo);

  expect(abrirVentanaFlotante('lila-escenario', { x: 11, y: 22, width: 333, height: 444 })).toBe(hijo);
  const [url, nombre, rasgos] = abrir.mock.calls[0]!;
  expect(url).toBe('');
  expect(nombre).toBe('lila-escenario');
  expect(rasgos).toMatch(/popup/);
  expect(rasgos).toContain('width=333');
  expect(rasgos).toContain('height=444');
  expect(rasgos).toContain('left=11');
  expect(rasgos).toContain('top=22');
  expect(hijo.document.head.querySelector('style')?.textContent).toBe('.app { color: red; }');
  expect(hijo.document.head.querySelector('base')?.getAttribute('href')).toBe(document.baseURI);
});

it('abrirVentanaFlotante gives null when the popup is blocked', () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  expect(abrirVentanaFlotante('lila-escenario')).toBeNull();
});
