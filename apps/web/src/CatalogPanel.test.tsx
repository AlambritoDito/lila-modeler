// @vitest-environment jsdom
/**
 * The catalog panel (#674): `CatalogPanel` mounted over a harness that keeps the catalog the way
 * `App.tsx` keeps it — the #672 operations, the version 3 confirmation (`catalogUpgrade.ts`) and the
 * one-level undo (`catalogUndo.ts`) — with the usage index read from real BPMN by `catalogo.ts`.
 * The shell's side (File menu, ⌘K, the process tabs, dirty and save) is `App.test.tsx`.
 *
 * The fixture is synthetic (`docs/EXAMPLES_POLICY.md`): a front office with three processes.
 */
import {
  adoptReference,
  createCatalogObject,
  formatVersionOf,
  updateCatalogObject,
  type CatalogObject,
  type CatalogOperationResult,
  type ProcessUse,
  type ProjectDocument,
} from '@lila-modeler/engine/project';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogPanel } from './CatalogPanel';
import { buildIndex, scanProcesses, type CatalogIndexState, type ProcessScan } from './catalogo';
import { confirmUpgrade } from './catalogUpgrade';
import { recordCatalogChange, undoCatalogChange, type CatalogUndoEntry } from './catalogUndo';
import { setLocale } from './i18n';
import type { CatalogoPanel } from './SelectorCatalogo';
import { en as T } from './strings.en';
import { es as ES } from './strings.es';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const P = T.catalogo.panel;
const RECEPTIONIST: CatalogObject = { type: 'role', id: 'role-rec', name: 'Receptionist', revision: 1 };
const FRONT: CatalogObject = { type: 'unit', id: 'unit-front', name: 'Front office', revision: 1 };
const MANUAL: CatalogObject = { type: 'document', id: 'doc-manual', name: 'Welcome manual', revision: 1, url: 'https://example.org/manual', attributes: [{ name: 'Retention', value: '5 years' }] };
const RISK: CatalogObject = { type: 'risk', id: 'risk-x', name: 'Overbooking', description: 'More guests than rooms.', revision: 3, attributes: [{ name: 'Level', value: 'High' }], likelihood: 4 };

