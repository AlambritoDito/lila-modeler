import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn } from '../../src/bpmn/index.js';
import { simulate } from '../../src/index.js';
import { ScenarioSchema } from '../../src/scenario.js';
import { decodeLila, encodeLila, lilaEntryNames } from '../../src/project/index.js';
import type { ProjectDocument, StoredRun } from '../../src/project/index.js';

/**
 * Acceptance of the `.lila` container (#317, ADR-027) against the real example. `examples/pedido`
 * is a project FOLDER without a `lila-project.json` — the manifest is reconstructed here exactly
 * as the desktop opener reconstructs it for a folder someone assembled by hand, which is also the
 * shape `zip -r pedido.lila pedido/*` would produce.
 */
const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../examples/pedido');
const AS_IS = 'as-is.scenario.json';
const TO_BE = 'to-be-3-cajeros.scenario.json';

let document: ProjectDocument;
let run: StoredRun;

beforeAll(async () => {
  const xml = readFileSync(resolve(EXAMPLE_DIR, 'model.bpmn'), 'utf8');
  const asIs = JSON.parse(readFileSync(resolve(EXAMPLE_DIR, AS_IS), 'utf8')) as Record<string, unknown>;
  const toBe = JSON.parse(readFileSync(resolve(EXAMPLE_DIR, TO_BE), 'utf8')) as Record<string, unknown>;

  // One replication: what is under test is the container, and 30 would only multiply the clock.
  const scenario = ScenarioSchema.parse({ ...asIs, run: { ...(asIs.run as object), replications: 1 } });
  const { ir } = await parseBpmn(xml);
  const result = simulate(ir, { ...scenario, model: scenario.model as string, run: scenario.run! }, { log: false });

  run = {
    id: 'run-as-is-1',
    scenarioName: AS_IS,
    result,
    inputs: {
      modelRevision: 0,
      scenarioRevision: 0,
      xml,
      scenario: JSON.parse(JSON.stringify(scenario)) as Record<string, unknown>,
    },
  };
  document = {
    version: 1,
    id: 'pedido',
    name: 'pedido',
    model: { id: ir.id, name: 'model.bpmn', xml, revision: 0 },
    scenarios: { [AS_IS]: asIs, [TO_BE]: toBe },
    scenarioRevisions: { [AS_IS]: 0, [TO_BE]: 0 },
    runs: [run],
  };
}, 120_000);

describe('the .lila container', () => {
  test('a round-trip is the identity on the document', () => {
    expect(decodeLila(encodeLila(document))).toEqual(document);
  });

  test('the archive holds exactly the ADR-018 folder, with the same names', () => {
    expect([...lilaEntryNames(encodeLila(document))]).toEqual([
      'lila-project.json',
      'model.bpmn',
      AS_IS,
      TO_BE,
      `runs/${run.id}.result.json`,
    ]);
  });

  test('encoding is deterministic, so two saves of one document are the same bytes', () => {
    expect(encodeLila(document)).toEqual(encodeLila(document));
  });

  test('the manifest stamps the engine that wrote the runs, and reading ignores it', () => {
    const manifest = JSON.parse(
      new TextDecoder().decode(unzipSync(encodeLila(document))['lila-project.json']),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({ version: 1, id: 'pedido', name: 'pedido', engine: expect.any(String) });
  });

  /** Rebuilds an archive with `mutate` applied to its entries; the shortcut every case below uses. */
  function rebuilt(mutate: (entries: Record<string, Uint8Array>) => void): Uint8Array {
    const entries = unzipSync(encodeLila(document));
    mutate(entries);
    return zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, v])));
  }

  test('a malformed run does not abort the opening: it lands in `problems`', () => {
    const bytes = rebuilt((entries) => {
      entries[`runs/${run.id}.result.json`] = strToU8('{"id":"run-as-is-1","scenarioName":"as-is.scenario.json"}');
    });
    const opened = decodeLila(bytes);
    expect(opened.runs).toEqual([]);
    expect(opened.problems).toEqual([
      { file: `runs/${run.id}.result.json`, message: expect.stringContaining('invalid shape') },
    ]);
    // The rest of the project is still there: that is the point of not aborting.
    expect(Object.keys(opened.scenarios)).toEqual([AS_IS, TO_BE]);
  });

  test('a file that is not part of the layout is reported and dropped', () => {
    const opened = decodeLila(rebuilt((entries) => { entries['notes.md'] = strToU8('# notes'); }));
    expect(opened.problems).toEqual([
      { file: 'notes.md', message: expect.stringContaining('not part of the Lila project layout') },
    ]);
    // Dropped, not carried: saving again writes the five entries of the layout and nothing else.
    expect([...lilaEntryNames(encodeLila(opened))]).not.toContain('notes.md');
  });

  test('an archive without a manifest is not a project', () => {
    expect(() => decodeLila(rebuilt((entries) => { delete entries['lila-project.json']; })))
      .toThrow(/lila-project\.json/);
  });

  test('a manifest of a newer version is refused instead of being read as version 1', () => {
    expect(() => decodeLila(rebuilt((entries) => {
      const manifest = JSON.parse(strFromU8(entries['lila-project.json']!));
      entries['lila-project.json'] = strToU8(JSON.stringify({ ...manifest, version: 2 }));
    }))).toThrow(/version 2/);
  });

  test('an archive without model.bpmn is not a project', () => {
    expect(() => decodeLila(rebuilt((entries) => { delete entries['model.bpmn']; })))
      .toThrow(/model\.bpmn/);
  });

  test('a traversal entry is refused instead of being opened around', () => {
    const bytes = rebuilt((entries) => { entries['../x'] = strToU8('escape'); });
    expect(() => decodeLila(bytes)).toThrow(/unsafe entry name/);
  });

  test('an absolute entry is refused too', () => {
    const bytes = rebuilt((entries) => { entries['/etc/passwd'] = strToU8('escape'); });
    expect(() => decodeLila(bytes)).toThrow(/unsafe entry name/);
  });

  test('bytes that are not a zip fail as a format error, not a crash', () => {
    expect(() => decodeLila(strToU8('not a zip'))).toThrow(/readable \.lila archive/);
  });
});
