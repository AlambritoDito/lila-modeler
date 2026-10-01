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

/** One lane of a process, with its nesting depth and whether it has lanes of its own. */
export interface LaneEntry {
  lane: El;
  depth: number;
  leaf: boolean;
}

/** Every lane of `process`, depth first, top to bottom. */
export function lanesOf(process: El): LaneEntry[] {
  const out: LaneEntry[] = [];
  const visit = (laneSet: El | undefined, depth: number): void => {
    for (const lane of (laneSet?.['lanes'] ?? []) as El[]) {
      const children = (lane['childLaneSet']?.['lanes'] ?? []) as El[];
      out.push({ lane, depth, leaf: children.length === 0 });
      visit(lane['childLaneSet'], depth + 1);
    }
  };
  for (const laneSet of (process['laneSets'] ?? []) as El[]) visit(laneSet, 0);
  return out;
}

/** The deepest lane `node` is listed in (`flowNodeRef`). */
export function laneOfNode(process: El, node: El): El | undefined {
  let found: LaneEntry | undefined;
  for (const entry of lanesOf(process)) {
    if (((entry.lane['flowNodeRef'] ?? []) as El[]).includes(node) && (found === undefined || entry.depth >= found.depth)) found = entry;
  }
  return found?.lane;
}

const isFlowNode = (el: El): boolean =>
  typeof el['$instanceOf'] === 'function' ? (el['$instanceOf'] as (t: string) => boolean)('bpmn:FlowNode') : el.$type !== 'bpmn:SequenceFlow';

/**
 * Lays the top-level nodes of `process` out in lanes, in place on `plane`, where their shapes sit at
 * the positions `bpmn-auto-layout` gave them (see the header): each node moves into the band of its
 * lane (the deepest lane that lists it; a node in no lane goes to the first one), the layouter's
 * rows compacted per leaf lane (an empty lane keeps one row), columns kept. Nested lanes stack their
 * leaves; a parent lane spans its children. Boundary events stay on their host. The sequence flows
 * are routed again with `route`, around the other shapes. The pool and lane shapes are updated, or
 * created (`<id>_di`), with the pool's corner at `origin`, and the plane moves to the collaboration.
 * Used by `create_process` (a new model) and `edit_process` (an existing one). Returns the pool's
 * bounds.
 */
