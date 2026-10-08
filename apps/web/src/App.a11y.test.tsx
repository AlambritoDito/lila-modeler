// @vitest-environment jsdom
/**
 * #554 (seam QA of Lote J, triaged against Lote M): the shell's part of the findings — the mode
 * buttons say which one is active, a Run started from the keyboard keeps the focus on its button,
 * and the results table gets the lint's code and path, so the Warnings tab can tell a lint
 * problem from the run's same warning in another language.
 *
 * Its own file so `App.test.tsx` stays as it is; the mocks are a subset of that suite's (canvas,
 * panels, results and the simulation boundary), enough to mount `App` under jsdom and run once.
 */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Modelador } from './Modeler';
import { seedModelXml } from './project';
import type { ProjectSessionStore } from './store/ProjectStore';
import type { AvisoDock } from './DockSimular';
import { en as T } from './strings.en';

const mocks = vi.hoisted(() => ({
  gate: vi.fn(),
  worker: vi.fn(),
  problemas: [] as { ruta: string; mensaje: string; severidad: 'error' | 'warning'; codigo?: string }[],
  /** The last props of the results table. */
  dock: null as null | { avisos: readonly AvisoDock[]; corrida: { result: { warnings: string[] } } | null },
}));

vi.mock('./simulationGate', () => ({ prepareSimulation: mocks.gate }));
vi.mock('./simulationClient', () => ({ runInWorker: mocks.worker }));
vi.mock('./theme/applyTheme', async (real) => ({ ...(await real<object>()), applyTheme: vi.fn() }));
vi.mock('./ResultsView', () => ({ ResultsView: () => null }));
vi.mock('./DockSimular', async (real) => ({ ...(await real<object>()), TablaResultados: (props: NonNullable<typeof mocks.dock>) => {
  mocks.dock = props;
  return <section data-mock="dock" />;
} }));
vi.mock('./PanelResumen', async (real) => ({ ...(await real<object>()), PanelResumen: () => null }));
vi.mock('./VistaComparar', async (real) => ({ ...(await real<object>()), VistaComparar: () => null }));
vi.mock('./MapasComparados', () => ({ MapasComparados: () => null }));
vi.mock('./PropertiesPanel', async (real) => ({ ...(await real<object>()), PanelPropiedades: () => null }));
vi.mock('./replay/Replay', () => ({ Replay: () => null }));
vi.mock('./ScenarioPanel', async (real) => ({
  problemasEscenario: () => mocks.problemas,
  duplicarEscenario: (await real<typeof import('./ScenarioPanel')>()).duplicarEscenario,
  ScenarioPanel: () => null,
}));
vi.mock('./Modeler', () => ({
  Lienzo: ({ onListo }: { onListo: (modelo: Modelador) => void }) => {
    useEffect(() => {
      onListo({
        exportar: vi.fn().mockResolvedValue(seedModelXml()), abrir: vi.fn().mockResolvedValue(true), cuellos: vi.fn(), ajustar: vi.fn(), zoom: vi.fn(),
        repintar: vi.fn(), validacion: vi.fn(), seleccionar: vi.fn(), simulacionTokens: vi.fn(), enfocar: vi.fn(),
        porcentajes: vi.fn(), etiquetasPaso: vi.fn(),
        suscribir: () => () => {},
        servicios: {
          modeling: { createShape: vi.fn() },
          elementFactory: { createShape: vi.fn(), createParticipantShape: vi.fn() },
          canvas: { viewbox: () => ({ x: 0, y: 0, width: 800, height: 400 }), getRootElement: () => 'raiz', scrollToElement: vi.fn() },
          create: { start: vi.fn() },
          directEditing: { activate: vi.fn(), isActive: () => false, complete: vi.fn() },
          selection: { get: () => [], select: vi.fn() },
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

// No node `type`: a typed task would be seeded into the scenario (#420), which drops the run.
const ir = { id: 'Process_1', nodes: { Task_A: { name: 'Pack order' } }, flows: {}, source: { originalIds: {} } };
const scenario = { model: 'model.bpmn', run: { seed: 42, baseTimeUnit: 'min' }, resources: {} };
const SIN_PARAMETROS_EN = 'W-ELEMENTO-SIN-PARAMETROS: the element exists in the model and has no parameters; it takes its default values (elements.Task_A).';

let root: Root;
let container: HTMLDivElement;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
const modos = (): HTMLButtonElement[] => [...container.querySelectorAll<HTMLButtonElement>('nav.modos button')];
const boton = (texto: string): HTMLButtonElement => [...container.querySelectorAll('button')].find((b) => b.textContent === texto)!;

beforeEach(async () => {
  vi.resetAllMocks();
  mocks.problemas = [];
  mocks.dock = null;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'test', tokens: {} }) }));
  mocks.gate.mockResolvedValue({ ir, scenario, warnings: [SIN_PARAMETROS_EN] });
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
  await act(async () => { root.render(<App store={session} />); });
  // The startup reparse (150 ms) settles first, as in `App.test.tsx`.
  await act(async () => { await new Promise((listo) => { setTimeout(listo, 200); }); });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

it('#554: the active mode button says so (aria-current), not only its CSS class', async () => {
  const actual = (): (string | null)[] => modos().map((b) => b.getAttribute('aria-current'));
  expect(modos().map((b) => b.textContent)).toEqual([T.app.modos.modelar, T.app.modos.simular, T.app.modos.resultados]);
  expect(actual()).toEqual(['page', null, null]);
  await act(async () => modos()[1]!.click());
  expect(actual()).toEqual([null, 'page', null]);
});

it('#554: Run from the keyboard keeps the focus on its button through Cancel and back', async () => {
  const corrida = deferred<{ result: object; logSample: [] }>();
  mocks.worker.mockReturnValueOnce(corrida.promise);
  const ejecutar = container.querySelector<HTMLButtonElement>('button.ejecutar')!;
  ejecutar.focus();
  expect(document.activeElement).toBe(ejecutar);
  // Enter (or Space) on a focused button is its click.
  await act(async () => ejecutar.click());
  expect(mocks.worker).toHaveBeenCalledOnce();
  // Running: the same button is Cancel now, and it still has the focus (it fell to <body> before).
  expect(document.activeElement).toBe(container.querySelector('button.cancelar'));
  expect((document.activeElement as HTMLElement).textContent).toBe(T.app.cancelar);
  await act(async () => corrida.resolve({ result: { warnings: [], bottlenecks: [], elements: {}, resources: {}, flows: {}, process: {} }, logSample: [] }));
  // Done: it lands in Results with the focus back on Run.
  expect(modos()[2]!.getAttribute('aria-current')).toBe('page');
  expect(document.activeElement).toBe(container.querySelector('button.ejecutar'));
  expect(document.activeElement).toBe(ejecutar);
});

it('#554: the results table gets the lint\'s code and path, so another language still dedupes', async () => {
  // The live lint after switching to Spanish; the run's copy of the same warning is in English.
  mocks.problemas = [{ ruta: 'elements.Task_A', codigo: 'W-ELEMENTO-SIN-PARAMETROS', severidad: 'warning',
    mensaje: 'el elemento existe en el modelo y no tiene parámetros; toma sus valores por defecto (elements.Task_A).' }];
  mocks.worker.mockResolvedValueOnce({ result: { warnings: [], bottlenecks: [], elements: {}, resources: {}, flows: {}, process: {} }, logSample: [] });
  await act(async () => boton(T.app.ejecutar).click());
  expect(mocks.dock?.corrida?.result.warnings).toEqual([SIN_PARAMETROS_EN]);
  expect(mocks.dock?.avisos).toEqual([expect.objectContaining({ codigo: 'W-ELEMENTO-SIN-PARAMETROS', ruta: 'elements.Task_A' })]);
  const { avisosDelDock } = await vi.importActual<typeof import('./DockSimular')>('./DockSimular');
  expect(avisosDelDock(mocks.dock!.corrida!.result.warnings, mocks.dock!.avisos)).toHaveLength(1);
});
