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
import { flushSync } from 'react-dom';
import { failStartup, finishStartup, setStartupLocale } from './startup';
import { parseBpmn } from '@lila/engine/bpmn';
import { resolveExtends, type ResolvedScenario } from '@lila/engine/schema';
import { compare } from '@lila/engine';
import { CompareView } from './CompareView';
import { runMetaFrom } from './compareWarnings';
import { changeToken, defaultElement, defaultScenarios, newModelXml, nextScenarioRevisions, projectStore, readProject } from './project';
import type { ProcessIR, SimulationProgress } from '@lila/engine';
import { Lienzo, type EstadoLienzo, type Modelador, type Servicios } from './Modeler';
import { Paleta } from './Paleta';
import { PaletaComandos, type Comando } from './PaletaComandos';
import { nombreDeTipo, PanelPropiedades } from './PropertiesPanel';
import { duplicarEscenario, problemasEscenario, ScenarioPanel } from './ScenarioPanel';
import { RailEscenarios } from './RailEscenarios';
import { ResultsView } from './ResultsView';
import { TokenSim } from './TokenSim';
import { prepareSimulation } from './simulationGate';
import type { ProjectDocument, StoredRun } from './store/ProjectStore';
import type { SaveOutcome, Ajustes, MenuAction, OpenPathRequest } from '../../desktop/src/bridge.js';
import type { Corrida } from './BottleneckOverlay';
import { problemasPorElemento } from './ValidationMarkers';
import { runInWorker } from './simulationClient';
import { buildReplay, LOG_SAMPLE_LIMIT } from './replay/replayModel';
import { Replay } from './replay/Replay';
import type { EventLogRow } from '@lila/engine';
import { applyTheme, tokenToCssVar, type Theme } from './theme/applyTheme';
import { TOKEN_NAMES } from './theme/tokens';
import { esDelUsuario, saneaTemas, temaDe, type TemaGuardado } from './theme/temas';
import { temaPorDefecto, type TemaId } from './theme/temaPorDefecto';
// Aliased: `Ajustes` above is already the bridge's settings-payload type (`readSettings`/
// `writeSettings`); this is the dialog body component of the same name (`settings/Ajustes.tsx`).
import { Ajustes as AjustesDialogo } from './settings/Ajustes';
import { About, Karaoke } from './About';
import { abrirVentanaFlotante, geometriaDe, geometriaValida, VentanaFlotante, type Geometria } from './VentanaFlotante';
import { Bienvenida } from './Bienvenida';
import type { Recent } from '../../desktop/src/bridge.js';
import { LOCALES, PREFERENCIAS, setLocale, strings, useLocale, useStrings, type Preferencia } from './i18n';
import { ATAJOS, atajoPorId, coincide, etiqueta, MAC, tooltip, type AtajoId, type AtajoPropio } from './atajos';
import { DENSIDAD_IDS, MODO_IDS, PESTANA_IDS, type Densidad, type ModoId, type PestanaId, type VerboPerdida } from './ids';
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
import './theme/montana.css';

/** `file` (LILA-072): el `.bpmn` pulsado, cuando no es el `model.bpmn` de la carpeta. */
type ProjectAction = 'new' | 'open' | 'openFile' | 'bpmn' | { readonly recent: string; readonly file?: string };

/**
 * Nombre del cuello de botella principal para el panel derecho (#226): antes se enseñaba el id
 * BPMN en crudo (`Task_Preparar`), que no es lo que el usuario ve en el lienzo. El id se añade
 * entre paréntesis solo cuando aporta algo —tareas sin nombre, o ids sanitizados por el motor—,
 * porque sigue siendo la única clave (regla 5 de BACKLOG.md). `undefined` = no hubo cuellos.
 */
function nombreDeCuello(id: string | undefined, ir: ProcessIR | null): string | undefined {
  const S = strings();
  if (id === undefined) return undefined;
  const nombre = ir?.nodes[id]?.name;
  return nombre === undefined || nombre === '' || nombre === id ? id : S.app.nombreDeCuello(nombre, id);
}

/** Temas integrados, servidos como JSON estáticos (`vite.config.ts`): editar y recargar cambia la UI. */
/** Sus ids son los mismos en todos los idiomas —lo garantiza `Strings`—; su rótulo, no. */
const temaIds = (): TemaId[] => Object.keys(strings().app.temas) as TemaId[];

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
    const idioma = localStorage.getItem('lila.idioma');
    // Empty or blank is "never saved" (320 by default), not 0 clamped up to 300 (QA of #390).
    const panelAncho = Number(localStorage.getItem('lila.panelAncho')?.trim() || NaN);
    // Left column widths (#406), same "blank is never saved" rule.
    const paletaAncho = Number(localStorage.getItem('lila.paletaAncho')?.trim() || NaN);
    const railAncho = Number(localStorage.getItem('lila.railAncho')?.trim() || NaN);
    // Los temas del usuario (LILA-114) van en su propia clave, y en escritorio en `ajustes.temas`:
    // es una lista, no un texto, así que aquí se guarda serializada. `saneaTemas` valida lo que
    // salga de cualquiera de los dos sitios, que son igual de ajenos.
    //
    // Su `try` es aparte del de las otras dos preferencias (QA de #277): `lila.temas` es lo único
    // que pasa por `JSON.parse`, y un valor corrupto ahí se llevaba por delante el tema elegido y
    // la densidad, que son texto y no pueden romperse.
    let temas: unknown = null;
    try { temas = JSON.parse(localStorage.getItem('lila.temas') ?? 'null'); } catch { /* lista ilegible: se pierde solo ella */ }
    // Geometry of the detached scenario window (design 2c): same reasoning, its own `try`.
    let ventana: unknown = null;
    try { ventana = JSON.parse(localStorage.getItem('lila.ventanaEscenario') ?? 'null'); } catch { /* se pierde solo ella */ }
    // Per-mode panel visibility (#412): its own `try` too; `sanearPaneles` checks the shape.
    let paneles: unknown = null;
    try { paneles = JSON.parse(localStorage.getItem('lila.paneles') ?? 'null'); } catch { /* only this one is lost */ }
    return {
      ...(tema === null ? {} : { tema }),
      ...(densidad === null ? {} : { densidad }),
      ...(idioma === null ? {} : { idioma }),
      ...(Number.isFinite(panelAncho) ? { panelAncho } : {}),
      ...(Number.isFinite(paletaAncho) ? { paletaAncho } : {}),
      ...(Number.isFinite(railAncho) ? { railAncho } : {}),
      ...(paneles === null ? {} : { paneles: paneles as NonNullable<Ajustes['paneles']> }),
      ...(temas === null ? {} : { temas: temas as readonly TemaGuardado[] }),
      ...(geometriaValida(ventana) ? { ventanaEscenario: ventana } : {}),
    };
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
    if (ajustes.idioma !== undefined) localStorage.setItem('lila.idioma', ajustes.idioma);
    if (ajustes.temas !== undefined) localStorage.setItem('lila.temas', JSON.stringify(ajustes.temas));
    if (ajustes.panelAncho !== undefined) localStorage.setItem('lila.panelAncho', String(ajustes.panelAncho));
    if (ajustes.paletaAncho !== undefined) localStorage.setItem('lila.paletaAncho', String(ajustes.paletaAncho));
    if (ajustes.railAncho !== undefined) localStorage.setItem('lila.railAncho', String(ajustes.railAncho));
    if (ajustes.paneles !== undefined) localStorage.setItem('lila.paneles', JSON.stringify(ajustes.paneles));
    if (ajustes.ventanaEscenario !== undefined) localStorage.setItem('lila.ventanaEscenario', JSON.stringify(ajustes.ventanaEscenario));
  } catch { /* sin almacenamiento (modo privado): no persiste, no rompe */ }
}
/** El valor guardado, si sigue siendo uno de los válidos; si no, el de fábrica. */
function valido<T extends string>(valor: string | undefined, validas: readonly T[], porDefecto: T): T {
  return validas.includes(valor as T) ? (valor as T) : porDefecto;
}
/**
 * Si el tema se lee claro (letra oscura sobre fondo claro) — Papel, Tieso y Montana lo son hoy,
 * Eva-01 y Akira no. Decide qué `color-scheme` llevan los controles nativos (diseño 2d): sin
 * eso el `<select>` pinta sus `<option>` y el selector de fecha con los colores que trae por
 * fábrica el navegador, que son los de un tema oscuro, y salen ilegibles sobre uno claro.
 *
 * Ningún tema trae una marca «soy claro» (`docs/THEMES.md`) — ninguno la necesitaba antes de
 * esto—, así que se calcula del mismo `bg.base` que ya trae cada uno, con la misma caída a
 * Eva-01 que usa `aplicarTema` para el token que falte.
 * ponytail: umbral de luminancia relativa, no la fórmula de contraste completa — alcanza para
 * decidir claro/oscuro, no para medir accesibilidad.
 */
export function temaClaro(t: Theme | null | undefined): boolean {
  const crudo = (t?.tokens?.['bg.base'] ?? '#12101A').replace('#', '');
  // `#RGB`, `#RRGGBB` o `#RRGGBBAA` son los tres formatos válidos (`theme/temas.ts`, `HEX`); un
  // `#RGB` corto se expande antes de leerlo (QA de la ronda 1 de #392: sin esto, `#fff` no casaba
  // con la expresión de 6 dígitos de abajo y `temaClaro` lo daba por oscuro).
  const seis = crudo.length === 3 ? [...crudo].map((c) => c + c).join('') : crudo;
  const hex = /^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/.exec(seis);
  if (hex === null) return false;
  const canal = (i: number): number => Number.parseInt(hex[i] ?? '00', 16) / 255;
  return 0.2126 * canal(1) + 0.7152 * canal(2) + 0.0722 * canal(3) > 0.5;
}

/**
 * Aplica el tema y borra las variables en línea que el anterior dejó puestas y este no trae. Sin
 * eso, `docs/THEMES.md` mentía: un tema parcial (legal, y lo que sale de «Importar») heredaba en
 * silencio los tokens del que estuviera puesto, así que el mismo archivo se veía distinto según lo
 * que hubiera antes. Se borra **después** de escribir, no antes, para no perder la otra garantía
 * de `applyTheme`: un tema malo lanza sin tocar nada y deja el anterior intacto.
 */
function aplicarTema(t: Theme): void {
  applyTheme(t);
  const raiz = document.documentElement;
  for (const token of TOKEN_NAMES) if (t.tokens[token] === undefined) raiz.style.removeProperty(tokenToCssVar(token));
}

async function cargarTema(id: TemaId): Promise<Theme> {
  const S = strings();
  const r = await fetch(`./${id}.json`);
  if (!r.ok) throw new Error(S.app.errorTemaHttp(r.status));
  return r.json() as Promise<Theme>;
}

/**
 * Shortcut text for a tooltip, from the one map (#413): ` (⌘S)` on Mac, ` (Ctrl+S)` elsewhere.
 * `soloDesktop` entries are announced only inside Electron: the browser keeps ⌘N, ⌘, and ⌘1…⌘6.
 */
