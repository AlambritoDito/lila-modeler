/**
 * XLSX export (issue #80).
 *
 * The workbook is built from a real `examples/pedido` run, unzipped again with the same `fflate`
 * the writer uses, and read back cell by cell: the Elements sheet has to carry exactly the rows
 * `elementsCsv` writes, which is the invariant that keeps the two exports from drifting apart now
 * that both come from `elementsRows`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, test } from 'vitest';

import { parseBpmn, validate } from '../src/bpmn/index.js';
import { compare } from '../src/core/compare.js';
import { simulate, type ProcessIR, type RunResult } from '../src/index.js';
import { elementsCsv } from '../src/csv.js';
import { loadResolvedScenario } from '../src/cli-shared.js';
import type { ResolvedScenario } from '../src/scenario.js';
import { columnName, escapeXml, sheetName, uniqueSheetNames, workbook } from '../src/xlsx.js';
import { compareWorkbook, payrollRows, scenarioWorkbook } from '../src/xlsx-report.js';

const here = dirname(fileURLToPath(import.meta.url));
const pedidoDir = resolve(here, '../../../examples/pedido');

async function pedidoIr(): Promise<ProcessIR> {
  const parsed = await parseBpmn(readFileSync(resolve(pedidoDir, 'model.bpmn'), 'utf8'));
  const problems = validate(parsed.ir, { unsupported: parsed.unsupported });
  expect(problems.errors).toEqual([]);
  return parsed.ir;
}

/** `examples/pedido` with the seed and replication count the acceptance criteria name. */
function pedidoScenario(file: string, replications: number): ResolvedScenario {
  // `loadResolvedScenario` applies `extends`, which the TO-BE of the example needs.
  const scenario = loadResolvedScenario(resolve(pedidoDir, file));
  return { ...scenario, run: { ...scenario.run, replications, seed: 42 } };
}

/** The parts of an `.xlsx` as text, keyed by their path inside the zip. */
function parts(bytes: Uint8Array): Record<string, string> {
  return Object.fromEntries(
    Object.entries(unzipSync(bytes)).map(([path, content]) => [path, strFromU8(content)]),
  );
}

/**
 * One `<c>`: the numeric cells carry an `s=` style index since #359, so the pattern reads it as
 * well and the two decoders below share it.
 */
const CELL_PATTERN =
  /<c r="([A-Z]+)\d+"(?: s="(\d+)")?(?: t="(\w+)")?>(?:<v>(.*?)<\/v>|<is><t[^>]*>(.*?)<\/t><\/is>)<\/c>/g;

/**
 * Cell values of a worksheet part, row by row. Cells are placed by the column of their `r`
 * reference, so an omitted (empty) cell comes back as `''` and the row keeps its alignment.
 */
function sheetRows(xml: string): string[][] {
  return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>|<row [^>]*\/>/g)].map(([, body]) => {
    const cells: string[] = [];
    for (const [, reference, , , numeric, inline] of (body ?? '').matchAll(CELL_PATTERN)) {
      const column = columnIndex(reference ?? 'A');
      while (cells.length < column) cells.push('');
      cells[column] = numeric ?? unescapeXml(inline ?? '');
    }
    return cells;
  });
}

/**
 * `cellXfs` index of every cell of a worksheet, in the same shape `sheetRows` returns: `''` for a
 * cell with no explicit style (the general format, which is what every text cell and the whole
 * header row keep).
 */
function sheetStyles(xml: string): string[][] {
  return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>|<row [^>]*\/>/g)].map(([, body]) => {
    const cells: string[] = [];
    for (const [, reference, style] of (body ?? '').matchAll(CELL_PATTERN)) {
      const column = columnIndex(reference ?? 'A');
      while (cells.length < column) cells.push('');
      cells[column] = style ?? '';
    }
    return cells;
  });
}

/** `A -> 0`, `AA -> 26`: the inverse of the writer's `columnName`. */
function columnIndex(reference: string): number {
  let index = 0;
  for (const character of reference) index = index * 26 + (character.charCodeAt(0) - 64);
  return index - 1;
}

