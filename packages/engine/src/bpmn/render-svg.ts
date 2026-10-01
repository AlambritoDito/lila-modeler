/**
 * `renderSvg`: BPMN 2.0 XML → an SVG drawing of its diagram (#538), with no DOM and no browser.
 *
 * Agents and the CLI produce deliverables without the app, so the engine draws the diagram
 * itself from the DI (`bpmndi:*`): every shape at its `dc:Bounds`, every edge through its
 * `di:waypoint`s, the same geometry bpmn-js draws. The look follows bpmn-js's renderer in the
 * Lila Light theme on white paper (`apps/web/src/theme/themes/lila-light.json`, the «papel»
 * export of `apps/web/src/exportarDiagrama.ts`); a colour an element carries in its DI
 * (`bioc:*`, `color:*`, #452) wins over the theme's.
 *
 * The result is the `<svg>` element alone (no XML prolog), valid as an `.svg` file and inline in
 * an HTML page; same input, same bytes. Every text is escaped. Each shape and edge is a `<g>`
 * with `data-element-id` (the BPMN id as written in the file); a shape's group is translated to
 * its bounds' corner and its first child spans exactly its width and height.
 *
 * ponytail: labels wrap on an estimated text width (no font metrics without a DOM), so a line
 * can come out slightly shorter or longer than bpmn-js's; task-type icons, loop markers and
 * the less common event markers (error, escalation, compensation…) are not drawn. Upgrade path:
 * add the missing markers here as they are needed; real metrics would need a font file.
 */
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';
import lila from './lila.moddle.json' with { type: 'json' };
import { sanitizeXmlIds } from './ids.js';
import { escapeXml } from '../xlsx.js';

export interface RenderSvgOptions {
  /** The `bpmndi:BPMNDiagram` to draw, by id; the first one by default. */
  readonly diagram?: string;
  /** Blank space around the drawing, in diagram units (default 20). */
  readonly margin?: number;
}

/** Lila Light's diagram tokens on white paper. */
const THEME = {
  paper: '#FFFFFF',
  fill: '#FFFFFF',
  stroke: '#280838',
  label: '#280838',
  font: 'Archivo, Inter, system-ui, sans-serif',
} as const;

const FONT_SIZE = 12;
const EXTERNAL_FONT_SIZE = 11;
const LINE_HEIGHT = 1.2;

const TASKS = new Set([
  'bpmn:Task', 'bpmn:UserTask', 'bpmn:ServiceTask', 'bpmn:ManualTask', 'bpmn:ScriptTask',
  'bpmn:BusinessRuleTask', 'bpmn:SendTask', 'bpmn:ReceiveTask', 'bpmn:CallActivity',
]);
const SUBPROCESSES = new Set(['bpmn:SubProcess', 'bpmn:Transaction', 'bpmn:AdHocSubProcess']);
const EVENTS = new Set([
  'bpmn:StartEvent', 'bpmn:EndEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:IntermediateThrowEvent', 'bpmn:BoundaryEvent',
]);
const GATEWAYS = new Set([
  'bpmn:ExclusiveGateway', 'bpmn:ParallelGateway', 'bpmn:InclusiveGateway', 'bpmn:EventBasedGateway', 'bpmn:ComplexGateway',
]);

/** Numbers as written: at most two decimals, no trailing zeros, never `-0`. */
function n(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** A DI colour, kept only when it is a plain hex, `rgb()`/`rgba()` or name (nothing to escape). */
function diColour(di: ModdleElement | undefined, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = di?.get?.(name) ?? di?.$attrs?.[name];
    if (typeof value === 'string' && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i.test(value.trim())) return value.trim();
  }
  return undefined;
}

interface Colours {
  readonly fill: string;
  readonly stroke: string;
  readonly label: string;
}

