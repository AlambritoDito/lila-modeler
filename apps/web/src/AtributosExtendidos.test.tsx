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
import BpmnFactory from 'bpmn-js/lib/features/modeling/BpmnFactory';
import { Ids } from 'ids';
import ModdleCopy from 'bpmn-js/lib/features/copy-paste/ModdleCopy';
import { GuardiaAtributos } from './atributos';
import { confirmarEdicionEnCurso, hayBorradorPendiente } from './edicionEnCurso';
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

const LILA_NS = 'xmlns:lila="https://lila-modeler.org/schema/bpmn/1"';
const DEF_SLA = '<lila:attributeDefinition id="Attr_sla" name="SLA" type="text" appliesTo="task" />';

describe('where the definitions live (QA 1, 2 and 5 of #513)', () => {
  it('inside a drilled-down sub-process a task sees and edits the top-level attributes; new ones go to the process', async () => {
    const xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ${LILA_NS} id="D" targetNamespace="urn:t">
      <bpmn:process id="Proc_1"><bpmn:extensionElements>${DEF_SLA}</bpmn:extensionElements>
        <bpmn:subProcess id="Sub_1"><bpmn:task id="Task_In" name="Dentro" /></bpmn:subProcess>
      </bpmn:process></bpmn:definitions>`;
    // The canvas root after a drill-down is the collapsed sub-process itself.
    const b = await banco(xml, 'Sub_1');
    const panel = montar(b.modelador);
    b.clic('Task_In');
    escribir(panel.querySelector('input[aria-label="SLA"]'), '4 h');

    pulsar(boton(panel, T.definir));
    const d = dialogo()!;
    expect(d.querySelector<HTMLInputElement>(`[aria-label="${T.nombre(1)}"]`)?.value).toBe('SLA');
    pulsar(boton(d, T.anadir));
    escribir(d.querySelector(`[aria-label="${T.nombre(2)}"]`), 'Owner');
    pulsar(boton(d, T.guardar));

    const notas = await readAnnotations(await b.exportar());
    expect(notas.Task_In?.attributes).toEqual([{ ref: 'Attr_sla', value: '4 h' }]);
    expect(notas.Proc_1?.attributeDefinitions?.map((a) => a.name)).toEqual(['SLA', 'Owner']);
    expect(notas.Sub_1).toBeUndefined();
  });

  const TRES_POOLS = (enProcA: string, enProcB = '') => `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ${LILA_NS} id="D" targetNamespace="urn:t">
    <bpmn:collaboration id="Collab">
      <bpmn:participant id="P_A" processRef="Proc_A" /><bpmn:participant id="P_B" processRef="Proc_B" /><bpmn:participant id="P_C" processRef="Proc_C" />
    </bpmn:collaboration>
    <bpmn:process id="Proc_A">${enProcA === '' ? '' : `<bpmn:extensionElements>${enProcA}</bpmn:extensionElements>`}<bpmn:task id="Task_A" /></bpmn:process>
    <bpmn:process id="Proc_B">${enProcB === '' ? '' : `<bpmn:extensionElements>${enProcB}</bpmn:extensionElements>`}<bpmn:task id="Task_B"><bpmn:extensionElements><lila:attributeValue ref="Attr_sla" value="48" /></bpmn:extensionElements></bpmn:task></bpmn:process>
    <bpmn:process id="Proc_C"><bpmn:task id="Task_C" /></bpmn:process>
  </bpmn:definitions>`;

  it('with three pools, new definitions go to the collaboration, and one written on a pool process moves there on save', async () => {
    const b = await banco(TRES_POOLS(DEF_SLA), 'Collab');
    const panel = montar(b.modelador);
    b.clic('Task_B');
    expect((panel.querySelector('input[aria-label="SLA"]') as HTMLInputElement).value).toBe('48');
    // Nothing edited, but a definition is out of place: saving tidies it up.
    pulsar(boton(panel, T.definir));
    pulsar(boton(dialogo()!, T.guardar));
    const notas = await readAnnotations(await b.exportar());
    expect(notas.Collab?.attributeDefinitions?.map((a) => a.id)).toEqual(['Attr_sla']);
    expect(notas.Proc_A).toBeUndefined();
    expect(notas.Task_B?.attributes).toEqual([{ ref: 'Attr_sla', value: '48' }]);
  });

  it('a definition repeated on two pool processes shows once, with a notice, and saving keeps one', async () => {
    const b = await banco(TRES_POOLS(DEF_SLA, DEF_SLA.replace('name="SLA"', 'name="SLA copy"')), 'Collab');
    const panel = montar(b.modelador);
    b.clic('Task_B');
    expect(panel.querySelectorAll('input[aria-label="SLA"]')).toHaveLength(1);
    expect(panel.querySelector('input[aria-label="SLA copy"]')).toBeNull();
    expect(panel.textContent).toContain(T.repetidas(1));
    pulsar(boton(panel, T.definir));
    pulsar(boton(dialogo()!, T.guardar));
    expect((await b.exportar()).match(/<lila:attributeDefinition/g)).toHaveLength(1);
  });

  /** A `shape.delete` that does to the moddle what bpmn-js does when a pool goes (`BpmnUpdater`). */
  function borrarPool(b: Awaited<ReturnType<typeof banco>>): (id: string) => void {
    new GuardiaAtributos(b.eventBus as never, b.escritor.modeling, b.escritor.bpmnFactory);
    const raices = b.definitions.rootElements!;
    const collab = b.figura('Collab');
    b.commandStack.register('shape.delete', {
      execute: (ctx: { shape: ElementoLienzo; antes?: [number, number] }) => {
        const bo = ctx.shape.businessObject as unknown as ModdleElement;
        const participantes = (collab.businessObject as unknown as ModdleElement).participants!;
        ctx.antes = [participantes.indexOf(bo), raices.indexOf(bo.processRef!)];
        participantes.splice(ctx.antes[0], 1);
        raices.splice(ctx.antes[1], 1);
        return [];
      },
      revert: (ctx: { shape: ElementoLienzo; antes: [number, number] }) => {
        const bo = ctx.shape.businessObject as unknown as ModdleElement;
        raices.splice(ctx.antes[1], 0, bo.processRef!);
        (collab.businessObject as unknown as ModdleElement).participants!.splice(ctx.antes[0], 0, bo);
        return [];
      },
    } as never);
    return (id) => act(() => b.commandStack.execute('shape.delete', { shape: { ...b.figura(id), parent: collab } }));
  }

  it('deleting the pool whose process held the definitions keeps them, in the collaboration, and ⌘Z undoes it whole', async () => {
    const b = await banco(TRES_POOLS(DEF_SLA), 'Collab');
    const antes = await b.exportar();
    borrarPool(b)('P_A');
    const notas = await readAnnotations(await b.exportar());
    expect(notas.Collab?.attributeDefinitions?.map((a) => a.id)).toEqual(['Attr_sla']);
    expect(notas.Task_A).toBeUndefined();
    const panel = montar(b.modelador);
    b.clic('Task_B');
    expect((panel.querySelector('input[aria-label="SLA"]') as HTMLInputElement).value).toBe('48');
    b.deshacer();
    expect(await b.exportar()).toBe(antes);
  });

  it('deleting any pool of three leaves the collaboration\'s definitions alone', async () => {
    const b = await banco(TRES_POOLS(''), 'Collab');
    const panel = montar(b.modelador);
    b.clic('Task_C');
    pulsar(boton(panel, T.definir));
    pulsar(boton(dialogo()!, T.anadir));
    escribir(dialogo()!.querySelector(`[aria-label="${T.nombre(1)}"]`), 'SLA');
    pulsar(boton(dialogo()!, T.guardar));
    const borrar = borrarPool(b);
    borrar('P_A');
    borrar('P_C');
    const notas = await readAnnotations(await b.exportar());
    expect(notas.Collab?.attributeDefinitions?.map((a) => a.name)).toEqual(['SLA']);
  });

  it('copying a pool\'s process never copies definitions (a paste would repeat every id)', async () => {
    const b = await banco(TRES_POOLS(`${DEF_SLA}<lila:versionTag value="2" />`), 'Collab');
    new GuardiaAtributos(b.eventBus as never, b.escritor.modeling, b.escritor.bpmnFactory);
    // What `BaseModeler` gives the moddle: the id registry the copy claims new ids from.
    (b.moddle as unknown as { ids: unknown }).ids = new Ids([32, 36, 1]);
    const factory = new BpmnFactory(b.moddle as never);
    const copia = new ModdleCopy(b.eventBus as never, factory, b.moddle as never)
      .copyElement(b.figura('Proc_A').businessObject as never, b.moddle.create('bpmn:Process', { id: 'Proc_Copia' }) as never) as unknown as ModdleElement;
    expect(copia.extensionElements?.values?.map((v) => v.$type)).toEqual(['lila:VersionTag']);
  });

  it('turning a process diagram into a collaboration (first pool) takes the definitions along, in one ⌘Z', async () => {
    const xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" ${LILA_NS} id="D" targetNamespace="urn:t">
      <bpmn:process id="Proc_1"><bpmn:extensionElements>${DEF_SLA}</bpmn:extensionElements><bpmn:task id="Task_1" /></bpmn:process></bpmn:definitions>`;
    const b = await banco(xml);
    new GuardiaAtributos(b.eventBus as never, b.escritor.modeling, b.escritor.bpmnFactory);
    const antes = await b.exportar();
    const raices = b.definitions.rootElements!;
    let actual: ElementoLienzo = b.figura('Proc_1');
    // What `UpdateCanvasRootHandler` does to the moddle.
    b.commandStack.register('canvas.updateRoot', {
      execute: (ctx: { newRoot: ElementoLienzo; oldRoot?: ElementoLienzo }) => {
        ctx.oldRoot = actual;
        raices.push(ctx.newRoot.businessObject as unknown as ModdleElement);
        raices.splice(raices.indexOf(actual.businessObject as unknown as ModdleElement), 1);
        actual = ctx.newRoot;
        return [];
      },
      revert: (ctx: { newRoot: ElementoLienzo; oldRoot: ElementoLienzo }) => {
        raices.splice(raices.indexOf(ctx.newRoot.businessObject as unknown as ModdleElement), 1, ctx.oldRoot.businessObject as unknown as ModdleElement);
        actual = ctx.oldRoot;
        return [];
      },
    } as never);
    const collab = b.moddle.create('bpmn:Collaboration', { id: 'Collab' });
    collab.$parent = b.definitions;
    act(() => b.commandStack.execute('canvas.updateRoot', { newRoot: { id: 'Collab', type: 'bpmn:Collaboration', businessObject: collab } }));
    // The process stays as the new pool's process in bpmn-js; here it is enough that it lost them.
    raices.push(b.figura('Proc_1').businessObject as unknown as ModdleElement);
    const notas = await readAnnotations(await b.exportar());
    expect(notas.Collab?.attributeDefinitions?.map((a) => a.id)).toEqual(['Attr_sla']);
    expect(notas.Proc_1).toBeUndefined();
    raices.pop();
    b.deshacer();
    expect(await b.exportar()).toBe(antes);
  });
});

