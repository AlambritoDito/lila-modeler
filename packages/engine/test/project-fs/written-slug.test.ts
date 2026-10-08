/**
 * #613: a write on a version 2 `.lila` that lists a single process saves it as version 1 (#517),
 * and its process takes the slug of the project's name. Every write reports the process as it is in
 * the file afterwards — `lila run --save`, `saveSimulationRun`, `lila process edit`, annotate and
 * the sheet import — not the slug that no longer exists. With several processes nothing moves.
 */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { parseBpmn } from '../../src/bpmn/index.js';
import { resolveScenarioArgument, withRunOverrides } from '../../src/cli-shared.js';
import { main } from '../../src/cli.js';
import { simulate } from '../../src/index.js';
import { encodeLila, processesOf } from '../../src/project/index.js';
import {
  annotateLilaElement,
  editLilaProcess,
  importLilaScenarioSheet,
  openLilaProcess,
  readLilaFile,
  saveSimulationRun,
} from '../../src/project-fs/index.js';
import { EXAMPLE_LILA } from './export-fixture.js';

let dir: string;
let file: string;
let out: string[];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lila-written-slug-'));
  file = join(dir, 'pedido.lila');
  copyFileSync(EXAMPLE_LILA, file);
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args) => void out.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * `file` as a version 2 archive whose manifest lists one process, `mostrador` (another tool, or a
 * repository whose second process was deleted by hand), or two with `copia` when `both`.
 */
async function version2(both = false): Promise<void> {
  const { document } = await readLilaFile(file);
  const copia = { ...processesOf(document)[0]!, slug: 'copia', name: 'Copia' };
  const entries = unzipSync(encodeLila({ ...document, process: { slug: 'mostrador', name: 'Mostrador' }, processes: [copia] }));
  if (both) { writeFileSync(file, zipSync(entries)); return; }
  const manifest = JSON.parse(strFromU8(entries['lila-project.json']!)) as { processes: { slug: string }[] };
  manifest.processes = manifest.processes.filter((p) => p.slug === 'mostrador');
  const kept = Object.fromEntries(Object.entries(entries).filter(([name]) => !name.startsWith('processes/copia/')));
  writeFileSync(file, zipSync({ ...kept, 'lila-project.json': strToU8(JSON.stringify(manifest)) }));
}

/** The slug the archive's only process has now. */
async function slugNow(): Promise<string> {
  const lila = await openLilaProcess(file);
  expect(lila.slugs).toHaveLength(1);
  return lila.process.slug;
}

describe('a one-process version 2 archive: writes report the slug the file has afterwards (#613)', () => {
  beforeEach(async () => {
    await version2();
    expect(await slugNow()).toBe('mostrador');
  });

  test('saveSimulationRun and `lila run --save`', async () => {
    const lila = await openLilaProcess(file);
    const { ir } = await parseBpmn(lila.process.model.xml);
    const scenario = withRunOverrides(resolveScenarioArgument('as-is', lila).scenario, { seed: 7, replications: 1 });
    const saved = await saveSimulationRun(lila, 'as-is', scenario, simulate(ir, scenario, { log: false }));
    const slug = await slugNow();
    expect(slug).not.toBe('mostrador');
    expect(saved.process).toBe(slug);

    await version2();
    expect(await main(['run', file, 'as-is', '--seed', '3', '--replications', '1', '--save'])).toBe(0);
    expect(out.at(-1)).toMatch(new RegExp(`\\(process ${await slugNow()}\\)\\.$`));
  });

  test('lila process edit / edit_process; a dry run writes nothing and keeps the slug', async () => {
    const dry = await editLilaProcess(file, [{ op: 'rename', id: 'Task_Revisar', name: 'Check' }], { dryRun: true });
    expect(dry.slug).toBe('mostrador');
    const edited = await editLilaProcess(file, [{ op: 'rename', id: 'Task_Revisar', name: 'Check' }]);
    const slug = await slugNow();
    expect(slug).not.toBe('mostrador');
    expect(edited.slug).toBe(slug);
    expect(edited.summary).toContain(slug);
    expect(edited.summary).not.toContain('mostrador');
  });

  test('annotate', async () => {
    const result = await annotateLilaElement({ file, elementId: 'Task_Revisar', documentation: 'Check twice.' });
    expect(result.written).toBe(true);
    expect(result.process).toBe(await slugNow());
  });

  test('scenario sheet import', async () => {
    const sheet = join(dir, 'Elements.csv');
    writeFileSync(sheet, 'id,distribution,unit,mean,sd\nTask_TomarPedido,normal,min,3,1\n');
    expect((await importLilaScenarioSheet({ file, scenario: 'to-be-3-cajeros', sheet, dryRun: true })).process).toBe('mostrador');
    const result = await importLilaScenarioSheet({ file, scenario: 'to-be-3-cajeros', sheet });
    expect(result.written).toBe(true);
    expect(result.process).toBe(await slugNow());
  });
});

test('with two processes a write keeps the slug it was given (#613)', async () => {
  await version2(true);
  const result = await annotateLilaElement({ file, process: 'mostrador', elementId: 'Task_Revisar', documentation: 'Check twice.' });
  expect(result.process).toBe('mostrador');
  expect((await openLilaProcess(file, { process: 'mostrador' })).slugs).toEqual(['mostrador', 'copia']);
});
