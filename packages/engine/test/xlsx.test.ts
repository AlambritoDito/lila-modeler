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
import { escapeXml, sheetName, uniqueSheetNames, workbook } from '../src/xlsx.js';
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
 * Cell values of a worksheet part, row by row. Cells are placed by the column of their `r`
 * reference, so an omitted (empty) cell comes back as `''` and the row keeps its alignment.
 */
function sheetRows(xml: string): string[][] {
  return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>|<row [^>]*\/>/g)].map(([, body]) => {
    const cells: string[] = [];
    const pattern =
      /<c r="([A-Z]+)\d+"(?: t="(\w+)")?>(?:<v>(.*?)<\/v>|<is><t[^>]*>(.*?)<\/t><\/is>)<\/c>/g;
    for (const [, reference, , numeric, inline] of (body ?? '').matchAll(pattern)) {
      const column = columnIndex(reference ?? 'A');
      while (cells.length < column) cells.push('');
      cells[column] = numeric ?? unescapeXml(inline ?? '');
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
});
