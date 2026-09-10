/**
 * QA adversarial de `CompareView` (LILA-063), por un agente distinto al implementador.
 *
 * Ataques, en orden: paridad literal con `lila compare` (la vista y la CLI imprimen la misma
 * tabla, celda por celda), columna base intocable, estructura de la tabla, `baseTimeUnit`
 * distinto de `min`, pools que nacen o desaparecen entre escenarios, `null` en la base **y** en
 * la columna comparada, significancia por columna, orden de filas, ids que no son NCName y
 * ordenación por la columna `Metric`.
 *
 * Mismo patrón que `CompareView.test.tsx` (LILA-062/063): sin jsdom, `renderToStaticMarkup` y
 * aserciones sobre el HTML. Las dos corridas reales de `examples/pedido` y la invocación de la
 * CLI viven en un `beforeAll` con timeout explícito (#183/#191).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn } from '@lila/engine/bpmn';
import { resolveExtends } from '@lila/engine/schema';
import { formatDuration } from '@lila/engine/format';
import {
  compare,
  simulate,
  type CompareResult,
  type CompareRow,
  type ElementMetrics,
  type ProcessIR,
  type ResourceMetrics,
  type ReplicationSummary,
  type RunResult,
  type SimScenario,
} from '@lila/engine';

import { compareColumns, CompareView, compareMetricLabel, visibleCompareRows } from './CompareView.js';
import { DataTable, sortRows } from './ResultsView.js';
import { setLocale } from './i18n';

// This suite pins the Spanish translation. English is the app's base language since
// LILA-210, so the locale is set here instead of depending on the machine's.
setLocale('es');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');
const EXAMPLE_DIR = resolve(REPO, 'examples/pedido');
const LILA_BIN = resolve(REPO, 'packages/engine/bin/lila.js');
const readScenario = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const HIGHLIGHT = 'background:var(--bg-hover)';
const SIGNIFICANT = 'Diferencia significativa';

/* ------------------------------------------------------------------ *
 * Utilidades de lectura del HTML.
 * ------------------------------------------------------------------ */

const tablesOf = (html: string): string[] => html.match(/<table[^]*?<\/table>/g) ?? [];
const rowsOf = (table: string): string[] => table.match(/<tr[^]*?<\/tr>/g) ?? [];
const cellsOf = (tr: string): string[] => tr.match(/<t[dh][^]*?<\/t[dh]>/g) ?? [];

/** Texto visible de una celda: sin etiquetas, sin entidades y con espacios colapsados. */
function textOf(cell: string): string {
  return cell
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** La marca de significancia va separada en el HTML (`… *`) y pegada en la CLI (`…*`). */
const normalizeMark = (text: string): string => text.replace(/\s+\*$/, '*');

/* ------------------------------------------------------------------ *
 * Fixture real: examples/pedido AS-IS vs TO-BE 3 cajeros, más la salida de `lila compare`.
 * ------------------------------------------------------------------ */

let ir: ProcessIR;
let comparison: CompareResult;
let html: string;
let cliStdout: string;

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
      resourceNames={{ cajero: 'Cashier', cocinero: 'Cook', horno: 'Oven' }}
      scenarioNames={['AS-IS', 'TO-BE 3 cashiers']}
    />,
  );
  // La misma comparación por la CLI: `simulate` es determinista con `seed`, así que las dos
  // tablas tienen que coincidir carácter por carácter en cada celda.
  cliStdout = execFileSync(
    process.execPath,
    [
      LILA_BIN,
      'compare',
      resolve(EXAMPLE_DIR, 'model.bpmn'),
      resolve(EXAMPLE_DIR, 'as-is.scenario.json'),
      resolve(EXAMPLE_DIR, 'to-be-3-cajeros.scenario.json'),
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
}, 180_000);

/**
 * Tablas monoespaciadas de la CLI, cortadas por los anchos exactos de la línea de guiones que
 * `formatTable` imprime debajo del encabezado (partir por espacios se rompería con cualquier
 * nombre que llevara dos seguidos).
 */
