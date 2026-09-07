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

export function menuTemplate(
  recents: readonly RecentEntry[],
  platform: NodeJS.Platform,
  send: (action: MenuAction) => void,
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin';
  const preferencias: MenuItemConstructorOptions = {
    label: 'Preferencias…',
    accelerator: 'CmdOrCtrl+,',
    click: () => send('ajustes'),
  };
  const recientes: MenuItemConstructorOptions[] = recents.length
    ? recents.map((r) => ({ label: r.name, sublabel: r.dir, toolTip: r.dir, click: () => send({ openRecent: r.dir }) }))
    : [{ label: 'Ninguno', enabled: false }];

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
      label: 'Archivo',
      submenu: [
        { label: 'Nuevo proyecto', accelerator: 'CmdOrCtrl+N', click: () => send('nuevo') },
        { label: 'Abrir proyecto…', accelerator: 'CmdOrCtrl+O', click: () => send('abrir') },
        { label: 'Abrir reciente', submenu: recientes },
        { type: 'separator' },
        { label: 'Guardar proyecto', accelerator: 'CmdOrCtrl+S', click: () => send('guardar') },
        { label: 'Guardar como…', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('guardarComo') },
        ...(mac ? [] : [{ type: 'separator' as const }, preferencias, { type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
}
