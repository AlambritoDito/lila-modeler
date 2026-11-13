/**
 * The catalog panel's logic (#674): grouping and search, the repeated-name warning, and the usage
 * index built process by process, held equal to the engine's `usageIndex` of the whole document.
 *
 * The fixture is synthetic (`docs/EXAMPLES_POLICY.md`): a front office with three processes.
 */
import { usageIndex, withCatalog, withProcesses, type CatalogObject, type ProcessDocument, type ProjectDocument } from '@lila-modeler/engine/project';
import { describe, expect, it } from 'vitest';
import { buildIndex, groupCatalog, isProcessUse, repeatsName, scanProcesses, unitDescendants, usesOf, type ScanCache } from './catalogo';

const RECEPTIONIST: CatalogObject = { type: 'role', id: 'role-rec', name: 'Receptionist', revision: 1, unitRef: 'unit-front' };
const CASHIER: CatalogObject = { type: 'role', id: 'role-cash', name: 'Cajéro', revision: 1, unitRef: 'unit-gone' };
const FRONT: CatalogObject = { type: 'unit', id: 'unit-front', name: 'Front office', revision: 1 };
const PMS: CatalogObject = { type: 'system', id: 'sys-pms', name: 'PMS', revision: 1, ownerRef: 'role-rec' };
const RISK: CatalogObject = { type: 'risk', id: 'risk-x', name: 'Overbooking', revision: 1 };
const CONTROL: CatalogObject = { type: 'control', id: 'control-a', name: 'Audit', revision: 1 };
const CATALOG = [RISK, PMS, CASHIER, RECEPTIONIST, FRONT, CONTROL];

const xml = (process: string, task: string, extensions: string): string => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="D_${process}" targetNamespace="urn:test">
  <bpmn:process id="${process}">
    <bpmn:task id="${task}" name="${task}">
      <bpmn:extensionElements>${extensions}</bpmn:extensionElements>
    </bpmn:task>
  </bpmn:process>
