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
  parseNumber,
  planScenarioImport,
  readScenarioFile,
  scenarioTemplate,
  type ImportPlan,
  type ReadSheet,
} from '../src/scenario-sheets.js';
import { readCsv, readWorkbook } from '../src/xlsx-read.js';
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

  test('parseNumber reads the separators Excel writes', () => {
    expect(parseNumber('1,5')).toBe(1.5);
    expect(parseNumber('1.234,5')).toBe(1234.5);
    expect(parseNumber('1,234.5')).toBe(1234.5);
    expect(parseNumber('1 234')).toBe(1234);
    expect(parseNumber('78%')).toBeCloseTo(0.78);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNaN();
    expect(parseNumber('1,2,3')).toBeNaN();
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

describe('(e) the imported scenario passes validateScenario', () => {
  test('a workbook that touches every table', () => {
    const plan = planScenarioImport(
      [
        ...csv('Calendars.csv', 'id,days,from,to\nturno,LUN-VIE,0.25,0.5\n'),
        ...csv('Resources.csv', 'id,name,type,capacity,costPerHour,calendar\nrepartidor,Driver,equipo,1,40,turno\ncajero,,,oficina:2; turno:1,,\n'),
        ...csv('Elements.csv', 'name,distribution,unit,min,mode,max,selection\nTake order,triangular,h,0.5,1,2,\nRevisar,,,,,,and\n'),
        ...csv('Arrivals.csv', 'id,distribution,unit,mean,triggerCount\nStartEvent_Pedido,exponential,min,3,500\n'),
        ...csv('Assignments.csv', 'elementId,resourceName,quantity\nTask_Revisar,Driver,\nTask_Revisar,Cashier,1\n'),
      ],
      asIs(),
      pedidoIr(),
    );
    expect(plan.issues).toEqual([]);
    const result = applyImportChanges(asIs(), plan.changes);
    // The pool's own calendar and its slices exclude each other (R16): the lint says so, which is
    // the point of running it; everything else must be clean.
    const resources = result['resources'] as Record<string, Record<string, unknown>>;
    delete resources['cajero']!['calendar'];
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

  test('a file that is not a workbook throws a readable error', () => {
    expect(() => readWorkbook(strToU8('id,name\n'))).toThrow();
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
