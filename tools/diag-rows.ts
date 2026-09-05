// TEMPORAL (diagnóstico R-DEG-2)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseBpmn } from '../packages/engine/src/bpmn/index.js';
import { simulate, type EventLogRow } from '../packages/engine/src/index.js';
import { loadPedidoScenario } from '../packages/engine/test/golden/pedido.js';
import type { ResolvedScenario } from '../packages/engine/src/scenario.js';

function withoutCalendars(scenario: ResolvedScenario): ResolvedScenario {
  const degraded: ResolvedScenario = {
    ...scenario,
    resources: Object.fromEntries(
      Object.entries(scenario.resources ?? {}).map(([id, pool]) => {
        const copy = { ...pool };
        delete copy.calendar;
        return [id, copy];
      }),
    ),
    elements: Object.fromEntries(
      Object.entries(scenario.elements ?? {}).map(([id, el]) => {
        const copy = { ...el };
        delete copy.calendar;
        return [id, copy];
      }),
    ),
  };
  delete degraded.calendars;
  return degraded;
}

const buf = new DataView(new ArrayBuffer(8));
function hex(x: number): string {
  buf.setFloat64(0, x);
  return Array.from({ length: 8 }, (_, i) => buf.getUint8(i).toString(16).padStart(2, '0')).join('');
}

const scenario = withoutCalendars(loadPedidoScenario(42));
const xml = readFileSync(resolve(process.cwd(), 'examples/pedido', scenario.model), 'utf8');
const parsed = await parseBpmn(xml);

const lines: string[] = [];
let n = 0;
simulate(parsed.ir, scenario, {
  log: true,
  onEvent: (row: EventLogRow) => {
    if (row.elementId !== 'Task_TomarPedido') return;
    n++;
    lines.push(
      [row.replication, row.caseId, row.activityInstanceId, row.status,
       hex(row.enabledAt), hex(row.startedAt ?? NaN), hex(row.endedAt ?? NaN), hex(row.resourceWait)].join(' '),
    );
  },
});
writeFileSync(process.argv[2] ?? 'rows.txt', `${lines.join('\n')}\n`);
console.log(`${process.platform}/${process.arch} node ${process.version} filas=${n}`);
