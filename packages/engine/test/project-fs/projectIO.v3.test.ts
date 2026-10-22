/**
 * Repository version 3 in a project folder (#671, RM-01 §§ 1, 2.4, 7, 8), with real temporary
 * folders: the #92 fixture in its folder form reads as the archive does and is written back without
 * touching its catalog files, a version 1 folder moves to the version 3 layout all or nothing, a
 * newer manifest is refused before anything is written, and files outside the layout survive.
 */
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeLila, decodeLilaArchive, formatVersionOf, withCatalog } from '../../src/project/index.js';
import type { CatalogObject, ProjectDocument, StoredRun } from '../../src/project/index.js';
import { readProjectFolder, writeProjectFolder, type WriteProjectFsImpl } from '../../src/project-fs/index.js';
import {
  BILLING_ID,
  BOOKING_SYSTEM,
  BROKEN,
  FRONT_DESK_ID,
  NO_SHOW_RISK,
  RECEPTIONIST,
  v3Entries,
  v3Fixture,
} from '../project/fixtures/lila-v3.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'lila-v3-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const XML = `<?xml version="1.0"?><definitions xmlns="http://example.org"><process id="Process_Pedido"/></definitions>`;
const AS_IS = 'as-is.scenario.json';

function run(id: string): StoredRun {
  return { id, scenarioName: AS_IS, result: { kpis: { total: 1 } }, inputs: { modelRevision: 0, scenarioRevision: 0, xml: '', scenario: { version: 1 } } } as unknown as StoredRun;
}

const v1: ProjectDocument = {
  version: 1,
  id: 'repo-1',
  name: 'Pedido',
  model: { id: 'Process_Pedido', name: 'model.bpmn', xml: XML, revision: 3 },
  scenarios: { [AS_IS]: { version: 1, name: 'AS-IS', model: 'model.bpmn' } },
  scenarioRevisions: { [AS_IS]: 2 },
  runs: [run('run-a')],
};

const receptionist: CatalogObject = { type: 'role', id: 'role-0a1b2c3d4e5f', name: 'Receptionist', revision: 1 };

/** Every file under `root` with its content, keyed by its relative path (`/` separators). */
async function files(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[relative(root, path).split('\\').join('/')] = await readFile(path, 'utf8');
  }
  return out;
}

/** The fixture in its folder form: `unzip hotel.lila` (ADR-027), entry by entry. */
async function unzipFixture(options: { readonly notes?: boolean } = {}): Promise<Record<string, string>> {
  const entries = Object.fromEntries(v3Entries(options));
  for (const [name, text] of Object.entries(entries)) {
    await mkdir(dirname(join(dir, name)), { recursive: true });
    await writeFile(join(dir, name), text);
  }
  return entries;
}

/** The document without what only says how it was read. */
function content(document: ProjectDocument): ProjectDocument {
  const { problems: _problems, ...rest } = document;
  return rest;
}

const catalogFiles = (all: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(all).filter(([name]) => name.startsWith('catalog/')));

