/**
 * #449 — scenario parameters from Excel/CSV: template, reader and import plan.
 *
 * The acceptance of the issue, one `describe` each: (a) template → import without edits is the
 * identical scenario; (b) a Spanish CSV (`;` and decimal comma); (c) unmatched rows and ambiguous
 * names are reported and nothing of those rows is applied; (d) invalid values say sheet, row and
 * column; (e) what the import produces passes `validateScenario`.
 */
import { readFileSync } from 'node:fs';

import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';

import { parseBpmn } from '../src/bpmn/index.js';
import { loadResolvedScenario } from '../src/cli-shared.js';

import { SHEET_MESSAGES } from '../src/messages/sheets.js';
import { parseScenario, validateScenario } from '../src/scenario.js';
import {
  applyImportChanges,
  describeImportValue,
  parseNumber,
  planScenarioImport,
  readScenarioFile,
  scenarioTemplate,
  type ImportPlan,
  type ReadSheet,
} from '../src/scenario-sheets.js';
import { WorkbookReadError, readCsv, readWorkbook } from '../src/xlsx-read.js';
import { AS_IS, clone, pedidoIr } from './pedido.fixtures.js';

const csv = (name: string, text: string): ReadSheet[] => readScenarioFile(name, strToU8(text));

function asIs(): Record<string, unknown> {
  return clone(AS_IS) as unknown as Record<string, unknown>;
}

function errorsOf(scenario: Record<string, unknown>): string[] {
  const parsed = parseScenario(scenario);
  if (!parsed.success) return parsed.error.issues.map((issue) => issue.message);
  return validateScenario(parsed.data, pedidoIr())
    .filter((problem) => problem.severity === 'error')
    .map((problem) => problem.message);
}

function roundTrip(scenario: Record<string, unknown>): ImportPlan {
  const bytes = scenarioTemplate(scenario, pedidoIr());
  return planScenarioImport(readWorkbook(bytes), scenario, pedidoIr());
}

