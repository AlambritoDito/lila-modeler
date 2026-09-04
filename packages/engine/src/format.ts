/** Presentación de tiempos y tablas de la CLI; los valores internos siempre siguen en segundos. */

export type BaseTimeUnit = 's' | 'min' | 'h' | 'day';

const SECONDS_PER_UNIT: Readonly<Record<BaseTimeUnit, number>> = {
  s: 1,
  min: 60,
  h: 3_600,
  day: 86_400,
};

/** Conversión solo de presentación (R-DURA-2); no se usa dentro de `simulate`. */
export function formatDuration(seconds: number, unit: BaseTimeUnit): string {
  return formatNumber(seconds / SECONDS_PER_UNIT[unit]);
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/**
 * Fracción como porcentaje con signo explícito, para las columnas de delta de `lila compare`.
 * El signo sale del texto ya redondeado y no del valor crudo: una diferencia de −1e−11 redondea a
 * cero y se imprime `0%`, nunca `-0%` (ni `+0%`, que afirmaría un aumento inexistente).
 */
export function formatSignedPercent(fraction: number): string {
  const text = formatNumber(fraction * 100);
  if (text === '0') return '0%';
  return `${text.startsWith('-') ? '' : '+'}${text}%`;
}

/** Tabla monoespaciada estable sin dependencia de terminal ni locale. */
export function formatTable(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, column) => {
    let width = header.length;
    for (const row of rows) width = Math.max(width, row[column]?.length ?? 0);
    return width;
  });
  const line = (row: readonly string[]): string =>
    row.map((value, column) => value.padEnd(widths[column] ?? value.length)).join('  ').trimEnd();
  return [line(headers), widths.map((width) => '-'.repeat(width)).join('  '), ...rows.map(line)].join('\n');
}
