import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { parseBpmn } from '../../src/bpmn/parse.js';
import { compare, type CompareRow } from '../../src/core/compare.js';
import type { ElementMetrics, KpiSummary, RunResult } from '../../src/core/result.js';
import { simulate } from '../../src/core/run.js';
import type { SimScenario } from '../../src/core/sim.js';
import { resolveExtends } from '../../src/scenario.js';

/* ------------------------------------------------------------------ *
 * Aceptación LILA-038 · AS-IS vs TO-BE 3 cajeros sobre examples/pedido
 * ------------------------------------------------------------------ */

const exampleDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../examples/pedido');
const readScenario = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const { ir } = await parseBpmn(readFileSync(resolve(exampleDir, 'model.bpmn'), 'utf8'));
// `to-be-3-cajeros.scenario.json` es un delta con `extends`: solo sube `cajero.capacity` a 3.
// Ambos escenarios declaran `replications: 30` y `seed: 42`; las dos corridas juntas tardan ~4,5 s.
const asIs = resolveExtends(resolve(exampleDir, 'as-is.scenario.json'), readScenario) as unknown as SimScenario;
const toBe = resolveExtends(
  resolve(exampleDir, 'to-be-3-cajeros.scenario.json'),
  readScenario,
) as unknown as SimScenario;

const comparison = compare([simulate(ir, asIs, { log: false }), simulate(ir, toBe, { log: false })]);

describe('aceptación: AS-IS vs TO-BE 3 cajeros', () => {
  const row = (kpi: string): CompareRow => {
    const found = comparison.rows.find((candidate) => candidate.kpi === kpi);
    expect(found, kpi).toBeDefined();
    return found!;
  };

  test('los escenarios del ejemplo son los que pide la aceptación', () => {
    expect(asIs.resources?.['cajero']?.capacity).toBe(2);
    expect(toBe.resources?.['cajero']?.capacity).toBe(3);
    expect(asIs.run.replications).toBe(30);
    expect(toBe.run.replications).toBe(30);
  });

  test('la reducción de espera en Task_TomarPedido es significativa', () => {
    const wait = row('elements.Task_TomarPedido.resourceWait.mean');
    // Números observados con seed 42 y 30 replicaciones: AS-IS 14,94 s (IC [14,70; 15,19]),
    // TO-BE 2,19 s (IC [2,12; 2,27]). Intervalos disjuntos ⇒ significativo.
    expect(wait.deltaAbs[1]).toBeLessThan(0);
    expect(wait.deltaRel[1]!).toBeLessThan(-0.5);
    expect(wait.significant[1]).toBe(true);
  });

  test('la de Task_Preparar no lo es', () => {
    const wait = row('elements.Task_Preparar.resourceWait.mean');
    // El cuello de botella de Preparar es el pool `horno` (capacity 1), que el TO-BE no toca:
    // AS-IS 650 176 s (IC [646 520; 653 832]) y TO-BE 650 189 s (IC [646 533; 653 845]) se solapan
    // casi por completo, y el delta ni siquiera es una reducción.
    expect(wait.significant[1]).toBe(false);
    expect(Math.abs(wait.deltaRel[1]!)).toBeLessThan(0.01);
  });

  test('la utilización del cajero sí baja de forma significativa', () => {
    const utilization = row('resources.cajero.utilization');
    expect(utilization.deltaAbs[1]).toBeLessThan(0);
    expect(utilization.significant[1]).toBe(true);
  });

  test('la base se compara consigo misma: delta 0 y nunca significativa', () => {
    const wait = row('elements.Task_TomarPedido.resourceWait.mean');
    expect(wait.values[0]).toBe(wait.base);
    expect(wait.deltaAbs[0]).toBe(0);
    expect(wait.deltaRel[0]).toBe(0);
    expect(wait.significant[0]).toBe(false);
  });

  test('scope/id/metric permiten agrupar la tabla por elemento, recurso y proceso', () => {
    expect(row('elements.Task_Preparar.queueLength.max')).toMatchObject({
      scope: 'elements',
      id: 'Task_Preparar',
      metric: 'queueLength.max',
    });
    expect(row('resources.horno.utilization')).toMatchObject({
      scope: 'resources',
      id: 'horno',
      metric: 'utilization',
    });
    expect(row('process.cycleTime.p95')).toMatchObject({ scope: 'process', id: null, metric: 'cycleTime.p95' });
    expect(row('flows.Flow_Aprobado.count')).toMatchObject({
      scope: 'flows',
      id: 'Flow_Aprobado',
      metric: 'count',
    });
  });
});

/* ------------------------------------------------------------------ *
 * Casos unitarios sobre RunResult sintéticos
 * ------------------------------------------------------------------ */

function elementMetrics(resourceWaitMean: number): ElementMetrics {
  return {
    started: 1,
    completed: 1,
    processing: { min: 0, max: 0, mean: 0, total: 0 },
    resourceWait: { min: 0, max: 0, mean: resourceWaitMean, sd: 0, total: resourceWaitMean },
    offHoursWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
    queueLength: { mean: 0, max: 0 },
    fixedCostTotal: 0,
  };
}

