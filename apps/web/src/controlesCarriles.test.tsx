// @vitest-environment jsdom
/**
 * #596: the lane controls of Model — the «+» and ⠿ on the canvas (`controlesCarriles.ts`) and the
 * lane list and lane height of the properties panel.
 *
 * Like `carriles.test.ts`, a real bpmn-js `Modeler` imports a pool with three lanes: the controls
 * are overlays on its canvas and every operation is one of its commands. The SVG APIs jsdom lacks
 * are stubbed the same way. jsdom has no layout, so the drag test pins the viewbox to the identity:
 * a pointer at client (x, y) is the diagram point (x, y).
 */
import Modeler from 'bpmn-js/lib/Modeler';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { moduloLote } from './lote';
import { carrilesDe, moduloCarriles, type Forma, type LilaCarriles } from './carriles';
import { direccionDeTecla, moduloControlesCarriles } from './controlesCarriles';
import type { Modelador, Servicios } from './Modeler';
import { PanelPropiedades } from './PropertiesPanel';
import { setLocale } from './i18n';

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
  // jsdom has no `showModal`/`close`.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
});

const desmontar: Array<() => void> = [];
afterEach(() => {
  for (const d of desmontar.splice(0)) d();
  setLocale('auto');
});

/** A pool with three lanes (the second without a name), a task in each of the last two. */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="D" targetNamespace="http://example.com">
  <bpmn:collaboration id="C"><bpmn:participant id="Pool" name="Bank" processRef="P" /></bpmn:collaboration>
  <bpmn:process id="P">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="L1" name="Desk" />
      <bpmn:lane id="L2"><bpmn:flowNodeRef>T2</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L3" name="Committee"><bpmn:flowNodeRef>T3</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:task id="T2" name="Review"><bpmn:outgoing>F</bpmn:outgoing></bpmn:task>
    <bpmn:task id="T3" name="Approve"><bpmn:incoming>F</bpmn:incoming></bpmn:task>
    <bpmn:sequenceFlow id="F" sourceRef="T2" targetRef="T3" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="DI"><bpmndi:BPMNPlane id="PL" bpmnElement="C">
    <bpmndi:BPMNShape id="Pool_di" bpmnElement="Pool" isHorizontal="true"><dc:Bounds x="100" y="100" width="600" height="360" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L1_di" bpmnElement="L1" isHorizontal="true"><dc:Bounds x="130" y="100" width="570" height="100" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L2_di" bpmnElement="L2" isHorizontal="true"><dc:Bounds x="130" y="200" width="570" height="120" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="L3_di" bpmnElement="L3" isHorizontal="true"><dc:Bounds x="130" y="320" width="570" height="140" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T2_di" bpmnElement="T2"><dc:Bounds x="280" y="220" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T3_di" bpmnElement="T3"><dc:Bounds x="480" y="350" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNEdge id="F_di" bpmnElement="F"><di:waypoint x="380" y="260" /><di:waypoint x="530" y="260" /><di:waypoint x="530" y="350" /></bpmndi:BPMNEdge>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

async function montar(xml = XML) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const modeler = new Modeler({ container, additionalModules: [moduloLote, moduloCarriles, moduloControlesCarriles] });
  const { warnings } = await modeler.importXML(xml);
  expect(warnings).toEqual([]);
  desmontar.push(() => { modeler.destroy(); container.remove(); });
  const registry = modeler.get<{ get(id: string): Forma }>('elementRegistry');
  return {
    modeler,
    container,
    el: (id: string) => registry.get(id),
    carriles: modeler.get<LilaCarriles>('lilaCarriles'),
    commandStack: modeler.get<{ undo(): void; redo(): void; canUndo(): boolean }>('commandStack'),
    selection: modeler.get<{ select(el: unknown): void; get(): Forma[] }>('selection'),
    orden: () => carrilesDe(registry.get('Pool')).map((l) => l.id),
    xml: async () => (await modeler.saveXML({ format: false })).xml!,
  };
}

type Montado = Awaited<ReturnType<typeof montar>>;

const botones = (m: Montado, clase: string): HTMLButtonElement[] => [...m.container.querySelectorAll<HTMLButtonElement>(`.djs-overlay-lila-carril .${clase}`)];
const mas = (m: Montado) => botones(m, 'lila-carril-mas');
const asas = (m: Montado) => botones(m, 'lila-carril-asa');
const asaDe = (m: Montado, id: string) => asas(m).find((b) => b.dataset['lilaCarril'] === `asa:${id}`)!;
const alt = (key: string): KeyboardEvent => new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true });

