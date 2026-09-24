import type { SaveOutcome } from '../../desktop/src/bridge.js';
// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, StrictMode, useEffect } from 'react';
import { startStartup, finishStartup } from './startup';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Modelador } from './Modeler';
import { parseBpmn } from '@lila/engine/bpmn';
import { newModelXml, seedModelXml } from './project';
import type { ProjectDocument, ProjectSessionStore } from './store/ProjectStore';
import { App, temaClaro } from './App';
import { applyTheme } from './theme/applyTheme';
// The app boots in English (jsdom's `navigator.language` is `en-US`), so the texts this suite
// clicks and reads come from the base catalog instead of being written by hand: a literal here
// would only pin which language the catalog happens to be in.
import { en as T } from './strings.en';
// The Spanish catalog is only read by the language tests (LILA-210): what they assert is
// that the app switched catalogs, and the only honest way to say that is with the other one.
import { es as ES } from './strings.es';

const mocks = vi.hoisted(() => ({ gate: vi.fn(), worker: vi.fn(), exportXml: vi.fn(), zoom: vi.fn(), ajustar: vi.fn(), changed: () => {}, scenarioChange: () => {},
  // #226: abrir y el overlay son mocks propios para poder fallar una apertura y mirar con qué
  // corrida se pinta o se limpia el lienzo.
  abrir: vi.fn(), cuellos: vi.fn(),
  // LILA-209: el shell lintea el escenario activo con la misma función que el panel; aquí se
  // sustituye por una lista fija para poder mirar los chips sin montar el panel de verdad.
  problemas: [] as { ruta: string; mensaje: string; severidad: 'error' | 'warning' }[], seleccionar: vi.fn(), validacion: vi.fn(),
  // LILA-065: enciende y apaga la animación de tokens de bpmn-js-token-simulation.
  simulacionTokens: vi.fn(),
  // LILA-113: `repintar` relee los tokens en el modelador vivo. `montajes` cuenta cuántas veces se
  // montó el lienzo: cambiar de tema ya no lo remonta, y ese es justamente el punto del ticket.
  repintar: vi.fn(), montajes: 0,
  // LILA-072: con `retrasarLienzo`, el lienzo falso NO avisa de que está listo al montar — el test
  // decide cuándo llamando a `mocks.listo()`, que es lo que separa "la app arrancó" de "el
  // modelador existe" y permite probar una ruta .bpmn que llega en medio.
  retrasarLienzo: false, listo: (() => {}) as () => void,
  // LILA-207: los servicios que la paleta usa para insertar una figura.
  fabricar: vi.fn(), crearFigura: vi.fn(), editarNombre: vi.fn(), arrastrar: vi.fn(),
  // LILA-192/193: el shell publica pérdida e ids rotos por `onEstado`; aquí se guarda el
  // callback para poder empujar un estado de lienzo concreto desde los tests.
  publicarEstado: (_estado: unknown) => {} }));
vi.mock('./simulationGate', () => ({ prepareSimulation: mocks.gate }));
vi.mock('./simulationClient', () => ({ runInWorker: mocks.worker }));
// Mock parcial: `applyTheme` es un espía, pero `tokenToCssVar` sigue siendo el de verdad porque
// `App.tsx` lo usa para borrar las variables del tema anterior (QA de #277).
vi.mock('./theme/applyTheme', async (real) => ({ ...(await real<object>()), applyTheme: vi.fn() }));
vi.mock('./ResultsView', () => ({ ResultsView: ({ result }: { result: { warnings: string[] } }) => <div>Resultado actual {result.warnings.join(' ')}</div> }));
vi.mock('./PropertiesPanel', () => ({ PanelPropiedades: () => null }));
vi.mock('./ScenarioPanel', async (importOriginal) => ({ problemasEscenario: () => mocks.problemas,
  // The rail «+» (#397) goes through the real naming, which is pure.
  duplicarEscenario: (await importOriginal<typeof import('./ScenarioPanel')>()).duplicarEscenario,
  ScenarioPanel: ({ onCambio }: { onCambio: (file: string, raw: object) => void }) => {
    mocks.scenarioChange = () => onCambio('as-is.scenario.json', {});
    // A marker, so the detached-window tests (design 2c) can tell which document it landed in.
    return <div data-mock="escenario" />;
  } }));
vi.mock('./Modeler', () => ({ Lienzo: ({ onListo, onEstado }: { onListo: (model: Modelador) => void; onEstado: (estado: unknown) => void }) => {
  useEffect(() => { mocks.montajes += 1; mocks.publicarEstado = onEstado; mocks.listo = () => onListo({
    exportar: mocks.exportXml, abrir: mocks.abrir, cuellos: mocks.cuellos, ajustar: mocks.ajustar, zoom: mocks.zoom,
    repintar: mocks.repintar,
    validacion: mocks.validacion, seleccionar: mocks.seleccionar, simulacionTokens: mocks.simulacionTokens,
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
  } as unknown as Modelador); if (!mocks.retrasarLienzo) mocks.listo(); }, [onListo]);
  // The canvas container of bpmn-js, as far as the panel keys (#412) care: its focusable `<svg>`
  // and the contenteditable label editor that lives next to it.
  return <div>Modelo montado<div className="djs-container"><svg tabIndex={0} /><div className="djs-direct-editing-parent" contentEditable /></div></div>;
} }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let session: ProjectSessionStore;
let container: HTMLDivElement;
// `nodes` es lo que el panel lee para nombrar el cuello principal (#226): una tarea con nombre
// y otra sin él, que son los dos caminos de `nombreDeCuello`.
const ir = { id: 'Process_1', nodes: { Task_Preparar: { name: 'Prepare food' }, Task_Anonima: { name: '' } }, source: { originalIds: {} } };
/** Corrida con un cuello de botella pintable, para el overlay y el panel derecho (#226). */
const conCuello = (elementId: string) => ({ result: { warnings: [], bottlenecks: [{ elementId, utilization: 0.9 }] }, logSample: [] });
/** Última llamada a `Modelador.cuellos`: `[corrida, visible]`. */
const ultimoOverlay = () => mocks.cuellos.mock.calls.at(-1) as [{ result: { bottlenecks: { elementId: string }[] } } | null, boolean];
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
  mocks.retrasarLienzo = false;
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  // LILA-381: «Acerca de» cierra Ajustes con `close()` antes de abrir su propio diálogo; jsdom no
  // implementa ese método tampoco (mismo motivo que `showModal` arriba).
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'test', tokens: {} }) }));
  mocks.gate.mockResolvedValue({ ir, scenario, warnings: ['W-FRONTERA'] });
  mocks.abrir.mockResolvedValue(true);
  mocks.worker.mockResolvedValue(done);
  // El reparseo diferido de `App.tsx` (150 ms tras montar) sustituye `ir` por el del XML
  // exportado. Para que ese XML nombre la misma tarea que el `ir` falso de `gate` —y el test no
  // dependa de terminar antes del temporizador— la tarea del modelo nuevo pasa a ser
  // `Task_Preparar` («Preparar alimento»); ver `ir` arriba. `newModelXml()` (#409) ya no tiene
  // tareas —es un proceso vacío—, así que este fixture usa `seedModelXml()`, la plantilla
  // inicio→tarea→fin de antes de #409 conservada solo para pruebas.
  mocks.exportXml.mockResolvedValue(seedModelXml().replaceAll(/Task_[0-9a-f]{32}/g, 'Task_Preparar').replace(/(<bpmn:task id="Task_Preparar" name=")[^"]*/, '$1Preparar alimento'));
  mocks.fabricar.mockImplementation((atributos: object) => ({ ...atributos, id: 'Figura_nueva' }));
  mocks.crearFigura.mockImplementation((figura: object) => figura);
  session = { openProject: vi.fn().mockResolvedValue(null), createProject: vi.fn(async (doc) => doc), saveProject: vi.fn(async (doc) => doc), setDirty: vi.fn(), putProcess: vi.fn(async () => {}) } as unknown as ProjectSessionStore;
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  // Modo «Simular»: deja abierta la pestaña Simulación del panel derecho.
  await click(T.app.modos.simular);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); localStorage.clear(); });
it('valida antes del Worker y abre Resultados con avisos preservados', async () => {
  await click(T.app.ejecutar);
  expect(mocks.worker).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Resultado actual W-FRONTERA W-MOTOR');
  expect(container.textContent).toContain('Modelo montado');
});
it('un error de validación impide iniciar Worker', async () => {
  mocks.gate.mockRejectedValueOnce(new Error('E-NOSOP: Task_1'));
  await click(T.app.ejecutar);
  expect(mocks.worker).not.toHaveBeenCalled();
  expect(container.textContent).toContain('E-NOSOP: Task_1');
});
it('cancelar durante preparación no crea Worker ni queda Simulando', async () => {
  const gate = deferred<{ ir: typeof ir; scenario: typeof scenario; warnings: string[] }>();
  mocks.gate.mockReturnValueOnce(gate.promise);
  await click(T.app.ejecutar); await click(T.app.cancelar);
  await act(async () => gate.resolve({ ir, scenario, warnings: [] }));
  expect(mocks.worker).not.toHaveBeenCalled();
  // La barra vuelve a la acción primaria: ni progreso ni botón de cancelar (#237).
  expect(container.querySelector('.progreso')).toBeNull();
  expect(container.textContent).toContain(T.app.ejecutar);
});
it.each(['modelo', 'escenario'])('editar %s aborta y descarta resultado y progreso tardíos', async (kind) => {
  const run = deferred<typeof done>(); mocks.worker.mockReturnValueOnce(run.promise);
  await click(T.app.ejecutar);
  const options = mocks.worker.mock.calls[0]![2] as { signal: AbortSignal; onProgress: (progress: unknown) => void };
  await act(async () => { if (kind === 'modelo') mocks.changed(); else mocks.scenarioChange(); });
  expect(options.signal.aborted).toBe(true);
  await act(async () => { options.onProgress({ fraction: 1, replication: 1 }); run.resolve(done); });
  expect(container.textContent).not.toContain('Resultado actual');
  expect(container.querySelector('.progreso')).toBeNull();
});
it('desmontar termina la corrida activa', async () => {
  mocks.worker.mockReturnValueOnce(new Promise(() => {})); await click(T.app.ejecutar);
  const options = mocks.worker.mock.calls[0]![2] as { signal: AbortSignal };
  await act(async () => root.unmount()); expect(options.signal.aborted).toBe(true);
});

// #226 punto 4: el panel enseñaba `corrida.result.bottlenecks[0].elementId` en crudo.
it.each([['Task_Preparar', T.app.nombreDeCuello('Prepare food', 'Task_Preparar')], ['Task_Anonima', 'Task_Anonima']])(
  'el panel nombra el cuello principal %s',
  async (elementId, texto) => {
    mocks.worker.mockResolvedValue(conCuello(elementId));
    await click(T.app.ejecutar);
    expect(container.textContent).toContain(texto);
  },
);

// #226 punto 6: el interruptor «Cuellos de botella» no tenía prueba.
it('el interruptor «Cuellos de botella» limpia el overlay y lo vuelve a pintar', async () => {
  mocks.worker.mockResolvedValue(conCuello('Task_Preparar'));
  await click(T.app.ejecutar);
  expect(ultimoOverlay()[0]?.result.bottlenecks[0]?.elementId).toBe('Task_Preparar');
  expect(ultimoOverlay()[1]).toBe(true);

  const interruptor = container.querySelector<HTMLInputElement>('.campo.interruptor input')!;
  await act(async () => interruptor.click());
  // Apagar no descarta la corrida: `sincronizarOverlay` limpia el lienzo por `visible = false`.
  expect(ultimoOverlay()[0]).not.toBeNull();
  expect(ultimoOverlay()[1]).toBe(false);

  await act(async () => interruptor.click());
  expect(ultimoOverlay()[1]).toBe(true);
  expect(interruptor.checked).toBe(true);
});

/**
 * #226 punto 5. El ticket describía que tras un `abrir()` fallido había que mover el interruptor
 * dos veces, porque el lienzo se quedaba limpio con la corrida todavía en el estado. Ya no:
 * `Modeler.abrir` solo destruye la instancia anterior (y con ella su overlay) en el camino de
 * éxito, así que al fallar el diagrama en pantalla sigue siendo el de antes — y su overlay, su
 * corrida y su interruptor tienen que seguir intactos, que es lo que fija esta prueba.
 */
