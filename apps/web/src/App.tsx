/**
 * Shell de la app web (LILA-057): barra superior con los modos, paleta propia de figuras a la
 * izquierda (LILA-207), lienzo al centro, panel derecho con pestañas y barra de estado abajo. La
 * disposición es la del brief `prompts/claude-design-ui.md`; los colores salen todos de los
 * tokens de LILA-112, sin un solo hex aquí.
 *
 * Ni un solo literal de UI aquí: todo el texto que se lee en pantalla sale de `strings.es.ts`
 * (LILA-066), que es también lo que vigila `strings.test.ts`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseBpmn } from '@lila/engine/bpmn';
import { resolveExtends, type ResolvedScenario } from '@lila/engine/schema';
import { compare } from '@lila/engine';
import { CompareView } from './CompareView';
import { runMetaFrom } from './compareWarnings';
import { changeToken, defaultScenarios, newModelXml, nextScenarioRevisions, projectStore, readProject } from './project';
import type { ProcessIR, SimulationProgress } from '@lila/engine';
import { Lienzo, type EstadoLienzo, type Modelador, type Servicios } from './Modeler';
import { Paleta } from './Paleta';
import { PanelPropiedades } from './PropertiesPanel';
import { problemasEscenario, ScenarioPanel } from './ScenarioPanel';
import { ResultsView } from './ResultsView';
import { TokenSim } from './TokenSim';
import { prepareSimulation } from './simulationGate';
import type { ProjectDocument, StoredRun } from './store/ProjectStore';
import type { Ajustes, MenuAction, OpenPathRequest } from '../../desktop/src/bridge.js';
import type { Corrida } from './BottleneckOverlay';
import { problemasPorElemento } from './ValidationMarkers';
import { runInWorker } from './simulationClient';
import { applyTheme, type Theme } from './theme/applyTheme';
import { S } from './strings.es';
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

/** `file` (LILA-072): el `.bpmn` pulsado, cuando no es el `model.bpmn` de la carpeta. */
type ProjectAction = 'new' | 'open' | 'bpmn' | { readonly recent: string; readonly file?: string };

/**
 * Nombre del cuello de botella principal para el panel derecho (#226): antes se enseñaba el id
 * BPMN en crudo (`Task_Preparar`), que no es lo que el usuario ve en el lienzo. El id se añade
 * entre paréntesis solo cuando aporta algo —tareas sin nombre, o ids sanitizados por el motor—,
 * porque sigue siendo la única clave (regla 5 de BACKLOG.md). `undefined` = no hubo cuellos.
 */
function nombreDeCuello(id: string | undefined, ir: ProcessIR | null): string | undefined {
  if (id === undefined) return undefined;
  const nombre = ir?.nodes[id]?.name;
  return nombre === undefined || nombre === '' || nombre === id ? id : S.app.nombreDeCuello(nombre, id);
}

const MODOS = S.app.modos;
const PESTANAS = S.app.pestanas;

/** Temas integrados, servidos como JSON estáticos (`vite.config.ts`): editar y recargar cambia la UI. */
const TEMAS = S.app.temas;
type TemaId = keyof typeof TEMAS;
const TEMA_IDS = Object.keys(TEMAS) as TemaId[];
const DENSIDADES = S.app.densidades.map((d) => d.id);
type Densidad = (typeof S.app.densidades)[number]['id'];

/**
 * Preferencias de apariencia (LILA-113). Con puente van a `<userData>/estado.json`
 * (`readSettings`/`writeSettings`); sin él, a `localStorage`. Son excluyentes: el puente manda
 * cuando existe.
 *
 * Hasta ahora era `localStorage` en las dos modalidades, con el argumento de que `lila://` es un
 * esquema con origen propio y por tanto tiene su propio almacén. Sigue siendo verdad, pero el
 * almacén está dentro del perfil de Chromium de la app: no se ve desde fuera, no se copia a otra
 * máquina y desaparece si se limpian los datos del sitio. La ventana y los recientes ya viven en
 * `estado.json`; la apariencia es del mismo tipo de dato y estaba en otro sitio sin motivo.
 *
 * Leer es asíncrono porque en escritorio es una llamada IPC. Nunca rechaza: sin preferencias
 * legibles se arranca con las de fábrica, que es peor que recordar y mejor que no arrancar.
 */
