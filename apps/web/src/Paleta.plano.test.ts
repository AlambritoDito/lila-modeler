// @vitest-environment jsdom
/**
 * #721: a click on a palette item inside a collapsed sub-process. bpmn-js keeps every plane of the
 * diagram in one registry and one coordinate system, so the pool of the root diagram is still
 * "under" the centre of the view while the sub-process plane is the one showing. The figure has to
 * go to the open plane, and the view has to stay there.
 *
 * Like `carriles.test.ts`, this builds a real bpmn-js `Modeler`: the planes, the rules and
 * `scrollToElement` switching root are the whole point, and a fake would test none of them.
 */
import Modeler from 'bpmn-js/lib/Modeler';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { moduloLote } from './lote';
import { moduloCarriles, type LilaCarriles } from './carriles';
import { gruposDeFiguras, hayPool, insertar, type Figura } from './Paleta';
import type { Servicios } from './Modeler';

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
  // `canvas.scrollToElement` reads the viewport's matrix, which the lane suite never needed.
  proto['getCTM'] = () => new Matriz();
  proto['createSVGMatrix'] = () => new Matriz();
  proto['createSVGTransform'] = () => new Transformacion();
  proto['createSVGTransformFromMatrix'] = (m: Matriz) => { const t = new Transformacion(); t.matrix = m; return t; };
});

/** A pool whose collapsed sub-process `Sub` has a plane of its own, with one task in it. */
const SUBPROCESO_PLEGADO = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="D" targetNamespace="http://example.com">
  <bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>
  <bpmn:process id="P">
    <bpmn:subProcess id="Sub" name="Sub"><bpmn:task id="Dentro" name="Inside" /></bpmn:subProcess>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="DI"><bpmndi:BPMNPlane id="PL" bpmnElement="C">
    <bpmndi:BPMNShape id="Pool_di" bpmnElement="Pool" isHorizontal="true"><dc:Bounds x="0" y="0" width="800" height="400" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Sub_di" bpmnElement="Sub" isExpanded="false"><dc:Bounds x="100" y="100" width="100" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
  <bpmndi:BPMNDiagram id="DI2"><bpmndi:BPMNPlane id="PL2" bpmnElement="Sub">
    <bpmndi:BPMNShape id="Dentro_di" bpmnElement="Dentro"><dc:Bounds x="100" y="100" width="100" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

interface Forma { id: string; type: string; parent?: Forma; x: number; y: number }
interface Lienzo {
  getRootElement(): Forma;
  setRootElement(raiz: Forma): void;
  findRoot(id: string): Forma;
}

const figura = (tipo: string): Figura => gruposDeFiguras().flatMap((g) => g.figuras).find((f) => f.tipo === tipo)!;

/** The diagram, drilled into `Sub` or not, with the view centred on (400, 200): inside the pool. */
async function montar(dentro: boolean) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modeler = new Modeler({ container, additionalModules: [moduloLote, moduloCarriles] });
  const { warnings } = await modeler.importXML(SUBPROCESO_PLEGADO);
  expect(warnings).toEqual([]);
  const g = <T,>(n: string) => modeler.get<T>(n);
  const canvas = g<Lienzo>('canvas');
  if (dentro) canvas.setRootElement(canvas.findRoot('Sub_plane'));
  // jsdom lays nothing out, so the real `viewbox()` has no size; the rest of the canvas is real.
  const lienzo = Object.assign(Object.create(canvas as object) as Lienzo, { viewbox: () => ({ x: 0, y: 0, width: 800, height: 400 }) });
  const activate = vi.fn();
  const registry = g<{ get(id: string): Forma; filter(f: (e: Forma) => boolean): Forma[] }>('elementRegistry');
  return {
    canvas, registry, activate,
    servicios: {
      modeling: g('modeling'), elementRegistry: registry, rules: g('rules'), canvas: lienzo,
      directEditing: { activate }, elementFactory: g('elementFactory'), carriles: g<LilaCarriles>('lilaCarriles'),
    } as unknown as Servicios,
  };
}

describe('a palette click inside a collapsed sub-process (#721)', () => {
  it('creates the task on the open sub-process plane and stays on it', async () => {
    const m = await montar(true);
    const plano = m.canvas.getRootElement();
    expect(plano.id).toBe('Sub_plane');

    insertar(m.servicios, figura('bpmn:Task'));

    const creada = m.activate.mock.calls[0]![0] as Forma;
    expect(creada.type).toBe('bpmn:Task');
    expect(creada.parent).toBe(plano);
    expect((creada as unknown as { businessObject: { $parent: { id: string } } }).businessObject.$parent.id).toBe('Sub');
    expect([creada.x + 50, creada.y + 40]).toEqual([400, 200]);
    // `scrollToElement` shows the root of whatever it is given: a task on the pool would jump out.
    expect(m.canvas.getRootElement()).toBe(plano);
    expect(m.registry.filter((el) => el.parent?.id === 'Pool').map((el) => el.id)).toEqual(['Sub']);
  });

  it('the same click on the root diagram still goes into the pool under the centre of the view', async () => {
    const m = await montar(false);
    const raiz = m.canvas.getRootElement();

    insertar(m.servicios, figura('bpmn:Task'));

    const creada = m.activate.mock.calls[0]![0] as Forma;
    expect(creada.parent?.id).toBe('Pool');
    expect(m.canvas.getRootElement()).toBe(raiz);
  });

  it('the Lane tool finds no pool there: nothing is added to the pool of the hidden root diagram', async () => {
    const m = await montar(true);
    expect(hayPool(m.servicios)).toBe(false);
    const hecho = vi.fn();

    insertar(m.servicios, figura('bpmn:Lane'), null, hecho);

    expect(m.registry.filter((el) => el.type === 'bpmn:Lane')).toEqual([]);
    expect(m.activate).not.toHaveBeenCalled();
    expect(m.canvas.getRootElement().id).toBe('Sub_plane');

    const fuera = await montar(false);
    expect(hayPool(fuera.servicios)).toBe(true);
  });
});
