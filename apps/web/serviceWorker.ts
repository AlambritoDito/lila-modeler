/**
 * Builds `sw.js` (#574, ADR-031) from the `sw.js` template next to this file: the app version
 * names the cache, so every version bump installs a fresh worker and drops the old cache, and the
 * precache list is what `vite build` just wrote. Called by `vite.config.ts` after the build.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * The files to precache, relative to the app's base: everything in the build except the worker
 * itself and the legacy font formats (`.woff`, `.eot`, `.ttf`) that Chromium never asks for when
 * a `.woff2` is listed first. `index.html` is cached as `./`, the URL a navigation falls back to.
 */
export function precacheList(files: readonly string[]): string[] {
  return files
    .filter((f) => f !== 'sw.js' && !/\.(woff|eot|ttf|map)$/i.test(f))
    .map((f) => (f === 'index.html' ? './' : f))
    .sort();
}

/** The template with the version and the precache list filled in. */
export function serviceWorkerSource(template: string, version: string, files: readonly string[]): string {
  if (!template.includes("'__LILA_VERSION__'") || !template.includes('/* __LILA_PRECACHE__ */ []')) {
    throw new Error('sw.js template placeholders are missing');
  }
  return template
    .replace("'__LILA_VERSION__'", JSON.stringify(version))
    .replace('/* __LILA_PRECACHE__ */ []', JSON.stringify(precacheList(files)));
}

/** Every file under `dir`, as POSIX paths relative to it. */
export function listFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => statSync(join(dir, f)).isFile())
    .map((f) => relative(dir, join(dir, f)).split(sep).join('/'));
}

/** Reads the template, fills it in for `outDir` and returns the worker's source. */
export function buildServiceWorker(templatePath: string, outDir: string, version: string): string {
  return serviceWorkerSource(readFileSync(templatePath, 'utf8'), version, listFiles(outDir));
}
