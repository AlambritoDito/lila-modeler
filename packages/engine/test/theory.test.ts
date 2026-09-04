import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn, validate } from '../src/bpmn/index.js';
import { simulate } from '../src/index.js';
import { ScenarioSchema, scenarioErrors, validateScenario, type ResolvedScenario } from '../src/scenario.js';

// LILA-050 (M2, LILA_MODELER_ESTRUCTURA.md §7 aceptación a): a diferencia de mm1.test.ts (que solo
// valida la fórmula de Erlang C contra expected.json), aquí se parsea el .bpmn real de cada caso,
// se simula con el motor DES completo y se compara el resultado con el oráculo, tolerancia 3 %.
// `packages/engine/src/core/` no se toca: el escenario de partida (examples/mm1/*/scenario.json,
// 30 días de duración, warmup 1 h, 30 replicaciones) ya converge dentro de tolerancia — medido
// abajo en el comentario de tiempos — así que no hace falta ningún override de `run`.

const here = dirname(fileURLToPath(import.meta.url));
const mm1Dir = resolve(here, '../../../examples/mm1');

const TOLERANCE = 0.03; // 3 %, LILA-050

function assertWithinTolerance(actual: number, expected: number, label: string): void {
  const relativeError = Math.abs(actual - expected) / Math.abs(expected);
  expect(relativeError, `${label}: actual=${actual} esperado=${expected} error=${(relativeError * 100).toFixed(2)}%`).toBeLessThanOrEqual(TOLERANCE);
}

/** El valor teórico debe caer dentro del IC 95 % de las 30 replicaciones, o el test documenta por qué no. */
function assertTheoryInCi95(ci95: readonly [number, number] | undefined, theoretical: number, label: string): void {
  expect(ci95, `${label}: sin ci95 (¿replications <= 1?)`).toBeDefined();
  const [low, high] = ci95!;
  expect(theoretical, `${label}: teórico=${theoretical} fuera de ci95=[${low}, ${high}]`).toBeGreaterThanOrEqual(low);
  expect(theoretical, `${label}: teórico=${theoretical} fuera de ci95=[${low}, ${high}]`).toBeLessThanOrEqual(high);
}

async function simulateCase(dir: string) {
  const caseDir = resolve(mm1Dir, dir);
  const bpmnXml = readFileSync(resolve(caseDir, 'model.bpmn'), 'utf8');
  const scenarioRaw: unknown = JSON.parse(readFileSync(resolve(caseDir, 'scenario.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(resolve(caseDir, 'expected.json'), 'utf8')) as {
    values: {
      utilization: number;
      wqSeconds: number;
      lqCustomers: number;
      wSeconds: number;
    };
  };

  const parsedBpmn = await parseBpmn(bpmnXml);
  const modelValidation = validate(parsedBpmn.ir, { unsupported: parsedBpmn.unsupported });
  if (modelValidation.errors.length > 0) {
    throw new Error(`${dir}/model.bpmn inválido: ${JSON.stringify(modelValidation.errors)}`);
  }

  // examples/mm1/*/scenario.json no usa `extends`: ScenarioSchema.parse ya produce el escenario
  // resuelto (model + run obligatorios), igual que hace golden/pedido.ts.
  const scenario = ScenarioSchema.parse(scenarioRaw) as ResolvedScenario;
  expect(scenario.run.replications, 'LILA-050 pide 30 replicaciones').toBe(30);

  const scenarioProblems = scenarioErrors(validateScenario(scenario, parsedBpmn.ir));
  if (scenarioProblems.length > 0) {
    throw new Error(`${dir}/scenario.json inválido: ${JSON.stringify(scenarioProblems)}`);
  }

  const result = simulate(parsedBpmn.ir, scenario, { log: false });
  return { result, expected };
}

describe.each(['mm1-rho08', 'mm3'] as const)('examples/mm1/%s: motor DES vs oráculo Erlang C', (dir) => {
  // Una sola simulación por caso (30 replicaciones cada una), reutilizada por ambos tests: así el
  // archivo completo hace 2 simulate(), no 4, y el tiempo medido en el comentario final sigue siendo
  // representativo de `npm test`.
  let ctx: Awaited<ReturnType<typeof simulateCase>>;
  beforeAll(async () => {
    ctx = await simulateCase(dir);
  }, 20_000);

  test('wSeconds, wqSeconds, lqCustomers y utilization caen dentro del 3% del valor teórico', () => {
    const { result, expected } = ctx;
    const servicio = result.elements.Task_Servicio;
    const servidor = result.resources.servidor;
    expect(servicio, 'Task_Servicio no aparece en result.elements').toBeDefined();
    expect(servidor, 'servidor no aparece en result.resources').toBeDefined();

    assertWithinTolerance(result.process.cycleTime.mean, expected.values.wSeconds, 'wSeconds (process.cycleTime.mean)');
    assertWithinTolerance(servicio!.resourceWait.mean, expected.values.wqSeconds, 'wqSeconds (elements.Task_Servicio.resourceWait.mean)');
    assertWithinTolerance(servicio!.queueLength.mean, expected.values.lqCustomers, 'lqCustomers (elements.Task_Servicio.queueLength.mean)');
    assertWithinTolerance(servidor!.utilization, expected.values.utilization, 'utilization (resources.servidor.utilization)');
  });

  test('el valor teórico cae dentro del IC 95% de las 30 replicaciones', () => {
    const { result, expected } = ctx;
    const kpis = result.replications?.kpis;
    expect(kpis, `${dir}: sin result.replications (¿replications <= 1?)`).toBeDefined();

    assertTheoryInCi95(kpis!['process.cycleTime.mean']?.ci95, expected.values.wSeconds, 'wSeconds');
    assertTheoryInCi95(kpis!['elements.Task_Servicio.resourceWait.mean']?.ci95, expected.values.wqSeconds, 'wqSeconds');
    assertTheoryInCi95(kpis!['elements.Task_Servicio.queueLength.mean']?.ci95, expected.values.lqCustomers, 'lqCustomers');
    assertTheoryInCi95(kpis!['resources.servidor.utilization']?.ci95, expected.values.utilization, 'utilization');
  });
});

// Tiempo medido en macOS (Node 22, `npx vitest run packages/engine/test/theory.test.ts`):
// simulate() puro ~0.5 s (mm1-rho08) + ~1.4 s (mm3), una sola vez por caso (beforeAll). Archivo
// completo (parse + validate + 2 simulate() + 4 tests): 4 tests en 2.18 s, "Duration" total de
// vitest 2.55 s. Muy por debajo del límite de 10 s del ticket.
