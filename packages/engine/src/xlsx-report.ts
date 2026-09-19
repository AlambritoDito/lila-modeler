/**
 * Results workbooks (issue #80): what `lila run --xlsx`, `lila compare --xlsx` and the two
 * "Export XLSX" buttons of the web produce.
 *
 * The Elements / Flows / Resources / Parameters tables are **not** rebuilt here: they come from the
 * row builders of `csv.ts` (`elementsRows`, `flowsRows`, `resourcesRows`, `processRows`), the same
 * ones `toCsv` serializes, so a column added to the CSV shows up in the spreadsheet and the two can
 * never disagree. Column names are the Bizagi mapping of `docs/RESULTS_FORMAT.md` § 10 through
 * `format.ts`, untranslated in every language (rule 4 of `BACKLOG.md`); only the sheet names and
 * the labels of the sheets the workbook *adds* (Summary, Parameters, Comparison) come from the
 * message catalog.
 *
 * Everything here is pure: no `node:fs`, no clock. The CLI writes the bytes and the browser turns
 * them into a `Blob`.
 */

import { alwaysOpen, compileCalendar, openTime, weekOffsetSeconds } from './core/calendar.js';
import type { CompareResult } from './core/compare.js';
import type { ProcessIR } from './core/ir.js';
import type { RunResult } from './core/result.js';
import { PROCESS_COLUMNS, elementsRows, flowsRows, processRows, resourcesRows } from './csv.js';
import { columnHeader, columnLabel } from './format.js';
import { messages, type Locale } from './messages/index.js';
import type { Distribution, ResolvedScenario } from './scenario.js';
import { workbook, type CellFormat, type CellValue, type SheetSpec } from './xlsx.js';

export { XLSX_MIME_TYPE } from './xlsx.js';

/** id of a resource pool -> visible name, the same map `lila run --csv` feeds to `resourcesCsv`. */
export type ResourceNames = Readonly<Record<string, string | undefined>>;

/** `{ cajero: 'Cashier' }` out of a resolved scenario; the CLI and the web both need it. */
export function resourceNamesOf(scenario: ResolvedScenario): Record<string, string> {
  return Object.fromEntries(
    Object.entries(scenario.resources ?? {}).map(([id, resource]) => [id, resource.name ?? id]),
  );
}

/* ------------------------------------------------------------------ *
 * Payroll: what the pools cost for the whole run, used or not
 * ------------------------------------------------------------------ */

/**
 * Working seconds of the run for one calendar: the open time of `[0, run.duration)`, exactly the
 * `availableTime` denominator of `utilization` (`docs/RESULTS_FORMAT.md` § 4). A pool with no
 * calendar is 24×7. `null` when the scenario has no `run.duration`: the run then ends when the
 * arrivals do, an instant this function cannot know without simulating.
 */
function workingSeconds(scenario: ResolvedScenario, calendarId: string | undefined): number | null {
  const { duration } = scenario.run;
  if (duration === undefined) return null;
  const offset = weekOffsetSeconds(scenario.run.start);
  const definition = calendarId === undefined ? undefined : scenario.calendars?.[calendarId];
  // An unknown id cannot happen in a validated scenario; degrading to 24×7 keeps the export from
  // being the only surface in the project that refuses to produce output.
  const calendar = definition === undefined ? alwaysOpen(offset) : compileCalendar(definition, offset);
  return openTime(calendar, 0, duration);
}

/** One payroll line: what the pool costs for the hours it was available, whether busy or idle. */
export interface PayrollRow {
  id: string;
  name: string;
  /** Units of the pool; the sum of the slices when `capacity` is a list of calendar intervals. */
  capacity: number;
  /** Hours the pool was available during the run; `null` without `run.duration`. */
  hours: number | null;
  /** `capacity × costPerHour × hours`; `null` when `hours` is. */
  cost: number | null;
}

/**
 * Payroll of every declared pool: `capacity × costPerHour × working hours of the run`.
 *
 * It is **not** `resources[id].unitCost`, which only charges the hours the pool was actually busy
 * (§ 4). Both readings are legitimate and answer different questions — what the process consumed
 * versus what the staffing costs regardless of load — and Bizagi's "Resource utilization" report
 * shows them side by side. A pool whose capacity is given per calendar slice pays each slice at
 * that slice's own open hours.
 */
