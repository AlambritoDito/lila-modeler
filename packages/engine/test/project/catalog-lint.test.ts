/**
 * The catalog lint of #95 (RM-01 § 3.4): `W-REF-SIN-CATALOGO` for a BPMN reference that matches no
 * object of the type it expects, `W-ACTIVIDAD-SIN-RESPONSABLE` for an activity without an R, and
 * nothing at all for a version 1 or 2 project. Synthetic hotel of `fixtures/catalog-hotel.ts`.
 */
import { describe, expect, test } from 'vitest';

import { AnnotationContentLossError } from '../../src/bpmn/annotate.js';
import {
  asVersion3,
  lintCatalog,
  processesOf,
  usageIndex,
  withProcesses,
  type CatalogObject,
  type ProjectDocument,
} from '../../src/project/index.js';
import { HOTEL_PROCESSES, hotelDocument, hotelModel } from './fixtures/catalog-hotel.js';

const RECEPTIONIST: CatalogObject = { type: 'role', id: 'role-7k2m9q4x1pzd', name: 'Receptionist', revision: 1, unitRef: 'unit-b3r8w1c6k0qe' };
const FRONT_OFFICE: CatalogObject = { type: 'unit', id: 'unit-b3r8w1c6k0qe', name: 'Front office', revision: 1 };
/** Its owner matches no object: an object reference, which the lint does not report. */
const PMS: CatalogObject = { type: 'system', id: 'system-m4q8w2k6z1rd', name: 'Property management', revision: 1, ownerRef: 'role-gone00000000' };
const NO_SHOW: CatalogObject = { type: 'risk', id: 'risk-c5n2v8b1x7qa', name: 'No-show', revision: 1 };

const R = `<lila:responsibility type="R" roleRef="${RECEPTIONIST.id}" />`;

/** The hotel v3 with the four objects above; `xml(slug)` replaces a process's model when it answers one. */
function hotel(extensions: (slug: string) => string, xml: (slug: string) => string | undefined = () => undefined): ProjectDocument {
  const base = asVersion3({ ...hotelDocument(2), catalog: [RECEPTIONIST, FRONT_OFFICE, PMS, NO_SHOW] });
  const processes = processesOf(base).map((p) => {
    const spec = HOTEL_PROCESSES.find((h) => h.slug === p.slug)!;
    return { ...p, model: { ...p.model, xml: xml(p.slug) ?? hotelModel(spec.bpmnId, spec.name, spec.task, extensions(p.slug)) } };
  });
  return withProcesses(base, processes);
}