describe('the #92 version 3 fixture in a folder', () => {
  it('unzipped, it reads as the archive does: the same document, the same catalog problems', async () => {
    await unzipFixture({ notes: true });
    const { document, problems } = await readProjectFolder(dir);
    const archive = decodeLila(v3Fixture({ notes: true }));
    expect(content(document)).toEqual(content(archive));
    expect(document.formatVersion).toBe(3);
    expect(document.process?.id).toBe(FRONT_DESK_ID);
    expect(document.processes?.[0]?.id).toBe(BILLING_ID);
    expect(document.catalog?.map((o) => o.id)).toContain(NO_SHOW_RISK); // A type this build does not know.
    // The broken object is explained in both; the folder says nothing about files outside the layout.
    expect(problems).toEqual(archive.problems?.filter((p) => p.file.startsWith('catalog/')));
    expect(problems.map((p) => p.file)).toEqual([`catalog/role/${BROKEN}.json`]);
    expect(problems[0]!.message).toMatch(/Not loaded; kept as is\.$/);
  });

  it('written back, every catalog file is byte-identical and kept files are untouched; a second write changes nothing', async () => {
    const entries = await unzipFixture({ notes: true });
    const { document } = await readProjectFolder(dir);
    const mtimes = async (): Promise<number[]> =>
      Promise.all(Object.keys(catalogFiles(entries)).map(async (name) => (await stat(join(dir, name))).mtimeMs));
    const before = await mtimes();

    await writeProjectFolder(dir, document);
    const first = await files(dir);
    expect(catalogFiles(first)).toEqual(catalogFiles(entries)); // The compact `system` file included.
    expect(first[`catalog/system/${BOOKING_SYSTEM}.json`]).toBe(entries[`catalog/system/${BOOKING_SYSTEM}.json`]);
    expect(first['maps/x.json']).toBe(entries['maps/x.json']);
    expect(first['notes.md']).toBe(entries['notes.md']);
    // Process files are the fixture's; the manifest is the archive's without the `engine` stamp.
    for (const name of Object.keys(entries).filter((n) => n.startsWith('processes/'))) expect(first[name]).toBe(entries[name]);
    const { engine: _engine, ...manifest } = JSON.parse(entries['lila-project.json']!) as Record<string, unknown>;
    expect(first['lila-project.json']).toBe(`${JSON.stringify(manifest, null, 2)}\n`);
    // Unchanged objects are not even rewritten.
    expect(await mtimes()).toEqual(before);

    const reread = await readProjectFolder(dir);
    expect(content(reread.document)).toEqual(content(document));
    await writeProjectFolder(dir, reread.document);
    expect(await files(dir)).toEqual(first);
  });

  it('decoded and written to an empty folder, it reads back as the same document; a second write changes nothing', async () => {
    const archive = decodeLila(v3Fixture());
    await writeProjectFolder(dir, archive, { saveAs: true });
    const written = await files(dir);
    expect(Object.keys(written).sort()).toEqual([
      `catalog/document/document-x9d2k7m4q1wa.json`,
      `catalog/risk/${NO_SHOW_RISK}.json`,
      `catalog/role/${RECEPTIONIST}.json`,
      `catalog/system/${BOOKING_SYSTEM}.json`,
      `catalog/unit/unit-b3r8w1c6k0qe.json`,
      'lila-project.json',
      'processes/billing/as-is.scenario.json',
      'processes/billing/model.bpmn',
      'processes/front-desk/as-is.scenario.json',
      'processes/front-desk/model.bpmn',
    ]);
    const { document, problems } = await readProjectFolder(dir);
    expect(problems).toEqual([]);
    expect(content(document)).toEqual(content(archive));
    await writeProjectFolder(dir, document);
    expect(await files(dir)).toEqual(written);
  });
});