function unescapeXml(text: string): string {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

/** The `name=` of every `<sheet>` of `xl/workbook.xml`, in tab order. */
function sheetNames(xml: string): string[] {
  return [...xml.matchAll(/<sheet name="([^"]*)"/g)].map(([, name]) => unescapeXml(name ?? ''));
}

/** `elementsCsv` parsed back into cells; the CSV of `examples/pedido` has no quoted field. */
function csvCells(csv: string): string[][] {
  return csv
    .split('\r\n')
    .filter((line) => line !== '')
    .map((line) => line.split(','));
}

describe('minimal OOXML writer', () => {
  test('sanitizes, truncates to 31 characters and makes tab names unique', () => {
    expect(sheetName('a'.repeat(40))).toHaveLength(31);
    expect(sheetName('Pedidos [2026]: Q1/Q2*?\\x')).toBe('Pedidos  2026   Q1 Q2   x');
    expect(sheetName('   ')).toBe('Sheet');
    expect(uniqueSheetNames(['Summary', 'Summary', 'Summary'])).toEqual([
      'Summary',
      'Summary (2)',
      'Summary (3)',
    ]);
    // Uniqueness never pushes a name past the 31-character limit.
    expect(uniqueSheetNames(['x'.repeat(40), 'x'.repeat(40)]).map((name) => name.length)).toEqual([31, 31]);
  });

  test('escapes the five XML entities and drops illegal control characters', () => {
    expect(escapeXml('a & b < c > d "e" \'f\'')).toBe('a &amp; b &lt; c &gt; d &quot;e&quot; &apos;f&apos;');
    expect(escapeXml('ab\tc')).toBe('ab\tc');
  });

  test('a sheet with dangerous text survives the round trip verbatim', () => {
    const nasty = 'R&D <tag> "quoted" & \'apos\'';
    const bytes = workbook([{ headers: ['h'], name: `${'n'.repeat(40)}`, rows: [[nasty], [1.5], [true]] }]);
    const files = parts(bytes);
    expect(sheetNames(files['xl/workbook.xml'] ?? '')).toEqual(['n'.repeat(31)]);
    expect(sheetRows(files['xl/worksheets/sheet1.xml'] ?? '')).toEqual([['h'], [nasty], ['1.5'], ['1']]);
  });

  test('an empty sheet is still a valid part listed in [Content_Types].xml', () => {
    const files = parts(workbook([{ headers: [], name: 'Empty', rows: [] }]));
    expect(files['xl/worksheets/sheet1.xml']).toContain('<sheetData/>');
    expect(files['[Content_Types].xml']).toContain('/xl/worksheets/sheet1.xml');
  });

  test('the same sheets always produce the same bytes', () => {
    const sheets = [{ headers: ['a'], name: 'S', rows: [[1]] }];
    expect(workbook(sheets)).toEqual(workbook(sheets));
  });
});

describe('workbook of a run (examples/pedido)', () => {
  test('the Elements sheet carries exactly the rows of elementsCsv', async () => {
    const ir = await pedidoIr();
    const scenario = pedidoScenario('as-is.scenario.json', 3);
    const result: RunResult = simulate(ir, scenario, { log: false });
    const files = parts(scenarioWorkbook(ir, scenario, result, { cajero: 'Cashier' }));

    const expected = csvCells(elementsCsv(ir, result));
    const width = expected[0]?.length ?? 0;
    const actual = sheetRows(files['xl/worksheets/sheet2.xml'] ?? '').map((row) => [
      ...row,
      ...Array.from({ length: Math.max(0, width - row.length) }, () => ''),
    ]);
    expect(actual).toEqual(expected);
    // Not an empty comparison: the run really produced the eleven elements of the example.
    expect(actual).toHaveLength(expected.length);
    expect(actual.length).toBeGreaterThan(10);
  });

  test('the Summary sheet skips the process rows that would be blank', async () => {
    const ir = await pedidoIr();
    const scenario = pedidoScenario('as-is.scenario.json', 1);
    const files = parts(scenarioWorkbook(ir, scenario, simulate(ir, scenario, { log: false })));
    const rows = sheetRows(files['xl/worksheets/sheet1.xml'] ?? '');
    const metrics = rows.filter((row) => row[0] === 'Process').map((row) => row[3]);
    // No `run.serviceLevel` in the example and `Outcome` only labels the per-outcome CSV rows.
    expect(metrics).not.toContain('Within service level');
    expect(metrics).not.toContain('Outcome');
    expect(metrics).toContain('Total cost');
    expect(rows.every((row) => row[0] !== 'Process' || (row[4] ?? '') !== '')).toBe(true);
  });

  // #359 — the Elements / Flows / Resources headers are the Bizagi contract and are pinned to the
  // CSV's by the test above, so the unit travels where nothing pins the text: the `Metric` labels
  // of the tall `Summary` sheet, plus one `Notes` row that names the unit of the source sheets.
  test('the Summary sheet states the unit of its durations and of the source sheets', async () => {
    const ir = await pedidoIr();
    const scenario = pedidoScenario('as-is.scenario.json', 1);
    const files = parts(scenarioWorkbook(ir, scenario, simulate(ir, scenario, { log: false })));
    const rows = sheetRows(files['xl/worksheets/sheet1.xml'] ?? '');

    const metrics = rows.filter((row) => row[0] === 'Process').map((row) => row[3]);
    expect(metrics).toContain('Cycle time average (s)');
    expect(metrics).toContain('Wait time p95 (s)');
    // A count, a rate and money are not durations and take no suffix.
    expect(metrics).toContain('Instances completed');
    expect(metrics).toContain('Throughput per hour');
    expect(metrics).toContain('Cost per case');
    expect(metrics).not.toContain('Cycle time average');

    const notes = rows.filter((row) => row[0] === 'Notes');
    expect(notes.map((row) => row[3])).toEqual(['Durations', 'Cost per case', 'Payroll cost']);
    expect(notes[0]?.[4]).toContain('seconds');
    // It names the sheets that do carry seconds: `Flows` has no duration column, `Resources` has
    // `Busy time` (§ 4).
    expect(notes[0]?.[4]).toContain('Busy time');
    expect(notes[0]?.[4]).not.toContain('Flows');
    // #358 — the note says what `Cost per case` averages over, and adds no number of its own.
    expect(notes[1]?.[4]).toContain('mean cost of the cases that completed');
    expect(notes[2]?.[4]).toContain('availability');
    expect(notes.every((row) => Number.isNaN(Number(row[4])))).toBe(true);
  });

  test('the notes follow the locale', async () => {
    const ir = await pedidoIr();
    const scenario = pedidoScenario('as-is.scenario.json', 1);
    const files = parts(scenarioWorkbook(ir, scenario, simulate(ir, scenario, { log: false }), {}, 'es'));
    const notes = sheetRows(files['xl/worksheets/sheet1.xml'] ?? '').filter((row) => row[0] === 'Notas');
    expect(notes).toHaveLength(3);
    // Every label of the block comes from the `es` catalog: none of them is left in English.
    expect(notes.map((row) => row[3])).toEqual(['Duraciones', 'Costo por caso', 'Costo de nómina']);
    expect(notes[1]?.[4]).toContain('costo medio de los casos que terminaron');
  });

  // #359 — presentation only: the cells keep the value they always had and gain a format.
  test('numeric cells carry a readable format and the header row keeps the general one', async () => {
    const ir = await pedidoIr();
    const scenario = pedidoScenario('as-is.scenario.json', 1);
    const result = simulate(ir, scenario, { log: false });
    const files = parts(scenarioWorkbook(ir, scenario, result, { cajero: 'Cashier' }));

    expect(files['xl/styles.xml']).toContain('<numFmt numFmtId="164" formatCode="0.###"/>');
    expect(files['xl/styles.xml']).toContain('<cellXfs count="3">');

    const summary = sheetStyles(files['xl/worksheets/sheet1.xml'] ?? '');
    expect(summary[0]).toEqual(['', '', '', '', '']);
    const process = sheetStyles(files['xl/worksheets/sheet1.xml'] ?? '').find(
      (_, index) => sheetRows(files['xl/worksheets/sheet1.xml'] ?? '')[index]?.[0] === 'Process',
    );
    expect(process?.[4]).toBe('1');

    // Elements: the three identity columns stay text, every metric after them is formatted.
    const elements = sheetStyles(files['xl/worksheets/sheet2.xml'] ?? '');
    expect(elements[1]?.slice(0, 3)).toEqual(['', '', '']);
    expect(elements[1]?.slice(3)).toEqual(Array.from({ length: 12 }, () => '1'));

    // And the numbers themselves did not move: the sheet still equals the CSV (test above).
    expect(sheetRows(files['xl/worksheets/sheet2.xml'] ?? '')[1]?.[3]).toBe(
      String(Object.values(result.elements)[0]?.started),
    );
  });

  // #359 — `Within service level` is a fraction living in a `Value` column full of counts, seconds
  // and money: under the column's `0.###` it showed `0.001004…` as `0.001` and anything below
  // `0.0005` as the `0` § 5 forbids reading as "0 % met", so the row overrides the column format.
  test('Within service level is a percentage cell and keeps the fraction', async () => {
    const ir = await pedidoIr();
    const base = pedidoScenario('as-is.scenario.json', 1);
    const scenario: ResolvedScenario = { ...base, run: { ...base.run, serviceLevel: 1800 } };
    const result = simulate(ir, scenario, { log: false });
    expect(typeof result.process.withinServiceLevel).toBe('number');

    const files = parts(scenarioWorkbook(ir, scenario, result, { cajero: 'Cashier' }));
    const sheet = files['xl/worksheets/sheet1.xml'] ?? '';
    const rows = sheetRows(sheet);
    const styles = sheetStyles(sheet);

    const process = rows.findIndex((row) => row[0] === 'Process' && row[3] === 'Within service level');
    expect(process).toBeGreaterThan(0);
    // `2` is the `0.00%` entry of `cellXfs`; the row above it keeps the column's `0.###` (`1`).
    expect(styles[process]?.[4]).toBe('2');
    expect(styles[process - 1]?.[4]).toBe('1');
    // The cell holds the fraction, not a pre-multiplied percentage: the format only displays it.
    expect(Number(rows[process]?.[4])).toBe(result.process.withinServiceLevel);
    expect(Number(rows[process]?.[4])).toBeLessThan(1);

    // Per outcome as well (#316), and only those rows: the payroll and the totals stay `0.###`.
    const outcome = rows.findIndex(
      (row) => row[0] === 'Outcomes' && row[3] === 'Within service level',
    );
    expect(outcome).toBeGreaterThan(process);
    expect(styles[outcome]?.[4]).toBe('2');
    expect(Number(rows[outcome]?.[4])).toBe(
      Object.values(result.process.byEndEvent ?? {})[0]?.withinServiceLevel,
    );
    const payroll = rows.findIndex((row) => row[0] === 'Payroll');
    expect(payroll).toBeGreaterThan(0);
    expect(styles[payroll]?.[4]).toBe('1');
  });

  test('the five sheets are named and declared once each', async () => {
    const ir = await pedidoIr();
    const scenario = pedidoScenario('as-is.scenario.json', 1);
    const files = parts(scenarioWorkbook(ir, scenario, simulate(ir, scenario, { log: false })));

    expect(sheetNames(files['xl/workbook.xml'] ?? '')).toEqual([
      'Summary',
      'Elements',
      'Flows',
      'Resources',
      'Parameters',
    ]);
    for (let index = 1; index <= 5; index++) {
      expect(files[`xl/worksheets/sheet${index}.xml`]).toBeDefined();
      expect(files['[Content_Types].xml']).toContain(`/xl/worksheets/sheet${index}.xml"`);
    }
    // No orphan part and no missing one.
    expect(files['xl/worksheets/sheet6.xml']).toBeUndefined();
  });

  test('sheet names follow the locale', async () => {
    const ir = await pedidoIr();
    const scenario = pedidoScenario('as-is.scenario.json', 1);
    const files = parts(scenarioWorkbook(ir, scenario, simulate(ir, scenario, { log: false }), {}, 'es'));
    expect(sheetNames(files['xl/workbook.xml'] ?? '')).toEqual([
      'Resumen',
      'Elementos',
      'Flujos',
      'Recursos',
      'Parámetros',
    ]);
  });

  test('the Summary sheet charges every declared pool for the open hours of the run', () => {
    const scenario = pedidoScenario('as-is.scenario.json', 1);
    const payroll = payrollRows(scenario);
    // 30 days from Mon 2026-09-07, calendar `oficina` = Mon-Fri 09:00-18:00 -> 22 days x 9 h.
    expect(payroll.find((row) => row.id === 'cajero')).toEqual({
      capacity: 2,
      cost: 2 * 220 * 198,
      hours: 198,
      id: 'cajero',
      name: 'Cashier',
    });
    // `horno` declares no calendar: 24x7 over the whole 30-day duration, and costPerHour 0.
    expect(payroll.find((row) => row.id === 'horno')?.hours).toBe(720);
    expect(payroll.find((row) => row.id === 'horno')?.cost).toBe(0);
  });

  test('without run.duration the payroll degrades to empty cells instead of guessing', () => {
    const base = pedidoScenario('as-is.scenario.json', 1);
    const { duration: _duration, ...run } = base.run;
    const payroll = payrollRows({ ...base, run });
    expect(payroll.map((row) => row.hours)).toEqual([null, null, null]);
    expect(payroll.map((row) => row.cost)).toEqual([null, null, null]);
  });
});

describe('workbook of a comparison', () => {
  test('one Summary per scenario plus a Comparison sheet with the compare() rows', async () => {
    const ir = await pedidoIr();
    const entries = ['as-is.scenario.json', 'to-be-3-cajeros.scenario.json'].map((file) => {
      const scenario = pedidoScenario(file, 3);
      return { result: simulate(ir, scenario, { log: false }), scenario };
    });
    const comparison = compare(entries.map((entry) => entry.result));
    const files = parts(compareWorkbook(ir, entries, comparison));

    expect(sheetNames(files['xl/workbook.xml'] ?? '')).toEqual([
      entries[0]!.scenario.name,
      entries[1]!.scenario.name,
      'Comparison',
    ]);

    const rows = sheetRows(files['xl/worksheets/sheet3.xml'] ?? '');
    expect(rows[0]?.slice(0, 5)).toEqual(['Kpi', 'Scope', 'Id', 'Name', 'Metric']);
    expect(rows).toHaveLength(comparison.rows.length + 1);

    const cycleTime = comparison.rows.findIndex((row) => row.kpi === 'process.cycleTime.mean');
    expect(cycleTime).toBeGreaterThanOrEqual(0);
    const row = rows[cycleTime + 1] ?? [];
    expect(row[0]).toBe('process.cycleTime.mean');
    expect(row[4]).toBe('Cycle time average');
    expect(Number(row[5])).toBe(comparison.rows[cycleTime]!.values[0]);
  });

  // #367: synthetic export fixtures derived from the public pedido demo. The controlled
  // fractions and intervals exercise display precision, not the statistical aggregation.
  test('service-level values and confidence bounds use percentages without rounding stored fractions', async () => {
    const ir = await pedidoIr();
    const fractions = [0.001004, 0.000858, 0.0002];
    const intervals: [number, number][] = [[0.0009, 0.001108], [0.0007, 0.001016], [0.0001, 0.0003]];
    const entries = fractions.map((fraction, index) => {
      const base = pedidoScenario('as-is.scenario.json', 3);
      const scenario = { ...base, name: `Scenario ${index}`, run: { ...base.run, serviceLevel: 1800 } };
      const result = simulate(ir, scenario, { log: false });
      result.process.withinServiceLevel = fraction;
      for (const outcome of Object.values(result.process.byEndEvent ?? {})) {
        outcome.withinServiceLevel = fraction;
      }
      for (const [kpi, summary] of Object.entries(result.replications!.kpis)) {
        if (kpi.endsWith('.withinServiceLevel')) {
          result.replications!.kpis[kpi] = { ...summary, mean: fraction, ci95: intervals[index]! };
        }
      }
      return { scenario, result };
    });
    const comparison = compare(entries.map((entry) => entry.result));
    const files = parts(compareWorkbook(ir, entries, comparison));
    const sheet = files['xl/worksheets/sheet4.xml']!;
    const rows = sheetRows(sheet);
    const styles = sheetStyles(sheet);
    const headers = rows[0]!;
    expect(headers).toEqual([
      'Kpi', 'Scope', 'Id', 'Name', 'Metric',
      ...entries.flatMap(({ scenario: { name } }, index) => [
        name, `CI95 low ${name}`, `CI95 high ${name}`,
        ...(index === 0 ? [] : [`Delta ${name}`, `Delta % ${name}`, `CI95 overlap ${name}`]),
      ]),
    ]);
    expect(styles[0]).toEqual(headers.map(() => ''));
    const xfs = files['xl/styles.xml']!.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/)![1]!;
    expect([...xfs.matchAll(/<xf [^>]*numFmtId="(\d+)"[^>]*\/>/g)][2]?.[1]).toBe('10');

    const serviceRows = comparison.rows.filter((row) => row.kpi.endsWith('.withinServiceLevel'));
    expect(serviceRows.some((row) => row.kpi === 'process.withinServiceLevel')).toBe(true);
    expect(serviceRows.some((row) => row.kpi.startsWith('process.byEndEvent.'))).toBe(true);
    for (const row of serviceRows) {
      const rowIndex = rows.findIndex((cells) => cells[0] === row.kpi);
      expect(rowIndex).toBeGreaterThan(0);
      for (const [index, entry] of entries.entries()) {
        const column = headers.indexOf(entry.scenario.name);
        const expected = [fractions[index]!, ...intervals[index]!];
        expected.forEach((value, offset) => {
          expect(styles[rowIndex]?.[column + offset]).toBe('2');
          expect(Number(rows[rowIndex]?.[column + offset])).toBe(value);
          // Exact numeric OOXML: no text conversion, scaling or pre-rounding.
          expect(sheet).toContain(`<c r="${columnName(column + offset)}${rowIndex + 1}" s="2"><v>${value}</v></c>`);
        });
        if (index === 0) continue;
        const absolute = fractions[index]! - fractions[0]!;
        expect(styles[rowIndex]?.[column + 3]).toBe('1');
        expect(Number(rows[rowIndex]?.[column + 3])).toBe(absolute);
        expect(styles[rowIndex]?.[column + 4]).toBe('2');
        expect(Number(rows[rowIndex]?.[column + 4])).toBe(absolute / fractions[0]!);
        expect(styles[rowIndex]?.[column + 5]).toBe('');
        expect(sheet).toContain(`<c r="${columnName(column + 5)}${rowIndex + 1}" t="b"><v>${index === 1 ? 1 : 0}</v></c>`);
      }
    }
    // Every unrelated metric retains numeric values and its existing column formats.
    for (const [index, row] of comparison.rows.entries()) {
      if (row.kpi.endsWith('.withinServiceLevel')) continue;
      for (const [scenarioIndex, entry] of entries.entries()) {
        const column = headers.indexOf(entry.scenario.name);
        expect(styles[index + 1]?.[column]).toBe('1');
        expect(Number(rows[index + 1]?.[column])).toBe(row.values[scenarioIndex]);
        expect(styles[index + 1]?.slice(column + 1, column + 3)).toEqual(['1', '1']);
      }
    }
    for (const [index, entry] of entries.entries()) {
      const summary = files[`xl/worksheets/sheet${index + 1}.xml`]!;
      const standalone = parts(scenarioWorkbook(ir, entry.scenario, entry.result));
      expect(summary).toBe(standalone['xl/worksheets/sheet1.xml']);
      sheetRows(summary).forEach((row, rowIndex) => {
        if (row[3] !== 'Within service level') return;
        expect(sheetStyles(summary)[rowIndex]?.[4]).toBe('2');
        expect(Number(row[4])).toBe(fractions[index]);
      });
    }
  });

  test('service-level comparisons preserve missing intervals and absent metrics', async () => {
    const ir = await pedidoIr();
    const entries = [true, true, false].map((withTarget, index) => {
      const base = pedidoScenario('as-is.scenario.json', 1);
      const scenario = {
        ...base, name: `Scenario ${index}`,
        run: { ...base.run, ...(withTarget ? { serviceLevel: 1800 } : {}) },
      };
      return { scenario, result: simulate(ir, scenario, { log: false }) };
    });
    const comparison = compare(entries.map((entry) => entry.result));
    const files = parts(compareWorkbook(ir, entries, comparison));
    const sheet = files['xl/worksheets/sheet4.xml']!;
    const rows = sheetRows(sheet);
    const styles = sheetStyles(sheet);
    const rowIndex = rows.findIndex((row) => row[0] === 'process.withinServiceLevel');
    expect(rowIndex).toBeGreaterThan(0);
    expect(styles[rowIndex]?.[5]).toBe('2');
    expect(styles[rowIndex]?.[8]).toBe('2');
    // No CI means absent low/high and overlap cells, never zero or false. The third
    // scenario has no target, so its value and both deltas must also remain absent.
    for (const column of [6, 7, 9, 10, 13, 14, 15, 16, 17, 18, 19]) {
      expect(sheet).not.toContain(`<c r="${columnName(column)}${rowIndex + 1}"`);
    }
    const withoutTarget = entries.slice(2);
    const withoutTargetFiles = parts(compareWorkbook(ir, withoutTarget, compare(withoutTarget.map((entry) => entry.result))));
    expect(withoutTargetFiles['xl/worksheets/sheet2.xml']).not.toContain('withinServiceLevel');
    expect(withoutTargetFiles['xl/worksheets/sheet1.xml']).not.toContain('Within service level');
  });

  // #359 — the relative delta is a fraction (`0.153`), so it takes a percentage format; the reader shows `15.30 %` without the value changing.
  test('the relative delta is a percentage cell and the rest readable numbers', async () => {
    const ir = await pedidoIr();
    const entries = ['as-is.scenario.json', 'to-be-3-cajeros.scenario.json'].map((file) => {
      const scenario = pedidoScenario(file, 3);
      return { result: simulate(ir, scenario, { log: false }), scenario };
    });
    const comparison = compare(entries.map((entry) => entry.result));
    const files = parts(compareWorkbook(ir, entries, comparison));

    const sheet = files['xl/worksheets/sheet3.xml'] ?? '';
    const headers = sheetRows(sheet)[0] ?? [];
    const deltaRelative = headers.findIndex((header) => header.startsWith('Delta % '));
    expect(deltaRelative).toBeGreaterThan(0);

    const cycleTime = comparison.rows.findIndex((row) => row.kpi === 'process.cycleTime.mean');
    const styles = sheetStyles(sheet)[cycleTime + 1] ?? [];
    expect(styles[deltaRelative]).toBe('2');
    expect(styles[headers.indexOf('Kpi')]).toBe('');
    expect(styles[deltaRelative - 1]).toBe('1');
    // The cell still holds the fraction compare() produced, not a pre-multiplied 15.3.
    expect(Number((sheetRows(sheet)[cycleTime + 1] ?? [])[deltaRelative])).toBe(
      comparison.rows[cycleTime]!.deltaRel[1],
    );
  });
});
