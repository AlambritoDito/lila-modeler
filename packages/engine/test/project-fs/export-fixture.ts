/**
 * `examples/pedido.lila` with stored runs, as the app saves them (`DesktopStore.putRun`): the
 * result plus the model and scenario revisions and the resolved scenario it ran. Shared by the engine's
 * and the MCP server's export tests (#538).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseBpmn } from '../../src/bpmn/index.js';
import { resolveScenarioArgument, withRunOverrides } from '../../src/cli-shared.js';
import { simulate } from '../../src/index.js';
import { decodeLila, encodeLila, type StoredRun } from '../../src/project/index.js';
import { openLilaProcess } from '../../src/project-fs/index.js';

export const EXAMPLE_LILA = fileURLToPath(new URL('../../../../examples/pedido.lila', import.meta.url));

/**
 * Writes pedido at `path` with one run per entry of `scenarios` (ids `run-1`, `run-2`, …); with
 * `stale`, the model was saved again after the runs (they are of an older revision).
 */
export async function pedidoWithRuns(
  path: string,
  scenarios: readonly string[],
  options: { stale?: boolean } = {},
): Promise<readonly StoredRun[]> {
  writeFileSync(path, readFileSync(EXAMPLE_LILA));
  const lila = await openLilaProcess(path);
  const doc = lila.document;
  const { ir } = await parseBpmn(doc.model.xml);
  const runs = scenarios.map((entry, index): StoredRun => {
    const { scenario } = resolveScenarioArgument(entry, lila);
    const result = simulate(ir, withRunOverrides(scenario, { seed: 42, replications: 1 }), { log: false });
    return {
      id: `run-${index + 1}`,
      scenarioName: entry,
      result,
      inputs: {
        modelRevision: doc.model.revision,
        scenarioRevision: doc.scenarioRevisions[entry] ?? 0,
        xml: doc.model.xml,
        // A run keeps the scenario it ran, resolved (`runProblem` refuses one without model and run).
        scenario: scenario as unknown as StoredRun['inputs']['scenario'],
      },
    };
  });
  const fresh = decodeLila(readFileSync(EXAMPLE_LILA));
  // Stale: the model was edited (and saved) after the runs.
  const model = options.stale === true ? { ...fresh.model, revision: fresh.model.revision + 1 } : fresh.model;
  writeFileSync(path, encodeLila({ ...fresh, model, runs }));
  return runs;
}
