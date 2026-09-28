import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn } from '../../src/bpmn/index.js';
import { simulate } from '../../src/index.js';
import { ScenarioSchema } from '../../src/scenario.js';
import {
  decodeLila,
  encodeLila,
  lilaEntryNames,
  processesOf,
  processSlug,
  ProjectFormatError,
  readProjectDocument,
  withProcesses,
} from '../../src/project/index.js';
import type { ProcessDocument, ProjectDocument, StoredRun } from '../../src/project/index.js';
import { decodeLila as decodeLilaBeta14 } from './fixtures/lila-v1.js';

/**
 * The repository (ADR-029, #498): a version 1 project is a one-process repository, and a second
 * process turns the archive into version 2 with each process under `processes/<slug>/`.
 */
const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../examples/pedido');
const AS_IS = 'as-is.scenario.json';
const TO_BE = 'to-be-3-cajeros.scenario.json';

let v1: ProjectDocument;
let second: ProcessDocument;

async function runOf(id: string, xml: string, raw: Record<string, unknown>): Promise<StoredRun> {
  const scenario = ScenarioSchema.parse({ ...raw, run: { ...(raw.run as object), replications: 1 } });
  const { ir } = await parseBpmn(xml);
  const result = simulate(ir, { ...scenario, model: scenario.model as string, run: scenario.run! }, { log: false });
  return {
    id,
    scenarioName: AS_IS,
    result,
    inputs: { modelRevision: 0, scenarioRevision: 0, xml, scenario: JSON.parse(JSON.stringify(scenario)) as Record<string, unknown> },
  };
}

beforeAll(async () => {
  const xml = readFileSync(resolve(EXAMPLE_DIR, 'model.bpmn'), 'utf8');
  const asIs = JSON.parse(readFileSync(resolve(EXAMPLE_DIR, AS_IS), 'utf8')) as Record<string, unknown>;
  const toBe = JSON.parse(readFileSync(resolve(EXAMPLE_DIR, TO_BE), 'utf8')) as Record<string, unknown>;
  const { ir } = await parseBpmn(xml);
  v1 = {
    version: 1,
    id: 'pedido',
    name: 'Pedido',
    model: { id: ir.id, name: 'model.bpmn', xml, revision: 4 },
    scenarios: { [AS_IS]: asIs, [TO_BE]: toBe },
    scenarioRevisions: { [AS_IS]: 1, [TO_BE]: 0 },
    runs: [await runOf('run-a', xml, asIs)],
  };
  // The second process is the same diagram under another process id: what matters here is the
  // container, not a second model.
  const xml2 = xml.replaceAll(ir.id, 'Process_Facturacion');
  second = {
    slug: 'facturacion',
    name: 'Facturación',
    model: { id: 'Process_Facturacion', name: 'model.bpmn', xml: xml2, revision: 2 },
    scenarios: { [AS_IS]: { ...asIs, name: 'Facturación AS-IS' } },
    scenarioRevisions: { [AS_IS]: 3 },
    runs: [await runOf('run-b', xml2, asIs)],
  };
}, 120_000);

describe('slugs', () => {
  test('are folder-safe, accent-free and unique', () => {
    expect(processSlug('Facturación y Cobro')).toBe('facturacion-y-cobro');
    expect(processSlug('¿?')).toBe('process');
    expect(processSlug('Pedido', ['pedido', 'pedido-2'])).toBe('pedido-3');
    expect(processSlug('CON')).toBe('con-process');
  });
});

describe('a version 1 project is a one-process repository', () => {
  test('open → save without changes is the same bytes', () => {
    const bytes = encodeLila(v1);
    const reopened = decodeLila(bytes);
    expect(reopened).toEqual(v1);
    expect(reopened.processes).toBeUndefined();
    expect(encodeLila(reopened)).toEqual(bytes);
  });

  test('processesOf gives it one process named after the project', () => {
    const [only, ...rest] = processesOf(v1);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ slug: 'pedido', name: 'Pedido', model: v1.model, runs: v1.runs });
    expect(withProcesses(v1, [only!])).toEqual(v1);
  });

  test('a single process never writes version 2', () => {
    const renamed = withProcesses(v1, [{ ...processesOf(v1)[0]!, name: 'Otro', slug: 'otro' }]);
    expect(JSON.parse(strFromU8(unzipSync(encodeLila(renamed))['lila-project.json']!))).toMatchObject({ version: 1 });
  });
});

