import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { parseBpmn } from '../../src/bpmn/parse.js';
import { compare, type CompareResult, type CompareRow } from '../../src/core/compare.js';
import { numericKpis, summarizeKpi } from '../../src/core/replications.js';
import type { ElementMetrics, KpiSummary, ResourceMetrics, RunResult } from '../../src/core/result.js';
import { simulate } from '../../src/core/run.js';
import type { SimScenario } from '../../src/core/sim.js';
import { compare as compareFromIndex } from '../../src/index.js';
import { resolveExtends } from '../../src/scenario.js';

/**
 * QA adversarial de LILA-038 (agente distinto al implementador).
 *
 * `compare.test.ts` cubre el camino feliz y la aceptación con seed 42. Aquí se ataca el contrato
 * por los bordes: intervalos degenerados, IC inconsistentes con `mean`/`sd`, direccionalidad,
 * replicaciones desiguales, modelos disjuntos, ids hostiles, pureza, escala y una segunda semilla.
 */

/* ------------------------------------------------------------------ *
 * Utilidades: RunResult sintéticos
 * ------------------------------------------------------------------ */

function elementMetrics(mean: number): ElementMetrics {
  return {
    started: 1,
    completed: 1,
    processing: { min: 0, max: 0, mean: 0, total: 0 },
    resourceWait: { min: 0, max: 0, mean, sd: 0, total: mean },
    offHoursWait: { min: 0, max: 0, mean: 0, sd: 0, total: 0 },
    queueLength: { mean: 0, max: 0 },
    fixedCostTotal: 0,
  };
}

function resourceMetrics(utilization: number): ResourceMetrics {
  return { utilization, busyTime: 0, fixedCost: 0, unitCost: 0, totalCost: 0 };
}

