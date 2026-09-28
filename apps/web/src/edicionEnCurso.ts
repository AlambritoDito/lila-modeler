/**
 * Commits whatever the user is still typing before the app reads the model: a label in bpmn-js's
 * direct editing (QA S1 of #507) and a form field that writes on blur, such as an extended
 * attribute's number or date (#509, second QA pass of #513). Saving, exporting, Run and the close
 * guard call it first, so a value on screen is never missing from what they write.
 *
 * Only a text field is blurred: selects and checkboxes already write on change, and moving the
 * focus off a button would only disturb keyboard users.
 */
interface EdicionDirecta { isActive?(): boolean; complete?(): void }

export function confirmarEdicionEnCurso(directEditing?: EdicionDirecta): void {
  if (directEditing?.isActive?.()) directEditing.complete?.();
  const activo = typeof document === 'undefined' ? null : document.activeElement;
  if (activo instanceof HTMLInputElement || activo instanceof HTMLTextAreaElement) activo.blur();
}