function coloursOf(di: ModdleElement): Colours {
  const stroke = diColour(di, ['bioc:stroke', 'color:border-color']) ?? THEME.stroke;
  return {
    fill: diColour(di, ['bioc:fill', 'color:background-color']) ?? THEME.fill,
    stroke,
    // An embedded label takes the element's stroke (#452); `color:color` on the label wins.
    label: diColour(di.label, ['color:color']) ?? (stroke === THEME.stroke ? THEME.label : stroke),
  };
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

/** Estimated advance of one character, in ems, for a sans-serif like Archivo. */
function charWidth(ch: string): number {
  if (/[ilj.,:;'|!()[\]{} ]/.test(ch)) return 0.3;
  if (/[mwMW@]/.test(ch)) return 0.85;
  if (/[A-Z0-9#%&]/.test(ch)) return 0.65;
  return 0.53;
}

function textWidth(text: string, size: number): number {
  let width = 0;
  for (const ch of text) width += charWidth(ch);
  return width * size;
}

/** Splits `text` into lines no wider than `max`, at spaces, and inside a word only when it alone is wider. */
function wrapText(text: string, max: number, size: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter((w) => w !== '')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (textWidth(candidate, size) <= max || line === '' && textWidth(word, size) <= max) {
        line = candidate;
        continue;
      }
      if (line !== '') lines.push(line);
      line = '';
      // A word wider than the box is cut where it overflows.
      let rest = word;
      while (textWidth(rest, size) > max && rest.length > 1) {
        let cut = 1;
        while (cut < rest.length && textWidth(rest.slice(0, cut + 1), size) <= max) cut++;
        lines.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    if (line !== '') lines.push(line);
  }
  return lines;
}

type Align = 'center-middle' | 'center-top' | 'center-bottom' | 'left-top';

/**
 * `<text>` with one `<tspan>` per wrapped line inside the box `x, y, width, height`. Lines that
 * do not fit vertically are kept: bpmn-js lets a long label overflow its box too.
 */
function textBlock(
  text: string | undefined,
  box: { x: number; y: number; width: number; height: number },
  options: { align: Align; size?: number; colour: string; padding?: number; transform?: string },
): string {
  if (text === undefined || text.trim() === '') return '';
  const size = options.size ?? FONT_SIZE;
  const padding = options.padding ?? 5;
  const lines = wrapText(text, Math.max(box.width - 2 * padding, size), size);
  if (lines.length === 0) return '';
  const lineHeight = size * LINE_HEIGHT;
  const blockHeight = lines.length * lineHeight;
  const left = options.align === 'left-top';
  const x = left ? box.x + padding : box.x + box.width / 2;
  const top =
    options.align === 'center-middle' ? box.y + (box.height - blockHeight) / 2
      : options.align === 'center-bottom' ? box.y + box.height - blockHeight
        : box.y + (left ? padding : 0);
  // The baseline of a line sits about 0.8 em below its top.
  const tspans = lines
    .map((line, index) => `<tspan x="${n(x)}" y="${n(top + index * lineHeight + size * 0.9)}">${escapeXml(line)}</tspan>`)
    .join('');
  return (
    `<text font-family="${THEME.font}" font-size="${size}" fill="${escapeXml(options.colour)}"` +
    `${left ? '' : ' text-anchor="middle"'}${options.transform === undefined ? '' : ` transform="${options.transform}"`}>${tspans}</text>`
  );
}

/* ------------------------------------------------------------------ *
 * Shapes — drawn at the origin, the group is translated to the bounds' corner
 * ------------------------------------------------------------------ */

interface Box {
  readonly width: number;
  readonly height: number;
}

function stroked(c: Colours, width = 2, extra = ''): string {
  return `fill="${escapeXml(c.fill)}" stroke="${escapeXml(c.stroke)}" stroke-width="${width}"${extra}`;
}

function line(d: string, c: Colours, width = 2, extra = ''): string {
  return `<path d="${d}" fill="none" stroke="${escapeXml(c.stroke)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
}

function eventDefinitionOf(el: ModdleElement): string | undefined {
  return [...(el.eventDefinitions ?? []), ...(el.eventDefinitionRef ?? [])][0]?.$type;
}

/** The marker inside an event of diameter `d`; `filled` for throw and end events. */
function eventMarker(definition: string | undefined, d: number, c: Colours, filled: boolean): string {
  const cx = d / 2;
  const s = d / 36; // bpmn-js draws its markers for a 36-unit event
  const ink = escapeXml(c.stroke);
  const inside = filled ? ink : escapeXml(c.fill);
  switch (definition) {
    case 'bpmn:TimerEventDefinition': {
      const r = 11 * s;
      const ticks = Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6;
        return `M${n(cx + Math.cos(a) * r * 0.75)} ${n(cx + Math.sin(a) * r * 0.75)}L${n(cx + Math.cos(a) * r)} ${n(cx + Math.sin(a) * r)}`;
      }).join('');
      return (
        `<circle cx="${n(cx)}" cy="${n(cx)}" r="${n(r)}" ${stroked(c, 2)}/>` +
        line(ticks, c, 1) +
        line(`M${n(cx)} ${n(cx)}L${n(cx + 6 * s)} ${n(cx - 2 * s)}M${n(cx)} ${n(cx)}L${n(cx + 1 * s)} ${n(cx - 8 * s)}`, c, 1.5)
      );
    }
    case 'bpmn:MessageEventDefinition': {
      const w = 15 * s;
      const h = 11 * s;
      const x = cx - w / 2;
      const y = cx - h / 2;
      return (
        `<path d="M${n(x)} ${n(y)}h${n(w)}v${n(h)}h${n(-w)}z" fill="${inside}" stroke="${ink}" stroke-width="1"/>` +
        `<path d="M${n(x)} ${n(y)}L${n(cx)} ${n(y + h / 2)}L${n(x + w)} ${n(y)}" fill="none" stroke="${filled ? escapeXml(c.fill) : ink}" stroke-width="1"/>`
      );
    }
    case 'bpmn:TerminateEventDefinition':
      return `<circle cx="${n(cx)}" cy="${n(cx)}" r="${n(10 * s)}" fill="${ink}" stroke="${ink}" stroke-width="2"/>`;
    case 'bpmn:SignalEventDefinition': {
      const r = 10 * s;
      return `<path d="M${n(cx)} ${n(cx - r)}L${n(cx + r * 0.87)} ${n(cx + r / 2)}L${n(cx - r * 0.87)} ${n(cx + r / 2)}z" fill="${inside}" stroke="${ink}" stroke-width="1"/>`;
    }
    case 'bpmn:ConditionalEventDefinition': {
      const w = 14 * s;
      const x = cx - w / 2;
      const rows = [0.2, 0.4, 0.6, 0.8].map((f) => `M${n(x + 2 * s)} ${n(x + w * f)}h${n(w - 4 * s)}`).join('');
      return `<path d="M${n(x)} ${n(x)}h${n(w)}v${n(w)}h${n(-w)}z" ${stroked(c, 1)}/>` + line(rows, c, 1);
    }
    case 'bpmn:LinkEventDefinition': {
      const x = cx - 9 * s;
      const y = cx - 5 * s;
      return `<path d="M${n(x)} ${n(y)}h${n(11 * s)}v${n(-4 * s)}l${n(7 * s)} ${n(9 * s)}l${n(-7 * s)} ${n(9 * s)}v${n(-4 * s)}h${n(-11 * s)}z" fill="${inside}" stroke="${ink}" stroke-width="1"/>`;
    }
    default:
      return '';
  }
}

function eventShape(el: ModdleElement, box: Box, c: Colours): string {
  const d = box.width;
  const r = d / 2;
  const definition = eventDefinitionOf(el);
  const dashed = el.cancelActivity === false || el.isInterrupting === false ? ' stroke-dasharray="6 3"' : '';
  const circle = (radius: number, width: number, extra = ''): string =>
    `<circle cx="${n(r)}" cy="${n(box.height / 2)}" r="${n(radius)}" ${stroked(c, width, extra)}/>`;
  switch (el.$type) {
    case 'bpmn:StartEvent':
      return circle(r, 2, dashed) + eventMarker(definition, d, c, false);
    case 'bpmn:EndEvent':
      return circle(r, 4) + eventMarker(definition, d, c, true);
    default: {
      // Intermediate and boundary events: a double ring.
      const thrown = el.$type === 'bpmn:IntermediateThrowEvent';
      return circle(r, 1.5, dashed) + circle(r - 3, 1.5, dashed) + eventMarker(definition, d, c, thrown);
    }
  }
}

function gatewayShape(el: ModdleElement, box: Box, c: Colours): string {
  const { width: w, height: h } = box;
  const cx = w / 2;
  const cy = h / 2;
  const diamond = `<polygon points="${n(cx)},0 ${n(w)},${n(cy)} ${n(cx)},${n(h)} 0,${n(cy)}" ${stroked(c, 2)}/>`;
  const s = Math.min(w, h) / 50; // bpmn-js markers are sized for a 50-unit gateway
  switch (el.$type) {
    case 'bpmn:ExclusiveGateway': {
      const a = 8 * s;
      return diamond + line(`M${n(cx - a)} ${n(cy - a)}L${n(cx + a)} ${n(cy + a)}M${n(cx + a)} ${n(cy - a)}L${n(cx - a)} ${n(cy + a)}`, c, 4 * s);
    }
    case 'bpmn:ParallelGateway': {
      const a = 11 * s;
      return diamond + line(`M${n(cx)} ${n(cy - a)}V${n(cy + a)}M${n(cx - a)} ${n(cy)}H${n(cx + a)}`, c, 4 * s);
    }
    case 'bpmn:InclusiveGateway':
      return diamond + `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(12 * s)}" fill="none" stroke="${escapeXml(c.stroke)}" stroke-width="${n(2.5 * s)}"/>`;
    case 'bpmn:ComplexGateway': {
      const a = 11 * s;
      const b = a * 0.7;
      return diamond + line(
        `M${n(cx)} ${n(cy - a)}V${n(cy + a)}M${n(cx - a)} ${n(cy)}H${n(cx + a)}M${n(cx - b)} ${n(cy - b)}L${n(cx + b)} ${n(cy + b)}M${n(cx + b)} ${n(cy - b)}L${n(cx - b)} ${n(cy + b)}`,
        c, 3 * s,
      );
    }
    case 'bpmn:EventBasedGateway': {
      const r = 10 * s;
      const p = 7 * s;
      const pentagon = Array.from({ length: 5 }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        return `${n(cx + Math.cos(a) * p)},${n(cy + Math.sin(a) * p)}`;
      }).join(' ');
      const ring = (radius: number): string =>
        `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(radius)}" fill="none" stroke="${escapeXml(c.stroke)}" stroke-width="1"/>`;
      return diamond + ring(r + 2 * s) + ring(r) + `<polygon points="${pentagon}" fill="none" stroke="${escapeXml(c.stroke)}" stroke-width="1.5"/>`;
    }
    default:
      return diamond;
  }
}

/** The collapsed sub-process marker: a small boxed plus at the bottom centre. */
function collapsedMarker(box: Box, c: Colours): string {
  const x = box.width / 2 - 7;
  const y = box.height - 18;
  return `<rect x="${n(x)}" y="${n(y)}" width="14" height="14" ${stroked(c, 1.5)}/>` + line(`M${n(x + 7)} ${n(y + 3)}v8M${n(x + 3)} ${n(y + 7)}h8`, c, 1.5);
}

/** An activity's name: centred, top-left when `expanded`, above the collapsed marker when `false`. */
function activityLabel(el: ModdleElement, expanded: boolean | undefined, box: Box, c: Colours): string {
  if (expanded === true) return textBlock(el.name, { x: 0, y: 0, ...box }, { align: 'left-top', colour: c.label });
  const height = expanded === false ? box.height - 18 : box.height;
  return textBlock(el.name, { x: 0, y: 0, width: box.width, height }, { align: 'center-middle', colour: c.label }) +
    (expanded === false ? collapsedMarker(box, c) : '');
}

function activityShape(el: ModdleElement, expanded: boolean, box: Box, c: Colours): string {
  const rect = (width: number, extra = ''): string =>
    `<rect x="0" y="0" width="${n(box.width)}" height="${n(box.height)}" rx="10" ry="10" ${stroked(c, width, extra)}/>`;
  if (SUBPROCESSES.has(el.$type)) {
    const eventSub = el.triggeredByEvent === true ? ' stroke-dasharray="2 2"' : '';
    const outline = el.$type === 'bpmn:Transaction'
      ? rect(1.5) + `<rect x="3" y="3" width="${n(box.width - 6)}" height="${n(box.height - 6)}" rx="8" ry="8" fill="none" stroke="${escapeXml(c.stroke)}" stroke-width="1.5"/>`
      : rect(2, eventSub);
    return outline + activityLabel(el, expanded, box, c);
  }
  // A call activity has bpmn-js's thick border and, collapsed, the sub-process marker.
  return rect(el.$type === 'bpmn:CallActivity' ? 5 : 2) + activityLabel(el, el.$type === 'bpmn:CallActivity' ? expanded : undefined, box, c);
}

/** A pool or a lane: the frame and its title in a band along the leading edge (vertical text when horizontal). */
function containerShape(el: ModdleElement, di: ModdleElement, box: Box, c: Colours): string {
  const horizontal = di.isHorizontal !== false;
  const pool = el.$type === 'bpmn:Participant';
  const frame = `<rect x="0" y="0" width="${n(box.width)}" height="${n(box.height)}" ${stroked(c, pool ? 2 : 1.5)}${pool ? '' : ' fill-opacity="0"'}/>`;
  // The title sits in a 30-unit band along the leading edge; a pool also draws the band's divider.
  const band = 30;
  if (horizontal) {
    // Drawn in a frame turned a quarter left: its x runs up the band, its y across it.
    const title = textBlock(el.name, { x: -box.height, y: 0, width: box.height, height: band }, {
      align: 'center-middle', colour: c.label, transform: 'rotate(-90)',
    });
    return frame + (pool ? line(`M${band} 0V${n(box.height)}`, c, 1.5) : '') + title;
  }
  const title = textBlock(el.name, { x: 0, y: 0, width: box.width, height: band }, { align: 'center-middle', colour: c.label });
  return frame + (pool ? line(`M0 ${band}H${n(box.width)}`, c, 1.5) : '') + title;
}

function dataShape(el: ModdleElement, box: Box, c: Colours): string {
  const { width: w, height: h } = box;
  if (el.$type === 'bpmn:DataStoreReference') {
    const ry = Math.min(8, h / 6);
    return (
      `<path d="M0 ${n(ry)}A${n(w / 2)} ${n(ry)} 0 0 1 ${n(w)} ${n(ry)}V${n(h - ry)}A${n(w / 2)} ${n(ry)} 0 0 1 0 ${n(h - ry)}z" ${stroked(c, 2)}/>` +
      line(`M0 ${n(ry)}A${n(w / 2)} ${n(ry)} 0 0 0 ${n(w)} ${n(ry)}M0 ${n(ry * 2)}A${n(w / 2)} ${n(ry)} 0 0 0 ${n(w)} ${n(ry * 2)}`, c, 1.5)
    );
  }
  const fold = Math.min(10, w / 3);
  return (
    `<path d="M0 0H${n(w - fold)}L${n(w)} ${n(fold)}V${n(h)}H0z" ${stroked(c, 2)}/>` +
    line(`M${n(w - fold)} 0V${n(fold)}H${n(w)}`, c, 1.5)
  );
}

function annotationShape(el: ModdleElement, box: Box, c: Colours): string {
  // An invisible frame carries the bounds; only the bracket on the left is drawn.
  return (
    `<rect x="0" y="0" width="${n(box.width)}" height="${n(box.height)}" fill="none" stroke="none"/>` +
    line(`M10 0H0V${n(box.height)}H10`, c, 2) +
    textBlock(el.text, { x: 0, y: 0, ...box }, { align: 'left-top', colour: c.label })
  );
}

function groupShape(box: Box, c: Colours): string {
  return `<rect x="0" y="0" width="${n(box.width)}" height="${n(box.height)}" rx="10" ry="10" fill="none" stroke="${escapeXml(c.stroke)}" stroke-width="2" stroke-dasharray="10 6 2 6"/>`;
}

/* ------------------------------------------------------------------ *
 * Edges
 * ------------------------------------------------------------------ */

type Point = { readonly x: number; readonly y: number };

/** An arrowhead with its tip on `tip`, pointing away from `from`. */
function arrowhead(from: Point, tip: Point, c: Colours, open: boolean): string {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const back = { x: tip.x - ux * 10, y: tip.y - uy * 10 };
  const side = (k: number): string => `${n(back.x - uy * 4 * k)},${n(back.y + ux * 4 * k)}`;
  return `<polygon points="${n(tip.x)},${n(tip.y)} ${side(1)} ${side(-1)}" fill="${open ? THEME.paper : escapeXml(c.stroke)}" stroke="${escapeXml(c.stroke)}" stroke-width="1" stroke-linejoin="round"/>`;
}

function edgeShape(el: ModdleElement, points: readonly Point[], c: Colours, flowSource: ModdleElement | undefined): string {
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${n(p.x)} ${n(p.y)}`).join('');
  const last = points[points.length - 1]!;
  const before = points[points.length - 2] ?? last;
  const first = points[0]!;
  const second = points[1] ?? first;
  const ink = escapeXml(c.stroke);
  switch (el.$type) {
    case 'bpmn:SequenceFlow': {
      let marks = '';
      // The default flow of a gateway or activity: a slash near its source.
      if (flowSource?.default === el) {
        const len = Math.hypot(second.x - first.x, second.y - first.y) || 1;
        const ux = (second.x - first.x) / len;
        const uy = (second.y - first.y) / len;
        const mx = first.x + ux * 10;
        const my = first.y + uy * 10;
        marks = line(`M${n(mx - uy * 6 - ux * 3)} ${n(my + ux * 6 - uy * 3)}L${n(mx + uy * 6 + ux * 3)} ${n(my - ux * 6 + uy * 3)}`, c, 1.5);
      }
      return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>` + marks + arrowhead(before, last, c, false);
    }
    case 'bpmn:MessageFlow':
      return (
        `<path d="${d}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-dasharray="10 6" stroke-linejoin="round"/>` +
        `<circle cx="${n(first.x)}" cy="${n(first.y)}" r="4" fill="${THEME.paper}" stroke="${ink}" stroke-width="1.5"/>` +
        arrowhead(before, last, c, true)
      );
    case 'bpmn:DataInputAssociation':
    case 'bpmn:DataOutputAssociation':
      return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-dasharray="2 4" stroke-linecap="round"/>` + arrowhead(before, last, c, true);
    default:
      // Associations: dotted, no arrow.
      return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="1.5" stroke-dasharray="2 4" stroke-linecap="round"/>`;
  }
}

