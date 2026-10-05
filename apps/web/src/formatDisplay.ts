/**
 * Numbers as the UI shows them (#578): at most two decimals, never padded. The engine's
 * `formatNumber`/`formatDuration` stay exact (1e-6) because the CLI, the CSV/XLSX exports and the
 * goldens depend on them; the screen shows these instead and keeps the exact value in `title`.
 *
 * Like `formatNumber`, the decimal separator is always `.`: the UI has no locale-aware numbers.
 */
import { formatDuration, formatNumber, SECONDS_PER_UNIT, type BaseTimeUnit } from '@lila-modeler/engine/format';
import { strings } from './i18n';

/**
 * `value` rounded to `decimals` places, halves away from zero and without the binary error of
 * `Math.round(x * 100)` (1.005 → 1.01, 0.025 → 0.03): the shift goes through the decimal
 * exponent of the number's own text. No `-0`.
 */
export function roundDisplay(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return value;
  const shift = (n: number, by: number): number => {
    const [mantissa, exponent = '0'] = String(n).split('e');
    return Number(`${mantissa}e${Number(exponent) + by}`);
  };
  const rounded = Math.sign(value) * shift(Math.round(shift(Math.abs(value), decimals)), -decimals);
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * 1 → "1", 1.5 → "1.5", 1.23456 → "1.23". A value that is not zero never reads "0": below
 * 0.01 it keeps two significant digits (0.004158 → "0.0042").
 */
export function formatDisplay(value: number, decimals = 2): string {
  // Below the CLI's own 1e-6 rounding it is float noise: show "0" like the title, not "1.2e-7".
  if (formatNumber(value) === '0') return '0';
  if (Math.abs(value) < 10 ** -decimals) return String(Number(value.toPrecision(2)));
  return formatNumber(roundDisplay(value, decimals));
}

/**
 * Seconds in `unit` with two decimals. A duration of an hour or more in a unit smaller than hours
 * also reads in hours: `11700` s in `min` is "3.25 h (195 min)". Below an hour the number goes
 * alone, for a column whose header already names the unit.
 */
export function formatDisplayDuration(seconds: number, unit: BaseTimeUnit): string {
  const inUnit = formatDisplay(seconds / SECONDS_PER_UNIT[unit]);
  if (!enHoras(seconds, unit)) return inUnit;
  const short = strings().lienzo.unidadesCortas;
  return `${formatDisplay(seconds / SECONDS_PER_UNIT.h)} ${short.h} (${inUnit} ${short[unit]})`;
}

/** Like `formatDisplayDuration`, for a sentence: the unit always goes with it ("195 min"). */
export function formatDisplayDurationWithUnit(seconds: number, unit: BaseTimeUnit): string {
  if (enHoras(seconds, unit)) return formatDisplayDuration(seconds, unit);
  return `${formatDisplay(seconds / SECONDS_PER_UNIT[unit])} ${strings().lienzo.unidadesCortas[unit]}`;
}

/** The exact value of a duration (the CLI's text) with its unit, for a cell's `title`. */
export function exactDuration(seconds: number, unit: BaseTimeUnit): string {
  return `${formatDuration(seconds, unit)} ${strings().lienzo.unidadesCortas[unit]}`;
}

function enHoras(seconds: number, unit: BaseTimeUnit): boolean {
  return Number.isFinite(seconds) && Math.abs(seconds) >= SECONDS_PER_UNIT.h && SECONDS_PER_UNIT[unit] < SECONDS_PER_UNIT.h;
}