describe('(a) template → import without edits', () => {
  test('the AS-IS of examples/pedido comes back identical', () => {
    const scenario = asIs();
    const plan = roundTrip(scenario);
    expect(plan.issues).toEqual([]);
    expect(plan.changes).toEqual([]);
    expect(applyImportChanges(scenario, plan.changes)).toEqual(scenario);
    expect(plan.tables.map((t) => t.sheet)).toEqual(['Elements', 'Arrivals', 'Resources', 'Assignments', 'Calendars']);
  });

  test('the real examples/pedido model and its resolved TO-BE come back identical', async () => {
    const dir = new URL('../../../examples/pedido/', import.meta.url);
    const { ir } = await parseBpmn(readFileSync(new URL('model.bpmn', dir), 'utf8'));
    const scenario = loadResolvedScenario(new URL('to-be-3-cajeros.scenario.json', dir).pathname) as unknown as Record<string, unknown>;
    const sheets = readWorkbook(scenarioTemplate(scenario, ir));
    // Every task gets its row, parameterised or not (Pack order has no parameters).
    expect(sheets[0]!.rows.map((row) => row[0])).toContain('Task_Empacar');
    const plan = planScenarioImport(sheets, scenario, ir);
    expect(plan.issues).toEqual([]);
    expect(plan.changes).toEqual([]);
  });

  test('calendars with dated selectors or holidays (#82) are left out and kept whole, with a note', () => {
    const scenario = asIs();
    const calendars = scenario['calendars'] as Record<string, unknown>;
    calendars['cierre'] = { intervals: [{ monthDays: [-1], from: '09:00', to: '13:00' }] };
    calendars['feriados'] = {
      intervals: [{ days: ['MON'], from: '09:00', to: '10:00' }],
      holidays: ['12-25', '2026-09-16'],
    };
    const sheets = readWorkbook(scenarioTemplate(scenario, pedidoIr()));
    const ids = sheets.find((sheet) => sheet.name === 'Calendars')!.rows.map((row) => row[0]);
    expect(ids).not.toContain('cierre');
    expect(ids).not.toContain('feriados');

    const plan = planScenarioImport(sheets, scenario, pedidoIr());
    expect(plan.changes).toEqual([]);
    expect(plan.issues.map((issue) => [issue.kind, issue.message])).toEqual([
      ['warning', 'calendar "cierre" uses monthDays, monthWeekdays, dates or holidays, which this sheet does not edit; it was kept untouched.'],
      ['warning', 'calendar "feriados" uses monthDays, monthWeekdays, dates or holidays, which this sheet does not edit; it was kept untouched.'],
    ]);

    // Rows that name them are not applied either, in either language.
    const edit = planScenarioImport(
      csv('calendarios.csv', 'id;days;from;to\ncierre;MON;08:00;09:00\nferiados;TUE;08:00;09:00\n'),
      scenario,
      pedidoIr(),
      { locale: 'es' },
    );
    expect(edit.changes).toEqual([]);
    expect(edit.issues.map((issue) => issue.text)).toEqual([
      'calendarios, fila 2: el calendario «cierre» usa monthDays, monthWeekdays, dates o festivos (holidays), que esta hoja no edita; se conservó intacto.',
      'calendarios, fila 3: el calendario «feriados» usa monthDays, monthWeekdays, dates o festivos (holidays), que esta hoja no edita; se conservó intacto.',
    ]);
    expect(applyImportChanges(scenario, edit.changes)).toEqual(scenario);
  });

  test('slices, user points and times that do not divide the base unit survive too', () => {
    const scenario = asIs();
    const calendars = scenario['calendars'] as Record<string, unknown>;
    calendars['noche'] = { intervals: [{ days: ['SAT', 'SUN'], from: '22:00', to: '24:00' }] };
    const resources = scenario['resources'] as Record<string, Record<string, unknown>>;
    resources['horno']!['capacity'] = [
      { calendar: 'oficina', capacity: 2 },
      { calendar: 'noche', capacity: 1 },
    ];
    const elements = scenario['elements'] as Record<string, Record<string, unknown>>;
    // 100 s is 1.666… min: the template has to fall back to seconds for that row.
    elements['Task_Preparar']!['processingTime'] = { type: 'uniform', min: 100, max: 130.5 };
    elements['Timer_Reposo']!['processingTime'] = {
      type: 'user',
      points: [
        { value: 60, probability: 0.25 },
        { value: 600, probability: 0.75 },
      ],
    };
    elements['Task_Revisar']!['processingTime'] = { type: 'gamma', shape: 2.5, scale: 37 };
    const plan = roundTrip(scenario);
    expect(plan.issues).toEqual([]);
    expect(plan.changes).toEqual([]);
  });

  test('the template writes times in run.baseTimeUnit when they convert exactly', () => {
    const sheets = readWorkbook(scenarioTemplate(asIs(), pedidoIr()));
    const elements = sheets.find((sheet) => sheet.name === 'Elements')!;
    const header = elements.rows[0]!;
    const row = elements.rows.find((cells) => cells[0] === 'Task_TomarPedido')!;
    const at = (column: string): unknown => row[header.indexOf(column)];
    expect([at('distribution'), at('unit'), at('min'), at('mode'), at('max')]).toEqual(['triangular', 'min', 1, 2, 5]);
  });
});

