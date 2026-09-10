/**
 * `ProjectSessionStore` de Electron (OP-08, LILA-071, ADR-018/023): la carpeta de proyecto vive
 * en disco vía `window.lila` (`chooseFolder`/`readProject`/`writeProject`, `apps/desktop/src/
 * bridge.ts`). El `LilaBridge` se inyecta por constructor —por defecto `window.lila`— para poder
 * probar esta clase con un puente falso en jsdom, sin Electron.
 *
 * `import type { LilaBridge }` cruza a `apps/desktop/src/bridge.ts`: compila bajo el `tsconfig`
 * de `apps/web` (sin `rootDir` propio), a diferencia de la dirección contraria (`bridge.ts`
 * importando de aquí), que revienta con `TS6059` — ver el comentario de cabecera de
 * `apps/desktop/src/projectTypes.ts`.
 */
import type { RunResult } from '@lila/engine';
import type { Scenario } from '@lila/engine/schema';
import type { SaveOutcome, LilaBridge, LilaProjectDocument, OpenPathRequest, Recent } from '../../../desktop/src/bridge.js';
import type {
  ProcessData,
  ProcessSummary,
  ProjectDocument,
  ProjectSessionStore,
  ScenarioDocument,
  StoredRun,
} from './ProjectStore';
import { strings } from '../i18n';

type ProjectProblem = LilaProjectDocument['problems'][number];

function requireWindowLila(): LilaBridge {
  const S = strings();
  if (typeof window === 'undefined' || window.lila === undefined) {
    throw new Error(S.almacen.errorSinBridge);
  }
  return window.lila;
}

/**
 * Propaga `problems` DENTRO del `ProjectDocument` devuelto (OP-14, revisión de A, issue #71:
 * "problems sigue eliminado en toProjectDocument" — A ya declara `problems?` opcional en
 * `ProjectDocument`, así que ya no hace falta extraerlo a un canal aparte para que sobreviva:
 * `App.tsx#activate` lee `doc.problems` directamente del documento que devuelven
 * `createProject`/`openProject`/`saveProject`/`openRecent`). También se expone en
 * `this.problems`/`lastProblems` por compatibilidad con el resto de esta clase, y se castea
 * `runs[].result` de `unknown` (lo que tipa el puente, que no depende de `@lila/engine`) a
 * `RunResult` — el único cast de esta clase: no oculta una invalidez de dominio, solo repara una
 * frontera IPC entre dos paquetes que no comparten el tipo de `@lila/engine`, el valor en tiempo
 * de ejecución es exactamente el `RunResult` que `putRun`/`saveProject` escribieron.
 */
function toProjectDocument(
  raw: LilaProjectDocument,
): { document: ProjectDocument; problems: readonly ProjectProblem[] } {
  const { problems, ...rest } = raw;
  const runs: StoredRun[] = rest.runs.map((run) => ({ ...run, result: run.result as RunResult }));
  return { document: { ...rest, runs, problems }, problems };
}

export class DesktopStore implements ProjectSessionStore {
  private readonly bridge: LilaBridge;
  /** Carpeta del proyecto abierto/guardado con éxito por última vez; `null` antes del primero. */
  private activeDir: string | null = null;
  /** Último documento leído/escrito con éxito; respalda los métodos históricos de abajo. */
  private activeDocument: ProjectDocument | null = null;
  private problems: readonly ProjectProblem[] = [];
  /**
   * `.bpmn` con el que se abrió el proyecto activo, cuando no es el `model.bpmn` de la carpeta
   * (LILA-072, hallazgo 7 del QA): un guardado normal escribe en ESE archivo. `undefined` es
   * `model.bpmn`, que es también lo que dejan «Nuevo», «Abrir…» y «Guardar como».
   */
  private activeModelFile: string | undefined = undefined;
  /** `true` si el proyecto activo es un diagrama suelto: un `.bpmn` que no es el `model.bpmn` de
   *  su carpeta, sea esa carpeta un proyecto Lila o no (LILA-206). */
  private activeLoose = false;

  constructor(bridge: LilaBridge = requireWindowLila()) {
    this.bridge = bridge;
  }

  /** Escenarios que `readProject` no pudo interpretar en la última lectura (JSON roto, etc.). */
  get lastProblems(): readonly ProjectProblem[] {
    return this.problems;
  }

