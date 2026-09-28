// @vitest-environment jsdom
/**
 * Extended attributes (#509) in the properties panel, mounted in jsdom.
 *
 * The bench is `PropertiesPanel.qa.test.tsx`'s, with the one difference that matters here: every
 * write goes through a real diagram-js `CommandStack` with bpmn-js's own
 * `UpdateModdlePropertiesHandler` and the app's `lila.lote` (`lote.ts`), so ⌘Z is the real undo
 * and not an imitation. The canvas is left out for the same reason as there (jsdom cannot draw).
 */
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';
import Modeler from 'bpmn-js/lib/Modeler';
import type { Moddle } from 'bpmn-moddle';
import UpdateModdlePropertiesHandler from 'bpmn-js/lib/features/modeling/cmd/UpdateModdlePropertiesHandler';
import CommandStack from 'diagram-js/lib/command/CommandStack';
import EventBus from 'diagram-js/lib/core/EventBus';
import Selection from 'diagram-js/lib/features/selection/Selection';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { readAnnotations } from '../../../packages/engine/src/bpmn/annotate.js';
import lila from '../../../packages/engine/src/bpmn/lila.moddle.json' with { type: 'json' };
import { LilaLote } from './lote';
import type { Modelador } from './Modeler';
import { PanelPropiedades, type ElementoLienzo, type ElementoModdle, type Escritor } from './PropertiesPanel';
import { setLocale } from './i18n';
import { en } from './strings.en';

setLocale('en');
const T = en.atributos;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // jsdom has `<dialog>` but not its modal methods (same polyfill as `App.test.tsx`).
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs" targetNamespace="urn:test">
  <bpmn:process id="Proc_1" name="Proceso" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Inicio" />
    <bpmn:task id="Task_1" name="Revisar" />
    <bpmn:task id="Task_2" name="Aprobar" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start_1" targetRef="Task_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Proc_1">
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"><dc:Bounds x="100" y="100" width="100" height="80" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

function* recorrer(el: ModdleElement): Generator<ModdleElement> {
  if (typeof el.id === 'string') yield el;
  for (const hijo of [...(el.rootElements ?? []), ...(el.flowElements ?? []), ...(el.participants ?? [])]) yield* recorrer(hijo);
}

/** `raizId`: the canvas root — a collapsed sub-process after a drill-down, a collaboration… */
async function banco(xml: string, raizId = 'Proc_1') {
  const moddle = BpmnModdle({ lila });
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const eventBus = new EventBus();
  const commandStack = new CommandStack(eventBus, { get: () => undefined } as never);
  commandStack.register('element.updateModdleProperties', new UpdateModdlePropertiesHandler({ filter: () => [] } as never));
  const lote = new LilaLote(commandStack as never);

  const figuras = new Map<string, ElementoLienzo>();
  for (const el of recorrer(definitions)) {
    figuras.set(el.id, { id: el.id, type: el.$type, businessObject: el as unknown as ElementoModdle });
  }
  const raiz = figuras.get(raizId)!;
  let cambios = 0;
  eventBus.on('commandStack.changed', () => {
    cambios++;
  });
  const selection = new Selection(eventBus, { getRootElement: () => raiz, findRoot: () => raiz } as never);

  const escritor: Escritor = {
    modeling: {
      updateProperties: () => {
        throw new Error('extended attributes only use updateModdleProperties');
      },
      updateModdleProperties: (element, moddleElement, properties) =>
        commandStack.execute('element.updateModdleProperties', { element, moddleElement, properties }),
    },
    bpmnFactory: { create: (tipo, atributos) => moddle.create(tipo, atributos) as ElementoModdle },
    lote: lote.ejecutar,
  };
  const modelador = {
    servicios: { ...escritor, selection, rootElement: () => raiz, elementRegistry: { filter: () => [] } },
    suscribir: (eventos: string[], escuchar: () => void) => {
      eventBus.on(eventos, escuchar);
      return () => eventBus.off(eventos, escuchar);
    },
  } as unknown as Modelador;
  const exportar = async (): Promise<string> => (await moddle.toXML(definitions, { format: true })).xml;
  const accion = (hacer: () => void): void => act(() => {
    hacer();
    // What bpmn-js's ChangeSupport turns `commandStack.changed` into.
    eventBus.fire('elements.changed', { elements: [] });
  });
  return {
    modelador,
    exportar,
    moddle,
    definitions,
    eventBus,
    commandStack,
    escritor,
    figura: (id: string) => figuras.get(id)!,
    cambios: () => cambios,
    clic: (id: string) => act(() => selection.select(figuras.get(id) as never)),
    deshacer: () => accion(() => commandStack.undo()),
    rehacer: () => accion(() => commandStack.redo()),
  };
}

