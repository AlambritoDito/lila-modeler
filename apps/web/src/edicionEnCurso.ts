/**
 * Commits whatever the user is still typing before the app reads the model: a label in bpmn-js's
 * direct editing (QA S1 of #507) and a form field that writes on blur, such as an extended
 * attribute's number or date (#509, second QA pass of #513). Saving, exporting, Run and the close
 * guard call it first, so a value on screen is never missing from what they write.
 *
 * Only a text field is blurred: selects and checkboxes already write on change, and moving the
 * focus off a button would only disturb keyboard users. `flushSync` lets React re-render with the
 * new model revision before the caller goes on, so a save compares against the token that
 * includes that value.
 */
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

interface EdicionDirecta { isActive?(): boolean; complete?(): void }

export function confirmarEdicionEnCurso(directEditing?: EdicionDirecta): void {
  const activo = typeof document === 'undefined' ? null : document.activeElement;
  const campo = activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement ? activo : null;
  const editando = directEditing?.isActive?.() === true;
  // Nothing to commit, no `flushSync`: Run can also start from an effect, where it may not flush.
  if (!editando && campo === null) return;
  flushSync(() => {
    if (editando) directEditing?.complete?.();
    campo?.blur();
  });
}

/**
 * Fields holding a valid value not yet in the model. While there is one the project counts as
 * unsaved (`App.tsx`), so the close guard asks and its save commits it through the helper above.
 */
const pendientes = new Set<object>();
const oyentes = new Set<() => void>();

export function marcarBorrador(campo: object, pendiente: boolean): void {
  if (pendiente === pendientes.has(campo)) return;
  if (pendiente) pendientes.add(campo);
  else pendientes.delete(campo);
  for (const oyente of oyentes) oyente();
}

export const hayBorradorPendiente = (): boolean => pendientes.size > 0;

export function useBorradorPendiente(): boolean {
  return useSyncExternalStore((oyente) => {
    oyentes.add(oyente);
    return () => oyentes.delete(oyente);
  }, hayBorradorPendiente);
}
