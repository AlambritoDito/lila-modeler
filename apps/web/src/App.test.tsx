// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Modelador } from './Modeler';
import { parseBpmn } from '@lila/engine/bpmn';
import { newModelXml } from './project';
import type { ProjectDocument, ProjectSessionStore } from './store/ProjectStore';
import { App } from './App';
import { applyTheme } from './theme/applyTheme';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), worker: vi.fn(), exportXml: vi.fn(), zoom: vi.fn(), ajustar: vi.fn(), changed: () => {}, scenarioChange: () => {},
  // LILA-209: el shell lintea el escenario activo con la misma función que el panel; aquí se
  // sustituye por una lista fija para poder mirar los chips sin montar el panel de verdad.
  problemas: [] as { ruta: string; mensaje: string; severidad: 'error' | 'warning' }[], seleccionar: vi.fn(), validacion: vi.fn() }));
vi.mock('./simulationGate', () => ({ prepareSimulation: mocks.gate }));
vi.mock('./simulationClient', () => ({ runInWorker: mocks.worker }));
vi.mock('./theme/applyTheme', () => ({ applyTheme: vi.fn() }));
vi.mock('./ResultsView', () => ({ ResultsView: ({ result }: { result: { warnings: string[] } }) => <div>Resultado actual {result.warnings.join(' ')}</div> }));
vi.mock('./PropertiesPanel', () => ({ PanelPropiedades: () => null }));
vi.mock('./ScenarioPanel', () => ({ problemasEscenario: () => mocks.problemas,
  ScenarioPanel: ({ onCambio }: { onCambio: (file: string, raw: object) => void }) => {
    mocks.scenarioChange = () => onCambio('as-is.scenario.json', {});
    return null;
  } }));
vi.mock('./Modeler', () => ({ Lienzo: ({ onListo }: { onListo: (model: Modelador) => void }) => {
  useEffect(() => { onListo({
    exportar: mocks.exportXml, abrir: async () => true, cuellos: vi.fn(), ajustar: mocks.ajustar, zoom: mocks.zoom,
    validacion: mocks.validacion, seleccionar: mocks.seleccionar,
    suscribir: (_events: string[], callback: () => void) => { mocks.changed = callback; return () => {}; },
  } as unknown as Modelador); }, [onListo]);
  return <div>Modelo montado</div>;
} }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let session: ProjectSessionStore;
let container: HTMLDivElement;
const ir = { id: 'Process_1', source: { originalIds: {} } };
const scenario = { model: 'model.bpmn', run: { seed: 42 } };
const done = { result: { warnings: ['W-MOTOR'], bottlenecks: [] }, logSample: [] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
/** Los controles del lienzo y de las pestañas son iconos: se buscan por su etiqueta accesible. */
function porEtiqueta(etiqueta: string): HTMLButtonElement {
  const boton = container.querySelector<HTMLButtonElement>(`button[aria-label="${etiqueta}"]`);
  expect(boton, etiqueta).not.toBeNull();
  return boton!;
}
async function click(label: string) {
  await act(async () => {
    const button = [...container.querySelectorAll('button')].filter((b) => b.textContent === label).at(-1);
    expect(button, label).toBeDefined(); button!.click();
  });
}
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.problemas = [];
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'test' }) }));
  mocks.gate.mockResolvedValue({ ir, scenario, warnings: ['W-FRONTERA'] });
  mocks.worker.mockResolvedValue(done);
  mocks.exportXml.mockResolvedValue(newModelXml());
  session = { openProject: vi.fn().mockResolvedValue(null), createProject: vi.fn(async (doc) => doc), saveProject: vi.fn(async (doc) => doc), setDirty: vi.fn() } as unknown as ProjectSessionStore;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  await click('Simular');
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); localStorage.clear(); });
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

it('guardar cancelado mantiene cambios pendientes', async () => {
  await act(async () => mocks.changed());
  vi.mocked(session.saveProject).mockResolvedValueOnce(null);
  await click('Guardar');
  expect(container.textContent).toContain('Sin guardar');
});
it('editar mientras se guarda conserva dirty y no confirma cierre limpio', async () => {
  await act(async () => mocks.changed());
  const pending = deferred<ProjectDocument | null>();
  vi.mocked(session.saveProject).mockReturnValueOnce(pending.promise);
  await click('Guardar');
  const snapshot = vi.mocked(session.saveProject).mock.calls[0]![0];
  await act(async () => mocks.scenarioChange());
  await act(async () => pending.resolve(snapshot));
  expect(container.textContent).toContain('Sin guardar');
  expect(session.setDirty).toHaveBeenLastCalledWith(true);
});
it('abrir cancelado conserva proyecto y escenarios', async () => {
  await click('Abrir');
  expect(container.textContent).toContain('Pedido de ejemplo');
});
it('nuevo proyecto reemplaza escenarios del ejemplo por ids propios', async () => {
  await click('Nuevo');
  expect(session.createProject).toHaveBeenCalledOnce();
  const doc = vi.mocked(session.createProject).mock.calls[0]![0];
  expect(doc.model.id).toMatch(/^Process_/);
  expect(JSON.stringify(doc.scenarios)).not.toContain('cajero');
  expect(Object.keys(doc.scenarios)).toHaveLength(2);
  expect(container.textContent).toContain('Mi proyecto');
});

