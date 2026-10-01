/**
 * Saving a run into a `.lila` (#538): `lila run --save` and `saveSimulationRun` store the run the
 * way the app does (`storedRun`), the app's load path sees it as the current run, `lila export`
 * uses it, and concurrent saves — in one process or several — all land.
 */
import { execFile } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { parseBpmn } from '../../src/bpmn/index.js';
import { resolveScenarioArgument, withRunOverrides } from '../../src/cli-shared.js';
import { main } from '../../src/cli.js';
import { simulate } from '../../src/index.js';
import { isCurrentRun, runProblem, withProcesses, processesOf } from '../../src/project/index.js';
import {
  exportDocument,
  openLilaProcess,
  readLilaFile,
  saveSimulationRun,
  writeLilaProject,
} from '../../src/project-fs/index.js';
import { EXAMPLE_LILA } from './export-fixture.js';

const lilaBin = fileURLToPath(new URL('../../bin/lila.js', import.meta.url));

let dir: string;
let file: string;
let out: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lila-save-run-'));
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

/** A run of `entry` on `file`, ready to save. */
async function simulated(entry: string) {
  const lila = await openLilaProcess(file);
  const { ir } = await parseBpmn(lila.process.model.xml);
  const scenario = withRunOverrides(resolveScenarioArgument(entry, lila).scenario, { seed: 7, replications: 1 });
  return { lila, scenario, result: simulate(ir, scenario, { log: false }) };
}

describe('lila run --save', () => {
  test('stores the run as the app does: current on the desktop load path, and used by export', async () => {
    expect(await main(['run', file, 'to-be-3-cajeros', '--seed', '42', '--replications', '2', '--save'])).toBe(0);
    expect(out.at(-1)).toMatch(/^Run [0-9a-f-]{36} saved in .*pedido\.lila \(process pedido\)\.$/);

    // The desktop opens a .lila with `readLilaFile` and the app keeps a run when `isCurrentRun`.
    const { document } = await readLilaFile(file);
    expect(document.runs).toHaveLength(1);
    const [run] = document.runs;
    expect(runProblem(run)).toBeNull();
    expect(run!.scenarioName).toBe('to-be-3-cajeros.scenario.json');
    expect(isCurrentRun(run!, document.model.revision, document.scenarioRevisions)).toBe(true);
    expect(run!.inputs.xml).toBe(document.model.xml);
    expect(run!.inputs.scenario).toMatchObject({ model: 'model.bpmn', run: { seed: 42, replications: 2 } });
    // Resolved: the stored scenario carries no `extends`, it ran with the parent's values.
    expect(run!.inputs.scenario).not.toHaveProperty('extends');

    const doc = await exportDocument({ file, format: 'html', date: '2026-09-30' });
    expect(doc.run).toEqual({ id: run!.id, scenario: 'to-be-3-cajeros.scenario.json', current: true });
    expect(doc.data).toContain('<h2>Results</h2>');
  });

  test('needs a .lila and a scenario of it', async () => {
    const bpmn = join(dir, 'model.bpmn');
    writeFileSync(bpmn, (await openLilaProcess(file)).process.model.xml);
    expect(await main(['run', bpmn, fileURLToPath(new URL('../../../../examples/pedido/as-is.scenario.json', import.meta.url)), '--save'])).toBe(1);
    expect(out.at(-1)).toMatch(/needs a .lila model/);

    const disk = join(dir, 'mine.scenario.json');
    writeFileSync(disk, JSON.stringify({ version: 1, extends: fileURLToPath(new URL('../../../../examples/pedido/as-is.scenario.json', import.meta.url)) }));
    expect(await main(['run', file, disk, '--save'])).toBe(1);
    expect(out.at(-1)).toMatch(/needs a scenario of the .lila/);
    expect((await readLilaFile(file)).document.runs).toHaveLength(0);
  });
});

describe('saveSimulationRun', () => {
  test('concurrent saves in one process all land', async () => {
    const runs = await Promise.all(['as-is', 'to-be-3-cajeros', 'as-is', 'to-be-3-cajeros', 'as-is'].map(simulated));
    const saved = await Promise.all(runs.map(({ lila, scenario, result }, i) =>
      saveSimulationRun(lila, i % 2 === 0 ? 'as-is' : 'to-be-3-cajeros', scenario, result)));
    const { document } = await readLilaFile(file);
    expect(document.runs.map((r) => r.id).sort()).toEqual(saved.map((s) => s.id).sort());
  });

  test('concurrent `lila run --save` processes all land', async () => {
    const run = promisify(execFile);
    await Promise.all([1, 2, 3].map((seed) =>
      run(process.execPath, [lilaBin, 'run', file, 'as-is', '--seed', String(seed), '--replications', '1', '--save'])));
    const { document } = await readLilaFile(file);
    expect(document.runs.map((r) => (r.inputs.scenario['run'] as { seed: number }).seed).sort()).toEqual([1, 2, 3]);
  }, 60_000);

  test('a run whose model changed meanwhile is refused, and nothing is written', async () => {
    const { lila, scenario, result } = await simulated('as-is');
    // Somebody saves an edited model after the simulation started.
    const other = await openLilaProcess(file);
    const [first] = processesOf(other.document);
    await writeLilaProject(other, withProcesses(other.document, [{ ...first!, model: { ...first!.model, revision: first!.model.revision + 1 } }]));
    await expect(saveSimulationRun(lila, 'as-is', scenario, result)).rejects.toThrow(/changed while the simulation ran; the run was not saved/);
    expect((await readLilaFile(file)).document.runs).toHaveLength(0);
  });
});
