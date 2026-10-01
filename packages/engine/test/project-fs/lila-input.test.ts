/**
 * A `.lila` as the input of the CLI (#466): `validate`, `run` and `compare` give the same answer on
 * the archive as on the extracted `.bpmn` + scenario files, a repository picks its process with
 * `--process`, and `writeLilaScenario` rewrites one scenario without touching anything else.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { strFromU8, unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../../src/cli.js';
import { decodeLila, encodeLila, processesOf } from '../../src/project/index.js';
import type { ProcessDocument, ProjectDocument } from '../../src/project/index.js';
import {
  findLilaScenario,
  lilaScenarioEntryName,
  openLilaProcess,
  writeLilaFile,
  writeLilaProject,
  writeLilaScenario,
} from '../../src/project-fs/index.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const folder = join(repo, 'examples/pedido');
const exampleLila = join(repo, 'examples/pedido.lila');
const model = join(folder, 'model.bpmn');
const asIs = join(folder, 'as-is.scenario.json');
const toBe = join(folder, 'to-be-3-cajeros.scenario.json');

let out: string[];
let scratch: string;

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  scratch = mkdtempSync(join(tmpdir(), 'lila-input-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

function pedidoDocument(): ProjectDocument {
  const scenarios = Object.fromEntries(
    readdirSync(folder)
      .filter((name) => name.endsWith('.scenario.json'))
      .sort()
      .map((name) => [name, JSON.parse(readFileSync(join(folder, name), 'utf8')) as Record<string, unknown>]),
  );
  return {
    version: 1,
    id: 'p1',
    name: 'pedido',
    model: { id: 'Process_Restaurante', name: 'model.bpmn', xml: readFileSync(model, 'utf8'), revision: 1 },
    scenarios,
    scenarioRevisions: Object.fromEntries(Object.keys(scenarios).map((name) => [name, 1])),
    runs: [],
  };
}

/** A version 2 repository: `pedido` first, then `copia` (the same process, its own scenarios). */
function repositoryDocument(): ProjectDocument {
  const base = pedidoDocument();
  const copia: ProcessDocument = {
    slug: 'copia',
    name: 'Copia',
    model: base.model,
    scenarios: { 'solo.scenario.json': { ...base.scenarios['as-is.scenario.json'], name: 'Solo' } },
    scenarioRevisions: { 'solo.scenario.json': 4 },
    runs: [],
  };
  return { ...base, process: { slug: 'pedido', name: 'Pedido' }, processes: [copia] };
}

function writeArchive(name: string, document: ProjectDocument): string {
  const file = join(scratch, name);
  writeFileSync(file, encodeLila(document));
  return file;
}

async function cli(...argv: string[]): Promise<number> {
  out = [];
  return main(argv);
}

function bytes(file: string): Buffer {
  return readFileSync(file);
}

describe('examples/pedido.lila', () => {
  test('says the same as the examples/pedido folder (regenerate with tools/example-lila.mjs)', () => {
    const decoded = decodeLila(new Uint8Array(readFileSync(exampleLila)));
    const folderDocument = pedidoDocument();
    expect(decoded.model.xml).toBe(folderDocument.model.xml);
    expect(decoded.scenarios).toEqual(folderDocument.scenarios);
  });
});

