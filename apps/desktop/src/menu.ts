/**
 * Plantilla del menú nativo. Pura (solo tipos de Electron) para probarla sin Electron detrás:
 * `main.ts` la construye con `Menu.buildFromTemplate` y la vuelve a construir cuando cambian los
 * recientes. Los aceleradores (`CmdOrCtrl+,`, `CmdOrCtrl+S`, …) viven aquí y no en el renderer:
 * en macOS el sistema consume la tecla al despachar el menú, y en Windows/Linux llegaría también
 * al renderer, así que el shell web no registra atajos cuando `window.lila` existe.
 */
import type { MenuItemConstructorOptions } from 'electron';
import type { MenuAction } from './bridge.js';
import type { RecentEntry } from './sessionState.js';
import type { Strings } from './strings/index.js';

/**
 * The texts come in as an argument (LILA-213) instead of being written here: the catalog is
 * chosen in `main.ts` from the language setting, and the menu is rebuilt with a different one
 * when that setting changes. Only the labels this app owns are translated — `appMenu`,
 * `editMenu`, `viewMenu` and `windowMenu` are roles, and the OS localises them itself.
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
  const recientes: MenuItemConstructorOptions[] = recents.length
    ? recents.map((r) => ({ label: r.name, sublabel: r.dir, toolTip: r.dir, click: () => send({ openRecent: r.dir }) }))
    : [{ label: S.ninguno, enabled: false }];

  return [
    ...(mac
      ? [{
          role: 'appMenu' as const,
          submenu: [
            { role: 'about' as const },
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
        ...(mac ? [] : [{ type: 'separator' as const }, preferencias, { type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}
