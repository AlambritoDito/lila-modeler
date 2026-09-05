/**
 * `ProjectStore` de la demo online (LILA-058, ADR-023, ADR-018): sin persistencia real, todo
 * vive en memoria mientras dura la pestaña. Abrir es un selector de archivo nativo; guardar es
 * una descarga. Es la modalidad que arranca `main.tsx`; `DesktopStore` (LILA-071) y
 * `RemoteStore` (LILA-086) sustituyen esto sin que el resto de la SPA lo note.
 */
import type { RunResult } from '@lila/engine';
import type { Scenario } from '@lila/engine/schema';
import type { ProcessData, ProcessSummary, ProjectStore } from './ProjectStore';

/** Crea, dispara y limpia un `<input type=file>` invisible; resuelve con el archivo elegido. */
function elegirArchivo(): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bpmn,.xml';
    input.hidden = true;
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        input.remove();
        if (file === undefined) {
          reject(new Error('No se eligió ningún archivo.'));
          return;
        }
        resolve(file);
      },
      { once: true },
    );
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

export class BrowserStore implements ProjectStore {
  private readonly procesos: Map<string, ProcessData>;
  private readonly escenarios = new Map<string, Map<string, Scenario>>();

  /** `semilla`: procesos ya cargados al arrancar (en `main.tsx`, `examples/pedido`). */
  constructor(semilla: ReadonlyMap<string, ProcessData> = new Map()) {
    this.procesos = new Map(semilla);
  }

  async listProcesses(): Promise<readonly ProcessSummary[]> {
    return [...this.procesos].map(([id, { name }]) => ({ id, name }));
  }

  async getProcess(id: string): Promise<ProcessData> {
    const cargado = this.procesos.get(id);
    if (cargado !== undefined) return cargado;
    const archivo = await elegirArchivo();
    const datos: ProcessData = { xml: await archivo.text(), name: archivo.name };
    this.procesos.set(id, datos);
    return datos;
  }

  async putProcess(id: string, xml: string): Promise<void> {
    const nombre = this.procesos.get(id)?.name ?? id;
    this.procesos.set(id, { xml, name: nombre });
    descargar(xml, nombre, 'application/xml');
  }

  async listScenarios(processId: string): Promise<readonly string[]> {
    return [...(this.escenarios.get(processId)?.keys() ?? [])];
  }

  async putScenario(processId: string, name: string, scenario: Scenario): Promise<void> {
    const deProceso = this.escenarios.get(processId) ?? new Map<string, Scenario>();
    deProceso.set(name, scenario);
    this.escenarios.set(processId, deProceso);
    descargar(JSON.stringify(scenario, null, 2), `${name}.scenario.json`, 'application/json');
  }

  async putRun(processId: string, scenarioName: string, result: RunResult): Promise<void> {
    descargar(
      JSON.stringify(result, null, 2),
      `${processId}-${scenarioName}.result.json`,
      'application/json',
    );
  }
}
