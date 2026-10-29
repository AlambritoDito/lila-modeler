import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';

import { validateBpmnModel } from '../../src/bpmn/index.js';
import { simulate } from '../../src/index.js';
import { decodeLila, encodeLila, processesOf } from '../../src/project/index.js';
import { lilaScenarioView } from '../../src/project-fs/index.js';
import type { ProcessDocument, ProjectDocument } from '../../src/project/index.js';
import { parseScenario, resolveExtends, validateScenario } from '../../src/scenario.js';

/**
 * #699: every `.lila` a released version wrote keeps opening and running. The archives under
 * `test/fixtures/released-lila/` are frozen (see its README): they stand for files already in
 * people's hands, so they are never regenerated, and their sha256 is pinned here so an accidental
 * rewrite fails this test instead of quietly moving the goalposts.
 */
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/released-lila');

const FROZEN = {
  'legacy-loose-model-v1.lila': '7d91642ca138218913cb3d81f808d9be39841b255c37c0caef3e7c5de08c71ac',
  'v1.lila': 'ab328695ee616bcc42b4296508c3297b3567d729043942c095ec605da73f8678',
  'v2-two-processes.lila': 'b9d06930cf02c97b7a49a538f4ab9460752058cf8ce67fe5a9fce9e72d8ed3a3',
} as const;

const LEGACY = 'legacy-loose-model-v1.lila';
const LEGACY_MODEL = 'service-request.bpmn';

function fixture(name: keyof typeof FROZEN): Uint8Array {
  return new Uint8Array(readFileSync(resolve(FIXTURES, name)));
}

/** `bytes` with `change` applied to its entries, zipped again in the same order. */
function rezip(bytes: Uint8Array, change: (entries: Record<string, Uint8Array>) => void): Uint8Array {
  const entries = unzipSync(bytes);
  change(entries);
  return zipSync(entries);
}

function json(raw: Uint8Array | undefined): Record<string, unknown> {
  return JSON.parse(strFromU8(raw as Uint8Array)) as Record<string, unknown>;
}

function withJson(entries: Record<string, Uint8Array>, name: string, edit: (value: Record<string, unknown>) => Record<string, unknown>): void {
  entries[name] = strToU8(`${JSON.stringify(edit(json(entries[name])), null, 2)}\n`);
}

/**
 * What «Run» does with one scenario of a process, without a Worker: resolve `extends`, check the
 * scenario targets the process's model (the gate in `apps/web/src/simulationGate.ts`), validate
 * the model and the scenario, and simulate with seed 42 and a few replications.
 */
async function runScenario(process: ProcessDocument, file: string) {
  const resolved = resolveExtends(file, (path) => {
    const raw = process.scenarios[path];
    if (raw === undefined) throw new Error(`unknown scenario ${path}`);
    return raw;
  });
  const parsed = parseScenario(resolved);
  if (!parsed.success) throw new Error(parsed.error.message);
  const scenario = parsed.data;
  // The app accepts only `model.bpmn` for a project (`expectedModel` in `App.tsx`).
  if (scenario.model !== 'model.bpmn' || process.model.name !== 'model.bpmn') {
    throw new Error(`the scenario points at ${scenario.model}, but the active model is ${process.model.name}.`);
  }
  const model = await validateBpmnModel(process.model.xml, { scenarios: Object.values(process.scenarios) });
  expect(model.errors).toEqual([]);
  expect(validateScenario(scenario, model.ir).filter((p) => p.severity === 'error')).toEqual([]);
  const run = { ...scenario.run!, seed: 42, replications: 2 };
  return simulate(model.ir, { ...scenario, model: scenario.model, run }, { log: false });
}

async function expectEveryScenarioRuns(document: ProjectDocument): Promise<void> {
  for (const process of processesOf(document)) {
    expect(Object.keys(process.scenarios).length).toBeGreaterThan(0);
    for (const file of Object.keys(process.scenarios)) {
      const result = await runScenario(process, file);
      expect(result.replications?.count, `${process.slug}/${file}`).toBe(2);
      expect(result.process.completed, `${process.slug}/${file}`).toBeGreaterThan(0);
    }
  }
}

