/**
 * Calendarios semanales (LILA-040), §12 de `docs/SEMANTICS.md` (R-CAL-1 … R-CAL-3).
 *
 * Un calendario es un patrón semanal de intervalos abiertos `[s, e)` medidos en segundos
 * desde el lunes 00:00 del propio patrón, más el `offset` de la semana en que cae `run.start`
 * (el instante `t = 0` del reloj virtual, R-TOK-1). Con eso, `pos(t)` traduce cualquier
 * instante de simulación a su posición dentro de la semana y todas las primitivas son
 * aritmética entera sin calendario real: sin DST, sin festivos, sin zonas horarias (R-CAL-1).
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
}

/** La forma de `scenario.calendars[nombre]` que consume el motor (§2.3 de SCENARIO_FORMAT). */
export interface CalendarDef {
  readonly intervals: readonly {
    readonly days: readonly Weekday[];
    readonly from: string;
    readonly to: string;
  }[];
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

/** Ordena, une solapes y adyacencias (R-CAL-2) y construye el calendario. Vacío ⇒ E-CAL-VACIO. */
function build(raw: readonly Interval[], offset: number): Calendar {
  const sorted = [...raw].sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const intervals: Interval[] = [];

  for (const [start, end] of sorted) {
    const last = intervals[intervals.length - 1];
    // `<=` une también los adyacentes: 09–12 + 12–18 es un solo intervalo.
    if (last !== undefined && start <= last[1]) {
      if (end > last[1]) intervals[intervals.length - 1] = [last[0], end];
    } else {
      intervals.push([start, end]);
    }
  }

  if (intervals.length === 0) {
    throw new RangeError('E-CAL-VACIO: el calendario no tiene intervalos abiertos.');
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
export function compileCalendar(def: CalendarDef, offset: number): Calendar {
  const raw: Interval[] = [];

  for (const { days, from, to } of def.intervals) {
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

  return build(raw, offset);
}

/** Calendario 24×7: la degradación de R-DEG-2 expresada como calendario de un solo intervalo. */
export function alwaysOpen(offset: number): Calendar {
  return build([[0, WEEK]], offset);
}

/* ------------------------------------------------------------------ *
 * Primitivas (R-CAL-3)
 * ------------------------------------------------------------------ */

/** Posición de `t` dentro del patrón semanal. Requiere `t ≥ 0` (el reloj nunca retrocede). */
function pos(cal: Calendar, t: number): number {
  return (t + cal.offset) % WEEK;
}

/** ¿Está abierto el calendario en `t`? `from` inclusivo, `to` exclusivo (R-CAL-2). */
export function isOpen(cal: Calendar, t: number): boolean {
  const p = pos(cal, t);
  for (const [start, end] of cal.intervals) {
    if (p < start) return false; // ordenados: ninguno posterior puede contener p
    if (p < end) return true;
  }
  return false;
}

/** Primer instante abierto en `[t, ∞)`; devuelve `t` si ya está abierto (R-CAL-3). */
export function nextOpen(cal: Calendar, t: number): number {
  const p = pos(cal, t);
  for (const [start, end] of cal.intervals) {
    if (end <= p) continue;
    return start > p ? t + (start - p) : t;
  }
  const first = cal.intervals[0];
  if (first === undefined) throw new RangeError('E-CAL-VACIO: el calendario no tiene intervalos abiertos.');
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
