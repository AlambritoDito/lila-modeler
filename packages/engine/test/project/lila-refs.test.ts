/**
 * #670 (A1.0 of #127), path 1: every `lila:*Ref` and `lila:responsibility` survives
 * `decodeLila(encodeLila(document))` unchanged, for a version 1 project and a version 2 repository,
 * and a second encode gives the same bytes. The folder, the archive on disk and the agent writes
 * are in `test/project-fs/lila-refs.test.ts`.
 */
import { strFromU8, unzipSync } from 'fflate';
import { beforeAll, describe, expect, test } from 'vitest';

import { decodeLila, encodeLila, lilaEntryNames, processesOf } from '../../src/project/index.js';
import type { ProjectDocument } from '../../src/project/index.js';
import {
  EXPECTED_ORDERED,
  SECOND_SLUG,
  expectFullCoverage,
  inventories,
  orderedReferences,
  refsModel,
  lilaInventory,
  v1Project,
  v2Repository,
} from '../lila-refs.fixture.js';

let v1: ProjectDocument;
let v2: ProjectDocument;

beforeAll(async () => {
  v1 = await v1Project();
  v2 = await v2Repository();
}, 120_000);

describe('the fixture', () => {
  test('carries every REF_KINDS kind, R/A/C/I and every V1_TAGS type, in every model it puts in a container', async () => {
    const xml = await refsModel();
    expectFullCoverage(lilaInventory(xml));
    expect(await orderedReferences(xml)).toEqual(EXPECTED_ORDERED);
    for (const document of [v1, v2]) {
      for (const [key, inventory] of Object.entries(inventories(document))) {
        expect(inventory.length, key).toBeGreaterThan(0);
        expectFullCoverage(inventory);
      }
    }
    // A repository of two processes, each with its own run: four models to carry.
    expect(Object.keys(inventories(v2))).toEqual(['pedido', 'pedido/runs/run-a', SECOND_SLUG, `${SECOND_SLUG}/runs/run-b`]);
    // The two processes are told apart by their process id, so a swap would not compare equal.
    const [first, second] = processesOf(v2).map((p) => lilaInventory(p.model.xml));
    expect(first).not.toEqual(second);
  });
});

describe.each([
  ['version 1 project', () => v1, 1, ['lila-project.json', 'model.bpmn']],
  ['version 2 repository', () => v2, 2, ['lila-project.json', 'processes/pedido/model.bpmn', `processes/${SECOND_SLUG}/model.bpmn`]],
] as const)('decodeLila(encodeLila(…)): %s', (_label, document, version, entries) => {
  test('every model and every run keeps the same references, byte for byte', async () => {
    const original = document();
    const bytes = encodeLila(original);
    // Exactly the layout of that version: its manifest, and one model per process where it belongs.
    const manifest = JSON.parse(strFromU8(unzipSync(bytes)['lila-project.json']!)) as { version: number };
    expect(manifest.version).toBe(version);
    expect(lilaEntryNames(bytes).filter((name) => name === 'lila-project.json' || name.endsWith('model.bpmn'))).toEqual(entries);
    const reopened = decodeLila(bytes);

    expect(reopened.problems).toBeUndefined();
    expect(inventories(reopened)).toEqual(inventories(original));
    const before = processesOf(original);
    const after = processesOf(reopened);
    expect(after.map((p) => p.slug)).toEqual(before.map((p) => p.slug));
    for (const [i, process] of after.entries()) {
      // The container stores the XML as it is: not only the same references, the same text.
      expect(process.model.xml).toBe(before[i]!.model.xml);
      expect(process.runs.map((r) => r.inputs.xml)).toEqual(before[i]!.runs.map((r) => r.inputs.xml));
      expect(await orderedReferences(process.model.xml)).toEqual(EXPECTED_ORDERED);
      expectFullCoverage(lilaInventory(process.model.xml));
    }
  });

  test('a second encode of the reopened document gives the same bytes', () => {
    const bytes = encodeLila(document());
    const again = encodeLila(decodeLila(bytes));
    expect(Buffer.from(again).equals(Buffer.from(bytes))).toBe(true);
  });
});
