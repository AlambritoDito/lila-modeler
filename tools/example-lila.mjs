/**
 * Writes `examples/pedido.lila`, the `.lila` twin of the `examples/pedido` folder (#466): the file
 * the `.lila` examples of `docs/CLI.md` and `docs/MCP.md` run against. Run it after changing the
 * folder's model or scenarios; `packages/engine/test/project-fs/lila-input.test.ts` fails until
 * the two say the same thing.
 *
 *   npm run build && node tools/example-lila.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeLila } from '@lila-modeler/engine/project';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const folder = join(ROOT, 'examples/pedido');
const scenarios = Object.fromEntries(
  readdirSync(folder)
    .filter((name) => name.endsWith('.scenario.json'))
    .sort()
    .map((name) => [name, JSON.parse(readFileSync(join(folder, name), 'utf8'))]),
);
const document = {
  version: 1,
  id: 'example-pedido',
  name: 'pedido',
  model: { id: 'Process_Restaurante', name: 'model.bpmn', xml: readFileSync(join(folder, 'model.bpmn'), 'utf8'), revision: 1 },
  scenarios,
  scenarioRevisions: Object.fromEntries(Object.keys(scenarios).map((name) => [name, 1])),
  runs: [],
};
const target = join(ROOT, 'examples/pedido.lila');
writeFileSync(target, encodeLila(document));
console.log(`Wrote ${target}`);
