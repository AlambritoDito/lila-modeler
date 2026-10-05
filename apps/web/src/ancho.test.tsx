// @vitest-environment jsdom
/**
 * #563: activity width, by the side handles and from the Properties panel.
 *
 * Like `carriles.test.ts`, this builds a real bpmn-js `Modeler`: the rule only means something
 * next to bpmn-js's own, and the width is written by `modeling.resizeShape`. The SVG APIs jsdom
 * lacks are stubbed the same way; nothing here reads what is drawn beyond which resize handles
 * exist. The drag itself is checked in a browser (the PR says how): jsdom has no pointer geometry.
 */
import Modeler from 'bpmn-js/lib/Modeler';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ANCHO_MAXIMO, ANCHO_MINIMO, moduloAncho, problemaDeAncho, type LilaAncho } from './ancho';
import type { Modelador, Servicios } from './Modeler';
import { PanelPropiedades } from './PropertiesPanel';
import { setLocale, strings } from './i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const desmontar: Array<() => void> = [];
afterEach(() => {
  for (const d of desmontar.splice(0)) d();
  setLocale('auto');
});

/** Every task subtype and a call activity in a row, plus what must keep bpmn-js's behaviour. */
const TIPOS = ['task', 'userTask', 'serviceTask', 'manualTask', 'scriptTask', 'sendTask', 'receiveTask', 'businessRuleTask', 'callActivity'];
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="D" targetNamespace="http://example.com">
  <bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>
  <bpmn:process id="P">
    <bpmn:laneSet id="LS"><bpmn:lane id="L1" name="One"><bpmn:flowNodeRef>Start</bpmn:flowNodeRef><bpmn:flowNodeRef>T</bpmn:flowNodeRef><bpmn:flowNodeRef>G</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
    <bpmn:startEvent id="Start"><bpmn:outgoing>F1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="T" name="Review the application"><bpmn:documentation>Check it</bpmn:documentation><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing></bpmn:task>
    <bpmn:exclusiveGateway id="G"><bpmn:incoming>F2</bpmn:incoming></bpmn:exclusiveGateway>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="T" />
    <bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="G" />
    <bpmn:boundaryEvent id="B" attachedToRef="T"><bpmn:timerEventDefinition id="TD" /></bpmn:boundaryEvent>
    ${TIPOS.map((t) => `<bpmn:${t} id="X_${t}" />`).join('')}
    <bpmn:subProcess id="SubOpen" /><bpmn:subProcess id="SubClosed" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="DI"><bpmndi:BPMNPlane id="PL" bpmnElement="C">
    <bpmndi:BPMNShape id="Pool_di" bpmnElement="Pool" isHorizontal="true"><dc:Bounds x="100" y="100" width="1200" height="600" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L1_di" bpmnElement="L1" isHorizontal="true"><dc:Bounds x="130" y="100" width="1170" height="600" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="180" y="142" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T_di" bpmnElement="T"><dc:Bounds x="280" y="120" width="160" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="G_di" bpmnElement="G" isMarkerVisible="true"><dc:Bounds x="600" y="135" width="50" height="50" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="B_di" bpmnElement="B"><dc:Bounds x="402" y="182" width="36" height="36" /></bpmndi:BPMNShape>
    ${TIPOS.map((t, i) => `<bpmndi:BPMNShape id="X_${t}_di" bpmnElement="X_${t}"><dc:Bounds x="${180 + i * 120}" y="260" width="100" height="80" /></bpmndi:BPMNShape>`).join('')}
    <bpmndi:BPMNShape id="SubOpen_di" bpmnElement="SubOpen" isExpanded="true"><dc:Bounds x="180" y="400" width="350" height="200" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="SubClosed_di" bpmnElement="SubClosed" isExpanded="false"><dc:Bounds x="600" y="420" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F1_di" bpmnElement="F1"><di:waypoint x="216" y="160" /><di:waypoint x="280" y="160" /></bpmndi:BPMNEdge>
    <bpmndi:BPMNEdge id="F2_di" bpmnElement="F2"><di:waypoint x="440" y="160" /><di:waypoint x="600" y="160" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

