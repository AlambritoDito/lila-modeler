/**
 * Plantilla del menú nativo. Pura (solo tipos de Electron) para probarla sin Electron detrás:
 * `main.ts` la construye con `Menu.buildFromTemplate` y la vuelve a construir cuando cambian los
 * recientes. Los aceleradores (`CmdOrCtrl+,`, `CmdOrCtrl+S`, …) viven aquí y no en el renderer:
 * en macOS el sistema consume la tecla al despachar el menú, y en Windows/Linux llegaría también
 * al renderer, así que el shell web no despacha desde el teclado las entradas `menu: true` del
 * mapa de atajos (#413) cuando `window.lila` existe.
 */
import type { MenuItemConstructorOptions } from 'electron';
import type { MenuAction } from './bridge.js';
import type { RecentEntry } from './sessionState.js';
import type { Strings } from './strings/index.js';

/**
 * The texts come in as an argument (LILA-213) instead of being written here: the catalog is
 * chosen in `main.ts` from the language setting, and the menu is rebuilt with a different one
 * when that setting changes. Only the labels this app owns are translated — `appMenu`,
 * `editMenu` and `windowMenu` are roles, and the OS localises them itself.
 *
 * View and Simulation are this app's own (#413): Electron's `viewMenu` role brought reload (⌘R)
 * and page zoom (⌘+/⌘−/⌘0), which fought the canvas zoom of the shortcut map. Their items send
 * `{ atajo: id }`. The accelerators are literals — this package cannot import
 * `apps/web/src/atajos.ts` — and `menu.test.ts` holds them to that map.
 */
export function menuTemplate(
  recents: readonly RecentEntry[],
  platform: NodeJS.Platform,
  send: (action: MenuAction) => void,
  strings: Strings,
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  const S = strings.menu;
  const preferencias: MenuItemConstructorOptions = {
    label: S.preferencias,
    accelerator: 'CmdOrCtrl+,',
    click: () => send('ajustes'),
  };
  // Todos los productos del dueño llevan un «Acerca de» (LILA-381): en macOS sustituye al role
  // `about` de Electron (genérico, sin la marca del dueño); fuera de macOS no hay app menu, así
  // que va al final de Archivo, antes de Salir.
  const acercaDe: MenuItemConstructorOptions = {
    label: S.acercaDe,
    click: () => send('acerca'),
  };
  const recientes: MenuItemConstructorOptions[] = recents.length
    ? recents.map((r) => ({ label: r.name, sublabel: r.dir, toolTip: r.dir, click: () => send({ openRecent: r.dir }) }))
    : [{ label: S.ninguno, enabled: false }];
  const atajo = (label: string, accelerator: string, id: string): MenuItemConstructorOptions =>
    ({ label, accelerator, click: () => send({ atajo: id }) });

  return [
    ...(mac
      ? [{
          role: 'appMenu' as const,
          submenu: [
            acercaDe,
            { type: 'separator' as const },
            preferencias,
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : []),
    {
      label: S.archivo,
      submenu: [
        { label: S.nuevoProyecto, accelerator: 'CmdOrCtrl+N', click: () => send('nuevo') },
        { label: S.abrirProyecto, accelerator: 'CmdOrCtrl+O', click: () => send('abrir') },
        { label: S.abrirProyectoArchivo, click: () => send('abrirArchivo') },
        { label: S.abrirReciente, submenu: recientes },
        { type: 'separator' },
        { label: S.guardarProyecto, accelerator: 'CmdOrCtrl+S', click: () => send('guardar') },
        { label: S.guardarComo, accelerator: 'CmdOrCtrl+Shift+S', click: () => send('guardarComo') },
        // Dos destinos, dos entradas (ADR-027): «Guardar como…» crea un `.lila` —el formato con
        // el que se manda un proyecto a alguien— y esta crea la carpeta de ADR-018, que es la
        // forma que sigue siendo la buena para versionar con git. No es un submenú ni un
        // desplegable dentro del diálogo: el diálogo nativo de guardar no admite elegir «carpeta o
        // archivo», así que la elección tiene que estar antes de abrirlo.
        { label: S.guardarComoCarpeta, click: () => send('guardarComoCarpeta') },
        ...(mac
          ? []
          : [
              { type: 'separator' as const }, preferencias,
              { type: 'separator' as const }, acercaDe,
              { type: 'separator' as const }, { role: 'quit' as const },
            ]),
      ],
    },
    { role: 'editMenu' },
    {
      label: S.vista,
      submenu: [
        atajo(S.paleta, 'CmdOrCtrl+K', 'paleta'),
        { type: 'separator' },
        atajo(S.modoModelar, 'CmdOrCtrl+1', 'modo:modelar'),
        atajo(S.modoSimular, 'CmdOrCtrl+2', 'modo:simular'),
        atajo(S.modoResultados, 'CmdOrCtrl+3', 'modo:resultados'),
        atajo(S.modoComparar, 'CmdOrCtrl+4', 'modo:comparar'),
        atajo(S.modoAnimar, 'CmdOrCtrl+5', 'modo:animar'),
        atajo(S.modoRutas, 'CmdOrCtrl+6', 'modo:rutas'),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { label: S.simulacion, submenu: [atajo(S.ejecutar, 'CmdOrCtrl+Enter', 'ejecutar')] },
    { role: 'windowMenu' },
  ];
}