describe('lila validate / run / compare on a .lila', () => {
  test('validate --json: same report as the extracted model.bpmn', async () => {
    expect(await cli('validate', model, '--json')).toBe(0);
    const fromBpmn = out.join('\n');
    expect(await cli('validate', exampleLila, '--json')).toBe(0);
    expect(out.join('\n')).toBe(fromBpmn);
  });

  test('run: same RunResult as the .bpmn + scenario json, by entry name, stem or "name"', async () => {
    const reference = join(scratch, 'reference.json');
    expect(await cli('run', model, asIs, '--seed', '7', '--replications', '2', '--json', reference)).toBe(0);
    for (const scenario of ['as-is.scenario.json', 'as-is', 'AS-IS']) {
      const target = join(scratch, `lila-${scenario}.json`);
      expect(await cli('run', exampleLila, scenario, '--seed', '7', '--replications', '2', '--json', target), out.join('\n')).toBe(0);
      expect(bytes(target).equals(bytes(reference))).toBe(true);
    }
  });

  test('run: an existing .json path wins over a name, and runs against the archive model', async () => {
    const reference = join(scratch, 'reference.json');
    expect(await cli('run', model, toBe, '--seed', '7', '--replications', '2', '--json', reference)).toBe(0);
    const target = join(scratch, 'lila.json');
    expect(await cli('run', exampleLila, toBe, '--seed', '7', '--replications', '2', '--json', target)).toBe(0);
    expect(bytes(target).equals(bytes(reference))).toBe(true);
  });

  test('compare: same CompareResult as on the extracted files, extends resolved inside the archive', async () => {
    const reference = join(scratch, 'reference.json');
    expect(await cli('compare', model, asIs, toBe, '--seed', '7', '--replications', '2', '--json', reference)).toBe(0);
    const target = join(scratch, 'lila.json');
    expect(
      await cli('compare', exampleLila, 'as-is', 'to-be-3-cajeros', '--seed', '7', '--replications', '2', '--json', target),
      out.join('\n'),
    ).toBe(0);
    expect(bytes(target).equals(bytes(reference))).toBe(true);
  });

  test('an unknown scenario name lists the scenarios of the process (en and es)', async () => {
    expect(await cli('run', exampleLila, 'nada')).toBe(1);
    expect(out.join('\n')).toContain('as-is.scenario.json, to-be-3-cajeros.scenario.json');
    expect(await cli('run', exampleLila, 'nada', '--lang', 'es')).toBe(1);
    expect(out.join('\n')).toContain('sus escenarios son: as-is.scenario.json, to-be-3-cajeros.scenario.json');
  });

  test('--process on a .bpmn is an error, not ignored', async () => {
    expect(await cli('validate', model, '--process', 'pedido')).toBe(1);
    expect(out.join('\n')).toContain('only applies when the model is a .lila');
  });

  test('a file that is not a .lila archive is refused with its code', async () => {
    const broken = join(scratch, 'broken.lila');
    writeFileSync(broken, 'not a zip');
    expect(await cli('validate', broken)).toBe(1);
    expect(out.join('\n')).toContain('LILA-ZIP');
  });
});

describe('a version 2 repository', () => {
  test('without --process: an error that lists the slugs', async () => {
    const file = writeArchive('repo.lila', repositoryDocument());
    expect(await cli('validate', file)).toBe(1);
    expect(out.join('\n')).toContain('several processes (pedido, copia)');
    expect(await cli('run', file, 'as-is', '--lang', 'es')).toBe(1);
    expect(out.join('\n')).toContain('varios procesos (pedido, copia)');
  });

  test('an unknown --process lists the slugs', async () => {
    const file = writeArchive('repo.lila', repositoryDocument());
    expect(await cli('validate', file, '--process', 'otro')).toBe(1);
    expect(out.join('\n')).toContain('no process "otro"; its processes are: pedido, copia');
  });

  test('--process picks the process; its scenarios are its own', async () => {
    const file = writeArchive('repo.lila', repositoryDocument());
    const reference = join(scratch, 'reference.json');
    expect(await cli('run', model, asIs, '--seed', '3', '--replications', '2', '--json', reference)).toBe(0);
    const first = join(scratch, 'pedido.json');
    expect(await cli('run', file, 'as-is', '--process', 'pedido', '--seed', '3', '--replications', '2', '--json', first)).toBe(0);
    expect(bytes(first).equals(bytes(reference))).toBe(true);
    const second = join(scratch, 'copia.json');
    expect(await cli('run', file, 'Solo', '--process', 'copia', '--seed', '3', '--replications', '2', '--json', second)).toBe(0);
    expect(bytes(second).equals(bytes(reference))).toBe(true);
    // `as-is` belongs to the other process.
    expect(await cli('run', file, 'as-is', '--process', 'copia')).toBe(1);
    expect(out.join('\n')).toContain('process "copia"');
  });

  test('a repository with one process needs no --process', async () => {
    const document = repositoryDocument();
    const file = writeArchive('one.lila', { ...document, processes: undefined, process: undefined } as ProjectDocument);
    expect(await cli('validate', file)).toBe(0);
  });
});

describe('findLilaScenario', () => {
  test('entry name, then stem, then a unique "name"; two equal names are ambiguous', async () => {
    const document = pedidoDocument();
    const file = writeArchive('dup.lila', {
      ...document,
      scenarios: { ...document.scenarios, 'otro.scenario.json': { ...document.scenarios['as-is.scenario.json'] } },
      scenarioRevisions: { ...document.scenarioRevisions, 'otro.scenario.json': 1 },
    });
    const lila = await openLilaProcess(file);
    expect(findLilaScenario(lila, 'otro.scenario.json')).toBe('otro.scenario.json');
    expect(findLilaScenario(lila, 'otro')).toBe('otro.scenario.json');
    expect(findLilaScenario(lila, 'TO-BE 3 cashiers')).toBe('to-be-3-cajeros.scenario.json');
    expect(() => findLilaScenario(lila, 'AS-IS')).toThrow('as-is.scenario.json, otro.scenario.json');
  });

  test('lilaScenarioEntryName adds the suffix and refuses folders', () => {
    expect(lilaScenarioEntryName('to-be')).toBe('to-be.scenario.json');
    expect(lilaScenarioEntryName('to-be.scenario.json')).toBe('to-be.scenario.json');
    expect(() => lilaScenarioEntryName('../x')).toThrow();
    expect(() => lilaScenarioEntryName('runs/x')).toThrow();
    expect(() => lilaScenarioEntryName('.scenario.json')).toThrow();
  });
});

