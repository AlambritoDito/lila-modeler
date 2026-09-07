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
import type { LilaBridge, WriteProjectOptions } from './bridge.js';

const { contextBridge, ipcRenderer } = electron;

const lila = {
  platform: 'desktop',
  version: process.versions.electron ?? '',
  chooseFolder: () => ipcRenderer.invoke('lila:chooseFolder') as Promise<string | null>,
  readProject: (dir: string) => ipcRenderer.invoke('lila:readProject', dir) as ReturnType<LilaBridge['readProject']>,
  writeProject: (dir: string, document: unknown, options?: WriteProjectOptions) =>
    ipcRenderer.invoke('lila:writeProject', dir, document, options) as Promise<void>,
  setDirty: (dirty: boolean) => {
    ipcRenderer.send('lila:setDirty', dirty);
  },
  // Sandboxeado: solo reenvía. `cb` (registrada por DesktopStore) corre en el renderer; el
  // resultado vuelve a main por `lila:close-response` para que decida si cierra la ventana.
  onCloseRequested: (cb: () => Promise<boolean>) => {
    const listener = () => {
      void cb()
        .then((saved) => ipcRenderer.send('lila:close-response', { saved }))
        .catch(() => ipcRenderer.send('lila:close-response', { saved: false }));
    };
    ipcRenderer.on('lila:close-requested', listener);
    return () => ipcRenderer.removeListener('lila:close-requested', listener);
  },
} satisfies LilaBridge;

contextBridge.exposeInMainWorld('lila', lila);
