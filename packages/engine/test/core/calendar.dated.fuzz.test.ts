import { describe, expect, test } from 'vitest';

import {
  addWorkingTime,
  capacityAt,
  compileCalendar,
  compileCapacity,
  isOpen,
  nextCapacityRise,
  nextOpen,
  openTime,
  startEpochDay,
  weekOffsetSeconds,
  type Calendar,
  type CalendarDef,
} from '../../src/core/calendar.js';

/**
 * #82, QA of #510: a small deterministic fuzz of dated calendars (R-CAL-12 … R-CAL-14) against
 * an oracle built on `Date.UTC`, independent of the engine's own civil arithmetic. Adapted from
 * the QA's `fuzz.mts` / `fuzzcap.mts`, which found the 00:00 opening bug of `nextOpen`.
 */

const DAY = 86400;
const WD = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const HORIZON = 900;
const pad = (n: number): string => String(n).padStart(2, '0');

function generator(seed: number) {
  let s = seed;
  const rnd = (): number => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ri = (a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1));
  const pick = <T,>(xs: readonly T[]): T => xs[ri(0, xs.length - 1)]!;
  const hhmm = (m: number): string => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  const interval = (): CalendarDef['intervals'][number] => {
    // Openings at 00:00 are frequent on purpose: that is where the bug was.
    const a = rnd() < 0.3 ? 0 : ri(0, 23 * 4) * 15;
    const b = Math.min(1440, a + ri(1, 40) * 15);
    const times = { from: hhmm(a), to: b === 1440 ? '24:00' : hhmm(b) };
    switch (ri(0, 3)) {
      case 0:
        return { days: [...new Set(Array.from({ length: ri(1, 3) }, () => pick(WD)))], ...times };
      case 1:
        return { monthDays: [...new Set(Array.from({ length: ri(1, 3) }, () => pick([1, 2, 15, 28, 29, 30, 31, -1, -2, -29, -31])))], ...times };
      case 2:
        return { monthWeekdays: Array.from({ length: ri(1, 2) }, () => ({ nth: pick([1, 2, 4, 5, -1, -2, -5]), day: pick(WD) })), ...times };
      default:
        return { dates: [...new Set(Array.from({ length: ri(1, 3) }, () => pick(['02-29', '02-28', '03-01', '12-31', '01-01', '06-15', '04-30'])))], ...times };
    }
  };
  const def = (): CalendarDef => {
    const intervals = Array.from({ length: ri(1, 3) }, interval);
    const holidays: string[] = [];
    for (let i = ri(0, 4); i > 0; i--) {
      holidays.push(rnd() < 0.5 ? pick(['02-29', '12-25', '01-01', '03-01', '06-15', '12-31']) : `${ri(2026, 2029)}-${pad(ri(1, 12))}-${pad(ri(1, 28))}`);
    }
    return holidays.length > 0 ? { intervals, holidays } : { intervals };
  };
  return { rnd, ri, pick, def };
}

