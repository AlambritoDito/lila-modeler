/**
 * Catalog references on the live canvas (#675, `catalogLive.ts`) over bpmn-moddle with the `lila:`
 * extension, the tree bpmn-js holds: what `Modelador.referencias` does to it must leave the diagram
 * with the references the engine's rewrite (#672) leaves in the XML of the other processes.
 */
import { BpmnModdle } from 'bpmn-moddle';
import { adoptReference, processesOf, withCatalog, type CatalogObject, type ProjectDocument } from '@lila-modeler/engine/project';
import { describe, expect, it } from 'vitest';
import lila from '../../../packages/engine/src/bpmn/lila.moddle.json' with { type: 'json' };
import { attemptDelete, referenceChanges, rewrittenProcesses } from './catalogDelete';
import { applyReferenceChanges, referenceOf, setReferences, type ModdleNode } from './catalogLive';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="D" targetNamespace="urn:test">
  <bpmn:collaboration id="C"><bpmn:participant id="Pool" processRef="P" /></bpmn:collaboration>
  <bpmn:process id="P">
    <bpmn:laneSet id="LS"><bpmn:lane id="Lane"><bpmn:extensionElements><lila:responsibility type="R" roleRef="role-rec" /></bpmn:extensionElements></bpmn:lane></bpmn:laneSet>
    <bpmn:task id="Welcome" name="Welcome"><bpmn:extensionElements>
      <lila:versionTag value="1.0" />
      <lila:responsibility type="R" roleRef="role-rec" />
      <lila:responsibility type="A" roleRef="role-agent" />
      <lila:systemRef ref="POS" />
    </bpmn:extensionElements></bpmn:task>
    <bpmn:subProcess id="Sub"><bpmn:task id="Inner"><bpmn:extensionElements><lila:responsibility type="A" roleRef="role-rec" /><lila:responsibility type="A" roleRef="role-agent" /><lila:systemRef ref="POS" /></bpmn:extensionElements></bpmn:task></bpmn:subProcess>
    <bpmn:task id="Plain" name="Plain" />
  </bpmn:process>
