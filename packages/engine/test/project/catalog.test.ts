/**
 * Repository version 3 with a catalog (#92, RM-01 §§ 1–2, ADR-032): the object grammar and ids,
 * the archive codec on a hand-zipped synthetic fixture, the one-way upgrade, and the entries kept
 * beside the document.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';

import {
  asVersion3,
  canonicalCatalogObject,
  catalogObjectProblem,
  decodeLila,
  decodeLilaArchive,
  encodeLila,
  formatVersionOf,
  isAdoptableId,
  isCatalogId,
  lilaEntryNames,
  newCatalogId,
  newProcessId,
  processesOf,
  ProjectFormatError,
  readProjectDocument,
  upgradesToVersion3,
  withCatalog,
  withProcesses,
  type CatalogObject,
  type ProjectDocument,
} from '../../src/project/index.js';
import {
  BILLING_ID,
  BOOKING_SYSTEM,
  BROKEN,
  CHECK_IN_FORM,
  FRONT_DESK_ID,
  FRONT_OFFICE,
  NO_SHOW_RISK,
  RECEPTIONIST,
  v3Entries,
  v3Fixture,
} from './fixtures/lila-v3.js';

const MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs_1" targetNamespace="https://lila-modeler.org/bpmn">
  <bpmn:process id="Process_Reception" isExecutable="false"><bpmn:task id="Task_1" name="Welcome the guest" /></bpmn:process>
</bpmn:definitions>
`;

/** A version 1 project with one process and no catalog. */
const v1: ProjectDocument = {
  version: 1,
  id: 'c2f4e6a8-1b3d-4f5a-8c7e-9d0b2a4c6e8f',
  name: 'Reception',
  model: { id: 'Process_Reception', name: 'model.bpmn', xml: MODEL, revision: 1 },
  scenarios: { 'as-is.scenario.json': { version: 1, name: 'AS-IS', model: 'model.bpmn' } },
  scenarioRevisions: { 'as-is.scenario.json': 1 },
  runs: [],
};

const receptionist: CatalogObject = { type: 'role', id: 'role-0a1b2c3d4e5f', name: 'Receptionist', revision: 1 };

function manifestOf(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(strFromU8(unzipSync(bytes)['lila-project.json']!)) as Record<string, unknown>;
}

describe('catalog ids (RM-01 § 2.3)', () => {
  test('a generated id is <type>-<12 of [0-9a-z]> and they do not repeat', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newCatalogId('role')));
    expect(ids.size).toBe(2000);
    for (const id of ids) expect(id).toMatch(/^role-[0-9a-z]{12}$/);
    expect(newProcessId()).toMatch(/^process-[0-9a-z]{12}$/);
    expect(newCatalogId('cost-centre')).toMatch(/^cost-centre-[0-9a-z]{12}$/);
    expect(() => newCatalogId('Role')).toThrow(RangeError);
  });

  test('the grammar is the slug grammar; reserved Windows names are not adopted', () => {
    expect(isCatalogId('rol-1')).toBe(true);
    expect(isCatalogId('sys-crm')).toBe(true);
    expect(isCatalogId('Credit Analyst')).toBe(false);
    expect(isCatalogId('-x')).toBe(false);
    expect(isCatalogId('a'.repeat(65))).toBe(false);
    expect(isAdoptableId('rol-1')).toBe(true);
    expect(isAdoptableId('Credit Analyst')).toBe(false);
    for (const reserved of ['con', 'nul', 'com1', 'lpt9', 'aux', 'prn']) {
      expect(isCatalogId(reserved)).toBe(true);
      expect(isAdoptableId(reserved)).toBe(false);
    }
  });
});

describe('catalog objects (RM-01 § 2.1, § 2.2)', () => {
  test('the envelope and the type fields are checked; unknown types are the envelope only', () => {
    expect(catalogObjectProblem(receptionist)).toBeNull();
    expect(catalogObjectProblem({ ...receptionist, name: '  ' })).toMatch(/name/);
    expect(catalogObjectProblem({ ...receptionist, revision: 0 })).toMatch(/revision/);
    expect(catalogObjectProblem({ ...receptionist, attributes: [{ name: 'x' }] })).toMatch(/attributes/);
    expect(catalogObjectProblem({ ...receptionist, unitRef: 7 })).toMatch(/unitRef/);
    expect(catalogObjectProblem({ type: 'document', id: 'd-1', name: 'Form', revision: 1, url: 'https://example.org/f' })).toBeNull();
    expect(catalogObjectProblem({ type: 'document', id: 'd-1', name: 'Form', revision: 1, url: 'javascript:alert(1)' })).toMatch(/url/);
    expect(catalogObjectProblem({ type: 'risk', id: 'risk-1', name: 'Late', revision: 1, url: 7, unitRef: [] })).toBeNull();
    expect(catalogObjectProblem(receptionist, { type: 'unit', id: receptionist.id })).toMatch(/entry path/);
  });

  test('a writer puts the known fields first and keeps the others in their order', () => {
    const object = { vendor: 'x', revision: 1, url: 'https://example.org', name: 'CRM', zeta: 1, id: 'sys-crm', type: 'system' } as CatalogObject;
    expect(Object.keys(canonicalCatalogObject(object))).toEqual(['type', 'id', 'name', 'revision', 'url', 'vendor', 'zeta']);
  });
});

