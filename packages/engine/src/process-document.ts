/**
 * Process document (#454): the classroom deliverable, laid out the way Bizagi's «Publish to Word»
 * does it — cover, diagram, process description, one section per element in flow order grouped by
 * lane, then the scenario and the results — written as a Word file (`toDocx`) or a single
 * self-contained HTML page (`toHtml`) from **one** document model, so both carry the same text.
 *
 * Pure, like `xlsx-report.ts`: no DOM, no `node:*`, no clock (the date comes from the caller), so
 * the same inputs always give the same bytes. The diagram arrives as PNG bytes the host already
 * rasterised (the web's paper export of #451).
 *
 * The `.docx` is hand-written WordprocessingML zipped with `fflate`, the same approach as
 * `xlsx.ts`:
 *
 * ```
 * [Content_Types].xml           rels, xml and png defaults; document and styles overrides
 * _rels/.rels                   package -> word/document.xml
 * word/_rels/document.xml.rels  rId1 -> styles.xml, rId2 -> media/diagram.png (only with a diagram)
 * word/styles.xml               Normal, Title, heading 1/2 (outline levels 0/1), the two tables
 * word/document.xml             the blocks, A4 with 1-inch margins
 * word/media/diagram.png        the diagram, when there is one
 * ```
 *
 * ponytail: no table-of-contents field. A TOC field is empty until Word updates it, and
 * `w:updateFields` makes Word ask about it on every open; the built-in `heading 1`/`heading 2`
 * styles with their outline levels already fill Word's navigation pane, and References → Table of
 * Contents builds a TOC from them in one click. Upgrade path: a `TOC \o "1-2"` field with a cached
 * result written here.
 */

import { strFromU8, strToU8, zipSync } from 'fflate';

import type { Annotations } from './bpmn/annotate.js';
import type { ProcessIR } from './core/ir.js';
import type { RunResult } from './core/result.js';
import { messages, type Locale } from './messages/index.js';
import type { ResolvedScenario } from './scenario.js';
import { version as ENGINE_VERSION } from './version.js';
import { parametersSheet, resourceNamesOf, scenarioSheets } from './xlsx-report.js';
import { escapeXml, FIXED_MTIME, type CellFormat, type CellValue, type SheetSpec } from './xlsx.js';

/** One block of the document, in reading order. Table cells are already text. */
export type DocBlock =
  | { readonly kind: 'title'; readonly text: string }
  | { readonly kind: 'heading'; readonly level: 1 | 2; readonly text: string }
  | { readonly kind: 'paragraph'; readonly text: string; readonly label?: string }
  | { readonly kind: 'image'; readonly alt: string }
  | { readonly kind: 'table'; readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] };

export interface ProcessDocument {
  readonly locale: Locale;
  readonly title: string;
  /** The diagram; only present when the bytes are a PNG (its size is read from the header). */
  readonly png?: Uint8Array;
  readonly blocks: readonly DocBlock[];
}

export interface ProcessDocumentInput {
  readonly ir: ProcessIR;
  /** `readAnnotations(xml)`, keyed by the ids of the `.bpmn` file. */
  readonly annotations: Readonly<Record<string, Annotations>>;
  readonly title: string;
  /** `YYYY-MM-DD`, from the caller: the engine has no clock. */
  readonly date: string;
  readonly locale?: Locale;
  readonly png?: Uint8Array;
  readonly scenario?: ResolvedScenario;
  /** A run of `scenario`; ignored without it. */
  readonly result?: RunResult;
}

/**
 * Node ids in flow order: breadth-first from the nodes with no incoming flow (and not attached to
 * a task), in key order; a visited node queues its boundary events first, then the targets of its
 * outgoing flows. Nodes the walk never reaches go last, in key order.
 */
