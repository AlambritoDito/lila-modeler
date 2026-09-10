/**
 * Spanish translation of the desktop shell's base catalog (`en.ts`, LILA-213).
 *
 * This file does not decide which texts exist: `en.ts` fixes that, and the `Strings` type
 * (`types.ts`) forces this translation to have exactly its keys, with the same shape. Forgetting
 * a key, inventing one or changing its kind does not compile; `strings.test.ts` checks the same
 * thing at runtime, walking both objects.
 *
 * The texts below are the ones the app has shipped since OP-02/OP-14, unchanged to the letter:
 * a Spanish user sees exactly the same menu and the same dialogs as before this ticket.
 */
import type { Strings } from './types.js';

export const es: Strings = {
  menu: {
    preferencias: 'Preferencias…',
    ninguno: 'Ninguno',
    archivo: 'Archivo',
    nuevoProyecto: 'Nuevo proyecto',
    abrirProyecto: 'Abrir proyecto…',
    abrirReciente: 'Abrir reciente',
    guardarProyecto: 'Guardar proyecto',
    guardarComo: 'Guardar como…',
  },
  cierre: {
    guardar: 'Guardar',
    descartar: 'Descartar',
    cancelar: 'Cancelar',
    mensaje: 'Hay cambios sin guardar.',
    detalle: '¿Quieres guardar los cambios antes de cerrar?',
    parcialMensaje: 'El diagrama se guardó.',
    parcialDetalle: 'Los escenarios y las corridas siguen sin guardarse. Usa «Guardar como…» para guardar el proyecto completo. La ventana permanecerá abierta.',
    errorMensaje: 'No se pudo guardar.',
    errorDetalle: 'El cierre se canceló para no perder cambios. Vuelve a intentar guardar manualmente.',
  },
};
