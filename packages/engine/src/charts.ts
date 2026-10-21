/**
 * Charts of a run (#460, #636): what each chart of the app's Results view draws, and the same
 * charts drawn as plain SVG text for the process document a host without a browser exports.
 *
 * The data and geometry functions moved here from the app (`apps/web/src/graficas.ts` and
 * `GraficasSvg.tsx`), so the app's charts and the engine's draw the same rows on the same scale:
 * every value comes from the same `RunResult` fields as the table beside it, so a chart can never
 * say something its table does not. The app keeps its React drawing and imports these.
 *
 * `chartsSvg` mirrors the app's `SvgBarras`/`SvgHistograma` in `PAPER_PALETTE` (the paper of
 * `toHtml`), minus what only works on screen: no hover titles, no hit areas, no element ids, so
 * the same input always gives the same bytes and two charts on one page never clash.
 *
 * Pure: no DOM, no `node:*`, no clock; the app's Vite build bundles this subpath.
 */
import type { ProcessIR } from './core/ir.js';
import type { RunResult } from './core/result.js';
import { columnLabel, formatNumber, SECONDS_PER_UNIT, type BaseTimeUnit } from './format.js';
import { messages, type Locale } from './messages/index.js';
import type { ResolvedScenario } from './scenario.js';

/* ------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------ */

/**
 * Categorical slots, fixed order, never cycled: the validated default palette of the dataviz
 * method (worst adjacent CVD ΔE 9.1 light / 8.4 dark, normal-vision ΔE ≥ 19.3). Re-validated on
 * every built-in surface of Lila: light on `#FFFFFF` (Lila Light, Papel, Tieso) and `#F2D9FC`
 * (Montana), dark on `#1C1730` (Eva-01), `#271640` (Lila Dark) and `#14121F` (Akira). On the light
 * surfaces some slots sit under 3:1, which is why every bar carries its value as text and the
 * table stays next to the chart.
 *
 * The app's `graficas.css` declares the same hex values as `--serie-N`; `graficas.test.ts` keeps
 * them equal.
 */
export const SERIES_LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'] as const;
export const SERIES_DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'] as const;
/** Series a chart can tell apart; a ninth is never a generated hue. */
export const MAX_SERIES = SERIES_LIGHT.length;

/** One bar: `value` in the chart's unit, `null` when the table shows no value (absent, not zero). */
export interface ChartPoint {
  id: string;
  label: string;
  value: number | null;
}

/** Utilization per pool, in %, in the order of the Resources table (`resourceRows`). */
export function utilizationByResource(result: RunResult, names: Readonly<Record<string, string>>): ChartPoint[] {
  return Object.entries(result.resources).map(([id, m]) => ({ id, label: names[id] ?? id, value: m.utilization * 100 }));
}

/**
 * Instances started per task, in the order of the Elements table. Only tasks: events and gateways
 * repeat the count of the task next to them and would double the chart for nothing.
 */
export function instancesByTask(ir: ProcessIR, result: RunResult): ChartPoint[] {
  return Object.entries(result.elements)
    .filter(([id]) => ir.nodes[id]?.type === 'task')
    .map(([id, m]) => ({ id, label: ir.nodes[id]?.name || id, value: m.started }));
}

export const PERCENTILES = ['p50', 'p90', 'p95'] as const;

/**
 * Cycle and wait time p50/p90/p95 of the Process table, in seconds; `null` when no case completed,
 * because then the engine's zeros are the statistics of an empty set, not a measured zero
 * (docs/RESULTS_FORMAT.md § 8).
 */
export function processPercentiles(result: RunResult): { cycle: number[]; wait: number[] } | null {
  if (result.process.completed === 0) return null;
  return {
    cycle: PERCENTILES.map((p) => result.process.cycleTime[p]),
    wait: PERCENTILES.map((p) => result.process.waitTime[p]),
  };
}

/** The smallest 1, 2 or 5 × 10ⁿ that is at least `x` (> 0). */
export function roundStep(x: number): number {
  const base = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 5, 10].map((m) => m * base).find((step) => step >= x * (1 - 1e-9)) ?? 10 * base;
}

/**
 * The run measured nothing: every arrival fell inside the warm-up (or the warm-up outlasts the
 * run), so its zeros are not measurements and no chart draws them.
 */