export function flowOrder(ir: ProcessIR): string[] {
  const ids = Object.keys(ir.nodes);
  const boundaries = new Map<string, string[]>();
  for (const id of ids) {
    const host = ir.nodes[id]!.attachedTo;
    if (host !== undefined) boundaries.set(host, [...(boundaries.get(host) ?? []), id]);
  }
  const queue = ids.filter((id) => ir.nodes[id]!.incoming.length === 0 && ir.nodes[id]!.attachedTo === undefined);
  const seen = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index]!;
    const node = ir.nodes[id];
    if (seen.has(id) || node === undefined) continue;
    seen.add(id);
    queue.push(...(boundaries.get(id) ?? []));
    for (const flow of node.outgoing) {
      const to = ir.flows[flow]?.to;
      if (to !== undefined) queue.push(to);
    }
  }
  return [...seen, ...ids.filter((id) => !seen.has(id))];
}

/** A cell as the reader sees it in the spreadsheet: `0.###` numbers and `0.00%` fractions. */
function cellText(value: CellValue, format?: CellFormat): string {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
  if (format === 'percent') return `${(value * 100).toFixed(2)}%`;
  return String(Math.round(value * 1000) / 1000);
}

function tableOf(sheet: SheetSpec): DocBlock {
  return {
    kind: 'table',
    headers: sheet.headers,
    rows: sheet.rows.map((row, index) => {
      const formats = sheet.rowFormats?.[index] ?? sheet.formats ?? [];
      return row.map((value, column) => cellText(value, formats[column]));
    }),
  };
}