describe('(b) CSV from a Spanish Excel', () => {
  test('`;` as separator, decimal comma, match by name, Windows-1252 bytes', () => {
    const text = 'sep=;\r\nid;name;distribution;unit;mean;sd;fixedCost\r\n;  PREPARAR ;normal;min;8,5;1,25;"1.234,5"\r\n';
    // «Revisión» in Windows-1252: the ó is one byte (0xF3), not valid UTF-8.
    const bytes = new Uint8Array([...strToU8(text), ...strToU8(';Revisi'), 0xf3, ...strToU8('n;;;;;;\r\n')]);
    const sheets = readScenarioFile('tiempos.csv', bytes);
    expect(sheets[0]!.rows[2]![1]).toBe('Revisión');

    const plan = planScenarioImport(sheets, asIs(), pedidoIr());
    expect(plan.tables).toEqual([{ table: 'elements', sheet: 'tiempos', rows: 2 }]);
    expect(plan.issues).toEqual([]);
    const result = applyImportChanges(asIs(), plan.changes);
    const preparar = (result['elements'] as Record<string, Record<string, unknown>>)['Task_Preparar']!;
    expect(preparar['processingTime']).toEqual({ type: 'normal', mean: 510, sd: 75 });
    expect(preparar['fixedCost']).toBe(1234.5);
    expect(errorsOf(result)).toEqual([]);
  });

  test('the table of a CSV comes from its file name or, failing that, from its columns', () => {
    const plan = planScenarioImport(
      csv('export.csv', 'resourceName,elementName,quantity\nCashier,Take order,2\n'),
      asIs(),
      pedidoIr(),
    );
    expect(plan.tables[0]!.table).toBe('assignments');
    expect(plan.changes).toMatchObject([{ path: ['elements', 'Task_TomarPedido', 'resources'], after: [{ ref: 'cajero', quantity: 2 }] }]);
  });

  test('parseNumber follows the style of the file: `;` means decimal comma, `,` means decimal dot', () => {
    const comma = (text: string): number | null => parseNumber(text, 'comma');
    const dot = (text: string): number | null => parseNumber(text, 'dot');
    expect([comma('1,5'), comma('1.500'), comma('12.500'), comma('1.234.567'), comma('1.234,5'), comma('1 234,5'), comma('0,375'), comma('78%'), comma('1,5%'), comma(',5')]).toEqual([
      1.5, 1500, 12500, 1234567, 1234.5, 1234.5, 0.375, 0.78, 0.015, 0.5,
    ]);
    expect([dot('1.5'), dot('1,500'), dot('1,234'), dot('1,234,567'), dot('1,234.5'), dot('1 234'), dot('.5'), dot('1e3'), dot('-5')]).toEqual([
      1.5, 1500, 1234, 1234567, 1234.5, 1234, 0.5, 1000, -5,
    ]);
    // A separator that is not the decimal one has to group by three: no guessing.
    for (const text of ['1.5', '1,234.5', '1,2,3', '12.34.5']) expect(comma(text), text).toBeNaN();
    for (const text of ['1,5', '1.234,5', '1,2,3', '0,375', '1 234,5']) expect(dot(text), text).toBeNaN();
    expect(comma('0.375')).toBeNaN();
    // Not finite, not a number.
    for (const text of ['1e999', '1E+309', 'Infinity', 'abc', '0x10', '(5)', '$1,200']) expect(dot(text), text).toBeNaN();
    expect(parseNumber(Number.POSITIVE_INFINITY)).toBeNaN();
    expect(dot('')).toBeNull();
  });

  test('the delimiter decides: 1.500 is 1500 in a `;` file and 1,234 is 1234 in a quoted `,` file', () => {
    const es = planScenarioImport(csv('Recursos.csv', '\uFEFFid;costPerHour\ncajero;1.500\ncocinero;12,5\n'), asIs(), pedidoIr());
    expect(es.changes.map((change) => change.after)).toEqual([1500, 12.5]);
    const en = planScenarioImport(csv('Resources-en.csv', 'id,costPerHour\ncajero,"1,234"\ncocinero,12.5\n'), asIs(), pedidoIr());
    expect(en.changes.map((change) => change.after)).toEqual([1234, 12.5]);
    const wrong = planScenarioImport(csv('Resources.csv', 'id;costPerHour;fixedCost\ncajero;1.5;1e999\n'), asIs(), pedidoIr());
    expect(wrong.changes).toEqual([]);
    expect(wrong.issues.map((issue) => issue.text)).toEqual([
      'Resources, row 2, column costPerHour: "1.5" is not a number in this file, which writes decimals with "," and thousands with ".".',
      'Resources, row 2, column fixedCost: "1e999" is not a number in this file, which writes decimals with "," and thousands with ".".',
    ]);
  });

  test('a text cell of a workbook uses the language of the app, and an ambiguous one gets a note', () => {
    const sheet = (value: string): ReadSheet[] => [{ name: 'Resources', rows: [['id', 'costPerHour'], ['cajero', value]] }];
    const es = planScenarioImport(sheet('1.500'), asIs(), pedidoIr(), { locale: 'es' });
    expect(es.changes[0]!.after).toBe(1500);
    expect(es.issues.map((issue) => [issue.kind, issue.column])).toEqual([['warning', 'costPerHour']]);
    const en = planScenarioImport(sheet('1.500'), asIs(), pedidoIr());
    expect(en.changes[0]!.after).toBe(1.5);
    expect(en.issues[0]!.message).toBe('"1.500" is text that could be thousands or decimals; it was read as 1.5. Type it as a number in the cell to avoid doubt.');
    expect(planScenarioImport(sheet('12,5'), asIs(), pedidoIr(), { locale: 'es' }).issues).toEqual([]);
  });

  test('readCsv keeps quoted separators, quotes and line breaks', () => {
    const table = readCsv('a,b\n"x, y","he said ""hi"""\n"two\nlines",\n');
    expect(table.delimiter).toBe(',');
    expect(table.rows).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
      ['two\nlines', null],
    ]);
  });
});

