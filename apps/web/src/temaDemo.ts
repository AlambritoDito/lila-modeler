/**
 * Dev pages only (`results.html`, `compare.html`): `?tema=<id>` applies one of the built-in themes
 * (`lila-light`, `lila-dark`, `papel`, `tieso`, `akira`, `montana`, `eva-01`) so the charts of #460
 * can be checked in every theme without the shell. Returns the scheme the shell would write in
 * `data-esquema` for it — the same `bg.base` luminance rule as `temaClaro` in `App.tsx`.
 */
import { applyTheme, type Theme } from './theme/applyTheme';

const TEMAS = import.meta.glob<Theme>('./theme/themes/*.json', { eager: true, import: 'default' });

export function temaDeLaDemo(): 'claro' | 'oscuro' {
  const id = new URLSearchParams(location.search).get('tema');
  const tema = id === null ? undefined : TEMAS[`./theme/themes/${id}.json`];
  if (tema !== undefined) applyTheme(tema);
  const hex = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(tema?.tokens['bg.base'] ?? '#12101A');
  const canal = (i: number): number => Number.parseInt(hex?.[i] ?? '00', 16) / 255;
  return 0.2126 * canal(1) + 0.7152 * canal(2) + 0.0722 * canal(3) > 0.5 ? 'claro' : 'oscuro';
}