it('editar durante la exportación impide guardar un XML con revisión incorrecta', async () => {
  const pending = deferred<string>(); mocks.exportXml.mockReturnValueOnce(pending.promise);
  await click('Guardar');
  await act(async () => mocks.changed());
  await act(async () => pending.resolve(newModelXml()));
  expect(session.saveProject).not.toHaveBeenCalled();
  expect(container.textContent).toContain('El modelo cambió durante el guardado');
  expect(container.textContent).toContain('Sin guardar');
});
it('editar durante apertura conserva el proyecto activo y sus cambios', async () => {
  const xml = newModelXml(); const parsed = await parseBpmn(xml);
  const doc: ProjectDocument = { version: 1, id: 'new', name: 'Otra carpeta', model: { id: parsed.ir.id, name: 'model.bpmn', xml, revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [] };
  const pending = deferred<ProjectDocument | null>(); vi.mocked(session.openProject).mockReturnValueOnce(pending.promise);
  await click('Abrir');
  await act(async () => mocks.changed());
  await act(async () => pending.resolve(doc));
  expect(container.textContent).toContain('Pedido de ejemplo');
  expect(container.textContent).toContain('Conservamos tus cambios');
});

it('cancelar reemplazo conserva dirty y no abre otro proyecto', async () => {
  await act(async () => mocks.changed());
  await click('Abrir');
  expect(container.querySelector('dialog')?.open).toBe(true);
  await click('Cancelar');
  expect(session.openProject).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Sin guardar');
});
it.each(['cancelado', 'fallido'])('guardar %s detiene reemplazo y conserva modelo', async (kind) => {
  await act(async () => mocks.changed());
  if (kind === 'cancelado') vi.mocked(session.saveProject).mockResolvedValueOnce(null);
  else vi.mocked(session.saveProject).mockRejectedValueOnce(new Error('E-PERMISO'));
  await click('Nuevo'); await click('Guardar y continuar');
  expect(session.createProject).not.toHaveBeenCalled();
  expect(container.querySelector('dialog')?.open).toBe(true);
  expect(container.textContent).toContain('Sin guardar');
});
it('guarda el proyecto actual antes de reemplazarlo', async () => {
  await act(async () => mocks.changed());
  await click('Nuevo'); await click('Guardar y continuar');
  expect(session.saveProject).toHaveBeenCalledOnce();
  expect(session.createProject).toHaveBeenCalledOnce();
  expect(vi.mocked(session.saveProject).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(session.createProject).mock.invocationCallOrder[0]!);
  expect(container.textContent).toContain('Mi proyecto');
});
it('descartar permite reemplazar sin guardar', async () => {
  await act(async () => mocks.changed());
  await click('Nuevo'); await click('Descartar');
  expect(session.saveProject).not.toHaveBeenCalled();
  expect(session.createProject).toHaveBeenCalledOnce();
});

it('bloquea interacción con edición durante apertura y la restaura al cancelar', async () => {
  const pending = deferred<ProjectDocument | null>(); vi.mocked(session.openProject).mockReturnValueOnce(pending.promise);
  await click('Abrir');
  expect(container.querySelector('.zona-modelo')?.hasAttribute('inert')).toBe(true);
  expect(container.querySelector('.panel')?.hasAttribute('inert')).toBe(true);
  await act(async () => pending.resolve(null));
  expect(container.querySelector('.zona-modelo')?.hasAttribute('inert')).toBe(false);
  expect(container.querySelector('.panel')?.hasAttribute('inert')).toBe(false);
});

it('cambiar de tema aplica el JSON nuevo, lo recuerda y remonta el lienzo con el XML actual', async () => {
  const papel = { name: 'Papel', tokens: { 'bg.base': '#F4F1EC' } };
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => papel } as Response);
  const select = container.querySelector<HTMLSelectElement>('dialog.ajustes select')!;
  await act(async () => { select.value = 'papel'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(fetch).toHaveBeenLastCalledWith('./papel.json');
  expect(applyTheme).toHaveBeenLastCalledWith(papel);
  expect(mocks.exportXml).toHaveBeenCalled();
  expect(localStorage.getItem('lila.tema')).toBe('papel');
  expect(container.textContent).toContain('Tema: Papel');
});
it('arranca con el tema recordado y la densidad como atributo', async () => {
  localStorage.setItem('lila.tema', 'papel'); localStorage.setItem('lila.densidad', 'compacta');
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(fetch).toHaveBeenLastCalledWith('./papel.json');
  expect(container.querySelector('.app')?.getAttribute('data-densidad')).toBe('compacta');
  expect(document.documentElement.style.getPropertyValue('--density')).toBe('compacta');
});
it('⌘, abre Ajustes y ⌘S guarda; sin modificador no pasa nada', async () => {
  const dialog = container.querySelector<HTMLDialogElement>('dialog.ajustes')!;
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's' })); });
  expect(session.saveProject).not.toHaveBeenCalled();
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true })); });
  expect(dialog.open).toBe(true);
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true })); });
  expect(session.saveProject).toHaveBeenCalledOnce();
});
it('el menú nativo despacha a las mismas acciones y abrir reciente activa el proyecto', async () => {
  let menu: ((a: unknown) => void) | null = null;
  const doc = { version: 1, id: 'p2', name: 'Reciente', model: { id: 'Process_2', name: 'model.bpmn', xml: newModelXml(), revision: 0 }, scenarios: { 'as-is.scenario.json': {} }, scenarioRevisions: {}, runs: [] };
  vi.stubGlobal('lila', { onMenu: (cb: (a: unknown) => void) => { menu = cb; return () => {}; } });
  (session as unknown as { openRecent: unknown }).openRecent = vi.fn().mockResolvedValue(doc);
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(menu).not.toBeNull();
  await act(async () => { menu!({ openRecent: '/p/reciente' }); });
  expect((session as unknown as { openRecent: ReturnType<typeof vi.fn> }).openRecent).toHaveBeenCalledWith('/p/reciente');
  expect(container.textContent).toContain('Reciente');
  await act(async () => { menu!('guardar'); });
  expect(session.saveProject).toHaveBeenCalledOnce();
});

