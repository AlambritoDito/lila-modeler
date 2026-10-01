/**
 * Path predicates shared by the project disk IO (`projectIO.ts`, `lilaFile.ts`) and by the desktop,
 * which re-exports them from `openPath.ts`/`safePaths.ts`. Moved here from `apps/desktop` with the
 * rest of the project disk IO (#466); the desktop modules keep their old names so nothing there had
 * to change.
 */
import { lstat } from 'node:fs/promises';

/** The project's model file (the same `MODEL_FILE` as `projectIO.ts`). */
const MODEL_FILE = 'model.bpmn';

/**
 * `true` if `p` ends in `.lila`, the project container of ADR-027 (case-insensitive: `Pedido.LILA`
 * counts too).
 */
export function isLilaPath(p: string): boolean {
  return p.toLowerCase().endsWith('.lila');
}

/**
 * `true` si `name` es el `model.bpmn` del proyecto escrito con otras mayúsculas (`Model.bpmn`,
 * `MODEL.BPMN`) — un nombre que el puente RECHAZA (LILA-206, P3 del QA).
 *
 * `projectIO` compara el nombre del `.bpmn` abierto con `model.bpmn` usando `===`, así que
 * `Model.bpmn` cuenta como «otro diagrama» y se guarda en modo `diagramOnly`. En macOS y Windows
 * (sistemas de archivos insensibles a mayúsculas) es EL MISMO archivo: se sobrescribiría el
 * `model.bpmn` real dejando el manifiesto con la revisión vieja y sin guardar escenarios ni
 * corridas, en silencio. Normalizar a `model.bpmn` arreglaría eso ahí, pero en Linux `Model.bpmn`
 * y `model.bpmn` son dos archivos distintos y la normalización pisaría el modelo del proyecto con
 * otro diagrama: pérdida de datos. Como ninguna de las dos interpretaciones vale en las dos
 * plataformas, se rechaza; renombrar el archivo es cosa de un segundo y no pierde nada.
 */
export function isMiscasedModelFile(name: string): boolean {
  return name !== MODEL_FILE && name.toLowerCase() === MODEL_FILE;
}

/**
 * `true` si `target` existe y es un symlink (`lstat`, que a diferencia de `stat` no sigue el
 * enlace). `false` si no existe — quien llama decide qué hacer con "no existe" por separado; esto
 * solo distingue "existe y es un enlace" de todo lo demás (OP-14, revisión de A sobre OP-02:
 * "sigue symlinks fuera de la carpeta autorizada", issue #71). Usado por `projectIO.ts` para
 * excluir en lectura (con `problems`) y rechazar en escritura cualquier archivo/carpeta de
 * proyecto que resulte ser un enlace hacia fuera de la carpeta autorizada, sin necesidad de
 * resolver el enlace primero (evita tocar el destino externo).
 */
export async function isSymlink(target: string): Promise<boolean> {
  try {
    const info = await lstat(target);
    return info.isSymbolicLink();
  } catch (error) {
    if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}