/** `[width, height]` of a PNG from its IHDR chunk, or `null` if the bytes are not a PNG. */
function pngSize(png: Uint8Array | undefined): readonly [number, number] | null {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52];
  if (png === undefined || png.length < 24 || SIGNATURE.some((byte, index) => png[index] !== byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

/**
 * The document model. Only the simulated process is documented (the IR is one pool).
 *
 * ponytail: the other participants of a collaboration (a context pool such as the customer of
 * `examples/pedido`) are left out, as they are out of the simulation. Upgrade path: parse each
 * `bpmn:process` of the file and emit one chapter per pool.
 */
export function buildProcessDocument(input: ProcessDocumentInput): ProcessDocument {
  const { ir, annotations, locale = 'en' } = input;
  const M = messages(locale);
  const C = M.cli;
  const original = (id: string): string => ir.source.originalIds[id] ?? id;
  const notesOf = (id: string): Annotations => annotations[original(id)] ?? {};
  const png = pngSize(input.png) === null ? undefined : input.png;

  const blocks: DocBlock[] = [{ kind: 'title', text: input.title }];
  const process = notesOf(ir.id);
  if (process.versionTag) blocks.push({ kind: 'paragraph', text: C.docVersion(process.versionTag) });
  blocks.push({ kind: 'paragraph', text: C.docDate(input.date) });
  blocks.push({ kind: 'paragraph', text: C.docGeneratedBy(ENGINE_VERSION) });
  if (png !== undefined) blocks.push({ kind: 'image', alt: C.docDiagramAlt() });
  blocks.push({ kind: 'heading', level: 1, text: C.docDescription() });
  blocks.push({ kind: 'paragraph', text: process.documentation ?? C.docNoDescription() });

  // Lanes in order of first appearance along the flow; `null` gathers the nodes outside every lane.
  const order = flowOrder(ir);
  const lanes = new Map<string | null, string[]>();
  for (const id of order) {
    const lane = ir.nodes[id]!.lane ?? null;
    lanes.set(lane, [...(lanes.get(lane) ?? []), id]);
  }
  const withLanes = order.some((id) => ir.nodes[id]!.lane !== undefined);
  for (const [lane, ids] of withLanes ? lanes : new Map([[null, order]])) {
    blocks.push({ kind: 'heading', level: 1, text: !withLanes ? C.docElements() : lane ?? C.docNoLane() });
    for (const id of ids) {
      const node = ir.nodes[id]!;
      const notes = notesOf(id);
      const line = (label: string, text: string | undefined): void => {
        if (text !== undefined && text !== '') blocks.push({ kind: 'paragraph', label, text });
      };
      blocks.push({ kind: 'heading', level: 2, text: node.name || original(id) });
      line(C.docType(), M.mcp.nodeType(node.type));
      line(C.docId(), original(id));
      line(C.docLane(), node.lane);
      line(C.docSubprocess(), node.subprocessId === undefined ? undefined : original(node.subprocessId));
      if (node.attachedTo !== undefined) line(C.docAttachedTo(), ir.nodes[node.attachedTo]?.name || original(node.attachedTo));
      line(C.docDocumentation(), notes.documentation);
      line(C.docResponsibilities(), notes.responsibilities?.map((r) => `${r.type}: ${r.roleRef}`).join(', '));
      for (const [kind, refs] of Object.entries(notes.refs ?? {})) line(`lila:${kind}`, refs.join(', '));
    }
  }

  const { scenario, result } = input;
  if (scenario !== undefined) {
    blocks.push({ kind: 'heading', level: 1, text: C.docScenario(scenario.name) });
    blocks.push(tableOf(parametersSheet(ir, scenario, locale)));
    if (result !== undefined) {
      blocks.push({ kind: 'heading', level: 1, text: C.docResults() });
      // Summary, Elements, Flows and Resources: the XLSX's own sheets (Parameters is above).
      for (const sheet of scenarioSheets(ir, scenario, result, resourceNamesOf(scenario), locale).slice(0, 4)) {
        blocks.push({ kind: 'heading', level: 2, text: sheet.name }, tableOf(sheet));
      }
    }
  }

  return { locale, title: input.title, blocks, ...(png === undefined ? {} : { png }) };
}

/* ------------------------------------------------------------------ *
 * Word
 * ------------------------------------------------------------------ */

export const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** A4 in twips, 1-inch margins: the text is 9026 twips wide and 13958 tall. */
const PAGE = { width: 11906, height: 16838, margin: 1440 } as const;
const TEXT_WIDTH_TWIPS = PAGE.width - 2 * PAGE.margin;
/** 635 EMU per twip: 5 731 510 × 8 863 330 EMU of text area. */
const TEXT_WIDTH_EMU = TEXT_WIDTH_TWIPS * 635;
const TEXT_HEIGHT_EMU = (PAGE.height - 2 * PAGE.margin) * 635;
/** 9525 EMU per pixel at 96 dpi. */
const EMU_PER_PX = 9525;

const BRAND = '7028F0';

/** One run; `\n` becomes `<w:br/>` so a multi-line description keeps its lines. */
function run(text: string, bold = false): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const body = lines.map((line) => `<w:t xml:space="preserve">${escapeXml(line)}</w:t>`).join('<w:br/>');
  return `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}${body}</w:r>`;
}

function paragraph(content: string, style?: string): string {
  return `<w:p>${style === undefined ? '' : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`}${content}</w:p>`;
}

function imageXml(alt: string, [width, height]: readonly [number, number]): string {
  const scale = Math.min(1, TEXT_WIDTH_EMU / (width * EMU_PER_PX), TEXT_HEIGHT_EMU / (height * EMU_PER_PX));
  const cx = Math.round(width * EMU_PER_PX * scale);
  const cy = Math.round(height * EMU_PER_PX * scale);
  return paragraph(
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="1" name="Diagram" descr="${escapeXml(alt)}"/>` +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      '<pic:nvPicPr><pic:cNvPr id="1" name="diagram.png"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>',
  );
}

/**
 * A `TableGrid` table with a repeating bold header row. Every cell holds exactly one paragraph,
 * which is what Word requires of a `w:tc`.
 *
 * ponytail: the tables stay on the portrait page, so the 15 columns of Elements are narrow.
 * Upgrade path: a landscape section (`w:sectPr` with `w:orient`) around the results.
 */
