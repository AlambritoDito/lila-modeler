// @vitest-environment jsdom
/**
 * `DESKTOP` en `App.tsx` (`typeof window.lila !== 'undefined'`) se lee una sola vez, al cargar el
 * módulo — no en cada render — así que la única forma de ejercitar sus dos ramas en la misma
 * corrida es una instancia de módulo fresca por rama: `vi.resetModules()` más un `import('./App')`
 * dinámico, después de poner o borrar `window.lila`. Va en su propio archivo para no tocar el
 * módulo que `App.test.tsx` ya tiene cargado (QA de la ronda 1 de #392, should-fix: nada probaba
 * que la marca de la cabecera se calla en Electron).
 *
 * El montaje reutiliza el mismo bloque de `vi.mock` que `App.test.tsx` —lienzo, panel de
 * propiedades, panel de escenario, resultados, simulación— porque es el que ya demostró que basta
 * para montar `App` bajo jsdom sin bpmn-js de verdad; `./Bienvenida` se suma aquí porque en
 * Electron `pendingOpenPath()` resuelve a `null` y eso abre el overlay de bienvenida, que no hace
 * falta renderizar para esta prueba.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { Modelador } from './Modeler';
import type { ProjectSessionStore } from './store/ProjectStore';
import { en as T } from './strings.en';

vi.mock('./simulationGate', () => ({ prepareSimulation: vi.fn() }));
vi.mock('./simulationClient', () => ({ runInWorker: vi.fn() }));
vi.mock('./theme/applyTheme', async (real) => ({ ...(await real<object>()), applyTheme: vi.fn() }));
vi.mock('./ResultsView', () => ({ ResultsView: () => null }));
vi.mock('./PropertiesPanel', () => ({ PanelPropiedades: () => null }));
vi.mock('./ScenarioPanel', () => ({ problemasEscenario: () => [], ScenarioPanel: () => null }));
vi.mock('./Bienvenida', () => ({ Bienvenida: () => null }));
vi.mock('./Modeler', () => ({
  Lienzo: ({ onListo }: { onListo: (modelo: Modelador) => void }) => {
    useEffect(() => {
      onListo({
        exportar: vi.fn(), abrir: vi.fn(), cuellos: vi.fn(), ajustar: vi.fn(), zoom: vi.fn(),
        repintar: vi.fn(), validacion: vi.fn(), seleccionar: vi.fn(), simulacionTokens: vi.fn(),
        suscribir: () => () => {},
        servicios: {
          modeling: { createShape: vi.fn() },
          elementFactory: { createShape: vi.fn(), createParticipantShape: vi.fn() },
          canvas: { viewbox: () => ({ x: 0, y: 0, width: 800, height: 400 }), getRootElement: () => 'raiz', scrollToElement: vi.fn() },
          create: { start: vi.fn() },
          directEditing: { activate: vi.fn() },
          elementRegistry: { filter: () => [] },
          rules: { allowed: () => true },
        },
      } as unknown as Modelador);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <div>Modelo montado</div>;
  },
}));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(async () => {
  if (root !== undefined) await act(async () => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  delete (window as unknown as { lila?: unknown }).lila;
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function montarApp(): Promise<HTMLDivElement> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'test', tokens: {} }) }));
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  const { App } = await import('./App');
  const session = {
    openProject: vi.fn().mockResolvedValue(null),
    createProject: vi.fn(async (doc: unknown) => doc),
    saveProject: vi.fn(async (doc: unknown) => doc),
    setDirty: vi.fn(),
    putProcess: vi.fn(async () => {}),
  } as unknown as ProjectSessionStore;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(<App store={session} />); });
  return container;
}

it('en la web (sin `window.lila`), la marca del producto se enseña junto al icono', async () => {
  vi.resetModules();
  const contenedor = await montarApp();
  const producto = contenedor.querySelector('.identidad .producto');
  expect(producto).not.toBeNull();
  expect(producto?.textContent).toBe(T.app.marca);
});

it('en Electron (`window.lila` presente) la marca se calla: ya la lleva la barra de título del SO', async () => {
  (window as unknown as { lila: unknown }).lila = {
    readSettings: vi.fn().mockResolvedValue({}),
    writeSettings: vi.fn().mockResolvedValue(undefined),
    onMenu: vi.fn(() => () => {}),
    onOpenPath: vi.fn(() => () => {}),
    pendingOpenPath: vi.fn().mockResolvedValue(null),
  };
  vi.resetModules();
  const contenedor = await montarApp();
  expect(contenedor.querySelector('.identidad .producto')).toBeNull();
  // El icono se queda: solo el texto del producto se calla.
  expect(contenedor.querySelector('.identidad .logo')).not.toBeNull();
});
