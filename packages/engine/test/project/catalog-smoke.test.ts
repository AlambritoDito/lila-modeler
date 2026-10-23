/**
 * Performance smoke test of the catalog operations (#672): a generated synthetic repository of 50
 * processes × 40 tasks and 200 catalog objects (50 of each type of lot A1), each task with a RACI
 * responsibility, a system and an input. It opens the archive, builds the usage index, renames an
 * object, deletes a used one with `replaceWith` and saves, and prints how long each step took.
 *
 * No timing is asserted: the budgets of RM-01 § 9 are out of v1 (orchestrator default of #672).
 * Only the generator is committed, never its output; every name is synthetic
 * (`docs/EXAMPLES_POLICY.md`).
 */
import { expect, test } from 'vitest';

import {
  decodeLila,
  deleteCatalogObject,
  encodeLila,
  processesOf,
  updateCatalogObject,
  usageIndex,
  withProcesses,
  type CatalogObject,
  type ProcessDocument,
  type ProjectDocument,
} from '../../src/project/index.js';

const PROCESSES = 50;
const TASKS = 40;
const PER_TYPE = 50;

const pad = (n: number, width: number): string => String(n).padStart(width, '0');
const idOf = (type: string, n: number): string => `${type}-${pad(n, 12)}`;

function model(p: number): string {
  const tasks: string[] = [];
  const flows: string[] = [];
  for (let t = 1; t <= TASKS; t++) {
    const k = (p * TASKS + t) % PER_TYPE;
    tasks.push(`    <bpmn:task id="Task_${t}" name="Task ${pad(t, 2)}">
      <bpmn:extensionElements><lila:responsibility type="R" roleRef="${idOf('role', k)}" /><lila:systemRef ref="${idOf('system', k)}" /><lila:input ref="${idOf('document', k)}" /></bpmn:extensionElements>
      <bpmn:incoming>Flow_${t}</bpmn:incoming><bpmn:outgoing>Flow_${t + 1}</bpmn:outgoing>
    </bpmn:task>`);
  }
  for (let f = 1; f <= TASKS + 1; f++) {
    const source = f === 1 ? 'Start_1' : `Task_${f - 1}`;
    const target = f === TASKS + 1 ? 'End_1' : `Task_${f}`;
    flows.push(`    <bpmn:sequenceFlow id="Flow_${f}" sourceRef="${source}" targetRef="${target}" />`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="Defs_${p}" targetNamespace="https://lila-modeler.org/bpmn">
  <bpmn:process id="Process_${pad(p, 3)}" name="Process ${pad(p, 3)}" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
${tasks.join('\n')}
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_${TASKS + 1}</bpmn:incoming></bpmn:endEvent>
${flows.join('\n')}
  </bpmn:process>
</bpmn:definitions>
`;
}

/** The synthetic repository: processes `process-000`…, objects `role-000000000000`… */
function syntheticOrg(): ProjectDocument {
  const catalog: CatalogObject[] = [];
  for (const type of ['role', 'unit', 'system', 'document']) {
    for (let n = 0; n < PER_TYPE; n++) {
      catalog.push({ type, id: idOf(type, n), name: `${type[0]!.toUpperCase()}${type.slice(1)} ${pad(n, 4)}`, revision: 1 });
    }
  }
  const processes: ProcessDocument[] = Array.from({ length: PROCESSES }, (_, p) => ({
    id: `process-${pad(p, 12)}`,
    slug: `process-${pad(p, 3)}`,
    name: `Process ${pad(p, 3)}`,
    model: { id: `Process_${pad(p, 3)}`, name: 'model.bpmn', xml: model(p), revision: 1 },
    scenarios: {},
    scenarioRevisions: {},
    runs: [],
  }));
  const base: ProjectDocument = {
    version: 1,
    id: '00000000-0000-4000-8000-000000000672',
    name: 'Synthetic org',
    formatVersion: 3,
    catalog,
    model: processes[0]!.model,
    scenarios: {},
    scenarioRevisions: {},
    runs: [],
  };
  return withProcesses(base, processes);
}

async function timed<T>(timings: Record<string, number>, step: string, work: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  const result = await work();
  timings[step] = Math.round(performance.now() - start);
  return result;
}

test('smoke: open, index, rename, delete with replaceWith and save a synthetic repository', async () => {
  const timings: Record<string, number> = {};
  const archive = encodeLila(syntheticOrg());
  const opened = await timed(timings, 'open (decode)', () => decodeLila(archive));
  expect(processesOf(opened)).toHaveLength(PROCESSES);
  expect(opened.catalog).toHaveLength(4 * PER_TYPE);

  const index = await timed(timings, 'usage index', () => usageIndex(opened));
  const roleUses = index.uses[`role/${idOf('role', 7)}`]!;
  expect(roleUses.length).toBeGreaterThan(0);
  expect(index.unresolved).toEqual([]);

  const renamed = await timed(timings, 'rename', () =>
    updateCatalogObject(opened, { id: idOf('role', 7), baseRevision: 1, name: 'Role 0007 renamed' }),
  );
  const deleted = await timed(timings, 'delete with replaceWith', () =>
    deleteCatalogObject(renamed.document, { id: idOf('role', 7), replaceWith: idOf('role', 8) }),
  );
  expect(deleted.change.processes.reduce((sum, p) => sum + p.references, 0)).toBe(roleUses.length);

  const saved = await timed(timings, 'save (encode)', () => encodeLila(deleted.document));
  const reopened = decodeLila(saved);
  expect(reopened.catalog).toHaveLength(4 * PER_TYPE - 1);
  expect((await usageIndex(reopened)).uses[`role/${idOf('role', 8)}`]).toHaveLength(roleUses.length * 2);

  console.log(
    `catalog smoke (${PROCESSES} processes × ${TASKS} tasks, ${4 * PER_TYPE} objects, ${(archive.length / 1024).toFixed(0)} KB): ` +
      Object.entries(timings).map(([step, ms]) => `${step} ${ms} ms`).join(', '),
  );
}, 120_000);