function cliTable(title: string): { headers: string[]; rows: string[][] } {
  const lines = cliStdout.split('\n');
  const start = lines.indexOf(title);
  expect(start, `la CLI no imprimió la tabla "${title}"`).toBeGreaterThanOrEqual(0);
  const dashes = lines[start + 2] ?? '';
  expect(dashes).toMatch(/^-+( {2}-+)*$/);

  const widths = dashes.split('  ').map((segment) => segment.length);
  const cut = (line: string): string[] => {
    const cells: string[] = [];
    let offset = 0;
    for (const [index, width] of widths.entries()) {
      cells.push((index === widths.length - 1 ? line.slice(offset) : line.slice(offset, offset + width)).trimEnd());
      offset += width + 2;
    }
    return cells;
  };

  const rows: string[][] = [];
  for (let index = start + 3; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (line.trim() === '') break;
    rows.push(cut(line));
  }
  return { headers: cut(lines[start + 1] ?? ''), rows };
}

describe('CompareView QA: paridad con `lila compare`', () => {
  // Ataque 1: la vista repite el subconjunto curado y las etiquetas Bizagi de `cli.ts` en vez de
  // importarlos (nota "ponytail" del componente). Este test es el que detecta esa deriva: mismas
  // filas, mismo orden y mismo texto en cada celda que la tabla de consola.
  test.each([
    ['Process elements', 0],
    ['Resources', 1],
    ['Process', 2],
  ])('la tabla %s es idéntica, celda por celda, a la de la consola', (title, tableIndex) => {
    const cli = cliTable(title as string);
    const table = tablesOf(html)[tableIndex as number];
    expect(table, `falta la tabla ${title} en la vista`).toBeDefined();

    const [head, ...body] = rowsOf(table!);
    expect(cellsOf(head!).map(textOf)).toEqual(cli.headers);
    expect(body).toHaveLength(cli.rows.length);
    for (const [index, tr] of body.entries()) {
      expect(cellsOf(tr).map((cell) => normalizeMark(textOf(cell))), `${title} fila ${index}`).toEqual(
        cli.rows[index],
      );
    }
  });
});

