/**
 * Sin jsdom ni @testing-library (igual que ResultsView.test.tsx, LILA-062): se renderiza con
 * `react-dom/server` y se afirma sobre el HTML producido. Dos fuentes de datos:
 *
 * 1. `examples/pedido` AS-IS vs TO-BE 3 cajeros, la aceptación literal de docs/RESULTS_FORMAT.md
 *    §11 / LILA-038: dos `simulate()` reales dentro de un `beforeAll` **con timeout explícito**
 *    (#183/#191: en el nivel superior del módulo la corrida se paga durante el `collect`, que no
 *    tiene límite de tiempo y colgaría CI en vez de fallar).
 * 2. Un `RunResult` sintético de tres escenarios para el orden de columnas, la significancia por
 *    columna y el toggle de KPIs, donde no hace falta simular nada.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn } from '@lila/engine/bpmn';
import { resolveExtends } from '@lila/engine/schema';
import {
  compare,
  simulate,
  type CompareResult,
  type CompareRow,
  type ElementMetrics,
  type KpiSummary,
  type ProcessIR,
  type ResourceMetrics,
  type RunResult,
  type SimScenario,
} from '@lila/engine';

import { CompareView, compareMetricLabel, visibleCompareRows, type CompareRunMeta } from './CompareView.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = resolve(HERE, '../../../examples/pedido');
const readScenario = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const HIGHLIGHT = 'background:var(--bg-hover)';
const CURATED_SCOPES = ['elements', 'resources', 'process'] as const;

/* ------------------------------------------------------------------ *
 * Fixture 1: aceptación real AS-IS vs TO-BE 3 cajeros (LILA-038/047/063).
 * ------------------------------------------------------------------ */

let ir: ProcessIR;
let comparison: CompareResult;
let html: string;
/** Todas las filas `<tr>...</tr>` del documento; no hay `<tr>` anidados en esta tabla. */
let trBlocks: string[];

beforeAll(async () => {
  const parsed = await parseBpmn(readFileSync(resolve(EXAMPLE_DIR, 'model.bpmn'), 'utf8'));
  ir = parsed.ir;
  const asIs = resolveExtends(resolve(EXAMPLE_DIR, 'as-is.scenario.json'), readScenario) as unknown as SimScenario;
  const toBe = resolveExtends(
    resolve(EXAMPLE_DIR, 'to-be-3-cajeros.scenario.json'),
    readScenario,
  ) as unknown as SimScenario;
  comparison = compare([simulate(ir, asIs, { log: false }), simulate(ir, toBe, { log: false })]);
  html = renderToStaticMarkup(
    <CompareView
      baseTimeUnit="min"
      comparison={comparison}
      ir={ir}
      resourceNames={{ cajero: 'Cajero', cocinero: 'Cocinero', horno: 'Horno' }}
      scenarioNames={['AS-IS', 'TO-BE 3 cajeros']}
    />,
  );
  trBlocks = html.match(/<tr[^]*?<\/tr>/g) ?? [];
}, 120_000);

/** Ubica la única fila que muestra el id (o, si no hay id, solo el metric) y la etiqueta del KPI. */
function findRow(row: CompareRow): string {
  const idNeedle = row.id === null ? null : `>${row.id}<`;
  // Envuelto en `><` porque la etiqueta va sola en su celda: "Average time" sería substring de
  // "Average time (waiting for resource)" sin el borde exacto.
  const metricNeedle = `>${compareMetricLabel(row.scope, row.metric)}<`;
  const matches = trBlocks.filter(
    (tr) => (idNeedle === null || tr.includes(idNeedle)) && tr.includes(metricNeedle),
  );
  expect(matches, `fila no encontrada para ${row.kpi}`).toHaveLength(1);
  return matches[0]!;
}

const cellsOf = (tr: string): string[] => tr.match(/<td[^]*?<\/td>/g) ?? [];
const textOf = (cell: string): string => cell.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