/* ------------------------------------------------------------------ *
 * External labels
 * ------------------------------------------------------------------ */

type Bounds = { x: number; y: number; width: number; height: number };

/** bpmn-js's default external label: 90×20 under a shape, or around the middle of a flow. */
function defaultLabelBounds(di: ModdleElement): Bounds | undefined {
  if (di.bounds !== undefined) {
    const b = di.bounds;
    return { x: b.x + b.width / 2 - 45, y: b.y + b.height + 5, width: 90, height: 20 };
  }
  const points = di.waypoint ?? [];
  if (points.length < 2) return undefined;
  const mid = Math.floor((points.length - 1) / 2);
  const a = points[mid]!;
  const b = points[mid + 1]!;
  return { x: (a.x + b.x) / 2 - 45, y: (a.y + b.y) / 2 - 25, width: 90, height: 20 };
}

/** The DI label box, unless it is empty (Bizagi writes `0 0 0 0` for a flow without one). */
function labelBounds(di: ModdleElement): Bounds | undefined {
  const b = di.label?.bounds;
  return b !== undefined && (b.width > 0 || b.height > 0) ? b : defaultLabelBounds(di);
}

function externalLabel(el: ModdleElement, di: ModdleElement, c: Colours): string {
  const text = el.name;
  if (text === undefined || text.trim() === '') return '';
  const bounds = labelBounds(di);
  if (bounds === undefined) return '';
  // A flow's default label grows upwards, so a second line never sits on the flow itself.
  const above = di.bounds === undefined && bounds !== di.label?.bounds;
  // A DI label box narrower than its words (common in exports) widens to bpmn-js's 90.
  const width = Math.max(bounds.width, 90);
  return textBlock(text, { x: bounds.x + bounds.width / 2 - width / 2, y: bounds.y, width, height: bounds.height }, {
    align: above ? 'center-bottom' : 'center-top', size: EXTERNAL_FONT_SIZE, colour: diColour(di.label, ['color:color']) ?? THEME.label, padding: 0,
  });
}

