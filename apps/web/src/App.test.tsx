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
vi.mock('./ScenarioPanel', () => ({ problemasEscenario: () => mocks.problemas,
  ScenarioPanel: ({ onCambio }: { onCambio: (file: string, raw: object) => void }) => {
    mocks.scenarioChange = () => onCambio('as-is.scenario.json', {});
    return null;
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
  return <div>Modelo montado</div>;
} }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let session: ProjectSessionStore;
let container: HTMLDivElement;
// `nodes` es lo que el panel lee para nombrar el cuello principal (#226): una tarea con nombre
// y otra sin él, que son los dos caminos de `nombreDeCuello`.
const ir = { id: 'Process_1', nodes: { Task_Preparar: { name: 'Preparar alimento' }, Task_Anonima: { name: '' } }, source: { originalIds: {} } };
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
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ name: 'test', tokens: {} }) }));
  mocks.gate.mockResolvedValue({ ir, scenario, warnings: ['W-FRONTERA'] });
  mocks.abrir.mockResolvedValue(true);
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

// #226 punto 4: el panel enseñaba `corrida.result.bottlenecks[0].elementId` en crudo.
it.each([['Task_Preparar', 'Preparar alimento (Task_Preparar)'], ['Task_Anonima', 'Task_Anonima']])(
  'el panel nombra el cuello principal %s',
  async (elementId, texto) => {
    mocks.worker.mockResolvedValue(conCuello(elementId));
    await click('Ejecutar simulación');
    expect(container.textContent).toContain(texto);
  },
);

