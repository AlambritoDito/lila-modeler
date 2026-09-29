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
 * word/_rels/document.xml.rels  rId1 -> styles.xml, rId2 -> media/diagram.png (only with a diagram),
 *                               rId3… -> media/chart-1.png… (only with a run and its charts, #460)
 * word/styles.xml               Normal, Title, heading 1/2 (outline levels 0/1), the two tables
 * word/document.xml             the blocks, A4 with 1-inch margins
 * word/media/diagram.png        the diagram, when there is one
 * word/media/chart-N.png        the charts of the run, rasterised by the host like the diagram
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
import { categoryOf, effectiveAttributes, type ElementCategory } from './bpmn/attributes.js';
import type { SubprocessInfo } from './bpmn/parse.js';
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
  /** The diagram, or with `chart` the chart at that index of `ProcessDocument.charts`. */
  | { readonly kind: 'image'; readonly alt: string; readonly chart?: number }
  | { readonly kind: 'table'; readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] };

export interface ProcessDocument {
  readonly locale: Locale;
  readonly title: string;
  /** The diagram; only present when the bytes are a PNG (its size is read from the header). */
  readonly png?: Uint8Array;
  /** The charts of the run (#460), PNG only; `image` blocks point into it with `chart`. */
  readonly charts?: readonly Uint8Array[];
  readonly blocks: readonly DocBlock[];
}

/** A chart of the run the host already rasterised (#460), with the text a reader gets instead. */
export interface DocumentChart {
  readonly png: Uint8Array;
  readonly alt: string;
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
  /** `parseBpmn(xml).subprocesses`: names and lanes of the flattened sub-processes. */
  readonly subprocesses?: Readonly<Record<string, SubprocessInfo>> | undefined;
  /** `parseBpmn(xml).lanes` and `.pool`: where the lanes' and the pool's extended attributes are (#509). */
  readonly lanes?: Readonly<Record<string, string>> | undefined;
  readonly pool?: string | undefined;
  /**
   * `parseBpmn(xml).nodeLanes`, `.laneParents` and `.poolName` (#516): lanes grouped by id, not by
   * name, with their hierarchy, and the pool under a heading of its own. Without `nodeLanes` the
   * lanes group by `Node.lane`, their label, as hand-built inputs carry nothing else.
   */
  readonly nodeLanes?: Readonly<Record<string, string>> | undefined;
  readonly laneParents?: Readonly<Record<string, string>> | undefined;
  readonly poolName?: string | undefined;
  /** `parseBpmn(xml).types`: the BPMN type of each node, which the IR flattens (#509). */
  readonly types?: Readonly<Record<string, string>> | undefined;
  readonly scenario?: ResolvedScenario;
  /** A run of `scenario`; ignored without it. */
  readonly result?: RunResult;
  /**
   * Charts of that run (#460), placed at the top of the results section in this order. Ignored
   * without a `result`: no run, no charts. Bytes that are not a PNG are left out.
   */
  readonly charts?: readonly DocumentChart[];
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

/** The extended-attribute element type of each IR node type, when the BPMN type is not known (#509). */
const NODE_CATEGORY: Record<ProcessIR['nodes'][string]['type'], ElementCategory> = {
  start: 'event', end: 'event', terminate: 'event', timer: 'event',
  task: 'task',
  xor: 'gateway', or: 'gateway', and: 'gateway', eventGateway: 'gateway',
};

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

  // Extended attributes (#509): one labelled line per filled-in attribute, under the element.
  const definitions = Object.values(annotations).flatMap((a) => a.attributeDefinitions ?? []);
  const attributesOf = (id: string, category: ElementCategory | undefined) =>
    effectiveAttributes(definitions, category, annotations[id]?.attributes ?? []);
  const attributeLines = (id: string, category: ElementCategory | undefined): void => {
    for (const { name, value } of attributesOf(id, category)) {
      blocks.push({ kind: 'paragraph', label: name === '' ? C.docAttributeNoRef() : name, text: value });
    }
  };
  attributeLines(original(ir.id), 'process');
  // The pool's lines under its own heading (#516), or they read as the process's.
  if (input.pool !== undefined && attributesOf(input.pool, 'lane').length > 0) {
    blocks.push({ kind: 'heading', level: 2, text: input.poolName || input.pool });
    attributeLines(input.pool, 'lane');
  }

  // Flattened sub-processes (R-PLAN-1): their children inherit the lane of the sub-process, which
  // is the only shape the lane lists, and the sub-process gets its own section before them.
  const subs = input.subprocesses ?? {};
  const subLane = (sub: string | undefined): string | undefined =>
    sub === undefined ? undefined : (subs[sub]?.lane ?? subLane(subs[sub]?.parent));
  const subName = (sub: string): string => subs[sub]?.name || original(sub);
  const laneOf = (id: string): string | undefined => ir.nodes[id]!.lane ?? subLane(ir.nodes[id]!.subprocessId);