describe('writeLilaScenario', () => {
  test('rewrites one scenario of one process; every other entry is byte-identical', async () => {
    const file = writeArchive('repo.lila', repositoryDocument());
    const before = unzipSync(new Uint8Array(readFileSync(file)));
    const lila = await openLilaProcess(file, { process: 'copia' });
    const changed = { ...lila.process.scenarios['solo.scenario.json'], description: 'patched' };
    await writeLilaScenario(lila, 'solo.scenario.json', changed);

    const after = unzipSync(new Uint8Array(readFileSync(file)));
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const name of Object.keys(before)) {
      if (name === 'lila-project.json' || name === 'processes/copia/solo.scenario.json') continue;
      expect(Buffer.from(after[name]!).equals(Buffer.from(before[name]!)), name).toBe(true);
    }
    const decoded = decodeLila(new Uint8Array(readFileSync(file)));
    const [pedido, copia] = processesOf(decoded);
    expect(copia!.scenarios['solo.scenario.json']).toEqual(changed);
    // The revision goes up, so the app knows older runs of it are stale; the others stay.
    expect(copia!.scenarioRevisions['solo.scenario.json']).toBe(5);
    expect(pedido).toEqual(processesOf(repositoryDocument())[0]);
    expect(JSON.parse(strFromU8(after['lila-project.json']!)).version).toBe(2);
  });

  test('a version 1 project stays version 1 and gains the new entry', async () => {
    const file = writeArchive('pedido.lila', pedidoDocument());
    const lila = await openLilaProcess(file);
    await writeLilaScenario(lila, 'nuevo', { version: 1, extends: 'as-is.scenario.json', name: 'Nuevo' });
    const decoded = decodeLila(new Uint8Array(readFileSync(file)));
    expect(decoded.processes).toBeUndefined();
    expect(decoded.scenarios['nuevo.scenario.json']).toEqual({ version: 1, extends: 'as-is.scenario.json', name: 'Nuevo' });
    expect(decoded.scenarioRevisions['nuevo.scenario.json']).toBe(1);
    expect(readdirSync(scratch)).toEqual(['pedido.lila']);
  });

  test('refuses, writing nothing, when the file changed on disk after it was opened', async () => {
    const file = writeArchive('pedido.lila', pedidoDocument());
    const lila = await openLilaProcess(file);
    const later = new Date(statSync(file).mtimeMs + 5000);
    utimesSync(file, later, later);
    const untouched = readFileSync(file);
    await expect(writeLilaScenario(lila, 'as-is.scenario.json', { version: 1 })).rejects.toThrow('changed on disk');
    expect(readFileSync(file).equals(untouched)).toBe(true);
    expect(readdirSync(scratch)).toEqual(['pedido.lila']);
  });

  test('two writers that opened the same version: the second is refused, the first is kept', async () => {
    const file = writeArchive('pedido.lila', pedidoDocument());
    const [a, b] = await Promise.all([openLilaProcess(file), openLilaProcess(file)]);
    const results = await Promise.allSettled([
      writeLilaScenario(a, 'a', { version: 1, name: 'A' }),
      writeLilaScenario(b, 'b', { version: 1, name: 'B' }),
    ]);
    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]!.status).toBe('rejected');
    expect(String((results[1] as PromiseRejectedResult).reason)).toContain('changed on disk');
    const decoded = decodeLila(new Uint8Array(readFileSync(file)));
    expect(Object.keys(decoded.scenarios)).toContain('a.scenario.json');
    expect(Object.keys(decoded.scenarios)).not.toContain('b.scenario.json');
    // A fresh open sees the first write and may write again.
    await writeLilaProject(await openLilaProcess(file), decoded);
  });

  test('a file replaced by another with the same size and mtime is still caught (inode)', async () => {
    const file = writeArchive('pedido.lila', pedidoDocument());
    const lila = await openLilaProcess(file);
    const { mtime, atime } = statSync(file);
    const copy = join(scratch, 'copy.tmp');
    writeFileSync(copy, readFileSync(file));
    utimesSync(copy, atime, mtime);
    rmSync(file);
    writeFileSync(file, readFileSync(copy));
    utimesSync(file, atime, mtime);
    rmSync(copy);
    await expect(writeLilaScenario(lila, 'x', { version: 1 })).rejects.toThrow('changed on disk');
  });
});

/**
 * Two writers in two **processes** (QA round 2 of #550): two MCP servers, or the CLI and the
 * desktop. Each child opens the same file, says it is ready, waits for the go and writes its own
 * process. A run ends with both changes on disk or one refused with "changed on disk"; two OKs
 * with one change missing is a silent loss and fails.
 */
