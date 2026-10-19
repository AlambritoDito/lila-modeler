/**
 * The read-only inventory of #628: `lilaProjectInventory` (`get_project`, `lila project show`) and
 * `lilaScenarioView` (`get_scenario`, `lila scenario show`). Runs are current or stale by the rule
 * `export_results` uses, a scenario reads as stored or resolved with the validator's notes, and
 * nothing ever touches the file: every test compares its bytes.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../../src/cli.js';
import { decodeLila, encodeLila, type ProcessDocument, type ProjectDocument } from '../../src/project/index.js';
import { defineLilaAttribute, lilaProjectInventory, lilaScenarioView } from '../../src/project-fs/index.js';
import { EXAMPLE_LILA, pedidoWithRuns } from './export-fixture.js';

let scratch: string;
let out: string[];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lila-inventory-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * pedido with a run of each scenario, the TO-BE saved again after its run (so that run is stale),
 * as a repository with a second process `copia` whose only scenario is a draft with an unknown id.
 */
async function repository(): Promise<string> {
  const file = join(scratch, 'repo.lila');
  await pedidoWithRuns(file, ['as-is.scenario.json', 'to-be-3-cajeros.scenario.json']);
  const base = decodeLila(readFileSync(file));
  const copia: ProcessDocument = {
    slug: 'copia',
    name: 'Copia',
    model: { ...decodeLila(readFileSync(EXAMPLE_LILA)).model, revision: 4 },
    scenarios: { 'borrador.scenario.json': { version: 1, extends: 'missing.scenario.json' } },
    scenarioRevisions: { 'borrador.scenario.json': 2 },
    runs: [],
  };
  const document: ProjectDocument = {
    ...base,
    scenarioRevisions: { ...base.scenarioRevisions, 'to-be-3-cajeros.scenario.json': 2 },
    process: { slug: 'pedido', name: 'Pedido' },
    processes: [copia],
  };
  writeFileSync(file, encodeLila(document));
  return file;
}

