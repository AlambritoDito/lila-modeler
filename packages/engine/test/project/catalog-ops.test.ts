/**
 * The catalog operations of #672 (RM-01 § 2.3, § 3.4, § 5.4) on the synthetic hotel of
 * `fixtures/catalog-hotel.ts`: pure functions that return a new document and a change summary and
 * never touch their input.
 */
import { describe, expect, test } from 'vitest';

import {
  adoptReference,
  CatalogError,
  createCatalogObject,
  decodeLila,
  deleteCatalogObject,
  encodeLila,
  formatVersionOf,
  getCatalogObject,
  listCatalog,
  processesOf,
  updateCatalogObject,
  type CatalogObject,
  type ProjectDocument,
} from '../../src/project/index.js';
import { HOTEL_PROCESSES, hotelDocument, hotelModel } from './fixtures/catalog-hotel.js';

/** The error `work` throws, which must be a `CatalogError`. */
async function refusal(work: () => unknown): Promise<CatalogError> {
  try {
    await work();
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogError);
    return error as CatalogError;
  }
  throw new Error('expected a CatalogError');
}

/** The hotel with `extensions` on the task of every process (a version 3 document when `catalog` is given). */
function withRefs(document: ProjectDocument, extensions: (slug: string) => string): ProjectDocument {
  const processes = processesOf(document).map((p) => {
    const spec = HOTEL_PROCESSES.find((h) => h.slug === p.slug)!;
    return { ...p, model: { ...p.model, xml: hotelModel(spec.bpmnId, spec.name, spec.task, extensions(p.slug)) } };
  });
  const [first, ...rest] = processes;
  return {
    ...document,
    model: first!.model,
    ...(document.process === undefined ? {} : { process: { ...document.process } }),
    ...(rest.length === 0 ? {} : { processes: rest }),
  };
}

/** A hotel v3 with role "Receptionist" set as R on every task; returns the document and the role. */
function receptionistHotel(): { document: ProjectDocument; role: CatalogObject } {
  const created = createCatalogObject(hotelDocument(2), { type: 'role', name: 'Receptionist' });
  const role = created.object;
  return { document: withRefs(created.document, () => `<lila:responsibility type="R" roleRef="${role.id}" />`), role };
}