async function preferencias(): Promise<Ajustes> {
  const puente = window.lila;
  // `try`, no `.catch`: cubre también el puente que no trae `readSettings` —un preload viejo junto
  // a un renderer nuevo—. Si esto rechazara, el `then` del efecto que lo llama no lo recoge y
  // `tema` se quedaría en `undefined` para siempre, o sea sin lienzo (QA de #275).
  if (puente !== undefined) { try { return await puente.readSettings(); } catch { return {}; } }
  try {
    const tema = localStorage.getItem('lila.tema');
    const densidad = localStorage.getItem('lila.densidad');
    return { ...(tema === null ? {} : { tema }), ...(densidad === null ? {} : { densidad }) };
  } catch { return {}; }
}
/** Guarda solo lo que cambia; el puente fusiona con lo que ya hubiera (ver `bridge.ts`). */
function recordar(ajustes: Ajustes): void {
  const puente = window.lila;
  if (puente !== undefined) {
    // Que no se pueda escribir la preferencia no puede tumbar la app ni ensuciar la consola del
    // smoke: como mucho, la próxima vez arranca con el tema anterior. El `try` cubre el puente que
    // no trae `writeSettings` —si lanzara, lo haría dentro de un efecto y se llevaría el árbol—.
    try { void puente.writeSettings(ajustes).catch(() => {}); } catch { /* puente sin el método */ }
    return;
  }
  try {
    if (ajustes.tema !== undefined) localStorage.setItem('lila.tema', ajustes.tema);
    if (ajustes.densidad !== undefined) localStorage.setItem('lila.densidad', ajustes.densidad);
  } catch { /* sin almacenamiento (modo privado): no persiste, no rompe */ }
}
/** El valor guardado, si sigue siendo uno de los válidos; si no, el de fábrica. */
function valido<T extends string>(valor: string | undefined, validas: readonly T[], porDefecto: T): T {
  return validas.includes(valor as T) ? (valor as T) : porDefecto;
}
async function cargarTema(id: TemaId): Promise<Theme> {
  const r = await fetch(`./${id}.json`);
  if (!r.ok) throw new Error(S.app.errorTemaHttp(r.status));
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
  return S.app.atajo(letra, shift, MAC);
}

/**
 * Los servicios del lienzo para la paleta (LILA-207). El getter de `Modelador` lanza mientras no
 * haya un BPMN abierto; devolver `null` deja la paleta pintada pero inerte en vez de tumbar el
 * render.
 */
