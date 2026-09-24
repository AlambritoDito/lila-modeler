/**
 * The one shortcut map (#413). Pure data plus four formatters, no React and no DOM: `App.tsx`
 * dispatches from it, the tooltips and the properties panel print it, `apps/desktop/src/menu.ts`
 * is held to it by `menu.test.ts` (it cannot import this file: `rootDir: src`), and
 * `docs/SHORTCUTS.md` is held to it by `atajos.test.ts`. The labels live in `S.atajos.<id>`.
 *
 * `tecla` is `'+'`-separated: optional `Mod` (⌘ on macOS, Ctrl elsewhere) and `Shift`, then the key —
 * a letter, `DigitN` (matched by `e.code`, so it works on any layout), `Plus`/`Minus` (matched
 * as bpmn-js does, by `e.key`), or a `KeyboardEvent.key` name (`F2`, `Escape`, `Enter`, `,`…).
 * `teclaMac` only exists where macOS uses a different key. Flags:
 * - `menu`: an item of the native Electron menu owns it; in the desktop app the keyboard handler
 *   leaves it alone and it arrives through `onMenu`.
 * - `soloDesktop`: the browser keeps that key for itself (⌘N, ⌘, and ⌘1…⌘6 open windows and
 *   settings or switch tabs), so the web app does not announce it in its tooltips; the `modos`
 *   group is not even dispatched there, so Ctrl+1…6 keep switching the browser's tabs.
 * - `lienzo`: bpmn-js handles it on the focused canvas; it is listed here only to be documented.
 * - `hija`: the detached scenario window forwards it to the main one.
 * - `ambito: 'corrida'`: only while a simulation is running.
 */
export type GrupoAtajo = 'archivo' | 'buscar' | 'modos' | 'simulacion' | 'lienzo' | 'paneles';

export interface Atajo {
  readonly id: string;
  readonly grupo: GrupoAtajo;
  readonly tecla: string;
  readonly teclaMac?: string;
  readonly menu?: true;
  readonly soloDesktop?: true;
  readonly lienzo?: true;
  readonly hija?: true;
  readonly ambito?: 'corrida';
}

export const ATAJOS = [
  { id: 'nuevo', grupo: 'archivo', tecla: 'Mod+N', menu: true, soloDesktop: true },
  { id: 'abrir', grupo: 'archivo', tecla: 'Mod+O', menu: true },
  { id: 'guardar', grupo: 'archivo', tecla: 'Mod+S', menu: true, hija: true },
  { id: 'guardarComo', grupo: 'archivo', tecla: 'Mod+Shift+S', menu: true, hija: true },
  { id: 'ajustes', grupo: 'archivo', tecla: 'Mod+,', menu: true, soloDesktop: true },
  { id: 'paleta', grupo: 'buscar', tecla: 'Mod+K', menu: true, hija: true },
  { id: 'modo:modelar', grupo: 'modos', tecla: 'Mod+Digit1', menu: true, soloDesktop: true },
  { id: 'modo:simular', grupo: 'modos', tecla: 'Mod+Digit2', menu: true, soloDesktop: true },
  { id: 'modo:resultados', grupo: 'modos', tecla: 'Mod+Digit3', menu: true, soloDesktop: true },
  { id: 'modo:comparar', grupo: 'modos', tecla: 'Mod+Digit4', menu: true, soloDesktop: true },
  { id: 'modo:animar', grupo: 'modos', tecla: 'Mod+Digit5', menu: true, soloDesktop: true },
  { id: 'modo:rutas', grupo: 'modos', tecla: 'Mod+Digit6', menu: true, soloDesktop: true },
  { id: 'ejecutar', grupo: 'simulacion', tecla: 'Mod+Enter', menu: true },
  { id: 'cancelar', grupo: 'simulacion', tecla: 'Escape', ambito: 'corrida' },
  { id: 'zoomMas', grupo: 'lienzo', tecla: 'Mod+Plus' },
  { id: 'zoomMenos', grupo: 'lienzo', tecla: 'Mod+Minus' },
  { id: 'ajustarVista', grupo: 'lienzo', tecla: 'Mod+0' },
  { id: 'renombrar', grupo: 'lienzo', tecla: 'F2' },
  { id: 'deshacer', grupo: 'lienzo', tecla: 'Mod+Z', lienzo: true },
  { id: 'rehacer', grupo: 'lienzo', tecla: 'Mod+Y', teclaMac: 'Mod+Shift+Z', lienzo: true },
  { id: 'borrar', grupo: 'lienzo', tecla: 'Delete', teclaMac: 'Backspace', lienzo: true },
  { id: 'seleccionarTodo', grupo: 'lienzo', tecla: 'Mod+A', lienzo: true },
  { id: 'copiar', grupo: 'lienzo', tecla: 'Mod+C', lienzo: true },
  { id: 'pegar', grupo: 'lienzo', tecla: 'Mod+V', lienzo: true },
  { id: 'lazo', grupo: 'lienzo', tecla: 'L', lienzo: true },
  { id: 'mano', grupo: 'lienzo', tecla: 'H', lienzo: true },
  { id: 'conectar', grupo: 'lienzo', tecla: 'C', lienzo: true },
  { id: 'editarEtiqueta', grupo: 'lienzo', tecla: 'E', lienzo: true },
  { id: 'reemplazar', grupo: 'lienzo', tecla: 'R', lienzo: true },
  { id: 'izquierda', grupo: 'paneles', tecla: 'Mod+Shift+L' },
  { id: 'derecha', grupo: 'paneles', tecla: 'Mod+Shift+P' },
  { id: 'diagramas', grupo: 'paneles', tecla: 'Mod+Shift+D' },
  { id: 'estado', grupo: 'paneles', tecla: 'Mod+Shift+B' },
  { id: 'irModos', grupo: 'paneles', tecla: 'F6' },
  { id: 'irPanel', grupo: 'paneles', tecla: 'Shift+F6' },
] as const satisfies readonly Atajo[];

