/**
 * #670 (A1.0 of #127), paths 2–4: every `lila:*Ref` and `lila:responsibility` survives the
 * containers on disk and the agent writes that do not target it, for a version 1 project and a
 * version 2 repository (two processes, the annotated model in both).
 *
 * 2. the desktop folder: `writeProjectFolder` → `readProjectFolder`;
 * 3. the archive on disk: `writeLilaFile` → `readLilaFile`;
 * 4. agent writes on a `.lila` that leave the annotated elements alone: `annotateLilaElement` on
 *    another element, `writeLilaScenario`, `saveLilaRun`, and `editLilaProcess` /
 *    `putLilaProcessBpmn` on the other process.
 *
 * Path 1 (`decodeLila(encodeLila(…))` in memory) is `test/project/lila-refs.test.ts`. Real
 * temporary folders, as the other `project-fs` tests use.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { annotateElement } from '../../src/bpmn/annotate.js';
import { outlineToBpmn } from '../../src/bpmn/outline.js';
import { processesOf } from '../../src/project/index.js';
import type { ProcessDocument, ProjectDocument } from '../../src/project/index.js';
import {
  annotateLilaElement,
  editLilaProcess,
  openLilaProcess,
  putLilaProcessBpmn,
  readLilaFile,
  readProjectFolder,
  saveLilaRun,
  writeLilaFile,
  writeLilaScenario,
  writeProjectFolder,
} from '../../src/project-fs/index.js';
import { CREDIT } from '../fixtures/outlines.js';
import {
  AS_IS,
  EXPECTED_ORDERED,
  SECOND_SLUG,
  TO_BE,
  expectFullCoverage,
  inventories,
  lilaInventory,
  orderedReferences,
  secondModel,
  shortRun,
  untouched,
  v1Project,
  v2Repository,
} from '../lila-refs.fixture.js';

let v1: ProjectDocument;
let v2: ProjectDocument;
let dir: string;

beforeAll(async () => {
  v1 = await v1Project();
  v2 = await v2Repository();
}, 120_000);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lila-refs-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** The element no reference sits on: what the agent writes below target instead. */
const OTHER = 'Task_Empacar';

const DOCUMENTS = [
  ['version 1 project', () => v1],
  ['version 2 repository', () => v2],
] as const;

/** `slug`'s process of `document`. */
function processOf(document: ProjectDocument, slug: string): ProcessDocument {
  const process = processesOf(document).find((p) => p.slug === slug);
  if (process === undefined) throw new Error(`no process "${slug}" in ${processesOf(document).map((p) => p.slug).join(', ')}`);
  return process;
}

/** A process the write did not target: the same model text, the same runs, the same references. */
async function expectProcessUnchanged(after: ProcessDocument, before: ProcessDocument): Promise<void> {
  expect(after.model.xml).toBe(before.model.xml);
  expect(after.runs.map((r) => [r.id, r.inputs.xml])).toEqual(before.runs.map((r) => [r.id, r.inputs.xml]));
  expect(await orderedReferences(after.model.xml)).toEqual(EXPECTED_ORDERED);
  expectFullCoverage(lilaInventory(after.model.xml));
}

/**
 * The targeted process, rewritten by bpmn-moddle: every element but `OTHER` keeps its `lila:` as it
 * was (inventory) and its references in the same order (`readAnnotations`).
 */
async function expectUntouchedElements(after: ProcessDocument, before: ProcessDocument): Promise<void> {
  expect(untouched(lilaInventory(after.model.xml), OTHER)).toEqual(untouched(lilaInventory(before.model.xml), OTHER));
  const { [OTHER]: _other, ...rest } = await orderedReferences(after.model.xml);
  expect(rest).toEqual(EXPECTED_ORDERED);
  // The runs keep the model they ran on.
  expect(after.runs.map((r) => [r.id, r.inputs.xml])).toEqual(before.runs.map((r) => [r.id, r.inputs.xml]));
}

/** `document` written as a `.lila` in the scratch folder, and its path. */
async function lilaOnDisk(document: ProjectDocument): Promise<string> {
  const file = join(dir, 'refs.lila');
  await writeLilaFile(file, document);
  return file;
}

async function reopen(file: string): Promise<ProjectDocument> {
  const { document, problems } = await readLilaFile(file);
  expect(problems).toEqual([]);
  return document;
}