export function payrollRows(scenario: ResolvedScenario, names: ResourceNames = {}): PayrollRow[] {
  return Object.entries(scenario.resources ?? {}).map(([id, resource]) => {
    const slices = Array.isArray(resource.capacity)
      ? resource.capacity.map((slice) => ({ calendar: slice.calendar, capacity: slice.capacity }))
      : [{ calendar: resource.calendar, capacity: resource.capacity }];

    let capacity = 0;
    let hours: number | null = 0;
    let cost: number | null = 0;
    for (const slice of slices) {
      capacity += slice.capacity;
      const seconds = workingSeconds(scenario, slice.calendar);
      if (seconds === null) {
        hours = null;
        cost = null;
        continue;
      }
      if (hours !== null) hours += seconds / 3600;
      if (cost !== null) cost += (slice.capacity * resource.costPerHour * seconds) / 3600;
    }

    return { capacity, cost, hours, id, name: names[id] ?? resource.name ?? id };
  });
}

/* ------------------------------------------------------------------ *
 * Summary sheet
 * ------------------------------------------------------------------ */

/** Bizagi column names, identical in every language (`docs/BIZAGI_PARITY.md`). */
const ID_COLUMN = 'Id';
const NAME_COLUMN = 'Name';
const METRIC_COLUMN = 'Metric';

/**
 * Metric label of the `Summary` sheet, with the unit of the value it names (#359).
 *
 * The sheet is tall — the metric travels as a **label**, not as a column header — so the unit can
 * go next to it with the project's usual `columnHeader` convention (`Cycle time average (s)`,
 * exactly as the console prints `Cycle time average (min)`). The Elements / Flows / Resources
 * sheets cannot do the same: their headers are the Bizagi contract and are pinned to the CSV's
 * (`docs/RESULTS_FORMAT.md` § 12), so the unit of those sheets is stated in the `Notes` block
 * instead. Durations are always seconds here — the workbook never converts (§ 1).
 */
function metricLabel(metric: string): string {
  return columnHeader('process', metric, 's');
}

/** Formats of a tall sheet's five columns: text, text, text, text and the one `Value` column. */
const VALUE_NUMBER: readonly (CellFormat | undefined)[] = [
  undefined,
  undefined,
  undefined,
  undefined,
  'number',
];
const VALUE_PERCENT: readonly (CellFormat | undefined)[] = [
  undefined,
  undefined,
  undefined,
  undefined,
  'percent',
];

/**
 * `Summary`: the process table of `lila run` in tall form (one metric per row, so it stays
 * readable next to the per-outcome and payroll blocks), the completed cases per end event when the
 * result carries them, the payroll of every declared pool with its total, and a `Notes` block that
 * says what the numbers above mean (#358, #359).
 */
