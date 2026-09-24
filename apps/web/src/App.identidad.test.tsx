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
import { newModelXml } from './project';
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
        // #411: the new desktop menu's "Save project"/"Save as" go through here
        // (`App.tsx`'s `snapshot()` → `modelador.exportar` → `parseBpmn`), so a real XML is
        // needed instead of the `undefined` an unimplemented `vi.fn()` returns.
        exportar: vi.fn().mockResolvedValue(newModelXml()), abrir: vi.fn(), cuellos: vi.fn(), ajustar: vi.fn(), zoom: vi.fn(),
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

/**
 * `sessionOverrides` (#411) is the only thing the desktop File dropdown adds to this mount:
 * `openRecent`, for the tests that open a recent from the menu. The rest of the fields are the
 * ones `App.identidad.test.tsx` already needed.
 */
async function montarApp(sessionOverrides: Record<string, unknown> = {}): Promise<{ contenedor: HTMLDivElement; session: ProjectSessionStore }> {
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
    ...sessionOverrides,
  } as unknown as ProjectSessionStore;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => { root!.render(<App store={session} />); });
  return { contenedor: container, session };
}

/**
 * `<details>`'s `toggle` is real HTML, not a React event: the standard itself queues it (`queue a
 * task`, `setTimeout(0)` in jsdom) instead of firing it in the same turn as the click — so a test
 * that depends on `onToggle` (recents, click-outside) has to yield a tick.
 */