describe('the version 3 archive (RM-01 § 1)', () => {
  test('the fixture reads: processes with ids, every object, the broken one explained, maps/ and risk silent', () => {
    const { document, preserved } = decodeLilaArchive(v3Fixture());
    expect(document.formatVersion).toBe(3);
    expect(processesOf(document).map((p) => [p.id, p.slug])).toEqual([[FRONT_DESK_ID, 'front-desk'], [BILLING_ID, 'billing']]);
    expect(document.catalog?.map((o) => `${o.type}/${o.id}`)).toEqual([
      `document/${CHECK_IN_FORM}`,
      `risk/${NO_SHOW_RISK}`,
      `role/${RECEPTIONIST}`,
      `system/${BOOKING_SYSTEM}`,
      `unit/${FRONT_OFFICE}`,
    ]);
    expect(document.catalog?.find((o) => o.id === CHECK_IN_FORM)?.url).toBe('https://example.org/forms/check-in');
    // An unknown field survives, and so does every field of a type this build does not know.
    expect(document.catalog?.find((o) => o.id === BOOKING_SYSTEM)?.vendor).toBe('In-house');
    expect(document.catalog?.find((o) => o.id === NO_SHOW_RISK)?.likelihood).toBe('medium');
    expect(document.problems).toEqual([
      { file: `catalog/role/${BROKEN}.json`, message: expect.stringMatching(/"name".*kept as is\.$/) },
    ]);
    expect(Object.keys(preserved.entries)).toEqual([`catalog/role/${BROKEN}.json`, 'maps/x.json']);
    expect(preserved.slugs).toEqual(['front-desk', 'billing']);
    expect(formatVersionOf(document)).toBe(3);
  });

  test('decode → encode gives back the fixture byte for byte, and a second save the same bytes', () => {
    for (const notes of [false, true]) {
      const fixture = v3Fixture({ notes });
      const first = decodeLilaArchive(fixture);
      const saved = encodeLila(first.document, first.preserved);
      expect(Buffer.from(saved).equals(Buffer.from(fixture))).toBe(true);
      const second = decodeLilaArchive(saved);
      expect(Buffer.from(encodeLila(second.document, second.preserved)).equals(Buffer.from(fixture))).toBe(true);
      expect([...lilaEntryNames(saved)]).toEqual(v3Entries({ notes }).map(([name]) => name));
    }
  });

  test('without the kept entries the document still saves its catalog, and nothing else of the extras', () => {
    const names = [...lilaEntryNames(encodeLila(decodeLila(v3Fixture())))];
    expect(names).toContain(`catalog/risk/${NO_SHOW_RISK}.json`);
    expect(names).not.toContain('maps/x.json');
    expect(names).not.toContain(`catalog/role/${BROKEN}.json`);
  });

  test('an edited object is written canonically; the unchanged ones keep their bytes', () => {
    const { document, preserved } = decodeLilaArchive(v3Fixture());
    const catalog = document.catalog!.map((o) => (o.id === BOOKING_SYSTEM ? { ...o, name: 'Reservations', revision: 2 } : o));
    const entries = unzipSync(encodeLila(withCatalog(document, catalog), preserved));
    expect(strFromU8(entries[`catalog/system/${BOOKING_SYSTEM}.json`]!)).toBe(
      `${JSON.stringify({ type: 'system', id: BOOKING_SYSTEM, name: 'Reservations', revision: 2, ownerRef: RECEPTIONIST, vendor: 'In-house' }, null, 2)}\n`,
    );
    const original = Object.fromEntries(v3Entries());
    expect(strFromU8(entries[`catalog/document/${CHECK_IN_FORM}.json`]!)).toBe(original[`catalog/document/${CHECK_IN_FORM}.json`]);
  });

  test('the same id under two types: both load, and it is reported', () => {
    const entries = unzipSync(v3Fixture());
    entries[`catalog/unit/${RECEPTIONIST}.json`] = strToU8(JSON.stringify({ type: 'unit', id: RECEPTIONIST, name: 'Twin', revision: 1 }));
    const document = decodeLila(zipSync(entries));
    expect(document.catalog?.filter((o) => o.id === RECEPTIONIST).map((o) => o.type)).toEqual(['role', 'unit']);
    expect(document.problems?.map((p) => p.file)).toContain(`catalog/unit/${RECEPTIONIST}.json`);
  });

  test('an object whose path disagrees with it, or that is not JSON, is excluded and kept', () => {
    const entries = unzipSync(v3Fixture());
    entries['catalog/unit/unit-elsewhere.json'] = strToU8(JSON.stringify({ type: 'unit', id: 'unit-other', name: 'X', revision: 1 }));
    entries['catalog/unit/unit-garbled.json'] = strToU8('{ not json');
    entries['catalog/Unit/unit-x.json'] = strToU8('{}');
    const { document, preserved } = decodeLilaArchive(zipSync(entries));
    expect(document.catalog?.map((o) => o.id)).not.toContain('unit-other');
    const files = document.problems!.map((p) => p.file);
    expect(files).toEqual(expect.arrayContaining(['catalog/unit/unit-elsewhere.json', 'catalog/unit/unit-garbled.json', 'catalog/Unit/unit-x.json']));
    const saved = unzipSync(encodeLila(document, preserved));
    expect(strFromU8(saved['catalog/unit/unit-garbled.json']!)).toBe('{ not json');
    expect(saved['catalog/Unit/unit-x.json']).toBeDefined();
  });

  test('a version 3 manifest without process ids, or with one twice, is refused', () => {
    const entries = unzipSync(v3Fixture());
    const manifest = manifestOf(v3Fixture()) as { processes: { id?: string }[] };
    delete manifest.processes[1]!.id;
    entries['lila-project.json'] = strToU8(JSON.stringify(manifest));
    expect(() => decodeLila(zipSync(entries))).toThrow(/needs an "id"/);
    manifest.processes[1]!.id = FRONT_DESK_ID;
    entries['lila-project.json'] = strToU8(JSON.stringify(manifest));
    expect(() => decodeLila(zipSync(entries))).toThrow(/repeated/);
  });

  test('a version 4 manifest is refused with LILA-MANIFEST', () => {
    const entries = unzipSync(v3Fixture());
    entries['lila-project.json'] = strToU8(JSON.stringify({ ...manifestOf(v3Fixture()), version: 4 }));
    let error: unknown;
    try {
      decodeLila(zipSync(entries));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ProjectFormatError);
    expect((error as ProjectFormatError).code).toBe('LILA-MANIFEST');
    expect((error as Error).message).toMatch(/version 4; this reader understands versions 1, 2 and 3/);
  });

  test('limits are written back as found; an invalid member is reported, not fixed', () => {
    const entries = unzipSync(v3Fixture());
    const limits = { attachmentBytes: 52428800, repositoryBytes: -1 };
    entries['lila-project.json'] = strToU8(`${JSON.stringify({ ...manifestOf(v3Fixture()), limits }, null, 2)}\n`);
    const { document, preserved } = decodeLilaArchive(zipSync(entries));
    expect(document.limits).toEqual(limits);
    expect(document.problems?.find((p) => p.file === 'lila-project.json')?.message).toMatch(/limits\.repositoryBytes/);
    expect(manifestOf(encodeLila(document, preserved)).limits).toEqual(limits);
  });
});

