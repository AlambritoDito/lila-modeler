// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Modelador } from './Modeler';
import type { ProjectStore } from './store/ProjectStore';
import { App } from './App';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), worker: vi.fn(), changed: () => {}, scenarioChange: () => {} }));
vi.mock('./simulationGate', () => ({ prepareSimulation: mocks.gate }));
vi.mock('./simulationClient', () => ({ runInWorker: mocks.worker }));
vi.mock('./theme/applyTheme', () => ({ applyTheme: vi.fn() }));
vi.mock('./ResultsView', () => ({ ResultsView: ({ result }: { result: { warnings: string[] } }) => <div>Resultado actual {result.warnings.join(' ')}</div> }));
vi.mock('./PropertiesPanel', () => ({ PanelPropiedades: () => null }));
vi.mock('./ScenarioPanel', () => ({ ScenarioPanel: ({ onCambio }: { onCambio: (file: string, raw: object) => void }) => {
  mocks.scenarioChange = () => onCambio('as-is.scenario.json', {});
  return null;
} }));
vi.mock('./Modeler', () => ({ Lienzo: ({ onListo }: { onListo: (model: Modelador) => void }) => {
  useEffect(() => { onListo({
    exportar: async () => '<xml/>', abrir: async () => true, cuellos: vi.fn(), ajustar: vi.fn(),
    suscribir: (_events: string[], callback: () => void) => { mocks.changed = callback; return () => {}; },
  } as unknown as Modelador); }, [onListo]);
  return <div>Modelo montado</div>;
} }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const ir = { id: 'Process_1', source: { originalIds: {} } };
const scenario = { model: 'model.bpmn', run: { seed: 42 } };
const done = { result: { warnings: ['W-MOTOR'], bottlenecks: [] }, logSample: [] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
async function click(label: string) {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].filter((b) => b.textContent === label).at(-1);
    expect(button, label).toBeDefined(); button!.click();
  });
}
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'test' }) }));
  mocks.gate.mockResolvedValue({ ir, scenario, warnings: ['W-FRONTERA'] });
  mocks.worker.mockResolvedValue(done);
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<App store={{} as ProjectStore} />));
  await click('Simular');
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
it('valida antes del Worker y abre Resultados con avisos preservados', async () => {
  await click('Simular');
  expect(mocks.worker).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Resultado actual W-FRONTERA W-MOTOR');
  expect(container.textContent).toContain('Modelo montado');
});
it('un error de validación impide iniciar Worker', async () => {
  mocks.gate.mockRejectedValueOnce(new Error('E-NOSOP: Task_1'));
  await click('Simular');
  expect(mocks.worker).not.toHaveBeenCalled();
  expect(container.textContent).toContain('E-NOSOP: Task_1');
});
it('cancelar durante preparación no crea Worker ni queda Simulando', async () => {
  const gate = deferred<{ ir: typeof ir; scenario: typeof scenario; warnings: string[] }>();
  mocks.gate.mockReturnValueOnce(gate.promise);
  await click('Simular'); await click('Cancelar');
  await act(async () => gate.resolve({ ir, scenario, warnings: [] }));
  expect(mocks.worker).not.toHaveBeenCalled();
  expect(container.textContent).not.toContain('Simulando…');
});
it.each(['modelo', 'escenario'])('editar %s aborta y descarta resultado y progreso tardíos', async (kind) => {
  const run = deferred<typeof done>(); mocks.worker.mockReturnValueOnce(run.promise);
  await click('Simular');
  const options = mocks.worker.mock.calls[0]![2] as { signal: AbortSignal; onProgress: (progress: unknown) => void };
  await act(async () => { if (kind === 'modelo') mocks.changed(); else mocks.scenarioChange(); });
  expect(options.signal.aborted).toBe(true);
  await act(async () => { options.onProgress({ fraction: 1, replication: 1 }); run.resolve(done); });
  expect(container.textContent).not.toContain('Resultado actual');
  expect(container.textContent).not.toContain('Simulando…');
});
it('desmontar termina la corrida activa', async () => {
  mocks.worker.mockReturnValueOnce(new Promise(() => {})); await click('Simular');
  const options = mocks.worker.mock.calls[0]![2] as { signal: AbortSignal };
  await act(async () => root.unmount()); expect(options.signal.aborted).toBe(true);
});