  // Lanes are keyed by id when the parse gave them (#516): same-named lanes stay apart, and a
  // nested lane hangs from its parent. Without ids the key is the label, as before.
  const nodeLanes = input.nodeLanes;
  const parents = input.laneParents ?? {};
  const subLaneKey = (sub: string | undefined): string | undefined =>
    sub === undefined ? undefined : (nodeLanes?.[sub] ?? subLaneKey(subs[sub]?.parent));
  const laneKeyOf = (id: string): string | undefined =>
    nodeLanes === undefined ? laneOf(id) : (nodeLanes[id] ?? subLaneKey(ir.nodes[id]!.subprocessId));
  const names = new Map<string, string>(Object.entries(input.lanes ?? {}));
  for (const id of Object.keys(ir.nodes)) {
    const key = laneKeyOf(id);
    const label = laneOf(id);
    if (key !== undefined && label !== undefined && !names.has(key)) names.set(key, label);
  }
  const ancestry = (key: string): string[] => {
    const chain = [key];
    for (let at = parents[key]; at !== undefined && !chain.includes(at); at = parents[at]) chain.unshift(at);
    return chain;
  };
  // A nested lane reads `Parent / Child`; a heading two lanes still share gets the lane's id.
  const path = (key: string): string => ancestry(key).map((k) => names.get(k) ?? k).join(' / ');
  const laneKeys = new Set(Object.keys(ir.nodes).flatMap((id) => {
    const key = laneKeyOf(id);
    return key === undefined ? [] : ancestry(key);
  }));
  const pathCount = new Map<string, number>();
  for (const key of laneKeys) pathCount.set(path(key), (pathCount.get(path(key)) ?? 0) + 1);
  const laneTitle = (key: string): string =>
    nodeLanes === undefined ? key : (pathCount.get(path(key))! > 1 ? `${path(key)} (${key})` : path(key));
  const laneTitleOf = (key: string | undefined): string | undefined => (key === undefined ? undefined : laneTitle(key));

  const line = (label: string, text: string | undefined): void => {
    if (text !== undefined && text !== '') blocks.push({ kind: 'paragraph', label, text });
  };
  const section = (id: string, heading: string, type: string, lane: string | undefined, sub: string | undefined): void => {
    const notes = notesOf(id);
    blocks.push({ kind: 'heading', level: 2, text: heading || original(id) });
    line(C.docType(), type);
    line(C.docId(), original(id));
    line(C.docLane(), laneTitleOf(lane));
    line(C.docSubprocess(), sub === undefined ? undefined : subName(sub));
    const host = ir.nodes[id]?.attachedTo;
    if (host !== undefined) line(C.docAttachedTo(), ir.nodes[host]?.name || original(host));
    line(C.docDocumentation(), notes.documentation);
    line(C.docResponsibilities(), notes.responsibilities?.map((r) => `${r.type}: ${r.roleRef}`).join(', '));
    for (const [kind, refs] of Object.entries(notes.refs ?? {})) line(`lila:${kind}`, refs.join(', '));
    const bpmnType = input.types?.[id];
    const fallback = ir.nodes[id] === undefined ? 'subProcess' : NODE_CATEGORY[ir.nodes[id].type];
    attributeLines(original(id), bpmnType === undefined ? fallback : categoryOf(bpmnType));
  };
  const opened = new Set<string>();
  const openSub = (sub: string | undefined): void => {
    if (sub === undefined || opened.has(sub)) return;
    opened.add(sub);
    openSub(subs[sub]?.parent);
    section(sub, subName(sub), C.docSubprocess(), nodeLanes === undefined ? subLane(sub) : subLaneKey(sub), subs[sub]?.parent);
  };

  // Lanes in order of first appearance along the flow, a parent lane before its children and a
  // lane's own elements before its children's; `null` gathers the nodes outside every lane.
  const order = flowOrder(ir);
  const lanes = new Map<string | null, string[]>();
  for (const id of order) {
    // Every lane of the chain gets its entry at the first node below it, so the order holds.
    for (const key of ancestry(laneKeyOf(id) ?? '')) if (key !== '' && !lanes.has(key)) lanes.set(key, []);
    const lane = laneKeyOf(id) ?? null;
    lanes.set(lane, [...(lanes.get(lane) ?? []), id]);
  }
  const withLanes = order.some((id) => laneKeyOf(id) !== undefined);
  const emit = (lane: string | null, ids: readonly string[]): void => {
    blocks.push({ kind: 'heading', level: 1, text: !withLanes ? C.docElements() : lane === null ? C.docNoLane() : laneTitle(lane) });
    if (lane !== null) {
      // By id (#516); a hand-built input without ids still finds its lanes by their label.
      for (const [laneId, label] of Object.entries(input.lanes ?? {})) {
        if (nodeLanes === undefined ? label === lane : laneId === lane) attributeLines(laneId, 'lane');
      }
    }
    for (const id of ids) {
      const node = ir.nodes[id]!;
      openSub(node.subprocessId);
      section(id, node.name, M.mcp.nodeType(node.type), laneKeyOf(id), node.subprocessId);
    }
    for (const [child, childIds] of lanes) if (child !== null && lane !== null && parents[child] === lane) emit(child, childIds);
  };
  if (!withLanes) emit(null, order);
  else for (const [lane, ids] of lanes) if (lane === null || parents[lane] === undefined || !lanes.has(parents[lane])) emit(lane, ids);

