/**
 * The one-time version 3 confirmation (#93, `catalogUpgrade.ts`) over the real catalog operations
 * of #672: asked before the first object of a version 1 or 2 project, never after, never for a
 * version 3 one; Cancel applies nothing.
 */
import { adoptReference, createCatalogObject, formatVersionOf, withProcesses, type ProjectDocument } from '@lila-modeler/engine/project';
import { describe, expect, it, vi } from 'vitest';
import { confirmUpgrade, upgradeQuestion } from './catalogUpgrade';

const proceso = (slug: string) => ({
  slug, name: slug, model: { id: `Process_${slug}`, name: 'model.bpmn', xml: '<x/>', revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [],
});
const V1: ProjectDocument = { ...proceso('a'), version: 1, id: 'p', name: 'Front office' };
const V2: ProjectDocument = withProcesses(V1, [proceso('a'), proceso('b'), proceso('c')]);

describe('upgradeQuestion', () => {
  it('asks for the first object of a version 1 or 2 project, naming the running version', () => {
    expect(formatVersionOf(V2)).toBe(2);
    expect(upgradeQuestion(createCatalogObject(V2, { type: 'role', name: 'Receptionist' }), '1.0.0-beta.30')).toEqual({ appVersion: '1.0.0-beta.30' });
    expect(upgradeQuestion(createCatalogObject(V1, { type: 'role', name: 'Receptionist' }), '1.0.0-beta.30')).not.toBeNull();
  });

  it('never asks again once the document is version 3, nor for a version 3 project', () => {
    const primera = createCatalogObject(V2, { type: 'role', name: 'Receptionist' }).document;
    expect(upgradeQuestion(createCatalogObject(primera, { type: 'role', name: 'Temp' }), 'v')).toBeNull();
    const v3Vacio: ProjectDocument = { ...V1, formatVersion: 3, catalog: [] };
    expect(upgradeQuestion(createCatalogObject(v3Vacio, { type: 'system', name: 'CRM' }), 'v')).toBeNull();
  });
});

describe('confirmUpgrade', () => {
  it('Cancel returns null: the caller applies nothing and the document stays version 2', async () => {
    const resultado = createCatalogObject(V2, { type: 'role', name: 'Receptionist' });
    const preguntar = vi.fn().mockResolvedValue(false);
    expect(await confirmUpgrade(resultado, '1.0.0-beta.30', preguntar)).toBeNull();
    expect(preguntar).toHaveBeenCalledWith({ appVersion: '1.0.0-beta.30' });
    // The operations are pure: the input was never touched.
    expect(V2.catalog).toBeUndefined();
    expect(formatVersionOf(V2)).toBe(2);
  });

  it('Confirm returns the result, version 3; a second create does not ask', async () => {
    const preguntar = vi.fn().mockResolvedValue(true);
    const primera = await confirmUpgrade(createCatalogObject(V2, { type: 'role', name: 'Receptionist' }), 'v', preguntar);
    expect(primera?.document.formatVersion).toBe(3);
    expect(primera?.document.catalog?.map((o) => o.name)).toEqual(['Receptionist']);
    const segunda = await confirmUpgrade(createCatalogObject(primera!.document, { type: 'role', name: 'Temp' }), 'v', preguntar);
    expect(segunda?.document.catalog).toHaveLength(2);
    expect(preguntar).toHaveBeenCalledTimes(1);
  });

  it('adopting an id asks the same question', async () => {
    const preguntar = vi.fn().mockResolvedValue(false);
    expect(await confirmUpgrade(await adoptReference(V1, { type: 'role', ref: 'cajero' }), 'v', preguntar)).toBeNull();
    expect(preguntar).toHaveBeenCalledTimes(1);
  });
});
