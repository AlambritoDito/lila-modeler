import { describe, expect, test } from 'vitest';

import {
  addWorkingTime,
  capacityAt,
  compileCalendar,
  compileCapacity,
  intersect,
  isOpen,
  nextCapacityRise,
  nextOpen,
  openTime,
  startEpochDay,
  weekOffsetSeconds,
  type CalendarDef,
} from '../../src/core/calendar.js';

/**
 * #82: monthly and annual recurrence and holidays (R-CAL-12 … R-CAL-14 of `docs/SEMANTICS.md`).
 *
 * The expected instants are computed with `Date.UTC` on the civil fields, an oracle independent
 * of the engine's own day arithmetic (which never touches `Date`, R-DET-5).
 */

const HOUR = 3600;

/** Seconds from `start` to `iso`, both read as civil fields (the offset is ignored, R-CAL-1). */
function at(start: string, iso: string): number {
  const civil = (value: string): number =>
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(5, 7)) - 1,
      Number(value.slice(8, 10)),
      Number(value.slice(11, 13) || 0),
      Number(value.slice(14, 16) || 0),
    ) / 1000;
  return civil(iso) - civil(start);
}

function compile(def: CalendarDef, start: string) {
  return compileCalendar(def, weekOffsetSeconds(start), 'en', startEpochDay(start));
}

const NINE_TO_FIVE = { from: '09:00', to: '17:00' } as const;

describe('monthly recurrence by day of the month (R-CAL-12)', () => {
  const start = '2026-04-01T00:00:00-06:00';

  test('day 31 skips a 30-day month: from April 1 the first opening is May 31', () => {
    const cal = compile({ intervals: [{ monthDays: [31], ...NINE_TO_FIVE }] }, start);
    expect(nextOpen(cal, 0)).toBe(at(start, '2026-05-31T09:00'));
    expect(isOpen(cal, at(start, '2026-04-30T12:00'))).toBe(false);
    expect(isOpen(cal, at(start, '2026-05-31T12:00'))).toBe(true);
  });

  test('day -1 is the last day of every month, whatever its length', () => {
    const cal = compile({ intervals: [{ monthDays: [-1], ...NINE_TO_FIVE }] }, start);
    expect(nextOpen(cal, 0)).toBe(at(start, '2026-04-30T09:00'));
    expect(nextOpen(cal, at(start, '2026-04-30T17:00'))).toBe(at(start, '2026-05-31T09:00'));
    // February of a leap year closes on the 29th.
    const leap = '2028-02-01T00:00:00Z';
    expect(nextOpen(compile({ intervals: [{ monthDays: [-1], ...NINE_TO_FIVE }] }, leap), 0)).toBe(
      at(leap, '2028-02-29T09:00'),
    );
  });

  test('open time and working time walk the month (8 h on the 1st of each month)', () => {
    const year = '2026-01-01T00:00:00Z';
    const cal = compile({ intervals: [{ monthDays: [1], ...NINE_TO_FIVE }] }, year);
    expect(openTime(cal, 0, at(year, '2027-01-01T00:00'))).toBe(12 * 8 * HOUR);
    // 10 h of work from Jan 1 09:00: 8 h that day, 2 h on Feb 1.
    expect(addWorkingTime(cal, at(year, '2026-01-01T09:00'), 10 * HOUR)).toBe(at(year, '2026-02-01T11:00'));
  });
});