describe('lilaProjectInventory', () => {
  test('processes, scenarios and runs, current or stale, without writing', async () => {
    const file = await repository();
    const bytes = readFileSync(file);
    const inventory = await lilaProjectInventory({ file });
    expect(inventory).toEqual({
      file: file.replaceAll('\\', '/'),
      name: 'pedido',
      formatVersion: 2,
      processes: [
        {
          slug: 'pedido',
          name: 'Pedido',
          processId: 'Process_Restaurante',
          modelRevision: 1,
          elements: 11,
          scenarios: [
            { entry: 'as-is.scenario.json', name: 'AS-IS', revision: 1, extends: null },
            { entry: 'to-be-3-cajeros.scenario.json', name: 'TO-BE 3 cashiers', revision: 2, extends: 'as-is.scenario.json' },
          ],
          runs: [
            { id: 'run-1', scenario: 'as-is.scenario.json', start: expect.any(String), replications: 1, current: true },
            { id: 'run-2', scenario: 'to-be-3-cajeros.scenario.json', start: expect.any(String), replications: 1, current: false },
          ],
          attributes: [],
        },
        {
          slug: 'copia',
          name: 'Copia',
          processId: 'Process_Restaurante',
          modelRevision: 4,
          elements: 11,
          scenarios: [{ entry: 'borrador.scenario.json', name: null, revision: 2, extends: 'missing.scenario.json' }],
          runs: [],
          attributes: [],
        },
      ],
    });
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('lists the extended attributes each process defines (#633); null for a model that cannot be read back whole', async () => {
    const file = await repository();
    await defineLilaAttribute({ file, process: 'copia', name: 'Risk', type: 'list', appliesTo: 'task', options: ['Low', 'High'] });
    const document = decodeLila(readFileSync(file));
    const b20 = readFileSync(new URL('../../../../examples/bizagi-exports/bizagi-miwg-B.2.0-roundtrip.bpmn', import.meta.url), 'utf8');
    writeFileSync(file, encodeLila({ ...document, model: { ...document.model, xml: b20 } }));
    const bytes = readFileSync(file);
    const inventory = await lilaProjectInventory({ file });
    expect(inventory.processes.map((p) => [p.slug, p.attributes])).toEqual([
      ['pedido', null],
      ['copia', [{ id: 'Attr_risk', name: 'Risk', type: 'list', appliesTo: 'task', options: ['Low', 'High'] }]],
    ]);
    expect(readFileSync(file).equals(bytes)).toBe(true);

    expect(await main(['project', 'show', file])).toBe(0);
    expect(out).toContain('  extended attributes: unreadable model');
    expect(out).toContain('  1 extended attribute:');
    expect(out).toContain('    Attr_risk  "Risk"  list, for tasks, options Low, High');
  });

  test('a one-process project is format version 1', async () => {
    const inventory = await lilaProjectInventory({ file: EXAMPLE_LILA });
    expect(inventory.formatVersion).toBe(1);
    expect(inventory.processes.map((p) => p.slug)).toEqual(['pedido']);
  });
});

describe('lilaScenarioView', () => {
  test('as stored, and resolved through extends with the defaults, with the lint notes', async () => {
    const file = await repository();
    const bytes = readFileSync(file);
    const stored = await lilaScenarioView({ file, process: 'pedido', scenario: 'TO-BE 3 cashiers' });
    expect(stored).toMatchObject({
      process: 'pedido',
      entry: 'to-be-3-cajeros.scenario.json',
      revision: 2,
      resolved: false,
      scenario: { version: 1, name: 'TO-BE 3 cashiers', extends: 'as-is.scenario.json', resources: { cajero: { capacity: 3 } } },
      runnable: true,
    });

    const resolved = await lilaScenarioView({ file, process: 'pedido', scenario: 'to-be-3-cajeros', resolved: true });
    expect(resolved.resolved).toBe(true);
    expect(resolved.scenario).not.toHaveProperty('extends');
    // `run` is the AS-IS's, inherited through `extends`.
    expect(resolved.scenario).toMatchObject({ model: 'model.bpmn', resources: { cajero: { capacity: 3 } }, run: { warmup: 3600 } });
    expect(resolved.notes).toEqual(stored.notes);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('a draft that cannot run: runnable false and why, in the caller\'s language', async () => {
    const file = await repository();
    const view = await lilaScenarioView({ file, process: 'copia', scenario: 'borrador', resolved: true, locale: 'es' });
    expect(view.runnable).toBe(false);
    expect(view.scenario).toBeNull();
    expect(view.notes[0]).toContain('missing.scenario.json');

    // An unknown element id is an error of the validator, not of the tool.
    const document = decodeLila(readFileSync(EXAMPLE_LILA));
    const scenario = { ...document.scenarios['as-is.scenario.json'], elements: { Nope: { processingTime: { type: 'constant', value: 1 } } } };
    const draft = join(scratch, 'draft.lila');
    writeFileSync(draft, encodeLila({ ...document, scenarios: { ...document.scenarios, 'as-is.scenario.json': scenario } }));
    const lint = await lilaScenarioView({ file: draft, scenario: 'as-is' });
    expect(lint.runnable).toBe(false);
    expect(lint.notes.some((note) => note.startsWith('E-'))).toBe(true);
  });

  test('a repository needs the process; an unknown scenario lists the ones there are', async () => {
    const file = await repository();
    await expect(lilaScenarioView({ file, scenario: 'as-is' })).rejects.toThrow('several processes (pedido, copia)');
    await expect(lilaScenarioView({ file, process: 'pedido', scenario: 'nope' })).rejects.toThrow(
      'its scenarios are: as-is.scenario.json, to-be-3-cajeros.scenario.json',
    );
  });
});

describe('CLI', () => {
  test('lila project show, as text (en, es) and JSON; the file is not touched', async () => {
    const file = await repository();
    const bytes = readFileSync(file);
    expect(await main(['project', 'show', file])).toBe(0);
    expect(out.slice(0, 7)).toEqual([
      `Project "pedido" (${file.replaceAll('\\', '/')}), format version 2`,
      'Process pedido "Pedido": Process_Restaurante, model revision 1, 11 elements',
      '  2 scenarios:',
      '    as-is.scenario.json  "AS-IS"  revision 1',
      '    to-be-3-cajeros.scenario.json  "TO-BE 3 cashiers"  revision 2  extends as-is.scenario.json',
      '  2 saved runs:',
      expect.stringMatching(/^ {4}run-1 {2}as-is\.scenario\.json {2}1 replication, start .+, current$/),
    ]);
    expect(out[7]).toMatch(/, stale$/);
    out = [];
    expect(await main(['--lang', 'es', 'project', 'show', file])).toBe(0);
    expect(out[1]).toBe('Proceso pedido "Pedido": Process_Restaurante, revisión del modelo 1, 11 elementos');
    expect(out.slice(-2)).toEqual(['  0 corridas guardadas', '  0 atributos extendidos']);
    out = [];
    expect(await main(['project', 'show', file, '--json'])).toBe(0);
    expect(JSON.parse(out.join('\n'))).toEqual(await lilaProjectInventory({ file }));
    out = [];
    expect(await main(['project', 'list', file])).toBe(1);
    expect(out[0]).toBe('lila project: unknown subcommand "list"; use show, create.');
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('lila scenario show, stored and --resolved, text and JSON', async () => {
    const file = await repository();
    const bytes = readFileSync(file);
    expect(await main(['scenario', 'show', file, 'to-be-3-cajeros', '--process', 'pedido'])).toBe(0);
    expect(out[0]).toBe('Scenario to-be-3-cajeros.scenario.json of process pedido, revision 2, as stored:');
    expect(out.at(-1)).toBe('It can run.');
    out = [];
    expect(await main(['scenario', 'show', file, 'borrador', '--process', 'copia', '--resolved', '--json'])).toBe(0);
    expect(JSON.parse(out.join('\n'))).toMatchObject({ entry: 'borrador.scenario.json', resolved: true, scenario: null, runnable: false });
    out = [];
    expect(await main(['--lang', 'es', 'scenario', 'show', file, 'borrador', '--process', 'copia'])).toBe(0);
    expect(out.at(-1)).toBe('No se puede correr así: mira los errores de arriba.');
    out = [];
    expect(await main(['scenario', 'show', file])).toBe(1);
    expect(out[0]).toMatch(/^lila scenario show: /);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });
});