  const { scenario, result } = input;
  const charts: Uint8Array[] = [];
  if (scenario !== undefined) {
    blocks.push({ kind: 'heading', level: 1, text: C.docScenario(scenario.name) });
    blocks.push(tableOf(parametersSheet(ir, scenario, locale)));
    if (result !== undefined) {
      blocks.push({ kind: 'heading', level: 1, text: C.docResults() });
      for (const chart of input.charts ?? []) {
        if (pngSize(chart.png) === null) continue;
        blocks.push({ kind: 'image', alt: chart.alt, chart: charts.length });
        charts.push(chart.png);
      }
      // Summary, Elements, Flows and Resources: the XLSX's own sheets (Parameters is above).
      for (const sheet of scenarioSheets(ir, scenario, result, resourceNamesOf(scenario), locale).slice(0, 4)) {
        blocks.push({ kind: 'heading', level: 2, text: sheet.name }, tableOf(sheet));
      }
    }
  }

  return {
    locale,
    title: input.title,
    blocks,
    ...(png === undefined ? {} : { png }),
    ...(charts.length === 0 ? {} : { charts }),
  };
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

/** One run; `\n` becomes `<w:br/>` and `\t` `<w:tab/>`, so a description keeps its layout. */
function run(text: string, bold = false): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const body = lines
    .map((line) => line.split('\t').map((part) => `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`).join('<w:tab/>'))
    .join('<w:br/>');
  return `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}${body}</w:r>`;
}

function paragraph(content: string, style?: string): string {
  return `<w:p>${style === undefined ? '' : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`}${content}</w:p>`;
}

/** The relationship id of chart `index`: rId1 is the styles and rId2 the diagram. */
const chartRid = (index: number): string => `rId${index + 3}`;

function imageXml(
  alt: string,
  [width, height]: readonly [number, number],
  { id, rid, file }: { readonly id: number; readonly rid: string; readonly file: string } = { id: 1, rid: 'rId2', file: 'diagram.png' },
): string {
  const scale = Math.min(1, TEXT_WIDTH_EMU / (width * EMU_PER_PX), TEXT_HEIGHT_EMU / (height * EMU_PER_PX));
  const cx = Math.round(width * EMU_PER_PX * scale);
  const cy = Math.round(height * EMU_PER_PX * scale);
  return paragraph(
    '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      `<wp:extent cx="${cx}" cy="${cy}"/>` +
      `<wp:docPr id="${id}" name="${id === 1 ? 'Diagram' : `Chart ${id - 1}`}" descr="${escapeXml(alt)}"/>` +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
      `<pic:nvPicPr><pic:cNvPr id="${id}" name="${file}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
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
        case 'image': {
          if (block.chart === undefined) return size === null ? '' : imageXml(block.alt, size);
          const chart = pngSize(doc.charts?.[block.chart]);
          return chart === null
            ? ''
            : imageXml(block.alt, chart, { id: block.chart + 2, rid: chartRid(block.chart), file: `chart-${block.chart + 1}.png` });
        }
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
        (doc.charts ?? [])
          .map((_, index) => `<Relationship Id="${chartRid(index)}" Type="${R_NS}/image" Target="media/chart-${index + 1}.png"/>`)
          .join('') +
        '</Relationships>',
    ),
    'word/styles.xml': strToU8(stylesXml(doc.locale)),
    'word/document.xml': strToU8(documentXml(doc)),
  };
  if (png !== undefined) files['word/media/diagram.png'] = png;
  (doc.charts ?? []).forEach((chart, index) => {
    files[`word/media/chart-${index + 1}.png`] = chart;
  });
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
  '.scroll{overflow-x:auto}' +
  // ponytail: 8 px is what fits the 15 columns of Elements on a portrait A4 (measured); a very long
  // unbroken id (Bizagi's `sid-<UUID>`) can still push a table past the page. Upgrade path: a
  // landscape `@page` for the results.
  // The screen's scrolling wrapper would clip the table on paper, hence `overflow:visible` there.
  '@media print{body{padding:0;max-width:none}table{font-size:8px}th,td{padding:2px 3px}.scroll{overflow:visible}' +
  'h2,h3{break-after:avoid}tr,img{break-inside:avoid}}';

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
        case 'image': {
          const bytes = block.chart === undefined ? png : doc.charts?.[block.chart];
          return bytes === undefined
            ? ''
            : `<img src="data:image/png;base64,${btoa(strFromU8(bytes, true))}" alt="${escapeHtml(block.alt)}">`;
        }
        case 'table': {
          const cells = (row: readonly string[], tag: 'th' | 'td'): string =>
            `<tr>${row.map((text) => `<${tag}>${htmlText(text)}</${tag}>`).join('')}</tr>`;
          return (
            `<div class="scroll"><table><thead>${cells(block.headers, 'th')}</thead>` +
            `<tbody>${block.rows.map((row) => cells(row, 'td')).join('')}</tbody></table></div>`
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