const xml = (task: string, extensions: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="D_${task}" targetNamespace="urn:test">
  <bpmn:process id="Process_${task}">
    <bpmn:task id="${task}" name="${task}"><bpmn:extensionElements>${extensions}</bpmn:extensionElements></bpmn:task>
  </bpmn:process>
</bpmn:definitions>`;
const PROCESOS = [
  { slug: 'check-in', name: 'Check-in', xml: xml('Task_Welcome', '<lila:responsibility type="R" roleRef="role-rec" />') },
  { slug: 'billing', name: 'Billing', xml: xml('Task_Charge', '<lila:responsibility type="A" roleRef="role-rec" /><lila:responsibility type="R" roleRef="ghost" />') },
  { slug: 'check-out', name: 'Check-out', xml: xml('Task_Farewell', '<lila:responsibility type="R" roleRef="role-rec" />') },
];
let ESCANEOS: readonly ProcessScan[];

const V1: ProjectDocument = { version: 1, id: 'p', name: 'Front office', model: { id: 'Process_Front', name: 'model.bpmn', xml: '', revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [] };
const V3: ProjectDocument = { ...V1, formatVersion: 3, catalog: [RECEPTIONIST, FRONT, MANUAL, RISK] };

interface Estado {
  doc: ProjectDocument;
  fijarEscaneos: (e: readonly ProcessScan[] | 'pending' | 'unavailable') => void;
}
interface Montado {
  dialogo: () => HTMLDialogElement;
  estado: () => Estado;
  ir: ReturnType<typeof vi.fn<(uso: ProcessUse) => void>>;
  cerrado: ReturnType<typeof vi.fn<() => void>>;
}

/** Mounts the panel over a catalog kept as `App.tsx` keeps it. `escaneos` is the index's source; `'pending'` before it is read. */
function montar(inicial: ProjectDocument, escaneos: readonly ProcessScan[] | 'pending' | 'unavailable', preguntar: (q: { appVersion: string }) => Promise<boolean> = nunca): Montado {
  const contenedor = document.createElement('div');
  document.body.append(contenedor);
  const raiz = createRoot(contenedor);
  const ir = vi.fn<(uso: ProcessUse) => void>();
  const cerrado = vi.fn<() => void>();
  let ultimo!: Estado;
  function Arnes(): React.JSX.Element | null {
    const [doc, setDoc] = useState(inicial);
    const [leidos, setLeidos] = useState(escaneos);
    const [entrada, setEntrada] = useState<CatalogUndoEntry | null>(null);
    const [abierto, setAbierto] = useState(true);
    async function cambiar(operar: (d: ProjectDocument) => CatalogOperationResult | Promise<CatalogOperationResult>): Promise<CatalogObject | null> {
      const resultado = await confirmUpgrade(await operar(doc), '1.0.2', preguntar);
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
    const indice: CatalogIndexState = typeof leidos === 'string' ? leidos : buildIndex(doc.catalog ?? [], leidos);
    ultimo = { doc, fijarEscaneos: setLeidos };
    if (!abierto) return null;
    return <CatalogPanel
      catalogo={catalogo}
      indice={indice}
      procesos={PROCESOS}
      actualizar={(objeto, campos) => cambiar((d) => updateCatalogObject(d, { ...campos, id: objeto.id, type: objeto.type, baseRevision: objeto.revision }))}
      puedeDeshacer={entrada !== null}
      onDeshacer={() => { if (entrada !== null) { setDoc(undoCatalogChange(doc, entrada)); setEntrada(null); } }}
      onIr={ir}
      onCerrar={() => { cerrado(); setAbierto(false); }}
    />;
  }
  act(() => { raiz.render(<Arnes />); });
  desmontar.push(() => { act(() => { raiz.unmount(); }); contenedor.remove(); });
  return { dialogo: () => contenedor.querySelector('dialog.catalogo')!, estado: () => ultimo, ir, cerrado };
}

const desmontar: Array<() => void> = [];
const nunca = vi.fn().mockRejectedValue(new Error('no question expected'));
beforeEach(async () => {
  setLocale('en');
  // jsdom implements neither; what the browser does with the open state is all the panel needs here.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
  ESCANEOS = await scanProcesses(PROCESOS, new Map());
});
afterEach(() => { for (const d of desmontar.splice(0)) d(); document.body.replaceChildren(); });

const campo = <E extends HTMLElement = HTMLInputElement>(raiz: ParentNode, etiqueta: string): E => {
  const encontrado = raiz.querySelector<E>(`[aria-label="${etiqueta}"]`);
  if (encontrado === null) throw new Error(`no control «${etiqueta}»`);
  return encontrado;
};
function teclear(input: HTMLInputElement | HTMLTextAreaElement, texto: string): void {
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input) as object, 'value')!.set!.call(input, texto);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function tecla(el: HTMLElement, key: string): Promise<void> {
  await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
}
/** Leaves the field: React listens to `focusout` for `onBlur`. */
async function salir(el: HTMLElement): Promise<void> {
  await act(async () => { el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
}
const boton = (raiz: ParentNode, texto: string): HTMLButtonElement => {
  const encontrado = [...raiz.querySelectorAll('button')].find((b) => b.textContent === texto);
  if (encontrado === undefined) throw new Error(`no button «${texto}»`);
  return encontrado;
};
/** The rows of the list: `[name, count]` under each group heading. */
const lista = (d: HTMLElement): Record<string, string[][]> => Object.fromEntries(
  [...d.querySelectorAll('.catalogo-lista section')]
    .filter((s) => s.querySelector('.catalogo-objeto') !== null)
    .map((s) => [s.querySelector('h3')!.textContent, [...s.querySelectorAll('.catalogo-objeto')].map((b) => [b.querySelector('.nombre')!.textContent!, b.querySelector('.conteo')!.textContent!])]),
);
async function elegir(d: HTMLElement, nombre: string): Promise<void> {
  const fila = [...d.querySelectorAll<HTMLButtonElement>('.catalogo-objeto')].find((b) => b.querySelector('.nombre')!.textContent === nombre);
  expect(fila, nombre).toBeDefined();
  await act(async () => { fila!.click(); });
}
const detalle = (d: HTMLElement): HTMLElement => d.querySelector<HTMLElement>('section.catalogo-detalle')!;
const usos = (d: HTMLElement): HTMLButtonElement[] => [...detalle(d).querySelectorAll<HTMLButtonElement>('.catalogo-uso')];
async function crear(d: HTMLElement, tipo: string, nombre: string): Promise<void> {
  const selector = campo<HTMLSelectElement>(d, P.nuevoTipo);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(selector, tipo);
    selector.dispatchEvent(new Event('change', { bubbles: true }));
  });
  teclear(campo(d, P.nuevoNombre), nombre);
  await act(async () => { boton(d, P.crear).click(); });
}

describe('catalog panel (#674)', () => {
  it('lists the objects by type with their usage counts; an unknown type is listed under its token', () => {
    const { dialogo } = montar(V3, ESCANEOS);
    expect(dialogo().open).toBe(true);
    expect(lista(dialogo())).toEqual({
      [P.tipos.role]: [['Receptionist', P.usos(3)]],
      [P.tipos.unit]: [['Front office', P.usos(0)]],
      [P.tipos.document]: [['Welcome manual', P.usos(0)]],
      risk: [['Overbooking', P.usos(0)]],
    });
    // A known type with no objects is still there, empty; the search field has the focus.
    expect([...dialogo().querySelectorAll('.catalogo-lista h3')].map((h) => h.textContent)).toEqual([P.tipos.role, P.tipos.unit, P.tipos.system, P.tipos.document, 'risk', P.sinResolver]);
    expect(document.activeElement).toBe(campo(dialogo(), P.buscar));
  });

  it('counts show as pending, never as 0, until the index is built', async () => {
    const { dialogo, estado } = montar(V3, 'pending');
    expect(lista(dialogo())[P.tipos.role]).toEqual([['Receptionist', P.pendiente]]);
    await elegir(dialogo(), 'Receptionist');
    expect(detalle(dialogo()).textContent).toContain(P.pendiente);
    expect(dialogo().textContent).not.toContain(P.usos(0));
    expect(dialogo().textContent).not.toContain(P.sinUsos);
    expect(dialogo().textContent).not.toContain(P.sinResolverNinguna);

    act(() => { estado().fijarEscaneos(ESCANEOS); });
    expect(lista(dialogo())[P.tipos.role]).toEqual([['Receptionist', P.usos(3)]]);
    expect(dialogo().textContent).not.toContain(P.pendiente);
  });

  it('a model that could not be read says so instead of counting', async () => {
    const { dialogo } = montar(V3, 'unavailable');
    expect(lista(dialogo())[P.tipos.role]).toEqual([['Receptionist', P.noDisponible]]);
    await elegir(dialogo(), 'Receptionist');
    expect(detalle(dialogo()).textContent).toContain(P.noDisponibleTexto);
    expect(dialogo().textContent).not.toContain(P.usos(0));
  });

  it('«Receptionist» used in three processes shows «3 uses»; each use closes the panel and asks for its process and element', async () => {
    const { dialogo, ir, cerrado } = montar(V3, ESCANEOS);
    await elegir(dialogo(), 'Receptionist');
    expect(detalle(dialogo()).textContent).toContain('3 uses');
    expect(usos(dialogo()).map((b) => b.textContent)).toEqual([
      P.usoProceso('Check-in', 'Task_Welcome', P.relaciones['responsibility:R']),
      P.usoProceso('Billing', 'Task_Charge', P.relaciones['responsibility:A']),
      P.usoProceso('Check-out', 'Task_Farewell', P.relaciones['responsibility:R']),
    ]);
    await act(async () => { usos(dialogo())[1]!.click(); });
    expect(ir).toHaveBeenCalledExactlyOnceWith({ slug: 'billing', element: 'Task_Charge', relation: 'responsibility:A' });
    expect(cerrado).toHaveBeenCalledOnce();
    // Closed before the shell is asked to move: the canvas is free by then.
    expect(cerrado.mock.invocationCallOrder[0]).toBeLessThan(ir.mock.invocationCallOrder[0]!);
  });

  it('a use in another object shows that object instead of leaving the panel', async () => {
    const conDueno = { ...V3, catalog: [RECEPTIONIST, FRONT, { ...MANUAL, ownerRef: 'role-rec' }, RISK] };
    const { dialogo, ir, cerrado } = montar(conDueno, ESCANEOS);
    await elegir(dialogo(), 'Receptionist');
    expect(detalle(dialogo()).textContent).toContain(P.usos(4));
    expect(usos(dialogo()).at(-1)!.textContent).toBe(P.usoObjeto('Welcome manual', P.campos.ownerRef));
    await act(async () => { usos(dialogo()).at(-1)!.click(); });
    expect(campo(detalle(dialogo()), P.nombre).value).toBe('Welcome manual');
    expect(ir).not.toHaveBeenCalled();
    expect(cerrado).not.toHaveBeenCalled();
  });

  it('renaming updates the panel and keeps the id; «Undo last catalog change» restores the name', async () => {
    const { dialogo, estado } = montar(V3, ESCANEOS);
    await elegir(dialogo(), 'Receptionist');
    expect(boton(dialogo(), T.catalogo.deshacer).disabled).toBe(true);
    const nombre = campo(detalle(dialogo()), P.nombre);
    teclear(nombre, 'Front desk agent');
    // Typing does not write.
    expect(estado().doc.catalog![0]).toEqual(RECEPTIONIST);
    await tecla(nombre, 'Enter');
    expect(estado().doc.catalog![0]).toEqual({ ...RECEPTIONIST, name: 'Front desk agent', revision: 2 });
    expect(lista(dialogo())[P.tipos.role]).toEqual([['Front desk agent', P.usos(3)]]);
    expect(campo(detalle(dialogo()), P.nombre).value).toBe('Front desk agent');
    expect(detalle(dialogo()).querySelector('output.mono')!.textContent).toBe('role-rec');

    await act(async () => { boton(dialogo(), T.catalogo.deshacer).click(); });
    expect(estado().doc.catalog![0]).toEqual(RECEPTIONIST);
    expect(lista(dialogo())[P.tipos.role]).toEqual([['Receptionist', P.usos(3)]]);
    expect(campo(detalle(dialogo()), P.nombre).value).toBe('Receptionist');
    expect(boton(dialogo(), T.catalogo.deshacer).disabled).toBe(true);
  });

  it('a field is written when it is left; an empty name is not written', async () => {
    const { dialogo, estado } = montar(V3, ESCANEOS);
    await elegir(dialogo(), 'Receptionist');
    const descripcion = campo<HTMLTextAreaElement>(detalle(dialogo()), P.descripcion);
    teclear(descripcion, 'Welcomes the guests.');
    await salir(descripcion);
    expect(estado().doc.catalog![0]).toMatchObject({ description: 'Welcomes the guests.', revision: 2 });

    const nombre = campo(detalle(dialogo()), P.nombre);
    teclear(nombre, '   ');
    await salir(nombre);
    expect(estado().doc.catalog![0]).toMatchObject({ name: 'Receptionist', revision: 2 });
  });

  it('warns when a new name repeats one of the same type, and still lets it through', async () => {
    const { dialogo, estado } = montar(V3, ESCANEOS);
    teclear(campo(dialogo(), P.nuevoNombre), 'receptionist');
    expect(dialogo().querySelector('.catalogo-nuevo [role="status"]')!.textContent).toBe(P.nombreRepetido(P.tipo.role));
    await act(async () => { boton(dialogo(), P.crear).click(); });
    expect(estado().doc.catalog!.filter((o) => o.type === 'role').map((o) => o.name).sort()).toEqual(['Receptionist', 'receptionist']);
    // The new object is selected; renaming it to the other's name warns too.
    const nombre = campo(detalle(dialogo()), P.nombre);
    expect(nombre.value).toBe('receptionist');
    expect(detalle(dialogo()).querySelector('.catalogo-aviso')!.textContent).toBe(P.nombreRepetido(P.tipo.role));
    teclear(nombre, 'Night porter');
    expect(detalle(dialogo()).querySelector('.catalogo-aviso')).toBeNull();
    // Another type with that name is not a repeat.
    await crear(dialogo(), 'unit', 'Receptionist');
    expect(dialogo().querySelector('.catalogo-nuevo [role="status"]')).toBeNull();
  });

  it('creating the first object in a version 2 project asks once: Cancel changes nothing, Confirm creates, the second create does not ask', async () => {
    let responder!: (acepta: boolean) => void;
    const preguntar = vi.fn(() => new Promise<boolean>((resolve) => { responder = resolve; }));
    const { dialogo, estado } = montar(V1, [], preguntar);
    // A version 1 or 2 project has no catalog to resolve against: no «Unresolved references».
    expect(dialogo().textContent).not.toContain(P.sinResolver);

    await crear(dialogo(), 'role', 'Receptionist');
    expect(preguntar).toHaveBeenCalledExactlyOnceWith({ appVersion: '1.0.2' });
    await act(async () => { responder(false); });
    expect(estado().doc).toBe(V1);
    expect(campo(dialogo(), P.nuevoNombre).value).toBe('Receptionist');

    await act(async () => { boton(dialogo(), P.crear).click(); });
    expect(preguntar).toHaveBeenCalledTimes(2);
    await act(async () => { responder(true); });
    expect(estado().doc.formatVersion).toBe(3);
    expect(estado().doc.catalog).toMatchObject([{ type: 'role', name: 'Receptionist', revision: 1 }]);
    expect(campo(dialogo(), P.nuevoNombre).value).toBe('');
    expect(campo(detalle(dialogo()), P.nombre).value).toBe('Receptionist');

    await crear(dialogo(), 'system', 'PMS');
    expect(preguntar).toHaveBeenCalledTimes(2);
    expect(estado().doc.catalog!.map((o) => o.name).sort()).toEqual(['PMS', 'Receptionist']);
  });

  it('a `risk` object from a newer build is listed read-only: shown as it is, with nothing to edit', async () => {
    const { dialogo, estado } = montar(V3, ESCANEOS);
    await elegir(dialogo(), 'Overbooking');
    const d = detalle(dialogo());
    expect(d.textContent).toContain(P.soloLectura('risk'));
    expect(d.textContent).toContain('Overbooking');
    expect(d.textContent).toContain('risk-x');
    expect(d.textContent).toContain('More guests than rooms.');
    expect(d.textContent).toContain('Level');
    expect(d.textContent).toContain('High');
    expect(d.querySelectorAll('input, textarea, select')).toHaveLength(0);
    expect([...d.querySelectorAll('button')].filter((b) => !b.classList.contains('catalogo-uso'))).toHaveLength(0);
    // And no type to create it under.
    expect([...campo<HTMLSelectElement>(dialogo(), P.nuevoTipo).options].map((o) => o.value)).toEqual(['role', 'unit', 'system', 'document']);
    expect(estado().doc.catalog).toContainEqual(RISK);
  });

  it('a document has an owner picker, a URL that opens externally and attributes; no attachment control and no delete', async () => {
    const { dialogo, estado } = montar(V3, ESCANEOS);
    await elegir(dialogo(), 'Welcome manual');
    const d = detalle(dialogo());
    const enlace = d.querySelector<HTMLAnchorElement>('a.catalogo-enlace')!;
    expect(enlace.textContent).toBe(P.abrirEnlace);
    expect(enlace.getAttribute('href')).toBe('https://example.org/manual');
    expect(enlace.target).toBe('_blank');
    expect(enlace.rel).toBe('noopener noreferrer');
    expect(d.querySelector('input[type="file"]')).toBeNull();
    expect(dialogo().textContent).not.toMatch(/delete|attach/i);

    // The owner is picked from the roles, by name; the catalog holds the id.
    const dueno = campo(d, P.campos.ownerRef);
    expect(dueno.getAttribute('role')).toBe('combobox');
    teclear(dueno, 'recep');
    const fila = [...d.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === 'Receptionist')!;
    await act(async () => { fila.click(); });
    expect(estado().doc.catalog!.find((o) => o.id === 'doc-manual')).toMatchObject({ ownerRef: 'role-rec', revision: 2 });

    // A URL that is not http(s) is not written, and says why; emptied, the URL and its link go.
    const url = campo(detalle(dialogo()), P.campos.url);
    teclear(url, 'ftp://example.org/manual');
    await salir(url);
    expect(detalle(dialogo()).textContent).toContain(P.urlInvalida);
    expect(estado().doc.catalog!.find((o) => o.id === 'doc-manual')!.url).toBe('https://example.org/manual');
    teclear(url, '');
    await salir(url);
    expect(estado().doc.catalog!.find((o) => o.id === 'doc-manual')!.url).toBeUndefined();
    expect(detalle(dialogo()).querySelector('a.catalogo-enlace')).toBeNull();

    // Attributes: edit a value, add a pair, remove the first.
    const valor = campo(detalle(dialogo()), P.atributoValor(1));
    teclear(valor, '7 years');
    await salir(valor);
    teclear(campo(detalle(dialogo()), P.atributoNuevoNombre), 'Language');
    teclear(campo(detalle(dialogo()), P.atributoNuevoValor), 'EN');
    await act(async () => { boton(detalle(dialogo()), P.atributoAnadir).click(); });
    expect(estado().doc.catalog!.find((o) => o.id === 'doc-manual')!.attributes).toEqual([{ name: 'Retention', value: '7 years' }, { name: 'Language', value: 'EN' }]);
    await act(async () => { campo<HTMLButtonElement>(detalle(dialogo()), P.atributoQuitar(1)).click(); });
    expect(estado().doc.catalog!.find((o) => o.id === 'doc-manual')!.attributes).toEqual([{ name: 'Language', value: 'EN' }]);
  });

  it('a role picks its unit and a unit its parent, never itself', async () => {
    const { dialogo, estado } = montar(V3, ESCANEOS);
    await elegir(dialogo(), 'Receptionist');
    const unidad = campo(detalle(dialogo()), P.campos.unitRef);
    teclear(unidad, 'front');
    await act(async () => { [...detalle(dialogo()).querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === 'Front office')!.click(); });
    expect(estado().doc.catalog!.find((o) => o.id === 'role-rec')).toMatchObject({ unitRef: 'unit-front' });
    // The unit now lists the role as a use.
    await elegir(dialogo(), 'Front office');
    expect(usos(dialogo()).map((b) => b.textContent)).toEqual([P.usoObjeto('Receptionist', P.campos.unitRef)]);
    teclear(campo(detalle(dialogo()), P.campos.parentRef), 'front');
    expect([...detalle(dialogo()).querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual([T.catalogo.crear('front')]);
  });

  it('«Unresolved references» lists the references no object has, and goes to each', async () => {
    const { dialogo, ir } = montar(V3, ESCANEOS);
    const seccion = [...dialogo().querySelectorAll('.catalogo-lista section')].find((s) => s.querySelector('h3')!.textContent === P.sinResolver)!;
    const filas = [...seccion.querySelectorAll<HTMLButtonElement>('.catalogo-uso')];
    expect(filas.map((b) => b.textContent)).toEqual([
      P.sinResolverFila('ghost', P.tipo.role, P.usoProceso('Billing', 'Task_Charge', P.relaciones['responsibility:R'])),
    ]);
    await act(async () => { filas[0]!.click(); });
    expect(ir).toHaveBeenCalledExactlyOnceWith({ slug: 'billing', element: 'Task_Charge', relation: 'responsibility:R', type: 'role', id: 'ghost' });
  });

  it('with every reference resolved the section says so', () => {
    const { dialogo } = montar(V3, ESCANEOS.map((e) => ({ ...e, references: e.references.filter((r) => r.id !== 'ghost') })));
    expect(dialogo().textContent).toContain(P.sinResolverNinguna);
  });

  it('search filters by name or id', () => {
    const { dialogo } = montar(V3, ESCANEOS);
    teclear(campo(dialogo(), P.buscar), 'MANUAL');
    expect(lista(dialogo())).toEqual({ [P.tipos.document]: [['Welcome manual', P.usos(0)]] });
    teclear(campo(dialogo(), P.buscar), 'risk-');
    expect(lista(dialogo())).toEqual({ risk: [['Overbooking', P.usos(0)]] });
    teclear(campo(dialogo(), P.buscar), 'zzz');
    expect(dialogo().textContent).toContain(P.sinResultados);
  });

  it('Escape and «Close» close the panel and put the focus back where it was', async () => {
    const origen = document.createElement('button');
    document.body.append(origen);
    origen.focus();
    const { dialogo, cerrado } = montar(V3, ESCANEOS);
    expect(document.activeElement).toBe(campo(dialogo(), P.buscar));
    await tecla(campo(dialogo(), P.buscar), 'Escape');
    expect(cerrado).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(origen);

    const otro = montar(V3, ESCANEOS);
    await act(async () => { boton(otro.dialogo(), P.cerrar).click(); });
    expect(otro.cerrado).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(origen);
  });

  it('Escape in a picker with its list open closes the list, not the panel', async () => {
    const { dialogo, cerrado } = montar(V3, ESCANEOS);
    await elegir(dialogo(), 'Receptionist');
    const unidad = campo(detalle(dialogo()), P.campos.unitRef);
    teclear(unidad, 'fr');
    expect(detalle(dialogo()).querySelector('[role="listbox"]')).not.toBeNull();
    await tecla(unidad, 'Escape');
    expect(detalle(dialogo()).querySelector('[role="listbox"]')).toBeNull();
    expect(cerrado).not.toHaveBeenCalled();
    await tecla(unidad, 'Escape');
    expect(cerrado).toHaveBeenCalledOnce();
  });

  it('opened from an entry of a menu that has closed since, the focus goes back to the menu button', async () => {
    const menu = document.createElement('details');
    menu.innerHTML = '<summary>File</summary><div><button type="button">Catalog</button></div>';
    document.body.append(menu);
    menu.open = true;
    menu.querySelector('button')!.focus();
    menu.open = false;
    const { dialogo } = montar(V3, ESCANEOS);
    await tecla(dialogo(), 'Escape');
    expect(document.activeElement).toBe(menu.querySelector('summary'));
  });

  it('every control has an accessible name and is reachable by keyboard', async () => {
    const { dialogo } = montar(V3, ESCANEOS);
    await elegir(dialogo(), 'Welcome manual');
    expect(dialogo().getAttribute('aria-labelledby')).toBe(dialogo().querySelector('h2')!.id);
    for (const control of dialogo().querySelectorAll<HTMLElement>('input, textarea, select, button, a')) {
      const nombre = control.getAttribute('aria-label') ?? control.textContent ?? '';
      expect(nombre.trim(), control.outerHTML).not.toBe('');
      expect(control.tabIndex, control.outerHTML).toBeGreaterThanOrEqual(0);
    }
  });

  it('reads in Spanish with the UI in Spanish', async () => {
    setLocale('es');
    const { dialogo } = montar(V3, ESCANEOS);
    const E = ES.catalogo.panel;
    expect(dialogo().querySelector('h2')!.textContent).toBe(E.titulo);
    expect(lista(dialogo())[E.tipos.role]).toEqual([['Receptionist', E.usos(3)]]);
    await elegir(dialogo(), 'Receptionist');
    expect(usos(dialogo())[0]!.textContent).toBe(E.usoProceso('Check-in', 'Task_Welcome', E.relaciones['responsibility:R']));
    expect(dialogo().textContent).toContain(E.sinResolver);
    expect(dialogo().textContent).not.toContain(P.dondeSeUsa);
  });
});
