/**
 * Shared material for the container round trips of the `lila:` references (#670, slice A1.0 of
 * #127): a version 1 project and a version 2 repository whose models carry every `lila:*Ref` kind
 * and every RACI type, and the helpers that compare what a save/reopen gives back.
 *
 * The model is `annotatedPedido()` (LILA-068's fixture, one `lila:` element of every v1 type) plus
 * an `I` responsibility, which that fixture does not write, so all four RACI types are present.
 * Everything here is synthetic: the public `examples/pedido` model and scenarios, annotated by the
 * engine's own writer with made-up catalog ids (`docs/EXAMPLES_POLICY.md`).
 *
 * Used by `test/project/lila-refs.test.ts` (encode/decode in memory) and by
 * `test/project-fs/lila-refs.test.ts` (folder, archive on disk, agent writes).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect } from 'vitest';

import { annotateElement, readAnnotations, REF_KINDS } from '../src/bpmn/annotate.js';
import type { Annotations } from '../src/bpmn/annotate.js';
import { parseBpmn } from '../src/bpmn/index.js';
import { simulate } from '../src/index.js';
import { processesOf, storedRun, withProcesses } from '../src/project/index.js';
import type { ProcessDocument, ProjectDocument, ScenarioDocument, StoredRun } from '../src/project/index.js';
import { ScenarioSchema } from '../src/scenario.js';
import { V1_TAGS, annotatedPedido, lilaInventory } from './bpmn-roundtrip.fixture.js';

export { lilaInventory };

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/pedido');
export const AS_IS = 'as-is.scenario.json';
export const TO_BE = 'to-be-3-cajeros.scenario.json';

/** The process id of the annotated model, and the one the second process of the repository gets. */
export const FIRST_PROCESS_ID = 'Process_Restaurante';
export const SECOND_PROCESS_ID = 'Process_Facturacion';
export const SECOND_SLUG = 'facturacion';

/** The RACI types of `docs/BPMN_EXTENSION.md` § 2; the fixture has to carry each of them. */
export const RACI_TYPES = ['R', 'A', 'C', 'I'] as const;

/**
 * Every `lila:*Ref` and `lila:responsibility` line `refsModel()` must carry, in `lilaInventory`
 * form. Pinned literally rather than read from the source, so a writer that changes a value on the
 * way in (and the source inventory with it) still fails, and so the guard below cannot shrink.
 */
export const EXPECTED_REFERENCES: readonly string[] = [
  'Task_Preparar <lila:controlRef ref="control-termometro">',
  'Task_Preparar <lila:responsibility roleRef="rol-cocinero" type="C">',
  'Task_Preparar <lila:riskRef ref="riesgo-plato-frio">',
  'Task_Revisar <lila:responsibility roleRef="rol-cliente" type="I">',
  'Task_TomarPedido <lila:documentRef ref="doc-pedido">',
  'Task_TomarPedido <lila:input ref="doc-pedido">',
  'Task_TomarPedido <lila:kpiRef ref="kpi-tiempo-atencion">',
  'Task_TomarPedido <lila:output ref="doc-comanda">',
  'Task_TomarPedido <lila:responsibility roleRef="rol-cajero" type="R">',
  'Task_TomarPedido <lila:responsibility roleRef="rol-gerente" type="A">',
  'Task_TomarPedido <lila:systemRef ref="sys-crm">',
  'Task_TomarPedido <lila:systemRef ref="sys-pos">',
];

/** One element's references as `readAnnotations` reads them: in file order, which the inventory sorts away. */
export type References = Pick<Annotations, 'responsibilities' | 'refs'>;

/** {@link EXPECTED_REFERENCES} again, per element and in the order `refsModel()` wrote them. */
export const EXPECTED_ORDERED: Readonly<Record<string, References>> = {
  Task_TomarPedido: {
    responsibilities: [
      { type: 'R', roleRef: 'rol-cajero' },
      { type: 'A', roleRef: 'rol-gerente' },
    ],
    refs: {
      systemRef: ['sys-pos', 'sys-crm'],
      documentRef: ['doc-pedido'],
      kpiRef: ['kpi-tiempo-atencion'],
      input: ['doc-pedido'],
      output: ['doc-comanda'],
    },
  },
  Task_Preparar: {
    responsibilities: [{ type: 'C', roleRef: 'rol-cocinero' }],
    refs: { riskRef: ['riesgo-plato-frio'], controlRef: ['control-termometro'] },
  },
  Task_Revisar: { responsibilities: [{ type: 'I', roleRef: 'rol-cliente' }] },
};

/** Every element of `xml` with a `lila:responsibility` or a `lila:*Ref`, read back by bpmn-moddle. */
export async function orderedReferences(xml: string): Promise<Record<string, References>> {
  const out: Record<string, References> = {};
  for (const [id, { responsibilities, refs }] of Object.entries(await readAnnotations(xml))) {
    if (responsibilities === undefined && refs === undefined) continue;
    out[id] = { ...(responsibilities === undefined ? {} : { responsibilities }), ...(refs === undefined ? {} : { refs }) };
  }
  return out;
}

