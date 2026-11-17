// @vitest-environment jsdom
/**
 * Safe delete and adopt-with-rewrite in the catalog panel (#675, RM-01 § 3.4): the real panel over
 * the engine's operations (#672), `catalogDelete.ts` and the undo of #93, on a repository of three
 * processes kept as `App.tsx` keeps it (the canvas is `App.test.tsx`'s and `Modeler.abrir.test.tsx`'s).
 */
import {
  adoptReference,
  createCatalogObject,
  formatVersionOf,
  processesOf,
  updateCatalogObject,
  withCatalog,
  withProcesses,
  type CatalogObject,
  type CatalogOperationResult,
  type ProcessUse,
  type ProjectDocument,
} from '@lila-modeler/engine/project';
import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogPanel } from './CatalogPanel';
import { attemptDelete } from './catalogDelete';
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
const AGENT: CatalogObject = { type: 'role', id: 'role-agent', name: 'Front desk agent', revision: 1 };
const TEMP: CatalogObject = { type: 'role', id: 'role-temp', name: 'Temp', revision: 1 };
const RISK: CatalogObject = { type: 'risk', id: 'risk-x', name: 'Overbooking', revision: 1 };

const xml = (task: string, extensions: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="D_${task}" targetNamespace="urn:test">
  <bpmn:process id="Process_${task}">
    <bpmn:task id="${task}" name="${task}"><bpmn:extensionElements>${extensions}</bpmn:extensionElements></bpmn:task>
  </bpmn:process>
</bpmn:definitions>`;
const proceso = (slug: string, name: string, task: string, extensions: string) => ({
  slug, name, model: { id: `Process_${task}`, name: 'model.bpmn', xml: xml(task, extensions), revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [],
});
const R = '<lila:responsibility type="R" roleRef="role-rec" />';
const PROCESOS = [
  proceso('check-in', 'Check-in', 'Task_Welcome', `${R}<lila:systemRef ref="POS" />`),
  proceso('billing', 'Billing', 'Task_Charge', `${R}<lila:systemRef ref="POS" />`),
  proceso('check-out', 'Check-out', 'Task_Farewell', `${R}<lila:systemRef ref="cashdesk" />`),
];
const repositorio = (catalogo: CatalogObject[], version3 = true): ProjectDocument => {
  const doc = withProcesses({ ...PROCESOS[0]!, version: 1, id: 'hotel', name: 'Hotel' }, PROCESOS);
  return version3 ? withCatalog(doc, catalogo) : doc;
};
const V3 = repositorio([RECEPTIONIST, AGENT, TEMP, RISK]);
const xmlDe = (doc: ProjectDocument): string[] => processesOf(doc).map((p) => p.model.xml);
const revisiones = (doc: ProjectDocument): number[] => processesOf(doc).map((p) => p.model.revision);

interface Montado {
  dialogo: () => HTMLDialogElement;
  doc: () => ProjectDocument;
  ir: ReturnType<typeof vi.fn<(uso: ProcessUse) => void>>;
  /** Waits for the usage index, read again after every change as the app reads it. */
  indexado: () => Promise<void>;
}

/** Mounts the panel over a whole repository: every operation gets the document with its processes, as #675 needs. */
function montar(inicial: ProjectDocument, opciones: { preguntar?: (q: { appVersion: string }) => Promise<boolean>; adopcion?: { type: 'system'; id: string } } = {}): Montado {
  const contenedor = document.createElement('div');
  document.body.append(contenedor);
  const raiz = createRoot(contenedor);
  const ir = vi.fn<(uso: ProcessUse) => void>();
  let ultimo = inicial;
  let pendiente: Promise<unknown> = Promise.resolve();
  function Arnes(): React.JSX.Element | null {
    const [doc, setDoc] = useState(inicial);
    const [leidos, setLeidos] = useState<readonly ProcessScan[] | 'pending'>('pending');
    const [entrada, setEntrada] = useState<CatalogUndoEntry | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [abierto, setAbierto] = useState(true);
    useEffect(() => {
      let vigente = true;
      pendiente = scanProcesses(processesOf(doc).map((p) => ({ slug: p.slug, xml: p.model.xml })), new Map()).then((e) => { if (vigente) act(() => setLeidos(e)); });
      return () => { vigente = false; };
    }, [doc]);
    async function cambiar(operar: (d: ProjectDocument) => CatalogOperationResult | Promise<CatalogOperationResult>): Promise<CatalogObject | null> {
      setError(null);
      try {
        const resultado = await confirmUpgrade(await operar(doc), '1.0.2', opciones.preguntar ?? nunca);
        if (resultado === null) return null;
        setDoc(resultado.document);
        setEntrada(recordCatalogChange(doc, resultado));
        return resultado.object;
      } catch (e) {
        setError(T.catalogo.error(e instanceof Error ? e.message : String(e)));
        return null;
      }
    }
    const catalogo: CatalogoPanel = {
      objetos: doc.catalog ?? [],
      conCatalogo: formatVersionOf(doc) === 3,
      crear: (tipo, nombre) => cambiar((d) => createCatalogObject(d, { type: tipo, name: nombre })),
      adoptar: (tipo, id) => cambiar((d) => adoptReference(d, { type: tipo, ref: id })),
    };
    const indice: CatalogIndexState = typeof leidos === 'string' ? leidos : buildIndex(doc.catalog ?? [], leidos);
    ultimo = doc;
    if (!abierto) return null;
    return <CatalogPanel
      catalogo={catalogo}
      indice={indice}
      procesos={PROCESOS}
      error={error}
      adopcion={opciones.adopcion}
      actualizar={(objeto, campos) => cambiar((d) => updateCatalogObject(d, { ...campos, id: objeto.id, type: objeto.type, baseRevision: objeto.revision }))}
      eliminar={async (objeto, como) => {
        let usos: Awaited<ReturnType<typeof attemptDelete>> | undefined;
        const borrado = await cambiar(async (d) => {
          usos = await attemptDelete(d, objeto, como);
          if (usos.state === 'in-use') return { document: d, object: objeto, changed: false, change: { created: [], updated: [], deleted: [], processes: [], wouldUpgrade: false } };
          return usos.result;
        });
        return usos === undefined ? null : usos.state === 'in-use' ? usos.uses : borrado === null ? null : 'deleted';
      }}
      puedeDeshacer={entrada !== null}
      onDeshacer={() => { if (entrada !== null) { setDoc(undoCatalogChange(doc, entrada)); setEntrada(null); } }}
      onIr={ir}
      onCerrar={() => setAbierto(false)}
    />;
  }
  act(() => { raiz.render(<Arnes />); });
  desmontar.push(() => { act(() => { raiz.unmount(); }); contenedor.remove(); });
  return {
    dialogo: () => contenedor.querySelector('dialog.catalogo')!,
    doc: () => ultimo,
    ir,
    indexado: async () => { await act(async () => { await pendiente; }); },
  };
}

const desmontar: Array<() => void> = [];
const nunca = vi.fn().mockRejectedValue(new Error('no question expected'));
beforeEach(() => {
  setLocale('en');
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(() => { for (const d of desmontar.splice(0)) d(); document.body.replaceChildren(); });

const boton = (raiz: ParentNode, texto: string): HTMLButtonElement => {
  const encontrado = [...raiz.querySelectorAll('button')].find((b) => b.textContent === texto);
  if (encontrado === undefined) throw new Error(`no button «${texto}»`);
  return encontrado;
};
const porEtiqueta = <E extends HTMLElement = HTMLButtonElement>(raiz: ParentNode, etiqueta: string): E => {
  const encontrado = raiz.querySelector<E>(`[aria-label="${etiqueta}"]`);
  if (encontrado === null) throw new Error(`no control «${etiqueta}»`);
  return encontrado;
};
async function pulsar(b: HTMLElement): Promise<void> {
  await act(async () => { b.click(); });
  // The operation is asynchronous (it reads every process): let it land.
  await act(async () => { await new Promise((listo) => { setTimeout(listo, 0); }); });
}
async function elegir(d: HTMLElement, nombre: string): Promise<void> {
  await pulsar([...d.querySelectorAll<HTMLButtonElement>('.catalogo-objeto')].find((b) => b.querySelector('.nombre')!.textContent === nombre)!);
}
const nombres = (d: HTMLElement): string[] => [...d.querySelectorAll('.catalogo-objeto .nombre')].map((n) => n.textContent!);
const rechazo = (d: HTMLElement): HTMLElement | null => d.querySelector<HTMLElement>('.catalogo-en-uso');
const usosDelRechazo = (d: HTMLElement): HTMLButtonElement[] => [...rechazo(d)!.querySelectorAll<HTMLButtonElement>('.catalogo-uso')];
function teclear(input: HTMLInputElement, texto: string): void {
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, texto);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function tecla(el: HTMLElement, key: string): Promise<void> {
  await act(async () => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise((listo) => { setTimeout(listo, 0); }); });
}
const USO = (procesoNombre: string, tarea: string): string => P.usoProceso(procesoNombre, tarea, P.relaciones['responsibility:R']);

describe('catalog panel: safe delete (#675)', () => {
  it('deleting an unused role removes it; «Undo last catalog change» brings it back', async () => {
    const { dialogo, doc, indexado } = montar(V3);
    await indexado();
    await elegir(dialogo(), 'Temp');
    await pulsar(porEtiqueta(dialogo(), P.borrarDe('Temp')));
    expect(nombres(dialogo())).not.toContain('Temp');
    expect(doc().catalog!.map((o) => o.id)).not.toContain('role-temp');
    expect(rechazo(dialogo())).toBeNull();
    // Nothing is selected any more, and the focus is not lost with the button that went away.
    expect(dialogo().textContent).toContain(P.elige);
    expect(document.activeElement).toBe(porEtiqueta(dialogo(), P.buscar));
    expect(xmlDe(doc())).toEqual(xmlDe(V3));

    await pulsar(boton(dialogo(), T.catalogo.deshacer));
    expect(nombres(dialogo())).toContain('Temp');
    expect(doc().catalog).toEqual(V3.catalog);
  });

  it('deleting «Receptionist», used in three processes, is refused: it lists the three uses and each one goes to its task', async () => {
    const { dialogo, doc, ir, indexado } = montar(V3);
    await indexado();
    await elegir(dialogo(), 'Receptionist');
    await pulsar(porEtiqueta(dialogo(), P.borrarDe('Receptionist')));

    expect(doc()).toBe(V3); // Refused: nothing changed, and there is nothing to undo.
    expect(boton(dialogo(), T.catalogo.deshacer).disabled).toBe(true);
    expect(nombres(dialogo())).toContain('Receptionist');
    const grupo = rechazo(dialogo())!;
    expect(grupo.getAttribute('role')).toBe('group');
    expect(grupo.getAttribute('aria-label')).toBe(P.enUsoGrupo('Receptionist'));
    expect(grupo.querySelector('[role="alert"]')!.textContent).toBe(P.enUso('Receptionist', 3));
    expect(usosDelRechazo(dialogo()).map((b) => b.textContent)).toEqual([USO('Check-in', 'Task_Welcome'), USO('Billing', 'Task_Charge'), USO('Check-out', 'Task_Farewell')]);
    // The two ways out and Cancel; no forced delete. Replacing waits for an object to be picked.
    expect([...grupo.querySelectorAll('.acciones button')].map((b) => b.textContent)).toEqual([P.reemplazarYBorrar, P.quitarYBorrar, T.app.cancelar]);
    expect(boton(grupo, P.reemplazarYBorrar).disabled).toBe(true);
    // The focus is in the refusal, on «Replace with».
    expect(document.activeElement).toBe(porEtiqueta(grupo, P.reemplazarPor));

    await pulsar(usosDelRechazo(dialogo())[1]!);
    expect(ir).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ slug: 'billing', element: 'Task_Charge', relation: 'responsibility:R' }));
  });

  it('Cancel leaves the object and closes the refusal; so does selecting another object', async () => {
    const { dialogo, doc, indexado } = montar(V3);
    await indexado();
    await elegir(dialogo(), 'Receptionist');
    await pulsar(porEtiqueta(dialogo(), P.borrarDe('Receptionist')));
    await pulsar(boton(rechazo(dialogo())!, T.app.cancelar));
    expect(rechazo(dialogo())).toBeNull();
    expect(doc()).toBe(V3);

    await pulsar(porEtiqueta(dialogo(), P.borrarDe('Receptionist')));
    expect(rechazo(dialogo())).not.toBeNull();
    await elegir(dialogo(), 'Temp');
    expect(rechazo(dialogo())).toBeNull();
    await elegir(dialogo(), 'Receptionist');
    expect(rechazo(dialogo())).toBeNull();
  });

  it('«Replace with» «Front desk agent» rewrites the three references and deletes the object; the undo restores it and the three references', async () => {
    const { dialogo, doc, indexado } = montar(V3);
    await indexado();
    await elegir(dialogo(), 'Receptionist');
    await pulsar(porEtiqueta(dialogo(), P.borrarDe('Receptionist')));

    // With the keyboard: type in the picker, Enter picks the row, the button is then enabled.
    const selector = porEtiqueta<HTMLInputElement>(rechazo(dialogo())!, P.reemplazarPor);
    teclear(selector, 'front');
    // The object being deleted is not offered as its own replacement.
    teclear(selector, '');
    expect([...rechazo(dialogo())!.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(['Front desk agent', 'Temp']);
    teclear(selector, 'front');
    await tecla(selector, 'Enter');
    expect(selector.value).toBe('Front desk agent');
    expect(boton(rechazo(dialogo())!, P.reemplazarYBorrar).disabled).toBe(false);
    await pulsar(boton(rechazo(dialogo())!, P.reemplazarYBorrar));
    await indexado();

    expect(nombres(dialogo())).not.toContain('Receptionist');
    expect(doc().catalog!.map((o) => o.id)).toEqual(['role-agent', 'role-temp', 'risk-x']);
    expect(xmlDe(doc()).every((x) => x.includes('roleRef="role-agent"') && !x.includes('role-rec'))).toBe(true);
    expect(revisiones(doc())).toEqual([1, 1, 1]);
    expect([...dialogo().querySelectorAll('.catalogo-objeto')].find((b) => b.querySelector('.nombre')!.textContent === 'Front desk agent')!.querySelector('.conteo')!.textContent).toBe(P.usos(3));

    await pulsar(boton(dialogo(), T.catalogo.deshacer));
    await indexado();
    expect(doc().catalog).toEqual(V3.catalog);
    expect(xmlDe(doc())).toEqual(xmlDe(V3));
    expect([...dialogo().querySelectorAll('.catalogo-objeto')].find((b) => b.querySelector('.nombre')!.textContent === 'Receptionist')!.querySelector('.conteo')!.textContent).toBe(P.usos(3));
    expect(boton(dialogo(), T.catalogo.deshacer).disabled).toBe(true);
  });

  it('«Replace with» a role created on the spot («Concierge»)', async () => {
    const { dialogo, doc, indexado } = montar(V3);
    await indexado();
    await elegir(dialogo(), 'Receptionist');
    await pulsar(porEtiqueta(dialogo(), P.borrarDe('Receptionist')));
    const selector = porEtiqueta<HTMLInputElement>(rechazo(dialogo())!, P.reemplazarPor);
    teclear(selector, 'Concierge');
    await pulsar([...rechazo(dialogo())!.querySelectorAll<HTMLElement>('[role="option"]')].find((o) => o.textContent === T.catalogo.crear('Concierge'))!);
    const concierge = doc().catalog!.find((o) => o.name === 'Concierge')!;
    expect(selector.value).toBe('Concierge');
    await pulsar(boton(rechazo(dialogo())!, P.reemplazarYBorrar));
    expect(doc().catalog!.map((o) => o.name)).not.toContain('Receptionist');
    expect(xmlDe(doc()).every((x) => x.includes(`roleRef="${concierge.id}"`))).toBe(true);
    // One level: the undo takes back the delete, not the create before it.
    await pulsar(boton(dialogo(), T.catalogo.deshacer));
    expect(doc().catalog!.map((o) => o.name).sort()).toEqual(['Concierge', 'Front desk agent', 'Overbooking', 'Receptionist', 'Temp']);
    expect(xmlDe(doc())).toEqual(xmlDe(V3));
  });

  it('«Remove references and delete» removes the three responsibilities; the undo restores them', async () => {
    const { dialogo, doc, indexado } = montar(V3);
    await indexado();
    await elegir(dialogo(), 'Receptionist');
    await pulsar(porEtiqueta(dialogo(), P.borrarDe('Receptionist')));
    await pulsar(boton(rechazo(dialogo())!, P.quitarYBorrar));
    await indexado();
    expect(doc().catalog!.map((o) => o.id)).not.toContain('role-rec');
    expect(xmlDe(doc()).some((x) => x.includes('lila:responsibility'))).toBe(false);
    expect(xmlDe(doc()).every((x) => x.includes('lila:systemRef'))).toBe(true);

    await pulsar(boton(dialogo(), T.catalogo.deshacer));
    expect(doc().catalog).toEqual(V3.catalog);
    expect(xmlDe(doc())).toEqual(xmlDe(V3));
  });

  it('an object of a type this build does not know has no Delete', async () => {
    const { dialogo, indexado } = montar(V3);
    await indexado();
    await elegir(dialogo(), 'Overbooking');
    expect(dialogo().querySelector(`[aria-label="${P.borrarDe('Overbooking')}"]`)).toBeNull();
  });

  it('reads in Spanish', async () => {
    setLocale('es');
    const E = ES.catalogo.panel;
    const { dialogo, indexado } = montar(V3);
    await indexado();
    await elegir(dialogo(), 'Receptionist');
    await pulsar(porEtiqueta(dialogo(), E.borrarDe('Receptionist')));
    expect(rechazo(dialogo())!.textContent).toContain(E.enUso('Receptionist', 3));
    expect([...rechazo(dialogo())!.querySelectorAll('.acciones button')].map((b) => b.textContent)).toEqual([E.reemplazarYBorrar, E.quitarYBorrar, ES.app.cancelar]);
  });
});

describe('catalog panel: adopt an unresolved value (#675)', () => {
  const seccion = (d: HTMLElement): HTMLElement => [...d.querySelectorAll<HTMLElement>('.catalogo-lista section')].find((s) => s.querySelector('h3')!.textContent === P.sinResolver)!;
  const revision = (d: HTMLElement): HTMLElement | null => d.querySelector<HTMLElement>('.catalogo-adopcion');

  it('each unresolved value has one «Adopt», on its first reference', async () => {
    const { dialogo, indexado } = montar(V3);
    await indexado();
    expect([...seccion(dialogo()).querySelectorAll('.catalogo-uso')]).toHaveLength(3);
    expect([...seccion(dialogo()).querySelectorAll('button.adoptar')].map((b) => b.getAttribute('aria-label'))).toEqual([
      P.adoptarFila('POS', P.tipo.system), P.adoptarFila('cashdesk', P.tipo.system),
    ]);
  });

  it('adopting hand-typed «POS» lists the places first, then rewrites every systemRef="POS" across processes; the undo restores them and removes the object', async () => {
    const { dialogo, doc, ir, indexado } = montar(V3);
    await indexado();
    await pulsar(porEtiqueta(dialogo(), P.adoptarFila('POS', P.tipo.system)));
    const r = revision(dialogo())!;
    expect(r.getAttribute('aria-label')).toBe(P.adoptarTitulo('POS', P.tipo.system));
    expect(r.textContent).toContain(P.adoptarReescribe('POS'));
    expect([...r.querySelectorAll('.catalogo-uso')].map((b) => b.textContent)).toEqual([
      P.usoProceso('Check-in', 'Task_Welcome', P.relaciones.systemRef), P.usoProceso('Billing', 'Task_Charge', P.relaciones.systemRef),
    ]);
    expect(doc()).toBe(V3); // Nothing yet: the list is shown before anything changes.
    expect(document.activeElement).toBe(boton(r, P.adoptarConfirmar));

    await pulsar(boton(r, P.adoptarConfirmar));
    await indexado();
    const pos = doc().catalog!.find((o) => o.type === 'system')!;
    expect(pos).toMatchObject({ name: 'POS', revision: 1 });
    expect(pos.id).not.toBe('POS');
    expect(xmlDe(doc()).map((x) => x.includes(`<lila:systemRef ref="${pos.id}" />`))).toEqual([true, true, false]);
    expect(xmlDe(doc()).join('')).not.toContain('ref="POS"');
    expect(revisiones(doc())).toEqual([1, 1, 0]);
    // The new object is shown, with its two uses; the value is no longer unresolved.
    expect(revision(dialogo())).toBeNull();
    expect(dialogo().querySelector('section.catalogo-detalle')!.getAttribute('aria-label')).toBe(P.detalle('POS'));
    expect([...seccion(dialogo()).querySelectorAll('button.adoptar')].map((b) => b.getAttribute('aria-label'))).toEqual([P.adoptarFila('cashdesk', P.tipo.system)]);

    await pulsar(boton(dialogo(), T.catalogo.deshacer));
    expect(doc().catalog).toEqual(V3.catalog);
    expect(xmlDe(doc())).toEqual(xmlDe(V3));
    expect(ir).not.toHaveBeenCalled();
  });

  it('a value that can be an id keeps it: the review says no process is rewritten, and none is', async () => {
    const { dialogo, doc, indexado } = montar(V3);
    await indexado();
    await pulsar(porEtiqueta(dialogo(), P.adoptarFila('cashdesk', P.tipo.system)));
    expect(revision(dialogo())!.textContent).toContain(P.adoptarConserva('cashdesk'));
    await pulsar(boton(revision(dialogo())!, P.adoptarConfirmar));
    expect(doc().catalog!.find((o) => o.type === 'system')).toMatchObject({ id: 'cashdesk', name: 'cashdesk' });
    expect(xmlDe(doc())).toEqual(xmlDe(V3));
  });

  it('Cancel adopts nothing; a place of the list goes to its task', async () => {
    const { dialogo, doc, ir, indexado } = montar(V3);
    await indexado();
    await pulsar(porEtiqueta(dialogo(), P.adoptarFila('POS', P.tipo.system)));
    await pulsar(revision(dialogo())!.querySelectorAll<HTMLButtonElement>('.catalogo-uso')[1]!);
    expect(ir).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ slug: 'billing', element: 'Task_Charge', relation: 'systemRef' }));
    const otro = montar(V3);
    await otro.indexado();
    await pulsar(porEtiqueta(otro.dialogo(), P.adoptarFila('POS', P.tipo.system)));
    await pulsar(boton(revision(otro.dialogo())!, T.app.cancelar));
    expect(revision(otro.dialogo())).toBeNull();
    expect(otro.doc()).toBe(V3);
    expect(doc()).toBe(V3);
  });

  it('opened by a picker on a value to adopt, in a version 2 project: the review waits for the index, and adopting asks the version 3 question once', async () => {
    const preguntar = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const V2 = repositorio([], false);
    const { dialogo, doc, indexado } = montar(V2, { preguntar, adopcion: { type: 'system', id: 'POS' } });
    const r = revision(dialogo())!;
    // Not confirmed blind: the button waits for the references to be read.
    expect(r.textContent).toContain(P.pendiente);
    expect(boton(r, P.adoptarConfirmar).disabled).toBe(true);
    await indexado();
    expect(boton(revision(dialogo())!, P.adoptarConfirmar).disabled).toBe(false);
    expect(revision(dialogo())!.querySelectorAll('.catalogo-uso')).toHaveLength(2);

    await pulsar(boton(revision(dialogo())!, P.adoptarConfirmar));
    expect(preguntar).toHaveBeenCalledTimes(1);
    expect(doc()).toBe(V2); // Cancelled: nothing changed, the review is still there.
    expect(revision(dialogo())).not.toBeNull();

    await pulsar(boton(revision(dialogo())!, P.adoptarConfirmar));
    expect(preguntar).toHaveBeenCalledTimes(2);
    expect(formatVersionOf(doc())).toBe(3);
    expect(doc().catalog!.map((o) => o.name)).toEqual(['POS']);
    expect(xmlDe(doc()).join('')).not.toContain('ref="POS"');
  });
});