export type AtajoId = (typeof ATAJOS)[number]['id'];
/** The entries bpmn-js handles: documented, never dispatched. */
export type AtajoLienzo = Extract<(typeof ATAJOS)[number], { lienzo: true }>['id'];
/** The entries this app dispatches; `App.tsx` must have a handler for every one of them. */
export type AtajoPropio = Exclude<AtajoId, AtajoLienzo>;

/** Formatting only (⌘ vs Ctrl); matching accepts both everywhere. */
export const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export const atajoPorId = (id: AtajoId): Atajo => ATAJOS.find((a) => a.id === id)!;

function partes(atajo: Atajo, mac: boolean): { mod: boolean; shift: boolean; tecla: string } {
  const p = ((mac ? atajo.teclaMac : undefined) ?? atajo.tecla).split('+');
  const tecla = p.pop()!;
  return { mod: p.includes('Mod'), shift: p.includes('Shift'), tecla };
}

/**
 * Whether `e` is `atajo`. ⌘ or Ctrl both count as `Mod` on every platform, like bpmn-js's
 * `isCmd` (and like the handler this replaces); Alt never matches (AltGr types characters).
 * Held keys (`repeat`) never match: one save, one run, one toggle per press.
 */
export function coincide(atajo: Atajo, e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey' | 'repeat'>, mac: boolean): boolean {
  const { mod, shift, tecla } = partes(atajo, mac);
  if (e.repeat || e.altKey || mod !== (e.metaKey || e.ctrlKey)) return false;
  // `+` needs Shift on many layouts, so zoom ignores it (bpmn-js does the same).
  if (tecla === 'Plus') return ['+', '=', 'Add'].includes(e.key);
  if (tecla === 'Minus') return ['-', 'Subtract'].includes(e.key);
  if (shift !== e.shiftKey) return false;
  if (tecla.startsWith('Digit')) return e.code === tecla;
  return tecla.length === 1 ? e.key.toLowerCase() === tecla.toLowerCase() : e.key === tecla;
}

const NOMBRE_MAC: Record<string, string> = { Enter: '↩', Escape: 'Esc', Plus: '+', Minus: '−', Backspace: '⌫', Delete: '⌦' };
const NOMBRE: Record<string, string> = { Escape: 'Esc', Plus: '+', Minus: '-', Delete: 'Del' };

/** `⇧⌘S` / `Ctrl+Shift+S`, `⌘↩` / `Ctrl+Enter`, `⇧F6` / `Shift+F6`. */
export function etiqueta(atajo: Atajo, mac: boolean): string {
  const { mod, shift, tecla } = partes(atajo, mac);
  const t = tecla.replace(/^Digit/, '');
  if (mac) return `${shift ? '⇧' : ''}${mod ? '⌘' : ''}${NOMBRE_MAC[t] ?? t}`;
  return [mod && 'Ctrl', shift && 'Shift', NOMBRE[t] ?? t].filter(Boolean).join('+');
}

/** Electron accelerator for the native menu (`CmdOrCtrl+Shift+S`); `menu.test.ts` pins parity. */
export function acelerador(atajo: Atajo): string {
  const { mod, shift, tecla } = partes(atajo, false);
  return [mod && 'CmdOrCtrl', shift && 'Shift', tecla.replace(/^Digit/, '')].filter(Boolean).join('+');
}

/** What a tooltip appends: ` (⇧⌘S)` / ` (Ctrl+Shift+S)`. */
export const tooltip = (atajo: Atajo, mac: boolean): string => ` (${etiqueta(atajo, mac)})`;