describe('frozen archives written by released versions (#699)', () => {
  test.each(Object.entries(FROZEN))('%s has not been regenerated', (name, sha256) => {
    expect(createHash('sha256').update(fixture(name as keyof typeof FROZEN)).digest('hex')).toBe(sha256);
  });

  test.each(Object.keys(FROZEN))('%s opens, every scenario runs, and save → reopen gives it back', async (name) => {
    const opened = decodeLila(fixture(name as keyof typeof FROZEN));
    expect(opened.problems).toBeUndefined();
    await expectEveryScenarioRuns(opened);

    const saved = encodeLila(opened);
    const reopened = decodeLila(saved);
    expect(reopened).toEqual(opened);
    expect(encodeLila(reopened)).toEqual(saved);
    await expectEveryScenarioRuns(reopened);
  }, 60_000);

  test.each(['v1.lila', 'v2-two-processes.lila'] as const)('%s: today\'s writer gives back its entries byte for byte, but for the engine stamp', (name) => {
    const frozen = unzipSync(fixture(name));
    const saved = unzipSync(encodeLila(decodeLila(fixture(name))));
    expect(Object.keys(saved)).toEqual(Object.keys(frozen));
    for (const entry of Object.keys(frozen)) {
      if (entry === 'lila-project.json') {
        expect({ ...json(saved[entry]), engine: null }, entry).toEqual({ ...json(frozen[entry]), engine: null });
      } else {
        expect(saved[entry], entry).toEqual(frozen[entry]);
      }
    }
  });

  test('a regular archive is read exactly as it is stored', () => {
    const entries = unzipSync(fixture('v1.lila'));
    const opened = decodeLila(fixture('v1.lila'));
    expect(opened.model.name).toBe('model.bpmn');
    expect(opened.model.xml).toBe(strFromU8(entries['model.bpmn'] as Uint8Array));
    for (const [file, scenario] of Object.entries(opened.scenarios)) expect(scenario).toEqual(json(entries[file]));
  });
});

