/**
 * The diagram of a generated or edited process: the single home of Lila's layout on top of
 * `bpmn-auto-layout` 1.3 (#97, #98). `outline.ts` (`create_process`) uses it, and `edit-layout.ts`
 * (`edit_process`) builds on the same pieces.
 *
 * - `autoLayout`: the layouter itself, with its two traps handled. It needs every node's
 *   `outgoing` in the order their targets appear (otherwise `Grid.addAfter` throws, QA of #553),
 *   and any failure of its own becomes a `LayoutError` instead of a raw `TypeError`.
 * - `layOutLanes`: 1.3 draws no pool and no lanes. Every node moves into its lane's band (the
 *   layouter's rows, compacted per lane), the flows are routed again with `route`, and the pool
 *   and lane shapes are added.
 * - `route`: orthogonal routing that goes around the shapes in its way (a same-row skip over the
 *   tasks in between, QA of #553), and under both ends for a loop.
 * - `labelFlows`: a `BPMNLabel` for every named flow on its own segment, so branches that share a
 *   gateway's exit trunk keep their labels (QA of #553).
 * - `separateSubprocessPlanes`: the content of a collapsed sub-process on its own drill-down plane.
 *
 * Browser-safe: no `node:*`.
 */
import { layoutProcess } from 'bpmn-auto-layout';

/** A `bpmn-moddle` element, loosely typed. */
export type El = { $type: string; id: string } & Record<string, any>;
/** `moddle.create`, loosely typed. */
export type Create = (type: string, attrs?: Record<string, unknown>) => El;

/** Layout grid of `bpmn-auto-layout` 1.3 (its `DEFAULT_CELL_HEIGHT`). */
export const CELL_HEIGHT = 140;
/** The pool's label strip, and each lane's, as bpmn-js draws them. */
export const HEADER = 30;
const MARGIN = 40;

/** `bpmn-auto-layout` failed on a process; `message` is its own. */
export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutError';
  }
}

/**
 * Sorts every node's `outgoing` by the position of its target in `order` (ids; unknown ones go
 * last). `bpmn-auto-layout` 1.3 throws on a gateway whose branches are listed against the chain
 * order of their targets. The semantic order of the flows themselves is not touched.
 */
export function sortOutgoing(nodes: Iterable<El>, order: readonly string[]): void {
  const position = new Map(order.map((id, i) => [id, i]));
  const at = (flow: El): number => position.get(flow['targetRef']?.id) ?? Number.MAX_SAFE_INTEGER;
  for (const node of nodes) (node['outgoing'] as El[] | undefined)?.sort((a, b) => at(a) - at(b));
}