function runResult(options: {
  elements?: Record<string, number>;
  resources?: Record<string, number>;
  kpis?: Record<string, KpiSummary>;
  replicationCount?: number;
}): RunResult {
  const result: RunResult = {
    elements: Object.fromEntries(
      Object.entries(options.elements ?? {}).map(([id, mean]) => [id, elementMetrics(mean)]),
    ),
    flows: {},
    resources: Object.fromEntries(
      Object.entries(options.resources ?? {}).map(([id, utilization]) => [id, resourceMetrics(utilization)]),
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
  if (options.kpis !== undefined) {
    result.replications = { count: options.replicationCount ?? 30, kpis: options.kpis };
  }
  return result;
}

const WAIT = 'elements.A.resourceWait.mean';
const ci = (mean: number, low: number, high: number, sd = 0): KpiSummary => ({ mean, sd, ci95: [low, high] });
const rowOf = (comparison: CompareResult, kpi: string): CompareRow => {
  const found = comparison.rows.find((candidate) => candidate.kpi === kpi);
  expect(found, kpi).toBeDefined();
  return found!;
};

/* ------------------------------------------------------------------ *
 * 1. Significancia con intervalos degenerados y no numéricos
 * ------------------------------------------------------------------ */

describe('QA LILA-038 · ataque 1: intervalos degenerados', () => {
  test('dos IC degenerados idénticos ([x, x]) no son significativos', () => {
    // sd 0 en las 30 replicaciones ⇒ margen 0 ⇒ ci95 = [x, x]. Un intervalo cerrado que
    // comparte su único punto con el otro se solapa: no significativo (RESULTS_FORMAT § 11).
    const base = runResult({ elements: { A: 5 }, kpis: { [WAIT]: ci(5, 5, 5) } });
    const same = runResult({ elements: { A: 5 }, kpis: { [WAIT]: ci(5, 5, 5) } });
    expect(rowOf(compare([base, same]), WAIT).significant).toEqual([false, false]);
  });

  test('dos IC degenerados separados por 1e-12 SÍ son significativos: la regla es geométrica', () => {
    // Decisión fijada, no accidente: § 11 define significancia como "los IC no se solapan", sin
    // épsilon ni tolerancia relativa. Con sd exactamente 0 en ambos lados eso convierte cualquier
    // diferencia representable en float64 en significativa. Es correcto bajo el contrato escrito
    // (sd 0 = el KPI es determinista, no hay ruido que explique la diferencia) y queda anclado
    // aquí para que un cambio a "no se solapan con holgura" tenga que ser deliberado.
    const base = runResult({ elements: { A: 5 }, kpis: { [WAIT]: ci(5, 5, 5) } });
    const nudged = runResult({ elements: { A: 5 }, kpis: { [WAIT]: ci(5 + 1e-12, 5 + 1e-12, 5 + 1e-12) } });
    const row = rowOf(compare([base, nudged]), WAIT);
    expect(row.significant).toEqual([false, true]);
    // Y el delta que la acompaña es ese mismo 1e-12: la marca no promete magnitud, solo señal.
    expect(row.deltaAbs[1]).toBe(0); // values vienen de `elements`, no de `replications`.
  });

  test('un ci95 con NaN degrada a "no significativo" y no lanza', () => {
    const base = runResult({ elements: { A: 5 }, kpis: { [WAIT]: ci(5, 4, 6) } });
    const broken = runResult({ elements: { A: 50 }, kpis: { [WAIT]: ci(50, NaN, NaN) } });
    expect(() => compare([base, broken])).not.toThrow();
    expect(rowOf(compare([base, broken]), WAIT).significant).toEqual([false, false]);
    // También al revés: la base rota no contamina ni marca de más.
    expect(rowOf(compare([broken, base]), WAIT).significant).toEqual([false, false]);
  });

  test('un resultado con `replications` pero sin ese KPI en `kpis` no marca significancia', () => {
    const base = runResult({ elements: { A: 5 }, kpis: { [WAIT]: ci(5, 4, 6) } });
    const otherKpiOnly = runResult({ elements: { A: 50 }, kpis: { 'process.cycleTime.mean': ci(1, 0, 2) } });
    expect(rowOf(compare([base, otherKpiOnly]), WAIT).significant).toEqual([false, false]);
  });

  test('significant[0] es false aunque el ci95 de la base venga invertido', () => {
    // Invariante documentado: "significant[0] siempre false". Un [hi, lo] mal formado no debe
    // poder convertir a la base en significativa contra sí misma.
    const inverted = runResult({ elements: { A: 5 }, kpis: { [WAIT]: ci(5, 9, 1) } });
    expect(rowOf(compare([inverted, inverted]), WAIT).significant[0]).toBe(false);
    expect(rowOf(compare([inverted]), WAIT).significant).toEqual([false]);
  });
});

/* ------------------------------------------------------------------ *
 * 2. La significancia lee `ci95` tal cual: ni half-width, ni t/z propia
 * ------------------------------------------------------------------ */

describe('QA LILA-038 · ataque 2: compare no recalcula el intervalo', () => {
  test('un ci95 estrecho con sd enorme sigue siendo estrecho: se usa [lo, hi], no mean ± sd', () => {
    // Si `compare` recalculara el intervalo a partir de mean/sd (o interpretara ci95 como
    // half-width) estas dos filas se solaparían de sobra y no marcarían nada.
    const base = runResult({ elements: { A: 10 }, kpis: { [WAIT]: ci(10, 10, 10, 999) } });
    const other = runResult({ elements: { A: 20 }, kpis: { [WAIT]: ci(20, 20, 20, 999) } });
    expect(rowOf(compare([base, other]), WAIT).significant).toEqual([false, true]);
  });

  test('un ci95 ancho con sd 0 no marca nada: manda el intervalo publicado', () => {
    const base = runResult({ elements: { A: 10 }, kpis: { [WAIT]: ci(10, -1e6, 1e6, 0) } });
    const other = runResult({ elements: { A: 20 }, kpis: { [WAIT]: ci(20, -1e6, 1e6, 0) } });
    expect(rowOf(compare([base, other]), WAIT).significant).toEqual([false, false]);
  });

  test('el ci95 de `replications` es [lo, hi] centrado en mean, no un half-width (LILA-027)', () => {
    const summary = summarizeKpi([1, 2, 3, 4, 5]);
    expect(summary.ci95[0]).toBeLessThan(summary.mean);
    expect(summary.ci95[1]).toBeGreaterThan(summary.mean);
    // t(0.975; 4) = 2.7764451052, sd muestral = 1.5811388301, n = 5.
    expect(summary.ci95[1] - summary.mean).toBeCloseTo(2.7764451052 * (1.5811388301 / Math.sqrt(5)), 9);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Direccionalidad: `significant` no dice si mejoró
 * ------------------------------------------------------------------ */

describe('QA LILA-038 · ataque 3: direccionalidad', () => {
  test('un aumento significativo se marca igual que una reducción', () => {
    const base = runResult({ elements: { A: 10 }, kpis: { [WAIT]: ci(10, 9, 11) } });
    const worse = runResult({ elements: { A: 40 }, kpis: { [WAIT]: ci(40, 38, 42) } });
    const better = runResult({ elements: { A: 2 }, kpis: { [WAIT]: ci(2, 1, 3) } });
    const row = rowOf(compare([base, worse, better]), WAIT);
    expect(row.significant).toEqual([false, true, true]);
    // El signo lo da el delta, no la marca: quien pinte la tabla (LILA-047) necesita ambos.
    expect(row.deltaAbs).toEqual([0, 30, -8]);
    expect(row.deltaRel).toEqual([0, 3, -0.8]);
  });

  test('signo con base negativa: deltaRel no invierte el sentido por su cuenta', () => {
    const row = rowOf(compare([runResult({ elements: { A: -4 } }), runResult({ elements: { A: -8 } })]), WAIT);
    expect(row.deltaAbs).toEqual([0, -4]);
    expect(row.deltaRel![1]).toBe(1); // (-8 − −4) / −4 = +1: crece en magnitud.
    // Anclado a propósito: con base negativa `deltaRel[0]` es **−0** (`+0 / −4`), no `+0`. El JSON
    // sale igual (`JSON.stringify(-0) === '0'`), pero `toFixed` imprimiría "-0.00" en la columna
    // de la base. Ningún KPI de v1 (tiempos, conteos, costos, utilización) es negativo, así que
    // hoy es inalcanzable; queda fijado para que LILA-047 normalice al formatear si eso cambia.
    expect(Object.is(row.deltaRel[0], -0)).toBe(true);
    expect(JSON.stringify(row.deltaRel)).toBe('[0,1]');
  });

  test('los KPI no escalares (bottlenecks, warnings, completedReplications) no generan filas', () => {
    const cancelled = runResult({ elements: { A: 1 } });
    cancelled.bottlenecks = [{ elementId: 'A', resourceWaitTotal: 999, utilization: 0.9 }];
    cancelled.warnings = ['W-ALGO'];
    cancelled.cancelled = true;
    cancelled.completedReplications = 1;
    const comparison = compare([cancelled, runResult({ elements: { A: 2 } })]);
    expect(comparison.rows.some((row) => row.kpi.includes('bottleneck'))).toBe(false);
    expect(comparison.rows.some((row) => row.kpi.includes('completedReplications'))).toBe(false);
    expect(comparison.rows.every((row) => ['elements', 'flows', 'resources', 'process'].includes(row.scope))).toBe(true);
    // Cancelado con menos de dos replicaciones completas ⇒ sin `replications` ⇒ sin significancia.
    expect(rowOf(comparison, WAIT).significant).toEqual([false, false]);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Replicaciones desiguales
 * ------------------------------------------------------------------ */

describe('QA LILA-038 · ataque 4: distinto número de replicaciones', () => {
  test('30 contra 5 replicaciones compara los intervalos publicados sin reescalarlos', () => {
    const wide = summarizeKpi([8, 12, 9, 11, 10]); // n = 5, IC ancho.
    const narrow = summarizeKpi(Array.from({ length: 30 }, (_, index) => 30 + (index % 2 === 0 ? 0.5 : -0.5)));
    const base = runResult({ elements: { A: wide.mean }, kpis: { [WAIT]: wide }, replicationCount: 5 });
    const other = runResult({ elements: { A: narrow.mean }, kpis: { [WAIT]: narrow }, replicationCount: 30 });
    expect(base.replications?.count).toBe(5);
    expect(other.replications?.count).toBe(30);
    expect(rowOf(compare([base, other]), WAIT).significant).toEqual([false, true]);
  });

  test('`replications: 1` en un solo lado degrada a false sin tocar los deltas', () => {
    const withCi = runResult({ elements: { A: 10 }, kpis: { [WAIT]: ci(10, 9.9, 10.1) } });
    const single = runResult({ elements: { A: 1000 } }); // sin `replications`
    const row = rowOf(compare([withCi, single]), WAIT);
    expect(row.significant).toEqual([false, false]);
    expect(row.deltaAbs).toEqual([0, 990]);
    expect(row.deltaRel).toEqual([0, 99]);
    // Y ninguno de los dos lados gana la marca por ser el que sí tiene IC.
    expect(rowOf(compare([single, withCi]), WAIT).significant).toEqual([false, false]);
  });
});

/* ------------------------------------------------------------------ *
 * 5. Modelos distintos: ids disjuntos y colecciones vacías
 * ------------------------------------------------------------------ */

describe('QA LILA-038 · ataque 5: resultados de modelos distintos', () => {
  test('ids completamente disjuntos producen filas con null a un lado, sin lanzar', () => {
    const left = runResult({ elements: { A: 1, B: 2 }, resources: { cajero: 0.4 } });
    const right = runResult({ elements: { X: 3 }, resources: { horno: 0.9 } });
    const comparison = compare([left, right]);
    expect(comparison.count).toBe(2);
    expect(rowOf(comparison, WAIT).values).toEqual([1, null]);
    expect(rowOf(comparison, 'elements.X.resourceWait.mean').values).toEqual([null, 3]);
    expect(rowOf(comparison, 'resources.cajero.utilization')).toMatchObject({
      base: 0.4,
      values: [0.4, null],
      deltaAbs: [0, null],
      deltaRel: [0, null],
      significant: [false, false],
    });
    expect(rowOf(comparison, 'resources.horno.utilization')).toMatchObject({
      base: null,
      values: [null, 0.9],
      deltaAbs: [null, null],
      deltaRel: [null, null],
    });
    // `process` existe en ambos ⇒ ninguna fila de proceso queda a medias.
    for (const row of comparison.rows.filter((candidate) => candidate.scope === 'process')) {
      expect(row.values.every((value) => value !== null)).toBe(true);
    }
  });

  test('`resources: {}` contra un resultado con pools no rompe ni inventa filas', () => {
    const noPools = compare([runResult({ elements: { A: 1 } }), runResult({ elements: { A: 1 }, resources: { p: 0.5 } })]);
    expect(noPools.rows.filter((row) => row.scope === 'resources')).toHaveLength(5); // los 5 KPI de un pool
    expect(rowOf(noPools, 'resources.p.utilization').base).toBeNull();
    // Y al revés, el pool de la base desaparece del comparado sin producir un error.
    const dropped = compare([runResult({ elements: { A: 1 }, resources: { p: 0.5 } }), runResult({ elements: { A: 1 } })]);
    expect(rowOf(dropped, 'resources.p.utilization').values).toEqual([0.5, null]);
  });

  test('dos resultados sin ningún elemento siguen dando las filas de proceso', () => {
    const comparison = compare([runResult({}), runResult({})]);
    expect(comparison.rows.every((row) => row.scope === 'process')).toBe(true);
    expect(comparison.rows.length).toBe(20); // 3 conteos + 7 + 7 percentiles + 3 agregados
  });
});

/* ------------------------------------------------------------------ *
 * 6. Ids hostiles: puntos, barras y no-ASCII
 * ------------------------------------------------------------------ */

describe('QA LILA-038 · ataque 6: ids con caracteres hostiles', () => {
  const hostile = ['Task_A.B', 'Task-ñ', 'Task\\C', 'A.B.C', 'Task..D', 'proceso.elements.x'];

  test('`kpi` coincide exactamente con la clave de numericKpis y `id` la desescapa', () => {
    const result = runResult({ elements: Object.fromEntries(hostile.map((id, index) => [id, index + 1])) });
    const keys = new Set(Object.keys(numericKpis(result)));
    const comparison = compare([result]);
    for (const row of comparison.rows) expect(keys.has(row.kpi)).toBe(true);
    for (const id of hostile) {
      const row = comparison.rows.find(
        (candidate) => candidate.scope === 'elements' && candidate.id === id && candidate.metric === 'resourceWait.mean',
      );
      expect(row, id).toBeDefined();
      // El path escapado es el mismo que usaría `replications.kpis` (RESULTS_FORMAT § 8).
      expect(row!.kpi).toBe(`elements.${id.replaceAll('\\', '\\\\').replaceAll('.', '\\.')}.resourceWait.mean`);
    }
  });

  test('ids que solo se distinguen por el escape no colisionan entre sí', () => {
    // `A.B` y un hipotético `A` con métrica `B` producirían el mismo path sin escape.
    const result = runResult({ elements: { 'A.B': 1, 'A\\.B': 2 } });
    const comparison = compare([result]);
    const ids = comparison.rows
      .filter((row) => row.scope === 'elements' && row.metric === 'resourceWait.mean')
      .map((row) => row.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).toContain('A.B');
    expect(ids).toContain('A\\.B');
  });

  test('el ci95 de un id con punto se encuentra por la misma clave escapada', () => {
    const path = 'elements.Task_A\\.B.resourceWait.mean';
    const base = runResult({ elements: { 'Task_A.B': 10 }, kpis: { [path]: ci(10, 9, 11) } });
    const other = runResult({ elements: { 'Task_A.B': 2 }, kpis: { [path]: ci(2, 1, 3) } });
    expect(rowOf(compare([base, other]), path).significant).toEqual([false, true]);
  });
});

/* ------------------------------------------------------------------ *
 * 7. Pureza, determinismo y orden
 * ------------------------------------------------------------------ */

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

describe('QA LILA-038 · ataque 7: pureza y determinismo', () => {
  test('no muta la entrada: dos RunResult congelados en profundidad', () => {
    const results = [
      deepFreeze(runResult({ elements: { A: 1, B: 2 }, resources: { p: 0.3 }, kpis: { [WAIT]: ci(1, 0, 2) } })),
      deepFreeze(runResult({ elements: { A: 5, C: 7 } })),
    ];
    const before = JSON.stringify(results);
    expect(() => compare(results)).not.toThrow();
    expect(JSON.stringify(results)).toBe(before);
  });

  test('dos llamadas idénticas producen el mismo JSON, campo a campo', () => {
    const results = [
      runResult({ elements: { B: 2, A: 1 }, resources: { z: 1, a: 0 }, kpis: { [WAIT]: ci(1, 0, 2) } }),
      runResult({ elements: { C: 3, A: 9 } }),
    ];
    expect(JSON.stringify(compare(results))).toBe(JSON.stringify(compare(results)));
  });

  test('`values` sigue el orden del array de entrada, no el orden de los ids', () => {
    const a = runResult({ elements: { A: 1 } });
    const b = runResult({ elements: { A: 2 } });
    const c = runResult({ elements: { A: 3 } });
    expect(rowOf(compare([a, b, c]), WAIT).values).toEqual([1, 2, 3]);
    expect(rowOf(compare([c, b, a]), WAIT).values).toEqual([3, 2, 1]);
    expect(rowOf(compare([c, b, a]), WAIT).base).toBe(3);
    expect(rowOf(compare([b, b, b]), WAIT).values).toEqual([2, 2, 2]);
  });

  test('el mismo objeto repetido no comparte arrays entre filas', () => {
    const only = runResult({ elements: { A: 1, B: 2 } });
    const comparison = compare([only, only]);
    const first = comparison.rows[0]!;
    const second = comparison.rows[1]!;
    expect(first.values).not.toBe(second.values);
    expect(first.deltaAbs).not.toBe(second.deltaAbs);
  });
});

/* ------------------------------------------------------------------ *
 * 8. Escala: coste lineal en (resultados × KPI)
 * ------------------------------------------------------------------ */

function bigResult(elementCount: number, offset: number): RunResult {
  const elements: Record<string, number> = {};
  for (let index = 0; index < elementCount; index++) elements[`Task_${index}`] = index + offset;
  return runResult({ elements });
}

describe('QA LILA-038 · ataque 8: escala', () => {
  test('50 resultados × ~2 000 KPI se comparan en tiempo lineal-ish', () => {
    // 105 elementos × 19 KPI numéricos + 20 de proceso = 2 015 paths.
    const many = Array.from({ length: 50 }, (_, index) => bigResult(105, index));
    const half = many.slice(0, 25);
    const thin = Array.from({ length: 50 }, (_, index) => bigResult(53, index));

    compare(half); // calentamiento del JIT antes de medir.
    // Mínimo de tres mediciones: una pausa de GC o contención de CPU (varias suites a la vez)
    // infla una medición aislada y convertía el ratio en flaky.
    const time = (results: readonly RunResult[]): number => {
      let best = Infinity;
      for (let attempt = 0; attempt < 3; attempt++) {
        const startedAt = performance.now();
        const comparison = compare(results);
        const elapsed = performance.now() - startedAt;
        expect(comparison.rows.length).toBeGreaterThan(0);
        best = Math.min(best, elapsed);
      }
      return best;
    };

    const full = time(many);
    const halfResults = time(half);
    const halfKpis = time(thin);
    expect(compare(many).rows).toHaveLength(105 * 19 + 20);
    expect(compare(many).count).toBe(50);
    // Cuadrático en el número de resultados o de KPI daría factores ~4; se deja holgura 3× más
    // un piso absoluto para no depender del reloj en máquinas cargadas.
    expect(full).toBeLessThan(3000);
    expect(full).toBeLessThan(Math.max(halfResults, 20) * 3);
    expect(full).toBeLessThan(Math.max(halfKpis, 20) * 3);
  });
});

/* ------------------------------------------------------------------ *
 * 9. Aceptación reproducida con otra semilla
 * ------------------------------------------------------------------ */

const exampleDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../examples/pedido');
const readScenario = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const { ir } = await parseBpmn(readFileSync(resolve(exampleDir, 'model.bpmn'), 'utf8'));
const asIs = resolveExtends(resolve(exampleDir, 'as-is.scenario.json'), readScenario) as unknown as SimScenario;
const toBe = resolveExtends(
  resolve(exampleDir, 'to-be-3-cajeros.scenario.json'),
  readScenario,
) as unknown as SimScenario;
const withSeed = (scenario: SimScenario, seed: number): SimScenario => ({
  ...scenario,
  run: { ...scenario.run, seed },
});

describe('QA LILA-038 · ataque 9: la aceptación no depende de la semilla 42', () => {
  const seed7 = compare([
    simulate(ir, withSeed(asIs, 7), { log: false }),
    simulate(ir, withSeed(toBe, 7), { log: false }),
  ]);

  test('con seed 7 la reducción de espera en Task_TomarPedido sigue siendo significativa', () => {
    const wait = rowOf(seed7, 'elements.Task_TomarPedido.resourceWait.mean');
    expect(wait.deltaAbs[1]).toBeLessThan(0);
    expect(wait.deltaRel[1]!).toBeLessThan(-0.5);
    expect(wait.significant[1]).toBe(true);
  });

  test('con seed 7 la de Task_Preparar sigue sin serlo', () => {
    const wait = rowOf(seed7, 'elements.Task_Preparar.resourceWait.mean');
    expect(wait.significant[1]).toBe(false);
    expect(Math.abs(wait.deltaRel[1]!)).toBeLessThan(0.01);
  });

  test('con seed 7 la utilización del cajero baja de forma significativa', () => {
    const utilization = rowOf(seed7, 'resources.cajero.utilization');
    expect(utilization.deltaAbs[1]).toBeLessThan(0);
    expect(utilization.significant[1]).toBe(true);
  });

  test('todo path de `replications.kpis` tiene su fila en compare, y con el mismo nombre', () => {
    const base = simulate(ir, withSeed(asIs, 7), { log: false });
    const paths = new Set(compare([base]).rows.map((row) => row.kpi));
    for (const path of Object.keys(base.replications?.kpis ?? {})) expect(paths.has(path)).toBe(true);
    expect(paths.size).toBe(Object.keys(base.replications?.kpis ?? {}).length);
  }, 60_000); // ponytail: simula examples/pedido con 30 réplicas (~5 s en CI); techo holgado, no medida de rendimiento
});

/* ------------------------------------------------------------------ *
 * 10. Superficie pública y aislamiento de core/
 * ------------------------------------------------------------------ */

describe('QA LILA-038 · ataque 10: superficie pública', () => {
  test('`compare` se exporta desde el índice del paquete y es la misma función', () => {
    expect(compareFromIndex).toBe(compare);
  });

  test('core/compare.ts no importa nada fuera de core/ (regla 2 del BACKLOG)', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../src/core/compare.ts'),
      'utf8',
    );
    const imports = [...source.matchAll(/^\s*import[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1]!);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier.startsWith('./')).toBe(true);
    expect(source).not.toMatch(/\bany\b\s*[;,)>\]]/);
  });

  test('cada campo de CompareRow documentado en § 11 existe en la fila real', () => {
    const row = compare([runResult({ elements: { A: 1 } })]).rows[0]!;
    expect(Object.keys(row).sort()).toEqual(
      ['base', 'deltaAbs', 'deltaRel', 'id', 'kpi', 'metric', 'scope', 'significant', 'values'].sort(),
    );
    expect(Object.keys(compare([runResult({})])).sort()).toEqual(['count', 'rows']);
  });
});
