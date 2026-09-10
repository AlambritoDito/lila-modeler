/**
 * Costura entre la SPA y su modalidad de ejecución (LILA-058, ADR-023). El shell —`main.tsx`,
 * y los paneles que lleguen después— habla siempre contra esta interfaz, nunca contra
 * `window.lila`, `fetch` o `<input type=file>` directamente: así el mismo `apps/web` corre en
 * el navegador, en Electron y contra un servidor sin que la UI sepa cuál de los tres es.
 *
 * Implementaciones:
 * - `BrowserStore` (este ticket): demo online sin persistencia — abre y descarga archivos.
 * - `DesktopStore` (LILA-071): Electron, sobre `window.lila.{openFile,saveFile,readProject}`.
 * - `RemoteStore` (LILA-086): servidor self-hosted (`packages/server`, M6), sobre su REST.
 *
 * Tipos: `xml` es el `.bpmn` tal cual lo produce `Modelador.exportar()` (ver `Modeler.tsx`);
 * `scenario` es el `Scenario` de `@lila/engine/schema` — el formato v1 de
 * `docs/SCENARIO_FORMAT.md`, sin resolver `extends`; `result` es el `RunResult` de
 * `docs/RESULTS_FORMAT.md`. Ningún método aquí es especulativo: son exactamente los seis que
 * pide el ticket, ni uno más.
 */
import type { SaveOutcome } from '../../../desktop/src/bridge.js';
import type { RunResult } from '@lila/engine';
import type { Scenario } from '@lila/engine/schema';
import type { ProjectDocument } from '@lila/engine/project';

/** Lo mínimo para listar un proceso sin cargar su XML. */
export interface ProcessSummary {
  readonly id: string;
  readonly name: string;
}

/** Un proceso ya cargado: su XML y el nombre con el que se muestra en la UI. */
export interface ProcessData {
  readonly xml: string;
  readonly name: string;
}

export interface ProjectStore {
  /** Procesos disponibles en esta modalidad (en `BrowserStore`, los de esta sesión). */
  listProcesses(): Promise<readonly ProcessSummary[]>;
  /**
   * Carga el proceso `id`. En `BrowserStore`, si no está en memoria abre un selector de
   * archivo. `null` es «se cerró el diálogo sin elegir nada»: no es un error y no se le
   * enseña a nadie. `DesktopStore` (LILA-071) devuelve `null` en el mismo caso, al cancelarse
   * `dialog.showOpenDialog`; que un proceso pedido por id no exista sí es una excepción.
   */
  getProcess(id: string): Promise<ProcessData | null>;
  /** Guarda `xml` como el proceso `id`. En `BrowserStore`, descarga el archivo. */
  putProcess(id: string, xml: string): Promise<void>;
  /** Nombres de los escenarios guardados para `processId`. */
  listScenarios(processId: string): Promise<readonly string[]>;
  /** Guarda un escenario con nombre `name` para `processId`. */
  putScenario(processId: string, name: string, scenario: Scenario): Promise<void>;
  /** Guarda el resultado de correr `scenarioName` sobre `processId`. */
  putRun(processId: string, scenarioName: string, result: RunResult): Promise<void>;
}

/**
 * The project document contract now lives in `@lila/engine/project` (ADR-024): `apps/desktop`
 * kept a hand-maintained copy of these same four shapes and the `.lila` container needs them
 * too, so the definition moved to the one package both already depend on. Re-exported here
 * because this module is what the SPA imports — the rest of the app did not have to change.
 */
export type { ProjectDocument, ProjectProblem, ScenarioDocument, StoredRun } from '@lila/engine/project';

/** Snapshot coherente; null es cancelación, error rechaza la promesa. */
export interface ProjectSessionStore extends ProjectStore {
  createProject(document: ProjectDocument): Promise<ProjectDocument | null>;
  /**
   * `options.fileOnly` pide explícitamente el contenedor `.lila` (ADR-024) en vez de una carpeta
   * de proyecto. Solo lo usa `DesktopStore`, donde son dos diálogos nativos distintos fuera de
   * macOS; `BrowserStore` ya abre las dos cosas con el mismo `<input type=file>` y lo ignora.
   */
  openProject(options?: { readonly fileOnly?: boolean }): Promise<ProjectDocument | null>;
  saveProject(document: ProjectDocument, options?: { saveAs?: boolean }): Promise<ProjectDocument | null>;
  /** Browser-only: last explicitly saved project, restored on startup without a file picker. */
  restoreSession?(): ProjectDocument | null;
  setDirty?(dirty: boolean): void;
  onSaveRequested?(save: () => Promise<SaveOutcome>): () => void;
  /**
   * Reabre un proyecto reciente sin diálogo; `null` si ya no existe. Solo `DesktopStore`.
   * `file` es el `.bpmn` a abrir como modelo cuando no es el `model.bpmn` del proyecto (LILA-072).
   */
  openRecent?(dir: string, file?: string): Promise<ProjectDocument | null>;
}