export function summarySheet(
  ir: ProcessIR,
  scenario: ResolvedScenario,
  result: RunResult,
  names: ResourceNames,
  locale: Locale = 'en',
): SheetSpec {
  const C = messages(locale).cli;
  const rows: CellValue[][] = [];
  // `Within service level` is a fraction in a `Value` column full of counts, seconds and money, so
  // it takes its own percentage cell: `0.###` would show `0.001004` as `0.001` and anything under
  // `0.0005` as the `0` section 5 forbids reading as "0 % met" (#359).
  const rowFormats: (readonly (CellFormat | undefined)[] | undefined)[] = [];
  const percentValue = (): void => {
    rowFormats[rows.length] = VALUE_PERCENT;
  };
  const table = processRows(result);
  const values = table.rows[0] ?? [];

  PROCESS_COLUMNS.forEach((metric, index) => {
    const value = values[index] ?? null;
    // The CSV keeps `withinServiceLevel` (empty without `run.serviceLevel`) and `outcome` (empty
    // on the global row) so its columns stay fixed; a tall sheet has no column to keep, so a row
    // with nothing to say is left out instead of written blank.
    if (value === null) return;
    if (metric === 'withinServiceLevel') percentValue();
    rows.push([C.xlsxSectionProcess(), '', '', metricLabel(metric), value]);
  });

  // Per-outcome block (#316): completed cases, mean cycle time and, with `run.serviceLevel`, the
  // fraction met, one row per metric like the process block above.
  for (const [id, outcome] of Object.entries(result.process.byEndEvent ?? {})) {
    const name = ir.nodes[id]?.name ?? '';
    rows.push([C.xlsxSectionOutcomes(), id, name, metricLabel('completed'), outcome.completed]);
    rows.push([C.xlsxSectionOutcomes(), id, name, metricLabel('cycleTime.mean'), outcome.cycleTime.mean]);
    if (outcome.withinServiceLevel !== undefined) {
      percentValue();
      rows.push([C.xlsxSectionOutcomes(), id, name, metricLabel('withinServiceLevel'), outcome.withinServiceLevel]);
    }
  }

  const payroll = payrollRows(scenario, names);
  for (const row of payroll) {
    rows.push([C.xlsxSectionPayroll(), row.id, row.name, C.xlsxCapacity(), row.capacity]);
    rows.push([C.xlsxSectionPayroll(), row.id, row.name, C.xlsxWorkingHours(), row.hours]);
    rows.push([C.xlsxSectionPayroll(), row.id, row.name, C.xlsxPayrollCost(), row.cost]);
  }
  if (payroll.length > 0) {
    const total = payroll.every((row) => row.cost === null)
      ? null
      : payroll.reduce((sum, row) => sum + (row.cost ?? 0), 0);
    rows.push([C.xlsxSectionPayroll(), '', '', `${C.xlsxTotal()} — ${C.xlsxPayrollCost()}`, total]);
  }

  // `Notes` (#358, #359): the three readings a workbook opened away from the app gets wrong —
  // the unit of the source sheets, what `Cost per case` averages over, and payroll against
  // actual use. Text in the `Value` column; no metric, no number.
  // Every label of the block comes from the catalog, so the Spanish workbook reads in Spanish:
  // `metricLabel('costPerCase')` is English by contract (section 10) and mixed the two languages
  // in the same block.
  rows.push([C.xlsxSectionNotes(), '', '', C.xlsxNoteDurations(), C.xlsxNoteSeconds()]);
  rows.push([C.xlsxSectionNotes(), '', '', C.xlsxCostPerCase(), C.xlsxNoteCostPerCase()]);
  if (payroll.length > 0) {
    rows.push([C.xlsxSectionNotes(), '', '', C.xlsxPayrollCost(), C.xlsxNotePayroll()]);
  }

  return {
    // Only the `Value` column holds numbers, and it holds every kind of them, so the column takes
    // the readable format and the fraction rows override it above.
    formats: VALUE_NUMBER,
    headers: [C.xlsxColumnSection(), ID_COLUMN, NAME_COLUMN, METRIC_COLUMN, C.xlsxColumnValue()],
    name: C.xlsxSheetSummary(),
    rowFormats,
    rows,
  };
}

/* ------------------------------------------------------------------ *
 * Parameters sheet
 * ------------------------------------------------------------------ */

/** `exponential(mean=240)`; a `user` distribution lists its `value:probability` pairs. */
export function describeDistribution(distribution: Distribution): string {
  const { type, ...rest } = distribution as { type: string } & Record<string, unknown>;
  const parts = Object.entries(rest).map(([key, value]) => {
    if (Array.isArray(value)) {
      const pairs = value as readonly { value: number; probability: number }[];
      return `${key}=[${pairs.map((pair) => `${pair.value}:${pair.probability}`).join(', ')}]`;
    }
    return `${key}=${String(value)}`;
  });
  return `${type}(${parts.join(', ')})`;
}

/** `MON,TUE 09:00-18:00`, one entry per interval of the calendar. */
function describeCalendar(intervals: readonly { days: readonly string[]; from: string; to: string }[]): string {
  return intervals.map((interval) => `${interval.days.join(',')} ${interval.from}-${interval.to}`).join('; ');
}

/**
 * `Parameters`: the **resolved** scenario as it actually ran (`extends` already applied, `--seed`
 * and `--replications` overrides included), so a workbook can be read months later without the
 * JSON next to it. Tall shape — section, id, name, parameter, value — because the sections have
 * nothing in common column-wise.
 */
