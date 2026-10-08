// @vitest-environment jsdom
/**
 * #580: moving a lane up or down, and the palette's Lane tool with nothing selected.
 *
 * Unlike the sibling suites, this one builds a real bpmn-js `Modeler` and imports a diagram: the
 * swap is a composition of bpmn-js's own commands (`moveElements`, `updateLaneRefs`), so faking
 * them would test nothing. jsdom has no SVG geometry, so the few calls diagram-js makes while
 * drawing (`getBBox`, `getComputedTextLength`, the `transform` list, `createSVGMatrix`) are
 * stubbed below with plain numbers; nothing here reads what is drawn, only the shapes' bounds,
 * the business objects and the exported XML.
 */
import Modeler from 'bpmn-js/lib/Modeler';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { moduloLote } from './lote';
import { moduloCarriles, vecino, type LilaCarriles, type Forma } from './carriles';
import { insertar, gruposDeFiguras, type Figura } from './Paleta';
import type { Servicios } from './Modeler';
import { setLocale } from './i18n';

/** The few SVG APIs diagram-js calls while drawing, which jsdom does not implement. */
beforeAll(() => {
  class Matriz {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    multiply(): Matriz { return this; }
    inverse(): Matriz { return this; }
    translate(): Matriz { return this; }
    scale(): Matriz { return this; }
    rotate(): Matriz { return this; }
  }
  class Transformacion { matrix = new Matriz(); setMatrix(m: Matriz): void { this.matrix = m; } setTranslate(): void {} setScale(): void {} setRotate(): void {} }
  const lista = () => {
    const items: Transformacion[] = [];
    return {
      get numberOfItems() { return items.length; },
      clear: () => { items.length = 0; },
      initialize: (t: Transformacion) => { items.length = 0; items.push(t); return t; },
      appendItem: (t: Transformacion) => { items.push(t); return t; },
      getItem: (i: number) => items[i],
      consolidate: () => items[0] ?? null,
      createSVGTransformFromMatrix: (m: Matriz) => { const t = new Transformacion(); t.matrix = m; return t; },
    };
  };
  (globalThis as Record<string, unknown>)['SVGMatrix'] = Matriz;
  const proto = SVGElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(proto, 'transform', {
    configurable: true,
    get(this: { __t?: unknown }) { return (this.__t ??= { baseVal: lista() }); },
  });
  proto['getBBox'] = function getBBox(this: Element) {
    return { x: 0, y: 0, width: (this.textContent ?? '').length * 7, height: 14 };
  };
  proto['getComputedTextLength'] = function getComputedTextLength(this: Element) { return (this.textContent ?? '').length * 7; };
  proto['getScreenCTM'] = () => new Matriz();
  proto['createSVGMatrix'] = () => new Matriz();
  proto['createSVGTransform'] = () => new Transformacion();
  proto['createSVGTransformFromMatrix'] = (m: Matriz) => { const t = new Transformacion(); t.matrix = m; return t; };
});

afterEach(() => setLocale('auto'));

/** A pool with three lanes of different heights; the task sits in the third one. */
const TRES_CARRILES = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="D" targetNamespace="http://example.com">
  <bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>
  <bpmn:process id="P">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="L1" name="One"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L2" name="Two"><bpmn:flowNodeRef>T2</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L3" name="Three"><bpmn:flowNodeRef>T3</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T2" name="Review"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T3" name="Ship"><bpmn:incoming>F2</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="T2" />
    <bpmn:sequenceFlow id="F2" sourceRef="T2" targetRef="T3" />
    <bpmn:boundaryEvent id="B3" attachedToRef="T3"><bpmn:timerEventDefinition id="TD" /></bpmn:boundaryEvent>
    <bpmn:textAnnotation id="N3"><bpmn:text>Note</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="A3" sourceRef="T3" targetRef="N3" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="DI"><bpmndi:BPMNPlane id="PL" bpmnElement="C">
    <bpmndi:BPMNShape id="Pool_di" bpmnElement="Pool" isHorizontal="true"><dc:Bounds x="100" y="100" width="600" height="400" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L1_di" bpmnElement="L1" isHorizontal="true"><dc:Bounds x="130" y="100" width="570" height="100" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L2_di" bpmnElement="L2" isHorizontal="true"><dc:Bounds x="130" y="200" width="570" height="120" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L3_di" bpmnElement="L3" isHorizontal="true"><dc:Bounds x="130" y="320" width="570" height="180" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="180" y="132" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T2_di" bpmnElement="T2"><dc:Bounds x="280" y="220" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T3_di" bpmnElement="T3"><dc:Bounds x="480" y="370" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="B3_di" bpmnElement="B3"><dc:Bounds x="542" y="432" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="N3_di" bpmnElement="N3"><dc:Bounds x="300" y="400" width="100" height="30" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="A3_di" bpmnElement="A3"><di:waypoint x="480" y="410" /><di:waypoint x="400" y="415" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F1_di" bpmnElement="F1"><di:waypoint x="216" y="150" /><di:waypoint x="330" y="150" /><di:waypoint x="330" y="220" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F2_di" bpmnElement="F2"><di:waypoint x="380" y="260" /><di:waypoint x="530" y="260" /><di:waypoint x="530" y="370" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