interface Forma { id: string; x: number; y: number; width: number; height: number; businessObject: { $type: string; lanes?: { id: string }[]; documentation?: { text: string }[] } }
interface Flujo { waypoints: { x: number; y: number }[] }

async function montar(xml = XML, conAncho = true) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modeler = new Modeler({ container, additionalModules: conAncho ? [moduloAncho] : [] });
  const { warnings } = await modeler.importXML(xml);
  expect(warnings).toEqual([]);
  desmontar.push(() => { modeler.destroy(); container.remove(); });
  const registry = modeler.get<{ get(id: string): Forma }>('elementRegistry');
  const rules = modeler.get<{ allowed(accion: string, contexto: object): unknown }>('rules');
  return {
    modeler,
    container,
    el: (id: string) => registry.get(id),
    puede: (contexto: object) => rules.allowed('shape.resize', contexto),
    ancho: conAncho ? modeler.get<LilaAncho>('lilaAncho') : undefined,
    commandStack: modeler.get<{ undo(): void; redo(): void; canUndo(): boolean }>('commandStack'),
    xml: async () => (await modeler.saveXML({ format: false })).xml!,
  };
}

const DIRECCIONES = ['n', 'w', 's', 'e', 'nw', 'ne', 'se', 'sw'];
const caja = (f: Forma, cambio: Partial<Forma>) => ({ x: f.x, y: f.y, width: f.width, height: f.height, ...cambio });
const limites = (xml: string, id: string): string | undefined => xml.match(new RegExp(`id="${id}_di"[^>]*><dc:Bounds ([^/]*)/>`))?.[1]?.trim();

describe('the resize rule (#563)', () => {
  it.each(TIPOS)('lets a %s be resized sideways only, never narrower than the minimum nor taller', async (tipo) => {
    const m = await montar();
    const forma = m.el(`X_${tipo}`);
    for (const d of DIRECCIONES) expect(m.puede({ shape: forma, direction: d }), d).toBe(d === 'e' || d === 'w');
    expect(m.puede({ shape: forma, direction: 'e', newBounds: caja(forma, { width: 220 }) })).toBe(true);
    expect(m.puede({ shape: forma, direction: 'w', newBounds: caja(forma, { x: forma.x - 50, width: 150 }) })).toBe(true);
    expect(m.puede({ shape: forma, direction: 'e', newBounds: caja(forma, { width: ANCHO_MINIMO }) })).toBe(true);
    expect(m.puede({ shape: forma, direction: 'e', newBounds: caja(forma, { width: ANCHO_MINIMO - 1 }) })).toBe(false);
    expect(m.puede({ shape: forma, direction: 'e', newBounds: caja(forma, { height: 120 }) })).toBe(false);
  });

  it('draws only the left and right handles on a selected task, none on a gateway', async () => {
    const m = await montar();
    const selection = m.modeler.get<{ select(el: unknown): void }>('selection');
    const asas = () => [...m.container.querySelectorAll('.djs-resizer')].map((a) => [...a.classList].find((c) => /^djs-resizer-[nswe]{1,2}$/.test(c))).sort();
    selection.select(m.el('X_userTask'));
    expect(asas()).toEqual(['djs-resizer-e', 'djs-resizer-w']);
    selection.select(m.el('G'));
    expect(asas()).toEqual([]);
  });

  it('leaves pools, lanes, sub-processes, gateways and events exactly as bpmn-js has them', async () => {
    const con = await montar();
    const sin = await montar(XML, false);
    for (const id of ['Pool', 'L1', 'SubOpen', 'SubClosed', 'G', 'Start', 'B']) {
      for (const d of [undefined, ...DIRECCIONES]) {
        for (const cambio of [undefined, { width: 400 }, { width: 40, height: 40 }]) {
          const contexto = (m: typeof con) => {
            const forma = m.el(id);
            return { shape: forma, ...(d === undefined ? {} : { direction: d }), ...(cambio === undefined ? {} : { newBounds: caja(forma, cambio) }) };
          };
          expect(con.puede(contexto(con)), `${id} ${d} ${JSON.stringify(cambio)}`).toBe(sin.puede(contexto(sin)));
        }
      }
    }
    expect(con.puede({ shape: con.el('G'), direction: 'e' })).toBe(false);
    expect(con.puede({ shape: con.el('Start'), direction: 'e' })).toBe(false);
  });

  it('keeps the width when a task becomes a user task, and the space tool moving tasks instead of stretching them', async () => {
    const m = await montar();
    // The space tool asks with the canvas shape and no direction: it could push vertically.
    expect(m.puede({ shape: m.el('T') })).toBe(false);
    const nueva = m.modeler.get<{ replaceElement(el: unknown, destino: object): Forma }>('bpmnReplace')
      .replaceElement(m.el('T'), { type: 'bpmn:UserTask' });
    expect([nueva.businessObject.$type, nueva.width, nueva.height]).toEqual(['bpmn:UserTask', 160, 80]);
  });

  it('stops a drag at the minimum width and keeps the height', async () => {
    const m = await montar();
    const contexto: { shape: Forma; direction: string; minDimensions?: object } = { shape: m.el('T'), direction: 'w' };
    m.modeler.get<{ fire(evento: string, datos: object): unknown }>('eventBus').fire('resize.start', { context: contexto });
    expect(contexto.minDimensions).toEqual({ width: ANCHO_MINIMO, height: 80 });
  });
});

