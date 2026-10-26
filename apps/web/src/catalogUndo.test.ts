/**
 * «Undo last catalog change» (#93, `catalogUndo.ts`) over the real catalog operations of #672: one
 * level, by snapshot; it restores the catalog and the BPMN the change rewrote, and never the
 * version 3 upgrade.
 */
import {
  adoptReference,
  createCatalogObject,
  deleteCatalogObject,
  formatVersionOf,
  processesOf,
  updateCatalogObject,
  withProcesses,
  type ProjectDocument,
} from '@lila-modeler/engine/project';
import { describe, expect, it } from 'vitest';
import { recordCatalogChange, undoCatalogChange } from './catalogUndo';

const xml = (rol: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="D" targetNamespace="urn:t">
  <bpmn:process id="P"><bpmn:task id="T"><bpmn:extensionElements><lila:responsibility type="R" roleRef="${rol}" /></bpmn:extensionElements></bpmn:task></bpmn:process>
</bpmn:definitions>`;
const proceso = (slug: string, rol: string) => ({
  slug, name: slug, model: { id: 'P', name: 'model.bpmn', xml: xml(rol), revision: 2 }, scenarios: {}, scenarioRevisions: {}, runs: [],
});
const V2: ProjectDocument = withProcesses({ ...proceso('a', 'cajero'), version: 1, id: 'p', name: 'Front office' }, [proceso('a', 'cajero'), proceso('b', 'cajero')]);

describe('catalog undo', () => {
  it('after a create, removes the object, leaves the document version 3', () => {
    const resultado = createCatalogObject(V2, { type: 'role', name: 'Temp' });
    const entrada = recordCatalogChange(V2, resultado);
    expect(entrada).not.toBeNull();
    const deshecho = undoCatalogChange(resultado.document, entrada!);
    expect(deshecho.catalog).toEqual([]);
    expect(deshecho.formatVersion).toBe(3);
    expect(formatVersionOf(deshecho)).toBe(3);
    // The processes keep the ids the upgrade gave them.
    expect(processesOf(deshecho).map((p) => p.id)).toEqual(processesOf(resultado.document).map((p) => p.id));
  });

  it('restores the catalog as it was, other objects included', () => {
    const uno = createCatalogObject(V2, { type: 'role', name: 'Receptionist' }).document;
    const dos = createCatalogObject(uno, { type: 'role', name: 'Temp' });
    const deshecho = undoCatalogChange(dos.document, recordCatalogChange(uno, dos)!);
    expect(deshecho.catalog).toEqual(uno.catalog);
  });

  it('an update that changed nothing leaves nothing to undo', () => {
    const uno = createCatalogObject(V2, { type: 'role', name: 'Receptionist' });
    const igual = updateCatalogObject(uno.document, { id: uno.object.id, baseRevision: 1, name: 'Receptionist' });
    expect(recordCatalogChange(uno.document, igual)).toBeNull();
  });

  it('after an adopt that rewrote no BPMN, the XML is as it was and only the object goes', async () => {
    const adoptado = await adoptReference(V2, { type: 'role', ref: 'cajero' });
    expect(adoptado.change.processes).toEqual([]);
    expect(processesOf(adoptado.document).map((p) => p.model.xml)).toEqual(processesOf(V2).map((p) => p.model.xml));
    const deshecho = undoCatalogChange(adoptado.document, recordCatalogChange(V2, adoptado)!);
    expect(deshecho.catalog).toEqual([]);
    expect(processesOf(deshecho).map((p) => p.model)).toEqual(processesOf(adoptado.document).map((p) => p.model));
  });

  it('puts back the BPMN of the processes a change rewrote (delete with replace, #675), the model one revision up', async () => {
    const uno = createCatalogObject(V2, { type: 'role', name: 'Receptionist' }).document;
    const conCajero = (await adoptReference(uno, { type: 'role', ref: 'cajero' })).document;
    const recep = conCajero.catalog!.find((o) => o.name === 'Receptionist')!;
    const borrado = await deleteCatalogObject(conCajero, { id: 'cajero', replaceWith: recep.id });
    expect(borrado.change.processes.map((p) => p.slug)).toEqual(['a', 'b']);
    const deshecho = undoCatalogChange(borrado.document, recordCatalogChange(conCajero, borrado)!);
    expect(deshecho.catalog).toEqual(conCajero.catalog);
    expect(processesOf(deshecho).map((p) => p.model.xml)).toEqual(processesOf(conCajero).map((p) => p.model.xml));
    expect(processesOf(deshecho).map((p) => p.model.revision)).toEqual(processesOf(borrado.document).map((p) => p.model.revision + 1));
    expect(processesOf(deshecho).map((p) => p.id)).toEqual(processesOf(borrado.document).map((p) => p.id));
  });
});