describe('monthly recurrence by weekday of the month (R-CAL-12)', () => {
  const start = '2026-01-01T00:00:00Z';

  test('the last Friday of the month', () => {
    const cal = compile({ intervals: [{ monthWeekdays: [{ nth: -1, day: 'FRI' }], ...NINE_TO_FIVE }] }, start);
    expect(nextOpen(cal, 0)).toBe(at(start, '2026-01-30T09:00'));
    expect(nextOpen(cal, at(start, '2026-01-30T17:00'))).toBe(at(start, '2026-02-27T09:00'));
  });

  test('a fifth Monday only exists in some months; the others are skipped', () => {
    const cal = compile({ intervals: [{ monthWeekdays: [{ nth: 5, day: 'MON' }], ...NINE_TO_FIVE }] }, start);
    expect(nextOpen(cal, 0)).toBe(at(start, '2026-03-30T09:00'));
  });

  test('the first Monday', () => {
    const cal = compile({ intervals: [{ monthWeekdays: [{ nth: 1, day: 'MON' }], ...NINE_TO_FIVE }] }, start);
    expect(nextOpen(cal, 0)).toBe(at(start, '2026-01-05T09:00'));
  });
});

describe('annual recurrence on a fixed date (R-CAL-13)', () => {
  test('February 29 only opens in leap years', () => {
    const start = '2025-01-01T00:00:00+02:00';
    const cal = compile({ intervals: [{ dates: ['02-29'], ...NINE_TO_FIVE }] }, start);
    expect(nextOpen(cal, 0)).toBe(at(start, '2028-02-29T09:00'));
  });

  test('2100 is not a leap year (Gregorian rule): the next February 29 is in 2104', () => {
    const start = '2100-01-01T00:00:00Z';
    const cal = compile({ intervals: [{ dates: ['02-29'], ...NINE_TO_FIVE }] }, start);
    expect(nextOpen(cal, 0)).toBe(at(start, '2104-02-29T09:00'));
  });

  test('a fixed date opens once a year', () => {
    const start = '2026-01-01T00:00:00Z';
    const cal = compile({ intervals: [{ dates: ['12-24'], from: '10:00', to: '14:00' }] }, start);
    expect(openTime(cal, 0, at(start, '2028-01-01T00:00'))).toBe(2 * 4 * HOUR);
  });
});

describe('holidays (R-CAL-14)', () => {
  const weekdays = { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const, ...NINE_TO_FIVE };
  const monday = '2026-04-06T00:00:00-06:00';

  test('a one-off holiday closes that day even though the weekly pattern opens it', () => {
    const cal = compile({ intervals: [weekdays], holidays: ['2026-04-08'] }, monday);
    expect(isOpen(cal, at(monday, '2026-04-08T10:00'))).toBe(false);
    expect(openTime(cal, 0, at(monday, '2026-04-13T00:00'))).toBe(4 * 8 * HOUR);
    // Work that would run into Wednesday resumes on Thursday.
    expect(addWorkingTime(cal, at(monday, '2026-04-07T16:00'), 2 * HOUR)).toBe(at(monday, '2026-04-09T10:00'));
    // The next week is untouched.
    expect(openTime(cal, at(monday, '2026-04-13T00:00'), at(monday, '2026-04-20T00:00'))).toBe(5 * 8 * HOUR);
  });

  test('an annual holiday "MM-DD" closes that date every year', () => {
    const cal = compile({ intervals: [weekdays], holidays: ['12-25'] }, '2026-12-21T00:00:00Z');
    // 2026-12-25 is a Friday: 4 open days that week.
    expect(openTime(cal, 0, 7 * 86400)).toBe(4 * 8 * HOUR);
    // 2028-12-25 is a Monday.
    const start = '2026-12-21T00:00:00Z';
    expect(isOpen(cal, at(start, '2028-12-25T10:00'))).toBe(false);
    expect(isOpen(cal, at(start, '2028-12-26T10:00'))).toBe(true);
  });

  test('a calendar whose every opening is a holiday never opens: E-CAL-VACIO', () => {
    expect(() =>
      compile({ intervals: [{ dates: ['12-25'], ...NINE_TO_FIVE }], holidays: ['12-25'] }, monday),
    ).toThrow(/E-CAL-VACIO/);
  });

  test('one-off holidays before the start or on a closed weekday keep the weekly path (same bytes)', () => {
    const pruned = compile({ intervals: [weekdays], holidays: ['1999-01-01', '2026-04-11'] }, monday);
    expect(pruned.dated).toBeUndefined();
    expect(pruned).toEqual(compile({ intervals: [weekdays] }, monday));
    // An annual holiday, or a one-off one on an open weekday, is dated.
    expect(compile({ intervals: [weekdays], holidays: ['12-25'] }, monday).dated).toBeDefined();
    expect(compile({ intervals: [weekdays], holidays: ['2026-04-10'] }, monday).dated).toBeDefined();
  });

  test('a holiday past the horizon gives the weekly results', () => {
    const weekly = compile({ intervals: [weekdays] }, monday);
    const dated = compile({ intervals: [weekdays], holidays: ['2030-01-02'] }, monday);
    expect(weekly.dated).toBeUndefined();
    expect(dated.dated).toBeDefined();
    for (const t of [0, 3 * HOUR, 10 * HOUR + 0.5, 4.3 * 86400, 12.7 * 86400]) {
      expect(isOpen(dated, t)).toBe(isOpen(weekly, t));
      expect(nextOpen(dated, t)).toBeCloseTo(nextOpen(weekly, t), 6);
      expect(addWorkingTime(dated, t, 13.25 * HOUR)).toBeCloseTo(addWorkingTime(weekly, t, 13.25 * HOUR), 6);
      expect(openTime(dated, t, t + 9.5 * 86400)).toBeCloseTo(openTime(weekly, t, t + 9.5 * 86400), 6);
    }
  });
});

