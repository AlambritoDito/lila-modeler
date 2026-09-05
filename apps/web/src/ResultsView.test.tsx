/**
 * Sin jsdom ni @testing-library instalados en el repo (ver package.json de la raíz y de
 * apps/web): se renderiza con `react-dom/server` y se afirma sobre el HTML producido, como
 * autoriza el ticket LILA-062. El orden por columna se prueba llamando a la función pura
 * `sortRows` en vez de simular clics — no hay DOM real donde disparar un evento.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { parseBpmn } from '@lila/engine/bpmn';
import { formatDuration, formatNumber } from '@lila/engine/format';
import { elementsCsv, flowsCsv, processCsv, resourcesCsv } from '@lila/engine/csv';
import type { ResolvedScenario } from '@lila/engine/schema';
import type { BottleneckEntry, ProcessIR, RunResult } from '@lila/engine';

import { buildResultCsvExports, ResultsView, sortRows, type ColumnDef } from './ResultsView.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '../../..');
const MODEL_PATH = resolve(REPOSITORY_ROOT, 'examples/pedido/model.bpmn');
const GOLDEN_PATH = resolve(
  REPOSITORY_ROOT,
  'packages/engine/test/golden/pedido.seed-42.json',
);

/** El golden M1 corre `withoutResourcesAndCalendars` (ver packages/engine/test/golden/pedido.ts):
 * `result.resources` y `result.bottlenecks` quedan vacíos a propósito, así que el escenario que
 * lo acompaña tampoco declara `resources`, para que Elementos/Flujos/Proceso sean directamente
 * comparables con lo que produjo `simulate` para ese JSON. */
function loadGolden(): RunResult {
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as RunResult;
}

function scenarioWithUnit(unit: 'min' | 'h'): ResolvedScenario {
  return {
    model: 'model.bpmn',
    name: 'AS-IS',
    run: { baseTimeUnit: unit, currency: 'MXN', replications: 30, seed: 42, start: '2026-09-07T08:00:00-06:00' },
  } as unknown as ResolvedScenario;
}

async function loadIr(): Promise<ProcessIR> {
  const xml = readFileSync(MODEL_PATH, 'utf8');
  const { ir } = await parseBpmn(xml);
  return ir;
}

