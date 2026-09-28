/**
 * Calendarios semanales (LILA-040), §12 de `docs/SEMANTICS.md` (R-CAL-1 … R-CAL-3).
 *
 * Un calendario es un patrón semanal de intervalos abiertos `[s, e)` medidos en segundos
 * desde el lunes 00:00 del propio patrón, más el `offset` de la semana en que cae `run.start`
 * (el instante `t = 0` del reloj virtual, R-TOK-1). Con eso, `pos(t)` traduce cualquier
 * instante de simulación a su posición dentro de la semana y todas las primitivas son
 * aritmética entera sin calendario real: sin DST, sin festivos, sin zonas horarias (R-CAL-1).
 *
 * #82 adds dated calendars (monthly/annual recurrence and holidays, R-CAL-12 … R-CAL-14): they
 * carry a `dated` layer and walk civil days instead of weeks, still with no `Date` and still in
 * `run.start`'s fixed offset (no DST, R-CAL-15). A calendar without it is untouched.
 *
 * Este archivo es `core/`: no importa nada fuera de `core/` (ni zod, ni `node:*`, ni React) y
 * nunca usa `Date` ni `Intl` (R-DET-5). El offset UTC de `run.start` se ignora **a propósito**:
 * R-CAL-1 dice que los días y horas del calendario se leen en ese mismo offset, así que basta
 * con los campos civiles de la cadena.
 *
 * Como `SCENARIO_FORMAT.md` R13 exige `to > from`, ningún intervalo cruza la medianoche: no hay
 * wrap dentro de un intervalo y la lista queda ordenada y disjunta tras compilar. Una ventana
 * nocturna se declara como dos intervalos.
 *
 * `openTime` e `intersect` no las usa todavía nadie: son las primitivas que LILA-041 necesita
 * para `offHoursWait` (R-CAL-7), la utilización sobre horas disponibles (R-CAL-9) y la
 * intersección de calendarios de una tarea (R-CAL-4). Se entregan aquí, con sus pruebas, para
 * que LILA-041 solo tenga que cablearlas.
 */
import { coded, coreMessages, type Locale } from './messages/index.js';

/** Segundos de una semana. Es el módulo de todo el archivo. */
export const WEEK = 604800;

const DAY = 86400;

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** Intervalo abierto `[s, e)` en segundos desde el lunes 00:00, con `0 ≤ s < e ≤ WEEK`. */
export type Interval = readonly [number, number];

export interface Calendar {
  /** Intervalos abiertos, ordenados por `s`, sin solapes ni adyacencias (R-CAL-2). */
  readonly intervals: readonly Interval[];
  /** Segundo de la semana en que cae `run.start`; `t = 0` está en `offset`. */
  readonly offset: number;
  /** Segundos abiertos por semana. Permite saltar semanas enteras en O(1). */
  readonly openPerWeek: number;
  /**
   * Present only on a dated calendar (monthly/annual recurrence or holidays, R-CAL-12…14, #82).
   * Then the weekly fields above are unused (`intervals: []`) and every primitive walks civil
   * days instead of weeks. A purely weekly calendar never carries it, so its code path is the
   * one from M3 byte for byte (R-DEG-2).
   */
  readonly dated?: Dated;
}

/**
 * One window of `scenario.calendars[name].intervals` (§ 2.3 of SCENARIO_FORMAT). The schema
 * requires exactly one day selector: `days` (weekly), `monthDays`, `monthWeekdays` or `dates`.
 */
export interface CalendarIntervalDef {
  readonly days?: readonly Weekday[] | undefined;
  /** Day of the month, `1…31`, or counted from the end, `-1…-31` (`-1` = last day). R-CAL-12. */
  readonly monthDays?: readonly number[] | undefined;
  /** The `nth` weekday of the month, `1…5` or from the end `-1…-5` (`-1` = last). R-CAL-12. */
  readonly monthWeekdays?: readonly { readonly nth: number; readonly day: Weekday }[] | undefined;
  /** Annual fixed dates `"MM-DD"`. R-CAL-13. */
  readonly dates?: readonly string[] | undefined;
  readonly from: string;
  readonly to: string;
}

/** La forma de `scenario.calendars[nombre]` que consume el motor (§2.3 de SCENARIO_FORMAT). */
export interface CalendarDef {
  readonly intervals: readonly CalendarIntervalDef[];
  /** Closed dates: `"YYYY-MM-DD"` once, `"MM-DD"` every year (R-CAL-14). */
  readonly holidays?: readonly string[] | null | undefined;
}

/* ------------------------------------------------------------------ *
 * run.start → offset de la semana
 * ------------------------------------------------------------------ */

/** `days_from_civil` de Howard Hinnant: días desde 1970-01-01, aritmética pura. */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/**
 * Segundo de la semana (lunes 00:00 = 0) en que cae `run.start`.
 *
 * Solo lee los campos civiles `YYYY-MM-DDThh:mm[:ss]`; el formato ya viene acotado por el
 * regex de `RunSchema.start`, y el offset UTC final se ignora porque el patrón semanal se
 * interpreta en ese mismo offset (R-CAL-1). 1970-01-01 fue jueves, de ahí el `+ 10`.
 */
