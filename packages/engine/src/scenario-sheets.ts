/**
 * Scenario parameters to and from a spreadsheet (issue #449).
 *
 * One sheet per table — `Elements`, `Arrivals`, `Resources`, `Assignments`, `Calendars` — with the
 * columns of `TABLE_COLUMNS`, specified in `docs/SCENARIO_SHEETS.md`. Two directions:
 *
 * - `scenarioTemplate` writes the workbook filled with the current scenario, so the person edits
 *   what is there instead of starting from a blank grid;
 * - `planScenarioImport` reads the sheets back and says **what would change**, without changing
 *   anything: the field-level changes, the rows that match nothing, the ambiguous names and the
 *   invalid values with their sheet, row and column. The caller shows that and only then applies
 *   the changes (`applyImportChanges`), which in the web is a delta on the scenario being edited.
 *
 * Rules that the rest follows from:
 *
 * 1. **An empty cell changes nothing.** The import fills in, it does not replace: a sheet with
 *    only the `mean` column filled touches the means and nothing else. That is also what makes
 *    the round trip exact — the template leaves empty what the scenario does not declare.
 * 2. **Rows are matched by BPMN id, else by BPMN name** (trimmed, spaces collapsed, case
 *    ignored). A name two elements share is ambiguous and the row is reported, never guessed.
 * 3. **A row applies whole or not at all.** One bad value and nothing of that row is applied; for
 *    the tables whose rows add up to one value (the assignments of an element, the intervals of a
 *    calendar), one bad row and the whole element or calendar keeps what it had.
 * 4. **Values are checked with the scenario schema itself** (`parseScenario`), so the reasons are
 *    the ones the CLI and the panel give, in the same language. What the schema cannot see — a
 *    reference to a calendar that does not exist, an unknown distribution name — is checked here.
 * 5. Times are written in the row's `unit` (`s`, `min`, `h`, `day`; empty = `run.baseTimeUnit`),
 *    exactly the parameters the panel scales (`value`, `min`, `mode`, `max`, `mean`, `sd` and the
 *    values of a `user` distribution) and stored in seconds, as the scenario always is.
 */

import type { ProcessIR } from './core/ir.js';
import type { Locale } from './messages/index.js';
import { sheetMessages, type SheetMessages } from './messages/sheets.js';
import { parseScenario, validateScenario, WEEKDAYS } from './scenario.js';
import { describeDistribution } from './xlsx-report.js';
import { workbook, type CellValue, type SheetSpec } from './xlsx.js';
import { decodeCsvBytes, readCsv, readWorkbook, type ReadCell, type ReadSheet } from './xlsx-read.js';

export { XLSX_MIME_TYPE } from './xlsx.js';
export { WorkbookReadError, readCsv, readWorkbook, type ReadCell, type ReadSheet } from './xlsx-read.js';

/* ------------------------------------------------------------------ *
 * The tables
 * ------------------------------------------------------------------ */

export type TableId = 'elements' | 'arrivals' | 'resources' | 'assignments' | 'calendars';

/** Distribution parameters with a column of their own, in the order of § 3. */
const PARAMETERS = ['value', 'min', 'mode', 'max', 'mean', 'sd', 'shape', 'scale', 'k', 'alpha', 'beta', 'n', 'p'] as const;

/** The same set the panel scales by `baseTimeUnit` (`scenarioFields.ts::PARAMETROS_DE_TIEMPO`). */
const TIME_PARAMETERS = new Set<string>(['value', 'min', 'mode', 'max', 'mean', 'sd']);

/** Parameters of each distribution (§ 3). `user` takes its points from the `points` column. */
const DISTRIBUTIONS: Readonly<Record<string, readonly string[]>> = {
  constant: ['value'],
  uniform: ['min', 'max'],
  triangular: ['min', 'mode', 'max'],
  exponential: ['mean'],
  normal: ['mean', 'sd'],
  truncatedNormal: ['mean', 'sd', 'min', 'max'],
  lognormal: ['mean', 'sd'],
  gamma: ['shape', 'scale'],
  erlang: ['k', 'mean'],
  weibull: ['shape', 'scale'],
  beta: ['alpha', 'beta', 'min', 'max'],
  poisson: ['mean'],
  binomial: ['n', 'p'],
  user: ['points'],
};

/** Spanish and Bizagi spellings of the distribution names, keyed by `normalized()`. */
const DISTRIBUTION_ALIASES: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.keys(DISTRIBUTIONS).map((type) => [normalized(type), type])),
  constante: 'constant',
  fixed: 'constant',
  fijo: 'constant',
  fija: 'constant',
  uniforme: 'uniform',
  exponencial: 'exponential',
  normaltruncada: 'truncatedNormal',
  usuario: 'user',
  empirical: 'user',
  empirica: 'user',
};

const DISTRIBUTION_COLUMNS = ['distribution', 'unit', ...PARAMETERS, 'points'] as const;

/** Columns of each table, in the order the template writes them. */
export const TABLE_COLUMNS: Readonly<Record<TableId, readonly string[]>> = {
  elements: ['id', 'name', 'kind', ...DISTRIBUTION_COLUMNS, 'fixedCost', 'calendar', 'probability', 'selection'],
  arrivals: ['id', 'name', ...DISTRIBUTION_COLUMNS, 'triggerCount', 'fixedCost', 'calendar'],
  resources: ['id', 'name', 'type', 'capacity', 'costPerHour', 'fixedCost', 'calendar'],
  assignments: ['elementId', 'elementName', 'resourceId', 'resourceName', 'quantity'],
  calendars: ['id', 'days', 'from', 'to'],
};

/** Tab name of each table in the template. Untranslated, like every column name of the project. */
export const TABLE_SHEETS: Readonly<Record<TableId, string>> = {
  elements: 'Elements',
  arrivals: 'Arrivals',
  resources: 'Resources',
  assignments: 'Assignments',
  calendars: 'Calendars',
};

/**
 * Sheet and file names of each table, English and Spanish. The order matters for a name that only
 * *contains* one of them: `asignaciones-recursos.csv` is the assignments, not the resources.
 */
const TABLE_ALIASES: Readonly<Record<string, TableId>> = {
  assignments: 'assignments',
  asignaciones: 'assignments',
  arrivals: 'arrivals',
  llegadas: 'arrivals',
  calendars: 'calendars',
  calendarios: 'calendars',
  resources: 'resources',
  recursos: 'resources',
  elements: 'elements',
  elementos: 'elements',
};

/** Order the tables are applied in: a calendar or pool created by the file can then be referenced. */
const APPLY_ORDER: readonly TableId[] = ['calendars', 'resources', 'elements', 'arrivals', 'assignments'];

const UNITS: Readonly<Record<string, number>> = { s: 1, min: 60, h: 3600, day: 86_400 };
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  s: 's', sec: 's', secs: 's', second: 's', seconds: 's', seg: 's', segundo: 's', segundos: 's',
  min: 'min', mins: 'min', minute: 'min', minutes: 'min', minuto: 'min', minutos: 'min', m: 'min',
  h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h', hora: 'h', horas: 'h',
  d: 'day', day: 'day', days: 'day', dia: 'day', dias: 'day',
};

/**
 * Day names the Calendars sheet accepts, exactly (accents and case aside): the abbreviations and
 * the full names in English and Spanish. Never a prefix, so «Monkey» or «Marzo» are not days.
 */
