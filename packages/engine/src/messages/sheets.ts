/**
 * Texts of the scenario import from Excel/CSV (issue #449), English and Spanish.
 *
 * They live in their own file rather than in `en.ts`/`es.ts` because none of them is an `E-*`/`W-*`
 * code: an import report is advice about a spreadsheet, not a defect of the scenario, and the
 * scenario the import produces is linted afterwards with the usual codes. `messages.test.ts` does
 * not see this catalog, so `test/scenario-sheets.test.ts` checks that both languages declare the
 * same entries.
 */
import type { Locale } from './types.js';

export interface SheetMessages {
  /** `Elements, row 4, column mean`; `column` is the header as written in the file. */
  where: (sheet: string, row: number, column: string | undefined) => string;
  unknownTable: (name: string, accepted: string) => string;
  unknownColumn: (column: string) => string;
  missingKeyColumn: (columns: string) => string;
  noKey: () => string;
  notFound: (key: string) => string;
  ambiguous: (name: string, ids: string) => string;
  duplicateRow: (key: string, firstRow: number) => string;
  unknownDistribution: (value: string, accepted: string) => string;
  missingDistribution: () => string;
  parameterNotApplicable: (parameter: string, type: string) => string;
  notANumber: (value: string) => string;
  notAWholeNumber: (value: string) => string;
  nonNegative: () => string;
  atLeastOne: () => string;
  probabilityRange: () => string;
  unknownUnit: (value: string, accepted: string) => string;
  unknownValue: (value: string, accepted: string) => string;
  badPoints: (value: string) => string;
  badSlices: (value: string) => string;
  unknownCalendar: (id: string) => string;
  unknownResource: (key: string) => string;
  duplicateResource: (key: string) => string;
  badDays: (value: string) => string;
  badTime: (value: string) => string;
  calendarNotWeekly: (id: string) => string;
  groupNotApplied: (key: string) => string;
}

const en: SheetMessages = {
  where: (sheet, row, column) => (column === undefined ? `${sheet}, row ${row}` : `${sheet}, row ${row}, column ${column}`),
  unknownTable: (name, accepted) => `sheet "${name}" is not one of ${accepted}; it was ignored.`,
  unknownColumn: (column) => `column "${column}" is not part of this sheet; it was ignored.`,
  missingKeyColumn: (columns) => `the sheet needs a ${columns} column to know which row is which; it was ignored.`,
  noKey: () => 'the row has values but neither an id nor a name; it was not applied.',
  notFound: (key) => `"${key}" does not match anything in the model or the scenario; the row was not applied.`,
  ambiguous: (name, ids) => `the name "${name}" is shared by ${ids}; write the id to choose one. The row was not applied.`,
  duplicateRow: (key, firstRow) => `"${key}" was already set in row ${firstRow}; this row was not applied.`,
  unknownDistribution: (value, accepted) => `unknown distribution "${value}"; use one of ${accepted}.`,
  missingDistribution: () => 'there are distribution parameters but no distribution type.',
  parameterNotApplicable: (parameter, type) => `"${parameter}" is not a parameter of the ${type} distribution; leave it empty.`,
  notANumber: (value) => `"${value}" is not a number.`,
  notAWholeNumber: (value) => `"${value}" is not a whole number.`,
  nonNegative: () => 'must be a number ≥ 0.',
  atLeastOne: () => 'must be a whole number ≥ 1.',
  probabilityRange: () => 'must be a probability between 0 and 1 (or 0% and 100%).',
  unknownUnit: (value, accepted) => `unknown time unit "${value}"; use one of ${accepted}.`,
  unknownValue: (value, accepted) => `"${value}" is not valid here; use one of ${accepted}.`,
  badPoints: (value) => `"${value}" is not a list of value:probability pairs separated by ";".`,
  badSlices: (value) => `"${value}" is not a number nor a list of calendar:capacity pairs separated by ";".`,
  unknownCalendar: (id) => `calendar "${id}" does not exist in the scenario nor in the Calendars sheet.`,
  unknownResource: (key) => `resource "${key}" does not exist in the scenario nor in the Resources sheet.`,
  duplicateResource: (key) => `resource "${key}" is assigned twice to the same element.`,
  badDays: (value) => `"${value}" is not a list of days (MON,TUE… or MON-FRI).`,
  badTime: (value) => `"${value}" is not a time of day (HH:MM, 24:00 allowed as the end).`,
  calendarNotWeekly: (id) =>
    `calendar "${id}" uses monthly or yearly dates, which this sheet cannot express; it was left as it is.`,
  groupNotApplied: (key) => `because of the rows above, "${key}" keeps its current values.`,
};