describe('ResultsView (LILA-062)', () => {
  it('la tabla de Elementos usa el mismo formato que `lila run` (formatDuration/formatNumber)', async () => {
    const ir = await loadIr();
    const result = loadGolden();
    const scenario = scenarioWithUnit('min');
    const html = renderToStaticMarkup(<ResultsView ir={ir} scenario={scenario} result={result} />);

    const task = result.elements['Task_TomarPedido']!;
    // La pestaña "Elementos del proceso" es la que se ve por defecto (sin clics).
    expect(html).toContain('Minimum time (min)');
    expect(html).toContain(formatDuration(task.processing.min, 'min'));
    expect(html).toContain(formatDuration(task.processing.mean, 'min'));
    expect(html).toContain(formatNumber(task.started));
    expect(html).toContain('Task_TomarPedido');
  });

  it('cambiar baseTimeUnit a "h" cambia etiqueta y valores de la tabla, igual que la CLI', async () => {
    const ir = await loadIr();
    const result = loadGolden();
    const task = result.elements['Task_Preparar']!;

    const minHtml = renderToStaticMarkup(
      <ResultsView ir={ir} scenario={scenarioWithUnit('min')} result={result} />,
    );
    const hourHtml = renderToStaticMarkup(
      <ResultsView ir={ir} scenario={scenarioWithUnit('h')} result={result} />,
    );

    expect(minHtml).toContain('Average time (min)');
    expect(hourHtml).toContain('Average time (h)');
    expect(minHtml).toContain(formatDuration(task.processing.mean, 'min'));
    expect(hourHtml).toContain(formatDuration(task.processing.mean, 'h'));
    // El mismo segundo crudo formatea distinto en cada unidad (no es casualidad de redondeo).
    expect(formatDuration(task.processing.mean, 'min')).not.toBe(formatDuration(task.processing.mean, 'h'));
  });

  it('el CSV exportado por cada tabla es byte a byte el de `csv.ts` para el golden', async () => {
    const ir = await loadIr();
    const result = loadGolden();
    const scenario = scenarioWithUnit('min');

    const exported = buildResultCsvExports(ir, scenario, result);

    expect(exported.elements).toBe(elementsCsv(ir, result));
    expect(exported.flows).toBe(flowsCsv(ir, result));
    expect(exported.process).toBe(processCsv(result));
    expect(exported.resources).toBe(resourcesCsv(result, {}));
  });

  it('el CSV no cambia con baseTimeUnit: siempre son los segundos crudos de `csv.ts`', async () => {
    const ir = await loadIr();
    const result = loadGolden();

    const inMinutes = buildResultCsvExports(ir, scenarioWithUnit('min'), result);
    const inHours = buildResultCsvExports(ir, scenarioWithUnit('h'), result);

    expect(inMinutes.elements).toBe(inHours.elements);
    expect(inMinutes.process).toBe(inHours.process);
  });

  it('resourcesCsv usa el nombre declarado en el escenario, no el id', async () => {
    const ir = await loadIr();
    const result: RunResult = {
      ...loadGolden(),
      resources: {
        cajero: { busyTime: 3600, fixedCost: 0, totalCost: 100, unitCost: 100, utilization: 0.5 },
      },
    };
    const scenario = {
      ...scenarioWithUnit('min'),
      resources: { cajero: { capacity: 2, name: 'Cajero' } },
    } as unknown as ResolvedScenario;

    const exported = buildResultCsvExports(ir, scenario, result);
    expect(exported.resources).toBe(resourcesCsv(result, { cajero: 'Cajero' }));
    expect(exported.resources).toContain('Cajero');
    expect(exported.resources).not.toContain('cajero,cajero');
  });

  it('sortRows ordena ascendente, descendente y respeta "sin orden" (null)', () => {
    interface Row {
      id: string;
      value: number;
    }
    const rows: Row[] = [
      { id: 'b', value: 2 },
      { id: 'a', value: 3 },
      { id: 'c', value: 1 },
    ];
    const columns: ColumnDef<Row>[] = [
      { display: (r) => String(r.value), header: 'Value', key: 'value', numeric: true, sortValue: (r) => r.value },
    ];

    expect(sortRows(rows, columns, null).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(sortRows(rows, columns, { dir: 'asc', key: 'value' }).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(sortRows(rows, columns, { dir: 'desc', key: 'value' }).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    // La entrada original no se muta.
    expect(rows.map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('la tarjeta de cuellos de botella sigue el orden de `result.bottlenecks`, sin reordenar', async () => {
    const ir = await loadIr();
    const bottlenecks: BottleneckEntry[] = [
      { elementId: 'Task_Preparar', resourceWaitTotal: 500, utilization: 0.9 },
      { elementId: 'Task_TomarPedido', resourceWaitTotal: 200, utilization: 0.6 },
      { elementId: 'Task_Revisar', resourceWaitTotal: 10, utilization: 0.3 },
    ];
    const result: RunResult = { ...loadGolden(), bottlenecks };

    const html = renderToStaticMarkup(
      <ResultsView ir={ir} scenario={scenarioWithUnit('min')} result={result} />,
    );

    const positions = bottlenecks.map((entry) => html.indexOf(ir.nodes[entry.elementId]?.name ?? entry.elementId));
    // Cada elemento aparece antes que el siguiente en el HTML (mismo orden que el array).
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i - 1]).toBeGreaterThanOrEqual(0);
      expect(positions[i]).toBeGreaterThan(positions[i - 1]!);
    }
  });

  it('sin cuellos de botella muestra el mensaje vacío en vez de una lista', async () => {
    const ir = await loadIr();
    const result = loadGolden();
    expect(result.bottlenecks).toEqual([]);

    const html = renderToStaticMarkup(
      <ResultsView ir={ir} scenario={scenarioWithUnit('min')} result={result} />,
    );

    expect(html).toContain('Sin espera por recurso detectada.');
  });
});
