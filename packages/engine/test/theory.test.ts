import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn, validate } from '../src/bpmn/index.js';
import { simulate, type KpiSummary } from '../src/index.js';
import { ScenarioSchema, scenarioErrors, validateScenario, type ResolvedScenario } from '../src/scenario.js';

// LILA-050 (M2, LILA_MODELER_ESTRUCTURA.md §7 aceptación a): a diferencia de mm1.test.ts (que solo
// valida la fórmula de Erlang C contra expected.json), aquí se parsea el .bpmn real de cada caso,
// se simula con el motor DES completo y se compara el resultado con el oráculo, tolerancia 3 %.
// `packages/engine/src/core/` no se toca: el escenario de partida (examples/mm1/*/scenario.json,
// 30 días de duración, warmup 1 h, 30 replicaciones) ya converge dentro de tolerancia — medido
// abajo en el comentario de tiempos — así que no hace falta ningún override de `run`.
//
// Margen estadístico medido en QA (40 semillas para mm1-rho08, 24 para mm3, misma configuración):
// el error relativo de `lqCustomers` tiene sd 2,4 % en mm1-rho08 y 1,6 % en mm3, sin sesgo
// detectable. Con la tolerancia de 3 % que pide el ticket, la semilla 42 pasa con holgura de
// ~0,6 sd en mm1-rho08 (+2,35 %) y ~1,6 sd en mm3 (+0,40 %); con otra semilla el mismo motor
// correcto saldría del 3 % en ~25 % de los casos (mm1) y ~12 % (mm3). Es una consecuencia de la
// varianza de una cola M/M/c con rho = 0,8 en 30 días × 30 replicaciones, no de un defecto del
// motor (Little se cumple: lambda·Wq = 3,2699 vs queueLength.mean = 3,2753). Si este test se pone
// rojo tras un cambio que altera el stream de RNG sin cambiar la semántica, la causa más probable
// es esa varianza y no una regresión: comprobar antes con varias semillas. Bajar la sd al 1 %
// exigiría ~6× la duración de la corrida y se saldría del techo de 10 s en CI que fija el ticket.

const here = dirname(fileURLToPath(import.meta.url));
const mm1Dir = resolve(here, '../../../examples/mm1');

const TOLERANCE = 0.03; // 3 %, LILA-050

interface ExpectedValues {
  utilization: number;
  wqSeconds: number;
  lqCustomers: number;
  wSeconds: number;
}

function relativeError(actual: number, expected: number): number {
  return Math.abs(actual - expected) / Math.abs(expected);
}

function assertWithinTolerance(actual: number, expected: number, label: string): void {
  const error = relativeError(actual, expected);
  expect(error, `${label}: actual=${actual} esperado=${expected} error=${(error * 100).toFixed(2)}%`).toBeLessThanOrEqual(TOLERANCE);
}

/** El valor teórico debe caer dentro del IC 95 % de las 30 replicaciones (R-ARR-8). */
function assertTheoryInCi95(
  kpis: Record<string, KpiSummary>,
  kpiPath: string,
  theoretical: number,
  label: string,
): void {
  const summary = kpis[kpiPath];
  expect(summary, `${label}: replications.kpis no trae la clave "${kpiPath}"`).toBeDefined();
  const [low, high] = summary!.ci95;
  expect(theoretical, `${label}: teórico=${theoretical} fuera de ci95=[${low}, ${high}]`).toBeGreaterThanOrEqual(low);
  expect(theoretical, `${label}: teórico=${theoretical} fuera de ci95=[${low}, ${high}]`).toBeLessThanOrEqual(high);
}