describe('CompareView (LILA-063): AS-IS vs TO-BE 3 cajeros', () => {
  test('Task_TomarPedido.resourceWait.mean queda resaltada y marcada como significativa', () => {
    const row = comparison.rows.find((r) => r.kpi === 'elements.Task_TomarPedido.resourceWait.mean')!;
    expect(row.significant[1]).toBe(true);
    expect(row.deltaAbs[1]).not.toBe(0);

    const tr = findRow(row);
    expect(tr).toContain(HIGHLIGHT);
    expect(tr).toContain('Diferencia significativa (IC95 disjuntos)');
  });

  test('Task_Preparar.resourceWait.mean no queda marcada como significativa (aunque cambie)', () => {
    const row = comparison.rows.find((r) => r.kpi === 'elements.Task_Preparar.resourceWait.mean')!;
    expect(row.significant[1]).toBe(false);

    const tr = findRow(row);
    expect(tr).not.toContain('Diferencia significativa');
  });

  test('se resalta la celda si y solo si su texto difiere del de la base, en toda la vista curada', () => {
    for (const scope of CURATED_SCOPES) {
      for (const row of visibleCompareRows(comparison.rows, scope, false)) {
        const cells = cellsOf(findRow(row));
        const cell = cells[cells.length - 1]!;
        const base = textOf(cells[cells.length - 2]!);
        // El texto de una celda que no cambió es el de la base más "(0%)", o "(-)" si la base es 0.
        // Tercer caso (QA, LILA-063): un KPI ausente en los dos escenarios imprime el mismo guion
        // en ambas columnas y tampoco cambió; en `examples/pedido` no ocurre, pero el predicado no
        // puede depender de eso.
        const unchanged =
          textOf(cell) === `${base} (0%)` || textOf(cell) === `${base} (-)` || textOf(cell) === base;
        expect(cell.includes(HIGHLIGHT), `${row.kpi}: "${base}" -> "${textOf(cell)}"`).toBe(!unchanged);
      }
    }
  });

  test('la marca `*` aparece exactamente en las celdas con `significant`, ni una más', () => {
    for (const scope of CURATED_SCOPES) {
      for (const row of visibleCompareRows(comparison.rows, scope, false)) {
        const tr = findRow(row);
        expect(tr.includes('Diferencia significativa'), row.kpi).toBe(row.significant[1] === true);
      }
    }
    expect((html.match(/Diferencia significativa \(IC95 disjuntos\)"/g) ?? []).length).toBeGreaterThan(0);
  });

  test('el resaltado ignora los residuos de punto flotante: mismo número mostrado, sin resaltar', () => {
    // `Task_Preparar.processing.mean` difiere en ~5.7e-14 s entre AS-IS y TO-BE: `deltaAbs !== 0`
    // pero las dos columnas imprimen el mismo número y el delta redondea a "(0%)". Ancla la
    // decisión de QA: "cambia" es lo que el usuario ve, no el último bit flotante.
    const row = comparison.rows.find((r) => r.kpi === 'elements.Task_Preparar.processing.mean')!;
    expect(row.deltaAbs[1]).not.toBe(0);
    expect(Math.abs(row.deltaRel[1]!)).toBeLessThan(1e-9);

    const tr = findRow(row);
    expect(tr).not.toContain(HIGHLIGHT);
  });

  test('mismos números y decimales que la consola de `lila compare` con el mismo seed', () => {
    // Copiados de `node packages/engine/bin/lila.js compare examples/pedido/model.bpmn
    // examples/pedido/as-is.scenario.json examples/pedido/to-be-3-cajeros.scenario.json`.
    expect(html).toContain('0.249493');
    expect(html).toContain('0.036306 (-85.447978%)');
    expect(html).toContain('41.411072%');
    expect(html).toContain('28.444895% (-31.310893%)');
    // Utilización en %, no en fracción (RESULTS_FORMAT §10, igual que resources.csv).
    expect(html).not.toContain('0.41411072');
  });

  test('los valores ausentes muestran guion y nunca aparecen NaN, undefined ni -0%', () => {
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('-0%');
    expect(html).toContain('0 (-)'); // base 0: el relativo no está definido, guion como en la CLI.
  });

  test('el nombre del recurso viene del escenario, no del id crudo', () => {
    expect(html).toContain('Cajero');
  });

  test('accesibilidad heredada de DataTable y marca legible por lector de pantalla', () => {
    expect(html).toContain('scope="col"');
    expect(html).toContain('aria-sort="none"');
    // `title` a secas no lo anuncia VoiceOver sobre un `<span>`: hace falta un rol con nombre.
    expect(html).toContain('aria-label="Diferencia significativa (IC95 disjuntos)"');
    expect(html).toContain('role="img"');
  });

  test('sin hex sueltos: todo color sale de un token del tema (LILA-112)', () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3}\b/);
  });
});