  /**
   * `{ saveAs: true }` SIEMPRE (OP-14, revisión de A: P0 "nuevo proyecto sobre carpeta ocupada
   * aún sobrescribe", issues #71/#74). La carpeta que devuelve `chooseFolder()` aquí nunca es la
   * carpeta activa de este documento — no existe una todavía — así que para `main`/`projectIO`
   * es siempre un "destino nuevo": sin `saveAs: true`, `assertFolderNotOccupied` ni se ejecuta y
   * un `model.bpmn`/manifiesto ajeno en esa carpeta se sobrescribe en silencio.
   */
  async createProject(document: ProjectDocument): Promise<ProjectDocument | null> {
    const dir = await this.bridge.chooseFolder();
    if (dir === null) return null;
    await this.bridge.writeProject(dir, document, { saveAs: true });
    this.activeDir = dir;
    this.activeDocument = document;
    this.problems = [];
    this.activeModelFile = undefined;
    this.activeLoose = false;
    return document;
  }

  async openProject(options?: { readonly fileOnly?: boolean }): Promise<ProjectDocument | null> {
    const dir = await this.bridge.chooseFolder(options?.fileOnly === true);
    if (dir === null) return null;
    const raw = await this.bridge.readProject(dir);
    const { document, problems } = toProjectDocument(raw);
    this.activeDir = dir;
    this.activeDocument = document;
    this.problems = problems;
    this.activeModelFile = undefined;
    this.activeLoose = false;
    return document;
  }

  /**
   * `options.overwrite`: extensión de B sobre el contrato de A (que solo declara `saveAs?`), para
   * saltar la detección de cambios externos de `writeProject` (OP-14 incremento 2,
   * `E-CAMBIO-EXTERNO`) cuando el usuario elige explícitamente "Sobrescribir" ante ese error. Es
   * un parámetro adicional opcional, no un cambio de forma: `ProjectSessionStore.saveProject`
   * (`ProjectStore.ts`, sin tocar) sigue aceptando solo `{ saveAs? }` y este método lo cumple.
   */
  async saveProject(
    document: ProjectDocument,
    options?: { saveAs?: boolean; overwrite?: boolean },
  ): Promise<ProjectDocument | null> {
    const explicitSaveAs = options?.saveAs === true;
    // Guardia de identidad (OP-14, revisión de A: "openProject no debe permitir guardar el
    // proyecto anterior en la carpeta nueva", issues #74/#70). Un guardado normal (sin "Guardar
    // como") del documento activo debe seguir siendo el mismo proyecto que el que está abierto:
    // si no lo es, el llamador tiene un documento obsoleto en memoria y hay que decírselo antes de
    // tocar disco, no escribirlo silenciosamente encima de la carpeta abierta.
    if (!explicitSaveAs && this.activeDocument !== null && document.id !== this.activeDocument.id) {
      throw new Error(strings().almacen.errorProyectoDistinto);
    }
    let dir = this.activeDir;
    // "Destino nuevo" (OP-14, revisión de A: P0 "nuevo proyecto sobre carpeta ocupada aún
    // sobrescribe", issues #71/#74) en dos casos: "Guardar como" explícito, o el primer guardado
    // sin carpeta activa todavía (`dir === null`) — en AMBOS acaba de elegirse una carpeta que
    // nunca fue la activa de este documento, así que main debe correr la comprobación de
    // ocupación (`assertFolderNotOccupied`, solo se dispara con `saveAs: true`). Antes de este
    // fix, el primer guardado pasaba el `saveAs` explícito (`false` por defecto) tal cual, y un
    // `model.bpmn`/manifiesto ajeno en la carpeta recién elegida se sobrescribía sin avisar.
    // (La condición se repite tal cual en el `if`, en vez de leerse de una variable ya calculada,
    // para que TypeScript siga pudiendo angostar `dir` a `string` después de este bloque.)
    let isNewDestination: boolean;
    if (dir === null || explicitSaveAs) {
      isNewDestination = true;
      const chosen = await this.bridge.chooseFolder();
      // Cancelar «Guardar como» (o el primer guardado sin carpeta activa) no cambia la carpeta
      // activa: se devuelve `null` tal cual, sin tocar `this.activeDir`/`this.activeDocument`.
      if (chosen === null) return null;
      dir = chosen;
    } else {
      isNewDestination = false;
    }
    // Si `writeProject` rechaza (incluido `E-CARPETA-OCUPADA` en "destino nuevo", o
    // `E-CAMBIO-EXTERNO` sin `overwrite`), la promesa de aquí rechaza también y ni `activeDir` ni
    // `activeDocument` cambian: solo tras un `writeProject` exitoso se confirma la carpeta.
    // Un guardado normal va al `.bpmn` con el que se abrió el proyecto (LILA-072, hallazgo 7 del
    // QA): sin esto, abrir `ventas.bpmn` y pulsar ⌘S pisaba el `model.bpmn` de al lado con el
    // diagrama de ventas y dejaba `ventas.bpmn` con la versión vieja. Un "destino nuevo"
    // («Guardar como», o el primer guardado) es siempre un proyecto completo con su `model.bpmn`,
    // así que ahí no se reenvía ni el archivo ni lo de "diagrama suelto".
    const sobreSuPropiaCarpeta = explicitSaveAs && this.activeLoose && dir === this.activeDir;
    try {
      await this.bridge.writeProject(dir, document, {
        saveAs: isNewDestination,
        overwrite: options?.overwrite === true,
        ...(isNewDestination || this.activeModelFile === undefined ? {} : { modelFile: this.activeModelFile }),
        ...(isNewDestination || !this.activeLoose ? {} : { diagramOnly: true }),
      });
    } catch (error) {
      // «Guardar como» de un diagrama suelto sobre su MISMA carpeta (LILA-208). Si esa carpeta ya
      // es un proyecto Lila, la capa de disco lo rechaza con `E-CARPETA-OCUPADA` (el suelto lleva
      // id propio, ver `readProjectFolder`) y aquí solo se traduce a algo entendible. Decisión del
      // ticket: rechazar, no pedir confirmación — la carpeta está ahí mismo para elegir otra.
      // Quién decide es el disco y no esta clase: un suelto en `~/Descargas` SÍ puede convertirse
      // en proyecto en su propia carpeta (QA ronda 3, `projectIO.test.ts`), y desde aquí no se
      // sabe si hay manifiesto al lado (QA de LILA-208).
      if (sobreSuPropiaCarpeta && (error instanceof Error) && error.message.includes('E-CARPETA-OCUPADA')) {
        throw new Error(strings().almacen.errorMismaCarpeta);
      }
      throw error;
    }
    this.activeDir = dir;
    this.activeDocument = document;
    if (isNewDestination) {
      this.activeModelFile = undefined;
      this.activeLoose = false;
    }
    return document;
  }

