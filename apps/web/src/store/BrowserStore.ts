/**
 * `ProjectStore` de la demo online (LILA-058, ADR-023, ADR-018): abrir es un selector de
 * archivo nativo y guardar es una descarga. Es la modalidad que arranca `main.tsx`;
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
import type { RunResult } from '@lila/engine';
import type { Scenario } from '@lila/engine/schema';
import { readProject } from '../project';
import type { ProcessData, ProcessSummary, ProjectSessionStore, ProjectDocument } from './ProjectStore';

/**
 * The version lives in the key, not inside the value: a future format change picks a new key
 * (`lila.project.v2`) and the old one is left alone. Same `lila.` prefix as the settings
 * (`lila.tema`, `lila.densidad`, `lila.temas`, `lila.idioma`).
 */
const CLAVE = 'lila.project.v1';

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
 * huérfano por cada vez que alguien pulsa «Abrir .bpmn» y se arrepiente.
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

/** Descarga `datos` como `nombre`: el mismo Blob + `<a download>` que ya usaba `main.tsx`. */
function descargar(datos: BlobPart, nombre: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([datos], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

export class BrowserStore implements ProjectSessionStore {
  private project: ProjectDocument | undefined;
  private readonly procesos: Map<string, ProcessData>;
  private readonly escenarios = new Map<string, Map<string, Scenario>>();
  /** Results of `putRun`, by process and scenario; part of the mirrored session. */
  private readonly corridas = new Map<string, Map<string, RunResult>>();
  /** One warning per store when writing fails: enough to debug, not enough to flood. */
  private avisoEscritura = false;

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

  async createProject(document: ProjectDocument): Promise<ProjectDocument> {
    return this.saveProject(document);
  }

  async openProject(): Promise<ProjectDocument | null> {
    const file = await elegirArchivo('.lila.json,.json');
    if (file === null) return null;
    return readProject(JSON.parse(await file.text()) as unknown);
  }

  async saveProject(document: ProjectDocument): Promise<ProjectDocument> {
    const snapshot = structuredClone(readProject(document));
    this.project = snapshot;
    descargar(JSON.stringify(snapshot, null, 2), `${snapshot.name}.lila.json`, 'application/json');
    // Saving also flushes the mirror. Normally it is already up to date — every mutation writes
    // it — but if an earlier write hit the quota and the tab has since freed room, an explicit
    // save is the moment to try again.
    this.guardar();
    return snapshot;
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