// ---------- lienzo: zoom, minimapa y pestañas de diagrama (LILA-208) ----------

it('los botones del lienzo acercan, alejan y ajustan el zoom', async () => {
  await act(async () => porEtiqueta('Acercar').click());
  expect(mocks.zoom).toHaveBeenLastCalledWith(1.2);
  await act(async () => porEtiqueta('Alejar').click());
  expect(mocks.zoom).toHaveBeenLastCalledWith(1 / 1.2);
  expect(mocks.ajustar).not.toHaveBeenCalled();
  await act(async () => porEtiqueta('Ajustar a pantalla').click());
  expect(mocks.ajustar).toHaveBeenCalledOnce();
});
it('cerrar la pestaña del diagrama y «+» abren un proyecto nuevo', async () => {
  await act(async () => porEtiqueta('Cerrar model.bpmn').click());
  expect(session.createProject).toHaveBeenCalledOnce();
  await act(async () => porEtiqueta('Nuevo diagrama').click());
  expect(session.createProject).toHaveBeenCalledTimes(2);
});
it('cerrar la pestaña con cambios sin guardar pasa por la guardia', async () => {
  await act(async () => mocks.changed());
  await act(async () => porEtiqueta('Cerrar model.bpmn').click());
  expect(container.querySelector<HTMLDialogElement>('dialog.confirmar-reemplazo')?.open).toBe(true);
  expect(session.createProject).not.toHaveBeenCalled();
});

it('los chips cuentan errores y avisos y llevan al primer elemento con problemas', async () => {
  await act(async () => {
    mocks.problemas = [
      { ruta: 'elements.Task_1', mensaje: 'sin parámetros', severidad: 'warning' },
      { ruta: 'run.duration', mensaje: 'falta parada', severidad: 'error' },
    ];
    mocks.scenarioChange();
  });
  const chips = [...container.querySelectorAll('.chips-validacion .chip')].map((c) => c.textContent);
  expect(chips).toEqual(['1 error', '1 aviso']);
  // El disco se pinta por el modelador, no por React: el shell no importa bpmn-js.
  const validacion = mocks.validacion.mock.calls.at(-1)![0] as { marcadores: Map<string, unknown> };
  expect([...validacion.marcadores.keys()]).toEqual(['Task_1']);

  await click('1 aviso');
  expect(mocks.seleccionar).toHaveBeenCalledWith('Task_1');
});

it('sin problemas no hay chips', () => {
  expect(container.querySelector('.chips-validacion')).toBeNull();
});