describe('(c) rows that match nothing, and ambiguous names', () => {
  test('are reported, and nothing of those rows is applied', () => {
    const ir = pedidoIr();
    ir.nodes['Task_Revisar']!.name = 'Take order'; // now two tasks share the name
    const sheets = csv(
      'elements.csv',
      'id;name;distribution;mean\n;take  ORDER;exponential;30\nTask_Nope;;exponential;30\n;Nothing here;exponential;30\n;Preparar;exponential;30\n',
    );
    const plan = planScenarioImport(sheets, asIs(), ir);
    expect(plan.issues.map((issue) => [issue.kind, issue.row, issue.column])).toEqual([
      ['ambiguous', 2, 'name'],
      ['unmatched', 3, 'id'],
      ['unmatched', 4, 'name'],
    ]);
    expect(plan.issues[0]!.message).toContain('Task_TomarPedido, Task_Revisar');
    expect(plan.changes.map((change) => change.path.join('.'))).toEqual(['elements.Task_Preparar.processingTime']);
  });

  test('an assignment with an unknown resource leaves the whole element as it was', () => {
    const plan = planScenarioImport(
      csv('assignments.csv', 'elementId,resourceId\nTask_Preparar,cocinero\nTask_Preparar,chef\n'),
      asIs(),
      pedidoIr(),
    );
    expect(plan.changes).toEqual([]);
    expect(plan.issues.map((issue) => [issue.kind, issue.row])).toEqual([
      ['unmatched', 3],
      ['warning', 2],
    ]);
  });

  test('a resource matches by its name; an unknown id is a new pool', () => {
    const plan = planScenarioImport(
      csv('recursos.csv', 'id;name;capacity;costPerHour\n;cashier;4;\nrepartidor;Driver;2;95,5\n'),
      asIs(),
      pedidoIr(),
    );
    expect(plan.issues).toEqual([]);
    expect(plan.changes.map((change) => [change.path.join('.'), change.after])).toEqual([
      ['resources.cajero.capacity', 4],
      ['resources.repartidor', { name: 'Driver', capacity: 2, costPerHour: 95.5 }],
    ]);
  });
});

describe('ids from the file never reach Object.prototype', () => {
  test('__proto__, constructor and prototype are row errors; inherited names match nothing', () => {
    const plan = planScenarioImport(
      [
        ...csv('Elements.csv', 'id;fixedCost;calendar\n__proto__;7;\ntoString;7;\nconstructor;7;\nTask_Preparar;1;constructor\n'),
        ...csv('Resources.csv', 'id;capacity;costPerHour\n__proto__;3;99\nprototype;3;99\n'),
        ...csv('Calendars.csv', 'id;days;from;to\n__proto__;MON;09:00;10:00\n'),
        ...csv('Assignments.csv', 'elementId;resourceId\nTask_Preparar;hasOwnProperty\nTask_Revisar;__proto__\n'),
        ...csv('Arrivals.csv', 'name;distribution;mean\nhasOwnProperty;constructor;3\n'),
      ],
      asIs(),
      pedidoIr(),
    );
    const probe = {} as Record<string, unknown>;
    for (const key of ['fixedCost', 'capacity', 'costPerHour', 'intervals', 'resources']) expect(probe[key], key).toBeUndefined();
    expect(Object.getOwnPropertyNames(Object.prototype).sort()).not.toContain('fixedCost');
    expect(plan.changes).toEqual([]);
    expect(plan.issues.map((issue) => [issue.sheet, issue.row, issue.kind])).toEqual([
      ['Calendars', 2, 'error'],
      ['Resources', 2, 'error'],
      ['Resources', 3, 'error'],
      ['Elements', 2, 'error'],
      ['Elements', 3, 'unmatched'],
      ['Elements', 4, 'error'],
      ['Elements', 5, 'error'],
      ['Arrivals', 2, 'unmatched'],
      ['Assignments', 2, 'unmatched'],
      ['Assignments', 3, 'error'],
      ['Assignments', 2, 'warning'],
      ['Assignments', 3, 'warning'],
    ]);
    expect(plan.issues[0]!.message).toBe('"__proto__" cannot be used as an id; the row was not applied.');
  });
});

