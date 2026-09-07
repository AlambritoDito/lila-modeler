/**
 * Shell de la app web (LILA-057): barra superior con los modos, paleta de bpmn-js a la
 * izquierda, lienzo al centro, panel derecho con pestañas y barra de estado abajo. La
 * disposición es la del brief `prompts/claude-design-ui.md`; los colores salen todos de los
 * tokens de LILA-112, sin un solo hex aquí.
 *
 * Los literales van escritos donde se usan: `strings.es.ts` es LILA-066 y sacarlos ahora solo
 * movería el problema de sitio.
 */
import { useEffect, useRef, useState } from 'react';
import { parseBpmn } from '@lila/engine/bpmn';
import { type ResolvedScenario } from '@lila/engine/schema';
import { compare } from '@lila/engine';
import { CompareView } from './CompareView';
import { runMetaFrom } from './compareWarnings';
import { changeToken, defaultScenarios, newModelXml, nextScenarioRevisions, projectStore, readProject } from './project';
import type { ProcessIR, SimulationProgress } from '@lila/engine';
import { Lienzo, type EstadoLienzo, type Modelador } from './Modeler';
import { PanelPropiedades } from './PropertiesPanel';
import { ScenarioPanel } from './ScenarioPanel';
import { ResultsView } from './ResultsView';
import { prepareSimulation } from './simulationGate';
import type { ProjectDocument, StoredRun } from './store/ProjectStore';
import type { MenuAction } from '../../desktop/src/bridge.js';
import type { Corrida } from './BottleneckOverlay';
import { runInWorker } from './simulationClient';
import { applyTheme, type Theme } from './theme/applyTheme';
// Único punto de la SPA que conoce la implementación concreta (LILA-058, ADR-023): el resto
// del shell habla con `store` solo por el tipo `ProjectStore`. Cambiar de modalidad —
// `DesktopStore` (LILA-071), `RemoteStore` (LILA-086)— es cambiar esta línea.
import type { ProjectStore } from './store/ProjectStore';
// El benchmark se compila dentro del bundle: es el único archivo que la app trae de serie, y
// así no hay que copiarlo a `public/` ni abrir `examples/` con `server.fs.allow`.
import pedido from '../../../examples/pedido/model.bpmn?raw';
// Los dos escenarios del benchmark viajan en el bundle por la misma razón que el modelo: son lo
// único que la app trae de serie, y con ellos «cambiar de escenario» ya es una acción real de la
// UI (aceptación de LILA-064). Abrir escenarios propios es LILA-061.
import asIsJson from '../../../examples/pedido/as-is.scenario.json';
import toBeJson from '../../../examples/pedido/to-be-3-cajeros.scenario.json';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';
import './theme/tokens.css';
import './app.css';

type ProjectAction = 'new' | 'open' | 'bpmn' | { readonly recent: string };

const MODOS = ['Modelar', 'Simular', 'Resultados', 'Comparar'] as const;
const PESTANAS = ['Propiedades', 'Documentación', 'Simulación'] as const;

/** Temas integrados, servidos como JSON estáticos (`vite.config.ts`): editar y recargar cambia la UI. */
const TEMAS = { 'eva-01': 'Eva-01', papel: 'Papel' } as const;
type TemaId = keyof typeof TEMAS;
const TEMA_IDS = Object.keys(TEMAS) as TemaId[];
const DENSIDADES = ['compacta', 'normal', 'comoda'] as const;
type Densidad = (typeof DENSIDADES)[number];

/** Preferencias de apariencia. localStorage vale igual en el navegador y bajo `lila://` en Electron. */
function preferencia<T extends string>(clave: string, validas: readonly T[], porDefecto: T): T {
  try {
    const v = localStorage.getItem(clave);
    return validas.includes(v as T) ? (v as T) : porDefecto;
  } catch { return porDefecto; }
}
function recordar(clave: string, valor: string): void {
  try { localStorage.setItem(clave, valor); } catch { /* sin almacenamiento (modo privado): no persiste, no rompe */ }
}
async function cargarTema(id: TemaId): Promise<Theme> {
  const r = await fetch(`./${id}.json`);
  if (!r.ok) throw new Error(`el servidor respondió ${r.status}`);
  return r.json() as Promise<Theme>;
}