/* ------------------------------------------------------------------ *
 * The drawing
 * ------------------------------------------------------------------ */

/** Paint order: pools, lanes, expanded sub-processes, the rest of the shapes, edges, boundary events, groups. */
function layerOf(di: ModdleElement, expanded: boolean): number {
  const type = di.bpmnElement?.$type ?? '';
  if (di.$type === 'bpmndi:BPMNEdge') return 4;
  if (type === 'bpmn:Participant') return 0;
  if (type === 'bpmn:Lane') return 1;
  if (expanded && type !== 'bpmn:CallActivity') return 2;
  if (type === 'bpmn:BoundaryEvent') return 5;
  if (type === 'bpmn:Group') return 6;
  return 3;
}

/** The external labels: events, gateways, data and flows (bpmn-js's `isLabelExternal`). */
function hasExternalLabel(type: string): boolean {
  return EVENTS.has(type) || GATEWAYS.has(type) || type === 'bpmn:DataObjectReference' || type === 'bpmn:DataStoreReference' ||
    type === 'bpmn:DataInput' || type === 'bpmn:DataOutput' || type === 'bpmn:SequenceFlow' || type === 'bpmn:MessageFlow' || type === 'bpmn:Group';
}

function shapeBody(el: ModdleElement, di: ModdleElement, expanded: boolean, box: Box, c: Colours): string {
  const type = el.$type;
  if (TASKS.has(type) || SUBPROCESSES.has(type)) return activityShape(el, expanded, box, c);
  if (EVENTS.has(type)) return eventShape(el, box, c);
  if (GATEWAYS.has(type)) return gatewayShape(el, box, c);
  if (type === 'bpmn:Participant' || type === 'bpmn:Lane') return containerShape(el, di, box, c);
  if (type === 'bpmn:DataObjectReference' || type === 'bpmn:DataStoreReference' || type === 'bpmn:DataInput' || type === 'bpmn:DataOutput') {
    return dataShape(el, box, c);
  }
  if (type === 'bpmn:TextAnnotation') return annotationShape(el, box, c);
  if (type === 'bpmn:Group') return groupShape(box, c);
  // Anything else (a choreography, a conversation node…) is a plain frame with its name.
  return `<rect x="0" y="0" width="${n(box.width)}" height="${n(box.height)}" ${stroked(c, 1.5)}/>` +
    textBlock(el.name, { x: 0, y: 0, ...box }, { align: 'center-middle', colour: c.label });
}