describe('createCatalogObject', () => {
  test('the first object upgrades a version 2 document to version 3; the second does not', () => {
    const before = hotelDocument(2);
    const frozen = structuredClone(before);
    const first = createCatalogObject(before, { type: 'role', name: '  Receptionist ' });
    expect(before).toEqual(frozen); // never mutated
    expect(first.object).toEqual({ type: 'role', id: first.object.id, name: 'Receptionist', revision: 1 });
    expect(first.object.id).toMatch(/^role-[0-9a-z]{12}$/);
    expect(first.change).toEqual({ created: [`role/${first.object.id}`], updated: [], deleted: [], processes: [], wouldUpgrade: true });
    expect(formatVersionOf(first.document)).toBe(3);
    // Every process got an id; slugs and models stay.
    const processes = processesOf(first.document);
    expect(processes.map((p) => p.slug)).toEqual(['check-in', 'check-out', 'room-service']);
    for (const p of processes) expect(p.id).toMatch(/^process-[0-9a-z]{12}$/);
    expect(processes.map((p) => p.model)).toEqual(processesOf(before).map((p) => p.model));

    const second = createCatalogObject(first.document, { type: 'unit', name: 'Front office' });
    expect(second.change.wouldUpgrade).toBe(false);
    expect(listCatalog(second.document).map((o) => o.type)).toEqual(['role', 'unit']);
  });

  test('a version 1 project is upgraded too, and keeps its process', () => {
    const result = createCatalogObject(hotelDocument(1), { type: 'system', name: 'Property management', url: 'https://pms.example.com/' });
    expect(result.change.wouldUpgrade).toBe(true);
    expect(processesOf(result.document).map((p) => p.slug)).toEqual(['check-in']);
    const reopened = decodeLila(encodeLila(result.document));
    expect(reopened.formatVersion).toBe(3);
    expect(reopened.catalog).toEqual([result.object]);
  });

  test('refuses an unknown type, an empty name, a bad url and a field the type does not have', async () => {
    const document = hotelDocument(2);
    expect((await refusal(() => createCatalogObject(document, { type: 'risk', name: 'No-show' }))).problem).toEqual({ reason: 'unknown-type', type: 'risk' });
    expect((await refusal(() => createCatalogObject(document, { type: 'role', name: '   ' }))).problem.reason).toBe('invalid');
    expect((await refusal(() => createCatalogObject(document, { type: 'document', name: 'Form', url: 'ftp://x' }))).problem.reason).toBe('invalid');
    expect((await refusal(() => createCatalogObject(document, { type: 'role', name: 'R', url: 'https://x.example' }))).problem).toEqual({
      reason: 'unknown-field', type: 'role', field: 'url',
    });
    expect((await refusal(() => createCatalogObject(document, { type: 'role', name: 'R', unitRef: 'Front Office' }))).code).toBe('LILA-CATALOG');
  });

  test('a document with a url round-trips through create, update, get and the archive', () => {
    const created = createCatalogObject(hotelDocument(2), {
      type: 'document', name: 'Registration card', url: 'https://intranet.example.com/forms/registration', attributes: [{ name: 'Retention', value: '5 years' }],
    });
    const id = created.object.id;
    const updated = updateCatalogObject(created.document, { id, baseRevision: 1, url: 'https://intranet.example.com/forms/registration-v2' });
    const reopened = decodeLila(encodeLila(updated.document));
    expect(getCatalogObject(reopened, { id })).toEqual({
      type: 'document', id, name: 'Registration card', revision: 2,
      attributes: [{ name: 'Retention', value: '5 years' }], url: 'https://intranet.example.com/forms/registration-v2',
    });
    const cleared = updateCatalogObject(reopened, { id, baseRevision: 2, url: null, attributes: null });
    expect(cleared.object).toEqual({ type: 'document', id, name: 'Registration card', revision: 3 });
  });
});

describe('updateCatalogObject', () => {
  test('a rename changes the object only: same models, revision one up', () => {
    const { document, role } = receptionistHotel();
    const renamed = updateCatalogObject(document, { id: role.id, baseRevision: 1, name: 'Front desk agent' });
    expect(renamed.object).toEqual({ ...role, name: 'Front desk agent', revision: 2 });
    expect(renamed.change).toEqual({ created: [], updated: [`role/${role.id}`], deleted: [], processes: [], wouldUpgrade: false });
    expect(processesOf(renamed.document).map((p) => p.model)).toEqual(processesOf(document).map((p) => p.model));
    expect(getCatalogObject(decodeLila(encodeLila(renamed.document)), { id: role.id }).revision).toBe(2);
  });

  test('a stale baseRevision is refused; an update to the same values changes nothing', async () => {
    const { document, role } = receptionistHotel();
    const renamed = updateCatalogObject(document, { id: role.id, baseRevision: 1, name: 'Front desk agent' }).document;
    const stale = await refusal(() => updateCatalogObject(renamed, { id: role.id, baseRevision: 1, name: 'Night auditor' }));
    expect(stale.code).toBe('LILA-REVISION');
    expect(stale.problem).toEqual({ reason: 'revision', id: role.id, expected: 1, actual: 2 });
    const same = updateCatalogObject(renamed, { id: role.id, baseRevision: 2, name: 'Front desk agent' });
    expect(same.changed).toBe(false);
    expect(same.document).toBe(renamed);
    expect(same.object.revision).toBe(2);
  });

  test('an unknown id is LILA-NO-OBJECT; an object of an unknown type is read-only', async () => {
    const { document } = receptionistHotel();
    expect((await refusal(() => updateCatalogObject(document, { id: 'role-nothere00000', baseRevision: 1, name: 'X' }))).code).toBe('LILA-NO-OBJECT');
    const risk: CatalogObject = { type: 'risk', id: 'risk-c5n2v8b1x7qa', name: 'No-show', revision: 1, likelihood: 'high' };
    const withRisk: ProjectDocument = { ...document, catalog: [...document.catalog!, risk] };
    expect((await refusal(() => updateCatalogObject(withRisk, { id: risk.id, baseRevision: 1, name: 'X' }))).problem.reason).toBe('read-only');
    expect((await refusal(() => deleteCatalogObject(withRisk, { id: risk.id }))).problem.reason).toBe('read-only');
  });
});