/* ------------------------------------------------------------------ *
 * Fixture 2: RunResult sintético (orden de columnas, delta contra la base, pool nuevo, toggle).
 * ------------------------------------------------------------------ */

function elementMetrics(resourceWaitMean: number): ElementMetrics {
  return {
    completed: 1,
    fixedCostTotal: 0,
    offHoursWait: { max: 0, mean: 0, min: 0, sd: 0, total: 0 },
    processing: { max: 0, mean: 0, min: 0, total: 0 },
    queueLength: { max: 0, mean: 0 },
    resourceWait: { max: 0, mean: resourceWaitMean, min: 0, sd: 0, total: resourceWaitMean },
    started: 1,
  };
}

function resourceMetrics(utilization: number): ResourceMetrics {
  return { busyTime: 0, fixedCost: 0, totalCost: 0, unitCost: 0, utilization };
}

/**
 * `overrides` cubre lo que necesitan los tests de OP-05 (issue #210) sin tocar la forma que ya
 * usaban los tests de LILA-063: costo total del proceso (para las filas de moneda),
 * `replications` (para forzar `significant` sin simular de verdad) y `warnings` propios.
 */
function syntheticResult(
  resourceWaitMean: number,
  resources: Record<string, ResourceMetrics> = {},
  overrides: Partial<Pick<RunResult, 'replications' | 'warnings'>> & { totalCost?: number } = {},
): RunResult {
  return {
    bottlenecks: [],
    elements: { A: elementMetrics(resourceWaitMean) },
    flows: {},
    process: {
      completed: 0,
      costPerCase: 0,
      cycleTime: { max: 0, mean: 0, min: 0, p50: 0, p90: 0, p95: 0, sd: 0 },
      inFlight: 0,
      started: 0,
      throughputPerHour: 0,
      totalCost: overrides.totalCost ?? 0,
      waitTime: { max: 0, mean: 0, min: 0, p50: 0, p90: 0, p95: 0, sd: 0 },
    },
    resources,
    warnings: overrides.warnings ?? [],
    ...(overrides.replications === undefined ? {} : { replications: overrides.replications }),
  };
}

const fakeIr: ProcessIR = {
  flows: {},
  id: 'Process_Fake',
  name: '',
  nodes: { A: { incoming: [], name: 'Tarea A', outgoing: [], type: 'task' } },
  source: { exporter: 'test', exporterVersion: '1', originalIds: {}, warnings: [] },
};

const tresEscenarios = compare([syntheticResult(10), syntheticResult(30), syntheticResult(20)]);
const tresHtml = renderToStaticMarkup(
  <CompareView baseTimeUnit="s" comparison={tresEscenarios} ir={fakeIr} scenarioNames={['Uno', 'Tres', 'Dos']} />,
);