export function parametersSheet(
  ir: ProcessIR,
  scenario: ResolvedScenario,
  locale: Locale = 'en',
): SheetSpec {
  const C = messages(locale).cli;
  const rows: CellValue[][] = [];
  const run = (section: string, id: string, name: string, parameter: string, value: CellValue): void => {
    if (value === undefined || value === null || value === '') return;
    rows.push([section, id, name, parameter, value]);
  };

  const runSection = C.xlsxSectionRun();
  run(runSection, '', '', 'name', scenario.name);
  // Solo el nombre del archivo: `model` viene ya resuelto a ruta absoluta y un libro que se
  // comparte no tiene por qué llevar el directorio personal de quien lo exportó.
  run(runSection, '', '', 'model', scenario.model.split(/[\\/]/).pop() ?? scenario.model);
  run(runSection, '', '', 'start', scenario.run.start);
  run(runSection, '', '', 'duration', scenario.run.duration ?? null);
  run(runSection, '', '', 'warmup', scenario.run.warmup);
  run(runSection, '', '', 'replications', scenario.run.replications);
  run(runSection, '', '', 'seed', scenario.run.seed ?? 1);
  run(runSection, '', '', 'baseTimeUnit', scenario.run.baseTimeUnit);
  run(runSection, '', '', 'currency', scenario.run.currency ?? null);

  for (const [id, calendar] of Object.entries(scenario.calendars ?? {})) {
    run(C.xlsxSectionCalendars(), id, '', 'intervals', describeCalendar(calendar.intervals));
  }

  for (const [id, resource] of Object.entries(scenario.resources ?? {})) {
    const section = C.xlsxSheetResources();
    const name = resource.name ?? '';
    run(section, id, name, 'type', resource.type);
    run(
      section,
      id,
      name,
      'capacity',
      Array.isArray(resource.capacity)
        ? resource.capacity.map((slice) => `${slice.calendar}:${slice.capacity}`).join(', ')
        : resource.capacity,
    );
    run(section, id, name, 'costPerHour', resource.costPerHour);
    run(section, id, name, 'fixedCost', resource.fixedCost);
    run(section, id, name, 'calendar', resource.calendar ?? null);
  }

  for (const [id, element] of Object.entries(scenario.elements ?? {})) {
    const name = ir.nodes[id]?.name ?? ir.flows[id]?.name ?? '';
    const section =
      element.interTriggerTimer !== undefined
        ? C.xlsxSectionArrivals()
        : element.probability !== undefined
          ? C.xlsxSectionGateways()
          : C.xlsxSectionTasks();
    if (element.interTriggerTimer !== undefined) {
      run(section, id, name, 'interTriggerTimer', describeDistribution(element.interTriggerTimer));
    }
    run(section, id, name, 'triggerCount', element.triggerCount ?? null);
    if (element.processingTime !== undefined) {
      run(section, id, name, 'processingTime', describeDistribution(element.processingTime));
    }
    if (element.resources !== undefined) {
      run(
        section,
        id,
        name,
        'resources',
        element.resources.map((entry) => `${entry.ref}×${entry.quantity}`).join(', '),
      );
    }
    run(section, id, name, 'selection', element.selection ?? null);
    run(section, id, name, 'fixedCost', element.fixedCost ?? null);
    run(section, id, name, 'calendar', element.calendar ?? null);
    run(section, id, name, 'probability', element.probability ?? null);
  }

  return {
    formats: [undefined, undefined, undefined, undefined, 'number'],
    headers: [C.xlsxColumnSection(), ID_COLUMN, NAME_COLUMN, C.xlsxColumnParameter(), C.xlsxColumnValue()],
    name: C.xlsxSheetParameters(),
    rows,
  };
}

/* ------------------------------------------------------------------ *
 * Workbooks
 * ------------------------------------------------------------------ */

/** The five sheets of a single run, in tab order. Exported so `compareWorkbook` reuses them. */
export function scenarioSheets(
  ir: ProcessIR,
  scenario: ResolvedScenario,
  result: RunResult,
  names: ResourceNames = {},
  locale: Locale = 'en',
): SheetSpec[] {
  const C = messages(locale).cli;
  const elements = elementsRows(ir, result);
  const flows = flowsRows(ir, result);
  const resources = resourcesRows(result, names);
  return [
    summarySheet(ir, scenario, result, names, locale),
    { formats: numericAfter(elements.headers, 3), headers: elements.headers, name: C.xlsxSheetElements(), rows: elements.rows },
    { formats: numericAfter(flows.headers, 4), headers: flows.headers, name: C.xlsxSheetFlows(), rows: flows.rows },
    { formats: numericAfter(resources.headers, 2), headers: resources.headers, name: C.xlsxSheetResources(), rows: resources.rows },
    parametersSheet(ir, scenario, locale),
  ];
}

/**
 * `'number'` for every column after the `leading` identity ones (`Id`, `Name`, `Type`, …), which
 * is the shape of the three tables that come from `csv.ts`: identifiers first, then nothing but
 * numbers. Formats only reach numeric cells, so a wrong guess here would be invisible anyway.
 */
function numericAfter(headers: readonly string[], leading: number): (CellFormat | undefined)[] {
  return headers.map((_, index) => (index < leading ? undefined : 'number'));
}

/**
 * Workbook of one run: `Summary`, `Elements`, `Flows`, `Resources`, `Parameters`.
 *
 * The event log is deliberately **not** a sheet: a run of a few million rows would blow past the
 * 1 048 576 rows a worksheet can hold and past any reasonable memory budget. `--csv` keeps writing
 * it in streaming, which is the export made for it (`docs/RESULTS_FORMAT.md` § 7).
 */