describe('(d) invalid values name the sheet, the row and the column', () => {
  test('unknown distribution, negative numbers and bad references', () => {
    const sheets = csv(
      'Elements.csv',
      [
        'id,distribution,mean,min,max,fixedCost,calendar,probability',
        'Task_TomarPedido,gaussian,5,,,,,',
        'Task_Preparar,exponential,-3,,,,,',
        'Task_Revisar,uniform,,9,1,,,',
        'Timer_Reposo,,,,,-1,noche,',
        'Flow_Aprobado,,,,,,,1.5',
      ].join('\n'),
    );
    const plan = planScenarioImport(sheets, asIs(), pedidoIr());
    expect(plan.changes).toEqual([]);
    const texts = plan.issues.map((issue) => issue.text);
    expect(texts[0]).toMatch(/^Elements, row 2, column distribution: unknown distribution "gaussian"; use one of constant, /);
    expect(texts[1]).toBe('Elements, row 3, column mean: must be > 0');
    expect(texts[2]).toMatch(/^Elements, row 4, column distribution: .*min ≤ max/);
    expect(texts[3]).toBe('Elements, row 5, column fixedCost: must be a number ≥ 0.');
    expect(texts[4]).toBe('Elements, row 5, column calendar: calendar "noche" does not exist in the scenario nor in the Calendars sheet.');
    expect(texts[5]).toMatch(/^Elements, row 6, column probability: must be a probability/);
    expect(plan.issues.every((issue) => issue.kind === 'error')).toBe(true);
  });

  test('in Spanish, with the schema messages in Spanish too', () => {
    const plan = planScenarioImport(
      csv('elementos.csv', 'id;distribution;mean\nTask_Preparar;exponencial;-3\n'),
      asIs(),
      pedidoIr(),
      { locale: 'es' },
    );
    expect(plan.issues[0]!.text).toMatch(/^elementos, fila 2, columna mean: /);
    expect(plan.issues[0]!.message).not.toMatch(/must/);
  });

  test('a parameter the distribution does not have, and a bad calendar row', () => {
    const plan = planScenarioImport(
      [
        ...csv('Elements.csv', 'id,distribution,mean,mode\nTask_Preparar,exponential,3,4\n'),
        ...csv('Calendars.csv', 'id,days,from,to\noficina,MON-FRI,09:00,18:00\noficina,FUNDAY,10:00,11:00\n'),
      ],
      asIs(),
      pedidoIr(),
    );
    expect(plan.changes).toEqual([]);
    expect(plan.issues.map((issue) => issue.text)).toEqual([
      'Calendars, row 3, column days: "FUNDAY" is not a list of days (MON,TUE… or MON-FRI).',
      'Calendars, row 2: because of the rows above, "oficina" keeps its current values.',
      'Elements, row 2, column mode: "mode" is not a parameter of the exponential distribution; leave it empty.',
    ]);
  });
});

describe('hidden sheets, copies and formulas', () => {
  test('a hidden sheet is skipped with a note; a duplicate names the sheet of the first row', () => {
    const rows = (mean: number): ReadSheet['rows'] => [['id', 'distribution', 'mean'], ['Task_Preparar', 'exponential', mean]];
    const plan = planScenarioImport(
      [
        { name: 'Elements_old', rows: [], hidden: true },
        { name: 'Elements', rows: rows(7) },
        { name: 'Elements (2)', rows: rows(8) },
      ],
      asIs(),
      pedidoIr(),
    );
    expect(plan.changes.map((change) => [change.sheet, change.after])).toEqual([['Elements', { type: 'exponential', mean: 420 }]]);
    expect(plan.issues.map((issue) => issue.text)).toEqual([
      'Elements_old, row 1: sheet "Elements_old" is hidden in the file; it was not read. Unhide it to import it.',
      'Elements (2), row 2: "Task_Preparar" was already set in Elements, row 2; this row was not applied.',
    ]);
  });

  test('a formula with no saved result is a note, not a silent empty cell', () => {
    const plan = planScenarioImport(
      [{ name: 'Resources', rows: [['id', 'capacity'], ['horno', null]], uncached: [{ row: 2, column: 1 }] }],
      asIs(),
      pedidoIr(),
    );
    expect(plan.issues.map((issue) => [issue.kind, issue.row, issue.column])).toEqual([['warning', 2, 'capacity']]);
  });
});