describe('a number still being typed is not lost (second QA pass of #513)', () => {
  /** Defines a number attribute «SLA» for tasks and returns the panel. */
  async function conSla() {
    const b = await banco(XML);
    const panel = montar(b.modelador);
    b.clic('Task_1');
    pulsar(boton(panel, T.definir));
    const d = dialogo()!;
    pulsar(boton(d, T.anadir));
    escribir(d.querySelector(`[aria-label="${T.nombre(1)}"]`), 'SLA');
    elegir(d.querySelector(`[aria-label="${T.tipo(1)}"]`), 'number');
    pulsar(boton(d, T.guardar));
    const campo = panel.querySelector('input[aria-label="SLA"]') as HTMLInputElement;
    act(() => campo.focus());
    return { b, panel, campo };
  }

  it('12 typed with no blur is in the XML that saving writes', async () => {
    const { b, campo } = await conSla();
    escribir(campo, '12');
    expect(document.activeElement).toBe(campo);
    // What ⌘S, the exports, Run and the close guard do before reading the model.
    act(() => confirmarEdicionEnCurso());
    expect(await b.exportar()).toContain('<lila:attributeValue ref="');
    expect(await b.exportar()).toContain('value="12"');
  });

  it('99 pending when the selection changes by code (no blur) is written to the element it was typed on', async () => {
    const { b, campo } = await conSla();
    escribir(campo, '99');
    b.clic('Task_2');
    const notas = await readAnnotations(await b.exportar());
    expect(notas.Task_1?.attributes?.map((a) => a.value)).toEqual(['99']);
    expect(notas.Task_2).toBeUndefined();
  });

  it('a valid draft not yet in the model makes the project unsaved; Esc or an invalid draft does not', async () => {
    const { b, campo } = await conSla();
    expect(hayBorradorPendiente()).toBe(false);
    escribir(campo, '12');
    // What App reads into `dirty`, so ⌘Q asks «save/discard» and saving commits it.
    expect(hayBorradorPendiente()).toBe(true);
    act(() => campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(campo.value).toBe('');
    expect(hayBorradorPendiente()).toBe(false);
    escribir(campo, '12,');
    expect(hayBorradorPendiente()).toBe(false);
    escribir(campo, '12');
    expect(hayBorradorPendiente()).toBe(true);
    act(() => confirmarEdicionEnCurso());
    expect(hayBorradorPendiente()).toBe(false);
    expect(await b.exportar()).toContain('value="12"');
    // Back to the stored value by hand: nothing pending, nothing forced dirty.
    act(() => campo.focus());
    escribir(campo, '13');
    escribir(campo, '12');
    expect(hayBorradorPendiente()).toBe(false);
  });

  it('a field unmounted with a pending draft leaves nothing pending behind', async () => {
    const { b, campo } = await conSla();
    escribir(campo, '5');
    b.clic('Task_2');
    expect(hayBorradorPendiente()).toBe(false);
  });

  it('an invalid draft is dropped when the field goes away: the model keeps its last valid value', async () => {
    const { b, campo } = await conSla();
    escribir(campo, '7');
    act(() => confirmarEdicionEnCurso());
    act(() => campo.focus());
    escribir(campo, '7,5');
    b.clic('Task_2');
    expect((await readAnnotations(await b.exportar())).Task_1?.attributes?.map((a) => a.value)).toEqual(['7']);
  });
});