export function weekOffsetSeconds(isoStart: string): number {
  const year = Number.parseInt(isoStart.slice(0, 4), 10);
  const month = Number.parseInt(isoStart.slice(5, 7), 10);
  const day = Number.parseInt(isoStart.slice(8, 10), 10);
  const hour = Number.parseInt(isoStart.slice(11, 13), 10);
  const minute = Number.parseInt(isoStart.slice(14, 16), 10);
  const second = isoStart.charAt(16) === ':' ? Number.parseInt(isoStart.slice(17, 19), 10) : 0;

  const days = daysFromCivil(year, month, day);
  const weekday = ((days % 7) + 10) % 7; // lunes = 0

  return weekday * DAY + hour * 3600 + minute * 60 + second;
}

/* ------------------------------------------------------------------ *
 * Compilación
 * ------------------------------------------------------------------ */

function hhmmSeconds(value: string): number {
  return Number.parseInt(value.slice(0, 2), 10) * 3600 + Number.parseInt(value.slice(3, 5), 10) * 60;
}

/**
 * Ordena, descarta degenerados, une solapes y adyacencias (R-CAL-2) y construye el calendario.
 * Sin ningún intervalo abierto ⇒ `E-CAL-VACIO`.
 */
function merge(raw: readonly Interval[]): Interval[] {
  const sorted = [...raw].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const intervals: Interval[] = [];

  for (const [start, end] of sorted) {
    // Un intervalo degenerado (`to <= from`) no abre nada. El esquema ya lo rechaza (R13), pero
    // colarlo dejaría `openPerWeek = 0` y `addWorkingTime` dividiría por cero: se descarta aquí.
    if (end <= start) continue;
    const last = intervals[intervals.length - 1];
    // `<=` une también los adyacentes: 09–12 + 12–18 es un solo intervalo.
    if (last !== undefined && start <= last[1]) {
      if (end > last[1]) intervals[intervals.length - 1] = [last[0], end];
    } else {
      intervals.push([start, end]);
    }
  }
  return intervals;
}

function build(raw: readonly Interval[], offset: number, locale: Locale = 'en'): Calendar {
  const intervals = merge(raw);

  if (intervals.length === 0) {
    throw new RangeError(coded('E-CAL-VACIO', coreMessages(locale).codes['E-CAL-VACIO/anonimo']()));
  }

  let openPerWeek = 0;
  for (const [start, end] of intervals) openPerWeek += end - start;

  return { intervals, offset, openPerWeek };
}

/**
 * Compila `{ days, from, to }[]` a intervalos absolutos de la semana.
 *
 * `intervals: []` es `E-CAL-VACIO` (R-CAL-2): un calendario que nunca abre bloquearía la
 * simulación para siempre, así que se rechaza en vez de degradarse.
 */
export function compileCalendar(
  def: CalendarDef,
  offset: number,
  locale: Locale = 'en',
  epochDay: number = MONDAY_EPOCH_DAY + Math.floor(offset / DAY),
): Calendar {
  if (isDatedDef(def)) return compileDated(def, offset, epochDay, locale);
  const raw: Interval[] = [];

  for (const { days = [], from, to } of def.intervals) {
    const start = hhmmSeconds(from);
    const end = hhmmSeconds(to);
    for (const day of days) {
      const index = WEEKDAYS.indexOf(day);
      // ponytail: el esquema (§2.3) ya restringe `days` al enum, así que aquí solo queda la
      // red de seguridad; no hay código de catálogo para un día inválido y no se inventa uno.
      if (index < 0) throw new RangeError(`día de calendario desconocido: ${day}`);
      raw.push([index * DAY + start, index * DAY + end]);
    }
  }

  return build(raw, offset, locale);
}

/** Calendario 24×7: la degradación de R-DEG-2 expresada como calendario de un solo intervalo. */
export function alwaysOpen(offset: number): Calendar {
  return build([[0, WEEK]], offset);
}

/* ------------------------------------------------------------------ *
 * Dated calendars: monthly/annual recurrence and holidays (R-CAL-12…14, #82)
 * ------------------------------------------------------------------ */

/** 1970-01-05, the first Monday of the epoch: the default civil anchor for a bare `offset`. */
const MONDAY_EPOCH_DAY = 4;

/**
 * Days of the Gregorian cycle: every (month, month length, day, weekday) combination repeats
 * every 400 years = 146097 days, which is also a whole number of weeks. It bounds every scan.
 */
const CYCLE_DAYS = 146097;

/** What a civil day looks like to a recurrence rule. Every rule is a function of this alone. */
interface DayShape {
  /** `0` = Monday. */
  readonly weekday: number;
  readonly month: number;
  readonly dom: number;
  /** Days in `month` that year (Feb: 28 or 29). */
  readonly length: number;
}

