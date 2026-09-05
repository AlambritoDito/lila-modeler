import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  WEEK,
  addWorkingTime,
  alwaysOpen,
  compileCalendar,
  intersect,
  isOpen,
  nextOpen,
  openTime,
  weekOffsetSeconds,
  type CalendarDef,
} from '../../src/core/calendar.js';

/** `run.start` normativo del ticket: lunes 08:00 en el offset del escenario. */
const START = '2026-09-07T08:00:00-06:00';
const OFFSET = 28800;

const H = 3600;
const D = 86400;

const OFICINA: CalendarDef = {
  intervals: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '09:00', to: '18:00' }],
};

const cal = compileCalendar(OFICINA, OFFSET);

/** `t` (segundos desde `run.start`) del instante `día d, hh:mm:ss` de la primera semana. */
function at(day: number, hours: number, minutes = 0, seconds = 0): number {
  return day * D + hours * H + minutes * 60 + seconds - OFFSET;
}

describe('weekOffsetSeconds (R-CAL-1)', () => {
  test('el run.start del ticket es lunes 08:00 ⇒ 28800', () => {
    expect(weekOffsetSeconds(START)).toBe(OFFSET);
  });

  test('viernes, domingo y forma sin segundos', () => {
    expect(weekOffsetSeconds('2026-09-11T17:59:00-06:00')).toBe(4 * D + 17 * H + 59 * 60);
    expect(weekOffsetSeconds('2026-09-13T00:00:00Z')).toBe(6 * D);
    expect(weekOffsetSeconds('2026-09-07T08:00-06:00')).toBe(OFFSET);
    expect(weekOffsetSeconds('2026-09-07T08:00Z')).toBe(OFFSET);
  });

  test('lee los segundos cuando están', () => {
    expect(weekOffsetSeconds('2026-09-07T08:00:45-06:00')).toBe(OFFSET + 45);
    expect(weekOffsetSeconds('2026-09-07T08:00:45.250-06:00')).toBe(OFFSET + 45);
  });

  test('año bisiesto: 2024-02-29 fue jueves', () => {
    expect(weekOffsetSeconds('2024-02-29T12:30:00+01:00')).toBe(3 * D + 12 * H + 30 * 60);
  });

  test('el offset UTC de la cadena no cambia nada (R-CAL-1: se lee en ese mismo offset)', () => {
    for (const suffix of ['Z', '-06:00', '+09:00', '+05:30', '-11:00']) {
      expect(weekOffsetSeconds(`2026-09-07T08:00:00${suffix}`)).toBe(OFFSET);
    }
  });
});

describe('compileCalendar (R-CAL-2)', () => {
  test('L–V 09–18 son cinco intervalos y 45 h abiertas por semana', () => {
    expect(cal.intervals).toHaveLength(5);
    expect(cal.intervals[0]).toEqual([9 * H, 18 * H]);
    expect(cal.openPerWeek).toBe(5 * 9 * H);
    expect(cal.offset).toBe(OFFSET);
  });

  test('fusiona intervalos adyacentes: 09–12 + 12–18 es uno solo', () => {
    const merged = compileCalendar(
      {
        intervals: [
          { days: ['MON'], from: '09:00', to: '12:00' },
          { days: ['MON'], from: '12:00', to: '18:00' },
        ],
      },
      OFFSET,
    );

    expect(merged.intervals).toEqual([[9 * H, 18 * H]]);
    expect(merged.openPerWeek).toBe(9 * H);
  });

  test('fusiona solapes: 09–13 + 11–18 es uno solo (unión, no suma)', () => {
    const merged = compileCalendar(
      {
        intervals: [
          { days: ['MON'], from: '09:00', to: '13:00' },
          { days: ['MON'], from: '11:00', to: '18:00' },
        ],
      },
      OFFSET,
    );

    expect(merged.intervals).toEqual([[9 * H, 18 * H]]);
  });

  test('ordena los días aunque lleguen desordenados', () => {
    const unordered = compileCalendar(
      {
        intervals: [
          { days: ['FRI', 'MON'], from: '09:00', to: '18:00' },
          { days: ['WED'], from: '09:00', to: '18:00' },
        ],
      },
      OFFSET,
    );

    expect(unordered.intervals).toEqual([
      [9 * H, 18 * H],
      [2 * D + 9 * H, 2 * D + 18 * H],
      [4 * D + 9 * H, 4 * D + 18 * H],
    ]);
  });

  test('intervals vacío es E-CAL-VACIO', () => {
    expect(() => compileCalendar({ intervals: [] }, OFFSET)).toThrow(/E-CAL-VACIO/);
  });
});

