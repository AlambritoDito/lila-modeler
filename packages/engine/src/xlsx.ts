/**
 * Minimal XLSX writer (issue #80).
 *
 * Hand-written OOXML over `fflate`, the only new dependency: SheetJS and exceljs are an order of
 * magnitude larger than the five XML parts a results workbook actually needs, and every byte of
 * them would ship inside the web bundle and the desktop artifact. What is emitted here is the
 * SpreadsheetML subset that Excel, LibreOffice, Numbers, pandas and openpyxl all read:
 *
 * ```
 * [Content_Types].xml        one <Override> per worksheet part
 * _rels/.rels                package -> xl/workbook.xml
 * xl/workbook.xml            <sheets>, one entry per sheet, in order
 * xl/_rels/workbook.xml.rels rId1..rIdN -> the worksheets, rId(N+1) -> styles
 * xl/styles.xml              one default format; some readers refuse a workbook without it
 * xl/worksheets/sheetN.xml   the cells
 * ```
 *
 * No shared string table: cells carry their text inline (`t="inlineStr"`). The table only pays off
 * when the same string repeats a lot, and it would add a part, a relationship and an index to keep
 * in step for no benefit in a results export whose repeated values are numbers.
 *
 * The output is **deterministic** (R-DET rules of the project): the zip entries carry a fixed
 * timestamp, so the same sheets always produce the same bytes.
 */

import { strToU8, zipSync } from 'fflate';

/** A cell value. `null` and `undefined` are written as an empty cell. */
export type CellValue = string | number | boolean | null | undefined;

/** One sheet of the workbook: a header row plus the data rows, all of them already ordered. */
export interface SheetSpec {
  /** Visible name of the tab; truncated and sanitized by `sheetName`. */
  name: string;
  headers: readonly string[];
  rows: readonly (readonly CellValue[])[];
}

/**
 * Fixed timestamp of every zip entry. The DOS date format used by zip cannot represent anything
 * before 1980, so that is the epoch the writer pins instead of `Date.now()` (which would make two
 * exports of the same run differ byte for byte and break `--xlsx` reproducibility).
 *
 * Built with the **local** constructor on purpose: the DOS field stores civil components, which
 * fflate reads with `getFullYear()`/`getMonth()`. A `Date.UTC` here would land in 1979 west of
 * Greenwich and fflate would refuse it; this way the stamp is 1980-01-01 00:00 in every zone, so
 * the bytes stay identical whatever the machine's timezone.
 */
const FIXED_MTIME = new Date(1980, 0, 1);

/** The five characters Excel forbids in a tab name, plus the leading/trailing apostrophe. */
const FORBIDDEN_IN_NAME = /[[\]:*?/\\]/g;

/** Excel's hard limit for a tab name. */
const MAX_SHEET_NAME = 31;

/**
 * A usable tab name: forbidden characters replaced by a space, apostrophes trimmed off the ends,
 * collapsed to at most 31 characters, never empty.
 */
export function sheetName(raw: string): string {
  const cleaned = raw.replace(FORBIDDEN_IN_NAME, ' ').replace(/^'+|'+$/g, '').trim();
  const clipped = cleaned.slice(0, MAX_SHEET_NAME).trim();
  return clipped === '' ? 'Sheet' : clipped;
}

/**
 * Makes the names unique the way Excel does when it imports a duplicate: a ` (2)`, ` (3)`… suffix,
 * with the base clipped so the whole name still fits in 31 characters.
 */
export function uniqueSheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((raw) => {
    const base = sheetName(raw);
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    for (let index = 2; ; index++) {
      const suffix = ` (${index})`;
      const candidate = `${base.slice(0, MAX_SHEET_NAME - suffix.length).trim()}${suffix}`;
      if (used.has(candidate)) continue;
      used.add(candidate);
      return candidate;
    }
  });
}