/** A second pool, so the palette has to ask which one. */
const DOS_POOLS = TRES_CARRILES
  .replace('<bpmn:participant id="Pool" processRef="P" />', '<bpmn:participant id="Pool" processRef="P" /><bpmn:participant id="Otro" processRef="P2" />')
  .replace('</bpmn:process>', '</bpmn:process><bpmn:process id="P2" />')
  .replace('</bpmndi:BPMNPlane>', '<bpmndi:BPMNShape id="Otro_di" bpmnElement="Otro" isHorizontal="true"><dc:Bounds x="100" y="600" width="600" height="200" /></bpmndi:BPMNShape></bpmndi:BPMNPlane>');

async function montar(xml: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modeler = new Modeler({ container, additionalModules: [moduloLote, moduloCarriles] });
  const { warnings } = await modeler.importXML(xml);
  expect(warnings).toEqual([]);
  const registry = modeler.get<{ get(id: string): Forma }>('elementRegistry');
  return {
    modeler,
    el: (id: string) => registry.get(id),
    carriles: modeler.get<LilaCarriles>('lilaCarriles'),
    commandStack: modeler.get<{ undo(): void; redo(): void }>('commandStack'),
    xml: async () => (await modeler.saveXML({ format: false })).xml!,
  };
}

/** The lanes' ids in the `laneSet`, and as they are stacked on the canvas. */
const ordenDe = (xml: string, patron: RegExp): string[] =>
  [...xml.slice(xml.indexOf('<bpmn:process')).matchAll(patron)].map((m) => m[1]!).filter((id) => id !== 'N3' && id !== 'A3');
const ordenSemantico = (xml: string): string[] => [...xml.matchAll(/<bpmn:lane id="(\w+)"/g)].map((m) => m[1]!);
const ordenVisual = (m: Awaited<ReturnType<typeof montar>>): string[] =>
  ['L1', 'L2', 'L3'].map((id) => m.el(id)).sort((a, b) => a.y - b.y).map((l) => l.id);
const refs = (m: Awaited<ReturnType<typeof montar>>, id: string): string[] =>
  ((m.el(id).businessObject as unknown as { flowNodeRef: { id: string }[] }).flowNodeRef).map((n) => n.id);