describe('setting the width (#563)', () => {
  it('changes only the width, in one undoable step, and keeps id, lane, documentation and flows attached', async () => {
    const m = await montar();
    const antes = await m.xml();
    // Imported dimensions are kept: selecting the task does not touch them.
    m.modeler.get<{ select(el: unknown): void }>('selection').select(m.el('T'));
    expect(limites(antes, 'T')).toBe('x="280" y="120" width="160" height="80"');

    m.ancho!.fijar(m.el('T'), 260);
    const t = m.el('T');
    expect([t.id, t.x, t.y, t.width, t.height]).toEqual(['T', 280, 120, 260, 80]);
    expect(t.businessObject.lanes?.map((l) => l.id)).toEqual(['L1']);
    expect(t.businessObject.documentation?.[0]?.text).toBe('Check it');
    // The outgoing flow now leaves from the new right edge; the incoming one still ends on the left.
    expect((m.el('F2') as unknown as Flujo).waypoints[0]).toMatchObject({ x: 540, y: 160 });
    expect((m.el('F1') as unknown as Flujo).waypoints.at(-1)).toMatchObject({ x: 280, y: 160 });
    // The boundary event stays on the task's bottom edge.
    expect(m.el('B').y + m.el('B').height / 2).toBe(200);

    const despues = await m.xml();
    expect(limites(despues, 'T')).toBe('x="280" y="120" width="260" height="80"');

    // Undo and redo restore every bound and waypoint. (bpmn-js's lane and attach behaviours may
    // list a lane's refs and the boundary event in another order: the same model either way.)
    const dibujo = (xml: string) => xml.slice(xml.indexOf('<bpmndi:BPMNDiagram'));
    m.commandStack.undo();
    expect(dibujo(await m.xml())).toBe(dibujo(antes));
    expect(m.el('T').businessObject.lanes?.map((l) => l.id)).toEqual(['L1']);
    expect(m.commandStack.canUndo()).toBe(false);
    m.commandStack.redo();
    expect(dibujo(await m.xml())).toBe(dibujo(despues));
  });

  it('survives export and reimport', async () => {
    const m = await montar();
    m.ancho!.fijar(m.el('X_callActivity'), 180);
    const otra = await montar(await m.xml());
    expect([otra.el('X_callActivity').width, otra.el('X_callActivity').height]).toEqual([180, 80]);
  });

  it('validates what is typed', () => {
    expect(problemaDeAncho('')).toBe('vacio');
    expect(problemaDeAncho('   ')).toBe('vacio');
    expect(problemaDeAncho('wide')).toBe('numero');
    expect(problemaDeAncho('120,5')).toBe('numero');
    expect(problemaDeAncho('Infinity')).toBe('numero');
    expect(problemaDeAncho(String(ANCHO_MINIMO - 1))).toBe('minimo');
    expect(problemaDeAncho(String(ANCHO_MINIMO))).toBeNull();
    expect(problemaDeAncho(' 120.5 ')).toBeNull();
    expect(problemaDeAncho('0x64')).toBe('numero');
    expect(problemaDeAncho('1e2')).toBe('numero');
    expect(problemaDeAncho('-60')).toBe('numero');
    expect(problemaDeAncho(String(ANCHO_MAXIMO))).toBeNull();
    expect(problemaDeAncho(String(ANCHO_MAXIMO + 1))).toBe('maximo');
  });
});