/**
 * The dated layer of a calendar. Days are civil days since 1970-01-01, read in `run.start`'s own
 * offset like every other calendar field (R-CAL-1): no `Date`, no `Intl`, no process timezone.
 */
export interface Dated {
  /** Civil day of `t = 0` (the date part of `run.start`). */
  readonly epochDay: number;
  /** Open intervals `[s, e)` of a civil day, `0 ≤ s < e ≤ DAY`, sorted and merged. */
  readonly day: (civil: number) => readonly Interval[];
  /** The same for a day shape, one-off holidays aside: what repeats every 400 years. */
  readonly shape: (shape: DayShape) => readonly Interval[];
  /** Civil days closed by a one-off holiday (`"YYYY-MM-DD"`), sorted. */
  readonly oneOff: readonly number[];
}

/** `civil_from_days` by Howard Hinnant, the inverse of `daysFromCivil`. */
function civilFromDays(days: number): [number, number, number] {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const MONTH_LENGTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function monthLength(year: number, month: number): number {
  return month === 2 && isLeap(year) ? 29 : MONTH_LENGTH[month - 1]!;
}

function shapeOf(civil: number): DayShape {
  const [year, month, dom] = civilFromDays(civil);
  return { weekday: ((civil % 7) + 10) % 7, month, dom, length: monthLength(year, month) };
}

/** Every shape the Gregorian calendar produces (≈ 2 700): enough to decide anything periodic. */
function allShapes(): DayShape[] {
  const shapes: DayShape[] = [];
  for (let month = 1; month <= 12; month++) {
    for (const length of month === 2 ? [28, 29] : [MONTH_LENGTH[month - 1]!]) {
      for (let dom = 1; dom <= length; dom++) {
        for (let weekday = 0; weekday < 7; weekday++) shapes.push({ weekday, month, dom, length });
      }
    }
  }
  return shapes;
}

let SHAPES: DayShape[] | undefined;
function shapes(): DayShape[] {
  SHAPES ??= allShapes();
  return SHAPES;
}

function shapeKey({ weekday, month, dom, length }: DayShape): number {
  return ((month * 32 + dom) * 32 + length) * 7 + weekday;
}

/** Memoizes a shape function: a calendar only ever sees a few thousand distinct shapes. */
function memoShape(fn: (shape: DayShape) => readonly Interval[]): (shape: DayShape) => readonly Interval[] {
  const cache = new Map<number, readonly Interval[]>();
  return (shape) => {
    const key = shapeKey(shape);
    let hit = cache.get(key);
    if (hit === undefined) {
      hit = fn(shape);
      cache.set(key, hit);
    }
    return hit;
  };
}

function dayFrom(shape: (shape: DayShape) => readonly Interval[], oneOff: readonly number[]): (civil: number) => readonly Interval[] {
  const closed = new Set(oneOff);
  return (civil) => (closed.has(civil) ? [] : shape(shapeOf(civil)));
}

/** `"MM-DD"` → `month * 100 + day`. */
function monthDayKey(value: string): number {
  return Number.parseInt(value.slice(0, 2), 10) * 100 + Number.parseInt(value.slice(3, 5), 10);
}

/** A calendar is dated as soon as it declares a holiday or a non-weekly selector. */
export function isDatedDef(def: CalendarDef): boolean {
  return (
    (def.holidays?.length ?? 0) > 0 ||
    def.intervals.some(
      (interval) =>
        interval.monthDays !== undefined || interval.monthWeekdays !== undefined || interval.dates !== undefined,
    )
  );
}

/** Does `interval` open on a day of this shape (R-CAL-12, R-CAL-13)? Selectors add up. */
function matches(interval: CalendarIntervalDef, shape: DayShape): boolean {
  const { weekday, month, dom, length } = shape;
  if (interval.days?.some((day) => WEEKDAYS.indexOf(day) === weekday)) return true;
  // A day that does not exist in the month (31 in a 30-day month) is skipped, as iCalendar's
  // BYMONTHDAY does: the recurrence never moves to another day.
  if (interval.monthDays?.some((n) => (n > 0 ? dom === n : dom === length + 1 + n))) return true;
  if (
    interval.monthWeekdays?.some(
      ({ nth, day }) =>
        WEEKDAYS.indexOf(day) === weekday &&
        (nth > 0 ? Math.ceil(dom / 7) === nth : Math.floor((length - dom) / 7) + 1 === -nth),
    )
  ) {
    return true;
  }
  return interval.dates?.some((date) => monthDayKey(date) === month * 100 + dom) ?? false;
}

function datedCalendar(offset: number, dated: Dated, locale: Locale): Calendar {
  if (isEmpty(dated)) {
    throw new RangeError(coded('E-CAL-VACIO', coreMessages(locale).codes['E-CAL-VACIO/anonimo']()));
  }
  return { intervals: [], offset, openPerWeek: 0, dated };
}

/**
 * Never opens? One-off holidays are finite, so after the last one the calendar is periodic and
 * every shape comes back: a calendar is empty exactly when no shape opens.
 */
function isEmpty(dated: Dated): boolean {
  return shapes().every((shape) => dated.shape(shape).length === 0);
}

function compileDated(def: CalendarDef, offset: number, epochDay: number, locale: Locale): Calendar {
  const windows = def.intervals.map((interval) => ({
    interval,
    span: [hhmmSeconds(interval.from), hhmmSeconds(interval.to)] as Interval,
  }));
  const annual = new Set<number>();
  const oneOff = new Set<number>();
  for (const holiday of def.holidays ?? []) {
    if (holiday.length === 5) {
      annual.add(monthDayKey(holiday));
    } else {
      const year = Number.parseInt(holiday.slice(0, 4), 10);
      oneOff.add(daysFromCivil(year, Number.parseInt(holiday.slice(5, 7), 10), Number.parseInt(holiday.slice(8, 10), 10)));
    }
  }
  const shape = memoShape((s) =>
    annual.has(s.month * 100 + s.dom)
      ? []
      : merge(windows.filter(({ interval }) => matches(interval, s)).map(({ span }) => span)),
  );
  const sorted = [...oneOff].sort((left, right) => left - right);
  return datedCalendar(offset, { epochDay, shape, day: dayFrom(shape, sorted), oneOff: sorted }, locale);
}

/** The weekly pattern seen day by day: the bridge when a weekly calendar meets a dated one. */
function asDated(cal: Calendar, epochDay: number): Dated {
  if (cal.dated !== undefined) return cal.dated;
  const byWeekday: Interval[][] = [[], [], [], [], [], [], []];
  for (const [start, end] of cal.intervals) {
    for (let weekday = Math.floor(start / DAY); weekday * DAY < end; weekday++) {
      const low = Math.max(start, weekday * DAY) - weekday * DAY;
      const high = Math.min(end, (weekday + 1) * DAY) - weekday * DAY;
      if (high > low) byWeekday[weekday]!.push([low, high]);
    }
  }
  const shape = (s: DayShape): readonly Interval[] => byWeekday[s.weekday]!;
  return { epochDay, shape, day: (civil) => byWeekday[((civil % 7) + 10) % 7]!, oneOff: [] };
}

function intersectLists(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const left = a[i]!;
    const right = b[j]!;
    const low = Math.max(left[0], right[0]);
    const high = Math.min(left[1], right[1]);
    if (high > low) out.push([low, high]);
    if (left[1] < right[1]) i += 1;
    else j += 1;
  }
  return out;
}