/** Every `model.bpmn` under `root`, keyed by its folder relative to `root` (`''` for the root). */
async function modelFiles(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name !== 'model.bpmn') continue;
    const folder = entry.parentPath.slice(root.length).replace(/^[\\/]/, '').replaceAll('\\', '/');
    out[folder] = await readFile(join(entry.parentPath, entry.name), 'utf8');
  }
  return out;
}

/** Where each process's `model.bpmn` lives in a folder or archive of `document`. */
function modelFolders(document: ProjectDocument): Record<string, string> {
  const processes = processesOf(document);
  if (processes.length === 1) return { '': processes[0]!.model.xml };
  return Object.fromEntries(processes.map((p) => [`processes/${p.slug}`, p.model.xml]));
}

describe.each(DOCUMENTS)('path 2, folder: writeProjectFolder → readProjectFolder (%s)', (_label, document) => {
  test('every model and run comes back with the same references, and the files on disk carry them', async () => {
    const original = document();
    await writeProjectFolder(dir, original);

    // The files themselves: one `model.bpmn` per process, the XML as it was.
    const files = await modelFiles(dir);
    expect(files).toEqual(modelFolders(original));
    for (const xml of Object.values(files)) expectFullCoverage(lilaInventory(xml));

    const { document: reopened, problems } = await readProjectFolder(dir);
    expect(problems).toEqual([]);
    expect(inventories(reopened)).toEqual(inventories(original));
    for (const before of processesOf(original)) await expectProcessUnchanged(processOf(reopened, before.slug), before);

    // Saving what was opened leaves the same model files.
    await writeProjectFolder(dir, reopened);
    expect(await modelFiles(dir)).toEqual(files);
  });
});

describe.each(DOCUMENTS)('path 3, archive on disk: writeLilaFile → readLilaFile (%s)', (_label, document) => {
  test('every model and run comes back with the same references, and the archive carries them', async () => {
    const original = document();
    const file = await lilaOnDisk(original);

    // The archive itself, read without the engine's decoder.
    const entries = unzipSync(new Uint8Array(await readFile(file)));
    const models = Object.fromEntries(
      Object.entries(entries)
        .filter(([name]) => name === 'model.bpmn' || name.endsWith('/model.bpmn'))
        .map(([name, bytes]) => [name.slice(0, -'/model.bpmn'.length).replace(/^model\.bpmn$/, ''), strFromU8(bytes)]),
    );
    expect(models).toEqual(modelFolders(original));

    const reopened = await reopen(file);
    expect(inventories(reopened)).toEqual(inventories(original));
    for (const before of processesOf(original)) await expectProcessUnchanged(processOf(reopened, before.slug), before);

    // Saving what was opened gives the same bytes.
    const bytes = await readFile(file);
    await writeLilaFile(file, reopened, { overwrite: true });
    expect((await readFile(file)).equals(bytes)).toBe(true);
  });
});

