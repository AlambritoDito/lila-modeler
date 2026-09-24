/**
 * «What's new in <version>» on the desktop welcome (#425): the intro paragraph of that version's
 * section in `CHANGELOG.md` (the first paragraph after `## [<version>] - <date>`, joined into one
 * line, inline markdown reduced to plain text), or `''` when the section is missing or opens
 * straight with a `###` list. Read at config time by `vite.config.ts` and the root
 * `vitest.config.ts`, and injected as `__LILA_NOVEDADES__`. Every release section therefore needs a
 * plain, user-facing intro paragraph before its first `###`: `App.test.tsx` fails without one.
 *
 * ponytail: the changelog is written in English only, so the Spanish UI shows this paragraph in
 * English too. Ceiling: a translated highlight would need a second source per version; the way up
 * is a Spanish line in the same section, picked here by locale.
 */
export function novedades(changelog: string, version: string): string {
  const lineas = changelog.split('\n');
  const encabezado = lineas.findIndex((linea) => linea.startsWith(`## [${version}]`));
  if (encabezado < 0) return '';
  const parrafo: string[] = [];
  for (const linea of lineas.slice(encabezado + 1)) {
    const texto = linea.trim();
    if (texto === '') {
      if (parrafo.length > 0) break;
    } else if (texto.startsWith('#')) {
      break;
    } else {
      parrafo.push(texto);
    }
  }
  return parrafo
    .join(' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/<(https?:\/\/[^>\s]+)>/g, '$1') // <https://…> -> https://…
    .replace(/\*\*([^*]+)\*\*/g, '$1') // **bold** -> bold
    .replace(/`([^`]+)`/g, '$1'); // `code` -> code
}