describe('CompareView QA: resaltado y estructura', () => {
  // Ataque 2: "AS-IS vs TO-BE marca solo las celdas que cambian" incluye no marcar nunca la
  // columna base —se compararía contra sí misma— ni las columnas de identidad (Id/Name/Metric).
  // Con dos escenarios, la única celda que puede llevar resaltado es la última de cada fila.
  test('solo la columna comparada puede llevar resaltado; base, Id, Name y Metric nunca', () => {
    let resaltadas = 0;
    for (const table of tablesOf(html)) {
      for (const tr of rowsOf(table).slice(1)) {
        const cells = cellsOf(tr);
        for (const cell of cells.slice(0, -1)) expect(cell, tr).not.toContain(HIGHLIGHT);
        if (cells[cells.length - 1]!.includes(HIGHLIGHT)) resaltadas++;
      }
    }
    expect(resaltadas).toBeGreaterThan(0);
  });

  // Ataque 3: una columna de más o de menos en una fila desalinea toda la tabla.
  test('cada fila tiene tantas celdas como encabezados su tabla', () => {
    const tables = tablesOf(html);
    expect(tables.length).toBe(3); // elementos, recursos, proceso; flujos solo con "todos los KPI".
    for (const table of tables) {
      const [head, ...body] = rowsOf(table);
      const columns = cellsOf(head!).length;
      expect(columns).toBeGreaterThan(2);
      for (const tr of body) expect(cellsOf(tr)).toHaveLength(columns);
    }
  });

  // Ataque 4: el `<th>` de cada columna tiene que ser encabezado de columna declarado.
  test('todos los encabezados son `th scope="col"` y ninguna fila de datos trae `th`', () => {
    for (const table of tablesOf(html)) {
      const [head, ...body] = rowsOf(table);
      for (const th of cellsOf(head!)) expect(th).toContain('scope="col"');
      for (const tr of body) expect(tr).not.toContain('<th');
    }
  });

  // Ataque 5: dos renders de la misma comparación tienen que dar el mismo HTML, y en el orden de
  // `compare()` (RESULTS_FORMAT §11: "dos llamadas con la misma entrada producen el mismo JSON").
  test('el orden de filas es estable y es el de `compare()`', () => {
    const again = renderToStaticMarkup(
      <CompareView
        baseTimeUnit="min"
        comparison={comparison}
        ir={ir}
        resourceNames={{ cajero: 'Cashier', cocinero: 'Cook', horno: 'Oven' }}
        scenarioNames={['AS-IS', 'TO-BE 3 cashiers']}
      />,
    );
    expect(again).toBe(html);

    const esperadas = visibleCompareRows(comparison.rows, 'elements', false);
    const filas = rowsOf(tablesOf(html)[0]!).slice(1);
    expect(filas).toHaveLength(esperadas.length);
    for (const [index, row] of esperadas.entries()) {
      const cells = cellsOf(filas[index]!).map(textOf);
      expect([cells[0], cells[2]], row.kpi).toEqual([row.id ?? '', compareMetricLabel(row.scope, row.metric)]);
    }
  });

  // Ataque 6: `visibleCompareRows(rows, scope, true)` no puede esconder ninguna columna que
  // Bizagi sí muestra (docs/RESULTS_FORMAT.md §10).
  test('con "todos los KPI" están todas las métricas con nombre de columna Bizagi', () => {
    const elementos = visibleCompareRows(comparison.rows, 'elements', true)
      .filter((row) => row.id === 'Task_TomarPedido')
      .map((row) => row.metric);
    expect(elementos).toEqual(
      expect.arrayContaining([
        'started',
        'completed',
        'processing.min',
        'processing.max',
        'processing.mean',
        'processing.total',
        'resourceWait.min',
        'resourceWait.max',
        'resourceWait.mean',
        'resourceWait.sd',
        'resourceWait.total',
        'fixedCostTotal',
      ]),
    );

    const recursos = visibleCompareRows(comparison.rows, 'resources', true)
      .filter((row) => row.id === 'cajero')
      .map((row) => row.metric);
    expect(recursos).toEqual(expect.arrayContaining(['utilization', 'fixedCost', 'unitCost', 'totalCost']));

    const flujos = visibleCompareRows(comparison.rows, 'flows', true);
    expect(flujos.length).toBeGreaterThan(0);
    expect(compareMetricLabel('flows', flujos[0]!.metric)).toBe('Instances/Tokens completed');
  });
});

/* ------------------------------------------------------------------ *
 * Ataque 7: `baseTimeUnit` distinto de `min`.
 * ------------------------------------------------------------------ */

/** Fila (id, etiqueta Bizagi) de un HTML ya renderizado. */
function findRow(source: string, id: string | null, label: string): string {
  const matches = (source.match(/<tr[^]*?<\/tr>/g) ?? []).filter(
    (tr) => (id === null || tr.includes(`>${id}<`)) && tr.includes(`>${label}<`),
  );
  expect(matches, `fila no encontrada: ${id ?? 'proceso'} / ${label}`).toHaveLength(1);
  return matches[0]!;
}

