/**
 * The pure parts of picking the stable Release for the Pages site (#704), kept out of
 * `build-pages.mjs` so they are testable without `gh` or a network (`pages-release.test.mjs`).
 */

/**
 * The fallback while GitHub has no «latest» Release: the newest published prerelease, from
 * `gh release list --json tagName,isDraft,publishedAt`. Drafts and unpublished entries never count.
 */
export function newestPublished(releases) {
  return (releases ?? [])
    .filter((r) => !r.isDraft && typeof r.publishedAt === 'string' && r.publishedAt !== '')
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0]?.tagName ?? null;
}

/** `gh release view`'s failure when the repository has no «latest» Release (as opposed to a network error). */
export function isNoLatestRelease(stderr) {
  return /release not found/i.test(stderr ?? '');
}

/** The installers of a Release, from `gh release view <tag> --json assets`; `undefined` without any. */
export function downloadsFrom(assets) {
  const url = (ext) => (assets ?? []).find((a) => typeof a.name === 'string' && a.name.endsWith(ext))?.url;
  const downloads = { dmg: url('.dmg'), exe: url('.exe') };
  return downloads.dmg || downloads.exe ? downloads : undefined;
}
