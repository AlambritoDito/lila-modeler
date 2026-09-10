/**
 * Resuelve el parámetro `scenario` de `run_simulation`/`compare_scenarios` (LILA-054): una ruta
 * `.json` (relativa al cwd del proceso, con `extends` igual que la CLI) o el escenario ya resuelto
 * como objeto inline.
 *
 * Un objeto inline se ancla a un archivo virtual `<escenario-inline>.json` en el cwd del proceso:
 * si declara `extends`, esa referencia (y cualquier `model` relativo) se resuelve contra el cwd,
 * igual que si el agente hubiera guardado el objeto ahí antes de pasarlo. `loadResolvedScenario`
 * (de `@lila/engine/cli-shared`, LILA-054) hace la misma validación de escenario resuelto para
 * ambos casos: no se duplica frente a la CLI.
 */
import { absolutePath, loadResolvedScenario, readJsonFile } from '@lila/engine/cli-shared';
import { messages, type Locale } from '@lila/engine/messages';
import type { ResolvedScenario } from '@lila/engine/schema';

export type ScenarioInput = string | Record<string, unknown>;

/** Nombre del ancla virtual: no existe en disco, así que nunca debe salir en un mensaje. */
const INLINE_FILE = '<escenario-inline>.json';

export function resolveScenarioInput(input: ScenarioInput, locale: Locale = 'en'): ResolvedScenario {
  if (typeof input === 'string') return loadResolvedScenario(absolutePath(input), undefined, locale);

  const virtualPath = absolutePath(INLINE_FILE);
  try {
    return loadResolvedScenario(
      virtualPath,
      (file) => (file === virtualPath ? input : readJsonFile(file, locale)),
      locale,
    );
  } catch (error) {
    // Los mensajes de `loadResolvedScenario`/`resolveExtends` citan el archivo. El ancla no existe
    // en disco: dejarla en el mensaje manda al agente a leer una ruta inventada.
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(detail.replaceAll(virtualPath, messages(locale).mcp.inlineScenario()));
  }
}
