/**
 * QA adversarial de LILA-040: fechas límite contra `Date.UTC`, propiedades de las cuatro
 * primitivas sobre calendarios sembrados, álgebra de `intersect` y aritmética degenerada.
 *
 * En `core/` no se permite `Date` (R-DET-5); en las pruebas sí, y aquí es justo el oráculo:
 * `weekOffsetSeconds` se compara contra `Date.UTC` para 200 fechas aleatorias sembradas.
 */
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
  type Calendar,
  type CalendarDef,
  type Weekday,
} from '../../src/core/calendar.js';

const H = 3600;
const D = 86400;

/** mulberry32: el mismo PRNG del motor, aquí solo para sembrar los casos. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_DAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const WEEKDAYS_MF: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Día de la semana con lunes = 0, calculado con `Date` (el oráculo que `core/` no puede usar). */
function mondayIndex(year: number, month: number, day: number): number {
  const utc = Date.UTC(2000, month - 1, day);
  const shifted = new Date(utc);
  shifted.setUTCFullYear(year);
  return (shifted.getUTCDay() + 6) % 7;
}

/* ------------------------------------------------------------------ *
 * 1. weekOffsetSeconds
 * ------------------------------------------------------------------ */

describe('weekOffsetSeconds contra Date.UTC (R-CAL-1)', () => {
  test('fechas límite: bisiestos, fin de año, 1970 y años anteriores, 2100 no bisiesto', () => {
    const cases: readonly (readonly [string, number, number, number])[] = [
      ['2024-02-29T00:00:00Z', 2024, 2, 29],
      ['2028-02-29T23:59:59Z', 2028, 2, 29],
      ['2000-02-29T06:00:00Z', 2000, 2, 29],
      ['2100-02-28T12:00:00Z', 2100, 2, 28],
      ['2100-03-01T12:00:00Z', 2100, 3, 1], // 2100 no es bisiesto
      ['1999-12-31T23:59:59Z', 1999, 12, 31],
      ['2026-12-31T00:00:00Z', 2026, 12, 31],
      ['1970-01-01T00:00:00Z', 1970, 1, 1], // jueves
      ['1969-12-31T00:00:00Z', 1969, 12, 31],
      ['1969-12-21T00:00:00Z', 1969, 12, 21], // días negativos con módulo negativo en JS
      ['1901-01-01T00:00:00Z', 1901, 1, 1],
      ['1600-02-29T00:00:00Z', 1600, 2, 29], // era anterior en days_from_civil
    ];

    for (const [iso, year, month, day] of cases) {
      const hour = Number(iso.slice(11, 13));
      const minute = Number(iso.slice(14, 16));
      const second = Number(iso.slice(17, 19));
      expect(weekOffsetSeconds(iso)).toBe(mondayIndex(year, month, day) * D + hour * H + minute * 60 + second);
    }

    expect(weekOffsetSeconds('1970-01-01T00:00:00Z')).toBe(3 * D); // jueves
  });

  test('200 fechas aleatorias sembradas coinciden con Date.UTC', () => {
    const random = prng(0x1104);
    const suffixes = ['Z', '-06:00', '+14:00', '-12:00', '+05:45', ''];

    for (let i = 0; i < 200; i += 1) {
      const year = 1583 + Math.floor(random() * 700);
      const month = 1 + Math.floor(random() * 12);
      const day = 1 + Math.floor(random() * 28);
      const hour = Math.floor(random() * 24);
      const minute = Math.floor(random() * 60);
      const second = Math.floor(random() * 60);
      const civil = `${pad(year, 4)}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
      const expected = mondayIndex(year, month, day) * D + hour * H + minute * 60 + second;

      for (const suffix of suffixes) {
        expect(weekOffsetSeconds(civil + suffix)).toBe(expected);
      }
      // La fracción de segundo se descarta, no se redondea.
      expect(weekOffsetSeconds(`${civil}.500-03:00`)).toBe(expected);
    }
  });

  test('la forma sin segundos y los offsets extremos dan el mismo resultado', () => {
    const base = weekOffsetSeconds('2026-09-07T08:00:00Z');
    for (const suffix of ['Z', '+14:00', '-12:00', '+00:00', '-00:00']) {
      expect(weekOffsetSeconds(`2026-09-07T08:00${suffix}`)).toBe(base);
      expect(weekOffsetSeconds(`2026-09-07T08:00:00${suffix}`)).toBe(base);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2. compileCalendar
 * ------------------------------------------------------------------ */

describe('compileCalendar adversarial (R-CAL-2)', () => {
  test('días repetidos y duplicados exactos colapsan en un intervalo', () => {
    const cal = compileCalendar(
      {
        intervals: [
          { days: ['MON', 'MON'], from: '09:00', to: '18:00' },
          { days: ['MON'], from: '09:00', to: '18:00' },
        ],
      },
      0,
    );

    expect(cal.intervals).toEqual([[9 * H, 18 * H]]);
    expect(cal.openPerWeek).toBe(9 * H);
  });

  test('un intervalo contenido en otro no alarga el resultado', () => {
    const cal = compileCalendar(
      {
        intervals: [
          { days: ['MON'], from: '08:00', to: '20:00' },
          { days: ['MON'], from: '10:00', to: '12:00' },
        ],
      },
      0,
    );

    expect(cal.intervals).toEqual([[8 * H, 20 * H]]);
  });

  test('la cadena de solapes y adyacencias se funde entera', () => {
    const cal = compileCalendar(
      {
        intervals: [
          { days: ['MON'], from: '14:00', to: '18:00' },
          { days: ['MON'], from: '09:00', to: '11:00' },
          { days: ['MON'], from: '10:00', to: '14:00' },
        ],
      },
      0,
    );

    expect(cal.intervals).toEqual([[9 * H, 18 * H]]);
  });

  test('los intervalos degenerados se descartan; si no queda ninguno es E-CAL-VACIO', () => {
    // El esquema ya exige `to > from` (R13), pero `core/` no puede quedarse con `openPerWeek = 0`:
    // `addWorkingTime` dividiría por cero y `nextOpen` devolvería un instante cerrado.
    const mixto = compileCalendar(
      {
        intervals: [
          { days: ['MON'], from: '09:00', to: '10:00' },
          { days: ['MON'], from: '20:00', to: '20:00' },
        ],
      },
      0,
    );

    expect(mixto.intervals).toEqual([[9 * H, 10 * H]]);
    expect(isOpen(mixto, nextOpen(mixto, 19 * H))).toBe(true);
    expect(() => compileCalendar({ intervals: [{ days: ['MON'], from: '09:00', to: '09:00' }] }, 0)).toThrow(
      /E-CAL-VACIO/,
    );
    expect(() => compileCalendar({ intervals: [{ days: ['MON'], from: '18:00', to: '09:00' }] }, 0)).toThrow(
      /E-CAL-VACIO/,
    );
  });

  test('days vacío no deja intervalos y es E-CAL-VACIO', () => {
    expect(() => compileCalendar({ intervals: [{ days: [], from: '09:00', to: '18:00' }] }, 0)).toThrow(
      /E-CAL-VACIO/,
    );
  });

  test('un día desconocido es error explícito', () => {
    const roto = { intervals: [{ days: ['LUN'], from: '09:00', to: '18:00' }] } as unknown as CalendarDef;
    expect(() => compileCalendar(roto, 0)).toThrow(/día de calendario desconocido/);
  });

  test('7×24 declarado como 00:00–23:59 deja el hueco de 1 min y addWorkingTime lo salta', () => {
    const casi = compileCalendar({ intervals: [{ days: ALL_DAYS, from: '00:00', to: '23:59' }] }, 0);

    expect(casi.intervals).toHaveLength(7); // no se funden: hay 60 s cerrados cada noche
    expect(casi.openPerWeek).toBe(WEEK - 7 * 60);
    expect(isOpen(casi, 23 * H + 59 * 60 + 30)).toBe(false);
    expect(addWorkingTime(casi, 23 * H + 59 * 60 - 60, 120)).toBe(D + 60);
    expect(openTime(casi, 0, WEEK)).toBe(casi.openPerWeek);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Propiedades de las primitivas
 * ------------------------------------------------------------------ */

function def(intervals: CalendarDef['intervals']): CalendarDef {
  return { intervals };
}

const CALENDARS: readonly (readonly [string, Calendar])[] = [
  ['oficina L–V 09–18', compileCalendar(def([{ days: WEEKDAYS_MF, from: '09:00', to: '18:00' }]), 28800)],
  [
    'turno partido con sábado',
    compileCalendar(
      def([
        { days: WEEKDAYS_MF, from: '09:00', to: '13:00' },
        { days: WEEKDAYS_MF, from: '14:00', to: '18:00' },
        { days: ['SAT'], from: '10:00', to: '14:00' },
      ]),
      0,
    ),
  ],
  ['solo domingo de madrugada', compileCalendar(def([{ days: ['SUN'], from: '00:00', to: '01:00' }]), 111111)],
  ['un minuto a la semana', compileCalendar(def([{ days: ['WED'], from: '12:00', to: '12:01' }]), 3600)],
  ['casi 24×7 con hueco nocturno', compileCalendar(def([{ days: ALL_DAYS, from: '00:00', to: '23:59' }]), 60)],
  ['24×7', alwaysOpen(28800)],
];

describe('propiedades de nextOpen, addWorkingTime y openTime (R-CAL-3)', () => {
  test('isOpen(nextOpen(t)) y nextOpen idempotente', () => {
    const random = prng(0x40a);
    for (const [name, cal] of CALENDARS) {
      for (let i = 0; i < 500; i += 1) {
        const t = Math.floor(random() * 6 * WEEK);
        const open = nextOpen(cal, t);
        expect(open, name).toBeGreaterThanOrEqual(t);
        expect(isOpen(cal, open), name).toBe(true);
        expect(nextOpen(cal, open), name).toBe(open);
        expect(openTime(cal, t, open), name).toBe(0); // no hay tiempo abierto antes de abrir
      }
    }
  });

  test('openTime(t, addWorkingTime(t, d)) === d', () => {
    const random = prng(0x40b);
    for (const [name, cal] of CALENDARS) {
      for (let i = 0; i < 500; i += 1) {
        const t = Math.floor(random() * 4 * WEEK);
        const d = 1 + Math.floor(random() * 3 * cal.openPerWeek);
        const end = addWorkingTime(cal, t, d);
        expect(end, `${name} t=${t} d=${d}`).toBeGreaterThanOrEqual(t);
        expect(openTime(cal, t, end), `${name} t=${t} d=${d}`).toBe(d);
        expect(isOpen(cal, end - 0.5), `${name} t=${t} d=${d}`).toBe(true);
      }
    }
  });

  test('addWorkingTime(t, openTime(t, u)) ≤ u, con igualdad si u está abierto', () => {
    const random = prng(0x40c);
    for (const [name, cal] of CALENDARS) {
      for (let i = 0; i < 500; i += 1) {
        const t = Math.floor(random() * 3 * WEEK);
        const u = t + Math.floor(random() * 3 * WEEK);
        const open = openTime(cal, t, u);
        const back = addWorkingTime(cal, t, open);
        expect(back, `${name} t=${t} u=${u}`).toBeLessThanOrEqual(u);
        if (open > 0 && isOpen(cal, u)) expect(back, `${name} t=${t} u=${u}`).toBe(u);
      }
    }
  });

  test('monótona en t y en d', () => {
    const random = prng(0x40d);
    for (const [name, cal] of CALENDARS) {
      for (let i = 0; i < 300; i += 1) {
        const t = Math.floor(random() * 2 * WEEK);
        const dt = Math.floor(random() * WEEK);
        const d = 1 + Math.floor(random() * cal.openPerWeek);
        const dd = Math.floor(random() * cal.openPerWeek);
        expect(addWorkingTime(cal, t, d), name).toBeLessThanOrEqual(addWorkingTime(cal, t + dt, d));
        expect(addWorkingTime(cal, t, d), name).toBeLessThanOrEqual(addWorkingTime(cal, t, d + dd));
      }
    }
  });

  test('openTime es aditiva por tramos', () => {
    const random = prng(0x40e);
    for (const [name, cal] of CALENDARS) {
      for (let i = 0; i < 300; i += 1) {
        const a = Math.floor(random() * 2 * WEEK);
        const b = a + Math.floor(random() * 2 * WEEK);
        const c = b + Math.floor(random() * 2 * WEEK);
        expect(openTime(cal, a, b) + openTime(cal, b, c), name).toBe(openTime(cal, a, c));
      }
    }
  });

  test('un d de años termina en microsegundos y sigue siendo exacto', { timeout: 3000 }, () => {
    const [, cal] = CALENDARS[0] as readonly [string, Calendar];
    const cincoAnios = 5 * 52 * cal.openPerWeek;

    for (let i = 0; i < 200_000; i += 1) {
      addWorkingTime(cal, i, cincoAnios);
    }

    // 52 semanas exactas de trabajo desde un lunes 09:00 acaban al cierre del viernes 52.
    const lunes9 = 9 * H - cal.offset;
    expect(addWorkingTime(cal, lunes9, 52 * cal.openPerWeek)).toBe(lunes9 + 51 * WEEK + 4 * D + 9 * H);
    expect(openTime(cal, lunes9, addWorkingTime(cal, lunes9, cincoAnios))).toBe(cincoAnios);
  });

  test('flotantes: fracciones, -0 y acumulación tras muchas semanas', () => {
    const [, cal] = CALENDARS[0] as readonly [string, Calendar];
    const lunes9 = 9 * H - cal.offset;

    expect(Object.is(addWorkingTime(cal, 5, -0), 5)).toBe(true);
    expect(Object.is(addWorkingTime(cal, 5, 0), 5)).toBe(true);
    expect(addWorkingTime(cal, lunes9, 0.1 + 0.2)).toBeCloseTo(lunes9 + 0.30000000000000004, 9);
    expect(openTime(cal, lunes9, addWorkingTime(cal, lunes9, 0.1 + 0.2))).toBeCloseTo(0.1 + 0.2, 9);

    // 300 semanas de trabajo más medio segundo: sin deriva acumulada.
    const d = 300 * cal.openPerWeek + 0.5;
    expect(addWorkingTime(cal, lunes9, d)).toBe(lunes9 + 300 * WEEK + 0.5);
    expect(openTime(cal, lunes9, addWorkingTime(cal, lunes9, d))).toBe(d);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Álgebra de intersect
 * ------------------------------------------------------------------ */

describe('álgebra de intersect (R-CAL-4)', () => {
  const a = compileCalendar(def([{ days: WEEKDAYS_MF, from: '09:00', to: '18:00' }]), 28800);
  const b = compileCalendar(
    def([
      { days: WEEKDAYS_MF, from: '08:00', to: '12:00' },
      { days: ['MON', 'WED', 'FRI'], from: '13:00', to: '22:00' },
      { days: ['SAT'], from: '09:00', to: '14:00' },
    ]),
    28800,
  );
  const c = compileCalendar(
    def([
      { days: ALL_DAYS, from: '10:00', to: '16:00' },
      { days: ['MON'], from: '17:00', to: '19:00' },
    ]),
    28800,
  );

  test('conmutativa, asociativa e idempotente', () => {
    expect(intersect(a, b).intervals).toEqual(intersect(b, a).intervals);
    expect(intersect(intersect(a, b), c).intervals).toEqual(intersect(a, intersect(b, c)).intervals);
    expect(intersect(a, a).intervals).toEqual(a.intervals);
    expect(intersect(b, b).intervals).toEqual(b.intervals);
  });

  test('24×7 es el elemento neutro por los dos lados', () => {
    const flat = alwaysOpen(28800);
    for (const cal of [a, b, c]) {
      expect(intersect(cal, flat).intervals).toEqual(cal.intervals);
      expect(intersect(flat, cal).intervals).toEqual(cal.intervals);
      expect(intersect(cal, flat).openPerWeek).toBe(cal.openPerWeek);
    }
  });

  test('la intersección coincide con isOpen punto a punto', () => {
    const random = prng(0x40f);
    const both = intersect(a, b);
    for (let i = 0; i < 2000; i += 1) {
      const t = Math.floor(random() * 3 * WEEK);
      expect(isOpen(both, t)).toBe(isOpen(a, t) && isOpen(b, t));
    }
  });

  test('intervalos que solo se tocan dan intersección vacía ⇒ E-CAL-VACIO', () => {
    const manana = compileCalendar(def([{ days: ['MON'], from: '09:00', to: '12:00' }]), 0);
    const tarde = compileCalendar(def([{ days: ['MON'], from: '12:00', to: '18:00' }]), 0);
    expect(() => intersect(manana, tarde)).toThrow(/E-CAL-VACIO/);
    expect(() => intersect(tarde, manana)).toThrow(/E-CAL-VACIO/);
  });

  test('la intersección nunca abre más que sus operandos', () => {
    for (const [left, right] of [
      [a, b],
      [b, c],
      [a, c],
    ] as const) {
      const both = intersect(left, right);
      expect(both.openPerWeek).toBeLessThanOrEqual(Math.min(left.openPerWeek, right.openPerWeek));
    }
  });
});

/* ------------------------------------------------------------------ *
 * 5. Oráculo por fuerza bruta
 * ------------------------------------------------------------------ */

describe('las primitivas contra una referencia minuto a minuto', () => {
  /** `true` si el minuto `m` (desde `t = 0`) está abierto, recorriendo los intervalos a pelo. */
  function openMinute(cal: Calendar, minute: number): boolean {
    const p = (minute * 60 + cal.offset) % WEEK;
    return cal.intervals.some(([start, end]) => p >= start && p < end);
  }

  test('openTime, nextOpen y addWorkingTime coinciden con el conteo directo de minutos', () => {
    const random = prng(0x40f0);
    const casos: readonly Calendar[] = [
      compileCalendar(
        def([
          { days: ['MON', 'WED', 'FRI'], from: '09:00', to: '13:00' },
          { days: ['MON', 'WED', 'FRI'], from: '14:00', to: '17:30' },
          { days: ['SUN'], from: '22:00', to: '23:59' },
        ]),
        4 * 3600 + 17 * 60,
      ),
      compileCalendar(def([{ days: ['TUE', 'THU'], from: '00:00', to: '06:00' }]), 0),
    ];

    for (const cal of casos) {
      const abierto: boolean[] = [];
      for (let m = 0; m < 3 * 7 * 24 * 60; m += 1) abierto.push(openMinute(cal, m));

      for (let i = 0; i < 200; i += 1) {
        const from = Math.floor(random() * 7 * 24 * 60);
        const to = from + Math.floor(random() * 14 * 24 * 60);

        let minutos = 0;
        for (let m = from; m < to; m += 1) if (abierto[m] === true) minutos += 1;
        expect(openTime(cal, from * 60, to * 60)).toBe(minutos * 60);

        // Los intervalos y el offset de estos calendarios son minutos exactos.
        let siguiente = from;
        while (abierto[siguiente] !== true) siguiente += 1;
        expect(nextOpen(cal, from * 60)).toBe(siguiente * 60);

        // d minutos de trabajo: el minuto abierto número d marca el final.
        const d = 1 + Math.floor(random() * 400);
        let restantes = d;
        let m = from;
        while (restantes > 0) {
          if (abierto[m] === true) restantes -= 1;
          m += 1;
        }
        expect(addWorkingTime(cal, from * 60, d * 60)).toBe(m * 60);
      }
    }
  });
});