describe.each(DOCUMENTS)('path 4, agent writes that do not target the annotated elements (%s)', (label, document) => {
  /** The process the writes below target: the second one in the repository, the only one otherwise. */
  const target = (): string => (label === 'version 2 repository' ? SECOND_SLUG : 'pedido');
  const slugOption = (): { process?: string } => (label === 'version 2 repository' ? { process: SECOND_SLUG } : {});

  /** Every process but the target is unchanged; the target keeps the references of its other elements. */
  async function expectOnlyTargetChanged(after: ProjectDocument, before: ProjectDocument): Promise<void> {
    expect(processesOf(after).map((p) => p.slug)).toEqual(processesOf(before).map((p) => p.slug));
    for (const process of processesOf(before)) {
      if (process.slug === target()) await expectUntouchedElements(processOf(after, process.slug), process);
      else await expectProcessUnchanged(processOf(after, process.slug), process);
    }
  }

  test('annotateLilaElement on another element', async () => {
    const original = document();
    const file = await lilaOnDisk(original);
    const result = await annotateLilaElement({
      file,
      ...slugOption(),
      elementId: OTHER,
      responsibilities: [{ type: 'R', roleRef: 'rol-empacador' }],
      refs: { systemRef: ['sys-etiquetas'], documentRef: ['doc-ticket'] },
    });
    expect(result).toMatchObject({ changed: true, written: true, process: target() });

    const reopened = await reopen(file);
    await expectOnlyTargetChanged(reopened, original);
    // The write did land, on the element it named.
    expect((await orderedReferences(processOf(reopened, target()).model.xml))[OTHER]).toEqual({
      responsibilities: [{ type: 'R', roleRef: 'rol-empacador' }],
      refs: { systemRef: ['sys-etiquetas'], documentRef: ['doc-ticket'] },
    });
  });

  test('writeLilaScenario', async () => {
    const original = document();
    const file = await lilaOnDisk(original);
    const lila = await openLilaProcess(file, slugOption());
    const scenario = { ...lila.process.scenarios[AS_IS]!, name: 'AS-IS (edited by an agent)' };
    await writeLilaScenario(lila, TO_BE, scenario);

    const reopened = await reopen(file);
    expect(processOf(reopened, target()).scenarios[TO_BE]).toEqual(scenario);
    expect(inventories(reopened)).toEqual(inventories(original));
    for (const process of processesOf(original)) await expectProcessUnchanged(processOf(reopened, process.slug), process);
  });

  test('saveLilaRun', async () => {
    const original = document();
    const file = await lilaOnDisk(original);
    const lila = await openLilaProcess(file, slugOption());
    const { model, scenarios, scenarioRevisions } = lila.process;
    const run = await shortRun('run-saved', model.xml, AS_IS, scenarios[AS_IS]!, {
      modelRevision: model.revision,
      scenarioRevision: scenarioRevisions[AS_IS] ?? 0,
    });
    await saveLilaRun(lila, run);

    const reopened = await reopen(file);
    const saved = processOf(reopened, target()).runs.map((r) => r.id);
    expect(saved).toContain('run-saved');
    // Every model and run that was there is unchanged, and the new run carries the references too.
    expect(inventories(reopened)).toEqual({ ...inventories(original), [`${target()}/runs/run-saved`]: lilaInventory(model.xml) });
    for (const process of processesOf(original)) {
      const after = processOf(reopened, process.slug);
      expect(after.model.xml).toBe(process.model.xml);
      expect(await orderedReferences(after.model.xml)).toEqual(EXPECTED_ORDERED);
    }
  });

  test('editLilaProcess renames an element without references (in a repository, of the other process)', async () => {
    const original = document();
    const file = await lilaOnDisk(original);
    const edited = await editLilaProcess(file, [{ op: 'rename', id: OTHER, name: 'Pack the order' }], slugOption());
    expect(edited).toMatchObject({ dryRun: false, slug: target() });

    const reopened = await reopen(file);
    expect(processOf(reopened, target()).model.xml).toContain('Pack the order');
    await expectOnlyTargetChanged(reopened, original);
  });

  test('putLilaProcessBpmn adds a process: the existing ones are unchanged', async () => {
    const original = document();
    const file = await lilaOnDisk(original);
    const { xml } = await outlineToBpmn(CREDIT, { processId: 'Process_Credit' });
    const added = await putLilaProcessBpmn({ file, mode: 'add', bpmn: xml, process: 'credit' });
    expect(added).toMatchObject({ mode: 'add', slug: 'credit' });

    const reopened = await reopen(file);
    // A version 1 project is a repository after this write (ADR-029); its process moved, unchanged.
    expect(processesOf(reopened).map((p) => p.slug)).toEqual([...processesOf(original).map((p) => p.slug), 'credit']);
    for (const process of processesOf(original)) await expectProcessUnchanged(processOf(reopened, process.slug), process);
  });

});

describe('path 4, agent writes that do not target the annotated elements (version 2 repository only)', () => {
  test('putLilaProcessBpmn replaces the other process', async () => {
    const original = v2;
    const file = await lilaOnDisk(original);
    // The other process's model as an agent would send it back: annotated on one more element.
    const xml = await annotateElement(secondModel(processesOf(original)[0]!.model.xml), OTHER, {
      refs: { kpiRef: ['kpi-empaque'] },
    });
    const replaced = await putLilaProcessBpmn({ file, mode: 'replace', bpmn: xml, process: SECOND_SLUG });
    expect(replaced).toMatchObject({ mode: 'replace', slug: SECOND_SLUG });

    const reopened = await reopen(file);
    const [first, second] = processesOf(original);
    await expectProcessUnchanged(processOf(reopened, first!.slug), first!);
    await expectUntouchedElements(processOf(reopened, SECOND_SLUG), second!);
    expect(processOf(reopened, SECOND_SLUG).model.xml).toBe(xml);
  });
});