it('abrir un .bpmn inválido conserva el proyecto, la corrida y su overlay', async () => {
  // El reparseo con retardo del arranque (150 ms) reescribe `ir` cuando termina, y con el `ir`
  // del XML de mentira el cuello se queda sin nombre. Se le espera ANTES de simular: si no,
  // llegaba en mitad de las aserciones y el test fallaba solo bajo carga.
  await act(async () => { await new Promise((listo) => { setTimeout(listo, 200); }); });
  mocks.worker.mockResolvedValue(conCuello('Task_Preparar'));
  await click(T.app.ejecutar);
  const pintadas = mocks.cuellos.mock.calls.length;

  const xml = newModelXml(); const parsed = await parseBpmn(xml);
  const doc: ProjectDocument = { version: 1, id: 'otro', name: 'Otra carpeta', model: { id: parsed.ir.id, name: 'roto.bpmn', xml, revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [] };
  vi.mocked(session.openProject).mockResolvedValueOnce(doc);
  mocks.abrir.mockResolvedValueOnce(false);
  // Simular deja el proyecto sin guardar: abrir pasa antes por la guardia de cambios.
  await click(T.app.abrir); await click(T.app.descartar);

  expect(mocks.abrir).toHaveBeenCalledOnce();
  expect(container.textContent).toContain(T.app.proyectoDemo);
  expect(container.textContent).toContain(T.app.nombreDeCuello('Prepare food', 'Task_Preparar'));
  // Ni una sola limpieza del overlay: nadie llamó `cuellos(null, …)` ni apagó el interruptor.
  expect(mocks.cuellos.mock.calls.slice(pintadas).filter((c) => c[0] === null || c[1] === false)).toEqual([]);
  expect(container.querySelector<HTMLInputElement>('.campo.interruptor input')!.checked).toBe(true);
});

it('guardar cancelado mantiene cambios pendientes', async () => {
  await act(async () => mocks.changed());
  vi.mocked(session.saveProject).mockResolvedValueOnce(null);
  await click(T.app.guardar);
  expect(container.textContent).toContain(T.app.sinGuardar);
});
it('editar mientras se guarda conserva dirty y no confirma cierre limpio', async () => {
  await act(async () => mocks.changed());
  const pending = deferred<ProjectDocument | null>();
  vi.mocked(session.saveProject).mockReturnValueOnce(pending.promise);
  await click(T.app.guardar);
  const snapshot = vi.mocked(session.saveProject).mock.calls[0]![0];
  await act(async () => mocks.scenarioChange());
  await act(async () => pending.resolve(snapshot));
  expect(container.textContent).toContain(T.app.sinGuardar);
  expect(session.setDirty).toHaveBeenLastCalledWith(true);
});
it('abrir cancelado conserva proyecto y escenarios', async () => {
  await click(T.app.abrir);
  expect(container.textContent).toContain(T.app.proyectoDemo);
});
it('nuevo proyecto reemplaza escenarios del ejemplo por ids propios', async () => {
  await click(T.app.nuevo);
  expect(session.createProject).toHaveBeenCalledOnce();
  const doc = vi.mocked(session.createProject).mock.calls[0]![0];
  expect(doc.model.id).toMatch(/^Process_/);
  expect(JSON.stringify(doc.scenarios)).not.toContain('cajero');
  expect(Object.keys(doc.scenarios)).toHaveLength(2);
  expect(container.textContent).toContain(T.app.proyectoNuevo);
});
it('nuevo proyecto (#409) crea un diagrama vacío sin marcar E-SIN-START/E-SIN-END', async () => {
  await click(T.app.nuevo);
  const doc = vi.mocked(session.createProject).mock.calls[0]![0];
  expect(doc.model.xml).not.toContain('bpmn:startEvent');
  expect(doc.model.xml).not.toContain('bpmn:task');
  expect(doc.model.xml).not.toContain('bpmn:endEvent');
  expect(Object.keys(doc.scenarios)).toHaveLength(2);
  for (const escenario of Object.values(doc.scenarios) as Array<{ elements?: unknown }>) {
    expect(escenario.elements ?? {}).toEqual({});
  }
  // Un proceso sin figuras no es un error hasta que se dibuje la primera (ver el `ponytail` en
  // `App.tsx`, `validacion`): ni el chip flotante ni la cuenta del pie muestran errores o avisos.
  expect(container.querySelector('.chips-validacion')).toBeNull();
  expect(container.querySelector('.chip.error')).toBeNull();
  expect(container.textContent).not.toContain('E-SIN-START');
  expect(container.textContent).not.toContain('E-SIN-END');
  expect(container.textContent).toContain(T.app.errores(0));
  expect(container.textContent).toContain(T.app.avisos(0));
});

it('editar durante la exportación impide guardar un XML con revisión incorrecta', async () => {
  const pending = deferred<string>(); mocks.exportXml.mockReturnValueOnce(pending.promise);
  await click(T.app.guardar);
  await act(async () => mocks.changed());
  await act(async () => pending.resolve(newModelXml()));
  expect(session.saveProject).not.toHaveBeenCalled();
  expect(container.textContent).toContain(T.app.errorModeloCambio);
  expect(container.textContent).toContain(T.app.sinGuardar);
});
it('editar durante apertura conserva el proyecto activo y sus cambios', async () => {
  const xml = newModelXml(); const parsed = await parseBpmn(xml);
  const doc: ProjectDocument = { version: 1, id: 'new', name: 'Otra carpeta', model: { id: parsed.ir.id, name: 'model.bpmn', xml, revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [] };
  const pending = deferred<ProjectDocument | null>(); vi.mocked(session.openProject).mockReturnValueOnce(pending.promise);
  await click(T.app.abrir);
  await act(async () => mocks.changed());
  await act(async () => pending.resolve(doc));
  expect(container.textContent).toContain(T.app.proyectoDemo);
  expect(container.textContent).toContain(T.app.errorProyectoCambio);
});

it('cancelar reemplazo conserva dirty y no abre otro proyecto', async () => {
  await act(async () => mocks.changed());
  await click(T.app.abrir);
  expect(container.querySelector('dialog')?.open).toBe(true);
  await click(T.app.cancelar);
  expect(session.openProject).not.toHaveBeenCalled();
  expect(container.textContent).toContain(T.app.sinGuardar);
});
it.each(['cancelado', 'fallido'])('guardar %s detiene reemplazo y conserva modelo', async (kind) => {
  await act(async () => mocks.changed());
  if (kind === 'cancelado') vi.mocked(session.saveProject).mockResolvedValueOnce(null);
  else vi.mocked(session.saveProject).mockRejectedValueOnce(new Error('E-PERMISO'));
  await click(T.app.nuevo); await click(T.app.guardarYContinuar);
  expect(session.createProject).not.toHaveBeenCalled();
  expect(container.querySelector('dialog')?.open).toBe(true);
  expect(container.textContent).toContain(T.app.sinGuardar);
});
it('guarda el proyecto actual antes de reemplazarlo', async () => {
  await act(async () => mocks.changed());
  await click(T.app.nuevo); await click(T.app.guardarYContinuar);
  expect(session.saveProject).toHaveBeenCalledOnce();
  expect(session.createProject).toHaveBeenCalledOnce();
  expect(vi.mocked(session.saveProject).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(session.createProject).mock.invocationCallOrder[0]!);
  expect(container.textContent).toContain(T.app.proyectoNuevo);
});
it('descartar permite reemplazar sin guardar', async () => {
  await act(async () => mocks.changed());
  await click(T.app.nuevo); await click(T.app.descartar);
  expect(session.saveProject).not.toHaveBeenCalled();
  expect(session.createProject).toHaveBeenCalledOnce();
});

it('bloquea interacción con edición durante apertura y la restaura al cancelar', async () => {
  const pending = deferred<ProjectDocument | null>(); vi.mocked(session.openProject).mockReturnValueOnce(pending.promise);
  await click(T.app.abrir);
  expect(container.querySelector('.zona-modelo')?.hasAttribute('inert')).toBe(true);
  expect(container.querySelector('.panel')?.hasAttribute('inert')).toBe(true);
  await act(async () => pending.resolve(null));
  expect(container.querySelector('.zona-modelo')?.hasAttribute('inert')).toBe(false);
  expect(container.querySelector('.panel')?.hasAttribute('inert')).toBe(false);
});

it('cambiar de tema aplica el JSON nuevo, lo recuerda y repinta SIN remontar el lienzo (LILA-113)', async () => {
  // Let the independent initial XML parse finish before measuring the theme change.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
  mocks.exportXml.mockClear();
  const papel = { name: 'Papel', tokens: { 'bg.base': '#F4F1EC' } };
  const montajesAntes = mocks.montajes;
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => papel } as Response);
  const select = selectTema();
  await act(async () => { select.value = 'papel'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(fetch).toHaveBeenLastCalledWith('./papel.json');
  expect(applyTheme).toHaveBeenLastCalledWith(papel);
  // La aceptación del ticket: el lienzo NO se vuelve a montar (antes cambiaba su `key`, lo que se
  // llevaba por delante la pila de deshacer) y tampoco hace falta exportar el XML para reabrirlo.
  expect(mocks.montajes).toBe(montajesAntes);
  expect(mocks.exportXml).not.toHaveBeenCalled();
  expect(mocks.repintar).toHaveBeenCalledOnce();
  expect(localStorage.getItem('lila.tema')).toBe('papel');
  // El tema ya no se anuncia en la barra de estado (#237): se ve y se cambia en Ajustes.
  expect(select.value).toBe('papel');
});
it('aplicar un tema parcial borra las variables del anterior (docs/THEMES.md)', async () => {
  // `docs/THEMES.md` promete que un token ausente se queda con el valor por defecto de
  // `tokens.css`. No era verdad en cuanto se había aplicado otro tema: `applyTheme` escribe en
  // línea sobre `:root` y no borra, así que un tema parcial —lo que sale de «Importar»— heredaba
  // en silencio los tokens del anterior y se veía distinto según lo que hubiera antes (QA de #277).
  const raiz = document.documentElement;
  raiz.style.setProperty('--bg-base', '#F3F2F2');
  raiz.style.setProperty('--accent-primary', '#EC3013');
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Cian', tokens: { 'accent.primary': '#00E5FF' } }) } as Response);
  const select = selectTema();
  await act(async () => { select.value = 'papel'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  // `applyTheme` es un mock aquí: lo que se mide es que el token que el tema nuevo NO trae ya no
  // está en línea, que es justo lo que lo devuelve al `:root` de `tokens.css` (Eva-01).
  expect(raiz.style.getPropertyValue('--bg-base')).toBe('');
  raiz.style.removeProperty('--accent-primary');
});
it('un tema que lanza no borra las variables del anterior (QA ronda 2 de #277)', async () => {
  // Es la razón de que `aplicarTema` borre DESPUÉS de escribir y no antes: la garantía de
  // `applyTheme` es que un tema malo deja el anterior intacto, y barrer primero la perdía.
  const raiz = document.documentElement;
  raiz.style.setProperty('--bg-base', '#F3F2F2');
  vi.mocked(applyTheme).mockImplementationOnce(() => { throw new Error('Tema "Malo": el token "x" no existe en Lila Modeler.'); });
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Malo', tokens: {} }) } as Response);
  const select = selectTema();
  await act(async () => { select.value = 'papel'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(raiz.style.getPropertyValue('--bg-base')).toBe('#F3F2F2');
  expect(container.textContent).toContain('no existe en Lila Modeler');
  raiz.style.removeProperty('--bg-base');
});
it('el lienzo se repinta DESPUÉS del barrido, no antes (QA ronda 2 de #277)', async () => {
  // `repintar()` relee los tokens del `:root`: si corriera antes del barrido, el diagrama se
  // quedaría con los colores del tema anterior hasta el siguiente repintado.
  const raiz = document.documentElement;
  raiz.style.setProperty('--bg-base', '#F3F2F2');
  let alRepintar = 'sin llamar';
  mocks.repintar.mockImplementationOnce(() => { alRepintar = raiz.style.getPropertyValue('--bg-base'); });
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Cian', tokens: { 'accent.primary': '#00E5FF' } }) } as Response);
  const select = selectTema();
  await act(async () => { select.value = 'papel'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(alRepintar).toBe('');
});
it('un `lila.temas` ilegible no se lleva por delante el tema ni la densidad (QA de #277)', async () => {
  localStorage.setItem('lila.tema', 'papel');
  localStorage.setItem('lila.densidad', 'compacta');
  localStorage.setItem('lila.temas', '{esto no es JSON');
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(fetch).toHaveBeenLastCalledWith('./papel.json');
  expect(container.querySelector('.app')?.getAttribute('data-densidad')).toBe('compacta');
  // La lista ilegible se pierde sola: el selector solo trae los integrados.
  expect(container.querySelectorAll('dialog.ajustes select optgroup')).toHaveLength(1);
});
it('Enter en un campo de texto de Ajustes no cierra el diálogo (QA de #277)', async () => {
  const dialog = container.querySelector<HTMLDialogElement>('dialog.ajustes')!;
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true })); });
  expect(dialog.open).toBe(true);
  // El `<form method="dialog">` enviaba —o sea cerraba— al pulsar Enter en mitad de teclear un hex.
  // jsdom no implementa el envío implícito, así que lo que se mide es el `preventDefault`, que es
  // exactamente lo que en el navegador impide ese envío.
  const enHex = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => { hexDe('accent.primary').dispatchEvent(enHex); });
  expect(enHex.defaultPrevented).toBe(true);
  expect(dialog.open).toBe(true);
  // Y el botón «Cerrar» sigue cerrando con Enter: ahí el objetivo no es un `<input>`.
  const cerrar = [...container.querySelectorAll('dialog.ajustes button')].at(-1)!;
  const enBoton = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => { cerrar.dispatchEvent(enBoton); });
  expect(enBoton.defaultPrevented).toBe(false);
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
it('con puente (escritorio) las preferencias salen y entran por userData, no por localStorage (LILA-113)', async () => {
  const escrito: unknown[] = [];
  // localStorage dice otra cosa a propósito: con puente no se lee ni se escribe.
  localStorage.setItem('lila.tema', 'centinela');
  localStorage.setItem('lila.idioma', 'centinela');
  vi.stubGlobal('lila', {
    pendingOpenPath: async () => null, onOpenPath: () => () => {}, onMenu: () => () => {},
    readSettings: async () => ({ tema: 'papel', densidad: 'comoda', idioma: 'es' }),
    writeSettings: async (a: unknown) => { escrito.push(a); },
  });
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(fetch).toHaveBeenLastCalledWith('./papel.json');
  expect(container.querySelector('.app')?.getAttribute('data-densidad')).toBe('comoda');
  // Solo la densidad al arrancar (su efecto la reescribe tal cual); el tema, al cambiarlo.
  expect(escrito).toEqual([{ densidad: 'comoda' }]);
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Eva-01', tokens: {} }) } as Response);
  const select = selectTema();
  await act(async () => { select.value = 'eva-01'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(escrito).toContainEqual({ tema: 'eva-01' });
  expect(localStorage.getItem('lila.tema')).toBe('centinela');
  // El idioma viaja por el mismo camino (LILA-210): lo que dice el puente es lo que se aplica —la
  // app arranca en español aunque jsdom hable `en-US`— y lo que se cambia vuelve al puente.
  expect(container.textContent).toContain(ES.app.modos.simular);
  expect(document.documentElement.lang).toBe('es');
  const idioma = selectIdioma();
  await act(async () => { idioma.value = 'en'; idioma.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(escrito).toContainEqual({ idioma: 'en' });
  expect(localStorage.getItem('lila.idioma')).toBe('centinela');
});
it('un puente sin readSettings (preload viejo) arranca igual, con lienzo (QA #275)', async () => {
  // `preferencias()` no puede rechazar: el efecto que la llama no recoge el rechazo, así que la app
  // se quedaría con `tema === undefined` para siempre, o sea sin lienzo.
  vi.stubGlobal('lila', { pendingOpenPath: async () => null, onOpenPath: () => () => {}, onMenu: () => () => {} });
  const montajesAntes = mocks.montajes;
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  // jsdom has no `matchMedia`, so the system-based default is Lila Light (#404).
  expect(fetch).toHaveBeenLastCalledWith('./lila-light.json');
  expect(mocks.montajes).toBe(montajesAntes + 1);
});
it('un valor guardado que ya no existe cae al de fábrica sin pedirlo por fetch (LILA-113)', async () => {
  localStorage.setItem('lila.tema', 'tema-borrado'); localStorage.setItem('lila.densidad', 'gigante');
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(fetch).toHaveBeenLastCalledWith('./lila-light.json');
  expect(container.querySelector('.app')?.getAttribute('data-densidad')).toBe('normal');
});

// ---------- default theme by prefers-color-scheme (#404) ----------

/** Stubs `matchMedia` so only `(prefers-color-scheme: dark)` answers `oscuro`. */
function esquemaDelSistema(oscuro: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: oscuro && query === '(prefers-color-scheme: dark)', media: query }));
}
/** Serves the real built-in theme JSONs, so `data-esquema` is computed from their `bg.base`. */
function temasReales(): void {
  vi.mocked(fetch).mockImplementation(async (url) => {
    const archivo = resolve(dirname(fileURLToPath(import.meta.url)), 'theme/themes', String(url).replace('./', ''));
    return { ok: true, json: async () => JSON.parse(readFileSync(archivo, 'utf8')) as unknown } as Response;
  });
}
async function rearrancar(): Promise<void> {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
}
it.each([[true, 'lila-dark', 'oscuro'], [false, 'lila-light', 'claro']] as const)(
  'with nothing saved and a dark OS = %s it starts in %s (%s) and does not save it (#404)',
  async (oscuro, id, esquema) => {
    esquemaDelSistema(oscuro); temasReales();
    await rearrancar();
    expect(fetch).toHaveBeenLastCalledWith(`./${id}.json`);
    expect(container.querySelector('.app')?.getAttribute('data-esquema')).toBe(esquema);
    expect(localStorage.getItem('lila.tema')).toBeNull();
  },
);
it('a saved theme wins over the OS scheme (#404)', async () => {
  esquemaDelSistema(true);
  localStorage.setItem('lila.tema', 'papel');
  await rearrancar();
  expect(fetch).toHaveBeenLastCalledWith('./papel.json');
});
it('an invalid saved theme falls back to the OS-based Lila theme (#404)', async () => {
  esquemaDelSistema(true);
  localStorage.setItem('lila.tema', 'nope');
  await rearrancar();
  expect(fetch).toHaveBeenLastCalledWith('./lila-dark.json');
});
it('desktop without a saved theme follows the OS and never writes the automatic choice (#404)', async () => {
  esquemaDelSistema(true);
  const escrito: Record<string, unknown>[] = [];
  vi.stubGlobal('lila', {
    pendingOpenPath: async () => null, onOpenPath: () => () => {}, onMenu: () => () => {},
    readSettings: async () => ({}),
    writeSettings: async (a: Record<string, unknown>) => { escrito.push(a); },
  });
  await rearrancar();
  expect(fetch).toHaveBeenLastCalledWith('./lila-dark.json');
  expect(escrito.some((a) => 'tema' in a)).toBe(false);
});

// ---------- idioma (LILA-210) ----------

it('sin nada guardado arranca en el idioma del sistema (LILA-210)', async () => {
  // `navigator.language` es de solo lectura y vive en el prototipo: se tapa con una propiedad
  // propia y se quita al terminar, que es como el resto de la suite vuelve a ver «en-US».
  Object.defineProperty(navigator, 'language', { value: 'es-MX', configurable: true });
  try {
    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<App store={session} />));
    expect(container.textContent).toContain(ES.app.modos.simular);
    expect(container.textContent).not.toContain(T.app.modos.rutas);
    expect(document.documentElement.lang).toBe('es');
    // Y sin escribir nada: seguir al sistema es la preferencia de fábrica, no una elección.
    expect(localStorage.getItem('lila.idioma')).toBeNull();
    expect(selectIdioma().value).toBe('auto');
  } finally {
    delete (navigator as { language?: string }).language;
  }
});

it('cambiar de idioma repinta SIN remontar el lienzo y lo recuerda (LILA-210)', async () => {
  const montajesAntes = mocks.montajes;
  const validacionesAntes = mocks.validacion.mock.calls.length;
  const cuellosAntes = mocks.cuellos.mock.calls.length;
  expect(container.textContent).toContain(T.app.modos.rutas);
  const select = selectIdioma();
  await act(async () => { select.value = 'es'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  // El árbol entero se repinta con el catálogo nuevo…
  expect(container.textContent).toContain(ES.app.modos.rutas);
  expect(container.textContent).not.toContain(T.app.modos.rutas);
  expect(document.documentElement.lang).toBe('es');
  // …y el lienzo sigue siendo el mismo: la pila de deshacer y la selección no se pierden por
  // cambiar de idioma, que es justo el punto (el mismo trato que el tema en LILA-113).
  expect(mocks.montajes).toBe(montajesAntes);
  // Lo que se escribe SOBRE el lienzo no lo repinta React, así que sus efectos tienen que volver
  // a correr: los discos de validación y el overlay de cuellos se vuelven a aplicar (QA de #301).
  expect(mocks.validacion.mock.calls.length).toBeGreaterThan(validacionesAntes);
  expect(mocks.cuellos.mock.calls.length).toBeGreaterThan(cuellosAntes);
  // Se guarda la PREFERENCIA, que aquí coincide con el idioma porque se eligió a mano.
  expect(localStorage.getItem('lila.idioma')).toBe('es');
});

it('volver a «auto» devuelve el idioma al sistema (LILA-210)', async () => {
  const select = selectIdioma();
  await act(async () => { select.value = 'es'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await act(async () => { select.value = 'auto'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  // jsdom habla `en-US`, así que seguir al sistema es volver al catálogo base.
  expect(container.textContent).toContain(T.app.modos.rutas);
  expect(localStorage.getItem('lila.idioma')).toBe('auto');
});

it('un idioma guardado que no existe cae en «auto» sin romper nada (LILA-210)', async () => {
  // De una versión anterior, o de un `estado.json` tocado a mano: `fr` no es un catálogo que la
  // app tenga, y arrancar tiene que seguir arrancando.
  localStorage.setItem('lila.idioma', 'fr');
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(container.textContent).toContain(T.app.modos.rutas);
  expect(document.documentElement.lang).toBe('en');
  expect(selectIdioma().value).toBe('auto');
});

it('el idioma guardado manda sobre el del sistema (LILA-210)', async () => {
  localStorage.setItem('lila.idioma', 'es');
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(container.textContent).toContain(ES.app.modos.rutas);
  expect(selectIdioma().value).toBe('es');
});

// ---------- el idioma viaja al motor (#280) ----------

/**
 * La frontera de validación y el worker son mocks en esta suite, así que lo que se comprueba no
 * es el texto del motor —eso lo hace `simulationGate.test.ts`— sino lo que la app le **pide**:
 * el idioma activo en el momento de arrancar la corrida. Una corrida ya guardada conserva el
 * idioma en el que se produjo, y por eso el idioma se lee al arrancar y no al pintar.
 */
it('la corrida pide los mensajes del motor en el idioma activo (#280)', async () => {
  await click(T.app.ejecutar);
  expect(mocks.gate.mock.calls.at(-1)?.at(-1)).toEqual({ locale: 'en' });
  expect(mocks.worker.mock.calls.at(-1)?.[2]).toMatchObject({ locale: 'en' });

  const select = selectIdioma();
  await act(async () => { select.value = 'es'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await click(ES.app.ejecutar);

  expect(mocks.gate.mock.calls.at(-1)?.at(-1)).toEqual({ locale: 'es' });
  expect(mocks.worker.mock.calls.at(-1)?.[2]).toMatchObject({ locale: 'es' });
});

/** Un tema del usuario tal y como lo deja Apariencia (LILA-114). */
const temaMio = { id: 'u:1', tema: { name: 'Mío', tokens: { 'accent.primary': '#123456' } }, origen: { 'accent.primary': '#9EF01A' } };
/**
 * El selector de tema dentro del diálogo de Ajustes. Va por su `.campo`: el primer `<select>` del
 * diálogo es el del idioma, que se pinta encima de Apariencia (LILA-210).
 */
const selectTema = (): HTMLSelectElement =>
  container.querySelector<HTMLSelectElement>('dialog.ajustes .campo:not(.idioma) select')!;
/** El selector de idioma del mismo diálogo. */
const selectIdioma = (): HTMLSelectElement =>
  container.querySelector<HTMLSelectElement>('dialog.ajustes .idioma select')!;

/** El campo hex de un token dentro del diálogo de Ajustes. */
const hexDe = (token: string) =>
  container.querySelector<HTMLInputElement>(`dialog.ajustes input[aria-label="${T.apariencia.hex(token)}"]`)!;

it('un tema del usuario sobrevive a recargar y se aplica sin fetch (LILA-114)', async () => {
  localStorage.setItem('lila.tema', 'u:1');
  localStorage.setItem('lila.temas', JSON.stringify([temaMio]));
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.mocked(fetch).mockClear();
  await act(async () => root.render(<App store={session} />));
  // Ni una petición: el tema del usuario sale del almacén, no de `themes/*.json`.
  expect(fetch).not.toHaveBeenCalled();
  expect(applyTheme).toHaveBeenLastCalledWith(temaMio.tema);
  expect(selectTema().value).toBe('u:1');
});

it('editar un token guarda la lista donde toca en cada modalidad (LILA-114)', async () => {
  // Web: la lista va a `localStorage`, junto al tema elegido.
  teclear(hexDe('accent.primary'), '#00FF00');
  const guardado = JSON.parse(localStorage.getItem('lila.temas')!) as (typeof temaMio)[];
  expect(guardado).toHaveLength(1);
  expect(guardado[0]!.tema.tokens['accent.primary']).toBe('#00FF00');
  expect(localStorage.getItem('lila.tema')).toBe(guardado[0]!.id);

  // Escritorio: la misma lista sale y entra por el puente, y el `localStorage` ni se mira.
  const escrito: { temas?: unknown }[] = [];
  vi.stubGlobal('lila', {
    pendingOpenPath: async () => null, onOpenPath: () => () => {}, onMenu: () => () => {},
    readSettings: async () => ({ tema: 'u:1', temas: [temaMio] }),
    writeSettings: async (a: { temas?: unknown }) => { escrito.push(a); },
  });
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(applyTheme).toHaveBeenLastCalledWith(temaMio.tema);
  teclear(hexDe('accent.primary'), '#0000FF');
  // `toContainEqual` y no la última llamada: el efecto de la densidad escribe la suya después.
  expect(escrito).toContainEqual({ temas: [{ ...temaMio, tema: { ...temaMio.tema, tokens: { 'accent.primary': '#0000FF' } } }] });
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
it('en Ajustes, «Acerca de Lila Modeler» cierra Ajustes y abre el diálogo Acerca de (LILA-381)', async () => {
  const ajustes = container.querySelector<HTMLDialogElement>('dialog.ajustes')!;
  const acerca = container.querySelector<HTMLDialogElement>('dialog.acerca')!;
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true })); });
  expect(ajustes.open).toBe(true);
  expect(acerca.open).toBe(false);
  await click(T.app.acercaDe);
  expect(ajustes.open).toBe(false);
  expect(acerca.open).toBe(true);
  expect(container.textContent).toContain(T.bienvenida.nombre);
});
it('el menú nativo despacha "acerca" y abre el diálogo Acerca de (LILA-381)', async () => {
  let menu: ((a: unknown) => void) | null = null;
  vi.stubGlobal('lila', { onMenu: (cb: (a: unknown) => void) => { menu = cb; return () => {}; },
    pendingOpenPath: async () => null, onOpenPath: () => () => {},
    readSettings: async () => ({}), writeSettings: async () => {} });
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(menu).not.toBeNull();
  const acerca = container.querySelector<HTMLDialogElement>('dialog.acerca')!;
  expect(acerca.open).toBe(false);
  await act(async () => { menu!('acerca'); });
  expect(acerca.open).toBe(true);
});
it('mientras el karaoke del huevo de pascua suena, ni ⌘, ni "acerca" abren nada encima (QA de #387, Low)', async () => {
  // El `<dialog>` de Acerca de ya está cerrado mientras el karaoke corre (para que su "top layer"
  // no lo tape), así que ni el atajo de teclado ni el menú nativo pasan por él para saber que
  // hay que esperar: sin la `ref` de `App.tsx` que enlaza con `onKaraoke`, `ejecutar('ajustes')`
  // volvía a abrir Ajustes encima del overlay.
  vi.useFakeTimers();
  vi.stubGlobal('open', vi.fn());
  const ajustes = container.querySelector<HTMLDialogElement>('dialog.ajustes')!;
  const acerca = container.querySelector<HTMLDialogElement>('dialog.acerca')!;
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true })); });
  await click(T.app.acercaDe);
  expect(acerca.open).toBe(true);
  const icono = container.querySelector<HTMLImageElement>('.acerca-icono')!;
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { icono.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  }
  const campo = container.querySelector<HTMLInputElement>('.acerca-clave input')!;
  const receptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { receptor.call(campo, 'brito'); campo.dispatchEvent(new Event('input', { bubbles: true })); });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('.acerca-clave button[type="submit"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  expect(acerca.open).toBe(false);
  expect(document.querySelector('.karaoke')).not.toBeNull();
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true })); });
  expect(ajustes.open).toBe(false);
  expect(acerca.open).toBe(false);
  // Se cancela para terminar sin temporizadores vivos ni el enlace abierto.
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(document.querySelector('.karaoke')).toBeNull();
  // Y con el karaoke ya fuera, ⌘, vuelve a funcionar normalmente.
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', metaKey: true })); });
  expect(ajustes.open).toBe(true);
  vi.useRealTimers();
});
it('el menú nativo despacha a las mismas acciones y abrir reciente activa el proyecto', async () => {
  let menu: ((a: unknown) => void) | null = null;
  const doc = { version: 1, id: 'p2', name: 'Reciente', model: { id: 'Process_2', name: 'model.bpmn', xml: newModelXml(), revision: 0 }, scenarios: { 'as-is.scenario.json': {} }, scenarioRevisions: {}, runs: [] };
  // El puente falso trae también las dos rutas de apertura de LILA-072/074: `App` las llama al
  // montar y un puente a medias reventaría aquí igual que en Electron.
  vi.stubGlobal('lila', { onMenu: (cb: (a: unknown) => void) => { menu = cb; return () => {}; },
    pendingOpenPath: async () => null, onOpenPath: () => () => {},
    readSettings: async () => ({}), writeSettings: async () => {} });
  (session as unknown as { openRecent: unknown }).openRecent = vi.fn().mockResolvedValue(doc);
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(menu).not.toBeNull();
  await act(async () => { menu!({ openRecent: '/p/reciente' }); });
  // Sin `file`: «Abrir reciente» abre el `model.bpmn` de la carpeta, como siempre.
  expect((session as unknown as { openRecent: ReturnType<typeof vi.fn> }).openRecent).toHaveBeenCalledWith('/p/reciente', undefined);
  expect(container.textContent).toContain('Reciente');
  await act(async () => { menu!('guardar'); });
  expect(session.saveProject).toHaveBeenCalledOnce();
});