export function layOutLanes(plane: El, process: El, participant: El, create: Create, origin: Point = { x: 0, y: 0 }): Box {
  const planeElements = (plane['planeElement'] ??= []) as El[];
  const shapeOf = new Map<string, El>();
  for (const di of planeElements) if (di.$type === 'bpmndi:BPMNShape' && di['bpmnElement'] !== undefined) shapeOf.set(di['bpmnElement'].id, di);

  const lanes = lanesOf(process);
  const leaves = lanes.filter((l) => l.leaf);
  const nodes = ((process['flowElements'] ?? []) as El[]).filter((el) => isFlowNode(el) && shapeOf.has(el.id));
  const laid = new Map(nodes.map((n) => [n.id, { ...(shapeOf.get(n.id)!['bounds'] as Box) }]));
  const leafOf = (node: El): El => {
    const lane = laneOfNode(process, node);
    if (lane === undefined) return leaves[0]!.lane;
    const entry = lanes.find((l) => l.lane === lane)!;
    if (entry.leaf) return lane;
    // A node of a parent lane only: that lane's first leaf.
    return lanes.slice(lanes.indexOf(entry)).find((l) => l.leaf && l.depth > entry.depth)?.lane ?? leaves[0]!.lane;
  };

  // Rows each leaf lane uses, compacted top to bottom; an empty lane still gets one row.
  const indent = HEADER * (2 + Math.max(0, ...leaves.map((l) => l.depth)));
  const rowOf = (b: Box): number => Math.round((b.y + b.height / 2 - CELL_HEIGHT / 2) / CELL_HEIGHT);
  const hosts = nodes.filter((n) => n['attachedToRef'] === undefined);
  const final = new Map<string, Box>();
  const bands = new Map<El, { top: number; height: number }>();
  let top = 0;
  for (const { lane } of leaves) {
    const mine = hosts.filter((n) => leafOf(n) === lane);
    const rows = [...new Set(mine.map((n) => rowOf(laid.get(n.id)!)))].sort((a, b) => a - b);
    const height = Math.max(1, rows.length) * CELL_HEIGHT;
    bands.set(lane, { top, height });
    for (const n of mine) {
      const b = laid.get(n.id)!;
      final.set(n.id, { ...b, x: origin.x + b.x + indent, y: origin.y + top + rows.indexOf(rowOf(b)) * CELL_HEIGHT + (CELL_HEIGHT - b.height) / 2 });
    }
    top += height;
  }
  // Boundary events keep their place on their host.
  for (const n of nodes) {
    const host = n['attachedToRef'] as El | undefined;
    const hostLaid = host === undefined ? undefined : laid.get(host.id);
    const hostFinal = host === undefined ? undefined : final.get(host.id);
    if (hostLaid === undefined || hostFinal === undefined) continue;
    const b = laid.get(n.id)!;
    final.set(n.id, { ...b, x: b.x + hostFinal.x - hostLaid.x, y: b.y + hostFinal.y - hostLaid.y });
  }

  // An end the layouter left behind its only predecessor (a branch that ends, QA of #553) goes to
  // its right, in its own row, clear of the other shapes.
  for (const n of hosts) {
    const incoming = ((process['flowElements'] ?? []) as El[]).filter((f) => f.$type === 'bpmn:SequenceFlow' && f['targetRef'] === n);
    const outgoing = ((process['flowElements'] ?? []) as El[]).filter((f) => f.$type === 'bpmn:SequenceFlow' && f['sourceRef'] === n);
    const source = incoming.length === 1 && outgoing.length === 0 ? final.get(incoming[0]!['sourceRef']?.id) : undefined;
    const box = final.get(n.id)!;
    if (source === undefined || box.x >= source.x + source.width) continue;
    box.x = source.x + source.width + 50;
    const others = [...final.values()].filter((b) => b !== box);
    while (others.some((b) => b.x < box.x + box.width + 10 && box.x < b.x + b.width + 10 && b.y < box.y + box.height && box.y < b.y + b.height)) box.x += 50;
  }

  let right = origin.x;
  for (const [id, b] of final) {
    shapeOf.get(id)!['bounds'] = create('dc:Bounds', { x: Math.round(b.x), y: Math.round(b.y), width: b.width, height: b.height });
    right = Math.max(right, b.x + b.width);
  }

  const gateway = (el: El): boolean => el.$type.endsWith('Gateway');
  const boxes = [...final.values()];
  const entries = new Map<string, number>();
  let lowest = -Infinity;
  const flows = new Set(((process['flowElements'] ?? []) as El[]).filter((el) => el.$type === 'bpmn:SequenceFlow'));
  for (const di of planeElements) {
    if (di.$type !== 'bpmndi:BPMNEdge' || !flows.has(di['bpmnElement'])) continue;
    const flow = di['bpmnElement'] as El;
    const source = final.get(flow['sourceRef']?.id);
    const target = final.get(flow['targetRef']?.id);
    if (source === undefined || target === undefined) continue;
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
    di['waypoint'] = points.map((p) => create('dc:Point', { x: Math.round(p.x), y: Math.round(p.y) }));
    delete di['label'];
    lowest = Math.max(lowest, ...points.map((p) => p.y));
  }

  // A detour under the last row would hug the pool's border (QA of #553): the last lane grows.
  const room = lowest + 25 - (origin.y + top);
  if (room > 0 && leaves.length > 0) {
    bands.get(leaves[leaves.length - 1]!.lane)!.height += room;
    top += room;
  }
  // A parent lane spans its children.
  for (const entry of [...lanes].reverse()) {
    if (entry.leaf) continue;
    const children = ((entry.lane['childLaneSet']?.['lanes'] ?? []) as El[]).map((c) => bands.get(c)).filter((b) => b !== undefined);
    if (children.length === 0) continue;
    const last = children[children.length - 1]!;
    bands.set(entry.lane, { top: children[0]!.top, height: last.top + last.height - children[0]!.top });
  }

  // The pool and the lanes: updated when they have a shape, created first in the plane when not.
  const pool: Box = { x: origin.x, y: origin.y, width: right - origin.x + MARGIN, height: top };
  const added: El[] = [];
  const draw = (el: El, box: Box): void => {
    const bounds = create('dc:Bounds', { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
    const shape = shapeOf.get(el.id);
    if (shape !== undefined) shape['bounds'] = bounds;
    else added.push(create('bpmndi:BPMNShape', { id: `${el.id}_di`, bpmnElement: el, isHorizontal: true, bounds }));
  };
  draw(participant, pool);
  for (const { lane, depth } of lanes) {
    const band = bands.get(lane);
    if (band === undefined) continue;
    const x = origin.x + HEADER * (depth + 1);
    draw(lane, { x, y: origin.y + band.top, width: pool.x + pool.width - x, height: band.height });
  }
  plane['planeElement'] = [...added, ...planeElements];
  if (plane['bpmnElement'] === process && participant['$parent'] !== undefined) plane['bpmnElement'] = participant['$parent'];
  return pool;
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