/** Combines two calendars of which at least one is dated, day by day. */
function combineDated(
  a: Calendar,
  b: Calendar,
  op: (left: readonly Interval[], right: readonly Interval[]) => readonly Interval[],
): Calendar {
  const epochDay = (a.dated ?? b.dated)!.epochDay;
  const left = asDated(a, epochDay);
  const right = asDated(b, epochDay);
  const shape = memoShape((s) => op(left.shape(s), right.shape(s)));
  const oneOff = [...new Set([...left.oneOff, ...right.oneOff])].sort((x, y) => x - y);
  return datedCalendar(
    a.offset,
    { epochDay, shape, day: (civil) => op(left.day(civil), right.day(civil)), oneOff },
    'en',
  );
}

/** Seconds since midnight of `t = 0`, and the relative day / position of an instant. */
function where(cal: Calendar, t: number): { k: number; p: number } {
  const u = t + (cal.offset % DAY);
  const k = Math.floor(u / DAY);
  return { k, p: u - k * DAY };
}

/** Instant (in `t`) of midnight of relative day `k`. */
function midnight(cal: Calendar, k: number): number {
  return k * DAY - (cal.offset % DAY);
}

/** Last relative day that can still hold something new: past it, one whole cycle repeats. */
function scanLimit(dated: Dated, k: number): number {
  const last = dated.oneOff[dated.oneOff.length - 1];
  return Math.max(k, last === undefined ? k : last - dated.epochDay) + CYCLE_DAYS;
}

function datedNextOpen(cal: Calendar, dated: Dated, t: number): number {
  let { k, p } = where(cal, t);
  const limit = scanLimit(dated, k);
  for (; k <= limit; k++, p = 0) {
    for (const [start, end] of dated.day(dated.epochDay + k)) {
      if (end <= p) continue;
      return start > p ? midnight(cal, k) + start : t;
    }
  }
  throw new RangeError(coded('E-CAL-VACIO', coreMessages().codes['E-CAL-VACIO/anonimo']()));
}

function datedAddWorkingTime(cal: Calendar, dated: Dated, t: number, d: number): number {
  let { k, p } = where(cal, t);
  let rest = d;
  // Terminates: the calendar is not empty (checked when compiled), so every cycle has open time.
  for (; ; k++, p = 0) {
    for (const [start, end] of dated.day(dated.epochDay + k)) {
      if (end <= p) continue;
      const from = start > p ? start : p;
      const available = end - from;
      if (rest <= available) return midnight(cal, k) + from + rest;
      rest -= available;
    }
  }
}