const DAY_NAMES: Readonly<Record<string, string>> = {
  MON: 'MON', TUE: 'TUE', WED: 'WED', THU: 'THU', FRI: 'FRI', SAT: 'SAT', SUN: 'SUN',
  MONDAY: 'MON', TUESDAY: 'TUE', WEDNESDAY: 'WED', THURSDAY: 'THU', FRIDAY: 'FRI', SATURDAY: 'SAT', SUNDAY: 'SUN',
  LUN: 'MON', MAR: 'TUE', MIE: 'WED', JUE: 'THU', VIE: 'FRI', SAB: 'SAT', DOM: 'SUN',
  LUNES: 'MON', MARTES: 'TUE', MIERCOLES: 'WED', JUEVES: 'THU', VIERNES: 'FRI', SABADO: 'SAT', DOMINGO: 'SUN',
};

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** `Fixed cost (MXN)` → `fixedcost`: lower case, no accents, no parenthesis, letters and digits. */
function normalized(text: string): string {
  return text
    .replace(/\([^)]*\)/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** How names are compared (rule 2): trimmed, inner spaces collapsed, case ignored. */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function cellText(cell: ReadCell | undefined): string {
  if (cell === null || cell === undefined) return '';
  return typeof cell === 'string' ? cell.trim() : String(cell);
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function toSeconds(value: number, factor: number): number {
  return factor === 1 ? value : round6(value * factor);
}

function fromSeconds(seconds: number, factor: number): number {
  return factor === 1 ? seconds : round6(seconds / factor);
}

/**
 * How a file writes numbers as text. `comma`: `,` decimals and `.` thousands, what a Spanish Excel
 * writes (and why its CSV uses `;`). `dot`: `.` decimals and `,` thousands. It comes from the CSV's
 * delimiter, or from the language of the app for text cells of a workbook (numeric cells are
 * numbers and need none).
 */
export type NumberStyle = 'comma' | 'dot';

/**
 * A number out of a cell: a numeric cell as it is; text in `style`, with thousands separators
 * (`1.234.567` / `1,234,567`) and a percentage (`78%` → `0.78`). A separator that is not the
 * decimal one must group digits by three, so `1.5` in a `comma` file is not a number rather than
 * a guess. `NaN` when the text is not a finite number, `null` when the cell is empty.
 */
export function parseNumber(cell: ReadCell | undefined, style: NumberStyle = 'dot'): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : Number.NaN;
  if (typeof cell === 'boolean') return Number.NaN;
  let text = cell.replace(/[\s\u00A0\u202F]/g, '').replace(/^'/, '');
  if (text === '') return null;
  const percent = text.endsWith('%');
  if (percent) text = text.slice(0, -1);
  const [decimal, group] = style === 'comma' ? [',', '.'] : ['.', ','];
  if (text.includes(group)) {
    // A first group of `0` (`0,375`) is never thousands: it is a decimal in the other convention.
    const grouped = new RegExp(`^[-+]?[1-9]\\d{0,2}(\\${group}\\d{3})+(\\${decimal}\\d*)?$`);
    if (!grouped.test(text)) return Number.NaN;
    text = text.split(group).join('');
  }
  if (text.indexOf(decimal) !== text.lastIndexOf(decimal)) return Number.NaN;
  text = text.replace(decimal, '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return Number.NaN;
  const value = Number(text) / (percent ? 100 : 1);
  return Number.isFinite(value) ? value : Number.NaN;
}

/** `1.500` or `1,500` in a text cell of a workbook: thousands or decimals, depending on who wrote it. */
const AMBIGUOUS_NUMBER = /^[-+]?\d{1,3}[.,]\d{3}$/;

/**
 * Keys the file may not name: on a plain object they reach `Object.prototype` instead of an own
 * property. A row whose id is one of them is an error; every other lookup goes through `own`.
 */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isReservedKey(key: string): boolean {
  return RESERVED_KEYS.has(key);
}

/** `record[key]` only when it is an own property: `own({}, 'toString')` is `undefined`. */
function own<T>(record: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, key) ? record[key] : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality of two JSON values; key order does not matter. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keysA = Object.keys(a).filter((key) => a[key] !== undefined);
  const keysB = Object.keys(b).filter((key) => b[key] !== undefined);
  return keysA.length === keysB.length && keysA.every((key) => sameValue(a[key], b[key]));
}

function writePath(root: Record<string, unknown>, path: readonly string[], value: unknown): void {
  // Defence in depth: the planner rejects these ids per row, so reaching here is a bug.
  if (path.some(isReservedKey)) throw new Error(`reserved key in ${path.join('.')}`);
  let current = root;
  for (const segment of path.slice(0, -1)) {
    if (!isObject(own(current, segment))) current[segment] = {};
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function section(scenario: Record<string, unknown>, key: string): Record<string, Record<string, unknown>> {
  const value = own(scenario, key);
  return isObject(value) ? (value as Record<string, Record<string, unknown>>) : {};
}

/* ------------------------------------------------------------------ *
 * Readable values, for the report
 * ------------------------------------------------------------------ */

/** A value of the scenario the way the import report shows it. `—` for nothing. */
export interface DescribeOptions {
  /** Time unit to show a distribution in, the one its row was written in (`ImportChange.unit`). */
  unit?: string | undefined;
  locale?: Locale | undefined;
}

/**
 * A value of the scenario the way the import report shows it: `—` for nothing, `none` for an
 * empty list (a task left without pools), and a distribution in the unit of its row, so the
 * person reads `mean=3 min` where they typed 3 rather than the 180 seconds it is stored as.
 */
export function describeImportValue(value: unknown, options: DescribeOptions = {}): string {
  if (value === undefined || value === null) return '—';
  if (isObject(value) && typeof value['type'] === 'string') {
    const unit = options.unit !== undefined && Object.hasOwn(UNITS, options.unit) ? options.unit : undefined;
    if (unit === undefined) return describeDistribution(value as Parameters<typeof describeDistribution>[0]);
    const factor = UNITS[unit]!;
    const scaled: Record<string, unknown> = { ...value };
    for (const parameter of TIME_PARAMETERS) {
      if (typeof scaled[parameter] === 'number') scaled[parameter] = fromSeconds(scaled[parameter], factor);
    }
    if (Array.isArray(scaled['points'])) {
      scaled['points'] = (scaled['points'] as Record<string, unknown>[]).map((point) =>
        typeof point['value'] === 'number' ? { ...point, value: fromSeconds(point['value'], factor) } : point,
      );
    }
    return `${describeDistribution(scaled as Parameters<typeof describeDistribution>[0])} ${unit}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return sheetMessages(options.locale ?? 'en').none();
    return value
      .map((item) => {
        if (!isObject(item)) return String(item);
        if (typeof item['ref'] === 'string') return `${item['ref']}×${String(item['quantity'] ?? 1)}`;
        if (Array.isArray(item['days'])) return `${(item['days'] as string[]).join(',')} ${String(item['from'])}-${String(item['to'])}`;
        if (typeof item['calendar'] === 'string') return `${item['calendar']}:${String(item['capacity'])}`;
        return JSON.stringify(item);
      })
      .join('; ');
  }
  if (isObject(value)) return JSON.stringify(value);
  return String(value);
}

/* ------------------------------------------------------------------ *
 * Template
 * ------------------------------------------------------------------ */

function baseFactor(scenario: Record<string, unknown>): { unit: string; factor: number } {
  const run = scenario['run'];
  const unit = isObject(run) && typeof run['baseTimeUnit'] === 'string' && Object.hasOwn(UNITS, run['baseTimeUnit']) ? run['baseTimeUnit'] : 's';
  return { unit, factor: UNITS[unit]! };
}

/** `distribution`, `unit`, the parameters and `points` of one distribution, or empty cells. */
function distributionCells(distribution: unknown, scenario: Record<string, unknown>): CellValue[] {
  const cells: CellValue[] = DISTRIBUTION_COLUMNS.map(() => null);
  if (!isObject(distribution) || typeof distribution['type'] !== 'string') return cells;
  const base = baseFactor(scenario);
  const points = Array.isArray(distribution['points']) ? (distribution['points'] as Record<string, unknown>[]) : [];
  const times = [
    ...PARAMETERS.filter((p) => TIME_PARAMETERS.has(p) && typeof distribution[p] === 'number').map((p) => distribution[p] as number),
    ...points.map((point) => point['value']).filter((v): v is number => typeof v === 'number'),
  ];
  // The base unit only when every time survives the trip back exactly; otherwise seconds, so the
  // round trip of rule 1 never changes a value by the last decimal.
  const exact = times.every((seconds) => toSeconds(fromSeconds(seconds, base.factor), base.factor) === seconds);
  const { unit, factor } = exact ? base : { unit: 's', factor: 1 };
  cells[0] = distribution['type'];
  cells[1] = unit;
  PARAMETERS.forEach((parameter, index) => {
    const value = distribution[parameter];
    if (typeof value === 'number') cells[2 + index] = TIME_PARAMETERS.has(parameter) ? fromSeconds(value, factor) : value;
  });
  if (points.length > 0) {
    cells[DISTRIBUTION_COLUMNS.length - 1] = points
      .map((point) => `${typeof point['value'] === 'number' ? fromSeconds(point['value'], factor) : String(point['value'])}:${String(point['probability'])}`)
      .join('; ');
  }
  return cells;
}

function optional(value: unknown): CellValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null;
}

/**
 * Whether the Calendars sheet can express a calendar: weekly intervals only (`days`, `from`, `to`
 * and nothing else) and no `holidays`. The dated selectors of #82 (`monthDays`, `monthWeekdays`,
 * `dates`) and the holidays are not in the sheet, so such a calendar is left out of the template
 * and left untouched by the import, whole, with a note.
 */
function isWeekly(calendar: Record<string, unknown>): boolean {
  const intervals = calendar['intervals'];
  const holidays = calendar['holidays'];
  if (Array.isArray(holidays) ? holidays.length > 0 : holidays !== undefined && holidays !== null) return false;
  return (
    !Array.isArray(intervals) ||
    intervals.every(
      (interval) =>
        isObject(interval) &&
        Array.isArray(interval['days']) &&
        Object.keys(interval).every((key) => key === 'days' || key === 'from' || key === 'to'),
    )
  );
}

/**
 * The five sheets filled with `scenario` (the **resolved** one: what the person sees in the panel).
 * Elements are listed from the diagram, so an element without parameters still gets its row.
 */
export function templateSheets(scenario: Record<string, unknown>, ir: ProcessIR): SheetSpec[] {
  const elements = section(scenario, 'elements');
  const resources = section(scenario, 'resources');
  const calendars = section(scenario, 'calendars');
  const nameOf = (id: string): string => own(ir.nodes, id)?.name ?? own(ir.flows, id)?.name ?? '';

  const elementIds = [
    ...Object.entries(ir.nodes)
      .filter(([id, node]) => node.type !== 'start' && (['task', 'timer', 'end', 'terminate'].includes(node.type) || id in elements))
      .map(([id]) => id),
    ...Object.entries(ir.flows)
      .filter(([id, flow]) => {
        const from = own(ir.nodes, flow.from)?.type;
        return from === 'xor' || from === 'or' || id in elements;
      })
      .map(([id]) => id),
  ];
  const elementRows = elementIds.map((id) => {
    const element = own(elements, id) ?? {};
    return [
      id,
      nameOf(id),
      own(ir.nodes, id)?.type ?? 'flow',
      ...distributionCells(element['processingTime'], scenario),
      optional(element['fixedCost']),
      optional(element['calendar']),
      optional(element['probability']),
      optional(element['selection']),
    ];
  });

  const startIds = Object.entries(ir.nodes)
    .filter(([, node]) => node.type === 'start')
    .map(([id]) => id);
  const arrivalRows = startIds.map((id) => {
    const element = own(elements, id) ?? {};
    return [
      id,
      nameOf(id),
      ...distributionCells(element['interTriggerTimer'], scenario),
      optional(element['triggerCount']),
      optional(element['fixedCost']),
      optional(element['calendar']),
    ];
  });

  const resourceRows = Object.entries(resources).map(([id, resource]) => [
    id,
    optional(resource['name']),
    optional(resource['type']),
    Array.isArray(resource['capacity'])
      ? (resource['capacity'] as Record<string, unknown>[]).map((slice) => `${String(slice['calendar'])}:${String(slice['capacity'])}`).join('; ')
      : optional(resource['capacity']),
    optional(resource['costPerHour']),
    optional(resource['fixedCost']),
    optional(resource['calendar']),
  ]);

  const assignmentRows: CellValue[][] = [];
  for (const [id, element] of Object.entries(elements)) {
    if (!Array.isArray(element['resources'])) continue;
    for (const entry of element['resources'] as Record<string, unknown>[]) {
      const ref = String(entry['ref']);
      assignmentRows.push([id, nameOf(id), ref, optional(own(resources, ref)?.['name']), optional(entry['quantity'])]);
    }
  }

  const calendarRows: CellValue[][] = [];
  for (const [id, calendar] of Object.entries(calendars)) {
    if (!isWeekly(calendar) || !Array.isArray(calendar['intervals'])) continue;
    for (const interval of calendar['intervals'] as Record<string, unknown>[]) {
      calendarRows.push([id, (interval['days'] as string[]).join(','), optional(interval['from']), optional(interval['to'])]);
    }
  }

  const rowsOf: Record<TableId, CellValue[][]> = {
    elements: elementRows,
    arrivals: arrivalRows,
    resources: resourceRows,
    assignments: assignmentRows,
    calendars: calendarRows,
  };
  return (Object.keys(TABLE_SHEETS) as TableId[]).map((table) => ({
    name: TABLE_SHEETS[table],
    headers: TABLE_COLUMNS[table],
    rows: rowsOf[table],
  }));
}

/** The template as `.xlsx` bytes («Download template»). */
export function scenarioTemplate(scenario: Record<string, unknown>, ir: ProcessIR): Uint8Array {
  return workbook(templateSheets(scenario, ir));
}

/* ------------------------------------------------------------------ *
 * Reading a file
 * ------------------------------------------------------------------ */

/**
 * The tables of a file the person picked: every sheet of an `.xlsx`, or the one table of a CSV
 * (`.csv`, `.tsv`, `.txt`), named after the file so a `recursos.csv` is read as the Resources sheet.
 */
export function readScenarioFile(fileName: string, bytes: Uint8Array): ReadSheet[] {
  if (/\.(csv|tsv|txt)$/i.test(fileName)) {
    const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
    return [readCsv(decodeCsvBytes(bytes), base)];
  }
  return readWorkbook(bytes);
}

/* ------------------------------------------------------------------ *
 * The import plan
 * ------------------------------------------------------------------ */

/** One field that the import would set. `path` is a path of the scenario, no array indexes. */
export interface ImportChange {
  table: TableId;
  sheet: string;
  /** Spreadsheet row (the header is row 1). */
  row: number;
  path: readonly string[];
  /** What the row is about, for the report: `Take order (Task_1)`, `cajero`… */
  target: string;
  /** The field that changes, relative to the target; `''` when the whole entry is new. */
  field: string;
  before: unknown;
  after: unknown;
  /** For a distribution: the time unit its row was written in, to show it that way. */
  unit?: string;
}

/**
 * `lint`: an error of the scenario the import would produce that the current one does not have
 * (`validateScenario`, or the schema): a probability on a task, a pool with slices and a calendar…
 * The caller must not apply a plan that has any.
 */
export type ImportIssueKind = 'error' | 'unmatched' | 'ambiguous' | 'warning' | 'lint';

export interface ImportIssue {
  kind: ImportIssueKind;
  sheet: string;
  row: number;
  /** The column as written in the file; absent when the issue is about the whole row. */
  column?: string;
  message: string;
  /** `where: message`, ready to print. */
  text: string;
}

export interface ImportPlan {
  changes: ImportChange[];
  issues: ImportIssue[];
  /** The sheets that were read as a table, with how many data rows each had. */
  tables: { table: TableId; sheet: string; rows: number }[];
}

export interface ImportOptions {
  locale?: Locale;
}

interface Table {
  table: TableId;
  sheet: string;
  /** Canonical column → index in the row. */
  columns: Map<string, number>;
  /** Canonical column → header as written. */
  headers: Map<string, string>;
  /** Data rows with their spreadsheet row number. */
  rows: { row: number; cells: ReadCell[] }[];
  /** How text numbers are written in this sheet. */
  style: NumberStyle;
  /** A CSV decides its style by its delimiter; a workbook's text cells are a guess worth a note. */
  csv: boolean;
}

/** Which table a sheet is: by its name, then by the columns it has. */
function tableOf(name: string, headers: ReadonlySet<string>): TableId | null {
  const key = normalized(name);
  const exact = own(TABLE_ALIASES, key);
  if (exact !== undefined) return exact;
  for (const [alias, table] of Object.entries(TABLE_ALIASES)) if (key.includes(alias)) return table;
  if (headers.has('days')) return 'calendars';
  if (headers.has('resourceid') || headers.has('resourcename')) return 'assignments';
  if (headers.has('capacity') || headers.has('costperhour')) return 'resources';
  if (headers.has('triggercount')) return 'arrivals';
  if (['distribution', 'probability', 'selection', 'fixedcost'].some((h) => headers.has(h))) return 'elements';
  return null;
}

/** Plans the import of `sheets` into `scenario` (resolved) against the diagram `ir`. Pure. */
export function planScenarioImport(
  sheets: readonly ReadSheet[],
  scenario: Record<string, unknown>,
  ir: ProcessIR,
  options: ImportOptions = {},
): ImportPlan {
  const locale = options.locale ?? 'en';
  const M = sheetMessages(locale);
  const next = clone(scenario);
  const changes: ImportChange[] = [];
  const issues: ImportIssue[] = [];
  const tables: Table[] = [];

  const issue = (kind: ImportIssueKind, sheet: string, row: number, column: string | undefined, message: string): void => {
    issues.push({
      kind,
      sheet,
      row,
      ...(column === undefined ? {} : { column }),
      message,
      text: `${M.where(sheet, row, column)}: ${message}`,
    });
  };

  for (const sheet of sheets) {
    // A hidden tab is data the person cannot see in the file: never applied, always said.
    if (sheet.hidden === true) {
      issue('warning', sheet.name, 1, undefined, M.hiddenSheet(sheet.name));
      continue;
    }
    const headerIndex = sheet.rows.findIndex((row) => row.some((cell) => cellText(cell) !== ''));
    if (headerIndex === -1) continue;
    const header = sheet.rows[headerIndex]!;
    const normalizedHeaders = new Set(header.map((cell) => normalized(cellText(cell))));
    const table = tableOf(sheet.name, normalizedHeaders);
    if (table === null) {
      issue('warning', sheet.name, headerIndex + 1, undefined, M.unknownTable(sheet.name, Object.values(TABLE_SHEETS).join(', ')));
      continue;
    }
    const known = new Map(TABLE_COLUMNS[table].map((column) => [normalized(column), column]));
    const columns = new Map<string, number>();
    const headers = new Map<string, string>();
    header.forEach((cell, index) => {
      const text = cellText(cell);
      if (text === '') return;
      const column = known.get(normalized(text));
      if (column === undefined || columns.has(column)) {
        issue('warning', sheet.name, headerIndex + 1, text, M.unknownColumn(text));
        return;
      }
      columns.set(column, index);
      headers.set(column, text);
    });
    const keys: readonly (readonly string[])[] =
      table === 'assignments'
        ? [['elementId', 'elementName'], ['resourceId', 'resourceName']]
        : table === 'calendars'
          ? [['id']]
          : [['id', 'name']];
    const missing = keys.find((group) => !group.some((column) => columns.has(column)));
    if (missing !== undefined) {
      issue('warning', sheet.name, headerIndex + 1, undefined, M.missingKeyColumn(missing.join(' / ')));
      continue;
    }
    const rows = sheet.rows
      .map((cells, index) => ({ row: index + 1, cells }))
      .slice(headerIndex + 1)
      .filter(({ cells }) => [...columns.values()].some((index) => cellText(cells[index]) !== ''));
    for (const formula of sheet.uncached ?? []) {
      const column = [...columns].find(([, index]) => index === formula.column)?.[0];
      if (column !== undefined && formula.row > headerIndex + 1) {
        issue('warning', sheet.name, formula.row, headers.get(column), M.uncachedFormula());
      }
    }
    const csv = sheet.delimiter !== undefined;
    // `;` means decimal comma and `,` decimal dot; a tab says nothing (Excel's «Unicode Text» is
    // tab-separated in every language), so a tab file follows the app like a workbook does.
    const byLocale: NumberStyle = locale === 'es' ? 'comma' : 'dot';
    const style: NumberStyle = sheet.delimiter === ';' ? 'comma' : sheet.delimiter === ',' ? 'dot' : byLocale;
    tables.push({ table, sheet: sheet.name, columns, headers, rows, style, csv });
  }

  const context: Context = { M, ir, next, changes, issue, locale };
  for (const table of APPLY_ORDER) {
    const seen: Seen = new Map();
    for (const t of tables.filter((candidate) => candidate.table === table)) {
      switch (table) {
        case 'calendars':
          planCalendars(context, t);
          break;
        case 'resources':
          planResources(context, t, seen);
          break;
        case 'elements':
        case 'arrivals':
          planElements(context, t, seen);
          break;
        case 'assignments':
          planAssignments(context, t);
          break;
      }
    }
  }

  // The rows are valid one by one; this is what they make together (nit 5 of the QA of #514).
  // Only a new error that a row of the file caused blocks: one the scenario already had (however
  // the file reorders a list) is not the file's doing, and when the scenario did not even pass the
  // schema its deeper rules were never checked, so whatever they find now is shown, not blocking.
  if (changes.length > 0) {
    const before = errorsOf(scenario, ir, locale);
    const after = errorsOf(next, ir, locale);
    const known = new Set(before.list.map((problem) => problem.key));
    for (const problem of after.list) {
      if (known.has(problem.key)) continue;
      const change = changeFor(problem.path, changes);
      const blocking = change !== undefined && !(before.schemaFailed && problem.stage === 'rules');
      const readable = `${subjectOf(ir, problem.path)}: ${problem.message}`;
      issues.push({
        kind: blocking ? 'lint' : 'warning',
        sheet: change?.sheet ?? '',
        row: change?.row ?? 0,
        message: readable,
        text: change === undefined ? readable : `${M.where(change.sheet, change.row, undefined)}: ${readable}`,
      });
    }
  }

  return {
    changes,
    issues,
    tables: tables.map((t) => ({ table: t.table, sheet: t.sheet, rows: t.rows.length })),
  };
}

interface KeyedError {
  /** Code and path without array indexes: the same defect after sorting a list is the same key. */
  key: string;
  path: string;
  /** The message without the technical path in front, which the report replaces by a name. */
  message: string;
  stage: 'schema' | 'rules';
}

/** `elements.T.resources[1].quantity` → `elements.T.resources.quantity`. */
function withoutIndexes(path: string): string {
  return path.replace(/\[\d+\]/g, '').replace(/\.\d+(?=\.|$)/g, '');
}

/** `elements.T.probability: must be…` → `must be…`: the report says the element by its name. */
function withoutPath(message: string, path: string): string {
  for (const prefix of [path, withoutIndexes(path)]) {
    if (message.startsWith(`${prefix}: `)) return message.slice(prefix.length + 2);
  }
  return message;
}

/** Errors of a raw scenario: the schema's when it does not pass, `validateScenario`'s otherwise. */
function errorsOf(raw: Record<string, unknown>, ir: ProcessIR, locale: Locale): { schemaFailed: boolean; list: KeyedError[] } {
  const parsed = parseScenario(raw, { locale });
  if (!parsed.success) {
    return {
      schemaFailed: true,
      list: parsed.error.issues.map((issue) => {
        const path = issue.path.map(String).join('.');
        return { key: `schema|${withoutIndexes(path)}|${issue.code}`, path, message: issue.message, stage: 'schema' as const };
      }),
    };
  }
  return {
    schemaFailed: false,
    list: validateScenario(parsed.data, ir, { locale })
      .filter((problem) => problem.severity === 'error')
      .map((problem) => ({
        key: `${problem.code}|${withoutIndexes(problem.path)}`,
        path: problem.path,
        message: withoutPath(problem.message, problem.path),
        stage: 'rules' as const,
      })),
  };
}

/** What a problem path is about, by name: `Prepare food (Task_Preparar) · probability`. */
function subjectOf(ir: ProcessIR, path: string): string {
  const [section, id, ...rest] = withoutIndexes(path).split('.');
  if (id === undefined) return path;
  const who = section === 'elements' ? elementLabel(ir, id) : id;
  return rest.length === 0 ? who : `${who} · ${rest.join('.')}`;
}

/** The change a problem path points at: the one whose path is its longest prefix, or below it. */
function changeFor(path: string, changes: readonly ImportChange[]): ImportChange | undefined {
  let best: ImportChange | undefined;
  for (const change of changes) {
    const own = change.path.join('.');
    const covers = path === own || path.startsWith(`${own}.`) || path.startsWith(`${own}[`);
    if (covers && (best === undefined || own.length > best.path.join('.').length)) best = change;
  }
  return best ?? changes.find((change) => change.path.join('.').startsWith(`${path}.`));
}

/** The changes applied to a copy of `scenario`: the scenario the import produces. */
export function applyImportChanges(
  scenario: Record<string, unknown>,
  changes: readonly ImportChange[],
): Record<string, unknown> {
  const result = clone(scenario);
  for (const change of changes) writePath(result, change.path, clone(change.after));
  return result;
}

/* ------------------------------------------------------------------ *
 * Planning, table by table
 * ------------------------------------------------------------------ */

interface Context {
  M: SheetMessages;
  ir: ProcessIR;
  /** The scenario with every change planned so far: later tables see earlier ones. */
  next: Record<string, unknown>;
  changes: ImportChange[];
  issue: (kind: ImportIssueKind, sheet: string, row: number, column: string | undefined, message: string) => void;
  locale: Locale;
}

/**
 * Errors of one row, collected so the row applies whole or not at all (rule 3), plus notes that do
 * not stop it (an ambiguous number, seconds dropped from a time).
 */
interface RowErrors {
  list: { column: string; message: string }[];
  notes: { column: string; message: string }[];
  add(column: string, message: string): void;
  note(column: string, message: string): void;
}

function rowErrors(): RowErrors {
  const list: { column: string; message: string }[] = [];
  const notes: { column: string; message: string }[] = [];
  return {
    list,
    notes,
    add: (column, message) => list.push({ column, message }),
    note: (column, message) => notes.push({ column, message }),
  };
}

/**
 * The number in `raw` read with the sheet's style: `null` when empty, `undefined` when it is not a
 * number (the error is already in `errors`). An ambiguous text number in a workbook gets a note.
 */
function readNumber(t: Table, raw: ReadCell, column: string, errors: RowErrors, M: SheetMessages): number | null | undefined {
  const value = parseNumber(raw, t.style);
  if (value === null) return null;
  const written = cellText(raw);
  if (Number.isNaN(value)) {
    errors.add(column, typeof raw === 'string' ? M.notANumberIn(written, t.style === 'comma' ? ',' : '.', t.style === 'comma' ? '.' : ',') : M.notANumber(written));
    return undefined;
  }
  if (!t.csv && typeof raw === 'string' && AMBIGUOUS_NUMBER.test(written.replace(/\s/g, ''))) {
    errors.note(column, M.ambiguousNumber(written, value));
  }
  return value;
}

function cell(t: Table, cells: readonly ReadCell[], column: string): ReadCell {
  const index = t.columns.get(column);
  return index === undefined ? null : (cells[index] ?? null);
}

function text(t: Table, cells: readonly ReadCell[], column: string): string {
  return cellText(cell(t, cells, column));
}

function header(t: Table, column: string): string {
  return t.headers.get(column) ?? column;
}

function flush(context: Context, t: Table, row: number, errors: RowErrors): boolean {
  for (const note of errors.notes) context.issue('warning', t.sheet, row, header(t, note.column), note.message);
  errors.notes.length = 0;
  for (const error of errors.list) context.issue('error', t.sheet, row, header(t, error.column), error.message);
  return errors.list.length === 0;
}

function commit(context: Context, planned: ImportChange[]): void {
  for (const change of planned) {
    writePath(context.next, change.path, clone(change.after));
    context.changes.push(change);
  }
}

/** An id the file may not use as a key (`__proto__`…): reported as a row error, `true`. */
function rejectReserved(context: Context, t: Table, row: number, column: string, id: string): boolean {
  if (!isReservedKey(id)) return false;
  context.issue('error', t.sheet, row, header(t, column), context.M.reservedId(id));
  return true;
}

/** Where each key of a table was first set, across the sheets of that table. */
type Seen = Map<string, { sheet: string; row: number }>;

/** Matching result: an id, or the reason there is none (already reported). */
type Match = { id: string } | null;

/** Element by id, else by BPMN name (rule 2). */
function matchElement(context: Context, t: Table, row: number, id: string, name: string, idColumn: string, nameColumn: string): Match {
  const { ir, M } = context;
  if (id !== '') {
    if (rejectReserved(context, t, row, idColumn, id)) return null;
    if (Object.hasOwn(ir.nodes, id) || Object.hasOwn(ir.flows, id)) return { id };
    const sanitized = Object.entries(ir.source.originalIds).find(([, original]) => original === id)?.[0];
    if (sanitized !== undefined) return { id: sanitized };
    context.issue('unmatched', t.sheet, row, header(t, idColumn), M.notFound(id));
    return null;
  }
  const key = nameKey(name);
  const candidates = [...Object.entries(ir.nodes), ...Object.entries(ir.flows)]
    .filter(([, item]) => nameKey(item.name) === key)
    .map(([candidate]) => candidate);
  if (candidates.length === 1) return { id: candidates[0]! };
  if (candidates.length === 0) context.issue('unmatched', t.sheet, row, header(t, nameColumn), M.notFound(name));
  else context.issue('ambiguous', t.sheet, row, header(t, nameColumn), M.ambiguous(name, candidates.join(', ')));
  return null;
}

/** Pool by id, else by its `name` (or its id when it has none). */
function matchResource(context: Context, t: Table, row: number, name: string, nameColumn: string): Match {
  const key = nameKey(name);
  const candidates = Object.entries(section(context.next, 'resources'))
    .filter(([id, resource]) => nameKey(typeof resource['name'] === 'string' ? resource['name'] : id) === key)
    .map(([id]) => id);
  if (candidates.length === 1) return { id: candidates[0]! };
  if (candidates.length === 0) context.issue('unmatched', t.sheet, row, header(t, nameColumn), context.M.notFound(name));
  else context.issue('ambiguous', t.sheet, row, header(t, nameColumn), context.M.ambiguous(name, candidates.join(', ')));
  return null;
}

function elementLabel(ir: ProcessIR, id: string): string {
  const name = own(ir.nodes, id)?.name ?? own(ir.flows, id)?.name ?? '';
  return name.trim() === '' ? id : `${name} (${id})`;
}

/** A number ≥ 0 (`integer`: a whole number ≥ 1). `undefined` when the cell is empty or wrong. */
function numberField(
  t: Table,
  cells: readonly ReadCell[],
  column: string,
  errors: RowErrors,
  M: SheetMessages,
  kind: 'nonNegative' | 'integer' | 'probability',
): number | undefined {
  const raw = cell(t, cells, column);
  const value = readNumber(t, raw, column, errors, M);
  if (value === null || value === undefined) return undefined;
  if (kind === 'integer' && !Number.isInteger(value)) {
    errors.add(column, M.notAWholeNumber(cellText(raw)));
    return undefined;
  }
  if (kind === 'integer' && value < 1) {
    errors.add(column, M.atLeastOne());
    return undefined;
  }
  if (kind === 'nonNegative' && value < 0) {
    errors.add(column, M.nonNegative());
    return undefined;
  }
  if (kind === 'probability' && (value < 0 || value > 1)) {
    errors.add(column, M.probabilityRange());
    return undefined;
  }
  return value;
}

function calendarExists(context: Context, id: string): boolean {
  return !isReservedKey(id) && own(section(context.next, 'calendars'), id) !== undefined;
}

/**
 * Issues of `candidate` (placed at `path` of a throw-away scenario) according to the schema, as
 * `{ field path below `path`, message }`. The schema is the one of the chosen language.
 */
function schemaIssues(context: Context, path: readonly string[], candidate: unknown): { at: (string | number)[]; message: string }[] {
  const probe: Record<string, unknown> = { version: 1, name: 'import' };
  writePath(probe, path, candidate);
  const parsed = parseScenario(probe, { locale: context.locale });
  if (parsed.success) return [];
  return parsed.error.issues.map((problem) => ({
    at: (problem.path as (string | number)[]).slice(path.length),
    message: problem.message,
  }));
}

/** `distribution` + parameters of a row, in seconds. `undefined` = the row says nothing about it. */
function readDistribution(
  context: Context,
  t: Table,
  cells: readonly ReadCell[],
  errors: RowErrors,
): Record<string, unknown> | undefined {
  const { M } = context;
  const typeText = text(t, cells, 'distribution');
  const given = [...PARAMETERS, 'points'].filter((parameter) => text(t, cells, parameter) !== '');
  if (typeText === '') {
    if (given.length > 0) errors.add('distribution', M.missingDistribution());
    return undefined;
  }
  const type = own(DISTRIBUTION_ALIASES, normalized(typeText));
  if (type === undefined) {
    errors.add('distribution', M.unknownDistribution(typeText, Object.keys(DISTRIBUTIONS).join(', ')));
    return undefined;
  }

  const unitText = text(t, cells, 'unit');
  let factor = baseFactor(context.next).factor;
  if (unitText !== '') {
    const unit = own(UNIT_ALIASES, normalized(unitText));
    if (unit === undefined) {
      errors.add('unit', M.unknownUnit(unitText, Object.keys(UNITS).join(', ')));
      return undefined;
    }
    factor = UNITS[unit]!;
  }

  const distribution: Record<string, unknown> = { type };
  const before = errors.list.length;
  for (const parameter of given) {
    if (!DISTRIBUTIONS[type]!.includes(parameter)) {
      errors.add(parameter, M.parameterNotApplicable(parameter, type));
      continue;
    }
    if (parameter === 'points') {
      const points = readPoints(text(t, cells, 'points'), factor);
      if (points === null) errors.add('points', M.badPoints(text(t, cells, 'points')));
      else distribution['points'] = points;
      continue;
    }
    const value = readNumber(t, cell(t, cells, parameter), parameter, errors, M);
    if (value === null || value === undefined) continue;
    distribution[parameter] = TIME_PARAMETERS.has(parameter) ? toSeconds(value, factor) : value;
  }
  if (errors.list.length > before) return undefined;

  for (const problem of schemaIssues(context, ['elements', 'x', 'processingTime'], distribution)) {
    const column = typeof problem.at[0] === 'string' && problem.at[0] !== 'type' ? problem.at[0] : 'distribution';
    errors.add(column, problem.message);
  }
  return errors.list.length > before ? undefined : distribution;
}

/**
 * A number inside `points`. It is a structured field with its own separators (`;` between pairs,
 * `:` inside one) and no thousands, so its decimal can be `.` or `,` whatever the file or the
 * language: the template writes `.`, a person in Spanish types `,`, and both come back.
 */
function pointNumber(part: string): number | null {
  const text = part.replace(/\s/g, '');
  if (text.includes(',') && text.includes('.')) return Number.NaN;
  return parseNumber(text.replace(',', '.'), 'dot');
}

/** `30:0.2; 60:0.8` (values in the row's unit) → the `points` of a `user` distribution. */
function readPoints(value: string, factor: number): { value: number; probability: number }[] | null {
  const points: { value: number; probability: number }[] = [];
  for (const pair of value.split(/[;|\n]/)) {
    if (pair.trim() === '') continue;
    const parts = pair.split(':');
    if (parts.length !== 2) return null;
    const [v, p] = parts.map(pointNumber);
    if (v === null || p === null || v === undefined || p === undefined || Number.isNaN(v) || Number.isNaN(p)) return null;
    points.push({ value: toSeconds(v, factor), probability: p });
  }
  return points.length === 0 ? null : points;
}

function planElements(context: Context, t: Table, seen: Seen): void {
  const { M, ir } = context;
  const arrivals = t.table === 'arrivals';
  const distributionField = arrivals ? 'interTriggerTimer' : 'processingTime';

  for (const { row, cells } of t.rows) {
    const id = text(t, cells, 'id');
    const name = text(t, cells, 'name');
    if (id === '' && name === '') {
      context.issue('error', t.sheet, row, undefined, M.noKey());
      continue;
    }
    const match = matchElement(context, t, row, id, name, 'id', 'name');
    if (match === null) continue;
    const first = seen.get(match.id);
    if (first !== undefined) {
      context.issue('error', t.sheet, row, undefined, M.duplicateRow(id || name, first.sheet, first.row));
      continue;
    }
    seen.set(match.id, { sheet: t.sheet, row });

    const errors = rowErrors();
    const fields: Record<string, unknown> = {};
    const distribution = readDistribution(context, t, cells, errors);
    if (distribution !== undefined) fields[distributionField] = distribution;
    // The unit the row's times were written in, so the report shows them the same way.
    const unit = own(UNIT_ALIASES, normalized(text(t, cells, 'unit'))) ?? baseFactor(context.next).unit;
    const fixedCost = numberField(t, cells, 'fixedCost', errors, M, 'nonNegative');
    if (fixedCost !== undefined) fields['fixedCost'] = fixedCost;
    const calendar = text(t, cells, 'calendar');
    if (calendar !== '') {
      if (calendarExists(context, calendar)) fields['calendar'] = calendar;
      else errors.add('calendar', M.unknownCalendar(calendar));
    }
    if (arrivals) {
      const count = numberField(t, cells, 'triggerCount', errors, M, 'integer');
      if (count !== undefined) fields['triggerCount'] = count;
    } else {
      const probability = numberField(t, cells, 'probability', errors, M, 'probability');
      if (probability !== undefined) fields['probability'] = probability;
      const selection = text(t, cells, 'selection');
      if (selection !== '') {
        const value = own<string>({ and: 'and', y: 'and', or: 'or', o: 'or' }, selection.toLowerCase());
        if (value === undefined) errors.add('selection', M.unknownValue(selection, 'and, or'));
        else fields['selection'] = value;
      }
    }
    if (!flush(context, t, row, errors)) continue;

    const current = own(section(context.next, 'elements'), match.id) ?? {};
    const planned: ImportChange[] = [];
    for (const [field, after] of Object.entries(fields)) {
      if (sameValue(current[field], after)) continue;
      planned.push({
        table: t.table,
        sheet: t.sheet,
        row,
        path: ['elements', match.id, field],
        target: elementLabel(ir, match.id),
        field,
        before: current[field],
        after,
        ...(field === distributionField ? { unit } : {}),
      });
    }
    commit(context, planned);
  }
}

/** `3`, or `day:3; night:1` for the capacity by calendar slices (LILA-164). */
function readCapacity(t: Table, raw: ReadCell, errors: RowErrors, M: SheetMessages): unknown {
  const value = parseNumber(raw, t.style);
  if (value !== null && !Number.isNaN(value)) {
    if (!Number.isInteger(value) || value < 1) {
      errors.add('capacity', M.atLeastOne());
      return undefined;
    }
    return value;
  }
  const slices: { calendar: string; capacity: number }[] = [];
  for (const pair of cellText(raw).split(/[;|\n]/)) {
    if (pair.trim() === '') continue;
    const at = pair.lastIndexOf(':');
    const capacity = at === -1 ? Number.NaN : parseNumber(pair.slice(at + 1), t.style);
    if (at <= 0 || capacity === null || Number.isNaN(capacity)) {
      errors.add('capacity', M.badSlices(cellText(raw)));
      return undefined;
    }
    slices.push({ calendar: pair.slice(0, at).trim(), capacity });
  }
  if (slices.length === 0) {
    errors.add('capacity', M.badSlices(cellText(raw)));
    return undefined;
  }
  return slices;
}

function planResources(context: Context, t: Table, seen: Seen): void {
  const { M } = context;
  for (const { row, cells } of t.rows) {
    const idText = text(t, cells, 'id');
    const name = text(t, cells, 'name');
    let id: string;
    if (rejectReserved(context, t, row, 'id', idText)) continue;
    if (idText !== '') id = idText;
    else if (name !== '') {
      const match = matchResource(context, t, row, name, 'name');
      if (match === null) continue;
      id = match.id;
    } else {
      context.issue('error', t.sheet, row, undefined, M.noKey());
      continue;
    }
    const first = seen.get(id);
    if (first !== undefined) {
      context.issue('error', t.sheet, row, undefined, M.duplicateRow(id, first.sheet, first.row));
      continue;
    }
    seen.set(id, { sheet: t.sheet, row });

    const current = own(section(context.next, 'resources'), id);
    const errors = rowErrors();
    const fields: Record<string, unknown> = {};
    // A name only renames when the row says which pool by id; matched by name, it is the key.
    if (name !== '' && idText !== '') fields['name'] = name;
    const type = text(t, cells, 'type');
    if (type !== '') {
      const value = own<string>({ role: 'role', rol: 'role', equipment: 'equipment', equipo: 'equipment' }, type.toLowerCase());
      if (value === undefined) errors.add('type', M.unknownValue(type, 'role, equipment'));
      else fields['type'] = value;
    }
    if (text(t, cells, 'capacity') !== '') {
      const capacity = readCapacity(t, cell(t, cells, 'capacity'), errors, M);
      if (capacity !== undefined) {
        fields['capacity'] = capacity;
        if (Array.isArray(capacity)) {
          for (const slice of capacity as { calendar: string }[]) {
            if (!calendarExists(context, slice.calendar)) errors.add('capacity', M.unknownCalendar(slice.calendar));
          }
        }
      }
    }
    for (const field of ['costPerHour', 'fixedCost'] as const) {
      const value = numberField(t, cells, field, errors, M, 'nonNegative');
      if (value !== undefined) fields[field] = value;
    }
    const calendar = text(t, cells, 'calendar');
    if (calendar !== '') {
      if (calendarExists(context, calendar)) fields['calendar'] = calendar;
      else errors.add('calendar', M.unknownCalendar(calendar));
    }
    if (errors.list.length === 0) {
      // The schema has the last word (a pool created by the file needs its capacity, say). On an
      // existing pool only what this row wrote is reported: the rest is not the file's doing.
      const candidate = { ...(current ?? {}), ...fields };
      for (const problem of schemaIssues(context, ['resources', id], candidate)) {
        const field = typeof problem.at[0] === 'string' ? problem.at[0] : 'capacity';
        if (current === undefined || field in fields) errors.add(field, problem.message);
      }
    }
    if (!flush(context, t, row, errors)) continue;

    if (current === undefined) {
      commit(context, [{ table: 'resources', sheet: t.sheet, row, path: ['resources', id], target: id, field: '', before: undefined, after: fields }]);
      continue;
    }
    const planned: ImportChange[] = [];
    for (const [field, after] of Object.entries(fields)) {
      if (sameValue(current[field], after)) continue;
      const label = typeof current['name'] === 'string' && current['name'] !== id ? `${current['name']} (${id})` : id;
      planned.push({ table: 'resources', sheet: t.sheet, row, path: ['resources', id, field], target: label, field, before: current[field], after });
    }
    commit(context, planned);
  }
}

function planAssignments(context: Context, t: Table): void {
  const { M, ir } = context;
  /** Element id → its rows, in file order; `failed` once any of them is reported. */
  const groups = new Map<string, { firstRow: number; entries: Record<string, unknown>[]; failed: boolean; refs: Set<string> }>();

  for (const { row, cells } of t.rows) {
    const elementId = text(t, cells, 'elementId');
    const elementName = text(t, cells, 'elementName');
    if (elementId === '' && elementName === '') {
      context.issue('error', t.sheet, row, undefined, M.noKey());
      continue;
    }
    const match = matchElement(context, t, row, elementId, elementName, 'elementId', 'elementName');
    if (match === null) continue;
    let group = groups.get(match.id);
    if (group === undefined) {
      group = { firstRow: row, entries: [], failed: false, refs: new Set() };
      groups.set(match.id, group);
    }

    const resourceId = text(t, cells, 'resourceId');
    const resourceName = text(t, cells, 'resourceName');
    // An element with an empty resource is how a sheet says "no resources": it counts as a row.
    if (resourceId === '' && resourceName === '') continue;
    let ref: string | null = null;
    if (rejectReserved(context, t, row, 'resourceId', resourceId)) {
      group.failed = true;
      continue;
    }
    if (resourceId !== '') {
      if (!isReservedKey(resourceId) && own(section(context.next, 'resources'), resourceId) !== undefined) ref = resourceId;
      else context.issue('unmatched', t.sheet, row, header(t, 'resourceId'), M.unknownResource(resourceId));
    } else {
      ref = matchResource(context, t, row, resourceName, 'resourceName')?.id ?? null;
    }
    if (ref === null) {
      group.failed = true;
      continue;
    }
    const errors = rowErrors();
    if (group.refs.has(ref)) errors.add(resourceId !== '' ? 'resourceId' : 'resourceName', M.duplicateResource(ref));
    const quantity = numberField(t, cells, 'quantity', errors, M, 'integer');
    if (!flush(context, t, row, errors)) {
      group.failed = true;
      continue;
    }
    group.refs.add(ref);
    group.entries.push(quantity === undefined ? { ref } : { ref, quantity });
  }

  for (const [id, group] of groups) {
    if (group.failed) {
      context.issue('warning', t.sheet, group.firstRow, undefined, M.groupNotApplied(elementLabel(ir, id)));
      continue;
    }
    const before = own(section(context.next, 'elements'), id)?.['resources'];
    // `quantity` defaults to 1 (§ 2.5): `{ ref }` and `{ ref, quantity: 1 }` are the same assignment.
    const withQuantity = (list: unknown): unknown =>
      Array.isArray(list) ? list.map((entry) => (isObject(entry) ? { quantity: 1, ...entry } : entry)) : list;
    if (sameValue(withQuantity(before), withQuantity(group.entries))) continue;
    commit(context, [
      {
        table: 'assignments',
        sheet: t.sheet,
        row: group.firstRow,
        path: ['elements', id, 'resources'],
        target: elementLabel(ir, id),
        field: 'resources',
        before,
        after: group.entries,
      },
    ]);
  }
}

/** `MON,TUE`, `MON-FRI`, `lun, mar`, `Monday` → `['MON', 'TUE', …]`; `null` if a token is not a day. */
function readDays(value: string): string[] | null {
  const day = (token: string): string | undefined => {
    return own(DAY_NAMES, token.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\.$/, '').toUpperCase());
  };
  const days: string[] = [];
  // `MON - FRI`, `Lun – Vie`: spaces around a hyphen or a dash still make one range.
  for (const token of value.replace(/\s*[-\u2013\u2014]\s*/g, '-').split(/[,;\s]+/)) {
    if (token === '') continue;
    const range = token.split('-');
    if (range.length === 2) {
      const from = day(range[0]!);
      const to = day(range[1]!);
      if (from === undefined || to === undefined) return null;
      let index = WEEKDAYS.indexOf(from as (typeof WEEKDAYS)[number]);
      for (;;) {
        const current = WEEKDAYS[index]!;
        if (!days.includes(current)) days.push(current);
        if (current === to) break;
        index = (index + 1) % WEEKDAYS.length;
      }
      continue;
    }
    const single = day(token);
    if (single === undefined || range.length > 2) return null;
    if (!days.includes(single)) days.push(single);
  }
  return days.length === 0 ? null : days;
}

/**
 * `09:00`, `9:00`, `09:00:00`, or the fraction of a day Excel stores when a time is typed into a
 * cell (`0.375` = 09:00, `1` = 24:00). `null` when it is none of them.
 */
function readTime(raw: ReadCell, style: NumberStyle): { time: string; seconds: boolean } | null {
  const fraction = typeof raw === 'string' && raw.includes(':') ? null : parseNumber(raw, style);
  if (fraction !== null) {
    if (Number.isNaN(fraction) || fraction < 0 || fraction > 1) return null;
    // Seconds are dropped, as for `17:59:59` typed as text; the epsilon absorbs the binary fraction.
    const minutes = Math.floor(fraction * 1440 + 1e-6);
    return {
      time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`,
      seconds: Math.abs(fraction * 1440 - minutes) > 1e-6,
    };
  }
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(cellText(raw));
  if (match === null) return null;
  return { time: `${match[1]!.padStart(2, '0')}:${match[2]}`, seconds: match[3] !== undefined && match[3] !== '00' };
}

function planCalendars(context: Context, t: Table): void {
  const { M } = context;
  const groups = new Map<string, { rows: number[]; intervals: Record<string, unknown>[]; failed: boolean }>();

  for (const { row, cells } of t.rows) {
    const id = text(t, cells, 'id');
    if (id === '') {
      context.issue('error', t.sheet, row, undefined, M.noKey());
      continue;
    }
    if (rejectReserved(context, t, row, 'id', id)) continue;
    let group = groups.get(id);
    if (group === undefined) {
      group = { rows: [], intervals: [], failed: false };
      groups.set(id, group);
    }
    const errors = rowErrors();
    const days = readDays(text(t, cells, 'days'));
    if (days === null) errors.add('days', M.badDays(text(t, cells, 'days')));
    const times: Record<'from' | 'to', string | null> = { from: null, to: null };
    for (const column of ['from', 'to'] as const) {
      const read = readTime(cell(t, cells, column), t.style);
      if (read === null) errors.add(column, M.badTime(text(t, cells, column)));
      else {
        times[column] = read.time;
        // The scenario keeps minutes (HH:MM); say so instead of dropping the seconds in silence.
        if (read.seconds) errors.note(column, M.secondsDropped(text(t, cells, column), read.time));
      }
    }
    const { from, to } = times;
    if (!flush(context, t, row, errors)) {
      group.failed = true;
      continue;
    }
    group.rows.push(row);
    group.intervals.push({ days, from, to });
  }

  // The calendars the sheet cannot express and does not mention are kept as well; say so, since
  // the template left them out and the person may wonder where they went.
  for (const [id, calendar] of Object.entries(section(context.next, 'calendars'))) {
    if (!groups.has(id) && !isWeekly(calendar)) context.issue('warning', t.sheet, 1, undefined, M.calendarNotWeekly(id));
  }

  for (const [id, group] of groups) {
    const firstRow = group.rows[0] ?? t.rows[0]?.row ?? 1;
    const current = own(section(context.next, 'calendars'), id);
    if (current !== undefined && !isWeekly(current)) {
      context.issue('warning', t.sheet, firstRow, undefined, M.calendarNotWeekly(id));
      continue;
    }
    if (!group.failed) {
      for (const problem of schemaIssues(context, ['calendars', id, 'intervals'], group.intervals)) {
        const index = typeof problem.at[0] === 'number' ? problem.at[0] : 0;
        const column = typeof problem.at[1] === 'string' ? problem.at[1] : 'to';
        context.issue('error', t.sheet, group.rows[index] ?? firstRow, header(t, column), problem.message);
        group.failed = true;
      }
    }
    if (group.failed) {
      context.issue('warning', t.sheet, firstRow, undefined, M.groupNotApplied(id));
      continue;
    }
    if (current === undefined) {
      commit(context, [
        { table: 'calendars', sheet: t.sheet, row: firstRow, path: ['calendars', id], target: id, field: '', before: undefined, after: { intervals: group.intervals } },
      ]);
      continue;
    }
    if (sameValue(current['intervals'], group.intervals)) continue;
    commit(context, [
      {
        table: 'calendars',
        sheet: t.sheet,
        row: firstRow,
        path: ['calendars', id, 'intervals'],
        target: id,
        field: 'intervals',
        before: current['intervals'],
        after: group.intervals,
      },
    ]);
  }
}