describe('dated calendars combined with weekly ones (R-CAL-4, R-CAL-11)', () => {
  const start = '2026-04-01T00:00:00Z';

  test('intersection with a weekly calendar, and an empty one is E-CAL-VACIO', () => {
    const firstOfMonth = compile({ intervals: [{ monthDays: [1], from: '08:00', to: '20:00' }] }, start);
    const weekdays = compile({ intervals: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], ...NINE_TO_FIVE }] }, start);
    const both = intersect(firstOfMonth, weekdays);
    // 2026-04-01 is a Wednesday; 2026-05-01 a Friday; 2026-06-01 a Monday; 2026-08-01 a Saturday.
    expect(openTime(both, 0, at(start, '2026-09-01T00:00'))).toBe(4 * 8 * HOUR);
    const mornings = compile({ intervals: [{ days: ['MON'], from: '14:00', to: '17:00' }] }, start);
    const firstMorning = compile({ intervals: [{ monthDays: [1], from: '09:00', to: '12:00' }] }, start);
    expect(() => intersect(firstMorning, mornings)).toThrow(/E-CAL-VACIO/);
  });

  test('capacity by slices sums a monthly reinforcement on top of the weekly base', () => {
    const always = compile({ intervals: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], from: '00:00', to: '24:00' }] }, start);
    const closing = compile({ intervals: [{ monthDays: [-1], ...NINE_TO_FIVE }] }, start);
    const schedule = compileCapacity(
      [
        { calendar: always, capacity: 1 },
        { calendar: closing, capacity: 2 },
      ],
      weekOffsetSeconds(start),
    );
    expect(schedule.max).toBe(3);
    expect(schedule.constant).toBeUndefined();
    expect(capacityAt(schedule, at(start, '2026-04-29T10:00'))).toBe(1);
    expect(capacityAt(schedule, at(start, '2026-04-30T10:00'))).toBe(3);
    expect(nextCapacityRise(schedule, 0)).toBe(at(start, '2026-04-30T09:00'));
    expect(nextCapacityRise(schedule, at(start, '2026-04-30T09:00'))).toBe(at(start, '2026-05-31T09:00'));
    // `until` stops the scan (the engine passes the run's stop instant).
    expect(nextCapacityRise(schedule, 0, at(start, '2026-04-15T00:00'))).toBe(Infinity);
  });

  test('a holiday on one slice lowers the capacity that day only', () => {
    const monday = '2026-04-06T00:00:00Z';
    const weekdays = { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const, ...NINE_TO_FIVE };
    const day = compile({ intervals: [weekdays], holidays: ['2026-04-08'] }, monday);
    const guard = compile({ intervals: [weekdays] }, monday);
    const schedule = compileCapacity(
      [
        { calendar: day, capacity: 2 },
        { calendar: guard, capacity: 1 },
      ],
      weekOffsetSeconds(monday),
    );
    expect(capacityAt(schedule, at(monday, '2026-04-07T10:00'))).toBe(3);
    expect(capacityAt(schedule, at(monday, '2026-04-08T10:00'))).toBe(1);
    expect(capacityAt(schedule, at(monday, '2026-04-09T10:00'))).toBe(3);
    // The rise back to 3 comes when Wednesday closes: a fully closed pool already has the
    // capacity of its next opening (R-CAL-11), exactly as with weekly slices.
    expect(nextCapacityRise(schedule, at(monday, '2026-04-08T10:00'))).toBe(at(monday, '2026-04-08T17:00'));
    // Past the last one-off holiday nothing rises any more.
    expect(nextCapacityRise(schedule, at(monday, '2026-04-09T10:00'))).toBe(Infinity);
  });

  test('a single dated slice is a constant capacity: no calendar events', () => {
    const closing = compile({ intervals: [{ monthDays: [-1], ...NINE_TO_FIVE }] }, start);
    const schedule = compileCapacity([{ calendar: closing, capacity: 2 }], weekOffsetSeconds(start));
    expect(schedule.constant).toBe(2);
  });
});