function datedOpenTime(cal: Calendar, dated: Dated, a: number, b: number): number {
  const first = where(cal, a).k;
  const last = where(cal, b).k;
  let total = 0;
  for (let k = first; k <= last; k++) {
    const base = midnight(cal, k);
    for (const [start, end] of dated.day(dated.epochDay + k)) {
      const low = Math.max(base + start, a);
      const high = Math.min(base + end, b);
      if (high > low) total += high - low;
    }
  }
  return total;
}

/** Civil day of `run.start`, read from its civil fields only (R-CAL-1, R-DET-5). */
export function startEpochDay(isoStart: string): number {
  return daysFromCivil(
    Number.parseInt(isoStart.slice(0, 4), 10),
    Number.parseInt(isoStart.slice(5, 7), 10),
    Number.parseInt(isoStart.slice(8, 10), 10),
  );
}

/* ------------------------------------------------------------------ *
 * Primitivas (R-CAL-3)
 * ------------------------------------------------------------------ */

/** Posición de `t` dentro del patrón semanal. Requiere `t ≥ 0` (el reloj nunca retrocede). */
function pos(cal: Calendar, t: number): number {
  return (t + cal.offset) % WEEK;
}

/** ¿Está abierto el calendario en la posición `p` de la semana? Lo comparten `isOpen` y `compileCapacity`. */
function openAtPos(cal: Calendar, p: number): boolean {
  for (const [start, end] of cal.intervals) {
    if (p < start) return false; // ordenados: ninguno posterior puede contener p
    if (p < end) return true;
  }
  return false;
}

/** ¿Está abierto el calendario en `t`? `from` inclusivo, `to` exclusivo (R-CAL-2). */
export function isOpen(cal: Calendar, t: number): boolean {
  if (cal.dated !== undefined) {
    const { k, p } = where(cal, t);
    return cal.dated.day(cal.dated.epochDay + k).some(([start, end]) => p >= start && p < end);
  }
  return openAtPos(cal, pos(cal, t));
}

/** Primer instante abierto en `[t, ∞)`; devuelve `t` si ya está abierto (R-CAL-3). */
export function nextOpen(cal: Calendar, t: number): number {
  if (cal.dated !== undefined) return datedNextOpen(cal, cal.dated, t);
  const p = pos(cal, t);
  for (const [start, end] of cal.intervals) {
    if (end <= p) continue;
    return start > p ? t + (start - p) : t;
  }
  const first = cal.intervals[0];
  if (first === undefined) {
    throw new RangeError(coded('E-CAL-VACIO', coreMessages().codes['E-CAL-VACIO/anonimo']()));
  }
  return t + (WEEK - p) + first[0];
}

/**
 * Instante en que se han consumido `d` segundos **abiertos** desde `t` (R-CAL-3, R-CAL-5).
 *
 * `d ≤ 0` devuelve `t` tal cual, aunque esté cerrado: no hay trabajo que hacer y adelantar el
 * reloj hasta la apertura inventaría una espera. Si `d` termina justo al cerrar un intervalo se
 * devuelve el cierre (el instante más temprano que cumple), no la apertura siguiente.
 */
export function addWorkingTime(cal: Calendar, t: number, d: number): number {
  if (d <= 0) return t;
  if (cal.dated !== undefined) return datedAddWorkingTime(cal, cal.dated, t, d);
  // Una semana entera abierta es el elemento neutro y su respuesta exacta es `t + d`. Sin este
  // atajo el rodeo por `weeks × WEEK` redondea, y un 24×7 escrito a mano dejaba de dar los
  // mismos bytes que no declarar ningún calendario (R-DEG-2).
  if (cal.openPerWeek === WEEK) return t + d;

  // Cada semana natural aporta exactamente `openPerWeek` segundos abiertos, empiece donde
  // empiece: saltarlas de golpe evita iterar años de intervalos.
  let weeks = Math.floor(d / cal.openPerWeek);
  let rest = d - weeks * cal.openPerWeek;
  if (rest === 0 && weeks > 0) {
    // Múltiplo exacto: se deja la última semana al bucle para caer en el cierre del intervalo.
    weeks -= 1;
    rest = cal.openPerWeek;
  }

  const base = t + weeks * WEEK;
  let p = pos(cal, base);
  let weekBase = base - p; // instante absoluto del lunes 00:00 de la semana en curso

  // `rest ∈ (0, openPerWeek]`, así que dos pasadas bastan siempre.
  for (;;) {
    for (const [start, end] of cal.intervals) {
      if (end <= p) continue;
      const from = start > p ? start : p;
      const available = end - from;
      if (rest <= available) return weekBase + from + rest;
      rest -= available;
    }
    weekBase += WEEK;
    p = 0;
  }
}