describe('a second process turns it into version 2', () => {
  let repo: ProjectDocument;
  beforeAll(() => { repo = withProcesses(v1, [...processesOf(v1), second]); });

  test('the layout is processes/<slug>/ with the version 1 files', () => {
    expect([...lilaEntryNames(encodeLila(repo))]).toEqual([
      'lila-project.json',
      'processes/pedido/model.bpmn',
      `processes/pedido/${AS_IS}`,
      `processes/pedido/${TO_BE}`,
      'processes/pedido/runs/run-a.result.json',
      'processes/facturacion/model.bpmn',
      `processes/facturacion/${AS_IS}`,
      'processes/facturacion/runs/run-b.result.json',
    ]);
    const manifest = JSON.parse(strFromU8(unzipSync(encodeLila(repo))['lila-project.json']!)) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      version: 2,
      id: 'pedido',
      name: 'Pedido',
      processes: [
        { slug: 'pedido', name: 'Pedido', model: { id: v1.model.id, name: 'model.bpmn', revision: 4 }, scenarioRevisions: { [AS_IS]: 1, [TO_BE]: 0 } },
        { slug: 'facturacion', name: 'Facturación', model: { id: 'Process_Facturacion', revision: 2 }, scenarioRevisions: { [AS_IS]: 3 } },
      ],
    });
  });

  test('reopening keeps both processes with their scenarios and runs, and a second save is the same bytes', () => {
    const bytes = encodeLila(repo);
    const reopened = decodeLila(bytes);
    expect(reopened).toEqual(repo);
    const [a, b] = processesOf(reopened);
    expect(Object.keys(a!.scenarios)).toEqual([AS_IS, TO_BE]);
    expect(a!.runs.map((r) => r.id)).toEqual(['run-a']);
    expect(b).toEqual(second);
    expect(encodeLila(reopened)).toEqual(bytes);
  });

  test('removing the second process writes version 1 again', () => {
    const back = withProcesses(repo, processesOf(repo).slice(0, 1));
    expect(encodeLila(back)).toEqual(encodeLila(v1));
  });

  test('the beta.14 reader refuses it cleanly instead of misreading it', () => {
    let error: unknown;
    try { decodeLilaBeta14(encodeLila(repo)); } catch (e) { error = e; }
    // It looks for the version 1 `model.bpmn` at the root before it reads the manifest's version,
    // so the refusal it gives is "no model.bpmn" — a clean, coded error, not a crash or a
    // half-read project.
    expect(error).toBeInstanceOf(ProjectFormatError);
    expect((error as ProjectFormatError).code).toBe('LILA-NO-MODEL');
  });

  test('a version the reader does not know is refused with the version error', () => {
    const entries = unzipSync(encodeLila(repo));
    const manifest = JSON.parse(strFromU8(entries['lila-project.json']!)) as Record<string, unknown>;
    entries['lila-project.json'] = strToU8(JSON.stringify({ ...manifest, version: 3 }));
    expect(() => decodeLila(zipSync(entries))).toThrow(/version 3/);
  });

  test('a process folder without model.bpmn is fatal; stray entries are reported and dropped', () => {
    const entries = unzipSync(encodeLila(repo));
    delete entries['processes/facturacion/model.bpmn'];
    expect(() => decodeLila(zipSync(entries))).toThrow(/processes\/facturacion\/model\.bpmn/);

    const again = unzipSync(encodeLila(repo));
    again['model.bpmn'] = strToU8('<stale/>');
    again['processes/borrado/model.bpmn'] = strToU8('<gone/>');
    const opened = decodeLila(zipSync(again));
    expect(opened.problems?.map((p) => p.file)).toEqual(['model.bpmn', 'processes/borrado/model.bpmn']);
    expect(processesOf(opened).map((p) => p.slug)).toEqual(['pedido', 'facturacion']);
  });

  test('a manifest with a bad or repeated slug is refused', () => {
    const entries = unzipSync(encodeLila(repo));
    const manifest = JSON.parse(strFromU8(entries['lila-project.json']!)) as { processes: { slug: string }[] };
    manifest.processes[1]!.slug = '../x';
    entries['lila-project.json'] = strToU8(JSON.stringify(manifest));
    expect(() => decodeLila(zipSync(entries))).toThrow(/slug/);
    manifest.processes[1]!.slug = 'pedido';
    entries['lila-project.json'] = strToU8(JSON.stringify(manifest));
    expect(() => decodeLila(zipSync(entries))).toThrow(/repeated/);
  });

  test('the document validation refuses repeated slugs and invalid runs in any process', () => {
    expect(() => readProjectDocument({ ...repo, processes: [{ ...second, slug: 'pedido' }] })).toThrow(/not a Lila project/);
    expect(() => readProjectDocument({ ...repo, processes: [{ ...second, runs: [{ id: 'x' }] }] })).toThrow(/invalid shape/);
  });
});
