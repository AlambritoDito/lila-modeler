/**
 * Máquina de decisión del cierre con cambios sin guardar (OP-14, issue #74). Pura: el diálogo
 * nativo (`dialog.showMessageBox`) y el guardado en sí viven en `main.ts`/`DesktopStore`; esto
 * solo captura la tabla "dirty + elección + resultado del guardado → ¿cierra?" para poder
 * probarla sin Electron. El diálogo real no se automatiza (ver estado del ticket).
 */

/** Elección del usuario en el diálogo nativo "Guardar" / "Descartar" / "Cancelar". */
export type CloseChoice = 'save' | 'discard' | 'cancel';

export type CloseDecision = 'close' | 'stay';

/**
 * `saved` solo importa cuando `choice === 'save'`: `true` si el renderer confirmó el guardado a
 * tiempo, `false` si falló o no respondió en el plazo (main.ts usa 30 s), `null` cuando no aplica
 * (otra elección). Sin cambios (`dirty === false`) siempre cierra, sin mostrar diálogo — pero la
 * función es total: no requiere que la llamada dependa de haber mostrado el diálogo antes.
 */
export function decideClose(dirty: boolean, choice: CloseChoice, saved: boolean | null): CloseDecision {
  if (!dirty) return 'close';
  if (choice === 'cancel') return 'stay';
  if (choice === 'discard') return 'close';
  // choice === 'save'
  return saved === true ? 'close' : 'stay';
}