  setDirty(dirty: boolean): void {
    this.bridge.setDirty(dirty);
  }

  /**
   * Registra `save` como el callback que main invoca (vía `lila:close-requested`) cuando el
   * usuario elige "Guardar" en el diálogo nativo de cierre; `bridge.onCloseRequested` es puro
   * reenvío de IPC (ver `preload.cts`), así que toda la lógica de "qué es guardar" sigue siendo
   * responsabilidad de quien llame (`App.tsx`, vía `saveRef.current`).
   */
  onSaveRequested(save: () => Promise<SaveOutcome>): () => void {
    return this.bridge.onCloseRequested(save);
  }

  // -- Extensiones de B sobre el contrato (OP-14 incremento 2) ---------------------------------
  // No forman parte de `ProjectSessionStore` (`ProjectStore.ts`, de A): son propias de esta
  // modalidad (recientes/apertura de `.bpmn` no existen en `BrowserStore`). Petición a A: conectar
  // `listRecents`/`openRecent`/`onOpenPath` en la UI (menú "Abrir reciente", manejar
  // `lila:open-path` al arrancar) — ver `estado/OP-14-claude.md`.

  /** Hasta 10 proyectos abiertos/guardados recientemente, más nuevo primero. */
  async listRecents(): Promise<readonly Recent[]> {
    return this.bridge.listRecents();
  }