// ---------- abrir un .bpmn por asociación de archivo / arranque en frío (LILA-072, LILA-074) ----------

/** Puente falso con solo lo que mira este bloque; devuelve el espía de baja de `onOpenPath`. */
function puenteConRutas(pendiente: { dir: string; file?: string } | null) {
  const quitar = vi.fn();
  let emitir: ((ruta: { dir: string; file?: string }) => void) | null = null;
  let menu: ((a: unknown) => void) | null = null;
  vi.stubGlobal('lila', {
    pendingOpenPath: vi.fn().mockResolvedValue(pendiente),
    onOpenPath: (cb: (ruta: { dir: string; file?: string }) => void) => { emitir = cb; return quitar; },
    onMenu: (cb: (a: unknown) => void) => { menu = cb; return () => {}; },
    readSettings: async () => ({}),
    writeSettings: async () => {},
  });
  return {
    quitar,
    emitir: (ruta: { dir: string; file?: string }) => emitir!(ruta),
    menu: (accion: unknown) => menu!(accion),
  };
}
function proyecto(id: string, name: string) {
  return { version: 1, id, name, model: { id: `Process_${id}`, name: 'model.bpmn', xml: newModelXml(), revision: 0 }, scenarios: { 'as-is.scenario.json': {} }, scenarioRevisions: {}, runs: [] };
}
async function remontar() {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  // El efecto espera al modelador y `pendingOpenPath()` es asíncrono: un turno más de microtareas.
  await act(async () => {});
}