describe('calendar times', () => {
  test('seconds are dropped with a note, from text or from an Excel clock time', () => {
    const plan = planScenarioImport(
      [{ name: 'Calendars', rows: [['id', 'days', 'from', 'to'], ['turno', 'MON', '08:00:30', 17 / 24 + 59 / 1440 + 59 / 86400]] }],
      asIs(),
      pedidoIr(),
    );
    expect(plan.changes[0]!.after).toEqual({ intervals: [{ days: ['MON'], from: '08:00', to: '17:59' }] });
    expect(plan.issues.map((issue) => [issue.kind, issue.column])).toEqual([
      ['warning', 'from'],
      ['warning', 'to'],
    ]);
  });
});

describe('days and assignments', () => {
  test('days are whole names or abbreviations, never a prefix', () => {
    const plan = planScenarioImport(
      csv('Calendars.csv', 'id;days;from;to\na;Lunes-Viernes;09:00;10:00\nb;sáb. domingo;09:00;10:00\nc;Monkey;09:00;10:00\nd;Marzo;09:00;10:00\n'),
      asIs(),
      pedidoIr(),
    );
    expect(plan.changes.map((change) => (change.after as { intervals: { days: string[] }[] }).intervals[0]!.days)).toEqual([
      ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      ['SAT', 'SUN'],
    ]);
    expect(plan.issues.filter((issue) => issue.kind === 'error').map((issue) => issue.row)).toEqual([4, 5]);
  });

  test('quantity 1 written or implied is the same assignment: no change', () => {
    const plan = planScenarioImport(
      csv('Assignments.csv', 'elementId;resourceId;quantity\nTask_Preparar;cocinero;1\nTask_Preparar;horno;\n'),
      asIs(),
      pedidoIr(),
    );
    expect(plan.changes).toEqual([]);
    expect(plan.issues).toEqual([]);
  });
});

describe('(e) the imported scenario passes validateScenario', () => {
  test('what the rows make together is linted before applying, and pinned to the row', () => {
    const plan = planScenarioImport(
      [
        // The pool keeps its own calendar, and slices and a calendar exclude each other (R16).
        ...csv('Resources.csv', 'id;capacity\ncajero;oficina:2\n'),
        ...csv('Elements.csv', 'id;probability\nTask_Preparar;0,5\n'),
      ],
      asIs(),
      pedidoIr(),
    );
    expect(plan.changes).toHaveLength(2);
    const lint = plan.issues.filter((issue) => issue.kind === 'lint');
    expect(lint.map((issue) => [issue.sheet, issue.row])).toEqual([
      ['Resources', 2],
      ['Elements', 2],
    ]);
    expect(lint[0]!.text).toMatch(/^Resources, row 2: /);
  });

  test('a workbook that touches every table', () => {
    const plan = planScenarioImport(
      [
        ...csv('Calendars.csv', 'id,days,from,to\nturno,LUN-VIE,0.25,0.5\n'),
        ...csv('Resources.csv', 'id,name,type,capacity,costPerHour,calendar\nrepartidor,Driver,equipo,1,40,turno\nhorno,,,oficina:2; turno:1,,\n'),
        ...csv('Elements.csv', 'name,distribution,unit,min,mode,max,selection\nTake order,triangular,h,0.5,1,2,\nRevisar,,,,,,and\n'),
        ...csv('Arrivals.csv', 'id,distribution,unit,mean,triggerCount\nStartEvent_Pedido,exponential,min,3,500\n'),
        ...csv('Assignments.csv', 'elementId,resourceName,quantity\nTask_Revisar,Driver,\nTask_Revisar,Cashier,1\n'),
      ],
      asIs(),
      pedidoIr(),
    );
    expect(plan.issues).toEqual([]);
    const result = applyImportChanges(asIs(), plan.changes);
    expect(errorsOf(result)).toEqual([]);
    expect(result['calendars']).toMatchObject({ turno: { intervals: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '06:00', to: '12:00' }] } });
    const elements = result['elements'] as Record<string, Record<string, unknown>>;
    expect(elements['Task_TomarPedido']!['processingTime']).toEqual({ type: 'triangular', min: 1800, mode: 3600, max: 7200 });
    expect(elements['StartEvent_Pedido']!['interTriggerTimer']).toEqual({ type: 'exponential', mean: 180 });
    expect(elements['Task_Revisar']!['resources']).toEqual([{ ref: 'repartidor' }, { ref: 'cajero', quantity: 1 }]);
  });
});