  /**
   * Reabre un proyecto de `listRecents()` sin selector de carpetas. `null` si la carpeta ya no
   * existe (el bridge ya la quitó de recientes); no lanza por eso. `file` es el `.bpmn` que se
   * pulsó cuando no es el `model.bpmn` del proyecto (LILA-072): la misma puerta, otro modelo.
   */
  async openRecent(dir: string, file?: string): Promise<ProjectDocument | null> {
    const raw = await this.bridge.openRecent(dir, file);
    if (raw === null) return null;
    const { document, problems } = toProjectDocument(raw);
    this.activeDir = dir;
    this.activeDocument = document;
    this.problems = problems;
    this.activeModelFile = file;
    this.activeLoose = raw.loose === true;
    return document;
  }

  /** `.bpmn` pendiente de abrir (doble clic, `open-file`, argumento de línea de comandos). Se consume una vez. */
  async pendingOpenPath(): Promise<OpenPathRequest | null> {
    return this.bridge.pendingOpenPath();
  }

  /** Nueva ruta `.bpmn` a abrir mientras la ventana ya está lista (segunda instancia/`open-file`). */
  onOpenPath(cb: (path: OpenPathRequest) => void): () => void {
    return this.bridge.onOpenPath(cb);
  }

  // -- Métodos históricos de `ProjectStore` (LILA-058) ----------------------------------------
  // Mínimo viable sobre el documento activo en memoria + `saveProject`, sin reinventar: esta
  // modalidad solo tiene un proyecto abierto a la vez, así que "processId" no distingue nada
  // propio — es el mismo compromiso que ya asume `BrowserStore` ("el id real es irrelevante en
  // esta modalidad", ver `App.tsx`). Quedan aquí porque `ProjectSessionStore` extiende
  // `ProjectStore`; el flujo pensado para esta modalidad es `createProject`/`openProject`/
  // `saveProject` de arriba.

  private emptyDocument(id: string): ProjectDocument {
    return {
      version: 1,
      id: crypto.randomUUID(),
      name: id,
      model: { id, name: id, xml: '', revision: 0 },
      scenarios: {},
      scenarioRevisions: {},
      runs: [],
    };
  }

  private scenarioFileName(name: string): string {
    return name.endsWith('.scenario.json') ? name : `${name}.scenario.json`;
  }

  async listProcesses(): Promise<readonly ProcessSummary[]> {
    if (this.activeDocument === null) return [];
    return [{ id: this.activeDocument.model.id, name: this.activeDocument.model.name }];
  }

  async getProcess(id: string): Promise<ProcessData | null> {
    if (this.activeDocument !== null && this.activeDocument.model.id === id) {
      return { xml: this.activeDocument.model.xml, name: this.activeDocument.model.name };
    }
    // No es el proceso ya cargado: como en `BrowserStore`, se abre el selector (aquí, de
    // carpeta) y se lee el proyecto completo; cancelar devuelve `null` igual que allí.
    const document = await this.openProject();
    if (document === null) return null;
    return { xml: document.model.xml, name: document.model.name };
  }

  async putProcess(id: string, xml: string): Promise<void> {
    const base = this.activeDocument ?? this.emptyDocument(id);
    await this.saveProject({ ...base, model: { ...base.model, xml } });
  }

  async listScenarios(_processId: string): Promise<readonly string[]> {
    return this.activeDocument === null ? [] : Object.keys(this.activeDocument.scenarios);
  }

  async putScenario(processId: string, name: string, scenario: Scenario): Promise<void> {
    const base = this.activeDocument ?? this.emptyDocument(processId);
    const fileName = this.scenarioFileName(name);
    await this.saveProject({
      ...base,
      scenarios: { ...base.scenarios, [fileName]: scenario as unknown as ScenarioDocument },
      scenarioRevisions: { ...base.scenarioRevisions, [fileName]: (base.scenarioRevisions[fileName] ?? 0) + 1 },
    });
  }

  async putRun(processId: string, scenarioName: string, result: RunResult): Promise<void> {
    const base = this.activeDocument ?? this.emptyDocument(processId);
    const fileName = this.scenarioFileName(scenarioName);
    const run: StoredRun = {
      id: crypto.randomUUID(),
      scenarioName: fileName,
      result,
      inputs: {
        modelRevision: base.model.revision,
        scenarioRevision: base.scenarioRevisions[fileName] ?? 0,
        xml: base.model.xml,
        scenario: base.scenarios[fileName] ?? {},
      },
    };
    await this.saveProject({ ...base, runs: [...base.runs, run] });
  }
}