describe('the «+» on the pool edge (#596)', () => {
  it('puts one before every lane and one after the last, named for screen readers', async () => {
    const m = await montar();
    expect(mas(m).map((b) => b.getAttribute('aria-label'))).toEqual([1, 2, 3, 4].map((n) => `Add a lane at position ${n} of «Bank»`));
    expect(mas(m).every((b) => b.type === 'button' && b.title === 'Add a lane here')).toBe(true);
  });

  it('adds a lane right there with nothing selected, selects it, and one undo takes it away', async () => {
    const m = await montar();
    const antes = await m.xml();
    expect(m.selection.get()).toEqual([]);
    act(() => mas(m)[2]!.click());
    const [nuevo] = m.selection.get();
    expect(m.orden()).toEqual(['L1', 'L2', nuevo!.id, 'L3']);
    expect(nuevo!.type).toBe('bpmn:Lane');
    // Repainted: one more «+» and one more ⠿.
    expect([mas(m).length, asas(m).length]).toEqual([5, 4]);
    m.commandStack.undo();
    expect(m.orden()).toEqual(['L1', 'L2', 'L3']);
    expect(await m.xml()).toBe(antes);
  });

  it('follows the language', async () => {
    const m = await montar();
    act(() => setLocale('es'));
    expect(mas(m)[0]!.getAttribute('aria-label')).toBe('Añadir un carril en la posición 1 de «Bank»');
    expect(asaDe(m, 'L2').getAttribute('aria-label')).toBe('Carril «Carril sin nombre 2». Arrástralo, o pulsa Alt+↑/↓, para moverlo');
  });

  it('does nothing outside Model', async () => {
    const m = await montar();
    m.container.closest('body')!.classList.add('modo-simular');
    try {
      mas(m)[0]!.click();
      m.selection.select(m.el('L3'));
      m.modeler.get<{ fire(e: string, d: object): unknown }>('eventBus').fire('keyboard.keydown', { keyEvent: alt('ArrowUp') });
      expect(m.orden()).toEqual(['L1', 'L2', 'L3']);
      expect(m.commandStack.canUndo()).toBe(false);
    } finally {
      m.container.closest('body')!.classList.remove('modo-simular');
    }
  });
});

