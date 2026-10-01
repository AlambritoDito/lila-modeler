/**
 * Resuelve el parámetro `scenario` de `run_simulation`/`compare_scenarios` (LILA-054): una ruta
 * `.json` (relativa al cwd del proceso, con `extends` igual que la CLI) o el escenario ya resuelto
 * como objeto inline.
 *
 * Un objeto inline se ancla a un archivo virtual `<escenario-inline>.json` en el cwd del proceso:
 * si declara `extends`, esa referencia (y cualquier `model` relativo) se resuelve contra el cwd,
 * igual que si el agente hubiera guardado el objeto ahí antes de pasarlo. `loadResolvedScenario`
 * (de `@lila-modeler/engine/cli-shared`, LILA-054) hace la misma validación de escenario resuelto para
 * ambos casos: no se duplica frente a la CLI.
 */
import {
  absolutePath,
  loadResolvedScenario,
  readJsonFile,
  resolveScenarioArgument,
} from '@lila-modeler/engine/cli-shared';
import { messages, type Locale } from '@lila-modeler/engine/messages';
import { lilaScenarioReader, type LilaProcess } from '@lila-modeler/engine/project-fs';
import type { ResolvedScenario } from '@lila-modeler/engine/schema';

export type ScenarioInput = string | Record<string, unknown>;

/** Nombre del ancla virtual: no existe en disco, así que nunca debe salir en un mensaje. */
const INLINE_FILE = '<escenario-inline>.json';

/**
 * With `lila` (the model is a `.lila`, #466), a string is a `.json` path or a scenario name of
 * the process (`resolveScenarioArgument`), and an inline object is anchored inside the process's
 * folder of the archive instead of the cwd: its `extends: "as-is.scenario.json"` names a scenario
 * of the process, and a missing `model` means the process's `model.bpmn`.
 */
export function resolveScenarioInput(
  input: ScenarioInput,
  locale: Locale = 'en',
  lila?: LilaProcess | undefined,
): ResolvedScenario {
  if (typeof input === 'string') return resolveScenarioArgument(input, lila, locale).scenario;

  const disk = (file: string): unknown => readJsonFile(file, locale);
  const virtualPath = lila === undefined ? absolutePath(INLINE_FILE) : `${lila.root}${INLINE_FILE}`;
  const read = lila === undefined ? disk : lilaScenarioReader(lila, disk, locale);
  const anchored = lila !== undefined && !('model' in input) ? { ...input, model: 'model.bpmn' } : input;
  try {
    return loadResolvedScenario(virtualPath, (file) => (file === virtualPath ? anchored : read(file)), locale);
  } catch (error) {
    // Los mensajes de `loadResolvedScenario`/`resolveExtends` citan el archivo. El ancla no existe
    // en disco: dejarla en el mensaje manda al agente a leer una ruta inventada.
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(detail.replaceAll(virtualPath, messages(locale).mcp.inlineScenario()));
  }
}