/** `layoutProcess` of `bpmn-auto-layout`, with its failures as `LayoutError`. */
export async function autoLayout(xml: string): Promise<string> {
  try {
    return await layoutProcess(xml);
  } catch (error) {
    throw new LayoutError(error instanceof Error ? error.message : String(error));
  }
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Point = { x: number; y: number };

/** Does the orthogonal polyline `points` pass through one of `boxes` (borders excluded)? */
export function crosses(points: readonly Point[], boxes: readonly Box[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    for (const box of boxes) {
      if (x2 > box.x + 1 && x1 < box.x + box.width - 1 && y2 > box.y + 1 && y1 < box.y + box.height - 1) return true;
    }
  }
  return false;
}

/**
 * An orthogonal route from `s` to `t`: straight when they share a row; out of a gateway's top or
 * bottom and into a gateway's top or bottom when the rows differ (as bpmn-js draws a split and a
 * join). When that would cross another shape (a forward skip over the tasks in between, QA of
 * #553), or for a backward flow (a loop), it goes around: under every shape in its way, or over.
 */
export function route(s: Box, t: Box, sourceGateway: boolean, targetGateway: boolean, others: readonly Box[]): Point[] {
  const sy = s.y + s.height / 2;
  const ty = t.y + t.height / 2;
  const sx = s.x + s.width / 2;
  const tx = t.x + t.width / 2;
  const obstacles = others.filter((box) => box !== s && box !== t);
  if (t.x >= s.x + s.width) {
    let direct: Point[];
    if (Math.abs(sy - ty) < 1) direct = [{ x: s.x + s.width, y: sy }, { x: t.x, y: ty }];
    else if (sourceGateway) direct = [{ x: sx, y: ty > sy ? s.y + s.height : s.y }, { x: sx, y: ty }, { x: t.x, y: ty }];
    else if (targetGateway) direct = [{ x: s.x + s.width, y: sy }, { x: tx, y: sy }, { x: tx, y: sy > ty ? t.y + t.height : t.y }];
    else {
      const x = t.x - 25;
      direct = [{ x: s.x + s.width, y: sy }, { x, y: sy }, { x, y: ty }, { x: t.x, y: ty }];
    }
    if (!crosses(direct, obstacles)) return direct;
  }
  const [left, right] = [Math.min(sx, tx), Math.max(sx, tx)];
  const inSpan = obstacles.filter((box) => box.x < right && box.x + box.width > left);
  let below = Math.max(s.y + s.height, t.y + t.height) + 20;
  for (let moved = true; moved; ) {
    moved = false;
    for (const box of inSpan) {
      if (below > box.y && below < box.y + box.height) {
        below = box.y + box.height + 20;
        moved = true;
      }
    }
  }
  const under = [{ x: sx, y: s.y + s.height }, { x: sx, y: below }, { x: tx, y: below }, { x: tx, y: t.y + t.height }];
  if (!crosses(under, obstacles)) return under;
  let above = Math.min(s.y, t.y) - 20;
  for (let moved = true; moved; ) {
    moved = false;
    for (const box of inSpan) {
      if (above > box.y && above < box.y + box.height) {
        above = box.y - 20;
        moved = true;
      }
    }
  }
  const over = [{ x: sx, y: s.y }, { x: sx, y: above }, { x: tx, y: above }, { x: tx, y: t.y }];
  return crosses(over, obstacles) ? under : over;
}

/**
 * Writes a `BPMNLabel` for every named flow of `plane`, next to the flow's own last horizontal
 * segment. Without one, bpmn-js puts the label at the middle of the first segment, which several
 * branches of a gateway share: the labels then sit on the wrong branch (QA of #553).
 */
export function labelFlows(plane: El, create: Create): void {
  for (const di of plane['planeElement'] as El[]) {
    const name = di['bpmnElement']?.['name'] as string | undefined;
    if (di.$type !== 'bpmndi:BPMNEdge' || name === undefined || name === '') continue;
    const points = (di['waypoint'] as { x: number; y: number }[]).map((p) => ({ x: p.x, y: p.y }));
    let segment: [Point, Point] | undefined;
    for (let i = points.length - 1; i > 0 && segment === undefined; i--) {
      if (Math.abs(points[i]!.y - points[i - 1]!.y) < 1 && Math.abs(points[i]!.x - points[i - 1]!.x) >= 20) {
        segment = [points[i - 1]!, points[i]!];
      }
    }
    const width = Math.max(16, Math.round(name.length * 6.5));
    // A detour under its source puts its label at the target's end, clear of the gateway's own name.
    const under = segment !== undefined && segment[0].y > points[0]!.y + 1 && segment[0].y > points[points.length - 1]!.y + 1;
    const [x, y] =
      segment !== undefined
        ? under
          ? [segment[1].x > segment[0].x ? segment[1].x - width - 8 : segment[1].x + 8, segment[0].y - 18]
          : [Math.min(segment[0].x, segment[1].x) + 8, segment[0].y - 18]
        : [points[points.length - 2]!.x + 6, (points[points.length - 2]!.y + points[points.length - 1]!.y) / 2 - 7];
    di['label'] = create('bpmndi:BPMNLabel', {
      bounds: create('dc:Bounds', { x: Math.round(x), y: Math.round(y), width, height: 14 }),
    });
  }
}

/**
 * Moves every node of the main plane into its lane's band and adds the pool and lane shapes (see
 * the header). Each lane is as tall as the layouter rows its nodes use, compacted; columns stay.
 */
export function layOutLanes(definitions: El, laneNames: readonly string[], laneOf: ReadonlyMap<string, string>, create: Create): void {
  const process = (definitions['rootElements'] as El[]).find((el) => el.$type === 'bpmn:Process')!;
  const collaboration = (definitions['rootElements'] as El[]).find((el) => el.$type === 'bpmn:Collaboration')!;
  const participant = collaboration['participants'][0] as El;
  const diagram = (definitions['diagrams'] as El[]).find((d) => d['plane']['bpmnElement'] === process)!;
  const plane = diagram['plane'] as El;
  const planeElements = plane['planeElement'] as El[];
  const shapeOf = new Map<string, El>();
  for (const di of planeElements) if (di.$type === 'bpmndi:BPMNShape') shapeOf.set(di['bpmnElement'].id, di);

  const nodes = (process['flowElements'] as El[]).filter((el) => el.$type !== 'bpmn:SequenceFlow');
  const rowOf = (shape: El): number => Math.round((shape['bounds'].y + shape['bounds'].height / 2 - CELL_HEIGHT / 2) / CELL_HEIGHT);

  // Rows each lane uses, compacted top to bottom; an empty lane still gets one row.
  let top = 0;
  const bands = new Map<string, { top: number; rows: Map<number, number>; height: number }>();
  for (const lane of laneNames) {
    const rows = [...new Set(nodes.filter((n) => laneOf.get(n.id) === lane).map((n) => rowOf(shapeOf.get(n.id)!)))].sort((a, b) => a - b);
    const height = Math.max(1, rows.length) * CELL_HEIGHT;
    bands.set(lane, { top, rows: new Map(rows.map((row, index) => [row, index])), height });
    top += height;
  }

  let right = 0;
  for (const node of nodes) {
    const shape = shapeOf.get(node.id)!;
    const band = bands.get(laneOf.get(node.id)!)!;
    const bounds = shape['bounds'];
    const index = band.rows.get(rowOf(shape))!;
    bounds.x += 2 * HEADER;
    bounds.y = band.top + index * CELL_HEIGHT + (CELL_HEIGHT - bounds.height) / 2;
    right = Math.max(right, bounds.x + bounds.width);
  }

  const gateway = (el: El): boolean => el.$type.endsWith('Gateway');
  const boxes = nodes.map((node) => shapeOf.get(node.id)!['bounds'] as Box);
  const entries = new Map<string, number>();
  for (const di of planeElements) {
    if (di.$type !== 'bpmndi:BPMNEdge') continue;
    const flow = di['bpmnElement'] as El;
    const source = shapeOf.get(flow['sourceRef'].id)!['bounds'];
    const target = shapeOf.get(flow['targetRef'].id)!['bounds'];
    const points = route(source, target, gateway(flow['sourceRef']), gateway(flow['targetRef']), boxes);
    // Two detours entering the same shape from below (or above) would share their last stretch:
    // each later one comes in a little further right.
    const [a, b] = [points[points.length - 2]!, points[points.length - 1]!];
    if (points.length > 2 && a.x === b.x) {
      const key = `${flow['targetRef'].id}:${b.y}`;
      const seen = entries.get(key) ?? 0;
      entries.set(key, seen + 1);
      a.x += seen * 12;
      b.x += seen * 12;
    }
    di['waypoint'] = points.map((p) =>
      create('dc:Point', { x: Math.round(p.x), y: Math.round(p.y) }),
    );
  }

  const width = right + MARGIN;
  const shapes: El[] = [
    create('bpmndi:BPMNShape', {
      id: `${participant.id}_di`,
      bpmnElement: participant,
      isHorizontal: true,
      bounds: create('dc:Bounds', { x: 0, y: 0, width, height: top }),
    }),
  ];
  for (const lane of process['laneSets'][0]['lanes'] as El[]) {
    const band = bands.get(lane['name'])!;
    shapes.push(
      create('bpmndi:BPMNShape', {
        id: `${lane.id}_di`,
        bpmnElement: lane,
        isHorizontal: true,
        bounds: create('dc:Bounds', { x: HEADER, y: band.top, width: width - HEADER, height: band.height }),
      }),
    );
  }
  plane['planeElement'] = [...shapes, ...planeElements];
  plane['bpmnElement'] = collaboration;
}

/**
 * `bpmn-auto-layout` 1.3 draws a sub-process collapsed but leaves the DI of its content on the
 * main plane, where bpmn-js would paint it over the process. Each sub-process gets its own
 * diagram instead (the drill-down plane bpmn-js opens), and its content's DI moves there.
 */
export function separateSubprocessPlanes(definitions: El, create: Create): void {
  const main = (definitions['diagrams'] as El[])[0]!['plane'] as El;
  const moved = new Map<El, El[]>();
  const keep: El[] = [];
  for (const di of main['planeElement'] as El[]) {
    const parent = di['bpmnElement']?.['$parent'] as El | undefined;
    if (parent?.$type === 'bpmn:SubProcess') (moved.get(parent) ?? moved.set(parent, []).get(parent)!).push(di);
    else keep.push(di);
  }
  if (moved.size === 0) return;
  main['planeElement'] = keep;
  for (const [subprocess, elements] of moved) {
    const plane = create('bpmndi:BPMNPlane', { id: `BPMNPlane_${subprocess.id}`, bpmnElement: subprocess, planeElement: elements });
    (definitions['diagrams'] as El[]).push(create('bpmndi:BPMNDiagram', { id: `BPMNDiagram_${subprocess.id}`, plane }));
  }
}
