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
import { columnLabel, formatDuration, formatNumber } from '@lila/engine/format';
import { elementsCsv, flowsCsv, processCsv, resourcesCsv } from '@lila/engine/csv';
import type { ResolvedScenario } from '@lila/engine/schema';
import type { BottleneckEntry, ProcessIR, RunResult } from '@lila/engine';

import { buildResultCsvExports, ResultsView, sortRows, type ColumnDef } from './ResultsView.js';
import { setLocale } from './i18n';

// This suite pins the Spanish translation. English is the app's base language since
// LILA-210, so the locale is set here instead of depending on the machine's.
setLocale('es');

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

  it('sortRows ordena texto con acentos como el español, no por punto de código', () => {
    interface Row {
      name: string;
    }
    // Sin `localeCompare`, "Ánimo" (U+00C1 = 193) se iría detrás de "Zorro" (U+005A = 90).
    const rows: Row[] = [{ name: 'Zorro' }, { name: 'Ánimo' }, { name: 'animo' }, { name: 'Balde' }];
    const columns: ColumnDef<Row>[] = [
      { display: (r) => r.name, header: 'Name', key: 'name', sortValue: (r) => r.name },
    ];

    expect(sortRows(rows, columns, { dir: 'asc', key: 'name' }).map((r) => r.name)).toEqual([
      'animo',
      'Ánimo',
      'Balde',
      'Zorro',
    ]);
  });

  it('los números se ordenan como números: 9 antes que 10, no "10" antes que "9"', () => {
    interface Row {
      value: number;
    }
    const rows: Row[] = [{ value: 10 }, { value: 9 }, { value: 100 }];
    const columns: ColumnDef<Row>[] = [
      { display: (r) => String(r.value), header: 'V', key: 'v', numeric: true, sortValue: (r) => r.value },
    ];

    expect(sortRows(rows, columns, { dir: 'asc', key: 'v' }).map((r) => r.value)).toEqual([9, 10, 100]);
  });

  it('las columnas de costo conservan el nombre Bizagi y la moneda va en la cabecera', async () => {
    const ir = await loadIr();
    const html = renderToStaticMarkup(
      <ResultsView ir={ir} scenario={scenarioWithUnit('min')} result={loadGolden()} />,
    );

    // `Total fixed cost` es el nombre de columna de Bizagi (docs/RESULTS_FORMAT.md §10) y es el
    // header literal de `elementsCsv`: si la tabla le pegara " (MXN)" dejaría de coincidir.
    expect(html).toContain('Total fixed cost');
    expect(html).not.toContain('Total fixed cost (MXN)');
    expect(html).toContain('moneda MXN');
  });

  it('los encabezados ordenables son alcanzables por teclado y anuncian su orden', async () => {
    const ir = await loadIr();
    const html = renderToStaticMarkup(
      <ResultsView ir={ir} scenario={scenarioWithUnit('min')} result={loadGolden()} />,
    );

    expect(html).toContain('aria-sort="none"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('scope="col"');
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

  it('los encabezados salen del mapa único de `@lila/engine/format` (LILA-201)', async () => {
    const ir = await loadIr();
    const result = loadGolden();
    const scenario = scenarioWithUnit('min');
    const html = renderToStaticMarkup(<ResultsView ir={ir} scenario={scenario} result={result} />);

    // Texto exacto de cada `<th>` de la pestaña visible por defecto ("Elementos del proceso").
    const headers = [...html.matchAll(/<th [^>]*>(.*?)<\/th>/g)].map((match) =>
      match[1]!.replaceAll('<!-- -->', ''),
    );
    // Mismas columnas y orden que `elements.csv`, con el sufijo de unidad solo en las duraciones
    // (docs/RESULTS_FORMAT.md § 10): la web no puede llamar distinto a la columna que el CSV.
    const csvHeader = elementsCsv(ir, result).split('\r\n')[0]!.split(',');
    expect(headers).toHaveLength(csvHeader.length);
    for (const [index, name] of csvHeader.entries()) {
      expect([name, `${name} (min)`], name).toContain(headers[index]);
    }
    expect(headers).toContain(columnLabel('elements', 'fixedCostTotal'));
    expect(headers).toContain(`${columnLabel('elements', 'resourceWait.sd')} (min)`);
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
