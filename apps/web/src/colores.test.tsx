// @vitest-environment jsdom
/**
 * Colours per element (#452). The write and the Bizagi import run against bpmn-moddle, the tree
 * bpmn-js serializes with `saveXML` (bpmn-js itself cannot render in jsdom, see
 * `propiedades.test.ts`); the fake `modeling` does what `UpdateModdlePropertiesHandler` does to the
 * tree: `set` each property.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BpmnModdle } from 'bpmn-moddle';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { coloresDeBizagi, escribirColor, lista, type ElementoColoreable } from './colores.js';
import { setLocale } from './i18n';
import type { Modelador } from './Modeler.js';
import { PanelPropiedades, type ElementoModdle, type Escritor } from './PropertiesPanel.js';

setLocale('en');
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const leer = (rel: string): string => readFileSync(resolve(RAIZ, rel), 'utf8');

type Di = NonNullable<ElementoColoreable['di']>;

async function abrir(xml: string): Promise<{
  definitions: Parameters<typeof coloresDeBizagi>[0];
  elemento(id: string): ElementoColoreable;
  exportar(): Promise<string>;
  escritor: Escritor;
}> {
  const moddle = BpmnModdle();
  const { rootElement } = await moddle.fromXML(xml);
  const definitions = rootElement as unknown as { diagrams: Array<{ plane: { planeElement: Di[] } }> };
  const set = (objeto: ElementoModdle, props: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(props)) (objeto as unknown as Di).set(k, v);
  };
  return {
    definitions,
    elemento: (id) => {
      const di = definitions.diagrams.flatMap((d) => d.plane.planeElement)
        .find((p) => (p as unknown as { bpmnElement: { id: string } }).bpmnElement.id === id)!;
      const bo = (di as unknown as { bpmnElement: ElementoModdle }).bpmnElement;
      return { id, type: bo.$type, businessObject: bo, di };
    },
    exportar: async () => (await moddle.toXML(rootElement, { format: true })).xml,
    escritor: {
      modeling: { updateProperties: (el, props) => set(el.businessObject, props), updateModdleProperties: (_el, o, props) => set(o, props) },
      bpmnFactory: { create: (tipo, atributos) => moddle.create(tipo, atributos) as ElementoModdle },
    },
  };
}

/** The opening tag of the DI of `id`, and the label inside it. */
const diDe = (xml: string, id: string): string =>
  new RegExp(`<(?:bpmndi:)?BPMN(?:Shape|Edge)[^>]*bpmnElement="${id}"[\\s\\S]*?</(?:bpmndi:)?BPMN(?:Shape|Edge)>`).exec(xml)?.[0] ?? '';

describe('writing a colour', () => {
  it('a palette colour writes bioc and color on the shape and the label colour; «none» removes them', async () => {
    const m = await abrir(leer('examples/pedido/model.bpmn'));
    const tarea = m.elemento('Task_TomarPedido');
    escribirColor(m.escritor, tarea, 'azul');
    let di = diDe(await m.exportar(), 'Task_TomarPedido');
    expect(di).toContain('bioc:fill="#BBDEFB"');
    expect(di).toContain('bioc:stroke="#0D4372"');
    expect(di).toContain('color:background-color="#BBDEFB"');
    expect(di).toContain('color:border-color="#0D4372"');
    expect(di).toMatch(/<bpmndi:BPMNLabel[^>]*color:color="#0D4372"/);

    escribirColor(m.escritor, tarea, null);
    di = diDe(await m.exportar(), 'Task_TomarPedido');
    expect(di).not.toMatch(/bioc:|color:/);
  });

  it('an external label (event, gateway, flow) keeps the theme colour: it sits on the canvas, not on the fill', async () => {
    const m = await abrir(leer('examples/pedido/model.bpmn'));
    for (const id of ['StartEvent_Pedido', 'Gateway_ANDFork', 'Flow_Aprobado']) escribirColor(m.escritor, m.elemento(id), 'azul');
    const xml = await m.exportar();
    for (const id of ['StartEvent_Pedido', 'Gateway_ANDFork', 'Flow_Aprobado']) {
      expect(diDe(xml, id), id).toContain('color:border-color="#0D4372"');
      expect(diDe(xml, id), id).not.toContain('color:color');
    }
  });

  it('«none» on a task that had no label leaves no empty BPMNLabel behind', async () => {
    const m = await abrir(leer('examples/pedido/model.bpmn'));
    const tarea = m.elemento('Task_Preparar');
    escribirColor(m.escritor, tarea, 'verde');
    escribirColor(m.escritor, tarea, null);
    expect(diDe(await m.exportar(), 'Task_Preparar')).not.toContain('BPMNLabel');
  });

  it('a connection gets the stroke only', async () => {
    const m = await abrir(leer('examples/pedido/model.bpmn'));
    escribirColor(m.escritor, m.elemento('Flow_Start_TomarPedido'), 'rojo');
    const di = diDe(await m.exportar(), 'Flow_Start_TomarPedido');
    expect(di).toContain('color:border-color="#831311"');
    expect(di).not.toContain('background-color');
    expect(di).not.toContain('bioc:fill');
  });
});

