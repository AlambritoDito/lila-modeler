/**
 * `ProjectStore` de la demo online (LILA-058, ADR-023, ADR-018): abrir es un selector de
 * archivo nativo y guardar es una descarga. In Chrome and Edge (ADR-031) the File System Access
 * API upgrades both: Open keeps the file's handle and Save writes back to it (#573), and the
 * installed PWA opens a double-clicked `.lila` through `openHandle` (#572). Es la modalidad que arranca `main.tsx`;
 * `DesktopStore` (LILA-071) y `RemoteStore` (LILA-086) sustituyen esto sin que el resto de la
 * SPA lo note.
 *
 * Since LILA-067 the session also survives a reload: the processes, scenarios and runs this
 * store holds are mirrored into `localStorage` under `lila.project.v1`. That is what turns the
 * public GitHub Pages demo from a scratchpad that forgets everything on F5 into something you
 * can leave open in a tab. It is a mirror, not a database: the file dialog and the downloads
 * are still how work enters and leaves the browser, and the mirror is best effort — if storage
 * is unavailable, corrupt or full, the store keeps working in memory and only warns on the
 * console.
 */
import type { RunResult } from '@lila-modeler/engine';
import type { Scenario } from '@lila-modeler/engine/schema';
import { encodeLila } from '@lila-modeler/engine/project';
import { strings } from '../i18n';
import { readLila, readProject } from '../project';
import type { ProcessData, ProcessSummary, ProjectSessionStore, ProjectDocument } from './ProjectStore';

/**
 * The version lives in the key, not inside the value: a future format change picks a new key
 * (`lila.project.v2`) and the old one is left alone. Same `lila.` prefix as the settings
 * (`lila.tema`, `lila.densidad`, `lila.temas`, `lila.idioma`).
 */
const CLAVE = 'lila.project.v1';

/** The project container written by «Save project» (ADR-027, `docs/PROJECT_FORMAT.md`). */
const LILA_EXT = '.lila';
const LILA_MIME = 'application/vnd.lila-modeler+zip';

/** What is mirrored: the three collections this store owns, as plain JSON. */
interface SesionGuardada {
  readonly project?: ProjectDocument;
  readonly processes: Record<string, ProcessData>;
  readonly scenarios: Record<string, Record<string, Scenario>>;
  readonly runs: Record<string, Record<string, RunResult>>;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** An object whose every value is itself an object: the shape of the nested maps. */
function deObjetos(valor: unknown): valor is Record<string, Record<string, unknown>> {
  return esObjeto(valor) && Object.values(valor).every(esObjeto);
}

/**
 * Structural check only, and deliberately shallow: a `Scenario` may be a draft that does not
 * validate yet (the same rule `readProject` follows for the scenarios of a project) and a
 * `RunResult` is too big to re-validate on every boot. Anything that is not "an object of
 * objects" counts as corrupt and sends the store back to the seed.
 */
function esSesion(valor: unknown): valor is SesionGuardada {
  return esObjeto(valor)
    && esObjeto(valor.processes)
    && Object.values(valor.processes).every((p) => esObjeto(p) && typeof p.xml === 'string' && typeof p.name === 'string')
    && deObjetos(valor.scenarios) && Object.values(valor.scenarios).every(deObjetos)
    && deObjetos(valor.runs) && Object.values(valor.runs).every(deObjetos);
}

/**
 * `localStorage` is not always reachable: it does not exist outside a DOM environment and it
 * *throws* on access when the browser is set to block site data, so even reading the property
 * needs the guard.
 */
function almacen(): Storage | null {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? null;
  } catch {
    return null;
  }
}

/** The mirrored session, or `null` if there is none, it cannot be read, or it is corrupt. */
function leerSesion(): SesionGuardada | null {
  const storage = almacen();
  if (storage === null) return null;
  let crudo: string | null;
  try {
    crudo = storage.getItem(CLAVE);
  } catch {
    return null;
  }
  if (crudo === null) return null;
  try {
    const valor: unknown = JSON.parse(crudo);
    if (!esSesion(valor)) throw new Error('forma inesperada');
    if (valor.project !== undefined) readProject(valor.project);
    return valor;
  } catch (error) {
    // Corrupt content is not something to show anyone: the demo starts from the seed as if this
    // were a first visit. The key is dropped so the next write starts clean — otherwise the same
    // warning comes back on every reload until something manages to overwrite the bad value.
    console.warn(`[lila] ${CLAVE} ignorado (contenido no válido); se arranca con la semilla`, error);
    try {
      storage.removeItem(CLAVE);
    } catch {
      // Nothing left to try: the session just stays in memory.
    }
    return null;
  }
}