describe('CompareView QA: baseTimeUnit', () => {
  test('la unidad convierte las duraciones y no toca conteos, porcentajes ni contadores de cola', () => {
    const render = (unit: 's' | 'h'): string =>
      renderToStaticMarkup(
        <CompareView
          baseTimeUnit={unit}
          comparison={comparison}
          ir={ir}
          resourceNames={{ cajero: 'Cashier', cocinero: 'Cook', horno: 'Oven' }}
          scenarioNames={['AS-IS', 'TO-BE 3 cashiers']}
        />,
      );
    const enSegundos = render('s');
    const enHoras = render('h');

    const duracion = comparison.rows.find((r) => r.kpi === 'elements.Task_Revisar.processing.mean')!;
    for (const [unit, source] of [
      ['s', enSegundos],
      ['h', enHoras],
      ['min', html],
    ] as const) {
      const cells = cellsOf(findRow(source, 'Task_Revisar', 'Average time')).map(textOf);
      expect(cells[3], `base en ${unit}`).toBe(formatDuration(duracion.values[0]!, unit));
    }

    // Conteos, utilización y `queueLength.mean` no son segundos: su texto no puede cambiar.
    for (const [id, label] of [
      ['Task_Revisar', 'Instances started'],
      ['Task_TomarPedido', 'queueLength.mean'],
      ['cajero', 'Utilization (%)'],
      ['cajero', 'Total cost'],
    ] as const) {
      expect(cellsOf(findRow(enHoras, id, label)).map(textOf), `${id}/${label}`).toEqual(
        cellsOf(findRow(html, id, label)).map(textOf),
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 * Fixtures sintéticos: pools que aparecen y desaparecen, IC95 por columna, ids con punto.
 * ------------------------------------------------------------------ */

function elementMetrics(mean: number): ElementMetrics {
  return {
    completed: 1,
    fixedCostTotal: 0,
    offHoursWait: { max: 0, mean: 0, min: 0, sd: 0, total: 0 },
    processing: { max: 0, mean: 0, min: 0, total: 0 },
    queueLength: { max: 0, mean: 0 },
    resourceWait: { max: 0, mean, min: 0, sd: 0, total: mean },
    started: 1,
  };
}

const resourceMetrics = (utilization: number): ResourceMetrics => ({
  busyTime: 0,
  fixedCost: 0,
  totalCost: 0,
  unitCost: 0,
  utilization,
});

function syntheticResult(
  mean: number,
  resources: Record<string, ResourceMetrics> = {},
  replications?: ReplicationSummary,
  elementId = 'A',
): RunResult {
  return {
    bottlenecks: [],
    elements: { [elementId]: elementMetrics(mean) },
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
    ...(replications === undefined ? {} : { replications }),
    resources,
    warnings: [],
  };
}

const fakeIr = (nodeId = 'A'): ProcessIR => ({
  flows: {},
  id: 'Process_Fake',
  name: '',
  nodes: { [nodeId]: { incoming: [], name: 'Tarea A', outgoing: [], type: 'task' } },
  source: { exporter: 'test', exporterVersion: '1', originalIds: {}, warnings: [] },
});

/** Fila de recurso por id y etiqueta, con sus celdas ya en texto. */
function resourceRow(source: string, id: string): { html: string; cells: string[] } {
  const tr = findRow(source, id, 'Utilization (%)');
  return { cells: cellsOf(tr).map(textOf), html: tr };
}

describe('CompareView QA: pools que no existen en todos los escenarios', () => {
  const comparacion = compare([
    syntheticResult(10, { solo_base: resourceMetrics(0.25) }),
    syntheticResult(10),
    syntheticResult(10, { solo_tercero: resourceMetrics(0.5) }),
  ]);
  const tresHtml = renderToStaticMarkup(
    <CompareView
      baseTimeUnit="s"
      comparison={comparacion}
      ir={fakeIr()}
      resourceNames={{ solo_base: 'Solo base', solo_tercero: 'Solo tercero' }}
      scenarioNames={['AS-IS', 'TO-BE', 'TO-BE plus']}
    />,
  );

  // Ataque 8: el pool que desaparece. La celda pasa de un número a un guion: es un cambio.
  test('un pool que solo existe en la base muestra guion y resalta en las demás columnas', () => {
    const { cells, html: tr } = resourceRow(tresHtml, 'solo_base');
    expect(cells.slice(0, 3)).toEqual(['solo_base', 'Solo base', 'Utilization (%)']);
    expect(cells.slice(3)).toEqual(['25%', '-', '-']);
    const celdas = cellsOf(tr);
    expect(celdas[4]).toContain(HIGHLIGHT);
    expect(celdas[5]).toContain(HIGHLIGHT);
  });

  // Ataque 9: el caso que el implementador dejó anotado como frágil en su propio test — `null`
  // en la base **y** en la columna comparada. Guion contra guion no es un cambio y no se resalta.
  test('`null` en la base y en la columna comparada no resalta; solo resalta donde sí hay valor', () => {
    const fila = comparacion.rows.find((r) => r.kpi === 'resources.solo_tercero.utilization')!;
    expect([fila.values[0], fila.values[1]]).toEqual([null, null]);

    const { cells, html: tr } = resourceRow(tresHtml, 'solo_tercero');
    expect(cells.slice(3)).toEqual(['-', '-', '50% (-)']);
    const celdas = cellsOf(tr);
    expect(celdas[3]).not.toContain(HIGHLIGHT); // base
    expect(celdas[4]).not.toContain(HIGHLIGHT); // guion contra guion: nada cambió a la vista
    expect(celdas[5]).toContain(HIGHLIGHT);
  });

  test('el nombre del pool sale del mapa fusionado aunque el escenario base no lo declare', () => {
    expect(resourceRow(tresHtml, 'solo_tercero').cells[1]).toBe('Solo tercero');
  });
});

describe('CompareView QA: significancia por columna', () => {
  const kpi = 'elements.A.resourceWait.mean';
  const summary = (low: number, high: number): ReplicationSummary => ({
    count: 30,
    kpis: { [kpi]: { ci95: [low, high], mean: (low + high) / 2, sd: 1 } },
  });
  const comparacion = compare([
    syntheticResult(10, {}, summary(9, 11)),
    syntheticResult(30, {}, summary(29, 31)), // disjunto de la base: significativo
    syntheticResult(20, {}, summary(10.5, 25)), // se solapa con la base: no significativo
  ]);
  const tresHtml = renderToStaticMarkup(
    <CompareView
      baseTimeUnit="s"
      comparison={comparacion}
      ir={fakeIr()}
      scenarioNames={['Uno', 'Dos', 'Tres']}
    />,
  );

  // Ataque 10: la marca `*` tiene que ir en la celda de la columna significativa y en ninguna otra.
  test('la marca `*` va solo en la columna cuyo IC95 es disjunto del de la base', () => {
    const fila = comparacion.rows.find((r) => r.kpi === kpi)!;
    expect(fila.significant).toEqual([false, true, false]);

    const celdas = cellsOf(findRow(tresHtml, 'A', 'Average time (waiting for resource)'));
    expect(celdas[3]).not.toContain(SIGNIFICANT);
    expect(celdas[4]).toContain(SIGNIFICANT);
    expect(celdas[5]).not.toContain(SIGNIFICANT);
    expect((tresHtml.match(/role="img"/g) ?? []).length).toBe(1);
    expect(textOf(celdas[4]!)).toBe('30 (+200%) *');
  });

  // Ataque 11: significancia y resaltado son independientes; una celda puede cambiar sin ser
  // significativa (y el resaltado no puede depender del IC95).
  test('la celda no significativa cambia igual y queda resaltada', () => {
    const celdas = cellsOf(findRow(tresHtml, 'A', 'Average time (waiting for resource)'));
    expect(celdas[5]).toContain(HIGHLIGHT);
    expect(textOf(celdas[5]!)).toBe('20 (+100%)');
  });
});

describe('CompareView QA: ids ajenos y ordenación', () => {
  // Ataque 12: un id no-NCName sanitizado por el importador lleva puntos escapados en el path del
  // KPI (`elements.Task\.A.started`); la tabla tiene que mostrar el id crudo, que es la clave.
  test('un id con punto se muestra sin el escape del path de KPI', () => {
    const comparacion = compare([syntheticResult(10, {}, undefined, 'Task.A'), syntheticResult(20, {}, undefined, 'Task.A')]);
    expect(comparacion.rows.some((row) => row.kpi.includes('Task\\.A'))).toBe(true);
    expect(comparacion.rows.every((row) => row.scope !== 'elements' || row.id === 'Task.A')).toBe(true);

    const conPunto = renderToStaticMarkup(
      <CompareView
        baseTimeUnit="s"
        comparison={comparacion}
        ir={fakeIr('Task.A')}
        scenarioNames={['AS-IS', 'TO-BE']}
      />,
    );
    expect(cellsOf(findRow(conPunto, 'Task.A', 'Instances started')).map(textOf).slice(0, 2)).toEqual([
      'Task.A',
      'Tarea A',
    ]);
  });

  // Ataque 13: ordenar por la columna `Metric` tiene que ordenar por lo que se ve (la etiqueta
  // Bizagi), no por el path interno: "Average time" está bajo `processing.mean`.
  test('ordenar por `Metric` ordena por la etiqueta mostrada', () => {
    const comparacion = compare([syntheticResult(10), syntheticResult(20)]);
    const filas = visibleCompareRows(comparacion.rows, 'elements', false);
    const columnas = compareColumns('elements', fakeIr(), {}, ['AS-IS', 'TO-BE'], () => true, 's');

    const ordenadas = sortRows<CompareRow>(filas, columnas, { dir: 'asc', key: 'metric' });
    const etiquetas = ordenadas.map((row) => compareMetricLabel(row.scope, row.metric));
    expect(etiquetas).toEqual([...etiquetas].sort((a, b) => a.localeCompare(b, 'es')));
  });
});

describe('CompareView QA: columnas ocultas y un solo resultado', () => {
  // Ataque 14: al ocultar un escenario intermedio, el que queda no puede empezar a compararse
  // contra su vecino visible: la base es siempre `values[0]` (RESULTS_FORMAT §11).
  test('ocultar el escenario del medio no cambia contra quién se mide el delta', () => {
    const comparacion = compare([syntheticResult(10), syntheticResult(30), syntheticResult(20)]);
    const filas = visibleCompareRows(comparacion.rows, 'elements', false);
    const columnas = compareColumns(
      'elements',
      fakeIr(),
      {},
      ['Uno', 'Dos', 'Tres'],
      (index) => index !== 1,
      's',
    );
    expect(columnas.map((column) => column.key)).toEqual(['id', 'name', 'metric', 'scenario-0', 'scenario-2']);

    const parcial = renderToStaticMarkup(
      <DataTable columns={columnas} rowKey={(row) => row.kpi} rows={filas} title="Elementos" />,
    );
    const celdas = cellsOf(findRow(parcial, 'A', 'Average time (waiting for resource)'));
    expect(celdas).toHaveLength(5);
    expect(textOf(celdas[4]!)).toBe('20 (+100%)'); // contra 10, la base, no contra 30.
    expect(celdas[4]).toContain(HIGHLIGHT);
    expect(parcial).not.toContain('>Dos<');
  });

  // Ataque 15: `compare([un solo resultado])` es válido (RESULTS_FORMAT §11) y la vista no puede
  // resaltar nada ni inventar una columna de delta.
  test('un solo escenario: solo la columna base, sin resaltados ni marcas', () => {
    const unico = renderToStaticMarkup(
      <CompareView baseTimeUnit="s" comparison={compare([syntheticResult(10)])} ir={fakeIr()} scenarioNames={['Solo']} />,
    );
    expect(unico).toContain('Solo (base)');
    expect(unico).not.toContain(HIGHLIGHT);
    expect(unico).not.toContain(SIGNIFICANT);
    expect(cellsOf(findRow(unico, 'A', 'Average time (waiting for resource)')).map(textOf)).toEqual([
      'A',
      'Tarea A',
      'Average time (waiting for resource)',
      '10',
    ]);
  });
});