describe('context pad target', () => {
  it('an external label stands for its owner, once even if the owner is selected too', async () => {
    const m = await abrir(leer('examples/pedido/model.bpmn'));
    const compuerta = m.elemento('Gateway_ANDFork');
    const tarea = m.elemento('Task_Preparar');
    const etiqueta: ElementoColoreable = { id: 'Gateway_ANDFork_label', type: 'label', businessObject: compuerta.businessObject, di: compuerta.di!, labelTarget: compuerta };
    expect(lista([etiqueta, tarea])).toEqual([compuerta, tarea]);
    expect(lista([compuerta, etiqueta])).toEqual([compuerta]);
  });
});

describe('Bizagi colours on import', () => {
  it('copies a non-default bgColor/borderColor to the DI; Bizagi\'s White/Black default is no colour', async () => {
    const m = await abrir(leer('examples/bizagi-exports/bizagi-miwg-B.2.0-roundtrip.bpmn'));
    coloresDeBizagi(m.definitions);
    const xml = await m.exportar();
    const gris = diDe(xml, 'DF1373638080458');
    expect(gris).toContain('color:background-color="#F0F0F0"');
    expect(gris).toContain('bioc:fill="#F0F0F0"');
    expect(gris).toContain('color:border-color="#666666"');
    // The other ~190 elements carry bgColor="White"/borderColor="Black": none of them is painted.
    expect(xml.match(/color:background-color=/g)).toHaveLength(1);
  });

  it('a colour the DI already has wins over the Bizagi one', async () => {
    const xml = leer('examples/bizagi-exports/bizagi-miwg-B.2.0-roundtrip.bpmn');
    const m = await abrir(xml);
    const el = m.elemento('DF1373638080458');
    el.di!.set('color:background-color', '#123456');
    coloresDeBizagi(m.definitions);
    expect(diDe(await m.exportar(), 'DF1373638080458')).not.toContain('#F0F0F0');
  });
});

