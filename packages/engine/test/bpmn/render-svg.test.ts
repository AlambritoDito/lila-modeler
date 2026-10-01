/**
 * The engine's own SVG renderer (#538): over every bundled example, each DI shape is drawn at its
 * bounds and each DI edge through its waypoints — the geometry bpmn-js draws — every flow node
 * has a shape, and the same XML always gives the same bytes.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';
import { describe, expect, test } from 'vitest';

import { renderSvg } from '../../src/bpmn/index.js';

const root = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
const examplesDir = join(root, 'examples');

function bpmnFiles(dir: string): string[] {
  return readdirSync(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return bpmnFiles(path);
    return name.endsWith('.bpmn') ? [path] : [];
  });
}

const EXAMPLES = bpmnFiles(examplesDir);

/** `[minX, minY, maxX, maxY]` of the first drawn element of a shape group, in the group's frame. */
function firstChildBox(group: string): [number, number, number, number] {
  const child = group.match(/^<(rect|circle|polygon|path)\b([^>]*)>/);
  if (child === null) throw new Error(`no first child in ${group.slice(0, 120)}`);
  const attr = (name: string): number => Number(child[2]!.match(new RegExp(`\\s${name}="([^"]*)"`))![1]);
  switch (child[1]) {
    case 'rect':
      return [attr('x'), attr('y'), attr('x') + attr('width'), attr('y') + attr('height')];
    case 'circle':
      return [attr('cx') - attr('r'), attr('cy') - attr('r'), attr('cx') + attr('r'), attr('cy') + attr('r')];
    default: {
      const xs: number[] = [];
      const ys: number[] = [];
      if (child[1] === 'polygon') {
        const nums = child[2]!.match(/points="([^"]*)"/)![1]!.split(/[\s,]+/).map(Number);
        for (let i = 0; i < nums.length; i += 2) [xs[i / 2], ys[i / 2]] = [nums[i]!, nums[i + 1]!];
        return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }
      // A path made of M/L/H/V commands and horizontal elliptic arcs (a data store), which bulge by their ry.
      const source = child[2]!.match(/\sd="([^"]*)"/)![1]!;
      let x = 0;
      let y = 0;
      for (const [, cmd, args] of source.matchAll(/([MLHVAZz]?)\s*([-\d.,\s]*)/g)) {
        const nums = args!.split(/[\s,]+/).filter((s) => s !== '').map(Number);
        if (cmd === 'H') x = nums[0]!;
        else if (cmd === 'V') y = nums[0]!;
        else if (cmd === 'A') {
          const ry = nums[1]!;
          xs.push(x, x);
          ys.push(y - ry, y + ry);
          [x, y] = [nums[5]!, nums[6]!];
          xs.push(x, x);
          ys.push(y - ry, y + ry);
        } else if (nums.length >= 2) [x, y] = [nums[0]!, nums[1]!];
        else continue;
        xs.push(x);
        ys.push(y);
      }
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
  }
}

function groups(svg: string): Map<string, { transform?: string; inner: string }> {
  const out = new Map<string, { transform?: string; inner: string }>();
  for (const m of svg.matchAll(/<g data-element-id="([^"]*)"(?: transform="([^"]*)")?>/g)) {
    const start = m.index! + m[0].length;
    out.set(m[1]!, { ...(m[2] === undefined ? {} : { transform: m[2] }), inner: svg.slice(start) });
  }
  return out;
}

async function diOf(xml: string): Promise<{ plane: ModdleElement[]; flowNodes: string[] }> {
  const { rootElement } = await BpmnModdle().fromXML(xml);
  // bpmn-js does not draw the DI Bizagi writes for a `bpmn:DataObject` (only its reference), nor do we.
  const plane = (rootElement.diagrams?.[0]?.plane?.planeElement ?? []).filter((di) => di.bpmnElement?.$type !== 'bpmn:DataObject');
  const flowNodes: string[] = [];
  const walk = (el: ModdleElement): void => {
    for (const child of el.flowElements ?? []) {
      if (!/SequenceFlow|DataObject$|DataObjectReference|DataStoreReference/.test(child.$type)) flowNodes.push(child.id);
      walk(child);
    }
  };
  for (const el of rootElement.rootElements ?? []) walk(el);
  return { plane, flowNodes };
}

const close = (a: number, b: number): boolean => Math.abs(a - b) <= 0.01;