/** Segundos abiertos contenidos en `[a, b)`. `b ≤ a` ⇒ 0. Lo necesita LILA-041 (R-CAL-7/9). */
export function openTime(cal: Calendar, a: number, b: number): number {
  if (b <= a) return 0;
  if (cal.dated !== undefined) return datedOpenTime(cal, cal.dated, a, b);
  // Igual que en `addWorkingTime`: con la semana entera abierta la respuesta exacta es `b − a`.
  // Es el atajo que deja `offHoursWait` clavado en 0 y no en 4 × 10⁻⁹ (R-DEG-2).
  if (cal.openPerWeek === WEEK) return b - a;

  const weeks = Math.floor((b - a) / WEEK);
  const from = pos(cal, a + weeks * WEEK);
  const to = from + (b - a - weeks * WEEK); // < 2 × WEEK, puede desbordar la semana
  let total = weeks * cal.openPerWeek;

  for (const [start, end] of cal.intervals) {
    for (const shift of [0, WEEK]) {
      const low = Math.max(start + shift, from);
      const high = Math.min(end + shift, to);
      if (high > low) total += high - low;
    }
  }

  return total;
}

/**
 * Intersección de dos calendarios del mismo `offset` (R-CAL-4: el calendario de una tarea es la
 * intersección de los de sus pools y el suyo propio). Una intersección vacía es `E-CAL-VACIO`.
 */
export function intersect(a: Calendar, b: Calendar): Calendar {
  if (a.dated !== undefined || b.dated !== undefined) return combineDated(a, b, intersectLists);
  const out: Interval[] = [];
  let i = 0;
  let j = 0;

  while (i < a.intervals.length && j < b.intervals.length) {
    const left = a.intervals[i];
    const right = b.intervals[j];
    if (left === undefined || right === undefined) break;
    const low = Math.max(left[0], right[0]);
    const high = Math.min(left[1], right[1]);
    if (high > low) out.push([low, high]);
    if (left[1] < right[1]) i += 1;
    else j += 1;
  }

  return build(out, a.offset);
}

/**
 * Unión de dos calendarios del mismo `offset`: abierto cuando lo está cualquiera de los dos.
 * Es el calendario de un pool con `capacity` por intervalos (R-CAL-11): el pool está abierto
 * mientras quede al menos una unidad disponible. `build` ya une solapes y adyacencias.
 */
export function union(a: Calendar, b: Calendar): Calendar {
  if (a.dated !== undefined || b.dated !== undefined) {
    return combineDated(a, b, (left, right) => merge([...left, ...right]));
  }
  return build([...a.intervals, ...b.intervals], a.offset);
}

/* ------------------------------------------------------------------ *
 * Capacidad por intervalos (R-CAL-11, LILA-164)
 * ------------------------------------------------------------------ */

/** Un tramo declarado de capacidad: `capacity` unidades mientras `calendar` esté abierto. */
export interface CapacityEntry {
  /** `undefined` = siempre abierto (el pool sin calendario, o con un `default` inexistente). */
  readonly calendar: Calendar | undefined;
  readonly capacity: number;
}

/**
 * Capacidad de un pool como función escalonada de la semana (R-CAL-11).
 *
 * `segments` cubre `[0, WEEK)` sin huecos, ordenado por inicio y **sin ningún cero**: los tramos
 * en que el pool está cerrado toman la capacidad del siguiente tramo abierto. Eso es lo que
 * generaliza R-CAL-6 sin cambiar nada del caso de un solo calendario: la concesión ocurre aunque
 * el pool esté cerrado y el trabajo espera a la apertura, así que la capacidad que ve el
 * planificador durante el cierre es la que habrá al abrir.
 */
export interface CapacitySchedule {
  /** `[inicio de semana, capacidad]`, ordenado, `segments[0][0] === 0`, toda capacidad `≥ 1`. */
  readonly segments: readonly (readonly [number, number])[];
  readonly offset: number;
  /** Mayor capacidad de la semana: el tope contra el que se valida `quantity` (R-REC-2). */
  readonly max: number;
  /** Definida si la capacidad no cambia nunca; el motor entonces no agenda ningún evento. */
  readonly constant: number | undefined;
  /**
   * Present when some slice's calendar is dated (#82): `segments` is then unused and the
   * capacity is evaluated day by day from the slices themselves (same rules, R-CAL-11).
   */
  readonly dated?: DatedCapacity;
}

interface DatedCapacity {
  readonly entries: readonly { readonly calendar: Calendar | undefined; readonly capacity: number }[];
  /** Each slice's calendar seen day by day; `undefined` = always open. */
  readonly views: readonly (Dated | undefined)[];
  /** Union of the slices' calendars; `undefined` if one of them is always open. */
  readonly open: Calendar | undefined;
  readonly epochDay: number;
  /** `true` if, once the last one-off holiday is past, the capacity never changes again. */
  readonly periodicConstant: boolean;
  /** Last civil day closed by a one-off holiday of any slice, or `-Infinity`. */
  readonly lastOneOff: number;
}