/**
 * Texto de atajo para los tooltips: `⌘S` en Mac, `Ctrl+S` en el resto. En el navegador solo se
 * anuncian los que la página llega a ver: Chrome y Safari se quedan `⌘N` (ventana nueva) y `⌘,`
 * (preferencias) antes de entregarlos, así que ahí solo valen dentro de Electron, donde son
 * aceleradores del menú nativo.
 */
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const DESKTOP = typeof window !== 'undefined' && typeof window.lila !== 'undefined';
function atajo(tecla: string, soloDesktop = false): string {
  if (soloDesktop && !DESKTOP) return '';
  const shift = tecla.startsWith('⇧');
  const letra = shift ? tecla.slice(1) : tecla;
  return MAC ? ` (${shift ? '⇧' : ''}⌘${letra})` : ` (Ctrl+${shift ? 'Shift+' : ''}${letra})`;
}

/** Id del benchmark que trae la app de serie; cualquier otro se elige al vuelo (ver `abrir`). */
const PROCESO_INICIAL = 'pedido';

/** Escenarios de la sesión, por nombre de archivo (el que resuelve `extends`). */
type Escenarios = Readonly<Record<string, Record<string, unknown>>>;

/** Los dos del benchmark; el panel de escenario (LILA-061) añade copias a este mismo mapa. */
const ESCENARIOS_INICIALES: Escenarios = {
  'as-is.scenario.json': asIsJson as Record<string, unknown>,
  'to-be-3-cajeros.scenario.json': toBeJson as Record<string, unknown>,
};

/** Etiqueta del selector: el `name` del escenario, que es lo que también imprime la CLI. */
function etiquetaEscenario(archivo: string, escenarios: Escenarios): string {
  const nombre = escenarios[archivo]?.['name'];
  return typeof nombre === 'string' ? nombre : archivo;
}

/** Fase de la simulación, para lo que enseña el panel derecho. */
type EstadoSim =
  | { tipo: 'inactivo' }
  | { tipo: 'simulando'; progreso: SimulationProgress | null }
  | { tipo: 'error'; mensaje: string };