describe.each(EXAMPLES.map((path) => [relative(root, path), path]))('%s', (_name, path) => {
  const xml = readFileSync(path, 'utf8');

  test('shapes sit at their DI bounds and edges follow their DI waypoints', async () => {
    const svg = await renderSvg(xml);
    const drawn = groups(svg);
    const { plane } = await diOf(xml);
    expect(plane.length).toBeGreaterThan(0);
    for (const di of plane) {
      const id = di.bpmnElement!.id;
      const group = drawn.get(id);
      expect(group, id).toBeDefined();
      if (di.bounds !== undefined) {
        const { x, y, width, height } = di.bounds;
        const [tx, ty] = group!.transform!.match(/^translate\((\S+) (\S+)\)$/)!.slice(1).map(Number);
        expect(close(tx!, x) && close(ty!, y), `${id}: ${group!.transform} vs ${x},${y}`).toBe(true);
        const [x0, y0, x1, y1] = firstChildBox(group!.inner);
        expect([x0, y0, x1, y1].every((v, i) => close(v, [0, 0, width, height][i]!)), `${id}: ${[x0, y0, x1, y1]} vs ${width}×${height}`).toBe(true);
      } else {
        const d = group!.inner.match(/^<path d="([^"]*)"/)![1]!;
        const points = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
        expect(points.length, id).toBe(di.waypoint!.length);
        points.forEach(([px, py], i) => {
          expect(close(px!, di.waypoint![i]!.x) && close(py!, di.waypoint![i]!.y), `${id} point ${i}`).toBe(true);
        });
      }
    }
  });

  test('every flow node has a shape', async () => {
    const svg = await renderSvg(xml);
    const drawn = groups(svg);
    const { flowNodes } = await diOf(xml);
    expect(flowNodes.filter((id) => !drawn.has(id))).toEqual([]);
  });

  test('the viewBox holds every shape and waypoint, and the output is deterministic', async () => {
    const svg = await renderSvg(xml);
    expect(await renderSvg(xml)).toBe(svg);
    const [vx, vy, vw, vh] = svg.match(/viewBox="([^"]*)"/)![1]!.split(' ').map(Number) as [number, number, number, number];
    const { plane } = await diOf(xml);
    for (const di of plane) {
      const boxes = di.bounds !== undefined ? [di.bounds] : di.waypoint!.map((p) => ({ ...p, width: 0, height: 0 }));
      for (const b of boxes) {
        expect(b.x >= vx && b.y >= vy && b.x + b.width <= vx + vw && b.y + b.height <= vy + vh, di.bpmnElement!.id).toBe(true);
      }
    }
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ')).toBe(true);
    expect(svg).toContain('fill="#FFFFFF"');
  });
});

/** The centre x and top y of the external label whose only line is `text`. */
function labelAt(svg: string, text: string): [number, number] {
  const m = svg.match(new RegExp(`<text font-family="[^"]*" font-size="11"[^>]*><tspan x="([^"]+)" y="([^"]+)">${text}</tspan></text>`));
  if (m === null) throw new Error(`no label ${text}`);
  return [Number(m[1]), Math.round((Number(m[2]) - 11 * 0.9) * 100) / 100];
}