/** Índice del segmento que contiene la posición `p` de la semana. */
function segmentAt(schedule: CapacitySchedule, p: number): number {
  const { segments } = schedule;
  for (let i = segments.length - 1; i >= 0; i--) if (p >= segments[i]![0]) return i;
  return 0;
}

/**
 * Compila los tramos declarados a la función escalonada. Dos tramos cuyos calendarios se
 * **solapan suman** su capacidad en el solape (a diferencia de los intervalos de un mismo
 * calendario, que se unen): son dos grupos distintos de unidades del mismo rol.
 */
export function compileCapacity(
  entries: readonly CapacityEntry[],
  offset: number,
  locale: Locale = 'en',
): CapacitySchedule {
  // Guardia de la API interna, no un error del catálogo (§ 17): un escenario con la lista vacía
  // lo rechaza antes `assertSupportedResourceScenario` con `E-REC-CAPACIDAD` y el pool citado, y
  // aquí no hay pool que citar. Llevar el código dejaba dos textos fuera del catálogo (LILA-204).
  if (entries.length === 0) throw new RangeError('compileCapacity: hace falta al menos un tramo de capacidad.');
  if (entries.some((entry) => entry.calendar?.dated !== undefined)) return compileDatedCapacity(entries, offset, locale);

  const boundaries = new Set<number>([0]);
  for (const entry of entries) {
    if (entry.calendar === undefined) continue;
    for (const [start, end] of entry.calendar.intervals) {
      boundaries.add(start % WEEK);
      boundaries.add(end % WEEK); // `end === WEEK` cae en 0, que ya está
    }
  }
  const starts = [...boundaries].sort((left, right) => left - right);

  const raw = starts.map((p) => {
    let total = 0;
    for (const entry of entries) {
      if (entry.calendar === undefined || openAtPos(entry.calendar, p)) total += entry.capacity;
    }
    return total;
  });

  // Los tramos cerrados heredan la capacidad del siguiente abierto (circularmente). Siempre hay
  // alguno abierto: todo calendario tiene al menos un intervalo (R-CAL-2) y toda `capacity ≥ 1`.
  const filled = [...raw];
  const open = raw.findIndex((value) => value > 0);
  if (open < 0) {
    throw new RangeError(
      coded('E-CAL-VACIO', coreMessages(locale).codes['E-CAL-VACIO/pool-sin-tramos']()),
    );
  }
  for (let i = starts.length - 1; i >= 0; i--) {
    if (filled[i]! > 0) continue;
    filled[i] = filled[(i + 1) % starts.length]!;
  }
  // La pasada circular puede dejar un cero si el hueco cruza el lunes 00:00: una segunda pasada
  // hacia atrás desde el primer abierto lo cierra (dos pasadas bastan, el relleno es monótono).
  for (let i = starts.length - 1; i >= 0; i--) if (filled[i] === 0) filled[i] = filled[(i + 1) % starts.length]!;

  const segments: (readonly [number, number])[] = [];
  for (let i = 0; i < starts.length; i++) {
    const capacity = filled[i]!;
    if (segments.length > 0 && segments[segments.length - 1]![1] === capacity) continue;
    segments.push([starts[i]!, capacity]);
  }

  let max = 0;
  for (const [, capacity] of segments) max = Math.max(max, capacity);
  return {
    segments,
    offset,
    max,
    constant: segments.length === 1 ? segments[0]![1] : undefined,
  };
}

/** Capacidad efectiva del pool en `t` (R-CAL-11). */
export function capacityAt(schedule: CapacitySchedule, t: number): number {
  if (schedule.constant !== undefined) return schedule.constant;
  if (schedule.dated !== undefined) return datedCapacityAt(schedule.dated, t);
  return schedule.segments[segmentAt(schedule, (t + schedule.offset) % WEEK)]![1];
}

/**
 * Primer instante `> t` en que la capacidad **sube**. Es el único evento de calendario del heap
 * (R-CAL-3, R-CAL-11): al bajar no hay nada que planificar, y al subir hay que despertar la cola.
 * Requiere una capacidad no constante (si lo fuera no habría nada que despertar).
 */
export function nextCapacityRise(schedule: CapacitySchedule, t: number, until = Infinity): number {
  if (schedule.dated !== undefined) return datedNextCapacityRise(schedule, schedule.dated, t, until);
  const { segments } = schedule;
  const length = (index: number): number => (segments[index + 1]?.[0] ?? WEEK) - segments[index]![0];
  const p = (t + schedule.offset) % WEEK;
  let index = segmentAt(schedule, p);
  // Fin absoluto del segmento en curso; a partir de ahí, un segmento entero por vuelta.
  let boundary = t + (length(index) - (p - segments[index]![0]));
  // Se compara cada segmento con el **anterior**, no con el de `t`: desde el turno de mayor
  // capacidad la siguiente subida llega después de una bajada, y comparar contra `t` no la vería.
  for (let step = 0; step < segments.length; step++) {
    const next = (index + 1) % segments.length;
    if (segments[next]![1] > segments[index]![1]) return boundary;
    boundary += length(next);
    index = next;
  }
  // Invariante de la llamada, no error del escenario: solo se llega aquí con un horario que
  // `compileCapacity` declaró no constante, y un horario de dos o más tramos siempre sube en el
  // ciclo semanal. Sin código de catálogo por lo mismo que arriba (LILA-204).
  throw new RangeError('nextCapacityRise: la capacidad no sube nunca; el horario debería ser constante.');
}

