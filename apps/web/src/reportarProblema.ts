/**
 * «Report a problem…» (#651): GitHub's new-issue page with the `bug_report.yml` form already
 * carrying the version and the environment. No backend: nothing leaves the machine until the
 * person presses Submit on GitHub, and only these two fields go in the URL — no model contents,
 * file names or paths, and of the browser only its family, never the full user agent.
 */
import type { LilaBridge } from '../../desktop/src/bridge.js';
import { version as VERSION } from '../package.json';

/** `REPO_URL` of `Bienvenida.tsx`, repeated so this module stays free of React. */
const REPO_URL = 'https://github.com/AlambritoDito/lila-modeler';

/**
 * The prefilled form. Exactly three parameters: the template and the form's `version` and
 * `environment` field ids. `encodeURIComponent`, not `URLSearchParams`, so a space travels as
 * `%20` and never as `+` (GitHub's form would show the `+`).
 */
export function urlReporte(version: string, entorno: string): string {
  return `${REPO_URL}/issues/new?template=bug_report.yml`
    + `&version=${encodeURIComponent(version)}&environment=${encodeURIComponent(entorno)}`;
}

/** Where the app runs, as `entorno` reads it: the desktop bridge, or the browser's user agent. */
export interface Superficie {
  readonly bridge?: Pick<LilaBridge, 'system'> | undefined;
  readonly userAgent: string;
  /** The web app opened as an installed PWA (`display-mode: standalone`). */
  readonly standalone: boolean;
}

const SO: Readonly<Record<string, string>> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/**
 * `macOS 15.1.0 arm64 · desktop app` in the desktop app, from the bridge (OS, its version and the
 * architecture); `Windows · PWA (Edge)` or `Linux · browser (Firefox)` on the web, where the user
 * agent gives only the OS family and the browser family is all that is kept of it.
 */
export function entorno({ bridge, userAgent, standalone }: Superficie): string {
  if (bridge?.system !== undefined) {
    const { platform, version, arch } = bridge.system;
    return `${[SO[platform] ?? platform, version, arch].filter((x) => x !== '').join(' ')} · desktop app`;
  }
  return `${soDelNavegador(userAgent)} · ${standalone ? 'PWA' : 'browser'} (${familia(userAgent)})`;
}

/** The OS family a user agent names. iPadOS asks for the desktop site, so it reads as macOS. */
function soDelNavegador(ua: string): string {
  if (/iPhone|iPad|iPod/.test(ua)) return 'iOS';
  if (/Android/.test(ua)) return 'Android';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macOS';
  if (/Linux/.test(ua)) return 'Linux';
  return 'unknown OS';
}

/** The browser family. Order matters: Edge and Opera also say Chrome, and Chrome also says Safari. */
function familia(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'Firefox';
  if (/Chrome\/|CriOS\/|Chromium\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'other';
}

/** The environment of this window: the bridge if there is one, else the browser. */
export function entornoActual(): string {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches === true
    || (navigator as { standalone?: boolean }).standalone === true;
  return entorno({ bridge: window.lila, userAgent: navigator.userAgent, standalone });
}

/** The form for this build (the manifest version) in this window. */
export function urlReporteActual(): string {
  return urlReporte(VERSION, entornoActual());
}

/**
 * Opens the form in a new tab, or, in the desktop app, in the system browser: Electron's
 * `setWindowOpenHandler` hands an http(s) `window.open` to `shell.openExternal` and denies the window.
 */
export function abrirReporte(): void {
  window.open(urlReporteActual(), '_blank', 'noopener');
}