/** A model with every kind of node: only the five activities may get `W-ACTIVIDAD-SIN-RESPONSABLE`. */
function everyKind(raci: string): string {
  const ext = (body: string): string => (body === '' ? '' : `<bpmn:extensionElements>${body}</bpmn:extensionElements>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="Defs_Kinds" targetNamespace="https://lila-modeler.org/bpmn">
  <bpmn:process id="Process_Kinds" isExecutable="false">
    <bpmn:laneSet id="LaneSet_1"><bpmn:lane id="Lane_Desk" name="Desk">${ext(R)}<bpmn:flowNodeRef>Start_1</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
    <bpmn:startEvent id="Start_1">${ext(R)}</bpmn:startEvent>
    <bpmn:userTask id="Task_User">${ext(raci)}</bpmn:userTask>
    <bpmn:serviceTask id="Task_Service">${ext(R)}</bpmn:serviceTask>
    <bpmn:exclusiveGateway id="Gateway_1" />
    <bpmn:intermediateThrowEvent id="Event_1" />
    <bpmn:subProcess id="Sub_1">
      <bpmn:task id="Task_Inner" />
    </bpmn:subProcess>
    <bpmn:callActivity id="Call_1" calledElement="Process_Other" />
    <bpmn:endEvent id="End_1" />
  </bpmn:process>
</bpmn:definitions>
`;
}

describe('lintCatalog (#95)', () => {
  test('the Receptionist on every task: no warning; one task hand-edited to roleRef="ghost": one', async () => {
    expect(await lintCatalog(hotel(() => R))).toEqual([]);

    const edited = hotel((slug) => (slug === 'check-out' ? R.replace(RECEPTIONIST.id, 'ghost') : R));
    const ids = processesOf(edited).map((p) => p.id!);
    const warnings = await lintCatalog(edited);
    expect(warnings).toEqual([
      {
        code: 'W-REF-SIN-CATALOGO',
        process: ids[1],
        slug: 'check-out',
        element: 'Task_1',
        relation: 'responsibility:R',
        type: 'role',
        ref: 'ghost',
        message: `Task_1 (process ${ids[1]}): the responsibility:R reference "ghost" matches no role object in the catalog; it is kept as it is.`,
      },
    ]);
    // An R whose role is missing is still a Responsible: no `W-ACTIVIDAD-SIN-RESPONSABLE` on top.
    const [es] = await lintCatalog(edited, undefined, { locale: 'es' });
    expect(es!.message).toBe(`Task_1 (proceso ${ids[1]}): la referencia responsibility:R "ghost" no coincide con ningún objeto role del catálogo; se conserva tal cual.`);
  });

  test('a task with only A, C or I has no Responsible; events, gateways and lanes never warn', async () => {
    const document = hotel(
      () => R,
      (slug) => (slug === 'room-service' ? everyKind(`<lila:responsibility type="A" roleRef="${RECEPTIONIST.id}" /><lila:responsibility type="C" roleRef="${RECEPTIONIST.id}" /><lila:responsibility type="I" roleRef="${RECEPTIONIST.id}" />`) : undefined),
    );
    const process = processesOf(document)[2]!.id!;
    const warnings = await lintCatalog(document);
    expect(warnings.map((w) => [w.code, w.slug, w.element])).toEqual([
      ['W-ACTIVIDAD-SIN-RESPONSABLE', 'room-service', 'Task_User'],
      ['W-ACTIVIDAD-SIN-RESPONSABLE', 'room-service', 'Sub_1'],
      ['W-ACTIVIDAD-SIN-RESPONSABLE', 'room-service', 'Task_Inner'],
      ['W-ACTIVIDAD-SIN-RESPONSABLE', 'room-service', 'Call_1'],
    ]);
    expect(warnings[0]).toEqual({
      code: 'W-ACTIVIDAD-SIN-RESPONSABLE',
      process,
      slug: 'room-service',
      element: 'Task_User',
      message: `Task_User (process ${process}): the activity has no Responsible role (lila:responsibility type="R").`,
    });
  });

  test('a riskRef to a preserved risk object resolves; one to a missing risk does not', async () => {
    expect(await lintCatalog(hotel(() => `${R}<lila:riskRef ref="${NO_SHOW.id}" />`))).toEqual([]);
    const warnings = await lintCatalog(hotel((slug) => (slug === 'check-in' ? `${R}<lila:riskRef ref="risk-gone00000000" />` : R)));
    expect(warnings.map((w) => [w.code, w.slug, w.relation, w.type, w.ref])).toEqual([
      ['W-REF-SIN-CATALOGO', 'check-in', 'riskRef', 'risk', 'risk-gone00000000'],
    ]);
  });

  test('one warning per process, element, relation and id; a reference resolves only against the type it expects', async () => {
    const document = hotel((slug) =>
      slug === 'check-in'
        ? `${R}<lila:systemRef ref="POS" /><lila:systemRef ref="POS" /><lila:documentRef ref="POS" /><lila:documentRef ref="${PMS.id}" />`
        : R,
    );
    const warnings = await lintCatalog(document);
    expect(warnings.map((w) => [w.relation, w.type, w.ref])).toEqual([
      ['systemRef', 'system', 'POS'],
      ['documentRef', 'document', 'POS'],
      ['documentRef', 'document', PMS.id],
    ]);
    // The system's `ownerRef` matches no role either, but it is not a BPMN reference.
    expect((await usageIndex(document)).unresolved.some((u) => 'object' in u)).toBe(true);
    expect(warnings.some((w) => w.ref === 'role-gone00000000')).toBe(false);
  });

  test('a version 1 or 2 project gets no catalog warnings, whatever its typed ids', async () => {
    for (const version of [1, 2] as const) {
      const document = hotelDocument(version, { handTyped: true });
      expect((await usageIndex(document)).unresolved.length).toBeGreaterThan(0);
      expect(await lintCatalog(document)).toEqual([]);
    }
    expect(await lintCatalog({ ...hotelDocument(2), processes: [] })).toEqual([]);
  });

  test('an empty version 3 catalog: every reference is unresolved', async () => {
    const document = asVersion3(hotelDocument(2, { handTyped: true }));
    const warnings = await lintCatalog(document);
    expect(warnings).toHaveLength(6);
    expect(warnings.map((w) => w.slug)).toEqual(['check-in', 'check-in', 'check-out', 'check-out', 'room-service', 'room-service']);
  });

  test('uses the index it is given, and refuses a model it cannot read without losing content', async () => {
    const document = hotel((slug) => (slug === 'check-out' ? '' : R));
    const index = await usageIndex(document);
    expect(await lintCatalog(document, index)).toEqual(await lintCatalog(document));
    expect((await lintCatalog(document)).map((w) => [w.code, w.slug])).toEqual([['W-ACTIVIDAD-SIN-RESPONSABLE', 'check-out']]);

    const broken = hotel(() => R, (slug) => (slug === 'check-in' ? hotelModel('Process_CheckIn', 'Check-in', 'Twice').replace('id="End_1"', 'id="Task_1"') : undefined));
    await expect(lintCatalog(broken)).rejects.toBeInstanceOf(AnnotationContentLossError);
  });
});
