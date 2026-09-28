/**
 * Minimal XLSX and CSV readers (issue #449): the reading side of `xlsx.ts`.
 *
 * Same trade-off as the writer: `fflate` unzips the package and a few regular expressions read
 * the SpreadsheetML subset every spreadsheet program writes — `xl/workbook.xml` for the tab names,
 * its relationships for the part of each tab, `xl/sharedStrings.xml` and the `<c>` cells of each
 * worksheet. No `DOMParser`: the engine runs in Node as well, and the cells of a worksheet are
 * flat enough that a real XML parser would buy nothing but a dependency.
 *
 * What is **not** read, on purpose: styles (a date and a number are the same `<v>` here; the
 * caller that expects a clock time converts the day fraction), formulas (the cached `<v>` is the
 * value, which is what the person saw), merged cells and hidden sheets.
 */

import { strFromU8, unzipSync } from 'fflate';

/** A cell as read: text, number, boolean, or `null` for an empty or missing cell. */
export type ReadCell = string | number | boolean | null;

/** One table: a tab of a workbook or a whole CSV file, row 1 first. */
export interface ReadSheet {
  name: string;
  /** Dense rows: `rows[i][j]` is row `i + 1`, column `j` (A = 0) of the sheet. */
  rows: ReadCell[][];
  /** A tab marked `hidden` or `veryHidden`: its rows are not read, and the importer skips it. */
  hidden?: boolean;
  /** Cells with a formula but no saved value (`row` 1-based, `column` 0-based): read as empty. */
  uncached?: { row: number; column: number }[];
  /** Set for a CSV: its delimiter, which also says how its numbers are written. */
  delimiter?: CsvDelimiter;
}

/** Excel's own limits: a reference beyond them is a hostile or broken file, not a spreadsheet. */
export const MAX_ROWS = 1_048_576;
export const MAX_COLUMNS = 16_384;
/** Uncompressed bytes the reader accepts for the parts it reads. */
export const MAX_UNCOMPRESSED = 50 * 1024 * 1024;
/**
 * Cells the reader will lay out, counting the empty ones a row needs up to its last value. Rows are
 * dense arrays, so one value at XFD costs 16 384 slots: forty thousand such rows in a 200 KB file
 * would take gigabytes. A million slots is far beyond any scenario sheet.
 */
export const MAX_CELLS = 1_000_000;

/* ------------------------------------------------------------------ *
 * XML helpers
 * ------------------------------------------------------------------ */

/** The five XML entities, numeric references and OOXML's `_xHHHH_` escape for control chars. */
export function decodeXml(text: string): string {
  return text
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&(#x[0-9A-Fa-f]+|#\d+|lt|gt|amp|quot|apos);/g, (_, entity: string) => {
      switch (entity) {
        case 'lt':
          return '<';
        case 'gt':
          return '>';
        case 'amp':
          return '&';
        case 'quot':
          return '"';
        case 'apos':
          return "'";
        default:
          return String.fromCodePoint(
            entity.startsWith('#x') ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)),
          );
      }
    });
}

/** `name="x" r:id="rId1"` → `{ name: 'x', 'r:id': 'rId1' }`, values decoded. */
function attributes(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const match of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    result[match[1]!] = decodeXml(match[2] ?? match[3] ?? '');
  }
  return result;
}

/**
 * The text of a string item (`<si>` or `<is>`): every `<t>` run joined, without the phonetic
 * guides (`<rPh>`) that Japanese workbooks carry next to the text.
 */
function itemText(xml: string): string {
  const withoutPhonetics = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let text = '';
  for (const match of withoutPhonetics.matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) {
    text += decodeXml(match[1] ?? '');
  }
  return text;
}