/** The source element of a flow, to find out whether the flow is its default. */
function sourceOf(el: ModdleElement): ModdleElement | undefined {
  return el.$type === 'bpmn:SequenceFlow' ? el.sourceRef : undefined;
}

/**
 * Draws the diagram of `xml` as SVG. Throws when the XML cannot be read or has no diagram (no
 * `bpmndi:BPMNDiagram`, or none with the id `options.diagram`).
 */
export async function renderSvg(xmlIn: string, options: RenderSvgOptions = {}): Promise<string> {
  const { xml, sanitizedToOriginal } = sanitizeXmlIds(xmlIn);
  const { rootElement: definitions } = await BpmnModdle({ lila }).fromXML(xml);
  const diagrams = definitions.diagrams ?? [];
  const diagram = options.diagram === undefined ? diagrams[0] : diagrams.find((d) => (sanitizedToOriginal.get(d.id) ?? d.id) === options.diagram);
  if (diagram === undefined) {
    throw new Error(options.diagram === undefined ? 'The BPMN file has no diagram (bpmndi:BPMNDiagram).' : `No diagram with id "${options.diagram}".`);
  }
  const margin = options.margin ?? 20;
  const drawn = (diagram.plane?.planeElement ?? [])
    .filter((di) => di.bpmnElement !== undefined && (di.bounds !== undefined || (di.waypoint?.length ?? 0) >= 2));
  // A sub-process is expanded when its DI says so or its children are drawn on this plane
  // (exports that leave `isExpanded` out).
  const parents = new Set(drawn.map((di) => di.bpmnElement!.$parent));
  const isExpanded = (di: ModdleElement): boolean =>
    di.bounds !== undefined && (TASKS.has(di.bpmnElement!.$type) || SUBPROCESSES.has(di.bpmnElement!.$type)) &&
    (di.isExpanded === true || parents.has(di.bpmnElement));
  const elements = drawn
    .map((di, index) => ({ di, index, expanded: isExpanded(di), layer: layerOf(di, isExpanded(di)) }))
    .sort((a, b) => a.layer - b.layer || a.index - b.index);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const extend = (b: Bounds | undefined): void => {
    if (b === undefined) return;
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  };

  const body: string[] = [];
  const labels: string[] = [];
  for (const { di, expanded } of elements) {
    const el = di.bpmnElement!;
    const c = coloursOf(di);
    const id = escapeXml(sanitizedToOriginal.get(el.id) ?? el.id ?? '');
    if (di.bounds !== undefined) {
      const { x, y, width, height } = di.bounds;
      extend(di.bounds);
      body.push(`<g data-element-id="${id}" transform="translate(${n(x)} ${n(y)})">${shapeBody(el, di, expanded, { width, height }, c)}</g>`);
    } else {
      const points = di.waypoint!;
      for (const p of points) extend({ x: p.x, y: p.y, width: 0, height: 0 });
      body.push(`<g data-element-id="${id}">${edgeShape(el, points, c, sourceOf(el))}</g>`);
    }
    if (hasExternalLabel(el.$type)) {
      const label = externalLabel(el, di, c);
      if (label !== '') {
        extend(labelBounds(di));
        labels.push(label);
      }
    }
  }
  if (minX === Infinity) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  const x = minX - margin;
  const y = minY - margin;
  const width = maxX - minX + 2 * margin;
  const height = maxY - minY + 2 * margin;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="${n(x)} ${n(y)} ${n(width)} ${n(height)}">` +
    `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" fill="${THEME.paper}"/>` +
    body.join('') +
    labels.join('') +
    '</svg>'
  );
}