it('una ruta .bpmn pendiente al arrancar abre su carpeta en el editor', async () => {
  const abrirReciente = vi.fn().mockResolvedValue(proyecto('p3', 'Desde doble clic'));
  (session as unknown as { openRecent: unknown }).openRecent = abrirReciente;
  puenteConRutas({ dir: '/p/descargas', file: 'model.bpmn' });
  await remontar();
  expect(abrirReciente).toHaveBeenCalledWith('/p/descargas', 'model.bpmn');
  expect(container.textContent).toContain('Desde doble clic');
});

it('se abre EL .bpmn pulsado, no el model.bpmn de la carpeta (LILA-072)', async () => {
  const abrirReciente = vi.fn().mockResolvedValue(proyecto('p7', 'Ventas'));
  (session as unknown as { openRecent: unknown }).openRecent = abrirReciente;
  puenteConRutas({ dir: '/p/descargas', file: 'ventas.bpmn' });
  await remontar();
  expect(abrirReciente).toHaveBeenCalledWith('/p/descargas', 'ventas.bpmn');
});

// ---------- abrir un .lila por asociación de archivo / arranque en frío (issue #378) ----------
// Un `.lila` llega por la MISMA puerta que un `.bpmn` (arriba), pero SIN `ruta.file`: `ruta.dir`
// es entonces la ruta del propio `.lila`, no una carpeta que recorrer (ver `OpenPathRequest` en
// `bridge.ts`). El bug de #378 era reenviar `file` de todos modos con el nombre del `.lila`, lo
// que dejaba `DesktopStore.activeModelFile` mal puesto y reventaba el siguiente guardado normal
// en `lila:writeProject`/`requireBpmnName`.

it('una ruta .lila pendiente al arrancar abre el archivo SIN reenviar `file` a openRecent (issue #378)', async () => {
  const abrirReciente = vi.fn().mockResolvedValue(proyecto('p14', 'Desde .lila'));
  (session as unknown as { openRecent: unknown }).openRecent = abrirReciente;
  puenteConRutas({ dir: '/descargas/launch.lila' });
  await remontar();
  expect(abrirReciente).toHaveBeenCalledWith('/descargas/launch.lila', undefined);
  expect(container.textContent).toContain('Desde .lila');
});

it('una ruta .lila que llega con la app abierta también abre sin `file` (issue #378)', async () => {
  const abrirReciente = vi.fn().mockResolvedValue(proyecto('p15', 'Segundo .lila'));
  (session as unknown as { openRecent: unknown }).openRecent = abrirReciente;
  const puente = puenteConRutas(null);
  await remontar();
  await act(async () => { puente.emitir({ dir: '/descargas/otro.lila' }); });
  expect(abrirReciente).toHaveBeenCalledWith('/descargas/otro.lila', undefined);
  expect(container.textContent).toContain('Segundo .lila');
});

it('una ruta .lila que llega con una E/S en curso avisa con solo el nombre del archivo, sin "undefined" (issue #378)', async () => {
  const guardado = deferred<ProjectDocument | null>();
  session.saveProject = vi.fn().mockReturnValue(guardado.promise);
  const abrirReciente = vi.fn().mockResolvedValue(proyecto('p16', 'Nunca'));
  (session as unknown as { openRecent: unknown }).openRecent = abrirReciente;
  const puente = puenteConRutas(null);
  await remontar();
  await act(async () => { puente.menu('guardar'); }); // toma `ioLock` y no lo suelta.
  await act(async () => { puente.emitir({ dir: '/descargas/launch.lila' }); });
  expect(abrirReciente).not.toHaveBeenCalled();
  // Solo el nombre, como con un `.bpmn` (`ruta.file`) — no la ruta entera de `ruta.dir`.
  expect(container.textContent).toContain(T.app.errorAbrirOcupado('launch.lila'));
  expect(container.textContent).not.toContain('/descargas/launch.lila');
  expect(container.textContent).not.toContain('undefined');
  await act(async () => { guardado.resolve(null); });
});

it('una ruta .bpmn que llega con la app abierta cambia de proyecto', async () => {
  const abrirReciente = vi.fn()
    .mockResolvedValueOnce(proyecto('p4', 'Primero'))
    .mockResolvedValueOnce(proyecto('p5', 'Segundo'));
  (session as unknown as { openRecent: unknown }).openRecent = abrirReciente;
  const puente = puenteConRutas({ dir: '/p/uno', file: 'model.bpmn' });
  await remontar();
  expect(container.textContent).toContain('Primero');
  await act(async () => { puente.emitir({ dir: '/p/dos', file: 'model.bpmn' }); });
  expect(abrirReciente).toHaveBeenLastCalledWith('/p/dos', 'model.bpmn');
  expect(container.textContent).toContain('Segundo');
});

it('un .bpmn suelto (carpeta sin escenarios) abre con el AS-IS por defecto y sin errores', async () => {
  const suelto = { ...proyecto('p10', 'Suelto'), scenarios: {} };
  (session as unknown as { openRecent: unknown }).openRecent = vi.fn().mockResolvedValue(suelto);
  puenteConRutas({ dir: '/p/descargas', file: 'ventas.bpmn' });
  await remontar();
  expect(container.textContent).toContain('Suelto');
  const pie = container.querySelector('.estado')!;
  expect(pie.textContent).toContain(T.app.errores(0)); // sin AS-IS por defecto sería «escenario desconocido».
  expect(pie.textContent).toContain('AS-IS');
});

it('un diagrama suelto lo advierte en el pie, y «Guardar como» deja de advertirlo (LILA-072)', async () => {
  const suelto = { ...proyecto('p12', 'Suelto'), scenarios: {}, loose: true };
  (session as unknown as { openRecent: unknown }).openRecent = vi.fn().mockResolvedValue(suelto);
  const puente = puenteConRutas({ dir: '/p/descargas', file: 'ventas.bpmn' });
  await remontar();
  const pie = container.querySelector('.estado')!;
  expect(pie.textContent).toContain(T.app.diagramaSuelto);
  // El aviso nombra las dos cosas que un ⌘S en modo suelto NO escribe (LILA-208, aceptación 2).
  expect(T.app.diagramaSuelto).toContain('scenarios and runs are not saved');
  expect(T.app.diagramaSuelto).toContain(T.app.guardarComo);

  await act(async () => { puente.menu('guardarComo'); });
  expect(session.saveProject).toHaveBeenCalledWith(expect.anything(), { saveAs: true });
  expect(pie.textContent).not.toContain(T.app.diagramaSuelto);
});

it.each([
  ['escenario editado', 'escenario', T.app.sinGuardar],
  ['corrida sin guardar', 'corrida', T.app.sinGuardar],
  ['solo el XML editado', 'modelo', T.app.guardado],
] as const)('diagrama suelto, %s: guardar solo limpia el indicador de lo escrito (LILA-208)', async (_caso, que, esperado) => {
  // Un guardado normal en modo suelto escribe SOLO el `.bpmn`: el escenario editado sigue sin
  // estar en disco, así que el indicador NO puede quedarse en «Guardado» (y la guardia de cierre
  // sale del mismo token).
  const suelto = { ...proyecto('p13', 'Suelto'), loose: true };
  (session as unknown as { openRecent: unknown }).openRecent = vi.fn().mockResolvedValue(suelto);
  let pedirGuardado!: () => Promise<SaveOutcome>;
  (session as unknown as { onSaveRequested: unknown }).onSaveRequested =
    (cb: () => Promise<SaveOutcome>) => { pedirGuardado = cb; return () => {}; };
  const puente = puenteConRutas({ dir: '/p/descargas', file: 'ventas.bpmn' });
  await remontar();
  expect(container.textContent).toContain(T.app.guardado);

  // El `onCambio` del panel de escenario solo existe con su pestaña montada.
  await click(T.app.pestanas.simulacion);
  if (que === 'corrida') await click(T.app.ejecutar);
  else await act(async () => { if (que === 'modelo') mocks.changed(); else mocks.scenarioChange(); });
  expect(container.textContent).toContain(T.app.sinGuardar);
  await act(async () => { puente.menu('guardar'); });
  expect(session.saveProject).toHaveBeenCalledWith(expect.anything(), { saveAs: false });
  expect(container.textContent).toContain(esperado);
  expect(session.setDirty).toHaveBeenLastCalledWith(esperado === T.app.sinGuardar);

  // La guardia de cierre (`onSaveRequested` → `closeGuard`) sale del MISMO token: con el escenario
  // todavía sin escribir, «Guardar» en el diálogo nativo devuelve `false` y la ventana no se
  // cierra, en vez de irse llevándose el escenario editado (QA de LILA-208).
  let cerrar: SaveOutcome | null = null;
  await act(async () => { cerrar = await pedirGuardado(); });
  expect(cerrar).toBe(esperado === T.app.guardado ? 'saved' : 'diagram-only');
});

it('una ruta que llega con el lienzo aún no listo se abre en cuanto lo está', async () => {
  mocks.retrasarLienzo = true;
  const abrirReciente = vi.fn().mockResolvedValue(proyecto('p8', 'Tardío'));
  (session as unknown as { openRecent: unknown }).openRecent = abrirReciente;
  const puente = puenteConRutas(null);
  await remontar();
  await act(async () => { puente.emitir({ dir: '/p/tres', file: 'ventas.bpmn' }); });
  expect(abrirReciente).not.toHaveBeenCalled(); // sin modelador `projectAction` no haría nada.
  await act(async () => { mocks.listo(); });
  expect(abrirReciente).toHaveBeenCalledWith('/p/tres', 'ventas.bpmn');
  expect(container.textContent).toContain('Tardío');
});

it('una ruta que llega con una E/S en curso avisa en vez de descartarse', async () => {
  const guardado = deferred<ProjectDocument | null>();
  session.saveProject = vi.fn().mockReturnValue(guardado.promise);
  const abrirReciente = vi.fn().mockResolvedValue(proyecto('p9', 'Nunca'));
  (session as unknown as { openRecent: unknown }).openRecent = abrirReciente;
  const puente = puenteConRutas(null);
  await remontar();
  await act(async () => { puente.menu('guardar'); }); // toma `ioLock` y no lo suelta.
  await act(async () => { puente.emitir({ dir: '/p/cuatro', file: 'ventas.bpmn' }); });
  expect(abrirReciente).not.toHaveBeenCalled();
  expect(container.textContent).toContain(T.app.errorAbrirOcupado('ventas.bpmn'));
  await act(async () => { guardado.resolve(null); });
});

it('una ruta que llega con el diálogo de cambios sin guardar abierto no pisa la acción pendiente', async () => {
  (session as unknown as { openRecent: unknown }).openRecent = vi.fn().mockResolvedValue(proyecto('p11', 'Nunca'));
  const puente = puenteConRutas(null);
  await remontar();
  await act(async () => mocks.changed());
  await click(T.app.nuevo); // deja `pendingAction = 'new'` con el diálogo abierto.
  await act(async () => { puente.emitir({ dir: '/p/cinco', file: 'ventas.bpmn' }); });
  expect(container.textContent).toContain(T.app.errorAbrirOcupado('ventas.bpmn'));
  // «Descartar» sigue haciendo lo que el usuario pidió (Nuevo), no la ruta que llegó en medio.
  await click(T.app.descartar);
  expect(session.createProject).toHaveBeenCalledOnce();
  expect((session as unknown as { openRecent: ReturnType<typeof vi.fn> }).openRecent).not.toHaveBeenCalled();
});

