/**
 * Preload de OP-02: corre con `contextIsolation: true` y `sandbox: true`, así que no hay
 * `require`/Node completo aquí — solo lo que Electron expone al preload sandboxeado
 * (`ipcRenderer`, `contextBridge`). Expone `window.lila` con exactamente la forma de
 * `LilaBridge` (`bridge.ts`): el renderer nunca ve `ipcRenderer` ni un canal IPC directamente.
 *
 * Extensión `.cts` (no `.ts`/`.mts`): un preload sandboxeado NO admite ESM — ni siquiera con
 * `dist/preload.mjs` carga el `import` de abajo; Electron sigue reventando con "Cannot use
 * import statement outside a module" (verificado en el smoke de este ticket con ambas
 * extensiones). El `require` que sí expone el preload sandboxeado solo resuelve un puñado de
 * módulos integrados (`electron`, `events`, `timers`, `url`), no archivos propios — por eso
 * `bridge.ts` se importa aquí solo como tipo (`import type`, se borra al compilar, nunca genera
 * un `require` en tiempo de ejecución) y el valor de `platform` se repite como literal, con
 * `satisfies LilaBridge` para que ambos no puedan divergir sin que falle el typecheck.
 * `.cts` fuerza que `tsc` (NodeNext) compile a `dist/preload.cjs` en CommonJS de verdad.
 */
// `import x = require(...)`, no `import { … } from 'electron'`: bajo `verbatimModuleSyntax`
// (`tsconfig.base.json`) un archivo CommonJS (`.cts`) debe importar valores con la sintaxis
// clásica de `require`, no con `import`/`export` de ES — ese es justamente el punto de este
// archivo (ver comentario de arriba).
import electron = require('electron');
import type { SaveOutcome, Ajustes, LilaBridge, MenuAction, OpenPathRequest, Recent, WriteProjectOptions } from './bridge.js';

const { contextBridge, ipcRenderer } = electron;

const lila = {
  platform: 'desktop',
  version: process.versions.electron ?? '',
  chooseFolder: (fileOnly?: boolean) =>
    ipcRenderer.invoke('lila:chooseFolder', fileOnly) as Promise<string | null>,
  readProject: (dir: string) => ipcRenderer.invoke('lila:readProject', dir) as ReturnType<LilaBridge['readProject']>,
  writeProject: (dir: string, document: unknown, options?: WriteProjectOptions) =>
    ipcRenderer.invoke('lila:writeProject', dir, document, options) as Promise<void>,
  setDirty: (dirty: boolean) => {
    ipcRenderer.send('lila:setDirty', dirty);
  },
  // Sandboxeado: solo reenvía. `cb` (registrada por DesktopStore) corre en el renderer; el
  // resultado vuelve a main por `lila:close-response` para que decida si cierra la ventana.
  onCloseRequested: (cb: () => Promise<SaveOutcome>) => {
    const listener = () => {
      void cb()
        .then((saved) => ipcRenderer.send('lila:close-response', { saved }))
        .catch(() => ipcRenderer.send('lila:close-response', { saved: 'failed' }));
    };
    ipcRenderer.on('lila:close-requested', listener);
    return () => ipcRenderer.removeListener('lila:close-requested', listener);
  },
  listRecents: () => ipcRenderer.invoke('lila:listRecents') as Promise<readonly Recent[]>,
  openRecent: (dir: string, file?: string) =>
    ipcRenderer.invoke('lila:openRecent', dir, file) as ReturnType<LilaBridge['openRecent']>,
  pendingOpenPath: () => ipcRenderer.invoke('lila:pendingOpenPath') as Promise<OpenPathRequest | null>,
  onOpenPath: (cb: (path: OpenPathRequest) => void) => {
    const listener = (_event: unknown, path: OpenPathRequest) => cb(path);
    ipcRenderer.on('lila:open-path', listener);
    return () => ipcRenderer.removeListener('lila:open-path', listener);
  },
  readSettings: () => ipcRenderer.invoke('lila:readSettings') as Promise<Ajustes>,
  writeSettings: (ajustes: Ajustes) => ipcRenderer.invoke('lila:writeSettings', ajustes) as Promise<void>,
  onMenu: (cb: (action: MenuAction) => void) => {
    const listener = (_event: unknown, action: MenuAction) => cb(action);
    ipcRenderer.on('lila:menu', listener);
    return () => ipcRenderer.removeListener('lila:menu', listener);
  },
} satisfies LilaBridge;

contextBridge.exposeInMainWorld('lila', lila);
