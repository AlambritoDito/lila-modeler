/**
 * Base catalog of the desktop shell's texts (LILA-213): the native menu that `menu.ts` builds and
 * the close dialogs that `main.ts` shows. Everything a person reads that is written by the main
 * process — and nothing else — comes from here.
 *
 * Three boundaries that explain how short this file is:
 *
 * 1. **The renderer has its own catalog.** Every text inside the window comes from
 *    `apps/web/src/strings.en.ts`; this one only covers what lives outside it. The two follow the
 *    same convention — base language `as const`, translation annotated with `Strings` — but they
 *    are separate files because `apps/desktop` cannot import `apps/web` sources (see `types.ts`).
 * 2. **Electron's role menus are not here.** `appMenu`, `editMenu`, `viewMenu` and `windowMenu`
 *    are localised by the OS from its own language, so translating them here would only make them
 *    disagree with the rest of the menu bar.
 * 3. **The `E-*` messages are not here either.** `projectIO.ts` and the IPC guards in `main.ts`
 *    throw codes that the renderer maps to text; they are a contract between processes, not a
 *    label, and they stay as they are.
 *
 * Keys stay in Spanish, like the web catalog's: they are identifiers, not text anybody reads.
 */
export const en = {
  /** Native menu (`menu.ts`). The role submenus are localised by the OS and not listed here. */
  menu: {
    preferencias: 'Preferences…',
    /** The «Open Recent» submenu when there is no recent project yet; shown disabled. */
    ninguno: 'None',
    archivo: 'File',
    nuevoProyecto: 'New project',
    abrirProyecto: 'Open project…',
    abrirReciente: 'Open Recent',
    guardarProyecto: 'Save project',
    guardarComo: 'Save as…',
  },
  /** Close-with-unsaved-changes dialogs (`closeGuard.ts`, shown by `main.ts`). */
  cierre: {
    /** Buttons, in the order `closeDialogOptions` lays them out: `defaultId` 0, `cancelId` 2. */
    guardar: 'Save',
    descartar: 'Discard',
    cancelar: 'Cancel',
    mensaje: 'There are unsaved changes.',
    detalle: 'Do you want to save the changes before closing?',
    /** Second dialog: the save the user asked for did not go through, so the window stays open. */
    errorMensaje: 'Could not save.',
    errorDetalle: 'Closing was cancelled so no changes are lost. Try saving manually again.',
  },
} as const;