</bpmn:definitions>`;
const CATALOGO: CatalogObject[] = [
  { type: 'role', id: 'role-rec', name: 'Receptionist', revision: 1 },
  { type: 'role', id: 'role-agent', name: 'Front desk agent', revision: 1 },
];
const DOC: ProjectDocument = withCatalog({ version: 1, id: 'p', name: 'Hotel', model: { id: 'P', name: 'model.bpmn', xml: XML, revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [] }, CATALOGO);

async function vivo(): Promise<{ definiciones: ModdleNode; crear: (tipo: string, atributos: Record<string, unknown>) => ModdleNode; xml: () => Promise<string>; elemento: (id: string) => ModdleNode }> {
  const moddle = BpmnModdle({ lila });
  const { rootElement, elementsById } = await moddle.fromXML(XML, 'bpmn:Definitions') as unknown as { rootElement: ModdleNode; elementsById: Record<string, ModdleNode> };
  return {
    definiciones: rootElement,
    crear: (tipo, atributos) => moddle.create(tipo, atributos) as unknown as ModdleNode,
    xml: async () => (await moddle.toXML(rootElement as never, { format: true })).xml,
    elemento: (id) => elementsById[id]!,
  };
}
const referencias = (elemento: ModdleNode): string[] => (elemento.extensionElements?.values ?? []).map(referenceOf).filter((r) => r !== null).map((r) => `${r.relation} ${r.id}`);

describe('catalog references on the live canvas (#675)', () => {
  it('«replace with» on the live tree leaves the references the engine leaves in the XML, and reverting puts them back', async () => {
    const intento = await attemptDelete(DOC, CATALOGO[0]!, { replaceWith: 'role-agent' });
    if (intento.state !== 'deleted') throw new Error('refused');
    const [reescrito] = await rewrittenProcesses(DOC, intento.result);
    const lienzo = await vivo();
    const etiqueta = lienzo.elemento('Welcome').extensionElements!.values![0]!;

    const cambiados = applyReferenceChanges(lienzo.definiciones, reescrito!.apply, lienzo.crear);
    expect(cambiados.map((e) => e.id).sort()).toEqual(['Inner', 'Lane', 'Welcome']);
    expect(referencias(lienzo.elemento('Lane'))).toEqual(['responsibility:R role-agent']);
    expect(referencias(lienzo.elemento('Welcome'))).toEqual(['responsibility:R role-agent', 'responsibility:A role-agent', 'systemRef POS']);
    // «A role-rec» would repeat «A role-agent»: one is kept, as in the engine.
    expect(referencias(lienzo.elemento('Inner'))).toEqual(['responsibility:A role-agent', 'systemRef POS']);
    // What is not a catalog reference stays, the same object in the same place.
    expect(lienzo.elemento('Welcome').extensionElements!.values![0]).toBe(etiqueta);
    // The diagram now reads as the engine's rewrite of it: nothing left to change.
    expect((await referenceChanges(await lienzo.xml(), reescrito!.after.model.xml)).size).toBe(0);

    applyReferenceChanges(lienzo.definiciones, reescrito!.revert, lienzo.crear);
    expect((await referenceChanges(await lienzo.xml(), XML)).size).toBe(0);
    expect(referencias(lienzo.elemento('Inner'))).toEqual(['responsibility:A role-rec', 'responsibility:A role-agent', 'systemRef POS']);
  });

  it('«remove references» drops an extensionElements left empty; reverting makes it again', async () => {
    const intento = await attemptDelete(DOC, CATALOGO[0]!, { removeReferences: true });
    if (intento.state !== 'deleted') throw new Error('refused');
    const [reescrito] = await rewrittenProcesses(DOC, intento.result);
    const lienzo = await vivo();
    applyReferenceChanges(lienzo.definiciones, reescrito!.apply, lienzo.crear);
    expect(lienzo.elemento('Lane').extensionElements).toBeUndefined();
    expect(referencias(lienzo.elemento('Welcome'))).toEqual(['responsibility:A role-agent', 'systemRef POS']);
    expect(await lienzo.xml()).not.toContain('role-rec');
    expect((await referenceChanges(await lienzo.xml(), reescrito!.after.model.xml)).size).toBe(0);

    applyReferenceChanges(lienzo.definiciones, reescrito!.revert, lienzo.crear);
    expect(referencias(lienzo.elemento('Lane'))).toEqual(['responsibility:R role-rec']);
    expect(lienzo.elemento('Lane').extensionElements!.$parent).toBe(lienzo.elemento('Lane'));
    expect((await referenceChanges(await lienzo.xml(), XML)).size).toBe(0);
  });

  it('adopting «POS» rewrites it in place: the reference keeps being the same object', async () => {
    const adoptado = await adoptReference(DOC, { type: 'system', ref: 'POS' });
    const [reescrito] = await rewrittenProcesses(DOC, adoptado);
    const lienzo = await vivo();
    const sistema = lienzo.elemento('Welcome').extensionElements!.values![3]!;
    applyReferenceChanges(lienzo.definiciones, reescrito!.apply, lienzo.crear);
    expect(sistema['ref']).toBe(adoptado.object.id);
    expect(lienzo.elemento('Welcome').extensionElements!.values![3]).toBe(sistema);
    expect(processesOf(adoptado.document)[0]!.model.xml).toContain(`ref="${adoptado.object.id}"`);
    expect((await referenceChanges(await lienzo.xml(), reescrito!.after.model.xml)).size).toBe(0);
  });

  it('an element is found by the id it has in the exported XML, and one already as wanted is not touched', async () => {
    const lienzo = await vivo();
    const cambios = new Map([['Original', [{ relation: 'input', id: 'doc-1' }]], ['Welcome', [{ relation: 'responsibility:R', id: 'role-rec' }, { relation: 'responsibility:A', id: 'role-agent' }, { relation: 'systemRef', id: 'POS' }]]]);
    const cambiados = applyReferenceChanges(lienzo.definiciones, cambios, lienzo.crear, (e) => (e.id === 'Plain' ? 'Original' : e.id ?? ''));
    expect(cambiados.map((e) => e.id)).toEqual(['Plain']);
    expect(referencias(lienzo.elemento('Plain'))).toEqual(['input doc-1']);
    expect(await lienzo.xml()).toContain('<lila:input ref="doc-1" />');
    expect(setReferences(lienzo.elemento('Plain'), [{ relation: 'input', id: 'doc-1' }], lienzo.crear)).toBe(false);
  });
});