/**
 * Crea, dispara y limpia un `<input type=file>` invisible; resuelve con el archivo elegido, o
 * con `null` si el diálogo se cerró sin elegir nada.
 *
 * Cerrar el diálogo nativo **no** dispara `change`: dispara `cancel`. Sin escucharlo, la
 * promesa no se resolvía nunca y el `<input>` se quedaba en el `<body>` para siempre — un
 * huérfano por cada vez que alguien pulsa «Importar BPMN…» y se arrepiente.
 */
function elegirArchivo(accept = '.bpmn,.xml'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    const terminar = (file: File | null): void => {
      input.remove();
      resolve(file);
    };
    // `change` sin archivo no lo produce ningún navegador actual, pero cuesta cero cubrirlo.
    input.addEventListener('change', () => terminar(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => terminar(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * The File System Access API (#573, ADR-031), only in Chromium: Chrome and Edge, and the PWA
 * installed from them. Declared here because TypeScript's DOM lib has the handle but not the
 * pickers. Everything is optional — the API is looked up on every call, never assumed — so Safari,
 * Firefox and an older Chromium keep the `<input type=file>` and the download.
 */
interface EscrituraArchivo {
  write(datos: BlobPart): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}
/** What the store needs from a `FileSystemFileHandle`. */
export interface ManejadorArchivo {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable?(): Promise<EscrituraArchivo>;
  queryPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'readwrite' }): Promise<PermissionState>;
}
interface TipoSelector { description: string; accept: Record<string, string[]> }
interface ConSelectores {
  showOpenFilePicker?(options: { types: TipoSelector[]; multiple?: boolean }): Promise<ManejadorArchivo[]>;
  showSaveFilePicker?(options: { suggestedName: string; types: TipoSelector[] }): Promise<ManejadorArchivo>;
}
const selectores = (): ConSelectores => globalThis as ConSelectores;
/** In the UI language at the moment the dialog opens. */
const tipoLila = (): TipoSelector => ({ description: strings().almacen.tipoLila, accept: { [LILA_MIME]: [LILA_EXT] } });
/** Earlier saves from the demo are `.lila.json` (see `openProject`). */
const tipoLilaJson = (): TipoSelector => ({ description: strings().almacen.tipoLilaJson, accept: { 'application/json': ['.json'] } });

/** The user closed the picker: a cancel, not an error. */
const esCancelacion = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';
/**
 * The picker exists but refuses to open here — no user activation left (`SecurityError`), a
 * cross-origin frame or a policy (`NotAllowedError`).
 */
const esRechazo = (error: unknown): boolean => error instanceof DOMException && (error.name === 'SecurityError' || error.name === 'NotAllowedError');
/** No user activation left: no picker and no `<input type=file>` will open until the next click. */
const sinActivacion = (error: unknown): boolean => error instanceof DOMException && error.name === 'SecurityError';
/** The remembered file is gone (moved, deleted) or no longer writable: ask where instead. */
const archivoPerdido = (error: unknown): boolean => error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'NotAllowedError');

/** The file's modification time, or `null` when it cannot be read (gone, no permission). */
async function modificado(handle: ManejadorArchivo): Promise<number | null> {
  try { return (await handle.getFile()).lastModified; } catch { return null; }
}

/** Write access to `handle`, asking for it if needed (a launched file starts read-only). */
async function puedeEscribir(handle: ManejadorArchivo): Promise<boolean> {
  if (handle.createWritable === undefined) return false;
  try {
    if (handle.queryPermission === undefined) return true;
    if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
    return await handle.requestPermission?.({ mode: 'readwrite' }) === 'granted';
  } catch {
    return false;
  }
}

/** Reads a chosen `.lila` (ZIP) or `.lila.json`; the name decides which (see `openProject`). */
async function leerProyecto(file: File): Promise<ProjectDocument> {
  if (file.name.toLowerCase().endsWith(LILA_EXT)) return readLila(new Uint8Array(await file.arrayBuffer()));
  return readProject(JSON.parse(await file.text()) as unknown);
}

/** Descarga `datos` como `nombre`: el mismo Blob + `<a download>` que ya usaba `main.tsx`. */
function descargar(datos: BlobPart, nombre: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([datos], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Where Save writes back (#573). `modificado` is the file's `lastModified` when this window last
 * read or wrote it (`null`: unknown, not checked): if it changed since — another window of the
 * app, or another program, saved it — Save refuses instead of overwriting that work.
 */
interface Destino { readonly handle: ManejadorArchivo; readonly projectId: string; readonly modificado: number | null }

/** What `escribir` did: `rechazado` is a picker the browser refused (no user activation, policy). */
type Escritura = 'escrito' | 'cancelado' | 'sin-api' | 'rechazado';

export class BrowserStore implements ProjectSessionStore {
  private project: ProjectDocument | undefined;
  private readonly procesos: Map<string, ProcessData>;
  private readonly escenarios = new Map<string, Map<string, Scenario>>();
  /** Results of `putRun`, by process and scenario; part of the mirrored session. */
  private readonly corridas = new Map<string, Map<string, RunResult>>();
  /** One warning per store when writing fails: enough to debug, not enough to flood. */
  private avisoEscritura = false;
  /**
   * #573: the `.lila` Save writes back to, and the project it holds. Only with the File System
   * Access API; kept in memory only, so after a reload the first Save asks where again. A Save of
   * a different project (New, a gallery example, an import) never reuses it.
   */
  private destino: Destino | null = null;
  /** The destination before the last open, for `undoOpen`. */
  private destinoPrevio: BrowserStore['destino'] = null;

  /**
   * `semilla`: procesos ya cargados al arrancar (en `main.tsx`, `examples/pedido`).
   *
   * The seed is laid down first and what was mirrored in `localStorage` is written on top, so a
   * stored session wins for the ids it covers while the seed still answers for the ones it does
   * not. Booting the other way round — replacing the seed with the stored value — would leave a
   * visitor whose first action was saving a scenario with no example process to open.
   */
  constructor(semilla: ReadonlyMap<string, ProcessData> = new Map()) {
    this.procesos = new Map(semilla);
    const sesion = leerSesion();
    this.project = sesion?.project;
    if (sesion === null) return;
    for (const [id, datos] of Object.entries(sesion.processes)) this.procesos.set(id, datos);
    for (const [proceso, escenarios] of Object.entries(sesion.scenarios)) {
      this.escenarios.set(proceso, new Map(Object.entries(escenarios)));
    }
    for (const [proceso, corridas] of Object.entries(sesion.runs)) {
      this.corridas.set(proceso, new Map(Object.entries(corridas)));
    }
  }

  /**
   * Mirrors the whole session after every change. Writing it whole instead of by key keeps the
   * stored value consistent with memory at all times, and it is cheap next to the simulation
   * that produced the change.
   *
   * A failed write is never an error the user has to deal with: the usual cause is
   * `QuotaExceededError` — a handful of replications of a real model is megabytes of
   * `RunResult` and the quota is around five — and losing the mirror only costs the reload,
   * not the work in the tab.
   */
  private guardar(): void {
    const storage = almacen();
    if (storage === null) return;
    const sesion: SesionGuardada = {
      ...(this.project ? { project: this.project } : {}),
      processes: Object.fromEntries(this.procesos),
      scenarios: Object.fromEntries([...this.escenarios].map(([id, s]) => [id, Object.fromEntries(s)])),
      runs: Object.fromEntries([...this.corridas].map(([id, r]) => [id, Object.fromEntries(r)])),
    };
    try {
      storage.setItem(CLAVE, JSON.stringify(sesion));
    } catch (error) {
      if (this.avisoEscritura) return;
      this.avisoEscritura = true;
      console.warn(`[lila] no se pudo guardar ${CLAVE}; la sesión sigue solo en memoria`, error);
    }
  }

  /** Restore the last explicitly saved project, including scenarios, revisions and runs. */
  restoreSession(): ProjectDocument | null {
    return this.project ? structuredClone(this.project) : null;
  }

  /** #591: the file's text and name; nothing is kept or downloaded until the user saves. */
  async importBpmn(): Promise<{ xml: string; name: string } | null> {
    const archivo = await elegirArchivo();
    return archivo === null ? null : { xml: await archivo.text(), name: archivo.name };
  }

  /**
   * New: with the File System Access API it asks where to save the new project. When the browser
   * refuses the dialog (no user activation left, e.g. after «Save and continue» used it) the
   * project opens unsaved instead of downloading a blank file; its first Save asks where.
   */
  async createProject(document: ProjectDocument): Promise<ProjectDocument | null> {
    return this.guardarProyecto(document, false, true);
  }

  /**
   * `.lila` (ADR-027) is what this store writes now; `.lila.json` is still accepted because it is
   * what every project saved from the public demo before this change looks like, and the demo has
   * no migration step to run — the file is on the visitor's disk, not in a database. Which reader
   * to use is decided by the name, not by sniffing the bytes: a `.lila` is a ZIP and a `.lila.json`
   * is JSON, and a file whose extension lies about that is a file worth refusing.
   */
  async openProject(): Promise<ProjectDocument | null> {
    const { showOpenFilePicker } = selectores();
    if (showOpenFilePicker !== undefined) {
      let elegidos: ManejadorArchivo[] | null = null;
      try {
        elegidos = await showOpenFilePicker.call(globalThis, { types: [tipoLila(), tipoLilaJson()] });
      } catch (error) {
        if (esCancelacion(error)) return null;
        // No user activation left (the save dialog of «Save and continue» just used it): the
        // file input needs one too and would never answer, holding the I/O lock for good. The
        // user clicks Open again.
        if (sinActivacion(error)) return null;
        if (!esRechazo(error)) throw error;
      }
      if (elegidos !== null) return elegidos[0] === undefined ? null : this.openHandle(elegidos[0]);
    }
    const file = await elegirArchivo('.lila,.lila.json,.json');
    if (file === null) return null;
    this.destinoPrevio = this.destino;
    this.destino = null;
    return leerProyecto(file);
  }

  /**
   * #572: a file handed over by the installed PWA's `launchQueue` (a `.lila` double-clicked in the
   * system), or the one `showOpenFilePicker` returned. A `.lila` is remembered so Save rewrites it
   * (#573); a `.lila.json` is not — Save turns it into a `.lila`, which is a new file.
   */
  async openHandle(handle: ManejadorArchivo): Promise<ProjectDocument> {
    const file = await handle.getFile();
    const doc = await leerProyecto(file);
    this.destinoPrevio = this.destino;
    this.destino = handle.name.toLowerCase().endsWith(LILA_EXT) && handle.createWritable !== undefined
      ? { handle, projectId: doc.id, modificado: file.lastModified } : null;
    return doc;
  }

  /** The project just read did not open (it does not parse): Save goes where it went before. */
  undoOpen(): void {
    this.destino = this.destinoPrevio;
  }

  /** A project with no file behind it (a gallery example, an import) is about to be shown. */
  forget(): void {
    this.destino = null;
  }

  /**
   * With the File System Access API (#573) Save writes the `.lila` it opened or last saved, and
   * the first Save of a project — or «Save as» — asks where with the system's save dialog; closing
   * it is a cancel (`null`). Without the API, or when the browser refuses the picker, it downloads
   * a new copy, as it always has: what the user asked to save is never left unsaved.
   */
  async saveProject(document: ProjectDocument, options?: { saveAs?: boolean }): Promise<ProjectDocument | null> {
    return this.guardarProyecto(document, options?.saveAs === true, false);
  }

  private async guardarProyecto(document: ProjectDocument, saveAs: boolean, nuevo: boolean): Promise<ProjectDocument | null> {
    const snapshot = structuredClone(readProject(document));
    const datos = encodeLila(snapshot);
    const escrito = await this.escribir(snapshot, datos, saveAs);
    if (escrito === 'cancelado') return null;
    if (escrito === 'sin-api' || (escrito === 'rechazado' && !nuevo)) descargar(datos, `${snapshot.name}${LILA_EXT}`, LILA_MIME);
    // Commit only after the download was initiated successfully. Keep the returned document
    // separate so callers cannot mutate the last explicit save through a shared reference.
    this.project = structuredClone(snapshot);
    // Saving also flushes the mirror. Normally it is already up to date — every mutation writes
    // it — but if an earlier write hit the quota and the tab has since freed room, an explicit
    // save is the moment to try again.
    this.guardar();
    return snapshot;
  }

  /** Writes `datos` to the remembered `.lila` or to a new one the user picks (#573). */
  private async escribir(snapshot: ProjectDocument, datos: Uint8Array<ArrayBuffer>, saveAs: boolean): Promise<Escritura> {
    const { showSaveFilePicker } = selectores();
    if (showSaveFilePicker === undefined) return 'sin-api';
    const previo = !saveAs && this.destino?.projectId === snapshot.id ? this.destino : null;
    let handle: ManejadorArchivo | null = null;
    let escritura: EscrituraArchivo | null = null;
    if (previo !== null) {
      const ahora = await modificado(previo.handle);
      // Saved elsewhere since this window read it: refuse rather than overwrite that work.
      if (ahora !== null && previo.modificado !== null && ahora !== previo.modificado) {
        throw new Error(strings().almacen.errorCambioExternoWeb(previo.handle.name));
      }
      // Gone (moved, deleted) or not writable any more: ask where, as on a first save.
      if (ahora !== null && await puedeEscribir(previo.handle)) {
        try {
          escritura = await previo.handle.createWritable!();
          handle = previo.handle;
        } catch (error) {
          if (!archivoPerdido(error)) throw error;
        }
      }
    }
    if (handle === null || escritura === null) {
      let elegido: ManejadorArchivo;
      try {
        elegido = await showSaveFilePicker.call(globalThis, { suggestedName: `${snapshot.name}${LILA_EXT}`, types: [tipoLila()] });
      } catch (error) {
        if (esCancelacion(error)) return 'cancelado';
        if (esRechazo(error)) return 'rechazado';
        throw error;
      }
      if (elegido.createWritable === undefined) return 'sin-api';
      handle = elegido;
      escritura = await elegido.createWritable();
    }
    try {
      await escritura.write(datos);
      await escritura.close();
    } catch (error) {
      // The original file is untouched until `close()` commits the swap file: drop it.
      await escritura.abort?.().catch(() => undefined);
      throw error;
    }
    this.destino = { handle, projectId: snapshot.id, modificado: await modificado(handle) };
    return 'escrito';
  }

  async listProcesses(): Promise<readonly ProcessSummary[]> {
    return [...this.procesos].map(([id, { name }]) => ({ id, name }));
  }

  async getProcess(id: string): Promise<ProcessData | null> {
    const cargado = this.procesos.get(id);
    if (cargado !== undefined) return cargado;
    const archivo = await elegirArchivo();
    if (archivo === null) return null;
    const datos: ProcessData = { xml: await archivo.text(), name: archivo.name };
    this.procesos.set(id, datos);
    this.guardar();
    return datos;
  }

  async putProcess(id: string, xml: string): Promise<void> {
    const nombre = this.procesos.get(id)?.name ?? id;
    this.procesos.set(id, { xml, name: nombre });
    this.guardar();
    descargar(xml, nombre, 'application/xml');
  }

  async listScenarios(processId: string): Promise<readonly string[]> {
    return [...(this.escenarios.get(processId)?.keys() ?? [])];
  }

  async putScenario(processId: string, name: string, scenario: Scenario): Promise<void> {
    const deProceso = this.escenarios.get(processId) ?? new Map<string, Scenario>();
    deProceso.set(name, scenario);
    this.escenarios.set(processId, deProceso);
    this.guardar();
    descargar(JSON.stringify(scenario, null, 2), `${name}.scenario.json`, 'application/json');
  }

  async putRun(processId: string, scenarioName: string, result: RunResult): Promise<void> {
    const deProceso = this.corridas.get(processId) ?? new Map<string, RunResult>();
    deProceso.set(scenarioName, result);
    this.corridas.set(processId, deProceso);
    this.guardar();
    descargar(
      JSON.stringify(result, null, 2),
      `${processId}-${scenarioName}.result.json`,
      'application/json',
    );
  }
}
