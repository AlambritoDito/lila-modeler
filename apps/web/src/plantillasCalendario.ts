/**
 * Calendar templates of the calendar manager (Lote M, C3): presets of `intervals` (§ 2.3), so a
 * calendar created from one is born with hours and never trips E-CAL-VACIO (R-CAL-2). Only
 * «Blank» is born empty, and the manager says so next to it.
 *
 * Pure data and helpers; the names shown come from the catalog (`S.gcal.plantillas`).
 */
import { DIAS, enMinutos, type Intervalo } from './CalendarEditor.js';

export const PLANTILLAS = ['laborable', 'continuo', 'extendido', 'enBlanco'] as const;
export type Plantilla = (typeof PLANTILLAS)[number];

/** The intervals each template writes. `24:00` closes the day (R13), so 24/7 loses no minute. */
export function intervalosDePlantilla(plantilla: Plantilla): Intervalo[] {
  switch (plantilla) {
    case 'laborable':
      return [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '09:00', to: '18:00' }];
    case 'continuo':
      return [{ days: [...DIAS], from: '00:00', to: '24:00' }];
    case 'extendido':
      return [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], from: '06:00', to: '22:00' }];
    case 'enBlanco':
      return [];
  }
}

/** `true` for an entry of the weekly selector (`days`); monthly and yearly ones are repetitions. */
export function esSemanal(intervalo: Intervalo): boolean {
  return (
    intervalo.monthDays === undefined && intervalo.monthWeekdays === undefined && intervalo.dates === undefined
  );
}

/**
 * Applying a template to an existing calendar replaces its **weekly** hours only: the monthly
 * and yearly repetitions (#82) are a different tab and stay as written.
 */
export function aplicarPlantilla(intervals: readonly Intervalo[], plantilla: Plantilla): Intervalo[] {
  return [...intervalosDePlantilla(plantilla), ...intervals.filter((iv) => !esSemanal(iv))];
}

/** «Clear»: drops the weekly hours, keeps the repetitions. */
export function vaciarSemana(intervals: readonly Intervalo[]): Intervalo[] {
  return intervals.filter((iv) => !esSemanal(iv));
}

/**
 * The first free key for `base`: `base`, then `base 2`, `base 3`… The key is the calendar's name
 * (the format has no `name`, ANALISIS § B), so it has to be unique in `calendars`.
 */
export function nombreLibre(base: string, existentes: readonly string[]): string {
  if (!existentes.includes(base)) return base;
  let n = 2;
  while (existentes.includes(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/**
 * Open hours per week of the weekly entries, at minute resolution and as a union (§ 2.3:
 * overlapping entries do not add up). Monthly and yearly entries are not weekly hours and are
 * left out; anything malformed is ignored, the validator already flags it.
 */
export function horasSemana(intervals: readonly Intervalo[]): number {
  const abiertos = new Uint8Array(7 * 1440);
  for (const intervalo of intervals) {
    if (!esSemanal(intervalo) || !Array.isArray(intervalo.days)) continue;
    const desde = enMinutos(intervalo.from);
    const hasta = enMinutos(intervalo.to);
    if (desde === null || hasta === null || hasta <= desde) continue;
    for (const nombre of intervalo.days) {
      const dia = DIAS.indexOf(nombre);
      if (dia < 0) continue;
      abiertos.fill(1, dia * 1440 + desde, dia * 1440 + Math.min(hasta, 1440));
    }
  }
  let minutos = 0;
  for (const m of abiertos) minutos += m;
  return minutos / 60;
}
