/**
 * The diagram side of `edit_process` (#98): the DI of a process being edited in place.
 *
 * Two ways to draw an edited process:
 *
 * - `relayout`: the process's flow is laid out again with `bpmn-auto-layout` (the same layouter
 *   `create_process` uses) and Lila's lane fix: every node moves into its lane's band (rows
 *   compacted per lane), the flows are routed again orthogonally and the pool and lanes are
 *   resized. Only the DI of that process changes. The layouter gets a stripped copy of the flow
 *   (ids, types and flows), never the document, so nothing semantic can be lost on the way. Text
 *   annotations and data objects follow the element they are attached to; pools below this one
 *   move down (or up) by as much as it grew (or shrank); the content of collapsed sub-processes
 *   keeps its drill-down diagram as it was. An expanded sub-process becomes a collapsed one with
 *   its content on its own drill-down diagram, the way `create_process` draws it.
 * - incremental (`layout: false`): every shape and edge keeps its place; a new node goes right of
 *   its predecessor (making room by shifting what is to its right) and in its lane's band, and only
 *   the flows whose ends changed are routed again.
 *
 * The layouter call, the lane layout, the routing and the flow labels are `layout.ts`'s, the same
 * code `create_process` uses: this file only adds what editing an existing diagram needs.
 *
 * Browser-safe, like `outline.ts`.
 */
import { BpmnModdle } from 'bpmn-moddle';

import {
  autoLayout,
  CELL_HEIGHT,
  crosses,
  HEADER,
  labelFlows,
  layOutLanes,
  lanesOf,
  route,
  sortOutgoing,
  type Box,
  type Create,
  type El,
  type Point,
} from './layout.js';

export type { Box, Create, El, Point } from './layout.js';

const MARGIN = 40;
/** Horizontal gap between a new node and its predecessor. */
const GAP = 50;

export function is(el: unknown, type: string): boolean {
  const candidate = el as { $instanceOf?: (t: string) => boolean } | undefined;
  return typeof candidate?.$instanceOf === 'function' && candidate.$instanceOf(type);
}

/** bpmn-js's default size for a node of this type. */
export function sizeOf(el: El): { width: number; height: number } {
  if (is(el, 'bpmn:Event')) return { width: 36, height: 36 };
  if (is(el, 'bpmn:Gateway')) return { width: 50, height: 50 };
  return { width: 100, height: 80 };
}

const center = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const right = (b: Box): number => b.x + b.width;
const bottom = (b: Box): number => b.y + b.height;
const copy = (b: Box): Box => ({ x: b.x, y: b.y, width: b.width, height: b.height });
const overlaps = (a: Box, b: Box, pad = 0): boolean =>
  a.x < right(b) + pad && b.x < right(a) + pad && a.y < bottom(b) + pad && b.y < bottom(a) + pad;