// #226 punto 6: el interruptor «Cuellos de botella» no tenía prueba.
it('el interruptor «Cuellos de botella» limpia el overlay y lo vuelve a pintar', async () => {
  mocks.worker.mockResolvedValue(conCuello('Task_Preparar'));
  await click('Ejecutar simulación');
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
  mocks.worker.mockResolvedValue(conCuello('Task_Preparar'));
  await click('Ejecutar simulación');
  const pintadas = mocks.cuellos.mock.calls.length;

  const xml = newModelXml(); const parsed = await parseBpmn(xml);
  const doc: ProjectDocument = { version: 1, id: 'otro', name: 'Otra carpeta', model: { id: parsed.ir.id, name: 'roto.bpmn', xml, revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [] };
  vi.mocked(session.openProject).mockResolvedValueOnce(doc);
  mocks.abrir.mockResolvedValueOnce(false);
  // Simular deja el proyecto sin guardar: abrir pasa antes por la guardia de cambios.
  await click('Abrir'); await click('Descartar');

  expect(mocks.abrir).toHaveBeenCalledOnce();
  expect(container.textContent).toContain('Pedido de ejemplo');
  expect(container.textContent).toContain('Preparar alimento (Task_Preparar)');
  // Ni una sola limpieza del overlay: nadie llamó `cuellos(null, …)` ni apagó el interruptor.
  expect(mocks.cuellos.mock.calls.slice(pintadas).filter((c) => c[0] === null || c[1] === false)).toEqual([]);
  expect(container.querySelector<HTMLInputElement>('.campo.interruptor input')!.checked).toBe(true);
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

it('cambiar de tema aplica el JSON nuevo, lo recuerda y repinta SIN remontar el lienzo (LILA-113)', async () => {
  const papel = { name: 'Papel', tokens: { 'bg.base': '#F4F1EC' } };
  const montajesAntes = mocks.montajes;
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => papel } as Response);
  const select = container.querySelector<HTMLSelectElement>('dialog.ajustes select')!;
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
  const select = container.querySelector<HTMLSelectElement>('dialog.ajustes select')!;
  await act(async () => { select.value = 'papel'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  // `applyTheme` es un mock aquí: lo que se mide es que el token que el tema nuevo NO trae ya no
  // está en línea, que es justo lo que lo devuelve al `:root` de `tokens.css` (Eva-01).
  expect(raiz.style.getPropertyValue('--bg-base')).toBe('');
  raiz.style.removeProperty('--accent-primary');
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
  vi.stubGlobal('lila', {
    pendingOpenPath: async () => null, onOpenPath: () => () => {}, onMenu: () => () => {},
    readSettings: async () => ({ tema: 'papel', densidad: 'comoda' }),
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
  const select = container.querySelector<HTMLSelectElement>('dialog.ajustes select')!;
  await act(async () => { select.value = 'eva-01'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(escrito).toContainEqual({ tema: 'eva-01' });
  expect(localStorage.getItem('lila.tema')).toBe('centinela');
});
it('un puente sin readSettings (preload viejo) arranca igual, con lienzo (QA #275)', async () => {
  // `preferencias()` no puede rechazar: el efecto que la llama no recoge el rechazo, así que la app
  // se quedaría con `tema === undefined` para siempre, o sea sin lienzo.
  vi.stubGlobal('lila', { pendingOpenPath: async () => null, onOpenPath: () => () => {}, onMenu: () => () => {} });
  const montajesAntes = mocks.montajes;
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(fetch).toHaveBeenLastCalledWith('./eva-01.json');
  expect(mocks.montajes).toBe(montajesAntes + 1);
});
it('un valor guardado que ya no existe cae al de fábrica sin pedirlo por fetch (LILA-113)', async () => {
  localStorage.setItem('lila.tema', 'tema-borrado'); localStorage.setItem('lila.densidad', 'gigante');
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(<App store={session} />));
  expect(fetch).toHaveBeenLastCalledWith('./eva-01.json');
  expect(container.querySelector('.app')?.getAttribute('data-densidad')).toBe('normal');
});
/** Un tema del usuario tal y como lo deja Apariencia (LILA-114). */
const temaMio = { id: 'u:1', tema: { name: 'Mío', tokens: { 'accent.primary': '#123456' } }, origen: { 'accent.primary': '#9EF01A' } };
/** El campo hex de un token dentro del diálogo de Ajustes. */
const hexDe = (token: string) => container.querySelector<HTMLInputElement>(`dialog.ajustes input[aria-label="Hex de ${token}"]`)!;

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
  expect(container.querySelector<HTMLSelectElement>('dialog.ajustes select')!.value).toBe('u:1');
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
function puenteConRutas(pendiente: { dir: string; file: string } | null) {
  const quitar = vi.fn();
  let emitir: ((ruta: { dir: string; file: string }) => void) | null = null;
  let menu: ((a: unknown) => void) | null = null;
  vi.stubGlobal('lila', {
    pendingOpenPath: vi.fn().mockResolvedValue(pendiente),
    onOpenPath: (cb: (ruta: { dir: string; file: string }) => void) => { emitir = cb; return quitar; },
    onMenu: (cb: (a: unknown) => void) => { menu = cb; return () => {}; },
    readSettings: async () => ({}),
    writeSettings: async () => {},
  });
  return {
    quitar,
    emitir: (ruta: { dir: string; file: string }) => emitir!(ruta),
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
  expect(pie.textContent).toContain('0 errores'); // sin AS-IS por defecto sería «escenario desconocido».
  expect(pie.textContent).toContain('AS-IS');
});

it('un diagrama suelto lo advierte en el pie, y «Guardar como» deja de advertirlo (LILA-072)', async () => {
  const suelto = { ...proyecto('p12', 'Suelto'), scenarios: {}, loose: true };
  (session as unknown as { openRecent: unknown }).openRecent = vi.fn().mockResolvedValue(suelto);
  const puente = puenteConRutas({ dir: '/p/descargas', file: 'ventas.bpmn' });
  await remontar();
  const pie = container.querySelector('.estado')!;
  expect(pie.textContent).toContain('Diagrama suelto');
  // El aviso nombra las dos cosas que un ⌘S en modo suelto NO escribe (LILA-208, aceptación 2).
  expect(pie.textContent).toContain('los escenarios y las corridas no se guardan');
  expect(pie.textContent).toContain('Guardar como');

  await act(async () => { puente.menu('guardarComo'); });
  expect(session.saveProject).toHaveBeenCalledWith(expect.anything(), { saveAs: true });
  expect(pie.textContent).not.toContain('Diagrama suelto');
});

it.each([
  ['escenario editado', 'escenario', 'Sin guardar'],
  ['solo el XML editado', 'modelo', 'Guardado'],
] as const)('diagrama suelto, %s: guardar solo limpia el indicador de lo escrito (LILA-208)', async (_caso, que, esperado) => {
  // Un guardado normal en modo suelto escribe SOLO el `.bpmn`: el escenario editado sigue sin
  // estar en disco, así que el indicador NO puede quedarse en «Guardado» (y la guardia de cierre
  // sale del mismo token).
  const suelto = { ...proyecto('p13', 'Suelto'), loose: true };
  (session as unknown as { openRecent: unknown }).openRecent = vi.fn().mockResolvedValue(suelto);
  let pedirGuardado!: () => Promise<boolean>;
  (session as unknown as { onSaveRequested: unknown }).onSaveRequested =
    (cb: () => Promise<boolean>) => { pedirGuardado = cb; return () => {}; };
  const puente = puenteConRutas({ dir: '/p/descargas', file: 'ventas.bpmn' });
  await remontar();
  expect(container.textContent).toContain('Guardado');

  // El `onCambio` del panel de escenario solo existe con su pestaña montada.
  await click('Simulación');
  await act(async () => { if (que === 'modelo') mocks.changed(); else mocks.scenarioChange(); });
  expect(container.textContent).toContain('Sin guardar');
  await act(async () => { puente.menu('guardar'); });
  expect(session.saveProject).toHaveBeenCalledWith(expect.anything(), { saveAs: false });
  expect(container.textContent).toContain(esperado);
  expect(session.setDirty).toHaveBeenLastCalledWith(esperado === 'Sin guardar');

  // La guardia de cierre (`onSaveRequested` → `closeGuard`) sale del MISMO token: con el escenario
  // todavía sin escribir, «Guardar» en el diálogo nativo devuelve `false` y la ventana no se
  // cierra, en vez de irse llevándose el escenario editado (QA de LILA-208).
  let cerrar: boolean | null = null;
  await act(async () => { cerrar = await pedirGuardado(); });
  expect(cerrar).toBe(esperado === 'Guardado');
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
  expect(container.textContent).toContain('No se abrió "ventas.bpmn"');
  await act(async () => { guardado.resolve(null); });
});

it('una ruta que llega con el diálogo de cambios sin guardar abierto no pisa la acción pendiente', async () => {
  (session as unknown as { openRecent: unknown }).openRecent = vi.fn().mockResolvedValue(proyecto('p11', 'Nunca'));
  const puente = puenteConRutas(null);
  await remontar();
  await act(async () => mocks.changed());
  await click('Nuevo'); // deja `pendingAction = 'new'` con el diálogo abierto.
  await act(async () => { puente.emitir({ dir: '/p/cinco', file: 'ventas.bpmn' }); });
  expect(container.textContent).toContain('No se abrió "ventas.bpmn"');
  // «Descartar» sigue haciendo lo que el usuario pidió (Nuevo), no la ruta que llegó en medio.
  await click('Descartar');
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

// --- «Validar rutas» (LILA-065) ---

it('«Validar rutas» aparece junto a los demás modos y avisa de que no es la simulación DES', async () => {
  const modos = [...container.querySelectorAll('.modos .modo')].map((b) => b.textContent);
  expect(modos).toEqual(['Modelar', 'Simular', 'Resultados', 'Comparar', 'Validar rutas']);
  await click('Validar rutas');
  expect(container.textContent).toContain(
    'Animación de tokens de bpmn-js: no es simulación de eventos discretos; no usa el escenario ni produce resultados.',
  );
});

it('entrar en «Validar rutas» activa la animación de tokens y salir la desactiva', async () => {
  await click('Validar rutas');
  expect(mocks.simulacionTokens).toHaveBeenLastCalledWith(true);
  await click('Modelar');
  expect(mocks.simulacionTokens).toHaveBeenLastCalledWith(false);
});

it('cambiar de tema con «Validar rutas» encendido reinicia el modo (QA #275)', async () => {
  // Los colores neutros del modo se escriben en el DI y el DI gana a lo que repinte `repintar()`:
  // sin apagar y volver a encender, el diagrama se queda con el relleno del tema anterior y la
  // etiqueta con el color del nuevo (medido: `#1F1A36` bajo texto `#201E1D`, contraste 1,0:1).
  await click('Validar rutas');
  mocks.simulacionTokens.mockClear();
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ name: 'Papel', tokens: {} }) } as Response);
  const select = container.querySelector<HTMLSelectElement>('dialog.ajustes select')!;
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
  await click('Validar rutas');
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
  await click('Validar rutas');
  expect(mocks.validacion).toHaveBeenLastCalledWith(null);
  expect(mocks.cuellos).toHaveBeenLastCalledWith(null, false);
  await click('Modelar');
  expect(mocks.validacion).toHaveBeenLastCalledWith(expect.objectContaining({ marcadores: expect.anything() }));
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

it('sin pérdida, guardar escribe directamente y no abre ningún diálogo', async () => {
  await click('Guardar');
  expect(dialogoPerdida()).toBeNull();
  expect(session.saveProject).toHaveBeenCalledOnce();
});

// QA de #258: guardar reescribe `model.bpmn` en disco, así que no puede aceptar la pérdida por
// el usuario. Pasa por el mismo diálogo que exportar, con el verbo de la acción que espera.
it('con pérdida, guardar pide la misma confirmación: cancelar no escribe nada y aceptar guarda una vez', async () => {
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });

  await click('Guardar');
  const dialogo = dialogoPerdida()!;
  expect(dialogo).not.toBeNull();
  expect([...dialogo.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Guardar igualmente', 'Cancelar']);
  expect(session.saveProject).not.toHaveBeenCalled();

  await act(async () => { enDialogo(dialogo, 'Cancelar').click(); });
  expect(dialogoPerdida()).toBeNull();
  expect(session.saveProject).not.toHaveBeenCalled();

  // El atajo llega al mismo sitio que el botón: `guardar()` es el único camino al disco.
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true })); });
  expect(dialogoPerdida()).not.toBeNull();
  await act(async () => { enDialogo(dialogoPerdida()!, 'Guardar igualmente').click(); });
  expect(session.saveProject).toHaveBeenCalledOnce();
  expect(dialogoPerdida()).toBeNull();
});

// QA de #258: el cierre de Electron pide guardar por `onSaveRequested` y espera un booleano. El
// diálogo se ve —la ventana sigue abierta—, y cancelar devuelve `false`, que `closeGuard` lee
// como «no se guardó» y le hace cancelar el cierre: nada se escribe y nada se queda colgado.
it.each([
  ['Cancelar', false, 0],
  ['Guardar igualmente', true, 1],
] as const)('cerrar con pérdida espera el diálogo; «%s» devuelve %s al puente', async (accion, esperado, guardados) => {
  let pedirGuardado!: () => Promise<boolean>;
  await act(async () => root.unmount());
  const conCierre = { ...session, onSaveRequested: (cb: () => Promise<boolean>) => { pedirGuardado = cb; return () => {}; } } as unknown as ProjectSessionStore;
  root = createRoot(container);
  await act(async () => root.render(<App store={conCierre} />));
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });

  let resultado: boolean | 'pendiente' = 'pendiente';
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
  let pedirGuardado!: () => Promise<boolean>;
  await act(async () => root.unmount());
  const conCierre = { ...session, onSaveRequested: (cb: () => Promise<boolean>) => { pedirGuardado = cb; return () => {}; } } as unknown as ProjectSessionStore;
  root = createRoot(container);
  await act(async () => root.render(<App store={conCierre} />));
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });

  let resultado: boolean | 'pendiente' = 'pendiente';
  await act(async () => { void pedirGuardado().then((r) => { resultado = r; }); });
  await act(async () => { dialogoPerdida()!.dispatchEvent(new Event('cancel', { cancelable: true })); });
  expect(resultado).toBe(false);
  expect(dialogoPerdida()).toBeNull();
  expect(session.saveProject).not.toHaveBeenCalled();
});