describe('CompareView: tres escenarios y toggle de KPIs', () => {
  test('orden de columnas = orden de entrada, no alfabético ni por magnitud', () => {
    const positions = ['Uno (base)', 'Tres', 'Dos'].map((needle) => tresHtml.indexOf(needle));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions[0]).toBeLessThan(positions[1]!);
    expect(positions[1]).toBeLessThan(positions[2]!);
  });

  test('el delta de cada columna se calcula contra la base, no contra la columna anterior', () => {
    // 10 -> 30 es +200% y 10 -> 20 es +100%; contra la columna anterior serían +200% y -33.3%.
    expect(tresHtml).toContain('30 (+200%)');
    expect(tresHtml).toContain('20 (+100%)');
    expect(tresHtml).not.toContain('-33.333333%');
  });

  test('sin IC95 (una sola corrida) no hay marca, pero el resaltado sigue funcionando', () => {
    expect(tresEscenarios.rows.every((row) => row.significant.every((flag) => flag === false))).toBe(true);
    expect(tresHtml).not.toContain('Diferencia significativa (IC95 disjuntos)"');
    expect(tresHtml).toContain(HIGHLIGHT);
  });

  test('un pool que solo existe en el TO-BE: guion en la base y su nombre visible', () => {
    const nuevoPool = compare([
      syntheticResult(10),
      syntheticResult(10, { mesero: resourceMetrics(0.5) }),
    ]);
    const row = nuevoPool.rows.find((r) => r.kpi === 'resources.mesero.utilization')!;
    expect(row.values[0]).toBe(null);
    expect(row.deltaAbs[1]).toBe(null); // por eso `deltaAbs !== 0` no servía como criterio.

    const poolHtml = renderToStaticMarkup(
      <CompareView
        baseTimeUnit="s"
        comparison={nuevoPool}
        ir={fakeIr}
        resourceNames={{ mesero: 'Mesero' }}
        scenarioNames={['AS-IS', 'TO-BE']}
      />,
    );
    const tr = (poolHtml.match(/<tr[^]*?<\/tr>/g) ?? []).find(
      (block) => block.includes('>mesero<') && block.includes('>Utilization (%)<'),
    )!;
    expect(tr).toContain('>Mesero<');
    expect(textOf(cellsOf(tr)[3]!)).toBe('-'); // la base no conoce el pool.
    expect(textOf(cellsOf(tr)[4]!)).toBe('50% (-)'); // sin base no hay delta relativo, igual que la CLI.
    expect(cellsOf(tr)[4]!).toContain(HIGHLIGHT); // aparecer donde no había nada sí es un cambio.
  });

  test('visibleCompareRows: sin "mostrar todos" solo el subconjunto curado; con él, todos', () => {
    const curada = visibleCompareRows(tresEscenarios.rows, 'elements', false);
    const todas = visibleCompareRows(tresEscenarios.rows, 'elements', true);

    expect(curada.some((row) => row.metric === 'resourceWait.mean')).toBe(true);
    // queueLength.max no está en el subconjunto curado de `lila compare` (solo queueLength.mean).
    expect(curada.some((row) => row.metric === 'queueLength.max')).toBe(false);
    expect(todas.some((row) => row.metric === 'queueLength.max')).toBe(true);
    expect(todas.length).toBeGreaterThanOrEqual(curada.length);
  });

  test('dos escenarios con el mismo nombre no colapsan en el selector', () => {
    const igualHtml = renderToStaticMarkup(
      <CompareView baseTimeUnit="s" comparison={tresEscenarios} ir={fakeIr} scenarioNames={['Copia', 'Copia', 'Copia']} />,
    );
    // 3 escenarios + el toggle "Mostrar todos los KPI".
    expect((igualHtml.match(/type="checkbox"/g) ?? []).length).toBe(4);
  });
});

/* ------------------------------------------------------------------ *
 * OP-05 (issue #210): metadatos por corrida (`runs`) — moneda, unidades, semilla,
 * réplicas y avisos. Reutiliza `syntheticResult`/`fakeIr` de la fixture 2, sin simular nada.
 * ------------------------------------------------------------------ */

function findTr(html: string, needle: string): string {
  const blocks = html.match(/<tr[^]*?<\/tr>/g) ?? [];
  const matches = blocks.filter((block) => block.includes(needle));
  expect(matches, `fila no encontrada para "${needle}"`).toHaveLength(1);
  return matches[0]!;
}