const es: SheetMessages = {
  where: (sheet, row, column) => (column === undefined ? `${sheet}, fila ${row}` : `${sheet}, fila ${row}, columna ${column}`),
  unknownTable: (name, accepted) => `la hoja «${name}» no es ninguna de ${accepted}; se ignoró.`,
  unknownColumn: (column) => `la columna «${column}» no es de esta hoja; se ignoró.`,
  missingKeyColumn: (columns) => `la hoja necesita una columna ${columns} para saber qué fila es cuál; se ignoró.`,
  noKey: () => 'la fila tiene valores pero ni id ni nombre; no se aplicó.',
  notFound: (key) => `«${key}» no coincide con nada del modelo ni del escenario; la fila no se aplicó.`,
  ambiguous: (name, ids) => `el nombre «${name}» lo comparten ${ids}; escribe el id para elegir uno. La fila no se aplicó.`,
  duplicateRow: (key, firstRow) => `«${key}» ya se definió en la fila ${firstRow}; esta fila no se aplicó.`,
  unknownDistribution: (value, accepted) => `distribución desconocida «${value}»; usa una de ${accepted}.`,
  missingDistribution: () => 'hay parámetros de distribución pero falta el tipo de distribución.',
  parameterNotApplicable: (parameter, type) => `«${parameter}» no es un parámetro de la distribución ${type}; déjalo vacío.`,
  notANumber: (value) => `«${value}» no es un número.`,
  notAWholeNumber: (value) => `«${value}» no es un número entero.`,
  nonNegative: () => 'debe ser un número ≥ 0.',
  atLeastOne: () => 'debe ser un número entero ≥ 1.',
  probabilityRange: () => 'debe ser una probabilidad entre 0 y 1 (o entre 0 % y 100 %).',
  unknownUnit: (value, accepted) => `unidad de tiempo desconocida «${value}»; usa una de ${accepted}.`,
  unknownValue: (value, accepted) => `«${value}» no vale aquí; usa uno de ${accepted}.`,
  badPoints: (value) => `«${value}» no es una lista de pares valor:probabilidad separados por «;».`,
  badSlices: (value) => `«${value}» no es un número ni una lista de pares calendario:capacidad separados por «;».`,
  unknownCalendar: (id) => `el calendario «${id}» no existe en el escenario ni en la hoja Calendars.`,
  unknownResource: (key) => `el recurso «${key}» no existe en el escenario ni en la hoja Resources.`,
  duplicateResource: (key) => `el recurso «${key}» está asignado dos veces al mismo elemento.`,
  badDays: (value) => `«${value}» no es una lista de días (MON,TUE… o MON-FRI; también LUN,MAR…).`,
  badTime: (value) => `«${value}» no es una hora del día (HH:MM; 24:00 vale como fin).`,
  calendarNotWeekly: (id) =>
    `el calendario «${id}» usa fechas mensuales o anuales, que esta hoja no sabe expresar; se dejó como estaba.`,
  groupNotApplied: (key) => `por las filas anteriores, «${key}» conserva sus valores actuales.`,
};

export const SHEET_MESSAGES: Readonly<Record<Locale, SheetMessages>> = { en, es };

export function sheetMessages(locale: Locale = 'en'): SheetMessages {
  return SHEET_MESSAGES[locale] ?? en;
}