// QA de #258 (ronda 2): el diálogo bloquea el ratón, pero no los atajos ni los aceleradores del
// menú nativo. Abrir o crear un proyecto mientras espera cambiaría el documento por debajo.
it('con el diálogo de pérdida abierto, Cmd+O y Cmd+N no tocan el proyecto', async () => {
  await act(async () => { mocks.publicarEstado(ESTADO_CON_PERDIDA); });
  await click('Guardar');
  expect(dialogoPerdida()).not.toBeNull();

  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true })); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true })); });
  expect(session.openProject).not.toHaveBeenCalled();
  expect(dialogoPerdida()).not.toBeNull();

  // Contestado el diálogo, la puerta se abre otra vez.
  await act(async () => { enDialogo(dialogoPerdida()!, 'Cancelar').click(); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', metaKey: true })); });
  expect(session.openProject).toHaveBeenCalledOnce();
});

// QA: con una sola referencia el texto va en singular, en el pie y en el diálogo.
it('el aviso de pérdida concuerda en singular', async () => {
  await act(async () => { mocks.publicarEstado({ zoom: 1, elementos: 4, avisos: 1, error: null, perdidas: [], refsRotas: ['Message_1'] }); });
  const pie = container.querySelector('.estado')!;
  expect(pie.textContent).toContain('1 elemento o referencia se perderá al exportar: Message_1');
  expect(pie.textContent).toContain('1 aviso al importar');
  await click('Exportar .bpmn');
  expect(dialogoPerdida()!.querySelector('h2')!.textContent).toBe('Se perderá 1 referencia que el archivo original ya tenía rota');
});
