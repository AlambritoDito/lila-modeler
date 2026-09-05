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
import type { RunResult } from '@lila/engine';
import type { Scenario } from '@lila/engine/schema';

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
