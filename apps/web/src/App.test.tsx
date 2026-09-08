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
  problemas: [] as { ruta: string; mensaje: string; severidad: 'error' | 'warning' }[], seleccionar: vi.fn(), validacion: vi.fn(),
  // LILA-207: los servicios que la paleta usa para insertar una figura.
  fabricar: vi.fn(), crearFigura: vi.fn(), editarNombre: vi.fn(), arrastrar: vi.fn(),
  // LILA-192/193: el shell publica pérdida e ids rotos por `onEstado`; aquí se guarda el
  // callback para poder empujar un estado de lienzo concreto desde los tests.
  publicarEstado: (_estado: unknown) => {} }));
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
vi.mock('./Modeler', () => ({ Lienzo: ({ onListo, onEstado }: { onListo: (model: Modelador) => void; onEstado: (estado: unknown) => void }) => {
  useEffect(() => { mocks.publicarEstado = onEstado; onListo({
    exportar: mocks.exportXml, abrir: async () => true, cuellos: vi.fn(), ajustar: mocks.ajustar, zoom: mocks.zoom,
    validacion: mocks.validacion, seleccionar: mocks.seleccionar,
    suscribir: (_events: string[], callback: () => void) => { mocks.changed = callback; return () => {}; },
    // El viewbox es fijo: su centro (500, 250) es donde la paleta tiene que soltar la figura.
    servicios: {
      modeling: { createShape: mocks.crearFigura },
      elementFactory: { createShape: mocks.fabricar, createParticipantShape: vi.fn() },
      canvas: { viewbox: () => ({ x: 100, y: 50, width: 800, height: 400 }), getRootElement: () => 'raiz', scrollToElement: vi.fn() },
      create: { start: mocks.arrastrar },
      directEditing: { activate: mocks.editarNombre },
      // Sin elementos con caja, la figura cuelga de la raíz visible, que es lo que aquí permiten
      // las reglas; el reparto entre pools y carriles es de bpmn-js y se prueba en el navegador.
      elementRegistry: { filter: () => [] },
      rules: { allowed: () => true },
    },
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
  mocks.fabricar.mockImplementation((atributos: object) => ({ ...atributos, id: 'Figura_nueva' }));
  mocks.crearFigura.mockImplementation((figura: object) => figura);
  session = { openProject: vi.fn().mockResolvedValue(null), createProject: vi.fn(async (doc) => doc), saveProject: vi.fn(async (doc) => doc), setDirty: vi.fn(), putProcess: vi.fn(async () => {}) } as unknown as ProjectSessionStore;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  // Modo «Simular»: deja abierta la pestaña Simulación del panel derecho.
  await click('Simular');
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); localStorage.clear(); });
it('valida antes del Worker y abre Resultados con avisos preservados', async () => {
  await click('Ejecutar simulación');
  expect(mocks.worker).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Resultado actual W-FRONTERA W-MOTOR');
  expect(container.textContent).toContain('Modelo montado');
});
it('un error de validación impide iniciar Worker', async () => {
  mocks.gate.mockRejectedValueOnce(new Error('E-NOSOP: Task_1'));
  await click('Ejecutar simulación');
  expect(mocks.worker).not.toHaveBeenCalled();
  expect(container.textContent).toContain('E-NOSOP: Task_1');
});
it('cancelar durante preparación no crea Worker ni queda Simulando', async () => {
  const gate = deferred<{ ir: typeof ir; scenario: typeof scenario; warnings: string[] }>();
  mocks.gate.mockReturnValueOnce(gate.promise);
  await click('Ejecutar simulación'); await click('Cancelar');
  await act(async () => gate.resolve({ ir, scenario, warnings: [] }));
  expect(mocks.worker).not.toHaveBeenCalled();
  // La barra vuelve a la acción primaria: ni progreso ni botón de cancelar (#237).
  expect(container.textContent).not.toContain('Replicación');
  expect(container.textContent).toContain('Ejecutar simulación');
});
it.each(['modelo', 'escenario'])('editar %s aborta y descarta resultado y progreso tardíos', async (kind) => {
  const run = deferred<typeof done>(); mocks.worker.mockReturnValueOnce(run.promise);
  await click('Ejecutar simulación');
  const options = mocks.worker.mock.calls[0]![2] as { signal: AbortSignal; onProgress: (progress: unknown) => void };
  await act(async () => { if (kind === 'modelo') mocks.changed(); else mocks.scenarioChange(); });
  expect(options.signal.aborted).toBe(true);
  await act(async () => { options.onProgress({ fraction: 1, replication: 1 }); run.resolve(done); });
  expect(container.textContent).not.toContain('Resultado actual');
  expect(container.textContent).not.toContain('Replicación');
});
it('desmontar termina la corrida activa', async () => {
  mocks.worker.mockReturnValueOnce(new Promise(() => {})); await click('Ejecutar simulación');
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
  // El tema ya no se anuncia en la barra de estado (#237): se ve y se cambia en Ajustes.
  expect(select.value).toBe('papel');
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

// --- Barra superior y barra de estado como el artboard 01 (#237) ---

it('la barra tiene una sola acción primaria y corre el escenario desde cualquier modo', async () => {
  await click('Modelar');
  expect(container.querySelectorAll('.barra .boton.primario')).toHaveLength(1);
  await click('Ejecutar simulación');
  expect(mocks.worker).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Resultado actual');
});
it('mientras simula, la barra enseña la replicación, el porcentaje y CANCELAR', async () => {
  mocks.worker.mockReturnValueOnce(new Promise(() => {}));
  await click('Ejecutar simulación');
  const { onProgress } = mocks.worker.mock.calls[0]![2] as { onProgress: (p: unknown) => void };
  await act(async () => { onProgress({ replication: 2, totalReplications: 10, fraction: 0.31 }); });
  const barra = container.querySelector('.barra')!;
  expect(barra.textContent).toContain('Replicación 3 de 10');
  expect(barra.textContent).toContain('31 %');
  expect(barra.textContent).not.toContain('Ejecutar simulación');
  await click('Cancelar');
  expect(barra.textContent).toContain('Ejecutar simulación');
});
it('las acciones de proyecto viven en el desplegable Archivo, no sueltas en la barra', async () => {
  const menu = container.querySelector('.menu-archivo')!;
  const acciones = [...menu.querySelectorAll('button')].map((b) => b.textContent);
  expect(acciones).toEqual(expect.arrayContaining(['Nuevo', 'Abrir', 'Guardar', 'Guardar como']));
  const sueltos = [...container.querySelectorAll('.barra > .boton')].map((b) => b.textContent);
  expect(sueltos).not.toContain('Guardar');
  // El desplegable se cierra al elegir: `<details>` no lo hace solo.
  await click('Guardar');
  expect((menu as HTMLDetailsElement).open).toBe(false);
  // …y con `Esc`, que `<details>` tampoco trae de serie (#237 [QA]).
  await act(async () => { (menu as HTMLDetailsElement).open = true; });
  await act(async () => { menu.querySelector('summary')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect((menu as HTMLDetailsElement).open).toBe(false);
});
it('el pie lleva errores, avisos, escenario y semilla heredada del escenario activo', async () => {
  const pie = container.querySelector('.estado')!;
  expect(pie.textContent).toContain('0 errores');
  expect(pie.textContent).toContain('0 avisos');
  expect(pie.textContent).toContain('Escenario');
  expect(pie.textContent).toContain('AS-IS');
  expect(pie.textContent).toContain('Semilla 42');
  const select = container.querySelector<HTMLSelectElement>('.simulacion select')!;
  await act(async () => { select.value = 'to-be-3-cajeros.scenario.json'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(pie.textContent).toContain('TO-BE 3 cajeros');
  expect(pie.textContent).toContain('Semilla 42');
});

/** El setter nativo + el evento `input` es lo que React traduce a `onChange`. */
function teclear(campo: HTMLInputElement, texto: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const figuras = (): HTMLButtonElement[] => [...container.querySelectorAll<HTMLButtonElement>('.paleta .figura')];

it('la paleta inserta una tarea de usuario con el teclado, filtra la lista y se compacta', async () => {
  const tarea = figuras().find((b) => b.title === 'Tarea de usuario');
  expect(tarea).toBeDefined();
  // `Enter` sobre un ítem es la activación por defecto del `<button>`; jsdom no la ejecuta
  // (no implementa el comportamiento de activación del teclado), así que se comprueba que el
  // ítem es un botón nativo enfocable —que es lo que da ese `Enter`— y se activa.
  await act(async () => { tarea!.focus(); });
  expect(document.activeElement).toBe(tarea);
  await act(async () => { tarea!.click(); });
  expect(mocks.fabricar).toHaveBeenCalledWith({ type: 'bpmn:UserTask', eventDefinitionType: undefined, isExpanded: undefined });
  // Centro del viewbox de arriba, y colgada de la raíz visible.
  expect(mocks.crearFigura).toHaveBeenCalledWith({ type: 'bpmn:UserTask', eventDefinitionType: undefined, isExpanded: undefined, id: 'Figura_nueva' }, { x: 500, y: 250 }, 'raiz');
  expect(mocks.editarNombre).toHaveBeenCalledOnce();

  // El filtro deja solo las coincidencias, sin acentos ni mayúsculas, y se lleva los grupos vacíos.
  const filtro = container.querySelector<HTMLInputElement>('.paleta input[type="search"]')!;
  teclear(filtro, 'anotacion');
  expect(figuras().map((b) => b.title)).toEqual(['Anotación']);
  expect([...container.querySelectorAll('.paleta summary')].map((s) => s.textContent)).toEqual(['Artefactos']);
  teclear(filtro, '');
  expect(figuras().length).toBeGreaterThan(15);

  // Modo compacto: se va el campo de filtro y los nombres, pero cada ítem conserva su tooltip.
  await act(async () => { porEtiqueta('Modo compacto').click(); });
  expect(container.querySelector('.paleta.compacta')).not.toBeNull();
  expect(container.querySelector('.paleta input[type="search"]')).toBeNull();
  expect(figuras().find((b) => b.title === 'Tarea de usuario')).toBeDefined();
  expect(localStorage.getItem('lila.paleta')).toBe('compacta');
});

// --- Pérdida al importar y al exportar (LILA-192 #214, LILA-193 #216) ---

const ESTADO_CON_PERDIDA = {
  zoom: 1, elementos: 12, avisos: 3, error: null,
  perdidas: ['unresolved reference <Flow_inexistente>'],
  refsRotas: ['Message_1373655174960', 'DS1373655174514'],
};
const dialogoPerdida = (): HTMLDialogElement | null => container.querySelector('.confirmar-perdida');

it('la pérdida al importar se ve como error con los ids, y el resto sigue siendo el contador de avisos', async () => {
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });
  const pie = container.querySelector('.estado')!;
  const alerta = [...pie.querySelectorAll('[role="alert"]')].find((s) => s.classList.contains('error'))!;
  expect(alerta).toBeDefined();
  expect(alerta.textContent).toContain('3 elementos o referencias se perderán al exportar');
  expect(alerta.textContent).toContain('Message_1373655174960');
  expect(alerta.textContent).toContain('DS1373655174514');
  expect(alerta.textContent).toContain('Flow_inexistente');
  // De los 3 avisos del import, 1 implicaba pérdida y ya se cuenta arriba: quedan 2.
  const aviso = [...pie.querySelectorAll('[role="alert"]')].find((s) => s.classList.contains('aviso'))!;
  expect(aviso.textContent).toContain('2 avisos al importar');
});

it('sin pérdida, exportar descarga directamente y no abre ningún diálogo', async () => {
  await click('Exportar .bpmn');
  expect(dialogoPerdida()).toBeNull();
  expect(session.putProcess).toHaveBeenCalledOnce();
});

it('con pérdida, exportar pide confirmación: cancelar no descarga y aceptar sí', async () => {
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });

  await click('Exportar .bpmn');
  const dialogo = dialogoPerdida()!;
  expect(dialogo).not.toBeNull();
  expect(dialogo.textContent).toContain('Se perderán 3 referencias que el archivo original ya tenía rotas');
  expect([...dialogo.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
    'unresolved reference <Flow_inexistente>', 'Message_1373655174960', 'DS1373655174514',
  ]);
  expect(session.putProcess).not.toHaveBeenCalled();

  await act(async () => { [...dialogo.querySelectorAll('button')].find((b) => b.textContent === 'Cancelar')!.click(); });
  expect(dialogoPerdida()).toBeNull();
  expect(session.putProcess).not.toHaveBeenCalled();

  await click('Exportar .bpmn');
  await act(async () => { [...dialogoPerdida()!.querySelectorAll('button')].find((b) => b.textContent === 'Exportar igualmente')!.click(); });
  expect(session.putProcess).toHaveBeenCalledOnce();
  expect(dialogoPerdida()).toBeNull();
});
