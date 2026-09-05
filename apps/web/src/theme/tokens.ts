/**
 * Lista canónica de tokens de diseño de Lila Modeler.
 *
 * Los nombres son exactamente los del brief `prompts/claude-design-ui.md`
 * (LILA-112). Un tema (`themes/*.json`) tiene que traer estas claves y solo
 * estas; `applyTheme` las convierte en variables CSS con `tokenToCssVar`.
 */
export const TOKEN_NAMES = [
  // Base
  'bg.base',
  'bg.surface',
  'bg.elevated',
  'bg.hover',
  'border',
  'border.strong',
  'shadow',
  // Texto
  'fg.primary',
  'fg.muted',
  'fg.disabled',
  'fg.onAccent',
  // Acentos
  'accent.primary',
  'accent.secondary',
  'accent.tertiary',
  // Estados
  'status.success',
  'status.warning',
  'status.error',
  'status.info',
  // Lienzo y diagrama
  'canvas.bg',
  'canvas.grid',
  'diagram.stroke',
  'diagram.fill',
  'diagram.label',
  'diagram.selected',
  'diagram.hover',
  'diagram.connection',
  'diagram.marker.error',
  'diagram.marker.warning',
  // Simulación
  'sim.bottleneck.low',
  'sim.bottleneck.mid',
  'sim.bottleneck.high',
  'sim.utilization.low',
  'sim.utilization.mid',
  'sim.utilization.high',
  'sim.token',
  // Tipografía
  'font.ui',
  'font.mono',
  'font.diagram',
  'font.size.base',
  'density',
] as const;

export type TokenName = (typeof TOKEN_NAMES)[number];

/**
 * Tokens cuyo valor es un color hex (`#rgb`, `#rrggbb` o `#rrggbbaa`).
 * El resto (`font.*`, `density`) son texto libre. `shadow` es un color con
 * alfa a propósito: la sombra se compone en CSS (`box-shadow: … var(--shadow)`)
 * para que el editor de temas de LILA-114 pueda ofrecer un selector de color.
 */
export const COLOR_TOKEN_NAMES: readonly TokenName[] = TOKEN_NAMES.filter(
  (name) => !name.startsWith('font.') && name !== 'density',
);