export function nothingMeasured(result: RunResult, warmup: number | undefined): boolean {
  return result.process.started === 0 && (warmup ?? 0) > 0;
}

/** Axis from 0 to a round top with about five ticks; an all-zero chart still gets an axis 0–1. */
export function scale(maximum: number, top?: number): { top: number; ticks: number[] } {
  const high = top ?? (maximum > 0 ? maximum : 1);
  const step = roundStep(high / 5);
  const end = top ?? Math.ceil(high / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= end + step * 1e-9; v += step) ticks.push(Math.round(v / step) * step);
  return { top: end, ticks };
}

/** One class of the histogram: `[from, to)`. */
export interface HistogramClass {
  from: number;
  to: number;
  cases: number;
}

/**
 * Sturges' rule (between 5 and 20 classes) on round edges. Every value falls in exactly one class,
 * so the counts add up to the number of cases. A single distinct value is one class of its own.
 */
export function histogram(values: readonly number[]): HistogramClass[] {
  if (values.length === 0) return [];
  // A loop, not `Math.min(...values)`: a year of arrivals is half a million cases, past what a
  // spread fits on the call stack (QA of #512).
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max === min) return [{ from: min, to: max, cases: values.length }];
  const classes = Math.min(20, Math.max(5, Math.ceil(Math.log2(values.length)) + 1));
  const step = roundStep((max - min) / classes);
  const start = Math.floor(min / step) * step;
  const n = Math.floor((max - start) / step) + 1;
  const result = Array.from({ length: n }, (_, i) => ({ from: start + i * step, to: start + (i + 1) * step, cases: 0 }));
  for (const v of values) result[Math.min(n - 1, Math.floor((v - start) / step))]!.cases++;
  return result;
}

/* ------------------------------------------------------------------ *
 * Numbers as the charts show them (#578)
 * ------------------------------------------------------------------ */

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
 * 0.01 it keeps two significant digits (0.004158 → "0.0042"). `formatNumber` stays exact (1e-6)
 * for the CLI, the CSV/XLSX exports and the goldens; the screen and the charts show this instead.
 */
export function formatDisplay(value: number, decimals = 2): string {
  // Below the CLI's own 1e-6 rounding it is float noise: show "0" like the title, not "1.2e-7".
  if (formatNumber(value) === '0') return '0';
  if (Math.abs(value) < 10 ** -decimals) return String(Number(value.toPrecision(2)));
  return formatNumber(roundDisplay(value, decimals));
}

/**
 * Seconds in `unit` with two decimals. A duration of an hour or more in a unit smaller than hours
 * also reads in hours: `11700` s in `min` is "3.25 h (195 min)", with the short unit names of the
 * caller's language. Below an hour the number goes alone, for a column whose header already names
 * the unit.
 */
export function formatDisplayDuration(seconds: number, unit: BaseTimeUnit, short: Readonly<Record<BaseTimeUnit, string>>): string {
  const inUnit = formatDisplay(seconds / SECONDS_PER_UNIT[unit]);
  if (!inHours(seconds, unit)) return inUnit;
  return `${formatDisplay(seconds / SECONDS_PER_UNIT.h)} ${short.h} (${inUnit} ${short[unit]})`;
}

/** Whether `formatDisplayDuration` also gives the duration in hours. */
export function inHours(seconds: number, unit: BaseTimeUnit): boolean {
  return Number.isFinite(seconds) && Math.abs(seconds) >= SECONDS_PER_UNIT.h && SECONDS_PER_UNIT[unit] < SECONDS_PER_UNIT.h;
}

/* ------------------------------------------------------------------ *
 * Geometry shared by the app's drawing and this one
 * ------------------------------------------------------------------ */

export interface ChartPalette {
  series: readonly string[];
  ink: string;
  muted: string;
  grid: string;
  font: string;
  /** Painted behind the chart; on screen the section's surface shows through instead. */
  background?: string;
}

/** The paper of `toHtml` in `process-document.ts`: its ink and border colors. */
export const PAPER_PALETTE: ChartPalette = {
  series: SERIES_LIGHT,
  ink: '#280838',
  muted: '#5c4470',
  grid: '#c8c0d0',
  font: 'Archivo, Inter, system-ui, -apple-system, "Segoe UI", sans-serif',
  background: '#ffffff',
};