it('desmontar da de baja la suscripción a onOpenPath', async () => {
  const puente = puenteConRutas(null);
  await remontar();
  expect(puente.quitar).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  expect(puente.quitar).toHaveBeenCalled();
});

// ---------- lienzo: zoom, minimapa y pestañas de diagrama (LILA-208) ----------

it('los botones del lienzo acercan, alejan y ajustan el zoom', async () => {
  await act(async () => porEtiqueta(T.app.acercar).click());
  expect(mocks.zoom).toHaveBeenLastCalledWith(1.2);
  await act(async () => porEtiqueta(T.app.alejar).click());
  expect(mocks.zoom).toHaveBeenLastCalledWith(1 / 1.2);
  expect(mocks.ajustar).not.toHaveBeenCalled();
  await act(async () => porEtiqueta(T.app.ajustarPantalla).click());
  expect(mocks.ajustar).toHaveBeenCalledOnce();
});
it('cerrar la pestaña del diagrama y «+» abren un proyecto nuevo', async () => {
  await act(async () => porEtiqueta(T.app.cerrarArchivo('model.bpmn')).click());
  expect(session.createProject).toHaveBeenCalledOnce();
  await act(async () => porEtiqueta(T.app.nuevoDiagrama).click());
  expect(session.createProject).toHaveBeenCalledTimes(2);
});
it('cerrar la pestaña con cambios sin guardar pasa por la guardia', async () => {
  await act(async () => mocks.changed());
  await act(async () => porEtiqueta(T.app.cerrarArchivo('model.bpmn')).click());
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
  // The canvas chips; the rail of Simulate repeats them in its footer (design 2a).
  const chips = [...container.querySelectorAll('.zona-modelo .chips-validacion .chip')].map((c) => c.textContent);
  expect(chips).toEqual([T.app.errores(1), T.app.avisos(1)]);
  // El disco se pinta por el modelador, no por React: el shell no importa bpmn-js.
  const validacion = mocks.validacion.mock.calls.at(-1)![0] as { marcadores: Map<string, unknown> };
  expect([...validacion.marcadores.keys()]).toEqual(['Task_1']);

  await click(T.app.avisos(1));
  expect(mocks.seleccionar).toHaveBeenCalledWith('Task_1');
});

it('sin problemas no hay chips', () => {
  // Over the canvas only: the rail footer always shows its two counts (design 2a).
  expect(container.querySelector('.zona-modelo .chips-validacion')).toBeNull();
});

// --- «Validar rutas» (LILA-065) ---

it('«Validar rutas» aparece junto a los demás modos y avisa de que no es la simulación DES', async () => {
  const modos = [...container.querySelectorAll('.modos .modo')].map((b) => b.textContent);
  expect(modos).toEqual(Object.values(T.app.modos));
  await click(T.app.modos.rutas);
  expect(container.textContent).toContain(T.tokenSim.aviso);
});

it('entrar en «Validar rutas» activa la animación de tokens y salir la desactiva', async () => {
  await click(T.app.modos.rutas);
  expect(mocks.simulacionTokens).toHaveBeenLastCalledWith(true);
  await click(T.app.modos.modelar);
  expect(mocks.simulacionTokens).toHaveBeenLastCalledWith(false);
});