/** `B7` → `1`; the letters of an A1 reference to a 0-based column. */
function columnIndex(reference: string): number {
  let index = 0;
  for (const char of reference.replace(/\d+$/, '').toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/* ------------------------------------------------------------------ *
 * XLSX
 * ------------------------------------------------------------------ */

function sharedStrings(xml: string | undefined): string[] {
  if (xml === undefined) return [];
  return [...xml.matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((match) => itemText(match[1] ?? ''));
}

function cellValue(attrs: Record<string, string>, inner: string, shared: readonly string[]): ReadCell {
  const type = attrs['t'];
  if (type === 'inlineStr') {
    const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner);
    return is === null ? null : itemText(is[1]!);
  }
  const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
  if (v === null) return null;
  const raw = decodeXml(v[1]!);
  switch (type) {
    case 's':
      return shared[Number(raw)] ?? null;
    case 'b':
      return raw === '1' || raw === 'true';
    case 'str':
    case 'e':
    case 'd':
      return raw;
    default: {
      const number = Number(raw);
      return raw.trim() !== '' && Number.isFinite(number) ? number : raw;
    }
  }
}

/**
 * The cells of one worksheet part, dense, with missing cells as `null`. A row or column reference
 * beyond Excel's limits throws `WorkbookReadError` **before** anything is allocated for it: a 1 KB
 * file with `<row r="50000000">` would otherwise reserve fifty million rows.
 */
export function worksheetRows(
  xml: string,
  shared: readonly string[] = [],
  uncached: { row: number; column: number }[] = [],
  budget: { cells: number } = { cells: 0 },
): ReadCell[][] {
  const rows: ReadCell[][] = [];
  let nextRow = 0;
  for (const rowMatch of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowAttrs = attributes(rowMatch[1]!);
    const rowIndex = rowAttrs['r'] !== undefined ? Number(rowAttrs['r']) - 1 : nextRow;
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= MAX_ROWS) {
      throw new WorkbookReadError('out-of-bounds', `row ${rowAttrs['r'] ?? rowIndex + 1}`);
    }
    nextRow = rowIndex + 1;
    const cells: ReadCell[] = [];
    let nextColumn = 0;
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const cellAttrs = attributes(cellMatch[1]!);
      const column = cellAttrs['r'] !== undefined ? columnIndex(cellAttrs['r']) : nextColumn;
      if (column < 0 || column >= MAX_COLUMNS) throw new WorkbookReadError('out-of-bounds', `cell ${cellAttrs['r'] ?? column}`);
      nextColumn = column + 1;
      const inner = cellMatch[2] ?? '';
      const value = cellValue(cellAttrs, inner, shared);
      if (value === null) {
        // An empty cell (only a style, say) takes no room: nothing reads it.
        if (/<f\b/.test(inner)) uncached.push({ row: rowIndex + 1, column });
        continue;
      }
      budget.cells += Math.max(0, column + 1 - cells.length);
      if (budget.cells > MAX_CELLS) throw new WorkbookReadError('too-large', `more than ${MAX_CELLS} cells`);
      while (cells.length < column) cells.push(null);
      cells[column] = value;
    }
    while (rows.length < rowIndex) rows.push([]);
    rows[rowIndex] = cells;
  }
  return rows;
}

/**
 * Why a workbook could not be read. The caller translates `reason`; `message` is a detail in
 * English for logs.
 * - `not-a-workbook`: not a zip, or a zip without `xl/workbook.xml` (an old `.xls`, a renamed CSV);
 * - `too-large`: the parts to read expand beyond `MAX_UNCOMPRESSED`;
 * - `out-of-bounds`: a row or column reference beyond Excel's limits.
 */
export type WorkbookReadReason = 'not-a-workbook' | 'too-large' | 'out-of-bounds';

export class WorkbookReadError extends Error {
  override name = 'WorkbookReadError';
  constructor(
    readonly reason: WorkbookReadReason,
    detail: string,
  ) {
    super(`${reason}: ${detail}`);
  }
}

/** The only parts the reader opens; images, drawings and the rest are never decompressed. */
function isReadPart(name: string): boolean {
  return (
    name === 'xl/workbook.xml' ||
    name === 'xl/_rels/workbook.xml.rels' ||
    name === 'xl/sharedStrings.xml' ||
    /^xl\/worksheets\/[^/]+\.xml$/.test(name)
  );
}

/** `worksheets/sheet1.xml` or `/xl/worksheets/sheet1.xml` → `xl/worksheets/sheet1.xml`. */
function partPath(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts: string[] = ['xl'];
  for (const segment of target.split('/')) {
    if (segment === '..') parts.pop();
    else if (segment !== '.' && segment !== '') parts.push(segment);
  }
  return parts.join('/');
}

/**
 * Every tab of an `.xlsx`, in tab order. Works on what Excel, LibreOffice, Numbers, Google Sheets
 * and `xlsx.ts` write. Throws `WorkbookReadError` when the bytes are not a zip or carry no
 * workbook part (an `.xls` of the old binary format, a renamed CSV).
 */
