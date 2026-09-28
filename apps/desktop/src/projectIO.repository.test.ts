/**
 * The repository folder (ADR-029, #498) with real temporary folders: a version 1 project stays
 * version 1 byte for byte, a second process turns it into `processes/<slug>/`, and the move out of
 * the root goes through the same rollback as every other write.
 */
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processesOf, withProcesses } from '@lila-modeler/engine/project';
import type { ProcessDocument } from '@lila-modeler/engine/project';
import { hasProjectModel, readProjectFolder, writeProjectFolder, type WriteProjectFsImpl } from './projectIO.js';
import type { ProjectDocument, StoredRun } from './projectTypes.js';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'lila-repositorio-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const XML = (id: string): string => `<?xml version="1.0"?><definitions xmlns="http://example.org"><process id="${id}"/></definitions>`;
const AS_IS = 'as-is.scenario.json';

function run(id: string): StoredRun {
  return { id, scenarioName: AS_IS, result: { kpis: { total: 1 } }, inputs: { modelRevision: 0, scenarioRevision: 0, xml: '', scenario: { version: 1 } } } as unknown as StoredRun;
}

const v1: ProjectDocument = {
  version: 1,
  id: 'repo-1',
  name: 'Pedido',
  model: { id: 'Process_Pedido', name: 'model.bpmn', xml: XML('Process_Pedido'), revision: 3 },
  scenarios: { [AS_IS]: { version: 1, name: 'AS-IS', model: 'model.bpmn' } },
  scenarioRevisions: { [AS_IS]: 2 },
  runs: [run('run-a')],
};

const facturacion: ProcessDocument = {
  slug: 'facturacion',
  name: 'Facturación',
  model: { id: 'Process_Facturacion', name: 'model.bpmn', xml: XML('Process_Facturacion'), revision: 1 },
  scenarios: { [AS_IS]: { version: 1, name: 'Facturación', model: 'model.bpmn' } },
  scenarioRevisions: { [AS_IS]: 0 },
  runs: [run('run-b')],
};

/** Every file under `root` with its content, keyed by its relative path. */
async function files(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[relative(root, path)] = await readFile(path, 'utf8');
  }
  return out;
}

describe('a version 1 folder', () => {
  it('open → save without changes leaves the same bytes', async () => {
    await writeProjectFolder(dir, v1);
    const before = await files(dir);
    const { document } = await readProjectFolder(dir);
    expect(document.processes).toBeUndefined();
    await writeProjectFolder(dir, document);
    expect(await files(dir)).toEqual(before);
  });
});

describe('a second process', () => {
  const repo = (): ProjectDocument => withProcesses(v1, [...processesOf(v1), facturacion]);

  it('moves the first process into processes/<slug>/ and writes a version 2 manifest', async () => {
    await writeProjectFolder(dir, v1);
    await readProjectFolder(dir);
    await writeProjectFolder(dir, repo());
    expect(Object.keys(await files(dir)).sort()).toEqual([
      'lila-project.json',
      `processes/facturacion/${AS_IS}`,
      'processes/facturacion/model.bpmn',
      'processes/facturacion/runs/run-b.result.json',
      `processes/pedido/${AS_IS}`,
      'processes/pedido/model.bpmn',
      'processes/pedido/runs/run-a.result.json',
    ]);
    const manifest = JSON.parse(await readFile(join(dir, 'lila-project.json'), 'utf8')) as Record<string, unknown>;
    expect(manifest).toMatchObject({ version: 2, id: 'repo-1', name: 'Pedido', processes: [{ slug: 'pedido' }, { slug: 'facturacion', name: 'Facturación' }] });
    // No `model.bpmn` at the root: a build that only reads version 1 stops at E-SIN-MODELO instead
    // of opening a stale diagram and writing its manifest over the repository.
    await expect(stat(join(dir, 'model.bpmn'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await hasProjectModel(dir)).toBe(true);
  });

  it('reopens with both processes, their scenarios and runs, and a second save is the same bytes', async () => {
    await writeProjectFolder(dir, repo());
    const before = await files(dir);
    const { document, problems } = await readProjectFolder(dir);
    expect(problems).toEqual([]);
    expect(document).toEqual(repo());
    await writeProjectFolder(dir, document);
    expect(await files(dir)).toEqual(before);
  });

  it('back to one process writes version 1 at the root again', async () => {
    await writeProjectFolder(dir, repo());
    await readProjectFolder(dir);
    await writeProjectFolder(dir, v1);
    const { document } = await readProjectFolder(dir);
    expect(document).toEqual(v1);
  });

  it('a failure half-way through the move restores the version 1 folder', async () => {
    await writeProjectFolder(dir, v1);
    const before = await files(dir);
    await readProjectFolder(dir);
    let calls = 0;
    const fsImpl: WriteProjectFsImpl = {
      rename: async (from, to) => {
        calls += 1;
        if (calls === 9) throw new Error('disco lleno (simulado)');
        await rename(from, to);
      },
    };
    await expect(writeProjectFolder(dir, repo(), {}, fsImpl)).rejects.toThrow(/simulado/);
    const after = await files(dir);
    expect(Object.fromEntries(Object.entries(after).filter(([k]) => !k.startsWith('processes/')))).toEqual(before);
    expect(Object.keys(after).filter((k) => k.includes('.tmp-') || k.includes('.prev-'))).toEqual([]);
  });

  it('a broken scenario in a process is reported with its full path', async () => {
    await writeProjectFolder(dir, repo());
    await writeFile(join(dir, 'processes/facturacion/roto.scenario.json'), '{');
    const { problems } = await readProjectFolder(dir);
    expect(problems.map((p) => p.file)).toEqual(['processes/facturacion/roto.scenario.json']);
  });

  it('a newer manifest version is refused, a missing process model is fatal, a symlinked processes/ is refused', async () => {
    await writeProjectFolder(dir, repo());
    const manifest = JSON.parse(await readFile(join(dir, 'lila-project.json'), 'utf8')) as Record<string, unknown>;
    await writeFile(join(dir, 'lila-project.json'), JSON.stringify({ ...manifest, version: 3 }));
    await expect(readProjectFolder(dir)).rejects.toMatchObject({ code: 'E-MANIFEST' });
    await writeFile(join(dir, 'lila-project.json'), JSON.stringify(manifest));
    await rm(join(dir, 'processes/facturacion/model.bpmn'));
    await expect(readProjectFolder(dir)).rejects.toMatchObject({ code: 'E-SIN-MODELO' });

    const outside = await mkdtemp(join(tmpdir(), 'lila-fuera-'));
    try {
      await rm(join(dir, 'processes'), { recursive: true });
      await mkdir(join(outside, 'pedido'));
      await symlink(outside, join(dir, 'processes'));
      await expect(readProjectFolder(dir)).rejects.toMatchObject({ code: 'E-SYMLINK' });
      await expect(writeProjectFolder(dir, repo(), { overwrite: true })).rejects.toMatchObject({ code: 'E-SYMLINK' });
      expect(await readdir(join(outside, 'pedido'))).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('a repository is saved whole: no diagram-only save', async () => {
    await expect(writeProjectFolder(dir, repo(), { diagramOnly: true })).rejects.toMatchObject({ code: 'E-DESTINO-INVALIDO' });
    expect(await files(dir)).toEqual({});
  });
});
