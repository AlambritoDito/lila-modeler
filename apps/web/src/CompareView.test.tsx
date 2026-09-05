/**
 * Sin jsdom ni @testing-library (igual que ResultsView.test.tsx, LILA-062): se renderiza con
 * `react-dom/server` y se afirma sobre el HTML producido. Dos fuentes de datos:
 *
 * 1. `examples/pedido` AS-IS vs TO-BE 3 cajeros, la aceptación literal de docs/RESULTS_FORMAT.md
 *    §11 / LILA-038: dos `simulate()` reales, computados una sola vez a nivel de módulo (igual que
 *    packages/engine/test/core/compare.test.ts) para no pagar el costo dos veces ni depender de un
 *    timeout de test — la corrida completa tarda ~4-5 s.
 * 2. Un `RunResult` sintético de tres escenarios para el orden de columnas y el toggle de KPIs,
 *    donde no hace falta simular nada.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';

import { parseBpmn } from '@lila/engine/bpmn';
import { resolveExtends } from '@lila/engine/schema';
import { compare, simulate, type CompareRow, type ElementMetrics, type ProcessIR, type RunResult, type SimScenario } from '@lila/engine';

import { CompareView, compareMetricLabel, visibleCompareRows } from './CompareView.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = resolve(HERE, '../../../examples/pedido');
const readScenario = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

/* ------------------------------------------------------------------ *
 * Fixture 1: aceptación real AS-IS vs TO-BE 3 cajeros (LILA-038/047/063).
 * ------------------------------------------------------------------ */

const { ir } = await parseBpmn(readFileSync(resolve(EXAMPLE_DIR, 'model.bpmn'), 'utf8'));
const asIs = resolveExtends(resolve(EXAMPLE_DIR, 'as-is.scenario.json'), readScenario) as unknown as SimScenario;
const toBe = resolveExtends(
  resolve(EXAMPLE_DIR, 'to-be-3-cajeros.scenario.json'),
  readScenario,
) as unknown as SimScenario;
const comparison = compare([simulate(ir, asIs, { log: false }), simulate(ir, toBe, { log: false })]);
const scenarioNames = ['AS-IS', 'TO-BE 3 cajeros'];
const resourceNames = { cajero: 'Cajero', cocinero: 'Cocinero', horno: 'Horno' };

const html = renderToStaticMarkup(
  <CompareView
    baseTimeUnit="min"
    comparison={comparison}
    ir={ir}
    resourceNames={resourceNames}
    scenarioNames={scenarioNames}
  />,
);

/** Todas las filas `<tr>...</tr>` del documento; no hay `<tr>` anidados en esta tabla. */
const trBlocks = html.match(/<tr[^]*?<\/tr>/g) ?? [];

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

describe('CompareView (LILA-063): AS-IS vs TO-BE 3 cajeros', () => {
  test('Task_TomarPedido.resourceWait.mean queda resaltada y marcada como significativa', () => {
    const row = comparison.rows.find((r) => r.kpi === 'elements.Task_TomarPedido.resourceWait.mean')!;
    expect(row.significant[1]).toBe(true);
    expect(row.deltaAbs[1]).not.toBe(0);

    const tr = findRow(row);
    expect(tr).toContain('background:var(--bg-hover)');
    expect(tr).toContain('Diferencia significativa (IC95 disjuntos)');
  });

  test('Task_Preparar.resourceWait.mean no queda marcada como significativa (aunque cambie)', () => {
    const row = comparison.rows.find((r) => r.kpi === 'elements.Task_Preparar.resourceWait.mean')!;
    expect(row.significant[1]).toBe(false);

    const tr = findRow(row);
    expect(tr).not.toContain('Diferencia significativa');
  });

  test('se resalta exactamente la celda con deltaAbs !== 0, y ninguna otra, en toda la vista curada', () => {
    for (const scope of ['elements', 'resources', 'process'] as const) {
      for (const row of visibleCompareRows(comparison.rows, scope, false)) {
        const tr = findRow(row);
        const highlighted = tr.includes('background:var(--bg-hover)');
        expect(highlighted, row.kpi).toBe((row.deltaAbs[1] ?? 0) !== 0);
      }
    }
  });

  test('los valores ausentes muestran guion, nunca vacío ni NaN', () => {
    expect(html).not.toContain('NaN');
    expect(html).not.toContain('undefined');
  });

  test('el nombre del recurso viene del escenario, no del id crudo', () => {
    expect(html).toContain('Cajero');
  });
});

/* ------------------------------------------------------------------ *
 * Fixture 2: RunResult sintético de tres escenarios (orden de columnas, toggle de KPIs).
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

function syntheticResult(resourceWaitMean: number): RunResult {
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
      totalCost: 0,
      waitTime: { max: 0, mean: 0, min: 0, p50: 0, p90: 0, p95: 0, sd: 0 },
    },
    resources: {},
    warnings: [],
  };
}

const fakeIr: ProcessIR = {
  flows: {},
  id: 'Process_Fake',
  name: '',
  nodes: { A: { incoming: [], name: 'Tarea A', outgoing: [], type: 'task' } },
  source: { exporter: 'test', exporterVersion: '1', originalIds: {} },
};

const tresEscenarios = compare([syntheticResult(10), syntheticResult(30), syntheticResult(20)]);

describe('CompareView: tres escenarios y toggle de KPIs', () => {
  test('orden de columnas = orden de entrada, no alfabético ni por magnitud', () => {
    const threeHtml = renderToStaticMarkup(
      <CompareView baseTimeUnit="s" comparison={tresEscenarios} ir={fakeIr} scenarioNames={['Uno', 'Tres', 'Dos']} />,
    );

    const positions = ['Uno (base)', 'Tres', 'Dos'].map((needle) => threeHtml.indexOf(needle));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions[0]).toBeLessThan(positions[1]!);
    expect(positions[1]).toBeLessThan(positions[2]!);
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
});
