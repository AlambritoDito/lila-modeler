/**
 * Numbers as the UI shows them (#578): at most two decimals, never padded. The engine's
 * `formatNumber`/`formatDuration` stay exact (1e-6) because the CLI, the CSV/XLSX exports and the
 * goldens depend on them; the screen shows these instead and keeps the exact value in `title`.
 *
 * Like `formatNumber`, the decimal separator is always `.`: the UI has no locale-aware numbers.
 */
import { formatDuration, SECONDS_PER_UNIT, type BaseTimeUnit } from '@lila-modeler/engine/format';
import { formatDisplay, formatDisplayDuration as duracion, inHours, roundDisplay } from '@lila-modeler/engine/charts';
import { strings } from './i18n';

// The rounding lives in the engine (`charts.ts`, #636), which draws the same charts for the
// process document an agent exports.
export { formatDisplay, roundDisplay };

/**
 * Seconds in `unit` with two decimals. A duration of an hour or more in a unit smaller than hours
 * also reads in hours: `11700` s in `min` is "3.25 h (195 min)". Below an hour the number goes
 * alone, for a column whose header already names the unit.
 */
export function formatDisplayDuration(seconds: number, unit: BaseTimeUnit): string {
  return duracion(seconds, unit, strings().lienzo.unidadesCortas);
}

/** Like `formatDisplayDuration`, for a sentence: the unit always goes with it ("195 min"). */
export function formatDisplayDurationWithUnit(seconds: number, unit: BaseTimeUnit): string {
  if (inHours(seconds, unit)) return formatDisplayDuration(seconds, unit);
  return `${formatDisplay(seconds / SECONDS_PER_UNIT[unit])} ${strings().lienzo.unidadesCortas[unit]}`;
}

/** The exact value of a duration (the CLI's text) with its unit, for a cell's `title`. */
export function exactDuration(seconds: number, unit: BaseTimeUnit): string {
  return `${formatDuration(seconds, unit)} ${strings().lienzo.unidadesCortas[unit]}`;
}
