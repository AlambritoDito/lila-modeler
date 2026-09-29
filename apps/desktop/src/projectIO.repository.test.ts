/**
 * The repository folder (ADR-029, #498) with real temporary folders: a version 1 project stays
 * version 1 byte for byte, a second process turns it into `processes/<slug>/`, and the move out of
 * the root goes through the same rollback as every other write.
 */
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processesOf, processSlug, withProcesses } from '@lila-modeler/engine/project';
import type { ProcessDocument } from '@lila-modeler/engine/project';
import { hasProjectModel, occupiedSlugs, readProjectFolder, writeProjectFolder, type WriteProjectFsImpl } from './projectIO.js';
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

  it('a deleted process never comes back: the new one takes a free slug and nothing is deleted (QA of #511)', async () => {
    const conExtra: ProcessDocument = { ...facturacion, scenarios: { ...facturacion.scenarios, 'x.scenario.json': { version: 1 } } };
    await writeProjectFolder(dir, withProcesses(v1, [...processesOf(v1), conExtra]));
    // Delete it and save (back to version 1): its folder stays on disk and is reported as occupied.
    await readProjectFolder(dir);
    await writeProjectFolder(dir, v1);
    const { document: reabierto } = await readProjectFolder(dir);
    const ocupados = await occupiedSlugs(dir);
    expect(ocupados).toEqual(['facturacion', 'pedido']);
    const nuevo: ProcessDocument = { slug: processSlug('Facturación', ocupados), name: 'Facturación', model: { id: 'Process_Nuevo', name: 'model.bpmn', xml: XML('Process_Nuevo'), revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [] };
    expect(nuevo.slug).toBe('facturacion-2');
    const primero = { ...processesOf(reabierto)[0]!, slug: processSlug('Pedido', ocupados) };
    await writeProjectFolder(dir, withProcesses(reabierto, [primero, nuevo]));
    const { document } = await readProjectFolder(dir);
    expect(processesOf(document)[1]).toEqual(nuevo);
    const arbol = Object.keys(await files(dir));
    expect(arbol.filter((k) => k.startsWith('processes/facturacion-2/'))).toEqual(['processes/facturacion-2/model.bpmn']);
    // The orphan folder of the deleted process is left exactly as it was.
    expect(arbol).toContain('processes/facturacion/x.scenario.json');
    expect(arbol).toContain('processes/facturacion/runs/run-b.result.json');
  });

  it('the writer refuses a new process on a folder that holds another one\'s files, deleting nothing', async () => {
    await writeProjectFolder(dir, withProcesses(v1, [...processesOf(v1), facturacion]));
    await readProjectFolder(dir);
    await writeProjectFolder(dir, v1);
    await readProjectFolder(dir);
    const antes = await files(dir);
    const nuevo: ProcessDocument = { ...facturacion, model: { ...facturacion.model, id: 'Process_Nuevo' }, scenarios: {}, runs: [] };
    await expect(writeProjectFolder(dir, withProcesses(v1, [{ ...processesOf(v1)[0]!, slug: 'pedido-2' }, nuevo])))
      .rejects.toMatchObject({ code: 'E-CARPETA-OCUPADA' });
    expect(await files(dir)).toEqual(antes);
  });

  it('a listed process whose BPMN id changed keeps all its files (QA of #511, folder2 case B)', async () => {
    await writeProjectFolder(dir, repo());
    await readProjectFolder(dir);
    const cambiado: ProcessDocument = { ...facturacion, model: { ...facturacion.model, id: 'Process_FacturacionV2', xml: XML('Process_FacturacionV2') } };
    await writeProjectFolder(dir, withProcesses(v1, [...processesOf(v1), cambiado]));
    const arbol = Object.keys(await files(dir));
    expect(arbol).toContain(`processes/facturacion/${AS_IS}`);
    expect(arbol).toContain('processes/facturacion/runs/run-b.result.json');
    expect(processesOf((await readProjectFolder(dir)).document)[1]).toEqual(cambiado);
  });

  it('the first version 2 save writes the manifest after the process files (QA of #511, nit 4)', async () => {
    await writeProjectFolder(dir, v1);
    await readProjectFolder(dir);
    const orden: string[] = [];
    const fsImpl: WriteProjectFsImpl = { rename: async (from, to) => { if (!to.includes('.prev-')) orden.push(relative(dir, to)); await rename(from, to); } };
    await writeProjectFolder(dir, repo(), {}, fsImpl);
    const manifiesto = orden.indexOf('lila-project.json');
    expect(manifiesto).toBe(orden.length - 1);
    expect(orden.slice(0, manifiesto).every((p) => p.startsWith('processes/'))).toBe(true);
  });

  it('a process model opened straight from its folder is a loose diagram, not a nested project (QA of #511, nit 5)', async () => {
    await writeProjectFolder(dir, repo());
    const carpeta = join(dir, 'processes/facturacion');
    const { loose } = await readProjectFolder(carpeta);
    expect(loose).toBe(true);
    expect(await hasProjectModel(carpeta)).toBe(false);
    const antes = await files(dir);
    await writeProjectFolder(carpeta, facturacion as unknown as ProjectDocument, { diagramOnly: true });
    expect(Object.keys(await files(dir)).sort()).toEqual(Object.keys(antes).sort());
  });

  it('a repository is saved whole: no diagram-only save', async () => {
    await expect(writeProjectFolder(dir, repo(), { diagramOnly: true })).rejects.toMatchObject({ code: 'E-DESTINO-INVALIDO' });
    expect(await files(dir)).toEqual({});
  });
});