describe('the legacy loose-diagram archive (#613, #699)', () => {
  test('the frozen file has the shape released versions wrote', () => {
    const entries = unzipSync(fixture(LEGACY));
    expect(Object.keys(entries)).toEqual(['lila-project.json', 'model.bpmn', 'as-is.scenario.json', 'to-be.scenario.json']);
    expect(json(entries['lila-project.json'])).toMatchObject({ version: 1, model: { name: LEGACY_MODEL }, engine: '1.0.0-beta.16' });
    expect(json(entries['as-is.scenario.json'])['model']).toBe(LEGACY_MODEL);
    expect(json(entries['to-be.scenario.json'])).not.toHaveProperty('model');
    expect(json(entries['to-be.scenario.json'])['extends']).toBe('as-is.scenario.json');
  });

  test('it opens as model.bpmn, and AS IS and its extends TO BE both run', async () => {
    const opened = decodeLila(fixture(LEGACY));
    expect(opened.model.name).toBe('model.bpmn');
    expect(opened.scenarios['as-is.scenario.json']?.['model']).toBe('model.bpmn');
    expect(await runScenario(opened as unknown as ProcessDocument, 'as-is.scenario.json')).toBeTruthy();
    expect(await runScenario(opened as unknown as ProcessDocument, 'to-be.scenario.json')).toBeTruthy();
  }, 60_000);

  test('only the retargeted model changes: XML, ids, revisions and parameters stay byte for byte', () => {
    const entries = unzipSync(fixture(LEGACY));
    const manifest = json(entries['lila-project.json']);
    const saved = unzipSync(encodeLila(decodeLila(fixture(LEGACY))));

    expect(Object.keys(saved)).toEqual(Object.keys(entries));
    expect(saved['model.bpmn']).toEqual(entries['model.bpmn']);
    // The only differences in the manifest: the model's name, and the stamp of the engine that saved.
    const { engine: _old, ...before } = manifest;
    const { engine: _new, ...after } = json(saved['lila-project.json']);
    expect(after).toEqual({ ...before, model: { ...(before.model as object), name: 'model.bpmn' } });
    // AS IS differs in `model` only; TO BE, which inherits it, not at all.
    expect(json(saved['as-is.scenario.json'])).toEqual({ ...json(entries['as-is.scenario.json']), model: 'model.bpmn' });
    expect(saved['to-be.scenario.json']).toEqual(entries['to-be.scenario.json']);
    const asIs = strFromU8(saved['as-is.scenario.json'] as Uint8Array);
    expect(asIs).toBe(strFromU8(entries['as-is.scenario.json'] as Uint8Array).replace(`"model": "${LEGACY_MODEL}"`, '"model": "model.bpmn"'));
  });

  test('a scenario that names neither the manifest model nor model.bpmn is left alone and still refused', async () => {
    const bytes = rezip(fixture(LEGACY), (entries) => {
      withJson(entries, 'to-be.scenario.json', (s) => ({ ...s, model: 'another-process.bpmn' }));
    });
    const opened = decodeLila(bytes);
    expect(opened.model.name).toBe('model.bpmn');
    expect(opened.scenarios['as-is.scenario.json']?.['model']).toBe('model.bpmn');
    expect(opened.scenarios['to-be.scenario.json']?.['model']).toBe('another-process.bpmn');
    await expect(runScenario(opened as unknown as ProcessDocument, 'to-be.scenario.json')).rejects.toThrow(
      'the scenario points at another-process.bpmn, but the active model is model.bpmn.',
    );
  });

  test('a scenario naming an entry the archive holds is not retargeted, on this open or the next', async () => {
    const bytes = rezip(fixture(LEGACY), (entries) => {
      entries[LEGACY_MODEL] = entries['model.bpmn'] as Uint8Array;
    });
    const opened = decodeLila(bytes);
    // The model read is still the archive's `model.bpmn`; the extra entry is dropped.
    expect(opened.model.name).toBe('model.bpmn');
    expect(opened.scenarios['as-is.scenario.json']?.['model']).toBe(LEGACY_MODEL);
    expect(opened.problems).toEqual([{ file: LEGACY_MODEL, message: expect.stringContaining('not part of the Lila project layout') }]);
    await expect(runScenario(opened as unknown as ProcessDocument, 'as-is.scenario.json')).rejects.toThrow(
      `the scenario points at ${LEGACY_MODEL}, but the active model is model.bpmn.`,
    );
    // Saved and opened again, without the entry: still refused, not quietly repaired.
    const { problems: _problems, ...withoutProblems } = opened;
    const again = decodeLila(encodeLila(withoutProblems));
    expect(again).toEqual(withoutProblems);
    await expect(runScenario(again as unknown as ProcessDocument, 'as-is.scenario.json')).rejects.toThrow(`the scenario points at ${LEGACY_MODEL}`);
  });

  test('a version 2 process with the legacy shape is read the same way, and only that process', async () => {
    const bytes = rezip(fixture('v2-two-processes.lila'), (entries) => {
      withJson(entries, 'lila-project.json', (m) => ({
        ...m,
        processes: (m.processes as Array<Record<string, unknown>>).map((p) =>
          p.slug === 'billing' ? { ...p, model: { ...(p.model as object), name: 'billing.bpmn' } } : p,
        ),
      }));
      withJson(entries, 'processes/billing/as-is.scenario.json', (s) => ({ ...s, model: 'billing.bpmn' }));
      // A scenario of the other process naming that file is not retargeted: its manifest entry
      // names `model.bpmn`, so `billing.bpmn` is a genuinely different model there.
      withJson(entries, 'processes/service-request/as-is.scenario.json', (s) => ({ ...s, model: 'billing.bpmn' }));
    });
    const opened = decodeLila(bytes);
    const [serviceRequest, billing] = processesOf(opened);
    expect(billing?.model.name).toBe('model.bpmn');
    expect(billing?.scenarios['as-is.scenario.json']?.['model']).toBe('model.bpmn');
    expect(await runScenario(billing as ProcessDocument, 'as-is.scenario.json')).toBeTruthy();
    expect(serviceRequest?.model.name).toBe('model.bpmn');
    expect(serviceRequest?.scenarios['as-is.scenario.json']?.['model']).toBe('billing.bpmn');
    await expect(runScenario(serviceRequest as ProcessDocument, 'as-is.scenario.json')).rejects.toThrow('the scenario points at billing.bpmn');
  }, 60_000);

  test('the CLI and the MCP server see AS IS and TO BE as runnable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lila-699-'));
    try {
      const file = join(dir, LEGACY);
      copyFileSync(resolve(FIXTURES, LEGACY), file);
      for (const scenario of ['as-is.scenario.json', 'to-be.scenario.json']) {
        const view = await lilaScenarioView({ file, scenario, resolved: true });
        expect(view, scenario).toMatchObject({ runnable: true, scenario: { model: 'model.bpmn' } });
        expect(view.notes.filter((note) => note.startsWith('E-')), scenario).toEqual([]);
      }
      expect(readFileSync(file).equals(readFileSync(resolve(FIXTURES, LEGACY)))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