const DESKTOP = typeof window !== 'undefined' && typeof window.lila !== 'undefined';
function atajo(id: AtajoId): string {
  const a = atajoPorId(id);
  return a.soloDesktop && !DESKTOP ? '' : tooltip(a, MAC);
}
/** Where a key without ⌘/Ctrl is somebody's typing, not a shortcut. */
const CAMPO = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
/** A modal dialog or the welcome screen is up: no shortcut reaches what is behind it. */
const bloqueado = (): boolean => document.querySelector('dialog[open], .bienvenida, .karaoke') !== null;
/** An open dropdown of the bar takes Esc for itself: it closes on it (QA of #436, M2). */
const menuAbierto = (): boolean => document.querySelector('.menu-archivo[open], .menu-vista[open]') !== null;

/**
 * Los servicios del lienzo para la paleta (LILA-207). El getter de `Modelador` lanza mientras no
 * haya un BPMN abierto; devolver `null` deja la paleta pintada pero inerte en vez de tumbar el
 * render.
 */
function serviciosDe(modelador: Modelador | null): Servicios | null {
  try { return modelador?.servicios ?? null; } catch { return null; }
}

/** Right panel width limits, in px (design 2a, `docs/design/COMPARACION-2026-09-07.md`). */
const PANEL_MIN = 300;
const PANEL_MAX = 520;
const limitar = (px: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(px)));
const anchoPanel = (px: number): number => limitar(px, PANEL_MIN, PANEL_MAX);
/** Left column width limits (#406): the shape palette in Model, the scenario rail in Simulate. */
const PALETA_MIN = 180;
const PALETA_MAX = 360;
const RAIL_MIN = 160;
const RAIL_MAX = 320;
/** Width of the compact palette, and the drag width under which the palette snaps to it (#406). */
const PALETA_COMPACTA = 48;
const PALETA_SALTO = 114;

/** The four regions that can be hidden, per mode (#412). */
type Region = 'izquierda' | 'derecha' | 'diagramas' | 'estado';
const REGIONES: readonly Region[] = ['izquierda', 'derecha', 'diagramas', 'estado'];
type Paneles = Record<ModoId, Record<Region, boolean>>;
/** Modes that draw a left column: the palette in Model, the rail in Simulate. */
const conIzquierda = (modo: ModoId): boolean => modo === 'modelar' || modo === 'simular';
/**
 * Saved visibility, trimmed to the known modes and regions: anything missing or not a boolean is
 * visible, so a corrupt or older value can only show a panel, never lose one.
 */
function sanearPaneles(valor: unknown): Paneles {
  const guardado = (valor !== null && typeof valor === 'object' ? valor : {}) as Record<string, unknown>;
  return Object.fromEntries(MODO_IDS.map((modo) => {
    const entrada = (guardado[modo] !== null && typeof guardado[modo] === 'object' ? guardado[modo] : {}) as Record<string, unknown>;
    return [modo, Object.fromEntries(REGIONES.map((r) => [r, typeof entrada[r] === 'boolean' ? entrada[r] : true]))];
  })) as Paneles;
}
/** Ids of the regions, for `aria-controls` on their toggles. */
const ID_REGION: Record<Region, string> = { izquierda: 'region-izquierda', derecha: 'region-derecha', diagramas: 'region-diagramas', estado: 'region-estado' };
/**
 * Toggle icon (#412): the window frame with the region it stands for as a rectangle, filled
 * while shown (`app.css`). Square corners, like the rest of the system.
 */