it('cambiar de tema con «Validar rutas» encendido reinicia el modo (QA #275)', async () => {
  // Los colores neutros del modo se escriben en el DI y el DI gana a lo que repinte `repintar()`:
  // sin apagar y volver a encender, el diagrama se queda con el relleno del tema anterior y la
  // etiqueta con el color del nuevo (medido: `#1F1A36` bajo texto `#201E1D`, contraste 1,0:1).
  await click(T.app.modos.rutas);
  mocks.simulacionTokens.mockClear();
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Papel', tokens: {} }) } as Response);
  const select = selectTema();
  await act(async () => { select.value = 'papel'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(mocks.simulacionTokens.mock.calls.map(([activa]) => activa)).toEqual([false, true]);
});

it('editar un token de diagrama con «Validar rutas» encendido reinicia el modo (QA #277)', async () => {
  // Con un tema del usuario ya activo, editar un token NO cambia `temaId`: si la `key` de
  // `TokenSim` fuera solo el id, el modo no se reiniciaría y el diagrama se quedaría con el
  // relleno viejo, porque `ColoresNeutrosDelTema` lo escribió en el DI al activar el modo y el DI
  // gana a `repintar()` (medido por CDP: `fill` en línea `rgb(31,26,54)` con `--diagram-fill`
  // ya en `#FFFFFF`).
  localStorage.setItem('lila.tema', 'u:1');
  localStorage.setItem('lila.temas', JSON.stringify([temaMio]));
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  await click(T.app.modos.rutas);
  mocks.simulacionTokens.mockClear();
  // Un token que el modo no congela en el DI no reinicia nada: no hay por qué cortar la animación.
  teclear(hexDe('accent.primary'), '#00FFAA');
  expect(mocks.simulacionTokens).not.toHaveBeenCalled();
  teclear(hexDe('diagram.fill'), '#FFFFFF');
  expect(mocks.simulacionTokens.mock.calls.map(([activa]) => activa)).toEqual([false, true]);
});

it('en «Validar rutas» no se pintan el overlay de cuellos ni los marcadores de validación', async () => {
  await act(async () => {
    mocks.problemas = [{ ruta: 'elements.Task_1', mensaje: 'sin parámetros', severidad: 'warning' }];
    mocks.scenarioChange();
  });
  mocks.validacion.mockClear();
  mocks.cuellos.mockClear();
  await click(T.app.modos.rutas);
  expect(mocks.validacion).toHaveBeenLastCalledWith(null);
  expect(mocks.cuellos).toHaveBeenLastCalledWith(null, false);
  await click(T.app.modos.modelar);
  expect(mocks.validacion).toHaveBeenLastCalledWith(expect.objectContaining({ marcadores: expect.anything() }));
});

// --- Barra superior y barra de estado como el artboard 01 (#237) ---

it('la barra tiene una sola acción primaria y corre el escenario desde cualquier modo', async () => {
  await click(T.app.modos.modelar);
  expect(container.querySelectorAll('.barra .boton.primario')).toHaveLength(1);
  await click(T.app.ejecutar);
  expect(mocks.worker).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Resultado actual');
});
it('mientras simula, la barra enseña la replicación, el porcentaje y CANCELAR', async () => {
  mocks.worker.mockReturnValueOnce(new Promise(() => {}));
  await click(T.app.ejecutar);
  const { onProgress } = mocks.worker.mock.calls[0]![2] as { onProgress: (p: unknown) => void };
  await act(async () => { onProgress({ replication: 2, totalReplications: 10, fraction: 0.31 }); });
  const barra = container.querySelector('.barra')!;
  expect(barra.textContent).toContain(T.app.replicacion(3, 10));
  expect(barra.textContent).toContain(T.app.porCiento(31));
  expect(barra.textContent).not.toContain(T.app.ejecutar);
  await click(T.app.cancelar);
  expect(barra.textContent).toContain(T.app.ejecutar);
});
it('las acciones de proyecto viven en el desplegable Archivo, no sueltas en la barra', async () => {
  const menu = container.querySelector('.menu-archivo')!;
  const acciones = [...menu.querySelectorAll('button')].map((b) => b.textContent);
  expect(acciones).toEqual(expect.arrayContaining([T.app.nuevo, T.app.abrir, T.app.guardar, T.app.guardarComo]));
  const sueltos = [...container.querySelectorAll('.barra > .boton')].map((b) => b.textContent);
  expect(sueltos).not.toContain(T.app.guardar);
  // El desplegable se cierra al elegir: `<details>` no lo hace solo.
  await click(T.app.guardar);
  expect((menu as HTMLDetailsElement).open).toBe(false);
  // …y con `Esc`, que `<details>` tampoco trae de serie (#237 [QA]).
  await act(async () => { (menu as HTMLDetailsElement).open = true; });
  await act(async () => { menu.querySelector('summary')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect((menu as HTMLDetailsElement).open).toBe(false);
});
it('el pie lleva errores, avisos, escenario y semilla heredada del escenario activo', async () => {
  const pie = container.querySelector('.estado')!;
  expect(pie.textContent).toContain(T.app.errores(0));
  expect(pie.textContent).toContain(T.app.avisos(0));
  expect(pie.textContent).toContain(T.app.escenario);
  expect(pie.textContent).toContain('AS-IS');
  expect(pie.textContent).toContain(T.app.semilla('42'));
  // The scenario is picked in the rail of Simulate now (design 2a), not in a `<select>`.
  await act(async () => { filaRail('TO-BE 3 cashiers').click(); });
  expect(pie.textContent).toContain('TO-BE 3 cashiers');
  expect(pie.textContent).toContain(T.app.semilla('42'));
});

/** El setter nativo + el evento `input` es lo que React traduce a `onChange`. */
function teclear(campo: HTMLInputElement, texto: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** A row of the scenario rail (design 2a), by the scenario's name. */
const filaRail = (nombre: string): HTMLButtonElement =>
  [...container.querySelectorAll<HTMLButtonElement>('.rail-fila')].find((b) => b.querySelector('.rail-nombre')!.firstChild!.textContent === nombre)!;

const figuras = (): HTMLButtonElement[] => [...container.querySelectorAll<HTMLButtonElement>('.paleta .figura')];

it('la paleta inserta una tarea de usuario con el teclado, filtra la lista y se compacta', async () => {
  // The palette is Model's only since design 2a: in Simulate its column is the scenario rail.
  await click(T.app.modos.modelar);
  const tarea = figuras().find((b) => b.title === T.paleta.figuras.tareaUsuario);
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

  // El filtro deja solo las coincidencias, sin mayúsculas, y se lleva los grupos vacíos. Que
  // tampoco mire los acentos se prueba en `Paleta.test.ts`, donde el catálogo sí los tiene.
  const filtro = container.querySelector<HTMLInputElement>('.paleta input[type="search"]')!;
  teclear(filtro, 'annotation');
  expect(figuras().map((b) => b.title)).toEqual([T.paleta.figuras.anotacion]);
  expect([...container.querySelectorAll('.paleta summary')].map((s) => s.textContent)).toEqual([T.paleta.grupos.artefactos]);
  teclear(filtro, '');
  expect(figuras().length).toBeGreaterThan(15);

  // Modo compacto: se va el campo de filtro y los nombres, pero cada ítem conserva su tooltip.
  await act(async () => { porEtiqueta(T.paleta.modoCompacto).click(); });
  expect(container.querySelector('.paleta.compacta')).not.toBeNull();
  expect(container.querySelector('.paleta input[type="search"]')).toBeNull();
  expect(figuras().find((b) => b.title === T.paleta.figuras.tareaUsuario)).toBeDefined();
  expect(localStorage.getItem('lila.paleta')).toBe('compacta');
});

// --- Design 2a: scenario rail and resizable right panel ---

it('in Simulate the rail replaces the palette; a row picks the scenario and clears the result', async () => {
  expect(container.querySelector('.rail-escenarios')).not.toBeNull();
  expect(container.querySelector('.paleta')).toBeNull();
  expect(container.querySelector('.simulacion select')).toBeNull();
  mocks.worker.mockResolvedValue(conCuello('Task_Preparar'));
  await click(T.app.ejecutar);
  await click(T.app.modos.simular);
  expect(ultimoOverlay()[0]).not.toBeNull();
  await act(async () => { filaRail('TO-BE 3 cashiers').click(); });
  expect(filaRail('TO-BE 3 cashiers').getAttribute('aria-current')).toBe('true');
  expect(filaRail('AS-IS').hasAttribute('aria-current')).toBe(false);
  expect(ultimoOverlay()[0]).toBeNull();
  expect(container.textContent).toContain(T.app.cuellosSinCorrida);
  // Back in Model the palette returns.
  await click(T.app.modos.modelar);
  expect(container.querySelector('.paleta')).not.toBeNull();
  expect(container.querySelector('.rail-escenarios')).toBeNull();
});

it('the rail «+» twice on the same scenario numbers the copies instead of overwriting (#397)', async () => {
  await act(async () => { filaRail('AS-IS').click(); });
  await act(async () => { porEtiqueta(T.rail.nuevo).click(); });
  await act(async () => { filaRail('AS-IS').click(); });
  await act(async () => { porEtiqueta(T.rail.nuevo).click(); });
  expect(filaRail('AS-IS (copy)')).toBeDefined();
  expect(filaRail('AS-IS (copy 2)')).toBeDefined();
  expect(filaRail('AS-IS (copy 2)').getAttribute('aria-current')).toBe('true');
});

it('the divider resizes the right panel between 300 and 520 px and remembers it', async () => {
  const app = container.querySelector<HTMLElement>('.app')!;
  const divisor = container.querySelector<HTMLElement>('.divisor[role="separator"]')!;
  const ancho = () => app.style.getPropertyValue('--panel-ancho');
  const puntero = (tipo: string, clientX: number, button = 0) => act(async () => {
    divisor.dispatchEvent(new MouseEvent(tipo, { bubbles: true, clientX, button }));
  });
  expect(ancho()).toBe('320px');
  // Only the primary button drags.
  await puntero('pointerdown', 1000, 2); await puntero('pointermove', 900);
  expect(ancho()).toBe('320px');
  // Dragging left widens the panel: it grows from the right edge.
  await puntero('pointerdown', 1000); await puntero('pointermove', 900);
  expect(ancho()).toBe('420px');
  await puntero('pointermove', 100);
  expect(ancho()).toBe('520px');
  await puntero('pointermove', 1500);
  expect(ancho()).toBe('300px');
  await puntero('pointermove', 880); await puntero('pointerup', 880);
  expect(ancho()).toBe('440px');
  expect(localStorage.getItem('lila.panelAncho')).toBe('440');
  expect(container.querySelector('.panel.ancho')).not.toBeNull();
  // Moving without a pointerdown does nothing.
  await puntero('pointermove', 0);
  expect(ancho()).toBe('440px');
  // ARIA splitter convention: the arrow moves the divider, so ArrowLeft widens the panel.
  await act(async () => { divisor.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
  expect(ancho()).toBe('456px');
  expect(localStorage.getItem('lila.panelAncho')).toBe('456');
  await act(async () => { divisor.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
  expect(ancho()).toBe('440px');
  // A cancelled pointer ends the drag where the last move left it, and saves that.
  await puntero('pointerdown', 1000); await puntero('pointermove', 1040); await puntero('pointercancel', 0);
  expect(ancho()).toBe('400px');
  expect(localStorage.getItem('lila.panelAncho')).toBe('400');
  await puntero('pointermove', 0);
  expect(ancho()).toBe('400px');
});

it('the divider stays below the File menu (QA of #390)', () => {
  const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'app.css'), 'utf8');
  const zIndex = (selector: string) => Number(new RegExp(`^${selector.replace(/[.>]/g, '\\$&')} \\{[^}]*z-index: (\\d+)`, 'm').exec(css)![1]);
  expect(zIndex('.divisor')).toBeLessThan(zIndex('.menu-archivo > div'));
});

it('the panel width saved in the browser is restored, clamped', async () => {
  await act(async () => root.unmount());
  localStorage.setItem('lila.panelAncho', '9999');
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(container.querySelector<HTMLElement>('.app')!.style.getPropertyValue('--panel-ancho')).toBe('520px');
  // Blank means never saved: the 320 default, not 0 clamped to 300.
  await act(async () => root.unmount());
  localStorage.setItem('lila.panelAncho', '  ');
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(container.querySelector<HTMLElement>('.app')!.style.getPropertyValue('--panel-ancho')).toBe('320px');
});

// --- Hideable panels (#412) and the resizable left column (#406) ---

type RegionT = keyof typeof T.app.regiones;
const appEl = () => container.querySelector<HTMLElement>('.app')!;
const conClase = (clase: string) => appEl().classList.contains(clase);
const toggleDe = (r: RegionT) => container.querySelector<HTMLButtonElement>(`.vista-grupo [data-region="${r}"]`)!;
const itemVista = (r: RegionT) => container.querySelector<HTMLButtonElement>(`.menu-vista > div > [data-region="${r}"]`)!;
/** A keydown on `destino`; returns whether the app took it (`preventDefault`). */
async function pulsar(destino: EventTarget, init: KeyboardEventInit): Promise<boolean> {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  await act(async () => { destino.dispatchEvent(e); });
  return e.defaultPrevented;
}
const svgLienzo = () => container.querySelector<SVGElement>('.djs-container > svg')!;

it('each panel toggle hides its region with a class, keeps it mounted and flips aria-pressed (#412)', async () => {
  const casos: [RegionT, string, string][] = [
    ['izquierda', 'sin-izquierda', '.rail-escenarios'],
    ['derecha', 'sin-panel', 'aside.panel'],
    ['diagramas', 'sin-diagramas', 'nav.diagramas'],
    ['estado', 'sin-estado', 'footer.estado'],
  ];
  for (const [r, clase, selector] of casos) {
    const boton = toggleDe(r);
    expect(boton.getAttribute('aria-pressed')).toBe('true');
    expect(boton.getAttribute('aria-controls')).toBe(container.querySelector(selector)!.id);
    expect(itemVista(r).getAttribute('aria-pressed')).toBe('true');
    expect(itemVista(r).textContent).toContain(T.app.regiones[r]);
    await act(async () => boton.click());
    expect(conClase(clase)).toBe(true);
    expect(boton.getAttribute('aria-pressed')).toBe('false');
    expect(itemVista(r).getAttribute('aria-pressed')).toBe('false');
    // Still mounted: its state survives, only the CSS hides it.
    expect(container.querySelector(selector)).not.toBeNull();
    // The «View» menu item is the same switch.
    await act(async () => itemVista(r).click());
    expect(conClase(clase)).toBe(false);
    expect(boton.getAttribute('aria-pressed')).toBe('true');
  }
});

it('hiding the region that holds the focus hands it to the toggle (#412)', async () => {
  const fila = filaRail('AS-IS');
  await act(async () => { fila.focus(); });
  await act(async () => toggleDe('izquierda').click());
  // jsdom has no layout, so the group counts as off screen and the «View» menu gets it.
  expect(document.activeElement).toBe(container.querySelector('.menu-vista > summary'));
});

it('panel visibility is remembered per mode in lila.paneles and restored, invalid JSON shows all (#412)', async () => {
  await act(async () => toggleDe('derecha').click());
  expect(conClase('sin-panel')).toBe(true);
  await click(T.app.modos.modelar);
  expect(conClase('sin-panel')).toBe(false);
  await act(async () => toggleDe('estado').click());
  await click(T.app.modos.simular);
  expect(conClase('sin-panel')).toBe(true);
  expect(conClase('sin-estado')).toBe(false);
  const guardado = JSON.parse(localStorage.getItem('lila.paneles')!) as Record<string, Record<string, boolean>>;
  // The whole map, every mode.
  expect(Object.keys(guardado)).toEqual(['modelar', 'simular', 'resultados', 'comparar', 'animar', 'rutas']);
  expect(guardado['simular']).toEqual({ izquierda: true, derecha: false, diagramas: true, estado: true });
  expect(guardado['modelar']).toEqual({ izquierda: true, derecha: true, diagramas: true, estado: false });

  await remontar();
  expect(conClase('sin-estado')).toBe(true);
  expect(conClase('sin-panel')).toBe(false);
  await click(T.app.modos.simular);
  expect(conClase('sin-panel')).toBe(true);
  // Mounting does not write over what was saved.
  expect(JSON.parse(localStorage.getItem('lila.paneles')!)).toEqual(guardado);

  localStorage.setItem('lila.paneles', '{not json');
  await remontar();
  await click(T.app.modos.simular);
  expect([...appEl().classList].filter((c) => c.startsWith('sin-'))).toEqual([]);
});

it('with the desktop bridge the panel map and the left widths go through Ajustes, not localStorage (#406, #412)', async () => {
  const escrito: Record<string, unknown>[] = [];
  vi.stubGlobal('lila', {
    pendingOpenPath: async () => null, onOpenPath: () => () => {}, onMenu: () => () => {},
    readSettings: async () => ({ paneles: { simular: { derecha: false }, raro: { estado: false } }, paletaAncho: 300, railAncho: 9999 }),
    writeSettings: async (a: Record<string, unknown>) => { escrito.push(a); },
  });
  await remontar();
  expect(appEl().style.getPropertyValue('--paleta-ancho')).toBe('300px');
  expect(appEl().style.getPropertyValue('--rail-ancho')).toBe('320px');
  await click(T.app.modos.simular);
  expect(conClase('sin-panel')).toBe(true);
  await act(async () => toggleDe('estado').click());
  const paneles = escrito.filter((a) => 'paneles' in a).at(-1)!['paneles'] as Record<string, Record<string, boolean>>;
  // Always the full map (the bridge merges shallowly), sanitised to the known modes.
  expect(Object.keys(paneles)).toEqual(['modelar', 'simular', 'resultados', 'comparar', 'animar', 'rutas']);
  expect(paneles['simular']).toEqual({ izquierda: true, derecha: false, diagramas: true, estado: false });
  expect(localStorage.getItem('lila.paneles')).toBeNull();
});

it('Tab and Shift+Tab toggle the right panel and the left column only from the canvas (#412)', async () => {
  expect(await pulsar(svgLienzo(), { key: 'Tab' })).toBe(true);
  expect(conClase('sin-panel')).toBe(true);
  expect(await pulsar(svgLienzo(), { key: 'Tab', shiftKey: true })).toBe(true);
  expect(conClase('sin-izquierda')).toBe(true);
  await pulsar(svgLienzo(), { key: 'Tab' });
  await pulsar(svgLienzo(), { key: 'Tab', shiftKey: true });
  expect(conClase('sin-panel') || conClase('sin-izquierda')).toBe(false);

  const nada = async (destino: EventTarget, init: KeyboardEventInit = {}) => {
    expect(await pulsar(destino, { key: 'Tab', ...init })).toBe(false);
    expect(conClase('sin-panel')).toBe(false);
  };
  await nada(document.body);
  await nada(selectIdioma());
  await nada(porEtiqueta(T.app.deshacer));
  await nada(container.querySelector('.djs-direct-editing-parent')!);
  await nada(svgLienzo(), { repeat: true });
  await nada(svgLienzo(), { metaKey: true });
  await nada(svgLienzo(), { ctrlKey: true });
  await click(T.app.modos.modelar);
  await nada(container.querySelector<HTMLInputElement>('.paleta input[type="search"]')!);
  // Not while a dialog is open.
  await act(async () => porEtiqueta(T.app.ajustes).click());
  expect(container.querySelector('dialog.ajustes[open]')).not.toBeNull();
  await nada(svgLienzo());
});

it('F6 goes to the modes and Shift+F6 to the right panel or its toggle, the way out of the canvas (#412)', async () => {
  expect(await pulsar(svgLienzo(), { key: 'F6' })).toBe(true);
  expect(document.activeElement).toBe(container.querySelector('.modos .modo'));
  await pulsar(svgLienzo(), { key: 'Tab' });
  await pulsar(svgLienzo(), { key: 'F6', shiftKey: true });
  expect(document.activeElement).toBe(container.querySelector('.menu-vista > summary'));
});

it('double-click and Enter on a divider hide and show its side without saving a width (#406, #412)', async () => {
  const derecho = container.querySelector<HTMLElement>('.divisor[role="separator"]')!;
  await act(async () => { derecho.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(conClase('sin-panel')).toBe(true);
  // Hidden: arrows and drags do nothing.
  await pulsar(derecho, { key: 'ArrowLeft' });
  await act(async () => { derecho.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 1000, button: 0 })); });
  await act(async () => { derecho.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 900 })); });
  expect(appEl().style.getPropertyValue('--panel-ancho')).toBe('320px');
  await pulsar(derecho, { key: 'Enter' });
  expect(conClase('sin-panel')).toBe(false);
  expect(localStorage.getItem('lila.panelAncho')).toBeNull();

  const izquierdo = container.querySelector<HTMLElement>('.divisor-izquierdo[role="separator"]')!;
  expect(izquierdo.getAttribute('aria-label')).toBe(T.app.redimensionarIzquierda);
  await act(async () => { izquierdo.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); });
  expect(conClase('sin-izquierda')).toBe(true);
  // The divider stays, so it can bring the column back.
  expect(container.querySelector('.divisor-izquierdo')).not.toBeNull();
  await pulsar(izquierdo, { key: 'ArrowRight' });
  expect(appEl().style.getPropertyValue('--rail-ancho')).toBe('212px');
  await pulsar(izquierdo, { key: 'Enter' });
  expect(conClase('sin-izquierda')).toBe(false);
  expect(localStorage.getItem('lila.railAncho')).toBeNull();
  expect(JSON.parse(localStorage.getItem('lila.paneles')!)['simular']['izquierda']).toBe(true);
});

it('the detached scenario window hides the right panel; its toggle peeks without saving, docking restores (#412)', async () => {
  const marco = document.createElement('iframe');
  document.body.append(marco);
  const hijo = marco.contentWindow!;
  vi.spyOn(hijo, 'close').mockImplementation(() => {});
  const abrir = vi.spyOn(window, 'open').mockReturnValue(hijo);
  try {
    await act(async () => porEtiqueta(T.app.escenarioAcoplado).click());
    expect(conClase('sin-panel')).toBe(true);
    expect(toggleDe('derecha').getAttribute('aria-pressed')).toBe('false');
    await act(async () => toggleDe('derecha').click());
    expect(conClase('sin-panel')).toBe(false);
    expect(container.querySelector('aside')!.textContent).toContain(T.app.enVentanaAparte);
    expect(localStorage.getItem('lila.paneles')).toBeNull();
    await act(async () => toggleDe('derecha').click());
    expect(conClase('sin-panel')).toBe(true);
    // Model on the Properties tab: the window is not what the panel shows, so it is not hidden.
    await click(T.app.modos.modelar);
    expect(conClase('sin-panel')).toBe(true);
    await click(T.app.pestanas.propiedades);
    expect(conClase('sin-panel')).toBe(false);
    await click(T.app.pestanas.simulacion);
    expect(conClase('sin-panel')).toBe(true);

    const acoplar = [...hijo.document.querySelectorAll('button')].find((b) => b.textContent === T.app.acoplar)!;
    await act(async () => {
      acoplar.dispatchEvent(new (hijo as unknown as typeof globalThis).MouseEvent('click', { bubbles: true }));
    });
    expect(conClase('sin-panel')).toBe(false);
    expect(localStorage.getItem('lila.paneles')).toBeNull();
  } finally {
    abrir.mockRestore();
    marco.remove();
  }
});

it('a hidden status bar comes back for an error, while its toggle keeps the saved choice (#412, QA of #429)', async () => {
  await act(async () => toggleDe('estado').click());
  expect(conClase('sin-estado')).toBe(true);
  const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
  try {
    await act(async () => porEtiqueta(T.app.escenarioAcoplado).click());
    expect(conClase('sin-estado')).toBe(false);
    expect(container.querySelector('footer.estado [role="alert"]')!.textContent).toBe(T.app.ventanaBloqueada);
    // The toggle shows the preference (hidden), and says why the bar is there anyway.
    expect(toggleDe('estado').getAttribute('aria-pressed')).toBe('false');
    expect(toggleDe('estado').title).toBe(T.app.tituloEstadoForzado);
    // Pressing it is not dead: it records «shown»…
    await act(async () => toggleDe('estado').click());
    expect(toggleDe('estado').getAttribute('aria-pressed')).toBe('true');
    expect(JSON.parse(localStorage.getItem('lila.paneles')!)['simular']['estado']).toBe(true);
    // …and «hidden» again, which applies as soon as the error goes.
    await act(async () => toggleDe('estado').click());
    expect(JSON.parse(localStorage.getItem('lila.paneles')!)['simular']['estado']).toBe(false);
    expect(conClase('sin-estado')).toBe(false);
  } finally {
    abrir.mockRestore();
  }
});

it('import warnings do not pin the status bar: they are not errors (QA of #429)', async () => {
  await act(async () => toggleDe('estado').click());
  await act(async () => { mocks.publicarEstado({ zoom: 1, elementos: 3, avisos: 2, perdidas: [], refsRotas: [], error: null }); });
  expect(container.querySelector('footer.estado')!.textContent).toContain(T.app.avisosAlImportar(2));
  expect(conClase('sin-estado')).toBe(true);
  expect(toggleDe('estado').title).toBe(T.app.tituloRegiones.estado);
});

it('Escape in the View menu closes it and gives the focus back to its button (QA of #429)', async () => {
  const menu = container.querySelector<HTMLDetailsElement>('.menu-vista')!;
  expect(menu.querySelector('[role="menu"], [role="menuitemcheckbox"]')).toBeNull();
  menu.open = true;
  await act(async () => { itemVista('diagramas').focus(); });
  await pulsar(itemVista('diagramas'), { key: 'Escape' });
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(menu.querySelector('summary'));
});

it('the left divider sizes the rail in Simulate (160–320) and the palette in Model (180–360), each its own (#406)', async () => {
  const izquierdo = () => container.querySelector<HTMLElement>('.divisor-izquierdo[role="separator"]')!;
  const puntero = (tipo: string, clientX: number) => act(async () => {
    izquierdo().dispatchEvent(new MouseEvent(tipo, { bubbles: true, clientX, button: 0 }));
  });
  const ancho = (v: string) => appEl().style.getPropertyValue(v);
  // Simulate: the rail. Dragging right widens it.
  expect(izquierdo().getAttribute('aria-valuenow')).toBe('212');
  await puntero('pointerdown', 200); await puntero('pointermove', 600);
  expect(ancho('--rail-ancho')).toBe('320px');
  await puntero('pointermove', 0);
  expect(ancho('--rail-ancho')).toBe('160px');
  await puntero('pointerup', 250);
  expect(ancho('--rail-ancho')).toBe('262px');
  expect(localStorage.getItem('lila.railAncho')).toBe('262');
  await pulsar(izquierdo(), { key: 'ArrowRight' });
  expect(ancho('--rail-ancho')).toBe('278px');
  expect(localStorage.getItem('lila.railAncho')).toBe('278');
  expect(localStorage.getItem('lila.paletaAncho')).toBeNull();

  // Model: the palette.
  await click(T.app.modos.modelar);
  expect(ancho('--paleta-ancho')).toBe('236px');
  await puntero('pointerdown', 200); await puntero('pointermove', 500);
  expect(ancho('--paleta-ancho')).toBe('360px');
  await puntero('pointerup', 300);
  expect(ancho('--paleta-ancho')).toBe('336px');
  expect(localStorage.getItem('lila.paletaAncho')).toBe('336');
  expect(localStorage.getItem('lila.railAncho')).toBe('278');
  // Below 114 px it snaps to the compact palette; the width is kept for later.
  await puntero('pointerdown', 300); await puntero('pointermove', 0); await puntero('pointerup', 0);
  expect(container.querySelector('.paleta.compacta')).not.toBeNull();
  expect(localStorage.getItem('lila.paleta')).toBe('compacta');
  expect(localStorage.getItem('lila.paletaAncho')).toBe('336');
  expect(izquierdo().getAttribute('aria-valuenow')).toBe('48');
  // ArrowRight from compact lands on 180, not compact; ArrowLeft at 180 goes back to compact.
  await pulsar(izquierdo(), { key: 'ArrowRight' });
  expect(container.querySelector('.paleta.compacta')).toBeNull();
  expect(ancho('--paleta-ancho')).toBe('180px');
  expect(localStorage.getItem('lila.paleta')).toBe('normal');
  expect(localStorage.getItem('lila.paletaAncho')).toBe('180');
  await pulsar(izquierdo(), { key: 'ArrowLeft' });
  expect(container.querySelector('.paleta.compacta')).not.toBeNull();
  // Dragging out of compact leaves at max(180, x).
  await puntero('pointerdown', 100); await puntero('pointermove', 200);
  expect(container.querySelector('.paleta.compacta')).toBeNull();
  expect(ancho('--paleta-ancho')).toBe('180px');
  await puntero('pointermove', 350); await puntero('pointerup', 350);
  expect(ancho('--paleta-ancho')).toBe('298px');
  expect(localStorage.getItem('lila.paletaAncho')).toBe('298');
  // The palette's own button still toggles it, under the same key.
  await act(async () => { porEtiqueta(T.paleta.modoCompacto).click(); });
  expect(localStorage.getItem('lila.paleta')).toBe('compacta');
});

it('saved left widths are clamped, blank means never saved; no left divider without a left column (#406)', async () => {
  localStorage.setItem('lila.paletaAncho', '9999');
  localStorage.setItem('lila.railAncho', '  ');
  await remontar();
  expect(appEl().style.getPropertyValue('--paleta-ancho')).toBe('360px');
  expect(appEl().style.getPropertyValue('--rail-ancho')).toBe('212px');
  for (const modo of [T.app.modos.resultados, T.app.modos.comparar]) {
    await click(modo);
    expect(container.querySelector('.divisor-izquierdo')).toBeNull();
    expect(toggleDe('izquierda').disabled).toBe(true);
    expect(toggleDe('izquierda').getAttribute('aria-pressed')).toBe('false');
    // Nothing to toggle: Shift+Tab falls through and keeps moving the focus backwards.
    expect(await pulsar(svgLienzo(), { key: 'Tab', shiftKey: true })).toBe(false);
    expect(conClase('sin-izquierda')).toBe(false);
  }
});

// --- Pérdida al importar y al exportar (LILA-192 #214, LILA-193 #216) ---

const ESTADO_CON_PERDIDA = {
  zoom: 1, elementos: 12, avisos: 3, error: null,
  perdidas: ['unresolved reference <Flow_inexistente>'],
  refsRotas: ['Message_1373655174960', 'DS1373655174514'],
};
const dialogoPerdida = (): HTMLDialogElement | null => container.querySelector('.confirmar-perdida');
/** «Cancelar» existe también en la barra de simulación: los botones se buscan dentro del diálogo. */
function enDialogo(dialogo: HTMLDialogElement, etiqueta: string): HTMLButtonElement {
  const boton = [...dialogo.querySelectorAll('button')].find((b) => b.textContent === etiqueta);
  expect(boton, etiqueta).toBeDefined();
  return boton!;
}

it('la pérdida al importar se ve como error con los ids, y el resto sigue siendo el contador de avisos', async () => {
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });
  const pie = container.querySelector('.estado')!;
  const alerta = [...pie.querySelectorAll('[role="alert"]')].find((s) => s.classList.contains('error'))!;
  expect(alerta).toBeDefined();
  expect(alerta.textContent).toContain(T.app.perdidaAlExportar(3, ''));
  expect(alerta.textContent).toContain('Message_1373655174960');
  expect(alerta.textContent).toContain('DS1373655174514');
  expect(alerta.textContent).toContain('Flow_inexistente');
  // De los 3 avisos del import, 1 implicaba pérdida y ya se cuenta arriba: quedan 2.
  const aviso = [...pie.querySelectorAll('[role="alert"]')].find((s) => s.classList.contains('aviso'))!;
  expect(aviso.textContent).toContain(T.app.avisosAlImportar(2));
});

