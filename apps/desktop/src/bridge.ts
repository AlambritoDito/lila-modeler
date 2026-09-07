/**
 * Contrato del puente `window.lila` (OP-02). Puro tipo — sin Electron, sin `ipcRenderer` — para
 * que `apps/web` (vía `DesktopStore`, LILA-071) y `preload.ts` compartan la misma forma sin que
 * el renderer importe nada de `electron`. `platform: 'desktop'` es lo que `ProjectStore`
 * (LILA-058) usa para detectar esta modalidad con `typeof window.lila !== 'undefined'`.
 */

/** Valor fijo de `LilaBridge.platform`: distingue esta modalidad de `BrowserStore`/`RemoteStore`. */
export const LILA_PLATFORM = 'desktop';

export interface LilaBridge {
  readonly platform: typeof LILA_PLATFORM;
  readonly version: string;

  /**
   * Abre el selector nativo de carpetas. `null` es "se cerró sin elegir nada": no es un error.
   * La carpeta elegida queda autorizada en main para `listFiles`/`readFile`/`writeFile`.
   */
  openFolder(): Promise<string | null>;
  /** Nombres de archivo (no ocultos, no recursivo) de una carpeta ya autorizada por `openFolder`. */
  listFiles(dir: string): Promise<string[]>;
  /** Lee `rel` (relativo a `dir`) como texto UTF-8. `dir` debe estar autorizada. */
  readFile(dir: string, rel: string): Promise<string>;
  /** Escribe `content` en `rel` (relativo a `dir`). Escritura simple; la atómica es OP-14. */
  writeFile(dir: string, rel: string, content: string): Promise<void>;
}

declare global {
  interface Window {
    lila?: LilaBridge;
  }
}
