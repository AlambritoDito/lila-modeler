/**
 * Numbers as the UI shows them (#578): at most two decimals, never padded. The engine's
 * `formatNumber`/`formatDuration` stay exact (1e-6) because the CLI, the CSV/XLSX exports and the
 * goldens depend on them; the screen shows these instead and keeps the exact value in `title`.
 *
 * Like `formatNumber`, the decimal separator is always `.`: the UI has no locale-aware numbers.
 */
import { formatNumber, SECONDS_PER_UNIT, type BaseTimeUnit } from '@lila-modeler/engine/format';
import { strings } from './i18n';

/** `value` rounded to `decimals` places, without the `-0` that `Math.round(-0.001)` leaves. */
export function roundDisplay(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** 1 → "1", 1.5 → "1.5", 1.23456 → "1.23". */
export function formatDisplay(value: number, decimals = 2): string {
  return formatNumber(roundDisplay(value, decimals));
}

/**
 * Seconds in `unit` with two decimals. A duration of an hour or more in a unit smaller than hours
 * also reads in hours: `11700` s in `min` is "3.25 h (195 min)".
 */
export function formatDisplayDuration(seconds: number, unit: BaseTimeUnit): string {
  const inUnit = formatDisplay(seconds / SECONDS_PER_UNIT[unit]);
  if (!Number.isFinite(seconds) || Math.abs(seconds) < SECONDS_PER_UNIT.h || SECONDS_PER_UNIT[unit] >= SECONDS_PER_UNIT.h) {
    return inUnit;
  }
  const short = strings().lienzo.unidadesCortas;
  return `${formatDisplay(seconds / SECONDS_PER_UNIT.h)} ${short.h} (${inUnit} ${short[unit]})`;
}
