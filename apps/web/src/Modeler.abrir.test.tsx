// @vitest-environment jsdom
/**
 * `Modelador.abrir` over a real bpmn-js (#568, from the QA of #567): the instance it swaps in
 * imported before anyone listened to it, so `abrir` announces its empty selection itself. Without
 * that announcement the properties panel (a `suscribir` subscriber) and `onSeleccion` keep the
 * elements of the destroyed instance, and an edit through them is lost on save.
 *
 * `colores.test.tsx` covers the panel's side with a stand-in for `Lienzo` that announces the empty
 * selection on its own; this file mounts the real `Lienzo`. The SVG APIs jsdom lacks are stubbed
 * as in `ancho.test.tsx`; nothing here reads what is drawn.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Lienzo, type Modelador } from './Modeler';

// diagram-js-minimap's CommonJS build does not load under vitest; the minimap is not what this tests.
vi.mock('./moduloMinimapa', () => ({ moduloMinimapa: {} }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  // No 2D canvas in jsdom (it only logs «Not implemented»); nothing here measures text with it.
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];
});

/**
 * Two tasks, a start event and a collapsed sub-process with a task on its own plane, with no
 * external labels: jsdom's stubbed text metrics never let diagram-js finish laying out an event's
 * label (the app's seed diagram hangs here).
 */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="D" targetNamespace="http://example.com">
  <bpmn:process id="P" isExecutable="false">
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T1" name="Review"><bpmn:incoming>F1</bpmn:incoming></bpmn:task>
    <bpmn:task id="T2" name="Send" />
    <bpmn:subProcess id="Sub" name="Pack"><bpmn:task id="Inner" name="Wrap" /></bpmn:subProcess>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="T1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="DI"><bpmndi:BPMNPlane id="PL" bpmnElement="P">
    <bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="180" y="142" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T1_di" bpmnElement="T1"><dc:Bounds x="280" y="120" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T2_di" bpmnElement="T2"><dc:Bounds x="480" y="120" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Sub_di" bpmnElement="Sub" isExpanded="false"><dc:Bounds x="680" y="120" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F1_di" bpmnElement="F1"><di:waypoint x="216" y="160" /><di:waypoint x="280" y="160" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="DI_Sub"><bpmndi:BPMNPlane id="PL_Sub" bpmnElement="Sub">
    <bpmndi:BPMNShape id="Inner_di" bpmnElement="Inner"><dc:Bounds x="200" y="100" width="100" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const desmontar: Array<() => void> = [];
afterEach(() => { for (const d of desmontar.splice(0)) d(); });

async function montar(): Promise<{ modelador: Modelador; onSeleccion: ReturnType<typeof vi.fn> }> {
  const onSeleccion = vi.fn();
  let listo!: (m: Modelador) => void;
  const modelador = new Promise<Modelador>((r) => { listo = r; });
  const contenedor = document.createElement('div');
  document.body.append(contenedor);
  const raiz = createRoot(contenedor);
  // Stable props: they are the dependencies of the effect that builds bpmn-js.
  const onEstado = (): void => {};
  await act(async () => raiz.render(<Lienzo xmlInicial={XML} onListo={listo} onEstado={onEstado} onSeleccion={onSeleccion} />));
  desmontar.push(() => { act(() => raiz.unmount()); contenedor.remove(); });
  return { modelador: await Promise.race([modelador, new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Lienzo no listo')), 8000))]), onSeleccion };
}

it('abrir announces the new instance\'s empty selection to subscribers and to onSeleccion (#568)', async () => {
  const { modelador, onSeleccion } = await montar();
  const oyente = vi.fn();
  modelador.suscribir(['selection.changed'], oyente);
  act(() => modelador.seleccionar?.('T1'));
  expect(onSeleccion).toHaveBeenLastCalledWith('T1');
  expect(oyente).toHaveBeenCalledTimes(1);

  // The same diagram again, as a reload does: the new instance has the same ids, nothing selected.
  await act(async () => { expect(await modelador.abrir(XML)).toBe(true); });
  expect(oyente).toHaveBeenCalledTimes(2);
  expect(oyente.mock.calls[1]![0]).toMatchObject({ newSelection: [] });
  expect(onSeleccion).toHaveBeenLastCalledWith(null);
  expect(modelador.servicios.selection.get()).toEqual([]);
});

it('a list selects the ids still in the diagram and on the plane on screen, as one selection (#568)', async () => {
  const { modelador, onSeleccion } = await montar();
  const oyente = vi.fn();
  modelador.suscribir(['selection.changed'], oyente);
  const ids = (): string[] => modelador.servicios.selection.get().map((el) => el.id);

  // What a reload passes: two tasks, an id the new diagram no longer has, and a task that lives
  // on the collapsed sub-process's plane (diagram-js never keeps a selection across planes).
  act(() => modelador.seleccionar?.(['T1', 'T2', 'Gone', 'Inner']));
  expect(ids()).toEqual(['T1', 'T2']);
  expect(oyente).toHaveBeenCalledOnce(); // One selection, one change.
  expect(onSeleccion).toHaveBeenLastCalledWith(null); // Several: no single id to edit.

  // One id in a list still selects it.
  act(() => modelador.seleccionar?.(['T2']));
  expect(ids()).toEqual(['T2']);
  expect(onSeleccion).toHaveBeenLastCalledWith('T2');
  // Nothing left of it: nothing selected.
  act(() => modelador.seleccionar?.(['Gone']));
  expect(ids()).toEqual([]);
  expect(onSeleccion).toHaveBeenLastCalledWith(null);
});
