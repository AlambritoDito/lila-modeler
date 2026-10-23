// @vitest-environment jsdom
/**
 * The catalog pickers of the properties panel (#93): `PanelPropiedades` mounted with a catalog,
 * over real bpmn-moddle and a real diagram-js `CommandStack` with bpmn-js's
 * `UpdateModdlePropertiesHandler`, so ⌘Z/⌘⇧Z on the reference are the canvas's own. The catalog
 * side is a small harness that does what `App.tsx` does with the pure units: the #672 operations,
 * the version 3 confirmation (`catalogUpgrade.ts`) and the one-level undo (`catalogUndo.ts`).
 *
 * The fixture is synthetic (`docs/EXAMPLES_POLICY.md`): a front desk with two tasks.
 */
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';
import UpdateModdlePropertiesHandler from 'bpmn-js/lib/features/modeling/cmd/UpdateModdlePropertiesHandler';
import CommandStack from 'diagram-js/lib/command/CommandStack';
import EventBus from 'diagram-js/lib/core/EventBus';
import Selection from 'diagram-js/lib/features/selection/Selection';
import {
  adoptReference,
  createCatalogObject,
  formatVersionOf,
  updateCatalogObject,
  type CatalogObject,
  type CatalogOperationResult,
  type ProjectDocument,
} from '@lila-modeler/engine/project';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import lila from '../../../packages/engine/src/bpmn/lila.moddle.json' with { type: 'json' };
import { confirmUpgrade } from './catalogUpgrade';
import { recordCatalogChange, undoCatalogChange, type CatalogUndoEntry } from './catalogUndo';
import { setLocale } from './i18n';
import type { Modelador, Servicios } from './Modeler.js';
import { leerExtensiones, PanelPropiedades, type ElementoLienzo, type ElementoModdle, type Escritor } from './PropertiesPanel.js';
import type { CatalogoPanel } from './SelectorCatalogo';
import { en as T } from './strings.en';
import { es as ES } from './strings.es';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="D" targetNamespace="urn:test">
  <bpmn:process id="Process_Front">
    <bpmn:task id="Task_Receive" name="Receive guest">
      <bpmn:extensionElements><lila:responsibility type="R" /></bpmn:extensionElements>
    </bpmn:task>
    <bpmn:task id="Task_Charge" name="Charge">
      <bpmn:extensionElements>
        <lila:responsibility type="R" roleRef="cajero" />
        <lila:responsibility type="A" roleRef="Head Cashier" />
        <lila:systemRef ref="sys-pms" />
        <lila:riskRef ref="risk-x" />
      </bpmn:extensionElements>
    </bpmn:task>
  </bpmn:process>