export function scenarioWorkbook(
  ir: ProcessIR,
  scenario: ResolvedScenario,
  result: RunResult,
  names: ResourceNames = {},
  locale: Locale = 'en',
): Uint8Array {
  return workbook(scenarioSheets(ir, scenario, result, names, locale));
}

/** One compared run: its resolved scenario and the result `compare()` received, in the same order. */
export interface CompareEntry {
  scenario: ResolvedScenario;
  result: RunResult;
}

/**
 * Workbook of a comparison: the `Summary` of every scenario (one tab each, named after the
 * scenario) plus a `Comparison` tab with the rows of `compare()` — value, 95 % CI and, for every
 * non-base scenario, absolute delta, relative delta and whether its interval overlaps the base's.
 *
 * `overlap = false` is what the CLI prints as `*`: no overlap means a significant difference
 * (`docs/RESULTS_FORMAT.md` § 11). Without replications there is no interval and the cell is empty,
 * never `false` — an absent interval is not evidence of overlap.
 */
export function compareWorkbook(
  ir: ProcessIR,
  entries: readonly CompareEntry[],
  comparison: CompareResult,
  locale: Locale = 'en',
): Uint8Array {
  const C = messages(locale).cli;
  const names: Record<string, string> = {};
  for (const entry of entries) {
    for (const [id, name] of Object.entries(resourceNamesOf(entry.scenario))) names[id] ??= name;
  }

  const summaries = entries.map((entry) => ({
    ...summarySheet(ir, entry.scenario, entry.result, names, locale),
    name: entry.scenario.name,
  }));

  const scenarioNames = entries.map((entry) => entry.scenario.name);
  const headers: string[] = ['Kpi', 'Scope', ID_COLUMN, NAME_COLUMN, METRIC_COLUMN];
  // The five identity columns hold text; each scenario then adds numbers. Relative deltas
  // always take percentages; service-level values and intervals override the defaults below.
  const formats: (CellFormat | undefined)[] = [undefined, undefined, undefined, undefined, undefined];
  const serviceLevelColumns: number[] = [];
  for (const [index, name] of scenarioNames.entries()) {
    serviceLevelColumns.push(headers.length, headers.length + 1, headers.length + 2);
    headers.push(name, C.xlsxCi95Low(name), C.xlsxCi95High(name));
    formats.push('number', 'number', 'number');
    if (index > 0) {
      headers.push(C.xlsxDelta(name), C.xlsxDeltaRelative(name), C.xlsxOverlap(name));
      formats.push('number', 'percent', undefined);
    }
  }

  // rowFormats replaces the entire row, so retain the delta and identity column formats.
  // Absolute deltas stay in fraction units (value - base), with the existing 0.### display:
  // small differences may still round visually. Relative deltas remain (value - base) / base
  // displayed as 0.00%. Neither stored delta changes (#367).
  const serviceLevelFormats = [...formats];
  for (const column of serviceLevelColumns) serviceLevelFormats[column] = 'percent';
  const rowFormats = comparison.rows.map((row) =>
    row.metric === 'withinServiceLevel' ||
    (row.metric.startsWith('byEndEvent.') && row.metric.endsWith('.withinServiceLevel'))
      ? serviceLevelFormats
      : undefined,
  );

  const ci95Of = (index: number, kpi: string): readonly [number, number] | undefined =>
    entries[index]?.result.replications?.kpis?.[kpi]?.ci95;

  const rows: CellValue[][] = comparison.rows.map((row) => {
    const cells: CellValue[] = [
      row.kpi,
      row.scope,
      row.id ?? '',
      row.id === null ? '' : (ir.nodes[row.id]?.name ?? ir.flows[row.id]?.name ?? names[row.id] ?? ''),
      columnLabel(row.scope, row.metric),
    ];
    for (let index = 0; index < entries.length; index++) {
      const ci95 = ci95Of(index, row.kpi);
      cells.push(row.values[index] ?? null, ci95?.[0] ?? null, ci95?.[1] ?? null);
      if (index === 0) continue;
      const baseCi95 = ci95Of(0, row.kpi);
      cells.push(
        row.deltaAbs[index] ?? null,
        row.deltaRel[index] ?? null,
        baseCi95 === undefined || ci95 === undefined ? null : !(row.significant[index] ?? false),
      );
    }
    return cells;
  });

  return workbook([...summaries, { formats, headers, name: C.xlsxSheetComparison(), rowFormats, rows }]);
}
