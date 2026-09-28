import { describe, expect, test } from 'vitest';

import { parseScenario, scenarioErrors, validateScenario } from '../src/scenario.js';
import { AS_IS, clone, pedidoIr } from './pedido.fixtures.js';

/**
 * #82 at the scenario boundary: the new calendar fields (§ 2.3 of `docs/SCENARIO_FORMAT.md`)
 * survive a parse → serialize → parse round trip, `holidays` is no longer reserved, and each
 * malformed shape is a schema error with a readable message.
 */

type Raw = Record<string, unknown>;

function withCalendar(calendar: unknown): Raw {
  const raw = clone(AS_IS) as Raw;
  (raw['calendars'] as Raw)['oficina'] = calendar;
  return raw;
}

const DATED = {
  intervals: [
    { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '09:00', to: '18:00' },
    { monthDays: [1, -1], from: '08:00', to: '12:00' },
    { monthWeekdays: [{ nth: -1, day: 'FRI' }, { nth: 2, day: 'SAT' }], from: '10:00', to: '14:00' },
    { dates: ['02-29', '12-24'], from: '09:00', to: '13:00' },
  ],
  holidays: ['2026-12-25', '01-01'],
};

describe('dated calendars in the scenario (#82)', () => {
  test('round trip parse → serialize → parse keeps every field', () => {
    const first = parseScenario(withCalendar(DATED));
    expect(first.success).toBe(true);
    const serialized = JSON.parse(JSON.stringify(first.data)) as unknown;
    const second = parseScenario(serialized);
    expect(second.success).toBe(true);
    expect(second.data).toEqual(first.data);
    expect(second.data!.calendars!['oficina']).toEqual(DATED);
  });

  test('holidays is implemented: no E-RESERVADO, and the scenario validates clean', () => {
    const parsed = parseScenario(withCalendar(DATED));
    expect(scenarioErrors(validateScenario(parsed.data!, pedidoIr()))).toEqual([]);
  });

  test('timezone stays reserved', () => {
    const parsed = parseScenario(withCalendar({ ...DATED, timezone: 'Europe/Madrid' }));
    expect(parsed.success).toBe(true);
    const errors = scenarioErrors(validateScenario(parsed.data!, pedidoIr()));
    expect(errors.map((e) => [e.code, e.path])).toEqual([['E-RESERVADO', 'calendars.oficina.timezone']]);
  });

  test('a calendar that only opens on its own holidays is E-CAL-VACIO in the lint', () => {
    const parsed = parseScenario(
      withCalendar({ intervals: [{ dates: ['12-25'], from: '09:00', to: '13:00' }], holidays: ['12-25'] }),
    );
    const errors = scenarioErrors(validateScenario(parsed.data!, pedidoIr()));
    expect(errors.map((e) => [e.code, e.path])).toEqual([['E-CAL-VACIO', 'calendars.oficina']]);
  });

  test.each([
    ['no selector', { from: '09:00', to: '12:00' }, /exactly one of days, monthDays, monthWeekdays or dates/],
    ['two selectors', { days: ['MON'], monthDays: [1], from: '09:00', to: '12:00' }, /exactly one of/],
    ['day 0', { monthDays: [0], from: '09:00', to: '12:00' }, /monthDays: 0 is not a day/],
    ['day 32', { monthDays: [32], from: '09:00', to: '12:00' }, /monthDays\.0: must be ≤ 31/],
    ['nth 0', { monthWeekdays: [{ nth: 0, day: 'MON' }], from: '09:00', to: '12:00' }, /nth: 0 is not a week/],
    ['nth 6', { monthWeekdays: [{ nth: 6, day: 'MON' }], from: '09:00', to: '12:00' }, /nth: must be ≤ 5/],
    ['February 30', { dates: ['02-30'], from: '09:00', to: '12:00' }, /an annual date is "MM-DD"/],
    ['a full date in dates', { dates: ['2026-12-24'], from: '09:00', to: '12:00' }, /an annual date/],
  ])('schema rejects an interval with %s', (_, interval, message) => {
    const parsed = parseScenario(withCalendar({ intervals: [interval] }));
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n')).toMatch(
      message,
    );
  });

  test.each([['2026-02-29'], ['2026-13-01'], ['12/25'], ['02-30']])('schema rejects the holiday %s', (holiday) => {
    const parsed = parseScenario(withCalendar({ ...DATED, holidays: [holiday] }));
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((issue) => issue.message).join('\n')).toMatch(/holidays: a holiday is/);
  });

  test('the Spanish catalog has the same messages', () => {
    const parsed = parseScenario(withCalendar({ intervals: [{ from: '09:00', to: '12:00' }] }), { locale: 'es' });
    expect(parsed.error!.issues.map((issue) => issue.message).join('\n')).toMatch(/exactamente uno de days/);
  });
});