/** Parsea el .bpmn y resuelve el escenario committeado del caso, sin simular. */
async function loadCase(dir: string) {
  const caseDir = resolve(mm1Dir, dir);
  const bpmnXml = readFileSync(resolve(caseDir, 'model.bpmn'), 'utf8');
  const scenarioRaw: unknown = JSON.parse(readFileSync(resolve(caseDir, 'scenario.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(resolve(caseDir, 'expected.json'), 'utf8')) as {
    values: ExpectedValues;
  };

  const parsedBpmn = await parseBpmn(bpmnXml);
  const modelValidation = validate(parsedBpmn.ir, { unsupported: parsedBpmn.unsupported });
  if (modelValidation.errors.length > 0) {
    throw new Error(`${dir}/model.bpmn inválido: ${JSON.stringify(modelValidation.errors)}`);
  }

  // examples/mm1/*/scenario.json no usa `extends`, así que ScenarioSchema.parse ya produce el
  // escenario resuelto; se comprueba en vez de castear, igual que hace golden/pedido.ts.
  const parsedScenario = ScenarioSchema.parse(scenarioRaw);
  if (parsedScenario.model === undefined || parsedScenario.run === undefined) {
    throw new Error(`${dir}/scenario.json no es un escenario resuelto (model y run son obligatorios).`);
  }
  const scenario: ResolvedScenario = {
    ...parsedScenario,
    model: parsedScenario.model,
    run: parsedScenario.run,
  };

  const scenarioProblems = scenarioErrors(validateScenario(scenario, parsedBpmn.ir));
  if (scenarioProblems.length > 0) {
    throw new Error(`${dir}/scenario.json inválido: ${JSON.stringify(scenarioProblems)}`);
  }

  return { ir: parsedBpmn.ir, scenario, expected };
}

async function simulateCase(dir: string) {
  const { ir, scenario, expected } = await loadCase(dir);
  expect(scenario.run.replications, 'LILA-050 pide 30 replicaciones').toBe(30);
  const result = simulate(ir, scenario, { log: false });
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

    assertTheoryInCi95(kpis!, 'process.cycleTime.mean', expected.values.wSeconds, 'wSeconds');
    assertTheoryInCi95(kpis!, 'elements.Task_Servicio.resourceWait.mean', expected.values.wqSeconds, 'wqSeconds');
    assertTheoryInCi95(kpis!, 'elements.Task_Servicio.queueLength.mean', expected.values.lqCustomers, 'lqCustomers');
    assertTheoryInCi95(kpis!, 'resources.servidor.utilization', expected.values.utilization, 'utilization');
  });
});

// Control negativo: el arnés de arriba compara el resultado del motor contra expected.json, no
// contra sí mismo. Con capacity 2 el sistema deja de ser el M/M/1 del oráculo (W cae de 1500 s a
// ~357 s) y el 3 % tiene que romperse. Corre 1 replicación de 1 día: la discriminación es del 76 %,
// no hace falta precisión, y el costo es despreciable frente al presupuesto de 10 s del ticket.
test('control negativo: con capacity 2 el mismo arnés se sale del 3 %', async () => {
  const { ir, scenario, expected } = await loadCase('mm1-rho08');
  const otroSistema: ResolvedScenario = {
    ...scenario,
    run: { ...scenario.run, replications: 1, duration: 86_400 },
    resources: {
      ...scenario.resources,
      servidor: { ...scenario.resources!.servidor!, capacity: 2 },
    },
  };

  const result = simulate(ir, otroSistema, { log: false });
  const error = relativeError(result.process.cycleTime.mean, expected.values.wSeconds);
  expect(error, `wSeconds con capacity 2: actual=${result.process.cycleTime.mean} esperado=${expected.values.wSeconds}`).toBeGreaterThan(TOLERANCE);
}, 20_000);

// Tiempo medido en macOS (Node 22, `npx vitest run packages/engine/test/theory.test.ts`):
// simulate() puro ~0,5 s (mm1-rho08) + ~1,5 s (mm3), una sola vez por caso (beforeAll); el control
// negativo mide 3 ms. Archivo completo (parse + validate + 3 simulate() + 5 tests), tres corridas
// seguidas: tests 2,13–2,19 s, "Duration" total de vitest 2,39–2,45 s. El techo del ticket es 10 s
// en CI (ubuntu ~2× más lento que este Mac), así que queda holgura.