describe('process folders that are not this project\'s (#517)', () => {
  const repo = (): ProjectDocument => withProcesses(v1, [...processesOf(v1), facturacion]);
  const ajeno = '<definitions id="ajeno"/>';

  it('Save As refuses a folder without a manifest whose processes/ is populated, and leaves it untouched', async () => {
    await mkdir(join(dir, 'processes/pedido'), { recursive: true });
    await writeFile(join(dir, 'processes/pedido/model.bpmn'), ajeno);
    await writeFile(join(dir, `processes/pedido/${AS_IS}`), '{"version":1,"name":"ajeno"}\n');
    const antes = await files(dir);
    await expect(writeProjectFolder(dir, repo(), { saveAs: true })).rejects.toMatchObject({ code: 'E-CARPETA-OCUPADA' });
    // A version 1 project would not write into processes/, but the folder is still somebody else's.
    await expect(writeProjectFolder(dir, v1, { saveAs: true })).rejects.toMatchObject({ code: 'E-CARPETA-OCUPADA' });
    expect(await files(dir)).toEqual(antes);
  });

  it('a process folder created by hand after opening is not overwritten by a new process taking its slug', async () => {
    await writeProjectFolder(dir, repo());
    const { document } = await readProjectFolder(dir);
    const ocupados = await occupiedSlugs(dir); // the snapshot the app takes on open
    // Somebody creates processes/compras/ by hand (only its model) while the project is open.
    await mkdir(join(dir, 'processes/compras'));
    await writeFile(join(dir, 'processes/compras/model.bpmn'), ajeno);
    const antes = await files(dir);
    const compras: ProcessDocument = { slug: processSlug('Compras', ocupados), name: 'Compras', model: { id: 'Process_Compras', name: 'model.bpmn', xml: XML('Process_Compras'), revision: 0 }, scenarios: {}, scenarioRevisions: {}, runs: [] };
    expect(compras.slug).toBe('compras');
    await expect(writeProjectFolder(dir, withProcesses(document, [...processesOf(document), compras])))
      .rejects.toMatchObject({ code: 'E-CARPETA-OCUPADA' });
    expect(await files(dir)).toEqual(antes);
  });

  it('nor is a same-named scenario in such a folder', async () => {
    await writeProjectFolder(dir, repo());
    const { document } = await readProjectFolder(dir);
    await mkdir(join(dir, 'processes/compras'));
    await writeFile(join(dir, `processes/compras/${AS_IS}`), '{"version":1,"name":"ajeno"}\n');
    const antes = await files(dir);
    const compras: ProcessDocument = { ...facturacion, slug: 'compras', name: 'Compras', runs: [] };
    await expect(writeProjectFolder(dir, withProcesses(document, [...processesOf(document), compras])))
      .rejects.toMatchObject({ code: 'E-CARPETA-OCUPADA' });
    expect(await files(dir)).toEqual(antes);
  });
});