describe('CompareView (OP-05): metadatos por corrida y avisos', () => {
  test('(a) monedas distintas: process.totalCost no muestra delta ni resaltado, y aparece el aviso', () => {
    const comparison = compare([
      syntheticResult(10, {}, { totalCost: 100 }),
      syntheticResult(10, {}, { totalCost: 500 }),
    ]);
    const runs: CompareRunMeta[] = [{ currency: 'USD', name: 'AS-IS' }, { currency: 'MXN', name: 'TO-BE' }];
    const html = renderToStaticMarkup(
      <CompareView baseTimeUnit="s" comparison={comparison} ir={fakeIr} runs={runs} scenarioNames={['AS-IS', 'TO-BE']} />,
    );

    const tr = findTr(html, '>totalCost<');
    const cells = cellsOf(tr).map(textOf);
    // [Metric, AS-IS, TO-BE]: el valor de TO-BE se ve, pero sin delta y con "no comparable".
    expect(cells[2]).toContain('no comparable');
    expect(cells[2]).not.toMatch(/[-+]?\d+%/); // ningún porcentaje de mejora/ahorro inventado.
    expect(cellsOf(tr)[2]).not.toContain(HIGHLIGHT);
    expect(html).toContain('Costos en monedas distintas (USD vs MXN): no se comparan sin conversión.');
  });

  test('(b) réplicas = 1 en una corrida: sin marcador de significancia aunque `significant` sea true', () => {
    const disjointBase: KpiSummary = { ci95: [9, 11], mean: 10, sd: 1 };
    const disjointOther: KpiSummary = { ci95: [29, 31], mean: 30, sd: 1 };
    const comparison = compare([
      syntheticResult(10, {}, { replications: { count: 30, kpis: { 'elements.A.resourceWait.mean': disjointBase } } }),
      syntheticResult(30, {}, { replications: { count: 30, kpis: { 'elements.A.resourceWait.mean': disjointOther } } }),
    ]);
    // El fixture está bien montado: compare() sí marca significancia con estos IC disjuntos.
    const row = comparison.rows.find((r) => r.kpi === 'elements.A.resourceWait.mean')!;
    expect(row.significant[1]).toBe(true);

    // Pero los metadatos de la corrida declaran solo 1 réplica: la vista no puede fabricar un IC
    // que la corrida real no respalda, así que el asterisco no debe aparecer.
    const runs: CompareRunMeta[] = [
      { name: 'AS-IS', replications: 1 },
      { name: 'TO-BE', replications: 30 },
    ];
    const html = renderToStaticMarkup(
      <CompareView baseTimeUnit="s" comparison={comparison} ir={fakeIr} runs={runs} scenarioNames={['AS-IS', 'TO-BE']} />,
    );

    expect(html).not.toContain('Diferencia significativa');
    expect(html).toContain('Sin intervalos de confianza');
    expect(html).toContain('Sin intervalos de confianza: hacen falta ≥ 2 réplicas para hablar de significancia.');
  });

  test('(c) los avisos de ambas corridas son visibles, ninguno se pierde', () => {
    const comparison = compare([syntheticResult(10), syntheticResult(30)]);
    const runs: CompareRunMeta[] = [
      { name: 'AS-IS', warnings: ['Aviso propio de AS-IS'] },
      { name: 'TO-BE', warnings: ['Aviso propio de TO-BE'] },
    ];
    const html = renderToStaticMarkup(
      <CompareView baseTimeUnit="s" comparison={comparison} ir={fakeIr} runs={runs} scenarioNames={['AS-IS', 'TO-BE']} />,
    );

    expect(html).toContain('Aviso propio de AS-IS');
    expect(html).toContain('Aviso propio de TO-BE');
  });

  test('(d) unidades de tiempo distintas: aviso y formato por corrida', () => {
    // Mismo id/metrica en las dos corridas, valores en segundos elegidos para que la conversión
    // a la unidad de cada corrida dé un número redondo: 600 s en "min" = 10; 7200 s en "h" = 2.
    const comparison = compare([syntheticResult(600), syntheticResult(7200)]);
    const runs: CompareRunMeta[] = [
      { baseTimeUnit: 'min', name: 'AS-IS' },
      { baseTimeUnit: 'h', name: 'TO-BE' },
    ];
    const html = renderToStaticMarkup(
      <CompareView baseTimeUnit="s" comparison={comparison} ir={fakeIr} runs={runs} scenarioNames={['AS-IS', 'TO-BE']} />,
    );

    const tr = findTr(html, '>Average time (waiting for resource)<');
    const cells = cellsOf(tr).map(textOf);
    // [Id, Name, Metric, AS-IS, TO-BE].
    expect(cells[3]).toBe('10'); // AS-IS, en minutos.
    expect(cells[4]).toContain('2'); // TO-BE, en horas.
    expect(html).toContain(
      'Unidades de tiempo distintas entre corridas (min vs h): cada valor se muestra con la unidad de su propia corrida.',
    );
  });

  test('sin `runs` la vista es idéntica a antes de OP-05: sin panel de avisos ni metadatos extra', () => {
    expect(tresHtml).not.toContain('Avisos');
    expect(tresHtml).not.toContain('no comparable');
  });
});