it('sin pérdida, exportar descarga directamente y no abre ningún diálogo', async () => {
  await click(T.app.exportarBpmn);
  expect(dialogoPerdida()).toBeNull();
  expect(session.putProcess).toHaveBeenCalledOnce();
});

it('con pérdida, exportar pide confirmación: cancelar no descarga y aceptar sí', async () => {
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });

  await click(T.app.exportarBpmn);
  const dialogo = dialogoPerdida()!;
  expect(dialogo).not.toBeNull();
  expect(dialogo.textContent).toContain(T.app.perdidaTitulo(3));
  expect([...dialogo.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
    'unresolved reference <Flow_inexistente>', 'Message_1373655174960', 'DS1373655174514',
  ]);
  expect(session.putProcess).not.toHaveBeenCalled();

  await act(async () => { [...dialogo.querySelectorAll('button')].find((b) => b.textContent === T.app.cancelar)!.click(); });
  expect(dialogoPerdida()).toBeNull();
  expect(session.putProcess).not.toHaveBeenCalled();

  await click(T.app.exportarBpmn);
  await act(async () => { [...dialogoPerdida()!.querySelectorAll('button')].find((b) => b.textContent === T.app.perdidaConfirmar(T.app.perdidaVerbo.exportar))!.click(); });
  expect(session.putProcess).toHaveBeenCalledOnce();
  expect(dialogoPerdida()).toBeNull();
});

it('sin pérdida, guardar escribe directamente y no abre ningún diálogo', async () => {
  await click(T.app.guardar);
  expect(dialogoPerdida()).toBeNull();
  expect(session.saveProject).toHaveBeenCalledOnce();
});

// QA de #258: guardar reescribe `model.bpmn` en disco, así que no puede aceptar la pérdida por
// el usuario. Pasa por el mismo diálogo que exportar, con el verbo de la acción que espera.
it('con pérdida, guardar pide la misma confirmación: cancelar no escribe nada y aceptar guarda una vez', async () => {
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });

  await click(T.app.guardar);
  const dialogo = dialogoPerdida()!;
  expect(dialogo).not.toBeNull();
  expect([...dialogo.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
    T.app.perdidaConfirmar(T.app.perdidaVerbo.guardar), T.app.cancelar,
  ]);
  expect(session.saveProject).not.toHaveBeenCalled();

  await act(async () => { enDialogo(dialogo, T.app.cancelar).click(); });
  expect(dialogoPerdida()).toBeNull();
  expect(session.saveProject).not.toHaveBeenCalled();

  // El atajo llega al mismo sitio que el botón: `guardar()` es el único camino al disco.
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true })); });
  expect(dialogoPerdida()).not.toBeNull();
  await act(async () => { enDialogo(dialogoPerdida()!, T.app.perdidaConfirmar(T.app.perdidaVerbo.guardar)).click(); });
  expect(session.saveProject).toHaveBeenCalledOnce();
  expect(dialogoPerdida()).toBeNull();
});

// QA de #258: el cierre de Electron pide guardar por `onSaveRequested` y espera un booleano. El
// diálogo se ve —la ventana sigue abierta—, y cancelar devuelve `false`, que `closeGuard` lee
// como «no se guardó» y le hace cancelar el cierre: nada se escribe y nada se queda colgado.
it.each([
  [T.app.cancelar, 'cancelled', 0],
  [T.app.perdidaConfirmar(T.app.perdidaVerbo.guardar), 'saved', 1],
] as const)('cerrar con pérdida espera el diálogo; «%s» devuelve %s al puente', async (accion, esperado, guardados) => {
  let pedirGuardado!: () => Promise<SaveOutcome>;
  await act(async () => root.unmount());
  const conCierre = { ...session, onSaveRequested: (cb: () => Promise<SaveOutcome>) => { pedirGuardado = cb; return () => {}; } } as unknown as ProjectSessionStore;
  root = createRoot(container);
  await act(async () => root.render(<App store={conCierre} />));
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });

  let resultado: SaveOutcome | 'pendiente' = 'pendiente';
  await act(async () => { void pedirGuardado().then((r) => { resultado = r; }); });
  expect(dialogoPerdida()).not.toBeNull();
  expect(resultado).toBe('pendiente');
  expect(session.saveProject).not.toHaveBeenCalled();

  await act(async () => { enDialogo(dialogoPerdida()!, accion).click(); });
  expect(resultado).toBe(esperado);
  expect(session.saveProject).toHaveBeenCalledTimes(guardados);
});

// QA de #258 (ronda 2): Escape dispara el `cancel` nativo del `<dialog>`; si no resolviera la
// espera, el cierre de Electron se quedaría 30 s colgado antes de cancelarse. Resuelve «cancelar».
it('Escape en el diálogo de pérdida resuelve la espera con «cancelar» y no escribe nada', async () => {
  let pedirGuardado!: () => Promise<SaveOutcome>;
  await act(async () => root.unmount());
  const conCierre = { ...session, onSaveRequested: (cb: () => Promise<SaveOutcome>) => { pedirGuardado = cb; return () => {}; } } as unknown as ProjectSessionStore;
  root = createRoot(container);
  await act(async () => root.render(<App store={conCierre} />));
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });

  let resultado: SaveOutcome | 'pendiente' = 'pendiente';
  await act(async () => { void pedirGuardado().then((r) => { resultado = r; }); });
  await act(async () => { dialogoPerdida()!.dispatchEvent(new Event('cancel', { cancelable: true })); });
  expect(resultado).toBe('cancelled');
  expect(dialogoPerdida()).toBeNull();
  expect(session.saveProject).not.toHaveBeenCalled();
});

// QA de #258 (ronda 2): el diálogo bloquea el ratón, pero no los atajos ni los aceleradores del
// menú nativo. Abrir o crear un proyecto mientras espera cambiaría el documento por debajo.
it('con el diálogo de pérdida abierto, Cmd+O y Cmd+N no tocan el proyecto', async () => {
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });
  await click(T.app.guardar);
  expect(dialogoPerdida()).not.toBeNull();

  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true })); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true })); });
  expect(session.openProject).not.toHaveBeenCalled();
  expect(dialogoPerdida()).not.toBeNull();

  // Contestado el diálogo, la puerta se abre otra vez.
  await act(async () => { enDialogo(dialogoPerdida()!, T.app.cancelar).click(); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true })); });
  expect(session.openProject).toHaveBeenCalledOnce();
});