/** Synthetic, Bizagi-style (`docs/EXAMPLES_POLICY.md`): a coloured task and event, a default-white one. */
const BIZAGI_SINTETICO = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:bizagi="http://www.bizagi.com/bpmn20" id="D1" targetNamespace="http://example.com/synthetic">
  <process id="P1">
    <startEvent id="S1"><extensionElements><bizagi:BizagiExtensions><bizagi:BizagiProperties><bizagi:BizagiProperty name="bgColor" value="#FFCC00" /><bizagi:BizagiProperty name="borderColor" value="#996600" /></bizagi:BizagiProperties></bizagi:BizagiExtensions></extensionElements></startEvent>
    <task id="T1" name="Coloured"><extensionElements><bizagi:BizagiExtensions><bizagi:BizagiProperties><bizagi:BizagiProperty name="bgColor" value="#FFE0B2" /><bizagi:BizagiProperty name="borderColor" value="#6B3C00" /></bizagi:BizagiProperties></bizagi:BizagiExtensions></extensionElements></task>
    <task id="T2" name="Default"><extensionElements><bizagi:BizagiExtensions><bizagi:BizagiProperties><bizagi:BizagiProperty name="bgColor" value="White" /><bizagi:BizagiProperty name="borderColor" value="Black" /></bizagi:BizagiProperties></bizagi:BizagiExtensions></extensionElements></task>
  </process>
  <bpmndi:BPMNDiagram id="Dg"><bpmndi:BPMNPlane id="Pl" bpmnElement="P1">
    <bpmndi:BPMNShape id="S1_di" bpmnElement="S1"><dc:Bounds x="100" y="120" width="36" height="36" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T1_di" bpmnElement="T1"><dc:Bounds x="200" y="98" width="100" height="80" /></bpmndi:BPMNShape>
    <bpmndi:BPMNShape id="T2_di" bpmnElement="T2"><dc:Bounds x="350" y="98" width="100" height="80" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</definitions>`;

describe('Bizagi colours on a visible task (synthetic)', () => {
  it('the task gets fill, stroke and its embedded label colour; the event no label colour; White/Black nothing', async () => {
    const m = await abrir(BIZAGI_SINTETICO);
    coloresDeBizagi(m.definitions);
    const xml = await m.exportar();
    const t1 = diDe(xml, 'T1');
    expect(t1).toContain('color:background-color="#FFE0B2"');
    expect(t1).toContain('bioc:stroke="#6B3C00"');
    expect(t1).toMatch(/BPMNLabel[^>]*color:color="#6B3C00"/);
    const s1 = diDe(xml, 'S1');
    expect(s1).toContain('color:background-color="#FFCC00"');
    expect(s1).not.toContain('color:color');
    expect(diDe(xml, 'T2')).not.toMatch(/bioc:|color:/);
  });
});

describe('properties panel', () => {
  const montados: Array<() => void> = [];
  afterEach(() => {
    for (const d of montados.splice(0)) d();
  });

  it('shows none plus eight colours, marks the current one and paints through `pintar`', async () => {
    const m = await abrir(leer('examples/pedido/model.bpmn'));
    const tarea = m.elemento('Task_TomarPedido');
    escribirColor(m.escritor, tarea, 'verde');
    const pintar = vi.fn();
    const modelador = {
      servicios: { selection: { get: () => [tarea] }, rootElement: () => undefined, elementRegistry: { filter: () => [] }, colores: { pintar } },
      suscribir: () => () => undefined,
    } as unknown as Modelador;
    const contenedor = document.createElement('div');
    document.body.append(contenedor);
    const raiz = createRoot(contenedor);
    act(() => raiz.render(<PanelPropiedades modelador={modelador} pestana="propiedades" />));
    montados.push(() => { act(() => raiz.unmount()); contenedor.remove(); });

    const botones = [...contenedor.querySelectorAll<HTMLButtonElement>('.colores button')];
    expect(botones.map((b) => b.getAttribute('aria-label'))).toEqual(
      ['None', 'Blue', 'Green', 'Yellow', 'Orange', 'Red', 'Purple', 'Teal', 'Gray'],
    );
    expect(botones.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.title)).toEqual(['Green']);
    act(() => botones[5]!.click());
    expect(pintar).toHaveBeenCalledWith([tarea], 'rojo');
    act(() => botones[0]!.click());
    expect(pintar).toHaveBeenLastCalledWith([tarea], null);
  });

  it('with several selected, one click paints them all (one call, so one command and one ⌘Z)', async () => {
    const m = await abrir(leer('examples/pedido/model.bpmn'));
    const elegidos = [m.elemento('Task_Preparar'), m.elemento('Task_Empacar'), m.elemento('Flow_Aprobado')];
    const pintar = vi.fn();
    const modelador = {
      servicios: { selection: { get: () => elegidos }, rootElement: () => undefined, elementRegistry: { filter: () => [] }, colores: { pintar } },
      suscribir: () => () => undefined,
    } as unknown as Modelador;
    const contenedor = document.createElement('div');
    document.body.append(contenedor);
    const raiz = createRoot(contenedor);
    act(() => raiz.render(<PanelPropiedades modelador={modelador} pestana="propiedades" />));
    montados.push(() => { act(() => raiz.unmount()); contenedor.remove(); });
    expect(contenedor.textContent).toContain('3 elements selected');
    act(() => contenedor.querySelector<HTMLButtonElement>('.colores button[aria-label="Teal"]')!.click());
    expect(pintar).toHaveBeenCalledTimes(1);
    expect(pintar).toHaveBeenCalledWith(elegidos, 'turquesa');
  });
});
