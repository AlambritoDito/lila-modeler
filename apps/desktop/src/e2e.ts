/**
 * Seam de pruebas E2E por variables de entorno (OP-14, issue #74: "F no puede accionar diálogos
 * nativos desde su sesión"). Solo para pruebas — NO es una API pública. `main.ts` llama a
 * `e2eOverrides(process.env)` una única vez al arrancar y, según lo que venga definido, sustituye
 * el diálogo nativo correspondiente por un valor fijo. Sin ninguna de las tres variables,
 * `e2eOverrides` devuelve `{}` y el comportamiento de `main.ts` es idéntico al actual.
 *
 * - `LILA_E2E_FOLDER=<ruta absoluta>`: `chooseFolder()` devuelve esa ruta (creándola si falta, y
 *   anotándola como autorizada por `realpath`, igual que el diálogo real) en vez de abrir el
 *   selector nativo. El valor literal `"cancel"` simula que el usuario cerró el diálogo sin elegir
 *   nada: `chooseFolder()` resuelve `null`.
 * - `LILA_E2E_SAVE_FILE=<ruta absoluta a un .lila>`: lo mismo para `chooseSaveFile()` (el diálogo
 *   nativo de «Guardar como» hacia un `.lila` nuevo, ADR-027): devuelve esa ruta, autorizando su
 *   carpeta contenedora igual que el diálogo real, o `null` con el valor literal `"cancel"`.
 * - `LILA_E2E_CLOSE=save|discard|cancel`: el diálogo nativo Guardar/Descartar/Cancelar del cierre
 *   se resuelve con esa opción sin mostrarse. Cualquier otro valor es inválido y se ignora (se
 *   sigue mostrando el diálogo real, como si la variable no existiera).
 * - `LILA_E2E_LOG=<ruta de archivo>`: `main.ts` añade una línea JSON por evento relevante
 *   (`chooseFolder`, `writeProject` con éxito/error y código, `closeRequested` con la elección y el
 *   resultado, `openPath`) a ese archivo, para que la sesión de pruebas la lea después del
 *   recorrido.
 *
 * Un valor ausente, vacío, o con forma inválida para cualquiera de las variables se ignora —
 * esa clave en particular queda ausente de `E2EOverrides`, exactamente como si no se hubiera
 * puesto la variable.
 */

export type E2ECloseChoice = 'save' | 'discard' | 'cancel';

export interface E2EOverrides {
  /**
   * `undefined`: sin override, `chooseFolder()` usa el diálogo nativo. `null`: `LILA_E2E_FOLDER`
   * valía literalmente `"cancel"` (simula cancelar el diálogo). `string`: la ruta a usar.
   */
  readonly folder?: string | null;
  /** Lo mismo que `folder`, para `chooseSaveFile()` (`LILA_E2E_SAVE_FILE`). */
  readonly saveFile?: string | null;
  readonly close?: E2ECloseChoice;
  readonly logPath?: string;
}

const CLOSE_CHOICES: ReadonlySet<string> = new Set<E2ECloseChoice>(['save', 'discard', 'cancel']);

function isCloseChoice(value: string): value is E2ECloseChoice {
  return CLOSE_CHOICES.has(value);
}

/** Parsea las variables de entorno del seam E2E. Cualquier valor ausente o con forma inválida se ignora. */
export function e2eOverrides(env: Readonly<Record<string, string | undefined>>): E2EOverrides {
  const result: { folder?: string | null; saveFile?: string | null; close?: E2ECloseChoice; logPath?: string } = {};

  const folder = env.LILA_E2E_FOLDER;
  if (typeof folder === 'string' && folder.length > 0) {
    result.folder = folder === 'cancel' ? null : folder;
  }

  const saveFile = env.LILA_E2E_SAVE_FILE;
  if (typeof saveFile === 'string' && saveFile.length > 0) {
    result.saveFile = saveFile === 'cancel' ? null : saveFile;
  }

  const close = env.LILA_E2E_CLOSE;
  if (typeof close === 'string' && isCloseChoice(close)) {
    result.close = close;
  }

  const logPath = env.LILA_E2E_LOG;
  if (typeof logPath === 'string' && logPath.length > 0) {
    result.logPath = logPath;
  }

  return result;
}
