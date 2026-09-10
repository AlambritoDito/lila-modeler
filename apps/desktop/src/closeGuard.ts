/**
 * Máquina de decisión del cierre con cambios sin guardar (OP-14, issue #74). Pura: el diálogo
 * nativo (`dialog.showMessageBox`) y el guardado en sí viven en `main.ts`/`DesktopStore`; esto
 * solo captura la tabla "dirty + elección + resultado del guardado → ¿cierra?" para poder
 * probarla sin Electron. El diálogo real no se automatiza (ver estado del ticket).
 *
 * The dialog TEXTS come from the catalog (`strings/`, LILA-213), and the options
 * `dialog.showMessageBox` receives are built at the bottom of this file — here, and pure too — so
 * that the order of the buttons can be tested in both languages.
 */
import type { MessageBoxOptions } from 'electron';
import type { SaveOutcome } from './bridge.js';
import type { Strings } from './strings/index.js';

/** Elección del usuario en el diálogo nativo "Guardar" / "Descartar" / "Cancelar". */
export type CloseChoice = 'save' | 'discard' | 'cancel';

export type CloseDecision = 'close' | 'stay';

/** Only a complete save permits closing; cancellation and partial saves preserve the window. */
export function decideClose(dirty: boolean, choice: CloseChoice, saved: SaveOutcome | null): CloseDecision {
  if (!dirty) return 'close';
  if (choice === 'cancel') return 'stay';
  if (choice === 'discard') return 'close';
  // choice === 'save'
  return saved === 'saved' ? 'close' : 'stay';
}

/**
 * Options for the native Save/Discard/Cancel dialog (LILA-213). They live here, rather than
 * inline in `main.ts`, for the same reason the table above does: so the order of the buttons —
 * which `defaultId`, `cancelId` and the reading of `response` in `confirmClose` all depend on —
 * can be tested in both languages without Electron behind it. Only the `electron` type is
 * imported, and it is erased at compile time.
 *
 * `buttons[0]` is Save and `buttons[2]` Cancel in every language: `confirmClose` maps the index
 * of the response to a `CloseChoice`, so reordering them would change the user's choice.
 */
export function closeDialogOptions(strings: Strings): MessageBoxOptions {
  const S = strings.cierre;
  return {
    type: 'question',
    buttons: [S.guardar, S.descartar, S.cancelar],
    defaultId: 0,
    cancelId: 2,
    message: S.mensaje,
    detail: S.detalle,
  };
}

/**
 * Options for the second dialog: the save the user asked for did not go through (it failed, or
 * the renderer did not answer in time), so the window stays open and that has to be said.
 */
export function saveFailedDialogOptions(strings: Strings): MessageBoxOptions {
  const S = strings.cierre;
  return { type: 'error', message: S.errorMensaje, detail: S.errorDetalle };
}

/** Validate the renderer boundary; malformed replies cannot authorize closing. */
export function readSaveOutcome(payload: unknown): SaveOutcome {
  const value = typeof payload === 'object' && payload !== null
    ? (payload as { saved?: unknown }).saved : undefined;
  return value === 'saved' || value === 'diagram-only' || value === 'cancelled' ? value : 'failed';
}

/** Cancellation is not an error; a partial save explains what remains in memory. */
export function saveOutcomeDialogOptions(outcome: SaveOutcome, strings: Strings): MessageBoxOptions | null {
  if (outcome === 'failed') return saveFailedDialogOptions(strings);
  if (outcome === 'diagram-only') return {
    type: 'info', message: strings.cierre.parcialMensaje, detail: strings.cierre.parcialDetalle,
  };
  return null;
}