function tableXml(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const columns = Math.max(1, headers.length, ...rows.map((row) => row.length));
  const width = Math.floor(TEXT_WIDTH_TWIPS / columns);
  const cell = (text: string, bold: boolean): string =>
    `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${paragraph(text === '' ? '' : run(text, bold))}</w:tc>`;
  const row = (cells: readonly string[], header: boolean): string =>
    `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}` +
    `${Array.from({ length: columns }, (_, index) => cell(cells[index] ?? '', header)).join('')}</w:tr>`;
  return (
    '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/></w:tblPr>' +
    `<w:tblGrid>${`<w:gridCol w:w="${width}"/>`.repeat(columns)}</w:tblGrid>` +
    `${headers.length > 0 ? row(headers, true) : ''}${rows.map((cells) => row(cells, false)).join('')}</w:tbl>` +
    // A table cannot be the last thing before `w:sectPr`, nor sit flush against the next table.
    '<w:p/>'
  );
}

function documentXml(doc: ProcessDocument): string {
  const size = pngSize(doc.png);
  const body = doc.blocks
    .map((block) => {
      switch (block.kind) {
        case 'title':
          return paragraph(run(block.text), 'Title');
        case 'heading':
          return paragraph(run(block.text), `Heading${block.level}`);
        case 'paragraph':
          return paragraph(`${block.label === undefined ? '' : run(`${block.label}: `, true)}${run(block.text)}`);
        case 'image':
          return size === null ? '' : imageXml(block.alt, size);
        case 'table':
          return tableXml(block.headers, block.rows);
      }
    })
    .join('');
  const m = PAGE.margin;
  return (
    `${XML_HEADER}<w:document xmlns:w="${W_NS}" xmlns:r="${R_NS}"` +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
    ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"' +
    ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<w:body>${body}<w:sectPr><w:pgSz w:w="${PAGE.width}" w:h="${PAGE.height}"/>` +
    `<w:pgMar w:top="${m}" w:right="${m}" w:bottom="${m}" w:left="${m}" w:header="708" w:footer="708" w:gutter="0"/>` +
    '</w:sectPr></w:body></w:document>'
  );
}

/**
 * Children in the order the schema requires (name, basedOn, next, uiPriority, qFormat, pPr, rPr,
 * tblPr). The heading names are lower-case `heading 1`/`heading 2`: that is how Word recognises
 * its built-in headings and lists them in the navigation pane.
 */
function stylesXml(locale: Locale): string {
  const heading = (level: 1 | 2, size: number, before: number): string =>
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
    '<w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/>' +
    `<w:pPr><w:keepNext/><w:spacing w:before="${before}" w:after="120"/><w:outlineLvl w:val="${level - 1}"/></w:pPr>` +
    `<w:rPr><w:b/><w:color w:val="${BRAND}"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:style>`;
  const border = (side: string): string => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`;
  return (
    `${XML_HEADER}<w:styles xmlns:w="${W_NS}">` +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
    `<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${locale === 'es' ? 'es-ES' : 'en-US'}"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>' +
    '<w:next w:val="Normal"/><w:uiPriority w:val="10"/><w:qFormat/><w:pPr><w:spacing w:after="240"/></w:pPr>' +
    `<w:rPr><w:b/><w:color w:val="${BRAND}"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>` +
    heading(1, 32, 360) +
    heading(2, 26, 240) +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/>' +
    '<w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/>' +
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/>' +
    '<w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/>' +
    '<w:uiPriority w:val="39"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>' +
    '<w:rPr><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>' +
    `<w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders></w:tblPr>` +
    '</w:style></w:styles>'
  );
}

/** The `.docx` bytes. Deterministic: fixed zip timestamps, like the XLSX writer. */
export function toDocx(doc: ProcessDocument): Uint8Array {
  const png = pngSize(doc.png) === null ? undefined : doc.png;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      `${XML_HEADER}<Relationships xmlns="${PKG_REL_NS}">` +
        `<Relationship Id="rId1" Type="${R_NS}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    'word/_rels/document.xml.rels': strToU8(
      `${XML_HEADER}<Relationships xmlns="${PKG_REL_NS}">` +
        `<Relationship Id="rId1" Type="${R_NS}/styles" Target="styles.xml"/>` +
        (png === undefined ? '' : `<Relationship Id="rId2" Type="${R_NS}/image" Target="media/diagram.png"/>`) +
        '</Relationships>',
    ),
    'word/styles.xml': strToU8(stylesXml(doc.locale)),
    'word/document.xml': strToU8(documentXml(doc)),
  };
  if (png !== undefined) files['word/media/diagram.png'] = png;
  return zipSync(files, { mtime: FIXED_MTIME });
}