/** Where the segment from the centre of `b` towards `p` leaves `b`. */
function border(b: Box, p: Point): Point {
  const c = center(b);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const scale = Math.min(dx === 0 ? Infinity : b.width / 2 / Math.abs(dx), dy === 0 ? Infinity : b.height / 2 / Math.abs(dy));
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

/** A straight association from the border of `s` to the border of `t`. */
function straight(s: Box, t: Box): Point[] {
  return [border(s, center(t)), border(t, center(s))];
}

/** A message flow between pools: out of the top or bottom of one, into the other. */
function vertical(s: Box, t: Box): Point[] {
  const sx = center(s).x;
  const tx = center(t).x;
  const down = center(t).y >= center(s).y;
  const sy = down ? bottom(s) : s.y;
  const ty = down ? t.y : bottom(t);
  if (Math.abs(sx - tx) < 1) return [{ x: sx, y: sy }, { x: tx, y: ty }];
  // The horizontal stretch runs just outside the target, in the gap between the pools.
  const mid = down ? ty - 15 : ty + 15;
  return [{ x: sx, y: sy }, { x: sx, y: mid }, { x: tx, y: mid }, { x: tx, y: ty }];
}

/** The DI of a document: shapes and edges by the id of their BPMN element, and their planes. */
export class Diagram {
  readonly shapes = new Map<string, El>();
  readonly edges = new Map<string, El>();
  readonly planeOf = new Map<El, El>();
  /** Ids of the elements whose shapes moved (incremental layout), to route their links again. */
  readonly moved = new Set<string>();
  /** Sequence flows routed again (incremental layout), to label them again. */
  readonly rerouted = new Set<El>();
  /** What `makeRoom` may move: the elements of the process being edited. Default: everything. */
  owns: (el: El) => boolean = () => true;

  constructor(
    readonly definitions: El,
    readonly create: Create,
    readonly uniqueId: (base: string) => string,
  ) {
    this.index();
  }

  index(): void {
    this.shapes.clear();
    this.edges.clear();
    this.planeOf.clear();
    for (const diagram of (this.definitions['diagrams'] ?? []) as El[]) {
      const plane = diagram['plane'] as El | undefined;
      if (plane === undefined) continue;
      for (const di of (plane['planeElement'] ?? []) as El[]) {
        const id = (di['bpmnElement'] as El | undefined)?.id;
        if (id === undefined) continue;
        if (di.$type === 'bpmndi:BPMNShape') this.shapes.set(id, di);
        else if (di.$type === 'bpmndi:BPMNEdge') this.edges.set(id, di);
        this.planeOf.set(di, plane);
      }
    }
  }

  get hasDi(): boolean {
    return this.shapes.size > 0;
  }

  bounds(id: string): Box | undefined {
    return this.shapes.get(id)?.['bounds'] as Box | undefined;
  }

  /** The plane a node of `container` is drawn on: its sub-process's own plane, or the main one. */
  planeFor(container: El, process: El): El | undefined {
    const diagrams = (this.definitions['diagrams'] ?? []) as El[];
    if (container !== process) {
      const own = diagrams.find((d) => d['plane']?.['bpmnElement'] === container);
      if (own !== undefined) return own['plane'];
      const shape = this.shapes.get(container.id);
      if (shape !== undefined) return this.planeOf.get(shape);
    }
    return this.mainPlane(process);
  }

  mainPlane(process: El): El | undefined {
    const diagrams = (this.definitions['diagrams'] ?? []) as El[];
    const direct = diagrams.find((d) => d['plane']?.['bpmnElement'] === process);
    if (direct !== undefined) return direct['plane'];
    const collaborations = ((this.definitions['rootElements'] ?? []) as El[]).filter((r) => r.$type === 'bpmn:Collaboration');
    const pooled = diagrams.find((d) => collaborations.includes(d['plane']?.['bpmnElement']));
    return (pooled ?? diagrams[0])?.['plane'];
  }

  /** A plane for `process` when the document has no diagram at all. */
  ensurePlane(process: El, collaboration: El | undefined): El {
    const existing = this.mainPlane(process);
    if (existing !== undefined) return existing;
    const plane = this.create('bpmndi:BPMNPlane', {
      id: this.uniqueId('BPMNPlane_1'),
      bpmnElement: collaboration ?? process,
      planeElement: [],
    });
    ((this.definitions['diagrams'] ??= []) as El[]).push(this.create('bpmndi:BPMNDiagram', { id: this.uniqueId('BPMNDiagram_1'), plane }));
    return plane;
  }

  removeDi(id: string): void {
    for (const map of [this.shapes, this.edges]) {
      const di = map.get(id);
      if (di === undefined) continue;
      const plane = this.planeOf.get(di);
      if (plane !== undefined) plane['planeElement'] = (plane['planeElement'] as El[]).filter((e) => e !== di);
      map.delete(id);
      this.planeOf.delete(di);
    }
  }

  addShape(el: El, plane: El, box: Box, attrs: Record<string, unknown> = {}): El {
    this.removeDi(el.id);
    const shape = this.create('bpmndi:BPMNShape', {
      id: this.uniqueId(`${el.id}_di`),
      bpmnElement: el,
      bounds: this.create('dc:Bounds', rounded(box)),
      ...attrs,
    });
    ((plane['planeElement'] ??= []) as El[]).push(shape);
    this.moved.add(el.id);
    this.shapes.set(el.id, shape);
    this.planeOf.set(shape, plane);
    return shape;
  }

  setBounds(id: string, box: Box): void {
    const shape = this.shapes.get(id);
    if (shape === undefined) return;
    shape['bounds'] = this.create('dc:Bounds', rounded(box));
    delete shape['label'];
    this.moved.add(id);
  }

  setWaypoints(flow: El, points: Point[], plane: El | undefined): void {
    let edge = this.edges.get(flow.id);
    const waypoint = points.map((p) => this.create('dc:Point', { x: Math.round(p.x), y: Math.round(p.y) }));
    if (edge === undefined) {
      if (plane === undefined) return;
      edge = this.create('bpmndi:BPMNEdge', { id: this.uniqueId(`${flow.id}_di`), bpmnElement: flow, waypoint });
      ((plane['planeElement'] ??= []) as El[]).push(edge);
      this.edges.set(flow.id, edge);
      this.planeOf.set(edge, plane);
      return;
    }
    edge['waypoint'] = waypoint;
    delete edge['label'];
  }

  /** Routes a sequence flow again between its two shapes; a no-op when either has no shape. */
  routeFlow(flow: El): void {
    const s = this.bounds(flow['sourceRef']?.id);
    const t = this.bounds(flow['targetRef']?.id);
    if (s === undefined || t === undefined) return;
    const plane = this.planeOf.get(this.shapes.get(flow['sourceRef'].id)!);
    const obstacles = plane === undefined ? [] : this.nodeShapes(plane).map((di) => di['bounds'] as Box);
    this.setWaypoints(flow, route(s, t, is(flow['sourceRef'], 'bpmn:Gateway'), is(flow['targetRef'], 'bpmn:Gateway'), obstacles), plane);
    this.rerouted.add(flow);
  }

  /**
   * Routes again the flows among `flows` that now run through a shape the edit added or moved
   * (incremental layout): an untouched flow that crosses nothing new keeps its waypoints.
   */
  untangle(flows: Iterable<El>): void {
    for (const flow of flows) {
      const edge = this.edges.get(flow.id);
      const plane = edge === undefined ? undefined : this.planeOf.get(edge);
      if (edge === undefined || plane === undefined) continue;
      const ends = new Set([flow['sourceRef']?.id, flow['targetRef']?.id]);
      const fresh = this.nodeShapes(plane)
        .filter((di) => this.moved.has(di['bpmnElement'].id) && !ends.has(di['bpmnElement'].id))
        .map((di) => di['bounds'] as Box);
      if (crosses((edge['waypoint'] ?? []) as Point[], fresh)) this.routeFlow(flow);
    }
  }

  /** `labelFlows` on the edges of `flows` only: the other edges of the plane keep their labels. */
  label(flows: Iterable<El>): void {
    const planeElement = [...flows].map((f) => this.edges.get(f.id)).filter((e) => e !== undefined);
    labelFlows({ $type: 'bpmndi:BPMNPlane', id: '', planeElement }, this.create);
  }

  /** Every flow-like edge (sequence, message, association) touching `id`, routed again. */
  rerouteAround(id: string, flows: Iterable<El>): void {
    for (const flow of flows) {
      if (flow['sourceRef']?.id !== id && flow['targetRef']?.id !== id) continue;
      if (flow.$type === 'bpmn:SequenceFlow') this.routeFlow(flow);
      else this.routeOther(flow);
    }
  }

  /** A message flow or an association (also a data association), drawn straight. */
  routeOther(flow: El): void {
    let source: El | undefined;
    let target: El | undefined;
    if (flow.$type === 'bpmn:DataInputAssociation') {
      source = (flow['sourceRef'] ?? [])[0];
      target = flow['$parent'];
    } else if (flow.$type === 'bpmn:DataOutputAssociation') {
      source = flow['$parent'];
      target = flow['targetRef'];
    } else {
      source = flow['sourceRef'];
      target = flow['targetRef'];
    }
    const s = source === undefined ? undefined : this.bounds(source.id);
    const t = target === undefined ? undefined : this.bounds(target.id);
    if (s === undefined || t === undefined || !this.edges.has(flow.id)) return;
    this.setWaypoints(flow, flow.$type === 'bpmn:MessageFlow' ? vertical(s, t) : straight(s, t), undefined);
  }

  /**
   * After a pool went from `before` to `after`: what lies entirely right of it (vertical pools, as
   * Bizagi draws them) moves right by as much as it grew wider and, with `down`, what lies entirely
   * below it moves down by as much as it grew taller. The process's own shapes never move here.
   */
  pushAside(plane: El, before: Box, after: Box, down: boolean): void {
    const dy = down ? after.height - before.height : 0;
    const dx = after.width - before.width;
    if (dx === 0 && dy === 0) return;
    const below = bottom(before);
    const beside = right(before);
    for (const di of (plane['planeElement'] ?? []) as El[]) {
      if (this.owns(di['bpmnElement'])) continue;
      if (di.$type === 'bpmndi:BPMNShape') {
        const b = di['bounds'] as Box;
        const by = b.y >= below ? dy : 0;
        const bx = by === 0 && b.x >= beside ? dx : 0;
        b.y += by;
        b.x += bx;
        if (di['label']?.['bounds'] !== undefined) {
          di['label']['bounds'].y += by;
          di['label']['bounds'].x += bx;
        }
        if (bx !== 0 || by !== 0) this.moved.add(di['bpmnElement'].id);
      } else if (di.$type === 'bpmndi:BPMNEdge') {
        const points = (di['waypoint'] ?? []) as Point[];
        if (dy !== 0 && points.every((p) => p.y >= below)) for (const p of points) p.y += dy;
        else if (dx !== 0 && points.every((p) => p.x >= beside)) for (const p of points) p.x += dx;
      }
    }
  }

  /**
   * Draws the message flows of `definitions` again between their shapes, out of the top or bottom
   * of the source and into the bottom or top of the target. Flows that share a target (or a
   * source) get their own entry (exit) point and their own horizontal stretch, a little apart, and
   * each label sits on its own stretch (QA of #557: two notifications into one task overlapped).
   */
  routeMessages(definitions: El): void {
    const flows: El[] = [];
    for (const root of (definitions['rootElements'] ?? []) as El[]) for (const m of (root['messageFlows'] ?? []) as El[]) flows.push(m);
    const drawable = flows.filter((m) => this.edges.has(m.id) && this.bounds(m['sourceRef']?.id) && this.bounds(m['targetRef']?.id));
    const slot = (key: (m: El) => string, m: El): { k: number; n: number } => {
      const group = drawable.filter((o) => key(o) === key(m)).sort((a, b) => center(this.bounds(a['sourceRef'].id)!).x - center(this.bounds(b['sourceRef'].id)!).x);
      return { k: group.indexOf(m), n: group.length };
    };
    for (const m of drawable) {
      const s = this.bounds(m['sourceRef'].id)!;
      const t = this.bounds(m['targetRef'].id)!;
      const into = slot((o) => o['targetRef'].id, m);
      const out = slot((o) => o['sourceRef'].id, m);
      const spread = (b: Box, { k, n }: { k: number; n: number }): number => center(b).x + (k - (n - 1) / 2) * Math.min(20, b.width / (n + 1));
      const sx = spread(s, out);
      const tx = spread(t, into);
      const down = center(t).y >= center(s).y;
      const sy = down ? bottom(s) : s.y;
      const ty = down ? t.y : bottom(t);
      const mid = down ? ty - 15 - into.k * 24 : ty + 15 + into.k * 24;
      const points = Math.abs(sx - tx) < 1 ? [{ x: sx, y: sy }, { x: tx, y: ty }] : [{ x: sx, y: sy }, { x: sx, y: mid }, { x: tx, y: mid }, { x: tx, y: ty }];
      this.setWaypoints(m, points, undefined);
    }
    this.label(drawable);
  }

  /** Shapes that contain others: pools, lanes and expanded sub-processes. */
  isContainer(shape: El): boolean {
    const el = shape['bpmnElement'];
    return is(el, 'bpmn:Participant') || is(el, 'bpmn:Lane') || (is(el, 'bpmn:SubProcess') && shape['isExpanded'] === true);
  }

  /**
   * Makes `dx` of room at `fromX` in `plane`, between `top` and `bottom`: what starts right of it
   * moves right, and the pools, lanes and expanded sub-processes it crosses get wider.
   */
  makeRoom(plane: El, fromX: number, dx: number, band: { top: number; bottom: number }): void {
    const inBand = (b: Box): boolean => b.y < band.bottom && bottom(b) > band.top;
    for (const di of (plane['planeElement'] ?? []) as El[]) {
      if (!this.owns(di['bpmnElement'])) continue;
      if (di.$type === 'bpmndi:BPMNShape') {
        const b = di['bounds'] as Box;
        if (!inBand(b)) continue;
        if (b.x >= fromX) {
          b.x += dx;
          if (di['label']?.['bounds'] !== undefined) di['label']['bounds'].x += dx;
          this.moved.add(di['bpmnElement'].id);
        } else if (this.isContainer(di) && right(b) > fromX) b.width += dx;
      } else if (di.$type === 'bpmndi:BPMNEdge') {
        for (const p of (di['waypoint'] ?? []) as Point[]) if (p.x >= fromX && p.y >= band.top && p.y <= band.bottom) p.x += dx;
        if (di['label']?.['bounds'] !== undefined && di['label']['bounds'].x >= fromX) di['label']['bounds'].x += dx;
      }
    }
  }

  /**
   * Moves everything of `plane` at or below `fromY` down by `dy`; pools and lanes across it grow, and
   * so do the shapes of the elements in `grow` (a lane whose bottom is `fromY`, say).
   */
  shiftDown(plane: El, fromY: number, dy: number, skip: ReadonlySet<El> = new Set(), grow: ReadonlySet<El> = new Set()): void {
    for (const di of (plane['planeElement'] ?? []) as El[]) {
      if (skip.has(di)) continue;
      if (di.$type === 'bpmndi:BPMNShape') {
        const b = di['bounds'] as Box;
        if (grow.has(di['bpmnElement'])) b.height += dy;
        else if (b.y >= fromY) {
          b.y += dy;
          this.moved.add(di['bpmnElement'].id);
          if (di['label']?.['bounds'] !== undefined) di['label']['bounds'].y += dy;
        } else if (this.isContainer(di) && bottom(b) > fromY) b.height += dy;
      } else if (di.$type === 'bpmndi:BPMNEdge') {
        for (const p of (di['waypoint'] ?? []) as Point[]) if (p.y >= fromY) p.y += dy;
        if (di['label']?.['bounds'] !== undefined && di['label']['bounds'].y >= fromY) di['label']['bounds'].y += dy;
      }
    }
  }

  /** Widens the pools and lanes around `box` so it fits inside them. */
  fit(box: Box, plane: El): void {
    const containers = ((plane['planeElement'] ?? []) as El[]).filter(
      (di) => di.$type === 'bpmndi:BPMNShape' && (is(di['bpmnElement'], 'bpmn:Participant') || is(di['bpmnElement'], 'bpmn:Lane')),
    );
    const c = center(box);
    for (const di of containers) {
      const b = di['bounds'] as Box;
      if (b.x <= box.x && c.y >= b.y && c.y <= bottom(b) && right(b) < right(box) + MARGIN) b.width = right(box) + MARGIN - b.x;
    }
    // Lanes as wide as their pool.
    for (const pool of containers.filter((di) => is(di['bpmnElement'], 'bpmn:Participant'))) {
      const p = pool['bounds'] as Box;
      for (const lane of containers.filter((di) => is(di['bpmnElement'], 'bpmn:Lane'))) {
        const l = lane['bounds'] as Box;
        if (l.y >= p.y && bottom(l) <= bottom(p) + 1 && l.x >= p.x && l.x < right(p)) l.width = right(p) - l.x;
      }
    }
  }

  /** The node shapes (not pools, lanes or labels) of `plane`. */
  nodeShapes(plane: El): El[] {
    return ((plane['planeElement'] ?? []) as El[]).filter((di) => di.$type === 'bpmndi:BPMNShape' && !this.isContainer(di));
  }

  /**
   * A free top `y` for a `width`×`height` shape at `x`, as near `preferred` (a centre) as possible:
   * inside `band` (a lane or pool) when given, in one of its rows; when the band is full it grows
   * by one row (`grow`: the shapes that grow with it) and the shape goes there.
   */
  slot(plane: El, el: El, x: number, size: { width: number; height: number }, preferred: number, band: Box | undefined, grow: ReadonlySet<El>): number {
    const free = (y: number): boolean => {
      const box = { x, y, width: size.width, height: size.height };
      return !this.nodeShapes(plane).some((di) => di['bpmnElement'] !== el && overlaps(di['bounds'] as Box, box, 10));
    };
    if (band === undefined) {
      let y = preferred - size.height / 2;
      for (let tries = 0; tries < 20 && !free(y); tries++) y += size.height + 20;
      return y;
    }
    const rows = Math.max(1, Math.floor(band.height / CELL_HEIGHT));
    const centres = [preferred, center(band).y, ...Array.from({ length: rows }, (_, i) => band.y + CELL_HEIGHT / 2 + i * CELL_HEIGHT)];
    for (const c of centres) {
      const y = c - size.height / 2;
      if (y >= band.y && y + size.height <= bottom(band) && free(y)) return y;
    }
    const at = bottom(band);
    this.shiftDown(plane, at, CELL_HEIGHT, new Set(), grow);
    return at + (CELL_HEIGHT - size.height) / 2;
  }

  /** The shapes that grow with `lane` when it gets a row: the lane, the lanes above it and the pool. */
  growing(lane: El | undefined, pool: El | undefined): Set<El> {
    const out = new Set<El>();
    for (let l = lane; l !== undefined && l.$type === 'bpmn:Lane'; l = l['$parent']?.['$parent']) out.add(l);
    if (pool !== undefined) out.add(pool);
    return out;
  }

  /**
   * Places a new node `el` (incremental layout): right of `anchor` (its predecessor) when there is
   * one, making room by shifting what is to its right (also when its successor `next` is too
   * close), else at the right end of its band; always in `lane`'s band when given.
   */
  place(el: El, plane: El, options: { anchor?: El | undefined; next?: El | undefined; lane?: El | undefined; pool?: El | undefined }): void {
    const size = sizeOf(el);
    const anchor = options.anchor === undefined ? undefined : this.bounds(options.anchor.id);
    const next = options.next === undefined ? undefined : this.bounds(options.next.id);
    const laneBox = options.lane === undefined ? undefined : this.bounds(options.lane.id);
    const poolBox = options.pool === undefined ? undefined : this.bounds(options.pool.id);
    const band = laneBox ?? poolBox;
    const insideBand = (y: number): boolean => band === undefined || (y >= band.y && y <= bottom(band));

    let x: number;
    let preferred: number;
    if (anchor !== undefined) {
      preferred = insideBand(center(anchor).y) ? center(anchor).y : center(band!).y;
      x = right(anchor) + GAP;
      const range = poolBox === undefined ? { top: -Infinity, bottom: Infinity } : { top: poolBox.y, bottom: bottom(poolBox) };
      const slot: Box = { x, y: preferred - size.height / 2, width: size.width, height: size.height };
      if (next !== undefined && next.x > anchor.x && next.x < x + size.width + GAP) {
        this.makeRoom(plane, right(anchor) + 1, x + size.width + GAP - next.x, range);
      } else if (this.nodeShapes(plane).some((di) => di['bpmnElement'] !== el && overlaps(di['bounds'] as Box, slot, 10))) {
        this.makeRoom(plane, right(anchor) + 1, size.width + GAP, range);
      }
    } else {
      const inBand = this.nodeShapes(plane)
        .map((di) => di['bounds'] as Box)
        .filter((b) => band === undefined || (center(b).y >= band.y && center(b).y <= bottom(band)));
      const last = inBand.reduce<Box | undefined>((r, b) => (r === undefined || right(b) > right(r) ? b : r), undefined);
      x = last === undefined ? (band?.x ?? 0) + 2 * HEADER + 40 : right(last) + GAP;
      preferred = band !== undefined ? center(band).y : last !== undefined ? center(last).y : 100;
    }
    const y = this.slot(plane, el, x, size, preferred, band, this.growing(options.lane, options.pool));
    const box: Box = { x, y, ...size };
    this.addShape(el, plane, box);
    this.fit(box, plane);
  }

  /** Moves the shape of `el` into the band of `lane`, keeping its column. */
  moveIntoLane(el: El, lane: El, pool: El | undefined): void {
    const shape = this.bounds(el.id);
    const band = this.bounds(lane.id);
    if (shape === undefined || band === undefined) return;
    const plane = this.planeOf.get(this.shapes.get(el.id)!)!;
    const size = { width: shape.width, height: shape.height };
    const y = this.slot(plane, el, shape.x, size, center(band).y, band, this.growing(lane, pool));
    const box = { x: shape.x, y, ...size };
    this.setBounds(el.id, box);
    this.fit(box, plane);
  }

  /** Gives the shape of `el` the default size of its (new) type, keeping its centre. */
  resize(el: El): void {
    const b = this.bounds(el.id);
    if (b === undefined) return;
    const size = sizeOf(el);
    const c = center(b);
    this.setBounds(el.id, { x: c.x - size.width / 2, y: c.y - size.height / 2, ...size });
  }
}

function rounded(b: Box): Record<string, number> {
  return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
}

/* ------------------------------------------------------------------ *
 * Re-layout of one process
 * ------------------------------------------------------------------ */

export interface RelayoutContext {
  definitions: El;
  process: El;
  /** The pool of `process`, if it has one. */
  participant: El | undefined;
  /** The bounds its pool had before the edit, if it had a shape. */
  pool: Box | undefined;
  diagram: Diagram;
}

/** The DI of the sub-process content that sits on `plane` moves to the sub-process's own plane. */
function collapse(context: RelayoutContext, subprocess: El, plane: El): void {
  const { diagram, definitions } = context;
  const inside = (el: El | undefined): boolean => {
    for (let p = el?.['$parent'] as El | undefined; p !== undefined; p = p['$parent']) if (p === subprocess) return true;
    return false;
  };
  const moving = ((plane['planeElement'] ?? []) as El[]).filter((di) => inside(di['bpmnElement']));
  plane['planeElement'] = ((plane['planeElement'] ?? []) as El[]).filter((di) => !moving.includes(di));
  let own = ((definitions['diagrams'] ?? []) as El[]).find((d) => d['plane']?.['bpmnElement'] === subprocess)?.['plane'] as El | undefined;
  if (own === undefined) {
    own = diagram.create('bpmndi:BPMNPlane', { id: diagram.uniqueId(`BPMNPlane_${subprocess.id}`), bpmnElement: subprocess, planeElement: [] });
    (definitions['diagrams'] as El[]).push(diagram.create('bpmndi:BPMNDiagram', { id: diagram.uniqueId(`BPMNDiagram_${subprocess.id}`), plane: own }));
  }
  (own['planeElement'] as El[]).push(...moving);
  const shape = diagram.shapes.get(subprocess.id);
  if (shape !== undefined) shape['isExpanded'] = false;
  diagram.index();
}

/** The flow of `process` as `bpmn-auto-layout` needs it: ids, types and flows, nothing else. */
async function layoutPositions(process: El, nodes: El[], flows: El[]): Promise<{ shapes: Map<string, Box>; edges: Map<string, Point[]> }> {
  const moddle = BpmnModdle();
  const copies = new Map<El, El>();
  for (const node of nodes) copies.set(node, moddle.create(node.$type, { id: node.id }) as unknown as El);
  for (const node of nodes) {
    const host = node['attachedToRef'] as El | undefined;
    if (host !== undefined && copies.has(host)) copies.get(node)!['attachedToRef'] = copies.get(host);
  }
  const flowCopies: El[] = [];
  for (const flow of flows) {
    const source = copies.get(flow['sourceRef']);
    const target = copies.get(flow['targetRef']);
    if (source === undefined || target === undefined) continue;
    const c = moddle.create('bpmn:SequenceFlow', { id: flow.id, sourceRef: source, targetRef: target }) as unknown as El;
    (source['outgoing'] ??= []).push(c);
    (target['incoming'] ??= []).push(c);
    flowCopies.push(c);
  }
  // bpmn-auto-layout needs `outgoing` in the order the targets appear (see `layout.ts`).
  sortOutgoing(copies.values(), nodes.map((n) => n.id));
  const stripped = moddle.create('bpmn:Process', { id: process.id, flowElements: [...copies.values(), ...flowCopies] });
  const definitions = moddle.create('bpmn:Definitions', { id: 'Definitions_layout', targetNamespace: 'https://lila-modeler.org/bpmn', rootElements: [stripped] });
  const { xml } = await moddle.toXML(definitions);
  const { rootElement } = await moddle.fromXML(await autoLayout(xml));
  const shapes = new Map<string, Box>();
  const edges = new Map<string, Point[]>();
  for (const diagram of ((rootElement as El)['diagrams'] ?? []) as El[]) {
    for (const di of (diagram['plane']?.['planeElement'] ?? []) as El[]) {
      const id = di['bpmnElement']?.id as string | undefined;
      if (id === undefined) continue;
      if (di.$type === 'bpmndi:BPMNShape') shapes.set(id, copy(di['bounds']));
      else edges.set(id, ((di['waypoint'] ?? []) as Point[]).map((p) => ({ x: p.x, y: p.y })));
    }
  }
  return { shapes, edges };
}

/**
 * Lays out `process` again (see the header). Its top-level nodes and flows get new DI; its pool
 * and lanes are resized; what hangs on them follows.
 */
export async function relayout(context: RelayoutContext): Promise<void> {
  const { definitions, process, participant, diagram } = context;
  const elements = (process['flowElements'] ?? []) as El[];
  const nodes = elements.filter((el) => is(el, 'bpmn:FlowNode'));
  const flows = elements.filter((el) => el.$type === 'bpmn:SequenceFlow');
  if (nodes.length === 0) return;

  const plane = diagram.ensurePlane(process, participant?.['$parent'] as El | undefined);
  for (const node of nodes) {
    const shape = diagram.shapes.get(node.id);
    if (is(node, 'bpmn:SubProcess') && shape?.['isExpanded'] === true) collapse(context, node, diagram.planeOf.get(shape)!);
  }

  const old = new Map<string, Box>();
  for (const node of nodes) {
    const b = diagram.bounds(node.id);
    if (b !== undefined) old.set(node.id, copy(b));
  }
  const oldPoolBox = context.pool;

  const laid = await layoutPositions(process, nodes, flows);
  const lanes = lanesOf(process).length > 0 && participant !== undefined;
  const placed = nodes.filter((n) => laid.shapes.has(n.id));

  // Where the result goes: the pool keeps its corner; a new pool goes around where the flow was;
  // without a pool, the flow keeps its corner.
  const oldLeft = old.size === 0 ? 0 : Math.min(...[...old.values()].map((b) => b.x));
  const oldTop = old.size === 0 ? 0 : Math.min(...[...old.values()].map((b) => b.y));
  let origin: Point = { x: 0, y: 0 };
  if (participant !== undefined) origin = oldPoolBox !== undefined ? { x: oldPoolBox.x, y: oldPoolBox.y } : old.size > 0 ? { x: oldLeft - 2 * HEADER - MARGIN, y: oldTop - MARGIN } : origin;

  // The layouter's positions go into the DI first (shapes and edges, created when missing).
  for (const n of placed) {
    const b = laid.shapes.get(n.id)!;
    if (diagram.shapes.has(n.id)) diagram.setBounds(n.id, b);
    else diagram.addShape(n, plane, b, is(n, 'bpmn:SubProcess') ? { isExpanded: false } : {});
  }
  for (const f of flows) {
    const points = laid.edges.get(f.id);
    if (points !== undefined && points.length >= 2) diagram.setWaypoints(f, points, plane);
    else diagram.routeFlow(f);
  }

  let pool: Box | undefined;
  if (lanes) {
    // Lanes: Lila's lane layout, the same as `create_process`.
    pool = layOutLanes(plane, process, participant!, diagram.create, origin);
    diagram.index();
  } else {
    // No lanes: the layouter's picture moves as one piece; a pool, if any, goes around it.
    const boxes = placed.filter((n) => n['attachedToRef'] === undefined).map((n) => laid.shapes.get(n.id)!);
    const minX = Math.min(...boxes.map((b) => b.x));
    const minY = Math.min(...boxes.map((b) => b.y));
    const shift: Point =
      participant !== undefined
        ? { x: origin.x + HEADER + MARGIN / 2 - minX, y: origin.y + MARGIN - minY }
        : old.size > 0
          ? { x: oldLeft - minX, y: oldTop - minY }
          : { x: 0, y: 0 };
    let maxRight = 0;
    let maxBottom = 0;
    for (const n of placed) {
      const b = laid.shapes.get(n.id)!;
      const box = { ...b, x: b.x + shift.x, y: b.y + shift.y };
      diagram.setBounds(n.id, box);
      maxRight = Math.max(maxRight, right(box));
      maxBottom = Math.max(maxBottom, bottom(box));
    }
    for (const f of flows) {
      const edge = diagram.edges.get(f.id);
      if (edge === undefined) continue;
      for (const p of (edge['waypoint'] ?? []) as Point[]) {
        p.x += shift.x;
        p.y += shift.y;
      }
    }
    if (participant !== undefined) {
      pool = { x: origin.x, y: origin.y, width: maxRight - origin.x + MARGIN, height: maxBottom - origin.y + MARGIN };
      if (diagram.shapes.has(participant.id)) diagram.setBounds(participant.id, pool);
      else diagram.addShape(participant, plane, pool, { isHorizontal: true });
    }
  }
  diagram.label(flows);
  if (pool !== undefined && oldPoolBox !== undefined) diagram.pushAside(plane, oldPoolBox, pool, true);

  const final = new Map<string, Box>();
  for (const n of placed) {
    const b = diagram.bounds(n.id);
    if (b !== undefined) final.set(n.id, copy(b));
  }

  // What hangs on a node follows it: text annotations (associations) and data objects.
  const delta = (id: string): Point | undefined => {
    const before = old.get(id);
    const after = final.get(id);
    if (before === undefined || after === undefined) return undefined;
    return { x: center(after).x - center(before).x, y: center(after).y - center(before).y };
  };
  const moved = new Set<string>(nodes.map((n) => n.id));
  const follow = (id: string, by: Point | undefined): void => {
    const b = diagram.bounds(id);
    if (b === undefined || by === undefined || moved.has(id)) return;
    diagram.setBounds(id, { ...b, x: b.x + by.x, y: b.y + by.y });
    moved.add(id);
  };
  const associations: El[] = [];
  for (const root of (definitions['rootElements'] ?? []) as El[]) {
    for (const a of (root['artifacts'] ?? []) as El[]) if (a.$type === 'bpmn:Association') associations.push(a);
  }
  for (const a of (process['artifacts'] ?? []) as El[]) if (a.$type === 'bpmn:Association' && !associations.includes(a)) associations.push(a);
  for (const a of associations) {
    const s = a['sourceRef'] as El | undefined;
    const t = a['targetRef'] as El | undefined;
    if (s === undefined || t === undefined) continue;
    if (nodes.includes(s)) follow(t.id, delta(s.id));
    else if (nodes.includes(t)) follow(s.id, delta(t.id));
  }
  const dataAssociations: El[] = [];
  for (const n of nodes) {
    for (const d of (n['dataInputAssociations'] ?? []) as El[]) {
      for (const ref of (d['sourceRef'] ?? []) as El[]) follow(ref.id, delta(n.id));
      dataAssociations.push(d);
    }
    for (const d of (n['dataOutputAssociations'] ?? []) as El[]) {
      if (d['targetRef'] !== undefined) follow(d['targetRef'].id, delta(n.id));
      dataAssociations.push(d);
    }
  }
  for (const a of [...associations, ...dataAssociations]) diagram.routeOther(a);
  diagram.routeMessages(definitions);
}