describe('reordering lanes (#596)', () => {
  it('Alt+↑ on the canvas moves the selected lane up, with its task, in one undo step', async () => {
    const m = await montar();
    const antes = await m.xml();
    m.selection.select(m.el('L3'));
    const evento = alt('ArrowUp');
    const tratado = m.modeler.get<{ fire(e: string, d: object): unknown }>('eventBus').fire('keyboard.keydown', { keyEvent: evento });
    expect(tratado).toBe(true);
    expect(m.orden()).toEqual(['L1', 'L3', 'L2']);
    expect(m.el('T3').y).toBe(350 - 120);
    m.commandStack.undo();
    expect(await m.xml()).toBe(antes);
  });

  it('leaves plain arrows and other selections to bpmn-js', async () => {
    const m = await montar();
    const bus = m.modeler.get<{ fire(e: string, d: object): unknown }>('eventBus');
    m.selection.select(m.el('L3'));
    bus.fire('keyboard.keydown', { keyEvent: new KeyboardEvent('keydown', { key: 'ArrowUp' }) });
    m.selection.select(m.el('T3'));
    bus.fire('keyboard.keydown', { keyEvent: alt('ArrowUp') });
    expect(m.orden()).toEqual(['L1', 'L2', 'L3']);
    expect(direccionDeTecla(alt('ArrowDown'))).toBe('abajo');
    expect(direccionDeTecla(alt('ArrowLeft'))).toBe('arriba');
    expect(direccionDeTecla(new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, metaKey: true }))).toBeNull();
  });

  it('Alt+↓ on a lane\'s ⠿ moves it and keeps the focus on its handle', async () => {
    const m = await montar();
    asaDe(m, 'L1').focus();
    asaDe(m, 'L1').dispatchEvent(alt('ArrowDown'));
    expect(m.orden()).toEqual(['L2', 'L1', 'L3']);
    expect(document.activeElement).toBe(asaDe(m, 'L1'));
  });

  it('dragging a lane\'s ⠿ onto another lane takes it to that place, in one undo step', async () => {
    const m = await montar();
    const antes = await m.xml();
    const canvas = m.modeler.get<{ viewbox(): object }>('canvas');
    vi.spyOn(canvas, 'viewbox').mockReturnValue({ x: 0, y: 0, scale: 1 });
    const puntero = (tipo: string, y: number, objetivo: EventTarget = document) =>
      objetivo.dispatchEvent(new MouseEvent(tipo, { clientX: 400, clientY: y, button: 0, bubbles: true, cancelable: true }));

    puntero('pointerdown', 340, asaDe(m, 'L3'));
    puntero('pointermove', 300);
    puntero('pointermove', 150);
    // The lane it would land on is marked while dragging.
    expect(m.container.querySelector('[data-element-id="L1"]')!.classList.contains('lila-carril-destino')).toBe(true);
    puntero('pointerup', 150);
    expect(m.container.querySelector('.lila-carril-destino')).toBeNull();
    expect(m.orden()).toEqual(['L3', 'L1', 'L2']);
    expect(m.el('T3').y).toBe(350 - 220);
    expect(m.el('T3').businessObject.get?.('lanes')).toEqual([m.el('L3').businessObject]);
    m.commandStack.undo();
    expect(await m.xml()).toBe(antes);

    // Escape cancels a drag; a press without a move changes nothing.
    puntero('pointerdown', 340, asaDe(m, 'L3'));
    puntero('pointermove', 150);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    puntero('pointerup', 150);
    puntero('pointerdown', 340, asaDe(m, 'L3'));
    puntero('pointerup', 340);
    expect(m.orden()).toEqual(['L1', 'L2', 'L3']);
  });
});

