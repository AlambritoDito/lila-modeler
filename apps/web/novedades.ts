/**
 * «What's new in <version>» on the desktop welcome (#425): the intro paragraph of that version's
 * section in `CHANGELOG.md` (the first paragraph after `## [<version>] - <date>`, joined into one
 * line), or `''` when the section is missing or opens straight with a `###` list. Read at config
 * time by `vite.config.ts` and the root `vitest.config.ts`, and injected as `__LILA_NOVEDADES__`.
 *
 * ponytail: the changelog is written in English only, so the Spanish UI shows this paragraph in
 * English too. Ceiling: a translated highlight would need a second source per version; the way up
 * is a Spanish line in the same section, picked here by locale.
 */
export function novedades(changelog: string, version: string): string {
  const encabezado = changelog.indexOf(`\n## [${version}]`);
  if (encabezado < 0) return '';
  const cuerpo = changelog.slice(changelog.indexOf('\n', encabezado + 1) + 1).trimStart();
  const parrafo = cuerpo.split(/\n\s*\n/)[0] ?? '';
  if (parrafo.startsWith('#')) return '';
  return parrafo.split('\n').map((linea) => linea.trim()).join(' ');
}