describe('isOpen y nextOpen (R-CAL-2, R-CAL-3)', () => {
  test('from es inclusivo y to exclusivo', () => {
    expect(isOpen(cal, at(0, 9))).toBe(true);
    expect(isOpen(cal, at(0, 17, 59, 59))).toBe(true);
    expect(isOpen(cal, at(0, 18))).toBe(false);
    expect(isOpen(cal, at(1, 8, 59, 59))).toBe(false);
    expect(isOpen(cal, at(5, 12))).toBe(false); // sábado
  });

  test('nextOpen adelanta a la apertura, respeta lo ya abierto y salta el fin de semana', () => {
    expect(nextOpen(cal, 0)).toBe(at(0, 9)); // lunes 08:00 ⇒ 09:00
    expect(nextOpen(cal, at(0, 17, 30))).toBe(at(0, 17, 30)); // ya abierto ⇒ el propio t
    expect(nextOpen(cal, at(0, 18))).toBe(at(1, 9)); // el cierre ya no está abierto
    expect(nextOpen(cal, at(5, 10))).toBe(at(7, 9)); // sábado ⇒ lunes 09:00
    expect(nextOpen(cal, at(6, 23, 59))).toBe(at(7, 9)); // domingo tarde ⇒ lunes 09:00
  });
});

describe('addWorkingTime (R-CAL-3, R-CAL-5)', () => {
  test('aceptación del ticket: 2 h desde el lunes 17:30 terminan el martes a las 10:30', () => {
    expect(at(0, 17, 30)).toBe(34200);
    expect(addWorkingTime(cal, 34200, 2 * H)).toBe(95400);
    expect(95400).toBe(at(1, 10, 30));
  });

  test('aceptación del ticket: viernes 17:59 + 2 h terminan el lunes a las 10:59', () => {
    expect(at(4, 17, 59)).toBe(4 * D + 35940);
    expect(addWorkingTime(cal, at(4, 17, 59), 2 * H)).toBe(7 * D + 10740);
    expect(7 * D + 10740).toBe(at(7, 10, 59));
  });

  test('d ≤ 0 devuelve t aunque esté cerrado (no inventa espera)', () => {
    expect(addWorkingTime(cal, 0, 0)).toBe(0); // lunes 08:00, cerrado
    expect(addWorkingTime(cal, at(5, 3), 0)).toBe(at(5, 3)); // sábado de madrugada
    expect(addWorkingTime(cal, at(5, 3), -10)).toBe(at(5, 3));
  });

  test('desde el cierre, 1 s de trabajo cae en el 09:00:01 del día siguiente', () => {
    expect(addWorkingTime(cal, at(0, 18), 1)).toBe(at(1, 9, 0, 1));
  });

  test('consumir un intervalo exacto devuelve su cierre, no la apertura siguiente', () => {
    expect(addWorkingTime(cal, at(0, 9), 9 * H)).toBe(at(0, 18));
    expect(addWorkingTime(cal, 0, 9 * H)).toBe(at(0, 18)); // arranca cerrado, a las 08:00
  });

  test('3 semanas de 45 h desde media jornada terminan exactamente 3 semanas después', () => {
    const t = at(0, 17, 30);
    expect(addWorkingTime(cal, t, 3 * cal.openPerWeek)).toBe(t + 3 * WEEK);
  });

  test('acumula bien un tramo largo que no es múltiplo de semana', () => {
    // 45 h + 9 h = una semana completa más el lunes siguiente entero.
    expect(addWorkingTime(cal, at(0, 9), cal.openPerWeek + 9 * H)).toBe(at(7, 18));
  });

  test('d fraccionario se conserva', () => {
    expect(addWorkingTime(cal, at(0, 9), 1800.5)).toBe(at(0, 9, 30) + 0.5);
  });

  test('con 24×7 addWorkingTime es la suma directa', () => {
    const flat = alwaysOpen(OFFSET);
    expect(addWorkingTime(flat, 1234, 5 * D)).toBe(1234 + 5 * D);
    expect(isOpen(flat, at(6, 3))).toBe(true);
    expect(nextOpen(flat, at(6, 3))).toBe(at(6, 3));
  });
});

