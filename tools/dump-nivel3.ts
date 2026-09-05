// TEMPORAL (diagnóstico R-DEG-2): vuelca el RunResult canónico de nivel 3 sin calendarios.
import { writeFileSync } from 'node:fs';

import {
  loadPedidoScenario,
  renderPedidoScenario,
} from '../packages/engine/test/golden/pedido.js';
import type { ResolvedScenario } from '../packages/engine/src/scenario.js';

function withoutCalendars(scenario: ResolvedScenario): ResolvedScenario {
  const degraded: ResolvedScenario = {
    ...scenario,
    resources: Object.fromEntries(
      Object.entries(scenario.resources ?? {}).map(([poolId, pool]) => {
        const copy = { ...pool };
        delete copy.calendar;
        return [poolId, copy];
      }),
    ),
    elements: Object.fromEntries(
      Object.entries(scenario.elements ?? {}).map(([elementId, element]) => {
        const copy = { ...element };
        delete copy.calendar;
        return [elementId, copy];
      }),
    ),
  };
  delete degraded.calendars;
  return degraded;
}

const out = process.argv[2] ?? 'nivel3.json';
const actual = await renderPedidoScenario(withoutCalendars(loadPedidoScenario(42)));
writeFileSync(out, actual);
console.log(`${process.platform}/${process.arch} node ${process.version}`);
