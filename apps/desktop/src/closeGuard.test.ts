import { describe, expect, it } from 'vitest';
import { closeDialogOptions, decideClose, saveFailedDialogOptions } from './closeGuard.js';
import { desktopStrings } from './strings/index.js';

describe('decideClose', () => {
  it('sin cambios, cierra sin importar la elección', () => {
    expect(decideClose(false, 'save', null)).toBe('close');
    expect(decideClose(false, 'discard', null)).toBe('close');
    expect(decideClose(false, 'cancel', null)).toBe('close');
    expect(decideClose(false, 'save', false)).toBe('close');
  });

  it('con cambios, "Cancelar" siempre se queda', () => {
    expect(decideClose(true, 'cancel', null)).toBe('stay');
  });

  it('con cambios, "Descartar" siempre cierra', () => {
    expect(decideClose(true, 'discard', null)).toBe('close');
  });

  it('con cambios, "Guardar" cierra solo si el guardado tuvo éxito', () => {
    expect(decideClose(true, 'save', true)).toBe('close');
  });

  it('con cambios, "Guardar" se queda si el guardado falló o no respondió a tiempo', () => {
    expect(decideClose(true, 'save', false)).toBe('stay');
    expect(decideClose(true, 'save', null)).toBe('stay');
  });
});

/**
 * The dialogs of LILA-213: the same two dialogs in two languages. What is checked is not only the
 * texts — that the catalog already guarantees — but that translating them did not move the
 * buttons: `confirmClose` reads `result.response` as an index, so Save has to stay at 0 and
 * Cancel at 2, with `defaultId`/`cancelId` pointing at them, in every language.
 */
const DIALOGO = [
  [
    'en',
    ['Save', 'Discard', 'Cancel'],
    'There are unsaved changes.',
    'Do you want to save the changes before closing?',
    'Could not save.',
    'Closing was cancelled so no changes are lost. Try saving manually again.',
  ],
  [
    'es',
    ['Guardar', 'Descartar', 'Cancelar'],
    'Hay cambios sin guardar.',
    '¿Quieres guardar los cambios antes de cerrar?',
    'No se pudo guardar.',
    'El cierre se canceló para no perder cambios. Vuelve a intentar guardar manualmente.',
  ],
] as const;

describe('closeDialogOptions', () => {
  it.each(DIALOGO)('%s · the texts come from the catalog', (locale, buttons, message, detail) => {
    const opciones = closeDialogOptions(desktopStrings(locale));
    expect(opciones.buttons).toEqual(buttons);
    expect(opciones.message).toBe(message);
    expect(opciones.detail).toBe(detail);
  });

  it('the button order, defaultId and cancelId are the same in every language', () => {
    for (const [locale] of DIALOGO) {
      const opciones = closeDialogOptions(desktopStrings(locale));
      expect(opciones.type).toBe('question');
      expect(opciones.buttons).toHaveLength(3);
      expect(opciones.defaultId).toBe(0);
      expect(opciones.cancelId).toBe(2);
    }
    // The indices `confirmClose` maps to a `CloseChoice`: 0 saves, 1 discards, everything else
    // cancels. Reordering the buttons for one language would silently change the user's choice.
    const [en, es] = DIALOGO.map(([locale]) => closeDialogOptions(desktopStrings(locale)));
    expect(en!.buttons?.[0]).toBe('Save');
    expect(es!.buttons?.[0]).toBe('Guardar');
    expect(en!.buttons?.[2]).toBe('Cancel');
    expect(es!.buttons?.[2]).toBe('Cancelar');
  });
});

describe('saveFailedDialogOptions', () => {
  it.each(DIALOGO)('%s · reports the failed save as an error, with no buttons of its own', (
    locale,
    _buttons,
    _message,
    _detail,
    errorMensaje,
    errorDetalle,
  ) => {
    const opciones = saveFailedDialogOptions(desktopStrings(locale));
    expect(opciones.type).toBe('error');
    expect(opciones.message).toBe(errorMensaje);
    expect(opciones.detail).toBe(errorDetalle);
    // No `buttons`: it is an acknowledgement, and Electron puts the OS's own OK there.
    expect(opciones.buttons).toBeUndefined();
  });
});