describe('an opening at 00:00 after a closed day (QA of #510)', () => {
  const start = '2026-09-07T08:00:00Z';
  const allDay = { from: '00:00', to: '24:00' } as const;

  test('nextOpen jumps to midnight, it does not answer «already open»', () => {
    const thursday = compile({ intervals: [{ dates: ['09-10'], ...allDay }] }, start);
    expect(nextOpen(thursday, 0)).toBe(at(start, '2026-09-10T00:00'));
    expect(isOpen(thursday, 0)).toBe(false);
    const firstOfMonth = compile({ intervals: [{ monthDays: [1], ...allDay }] }, start);
    expect(nextOpen(firstOfMonth, 0)).toBe(at(start, '2026-10-01T00:00'));
    expect(addWorkingTime(firstOfMonth, 0, 3600)).toBe(at(start, '2026-10-01T01:00'));
    // The weekly equivalent with an in-window holiday takes the dated path and agrees.
    const weeklyDated = compile({ intervals: [{ days: ['THU'], ...allDay }], holidays: ['2026-09-17'] }, start);
    expect(weeklyDated.dated).toBeDefined();
    expect(nextOpen(weeklyDated, 0)).toBe(at(start, '2026-09-10T00:00'));
    expect(nextOpen(weeklyDated, at(start, '2026-09-11T00:00'))).toBe(at(start, '2026-09-24T00:00'));
  });

  test('capacity by slices: a closed pool takes the capacity of the next 00:00 opening (R-CAL-11)', () => {
    const schedule = compileCapacity(
      [
        { calendar: compile({ intervals: [{ dates: ['09-10'], ...allDay }] }, start), capacity: 2 },
        { calendar: compile({ intervals: [{ dates: ['09-12'], ...allDay }] }, start), capacity: 1 },
      ],
      weekOffsetSeconds(start),
    );
    expect(capacityAt(schedule, 0)).toBe(2);
    expect(capacityAt(schedule, at(start, '2026-09-11T12:00'))).toBe(1);
    // Closing on Sept 12 leaves the pool closed until next Sept 10 (capacity 2): that is the rise.
    expect(nextCapacityRise(schedule, 0)).toBe(at(start, '2026-09-13T00:00'));
  });
});