describe('deleteCatalogObject', () => {
  test('an object in use is refused with its uses', async () => {
    const { document, role } = receptionistHotel();
    const error = await refusal(() => deleteCatalogObject(document, { id: role.id }));
    expect(error.code).toBe('LILA-OBJECT-IN-USE');
    const ids = processesOf(document).map((p) => p.id);
    expect(error.problem).toEqual({
      reason: 'in-use', type: 'role', id: role.id,
      uses: HOTEL_PROCESSES.map((p, i) => ({ process: ids[i], slug: p.slug, element: 'Task_1', relation: 'responsibility:R' })),
    });
  });

  test('replaceWith rewrites every reference, then deletes; models get a new revision', async () => {
    const { document, role } = receptionistHotel();
    const agent = createCatalogObject(document, { type: 'role', name: 'Front desk agent' });
    const result = await deleteCatalogObject(agent.document, { id: role.id, replaceWith: agent.object.id });
    expect(listCatalog(result.document)).toEqual([agent.object]);
    expect(result.change.deleted).toEqual([`role/${role.id}`]);
    expect(result.change.processes.map((p) => [p.slug, p.references])).toEqual([['check-in', 1], ['check-out', 1], ['room-service', 1]]);
    for (const p of processesOf(result.document)) {
      expect(p.model.revision).toBe(2);
      expect(p.model.xml).toContain(`roleRef="${agent.object.id}"`);
      expect(p.model.xml).not.toContain(role.id);
    }
  });

  test('removeReferences removes them and the empty extension elements', async () => {
    const { document, role } = receptionistHotel();
    const result = await deleteCatalogObject(document, { id: role.id, removeReferences: true });
    expect(listCatalog(result.document)).toEqual([]);
    expect(formatVersionOf(result.document)).toBe(3); // stays version 3 (RM-01 § 1.3)
    for (const p of processesOf(result.document)) {
      expect(p.model.xml).not.toContain('lila:responsibility');
      expect(p.model.xml).not.toContain('extensionElements');
    }
  });

  test('an unused object is deleted with no model touched', async () => {
    const created = createCatalogObject(hotelDocument(2), { type: 'system', name: 'Minibar sensors' });
    const result = await deleteCatalogObject(created.document, { id: created.object.id });
    expect(result.change.processes).toEqual([]);
    expect(processesOf(result.document).map((p) => p.model)).toEqual(processesOf(created.document).map((p) => p.model));
  });

  test('replaceWith of another type, itself, or with removeReferences is refused', async () => {
    const { document, role } = receptionistHotel();
    const unit = createCatalogObject(document, { type: 'unit', name: 'Front office' });
    expect((await refusal(() => deleteCatalogObject(unit.document, { id: role.id, replaceWith: unit.object.id }))).problem.reason).toBe('replace-type');
    expect((await refusal(() => deleteCatalogObject(unit.document, { id: role.id, replaceWith: role.id }))).problem.reason).toBe('replace-self');
    expect((await refusal(() => deleteCatalogObject(unit.document, { id: role.id, replaceWith: 'role-nothere00000' }))).code).toBe('LILA-NO-OBJECT');
    expect(
      (await refusal(() => deleteCatalogObject(unit.document, { id: role.id, replaceWith: unit.object.id, removeReferences: true }))).problem.reason,
    ).toBe('replace-and-remove');
    expect((await refusal(() => deleteCatalogObject(unit.document, { id: role.id, baseRevision: 7, removeReferences: true }))).code).toBe('LILA-REVISION');
  });

  test('uses in other objects count too, and their reference fields follow the delete', async () => {
    const unit = createCatalogObject(hotelDocument(2), { type: 'unit', name: 'Front office' });
    const role = createCatalogObject(unit.document, { type: 'role', name: 'Receptionist', unitRef: unit.object.id });
    const error = await refusal(() => deleteCatalogObject(role.document, { id: unit.object.id }));
    expect(error.problem).toMatchObject({ reason: 'in-use', uses: [{ object: `role/${role.object.id}`, field: 'unitRef' }] });
    const result = await deleteCatalogObject(role.document, { id: unit.object.id, removeReferences: true });
    expect(getCatalogObject(result.document, { id: role.object.id })).toEqual({ type: 'role', id: role.object.id, name: 'Receptionist', revision: 2 });
    expect(result.change.updated).toEqual([`role/${role.object.id}`]);
  });
});

