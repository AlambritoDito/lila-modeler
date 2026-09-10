/**
 * Detección de una ruta `.bpmn` a abrir desde argumentos de línea de comandos (OP-14, incremento
 * 2, "arranque frío y segunda apertura" de OP-12). Pura: sin `electron`, sin tocar el sistema de
 * archivos — `main.ts` decide qué hacer con la ruta encontrada (verificar que existe, autorizar su
 * carpeta) usando `node:fs/promises`.
 */

/** `true` si `p` termina en `.bpmn` (insensible a mayúsculas: `Model.BPMN` también cuenta). */
export function isBpmnPath(p: string): boolean {
  return p.toLowerCase().endsWith('.bpmn');
}

/**
 * `true` si `p` termina en `.lila`, el contenedor de proyecto de ADR-024 (insensible a mayúsculas,
 * mismo criterio que `isBpmnPath`). Vive aquí, en el módulo puro, porque lo necesitan tanto
 * `main.ts` como `lilaFile.ts` y este es el único que no arrastra `node:fs`.
 */
export function isLilaPath(p: string): boolean {
  return p.toLowerCase().endsWith('.lila');
}

/**
 * El `model.bpmn` de un proyecto Lila (el mismo `MODEL_FILE` de `projectIO.ts`, repetido aquí
 * porque este módulo es puro y no importa nada).
 */
const MODEL_FILE = 'model.bpmn';

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