describe('reader', () => {
  test('reads shared strings, rich text, sparse cells and renamed sheet parts, as Excel writes them', () => {
    const files = {
      '[Content_Types].xml': strToU8('<Types/>'),
      'xl/workbook.xml': strToU8(
        '<workbook xmlns:r="x"><sheets><sheet name="Otra" sheetId="2" r:id="rId7"/><sheet name="Resources" sheetId="1" r:id="rId3"/></sheets></workbook>',
      ),
      'xl/_rels/workbook.xml.rels': strToU8(
        '<Relationships><Relationship Id="rId3" Target="worksheets/data.xml" Type="w"/><Relationship Id="rId7" Target="/xl/worksheets/empty.xml" Type="w"/></Relationships>',
      ),
      'xl/sharedStrings.xml': strToU8(
        '<sst><si><t>id</t></si><si><r><t>cap</t></r><r><t xml:space="preserve">acity</t></r></si><si><t>caj&amp;ero</t><rPh><t>x</t></rPh></si></sst>',
      ),
      'xl/worksheets/data.xml': strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="C3" s="4"><v>2.5</v></c><c r="D3" t="b"><v>1</v></c></row></sheetData></worksheet>',
      ),
      'xl/worksheets/empty.xml': strToU8('<worksheet><sheetData/></worksheet>'),
    };
    const sheets = readWorkbook(zipSync(files));
    expect(sheets).toEqual([
      { name: 'Otra', rows: [] },
      {
        name: 'Resources',
        rows: [['id', null, 'capacity'], [], ['caj&ero', null, 2.5, true]],
      },
    ]);
  });

  test('reads parts whose elements carry a namespace prefix (OpenXML SDK)', () => {
    const sheets = readWorkbook(
      zipSync({
        'xl/workbook.xml': strToU8('<x:workbook xmlns:x="m" xmlns:r="r"><x:sheets><x:sheet name="Calendars" sheetId="1" r:id="rId1"/></x:sheets></x:workbook>'),
        'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
        'xl/worksheets/sheet1.xml': strToU8(
          '<x:worksheet><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>id</x:t></x:is></x:c><x:c r="B1"><x:v>0.375</x:v></x:c></x:row></x:sheetData></x:worksheet>',
        ),
      }),
    );
    expect(sheets).toEqual([{ name: 'Calendars', rows: [['id', 0.375]] }]);
  });

  test('hostile references and oversized parts fail fast with a reason, before allocating', () => {
    const book = (sheet: string, extra: Record<string, Uint8Array> = {}): Uint8Array =>
      zipSync({
        'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Resources" sheetId="1" r:id="rId1"/></sheets></workbook>'),
        'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
        'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
        ...extra,
      });
    const reason = (bytes: Uint8Array): unknown => {
      try {
        readWorkbook(bytes);
        return 'read';
      } catch (error) {
        return error instanceof WorkbookReadError ? error.reason : error;
      }
    };
    expect(reason(book('<row r="50000000"><c r="A50000000"><v>1</v></c></row>'))).toBe('out-of-bounds');
    expect(reason(book('<row r="1"><c r="ZZZZZZ1"><v>1</v></c></row>'))).toBe('out-of-bounds');
    // Excel's real last row and column are fine.
    expect(reason(book('<row r="1048576"><c r="XFD1048576"><v>1</v></c></row>'))).toBe('read');
    // An image is never decompressed, however large; a sheet part that expands too much is refused.
    expect(reason(book('<row r="1"/>', { 'xl/media/image1.png': new Uint8Array(60 * 1024 * 1024) }))).toBe('read');
    expect(reason(book('<row r="1"/>', { 'xl/worksheets/sheet2.xml': new Uint8Array(60 * 1024 * 1024) }))).toBe('too-large');
    expect(reason(strToU8('id,name\n'))).toBe('not-a-workbook');
  });

  test('forty thousand rows with one value at XFD are refused fast, not laid out densely', () => {
    const rows = Array.from({ length: 40_000 }, (_, i) => `<row r="${i + 1}"><c r="XFD${i + 1}"><v>1</v></c></row>`).join('');
    const bytes = zipSync({
      'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="Elements" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`),
    });
    const started = performance.now();
    let reason: unknown;
    try {
      readWorkbook(bytes);
    } catch (error) {
      reason = error instanceof WorkbookReadError ? error.reason : error;
    }
    expect(reason).toBe('too-large');
    expect(performance.now() - started).toBeLessThan(1000);
  });

  test('style-only cells far to the right take no room', () => {
    const cells = Array.from({ length: 2_000 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c><c r="XFD${i + 1}" s="3"/></row>`).join('');
    const sheets = readWorkbook(
      zipSync({
        'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
        'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
        'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${cells}</sheetData></worksheet>`),
      }),
    );
    expect(sheets[0]!.rows.every((row) => row.length === 1)).toBe(true);
  });

  test('hidden sheets are flagged and not read; formulas without a saved value are listed', () => {
    const sheets = readWorkbook(
      zipSync({
        'xl/workbook.xml': strToU8(
          '<workbook xmlns:r="r"><sheets><sheet name="Elements_old" sheetId="1" state="hidden" r:id="rId1"/><sheet name="Elements" sheetId="2" r:id="rId2"/></sheets></workbook>',
        ),
        'xl/_rels/workbook.xml.rels': strToU8(
          '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
        ),
        'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1"><v>9</v></c></row></sheetData></worksheet>'),
        'xl/worksheets/sheet2.xml': strToU8('<worksheet><sheetData><row r="2"><c r="B2"><f>1+1</f></c><c r="C2"><f>2+2</f><v>4</v></c></row></sheetData></worksheet>'),
      }),
    );
    expect(sheets).toEqual([
      { name: 'Elements_old', rows: [], hidden: true },
      { name: 'Elements', rows: [[], [null, null, 4]], uncached: [{ row: 2, column: 1 }] },
    ]);
  });

  test('a DOCTYPE in shared strings does not shift their indexes', () => {
    const sheets = readWorkbook(
      zipSync({
        'xl/workbook.xml': strToU8('<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>'),
        'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
        'xl/sharedStrings.xml': strToU8('<!DOCTYPE x [<!ENTITY fake "<si><t>injected</t></si>">]><sst><si><t>id</t></si></sst>'),
        'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>'),
      }),
    );
    expect(sheets[0]!.rows).toEqual([['id']]);
  });

  test('UTF-16 text with a BOM (Excel «Unicode Text») is decoded', () => {
    const text = 'id\tname\nx\tÑandú\n';
    const le = new Uint8Array(2 + text.length * 2);
    le.set([0xff, 0xfe]);
    for (let i = 0; i < text.length; i++) le[2 + i * 2] = text.charCodeAt(i) & 0xff, (le[3 + i * 2] = text.charCodeAt(i) >> 8);
    const [sheet] = readScenarioFile('recursos.txt', le);
    expect(sheet!.delimiter).toBe('\t');
    expect(sheet!.rows[1]).toEqual(['x', 'Ñandú']);
  });

  test('a file that is not a workbook throws a readable error', () => {
    expect(() => readWorkbook(strToU8('id,name\n'))).toThrow();
  });
});

