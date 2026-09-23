/**
 * A panel of the app detached to its own OS window (design 2c, «Escenario acoplado ↗»).
 *
 * It is not a second app: `window.open('')` gives an empty `about:blank` window of the same origin,
 * and React renders into it with a portal from the SAME tree. Scenarios, the IR, the canvas
 * selection, the dirty state and ⌘S are therefore shared for free — there is nothing to sync.
 * What the child does not get by itself is the look: the stylesheets are cloned once when it
 * opens, and the theme variables (written inline on `<html>` by `applyTheme`) and `lang` are
 * mirrored while it lives.
 *
 * Never a modal: it does not block the canvas, does not trap focus, and closing it docks the panel
 * back. Generic on purpose: Results can reuse it with another `nombre`.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useStrings } from './i18n';

/** Position and size of the window, in screen pixels. Same shape as the desktop `WindowBounds`. */
export interface Geometria {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A saved geometry worth reusing: finite numbers and a size between the desktop child's minimum
 * (420 × 360) and 8192. Positions may be negative (a monitor left of the main one); an
 * off-screen one is the browser's (or Electron's `fitsAnyDisplay`) to clamp.
 */
export function geometriaValida(valor: unknown): valor is Geometria {
  if (typeof valor !== 'object' || valor === null) return false;
  const { x, y, width, height } = valor as Record<string, unknown>;
  const numero = (n: unknown, min: number): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= 8192;
  return numero(x, -8192) && numero(y, -8192) && numero(width, 420) && numero(height, 360);
}

/** Where the window is now. `innerWidth/Height` because that is what `width/height` set on open. */
export function geometriaDe(ventana: Window): Geometria {
  return { x: ventana.screenX, y: ventana.screenY, width: ventana.innerWidth, height: ventana.innerHeight };
}

/**
 * Opens (or reuses) the named window and dresses it like the app. Call it ONLY from a click
 * handler: popup blockers allow `window.open` inside a user gesture only, and an effect would run
 * twice under StrictMode. `null` = the browser blocked it.
 */
export function abrirVentanaFlotante(nombre: string, geom?: Geometria): Window | null {
  // Default: 560 × 720 over the right edge of the opener, which is where the docked panel lives.
  const g = geom ?? {
    width: 560,
    height: 720,
    x: Math.max(0, window.screenX + window.outerWidth - 600),
    y: window.screenY + 80,
  };
  // Never `noopener`: without the handle there is nothing to portal into.
  const ventana = window.open('', nombre, `popup,width=${g.width},height=${g.height},left=${g.x},top=${g.y}`);
  if (ventana === null) return null;
  const doc = ventana.document;
  const meta = doc.createElement('meta');
  meta.setAttribute('charset', 'utf-8');
  // `<base>`: the `url()`s of the fonts inside the cloned `<style>` tags resolve against it.
  const base = doc.createElement('base');
  base.href = document.baseURI;
  const estilos = [...document.head.querySelectorAll('link[rel="stylesheet"], style')].map((nodo) => {
    const copia = doc.importNode(nodo, true);
    if (nodo.tagName === 'LINK') (copia as HTMLLinkElement).href = (nodo as HTMLLinkElement).href;
    return copia;
  });
  // `replaceChildren`: reusing a window that is still open must not clone the head twice.
  // ponytail: styles Vite injects or hot-swaps AFTER this point (dev HMR, a lazy chunk loaded
  // later) are not copied; detaching again picks them up.
  doc.head.replaceChildren(meta, base, ...estilos);
  doc.documentElement.lang = document.documentElement.lang;
  doc.documentElement.style.cssText = document.documentElement.style.cssText;
  doc.body.style.margin = '0';
  return ventana;
}

export function VentanaFlotante({
  ventana,
  titulo,
  tema,
  densidad,
  inert,
  onAcoplar,
  onGeometria,
  onTecla,
  children,
}: {
  ventana: Window;
  titulo: string;
  /** `data-theme` of the main `.app` (decorated themes such as Montana). */
  tema: string | undefined;
  densidad: string;
  /** Same as the aside of the main window: nothing is edited while a project is being saved or opened. */
  inert?: boolean;
  /** Dock back: the «Acoplar» button, or the window closed/reloaded by the user. */
  onAcoplar: () => void;
  /** Where the window is, after a resize and when it or the app goes away. */
  onGeometria?: (geometria: Geometria) => void;
  /** Keys pressed inside the child, so the app shortcuts (⌘S…) work there too. */
  onTecla?: (evento: KeyboardEvent) => void;
  children: ReactNode;
}): React.JSX.Element {
  const S = useStrings();
  // The listeners are keyed on the window only; they read the latest callbacks from here.
  const actuales = useRef({ onAcoplar, onGeometria, onTecla });
  actuales.current = { onAcoplar, onGeometria, onTecla };

  useEffect(() => {
    ventana.document.title = titulo;
  }, [ventana, titulo]);

  useEffect(() => {
    const raiz = document.documentElement;
    const hija = ventana.document.documentElement;
    const copiar = (): void => {
      hija.style.cssText = raiz.style.cssText;
      hija.lang = raiz.lang;
    };
    copiar();
    const observador = new MutationObserver(copiar);
    observador.observe(raiz, { attributes: true, attributeFilter: ['style', 'lang'] });

    const guardar = (): void => actuales.current.onGeometria?.(geometriaDe(ventana));
    let espera: ReturnType<typeof setTimeout> | undefined;
    const redimensionada = (): void => {
      clearTimeout(espera);
      espera = setTimeout(guardar, 300);
    };
    const hijaSeVa = (): void => {
      guardar();
      actuales.current.onAcoplar();
      // ⌘R inside the child reloads `about:blank` and wipes the portal: close it for good.
      setTimeout(() => {
        if (!ventana.closed) ventana.close();
      });
    };
    const principalSeVa = (): void => {
      guardar();
      ventana.close();
    };
    const tecla = (e: KeyboardEvent): void => actuales.current.onTecla?.(e);
    ventana.addEventListener('pagehide', hijaSeVa);
    ventana.addEventListener('resize', redimensionada);
    ventana.addEventListener('keydown', tecla);
    window.addEventListener('pagehide', principalSeVa);
    // Only listeners: closing the window here would close it on every StrictMode re-run.
    return () => {
      observador.disconnect();
      clearTimeout(espera);
      ventana.removeEventListener('pagehide', hijaSeVa);
      ventana.removeEventListener('resize', redimensionada);
      ventana.removeEventListener('keydown', tecla);
      window.removeEventListener('pagehide', principalSeVa);
    };
  }, [ventana]);

  return createPortal(
    <div className="app ventana-flotante" data-theme={tema} data-densidad={densidad}>
      <header className="ventana-titulo">
        <span>{titulo}</span>
        <button type="button" className="acoplar" onClick={onAcoplar}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" />
            <path d="M15 4v16M6 12h6M10 9l3 3-3 3" />
          </svg>
          {S.app.acoplar}
        </button>
      </header>
      <div className="panel ventana-cuerpo" inert={inert}>{children}</div>
    </div>,
    ventana.document.body,
  );
}
