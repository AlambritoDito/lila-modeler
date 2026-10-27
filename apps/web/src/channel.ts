/**
 * The release channel of a web build (#704), derived from its base path and nothing else.
 *
 * GitHub Pages serves two builds from the same origin: the stable app at `/lila-modeler/app/`
 * (built from the latest Release) and the beta at `/lila-modeler/beta/` (built from `main`).
 * One origin means one `localStorage` and one Cache Storage, so the beta must not use the stable
 * app's names: if it did, opening the beta would overwrite — or recover — the stable app's
 * session (`lila.project.v1`) and its settings, and its service worker would delete the stable
 * app's offline cache. Every storage name in the app goes through this module so the rule lives
 * in one place:
 *
 * - **Stable** (any base not ending in `/beta/`: `/` in dev and Electron, `/lila-modeler/app/` on
 *   Pages) keeps today's names, `lila.<name>` and `lila-modeler-<version>`, so existing users
 *   lose nothing.
 * - **Beta** prefixes them with its base path: `lila[/lila-modeler/beta/].<name>` and
 *   `lila[/lila-modeler/beta/]-<version>`. Neither starts with a stable name, so the stable
 *   worker's cleanup (it deletes every other `lila-modeler-*` cache) never reaches the beta's.
 *
 * `base` defaults to Vite's `import.meta.env.BASE_URL`; `vite.config.ts` passes it explicitly,
 * because `import.meta.env` does not exist while the config itself runs.
 */
export type Channel = 'stable' | 'beta';

export function channelOf(base: string = import.meta.env.BASE_URL): Channel {
  return base.endsWith('/beta/') ? 'beta' : 'stable';
}

/** The `localStorage` key for `name` (`tema`, `project.v1`, …) in the build served at `base`. */
export function storageKey(name: string, base: string = import.meta.env.BASE_URL): string {
  return channelOf(base) === 'beta' ? `lila[${base}].${name}` : `lila.${name}`;
}

/** What the service worker's cache names start with; it only ever deletes caches with its own prefix. */
export function cachePrefix(base: string = import.meta.env.BASE_URL): string {
  return channelOf(base) === 'beta' ? `lila[${base}]-` : 'lila-modeler-';
}

/** The stable app next to a beta build: `/lila-modeler/beta/` → `/lila-modeler/app/`. */
export function stableAppPath(base: string = import.meta.env.BASE_URL): string {
  return base.replace(/beta\/$/, 'app/');
}

/**
 * The beta's web app manifest: the stable one renamed. `id`, `scope` and `start_url` stay `./`:
 * they resolve against the manifest's own URL, so at `/lila-modeler/beta/` they already name a
 * different installed app than `/lila-modeler/app/`.
 */
export function betaManifest(stable: string): string {
  const manifest = JSON.parse(stable) as Record<string, unknown>;
  return `${JSON.stringify({ ...manifest, name: 'Lila Modeler Beta', short_name: 'Lila Beta' }, null, 2)}\n`;
}
