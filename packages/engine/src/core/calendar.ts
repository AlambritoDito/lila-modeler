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

/**
 * Ordena, descarta degenerados, une solapes y adyacencias (R-CAL-2) y construye el calendario.
 * Sin ningún intervalo abierto ⇒ `E-CAL-VACIO`.
 */
function build(raw: readonly Interval[], offset: number): Calendar {
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
  return openAtPos(cal, pos(cal, t));
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
export function compileCapacity(entries: readonly CapacityEntry[], offset: number): CapacitySchedule {
  // Guardia de la API interna, no un error del catálogo (§ 17): un escenario con la lista vacía
  // lo rechaza antes `assertSupportedResourceScenario` con `E-REC-CAPACIDAD` y el pool citado, y
  // aquí no hay pool que citar. Llevar el código dejaba dos textos fuera del catálogo (LILA-204).
  if (entries.length === 0) throw new RangeError('compileCapacity: hace falta al menos un tramo de capacidad.');

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
  if (open < 0) throw new RangeError('E-CAL-VACIO: el pool no tiene ningún tramo de capacidad abierto.');
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
  return schedule.segments[segmentAt(schedule, (t + schedule.offset) % WEEK)]![1];
}

/**
 * Primer instante `> t` en que la capacidad **sube**. Es el único evento de calendario del heap
 * (R-CAL-3, R-CAL-11): al bajar no hay nada que planificar, y al subir hay que despertar la cola.
 * Requiere una capacidad no constante (si lo fuera no habría nada que despertar).
 */
export function nextCapacityRise(schedule: CapacitySchedule, t: number): number {
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