describe('renderSvg', () => {
  test('a flow label with no DI position goes where bpmn-js puts it (getFlowLabelPosition)', async () => {
    // Three waypoints: the first segment, vertical here, so 15 to its right.
    const pedido = await renderSvg(readFileSync(join(examplesDir, 'pedido/model.bpmn'), 'utf8'));
    expect(labelAt(pedido, 'Rejected')).toEqual([970, 281.5]);
    const levels = await renderSvg(readFileSync(join(examplesDir, 'bizagi-levels/level-1/model.bpmn'), 'utf8'));
    expect(labelAt(levels, 'Yellow')).toEqual([490, 332.5]);
    expect(labelAt(levels, 'Green')).toEqual([490, 392.5]);
  });

  test('a DI label with a position and no size is centred on that point; only 0 0 0 0 is no label', async () => {
    const at = (bounds: string) => MINI('Go').replace(
      '<di:waypoint x="100" y="90"/>',
      `<di:waypoint x="100" y="90"/><bpmndi:BPMNLabel><dc:Bounds ${bounds}/></bpmndi:BPMNLabel>`,
    );
    expect(labelAt(await renderSvg(at('x="300" y="10" width="0" height="0"')), 'Go')).toEqual([300, 10]);
    // All zeros: the default, 15 above the middle of the horizontal flow.
    expect(labelAt(await renderSvg(at('x="0" y="0" width="0" height="0"')), 'Go')).toEqual([73, 65]);
  });

  test('the DI of a bpmn:DataObject is not drawn and does not stretch the drawing', async () => {
    for (const [file, id] of [['B.1.0', 'DF1373655174778'], ['B.2.0', 'DF1373638080458']]) {
      const svg = await renderSvg(readFileSync(join(examplesDir, `bizagi-exports/bizagi-miwg-${file}-roundtrip.bpmn`), 'utf8'));
      expect(svg).not.toContain(`data-element-id="${id}"`);
      const [vx, vy] = svg.match(/viewBox="([^"]*)"/)![1]!.split(' ').map(Number);
      expect(vx! > -20 || vy! > -20, file).toBe(true);
    }
  });

  test('the exclusive gateway shows its X only with isMarkerVisible, like bpmn-js', async () => {
    const gateway = (marker: string) => MINI('x').replace('<task id="T" name="x"/>', '<exclusiveGateway id="T"/>').replace('bpmnElement="T" ', `bpmnElement="T" ${marker}`);
    const inner = async (marker: string) => groups(await renderSvg(gateway(marker))).get('T')!.inner.split('</g>')[0]!;
    expect(await inner('')).toMatch(/^<polygon [^>]*\/>$/);
    expect(await inner('isMarkerVisible="true"')).toMatch(/^<polygon [^>]*\/><path /);
  });

  test('the margin must be a finite number ≥ 0', async () => {
    await expect(renderSvg(MINI('x'), { margin: Number.NaN })).rejects.toThrow(RangeError);
    await expect(renderSvg(MINI('x'), { margin: -1 })).rejects.toThrow(RangeError);
  });

  test('snapshot of examples/pedido (pools, gateways, message flows)', async () => {
    expect(await renderSvg(readFileSync(join(examplesDir, 'pedido/model.bpmn'), 'utf8'))).toMatchSnapshot();
  });

  const MINI = (name: string, extra = ''): string => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" id="d" targetNamespace="t">
  <process id="P"><task id="T" name="${name}"/><startEvent id="S"><timerEventDefinition/></startEvent>
    <sequenceFlow id="F" sourceRef="S" targetRef="T" name="${name}"/></process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="PL" bpmnElement="P">
    <bpmndi:BPMNShape id="T_di" bpmnElement="T" ${extra}><dc:Bounds x="100" y="50" width="100" height="80"/></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="10" y="72" width="36" height="36"/></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F_di" bpmnElement="F"><di:waypoint x="46" y="90"/><di:waypoint x="100" y="90"/></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;

  test('escapes every text', async () => {
    const svg = await renderSvg(MINI('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;'));
    expect(svg).not.toContain('<script');
    expect(svg).toContain('>&lt;script&gt;alert(1)</tspan>');
    expect(svg).toContain('>&lt;/script&gt; &amp; &quot;q&quot;</tspan>');
  });

  test('wraps a task label inside its box and keeps the DI colours', async () => {
    const svg = await renderSvg(MINI('Review the customer order carefully', 'bioc:fill="#BBDEFB" bioc:stroke="#0D4372"'));
    const task = groups(svg).get('T')!.inner;
    expect(task).toMatch(/^<rect x="0" y="0" width="100" height="80" rx="10" ry="10" fill="#BBDEFB" stroke="#0D4372"/);
    expect(task.slice(0, task.indexOf('</g>')).match(/<tspan /g)!.length).toBeGreaterThan(1);
    // A colour that is not one is ignored rather than written into an attribute.
    const bad = await renderSvg(MINI('x', 'bioc:fill="red&quot; onload=&quot;x"'));
    expect(bad).not.toContain('onload');
    // Names: CSS colour names only.
    expect(groups(await renderSvg(MINI('x', 'bioc:fill="White"'))).get('T')!.inner).toContain('fill="White"');
    expect(await renderSvg(MINI('x', 'bioc:fill="javascript"'))).not.toContain('javascript');
  });

  test('a file with no diagram, or an unknown diagram id, is an error', async () => {
    await expect(renderSvg(MINI('x').replace(/<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, ''))).rejects.toThrow(/no diagram/);
    await expect(renderSvg(MINI('x'), { diagram: 'nope' })).rejects.toThrow(/nope/);
    expect(await renderSvg(MINI('x'), { diagram: 'D', margin: 0 })).toContain('viewBox="10 50 190 80"');
  });
});