const RECT_REGION: Record<Region, { x: number; y: number; width: number; height: number }> = {
  izquierda: { x: 3, y: 3, width: 3, height: 7 },
  derecha: { x: 10, y: 3, width: 3, height: 7 },
  diagramas: { x: 6, y: 10, width: 4, height: 1.5 },
  estado: { x: 3, y: 11.5, width: 10, height: 1.5 },
};
function IconoRegion({ region }: { region: Region | null }): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <rect x="2.5" y="2.5" width="11" height="11" />
      {region === null
        ? REGIONES.map((r) => <rect key={r} className="region" {...RECT_REGION[r]} />)
        : <rect className="region" {...RECT_REGION[region]} />}
    </svg>
  );
}
/** Focus the toggle of `region` that is on screen: the button group or, when narrow, the «View» menu. */
function enfocarToggle(region: Region): void {
  const boton = document.querySelector<HTMLElement>(`.vista-grupo [data-region="${region}"]`);
  if (boton !== null && boton.offsetParent !== null) boton.focus();
  else document.querySelector<HTMLElement>('.menu-vista > summary')?.focus();
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
  const S = strings();
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
  const S = strings();
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
  const S = useStrings();
  const [modelador, setModelador] = useState<Modelador | null>(null);
  useEffect(() => { if (modelador !== null) finishStartup(); }, [modelador]);
  const [estado, setEstado] = useState<EstadoLienzo>({
    zoom: 1,
    elementos: 0,
    avisos: 0,
    perdidas: [],
    refsRotas: [],
    error: null,
  });
  useEffect(() => { if (modelador === null && estado.error !== null) failStartup(); }, [modelador, estado.error]);
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
  /**
   * Bienvenida de escritorio (artboard 08): se enciende cuando el arranque no trae nada que
   * abrir por doble clic (`pendingOpenPath` → null) y la apaga `activate()`. En el navegador no
   * hay `window.lila`, así que nunca sale; lo que ve Pages no cambia.
   */
  const [bienvenida, setBienvenida] = useState(false);
  const [paletaAbierta, setPaletaAbierta] = useState(false);
  const [recientes, setRecientes] = useState<readonly Recent[]>([]);
  /** Recents for the desktop File dropdown (#411): fetched again every time it opens
   * (`alternarMenuArchivo`) instead of reusing `recientes` (that one is only for the welcome
   * screen), so opening one and reopening the menu shows the up-to-date list regardless of when
   * the welcome screen last ran. */
  const [recientesMenu, setRecientesMenu] = useState<readonly Recent[]>([]);
  const cerrarMenuFuera = useRef<{ menu: HTMLDetailsElement; cerrar: (e: PointerEvent) => void } | null>(null);
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
  const [confirmarPerdida, setConfirmarPerdida] = useState<VerboPerdida | null>(null);
  const respuestaPerdida = useRef<((acepta: boolean) => void) | null>(null);
  const exportDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (confirmarPerdida !== null && !exportDialog.current?.open) exportDialog.current?.showModal();
  }, [confirmarPerdida]);
  const [baseId, setBaseId] = useState('as-is.scenario.json');
  const adapter = projectStore(store);
  const [modo, setModo] = useState<ModoId>('modelar');
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [scenarioRevisions, setScenarioRevisions] = useState<Record<string, number>>({});
  const [archivo, setArchivo] = useState('model.bpmn');
  const [pestana, setPestana] = useState<PestanaId>('propiedades');
  // El lienzo no se monta hasta que el tema está resuelto: bpmn-js lee los colores de las
  // figuras de los tokens al montar (ver Modeler.tsx). `tema === undefined` es "todavía no se
  // sabe"; `null`, "no se pudo cargar, seguimos con los valores por defecto de tokens.css".
  // A partir de ahí ya no se remonta nunca: cambiar de tema es `modelador.repintar()`.
  const [tema, setTema] = useState<Theme | null | undefined>(undefined);
  const [avisoTema, setAvisoTema] = useState<string | null>(null);
  // Estos dos arrancan de fábrica y los pisa el primer efecto con lo que devuelva `preferencias()`:
  // en escritorio están en `userData` y leerlos es IPC, o sea asíncrono. Es el mismo instante en el
  // que `tema` deja de ser `undefined`, así que el lienzo nunca llega a ver el valor provisional.
  const [decoratedTheme, setDecoratedTheme] = useState<string | undefined>();
  const [temaId, setTemaId] = useState<string>(temaPorDefecto);
  /** Temas creados por el usuario en Ajustes → Apariencia (LILA-114). */
  const [temas, setTemas] = useState<readonly TemaGuardado[]>([]);
  const [densidad, setDensidad] = useState<Densidad>('normal');
  /** Width of the right panel (design 2a); the divider drags it and `recordar` keeps it. */
  const [panelAncho, setPanelAncho] = useState(320);
  const arrastre = useRef<{ x: number; ancho: number } | null>(null);
  /** Left column widths (#406): the palette in Model and the rail in Simulate, each its own. */
  const [paletaAncho, setPaletaAncho] = useState(236);
  const [railAncho, setRailAncho] = useState(212);
  const arrastreIzquierda = useRef<{ x: number; ancho: number } | null>(null);
  /** Compact (icons only) palette; lifted from `Paleta` so the divider can snap to it (#406). */
  const [compacta, setCompacta] = useState(() => {
    try { return localStorage.getItem('lila.paleta') === 'compacta'; } catch { return false; }
  });
  /**
   * Which regions each mode shows (#412). Written by the toggles only, through the ref, and
   * always whole — the desktop bridge merges shallowly, so a partial map would forget modes.
   */
  const [paneles, setPaneles] = useState<Paneles>(() => sanearPaneles(null));
  const panelesRef = useRef(paneles);
  /**
   * The right panel shown anyway while the scenario window is detached (#412). Not persisted:
   * the detached window hides the panel it came from, and each detach starts hidden again.
   */
  const [verConVentana, setVerConVentana] = useState(false);
  /**
   * Preferencia de idioma (LILA-210): `auto` sigue al sistema. Se guarda la preferencia y no el
   * idioma resuelto, y el idioma vivo lo lleva `i18n.ts` —de ahí `useLocale()`, que es lo que
   * pone al día lo que se pinta fuera de React y lo que va en la `key` de `TokenSim`—.
   */
  const [idioma, setIdioma] = useState<Preferencia>('auto');
  const locale = useLocale();
  const ajustesDialog = useRef<HTMLDialogElement>(null);
  /** The About window (#408, LILA-381), or `null` while closed. Same model as the scenario window. */
  const [ventanaAcerca, setVentanaAcerca] = useState<Window | null>(null);
  /** The Easter-egg karaoke overlay (QA of #387, Low): while it plays neither ⌘, nor the native
   * menu may open Settings or About on top of it. `Karaoke` keeps its timer in a `ref`, so the
   * re-render this state causes does not restart it. */
  const [karaoke, setKaraoke] = useState(false);
  const [escenarioId, setEscenarioId] = useState('as-is.scenario.json');
  /**
   * The scenario panel detached to its own window (design 2c), or `null` while docked. It is the
   * `Window` itself: `VentanaFlotante` portals into it from this same tree, so there is no state
   * to sync between the two.
   */
  const [ventanaEscenario, setVentanaEscenario] = useState<Window | null>(null);
  /** Last known geometry of that window; read with the preferences, written when it moves away. */
  const geomEscenario = useRef<Geometria | undefined>(undefined);
  const toggleEscenario = useRef<HTMLButtonElement>(null);
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
  /**
   * Event log of each run, by run id (#331). It is memory only, on purpose: `StoredRun` and the
   * `.lila` container carry the `RunResult`, not the log — up to ten thousand rows per run would
   * multiply the size of a saved project for something only the replay reads.
   *
   * // ponytail: reopening a `.lila` therefore animates nothing until the scenario is run again,
   * // which is what `S.animacion.sinLog` says. Upgrade path: an optional `log.jsonl` entry in
   * // the container, gated by a setting.
   */
  const logs = useRef(new Map<string, { rows: readonly EventLogRow[]; truncated: boolean }>());

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

  /** Última corrida válida del escenario elegido: la que pintan el overlay y la animación (#331). */
  const corridaActual = useMemo(
    () => [...runs].reverse().find((r) => r.scenarioName === escenarioId && r.inputs.modelRevision === revision
      && r.inputs.scenarioRevision === (scenarioRevisions[escenarioId] ?? 0)),
    [runs, escenarioId, revision, scenarioRevisions],
  );

  useEffect(() => {
    const run = corridaActual;
    setCorrida(run && ir ? { result: run.result, scenario: run.inputs.scenario as unknown as ResolvedScenario, originalIds: ir.source.originalIds } : null);
  }, [corridaActual, ir]);

  /**
   * Replay of that run's event log, or `null` when there is no run for the scenario or the log is
   * no longer in memory (a project reopened from a file). Rebuilt only when the run changes: it
   * walks the log once, and the clock of `Replay.tsx` reads it without touching the engine.
   */
  const replay = useMemo(() => {
    const log = corridaActual === undefined ? undefined : logs.current.get(corridaActual.id);
    if (log === undefined || ir === null || corridaActual === undefined) return null;
    return buildReplay(log.rows, ir, corridaActual.inputs.scenario as unknown as ResolvedScenario,
      { truncated: log.truncated });
  }, [corridaActual, ir]);

  useEffect(() => { adapter?.setDirty?.(dirty); }, [adapter, dirty]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    // Electron main coordina la confirmación nativa por el adaptador.
    if (!adapter?.onSaveRequested) window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [adapter, dirty]);
  const saveRef = useRef<() => Promise<SaveOutcome>>(async () => 'cancelled');
  saveRef.current = () => saveWithOutcome();
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
  async function aceptaPerdida(verbo: VerboPerdida): Promise<boolean> {
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
  async function guardar(saveAs = false, asFolder = false): Promise<boolean> {
    return await saveWithOutcome(saveAs, asFolder) === 'saved';
  }

  /** `asFolder` solo cuenta con `saveAs`: elige carpeta de proyecto en vez de `.lila` (ADR-027). */
  async function saveWithOutcome(saveAs = false, asFolder = false): Promise<SaveOutcome> {
    if (adapter === null || ioLock.current) return 'cancelled';
    // Guardar reescribe `model.bpmn` en disco: con pérdida pasa por el mismo diálogo que
    // exportar y no toca el archivo hasta que el usuario lo acepta (LILA-192). Cancelar
    // devuelve `false`, que es lo que el cierre de Electron lee como «no se guardó» y le hace
    // cancelar el cierre: la ventana sigue abierta con el diálogo delante, sin nada perdido.
    if (!await aceptaPerdida('guardar')) return 'cancelled';
    ioLock.current = true; setIoBusy(true); setIoError(null);
    try {
      const doc = await snapshot();
      // Un guardado normal en modo suelto escribe SOLO el `.bpmn` (`diagramOnly`, LILA-206): los
      // escenarios y las corridas siguen sin estar en disco. El token guardado avanza entonces
      // únicamente en la revisión del modelo y conserva los escenarios/corridas que SÍ estaban
      // guardados; con el token completo, editar un escenario y pulsar ⌘S dejaba el pie en
      // «Guardado» y la guardia de cierre dejaba salir sin escribirlo (LILA-208, hallazgo 2 del QA).
      const previo: readonly [string, number, Record<string, number>, string[]] | null =
        suelto && !saveAs && savedToken !== '' ? JSON.parse(savedToken) : null;
      const token = previo === null
        ? changeToken(doc.id, doc.model.revision, doc.scenarioRevisions, doc.runs.map((r) => r.id))
        : changeToken(doc.id, doc.model.revision, previo[2], previo[3]);
      const saved = await adapter.saveProject(doc, { saveAs, ...(asFolder ? { asFolder: true } : {}) });
      if (saved === null) return 'cancelled';
      // «Guardar como» crea el proyecto completo en la carpeta elegida: deja de ser suelto.
      if (saveAs) setSuelto(false);
      setSavedToken(token);
      // B puede cerrar antes del siguiente efecto de React; publicar el dirty confirmado.
      const unchanged = token === tokenRef.current && doc.model.revision === revisionRef.current;
      adapter.setDirty?.(!unchanged);
      return unchanged ? 'saved' : previo !== null ? 'diagram-only' : 'cancelled';
    } catch (e) { setIoError(e instanceof Error ? e.message : String(e)); return 'failed'; }
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
    // #420: the first IR of an opened project is a baseline, not a list of new nodes to seed.
    nodosVistos.current = null; sembrados.current.clear();
    setEscenarioId(first); setBaseId(first); setSeleccion(null); setCorrida(null); setIr(parsed.ir); setModo('modelar'); setBienvenida(false);
    setSavedToken(saved ? changeToken(doc.id, doc.model.revision, doc.scenarioRevisions, doc.runs.map((r) => r.id)) : '');
    return true;
  }
  const sessionRestored = useRef(false);
  useEffect(() => {
    if (modelador === null || sessionRestored.current) return;
    sessionRestored.current = true;
    const doc = adapter?.restoreSession?.();
    if (!doc) return;
    ioLock.current = true; setIoBusy(true);
    void activate(doc, true, tokenRef.current)
      .catch((error: unknown) => setIoError(error instanceof Error ? error.message : String(error)))
      .finally(() => { ioLock.current = false; setIoBusy(false); });
  }, [modelador, adapter]);

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
      if (kind === 'open' || kind === 'openFile') {
        const doc = await adapter.openProject(kind === 'openFile' ? { fileOnly: true } : undefined);
        if (doc) await activate(doc, true, beforeToken); return;
      }
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

  /**
   * Cambiar de escenario invalida el resultado anterior: el overlay se limpia aquí y se vuelve a
   * pintar cuando termine la corrida nueva. La corrida en vuelo es del escenario viejo, así que se
   * mata: si no, terminaría después y pintaría sus cuellos de botella bajo el nombre del nuevo.
   */
  function elegirEscenario(id: string): void {
    setEscenarioId(id);
    cancelarCorrida();
    const run = latest.find((r) => r.scenarioName === id);
    setCorrida(run && ir ? { result: run.result, scenario: run.inputs.scenario as unknown as ResolvedScenario, originalIds: ir.source.originalIds } : null);
  }

  /** Every write to an existing scenario: the panel (docked or detached) and the #420 seeding. */
  function cambiarEscenario(archivo: string, escenario: Record<string, unknown>): void {
    setEscenarios((previos) => ({ ...previos, [archivo]: escenario }));
    // Editing an `extends` parent also invalidates its descendants.
    setScenarioRevisions((previous) => nextScenarioRevisions(archivo, escenarios, previous));
    // The scenario changed, so the result on screen belongs to the previous one: same treatment
    // as picking another scenario in the selector (LILA-064).
    cancelarCorrida();
    setCorrida(null);
  }

  /** A new scenario (a duplicate, from the panel or the rail) becomes the active one. */
  function anadirEscenario(archivo: string, escenario: Record<string, unknown>): void {
    setEscenarios((previos) => ({ ...previos, [archivo]: escenario }));
    // Cualquier padre extends editado invalida también sus descendientes.
    setScenarioRevisions((previous) => nextScenarioRevisions(archivo, escenarios, previous));
    setEscenarioId(archivo);
    cancelarCorrida();
    setCorrida(null);
  }

  /**
   * A column divider (design 2a, #406): primary-button drag and arrow keys, persisted when the
   * gesture ends and only if the width changed. Arrows follow the ARIA splitter convention: they
   * move the divider, so ArrowLeft widens the right panel and narrows the left column (`signo`).
   * Double-click and Enter hide or show that side (#412) instead; while it is hidden, dragging and
   * arrows do nothing. `resolver` turns a proposed width into the one to keep (clamped, or the
   * palette's compact snap).
   */
  function divisor(o: {
    valor: number;
    signo: 1 | -1;
    resolver: (px: number, teclado: boolean) => number;
    fijar: (px: number) => void;
    persistir: (px: number) => void;
    alternar: () => void;
    oculto: boolean;
    gesto: React.MutableRefObject<{ x: number; ancho: number } | null>;
  }): React.HTMLAttributes<HTMLDivElement> {
    const mover = (x: number): number => o.resolver(o.gesto.current!.ancho + o.signo * (x - o.gesto.current!.x), false);
    const terminar = (px: number): void => {
      const inicial = o.gesto.current!.ancho;
      o.gesto.current = null;
      o.fijar(px);
      if (px !== inicial) o.persistir(px);
    };
    // A cancelled or lost capture ends the drag where the last move left it.
    const soltar = (): void => { if (o.gesto.current !== null) terminar(o.valor); };
    return {
      onPointerDown: (e) => {
        if (e.button !== 0 || o.oculto) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        o.gesto.current = { x: e.clientX, ancho: o.valor };
      },
      onPointerMove: (e) => { if (o.gesto.current !== null) o.fijar(mover(e.clientX)); },
      onPointerUp: (e) => { if (o.gesto.current !== null) terminar(mover(e.clientX)); },
      onPointerCancel: soltar,
      onLostPointerCapture: soltar,
      onDoubleClick: o.alternar,
      onKeyDown: (e) => {
        if (e.key === 'Enter') { e.preventDefault(); o.alternar(); return; }
        const paso = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
        if (paso === 0 || o.oculto) return;
        e.preventDefault();
        const px = o.resolver(o.valor + o.signo * paso, true);
        o.fijar(px);
        if (px !== o.valor) o.persistir(px);
      },
    };
  }

  // Único punto donde se pinta o se limpia el overlay. Todo lo que puede cambiarlo —terminar una
  // corrida, elegir otro escenario, abrir otro `.bpmn`, mover el interruptor, remontar el lienzo—
  // pasa por aquí, y `cuellos` es idempotente, así que repetirlo no acumula nada. En «Validar
  // rutas» (LILA-065) se apaga: la animación de tokens no convive con la tinta de cuellos.
  useEffect(() => {
    // El idioma está en las dependencias porque la etiqueta del overlay se escribe en el lienzo,
    // fuera de React: sin esto se quedaría en el idioma en el que se pintó (LILA-210).
    modelador?.cuellos(corrida, modo !== 'rutas' && modo !== 'animar' && verCuellos);
  }, [modelador, corrida, verCuellos, modo, locale]);

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
      // The messages of `problemasEscenario` are the engine's (zod and `validateScenario`) and
      // are shown verbatim; since #280 the engine is asked for them in the active locale.
      const problemas = problemasEscenario(resuelto, ir, locale);
      // ponytail (#409): an empty process («New») is not an error yet. Nothing to filter here:
      // `E-SIN-START`/`E-SIN-END` come from the engine's full `validate()`, which the web app only
      // runs at Run time (`simulationGate.ts`); `validateScenario` never emits them.
      if (error !== null) problemas.unshift({ ruta: 'extends', mensaje: error, severidad: 'error' });
      // Sin figura: archivos ilegibles del proyecto, el diagrama que no abrió y los avisos de importar.
      return problemasPorElemento(problemas, { avisos: estado.avisos, errores: projectProblems.length + (estado.error === null ? 0 : 1) });
    },
    // The locale is in the dependencies for two reasons now: `escenarioResuelto` calls
    // `strings()` inside and this `useMemo` caches the text it returned (LILA-210), and since
    // #280 it also picks the language of the engine messages. Without it a broken `extends` —and
    // the whole lint— would stay in the language it was resolved in.
    [escenarioId, escenarios, ir, estado.avisos, estado.error, projectProblems, locale],
  );

  // Único punto donde se pintan o se quitan los marcadores. Cualquier cosa que cambie los
  // problemas —editar el escenario en el panel, editar el diagrama (revision -> `ir` nuevo),
  // abrir otro proyecto, cambiar de tema (lienzo remontado)— pasa por aquí, y
  // `Modelador.validacion` es idempotente. En «Validar rutas» (LILA-065) se apaga: los discos de
  // validación no se pintan sobre la animación de tokens.
  useEffect(() => {
    // Same reason as the overlay for carrying the locale: the `title` of the disc is written by
    // `ValidationMarkers` onto the canvas DOM. The messages inside are the engine's, and since
    // #280 `validacion` is already recomputed in the active locale (see the `useMemo` above).
    modelador?.validacion(modo === 'rutas' || modo === 'animar' ? null : validacion);
  }, [modelador, validacion, modo, locale]);

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

  /**
   * #420: a start or task drawn on the canvas gets `defaultElement` in each BASE scenario (the
   * ones without `extends`), so a process built from «New» runs with numbers. Only nodes new
   * against the previous IR, only entries that do not exist, and only the first start with
   * arrivals (`triggerCount` or `interTriggerTimer`). A seeded node that goes away (delete, ⌘Z) takes its untouched seed with it: an entry
   * for an id that is not in the model is E-ELEMENTO-DESCONOCIDO and would block Run.
   * ponytail: «untouched» is a JSON.stringify comparison with the seed and the seeds are tracked per
   * id, not per scenario; an edit reverted by hand in another key order counts as edited. Move to a
   * per-scenario record with a structural equal if that ever matters.
   */
  const nodosVistos = useRef<Set<string> | null>(null);
  const sembrados = useRef(new Map<string, Record<string, unknown>>());
  useEffect(() => {
    if (ir === null) return;
    const vistos = nodosVistos.current;
    nodosVistos.current = new Set(Object.keys(ir.nodes));
    // The first IR after opening a project is only a baseline: opening never modifies it.
    if (vistos === null) return;
    const nuevos = Object.keys(ir.nodes).filter((id) => !vistos.has(id));
    const idos = [...sembrados.current.keys()].filter((id) => !(id in ir.nodes));
    if (nuevos.length === 0 && idos.length === 0) return;
    const igual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
    for (const [archivo, escenario] of Object.entries(escenarios)) {
      if (escenario['extends'] !== undefined) continue;
      const elements = { ...(escenario['elements'] as Record<string, Record<string, unknown>> | undefined) };
      let cambio = false;
      for (const id of idos) {
        if (id in elements && igual(elements[id], sembrados.current.get(id))) { delete elements[id]; cambio = true; }
      }
      for (const id of nuevos) {
        const type = ir.nodes[id]!.type;
        if ((type !== 'start' && type !== 'task') || elements[id] !== undefined) continue;
        if (type === 'start' && Object.entries(elements).some(([otro, e]) => ir.nodes[otro]?.type === 'start' && (e['triggerCount'] !== undefined || e['interTriggerTimer'] !== undefined))) continue;
        elements[id] = defaultElement(type);
        sembrados.current.set(id, elements[id]);
        cambio = true;
      }
      if (cambio) cambiarEscenario(archivo, { ...escenario, elements });
    }
    for (const id of idos) sembrados.current.delete(id);
    // Only a new IR is a new diagram; `escenarios` is read as it is when the diagram changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ir]);

  useEffect(() => {
    void preferencias().then(async (raw) => {
      const guardadas = raw && typeof raw === 'object' ? raw : {};
      const mios = saneaTemas(guardadas.temas);
      setTemas(mios);
      // Un tema del usuario que sigue en la lista vale como elección; si no, se cae al integrado
      // (o al Lila del esquema del sistema, sin guardarlo), igual que con un id de tema borrado.
      const id = temaDe(guardadas.tema ?? '', mios)?.id ?? valido(guardadas.tema, temaIds(), temaPorDefecto());
      setTemaId(id);
      setDensidad(valido(guardadas.densidad, DENSIDAD_IDS, 'normal'));
      if (typeof guardadas.panelAncho === 'number') setPanelAncho(anchoPanel(guardadas.panelAncho));
      if (typeof guardadas.paletaAncho === 'number') setPaletaAncho(limitar(guardadas.paletaAncho, PALETA_MIN, PALETA_MAX));
      if (typeof guardadas.railAncho === 'number') setRailAncho(limitar(guardadas.railAncho, RAIL_MIN, RAIL_MAX));
      panelesRef.current = sanearPaneles(guardadas.paneles);
      setPaneles(panelesRef.current);
      geomEscenario.current = guardadas.ventanaEscenario;
      // Un valor guardado que ya no vale —de una versión anterior, o de un `estado.json` tocado a
      // mano— cae en `auto`, que es arrancar en el idioma del sistema.
      const preferido = valido(guardadas.idioma, PREFERENCIAS, 'auto');
      setIdioma(preferido);
      setLocale(preferido);
      setStartupLocale(document.documentElement.lang);
      try {
        const t = temaDe(id, mios)?.tema ?? (await cargarTema(id as TemaId));
        aplicarTema(t);
        setDecoratedTheme(id === 'montana' ? id : undefined);
        setTema(t);
      } catch (e: unknown) {
        // Un tema roto no puede dejar la app en blanco: se avisa y se sigue con Eva-01, que
        // es lo que `tokens.css` trae por defecto.
        setAvisoTema(e instanceof Error ? e.message : String(e));
        setTema(null);
      }
    }).catch(() => {
      // Malformed preferences must not leave the initial canvas permanently unmounted.
      setTema(null);
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

  /**
   * Único punto donde se aplica un tema: el integrado se pide por `fetch` y el del usuario sale de
   * `lista` (LILA-114), que se pasa a mano porque quien acaba de editarla todavía no la ve en el
   * estado de React.
   */
  async function seleccionarTema(id: string, lista: readonly TemaGuardado[] = temas): Promise<void> {
    // '' means "no explicit choice, follow the system" (Appearance's delete button, #422 QA S1):
    // resolve it to a concrete Lila id to actually apply and show in the selector, but persist the
    // ORIGINAL `id` — so '' — instead of the resolved one. Persisting the resolved id would freeze
    // the app on today's OS scheme, since `preferencias()` would read that concrete id back as an
    // explicit choice on every future launch, even after the OS scheme changes.
    const idAplicado = id === '' ? temaPorDefecto() : id;
    try {
      const t = esDelUsuario(idAplicado) ? temaDe(idAplicado, lista)?.tema : await cargarTema(idAplicado as TemaId);
      if (t === undefined) return;
      aplicarTema(t);
      setDecoratedTheme(idAplicado === 'montana' ? idAplicado : undefined);
      // El lienzo NO se remonta (LILA-113): `repintar` relee los tokens en el renderer vivo de
      // bpmn-js y redibuja las figuras, así que la pila de deshacer y la selección siguen ahí.
      modelador?.repintar();
      setTema(t);
      setAvisoTema(null);
      if (idAplicado !== temaId) {
        setTemaId(idAplicado);
        recordar({ tema: id });
      }
    } catch (e: unknown) {
      setAvisoTema(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Cambiar de idioma no recarga nada: `setLocale` avisa a todos los componentes suscritos con
   * `useStrings()` y el árbol se repinta con el catálogo nuevo. El lienzo no se remonta (la pila
   * de deshacer y la selección siguen ahí); lo imperativo —el `title` del minimapa, la animación
   * de tokens, el overlay de cuellos— lo rehacen sus efectos con el idioma en las dependencias.
   */
  function cambiarIdioma(preferido: Preferencia): void {
    setIdioma(preferido);
    setLocale(preferido);
    recordar({ idioma: preferido });
  }

  /**
   * Lo que Apariencia devuelve: la lista nueva de temas del usuario y cuál queda activo. Guardar y
   * aplicar en la misma llamada es lo que hace que editar un token sea la vista previa —la app
   * entera se repinta— sin que el editor tenga que conocer `applyTheme`.
   */
  function guardarTemas(lista: readonly TemaGuardado[], seleccion: string = temaId): void {
    setTemas(lista);
    recordar({ temas: lista });
    void seleccionarTema(seleccion, lista);
  }

  /**
   * Único despachador de acciones globales: los atajos del navegador y el menú nativo de Electron
   * (`window.lila.onMenu`) llaman a lo mismo que los botones de la barra.
   */
  function ejecutar(accion: MenuAction): void {
    if (accion === 'ajustes') { if (!karaoke && !ajustesDialog.current?.open) ajustesDialog.current?.showModal(); }
    else if (accion === 'acerca') abrirAcerca();
    else if (accion === 'nuevo') void projectAction('new');
    else if (accion === 'abrir') void projectAction('open');
    else if (accion === 'abrirArchivo') void projectAction('openFile');
    else if (accion === 'guardar') void guardar();
    else if (accion === 'guardarComo') void guardar(true);
    else if (accion === 'guardarComoCarpeta') void guardar(true, true);
    // A shortcut the native menu owns (#413): same handlers as the keyboard; unknown ids are ignored.
    else if ('atajo' in accion) { if (Object.hasOwn(atajosRef.current, accion.atajo) && !bloqueado()) atajosRef.current[accion.atajo as AtajoPropio](); }
    else void projectAction({ recent: accion.openRecent });
  }
  const ejecutarRef = useRef(ejecutar);
  ejecutarRef.current = ejecutar;

  /**
   * `onToggle` of the bar's dropdowns — File (#411, in both modes) and View (#412): on opening it
   * closes the other one, arms the click-outside listener and, for File in desktop mode, asks the
   * bridge for the recents (so the dropdown shows the up-to-date list, not whatever was there when
   * the app started); on closing — or on reopening, in case the previous close never fired
   * `toggle` — it removes that listener. `<details>` has no built-in click-outside close (that's a
   * `<dialog>`/popover feature); `Esc` is still handled by each dropdown's `onKeyDown`.
   */
  function alternarMenu(e: React.SyntheticEvent<HTMLDetailsElement>): void {
    const el = e.currentTarget;
    // `toggle` fires late: when one dropdown opens and closes the other, the other's «closed»
    // event arrives after this one armed its listener. A closing dropdown may only remove the
    // listener it armed itself (seams QA of #433, S1b).
    const armado = cerrarMenuFuera.current;
    if (armado !== null && (el.open || armado.menu === el)) {
      document.removeEventListener('pointerdown', armado.cerrar);
      cerrarMenuFuera.current = null;
    }
    if (!el.open) return;
    for (const otro of document.querySelectorAll<HTMLDetailsElement>('.barra > details[open]')) {
      if (otro !== el) otro.open = false;
    }
    if (DESKTOP && el.classList.contains('menu-archivo')) void window.lila?.listRecents().then(setRecientesMenu).catch(() => setRecientesMenu([]));
    const cerrar = (ev: PointerEvent): void => {
      if (el.contains(ev.target as Node)) return;
      el.open = false;
      document.removeEventListener('pointerdown', cerrar);
      if (cerrarMenuFuera.current?.cerrar === cerrar) cerrarMenuFuera.current = null;
    };
    cerrarMenuFuera.current = { menu: el, cerrar };
    document.addEventListener('pointerdown', cerrar);
  }
  useEffect(() => window.lila?.onMenu((a) => ejecutarRef.current(a)), []);

  /** Only a sane size counts: a window already gone reports zeros. */
  function recordarGeometria(geometria: Geometria): void {
    if (!geometriaValida(geometria)) return;
    geomEscenario.current = geometria;
    recordar({ ventanaEscenario: geometria });
  }
  /** Detach the scenario panel (design 2c). A blocked popup leaves it docked and says why. */
  function desacoplar(): void {
    const ventana = abrirVentanaFlotante('lila-escenario', geomEscenario.current);
    if (ventana === null) { setIoError(S.app.ventanaBloqueada); return; }
    setVerConVentana(false);
    setVentanaEscenario(ventana);
  }
  /** Back to the panel. Idempotent: the child's own `pagehide` lands here too. */
  function acoplar(): void {
    const ventana = ventanaEscenario;
    if (ventana === null) return;
    if (!ventana.closed) { recordarGeometria(geometriaDe(ventana)); ventana.close(); }
    setVentanaEscenario(null);
    window.focus();
    toggleEscenario.current?.focus();
  }
  /**
   * Command palette (#410). Not while a file operation holds the app (`ioBusy`: the canvas and the
   * rail are inert), nor over another modal, the welcome screen or the karaoke: those own the
   * keyboard until they close.
   */
  function abrirPaleta(desdeHija = false): void {
    if (ioBusy || karaoke || document.querySelector('dialog[open], .bienvenida') !== null) return;
    // ponytail: from the detached scenario window the palette opens in the main one. A browser
    // ignores `focus()` on another window (QA of #438, headed Chrome), so there it would open
    // unseen while the typing kept going to the child: in the browser ⌘K from the child does
    // nothing. Electron honours `focus()`. Ceiling: render the palette inside the child window.
    if (desdeHija) {
      if (!DESKTOP) return;
      window.focus();
    }
    setPaletaAbierta(true);
  }
  const abrirPaletaRef = useRef(abrirPaleta);
  abrirPaletaRef.current = abrirPaleta;
  /** Set while `teclasHija` dispatches, so the `paleta` handler knows to raise the main window. */
  const desdeHija = useRef(false);
  /** The palette's rows, built when it opens: the canvas elements are read at that moment. */
  function comandosPaleta(): Comando[] {
    const irAModo = (m: ModoId): void => { setModo(m); if (m === 'simular') setPestana('simulacion'); };
    const elementos: Comando[] = serviciosDe(modelador)?.elementRegistry.filter((el) =>
      // Roots have no parent: the process, the collaboration and each collapsed sub-process's plane.
      el.id !== undefined && el.labelTarget === undefined && el.parent !== undefined
      && !(el.waypoints !== undefined && !el.businessObject?.name))
      .map((el): Comando => ({
        grupo: 'elementos', nombre: el.businessObject?.name || el.businessObject?.text || el.id!, id: el.id!, tipo: nombreDeTipo(el.type ?? ''),
        elegir: () => {
          // The canvas is hidden in Results and Compare; it has to be on screen before the focus.
          if (modo === 'resultados' || modo === 'comparar') flushSync(() => setModo('modelar'));
          modelador?.seleccionar?.(el.id!, { centrar: true });
          modelador?.enfocar?.();
        },
      })) ?? [];
    const libre = !ioBusy && modelador !== null;
    const conLienzo = modelador !== null;
    const corriendo = sim.tipo === 'simulando';
    // The actions are the app's own entries of the shortcut map (#413), with the same labels the
    // Settings → Shortcuts table prints and the same handlers the keys run; modes are their own
    // group above, and the focus-moving keys make no sense from a palette.
    const teclaDe = (id: AtajoId): string | undefined => {
      const a = atajoPorId(id);
      return a.soloDesktop && !DESKTOP ? undefined : etiqueta(a, MAC);
    };
    const accion = (id: AtajoPropio, cuando = true): Comando | false =>
      cuando && { grupo: 'acciones', nombre: S.atajos[id], tecla: teclaDe(id), elegir: () => atajosRef.current[id]() };
    const acciones: (Comando | false)[] = [
      accion('nuevo', libre), accion('abrir', libre), accion('guardar', libre), accion('guardarComo', libre),
      accion('ejecutar', libre && !corriendo), accion('cancelar', corriendo),
      accion('zoomMas', conLienzo), accion('zoomMenos', conLienzo), accion('ajustarVista', conLienzo), accion('renombrar', conLienzo),
      accion('izquierda'), accion('derecha'), accion('diagramas'), accion('estado'),
      accion('ajustes'),
      { grupo: 'acciones', nombre: S.app.acercaDe, elegir: () => ejecutar('acerca') },
    ];
    return [
      ...elementos,
      ...Object.keys(escenarios).map((id): Comando => ({
        grupo: 'escenarios', nombre: etiquetaEscenario(id, escenarios), elegir: () => { elegirEscenario(id); irAModo('simular'); },
      })),
      ...MODO_IDS.map((m): Comando => ({ grupo: 'modos', nombre: S.app.modos[m], elegir: () => irAModo(m) })),
      ...acciones.filter((a): a is Comando => a !== false),
    ];
  }

  /**
   * Opens the About window (#408), centred over the app, or focuses it if it is already open.
   * Like `desacoplar`, only from a click or a menu action: popup blockers need the gesture.
   */
  function abrirAcerca(): void {
    if (karaoke) return;
    if (ventanaAcerca !== null && !ventanaAcerca.closed) { ventanaAcerca.focus(); return; }
    const ventana = abrirVentanaFlotante('lila-acerca', {
      width: 440,
      height: 600,
      x: Math.round(window.screenX + (window.outerWidth - 440) / 2),
      y: Math.round(window.screenY + (window.outerHeight - 600) / 2),
    });
    if (ventana === null) { setIoError(S.app.acercaBloqueada); return; }
    setVentanaAcerca(ventana);
  }
  /** Idempotent: the child's own `pagehide` lands here too. Unmounting `About` resets its egg. */
  function cerrarAcerca(): void {
    if (ventanaAcerca !== null && !ventanaAcerca.closed) ventanaAcerca.close();
    setVentanaAcerca(null);
    window.focus();
  }
  const acoplarRef = useRef(acoplar);
  acoplarRef.current = acoplar;
  // Another project (or the app going away) docks the window: it was editing the previous one.
  useEffect(() => () => acoplarRef.current(), [projectId]);

  /**
   * Abrir un `.bpmn` por asociación de archivo (LILA-072) y arranque en frío (LILA-074), o un
   * `.lila` por la misma puerta (issue #378): main captura la ruta —doble clic, `open-file` de
   * macOS, argumento de línea de comandos—, autoriza su carpeta y la entrega por
   * `pendingOpenPath()` (lo que llegó antes de que la ventana pudiera recibirla; se consume una
   * vez) o por `onOpenPath` (con la app ya corriendo). Las dos entran por la MISMA puerta que
   * «Abrir reciente», la única que abre una carpeta ya autorizada sin selector, llevando
   * `ruta.file` CUANDO existe: se abre EL `.bpmn` pulsado, no un `model.bpmn` fijo. `ruta.file` NO
   * existe para un `.lila` (`ruta.dir` es entonces la ruta del propio archivo, no una carpeta que
   * recorrer — ver el JSDoc de `OpenPathRequest` en `bridge.ts`) y no debe reenviarse: forwarding
   * incondicional dejaba `DesktopStore.activeModelFile` con un nombre `.lila`, y el siguiente
   * guardado normal reventaba en `lila:writeProject`/`requireBpmnName`.
   * ponytail: la carpeta del archivo sigue siendo el proyecto (escenarios y corridas salen de
   * ahí); un `.bpmn` suelto abre como proyecto sin escenarios y se coloca con «Guardar como».
   */
  function abrirRuta(ruta: OpenPathRequest): void {
    // El lienzo aún no existe: `projectAction` no haría nada y la ruta se perdería (hallazgo 3 del
    // QA). Se guarda y la abre el efecto de abajo en cuanto haya modelador.
    if (modelador === null) { rutaPendiente.current = ruta; return; }
    // Con una E/S en curso o el diálogo de cambios sin guardar abierto, `projectAction` saldría en
    // silencio o pisaría la acción pendiente (hallazgos 4 y 5): mejor decirlo — el banner se pinta
    // también dentro del diálogo. Sin `ruta.file` (un `.lila`), `ruta.dir` YA es la ruta completa
    // del archivo pulsado (ver el JSDoc de `OpenPathRequest` en `bridge.ts`): se le recorta a solo
    // el nombre, igual que el `.bpmn` de al lado, en vez de mostrar la ruta entera en el aviso.
    if (ioLock.current || pendingAction !== null) {
      setIoError(S.app.errorAbrirOcupado(ruta.file ?? ruta.dir.split(/[\\/]/).pop() ?? ruta.dir));
      return;
    }
    void projectAction(ruta.file === undefined ? { recent: ruta.dir } : { recent: ruta.dir, file: ruta.file });
  }
  const abrirRutaRef = useRef(abrirRuta);
  abrirRutaRef.current = abrirRuta;
  useEffect(() => {
    const abrir = (ruta: OpenPathRequest): void => abrirRutaRef.current(ruta);
    const unsubscribe = window.lila?.onOpenPath(abrir);
    void window.lila?.pendingOpenPath().then((ruta) => { if (ruta !== null) abrir(ruta); else setBienvenida(true); });
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (bienvenida) void adapter?.listRecents?.().then(setRecientes).catch(() => setRecientes([]));
  }, [bienvenida, adapter]);
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
      // The language is decided when the run starts and travels with it: a run already stored
      // keeps the language it was produced in (its warnings are data, not text that is repainted).
      const { ir, scenario, warnings } = await prepareSimulation(xml, escenarioId, escenarios, archivo, { locale });
      if (control.signal.aborted || enVuelo.current !== control) return;
      const { result: rawResult, logSample } = await runInWorker(ir, scenario, {
        locale,
        logSampleLimit: LOG_SAMPLE_LIMIT,
        signal: control.signal,
        onProgress: (progreso) => {
          if (!control.signal.aborted && enVuelo.current === control) setSim({ progreso, tipo: 'simulando' });
        },
      });
      if (control.signal.aborted || enVuelo.current !== control || modelRevision !== revisionRef.current) return;
      const result = { ...rawResult, warnings: [...new Set([...warnings, ...rawResult.warnings])] };
      setIr(ir);
      const runId = crypto.randomUUID();
      logs.current.set(runId, { rows: logSample, truncated: logSample.length >= LOG_SAMPLE_LIMIT });
      // Only the last ten runs keep their log: ten thousand rows each is too much to hold for a
      // whole session of runs nobody will animate again (insertion order, so the oldest go first).
      for (const viejo of [...logs.current.keys()].slice(0, -10)) logs.current.delete(viejo);
      setRuns((previous) => [...previous, {
        id: runId, scenarioName: escenarioId, result,
        inputs: { modelRevision, scenarioRevision, xml, scenario: scenario as unknown as Record<string, unknown> },
      }]);
      setCorrida({ originalIds: ir.source.originalIds, result, scenario });
      setModo('resultados');
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
    if (!await aceptaPerdida('exportar')) return;
    try { await store.putProcess(procesoId, await modelador.exportar({ aceptarPerdida: true })); }
    catch (e) { setIoError(e instanceof Error ? e.message : String(e)); }
  }

  // --- Hideable regions (#412) ---
  const visibles = paneles[modo];
  const hayIzquierda = conIzquierda(modo);
  /** The detached scenario window counts as «right panel hidden» while it shows the scenario. */
  const ocultoPorVentana = ventanaEscenario !== null && pestana === 'simulacion' && modo !== 'animar';
  const derechaVisible = visibles.derecha && !(ocultoPorVentana && !verConVentana);
  /**
   * #419: a failed Run is drawn in the Simulation tab; when that tab is not the one on screen the
   * error goes to the status bar instead, so Run never fails silently and never shows it twice.
   * Everything that hides the tab belongs in this one condition, the hidden right panel (#412)
   * included.
   */
  const errorSimOculto = sim.tipo === 'error' && (pestana !== 'simulacion' || modo === 'animar' || !derechaVisible) ? sim.mensaje : null;
  /**
   * An error the status bar is showing right now. A hidden status bar comes back for it: an
   * error nobody can see is worse than a bar the user asked to hide. Errors only — the loose
   * `.bpmn` notice and the import warnings last as long as the model, and would pin the bar for
   * the whole session (QA of #429).
   */
  const hayAlerta = ioError !== null || perdidasAlExportar.length > 0 || estado.error !== null || avisoTema !== null
    || errorSimOculto !== null;
  const visible: Record<Region, boolean> = {
    izquierda: hayIzquierda && visibles.izquierda,
    derecha: derechaVisible,
    diagramas: visibles.diagramas,
    estado: visibles.estado || hayAlerta,
  };
  /**
   * What the toggles show as pressed and flip: what is on screen, except for the status bar, whose
   * toggle keeps showing (and recording) the user's choice while an error forces the bar in.
   */
  const pulsado: Record<Region, boolean> = { ...visible, estado: visibles.estado };
  const tituloRegion = (r: Region): string => (r === 'estado' && hayAlerta ? S.app.tituloEstadoForzado : S.app.tituloRegiones[r]);

  /** Show or hide `region` in the current mode, and save the whole map. `false` = nothing to do. */
  function alternarRegion(region: Region): boolean {
    if (region === 'izquierda' && !hayIzquierda) return false;
    const mostrar = !pulsado[region];
    // Hiding the region that holds the focus would drop it on `<body>`: it goes to the toggle.
    if (!mostrar && !(region === 'estado' && hayAlerta) && document.getElementById(ID_REGION[region])?.contains(document.activeElement)) enfocarToggle(region);
    // While detached the right toggle only peeks at the docked panel: the saved choice stays.
    if (region === 'derecha' && ocultoPorVentana) {
      setVerConVentana(mostrar);
      if (!mostrar || visibles.derecha) return true;
    }
    const actual = panelesRef.current;
    const siguiente = { ...actual, [modo]: { ...actual[modo], [region]: mostrar } };
    panelesRef.current = siguiente;
    setPaneles(siguiente);
    recordar({ paneles: siguiente });
    return true;
  }

  // --- Shortcuts (#413): one handler per entry of `atajos.ts` that the app owns ---
  function elegirModo(m: ModoId): void {
    setModo(m);
    if (m === 'simular') setPestana('simulacion');
  }
  /** F2: rename the one selected element in place (bpmn-js has no key for it). */
  function renombrar(): void {
    const s = serviciosDe(modelador);
    const [unico, ...otros] = s?.selection.get() ?? [];
    if (unico !== undefined && otros.length === 0) s!.directEditing.activate(unico);
  }
  /** Shift+F6: to the right panel's first control, or to its toggle while it is hidden (#412). */
  function irPanel(): void {
    const panel = document.getElementById(ID_REGION.derecha);
    const destino = panel?.offsetParent === null ? null
      : panel?.querySelector<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea, [tabindex]:not([tabindex="-1"])');
    if (destino) destino.focus(); else enfocarToggle('derecha');
  }
  // Exhaustive on purpose: a new entry in `ATAJOS` does not compile until it has a handler here.
  const atajos: Record<AtajoPropio, () => void> = {
    nuevo: () => ejecutar('nuevo'),
    abrir: () => ejecutar('abrir'),
    guardar: () => ejecutar('guardar'),
    guardarComo: () => ejecutar('guardarComo'),
    ajustes: () => ejecutar('ajustes'),
    paleta: () => abrirPaletaRef.current(desdeHija.current),
    ...Object.fromEntries(MODO_IDS.map((m) => [`modo:${m}`, () => elegirModo(m)])) as Record<`modo:${ModoId}`, () => void>,
    // The Run button is replaced by Cancel while a run is in flight; the key follows the button.
    ejecutar: () => { if (enVuelo.current === null && modelador !== null) void simular(); },
    cancelar: cancelarCorrida,
    zoomMas: () => modelador?.zoom(1.2),
    zoomMenos: () => modelador?.zoom(1 / 1.2),
    ajustarVista: () => modelador?.ajustar(),
    renombrar,
    izquierda: () => alternarRegion('izquierda'),
    derecha: () => alternarRegion('derecha'),
    diagramas: () => alternarRegion('diagramas'),
    estado: () => alternarRegion('estado'),
    irModos: () => document.querySelector<HTMLElement>('.modos .modo')?.focus(),
    irPanel,
  };
  const atajosRef = useRef(atajos);
  atajosRef.current = atajos;

  /**
   * The one keyboard dispatcher (#413), on `window` in the CAPTURE phase: it runs before bpmn-js's
   * canvas listener, so ⌘0 fits the diagram instead of bpmn-js's 100 % and ⌘+/⌘− zoom once, not
   * twice. Rules, in order: the first own entry that matches wins; in Electron the entries of the
   * native menu are left to it (they come back through `onMenu`, and would fire twice on
   * Windows/Linux otherwise); a key without ⌘/Ctrl is typing inside a field; nothing fires while a
   * dialog or the welcome screen is up (they handle their own keys); Esc only cancels a run.
   * Tab is Tab again: #412's Tab-on-the-canvas panel toggle is gone (WCAG 2.1.2).
   */
  const despachar = (e: KeyboardEvent, soloHija = false): void => {
    if (e.isComposing) return;
    const a = ATAJOS.find((x) => !('lienzo' in x) && (!soloHija || 'hija' in x) && coincide(x, e, MAC));
    if (a === undefined || (DESKTOP && 'menu' in a) || bloqueado()) return;
    // On the web Ctrl+1…6 (and ⌘1…⌘6 in Firefox) switch browser tabs: the modes are the tabs'
    // and ⌘K's there, the keys belong to the desktop app only.
    if (!DESKTOP && a.grupo === 'modos') return;
    const conMod = a.tecla.startsWith('Mod+');
    if (!conMod && (e.target as Element | null)?.closest?.(CAMPO)) return;
    if ('ambito' in a && (enVuelo.current === null || menuAbierto())) return;
    // Results and Compare hide the canvas: its keys go back to the browser (page zoom, WCAG 1.4.4).
    if (a.grupo === 'lienzo' && (modo === 'resultados' || modo === 'comparar')) return;
    e.preventDefault();
    // Only the ⌘ keys are hidden from the target (bpmn-js zooms on them too); Esc, F2 and F6 still
    // reach whatever else listens.
    if (conMod) e.stopPropagation();
    // A held key is swallowed, not repeated (QA of #436, M1): one save / run / toggle per press,
    // and the browser never gets the repeats (⌘S «Save page as», ⇧⌘B bookmarks bar). Zoom repeats.
    if (e.repeat && a.id !== 'zoomMas' && a.id !== 'zoomMenos') return;
    atajosRef.current[a.id as AtajoPropio]();
  };
  /**
   * The detached scenario window (design 2c) forwards only the `hija` entries (QA of #391): Open
   * would click the file input of the MAIN document with the popup's user activation, the browser
   * refuses the chooser without ever settling it and the app stays busy until reload; Settings
   * would open modal behind the window the user is looking at.
   */
  const teclasHija = (e: KeyboardEvent): void => {
    desdeHija.current = true;
    try { despachar(e, true); } finally { desdeHija.current = false; }
  };
  const despacharRef = useRef(despachar);
  despacharRef.current = despachar;
  useEffect(() => {
    const oyente = (e: KeyboardEvent): void => despacharRef.current(e);
    window.addEventListener('keydown', oyente, true);
    return () => window.removeEventListener('keydown', oyente, true);
  }, []);

  /** The compact palette keeps its own `localStorage` key, as before #406 (web and desktop). */
  function guardarCompacta(activa: boolean): void {
    try { localStorage.setItem('lila.paleta', activa ? 'compacta' : 'normal'); } catch { /* private mode: nothing persists, nothing breaks */ }
  }
  function cambiarCompacta(): void {
    guardarCompacta(!compacta);
    setCompacta(!compacta);
  }

  /**
   * The scenario panel, written once: it is drawn docked in the aside or inside the detached window
   * (design 2c), never both. ponytail: moving it between the two remounts it, so the step it was
   * on goes back to the first one; lift `paso` to the shell if anybody minds.
   */
  const panelEscenario = (
    <ScenarioPanel
      enVentana={ventanaEscenario !== null}
      archivo={escenarioId}
      escenarios={escenarios}
      onCambio={cambiarEscenario}
      onGuardar={() => { void guardar(); }}
      onDuplicar={anadirEscenario}
      ir={ir}
      seleccion={seleccion}
      onSeleccionar={(id) => { setSeleccion(id); if (id !== null) modelador?.seleccionar?.(id); else modelador?.servicios.selection.select([]); }}
    />
  );

  /** Light or dark native controls (design 2d); the detached window copies it like the theme. */
  const esquema = temaClaro(tema) ? 'claro' : 'oscuro';

  return (
    <div
      className={['app', ...(hayIzquierda && !visible.izquierda ? ['sin-izquierda'] : []), ...(visible.derecha ? [] : ['sin-panel']),
        ...(visible.diagramas ? [] : ['sin-diagramas']), ...(visible.estado ? [] : ['sin-estado'])].join(' ')}
      data-densidad={densidad}
      data-theme={decoratedTheme}
      data-esquema={esquema}
      style={{ '--panel-ancho': `${panelAncho}px`, '--paleta-ancho': `${paletaAncho}px`, '--rail-ancho': `${railAncho}px` } as React.CSSProperties}
    >
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
        <p>{S.app.perdidaTexto(confirmarPerdida === 'guardar')}</p>
        <ul>{perdidasAlExportar.map((perdida) => <li key={perdida}>{perdida}</li>)}</ul>
        <div className="acciones">
          <button className="boton primario" type="button" onClick={() => responderPerdida(true)}>{S.app.perdidaConfirmar(S.app.perdidaVerbo[confirmarPerdida])}</button>
          <button className="boton" type="button" onClick={() => responderPerdida(false)}>{S.app.cancelar}</button>
        </div>
      </dialog>}
      {bienvenida && <Bienvenida
        recientes={recientes}
        temaNombre={tema?.name ?? S.app.temas[temaId as TemaId] ?? temaId}
        densidadTexto={S.app.densidadEstado(S.app.densidadNombre(densidad))}
        onAccion={(accion) => { if (accion === 'ejemplo') setBienvenida(false); else void projectAction(accion); }}
        onAjustes={() => ejecutar('ajustes')}
      />}
      <header className="barra">
        <div className="identidad">
          <img className="logo" src={`${import.meta.env.BASE_URL}branding/lila-transparent.png`} alt="" aria-hidden="true" width="26" height="26" />
          {/* En Electron el nombre del producto ya va en la barra de título del sistema
              (diseño 2d): repetirlo aquí encima del icono sería ruido. */}
          {!DESKTOP && <span className="producto">{S.app.marca}</span>}
          <span className="separador" aria-hidden="true" />
          <div>
            <div className="proyecto">{projectName}</div>
            <div className="archivo">{archivo} · {dirty ? S.app.sinGuardar : S.app.guardado}</div>
          </div>
        </div>
        <nav className="modos">
          {MODO_IDS.map((m) => (
            <button
              key={m}
              type="button"
              className={m === modo ? 'modo activo' : 'modo'}
              onClick={() => elegirModo(m)}
            >
              {S.app.modos[m]}
            </button>
          ))}
        </nav>
        {/* In desktop (#411) these same actions also live here, with the same wording as the
            native menu (`apps/desktop/src/menu.ts`, which stays with its accelerators): the owner
            wasn't finding them there alone. The `<details>` is the same element in both modes —no
            library, no React state, keyboard support for free— only its entries change. `Esc`
            closes it by hand —`<details>` doesn't ship that, it's a `<dialog>`/popover feature—
            with the usual `onKeyDown`, which also returns focus to the summary (QA of #432, N2):
            otherwise it lands on an item hidden inside the now-closed `<details>`. A click outside
            closes it via `alternarMenu`'s `pointerdown` on `document` (there was none
            before). */}
        <details className="menu-archivo" onToggle={alternarMenu} onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          const d = e.currentTarget;
          d.open = false;
          d.querySelector<HTMLElement>(':scope > summary')?.focus();
        }}>
          <summary>{S.app.menuArchivo}</summary>
          <div onClick={(e) => {
            // #411: a click on the "Open recent" `<summary>` should only open/close THAT submenu
            // (its own native `<details>` already does that); without this `return`, the click
            // also bubbles up here and closes the whole dropdown before the user gets to see the
            // recents list.
            if ((e.target as HTMLElement).closest('summary') !== null) return;
            (e.currentTarget.parentElement as HTMLDetailsElement).open = false;
          }}>
            {DESKTOP ? <>
              <button type="button" title={`${S.app.menuEscritorio.nuevoProyecto}${atajo('nuevo')}`} disabled={ioBusy || modelador === null} onClick={() => void projectAction('new')}>{S.app.menuEscritorio.nuevoProyecto}</button>
              <button type="button" title={`${S.app.menuEscritorio.abrirProyecto}${atajo('abrir')}`} disabled={ioBusy || modelador === null} onClick={() => void projectAction('open')}>{S.app.menuEscritorio.abrirProyecto}</button>
              <button type="button" disabled={ioBusy || modelador === null} onClick={() => void projectAction('openFile')}>{S.app.menuEscritorio.abrirProyectoArchivo}</button>
              <details className="menu-archivo-reciente">
                <summary>{S.app.menuEscritorio.abrirReciente}</summary>
                <div>
                  {recientesMenu.length === 0
                    ? <button type="button" disabled>{S.app.menuEscritorio.ninguno}</button>
                    : recientesMenu.map((r) => (
                      <button key={r.dir} type="button" title={r.dir} disabled={ioBusy || modelador === null} onClick={() => ejecutar({ openRecent: r.dir })}>
                        {r.name} <small className="mono">{r.dir}</small>
                      </button>
                    ))}
                </div>
              </details>
              <hr />
              <button type="button" title={`${S.app.menuEscritorio.guardarProyecto}${atajo('guardar')}`} disabled={ioBusy || modelador === null} onClick={() => void guardar()}>{S.app.menuEscritorio.guardarProyecto}</button>
              <button type="button" title={`${S.app.menuEscritorio.guardarComo}${atajo('guardarComo')}`} disabled={ioBusy || modelador === null} onClick={() => void guardar(true)}>{S.app.menuEscritorio.guardarComo}</button>
              <button type="button" disabled={ioBusy || modelador === null} onClick={() => void guardar(true, true)}>{S.app.menuEscritorio.guardarComoCarpeta}</button>
              <hr />
              <button type="button" onClick={() => ejecutar('acerca')}>{S.app.acercaDe}</button>
            </> : <>
              <button type="button" title={`${S.app.tituloNuevo}${atajo('nuevo')}`} disabled={ioBusy || modelador === null} onClick={() => void projectAction('new')}>{S.app.nuevo}</button>
              <button type="button" title={`${S.app.tituloAbrir}${atajo('abrir')}`} disabled={ioBusy || modelador === null} onClick={() => void projectAction('open')}>{S.app.abrir}</button>
              <button type="button" title={`${S.app.tituloGuardar}${atajo('guardar')}`} disabled={ioBusy || modelador === null} onClick={() => void guardar()}>{S.app.guardar}</button>
              <button type="button" title={`${S.app.tituloGuardarComo}${atajo('guardarComo')}`} disabled={ioBusy || modelador === null} onClick={() => void guardar(true)}>{S.app.guardarComo}</button>
              {bpmnFilesEnabled && <>
                <button type="button" disabled={ioBusy || modelador === null} onClick={() => void projectAction('bpmn')}>{S.app.abrirBpmn}</button>
                <button type="button" onClick={() => void exportar()}>{S.app.exportarBpmn}</button>
              </>}
              <button type="button" onClick={() => ejecutar('acerca')}>{S.app.acercaDe}</button>
            </>}
          </div>
        </details>
        {/* The search box is a button that opens the command palette (#410); the artboard fixes
            its place and width. Its zone is the bar's spring: when fewer than 120 px are left the
            box wraps to a second, clipped line instead of shrinking to an empty box (#423). */}
        <div className="zona-buscador">
          <div className="buscador">
            <button type="button" className="buscador-boton" aria-haspopup="dialog" aria-keyshortcuts={MAC ? 'Meta+K' : 'Control+K'}
              aria-label={S.app.buscar} title={`${S.app.buscar}${atajo('paleta')}`} onClick={() => abrirPaleta()}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
              <span className="pista">{S.app.buscarPista}</span>
              <kbd>{etiqueta(atajoPorId('paleta'), MAC)}</kbd>
            </button>
          </div>
        </div>
        <div className="iconos">
          <button type="button" className="boton icono" aria-label={S.app.deshacer} title={S.app.deshacer} disabled={ioBusy || !modelador?.deshacer} onClick={() => modelador?.deshacer?.()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-15.5-6.4L3 13" /></svg>
          </button>
          <button type="button" className="boton icono" aria-label={S.app.rehacer} title={S.app.rehacer} disabled={ioBusy || !modelador?.rehacer} onClick={() => modelador?.rehacer?.()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 15.5-6.4L21 13" /></svg>
          </button>
        </div>
        {(pestana === 'simulacion' || ventanaEscenario !== null) && (
          <button ref={toggleEscenario} type="button" className="boton icono desacoplar" aria-pressed={ventanaEscenario !== null}
            aria-label={ventanaEscenario === null ? S.app.escenarioAcoplado : S.app.escenarioDesacoplado}
            title={ventanaEscenario === null ? S.app.escenarioAcoplado : S.app.escenarioDesacoplado}
            onClick={() => { if (ventanaEscenario === null) desacoplar(); else acoplar(); }}>
            {/* Icon-only at every width (#405): the label lives in `aria-label`/`title`. */}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M14 4h6v6M20 4l-8 8M18 14v6H4V6h6" /></svg>
          </button>
        )}
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
            <button type="button" className="boton cancelar" title={`${S.app.cancelar}${atajo('cancelar')}`} onClick={cancelarCorrida}>{S.app.cancelar}</button>
          </>
        ) : (
          <button type="button" className="boton primario ejecutar" title={`${S.app.ejecutar}${atajo('ejecutar')}`} disabled={modelador === null} onClick={() => void simular()}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4l14 8-14 8z" /></svg>
            {S.app.ejecutar}
          </button>
        )}
        <button type="button" className="boton icono" title={`${S.app.ajustes}${atajo('ajustes')}`} aria-label={S.app.ajustes} onClick={() => ejecutar('ajustes')}>⚙</button>
        {/* Panel toggles (#412): four icon buttons in wide windows, one «View» menu in narrow
            ones (`app.css` swaps them). Pressed = the region is on screen (see `pulsado`). */}
        <div className="iconos vista-grupo" role="group" aria-label={S.app.vista}>
          {REGIONES.map((r) => (
            <button key={r} type="button" className="boton icono" data-region={r} aria-pressed={pulsado[r]}
              aria-controls={r === 'izquierda' && !hayIzquierda ? undefined : ID_REGION[r]}
              aria-label={S.app.regiones[r]} title={`${tituloRegion(r)}${atajo(r)}`}
              disabled={r === 'izquierda' && !hayIzquierda} onClick={() => alternarRegion(r)}>
              <IconoRegion region={r} />
            </button>
          ))}
        </div>
        {/* Plain toggle buttons like the File menu (QA of #429): no `role="menu"`, which would
            promise arrow-key navigation. Escape closes it and gives the focus back to its button. */}
        <details className="menu-vista" onToggle={alternarMenu} onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          const menu = e.currentTarget as HTMLDetailsElement;
          menu.open = false;
          menu.querySelector('summary')?.focus();
        }}>
          <summary className="boton icono" aria-label={S.app.vista} title={S.app.vista}><IconoRegion region={null} /></summary>
          <div>
            {REGIONES.map((r) => (
              <button key={r} type="button" data-region={r} aria-pressed={pulsado[r]} title={`${tituloRegion(r)}${atajo(r)}`}
                disabled={r === 'izquierda' && !hayIzquierda}
                onClick={(e) => {
                  const menu = e.currentTarget.closest('details')!;
                  menu.open = false;
                  menu.querySelector('summary')?.focus();
                  alternarRegion(r);
                }}>
                <span className="marca-menu" aria-hidden="true">{pulsado[r] ? '✓' : ''}</span>{S.app.regiones[r]}
              </button>
            ))}
          </div>
        </details>
      </header>

      <dialog ref={ajustesDialog} className="ajustes" aria-labelledby="ajustes-titulo">
        <AjustesDialogo
          idioma={idioma}
          cambiarIdioma={cambiarIdioma}
          LOCALES={LOCALES}
          temaId={temaId}
          tema={tema ?? null}
          temas={temas}
          densidad={densidad}
          onDensidad={(d) => setDensidad(d as Densidad)}
          onTemas={guardarTemas}
          onSeleccionar={(id) => void seleccionarTema(id)}
          abrirAcerca={abrirAcerca}
          cerrarDialogo={() => ajustesDialog.current?.close()}
        />
      </dialog>

      {paletaAbierta && <PaletaComandos comandos={comandosPaleta()} onCerrar={() => setPaletaAbierta(false)} />}

      {ventanaAcerca !== null && (
        <VentanaFlotante
          ventana={ventanaAcerca}
          titulo={S.app.acercaDe}
          tema={decoratedTheme}
          esquema={esquema}
          densidad={densidad}
          cabecera={false}
          onAcoplar={cerrarAcerca}
          onTecla={(e) => { if (e.key === 'Escape') cerrarAcerca(); }}
        >
          <About onCerrar={cerrarAcerca} onKaraoke={() => { cerrarAcerca(); setKaraoke(true); }} />
        </VentanaFlotante>
      )}
      {karaoke && <Karaoke onTerminar={() => setKaraoke(false)} />}

      {ventanaEscenario !== null && (
        <VentanaFlotante
          ventana={ventanaEscenario}
          titulo={S.app.tituloVentanaEscenario(etiquetaEscenario(escenarioId, escenarios))}
          tema={decoratedTheme}
          esquema={esquema}
          densidad={densidad}
          inert={ioBusy}
          onAcoplar={acoplar}
          onGeometria={recordarGeometria}
          onTecla={teclasHija}
        >
          {panelEscenario}
        </VentanaFlotante>
      )}

      {/* Paleta propia (LILA-207): un raíl a la izquierda del lienzo, no los iconos que bpmn-js
          pinta dentro del contenedor (escondidos en `app.css`). In Simulate the same column is the
          scenario rail (design 2a); in the other modes nothing is drawn and it shrinks to 0. */}
      {modo === 'simular' ? (
        <RailEscenarios
          escenarios={escenarios}
          activo={escenarioId}
          corridas={latest}
          validacion={validacion}
          onElegir={elegirEscenario}
          onNuevo={() => { const copia = duplicarEscenario(escenarioId, escenarios[escenarioId] ?? {}, Object.keys(escenarios)); anadirEscenario(copia.archivo, copia.escenario); }}
          onProblema={(id) => modelador?.seleccionar?.(id)}
          enVentana={ventanaEscenario !== null ? escenarioId : null}
          id={ID_REGION.izquierda}
        />
      ) : modo === 'modelar' ? <Paleta servicios={serviciosDe(modelador)} id={ID_REGION.izquierda} compacta={compacta} onCompacta={cambiarCompacta} /> : null}
      {/* Divider of the left column (#406): the palette in Model, the rail in Simulate, each
          with its own width. It stays on screen when the column is hidden, so a double-click
          or Enter can bring it back. */}
      {hayIzquierda && (() => {
        const rail = modo === 'simular';
        const valor = rail ? railAncho : compacta ? PALETA_COMPACTA : paletaAncho;
        return <div className="divisor-izquierdo" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={S.app.redimensionarIzquierda}
          aria-valuemin={rail ? RAIL_MIN : PALETA_COMPACTA} aria-valuemax={rail ? RAIL_MAX : PALETA_MAX} aria-valuenow={valor} aria-controls={ID_REGION.izquierda}
          {...divisor({
            valor,
            signo: 1,
            oculto: !visible.izquierda,
            gesto: arrastreIzquierda,
            alternar: () => alternarRegion('izquierda'),
            resolver: rail ? (px) => limitar(px, RAIL_MIN, RAIL_MAX) : (px, teclado) => {
              if (!teclado) return px < PALETA_SALTO ? PALETA_COMPACTA : limitar(px, PALETA_MIN, PALETA_MAX);
              // Arrows: below the minimum, a step left lands on 180 first and then on compact;
              // a step right from compact lands on 180.
              if (px >= PALETA_MIN) return limitar(px, PALETA_MIN, PALETA_MAX);
              return px > valor || valor > PALETA_MIN ? PALETA_MIN : PALETA_COMPACTA;
            },
            fijar: rail ? setRailAncho : (px) => {
              setCompacta(px === PALETA_COMPACTA);
              if (px !== PALETA_COMPACTA) setPaletaAncho(px);
            },
            persistir: rail ? (px) => recordar({ railAncho: px }) : (px) => {
              guardarCompacta(px === PALETA_COMPACTA);
              if (px !== PALETA_COMPACTA) recordar({ paletaAncho: px });
            },
          })} />;
      })()}

      {/* La esquina inferior derecha del lienzo queda libre para la marca de agua
          «Powered by bpmn.io», que es obligatoria por la licencia de bpmn.io. */}
      <div className="zona-modelo" inert={ioBusy} style={{ visibility: modo === 'resultados' || modo === 'comparar' ? 'hidden' : 'visible' }}>
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
      {/* La `key`: los colores neutros del modo se escriben en el DI al activarlo
          (`ColoresNeutrosDelTema`), y el DI gana a los colores por defecto que repinta
          `repintar()`. Como el lienzo ya no se remonta al cambiar de tema, sin esta `key` el
          diagrama se quedaba con los colores del tema anterior y la etiqueta con los del nuevo
          —texto invisible—. Remontar `TokenSim` apaga y vuelve a encender el modo, que es donde
          el módulo relee los tokens (QA de #275). No basta con `temaId`: editar un token del tema
          activo no cambia el id (LILA-114), así que la `key` lleva además los dos tokens que el
          modo congela en el DI (QA de #277). Y el idioma (LILA-210): el módulo escribe su interfaz
          una sola vez al encenderse, así que sin remontar quedaba medio lienzo en el anterior. */}
      {modo === 'rutas' && (
        <TokenSim key={`${locale}|${temaId}|${tema?.tokens?.['diagram.fill'] ?? ''}|${tema?.tokens?.['diagram.stroke'] ?? ''}`} modelador={modelador} />
      )}
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
      {modo === 'resultados' && (
        <section className="zona-resultados">
          {corrida !== null && ir !== null
            ? <ResultsView ir={ir} scenario={corrida.scenario} result={corrida.result} onAnimar={() => setModo('animar')} sinLog={replay === null} />
            : <p>{S.app.sinResultados} {runs.length > 0 && S.app.sinCorridaActual}</p>}
        </section>
      )}
      {modo === 'comparar' && <section className="zona-resultados">
        <label>{S.app.escenarioBase} <select value={baseId} onChange={(e) => setBaseId(e.target.value)}>
          {Object.keys(escenarios).map((name) => <option key={name} value={name}>{etiquetaEscenario(name, escenarios)}</option>)}
        </select></label>
        {comparable && ir !== null
          ? <CompareView ir={ir} comparison={compare(ordered.map((r) => r.result), { locale })}
              entries={ordered.map((r) => ({ result: r.result, scenario: r.inputs.scenario as unknown as ResolvedScenario }))}
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
      <div className="divisor" role="separator" aria-orientation="vertical" tabIndex={0} aria-label={S.app.redimensionarPanel}
        aria-valuemin={PANEL_MIN} aria-valuemax={PANEL_MAX} aria-valuenow={panelAncho} aria-controls={ID_REGION.derecha}
        {...divisor({
          valor: panelAncho,
          signo: -1,
          oculto: !visible.derecha,
          gesto: arrastre,
          alternar: () => alternarRegion('derecha'),
          resolver: anchoPanel,
          fijar: setPanelAncho,
          persistir: (px) => recordar({ panelAncho: px }),
        })} />
      <aside id={ID_REGION.derecha} className={panelAncho >= 440 ? 'panel ancho' : 'panel'} inert={ioBusy}>
        {/* En «Animar» el panel entero son los controles de la reproducción: las pestañas de
            propiedades no tienen nada que decir sobre una corrida que ya terminó (#331). */}
        {modo === 'animar' ? (
          <Replay
            modelador={modelador}
            replay={replay}
            originalIds={ir?.source.originalIds ?? {}}
            motivo={corridaActual === undefined ? S.animacion.sinCorrida : S.animacion.sinLog}
          />
        ) : <>
        <nav className="pestanas">
          {PESTANA_IDS.map((p) => (
            <button
              key={p}
              type="button"
              className={p === pestana ? 'pestana activa' : 'pestana'}
              onClick={() => {
                setPestana(p);
              }}
            >
              {S.app.pestanas[p]}
            </button>
          ))}
        </nav>
        {pestana === 'simulacion' ? (
          <div className="simulacion">
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
            {ventanaEscenario === null ? panelEscenario : (
              <div className="panel-desacoplado">
                <p>{S.app.enVentanaAparte}</p>
                <button type="button" className="boton" onClick={() => ventanaEscenario.focus()}>{S.app.mostrarVentana}</button>
                <button type="button" className="boton" onClick={acoplar}>{S.app.acoplar}</button>
              </div>
            )}
          </div>
        ) : (
          <PanelPropiedades key={projectId} modelador={modelador} pestana={pestana} avisos={validacion.avisos} />
        )}
        </>}
      </aside>

      <nav id={ID_REGION.diagramas} className="diagramas">
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
      <footer id={ID_REGION.estado} className="estado">
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
        {errorSimOculto !== null && (
          <span role="alert" className="error corrida-fallida" title={errorSimOculto}>{S.app.errorSimular(errorSimOculto.split('\n')[0]!)}</span>
        )}
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