describe('adoptReference', () => {
  test('a value of the id grammar becomes the id, and no model is rewritten', async () => {
    const before = hotelDocument(2, { handTyped: true });
    const result = await adoptReference(before, { type: 'role', ref: 'cajero' });
    expect(result.object).toEqual({ type: 'role', id: 'cajero', name: 'cajero', revision: 1 });
    expect(result.change).toMatchObject({ created: ['role/cajero'], processes: [], wouldUpgrade: true });
    expect(processesOf(result.document).map((p) => p.model)).toEqual(processesOf(before).map((p) => p.model));
  });

  test('any other value gets a generated id and every reference is rewritten', async () => {
    const before = hotelDocument(2, { handTyped: true });
    const result = await adoptReference(before, { type: 'system', ref: 'POS', name: 'Point of sale' });
    const id = result.object.id;
    expect(id).toMatch(/^system-[0-9a-z]{12}$/);
    expect(result.object.name).toBe('Point of sale');
    expect(result.change.processes.map((p) => p.slug)).toEqual(['check-in', 'check-out', 'room-service']);
    for (const p of processesOf(result.document)) {
      expect(p.model.xml).toContain(`<lila:systemRef ref="${id}" />`);
      expect(p.model.xml).not.toContain('"POS"');
      expect(p.model.xml).toContain('roleRef="cajero"'); // other kinds untouched
      expect(p.model.revision).toBe(2);
    }
  });

  test('on a version 1 project it reports the upgrade', async () => {
    const result = await adoptReference(hotelDocument(1, { handTyped: true }), { type: 'role', ref: 'cajero' });
    expect(result.change.wouldUpgrade).toBe(true);
    expect(decodeLila(encodeLila(result.document)).catalog).toEqual([result.object]);
  });

  test('a reserved name or an id taken by another type gets a generated id; a resolved one is refused', async () => {
    const reserved = await adoptReference(hotelDocument(2), { type: 'role', ref: 'con' });
    expect(reserved.object.id).toMatch(/^role-/);
    const taken = await adoptReference(hotelDocument(2, { handTyped: true }), { type: 'unit', ref: 'cajero' });
    const again = await adoptReference(taken.document, { type: 'role', ref: 'cajero' });
    expect(again.object.id).toMatch(/^role-/);
    expect(processesOf(again.document)[0]!.model.xml).toContain(`roleRef="${again.object.id}"`);
    expect((await refusal(() => adoptReference(taken.document, { type: 'unit', ref: 'cajero' }))).problem.reason).toBe('already-resolved');
    expect((await refusal(() => adoptReference(taken.document, { type: 'unit', ref: '  ' }))).problem.reason).toBe('empty-ref');
  });
});

describe('getCatalogObject', () => {
  test('several types sharing an id need the type', async () => {
    const unit = await adoptReference(hotelDocument(2), { type: 'unit', ref: 'desk' });
    const both: ProjectDocument = { ...unit.document, catalog: [...unit.document.catalog!, { type: 'role', id: 'desk', name: 'Desk', revision: 1 }] };
    expect((await refusal(() => getCatalogObject(both, { id: 'desk' }))).problem).toEqual({ reason: 'ambiguous-id', id: 'desk', types: ['role', 'unit'] });
    expect(getCatalogObject(both, { id: 'desk', type: 'role' }).name).toBe('Desk');
  });
});