/** RunResult mínimo: solo `elements`, con `process` en ceros para no ensuciar las aserciones. */
function runResult(
  elements: Record<string, number>,
  kpis?: Record<string, KpiSummary>,
  resources: Record<string, number> = {},
): RunResult {
  const result: RunResult = {
    elements: Object.fromEntries(Object.entries(elements).map(([id, mean]) => [id, elementMetrics(mean)])),
    flows: {},
    resources: Object.fromEntries(
      Object.entries(resources).map(([id, utilization]) => [
        id,
        { utilization, busyTime: 0, fixedCost: 0, unitCost: 0, totalCost: 0 },
      ]),
    ),
    process: {
      started: 0,
      completed: 0,
      inFlight: 0,
      cycleTime: { min: 0, max: 0, mean: 0, sd: 0, p50: 0, p90: 0, p95: 0 },
      waitTime: { min: 0, max: 0, mean: 0, sd: 0, p50: 0, p90: 0, p95: 0 },
      throughputPerHour: 0,
      costPerCase: 0,
      totalCost: 0,
    },
    bottlenecks: [],
    warnings: [],
  };
  if (kpis !== undefined) result.replications = { count: 30, kpis };
  return result;
}

const WAIT = 'elements.A.resourceWait.mean';
const summary = (mean: number, low: number, high: number): KpiSummary => ({ mean, sd: 0, ci95: [low, high] });

describe('compare()', () => {
  test('rechaza una lista vacía', () => {
    expect(() => compare([])).toThrow(/E-COMPARE-VACIO/);
  });

  test('un solo resultado da deltas 0 y ninguna significancia', () => {
    const only = compare([runResult({ A: 5 })]);
    const row = only.rows.find((candidate) => candidate.kpi === WAIT)!;
    expect(only.count).toBe(1);
    expect(row).toMatchObject({ base: 5, values: [5], deltaAbs: [0], deltaRel: [0], significant: [false] });
  });

  test('deltaRel con base 0 es null, nunca Infinity ni NaN', () => {
    const row = compare([runResult({ A: 0 }), runResult({ A: 7 })]).rows.find(
      (candidate) => candidate.kpi === WAIT,
    )!;
    expect(row.deltaAbs).toEqual([0, 7]);
    expect(row.deltaRel).toEqual([null, null]);
    expect(JSON.stringify(row.deltaRel)).toBe('[null,null]');
  });

  test('un resultado sin ci95 (una sola replicación) nunca marca significancia', () => {
    const withCi = runResult({ A: 10 }, { [WAIT]: summary(10, 9, 11) });
    const withoutCi = runResult({ A: 1 });
    expect(compare([withCi, withoutCi]).rows.find((r) => r.kpi === WAIT)!.significant).toEqual([false, false]);
    expect(compare([withoutCi, withCi]).rows.find((r) => r.kpi === WAIT)!.significant).toEqual([false, false]);
  });

  test('los IC que solo se tocan en un extremo se consideran solapados', () => {
    const base = runResult({ A: 10 }, { [WAIT]: summary(10, 9, 11) });
    const touching = runResult({ A: 12 }, { [WAIT]: summary(12, 11, 13) });
    const disjoint = runResult({ A: 13 }, { [WAIT]: summary(13, 11.0001, 15) });
    expect(compare([base, touching, disjoint]).rows.find((r) => r.kpi === WAIT)!.significant).toEqual([
      false,
      false,
      true,
    ]);
  });

  test('un KPI ausente en alguno de los resultados da null, no un error', () => {
    const comparison = compare([
      runResult({ A: 1 }, undefined, { cajero: 0.5 }),
      runResult({ A: 2, B: 3 }, undefined, {}),
    ]);
    const b = comparison.rows.find((row) => row.kpi === 'elements.B.resourceWait.mean')!;
    expect(b).toMatchObject({ base: null, values: [null, 3], deltaAbs: [null, null], deltaRel: [null, null] });
    const pool = comparison.rows.find((row) => row.kpi === 'resources.cajero.utilization')!;
    expect(pool).toMatchObject({ base: 0.5, values: [0.5, null], deltaAbs: [0, null], deltaRel: [0, null] });
  });

  test('tres resultados: cada columna se compara contra la base, no contra la anterior', () => {
    const row = compare([runResult({ A: 10 }), runResult({ A: 5 }), runResult({ A: 20 })]).rows.find(
      (candidate) => candidate.kpi === WAIT,
    )!;
    expect(row.values).toEqual([10, 5, 20]);
    expect(row.deltaAbs).toEqual([0, -5, 10]);
    expect(row.deltaRel).toEqual([0, -0.5, 1]);
  });

  test('el orden lo fija la base; los KPI que solo existen en otro resultado van detrás', () => {
    const paths = compare([runResult({ A: 1, B: 2 }), runResult({ Z: 3, A: 1 })]).rows
      .filter((row) => row.scope === 'elements' && row.metric === 'started')
      .map((row) => row.id);
    expect(paths).toEqual(['A', 'B', 'Z']);
  });

  test('un id BPMN con punto se desescapa en `id` sin colisionar con el path', () => {
    const row = compare([runResult({ 'Task.A': 1 })]).rows.find(
      (candidate) => candidate.kpi === 'elements.Task\\.A.resourceWait.mean',
    )!;
    expect(row).toMatchObject({ scope: 'elements', id: 'Task.A', metric: 'resourceWait.mean' });
  });

  test('determinismo: dos llamadas con la misma entrada dan el mismo JSON', () => {
    const results = [runResult({ A: 1, B: 0 }, { [WAIT]: summary(1, 0.5, 1.5) }), runResult({ A: 4, C: 9 })];
    expect(JSON.stringify(compare(results))).toBe(JSON.stringify(compare(results)));
  });
});