/**
 * XML text escaping. Beyond the five entities it drops the control characters XML 1.0 cannot
 * represent (a stray U+0001 in a pasted id would make the whole workbook unreadable) and keeps
 * `\t`, `\n` and `\r`, which are legal and meaningful inside a cell.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/** `0 -> A`, `25 -> Z`, `26 -> AA`: the column part of an A1 reference. */
export function columnName(index: number): string {
  let name = '';
  for (let rest = index; rest >= 0; rest = Math.floor(rest / 26) - 1) {
    name = String.fromCharCode(65 + (rest % 26)) + name;
  }
  return name;
}

/** One `<c>` element, or `''` for an empty cell (a missing cell is legal and smaller). */
function cellXml(value: CellValue, reference: string): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return `<c r="${reference}" t="b"><v>${value ? 1 : 0}</v></c>`;
  // A non-finite number has no SpreadsheetML representation: it goes as text so the workbook stays
  // readable and the anomaly stays visible, instead of turning into a corrupt numeric cell.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}"><v>${value}</v></c>`;
  }
  const text = typeof value === 'number' ? String(value) : value;
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function rowXml(values: readonly CellValue[], rowNumber: number): string {
  const cells = values.map((value, column) => cellXml(value, `${columnName(column)}${rowNumber}`)).join('');
  return `<row r="${rowNumber}">${cells}</row>`;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** The worksheet part. An empty sheet (no headers, no rows) is valid and keeps its tab. */
export function worksheetXml(sheet: SheetSpec): string {
  const rows: string[] = [];
  let rowNumber = 1;
  if (sheet.headers.length > 0) rows.push(rowXml(sheet.headers, rowNumber++));
  for (const row of sheet.rows) rows.push(rowXml(row, rowNumber++));
  const data = rows.length === 0 ? '<sheetData/>' : `<sheetData>${rows.join('')}</sheetData>`;
  return `${XML_HEADER}<worksheet xmlns="${MAIN_NS}">${data}</worksheet>`;
}

function contentTypesXml(count: number): string {
  const overrides = Array.from(
    { length: count },
    (_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('');
  return (
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    `${overrides}</Types>`
  );
}

function workbookXml(names: readonly string[]): string {
  const sheets = names
    .map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('');
  return (
    `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
    `<sheets>${sheets}</sheets></workbook>`
  );
}

function workbookRelsXml(count: number): string {
  const sheets = Array.from(
    { length: count },
    (_, index) =>
      `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  ).join('');
  return (
    `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `${sheets}<Relationship Id="rId${count + 1}" Type="${REL_NS}/styles" Target="styles.xml"/>` +
    '</Relationships>'
  );
}

/** The smallest styles part a reader will accept: one font, one fill, one border, one format. */
const STYLES_XML =
  `${XML_HEADER}<styleSheet xmlns="${MAIN_NS}">` +
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  // Without the named `Normal` style openpyxl warns on every read ("Workbook contains no default
  // style"); it costs one element to keep the export silent for pandas users.
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

const PACKAGE_RELS_XML =
  `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
  '</Relationships>';

/**
 * Builds an `.xlsx` file in memory.
 *
 * Sheet names are sanitized, clipped to 31 characters and made unique (`sheetName`,
 * `uniqueSheetNames`); the order of `sheets` is the order of the tabs, and `sheet1.xml` is always
 * the first one. Works unchanged in Node and in the browser: nothing here touches `node:*`.
 */
export function workbook(sheets: readonly SheetSpec[]): Uint8Array {
  const names = uniqueSheetNames(sheets.map((sheet) => sheet.name));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypesXml(sheets.length)),
    '_rels/.rels': strToU8(PACKAGE_RELS_XML),
    'xl/workbook.xml': strToU8(workbookXml(names)),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRelsXml(sheets.length)),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(worksheetXml(sheet));
  });
  return zipSync(files, { mtime: FIXED_MTIME });
}

/** MIME type of the produced file; the web needs it for the download `Blob`. */
export const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