</bpmn:definitions>`;

const proceso = (slug: string, id: string, model: string): ProcessDocument => ({
  id, slug, name: slug, model: { id: `Process_${slug}`, name: 'model.bpmn', xml: model, revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [],
});
const PROCESSES = [
  proceso('check-in', 'process-aaaaaaaaaaaa', xml('Process_in', 'Task_Welcome', '<lila:responsibility type="R" roleRef="role-rec" /><lila:systemRef ref="sys-pms" />')),
  proceso('billing', 'process-bbbbbbbbbbbb', xml('Process_bill', 'Task_Charge', '<lila:responsibility type="A" roleRef="role-rec" /><lila:responsibility type="R" roleRef="ghost" /><lila:riskRef ref="risk-x" />')),
  proceso('check-out', 'process-cccccccccccc', xml('Process_out', 'Task_Farewell', '<lila:responsibility type="R" roleRef="role-rec" /><lila:documentRef ref="doc-missing" />')),
];
const BASE: ProjectDocument = { version: 1, id: 'p', name: 'Front office', model: PROCESSES[0]!.model, scenarios: {}, scenarioRevisions: {}, runs: [] };
const DOCUMENT = withCatalog(withProcesses(BASE, PROCESSES), CATALOG);
const sources = (list: readonly ProcessDocument[] = PROCESSES) => list.map((p) => ({ slug: p.slug, id: p.id, xml: p.model.xml }));

describe('groupCatalog', () => {
  it('lists the four known types in order, then unknown types by token, read-only; objects by name', () => {
    const groups = groupCatalog(CATALOG);
    expect(groups.map((g) => [g.type, g.readOnly, g.objects.map((o) => o.name)])).toEqual([
      ['role', false, ['Cajéro', 'Receptionist']],
      ['unit', false, ['Front office']],
      ['system', false, ['PMS']],
      ['document', false, []],
      ['control', true, ['Audit']],
      ['risk', true, ['Overbooking']],
    ]);
  });

  it('an empty catalog still lists the four known types, empty', () => {
    expect(groupCatalog([]).map((g) => g.type)).toEqual(['role', 'unit', 'system', 'document']);
  });

  it('searches by name (accents and case ignored) and by id, and drops the groups without a match', () => {
    expect(groupCatalog(CATALOG, 'CAJERO').map((g) => [g.type, g.objects.map((o) => o.id)])).toEqual([['role', ['role-cash']]]);
    expect(groupCatalog(CATALOG, 'sys-').map((g) => [g.type, g.objects.map((o) => o.id)])).toEqual([['system', ['sys-pms']]]);
    expect(groupCatalog(CATALOG, 'over').map((g) => [g.type, g.readOnly])).toEqual([['risk', true]]);
    expect(groupCatalog(CATALOG, 'nothing like this')).toEqual([]);
  });
});

describe('repeatsName', () => {
  it('warns when another object of the same type has the name; never for the object itself, another type or an empty name', () => {
    expect(repeatsName(CATALOG, 'role', ' receptionist ')).toBe(true);
    expect(repeatsName(CATALOG, 'role', 'cajero')).toBe(true);
    expect(repeatsName(CATALOG, 'role', 'Receptionist', 'role-rec')).toBe(false);
    expect(repeatsName(CATALOG, 'unit', 'Receptionist')).toBe(false);
    expect(repeatsName(CATALOG, 'role', '   ')).toBe(false);
    expect(repeatsName(CATALOG, 'role', 'Night porter')).toBe(false);
  });
});

describe('unitDescendants', () => {
  it('lists every unit under a unit, at any depth, and survives a cycle already in the file', () => {
    const unit = (id: string, parentRef?: string): CatalogObject => ({ type: 'unit', id, name: id, revision: 1, ...(parentRef !== undefined ? { parentRef } : {}) });
    const units = [unit('a'), unit('b', 'a'), unit('c', 'b'), unit('d'), unit('e', 'c'), { type: 'role', id: 'r', name: 'r', revision: 1, parentRef: 'a' }];
    expect([...unitDescendants(units, 'a')].sort()).toEqual(['b', 'c', 'e']);
    expect([...unitDescendants(units, 'c')]).toEqual(['e']);
    expect([...unitDescendants(units, 'd')]).toEqual([]);
    // A cycle written by hand: x ← y ← x. It ends, and never lists the unit itself.
    expect([...unitDescendants([unit('x', 'y'), unit('y', 'x')], 'x')]).toEqual(['y']);
  });
});

describe('the usage index', () => {
  it('is the engine\'s: the same uses and unresolved references as `usageIndex` of the whole document', async () => {
    const engine = await usageIndex(DOCUMENT);
    const index = buildIndex(CATALOG, await scanProcesses(sources(), new Map()));
    expect(index.uses).toEqual(engine.uses);
    expect(index.unresolved).toEqual(engine.unresolved);
  });

  it('a role used in three processes has three process uses, each with its slug and element, plus the object that owns it', async () => {
    const index = buildIndex(CATALOG, await scanProcesses(sources(), new Map()));
    const uses = usesOf(index, RECEPTIONIST);
    expect(uses).toEqual([
      { process: 'process-aaaaaaaaaaaa', slug: 'check-in', element: 'Task_Welcome', relation: 'responsibility:R' },
      { process: 'process-bbbbbbbbbbbb', slug: 'billing', element: 'Task_Charge', relation: 'responsibility:A' },
      { process: 'process-cccccccccccc', slug: 'check-out', element: 'Task_Farewell', relation: 'responsibility:R' },
      { object: 'system/sys-pms', field: 'ownerRef' },
    ]);
    expect((uses as readonly Parameters<typeof isProcessUse>[0][]).filter(isProcessUse)).toHaveLength(3);
    // An object of a type this build does not know resolves its references too (RM-01 § 2.4).
    expect(usesOf(index, RISK)).toEqual([{ process: 'process-bbbbbbbbbbbb', slug: 'billing', element: 'Task_Charge', relation: 'riskRef' }]);
    expect(usesOf(index, CONTROL)).toEqual([]);
  });

  it('lists the unresolved references of the processes and of the objects, with the type and id each expects', async () => {
    const index = buildIndex(CATALOG, await scanProcesses(sources(), new Map()));
    expect(index.unresolved).toEqual([
      { process: 'process-bbbbbbbbbbbb', slug: 'billing', element: 'Task_Charge', relation: 'responsibility:R', type: 'role', id: 'ghost' },
      { process: 'process-cccccccccccc', slug: 'check-out', element: 'Task_Farewell', relation: 'documentRef', type: 'document', id: 'doc-missing' },
      { object: 'role/role-cash', field: 'unitRef', type: 'unit', id: 'unit-gone' },
    ]);
  });

  it('a version 1 project has no process id: its uses carry the slug alone', async () => {
    const index = buildIndex([RECEPTIONIST, FRONT], await scanProcesses([{ slug: 'front-office', xml: PROCESSES[0]!.model.xml }], new Map()));
    expect(usesOf(index, RECEPTIONIST)).toEqual([{ slug: 'front-office', element: 'Task_Welcome', relation: 'responsibility:R' }]);
  });

  it('editing a process re-scans that process only; a process no longer listed is forgotten', async () => {
    const cache: ScanCache = new Map();
    const first = await scanProcesses(sources(), cache);
    const edited = PROCESSES.map((p) => (p.slug === 'billing' ? { ...p, model: { ...p.model, xml: xml('Process_bill', 'Task_Charge', '<lila:responsibility type="R" roleRef="role-cash" />') } } : p));
    const second = await scanProcesses(sources(edited), cache);
    // The same objects: those two processes were not read again.
    expect(second[0]).toBe(first[0]);
    expect(second[2]).toBe(first[2]);
    expect(second[1]).not.toBe(first[1]);
    expect(second[1]!.references.map((r) => r.id)).toEqual(['role-cash']);
    expect(usesOf(buildIndex(CATALOG, second), RECEPTIONIST)).toHaveLength(3);

    await scanProcesses(sources(edited.slice(0, 1)), cache);
    expect([...cache.keys()]).toEqual(['check-in']);
  });

  it('editing an object needs no scan: the same scans resolve against the new catalog', async () => {
    const scans = await scanProcesses(sources(), new Map());
    const ghost: CatalogObject = { type: 'role', id: 'ghost', name: 'Night porter', revision: 1 };
    const index = buildIndex([...CATALOG, ghost], scans);
    expect(usesOf(index, ghost)).toEqual([{ process: 'process-bbbbbbbbbbbb', slug: 'billing', element: 'Task_Charge', relation: 'responsibility:R' }]);
    expect(index.unresolved.map((r) => r.id)).toEqual(['doc-missing', 'unit-gone']);
  });

  it('a model that cannot be read is an error, not «unused»', async () => {
    await expect(scanProcesses([{ slug: 'broken', xml: '<not-bpmn' }], new Map())).rejects.toThrow();
  });
});

describe('usesOf', () => {
  it('is pending until the index is built, and for an object the index has not seen yet: never an empty list', () => {
    expect(usesOf('pending', RECEPTIONIST)).toBe('pending');
    expect(usesOf('unavailable', RECEPTIONIST)).toBe('unavailable');
    expect(usesOf({ uses: {}, unresolved: [] }, RECEPTIONIST)).toBe('pending');
    expect(usesOf(buildIndex([RECEPTIONIST], []), RECEPTIONIST)).toEqual([]);
  });
});