export function App({ store, bpmnFilesEnabled = true }: { store: ProjectStore; bpmnFilesEnabled?: boolean }): React.JSX.Element {
  const [modelador, setModelador] = useState<Modelador | null>(null);
  const [estado, setEstado] = useState<EstadoLienzo>({
    zoom: 1,
    elementos: 0,
    avisos: 0,
    error: null,
  });
  const [procesoId, setProcesoId] = useState(PROCESO_INICIAL);
  const [projectId, setProjectId] = useState('demo-pedido');
  const [projectName, setProjectName] = useState('Pedido de ejemplo');
  const [savedToken, setSavedToken] = useState(changeToken('demo-pedido', 0, {}, []));
  const [projectProblems, setProjectProblems] = useState<NonNullable<ProjectDocument['problems']>>([]);
  const [ioError, setIoError] = useState<string | null>(null);
  const [ioBusy, setIoBusy] = useState(false);
  const ioLock = useRef(false);
  const [pendingAction, setPendingAction] = useState<ProjectAction | null>(null);
  const replaceDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (pendingAction !== null && !replaceDialog.current?.open) replaceDialog.current?.showModal();
  }, [pendingAction]);
  const [baseId, setBaseId] = useState('as-is.scenario.json');
  const adapter = projectStore(store);
  const [modo, setModo] = useState<(typeof MODOS)[number]>('Modelar');
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [scenarioRevisions, setScenarioRevisions] = useState<Record<string, number>>({});
  const [archivo, setArchivo] = useState('model.bpmn');
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]>('Propiedades');
  // El lienzo no se monta hasta que el tema está resuelto: bpmn-js lee los colores de las
  // figuras de los tokens al montar (ver Modeler.tsx). `tema === undefined` es "todavía no se
  // sabe"; `null`, "no se pudo cargar, seguimos con los valores por defecto de tokens.css".
  const [tema, setTema] = useState<Theme | null | undefined>(undefined);
  const [avisoTema, setAvisoTema] = useState<string | null>(null);
  const [temaId, setTemaId] = useState<TemaId>(() => preferencia('lila.tema', TEMA_IDS, 'eva-01'));
  const [densidad, setDensidad] = useState<Densidad>(() => preferencia('lila.densidad', DENSIDADES, 'normal'));
  // XML con el que se monta el lienzo. Cambia solo al cambiar de tema: bpmn-js congela los colores
  // de las figuras al montar (`Modeler.tsx`), así que un tema nuevo es un lienzo nuevo con el
  // diagrama de ahora. ponytail: remontar pierde la pila de deshacer; hacer reactivo bpmnRenderer si molesta.
  const [xmlLienzo, setXmlLienzo] = useState(pedido);
  const ajustesDialog = useRef<HTMLDialogElement>(null);
  const [escenarioId, setEscenarioId] = useState('as-is.scenario.json');
  // Los escenarios se editan en el panel (LILA-061), así que dejan de ser una constante de
  // módulo: el mapa entero es estado, y `simular()` corre siempre lo que el panel tiene ahora.
  const [escenarios, setEscenarios] = useState<Escenarios>(ESCENARIOS_INICIALES);
  // IR del diagrama del lienzo, para que el panel valide con `validateScenario` (reglas R3…R14)
  // y no solo con el esquema. `null` mientras no se haya podido parsear.
  const [ir, setIr] = useState<ProcessIR | null>(null);
  const [seleccion, setSeleccion] = useState<string | null>(null);
  // La última corrida y el interruptor son todo el estado del overlay (LILA-064). Poner
  // `corrida` a `null` es lo que "apaga" el overlay al cambiar de escenario o de modelo: no hay
  // una segunda ruta de limpieza que se pueda olvidar de correr.
  const [corrida, setCorrida] = useState<Corrida | null>(null);
  const [verCuellos, setVerCuellos] = useState(true);
  const [sim, setSim] = useState<EstadoSim>({ tipo: 'inactivo' });
  // Corrida en vuelo. `runInWorker` traduce `abort()` a `worker.terminate()` (LILA-059), que es
  // la única forma real de pararla: `simulate` es síncrono y el worker no lee su cola mientras
  // corre. Sin esto, cambiar de escenario a mitad de una corrida deja el worker vivo y su
  // resultado llega tarde y pinta el overlay del escenario **anterior** sobre el selector nuevo
  // — justo lo contrario de la aceptación de LILA-064, y verificado en navegador.
  const enVuelo = useRef<AbortController | null>(null);

  const currentToken = changeToken(projectId, revision, scenarioRevisions, runs.map((r) => r.id));
  const dirty = currentToken !== savedToken;
  const tokenRef = useRef(currentToken);
  tokenRef.current = currentToken;
  const latest = Object.keys(escenarios).flatMap((name) => {
    const run = [...runs].reverse().find((r) => r.scenarioName === name && r.inputs.modelRevision === revision
      && r.inputs.scenarioRevision === (scenarioRevisions[name] ?? 0));
    return run ? [run] : [];
  });
  const ordered = [...latest].sort((a, b) => Number(b.scenarioName === baseId) - Number(a.scenarioName === baseId));
  const comparable = ordered.length >= 2 && ordered.some((r) => r.scenarioName === baseId);

  useEffect(() => {
    const run = [...runs].reverse().find((r) => r.scenarioName === escenarioId && r.inputs.modelRevision === revision
      && r.inputs.scenarioRevision === (scenarioRevisions[escenarioId] ?? 0));
    setCorrida(run && ir ? { result: run.result, scenario: run.inputs.scenario as unknown as ResolvedScenario, originalIds: ir.source.originalIds } : null);
  }, [runs, escenarioId, revision, scenarioRevisions, ir]);

  useEffect(() => { adapter?.setDirty?.(dirty); }, [adapter, dirty]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    // Electron main coordina la confirmación nativa por el adaptador.
    if (!adapter?.onSaveRequested) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [adapter, dirty]);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  saveRef.current = () => guardar();
  useEffect(() => adapter?.onSaveRequested?.(() => saveRef.current()), [adapter]);

  async function snapshot(): Promise<ProjectDocument> {
    if (modelador === null) throw new Error('El modelador todavía no está listo.');
    const atRevision = revisionRef.current;
    const xml = await modelador.exportar({ interactivo: true });
    if (atRevision !== revisionRef.current) throw new Error('El modelo cambió durante el guardado. Vuelve a guardar la revisión actual.');
    const parsed = await parseBpmn(xml);
    return { version: 1, id: projectId, name: projectName,
      model: { id: parsed.ir.id, name: archivo, xml, revision: atRevision },
      scenarios: escenarios, scenarioRevisions, runs, ...(projectProblems.length ? { problems: projectProblems } : {}) };
  }
  async function guardar(saveAs = false): Promise<boolean> {
    if (adapter === null || ioLock.current) return false;
    ioLock.current = true; setIoBusy(true); setIoError(null);
    try {
      const doc = await snapshot();
      const token = changeToken(doc.id, doc.model.revision, doc.scenarioRevisions, doc.runs.map((r) => r.id));
      const saved = await adapter.saveProject(doc, { saveAs });
      if (saved === null) return false;
      setSavedToken(token);
      // B puede cerrar antes del siguiente efecto de React; publicar el dirty confirmado.
      const unchanged = token === tokenRef.current && doc.model.revision === revisionRef.current;
      adapter.setDirty?.(!unchanged);
      return unchanged;
    } catch (e) { setIoError(e instanceof Error ? e.message : String(e)); return false; }
    finally { ioLock.current = false; setIoBusy(false); }
  }
  async function activate(raw: ProjectDocument, saved: boolean, expectedToken: string): Promise<boolean> {
    if (modelador === null) return false;
    const doc = readProject(raw);
    const parsed = await parseBpmn(doc.model.xml);
    if (expectedToken !== tokenRef.current) throw new Error('El proyecto cambió mientras se abría el archivo. Conservamos tus cambios; vuelve a abrirlo.');
    cancelarCorrida();
    if (!await modelador.abrir(doc.model.xml)) return false;
    revisionRef.current = doc.model.revision; setRevision(doc.model.revision);
    setProjectProblems(doc.problems ?? []);
    if (doc.problems?.length) setIoError(doc.problems.map((p) => `${p.file}: ${p.message}`).join(' · '));
    setProjectId(doc.id); setProjectName(doc.name); setProcesoId(doc.model.id); setArchivo(doc.model.name);
    setEscenarios(doc.scenarios); setScenarioRevisions({ ...doc.scenarioRevisions }); setRuns([...doc.runs]);
    const first = Object.keys(doc.scenarios)[0] ?? 'as-is.scenario.json';
    setEscenarioId(first); setBaseId(first); setSeleccion(null); setCorrida(null); setIr(parsed.ir); setModo('Modelar');
    setSavedToken(saved ? changeToken(doc.id, doc.model.revision, doc.scenarioRevisions, doc.runs.map((r) => r.id)) : '');
    return true;
  }
  async function projectAction(kind: ProjectAction, confirmed = false): Promise<void> {
    if (adapter === null || modelador === null || ioLock.current) return;
    if (dirty && !confirmed) { setPendingAction(kind); return; }
    const beforeToken = tokenRef.current;
    ioLock.current = true; setIoBusy(true); setIoError(null); cancelarCorrida();
    try {
      if (kind === 'open') { const doc = await adapter.openProject(); if (doc) await activate(doc, true, beforeToken); return; }
      if (typeof kind === 'object') {
        const doc = await adapter.openRecent?.(kind.recent);
        if (doc) await activate(doc, true, beforeToken);
        else if (doc === null) setIoError('Ese proyecto ya no está en su carpeta; se quitó de recientes.');
        return;
      }
      const data = kind === 'bpmn' ? await store.getProcess(crypto.randomUUID()) : { xml: newModelXml(), name: 'model.bpmn' };
      if (data === null) return;
      const parsed = await parseBpmn(data.xml);
      await modelador.comprobar?.(data.xml);
      const doc: ProjectDocument = { version: 1, id: crypto.randomUUID(), name: kind === 'new' ? 'Mi proyecto' : data.name.replace(/\.(bpmn|xml)$/i, ''),
        model: { id: parsed.ir.id, name: 'model.bpmn', xml: data.xml, revision: 0 },
        scenarios: defaultScenarios(parsed.ir), scenarioRevisions: {}, runs: [] };
      const created = await adapter.createProject(doc);
      if (created) await activate(created, true, beforeToken);
    } catch (e) { setIoError(e instanceof Error ? e.message : String(e)); }
    finally { ioLock.current = false; setIoBusy(false); }
  }

  /** Mata la corrida en vuelo, si la hay. Idempotente. */
  function cancelarCorrida(): void {
    enVuelo.current?.abort();
    enVuelo.current = null;
    setSim({ tipo: 'inactivo' });
  }

  // Único punto donde se pinta o se limpia el overlay. Todo lo que puede cambiarlo —terminar una
  // corrida, elegir otro escenario, abrir otro `.bpmn`, mover el interruptor, remontar el lienzo—
  // pasa por aquí, y `cuellos` es idempotente, así que repetirlo no acumula nada.
  useEffect(() => {
    modelador?.cuellos(corrida, verCuellos);
  }, [modelador, corrida, verCuellos]);

  useEffect(() => {
    if (modelador === null) return;
    return modelador.suscribir(['commandStack.changed'], () => {
      revisionRef.current += 1;
      setRevision(revisionRef.current);
      cancelarCorrida();
      setCorrida(null);
    });
  }, [modelador]);

  useEffect(() => () => { enVuelo.current?.abort(); }, []);

  // Reparsear la revisión reciente, sin aceptar un parseo anterior que termine tarde.
  useEffect(() => {
    if (modelador === null) return;
    let vivo = true;
    const timer = setTimeout(() => {
      void modelador.exportar().then((xml) => parseBpmn(xml)).then(({ ir: parseado }) => {
        if (vivo) setIr(parseado);
      }).catch(() => { if (vivo) setIr(null); });
    }, 150);
    return () => { vivo = false; clearTimeout(timer); };
  }, [modelador, procesoId, revision]);

  useEffect(() => {
    void cargarTema(temaId)
      .then((t) => {
        applyTheme(t);
        setTema(t);
      })
      .catch((e: unknown) => {
        // Un tema roto no puede dejar la app en blanco: se avisa y se sigue con Eva-01, que
        // es lo que `tokens.css` trae por defecto.
        setAvisoTema(e instanceof Error ? e.message : String(e));
        setTema(null);
      });
    // Solo al arrancar; los cambios posteriores pasan por `cambiarTema`, que además remonta el lienzo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `density` es un token del tema (`applyTheme` lo reescribe), así que la preferencia se
  // vuelve a aplicar encima cada vez que cambia el tema.
  useEffect(() => {
    document.documentElement.style.setProperty('--density', densidad);
    recordar('lila.densidad', densidad);
  }, [densidad, tema]);

  async function cambiarTema(id: TemaId): Promise<void> {
    if (id === temaId) return;
    try {
      const t = await cargarTema(id);
      const xml = modelador === null ? xmlLienzo : await modelador.exportar();
      applyTheme(t);
      // Todo en el mismo commit: el lienzo se remonta una sola vez y ya con los tokens nuevos.
      setXmlLienzo(xml);
      setTema(t);
      setTemaId(id);
      setAvisoTema(null);
      recordar('lila.tema', id);
    } catch (e: unknown) {
      setAvisoTema(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Único despachador de acciones globales: los atajos del navegador y el menú nativo de Electron
   * (`window.lila.onMenu`) llaman a lo mismo que los botones de la barra.
   */
  function ejecutar(accion: MenuAction): void {
    if (accion === 'ajustes') { if (!ajustesDialog.current?.open) ajustesDialog.current?.showModal(); }
    else if (accion === 'nuevo') void projectAction('new');
    else if (accion === 'abrir') void projectAction('open');
    else if (accion === 'guardar') void guardar();
    else if (accion === 'guardarComo') void guardar(true);
    else void projectAction({ recent: accion.openRecent });
  }
  const ejecutarRef = useRef(ejecutar);
  ejecutarRef.current = ejecutar;
  useEffect(() => {
    // En Electron los atajos son aceleradores del menú nativo (`apps/desktop/src/menu.ts`) y llegan
    // por `onMenu`; registrarlos también aquí los dispararía dos veces en Windows/Linux.
    const teclas = (e: KeyboardEvent) => {
      if (DESKTOP || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      const accion = ({ ',': 'ajustes', n: 'nuevo', o: 'abrir', s: e.shiftKey ? 'guardarComo' : 'guardar' } as const)[e.key.toLowerCase()];
      if (accion === undefined) return;
      e.preventDefault();
      ejecutarRef.current(accion);
    };
    window.addEventListener('keydown', teclas);
    const quitar = window.lila?.onMenu((a) => ejecutarRef.current(a));
    return () => { window.removeEventListener('keydown', teclas); quitar?.(); };
  }, []);

  /**
   * Corre el escenario elegido sobre lo que hay en el lienzo **ahora**: se exporta el XML y se
   * vuelve a parsear, así una tarea recién añadida entra en la simulación sin recargar nada. El
   * `ir.source.originalIds` que sale de ahí es el que deja al overlay pintar sobre los ids que
   * bpmn-js conoce cuando el archivo traía ids no-NCName (ver `BottleneckOverlay.ts`).
   */
  async function simular(): Promise<void> {
    if (modelador === null) return;
    cancelarCorrida();
    const control = new AbortController();
    enVuelo.current = control;
    setSim({ progreso: null, tipo: 'simulando' });
    try {
      const modelRevision = revisionRef.current;
      const scenarioRevision = scenarioRevisions[escenarioId] ?? 0;
      const xml = await modelador.exportar();
      const { ir, scenario, warnings } = await prepareSimulation(xml, escenarioId, escenarios, archivo);
      if (control.signal.aborted || enVuelo.current !== control) return;
      const { result: rawResult } = await runInWorker(ir, scenario, {
        signal: control.signal,
        onProgress: (progreso) => {
          if (!control.signal.aborted && enVuelo.current === control) setSim({ progreso, tipo: 'simulando' });
        },
      });
      if (control.signal.aborted || enVuelo.current !== control || modelRevision !== revisionRef.current) return;
      const result = { ...rawResult, warnings: [...new Set([...warnings, ...rawResult.warnings])] };
      setIr(ir);
      setRuns((previous) => [...previous, {
        id: crypto.randomUUID(), scenarioName: escenarioId, result,
        inputs: { modelRevision, scenarioRevision, xml, scenario: scenario as unknown as Record<string, unknown> },
      }]);
      setCorrida({ originalIds: ir.source.originalIds, result, scenario });
      setModo('Resultados');
      setSim({ tipo: 'inactivo' });
    } catch (e: unknown) {
      // Cancelar no es un error que enseñar: quien canceló ya dejó la UI como quería. Se
      // comprueba la señal y no el nombre de la excepción, porque `parseBpmn` puede fallar por
      // su cuenta después de que se haya cancelado.
      if (control.signal.aborted) return;
      setSim({ mensaje: e instanceof Error ? e.message : String(e), tipo: 'error' });
    } finally {
      if (enVuelo.current === control) enVuelo.current = null;
    }
  }

  async function exportar(): Promise<void> {
    if (modelador === null) return;
    try { await store.putProcess(procesoId, await modelador.exportar({ interactivo: true })); }
    catch (e) { setIoError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="app" data-densidad={densidad}>
      {pendingAction !== null && <dialog ref={replaceDialog} className="confirmar-reemplazo" aria-labelledby="reemplazo-titulo" onCancel={(event) => { event.preventDefault(); if (!ioBusy) setPendingAction(null); }}>
        <h2 id="reemplazo-titulo">Cambios sin guardar</h2>
        <p>Guarda los cambios de {projectName} antes de continuar, o descártalos.</p>
        {ioError && <p role="alert">{ioError}</p>}
        <div className="acciones">
          <button className="boton primario" disabled={ioBusy} onClick={() => void (async () => {
            const next = pendingAction;
            if (await guardar()) { setPendingAction(null); await projectAction(next, true); }
          })()}>Guardar y continuar</button>
          <button className="boton" disabled={ioBusy} onClick={() => { const next = pendingAction; setPendingAction(null); void projectAction(next, true); }}>Descartar</button>
          <button className="boton" disabled={ioBusy} onClick={() => setPendingAction(null)}>Cancelar</button>
        </div>
      </dialog>}
      <header className="barra">
        <span className="proyecto">Lila Modeler</span>
        <span className="archivo">{projectName} · {dirty ? 'Sin guardar' : 'Guardado'}</span>
        <nav className="modos">
          {MODOS.map((m) => (
            <button
              key={m}
              type="button"
              className={m === modo ? 'modo activo' : 'modo'}

              onClick={() => { setModo(m); if (m === 'Simular') setPestana('Simulación'); }}
            >
              {m}
            </button>
          ))}
        </nav>
        <button className="boton" title={`Nuevo proyecto${atajo('N', true)}`} disabled={ioBusy || modelador === null} onClick={() => void projectAction('new')}>Nuevo</button>
        <button className="boton" title={`Abrir proyecto${atajo('O')}`} disabled={ioBusy || modelador === null} onClick={() => void projectAction('open')}>Abrir</button>
        <button className="boton primario" title={`Guardar proyecto${atajo('S')}`} disabled={ioBusy || modelador === null} onClick={() => void guardar()}>Guardar</button>
        <button className="boton" title={`Guardar como${atajo('⇧S')}`} disabled={ioBusy || modelador === null} onClick={() => void guardar(true)}>Guardar como</button>
        {bpmnFilesEnabled && <><button type="button" className="boton" onClick={() => void projectAction('bpmn')} disabled={ioBusy || modelador === null}>
          Abrir .bpmn
        </button>
        <button type="button" className="boton primario" onClick={() => void exportar()}>
          Exportar .bpmn
        </button></>}
        <button type="button" className="boton icono" title={`Ajustes${atajo(',', true)}`} aria-label="Ajustes" onClick={() => ejecutar('ajustes')}>⚙</button>
      </header>

      <dialog ref={ajustesDialog} className="ajustes" aria-labelledby="ajustes-titulo">
        <form method="dialog">
          <h2 id="ajustes-titulo">Ajustes</h2>
          <h3>Apariencia</h3>
          <label className="campo">
            Tema
            <select value={temaId} onChange={(e) => void cambiarTema(e.target.value as TemaId)}>
              {TEMA_IDS.map((id) => <option key={id} value={id}>{TEMAS[id]}</option>)}
            </select>
          </label>
          <label className="campo">
            Densidad
            <select value={densidad} onChange={(e) => setDensidad(e.target.value as Densidad)}>
              <option value="compacta">Compacta</option>
              <option value="normal">Normal</option>
              <option value="comoda">Cómoda</option>
            </select>
          </label>
          <p className="vacio">Tipografía: {(tema?.tokens?.['font.ui'] ?? 'Archivo').split(',')[0]}. Editar cada color e importar o exportar temas llega en LILA-114.</p>
          <div className="acciones"><button className="boton primario">Cerrar</button></div>
        </form>
      </dialog>

      {/* La paleta de figuras la pinta bpmn-js dentro de este contenedor, arriba a la
          izquierda; la esquina inferior derecha queda libre para la marca de agua
          «Powered by bpmn.io», que es obligatoria por la licencia de bpmn.io. */}
      <div className="zona-modelo" inert={ioBusy} style={{ visibility: modo === 'Resultados' || modo === 'Comparar' ? 'hidden' : 'visible' }}>
      {tema === undefined ? (
        <div className="lienzo" />
      ) : (
        <Lienzo
          key={temaId}
          xmlInicial={xmlLienzo}
          onListo={setModelador}
          onEstado={setEstado}
          onSeleccion={setSeleccion}
        />
      )}

        {/* Controles de zoom (LILA-208). Van sobre la marca de agua, no encima: el `bottom` de
            `.zoom` en `app.css` deja libres sus 15 px inferiores derechos. */}
        <div className="zoom">
          <button type="button" className="boton icono" aria-label="Acercar" title="Acercar" disabled={modelador === null} onClick={() => modelador?.zoom(1.2)}>+</button>
          <button type="button" className="boton icono" aria-label="Alejar" title="Alejar" disabled={modelador === null} onClick={() => modelador?.zoom(1 / 1.2)}>−</button>
          <button type="button" className="boton icono" aria-label="Ajustar a pantalla" title="Ajustar a pantalla" disabled={modelador === null} onClick={() => modelador?.ajustar()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
        </div>
      </div>
      {modo === 'Resultados' && (
        <section className="zona-resultados">
          {corrida !== null && ir !== null
            ? <ResultsView ir={ir} scenario={corrida.scenario} result={corrida.result} />
            : <p>Simula la revisión actual para ver resultados. {runs.length > 0 && 'No hay corrida actual para el escenario seleccionado.'}</p>}
        </section>
      )}
      {modo === 'Comparar' && <section className="zona-resultados">
        <label>Escenario base <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
          {Object.keys(escenarios).map((name) => <option key={name} value={name}>{etiquetaEscenario(name, escenarios)}</option>)}
        </select></label>
        {comparable && ir !== null
          ? <CompareView ir={ir} comparison={compare(ordered.map((r) => r.result))}
              runs={ordered.map((r) => runMetaFrom(etiquetaEscenario(r.scenarioName, escenarios), r.inputs.scenario as unknown as ResolvedScenario, r.result))}
              scenarioNames={ordered.map((r) => etiquetaEscenario(r.scenarioName, escenarios))}
              baseTimeUnit={(ordered[0]!.inputs.scenario as unknown as ResolvedScenario).run.baseTimeUnit ?? 's'} />
          : <p>Simula el escenario base y al menos otro escenario de la revisión actual para comparar.</p>}
        {ordered.map((run) => <p key={run.id}>{etiquetaEscenario(run.scenarioName, escenarios)} · revisión {run.inputs.modelRevision}/{run.inputs.scenarioRevision} · semilla {String((run.inputs.scenario.run as Record<string, unknown>).seed)} · {String((run.inputs.scenario.run as Record<string, unknown>).currency ?? '')}</p>)}
      </section>}
      <aside className="panel" inert={ioBusy}>
        <nav className="pestanas">
          {PESTANAS.map((p) => (
            <button
              key={p}
              type="button"
              className={p === pestana ? 'pestana activa' : 'pestana'}
              onClick={() => {
                setPestana(p);
              }}
            >
              {p}
            </button>
          ))}
        </nav>
        {pestana === 'Simulación' ? (
          <div className="simulacion">
            <label className="campo">
              Escenario
              <select
                value={escenarioId}
                onChange={(e) => {
                  setEscenarioId(e.target.value);
                  // Cambiar de escenario invalida el resultado anterior: el overlay se limpia
                  // aquí y se vuelve a pintar cuando termine la corrida nueva. La corrida en
                  // vuelo es del escenario viejo, así que se mata: si no, terminaría después y
                  // pintaría sus cuellos de botella bajo el nombre del escenario nuevo.
                  cancelarCorrida();
                  const run = latest.find((r) => r.scenarioName === e.target.value);
                  setCorrida(run && ir ? { result: run.result, scenario: run.inputs.scenario as unknown as ResolvedScenario, originalIds: ir.source.originalIds } : null);
                  setSim({ tipo: 'inactivo' });
                }}
              >
                {Object.keys(escenarios).map((id) => (
                  <option key={id} value={id}>
                    {etiquetaEscenario(id, escenarios)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="boton primario"
              disabled={modelador === null || sim.tipo === 'simulando'}
              onClick={() => void simular()}
            >
              {sim.tipo === 'simulando' ? 'Simulando…' : 'Simular'}
            </button>
            {sim.tipo === 'simulando' && <button type="button" className="boton" onClick={cancelarCorrida}>Cancelar</button>}
            {sim.tipo === 'simulando' && (
              <p className="vacio">
                {sim.progreso === null
                  ? 'Preparando…'
                  : `${Math.round(sim.progreso.fraction * 100)} % · replicación ${sim.progreso.replication}`}
              </p>
            )}
            {sim.tipo === 'error' && (
              <p role="alert" className="error">
                No se pudo simular: {sim.mensaje}
              </p>
            )}
            <label className="campo interruptor">
              <input
                type="checkbox"
                checked={verCuellos}
                onChange={(e) => {
                  setVerCuellos(e.target.checked);
                }}
              />
              Cuellos de botella
            </label>
            <p className="vacio">
              {corrida === null
                ? 'Simula para ver los cuellos de botella sobre el diagrama.'
                : (corrida.result.bottlenecks[0]?.elementId ??
                  'Ningún elemento esperó por un recurso en esta corrida.')}
            </p>
            <ScenarioPanel
              archivo={escenarioId}
              escenarios={escenarios}
              onCambio={(archivo, escenario) => {
                setEscenarios((previos) => ({ ...previos, [archivo]: escenario }));
                // Cualquier padre extends editado invalida también sus descendientes.
                setScenarioRevisions((previous) => nextScenarioRevisions(archivo, escenarios, previous));
                // El escenario cambió: el resultado en pantalla es del anterior. Mismo trato
                // que al cambiar de escenario en el selector (LILA-064).
                cancelarCorrida();
                setCorrida(null);
              }}
              onGuardar={() => { void guardar(); }}
              onDuplicar={(archivo, escenario) => {
                setEscenarios((previos) => ({ ...previos, [archivo]: escenario }));
                // Cualquier padre extends editado invalida también sus descendientes.
                setScenarioRevisions((previous) => nextScenarioRevisions(archivo, escenarios, previous));
                setEscenarioId(archivo);
                cancelarCorrida();
                setCorrida(null);
              }}
              ir={ir}
              seleccion={seleccion}
              onSeleccionar={(id) => { setSeleccion(id); if (id !== null) modelador?.seleccionar?.(id); else modelador?.servicios.selection.select([]); }}
            />
          </div>
        ) : (
          <PanelPropiedades key={projectId} modelador={modelador} pestana={pestana} />
        )}
      </aside>

      <nav className="diagramas">
        <button className="boton" disabled={ioBusy || !modelador?.deshacer} onClick={() => modelador?.deshacer?.()}>Deshacer</button>
        <button className="boton" disabled={ioBusy || !modelador?.rehacer} onClick={() => modelador?.rehacer?.()}>Rehacer</button>
        {/* Un proyecto = un diagrama por ahora (LILA-208): la pestaña no cambia de nada, así que
            no es un botón; el ✕ cierra el proyecto y el «+» abre uno nuevo, los dos por
            `projectAction('new')`, que ya trae la guardia de cambios sin guardar. */}
        <span className="pestana activa">
          {archivo}
          <button type="button" className="cerrar" aria-label={`Cerrar ${archivo}`} title="Cerrar diagrama" disabled={ioBusy || modelador === null} onClick={() => void projectAction('new')}>✕</button>
        </span>
        <button type="button" className="boton icono" aria-label="Nuevo diagrama" title="Nuevo diagrama" disabled={ioBusy || modelador === null} onClick={() => void projectAction('new')}>+</button>
      </nav>

      <footer className="estado">
        {ioError !== null && <span role="alert" className="error">{ioError}</span>}
        <span>{estado.elementos} elementos</span>
        <button
          type="button"
          className="enlace"
          onClick={() => {
            modelador?.ajustar();
          }}
        >
          Zoom {Math.round(estado.zoom * 100)} % · ajustar
        </button>
        <button type="button" className="enlace" title={`Ajustes${atajo(',', true)}`} onClick={() => ejecutar('ajustes')}>Tema: {tema?.name ?? 'Eva-01'}</button>
        {estado.avisos > 0 && (
          <span role="alert" className="aviso">
            {estado.avisos} avisos al importar; revisa el diagnóstico antes de simular o exportar
          </span>
        )}
        {estado.error !== null && (
          <span role="alert" className="error">
            No se pudo abrir el diagrama: {estado.error}
          </span>
        )}
        {avisoTema !== null && (
          <span role="alert" className="error">
            No se pudo cargar el tema: {avisoTema}
          </span>
        )}
      </footer>
    </div>
  );
}