/* ------------------------------------------------------------------ *
 * HTML
 * ------------------------------------------------------------------ */

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function htmlText(text: string): string {
  return escapeHtml(text.replace(/\r\n?/g, '\n')).replaceAll('\n', '<br>');
}

/**
 * Always white paper, whatever the app's theme (`color-scheme: light`): the page is meant to be
 * printed or saved as PDF from the browser. Everything is inline — styles and the diagram as a
 * `data:` URI — so the single file opens anywhere, offline, with no external request.
 */
const HTML_STYLE =
  ':root{color-scheme:light}' +
  'body{margin:0 auto;max-width:960px;padding:32px 24px;background:#fff;color:#280838;' +
  'font:15px/1.5 Archivo,Inter,system-ui,-apple-system,"Segoe UI",sans-serif}' +
  'h1,h2,h3{color:#7028f0;line-height:1.2}h1{font-size:2em}h2{margin-top:1.6em}' +
  'img{display:block;max-width:100%;height:auto;margin:16px 0}' +
  'table{border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:12px}' +
  'th,td{border:1px solid #c8c0d0;padding:3px 6px;text-align:left;vertical-align:top}' +
  'th{background:#f3eefb}' +
  '@media print{body{padding:0;max-width:none}h2,h3{break-after:avoid}tr,img{break-inside:avoid}}';

/** The single-page HTML, with the same text as `toDocx`. Title → `h1`, levels 1/2 → `h2`/`h3`. */
export function toHtml(doc: ProcessDocument): string {
  const png = pngSize(doc.png) === null ? undefined : doc.png;
  const body = doc.blocks
    .map((block) => {
      switch (block.kind) {
        case 'title':
          return `<h1>${htmlText(block.text)}</h1>`;
        case 'heading':
          return `<h${block.level + 1}>${htmlText(block.text)}</h${block.level + 1}>`;
        case 'paragraph':
          return `<p>${block.label === undefined ? '' : `<strong>${htmlText(block.label)}:</strong> `}${htmlText(block.text)}</p>`;
        case 'image':
          return png === undefined
            ? ''
            : `<img src="data:image/png;base64,${btoa(strFromU8(png, true))}" alt="${escapeHtml(block.alt)}">`;
        case 'table': {
          const cells = (row: readonly string[], tag: 'th' | 'td'): string =>
            `<tr>${row.map((text) => `<${tag}>${htmlText(text)}</${tag}>`).join('')}</tr>`;
          return (
            `<table><thead>${cells(block.headers, 'th')}</thead>` +
            `<tbody>${block.rows.map((row) => cells(row, 'td')).join('')}</tbody></table>`
          );
        }
      }
    })
    .join('\n');
  return (
    `<!doctype html>\n<html lang="${doc.locale}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<meta name="generator" content="Lila Modeler ${ENGINE_VERSION}">` +
    `<title>${escapeHtml(doc.title)}</title><style>${HTML_STYLE}</style></head>\n<body>\n${body}\n</body></html>\n`
  );
}
