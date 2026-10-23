/**
 * The usage index of RM-01 § 4 (#672): uses by object, in process order then document order, the
 * unresolved references, and the BPMN process ids declared twice. Synthetic hotel of
 * `fixtures/catalog-hotel.ts`.
 */
import { describe, expect, test } from 'vitest';

import { asVersion3, processesOf, usageIndex, withProcesses, type CatalogObject, type ProjectDocument } from '../../src/project/index.js';
import { HOTEL_PROCESSES, hotelDocument, hotelModel } from './fixtures/catalog-hotel.js';

const RECEPTIONIST: CatalogObject = { type: 'role', id: 'role-7k2m9q4x1pzd', name: 'Receptionist', revision: 1, unitRef: 'unit-b3r8w1c6k0qe' };
const FRONT_OFFICE: CatalogObject = { type: 'unit', id: 'unit-b3r8w1c6k0qe', name: 'Front office', revision: 1 };
const PMS: CatalogObject = { type: 'system', id: 'system-m4q8w2k6z1rd', name: 'Property management', revision: 1, ownerRef: 'role-gone00000000' };
const NO_SHOW: CatalogObject = { type: 'risk', id: 'risk-c5n2v8b1x7qa', name: 'No-show', revision: 1 };

/** The hotel v3 with `extensions(slug)` on the task of every process, and the four objects above. */
function hotel(extensions: (slug: string) => string, bpmnId: (slug: string) => string = (slug) => HOTEL_PROCESSES.find((p) => p.slug === slug)!.bpmnId): ProjectDocument {
  const base = asVersion3({ ...hotelDocument(2), catalog: [RECEPTIONIST, FRONT_OFFICE, PMS, NO_SHOW] });
  const processes = processesOf(base).map((p) => {
    const spec = HOTEL_PROCESSES.find((h) => h.slug === p.slug)!;
    return { ...p, model: { ...p.model, xml: hotelModel(bpmnId(p.slug), spec.name, spec.task, extensions(p.slug)) } };
  });
  return withProcesses(base, processes);
}

describe('usageIndex', () => {
  test('lists the uses of every object, in process order and then document order', async () => {
    const document = hotel((slug) =>
      slug === 'check-out'
        ? `<lila:systemRef ref="${PMS.id}" /><lila:responsibility type="A" roleRef="${RECEPTIONIST.id}" /><lila:riskRef ref="${NO_SHOW.id}" />`
        : `<lila:responsibility type="R" roleRef="${RECEPTIONIST.id}" />`,
    );
    const ids = processesOf(document).map((p) => p.id!);
    const index = await usageIndex(document);
    expect(Object.keys(index.uses).sort()).toEqual([`risk/${NO_SHOW.id}`, `role/${RECEPTIONIST.id}`, `system/${PMS.id}`, `unit/${FRONT_OFFICE.id}`]);
    expect(index.uses[`role/${RECEPTIONIST.id}`]).toEqual([
      { process: ids[0], slug: 'check-in', element: 'Task_1', relation: 'responsibility:R' },
      { process: ids[1], slug: 'check-out', element: 'Task_1', relation: 'responsibility:A' },
      { process: ids[2], slug: 'room-service', element: 'Task_1', relation: 'responsibility:R' },
    ]);
    expect(index.uses[`system/${PMS.id}`]).toEqual([{ process: ids[1], slug: 'check-out', element: 'Task_1', relation: 'systemRef' }]);
    // A type this build does not know still resolves its references (RM-01 § 2.4).
    expect(index.uses[`risk/${NO_SHOW.id}`]).toEqual([{ process: ids[1], slug: 'check-out', element: 'Task_1', relation: 'riskRef' }]);
    expect(index.uses[`unit/${FRONT_OFFICE.id}`]).toEqual([{ object: `role/${RECEPTIONIST.id}`, field: 'unitRef' }]);
    // The owner role of the system matches no object.
    expect(index.unresolved).toEqual([{ object: `system/${PMS.id}`, field: 'ownerRef', type: 'role', id: 'role-gone00000000' }]);
    expect(index.duplicateProcessIds).toEqual([]);
  });

  test('a reference resolves only against the type it expects', async () => {
    const document = hotel((slug) => (slug === 'check-in' ? `<lila:documentRef ref="${PMS.id}" /><lila:input ref="form-1" />` : ''));
    const index = await usageIndex(document);
    expect(index.uses[`system/${PMS.id}`]).toEqual([]);
    expect(index.unresolved.filter((u) => 'element' in u)).toEqual([
      { process: processesOf(document)[0]!.id, slug: 'check-in', element: 'Task_1', relation: 'documentRef', type: 'document', id: PMS.id },
      { process: processesOf(document)[0]!.id, slug: 'check-in', element: 'Task_1', relation: 'input', type: 'document', id: 'form-1' },
    ]);
  });

  test('reports BPMN process ids declared by more than one process', async () => {
    const index = await usageIndex(hotel(() => '', (slug) => (slug === 'room-service' ? 'Process_RoomService' : 'Process_Front')));
    expect(index.duplicateProcessIds).toEqual([{ id: 'Process_Front', slugs: ['check-in', 'check-out'] }]);
  });

  test('a version 2 document has no process ids and no catalog: every reference is unresolved', async () => {
    const index = await usageIndex(hotelDocument(2, { handTyped: true }));
    expect(index.uses).toEqual({});
    expect(index.unresolved).toHaveLength(6);
    expect(index.unresolved[0]).toEqual({ slug: 'check-in', element: 'Task_1', relation: 'responsibility:R', type: 'role', id: 'cajero' });
    expect(index.unresolved[1]).toEqual({ slug: 'check-in', element: 'Task_1', relation: 'systemRef', type: 'system', id: 'POS' });
  });
});