describe('a version 1 folder becomes version 3 (RM-01 § 1.3, § 7)', () => {
  /** A version 1 folder with a run and two files that are not Lila's. */
  async function v1Folder(): Promise<{ document: ProjectDocument; before: Record<string, string> }> {
    await writeProjectFolder(dir, v1);
    await writeFile(join(dir, 'notes.md'), '# Notes\n');
    await mkdir(join(dir, 'extra'));
    await writeFile(join(dir, 'extra', 'keep.txt'), 'keep me');
    const { document } = await readProjectFolder(dir);
    expect(formatVersionOf(document)).toBe(1);
    return { document, before: await files(dir) };
  }

  it('adding role "Receptionist" moves it to processes/<slug>/ with process ids and writes the object', async () => {
    const { document, before } = await v1Folder();
    const added = withCatalog(document, [receptionist]);
    await writeProjectFolder(dir, added);
    const after = await files(dir);
    expect(Object.keys(after).sort()).toEqual([
      'catalog/role/role-0a1b2c3d4e5f.json',
      'extra/keep.txt',
      'lila-project.json',
      'notes.md',
      'processes/pedido/as-is.scenario.json',
      'processes/pedido/model.bpmn',
      'processes/pedido/runs/run-a.result.json',
    ]);
    expect(after['processes/pedido/model.bpmn']).toBe(before['model.bpmn']);
    expect(after['processes/pedido/as-is.scenario.json']).toBe(before[AS_IS]);
    expect(after['processes/pedido/runs/run-a.result.json']).toBe(before['runs/run-a.result.json']);
    expect(after['catalog/role/role-0a1b2c3d4e5f.json']).toBe(`${JSON.stringify(receptionist, null, 2)}\n`);
    const manifest = JSON.parse(after['lila-project.json']!) as { version: number; processes: { id: string; slug: string }[] };
    expect(manifest.version).toBe(3);
    expect(manifest.processes).toHaveLength(1);
    expect(manifest.processes[0]!.slug).toBe('pedido');
    expect(manifest.processes[0]!.id).toMatch(/^process-[0-9a-z]{12}$/);
    expect(manifest.processes[0]!.id).toBe(added.process?.id);
    expect(manifest).not.toHaveProperty('engine');

    const { document: reread, problems } = await readProjectFolder(dir);
    expect(problems).toEqual([]);
    expect(reread.formatVersion).toBe(3);
    expect(reread.catalog).toEqual([receptionist]);
    expect(reread.process).toEqual(added.process);
    // A second save of what was read writes the same bytes.
    await writeProjectFolder(dir, reread);
    expect(await files(dir)).toEqual(after);
  });

  /** A rename that fails once, on the first rename `fails` matches; the rollback's renames go through. */
  function failingOn(fails: (from: string, to: string) => boolean): WriteProjectFsImpl {
    let failed = false;
    return {
      rename: async (from, to) => {
        if (!failed && fails(from, to)) {
          failed = true;
          throw new Error('simulated failure');
        }
        await rename(from, to);
      },
    };
  }

  const cases: [string, (from: string, to: string) => boolean][] = [
    ['the catalog object', (_from, to) => to.endsWith('role-0a1b2c3d4e5f.json')],
    ['the manifest', (_from, to) => to === join(dir, 'lila-project.json')],
    ['the move of the root model.bpmn (after the manifest)', (from, to) => from === join(dir, 'model.bpmn') && to.includes('.prev-')],
  ];
  for (const [what, fails] of cases) {
    it(`a failure writing ${what} leaves the version 1 folder intact`, async () => {
      const { document, before } = await v1Folder();
      await expect(writeProjectFolder(dir, withCatalog(document, [receptionist]), {}, failingOn(fails))).rejects.toThrow('simulated failure');
      expect(await files(dir)).toEqual(before); // No `.tmp-*`, no `.prev-*`, no `lila-recovery.json`.
      const { document: reread } = await readProjectFolder(dir);
      expect(formatVersionOf(reread)).toBe(1);
      expect(content(reread)).toEqual(content(document));
      // And the next attempt goes through.
      await writeProjectFolder(dir, withCatalog(reread, [receptionist]));
      expect(JSON.parse((await files(dir))['lila-project.json']!).version).toBe(3);
    });
  }

  it('a catalog added to a version 1 folder by hand reads as version 3, with process ids', async () => {
    await writeProjectFolder(dir, v1);
    await mkdir(join(dir, 'catalog', 'role'), { recursive: true });
    await writeFile(join(dir, 'catalog', 'role', `${receptionist.id}.json`), JSON.stringify(receptionist));
    const { document } = await readProjectFolder(dir);
    expect(document.formatVersion).toBe(3);
    expect(document.catalog).toEqual([receptionist]);
    expect(document.process?.id).toMatch(/^process-/);
    // An empty catalog folder is not a catalog.
    await rm(join(dir, 'catalog', 'role', `${receptionist.id}.json`));
    expect((await readProjectFolder(dir)).document.formatVersion).toBeUndefined();
  });
});