describe('writers in different processes', () => {
  const dist = join(repo, 'packages/engine/dist/project-fs/index.js');
  const child = `
    import { existsSync, writeFileSync } from 'node:fs';
    const [dist, file, slug, entry, ready, go] = process.argv.slice(1);
    const { openLilaProcess, writeLilaScenario } = await import(dist);
    const lila = await openLilaProcess(file, { process: slug });
    writeFileSync(ready, '');
    while (!existsSync(go)) await new Promise((resolve) => setTimeout(resolve, 2));
    try {
      await writeLilaScenario(lila, entry, { ...lila.process.scenarios[entry], description: slug });
      console.log(JSON.stringify({ ok: true }));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, message: error.message }));
    }
  `;

  function run(args: string[]): Promise<{ ok: boolean; message?: string }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, ['--input-type=module', '-e', child, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      proc.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      proc.on('error', reject);
      proc.on('close', (code) => (code === 0 ? resolve(JSON.parse(stdout) as { ok: boolean }) : reject(new Error(stderr))));
    });
  }

  async function until(condition: () => boolean): Promise<void> {
    while (!condition()) await new Promise((resolve) => setTimeout(resolve, 2));
  }

  test('both changes are kept, or one is refused: never a silent loss', async () => {
    const outcomes = { both: 0, refused: 0 };
    for (let attempt = 0; attempt < 8; attempt++) {
      const file = writeArchive(`race-${attempt}.lila`, repositoryDocument());
      const go = join(scratch, `go-${attempt}`);
      const ready = [join(scratch, `ready-a-${attempt}`), join(scratch, `ready-b-${attempt}`)];
      const results = Promise.all([
        run([dist, file, 'pedido', 'as-is.scenario.json', ready[0]!, go]),
        run([dist, file, 'copia', 'solo.scenario.json', ready[1]!, go]),
      ]);
      await until(() => ready.every((path) => existsSync(path)));
      writeFileSync(go, '');
      const [first, second] = await results;
      const [pedido, copia] = processesOf(decodeLila(new Uint8Array(readFileSync(file))));
      const kept = [
        pedido!.scenarios['as-is.scenario.json']?.['description'] === 'pedido',
        copia!.scenarios['solo.scenario.json']?.['description'] === 'copia',
      ];
      expect(kept[0], JSON.stringify(first)).toBe(first!.ok);
      expect(kept[1], JSON.stringify(second)).toBe(second!.ok);
      for (const result of [first!, second!].filter((r) => !r.ok)) expect(result.message).toContain('changed on disk');
      expect(first!.ok || second!.ok).toBe(true);
      if (first!.ok && second!.ok) outcomes.both++;
      else outcomes.refused++;
      expect(existsSync(`${file}.lock`)).toBe(false);
    }
    expect(outcomes.both + outcomes.refused).toBe(8);
  }, 60_000);
});

describe('the .lila lock', () => {
  test('a lock left by a crash (older than the stale limit) does not block the save', async () => {
    const file = writeArchive('pedido.lila', pedidoDocument());
    const lock = `${file}.lock`;
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    await writeLilaFile(file, { ...pedidoDocument(), name: 'saved' });
    expect(decodeLila(new Uint8Array(readFileSync(file))).name).toBe('saved');
    expect(existsSync(lock)).toBe(false);
    expect(readdirSync(scratch)).toEqual(['pedido.lila']);
  });

  test('a live lock held by another writer: the save waits, then refuses without writing', async () => {
    const file = writeArchive('pedido.lila', pedidoDocument());
    const lock = `${file}.lock`;
    writeFileSync(lock, '');
    const untouched = readFileSync(file);
    await expect(writeLilaFile(file, { ...pedidoDocument(), name: 'saved' })).rejects.toMatchObject({ code: 'E-CAMBIO-EXTERNO' });
    expect(readFileSync(file).equals(untouched)).toBe(true);
    // Somebody else's lock is not ours to delete.
    expect(existsSync(lock)).toBe(true);
    const lila = await openLilaProcess(file);
    await expect(writeLilaScenario(lila, 'x', { version: 1 })).rejects.toThrow('changed on disk');
  }, 20_000);

  test('the lock is released when the write fails', async () => {
    const file = writeArchive('pedido.lila', pedidoDocument());
    const lila = await openLilaProcess(file);
    await expect(
      writeLilaFile(file, pedidoDocument(), { beforeWrite: async () => Promise.reject(new Error('no')) }),
    ).rejects.toThrow('no');
    expect(existsSync(`${file}.lock`)).toBe(false);
    await writeLilaScenario(lila, 'x', { version: 1 });
  });
});

