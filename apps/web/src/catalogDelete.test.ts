/**
 * Safe delete and adopt-with-rewrite (#675, `catalogDelete.ts`) over the real catalog operations of
 * #672: the refusal with its uses, the two choices, and what each one changes per element — the
 * list `Modelador.referencias` applies to the process on the canvas.
 */
import {
  adoptReference,
  CatalogError,
  processesOf,
  withCatalog,
  withProcesses,
  type CatalogObject,
  type ProjectDocument,
} from '@lila-modeler/engine/project';
import { describe, expect, it } from 'vitest';
import { adoptionPlaces, adoptionRewrites, attemptDelete, referenceChanges, rewrittenProcesses } from './catalogDelete';
import { buildIndex, scanProcesses } from './catalogo';

const xml = (task: string, extensions: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="D_${task}" targetNamespace="urn:test">
  <bpmn:process id="Process_${task}">
    <bpmn:task id="${task}" name="${task}"><bpmn:extensionElements>${extensions}</bpmn:extensionElements></bpmn:task>
    <bpmn:task id="${task}_Other" name="Other"><bpmn:extensionElements><lila:systemRef ref="POS" /></bpmn:extensionElements></bpmn:task>
  </bpmn:process>
</bpmn:definitions>`;
const proceso = (slug: string, task: string, extensions: string) => ({
  slug, name: slug, model: { id: `Process_${task}`, name: 'model.bpmn', xml: xml(task, extensions), revision: 4 }, scenarios: {}, scenarioRevisions: {}, runs: [],
});
const RECEPTIONIST: CatalogObject = { type: 'role', id: 'role-rec', name: 'Receptionist', revision: 1 };
const AGENT: CatalogObject = { type: 'role', id: 'role-agent', name: 'Front desk agent', revision: 1 };
const TEMP: CatalogObject = { type: 'role', id: 'role-temp', name: 'Temp', revision: 1 };
const CRM: CatalogObject = { type: 'system', id: 'sys-crm', name: 'CRM', revision: 1, ownerRef: 'role-rec' };
const PROCESOS = [
  proceso('check-in', 'Task_Welcome', '<lila:responsibility type="R" roleRef="role-rec" />'),
  proceso('billing', 'Task_Charge', '<lila:responsibility type="A" roleRef="role-rec" /><lila:responsibility type="A" roleRef="role-agent" /><lila:documentRef ref="doc-x" />'),
  proceso('check-out', 'Task_Farewell', '<lila:responsibility type="R" roleRef="role-rec" />'),
  proceso('laundry', 'Task_Wash', '<lila:responsibility type="R" roleRef="role-agent" />'),
];
const DOC: ProjectDocument = withCatalog(
  withProcesses({ ...PROCESOS[0]!, version: 1, id: 'hotel', name: 'Hotel' }, PROCESOS),
  [RECEPTIONIST, AGENT, TEMP, CRM],
);
const xmlDe = (doc: ProjectDocument): Record<string, string> => Object.fromEntries(processesOf(doc).map((p) => [p.slug, p.model.xml]));
const plano = (cambios: ReadonlyMap<string, unknown>): Record<string, unknown> => Object.fromEntries(cambios);

describe('safe delete (#675)', () => {
  it('an unused object is deleted, and no process is rewritten', async () => {
    const intento = await attemptDelete(DOC, TEMP);
    expect(intento.state).toBe('deleted');
    if (intento.state !== 'deleted') return;
    expect(intento.result.document.catalog!.map((o) => o.id)).not.toContain('role-temp');
    expect(intento.result.change.processes).toEqual([]);
    expect(xmlDe(intento.result.document)).toEqual(xmlDe(DOC));
  });

  it('an object in use is refused with every use, in processes and in other objects; nothing changes', async () => {
    const intento = await attemptDelete(DOC, RECEPTIONIST);
    expect(intento).toEqual({ state: 'in-use', uses: [
      expect.objectContaining({ slug: 'check-in', element: 'Task_Welcome', relation: 'responsibility:R' }),
      expect.objectContaining({ slug: 'billing', element: 'Task_Charge', relation: 'responsibility:A' }),
      expect.objectContaining({ slug: 'check-out', element: 'Task_Farewell', relation: 'responsibility:R' }),
      { object: 'system/sys-crm', field: 'ownerRef' },
    ] });
  });

  it('«replace with» rewrites the references of every process, and of the objects that pointed at it', async () => {
    const intento = await attemptDelete(DOC, RECEPTIONIST, { replaceWith: 'role-agent' });
    if (intento.state !== 'deleted') throw new Error('refused');
    const { document, change } = intento.result;
    expect(document.catalog!.map((o) => o.id).sort()).toEqual(['role-agent', 'role-temp', 'sys-crm']);
    expect(document.catalog!.find((o) => o.id === 'sys-crm')).toMatchObject({ ownerRef: 'role-agent', revision: 2 });
    expect(change.processes.map((p) => p.slug)).toEqual(['check-in', 'billing', 'check-out']);
    expect(Object.values(xmlDe(document)).join('')).not.toContain('role-rec');
    expect(xmlDe(document)['laundry']).toBe(xmlDe(DOC)['laundry']);

    const reescritos = await rewrittenProcesses(DOC, intento.result);
    expect(reescritos.map((r) => r.slug)).toEqual(['check-in', 'billing', 'check-out']);
    expect(reescritos.map((r) => r.after.model.revision)).toEqual([5, 5, 5]);
    expect(plano(reescritos[0]!.apply)).toEqual({ Task_Welcome: [{ relation: 'responsibility:R', id: 'role-agent' }] });
    expect(plano(reescritos[0]!.revert)).toEqual({ Task_Welcome: [{ relation: 'responsibility:R', id: 'role-rec' }] });
    // «A role-rec» became «A role-agent», which the task already had: one is kept. The document
    // reference of the task is listed with them, untouched; the other task is not listed at all.
    expect(plano(reescritos[1]!.apply)).toEqual({ Task_Charge: [{ relation: 'responsibility:A', id: 'role-agent' }, { relation: 'documentRef', id: 'doc-x' }] });
    expect(plano(reescritos[1]!.revert)).toEqual({ Task_Charge: [
      { relation: 'responsibility:A', id: 'role-rec' }, { relation: 'responsibility:A', id: 'role-agent' }, { relation: 'documentRef', id: 'doc-x' },
    ] });
  });

  it('«remove references» takes them out of every process and clears the fields that pointed at it', async () => {
    const intento = await attemptDelete(DOC, RECEPTIONIST, { removeReferences: true });
    if (intento.state !== 'deleted') throw new Error('refused');
    expect(intento.result.document.catalog!.find((o) => o.id === 'sys-crm')).not.toHaveProperty('ownerRef');
    const reescritos = await rewrittenProcesses(DOC, intento.result);
    expect(plano(reescritos[0]!.apply)).toEqual({ Task_Welcome: [] });
    expect(plano(reescritos[1]!.apply)).toEqual({ Task_Charge: [{ relation: 'responsibility:A', id: 'role-agent' }, { relation: 'documentRef', id: 'doc-x' }] });
    expect(plano(reescritos[2]!.revert)).toEqual({ Task_Farewell: [{ relation: 'responsibility:R', id: 'role-rec' }] });
  });

  it('any other refusal is the engine\'s: an object changed since it was read, a replacement of another type', async () => {
    await expect(attemptDelete(DOC, { ...RECEPTIONIST, revision: 7 })).rejects.toMatchObject({ code: 'LILA-REVISION' });
    await expect(attemptDelete(DOC, RECEPTIONIST, { replaceWith: 'sys-crm' })).rejects.toBeInstanceOf(CatalogError);
    await expect(attemptDelete(DOC, RECEPTIONIST, { replaceWith: 'role-rec' })).rejects.toBeInstanceOf(CatalogError);
  });

  it('there is no forced delete: without a choice an object in use stays, whatever else is passed', async () => {
    const forzado = await attemptDelete(DOC, RECEPTIONIST, { force: true } as never);
    expect(forzado.state).toBe('in-use');
  });
});

describe('adopt with rewrite (#675)', () => {
  it('says which values are rewritten on adoption: not an id, or the id of an object of another type', () => {
    expect(adoptionRewrites(DOC.catalog!, 'cajero')).toBe(false);
    expect(adoptionRewrites(DOC.catalog!, 'POS')).toBe(true);
    expect(adoptionRewrites(DOC.catalog!, 'Head Cashier')).toBe(true);
    expect(adoptionRewrites(DOC.catalog!, 'role-rec')).toBe(true);
  });

  it('lists the references the adoption resolves, of that type only, once the index is built', async () => {
    const escaneos = await scanProcesses(PROCESOS.map((p) => ({ slug: p.slug, xml: p.model.xml })), new Map());
    const indice = buildIndex(DOC.catalog!, escaneos);
    expect(adoptionPlaces('pending', 'system', 'POS')).toBe('pending');
    expect(adoptionPlaces('unavailable', 'system', 'POS')).toBe('unavailable');
    expect(adoptionPlaces(indice, 'system', 'POS').length).toBe(4);
    expect(adoptionPlaces(indice, 'role', 'POS')).toEqual([]);
    expect(adoptionPlaces(indice, 'document', 'doc-x')).toEqual([expect.objectContaining({ slug: 'billing', element: 'Task_Charge', relation: 'documentRef' })]);
  });

  it('adopting «POS» rewrites every systemRef="POS" of every process to the generated id; reverting names the same elements', async () => {
    const adoptado = await adoptReference(DOC, { type: 'system', ref: 'POS' });
    const id = adoptado.object.id;
    expect(id).not.toBe('POS');
    expect(adoptado.object.name).toBe('POS');
    const reescritos = await rewrittenProcesses(DOC, adoptado);
    expect(reescritos.map((r) => r.slug)).toEqual(['check-in', 'billing', 'check-out', 'laundry']);
    expect(plano(reescritos[3]!.apply)).toEqual({ Task_Wash_Other: [{ relation: 'systemRef', id }] });
    expect(plano(reescritos[3]!.revert)).toEqual({ Task_Wash_Other: [{ relation: 'systemRef', id: 'POS' }] });
    expect(Object.values(xmlDe(adoptado.document)).join('')).not.toContain('ref="POS"');
  });
});

describe('reference changes (#675)', () => {
  it('lists only the elements whose references differ, with the ones they end up with', async () => {
    const [a, b] = [xml('T', '<lila:responsibility type="R" roleRef="x" /><lila:input ref="d1" />'), xml('T', '<lila:input ref="d1" /><lila:responsibility type="R" roleRef="y" />')];
    expect(plano(await referenceChanges(a, a))).toEqual({});
    expect(plano(await referenceChanges(a, b))).toEqual({ T: [{ relation: 'input', id: 'd1' }, { relation: 'responsibility:R', id: 'y' }] });
    expect(plano(await referenceChanges(a, xml('T', '')))).toEqual({ T: [] });
  });
});