describe('versions above 3 and files outside the layout (RM-01 § 1.4)', () => {
  it('a version 4 manifest is refused with E-MANIFEST by the reader and by every writer, and nothing is written', async () => {
    await unzipFixture();
    const manifest = JSON.parse(await readFile(join(dir, 'lila-project.json'), 'utf8')) as Record<string, unknown>;
    await writeFile(join(dir, 'lila-project.json'), JSON.stringify({ ...manifest, version: 4 }));
    await writeFile(join(dir, 'model.bpmn'), XML); // A root model would otherwise be read as version 1.
    const before = await files(dir);
    await expect(readProjectFolder(dir)).rejects.toMatchObject({ code: 'E-MANIFEST', message: /versión 4/ });
    const v3 = decodeLila(v3Fixture());
    await expect(writeProjectFolder(dir, v3)).rejects.toMatchObject({ code: 'E-MANIFEST' });
    await expect(writeProjectFolder(dir, v1)).rejects.toMatchObject({ code: 'E-MANIFEST' });
    await expect(writeProjectFolder(dir, withCatalog(v1, [receptionist]))).rejects.toMatchObject({ code: 'E-MANIFEST' });
    expect(await files(dir)).toEqual(before);
  });

  it('an unknown file and folder survive every write: version 3, an object added, an object removed', async () => {
    await unzipFixture({ notes: true });
    await mkdir(join(dir, 'drafts'));
    await writeFile(join(dir, 'drafts', 'idea.txt'), 'later');
    await writeFile(join(dir, 'catalog', 'role', 'README.txt'), 'not an object');
    const kept = (all: Record<string, string>): Record<string, string | undefined> => ({
      notes: all['notes.md'],
      idea: all['drafts/idea.txt'],
      readme: all['catalog/role/README.txt'],
      broken: all[`catalog/role/${BROKEN}.json`],
      map: all['maps/x.json'],
    });
    const expected = kept(await files(dir));

    const { document } = await readProjectFolder(dir);
    await writeProjectFolder(dir, document);
    expect(kept(await files(dir))).toEqual(expected);

    await writeProjectFolder(dir, withCatalog(document, [...(document.catalog ?? []), receptionist]));
    expect(kept(await files(dir))).toEqual(expected);

    const reread = (await readProjectFolder(dir)).document;
    const removed = withCatalog(reread, (reread.catalog ?? []).filter((o) => o.id !== RECEPTIONIST));
    await writeProjectFolder(dir, removed);
    const after = await files(dir);
    expect(kept(after)).toEqual(expected);
    expect(after).not.toHaveProperty([`catalog/role/${RECEPTIONIST}.json`]);
    expect(after).toHaveProperty([`catalog/risk/${NO_SHOW_RISK}.json`]);
  });
});

describe('catalog objects on disk (RM-01 § 2, § 5.3)', () => {
  it('removing every object keeps version 3 and the process ids', async () => {
    await writeProjectFolder(dir, withCatalog(v1, [receptionist]));
    const read = (await readProjectFolder(dir)).document;
    await writeProjectFolder(dir, withCatalog(read, []));
    const after = await files(dir);
    expect(Object.keys(catalogFiles(after))).toEqual([]);
    const reread = (await readProjectFolder(dir)).document;
    expect(reread.formatVersion).toBe(3);
    expect(reread.process?.id).toBe(read.process?.id);
  });

  it('an object file someone else added after the folder was read is not deleted by a save', async () => {
    await writeProjectFolder(dir, withCatalog(v1, [receptionist]));
    const { document } = await readProjectFolder(dir);
    const theirs = { type: 'unit', id: 'unit-zz9zz9zz9zz9', name: 'Night shift', revision: 1 };
    await mkdir(join(dir, 'catalog', 'unit'));
    await writeFile(join(dir, 'catalog', 'unit', `${theirs.id}.json`), JSON.stringify(theirs));
    await writeProjectFolder(dir, document);
    expect(await files(dir)).toHaveProperty([`catalog/unit/${theirs.id}.json`], JSON.stringify(theirs));
  });

  it('an object changed on disk since it was read is E-CAMBIO-EXTERNO, for an edit and for a removal', async () => {
    await writeProjectFolder(dir, withCatalog(v1, [receptionist]));
    const { document } = await readProjectFolder(dir);
    const path = join(dir, 'catalog', 'role', `${receptionist.id}.json`);
    const theirs = `${JSON.stringify({ ...receptionist, name: 'Front desk agent', revision: 2 }, null, 2)}\n`;
    await writeFile(path, theirs);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const edited = withCatalog(document, [{ ...receptionist, description: 'Mine.', revision: 2 }]);
    await expect(writeProjectFolder(dir, edited)).rejects.toMatchObject({ code: 'E-CAMBIO-EXTERNO' });
    await expect(writeProjectFolder(dir, withCatalog(document, []))).rejects.toMatchObject({ code: 'E-CAMBIO-EXTERNO' });
    expect(await readFile(path, 'utf8')).toBe(theirs);
  });

  it('a version 3 archive saved into a folder carries its process ids and limits', async () => {
    const { document } = decodeLilaArchive(v3Fixture());
    const limited = { ...document, limits: { attachmentBytes: 1024 } };
    await writeProjectFolder(dir, limited, { saveAs: true });
    const reread = (await readProjectFolder(dir)).document;
    expect(reread.limits).toEqual({ attachmentBytes: 1024 });
    expect([reread.process?.id, ...(reread.processes ?? []).map((p) => p.id)]).toEqual([FRONT_DESK_ID, BILLING_ID]);
  });
});