/* ------------------------------------------------------------------ *
 * Capacity by slices with dated calendars (R-CAL-11 + #82)
 * ------------------------------------------------------------------ */

/** Sum of the slices open at `t`, without the closed-pool rule. */
function rawCapacity(dated: DatedCapacity, t: number): number {
  let total = 0;
  for (const entry of dated.entries) {
    if (entry.calendar === undefined || isOpen(entry.calendar, t)) total += entry.capacity;
  }
  return total;
}

function datedCapacityAt(dated: DatedCapacity, t: number): number {
  const raw = rawCapacity(dated, t);
  if (raw > 0 || dated.open === undefined) return raw;
  // R-CAL-11: while the whole pool is closed, the capacity of the next open instant applies.
  return rawCapacity(dated, nextOpen(dated.open, t));
}

/** Raw capacities at every edge of a set of per-day interval lists. */
function capacitiesOfDay(lists: readonly (readonly Interval[] | undefined)[], capacities: readonly number[]): number[] {
  const edges = new Set<number>([0]);
  for (const list of lists) for (const [start, end] of list ?? []) edges.add(start).add(end);
  const out: number[] = [];
  for (const edge of edges) {
    if (edge >= DAY) continue;
    let total = 0;
    lists.forEach((list, i) => {
      if (list === undefined || list.some(([start, end]) => edge >= start && edge < end)) total += capacities[i]!;
    });
    out.push(total);
  }
  return out;
}

function compileDatedCapacity(entries: readonly CapacityEntry[], offset: number, locale: Locale): CapacitySchedule {
  const epochDay = entries.find((entry) => entry.calendar?.dated !== undefined)!.calendar!.dated!.epochDay;
  const views = entries.map((entry) => (entry.calendar === undefined ? undefined : asDated(entry.calendar, epochDay)));
  const capacities = entries.map((entry) => entry.capacity);

  // Every value the step function takes while open: all shapes (the periodic part) plus the days
  // of one-off holidays, the only days that can combine slices in a way no shape does.
  const periodic = new Set<number>();
  for (const shape of shapes()) {
    for (const value of capacitiesOfDay(views.map((view) => view?.shape(shape)), capacities)) {
      if (value > 0) periodic.add(value);
    }
  }
  if (periodic.size === 0) {
    throw new RangeError(coded('E-CAL-VACIO', coreMessages(locale).codes['E-CAL-VACIO/pool-sin-tramos']()));
  }
  const values = new Set(periodic);
  const oneOff = [...new Set(views.flatMap((view) => view?.oneOff ?? []))];
  for (const civil of oneOff) {
    for (const value of capacitiesOfDay(views.map((view) => view?.day(civil)), capacities)) {
      if (value > 0) values.add(value);
    }
  }

  let open: Calendar | undefined;
  for (const entry of entries) {
    if (entry.calendar === undefined) {
      open = undefined;
      break;
    }
    open = open === undefined ? entry.calendar : union(open, entry.calendar);
  }

  return {
    segments: [[0, Math.max(...values)]],
    offset,
    max: Math.max(...values),
    constant: values.size === 1 ? [...values][0] : undefined,
    dated: {
      entries,
      views,
      open,
      epochDay,
      periodicConstant: periodic.size === 1,
      lastOneOff: oneOff.length === 0 ? -Infinity : Math.max(...oneOff),
    },
  };
}

function datedNextCapacityRise(schedule: CapacitySchedule, dated: DatedCapacity, t: number, until: number): number {
  const start = t + (schedule.offset % DAY);
  let k = Math.floor(start / DAY);
  // Past the last one-off holiday a periodic-constant schedule never rises again; otherwise a
  // whole Gregorian cycle contains every rise there is.
  const lastOneOff = dated.lastOneOff - dated.epochDay;
  const limit = dated.periodicConstant ? lastOneOff + 1 : Math.max(k, lastOneOff) + CYCLE_DAYS;
  let previous = datedCapacityAt(dated, t);
  for (; k <= limit; k++) {
    const base = k * DAY - (schedule.offset % DAY);
    if (base >= until) return Infinity;
    const edges = new Set<number>([0]);
    for (const view of dated.views) for (const [s, e] of view?.day(dated.epochDay + k) ?? []) edges.add(s).add(e);
    for (const edge of [...edges].sort((left, right) => left - right)) {
      const at = base + edge;
      if (at <= t || edge >= DAY) continue;
      if (at >= until) return Infinity;
      const capacity = datedCapacityAt(dated, at);
      if (capacity > previous) return at;
      previous = capacity;
    }
  }
  return Infinity;
}