describe('the report', () => {
  test('distributions in the unit of their row, empty lists said explicitly', () => {
    const plan = planScenarioImport(csv('Elements.csv', 'id;distribution;unit;min;mode;max\nTask_TomarPedido;triangular;;1;3;5\n'), asIs(), pedidoIr());
    const [change] = plan.changes;
    expect(change!.unit).toBe('min');
    expect(describeImportValue(change!.before, { unit: change!.unit })).toBe('triangular(min=1, mode=2, max=5) min');
    expect(describeImportValue(change!.after, { unit: change!.unit })).toBe('triangular(min=1, mode=3, max=5) min');
    expect(describeImportValue([], { locale: 'es' })).toBe('ninguno');
    expect(describeImportValue(undefined)).toBe('—');
  });
});

describe('messages', () => {
  test('English and Spanish declare the same entries with the same arity', () => {
    const keys = Object.keys(SHEET_MESSAGES.en).sort();
    expect(Object.keys(SHEET_MESSAGES.es).sort()).toEqual(keys);
    for (const key of keys) {
      const en = SHEET_MESSAGES.en[key as keyof typeof SHEET_MESSAGES.en] as (...args: unknown[]) => string;
      const es = SHEET_MESSAGES.es[key as keyof typeof SHEET_MESSAGES.es] as (...args: unknown[]) => string;
      expect(es.length, key).toBe(en.length);
      expect(es('a', 1, 'b')).not.toMatch(/undefined|NaN|\[object/);
    }
  });
});