</bpmn:definitions>`;

const RECEPCIONISTA: CatalogObject = { type: 'role', id: 'role-rec', name: 'Receptionist', revision: 1 };

function* recorrer(el: ModdleElement): Generator<ModdleElement> {
  if (typeof el.id === 'string') yield el;
  for (const hijo of [...(el.rootElements ?? []), ...(el.flowElements ?? [])]) yield* recorrer(hijo);
}

interface Banco {
  modelador: Modelador;
  clic(id: string): void;
  figura(id: string): ElementoLienzo;
  commandStack: CommandStack;
  exportar(): Promise<string>;
}

async function banco(): Promise<Banco> {
  const moddle = BpmnModdle({ lila });
  const { rootElement: definitions } = await moddle.fromXML(XML);
  const eventBus = new EventBus();
  const proceso = (definitions.rootElements ?? [])[0]!;
  const raiz = { id: proceso.id as string, type: proceso.$type as string, businessObject: proceso as unknown as ElementoModdle };
  const selection = new Selection(eventBus, { getRootElement: () => raiz, findRoot: () => raiz } as never);
  const commandStack = new CommandStack(eventBus, { get: () => undefined } as never);
  commandStack.register('element.updateModdleProperties', new UpdateModdlePropertiesHandler({ filter: () => [] } as never));
  const figuras = new Map<string, ElementoLienzo>();
  for (const el of recorrer(definitions)) figuras.set(el.id as string, { id: el.id as string, type: el.$type as string, businessObject: el as unknown as ElementoModdle });
  const figura = (id: string): ElementoLienzo => figuras.get(id)!;
  const escritor: Escritor = {
    modeling: {
      updateProperties: () => { throw new Error('the pickers only write lila: children'); },
      updateModdleProperties: (element, moddleElement, properties) => {
        commandStack.execute('element.updateModdleProperties', { element, moddleElement, properties });
      },
    },
    bpmnFactory: { create: (tipo, atributos) => moddle.create(tipo, atributos) as ElementoModdle },
  };
  const elementRegistry: Servicios['elementRegistry'] = { filter: (prueba) => [...figuras.values()].map((f) => ({ type: f.type, parent: {} })).filter(prueba) };
  const modelador = {
    abrir: () => Promise.resolve(true),
    exportar: async () => (await moddle.toXML(definitions, { format: true })).xml,
    ajustar: () => undefined,
    servicios: { ...escritor, selection, rootElement: () => raiz, elementRegistry },
    suscribir: (eventos: string[], escuchar: () => void) => {
      eventBus.on(eventos, escuchar);
      return () => { eventBus.off(eventos, escuchar); };
    },
  } as unknown as Modelador;
  return {
    modelador,
    figura,
    commandStack,
    clic: (id) => { act(() => { selection.select([figura(id)] as never); }); },
    exportar: modelador.exportar,
  };
}

/** What the harness exposes to the test: the document, and the undo command. */
interface Estado {
  doc: ProjectDocument;
  deshacer: () => void;
  puedeDeshacer: boolean;
  fijar: (doc: ProjectDocument) => void;
}

/**
 * Mounts the panel's documentation tab with a catalog kept the way `App.tsx` keeps it: each
 * operation asks `preguntar` when it upgrades the document, and registers its undo snapshot.
 */
function montar(modelador: Modelador, inicial: ProjectDocument, preguntar: (q: { appVersion: string }) => Promise<boolean>): { contenedor: HTMLElement; estado: () => Estado } {
  const contenedor = document.createElement('div');
  document.body.append(contenedor);
  const raizReact = createRoot(contenedor);
  let ultimo!: Estado;
  function Arnes(): React.JSX.Element {
    const [doc, setDoc] = useState(inicial);
    const [entrada, setEntrada] = useState<CatalogUndoEntry | null>(null);
    async function cambiar(operar: (d: ProjectDocument) => CatalogOperationResult | Promise<CatalogOperationResult>): Promise<CatalogObject | null> {
      const resultado = await confirmUpgrade(await operar(doc), '1.0.0-beta.30', preguntar);
      if (resultado === null) return null;
      setDoc(resultado.document);
      setEntrada(recordCatalogChange(doc, resultado));
      return resultado.object;
    }
    const catalogo: CatalogoPanel = {
      objetos: doc.catalog ?? [],
      conCatalogo: formatVersionOf(doc) === 3,
      crear: (tipo, nombre) => cambiar((d) => createCatalogObject(d, { type: tipo, name: nombre })),
      adoptar: (tipo, id) => cambiar((d) => adoptReference(d, { type: tipo, ref: id })),
    };
    ultimo = {
      doc,
      puedeDeshacer: entrada !== null,
      deshacer: () => { if (entrada !== null) { setDoc(undoCatalogChange(doc, entrada)); setEntrada(null); } },
      fijar: setDoc,
    };
    return <PanelPropiedades modelador={modelador} pestana="documentacion" catalogo={catalogo} />;
  }
  act(() => { raizReact.render(<Arnes />); });
  desmontar.push(() => { act(() => { raizReact.unmount(); }); contenedor.remove(); });
  return { contenedor, estado: () => ultimo };
}

const desmontar: Array<() => void> = [];
beforeEach(() => { setLocale('en'); });
afterEach(() => { for (const d of desmontar.splice(0)) d(); });

const V1: ProjectDocument = { version: 1, id: 'p', name: 'Front office', model: { id: 'Process_Front', name: 'model.bpmn', xml: '', revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [] };
const V3: ProjectDocument = { ...V1, formatVersion: 3, catalog: [RECEPCIONISTA] };

const campo = (raiz: HTMLElement, etiqueta: string): HTMLInputElement => {
  const encontrado = raiz.querySelector(`input[aria-label="${etiqueta}"]`);
  if (!(encontrado instanceof HTMLInputElement)) throw new Error(`no field «${etiqueta}»`);
  return encontrado;
};
function teclear(input: HTMLInputElement, texto: string): void {
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, texto);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function tecla(input: HTMLInputElement, key: string): void {
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
}
const filas = (raiz: HTMLElement): string[] => [...raiz.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? '');
async function elegirFila(raiz: HTMLElement, texto: string): Promise<void> {
  const fila = [...raiz.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === texto);
  expect(fila, texto).toBeDefined();
  await act(async () => { fila!.click(); });
}
const roles = (b: Banco, id: string): Array<string | undefined> => leerExtensiones(b.figura(id), 'lila:Responsibility').map((r) => r.roleRef);
const nunca = vi.fn().mockRejectedValue(new Error('no question expected'));

describe('catalog pickers in the properties panel (#93)', () => {
  it('choosing «Receptionist» writes its id; the field shows the name', async () => {
    const b = await banco();
    const { contenedor } = montar(b.modelador, V3, nunca);
    b.clic('Task_Receive');
    const rol = campo(contenedor, T.propiedades.rol(1));
    expect(rol.getAttribute('role')).toBe('combobox');
    expect(rol.value).toBe('');
    expect(rol.placeholder).toBe(T.catalogo.pista.role);

    teclear(rol, 'rece');
    // «rece» is no object's name, so creating it is offered after the matches.
    expect(filas(contenedor)).toEqual(['Receptionist', T.catalogo.crear('rece')]);
    // Typing filters, it does not write.
    expect(roles(b, 'Task_Receive')).toEqual([undefined]);
    await elegirFila(contenedor, 'Receptionist');
    expect(roles(b, 'Task_Receive')).toEqual(['role-rec']);
    expect(campo(contenedor, T.propiedades.rol(1)).value).toBe('Receptionist');
    expect(await b.exportar()).toContain('roleRef="role-rec"');
  });

  it('after a rename the field shows the new name; the BPMN is not touched', async () => {
    const b = await banco();
    const { contenedor, estado } = montar(b.modelador, V3, nunca);
    b.clic('Task_Receive');
    teclear(campo(contenedor, T.propiedades.rol(1)), 'Receptionist');
    tecla(campo(contenedor, T.propiedades.rol(1)), 'Enter');
    const antes = await b.exportar();

    const renombrado = updateCatalogObject(estado().doc, { id: 'role-rec', baseRevision: 1, name: 'Front desk agent' }).document;
    act(() => { estado().fijar(renombrado); });
    expect(campo(contenedor, T.propiedades.rol(1)).value).toBe('Front desk agent');
    expect(await b.exportar()).toBe(antes);
  });

  it('a value not in the catalog is kept and shown with its id; Adopt creates the role and the XML is unchanged', async () => {
    const b = await banco();
    const { contenedor, estado } = montar(b.modelador, V3, nunca);
    b.clic('Task_Charge');
    const rol = campo(contenedor, T.propiedades.rol(1));
    expect(rol.value).toBe('cajero — not in catalog');
    expect(rol.classList.contains('no-resuelto')).toBe(true);
    const antes = await b.exportar();

    const adoptar = contenedor.querySelector<HTMLButtonElement>(`button[aria-label="${T.catalogo.adoptarDe(T.propiedades.rol(1), 'cajero')}"]`);
    expect(adoptar?.textContent).toBe(T.catalogo.adoptar);
    await act(async () => { adoptar!.click(); });
    expect(estado().doc.catalog).toContainEqual({ type: 'role', id: 'cajero', name: 'cajero', revision: 1 });
    expect(campo(contenedor, T.propiedades.rol(1)).value).toBe('cajero');
    expect(campo(contenedor, T.propiedades.rol(1)).classList.contains('no-resuelto')).toBe(false);
    expect(await b.exportar()).toBe(antes);
  });

  it('a value that is not an adoptable id gets no Adopt, only a note, and stays as it is', async () => {
    const b = await banco();
    const { contenedor } = montar(b.modelador, V3, nunca);
    b.clic('Task_Charge');
    expect(campo(contenedor, T.propiedades.rol(2)).value).toBe('Head Cashier — not in catalog');
    expect(contenedor.querySelector(`button[aria-label="${T.catalogo.adoptarDe(T.propiedades.rol(2), 'Head Cashier')}"]`)).toBeNull();
    expect(contenedor.textContent).toContain(T.catalogo.noAdoptable('Head Cashier'));
    expect(roles(b, 'Task_Charge')).toEqual(['cajero', 'Head Cashier']);
  });

  it('a version 1 or 2 project shows its typed ids without warnings (RM-01 § 3.4), and still offers Adopt', async () => {
    const b = await banco();
    const { contenedor } = montar(b.modelador, V1, nunca);
    b.clic('Task_Charge');
    expect(campo(contenedor, T.propiedades.rol(1)).value).toBe('cajero');
    expect(campo(contenedor, T.propiedades.rol(1)).classList.contains('no-resuelto')).toBe(false);
    expect(campo(contenedor, T.propiedades.rol(2)).value).toBe('Head Cashier');
    expect(contenedor.textContent).not.toContain(T.catalogo.noAdoptable('Head Cashier'));
    expect(contenedor.textContent).not.toContain('not in catalog');
    expect(contenedor.querySelector(`button[aria-label="${T.catalogo.adoptarDe(T.propiedades.rol(1), 'cajero')}"]`)).not.toBeNull();
  });

  it('on a version 1 or 2 project the first «Create» asks; Cancel changes nothing; Confirm creates and selects; the second does not ask', async () => {
    const b = await banco();
    const preguntar = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const { contenedor, estado } = montar(b.modelador, V1, preguntar);
    b.clic('Task_Receive');
    const antes = await b.exportar();

    teclear(campo(contenedor, T.propiedades.rol(1)), 'Receptionist');
    expect(filas(contenedor)).toEqual([T.catalogo.crear('Receptionist')]);
    await elegirFila(contenedor, T.catalogo.crear('Receptionist'));
    expect(preguntar).toHaveBeenCalledTimes(1);
    expect(estado().doc).toBe(V1);
    expect(await b.exportar()).toBe(antes);
    expect(b.commandStack.canUndo()).toBe(false);

    teclear(campo(contenedor, T.propiedades.rol(1)), 'Receptionist');
    await elegirFila(contenedor, T.catalogo.crear('Receptionist'));
    expect(preguntar).toHaveBeenCalledTimes(2);
    expect(estado().doc.formatVersion).toBe(3);
    const creado = estado().doc.catalog!.find((o) => o.name === 'Receptionist')!;
    expect(creado.id).toMatch(/^role-[0-9a-z]{12}$/);
    expect(roles(b, 'Task_Receive')).toEqual([creado.id]);

    b.clic('Task_Charge');
    teclear(campo(contenedor, T.propiedades.rol(1)), 'Temp');
    await elegirFila(contenedor, T.catalogo.crear('Temp'));
    expect(preguntar).toHaveBeenCalledTimes(2);
    expect(estado().doc.catalog!.map((o) => o.name).sort()).toEqual(['Receptionist', 'Temp']);
  });

  it('«Undo last catalog change» after a create removes the object, keeps version 3 and the reference, and leaves the canvas undo alone', async () => {
    const b = await banco();
    const { contenedor, estado } = montar(b.modelador, { ...V1, formatVersion: 3, catalog: [] }, nunca);
    b.clic('Task_Receive');
    teclear(campo(contenedor, T.propiedades.rol(1)), 'Temp');
    await elegirFila(contenedor, T.catalogo.crear('Temp'));
    const temp = estado().doc.catalog![0]!;
    expect(roles(b, 'Task_Receive')).toEqual([temp.id]);
    expect(estado().puedeDeshacer).toBe(true);

    act(() => { estado().deshacer(); });
    expect(estado().doc.catalog).toEqual([]);
    expect(estado().doc.formatVersion).toBe(3);
    expect(estado().puedeDeshacer).toBe(false);
    // The reference stays, now unresolved; the canvas history still holds exactly the pick.
    expect(roles(b, 'Task_Receive')).toEqual([temp.id]);
    expect(campo(contenedor, T.propiedades.rol(1)).value).toBe(T.catalogo.noEnCatalogo(temp.id));
    act(() => { b.commandStack.undo(); });
    expect(roles(b, 'Task_Receive')).toEqual([undefined]);
    expect(b.commandStack.canUndo()).toBe(false);
  });

  it('⌘Z and ⌘⇧Z undo and redo a pick as one canvas command; clearing the field clears the reference', async () => {
    const b = await banco();
    const { contenedor } = montar(b.modelador, V3, nunca);
    b.clic('Task_Charge');
    const rol = (): HTMLInputElement => campo(contenedor, T.propiedades.rol(1));
    teclear(rol(), 'recep');
    tecla(rol(), 'Enter');
    expect(roles(b, 'Task_Charge')).toEqual(['role-rec', 'Head Cashier']);
    act(() => { b.commandStack.undo(); });
    expect(roles(b, 'Task_Charge')).toEqual(['cajero', 'Head Cashier']);
    expect(rol().value).toBe('cajero — not in catalog');
    act(() => { b.commandStack.redo(); });
    expect(rol().value).toBe('Receptionist');

    // Emptied and left: cleared, as the text field did, in one more command.
    teclear(rol(), '');
    act(() => { rol().blur(); });
    expect(roles(b, 'Task_Charge')).toEqual(['', 'Head Cashier']);
    expect(rol().value).toBe('');
    act(() => { b.commandStack.undo(); });
    expect(roles(b, 'Task_Charge')).toEqual(['role-rec', 'Head Cashier']);
  });

  it('keyboard: ↓ opens and moves, Enter chooses, Esc closes without writing; the combobox is wired for screen readers', async () => {
    const b = await banco();
    const conDos: ProjectDocument = { ...V3, catalog: [RECEPCIONISTA, { type: 'role', id: 'role-con', name: 'Concierge', revision: 1 }] };
    const { contenedor } = montar(b.modelador, conDos, nunca);
    b.clic('Task_Receive');
    const rol = campo(contenedor, T.propiedades.rol(1));
    act(() => { rol.focus(); });
    tecla(rol, 'ArrowDown');
    expect(rol.getAttribute('aria-expanded')).toBe('true');
    const lista = contenedor.querySelector('[role="listbox"]')!;
    expect(rol.getAttribute('aria-controls')).toBe(lista.id);
    expect(lista.getAttribute('aria-label')).toBe(T.catalogo.opciones(T.propiedades.rol(1)));
    expect(filas(contenedor)).toEqual(['Concierge', 'Receptionist']);
    expect(rol.getAttribute('aria-activedescendant')).toBe(contenedor.querySelectorAll('[role="option"]')[0]!.id);
    tecla(rol, 'ArrowDown');
    expect(contenedor.querySelectorAll('[role="option"]')[1]!.getAttribute('aria-selected')).toBe('true');

    // Esc: closed, nothing written.
    tecla(rol, 'Escape');
    expect(rol.getAttribute('aria-expanded')).toBe('false');
    expect(roles(b, 'Task_Receive')).toEqual([undefined]);

    teclear(rol, 'o');
    expect(filas(contenedor)).toEqual(['Concierge', 'Receptionist', T.catalogo.crear('o')]);
    tecla(rol, 'ArrowUp');
    expect(contenedor.querySelectorAll('[role="option"]')[2]!.getAttribute('aria-selected')).toBe('true');
    tecla(rol, 'ArrowUp');
    tecla(rol, 'Enter');
    expect(roles(b, 'Task_Receive')).toEqual(['role-rec']);
    expect(rol.value).toBe('Receptionist');
    // A typed text that was never chosen goes back on Esc.
    teclear(rol, 'xyz');
    expect(filas(contenedor)).toEqual([T.catalogo.crear('xyz')]);
    tecla(rol, 'Escape');
    expect(rol.value).toBe('Receptionist');
    expect(roles(b, 'Task_Receive')).toEqual(['role-rec']);
  });

  it('systems and documents get pickers of their type; risks, controls and KPIs stay typed ids', async () => {
    const b = await banco();
    const conSistema: ProjectDocument = { ...V3, catalog: [RECEPCIONISTA, { type: 'system', id: 'sys-pms', name: 'Property system', revision: 1 }] };
    const { contenedor } = montar(b.modelador, conSistema, nunca);
    b.clic('Task_Charge');
    const sistemas = T.propiedades.referencias.find(([t]) => t === 'lila:SystemRef')![1];
    const riesgos = T.propiedades.referencias.find(([t]) => t === 'lila:RiskRef')![1];
    const sistema = campo(contenedor, T.propiedades.referenciaN(sistemas, 1));
    expect(sistema.getAttribute('role')).toBe('combobox');
    expect(sistema.value).toBe('Property system');
    const riesgo = campo(contenedor, T.propiedades.referenciaN(riesgos, 1));
    expect(riesgo.getAttribute('role')).toBeNull();
    expect(riesgo.value).toBe('risk-x');

    // A role is not offered in the systems field.
    teclear(sistema, 'rec');
    expect(filas(contenedor)).toEqual([T.catalogo.crear('rec')]);
    tecla(sistema, 'Escape');

    // «+ Add» on Inputs gives a document picker.
    const entradas = T.propiedades.referencias.find(([t]) => t === 'lila:Input')![1];
    await act(async () => { contenedor.querySelector<HTMLButtonElement>(`button[aria-label="${T.propiedades.anadirA(entradas)}"]`)!.click(); });
    const entrada = campo(contenedor, T.propiedades.referenciaN(entradas, 1));
    expect(entrada.placeholder).toBe(T.catalogo.pista.document);
  });

  it('every control keeps a unique accessible name, the pickers included', async () => {
    const b = await banco();
    const { contenedor } = montar(b.modelador, V3, nunca);
    b.clic('Task_Charge');
    const nombres = [...contenedor.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label'));
    expect(new Set(nombres).size).toBe(nombres.length);
    const sinNombre = [...contenedor.querySelectorAll('input, button, select')].filter((c) => c.getAttribute('aria-label') === null && c.closest('label') === null && (c.textContent ?? '') === '');
    expect(sinNombre).toEqual([]);
  });

  it('reads in Spanish with the UI in Spanish', async () => {
    setLocale('es');
    const b = await banco();
    const { contenedor } = montar(b.modelador, V3, nunca);
    b.clic('Task_Charge');
    expect(campo(contenedor, ES.propiedades.rol(1)).value).toBe('cajero — no está en el catálogo');
    expect(contenedor.textContent).toContain(ES.catalogo.adoptar);
    teclear(campo(contenedor, ES.propiedades.rol(1)), 'Nuevo');
    expect(filas(contenedor)).toEqual(['Crear «Nuevo»']);
  });
});