describe('moving a lane (#580)', () => {
  it('moves the third lane above the second: canvas, laneSet, refs and XML, and undo restores it exactly', async () => {
    const m = await montar(TRES_CARRILES);
    const antes = await m.xml();
    const [l2, l3, t3] = [m.el('L2'), m.el('L3'), m.el('T3')];

    expect(vecino(l3, 'abajo')).toBeUndefined();
    expect(m.carriles.mover(l3, 'arriba')).toBe(true);

    expect(ordenVisual(m)).toEqual(['L1', 'L3', 'L2']);
    // Each lane keeps its own height: L3 (180) now starts where L2 started, L2 right below it.
    expect([l3.y, l3.height, l2.y, l2.height]).toEqual([200, 180, 380, 120]);
    // The task travelled with its lane and still belongs to it; the one in L2 too.
    expect(t3.y).toBe(370 - 120);
    expect(m.el('T2').y).toBe(220 + 180);
    expect(refs(m, 'L3')).toEqual(['T3', 'B3']);
    expect(refs(m, 'L2')).toEqual(['T2']);
    // The flow between them is still there, and still joins them.
    const f2 = m.el('F2') as unknown as { source: Forma; target: Forma };
    expect([f2.source.id, f2.target.id]).toEqual(['T2', 'T3']);

    // What hangs from the task or sits in the lane moved with it: a boundary event, an annotation.
    expect(m.el('B3').y).toBe(432 - 120);
    expect(m.el('N3').y).toBe(400 - 120);

    const despues = await m.xml();
    expect(ordenSemantico(despues)).toEqual(['L1', 'L3', 'L2']);
    // Only the lanes changed places: the flow elements keep their order (the engine reads it).
    // The annotation is the exception bpmn-js makes on any move: it goes to the collaboration.
    expect(ordenDe(despues, /<bpmn:(?:startEvent|task|sequenceFlow|boundaryEvent|textAnnotation|association) id="(\w+)"/g))
      .toEqual(ordenDe(antes, /<bpmn:(?:startEvent|task|sequenceFlow|boundaryEvent|textAnnotation|association) id="(\w+)"/g));
    expect(despues).toMatch(/id="T3_di"[^>]*><dc:Bounds x="480" y="250"/);

    m.commandStack.undo();
    expect(ordenVisual(m)).toEqual(['L1', 'L2', 'L3']);
    expect(await m.xml()).toBe(antes);

    m.commandStack.redo();
    expect(await m.xml()).toBe(despues);
  });

  it('moves a lane down, and offers only the directions that have a neighbour', async () => {
    const m = await montar(TRES_CARRILES);
    expect(vecino(m.el('L1'), 'arriba')).toBeUndefined();
    expect(vecino(m.el('L1'), 'abajo')?.id).toBe('L2');
    expect(m.carriles.mover(m.el('L1'), 'arriba')).toBe(false);
    m.carriles.mover(m.el('L1'), 'abajo');
    expect(ordenVisual(m)).toEqual(['L2', 'L1', 'L3']);
    expect(ordenSemantico(await m.xml())).toEqual(['L2', 'L1', 'L3']);
    expect(refs(m, 'L1')).toEqual(['Start']);
  });

  it('swaps nested lanes inside their parent lane, in its childLaneSet', async () => {
    const anidado = TRES_CARRILES
      .replace('<bpmn:lane id="L3" name="Three"><bpmn:flowNodeRef>T3</bpmn:flowNodeRef></bpmn:lane>',
        '<bpmn:lane id="L3" name="Three"><bpmn:flowNodeRef>T3</bpmn:flowNodeRef><bpmn:childLaneSet id="CLS"><bpmn:lane id="L3a" name="A" /><bpmn:lane id="L3b" name="B"><bpmn:flowNodeRef>T3</bpmn:flowNodeRef></bpmn:lane></bpmn:childLaneSet></bpmn:lane>')
      .replace('<bpmndi:BPMNShape id="Start_di"',
        '<bpmndi:BPMNShape id="L3a_di" bpmnElement="L3a" isHorizontal="true"><dc:Bounds x="160" y="320" width="540" height="60" /></bpmndi:BPMNShape><bpmndi:BPMNShape id="L3b_di" bpmnElement="L3b" isHorizontal="true"><dc:Bounds x="160" y="380" width="540" height="120" /></bpmndi:BPMNShape><bpmndi:BPMNShape id="Start_di"');
    const m = await montar(anidado);
    // The inner lanes' neighbours are each other, never the outer lanes.
    expect(vecino(m.el('L3a'), 'arriba')).toBeUndefined();
    m.carriles.mover(m.el('L3b'), 'arriba');
    expect([m.el('L3b').y, m.el('L3a').y]).toEqual([320, 440]);
    expect(m.el('T3').y).toBe(370 - 60);
    expect(refs(m, 'L3b')).toEqual(['T3', 'B3']);
    expect(ordenSemantico(await m.xml())).toEqual(['L1', 'L2', 'L3', 'L3b', 'L3a']);
    // Moving the outer lane carries its inner lanes with it.
    m.carriles.mover(m.el('L3'), 'arriba');
    expect([m.el('L3').y, m.el('L3b').y, m.el('L3a').y, m.el('L2').y]).toEqual([200, 200, 320, 380]);
  });

  it('puts the entries in the lane context pad, in the active language', async () => {
    setLocale('es');
    const m = await montar(TRES_CARRILES);
    const pad = m.modeler.get<{ getEntries(el: Forma): Record<string, { title: string }> }>('contextPad');
    const entradas = pad.getEntries(m.el('L2'));
    expect(entradas['lila-carril-arriba']?.title).toBe('Mover carril arriba');
    expect(entradas['lila-carril-abajo']?.title).toBe('Mover carril abajo');
    expect(pad.getEntries(m.el('L3'))['lila-carril-abajo']).toBeUndefined();
    expect(pad.getEntries(m.el('T3'))['lila-carril-arriba']).toBeUndefined();
  });
});