async function tick(): Promise<void> {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

/** Minimal desktop bridge: what `App.tsx` calls at startup, plus `listRecents` (its mock,
 * returned so the recents tests can assert on it without going through `window.lila`). */
function puenteEscritorio(recientes: readonly { dir: string; name: string; openedAt: string }[] = []) {
  const listRecents = vi.fn().mockResolvedValue(recientes);
  (window as unknown as { lila: unknown }).lila = {
    readSettings: vi.fn().mockResolvedValue({}),
    writeSettings: vi.fn().mockResolvedValue(undefined),
    onMenu: vi.fn(() => () => {}),
    onOpenPath: vi.fn(() => () => {}),
    pendingOpenPath: vi.fn().mockResolvedValue(null),
    listRecents,
  };
  return { listRecents };
}

it('en la web (sin `window.lila`), la marca del producto se enseña junto al icono', async () => {
  vi.resetModules();
  const { contenedor } = await montarApp();
  const producto = contenedor.querySelector('.identidad .producto');
  expect(producto).not.toBeNull();
  expect(producto?.textContent).toBe(T.app.marca);
});

it('en Electron (`window.lila` presente) la marca se calla: ya la lleva la barra de título del SO', async () => {
  puenteEscritorio();
  vi.resetModules();
  const { contenedor } = await montarApp();
  expect(contenedor.querySelector('.identidad .producto')).toBeNull();
  // El icono se queda: solo el texto del producto se calla.
  expect(contenedor.querySelector('.identidad .logo')).not.toBeNull();
});

// ---------- desktop File menu (#411) ----------

it('en Electron, el desplegable Archivo se pinta en la barra con el mismo texto que el menú nativo', async () => {
  puenteEscritorio();
  vi.resetModules();
  const { contenedor } = await montarApp();
  const menu = contenedor.querySelector('.menu-archivo');
  expect(menu).not.toBeNull();
  const acciones = [...menu!.querySelectorAll('button')].map((b) => b.textContent);
  expect(acciones).toEqual(expect.arrayContaining([
    T.app.menuEscritorio.nuevoProyecto, T.app.menuEscritorio.abrirProyecto, T.app.menuEscritorio.abrirProyectoArchivo,
    T.app.menuEscritorio.guardarProyecto, T.app.menuEscritorio.guardarComo, T.app.menuEscritorio.guardarComoCarpeta,
    T.app.acercaDe,
  ]));
  // Web-only entries (open/export .bpmn) don't apply here: `bpmnFilesEnabled` is false.
  expect(acciones).not.toContain(T.app.abrirBpmn);
  expect(acciones).not.toContain(T.app.exportarBpmn);
});

/**
 * One entry per test, each with its own mount (#411): chaining them in a single one — New, then
 * Open, then Save — trips the same `projectAction`/`guardar` guards `App.test.tsx` already covers
 * (a dirty document, `ioLock`…), and those aren't what this file tests. All that matters here is
 * that each desktop dropdown button reaches the same function as its native-menu equivalent
 * (`ejecutar`/`projectAction`/`guardar`, already thoroughly tested in `App.test.tsx`).
 */
it('«Nuevo proyecto» crea el proyecto, como el menú nativo', async () => {
  puenteEscritorio();
  vi.resetModules();
  const { contenedor, session } = await montarApp();
  const boton = [...contenedor.querySelectorAll('.menu-archivo button')].find((b) => b.textContent === T.app.menuEscritorio.nuevoProyecto) as HTMLButtonElement;
  await act(async () => { boton.click(); });
  expect(session.createProject).toHaveBeenCalledOnce();
});
it('«Abrir proyecto…» abre el selector nativo, como el menú nativo', async () => {
  puenteEscritorio();
  vi.resetModules();
  const { contenedor, session } = await montarApp();
  const boton = [...contenedor.querySelectorAll('.menu-archivo button')].find((b) => b.textContent === T.app.menuEscritorio.abrirProyecto) as HTMLButtonElement;
  await act(async () => { boton.click(); });
  expect(session.openProject).toHaveBeenCalledOnce();
});
it('«Guardar proyecto» guarda, como el menú nativo', async () => {
  puenteEscritorio();
  vi.resetModules();
  const { contenedor, session } = await montarApp();
  const boton = [...contenedor.querySelectorAll('.menu-archivo button')].find((b) => b.textContent === T.app.menuEscritorio.guardarProyecto) as HTMLButtonElement;
  await act(async () => { boton.click(); });
  expect(session.saveProject).toHaveBeenCalledOnce();
});

it('«Abrir reciente» pide los recientes al puente al abrirse y abre uno al pulsarlo', async () => {
  const { listRecents } = puenteEscritorio([
    { dir: '/p/uno', name: 'Uno', openedAt: new Date().toISOString() },
    { dir: '/p/dos', name: 'Dos', openedAt: new Date().toISOString() },
  ]);
  vi.resetModules();
  const openRecent = vi.fn().mockResolvedValue(null);
  const { contenedor } = await montarApp({ openRecent });
  const menu = contenedor.querySelector<HTMLDetailsElement>('.menu-archivo')!;
  await act(async () => { menu.querySelector('summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tick();
  expect(listRecents).toHaveBeenCalledOnce();
  const submenu = menu.querySelector<HTMLDetailsElement>('.menu-archivo-reciente')!;
  await act(async () => { submenu.querySelector('summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tick();
  // Opening "Open recent" only opens THAT submenu: a click on its `<summary>` must not close the
  // whole File dropdown (found via a real-Chrome CDP check, not caught by jsdom alone).
  expect(menu.open).toBe(true);
  const items = [...submenu.querySelectorAll('div button')];
  expect(items.map((b) => b.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Uno'), expect.stringContaining('Dos'), expect.stringContaining('/p/uno')]));
  await act(async () => { (items.find((b) => b.textContent?.includes('Uno')) as HTMLButtonElement).click(); });
  expect(openRecent).toHaveBeenCalledWith('/p/uno', undefined);
  // Clicking an entry closes the whole dropdown, not just the submenu (the wrapper's `onClick`).
  expect(menu.open).toBe(false);
});

it('«Abrir reciente» enseña una entrada deshabilitada cuando el puente no trae ninguno', async () => {
  puenteEscritorio([]);
  vi.resetModules();
  const { contenedor } = await montarApp();
  const menu = contenedor.querySelector<HTMLDetailsElement>('.menu-archivo')!;
  await act(async () => { menu.querySelector('summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tick();
  const submenu = menu.querySelector<HTMLDetailsElement>('.menu-archivo-reciente')!;
  await act(async () => { submenu.querySelector('summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tick();
  const vacio = submenu.querySelector('button')!;
  expect(vacio.textContent).toBe(T.app.menuEscritorio.ninguno);
  expect(vacio.disabled).toBe(true);
});

it('el menú Archivo de escritorio se cierra con Esc y con un clic fuera', async () => {
  puenteEscritorio();
  vi.resetModules();
  const { contenedor } = await montarApp();
  const menu = contenedor.querySelector<HTMLDetailsElement>('.menu-archivo')!;

  await act(async () => { menu.querySelector('summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tick();
  expect(menu.open).toBe(true);
  await act(async () => { menu.querySelector('summary')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(menu.open).toBe(false);

  await act(async () => { menu.querySelector('summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tick();
  expect(menu.open).toBe(true);
  await act(async () => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  expect(menu.open).toBe(false);

  // A click INSIDE the dropdown (here, "Open recent"'s summary) doesn't count as outside.
  await act(async () => { menu.querySelector('summary')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await tick();
  expect(menu.open).toBe(true);
  await act(async () => { menu.querySelector('.menu-archivo-reciente summary')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
  expect(menu.open).toBe(true);
});