describe('openTime (lo consume LILA-041 para offHoursWait y utilización)', () => {
  test('una semana entera son 45 h abiertas, empiece donde empiece', () => {
    expect(openTime(cal, 0, WEEK)).toBe(cal.openPerWeek);
    expect(openTime(cal, at(3, 11, 17), at(3, 11, 17) + WEEK)).toBe(cal.openPerWeek);
  });

  test('rango cerrado completo: de las 18:00 a las 09:00 hay 0 s abiertos', () => {
    expect(openTime(cal, at(0, 18), at(1, 9))).toBe(0);
    expect(openTime(cal, at(4, 18), at(7, 9))).toBe(0); // el fin de semana entero
  });

  test('rango parcial y rango que cruza el fin de semana', () => {
    expect(openTime(cal, 0, at(0, 18))).toBe(9 * H); // lunes 08:00 → 18:00
    expect(openTime(cal, at(4, 17), at(7, 17))).toBe(H + 8 * H); // viernes 17:00 → lunes 17:00
  });

  test('varias semanas más resto', () => {
    expect(openTime(cal, at(0, 9), at(0, 9) + 2 * WEEK)).toBe(2 * cal.openPerWeek);
    expect(openTime(cal, at(0, 9), at(0, 9) + 2 * WEEK + 9 * H)).toBe(2 * cal.openPerWeek + 9 * H);
  });

  test('b ≤ a es 0', () => {
    expect(openTime(cal, at(1, 12), at(1, 12))).toBe(0);
    expect(openTime(cal, at(1, 12), at(1, 10))).toBe(0);
  });

  test('coherente con addWorkingTime: lo abierto entre t y su fin es exactamente d', () => {
    const t = at(0, 17, 30);
    expect(openTime(cal, t, addWorkingTime(cal, t, 2 * H))).toBe(2 * H);
  });
});

describe('intersect (R-CAL-4; lo cablea LILA-041)', () => {
  const turnoTarde = compileCalendar(
    { intervals: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '12:00', to: '20:00' }] },
    OFFSET,
  );

  test('09–18 ∩ 12–20 = 12–18', () => {
    const both = intersect(cal, turnoTarde);
    expect(both.intervals[0]).toEqual([12 * H, 18 * H]);
    expect(both.intervals).toHaveLength(5);
    expect(both.openPerWeek).toBe(5 * 6 * H);
    expect(both.offset).toBe(OFFSET);
  });

  test('la intersección con 24×7 es el propio calendario', () => {
    expect(intersect(cal, alwaysOpen(OFFSET)).intervals).toEqual(cal.intervals);
    expect(intersect(alwaysOpen(OFFSET), cal).intervals).toEqual(cal.intervals);
  });

  test('turnos disjuntos son E-CAL-VACIO', () => {
    const manana = compileCalendar({ intervals: [{ days: ['MON'], from: '09:00', to: '12:00' }] }, OFFSET);
    const tarde = compileCalendar({ intervals: [{ days: ['MON'], from: '14:00', to: '18:00' }] }, OFFSET);
    expect(() => intersect(manana, tarde)).toThrow(/E-CAL-VACIO/);
  });

  test('un intervalo puede cortar varios del otro calendario', () => {
    const dosPausas = compileCalendar(
      {
        intervals: [
          { days: ['MON'], from: '08:00', to: '11:00' },
          { days: ['MON'], from: '14:00', to: '20:00' },
        ],
      },
      OFFSET,
    );

    expect(intersect(cal, dosPausas).intervals).toEqual([
      [9 * H, 11 * H],
      [14 * H, 18 * H],
    ]);
  });
});

describe('determinismo (R-DET-5)', () => {
  const SOURCE = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/core/calendar.ts');

  test('el módulo no usa Date, Intl ni Math.random fuera de los comentarios', () => {
    const code = readFileSync(SOURCE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    expect(code).not.toMatch(/\bDate\b/);
    expect(code).not.toMatch(/\bIntl\b/);
    expect(code).not.toMatch(/\bMath\.random\b/);
    expect(code).not.toMatch(/\bperformance\b/);
  });

  test('la zona horaria del proceso no cambia el resultado', () => {
    const original = process.env.TZ;
    const measure = (): readonly number[] => [
      weekOffsetSeconds(START),
      addWorkingTime(cal, 34200, 2 * H),
      openTime(cal, 0, WEEK),
    ];

    try {
      process.env.TZ = 'UTC';
      const utc = measure();
      process.env.TZ = 'Pacific/Kiritimati';
      expect(measure()).toEqual(utc);
      expect(utc).toEqual([28800, 95400, 162000]);
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});