describe('the palette Lane tool with nothing selected (#580)', () => {
  const carril = (): Figura => gruposDeFiguras().flatMap((g) => g.figuras).find((f) => f.tipo === 'bpmn:Lane')!;
  const servicios = (m: Awaited<ReturnType<typeof montar>>): Servicios => {
    const g = <T,>(n: string) => m.modeler.get<T>(n);
    return {
      modeling: g('modeling'), elementRegistry: g('elementRegistry'), rules: g('rules'), canvas: g('canvas'),
      directEditing: g('directEditing'), elementFactory: g('elementFactory'), carriles: m.carriles,
    } as unknown as Servicios;
  };
  const lanesOf = (m: Awaited<ReturnType<typeof montar>>, pool: string) =>
    (m.modeler.get<{ filter(f: (e: Forma) => boolean): Forma[] }>('elementRegistry'))
      .filter((e) => e.type === 'bpmn:Lane' && e.parent?.id === pool);

  it('with a single pool, adds the lane at its bottom straight away', async () => {
    const m = await montar(TRES_CARRILES);
    const hecho = vi.fn();
    insertar(servicios(m), carril(), null, hecho);
    const lanes = lanesOf(m, 'Pool');
    expect(lanes).toHaveLength(4);
    expect(lanes.sort((a, b) => a.y - b.y).at(-1)!.id).not.toMatch(/^L\d$/);
    expect(hecho).toHaveBeenCalledOnce();
  });

  it('with two pools, waits for a click on one; Escape cancels', async () => {
    const m = await montar(DOS_POOLS);
    const eventBus = m.modeler.get<{ fire(e: string, d: object): unknown }>('eventBus');
    const hecho = vi.fn();
    insertar(servicios(m), carril(), null, hecho);
    expect(m.carriles.eligiendo()).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(m.carriles.eligiendo()).toBe(false);
    expect(hecho).toHaveBeenCalledOnce();

    insertar(servicios(m), carril(), null, hecho);
    eventBus.fire('element.click', { element: m.el('Otro'), originalEvent: new MouseEvent('click') });
    expect(m.carriles.eligiendo()).toBe(false);
    expect(lanesOf(m, 'Otro').length).toBeGreaterThan(0);
    expect(lanesOf(m, 'Pool')).toHaveLength(3);
    expect(hecho).toHaveBeenCalledTimes(2);
  });

  it('an Escape inside an open dialog (⌘K) is the dialog\'s, not the pick\'s (#581)', async () => {
    const m = await montar(DOS_POOLS);
    const hecho = vi.fn();
    insertar(servicios(m), carril(), null, hecho);
    const dialogo = document.createElement('dialog');
    dialogo.setAttribute('open', '');
    const campo = document.createElement('input');
    dialogo.append(campo);
    document.body.append(dialogo);
    const oido = vi.fn();
    dialogo.addEventListener('keydown', oido);
    const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    campo.dispatchEvent(e);
    expect(oido).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(false);
    expect(m.carriles.eligiendo()).toBe(true);
    dialogo.remove();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(m.carriles.eligiendo()).toBe(false);
  });
});
