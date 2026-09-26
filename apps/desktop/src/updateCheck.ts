/**
 * Update notice (#487): on launch, the packaged app asks GitHub's public releases API whether a
 * newer version exists and, if so, offers to open its release page. Pure, like `closeGuard.ts`:
 * the fetch and the native dialog live in `main.ts`; the version comparison, the release choice
 * and the dialog options live here so they can be tested without Electron or the network.
 *
 * ponytail: notify-only. Installing the update in place needs a Developer ID signature
 * (Squirrel.Mac rejects ad-hoc builds); that is #486, with `electron-updater`.
 */
import type { MessageBoxOptions } from 'electron';
import type { Strings } from './strings/index.js';

/** Public list of releases. `/releases/latest` would skip prereleases, and every beta is one. */
export const RELEASES_URL = 'https://api.github.com/repos/AlambritoDito/lila-modeler/releases?per_page=20';

export interface Release {
  readonly tagName: string;
  readonly url: string;
}

type Parsed = { core: number[]; pre: string[] };

function parse(version: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** Semver precedence (build metadata ignored): negative, zero or positive, like a sort comparator. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) if (pa.core[i] !== pb.core[i]) return pa.core[i]! - pb.core[i]!;
  // A release outranks any of its prereleases: 1.0.0 > 1.0.0-beta.9.
  if (!pa.pre.length || !pb.pre.length) return pb.pre.length - pa.pre.length;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) - Number(y); // beta.10 > beta.9
    if (nx !== ny) return nx ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * The highest published release newer than `current`, or null. The API payload is untrusted:
 * anything that is not a non-draft release with a semver tag and a GitHub URL is skipped.
 */
export function pickUpdate(payload: unknown, current: string): Release | null {
  if (!Array.isArray(payload)) return null;
  let best: Release | null = null;
  for (const item of payload) {
    if (typeof item !== 'object' || item === null) continue;
    const { tag_name: tagName, html_url: url, draft } = item as Record<string, unknown>;
    if (draft === true || typeof tagName !== 'string' || typeof url !== 'string') continue;
    if (!parse(tagName) || !url.startsWith('https://github.com/')) continue;
    if (compareVersions(tagName, current) <= 0) continue;
    if (!best || compareVersions(tagName, best.tagName) > 0) best = { tagName, url };
  }
  return best;
}

/** `buttons[0]` is Download and `buttons[1]` Later in every language; `main.ts` reads index 0. */
export function updateDialogOptions(strings: Strings, release: Release, current: string): MessageBoxOptions {
  const S = strings.actualizacion;
  const version = release.tagName.replace(/^v/, '');
  return {
    type: 'info',
    buttons: [S.descargar, S.despues],
    defaultId: 0,
    cancelId: 1,
    message: S.mensaje(version),
    detail: S.detalle(current),
  };
}