// QA: con una sola referencia el texto va en singular, en el pie y en el diálogo.
it('el aviso de pérdida concuerda en singular', async () => {
  await act(async () => { mocks.publicarEstado({ zoom: 1, elementos: 4, avisos: 1, error: null, perdidas: [], refsRotas: ['Message_1'] }); });
  const pie = container.querySelector('.estado')!;
  expect(pie.textContent).toContain(T.app.perdidaAlExportar(1, 'Message_1'));
  expect(pie.textContent).toContain(T.app.avisosAlImportar(1));
  await click(T.app.exportarBpmn);
  expect(dialogoPerdida()!.querySelector('h2')!.textContent).toBe(T.app.perdidaTitulo(1));
});

it.each(['cancelled', 'failed'] as const)('close-time save distinguishes %s from a partial save', async (outcome) => {
  let requestSave!: () => Promise<SaveOutcome>;
  (session as unknown as { onSaveRequested: unknown }).onSaveRequested =
    (cb: () => Promise<SaveOutcome>) => { requestSave = cb; return () => {}; };
  await remontar();
  await act(async () => { mocks.changed(); });
  if (outcome === 'cancelled') vi.mocked(session.saveProject).mockResolvedValueOnce(null);
  else vi.mocked(session.saveProject).mockRejectedValueOnce(new Error('Disk write failed'));
  let result: SaveOutcome | undefined;
  await act(async () => { result = await requestSave(); });
  expect(result).toBe(outcome);
  expect(container.textContent).toContain(T.app.sinGuardar);
});

it('restores the saved browser project after the canvas becomes ready', async () => {
  const saved = proyecto('browser-project', 'Restored project');
  (session as unknown as { restoreSession: unknown }).restoreSession = vi.fn(() => saved);
  await remontar();
  expect(mocks.abrir).toHaveBeenCalledWith(saved.model.xml);
  expect(container.textContent).toContain('Restored project');
});

// Integration: the splash waits for the real shell's readiness callback, including StrictMode.
it('startup waits for the canvas and does not return after simulation', async () => {
  await act(async () => root.unmount());
  container.id = 'root'; container.setAttribute('inert', '');
  const splash = document.createElement('div'); splash.id = 'startup';
  splash.innerHTML = '<p id="startup-status"></p><a id="startup-reload" href=""></a>';
  document.body.append(splash); startStartup();
  mocks.retrasarLienzo = true;
  root = createRoot(container);
  try {
    await act(async () => root.render(<StrictMode><App store={session} /></StrictMode>));
    expect(document.getElementById('startup')).not.toBeNull();
    expect(container.hasAttribute('inert')).toBe(true);
    await act(async () => mocks.listo());
    expect(document.getElementById('startup')).toBeNull();
    expect(container.hasAttribute('inert')).toBe(false);
    await click(T.app.modos.simular); await click(T.app.ejecutar);
    expect(document.getElementById('startup')).toBeNull();
  } finally { finishStartup(); splash.remove(); container.removeAttribute('id'); }
});
it('an initial import error offers recovery on the startup screen', async () => {
  await act(async () => root.unmount());
  const splash = document.createElement('div'); splash.id = 'startup';
  splash.innerHTML = '<p id="startup-status"></p><a id="startup-reload" href=""></a>';
  document.body.append(splash); startStartup(); mocks.retrasarLienzo = true;
  root = createRoot(container);
  try {
    await act(async () => root.render(<App store={session} />));
    await act(async () => mocks.publicarEstado({ zoom: 1, elementos: 0, avisos: 0, error: 'broken XML', perdidas: [], refsRotas: [] }));
    expect(splash.dataset['state']).toBe('error');
    expect(splash.textContent).toContain('could not');
  } finally { finishStartup(); splash.remove(); }
});

// ---------- bienvenida de escritorio (artboard 08) ----------

/** Puente falso mínimo: `pendingOpenPath` decide si la bienvenida sale (`null`) o no (una ruta). */
function puenteBienvenida(pendiente: { dir: string; file: string } | null) {
  vi.stubGlobal('lila', {
    pendingOpenPath: async () => pendiente, onOpenPath: () => () => {}, onMenu: () => () => {},
    readSettings: async () => ({}), writeSettings: async () => {},
  });
}
it('la bienvenida sale en escritorio con los recientes, abre uno al pulsarlo y «Abrir el ejemplo» solo la cierra', async () => {
  const doc = { version: 1, id: 'p3', name: 'Click&Go', model: { id: 'Process_3', name: 'model.bpmn', xml: newModelXml(), revision: 0 }, scenarios: { 'as-is.scenario.json': {} }, scenarioRevisions: {}, runs: [] };
  puenteBienvenida(null);
  const listRecents = vi.fn().mockResolvedValue([{ dir: '/p/clickandgo.lila', name: 'Click&Go', openedAt: new Date(Date.now() - 7_200_000).toISOString() }]);
  const openRecent = vi.fn().mockResolvedValue(doc);
  Object.assign(session, { listRecents, openRecent });
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  const bienvenida = container.querySelector('.bienvenida')!;
  expect(bienvenida).not.toBeNull();
  expect(bienvenida.textContent).toContain('/p/clickandgo.lila');
  expect(bienvenida.querySelector('time')!.textContent).toBe('2 hours ago');
  expect(bienvenida.textContent).toContain(T.bienvenida.novedades('1.0.0-beta.3'));
  await act(async () => { bienvenida.querySelector<HTMLButtonElement>('.bienvenida-recientes button')!.click(); });
  expect(openRecent).toHaveBeenCalledWith('/p/clickandgo.lila', undefined);
  expect(container.querySelector('.bienvenida')).toBeNull();
  expect(container.textContent).toContain('Click&Go');

  // Sin recientes: el hueco lo dice; «Abrir el ejemplo» cierra sin tocar el store.
  listRecents.mockResolvedValue([]);
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(container.querySelector('.bienvenida')!.textContent).toContain(T.bienvenida.sinRecientes);
  await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('.bienvenida-accion')].find((b) => b.querySelector('strong')!.textContent === T.bienvenida.ejemplo)!.click(); });
  expect(container.querySelector('.bienvenida')).toBeNull();
  expect(session.openProject).not.toHaveBeenCalled();
  expect(openRecent).toHaveBeenCalledOnce();
});
it('la bienvenida no sale cuando el arranque trae un archivo que abrir (doble clic)', async () => {
  puenteBienvenida({ dir: '/p/suelto', file: 'ventas.bpmn' });
  Object.assign(session, { openRecent: vi.fn().mockResolvedValue(null) });
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(container.querySelector('.bienvenida')).toBeNull();
});


it('scopes Montana decoration to successfully applied built-in themes', async () => {
  const select = selectTema();
  const choose = async (id: string) => {
    await act(async () => { select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  const app = () => container.querySelector('.app')!;
  expect(app().hasAttribute('data-theme')).toBe(false);
  await choose('montana');
  expect(app().getAttribute('data-theme')).toBe('montana');
  vi.mocked(fetch).mockRejectedValueOnce(new Error('Unavailable theme'));
  await choose('papel');
  expect(app().getAttribute('data-theme')).toBe('montana');
  await choose('papel');
  expect(app().hasAttribute('data-theme')).toBe(false);
  await choose('montana');
  await click(T.apariencia.duplicar);
  expect(app().hasAttribute('data-theme')).toBe(false);
  expect(select.value).toMatch(/^u:/);
});

it('restores Montana decoration when the built-in theme was saved', async () => {
  localStorage.setItem('lila.tema', 'montana');
  await act(async () => { root.unmount(); });
  root = createRoot(container);
  await act(async () => { root.render(<App store={session} />); });
  expect(container.querySelector('.app')?.getAttribute('data-theme')).toBe('montana');
});

it('desacopla el escenario a una ventana propia y lo vuelve a acoplar (diseño 2c)', async () => {
  // The child is an `about:blank` iframe's window: same origin and its own document, like the popup.
  const marco = document.createElement('iframe');
  document.body.append(marco);
  const hijo = marco.contentWindow!;
  // jsdom's `close()` empties the body (its own teardown) under React's feet; a browser closes
  // asynchronously and keeps the nodes, so here it is only watched.
  const cerrar = vi.spyOn(hijo, 'close').mockImplementation(() => {});
  const abrir = vi.spyOn(window, 'open').mockReturnValue(hijo);
  try {
    await act(async () => porEtiqueta(T.app.escenarioAcoplado).click());
    expect(abrir).toHaveBeenCalledWith('', 'lila-escenario', expect.stringMatching(/popup/));
    expect(hijo.document.querySelector('[data-mock="escenario"]')).not.toBeNull();
    expect(container.querySelector('[data-mock="escenario"]')).toBeNull();
    expect(container.querySelector('aside')!.textContent).toContain(T.app.enVentanaAparte);
    expect(hijo.document.title).toBe(T.app.tituloVentanaEscenario('AS-IS'));

    const acoplar = [...hijo.document.querySelectorAll('button')].find((b) => b.textContent === T.app.acoplar);
    expect(acoplar).toBeDefined();
    await act(async () => {
      acoplar!.dispatchEvent(new (hijo as unknown as typeof globalThis).MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('[data-mock="escenario"]')).not.toBeNull();
    expect(container.textContent).not.toContain(T.app.enVentanaAparte);
    expect(cerrar).toHaveBeenCalled();
  } finally {
    abrir.mockRestore();
    marco.remove();
  }
});

it('the rail marks the detached scenario and the popup gets data-esquema (seams of #390, #391, #392)', async () => {
  const marco = document.createElement('iframe');
  document.body.append(marco);
  const hijo = marco.contentWindow!;
  vi.spyOn(hijo, 'close').mockImplementation(() => {});
  const abrir = vi.spyOn(window, 'open').mockReturnValue(hijo);
  const sub = (nombre: string): string => filaRail(nombre).querySelector('.rail-sub')!.textContent!;
  try {
    expect(sub('AS-IS')).not.toBe(T.rail.enVentana);
    await act(async () => porEtiqueta(T.app.escenarioAcoplado).click());
    // Only the scenario that lives in the window says so.
    expect(sub('AS-IS')).toBe(T.rail.enVentana);
    expect(sub('TO-BE 3 cashiers')).not.toBe(T.rail.enVentana);
    // The window follows the active scenario, and the subtitle follows the window.
    await act(async () => { filaRail('TO-BE 3 cashiers').click(); });
    expect(sub('TO-BE 3 cashiers')).toBe(T.rail.enVentana);
    expect(sub('AS-IS')).not.toBe(T.rail.enVentana);
    // Themed native controls (design 2d) key off `data-esquema`: the popup copies it like the theme.
    const esquema = container.querySelector('.app')!.getAttribute('data-esquema');
    expect(esquema).toMatch(/^(claro|oscuro)$/);
    expect(hijo.document.querySelector('.app.ventana-flotante')!.getAttribute('data-esquema')).toBe(esquema);

    const acoplar = [...hijo.document.querySelectorAll('button')].find((b) => b.textContent === T.app.acoplar);
    await act(async () => {
      acoplar!.dispatchEvent(new (hijo as unknown as typeof globalThis).MouseEvent('click', { bubbles: true }));
    });
    expect(sub('TO-BE 3 cashiers')).not.toBe(T.rail.enVentana);
    expect(container.querySelector('.rail-escenarios')!.textContent).not.toContain(T.rail.enVentana);
  } finally {
    abrir.mockRestore();
    marco.remove();
  }
});

it('si el navegador bloquea la ventana, el escenario se queda acoplado y lo dice (diseño 2c)', async () => {
  const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
  try {
    await act(async () => porEtiqueta(T.app.escenarioAcoplado).click());
    expect(container.textContent).toContain(T.app.ventanaBloqueada);
    expect(container.querySelector('[data-mock="escenario"]')).not.toBeNull();
    expect(container.textContent).not.toContain(T.app.enVentanaAparte);
  } finally {
    abrir.mockRestore();
  }
});

it('desde la ventana desacoplada solo llegan Guardar y Guardar como, no Abrir ni Ajustes (QA de #391)', async () => {
  const marco = document.createElement('iframe');
  document.body.append(marco);
  const hijo = marco.contentWindow!;
  vi.spyOn(hijo, 'close').mockImplementation(() => {});
  const abrir = vi.spyOn(window, 'open').mockReturnValue(hijo);
  const tecla = (key: string) => act(async () => {
    hijo.dispatchEvent(new (hijo as unknown as typeof globalThis).KeyboardEvent('keydown', { key, metaKey: true, cancelable: true }));
  });
  try {
    await act(async () => porEtiqueta(T.app.escenarioAcoplado).click());
    // Open would click the main page's file input with the popup's activation: the browser never
    // settles it and the app stays busy. Settings would open behind the window.
    await tecla('o');
    await tecla('n');
    await tecla(',');
    expect(session.openProject).not.toHaveBeenCalled();
    expect(session.createProject).not.toHaveBeenCalled();
    expect(container.querySelector('dialog.confirmar-reemplazo')).toBeNull();
    expect(container.querySelector<HTMLDialogElement>('dialog.ajustes')!.open).toBe(false);
    await tecla('s');
    expect(session.saveProject).toHaveBeenCalledOnce();
  } finally {
    abrir.mockRestore();
    marco.remove();
  }
});

// QA de la ronda 1 de #392: `#fff` no casaba con la expresión de 6 dígitos que lee
// `temaClaro` y el tema se daba por oscuro sin serlo. Un `it.each` corto en vez de una función
// por caso: mismo assert, solo cambia el hex y lo que se espera.
it.each([
  ['#fff', true],
  ['#FFFFFF', true],
  ['#000', false],
  // Los siete temas integrados (`theme/themes/*.json`): Papel, Tieso, Montana y Lila Light son
  // claros; Eva-01, Akira y Lila Dark, oscuros.
  ['#12101A', false], // eva-01
  ['#F3F2F2', true], // papel
  ['#EEF3F8', true], // tieso
  ['#0B0A14', false], // akira
  ['#EBC7FA', true], // montana
  ['#FAF8EE', true], // lila-light
  ['#1C0F2E', false], // lila-dark
] as const)('temaClaro(%s) es %s', (bgBase, claro) => {
  expect(temaClaro({ name: 't', tokens: { 'bg.base': bgBase } })).toBe(claro);
});