/** Open intervals of one civil day, per the format's rules, computed with `Date`. */
function oracleDay(def: CalendarDef, ms: number): [number, number][] {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const dom = d.getUTCDate();
  const len = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const wd = WD[(d.getUTCDay() + 6) % 7]!;
  const md = `${pad(m)}-${pad(dom)}`;
  if ((def.holidays ?? []).some((h) => h === md || h === `${y}-${md}`)) return [];
  const seconds = (v: string): number => Number(v.slice(0, 2)) * 3600 + Number(v.slice(3, 5)) * 60;
  const out: [number, number][] = def.intervals
    .filter(
      (iv) =>
        iv.days?.includes(wd) === true ||
        iv.monthDays?.some((n) => (n > 0 ? n === dom : len + 1 + n === dom)) === true ||
        iv.monthWeekdays?.some(
          (x) => x.day === wd && (x.nth > 0 ? Math.ceil(dom / 7) === x.nth : Math.floor((len - dom) / 7) + 1 === -x.nth),
        ) === true ||
        iv.dates?.includes(md) === true,
    )
    .map((iv) => [seconds(iv.from), seconds(iv.to)]);
  out.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [a, b] of out) {
    const last = merged[merged.length - 1];
    if (last !== undefined && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

/** Absolute open intervals (in `t`) over the horizon, merged across midnights. */
function oracle(def: CalendarDef, startMs: number, s0: number): [number, number][] {
  const abs: [number, number][] = [];
  for (let k = 0; k < HORIZON; k++) {
    for (const [a, b] of oracleDay(def, startMs + k * DAY * 1000)) {
      const A = k * DAY + a - s0;
      const B = k * DAY + b - s0;
      const last = abs[abs.length - 1];
      if (last !== undefined && A <= last[1]) last[1] = Math.max(last[1], B);
      else abs.push([A, B]);
    }
  }
  return abs;
}

const LIMIT = (HORIZON - 450) * DAY;

describe('dated calendars against a Date.UTC oracle', () => {
  test('isOpen, nextOpen, openTime and addWorkingTime', () => {
    const { ri, pick, def: randomDef } = generator(20260928);
    const failures: string[] = [];
    let checks = 0;
    for (let n = 0; n < 60; n++) {
      const def = randomDef();
      const [y, mo, d, hh, mm] = [ri(2025, 2028), ri(1, 12), ri(1, 28), ri(0, 23), pick([0, 30])];
      const start = `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${pick(['Z', '-06:00', '+09:00', '+14:00', '-11:00'])}`;
      const s0 = hh * 3600 + mm * 60;
      const abs = oracle(def, Date.UTC(y, mo - 1, d), s0);
      let cal: Calendar;
      try {
        cal = compileCalendar(def, weekOffsetSeconds(start), 'en', startEpochDay(start));
      } catch {
        if (abs.length > 0) failures.push(`compile threw but opens: ${JSON.stringify(def)}`);
        continue;
      }
      if (abs.length === 0) continue;
      const oNext = (t: number): number => {
        for (const [a, b] of abs) if (b > t) return Math.max(a, t);
        return Number.NaN;
      };
      const oTime = (a: number, b: number): number =>
        abs.reduce((sum, [x, z]) => sum + Math.max(0, Math.min(z, b) - Math.max(x, a)), 0);
      for (let q = 0; q < 20; q++) {
        const t = ri(0, LIMIT) + pick([0, 0.5, 0.25]);
        checks++;
        const where = `${start} ${JSON.stringify(def)} t=${t}`;
        if (isOpen(cal, t) !== abs.some(([a, b]) => t >= a && t < b)) failures.push(`isOpen ${where}`);
        const expected = oNext(t);
        if (!Number.isNaN(expected) && nextOpen(cal, t) !== expected) failures.push(`nextOpen ${where}`);
        const t2 = t + (ri(0, 200) * DAY) / 3;
        if (Math.abs(openTime(cal, t, t2) - oTime(t, t2)) > 1e-6) failures.push(`openTime ${where} → ${t2}`);
        const work = ri(1, 100) * 900;
        const done = addWorkingTime(cal, t, work);
        if (done < LIMIT + 300 * DAY) {
          const ok = Math.abs(oTime(t, done) - work) <= 1e-6 && abs.some(([a, b]) => done > a && done <= b);
          if (!ok) failures.push(`addWorkingTime ${where} d=${work}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(checks).toBeGreaterThan(500);
  });

  test('capacityAt and nextCapacityRise with dated slices (R-CAL-11)', () => {
    const { rnd, ri, pick, def: randomDef } = generator(510);
    const failures: string[] = [];
    let checks = 0;
    for (let n = 0; n < 40; n++) {
      const defs = Array.from({ length: ri(1, 3) }, () => (rnd() < 0.15 ? undefined : randomDef()));
      const caps = defs.map(() => ri(1, 3));
      const [y, mo, d, hh, mm] = [ri(2025, 2028), ri(1, 12), ri(1, 28), ri(0, 23), pick([0, 30])];
      const start = `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00Z`;
      const s0 = hh * 3600 + mm * 60;
      const abss = defs.map((def) => (def === undefined ? undefined : oracle(def, Date.UTC(y, mo - 1, d), s0)));
      let schedule;
      try {
        schedule = compileCapacity(
          defs.map((def, i) => ({
            calendar: def === undefined ? undefined : compileCalendar(def, weekOffsetSeconds(start), 'en', startEpochDay(start)),
            capacity: caps[i]!,
          })),
          weekOffsetSeconds(start),
        );
      } catch {
        continue;
      }
      const raw = (t: number): number =>
        abss.reduce((sum, abs, i) => sum + (abs === undefined || abs.some(([a, b]) => t >= a && t < b) ? caps[i]! : 0), 0);
      const edges = [...new Set(abss.flatMap((abs) => (abs ?? []).flat()))].sort((a, b) => a - b);
      const cap = (t: number): number => {
        const r = raw(t);
        if (r > 0 || abss.includes(undefined)) return r;
        const e = edges.find((x) => x > t && raw(x) > 0);
        return e === undefined ? Number.NaN : raw(e);
      };
      const until = LIMIT + 300 * DAY;
      for (let q = 0; q < 15; q++) {
        const t = ri(0, LIMIT) + pick([0, 0.5]);
        checks++;
        const where = `${start} ${JSON.stringify(defs)} ${JSON.stringify(caps)} t=${t}`;
        const expected = cap(t);
        if (!Number.isNaN(expected) && capacityAt(schedule, t) !== expected) failures.push(`capacityAt ${where}`);
        if (schedule.constant === undefined) {
          let previous = expected;
          let rise = Infinity;
          for (const e of edges) {
            if (e <= t) continue;
            if (e > until) break;
            const c = cap(e);
            if (c > previous) {
              rise = e;
              break;
            }
            previous = c;
          }
          const got = nextCapacityRise(schedule, t, until);
          if (got !== rise && !(rise === Infinity && got >= LIMIT)) failures.push(`rise ${where}: ${got} vs ${rise}`);
        }
      }
    }
    expect(failures).toEqual([]);
    expect(checks).toBeGreaterThan(300);
  });
});