describe('the lane list in Properties (#596)', () => {
  async function panel(seleccionar: string, idioma: 'en' | 'es' = 'en') {
    setLocale(idioma);
    const m = await montar();
    const servicios = {
      modeling: m.modeler.get('modeling'),
      bpmnFactory: m.modeler.get('bpmnFactory'),
      selection: m.modeler.get('selection'),
      elementRegistry: m.modeler.get('elementRegistry'),
      carriles: m.carriles,
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
    act(() => m.selection.select(m.el(seleccionar)));
    act(() => raiz.render(<PanelPropiedades modelador={modelador} pestana="propiedades" />));
    desmontar.push(() => { act(() => raiz.unmount()); contenedor.remove(); });
    const lista = () => contenedor.querySelector<HTMLElement>('.lista-carriles');
    const filas = () => [...(lista()?.querySelectorAll('li') ?? [])];
    const boton = (etiqueta: string) => contenedor.querySelector<HTMLButtonElement>(`button[aria-label="${etiqueta}"]`)!;
    return { m, contenedor, lista, filas, boton };
  }

  it('lists the pool\'s lanes in order, an unnamed one by its position, with their contents and height', async () => {
    const { lista, filas } = await panel('Pool');
    expect(lista()!.getAttribute('aria-label')).toBe('Lanes of «Bank»');
    expect(lista()!.querySelector('ol')).not.toBeNull();
    expect(filas().map((li) => li.querySelector('input')!.getAttribute('aria-label'))).toEqual(['Name of lane 1', 'Name of lane 2', 'Name of lane 3']);
    expect(filas().map((li) => li.querySelector('input')!.value)).toEqual(['Desk', '', 'Committee']);
    expect(filas()[1]!.querySelector('input')!.placeholder).toBe('Unnamed lane 2');
    expect(filas().map((li) => li.querySelector('small')!.textContent)).toEqual(['0 elements · height 100', '1 element · height 120', '1 element · height 140']);
    expect(filas()[1]!.textContent).not.toContain('L2');
  });

  it('↑ and ↓ move a lane with its task in one undo step; the arrows at the edges are disabled', async () => {
    const { m, filas, boton } = await panel('Pool');
    expect(boton('Move «Desk» up').disabled).toBe(true);
    expect(boton('Move «Committee» down').disabled).toBe(true);
    act(() => boton('Move «Committee» up').click());
    expect(m.orden()).toEqual(['L1', 'L3', 'L2']);
    expect(filas().map((li) => li.querySelector('input')!.value)).toEqual(['Desk', 'Committee', '']);
    expect(document.activeElement).toBe(boton('Move «Committee» up'));
    // Now third, the unnamed lane is called by its new position.
    act(() => boton('Move «Unnamed lane 3» up').click());
    expect(m.orden()).toEqual(['L1', 'L2', 'L3']);
    act(() => m.commandStack.undo());
    expect(m.orden()).toEqual(['L1', 'L3', 'L2']);
    act(() => m.commandStack.undo());
    expect(m.orden()).toEqual(['L1', 'L2', 'L3']);
    expect(m.commandStack.canUndo()).toBe(false);
  });

  it('renames a lane in place', async () => {
    const { m, filas } = await panel('Pool');
    const campo = filas()[1]!.querySelector('input')!;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, 'Analyst');
      campo.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(m.el('L2').businessObject.get?.('name')).toBe('Analyst');
    expect(filas()[1]!.querySelector('input')!.value).toBe('Analyst');
  });

  it('× deletes an empty lane at once, and asks first for one with a task', async () => {
    const { m, contenedor, boton } = await panel('Pool');
    act(() => boton('Delete «Desk»').click());
    expect(m.orden()).toEqual(['L2', 'L3']);
    expect(contenedor.querySelector('dialog')).toBeNull();

    act(() => boton('Delete «Committee»').click());
    const dialogo = contenedor.querySelector('dialog')!;
    expect(dialogo.open).toBe(true);
    expect(dialogo.textContent).toContain('«Committee» holds 1 element.');
    // Cancel keeps it.
    act(() => [...dialogo.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click());
    expect(m.orden()).toEqual(['L2', 'L3']);
    expect(contenedor.querySelector('dialog')).toBeNull();

    act(() => boton('Delete «Committee»').click());
    act(() => contenedor.querySelector<HTMLButtonElement>('dialog button[type="submit"]')!.click());
    expect(m.orden()).toEqual(['L2']);
    // The task stays in the pool, now in the lane that took the room.
    expect(m.el('T3')).toBeDefined();
    expect(m.el('T3').businessObject.get?.('lanes')).toEqual([m.el('L2').businessObject]);
    act(() => m.commandStack.undo());
    expect(m.orden()).toEqual(['L2', 'L3']);
  });

  it('adds a lane at the end and puts the focus on its name', async () => {
    const { m, contenedor, filas } = await panel('Pool');
    act(() => contenedor.querySelector<HTMLButtonElement>('.lista-carriles .anadir')!.click());
    expect(m.orden()).toHaveLength(4);
    expect(m.orden().slice(0, 3)).toEqual(['L1', 'L2', 'L3']);
    expect(document.activeElement).toBe(filas()[3]!.querySelector('input'));
    expect(filas()[3]!.querySelector('input')!.placeholder).toBe('Unnamed lane 4');
  });

  it('shows the same list with a lane selected, marking it, plus its height field', async () => {
    const { m, contenedor, filas } = await panel('L2', 'es');
    expect(filas().map((li) => li.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    expect(contenedor.querySelector('.lista-carriles')!.getAttribute('aria-label')).toBe('Carriles de «Bank»');
    const alto = contenedor.querySelector<HTMLInputElement>('input[aria-label="Alto"]')!;
    expect(alto.value).toBe('120');
    const escribir = (texto: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(alto, texto);
      alto.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Its task ends at 300: anything under 120 would leave it outside.
    escribir('100');
    act(() => alto.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(contenedor.querySelector('[role="alert"]')!.textContent).toBe('El tamaño tiene que ser al menos 120: con menos, algún elemento queda fuera del carril.');
    expect(m.el('L2').height).toBe(120);
    escribir('200');
    act(() => alto.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect([m.el('L2').height, m.el('L3').y, m.el('T3').y]).toEqual([200, 400, 430]);
    act(() => m.commandStack.undo());
    expect([m.el('L2').height, m.el('L3').y, m.el('T3').y]).toEqual([120, 320, 350]);
  });

  it('does not show for a task', async () => {
    const { contenedor } = await panel('T2');
    expect(contenedor.querySelector('.lista-carriles')).toBeNull();
    expect(contenedor.querySelector('input[aria-label="Height"]')).toBeNull();
  });
});