/** Width of a chart in the document, in CSS px: close to the A4 text width at 96 dpi. */
export const PAPER_WIDTH = 720;

const PAD = 8;
// Advance of a 12 px character of the UI font, for fitting labels: measured in Chrome at 6.3–6.4 on
// average and 7.1 for the widest real labels, so 7 errs on the side of room.
const CHAR = 7;
const BAR = 14;
const BETWEEN_BARS = 2;
const BETWEEN_GROUPS = 10;
const RADIUS = 4;
const LEGEND_ROW_HEIGHT = 18;

const textWidth = (text: string, size = 12): number => (text.length * CHAR * size) / 12;

function clip(text: string, width: number): string {
  const fits = Math.floor(width / CHAR);
  return text.length <= fits ? text : `${text.slice(0, Math.max(1, fits - 1))}…`;
}

/** Largest of `f` over `items`, at least `from`; a loop, so no list is too long for it. */
function largest<T>(items: readonly T[], f: (item: T) => number, from: number): number {
  let m = from;
  for (const item of items) m = Math.max(m, f(item));
  return m;
}

/** Where each legend entry goes: entries flow left to right and wrap, none past `width`. */
export function legendRows(names: readonly string[], width: number): { text: string; x: number; row: number }[] {
  const available = width - 2 * PAD - 14;
  let x = PAD;
  let row = 0;
  return names.map((name) => {
    const text = clip(name, Math.min(180, available));
    const w = 14 + textWidth(text);
    if (x > PAD && x + w > width - PAD) {
      x = PAD;
      row += 1;
    }
    const entry = { text, x, row };
    x += w + 16;
    return entry;
  });
}

/** One group of bars: a value per series and the table's text for each. */
export interface ChartGroup {
  id: string;
  label: string;
  /** One value per series, in the chart's unit; `null` is absent (no bar), never zero. */
  values: readonly (number | null)[];
  /** The text each bar shows at its tip: the table's own cell text. */
  texts: readonly string[];
}

/**
 * Horizontal layout of a bar chart `width` wide. The value at the tip is the table's text and is
 * never cut: it takes the room it needs, the group labels give way first (cut with «…»), and the
 * plot keeps at least 40 px.
 */
export function barGeometry(
  groups: readonly Pick<ChartGroup, 'label' | 'texts'>[],
  width: number,
): { x0: number; labelWidth: number; plotWidth: number } {
  const valueNeeded = largest(groups, (g) => largest(g.texts, (t) => textWidth(t, 11) + 8, 0), 24);
  const labelWidth = Math.min(width * 0.3, largest(groups, (g) => textWidth(g.label) + 8, 40), Math.max(40, width - 2 * PAD - 40 - valueNeeded));
  const valueWidth = Math.min(valueNeeded, width - 2 * PAD - labelWidth - 40);
  const x0 = PAD + labelWidth;
  return { x0, labelWidth, plotWidth: Math.max(40, width - x0 - valueWidth - PAD) };
}

/**
 * The axis ticks whose labels fit side by side at `pxPerUnit`: every k-th one, from 0, with at
 * least 8 px between labels (the histogram does the same for its edges).
 */
export function ticksThatFit(ticks: readonly number[], pxPerUnit: number): number[] {
  if (ticks.length < 2) return [...ticks];
  const step = (ticks[1]! - ticks[0]!) * pxPerUnit;
  const label = largest(ticks, (m) => textWidth(formatDisplay(m), 11), 0) + 8;
  const every = Math.max(1, Math.ceil(label / step));
  return ticks.filter((_, i) => i % every === 0);
}

/** A bar grown from `x0` to the right: rounded data end, square at the baseline. */
function horizontalBar(x0: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w, h / 2);
  return `M${x0},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 ${-r},${r}h${r - w}z`;
}

/** A column grown from `base` upwards: rounded top, square at the baseline. */
function column(x: number, base: number, w: number, h: number): string {
  const r = Math.min(RADIUS, h, w / 2);
  return `M${x},${base}v${r - h}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`;
}

/* ------------------------------------------------------------------ *
 * SVG text
 * ------------------------------------------------------------------ */

