/**
 * #546 fixture: Sample order (`examples/pedido`) with the Customer pool first in the document, as
 * deleting the Restaurant pool and pasting it back leaves it. The scenarios still configure the
 * Restaurant process, so that is the one every reader has to pick. Shared by the engine, MCP and
 * web tests.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseBpmn } from '../src/bpmn/index.js';
import { withRunOverrides } from '../src/cli-shared.js';
import { simulate } from '../src/index.js';
import { decodeLila, encodeLila, type StoredRun } from '../src/project/index.js';
import type { ResolvedScenario } from '../src/scenario.js';

export const PEDIDO_LILA = fileURLToPath(new URL('../../../examples/pedido.lila', import.meta.url));

/** The same model with the Customer participant and process first. */
export function customerFirst(xml: string): string {
  const process = /\s*<bpmn:process id="Process_Cliente"[\s\S]*?<\/bpmn:process>/.exec(xml)![0];
  const participant = /\s*<bpmn:participant id="Participant_Cliente"[^>]*\/>/.exec(xml)![0];
  return xml
    .replace(process, '')
    .replace(participant, '')
    .replace(/(\s*<bpmn:participant id="Participant_Restaurante")/, `${participant}$1`)
    .replace(/(\s*<bpmn:process id="Process_Restaurante")/, `${process}$1`);
}

/**
 * Writes `examples/pedido.lila` at `path` with its model Customer-first; with `run`, plus one
 * stored AS-IS run (one short replication) of the Restaurant process, as the app saves it.
 */
export async function customerFirstLila(path: string, options: { run?: boolean } = {}): Promise<void> {
  const doc = decodeLila(readFileSync(PEDIDO_LILA));
  const xml = customerFirst(doc.model.xml);
  const runs: StoredRun[] = [];
  if (options.run === true) {
    const raw = doc.scenarios['as-is.scenario.json'] as unknown as ResolvedScenario;
    const scenario = withRunOverrides({ ...raw, run: { ...raw.run, duration: 86_400, warmup: 0 } }, { seed: 42, replications: 1 });
    const { ir } = await parseBpmn(doc.model.xml);
    runs.push({
      id: 'run-1',
      scenarioName: 'as-is.scenario.json',
      result: simulate(ir, scenario, { log: false }),
      inputs: {
        modelRevision: doc.model.revision,
        scenarioRevision: doc.scenarioRevisions['as-is.scenario.json'] ?? 0,
        xml,
        scenario: scenario as unknown as StoredRun['inputs']['scenario'],
      },
    });
  }
  writeFileSync(path, encodeLila({ ...doc, model: { ...doc.model, xml }, runs }));
}