describe('the Width field in Properties (#563)', () => {
  /** The panel over a real modeler, with what `Lienzo` hands it for these tests. */
  async function panel(seleccionar: string) {
    const m = await montar();
    const servicios = {
      modeling: m.modeler.get('modeling'),
      bpmnFactory: m.modeler.get('bpmnFactory'),
      selection: m.modeler.get('selection'),
      elementRegistry: m.modeler.get('elementRegistry'),
      ancho: m.ancho,
    } as unknown as Servicios;
    const modelador = {
      servicios,
      suscribir: (eventos: string[], escuchar: () => void) => {
        m.modeler.on(eventos, escuchar);
        return () => m.modeler.off(eventos, escuchar);
      },
    } as unknown as Modelador;
    const contenedor = document.createElement('div');
    document.body.append(contenedor);
    const raiz = createRoot(contenedor);
    act(() => m.modeler.get<{ select(el: unknown): void }>('selection').select(m.el(seleccionar)));
    act(() => raiz.render(<PanelPropiedades modelador={modelador} pestana="propiedades" />));
    desmontar.push(() => { act(() => raiz.unmount()); contenedor.remove(); });
    const campo = () => contenedor.querySelector<HTMLInputElement>(`input[aria-label="${strings().propiedades.ancho}"]`);
    const escribir = (texto: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo(), texto);
      campo()!.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const tecla = (key: string) => act(() => { campo()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
    const alerta = () => contenedor.querySelector('[role="alert"]')?.textContent ?? null;
    return { ...m, campo, escribir, tecla, alerta };
  }

  it('shows the imported width and writes a valid one on Enter, undoable', async () => {
    setLocale('en');
    const p = await panel('T');
    expect(p.campo()?.value).toBe('160');
    p.escribir('240');
    // Nothing is written while typing.
    expect(p.el('T').width).toBe(160);
    p.tecla('Enter');
    expect([p.el('T').width, p.el('T').height]).toEqual([240, 80]);
    expect(limites(await p.xml(), 'T')).toBe('x="280" y="120" width="240" height="80"');
    act(() => p.commandStack.undo());
    expect(p.el('T').width).toBe(160);
    expect(p.campo()?.value).toBe('160');
  });

  it.each([
    ['', 'vacio'],
    ['abc', 'numero'],
    ['Infinity', 'numero'],
    [String(ANCHO_MINIMO - 1), 'minimo'],
  ] as const)('refuses «%s» with a message and leaves the diagram alone', async (texto, problema) => {
    setLocale('es');
    const p = await panel('X_serviceTask');
    const antes = await p.xml();
    p.escribir(texto);
    p.tecla('Enter');
    act(() => { p.campo()!.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    const S = strings().propiedades.anchoProblemas;
    expect(p.alerta()).toBe(problema === 'minimo' ? S.minimo(ANCHO_MINIMO) : S[problema]);
    expect(p.campo()?.getAttribute('aria-invalid')).toBe('true');
    expect(await p.xml()).toBe(antes);
    expect(p.commandStack.canUndo()).toBe(false);
    // Escape goes back to the width the diagram has.
    p.tecla('Escape');
    expect([p.campo()?.value, p.alerta()]).toEqual(['100', null]);
  });

  it('is not offered for gateways or events', async () => {
    const p = await panel('G');
    expect(p.campo()).toBeNull();
  });
});