export function readWorkbook(bytes: Uint8Array): ReadSheet[] {
  let files: Record<string, Uint8Array>;
  let total = 0;
  try {
    files = unzipSync(bytes, {
      filter: (file) => {
        if (!isReadPart(file.name)) return false;
        total += file.originalSize;
        if (total > MAX_UNCOMPRESSED) throw new WorkbookReadError('too-large', `${total} bytes`);
        return true;
      },
    });
  } catch (error) {
    if (error instanceof WorkbookReadError) throw error;
    throw new WorkbookReadError('not-a-workbook', error instanceof Error ? error.message : String(error));
  }
  // The size a zip header declares can lie; what came out is what counts.
  if (Object.values(files).reduce((sum, part) => sum + part.length, 0) > MAX_UNCOMPRESSED) {
    throw new WorkbookReadError('too-large', 'uncompressed parts');
  }
  // Tag prefixes dropped (`<x:row>` → `<row>`): the OpenXML SDK and some exporters qualify every
  // element with a namespace prefix, which the patterns below do not expect. Attributes such as
  // `r:id` keep theirs.
  const text = (path: string): string | undefined => {
    const content = files[path];
    // A DOCTYPE is dropped too: nothing is expanded, but an ENTITY holding `<si>` would otherwise be
    // read as one more shared string and shift every index after it.
    return content === undefined
      ? undefined
      : strFromU8(content)
          .replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/g, '')
          .replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
  };
  const book = text('xl/workbook.xml');
  if (book === undefined) throw new WorkbookReadError('not-a-workbook', 'xl/workbook.xml');

  const targets = new Map<string, string>();
  for (const match of (text('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    const attrs = attributes(match[1]!);
    if (attrs['Id'] !== undefined && attrs['Target'] !== undefined) targets.set(attrs['Id'], partPath(attrs['Target']));
  }

  const shared = sharedStrings(text('xl/sharedStrings.xml'));
  const sheets: ReadSheet[] = [];
  /** One budget for the whole workbook, not per sheet. */
  const budget = { cells: 0 };
  for (const [index, match] of [...book.matchAll(/<sheet\b([^>]*?)\/?>/g)].entries()) {
    const attrs = attributes(match[1]!);
    const relation = Object.entries(attrs).find(([key]) => key === 'id' || key.endsWith(':id'))?.[1];
    const path = (relation !== undefined ? targets.get(relation) : undefined) ?? `xl/worksheets/sheet${index + 1}.xml`;
    const name = attrs['name'] ?? `Sheet${index + 1}`;
    if (attrs['state'] === 'hidden' || attrs['state'] === 'veryHidden') {
      sheets.push({ name, rows: [], hidden: true });
      continue;
    }
    const xml = text(path);
    const uncached: { row: number; column: number }[] = [];
    const rows = xml === undefined ? [] : worksheetRows(xml, shared, uncached, budget);
    sheets.push({ name, rows, ...(uncached.length > 0 ? { uncached } : {}) });
  }
  return sheets;
}

/* ------------------------------------------------------------------ *
 * CSV
 * ------------------------------------------------------------------ */

export type CsvDelimiter = ',' | ';' | '\t';

/** Delimiters counted on the first line, outside quotes. */
function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let quoted = false;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === char) count++;
  }
  return count;
}

/**
 * The delimiter of a CSV: Excel's `sep=;` first line when there is one, otherwise whichever of
 * `;`, `,` and tab appears most on the header line. `;` wins a tie with `,` because a Spanish
 * Excel writes `;` and uses the comma for decimals, so a header line with the same number of
 * both is far more likely to be a `;` file with a decimal in it.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const directive = /^sep=(.)$/i.exec(firstLine.trim());
  if (directive !== null && (directive[1] === ',' || directive[1] === ';' || directive[1] === '\t')) {
    return directive[1];
  }
  const counts: [CsvDelimiter, number][] = [
    [';', countOutsideQuotes(firstLine, ';')],
    [',', countOutsideQuotes(firstLine, ',')],
    ['\t', countOutsideQuotes(firstLine, '\t')],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] === 0 ? ',' : counts[0]![0];
}

/**
 * One CSV file as a table (RFC 4180: quoted fields, `""` inside quotes, CR LF or LF). The BOM
 * Excel prepends and its `sep=` directive line are dropped; trailing empty lines too. Every
 * cell is text (numbers are the caller's to parse, because the decimal separator depends on
 * the file, not on the reader).
 */
export function readCsv(text: string, name = 'CSV'): ReadSheet & { delimiter: CsvDelimiter } {
  let body = text.startsWith('﻿') ? text.slice(1) : text;
  const delimiter = detectDelimiter(body);
  if (/^sep=.\r?\n/i.test(body)) body = body.replace(/^sep=.\r?\n/i, '');

  const rows: ReadCell[][] = [];
  let row: ReadCell[] = [];
  let field = '';
  let quoted = false;
  let wasQuoted = false;
  const endField = (): void => {
    row.push(field === '' && !wasQuoted ? null : field);
    field = '';
    wasQuoted = false;
  };
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (quoted) {
      if (c === '"') {
        if (body[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
      wasQuoted = true;
    } else if (c === delimiter) endField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++;
      endField();
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || wasQuoted || row.length > 0) {
    endField();
    rows.push(row);
  }
  while (rows.length > 0 && rows[rows.length - 1]!.every((cell) => cell === null)) rows.pop();
  return { delimiter, name, rows };
}

/**
 * A CSV's bytes as text: UTF-8 when they are valid UTF-8 (with or without BOM), Windows-1252
 * otherwise, which is what «CSV (delimited)» from a Spanish or English Windows Excel writes. Read
 * as UTF-8, its `ó` would be a replacement character and every accented name would stop matching.
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  // Excel's «Unicode Text» is UTF-16 with a BOM.
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