/** The reference lines of an inventory: every `lila:*Ref` kind and `lila:responsibility`. */
export function referenceLines(inventory: readonly string[]): string[] {
  const tags = new Set<string>([...REF_KINDS, 'responsibility']);
  return inventory.filter((line) => {
    const tag = /<lila:([\w-]+)/.exec(line)?.[1];
    return tag !== undefined && tags.has(tag);
  });
}

/**
 * The guard of the acceptance criteria: the inventory has every `REF_KINDS` kind, every RACI type,
 * every `V1_TAGS` element type, and exactly the pinned references.
 */
export function expectFullCoverage(inventory: readonly string[]): void {
  for (const kind of REF_KINDS) expect(inventory.some((line) => line.includes(`<lila:${kind} `)), kind).toBe(true);
  for (const type of RACI_TYPES) {
    expect(inventory.some((line) => line.includes('<lila:responsibility ') && line.includes(` type="${type}"`)), type).toBe(true);
  }
  for (const tag of V1_TAGS) expect(inventory.some((line) => line.includes(`<lila:${tag} `) || line.includes(`<lila:${tag}>`)), tag).toBe(true);
  expect(referenceLines(inventory)).toEqual(EXPECTED_REFERENCES);
}

/** `annotatedPedido()` plus an `I` on a task that has no responsibility yet. */
export async function refsModel(): Promise<string> {
  return annotateElement(await annotatedPedido(), 'Task_Revisar', {
    responsibilities: [{ type: 'I', roleRef: 'rol-cliente' }],
  });
}

/** The same model as the repository's second process: only the process id differs. */
export function secondModel(xml: string): string {
  return xml.replaceAll(FIRST_PROCESS_ID, SECOND_PROCESS_ID);
}

function example(name: string): ScenarioDocument {
  return JSON.parse(readFileSync(resolve(EXAMPLE_DIR, name), 'utf8')) as ScenarioDocument;
}

/**
 * A stored run of `scenarioName` on `xml`, cut short (one replication, 40 arrivals) because only its
 * container matters. Its `inputs.xml` is a second copy of the annotated model inside the archive.
 */
export async function shortRun(
  id: string,
  xml: string,
  scenarioName: string,
  scenario: ScenarioDocument,
  revisions: { readonly modelRevision: number; readonly scenarioRevision: number },
): Promise<StoredRun> {
  const raw = scenario as Record<string, unknown> & { run: object; elements: Record<string, object> };
  const parsed = ScenarioSchema.parse({
    ...raw,
    run: { ...raw.run, replications: 1 },
    elements: { ...raw.elements, StartEvent_Pedido: { ...raw.elements.StartEvent_Pedido, triggerCount: 40 } },
  });
  const { ir } = await parseBpmn(xml);
  const result = simulate(ir, { ...parsed, run: parsed.run! }, { log: false });
  return storedRun({
    id,
    scenarioName,
    result,
    xml,
    scenario: JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>,
    ...revisions,
  });
}

/** A version 1 project: the annotated model, both example scenarios and one stored run. */
export async function v1Project(): Promise<ProjectDocument> {
  const xml = await refsModel();
  const asIs = example(AS_IS);
  return {
    version: 1,
    id: 'refs-project',
    name: 'Pedido',
    model: { id: FIRST_PROCESS_ID, name: 'model.bpmn', xml, revision: 2 },
    scenarios: { [AS_IS]: asIs, [TO_BE]: example(TO_BE) },
    scenarioRevisions: { [AS_IS]: 1, [TO_BE]: 0 },
    runs: [await shortRun('run-a', xml, AS_IS, asIs, { modelRevision: 2, scenarioRevision: 1 })],
  };
}

/** A version 2 repository: `v1Project()` plus a second process with the annotated model too. */
export async function v2Repository(): Promise<ProjectDocument> {
  const v1 = await v1Project();
  const xml = secondModel(v1.model.xml);
  const asIs = example(AS_IS);
  const second: ProcessDocument = {
    slug: SECOND_SLUG,
    name: 'Facturación',
    model: { id: SECOND_PROCESS_ID, name: 'model.bpmn', xml, revision: 1 },
    scenarios: { [AS_IS]: asIs },
    scenarioRevisions: { [AS_IS]: 0 },
    runs: [await shortRun('run-b', xml, AS_IS, asIs, { modelRevision: 1, scenarioRevision: 0 })],
  };
  return withProcesses(v1, [...processesOf(v1), second]);
}

/**
 * Every model of `document` as `lilaInventory`, keyed by slug, plus the model each stored run keeps
 * in `inputs.xml` (keyed `<slug>/runs/<id>`): what a save/reopen of the container has to give back.
 */
export function inventories(document: ProjectDocument): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const process of processesOf(document)) {
    out[process.slug] = lilaInventory(process.model.xml);
    for (const run of process.runs) out[`${process.slug}/runs/${run.id}`] = lilaInventory(run.inputs.xml);
  }
  return out;
}

/** `inventory` without the lines owned by `ids`: the elements an agent write did not target. */
export function untouched(inventory: readonly string[], ...ids: string[]): string[] {
  return inventory.filter((line) => !ids.includes(line.slice(0, line.indexOf(' '))));
}