function escapeSvg(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

type Attributes = Readonly<Record<string, string | number>>;

function element(name: string, attributes: Attributes, content?: string): string {
  const attrs = Object.entries(attributes).map(([key, value]) => ` ${key}="${escapeSvg(String(value))}"`).join('');
  return content === undefined ? `<${name}${attrs}/>` : `<${name}${attrs}>${content}</${name}>`;
}

const text = (attributes: Attributes, content: string): string => element('text', attributes, escapeSvg(content));

function svgRoot(width: number, height: number, palette: ChartPalette, title: string, description: string, body: string): string {
  return element(
    'svg',
    { xmlns: 'http://www.w3.org/2000/svg', role: 'img', width, height, viewBox: `0 0 ${width} ${height}`, 'font-family': palette.font },
    element('title', {}, escapeSvg(title)) +
      element('desc', {}, escapeSvg(description)) +
      (palette.background === undefined ? '' : element('rect', { width, height, fill: palette.background })) +
      body,
  );
}

function header(title: string, sub: string | undefined, palette: ChartPalette): string {
  return (
    text({ x: PAD, y: PAD + 12, fill: palette.ink, 'font-size': 13, 'font-weight': 600 }, title) +
    (sub === undefined ? '' : text({ x: PAD, y: PAD + 30, fill: palette.muted, 'font-size': 11 }, sub))
  );
}

/** A bar chart: the same layout as the app's `SvgBarras`. */
export interface BarChart {
  title: string;
  sub?: string | undefined;
  /** Names of the series; two or more get a legend. */
  series: readonly string[];
  groups: readonly ChartGroup[];
  /** Fixed top of the axis (100 for a percentage). */
  top?: number | undefined;
}

/** `{ svg, alt }` of a bar chart; `value(label, text)` words each value of the description. */
export function barChartSvg(
  chart: BarChart,
  value: (label: string, text: string) => string,
  palette: ChartPalette = PAPER_PALETTE,
  width: number = PAPER_WIDTH,
): { svg: string; alt: string } {
  const { title, sub, series, groups, top } = chart;
  const color = (serie: number): string => palette.series[serie] ?? palette.series[0]!;
  const legend = series.length >= 2;

  const W = Math.max(280, width);
  const { x0, labelWidth, plotWidth } = barGeometry(groups, W);
  const maximum = largest(groups, (g) => largest(g.values, (v) => v ?? 0, 0), 0);
  const axis = scale(maximum, top !== undefined && maximum <= top ? top : undefined);
  const x = (v: number): number => x0 + (v / axis.top) * plotWidth;
  const ticks = ticksThatFit(axis.ticks, plotWidth / axis.top);

  const groupHeight = series.length * BAR + (series.length - 1) * BETWEEN_BARS;
  const entries = legend ? legendRows(series, W) : [];
  const rows = entries.length === 0 ? 0 : entries.at(-1)!.row + 1;
  const above = PAD + 20 + (sub === undefined ? 0 : 18) + rows * LEGEND_ROW_HEIGHT + (legend ? 4 : 0) + 6;
  const below = above + groups.length * groupHeight + Math.max(0, groups.length - 1) * BETWEEN_GROUPS;
  const H = below + 6 + 16 + PAD;

  const description = groups
    .map((g) =>
      series.length === 1
        ? value(g.label, g.texts[0] ?? '')
        : `${g.label}: ${series.map((s, i) => value(s, g.texts[i] ?? '')).join(', ')}`,
    )
    .join('; ');

  let body = header(title, sub, palette);
  if (legend) {
    body += element(
      'g',
      { transform: `translate(0 ${PAD + 20 + (sub === undefined ? 0 : 18) + 4})` },
      entries
        .map(({ text: entry, x: x1, row }, i) =>
          element('rect', { x: x1, y: 2 + row * LEGEND_ROW_HEIGHT, width: 10, height: 10, rx: 2, fill: color(i) }) +
          text({ x: x1 + 14, y: 11 + row * LEGEND_ROW_HEIGHT, fill: palette.ink, 'font-size': 12 }, entry),
        )
        .join(''),
    );
  }
  for (const m of ticks) {
    body +=
      element('line', { x1: x(m), x2: x(m), y1: above - 4, y2: below + 4, stroke: palette.grid, 'stroke-width': 1 }) +
      text({ x: x(m), y: below + 18, fill: palette.muted, 'font-size': 11, 'text-anchor': 'middle' }, formatDisplay(m));
  }
  groups.forEach((g, gi) => {
    const y = above + gi * (groupHeight + BETWEEN_GROUPS);
    body += text({ x: x0 - 6, y: y + groupHeight / 2 + 4, fill: palette.ink, 'font-size': 12, 'text-anchor': 'end' }, clip(g.label, labelWidth - 8));
    series.forEach((_, si) => {
      const v = g.values[si] ?? null;
      const yb = y + si * (BAR + BETWEEN_BARS);
      const w = v === null ? 0 : Math.max(0, x(v) - x0);
      if (w > 0) body += element('path', { d: horizontalBar(x0, yb, w, BAR), fill: color(si) });
      body += text({ x: x0 + w + 4, y: yb + BAR - 3, fill: palette.ink, 'font-size': 11 }, g.texts[si] ?? '');
    });
  });
  body += element('line', { x1: x0, x2: x0, y1: above - 4, y2: below + 4, stroke: palette.muted, 'stroke-width': 1 });

  return { svg: svgRoot(W, H, palette, title, description, body), alt: `${title}. ${description}` };
}

/** Text of a class, the same in the description and the app's data table. */
export function classText(c: HistogramClass): string {
  return c.from === c.to ? formatDisplay(c.from) : `${formatDisplay(c.from)} – ${formatDisplay(c.to)}`;
}

/** A histogram: the same layout as the app's `SvgHistograma`. `values` are in the chart's unit. */
export interface HistogramChart {
  title: string;
  sub?: string | undefined;
  values: readonly number[];
}

/** `{ svg, alt }` of a histogram, with the words of its description and of its count axis. */
export function histogramSvg(
  chart: HistogramChart,
  words: { value: (label: string, text: string) => string; cases: (n: number) => string; casesAxis: string },
  palette: ChartPalette = PAPER_PALETTE,
  width: number = PAPER_WIDTH,
): { svg: string; alt: string } {
  const { title, sub, values } = chart;
  const classes = histogram(values);
  const W = Math.max(280, width);
  const axis = scale(largest(classes, (c) => c.cases, 0));
  const yLabelWidth = Math.max(24, textWidth(formatDisplay(axis.top), 11) + 10);
  const x0 = PAD + yLabelWidth;
  const plotWidth = W - x0 - PAD;
  const above = PAD + 20 + (sub === undefined ? 0 : 18) + 26;
  const high = 160;
  const base = above + high;
  const H = base + 6 + 16 + PAD;
  const y = (v: number): number => base - (v / axis.top) * high;
  const classWidth = classes.length === 0 ? 0 : plotWidth / classes.length;
  const mode = classes.reduce((best, c, i) => (c.cases > (classes[best]?.cases ?? -1) ? i : best), 0);
  // At most about eight edge labels, so they never run into each other.
  const every = Math.max(1, Math.ceil((classes.length + 1) / Math.max(2, Math.floor(plotWidth / 64))));
  const edges = classes.length === 1 && classes[0]!.from === classes[0]!.to ? [] : [...classes.map((c) => c.from), classes.at(-1)?.to ?? 0];

  const description = classes.map((c) => words.value(classText(c), words.cases(c.cases))).join('; ');

  let body = header(title, sub, palette);
  for (const m of axis.ticks) {
    body +=
      element('line', { x1: x0, x2: W - PAD, y1: y(m), y2: y(m), stroke: palette.grid, 'stroke-width': 1 }) +
      text({ x: x0 - 6, y: y(m) + 4, fill: palette.muted, 'font-size': 11, 'text-anchor': 'end' }, formatDisplay(m));
  }
  body += text({ x: PAD, y: above - 14, fill: palette.muted, 'font-size': 11 }, words.casesAxis);
  classes.forEach((c, i) => {
    const h = base - y(c.cases);
    const xc = x0 + i * classWidth + 1;
    const w = Math.max(1, classWidth - 2);
    if (c.cases > 0) body += element('path', { d: column(xc, base, w, h), fill: palette.series[0]! });
    if (i === mode && c.cases > 0) {
      body += text({ x: xc + w / 2, y: y(c.cases) - 4, fill: palette.ink, 'font-size': 11, 'text-anchor': 'middle' }, formatDisplay(c.cases));
    }
  });
  body += element('line', { x1: x0, x2: W - PAD, y1: base, y2: base, stroke: palette.muted, 'stroke-width': 1 });
  edges.forEach((b, i) => {
    // The last edge ends at the plot's right edge instead of running past it.
    if (i % every === 0) {
      body += text(
        { x: x0 + i * classWidth, y: base + 16, fill: palette.muted, 'font-size': 11, 'text-anchor': i === edges.length - 1 ? 'end' : 'middle' },
        formatDisplay(b),
      );
    }
  });
  if (edges.length === 0 && classes.length === 1) {
    body += text({ x: x0 + plotWidth / 2, y: base + 16, fill: palette.muted, 'font-size': 11, 'text-anchor': 'middle' }, classText(classes[0]!));
  }

  return { svg: svgRoot(W, H, palette, title, description, body), alt: `${title}. ${description}` };
}

/* ------------------------------------------------------------------ *
 * The charts of a run, for the process document
 * ------------------------------------------------------------------ */

export interface ChartsInput {
  readonly ir: ProcessIR;
  readonly scenario: ResolvedScenario;
  readonly result: RunResult;
  readonly locale?: Locale | undefined;
  /**
   * Cycle time (s) of each completed case of replication 0 (`simulate`'s `onCycleTimes`). A stored
   * run keeps none, so without it the histogram is left out.
   */
  readonly cycleTimes?: readonly number[] | undefined;
}

/**
 * The charts of a run as standalone SVG, in the app's reading order (`graficasDelDocumento`):
 * utilization, cycle/wait percentiles, the per-case histogram when `cycleTimes` has cases,
 * instances per task. A chart with nothing to draw is left out; utilization and instances are
 * left out too when the warm-up swallowed the run. `alt` is the title and every value.
 */
export function chartsSvg(input: ChartsInput): { svg: string; alt: string }[] {
  const { ir, scenario, result } = input;
  const C = messages(input.locale ?? 'en').cli;
  const unit = (scenario.run.baseTimeUnit ?? 's') as BaseTimeUnit;
  const short = { s: C.chartUnit('s'), min: C.chartUnit('min'), h: C.chartUnit('h'), day: C.chartUnit('day') };
  const names = Object.fromEntries(Object.entries(scenario.resources ?? {}).map(([id, r]) => [id, r.name ?? id]));
  const measured = !nothingMeasured(result, scenario.run.warmup);
  const value = C.chartValue;
  const oneSeries = (title: string, serie: string, points: readonly ChartPoint[], top?: number): BarChart => ({
    title,
    series: [serie],
    groups: points.map((p) => ({ id: p.id, label: p.label, values: [p.value], texts: [p.value === null ? C.chartNoValue() : formatDisplay(p.value)] })),
    top,
  });

  const charts: { svg: string; alt: string }[] = [];
  if (measured) {
    const points = utilizationByResource(result, names);
    if (points.length > 0) charts.push(barChartSvg(oneSeries(C.chartUtilization(), columnLabel('resources', 'utilization'), points, 100), value));
  }
  const percentiles = processPercentiles(result);
  if (percentiles !== null) {
    const chart: BarChart = {
      title: C.chartPercentiles(unit),
      series: [C.chartCycle(), C.chartWait()],
      groups: PERCENTILES.map((p, i) => {
        const seconds = [percentiles.cycle[i]!, percentiles.wait[i]!];
        return {
          id: p,
          label: p,
          values: seconds.map((s) => s / SECONDS_PER_UNIT[unit]),
          texts: seconds.map((s) => formatDisplayDuration(s, unit, short)),
        };
      }),
    };
    charts.push(barChartSvg(chart, value));
  }
  const cycleTimes = input.cycleTimes;
  if (cycleTimes !== undefined && cycleTimes.length > 0) {
    const chart: HistogramChart = {
      title: C.chartHistogram(unit),
      sub: C.chartHistogramSub(cycleTimes.length, scenario.run.replications ?? 1),
      values: cycleTimes.map((c) => c / SECONDS_PER_UNIT[unit]),
    };
    charts.push(histogramSvg(chart, { value, cases: C.chartCases, casesAxis: C.chartCasesAxis() }));
  }
  if (measured) {
    const points = instancesByTask(ir, result);
    if (points.length > 0) charts.push(barChartSvg(oneSeries(C.chartInstances(), columnLabel('elements', 'started'), points), value));
  }
  return charts;
}