function serviciosDe(modelador: Modelador | null): Servicios | null {
  try { return modelador?.servicios ?? null; } catch { return null; }
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

/**
 * El escenario activo con `extends` ya aplicado, que es lo que valida el lint (§ 6 de
 * `docs/SCENARIO_FORMAT.md`) y lo mismo que resuelve el panel de escenario. Con la cadena rota
 * se lintea el delta tal cual y el fallo de la herencia cuenta como un error más, igual que en el panel;
 * dejar los chips en blanco escondería el resto de los problemas.
 */
function escenarioResuelto(archivo: string, escenarios: Escenarios): { resuelto: unknown; error: string | null } {
  try {
    return { error: null, resuelto: resolveExtends(archivo, (ruta) => {
      const encontrado = escenarios[ruta];
      if (encontrado === undefined) throw new Error(S.app.errorEscenarioDesconocido(ruta));
      return encontrado;
    }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), resuelto: escenarios[archivo] ?? {} };
  }
}

/**
 * Semilla que se usaría al simular, para la barra de estado (`docs/design/01-modelar-1440.png`).
 * Sale del escenario **resuelto**: `to-be-3-cajeros` no declara `run`, lo hereda por `extends`,
 * y `resolveExtends` es la misma función con la que `prepareSimulation` arma la corrida. Si el
 * escenario está a medio editar y no resuelve, la barra enseña «—» en vez de romperse.
 */
function semillaEscenario(archivo: string, escenarios: Escenarios): string {
  try {
    const run = resolveExtends(archivo, (p) => escenarios[p] ?? {})['run'] as { seed?: unknown } | undefined;
    return run?.seed === undefined ? S.app.sinValor : String(run.seed);
  } catch { return S.app.sinValor; }
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
    perdidas: [],
    refsRotas: [],
    error: null,
  });
  const [procesoId, setProcesoId] = useState(PROCESO_INICIAL);
  const [projectId, setProjectId] = useState('demo-pedido');
  const [projectName, setProjectName] = useState<string>(S.app.proyectoDemo);
  const [savedToken, setSavedToken] = useState(changeToken('demo-pedido', 0, {}, []));
  const [projectProblems, setProjectProblems] = useState<NonNullable<ProjectDocument['problems']>>([]);
  /** Diagrama suelto: un `.bpmn` abierto en una carpeta que no es un proyecto (LILA-072). */
  const [suelto, setSuelto] = useState(false);
  const [ioError, setIoError] = useState<string | null>(null);
  const [ioBusy, setIoBusy] = useState(false);
  const ioLock = useRef(false);
  const [pendingAction, setPendingAction] = useState<ProjectAction | null>(null);
  /** `.bpmn` que llegó antes de que el lienzo estuviera listo; lo abre `abrirRuta` (LILA-072). */
  const rutaPendiente = useRef<OpenPathRequest | null>(null);
  const replaceDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (pendingAction !== null && !replaceDialog.current?.open) replaceDialog.current?.showModal();
  }, [pendingAction]);
  // Decisión de escribir a pesar de la pérdida (LILA-192). Es estado de React y no un
  // `window.confirm` porque el diálogo tiene que verse, leerse y probarse como el resto de la app.
  // El estado es el verbo de la acción que espera respuesta —exportar o guardar—, y el `resolve`
  // de esa espera vive en la ref: así ambas pasan por el mismo diálogo y ninguna escribe sin el sí.
  const [confirmarPerdida, setConfirmarPerdida] = useState<'Exportar' | 'Guardar' | null>(null);
  const respuestaPerdida = useRef<((acepta: boolean) => void) | null>(null);
  const exportDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirmarPerdida !== null && !exportDialog.current?.open) exportDialog.current?.showModal();
  }, [confirmarPerdida]);
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
  // A partir de ahí ya no se remonta nunca: cambiar de tema es `modelador.repintar()`.
  const [tema, setTema] = useState<Theme | null | undefined>(undefined);
  const [avisoTema, setAvisoTema] = useState<string | null>(null);
  // Estos dos arrancan de fábrica y los pisa el primer efecto con lo que devuelva `preferencias()`:
  // en escritorio están en `userData` y leerlos es IPC, o sea asíncrono. Es el mismo instante en el
  // que `tema` deja de ser `undefined`, así que el lienzo nunca llega a ver el valor provisional.
  const [temaId, setTemaId] = useState<TemaId>('eva-01');
  const [densidad, setDensidad] = useState<Densidad>('normal');
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

  /**
   * Todo lo que el archivo original tiene y el XML exportado no tendrá: los avisos del import
   * que implican pérdida (LILA-193) y las referencias que ya venían rotas (LILA-192). Es la
   * misma lista que se pinta en el pie y que enumera el diálogo de confirmación.
   */
  const perdidasAlExportar = [...estado.perdidas, ...estado.refsRotas];

  /**
   * `true` si se puede escribir: no hay pérdida, o el usuario la aceptó en el diálogo. Exportar y
   * guardar comparten esta puerta porque los dos escriben un .bpmn mutilado (LILA-192).
   */
  async function aceptaPerdida(verbo: 'Exportar' | 'Guardar'): Promise<boolean> {
    if (perdidasAlExportar.length === 0) return true;
    respuestaPerdida.current?.(false);
    return new Promise<boolean>((resolve) => { respuestaPerdida.current = resolve; setConfirmarPerdida(verbo); });
  }
  function responderPerdida(acepta: boolean): void {
    const resolver = respuestaPerdida.current;
    respuestaPerdida.current = null;
    setConfirmarPerdida(null);
    resolver?.(acepta);
  }

  async function snapshot(): Promise<ProjectDocument> {
    if (modelador === null) throw new Error(S.app.errorModeladorNoListo);
    const atRevision = revisionRef.current;
    // `guardar()` ya obtuvo el sí del usuario si había pérdida; aquí no se decide nada.
    const xml = await modelador.exportar({ aceptarPerdida: true });
    if (atRevision !== revisionRef.current) throw new Error(S.app.errorModeloCambio);
    const parsed = await parseBpmn(xml);
    return { version: 1, id: projectId, name: projectName,
      model: { id: parsed.ir.id, name: archivo, xml, revision: atRevision },
      scenarios: escenarios, scenarioRevisions, runs, ...(projectProblems.length ? { problems: projectProblems } : {}) };
  }
  async function guardar(saveAs = false): Promise<boolean> {
    if (adapter === null || ioLock.current) return false;
    // Guardar reescribe `model.bpmn` en disco: con pérdida pasa por el mismo diálogo que
    // exportar y no toca el archivo hasta que el usuario lo acepta (LILA-192). Cancelar
    // devuelve `false`, que es lo que el cierre de Electron lee como «no se guardó» y le hace
    // cancelar el cierre: la ventana sigue abierta con el diálogo delante, sin nada perdido.
    if (!await aceptaPerdida('Guardar')) return false;
    ioLock.current = true; setIoBusy(true); setIoError(null);
    try {
      const doc = await snapshot();
      const token = changeToken(doc.id, doc.model.revision, doc.scenarioRevisions, doc.runs.map((r) => r.id));
      const saved = await adapter.saveProject(doc, { saveAs });
      if (saved === null) return false;
      // «Guardar como» crea el proyecto completo en la carpeta elegida: deja de ser suelto.
      if (saveAs) setSuelto(false);
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
    if (expectedToken !== tokenRef.current) throw new Error(S.app.errorProyectoCambio);
    cancelarCorrida();
    if (!await modelador.abrir(doc.model.xml)) return false;
    revisionRef.current = doc.model.revision; setRevision(doc.model.revision);
    setProjectProblems(doc.problems ?? []);
    setSuelto(doc.loose === true);
    if (doc.problems?.length) setIoError(doc.problems.map((p) => S.app.problemaDeArchivo(p.file, p.message)).join(' · '));
    setProjectId(doc.id); setProjectName(doc.name); setProcesoId(doc.model.id); setArchivo(doc.model.name);
    // Una carpeta sin `*.scenario.json` —un `.bpmn` suelto abierto por doble clic (LILA-072), o
    // una carpeta con el modelo puesto a mano— arranca con el AS-IS por defecto, el mismo de
    // «Nuevo», en vez de dejar el pie con un «escenario desconocido» que el usuario no provocó.
    const scenarios = Object.keys(doc.scenarios).length === 0 ? defaultScenarios(parsed.ir) : doc.scenarios;
    setEscenarios(scenarios); setScenarioRevisions({ ...doc.scenarioRevisions }); setRuns([...doc.runs]);
    const first = Object.keys(scenarios)[0] ?? 'as-is.scenario.json';
    setEscenarioId(first); setBaseId(first); setSeleccion(null); setCorrida(null); setIr(parsed.ir); setModo('Modelar');
    setSavedToken(saved ? changeToken(doc.id, doc.model.revision, doc.scenarioRevisions, doc.runs.map((r) => r.id)) : '');
    return true;
  }
  async function projectAction(kind: ProjectAction, confirmed = false): Promise<void> {
    // QA de #258: el diálogo de pérdida es modal para el ratón, pero Cmd+O/Cmd+N —y en Electron
    // los aceleradores del menú nativo— llegan igual por `window`. Sin esta puerta, abrir otro
    // proyecto mientras el diálogo espera cambiaba el documento por debajo y lo dejaba pidiendo
    // permiso para perder referencias que ya no son de este archivo. Es la ref y no el estado:
    // el `onClick` de «Guardar y continuar» quedó cerrado sobre el render en el que el diálogo
    // aún estaba abierto, y con el estado se bloquearía a sí mismo.
    if (adapter === null || modelador === null || ioLock.current || respuestaPerdida.current !== null) return;
    if (dirty && !confirmed) { setPendingAction(kind); return; }
    const beforeToken = tokenRef.current;
    ioLock.current = true; setIoBusy(true); setIoError(null); cancelarCorrida();
    try {
      if (kind === 'open') { const doc = await adapter.openProject(); if (doc) await activate(doc, true, beforeToken); return; }
      if (typeof kind === 'object') {
        const doc = await adapter.openRecent?.(kind.recent, kind.file);
        if (doc) await activate(doc, true, beforeToken);
        else if (doc === null) setIoError(S.app.errorRecienteAusente);
        return;
      }
      const data = kind === 'bpmn' ? await store.getProcess(crypto.randomUUID()) : { xml: newModelXml(), name: 'model.bpmn' };
      if (data === null) return;
      const parsed = await parseBpmn(data.xml);
      await modelador.comprobar?.(data.xml);
      const doc: ProjectDocument = { version: 1, id: crypto.randomUUID(), name: kind === 'new' ? S.app.proyectoNuevo : data.name.replace(/\.(bpmn|xml)$/i, ''),
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
  // pasa por aquí, y `cuellos` es idempotente, así que repetirlo no acumula nada. En «Validar
  // rutas» (LILA-065) se apaga: la animación de tokens no convive con la tinta de cuellos.
  useEffect(() => {
    modelador?.cuellos(corrida, modo !== 'Validar rutas' && verCuellos);
  }, [modelador, corrida, verCuellos, modo]);

  /**
   * Errores y avisos de ahora mismo (LILA-209): el lint del escenario activo —la misma lista
   * que cuenta la cabecera del panel de escenario, así que los dos números coinciden siempre—
   * más los que no cuelgan de ninguna figura: el diagnóstico del proyecto abierto y los avisos
   * de bpmn-js al importar.
   */
  const validacion = useMemo(
    () => {
      // Misma lista que la cabecera del panel de escenario: el fallo de la cadena `extends` va
      // delante de los problemas del delta sin resolver.
      const { resuelto, error } = escenarioResuelto(escenarioId, escenarios);
      const problemas = problemasEscenario(resuelto, ir);
      if (error !== null) problemas.unshift({ ruta: 'extends', mensaje: error, severidad: 'error' });
      // Sin figura: archivos ilegibles del proyecto, el diagrama que no abrió y los avisos de importar.
      return problemasPorElemento(problemas, { avisos: estado.avisos, errores: projectProblems.length + (estado.error === null ? 0 : 1) });
    },
    [escenarioId, escenarios, ir, estado.avisos, estado.error, projectProblems],
  );

  // Único punto donde se pintan o se quitan los marcadores. Cualquier cosa que cambie los
  // problemas —editar el escenario en el panel, editar el diagrama (revision -> `ir` nuevo),
  // abrir otro proyecto, cambiar de tema (lienzo remontado)— pasa por aquí, y
  // `Modelador.validacion` es idempotente. En «Validar rutas» (LILA-065) se apaga: los discos de
  // validación no se pintan sobre la animación de tokens.
  useEffect(() => {
    modelador?.validacion(modo === 'Validar rutas' ? null : validacion);
  }, [modelador, validacion, modo]);

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
    void preferencias().then(async (guardadas) => {
      const id = valido(guardadas.tema, TEMA_IDS, 'eva-01');
      setTemaId(id);
      setDensidad(valido(guardadas.densidad, DENSIDADES, 'normal'));
      try {
        const t = await cargarTema(id);
        applyTheme(t);
        setTema(t);
      } catch (e: unknown) {
        // Un tema roto no puede dejar la app en blanco: se avisa y se sigue con Eva-01, que
        // es lo que `tokens.css` trae por defecto.
        setAvisoTema(e instanceof Error ? e.message : String(e));
        setTema(null);
      }
    });
    // Solo al arrancar; los cambios posteriores pasan por `cambiarTema` y por el selector de densidad.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `density` es un token del tema (`applyTheme` lo reescribe), así que la preferencia se
  // vuelve a aplicar encima cada vez que cambia el tema.
  useEffect(() => {
    document.documentElement.style.setProperty('--density', densidad);
    // `tema === undefined` es "las preferencias todavía no se han leído": guardar aquí antes de
    // eso escribiría el valor de fábrica encima del que hay en disco.
    if (tema !== undefined) recordar({ densidad });
  }, [densidad, tema]);

  async function cambiarTema(id: TemaId): Promise<void> {
    if (id === temaId) return;
    try {
      const t = await cargarTema(id);
      applyTheme(t);
      // El lienzo NO se remonta (LILA-113): `repintar` relee los tokens en el renderer vivo de
      // bpmn-js y redibuja las figuras, así que la pila de deshacer y la selección siguen ahí.
      modelador?.repintar();
      setTema(t);
      setTemaId(id);
      setAvisoTema(null);
      recordar({ tema: id });
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
   * Abrir un `.bpmn` por asociación de archivo (LILA-072) y arranque en frío (LILA-074): main
   * captura la ruta —doble clic, `open-file` de macOS, argumento de línea de comandos—, autoriza
   * su carpeta y la entrega por `pendingOpenPath()` (lo que llegó antes de que la ventana pudiera
   * recibirla; se consume una vez) o por `onOpenPath` (con la app ya corriendo). Las dos entran
   * por la MISMA puerta que «Abrir reciente», la única que abre una carpeta ya autorizada sin
   * selector, pero llevando `ruta.file`: se abre EL archivo pulsado, no un `model.bpmn` fijo.
   * ponytail: la carpeta del archivo sigue siendo el proyecto (escenarios y corridas salen de
   * ahí); un `.bpmn` suelto abre como proyecto sin escenarios y se coloca con «Guardar como».
   */
  function abrirRuta(ruta: OpenPathRequest): void {
    // El lienzo aún no existe: `projectAction` no haría nada y la ruta se perdería (hallazgo 3 del
    // QA). Se guarda y la abre el efecto de abajo en cuanto haya modelador.
    if (modelador === null) { rutaPendiente.current = ruta; return; }
    // Con una E/S en curso o el diálogo de cambios sin guardar abierto, `projectAction` saldría en
    // silencio o pisaría la acción pendiente (hallazgos 4 y 5): mejor decirlo — el banner se pinta
    // también dentro del diálogo.
    if (ioLock.current || pendingAction !== null) {
      setIoError(S.app.errorAbrirOcupado(String(ruta.file)));
      return;
    }
    void projectAction({ recent: ruta.dir, file: ruta.file });
  }
  const abrirRutaRef = useRef(abrirRuta);
  abrirRutaRef.current = abrirRuta;
  useEffect(() => {
    const abrir = (ruta: OpenPathRequest): void => abrirRutaRef.current(ruta);
    void window.lila?.pendingOpenPath().then((ruta) => { if (ruta !== null) abrir(ruta); });
    return window.lila?.onOpenPath(abrir);
  }, []);
  useEffect(() => {
    const ruta = rutaPendiente.current;
    if (modelador === null || ruta === null) return;
    rutaPendiente.current = null;
    abrirRutaRef.current(ruta);
  }, [modelador]);

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
    // Nada se descarga mientras el usuario no vea qué se pierde (LILA-192).
    if (!await aceptaPerdida('Exportar')) return;
    try { await store.putProcess(procesoId, await modelador.exportar({ aceptarPerdida: true })); }
    catch (e) { setIoError(e instanceof Error ? e.message : String(e)); }
  }

  return (
    <div className="app" data-densidad={densidad}>
      {pendingAction !== null && <dialog ref={replaceDialog} className="confirmar-reemplazo" aria-labelledby="reemplazo-titulo" onCancel={(event) => { event.preventDefault(); if (!ioBusy) setPendingAction(null); }}>
        <h2 id="reemplazo-titulo">{S.app.reemplazoTitulo}</h2>
        <p>{S.app.reemplazoTexto(projectName)}</p>
        {ioError && <p role="alert">{ioError}</p>}
        <div className="acciones">
          <button className="boton primario" disabled={ioBusy} onClick={() => void (async () => {
            const next = pendingAction;
            if (await guardar()) { setPendingAction(null); await projectAction(next, true); }
          })()}>{S.app.guardarYContinuar}</button>
          <button className="boton" disabled={ioBusy} onClick={() => { const next = pendingAction; setPendingAction(null); void projectAction(next, true); }}>{S.app.descartar}</button>
          <button className="boton" disabled={ioBusy} onClick={() => setPendingAction(null)}>{S.app.cancelar}</button>
        </div>
      </dialog>}
      {confirmarPerdida !== null && <dialog ref={exportDialog} className="confirmar-perdida" aria-labelledby="perdida-titulo" onCancel={(event) => { event.preventDefault(); responderPerdida(false); }}>
        <h2 id="perdida-titulo">{S.app.perdidaTitulo(perdidasAlExportar.length)}</h2>
        <p>{S.app.perdidaTexto(confirmarPerdida === 'Guardar')}</p>
        <ul>{perdidasAlExportar.map((perdida) => <li key={perdida}>{perdida}</li>)}</ul>
        <div className="acciones">
          <button className="boton primario" type="button" onClick={() => responderPerdida(true)}>{S.app.perdidaConfirmar(S.app.perdidaVerbo[confirmarPerdida])}</button>
          <button className="boton" type="button" onClick={() => responderPerdida(false)}>{S.app.cancelar}</button>
        </div>
      </dialog>}
      <header className="barra">
        <div className="identidad">
          {/* Logo del artefacto: pentágono macizo en `accent.primary`. */}
          <svg className="logo" viewBox="0 0 24 24" aria-hidden="true"><polygon points="12,0 24,9.1 19.7,24 4.3,24 0,9.1" /></svg>
          <div>
            <div className="proyecto">{projectName}</div>
            <div className="archivo">{archivo} · {dirty ? S.app.sinGuardar : S.app.guardado}</div>
          </div>
        </div>
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
        {/* En Electron estas acciones son el menú nativo (`apps/desktop/src/menu.ts`) con sus
            aceleradores, así que aquí no se pintan. En el navegador el desplegable es un
            `<details>`: sin librería, sin estado en React y con teclado de serie. `Esc` sí hay
            que cerrarlo a mano —`<details>` no lo trae, eso es de `<dialog>`/popover—, y basta
            un `onKeyDown` porque el foco está dentro mientras está abierto.
            ponytail: no se cierra al hacer clic fuera; techo: si molesta, un `onBlur` en el
            summary (o `popover` cuando Electron suba de Chromium). */}
        {!DESKTOP && <details className="menu-archivo" onKeyDown={(e) => { if (e.key === 'Escape') (e.currentTarget as HTMLDetailsElement).open = false; }}>
          <summary>{S.app.menuArchivo}</summary>
          <div onClick={(e) => { (e.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>
            <button type="button" title={`${S.app.tituloNuevo}${atajo('N', true)}`} disabled={ioBusy || modelador === null} onClick={() => void projectAction('new')}>{S.app.nuevo}</button>
            <button type="button" title={`${S.app.tituloAbrir}${atajo('O')}`} disabled={ioBusy || modelador === null} onClick={() => void projectAction('open')}>{S.app.abrir}</button>
            <button type="button" title={`${S.app.tituloGuardar}${atajo('S')}`} disabled={ioBusy || modelador === null} onClick={() => void guardar()}>{S.app.guardar}</button>
            <button type="button" title={`${S.app.tituloGuardarComo}${atajo('⇧S')}`} disabled={ioBusy || modelador === null} onClick={() => void guardar(true)}>{S.app.guardarComo}</button>
            {bpmnFilesEnabled && <>
              <button type="button" disabled={ioBusy || modelador === null} onClick={() => void projectAction('bpmn')}>{S.app.abrirBpmn}</button>
              <button type="button" onClick={() => void exportar()}>{S.app.exportarBpmn}</button>
            </>}
          </div>
        </details>}
        <span className="hueco" />
        {/* Campo inerte: buscar de verdad es la paleta de comandos (LILA-066, #66). Está aquí
            porque el artefacto fija su sitio y su ancho, no para que funcione todavía. */}
        <div className="buscador">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
          <input type="search" readOnly aria-label={S.app.buscar} placeholder={S.app.buscarPista} title={S.app.buscarPendiente} />
          <kbd>⌘K</kbd>
        </div>
        <div className="iconos">
          <button type="button" className="boton icono" aria-label={S.app.deshacer} title={S.app.deshacer} disabled={ioBusy || !modelador?.deshacer} onClick={() => modelador?.deshacer?.()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15.5-6.4L3 13" /></svg>
          </button>
          <button type="button" className="boton icono" aria-label={S.app.rehacer} title={S.app.rehacer} disabled={ioBusy || !modelador?.rehacer} onClick={() => modelador?.rehacer?.()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 15.5-6.4L21 13" /></svg>
          </button>
        </div>
        {/* Única acción primaria de la app (artboard 01), y el mismo hueco enseña el progreso y
            el botón de cancelar mientras corre (artboard 03). Corre desde cualquier modo. */}
        {sim.tipo === 'simulando' ? (
          <>
            <div className="progreso">
              <div className="progreso-cifras">
                <span>{sim.progreso === null ? S.app.preparando : S.app.replicacion(sim.progreso.replication + 1, sim.progreso.totalReplications)}</span>
                {sim.progreso !== null && <span className="por-ciento">{S.app.porCiento(Math.round(sim.progreso.fraction * 100))}</span>}
              </div>
              <div className="progreso-pista"><div style={{ width: `${Math.round((sim.progreso?.fraction ?? 0) * 100)}%` }} /></div>
            </div>
            <button type="button" className="boton cancelar" onClick={cancelarCorrida}>{S.app.cancelar}</button>
          </>
        ) : (
          <button type="button" className="boton primario ejecutar" disabled={modelador === null} onClick={() => void simular()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4l14 8-14 8z" /></svg>
            {S.app.ejecutar}
          </button>
        )}
        <button type="button" className="boton icono" title={`${S.app.ajustes}${atajo(',', true)}`} aria-label={S.app.ajustes} onClick={() => ejecutar('ajustes')}>⚙</button>
      </header>

      <dialog ref={ajustesDialog} className="ajustes" aria-labelledby="ajustes-titulo">
        <form method="dialog">
          <h2 id="ajustes-titulo">{S.app.ajustes}</h2>
          <h3>{S.app.apariencia}</h3>
          <label className="campo">
            {S.app.tema}
            <select value={temaId} onChange={(e) => void cambiarTema(e.target.value as TemaId)}>
              {TEMA_IDS.map((id) => <option key={id} value={id}>{TEMAS[id]}</option>)}
            </select>
          </label>
          <label className="campo">
            {S.app.densidad}
            <select value={densidad} onChange={(e) => setDensidad(e.target.value as Densidad)}>
              {S.app.densidades.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </label>
          <p className="vacio">{S.app.tipografia((tema?.tokens?.['font.ui'] ?? S.app.tipografiaPorDefecto).split(',')[0]!)}</p>
          <div className="acciones"><button className="boton primario">{S.app.cerrar}</button></div>
        </form>
      </dialog>

      {/* Paleta propia (LILA-207): un raíl a la izquierda del lienzo, no los iconos que bpmn-js
          pinta dentro del contenedor (escondidos en `app.css`). En Resultados y Comparar no se
          pinta y su columna de la retícula se encoge a 0. */}
      {(modo === 'Modelar' || modo === 'Simular') && <Paleta servicios={serviciosDe(modelador)} />}

      {/* La esquina inferior derecha del lienzo queda libre para la marca de agua
          «Powered by bpmn.io», que es obligatoria por la licencia de bpmn.io. */}
      <div className="zona-modelo" inert={ioBusy} style={{ visibility: modo === 'Resultados' || modo === 'Comparar' ? 'hidden' : 'visible' }}>
      {tema === undefined ? (
        <div className="lienzo" />
      ) : (
        <Lienzo
          xmlInicial={pedido}
          onListo={setModelador}
          onEstado={setEstado}
          onSeleccion={setSeleccion}
        />
      )}

        {/* Controles de zoom (LILA-208). Van sobre la marca de agua, no encima: el `bottom` de
            `.zoom` en `app.css` deja libres sus 15 px inferiores derechos. */}
        <div className="zoom">
          <button type="button" className="boton icono" aria-label={S.app.acercar} title={S.app.acercar} disabled={modelador === null} onClick={() => modelador?.zoom(1.2)}>+</button>
          <button type="button" className="boton icono" aria-label={S.app.alejar} title={S.app.alejar} disabled={modelador === null} onClick={() => modelador?.zoom(1 / 1.2)}>−</button>
          <button type="button" className="boton icono" aria-label={S.app.ajustarPantalla} title={S.app.ajustarPantalla} disabled={modelador === null} onClick={() => modelador?.ajustar()}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
        </div>
      {/* Aviso de «Validar rutas» (LILA-065): deja claro que la animación de tokens no es la
          simulación DES del motor antes de que alguien la confunda con una corrida de verdad. */}
      {/* `key={temaId}`: los colores neutros del modo se escriben en el DI al activarlo
          (`ColoresNeutrosDelTema`), y el DI gana a los colores por defecto que repinta
          `repintar()`. Como el lienzo ya no se remonta al cambiar de tema, sin esta `key` el
          diagrama se quedaba con los colores del tema anterior y la etiqueta con los del nuevo
          —texto invisible—. Remontar `TokenSim` apaga y vuelve a encender el modo, que es donde
          el módulo relee los tokens (QA de #275). */}
      {modo === 'Validar rutas' && <TokenSim key={temaId} modelador={modelador} />}
      {(validacion.errores > 0 || validacion.avisos > 0) && (
        <div className="chips-validacion">
          {validacion.errores > 0 && (
            <button type="button" className="chip error" title={S.app.irAlPrimerProblema} disabled={validacion.primero === null}
              onClick={() => { if (validacion.primero !== null) modelador?.seleccionar?.(validacion.primero); }}>
              <span className="punto" />{S.app.errores(validacion.errores)}
            </button>
          )}
          {validacion.avisos > 0 && (
            <button type="button" className="chip" title={S.app.irAlPrimerProblema} disabled={validacion.primero === null}
              onClick={() => { if (validacion.primero !== null) modelador?.seleccionar?.(validacion.primero); }}>
              <span className="punto" />{S.app.avisos(validacion.avisos)}
            </button>
          )}
        </div>
      )}
      </div>
      {modo === 'Resultados' && (
        <section className="zona-resultados">
          {corrida !== null && ir !== null
            ? <ResultsView ir={ir} scenario={corrida.scenario} result={corrida.result} />
            : <p>{S.app.sinResultados} {runs.length > 0 && S.app.sinCorridaActual}</p>}
        </section>
      )}
      {modo === 'Comparar' && <section className="zona-resultados">
        <label>{S.app.escenarioBase} <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
          {Object.keys(escenarios).map((name) => <option key={name} value={name}>{etiquetaEscenario(name, escenarios)}</option>)}
        </select></label>
        {comparable && ir !== null
          ? <CompareView ir={ir} comparison={compare(ordered.map((r) => r.result))}
              runs={ordered.map((r) => runMetaFrom(etiquetaEscenario(r.scenarioName, escenarios), r.inputs.scenario as unknown as ResolvedScenario, r.result))}
              scenarioNames={ordered.map((r) => etiquetaEscenario(r.scenarioName, escenarios))}
              baseTimeUnit={(ordered[0]!.inputs.scenario as unknown as ResolvedScenario).run.baseTimeUnit ?? 's'} />
          : <p>{S.app.sinComparacion}</p>}
        {ordered.map((run) => <p key={run.id}>{S.app.corridaResumen(
          etiquetaEscenario(run.scenarioName, escenarios),
          run.inputs.modelRevision,
          run.inputs.scenarioRevision,
          String((run.inputs.scenario.run as Record<string, unknown>).seed ?? 1),
          String((run.inputs.scenario.run as Record<string, unknown>).currency ?? ''),
        )}</p>)}
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
              {S.app.escenario}
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
            {/* Correr, el progreso y cancelar viven en la barra superior (#237): la acción
                primaria de la app es una sola y está siempre a la vista. */}
            {sim.tipo === 'error' && (
              <p role="alert" className="error">
                {S.app.errorSimular(sim.mensaje)}
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
              {S.app.verCuellos}
            </label>
            <p className="vacio">
              {corrida === null
                ? S.app.cuellosSinCorrida
                : (nombreDeCuello(corrida.result.bottlenecks[0]?.elementId, ir) ??
                  S.app.cuellosSinEspera)}
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
        {/* Un proyecto = un diagrama por ahora (LILA-208): la pestaña no cambia de nada, así que
            no es un botón; el ✕ cierra el proyecto y el «+» abre uno nuevo, los dos por
            `projectAction('new')`, que ya trae la guardia de cambios sin guardar. */}
        <span className="pestana activa">
          {archivo}
          <button type="button" className="cerrar" aria-label={S.app.cerrarArchivo(archivo)} title={S.app.cerrarDiagrama} disabled={ioBusy || modelador === null} onClick={() => void projectAction('new')}>✕</button>
        </span>
        <button type="button" className="boton icono" aria-label={S.app.nuevoDiagrama} title={S.app.nuevoDiagrama} disabled={ioBusy || modelador === null} onClick={() => void projectAction('new')}>+</button>
      </nav>

      {/* Barra de estado del artefacto: validación, escenario y semilla a la izquierda; densidad
          y zoom a la derecha. Los mensajes largos (E/S, tema, importación) van al final para no
          descolocar esa retícula. Los conteos son los mismos que los chips del lienzo (#241). */}
      <footer className="estado">
        <span className={`marca${validacion.errores > 0 ? ' error' : ''}`}>{S.app.errores(validacion.errores)}</span>
        <span className={`marca${validacion.avisos > 0 ? ' aviso' : ''}`}>{S.app.avisos(validacion.avisos)}</span>
        <span className="separador" />
        <span>{S.app.escenario} <span className="acento">{etiquetaEscenario(escenarioId, escenarios)}</span></span>
        <span>{S.app.semilla(semillaEscenario(escenarioId, escenarios))}</span>
        <span className="hueco" />
        <span>{S.app.densidadEstado(S.app.densidadNombre(densidad))}</span>
        <button
          type="button"
          className="enlace"
          onClick={() => {
            modelador?.ajustar();
          }}
        >
          {S.app.zoom(Math.round(estado.zoom * 100))}
        </button>
        {suelto && (
          <span className="aviso">{S.app.diagramaSuelto}</span>
        )}
        {ioError !== null && <span role="alert" className="error">{ioError}</span>}
        {perdidasAlExportar.length > 0 && (
          <span role="alert" className="error">
            {S.app.perdidaAlExportar(perdidasAlExportar.length, perdidasAlExportar.join(' · '))}
          </span>
        )}
        {estado.avisos - estado.perdidas.length > 0 && (
          <span role="alert" className="aviso">
            {S.app.avisosAlImportar(estado.avisos - estado.perdidas.length)}
          </span>
        )}
        {estado.error !== null && (
          <span role="alert" className="error">{S.app.errorAbrirDiagrama(estado.error)}</span>
        )}
        {avisoTema !== null && (
          <span role="alert" className="error">{S.app.errorTema(avisoTema)}</span>
        )}
      </footer>
    </div>
  );
}

