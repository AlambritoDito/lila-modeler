/**
 * Detección de una ruta `.bpmn` a abrir desde argumentos de línea de comandos (OP-14, incremento
 * 2, "arranque frío y segunda apertura" de OP-12). Pura: sin `electron`, sin tocar el sistema de
 * archivos — `main.ts` decide qué hacer con la ruta encontrada (verificar que existe, autorizar su
 * carpeta) usando `node:fs/promises`. `node:path` sí se usa (solo el nombre de archivo, sin
 * tocar disco), para que `openPathRequest` de abajo también sea pura.
 */
import path from 'node:path';
import type { OpenPathRequest } from './bridge.js';

/** `true` si `p` termina en `.bpmn` (insensible a mayúsculas: `Model.BPMN` también cuenta). */
export function isBpmnPath(p: string): boolean {
  return p.toLowerCase().endsWith('.bpmn');
}

/**
 * `isLilaPath` (`.lila`, ADR-027) and `isMiscasedModelFile` (LILA-206) live with the project disk IO
 * in `@lila-modeler/engine/project-fs` since #466; re-exported here so `main.ts` and the tests keep
 * importing them from this module.
 */
export { isLilaPath, isMiscasedModelFile } from '@lila-modeler/engine/project-fs';
import { isLilaPath } from '@lila-modeler/engine/project-fs';

/**
 * La ruta que el diálogo nativo de «Guardar como» devolvió, con la extensión `.lila` puesta si le
 * faltaba (ADR-027). Windows y Linux añaden la extensión del filtro solo a veces, y en macOS el
 * usuario puede quitarla a mano en el campo del nombre; sin esto, el archivo resultante se
 * guardaría con el formato correcto y un nombre que ni `isLilaPath` ni el sistema reconocen, así
 * que al reabrirlo no sería un proyecto. Una ruta que ya termina en `.lila` (en cualquier
 * combinación de mayúsculas) se devuelve tal cual.
 */
export function withLilaExtension(p: string): string {
  return isLilaPath(p) ? p : `${p}.lila`;
}

/**
 * Primer argumento de `argv` (desde el índice `skip`) que parece una ruta `.bpmn` de usuario: no
 * empieza por `-` (para no confundir una flag como `--foo.bpmn`, que no es un caso real pero
 * cuesta cero excluir) y termina en `.bpmn`. `skip` deja fuera el ejecutable y, sin empaquetar, la
 * carpeta de la app (`main.ts` decide cuánto según `app.isPackaged`); para `second-instance`
 * (Electron ya entrega `argv` sin ese prefijo variable) usa `skip = 1` para saltar el propio
 * ejecutable. `null` si ninguno califica.
 */
export function findBpmnArg(argv: readonly string[], skip: number): string | null {
  for (let i = skip; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== undefined && !arg.startsWith('-') && (isBpmnPath(arg) || isLilaPath(arg))) return arg;
  }
  return null;
}

/**
 * Forma de `lila:open-path` para `filePath` ya autorizado, dado `realDir` (issue #378): para un
 * `.lila`, `realDir` YA es la ruta del propio archivo (`acceptOpenPath` en `main.ts` lo autoriza
 * así, no su carpeta) y no hay `.bpmn` suelto que nombrar, así que `file` se omite; para un
 * `.bpmn`, `realDir` es la carpeta que lo contiene y `file` es su nombre plano dentro de ella.
 * Mandar `file` para un `.lila` dejaba `DesktopStore.activeModelFile` con un nombre `.lila`, y el
 * siguiente guardado normal reventaba en `lila:writeProject`/`requireBpmnName` ("file" debe ser
 * un nombre de archivo .bpmn) — este helper es la única frontera que decide la forma, para que
 * `main.ts` no pueda volver a mandar los dos campos por accidente.
 *
 * `realDir` es lo que `fs.realpath` devolvió para `filePath` — sigue symlinks. Un symlink
 * `algo.lila` que en realidad apunta a una CARPETA (o a un archivo que no termina en `.lila`)
 * hacía, antes de este chequeo, que `main.ts` mandara `{ dir: realDir }` sin `file`: el otro
 * extremo (`lila:openRecent`/`lila:readProject`) ve una `dir` que no termina en `.lila` y la abre
 * como carpeta de proyecto — silencioso, y no lo que el nombre `.lila` prometía. Se rechaza aquí,
 * en la frontera, con el mismo código `E-ARGUMENTO` que ya usa el puente para argumentos con forma
 * inválida (`requireBpmnName`, `main.ts`): `acceptOpenPath` atrapa esto y ni autoriza la carpeta.
 */
export function openPathRequest(filePath: string, realDir: string): OpenPathRequest {
  if (isLilaPath(filePath)) {
    if (!isLilaPath(realDir)) {
      throw new Error(
        `E-ARGUMENTO: "filePath" debe resolver (symlinks incluidos) a un archivo ".lila" (recibido: ${JSON.stringify(filePath)}, resuelve a ${JSON.stringify(realDir)}).`,
      );
    }
    return { dir: realDir };
  }
  return { dir: realDir, file: path.basename(filePath) };
}