describe('the upgrade to version 3 (RM-01 § 1.3)', () => {
  test('adding a role to a version 1 project writes version 3 and is an upgrade; removing it stays version 3', () => {
    expect(formatVersionOf(v1)).toBe(1);
    const added = withCatalog(v1, [receptionist]);
    expect(upgradesToVersion3(v1, added)).toBe(true);
    const bytes = encodeLila(added);
    const manifest = manifestOf(bytes) as { version: number; processes: { id: string; slug: string }[] };
    expect(manifest.version).toBe(3);
    expect(manifest.processes).toHaveLength(1);
    expect(manifest.processes[0]!.id).toMatch(/^process-[0-9a-z]{12}$/);
    expect(manifest.processes[0]!.slug).toBe('reception');
    expect([...lilaEntryNames(bytes)]).toEqual([
      'lila-project.json',
      'processes/reception/model.bpmn',
      'processes/reception/as-is.scenario.json',
      'catalog/role/role-0a1b2c3d4e5f.json',
    ]);
    // The process id is chosen once, in memory: two saves of the upgraded document are identical.
    expect(Buffer.from(encodeLila(added)).equals(Buffer.from(bytes))).toBe(true);

    const removed = withCatalog(added, []);
    expect(upgradesToVersion3(added, removed)).toBe(false);
    expect(formatVersionOf(removed)).toBe(3);
    const after = manifestOf(encodeLila(removed)) as { version: number; processes: { id: string }[] };
    expect(after.version).toBe(3);
    expect(after.processes[0]!.id).toBe(manifest.processes[0]!.id);
    // And it reads back as version 3, with the same id, nothing in the catalog.
    const reopened = decodeLila(encodeLila(removed));
    expect(reopened.formatVersion).toBe(3);
    expect(reopened.catalog).toEqual([]);
    expect(processesOf(reopened)[0]!.id).toBe(manifest.processes[0]!.id);
  });

  test('a change that adds no object is not an upgrade, and neither is one to a version 3 document', () => {
    expect(upgradesToVersion3(v1, { ...v1, name: 'Renamed' })).toBe(false);
    const v3 = decodeLila(v3Fixture());
    expect(upgradesToVersion3(v3, withCatalog(v3, [...v3.catalog!, receptionist]))).toBe(false);
  });

  test('asVersion3 keeps existing ids and is idempotent', () => {
    const once = asVersion3(v1);
    expect(asVersion3(once)).toEqual(once);
    const v3 = decodeLila(v3Fixture());
    expect(processesOf(asVersion3(v3)).map((p) => p.id)).toEqual([FRONT_DESK_ID, BILLING_ID]);
  });

  test('a version 3 project with one process is not folded to version 1', () => {
    const v3 = decodeLila(v3Fixture());
    const [frontDesk] = processesOf(v3);
    const single = withProcesses(v3, [frontDesk!]);
    expect(single.process).toEqual({ id: FRONT_DESK_ID, slug: 'front-desk', name: 'Front desk' });
    const bytes = encodeLila(single);
    expect(manifestOf(bytes).version).toBe(3);
    expect([...lilaEntryNames(bytes)]).toContain('processes/front-desk/model.bpmn');
    expect([...lilaEntryNames(bytes)]).not.toContain('model.bpmn');
  });

  test('a catalog object or a reserved name in a version 1 archive makes it version 3 on the next save', () => {
    const entries = unzipSync(encodeLila(v1));
    entries['catalog/role/rol-1.json'] = strToU8(JSON.stringify({ type: 'role', id: 'rol-1', name: 'Cashier', revision: 1 }));
    const read = decodeLilaArchive(zipSync(entries));
    expect(read.document.formatVersion).toBe(3);
    expect(read.document.catalog?.map((o) => o.id)).toEqual(['rol-1']);
    const names = [...lilaEntryNames(encodeLila(read.document, read.preserved))];
    expect(names).toEqual(['lila-project.json', 'processes/reception/model.bpmn', 'processes/reception/as-is.scenario.json', 'catalog/role/rol-1.json']);

    const withMaps = unzipSync(encodeLila(v1));
    withMaps['maps/x.json'] = strToU8('{}');
    const mapped = decodeLilaArchive(zipSync(withMaps));
    expect(mapped.document.problems).toBeUndefined();
    expect(manifestOf(encodeLila(mapped.document, mapped.preserved)).version).toBe(3);
  });

  test('the kept entries of a process deleted in the session leave with it', () => {
    const entries = unzipSync(v3Fixture());
    entries['processes/billing/notes.md'] = strToU8('billing notes');
    entries['processes/billing/process.json'] = strToU8('{}');
    entries['processes/front-desk/process.json'] = strToU8('{}');
    const { document, preserved } = decodeLilaArchive(zipSync(entries));
    // `process.json` of a listed process is a reserved name: kept without a report.
    expect(document.problems?.map((p) => p.file)).toEqual([`catalog/role/${BROKEN}.json`, 'processes/billing/notes.md']);
    const [frontDesk] = processesOf(document);
    const names = [...lilaEntryNames(encodeLila(withProcesses(document, [frontDesk!]), preserved))];
    expect(names.filter((n) => n.startsWith('processes/billing/'))).toEqual([]);
    expect(names).toContain('processes/front-desk/process.json');
  });
});

describe('the document', () => {
  test('validation accepts the catalog and refuses a broken object, a type and id twice, or a bad process id', () => {
    const v3 = decodeLila(v3Fixture());
    expect(readProjectDocument(v3)).toBe(v3);
    expect(() => readProjectDocument({ ...v3, catalog: [{ type: 'role', id: 'x' }] })).toThrow(/not a Lila project/);
    expect(() => readProjectDocument({ ...v3, catalog: [receptionist, receptionist] })).toThrow(/not a Lila project/);
    expect(() => readProjectDocument({ ...v3, formatVersion: 4 })).toThrow(/not a Lila project/);
    expect(() => readProjectDocument({ ...v3, process: { ...v3.process!, id: 'Not An Id' } })).toThrow(/not a Lila project/);
    expect(() => readProjectDocument({ ...v3, processes: v3.processes!.map((p) => ({ ...p, id: FRONT_DESK_ID })) })).toThrow(
      /not a Lila project/,
    );
  });

  test('survives JSON, as the browser mirror stores it', () => {
    const v3 = decodeLila(v3Fixture());
    expect(readProjectDocument(JSON.parse(JSON.stringify(v3)))).toEqual(v3);
    expect(structuredClone(v3)).toEqual(v3);
  });
});