const montados: (() => void)[] = [];
afterEach(() => {
  for (const f of montados.splice(0)) f();
});

function montar(modelador: Modelador): HTMLElement {
  const contenedor = document.createElement('div');
  document.body.append(contenedor);
  const root = createRoot(contenedor);
  act(() => root.render(<PanelPropiedades modelador={modelador} pestana="propiedades" />));
  montados.push(() => {
    act(() => root.unmount());
    contenedor.remove();
  });
  return contenedor;
}

function escribir(campo: Element | null, texto: string): void {
  if (!(campo instanceof HTMLInputElement || campo instanceof HTMLTextAreaElement)) throw new Error('no field');
  const proto = campo instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function elegir(campo: Element | null, valor: string): void {
  if (!(campo instanceof HTMLSelectElement)) throw new Error('no select');
  act(() => {
    campo.value = valor;
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const boton = (raiz: ParentNode, texto: string): HTMLButtonElement => {
  const b = [...raiz.querySelectorAll('button')].find((x) => x.textContent === texto);
  if (b === undefined) throw new Error(`no button «${texto}»`);
  return b;
};
const pulsar = (b: HTMLElement): void => act(() => b.click());
const dialogo = (): HTMLDialogElement | null => document.querySelector('dialog.atributos-dialogo');

/** Defines one list attribute «Risk» (Low/High) for tasks, through the dialog. */
function definirRiesgo(panel: HTMLElement): void {
  pulsar(boton(panel, T.definir));
  const d = dialogo()!;
  expect(d.open).toBe(true);
  pulsar(boton(d, T.anadir));
  escribir(d.querySelector(`[aria-label="${T.nombre(1)}"]`), 'Risk');
  elegir(d.querySelector(`[aria-label="${T.tipo(1)}"]`), 'list');
  escribir(d.querySelector(`[aria-label="${T.opciones(1)}"]`), 'Low\nHigh\n');
  pulsar(boton(d, T.guardar));
}

describe('extended attributes in the properties panel (#509)', () => {
  it('(e) define a list attribute, assign it, undo: one ⌘Z per step, back to the original bytes', async () => {
    const b = await banco(XML);
    const original = await b.exportar();
    const panel = montar(b.modelador);
    b.clic('Task_1');
    expect(panel.textContent).toContain(T.ninguno(T.categorias.task));

    definirRiesgo(panel);
    expect(dialogo()).toBeNull();
    const campo = panel.querySelector('select[aria-label="Risk"]') as HTMLSelectElement;
    expect([...campo.options].map((o) => o.value)).toEqual(['', 'Low', 'High']);

    elegir(campo, 'High');
    let xml = await b.exportar();
    expect((await readAnnotations(xml)).Task_1).toEqual({ attributes: [{ ref: expect.stringMatching(/^Attr_/), value: 'High' }] });
    expect((await readAnnotations(xml)).Proc_1?.attributeDefinitions).toEqual([
      { id: expect.stringMatching(/^Attr_/), name: 'Risk', type: 'list', appliesTo: 'task', options: ['Low', 'High'] },
    ]);

    b.deshacer();
    expect((panel.querySelector('select[aria-label="Risk"]') as HTMLSelectElement).value).toBe('');
    xml = await b.exportar();
    expect((await readAnnotations(xml)).Task_1).toBeUndefined();
    expect(xml).toContain('lila:attributeDefinition');

    b.deshacer();
    expect(panel.querySelector('select[aria-label="Risk"]')).toBeNull();
    expect(await b.exportar()).toBe(original);

    b.rehacer();
    b.rehacer();
    expect((panel.querySelector('select[aria-label="Risk"]') as HTMLSelectElement).value).toBe('High');
  });

  it('only tasks get a task attribute; the process and events do not', async () => {
    const b = await banco(XML);
    const panel = montar(b.modelador);
    b.clic('Task_1');
    definirRiesgo(panel);
    b.clic('Start_1');
    expect(panel.querySelector('select[aria-label="Risk"]')).toBeNull();
    expect(panel.textContent).toContain(T.ninguno(T.categorias.event));
    b.clic('Task_2');
    expect(panel.querySelector('select[aria-label="Risk"]')).not.toBeNull();
  });

  it('a number is written on blur or Enter, and only if it fits: «24,5» never leaves «24» behind (QA 4 of #513)', async () => {
    const b = await banco(XML);
    const panel = montar(b.modelador);
    b.clic('Task_1');
    pulsar(boton(panel, T.definir));
    const d = dialogo()!;
    pulsar(boton(d, T.anadir));
    // «Add attribute» puts the focus on the new name.
    expect(document.activeElement).toBe(d.querySelector(`[aria-label="${T.nombre(1)}"]`));
    escribir(d.querySelector(`[aria-label="${T.nombre(1)}"]`), 'SLA');
    elegir(d.querySelector(`[aria-label="${T.tipo(1)}"]`), 'number');
    escribir(d.querySelector(`[aria-label="${T.valorPorDefecto(1)}"]`), 'ten');
    pulsar(boton(d, T.guardar));
    // A default that does not fit its type blocks the save, with the reason.
    expect(dialogo()?.textContent).toContain(T.errores.porDefecto('SLA'));
    escribir(d.querySelector(`[aria-label="${T.valorPorDefecto(1)}"]`), '10');
    pulsar(boton(d, T.guardar));
    expect(dialogo()).toBeNull();

    const sla = (): HTMLInputElement => panel.querySelector('input[aria-label="SLA"]') as HTMLInputElement;
    expect(sla().placeholder).toBe(T.porDefecto('10'));
    // Typed key by key, as a Spanish keyboard does it: no keystroke writes anything.
    for (const texto of ['2', '24', '24,', '24,5']) escribir(sla(), texto);
    expect(await b.exportar()).not.toContain('lila:attributeValue');
    expect(sla().getAttribute('aria-invalid')).toBe('true');
    expect(panel.querySelector('[role="alert"]')?.textContent).toBe(T.problemas.number);
    act(() => sla().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    // Still not written, still explained.
    expect(await b.exportar()).not.toContain('lila:attributeValue');
    expect(sla().value).toBe('24,5');
    expect(panel.querySelector('[role="alert"]')?.textContent).toBe(T.problemas.number);

    escribir(sla(), '24.5');
    expect(await b.exportar()).not.toContain('lila:attributeValue');
    act(() => sla().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(panel.querySelector('[role="alert"]')).toBeNull();
    expect(await b.exportar()).toContain('value="24.5"');
    // One step for the value: ⌘Z takes it back whole.
    b.deshacer();
    expect(await b.exportar()).not.toContain('lila:attributeValue');
  });

  it('renaming asks; removing an option names it, and «clear» clears only the values that no longer fit, in one ⌘Z', async () => {
    const b = await banco(XML);
    const panel = montar(b.modelador);
    b.clic('Task_1');
    definirRiesgo(panel);
    elegir(panel.querySelector('select[aria-label="Risk"]'), 'Low');
    b.clic('Task_2');
    elegir(panel.querySelector('select[aria-label="Risk"]'), 'High');

    // Rename only: it asks, every value still fits, so there is nothing to choose.
    pulsar(boton(panel, T.definir));
    let d = dialogo()!;
    escribir(d.querySelector(`[aria-label="${T.nombre(1)}"]`), 'Risk level');
    pulsar(boton(d, T.guardar));
    expect(d.textContent).toContain(T.renombrado('Risk', 'Risk level'));
    expect(d.textContent).toContain(T.conValores(2, 0));
    expect(d.querySelector('input[type="radio"]')).toBeNull();
    pulsar(boton(d, T.aplicar));
    expect((panel.querySelector('select[aria-label="Risk level"]') as HTMLSelectElement).value).toBe('High');

    // Drop «High» and rename again: the option is named, and clearing takes only the misfit.
    pulsar(boton(panel, T.definir));
    d = dialogo()!;
    escribir(d.querySelector(`[aria-label="${T.nombre(1)}"]`), 'Risk 2');
    escribir(d.querySelector(`[aria-label="${T.opciones(1)}"]`), 'Low\nMedium');
    pulsar(boton(d, T.guardar));
    expect(d.textContent).toContain(T.opcionesQuitadas('High'));
    expect(d.textContent).toContain(T.conValores(2, 1));
    const limpiar = [...d.querySelectorAll('label')].find((l) => l.textContent === T.limpiar(1))!.querySelector('input')!;
    act(() => limpiar.click());
    pulsar(boton(d, T.aplicar));
    expect((panel.querySelector('select[aria-label="Risk 2"]') as HTMLSelectElement).value).toBe('');
    b.clic('Task_1');
    expect((panel.querySelector('select[aria-label="Risk 2"]') as HTMLSelectElement).value).toBe('Low');
    expect((await b.exportar()).match(/<lila:attributeValue/g)).toHaveLength(1);

    b.deshacer();
    expect((panel.querySelector('select[aria-label="Risk level"]') as HTMLSelectElement).value).toBe('Low');
    expect((await b.exportar()).match(/<lila:attributeValue/g)).toHaveLength(2);
  });

  it('saving the dialog with no change creates no undo step and changes nothing (QA 7 of #513)', async () => {
    const b = await banco(XML);
    const panel = montar(b.modelador);
    b.clic('Task_1');
    definirRiesgo(panel);
    const antes = await b.exportar();
    const cambios = b.cambios();
    pulsar(boton(panel, T.definir));
    pulsar(boton(dialogo()!, T.guardar));
    expect(dialogo()).toBeNull();
    expect(b.cambios()).toBe(cambios);
    expect(await b.exportar()).toBe(antes);
  });

  it('deleting an attribute with values asks first, and «Back» loses nothing', async () => {
    const b = await banco(XML);
    const panel = montar(b.modelador);
    b.clic('Task_1');
    definirRiesgo(panel);
    elegir(panel.querySelector('select[aria-label="Risk"]'), 'Low');
    const antes = await b.exportar();

    pulsar(boton(panel, T.definir));
    const d = dialogo()!;
    pulsar(d.querySelector(`[aria-label="${T.quitar(1)}"]`) as HTMLButtonElement);
    pulsar(boton(d, T.guardar));
    expect(d.textContent).toContain(T.borrado('Risk', 1));
    pulsar(boton(d, T.volver));
    pulsar(boton(d, T.cancelar));
    expect(await b.exportar()).toBe(antes);

    pulsar(boton(panel, T.definir));
    const otra = dialogo()!;
    pulsar(otra.querySelector(`[aria-label="${T.quitar(1)}"]`) as HTMLButtonElement);
    pulsar(boton(otra, T.guardar));
    pulsar(boton(otra, T.aplicar));
    const xml = await b.exportar();
    expect(xml).not.toContain('lila:attribute');
    expect(xml).not.toContain('extensionElements');
  });

  it('(b) looking at a model without attributes changes nothing: byte-identical export', async () => {
    const b = await banco(XML);
    const antes = await b.exportar();
    const panel = montar(b.modelador);
    for (const id of ['Task_1', 'Start_1', 'Proc_1', 'Task_2']) b.clic(id);
    expect(panel.textContent).toContain(T.titulo);
    expect(await b.exportar()).toBe(antes);
  });

  it('(c) what the panel writes imports into bpmn-js without the lila descriptor, with no warnings', async () => {
    const b = await banco(XML);
    const panel = montar(b.modelador);
    b.clic('Task_1');
    definirRiesgo(panel);
    elegir(panel.querySelector('select[aria-label="Risk"]'), 'High');
    const xml = await b.exportar();

    const container = document.createElement('div');
    document.body.append(container);
    const moddle = new Modeler({ container }).get('moddle') as Moddle;
    const { rootElement, warnings } = await moddle.fromXML(xml, 'bpmn:Definitions');
    expect(warnings).toEqual([]);
    const reescrito = (await moddle.toXML(rootElement, { format: true })).xml;
    expect(reescrito).toContain('<lila:attributeValue ref="');
    expect((await readAnnotations(reescrito)).Task_1?.attributes?.[0]?.value).toBe('High');
    container.remove();
  });
});
