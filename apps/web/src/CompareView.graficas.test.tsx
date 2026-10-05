// @vitest-environment jsdom
/**
 * Acceptance of #460 in Compare, over real engine runs with a fixed seed (`examples/pedido`:
 * AS-IS, TO-BE 3 cashiers and a copy of AS-IS, three days, one replication each):
 *
 * (a) each bar shows exactly the text of its table cell (value and delta against the base), and
 *     its length is the table's value;
 * (b) a value the table shows as absent is no bar, not a zero one; costs in different currencies
 *     are not charted;
 * and a hidden scenario keeps the other scenarios' colors (color follows the scenario).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn } from '@lila-modeler/engine/bpmn';
import { SECONDS_PER_UNIT, formatNumber } from '@lila-modeler/engine/format';
import { resolveExtends } from '@lila-modeler/engine/schema';
import { compare, simulate, type CompareResult, type ProcessIR, type SimScenario } from '@lila-modeler/engine';

import { CompareView, compareCharts, compareMetricLabel, type CompareChartsInput } from './CompareView';
import { renderToStaticMarkup } from 'react-dom/server';
import { filasLeyenda, geometriaBarras, marcasQueCaben, PLOT_MINIMO, SvgBarras } from './GraficasSvg';
import { tabLabels } from './ResultsView';
import { setLocale, strings } from './i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setLocale('en');

const HERE = dirname(fileURLToPath(import.meta.url));
const PEDIDO = resolve(HERE, '../../../examples/pedido');
const leer = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
const NOMBRES = ['AS-IS', 'TO-BE 3 cashiers', 'AS-IS copy'];
const RECURSOS = { cajero: 'Cashier', cocinero: 'Cook', horno: 'Oven' };

let ir: ProcessIR;
let comparison: CompareResult;

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(PEDIDO, 'model.bpmn'), 'utf8'))).ir;
  const corto = (file: string): SimScenario => {
    const s = resolveExtends(resolve(PEDIDO, file), leer) as unknown as SimScenario;
    return { ...s, run: { ...s.run, duration: 3 * 86_400, replications: 1, seed: 42 } };
  };
  const [asIs, toBe] = [corto('as-is.scenario.json'), corto('to-be-3-cajeros.scenario.json')];
  comparison = compare([asIs, toBe, asIs].map((s) => simulate(ir, s, { log: false })));
}, 60_000);

let root: Root | null = null;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

async function montar(c: CompareResult = comparison): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(<CompareView ir={ir} comparison={c} scenarioNames={NOMBRES} baseTimeUnit="min" resourceNames={RECURSOS} />),
  );
}

/** The rows of the table titled `titulo`, as arrays of cell text (the significance mark dropped). */
function filas(titulo: string): string[][] {
  const seccion = [...container!.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === titulo)!;
  return [...seccion.querySelectorAll('tbody tr')].map((tr) =>
    [...tr.querySelectorAll('td')].map((td) => td.textContent!.replace(` ${strings().comparar.asterisco}`, '')),
  );
}

/** Bars of the chart titled `titulo`: per group, the texts and `data-valor` of each series. */
function grafica(titulo: string): { textos: string[]; valores: string[]; colores: string[] }[] {
  const svg = [...container!.querySelectorAll('[data-grafica="comparar"] svg')].find((s) => s.querySelector('title')?.textContent === titulo)!;
  return [...svg.querySelectorAll('g[data-grupo]')].map((g) => {
    const marcas = [...g.querySelectorAll('g.marca')];
    return {
      textos: marcas.map((m) => m.querySelector('text.valor')!.textContent!),
      valores: marcas.map((m) => m.getAttribute('data-valor')!),
      colores: marcas.map((m) => m.querySelector('path.barra')?.getAttribute('fill') ?? ''),
    };
  });
}

describe('(a) each compare bar is its table cell', () => {
  test('cycle time average and cost per case: the Process table cells, value and delta', async () => {
    await montar();
    const proceso = filas(tabLabels().process);
    for (const [metric, titulo] of [
      ['cycleTime.mean', strings().graficas.compararCiclo('min')],
      ['costPerCase', strings().graficas.compararCosto],
    ] as const) {
      const celdas = proceso.find((f) => f[0] === compareMetricLabel('process', metric))!.slice(1);
      const [barras] = grafica(titulo);
      expect(barras!.textos).toEqual(celdas);
      expect(barras!.textos[1]).toMatch(/\(([+-]\d|0%)/); // the delta is visible
      const fila = comparison.rows.find((r) => r.scope === 'process' && r.metric === metric)!;
      const escala = metric === 'cycleTime.mean' ? SECONDS_PER_UNIT.min : 1;
      expect(barras!.valores).toEqual(fila.values.map((v) => String(v! / escala)));
    }
  });

  test('utilization: one group per pool, the Resources table cells', async () => {
    await montar();
    const recursos = filas(tabLabels().resources).filter((f) => f[2] === compareMetricLabel('resources', 'utilization'));
    const grupos = grafica(strings().graficas.compararUtilizacion);
    expect(grupos).toHaveLength(recursos.length);
    grupos.forEach((g, i) => {
      expect(g.textos).toEqual(recursos[i]!.slice(3));
      // Bar labels are the cells' text: two decimals at most (#578); the values stay exact.
      for (const t of g.textos) expect(t).not.toMatch(/\d\.(?!00)\d{3,}/);
      expect(g.valores.map((v) => formatNumber(Number(v)))).toEqual(
        comparison.rows.filter((r) => r.scope === 'resources' && r.metric === 'utilization')[i]!.values.map((v) => formatNumber(v! * 100)),
      );
    });
  });

  test('a hidden scenario leaves the others their colors', async () => {
    await montar();
    expect(grafica(strings().graficas.compararCiclo('min'))[0]!.colores).toEqual(['var(--serie-1)', 'var(--serie-2)', 'var(--serie-3)']);
    const casilla = container!.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!;
    await act(async () => casilla.click());
    expect(grafica(strings().graficas.compararCiclo('min'))[0]!.colores).toEqual(['var(--serie-1)', 'var(--serie-3)']);
  });
});

describe('(b) absent is not zero', () => {
  test('a pool missing in the base is no bar, with the table’s dash', async () => {
    const rows = comparison.rows.map((r) =>
      r.scope === 'resources' && r.id === 'cajero' && r.metric === 'utilization'
        ? { ...r, values: [null, ...r.values.slice(1)], deltaAbs: r.deltaAbs.map(() => null), deltaRel: r.deltaRel.map(() => null) }
        : r,
    );
    await montar({ ...comparison, rows });
    const [cajero] = grafica(strings().graficas.compararUtilizacion);
    expect(cajero!.valores[0]).toBe('');
    expect(cajero!.colores[0]).toBe('');
    expect(cajero!.textos[0]).toBe(strings().comparar.sinValor);
  });

  test('costs in different currencies are not charted, and say so', () => {
    const { graficas, notas } = compareCharts({
      rows: comparison.rows,
      ir,
      resourceNames: RECURSOS,
      scenarioNames: NOMBRES,
      isVisible: () => true,
      baseTimeUnit: 'min',
      costsComparable: false,
    });
    expect(graficas.map((g) => g.titulo)).not.toContain(strings().graficas.compararCosto);
    expect(notas).toContain(strings().graficas.compararCostoNoComparable);
  });

  test('no rows, no charts and no empty frame', () => {
    const { graficas, notas } = compareCharts({
      rows: [],
      ir,
      resourceNames: {},
      scenarioNames: NOMBRES,
      isVisible: () => true,
      baseTimeUnit: 'min',
      costsComparable: true,
    });
    expect(graficas).toEqual([]);
    expect(notas).toEqual([]);
  });
});

describe('legend and colors (QA of #512)', () => {
  const base: CompareChartsInput = {
    rows: [],
    ir: {} as ProcessIR,
    resourceNames: {},
    scenarioNames: [],
    isVisible: () => true,
    baseTimeUnit: 'min',
    costsComparable: true,
  };

  test.each([
    [Array.from({ length: 10 }, (_, i) => `Esc ${i}`), 469],
    [['Base: AS-IS actual (base)', 'TO-BE con 3 cajeros', 'TO-BE horno doble'], 357],
    [['A scenario name far longer than any chart could ever hold on one line'], 280],
  ])('the legend wraps into rows and never passes the chart width (%#)', (nombres, ancho) => {
    const entradas = filasLeyenda(nombres, ancho);
    // 7 px per character is above the real average advance of the UI font at 12 px.
    for (const e of entradas) expect(e.x + 14 + e.texto.length * 7).toBeLessThanOrEqual(ancho);
    expect(entradas.map((e) => e.fila).every((f, i, all) => i === 0 || f >= all[i - 1]!)).toBe(true);
  });

  test('the first 8 visible scenarios are charted, and the note counts the visible ones', () => {
    const nombres = Array.from({ length: 10 }, (_, i) => `Esc ${i}`);
    const ocultos = new Set([2, 3, 4, 5]);
    const seis = compareCharts({ ...base, rows: comparison.rows, scenarioNames: nombres, isVisible: (i) => !ocultos.has(i) });
    expect(seis.notas).toEqual([]);
    const nueve = compareCharts({ ...base, rows: comparison.rows, scenarioNames: nombres, isVisible: (i) => i !== 4 });
    expect(nueve.graficas[0]!.series).toEqual(['Esc 0 (base)', 'Esc 1', 'Esc 2', 'Esc 3', 'Esc 5', 'Esc 6', 'Esc 7', 'Esc 8']);
    expect(nueve.notas).toEqual([strings().graficas.compararDemasiados(9)]);
  });

  test('colors follow the scenario’s own slot, so changing the base does not repaint', () => {
    const tres = { ...base, rows: comparison.rows, scenarioNames: NOMBRES };
    expect(compareCharts({ ...tres, seriesSlots: [0, 1, 2] }).graficas[0]!.colores).toEqual([0, 1, 2]);
    // TO-BE becomes the base: it moves to index 0 but keeps its slot 1.
    expect(compareCharts({ ...tres, seriesSlots: [1, 0, 2] }).graficas[0]!.colores).toEqual([1, 0, 2]);
    // Slots that do not fit the palette fall back to the position among the charted ones.
    expect(compareCharts({ ...tres, seriesSlots: [0, 9, 2] }).graficas[0]!.colores).toEqual([0, 1, 2]);
  });
});

describe('x axis ticks never collide (second QA pass of #512)', () => {
  const textos = (n: number): string[] => Array.from({ length: n }, (_, i) => (i === 0 ? '1174.463784' : `${930.847019 + i} (-20.741678%)`));

  test.each([3, 10])('%i scenarios at 357 px: tick labels keep 8 px apart', (n) => {
    const nombres = Array.from({ length: n }, (_, i) => `Scenario ${i}`);
    const html = renderToStaticMarkup(
      <SvgBarras
        titulo="t"
        series={nombres.slice(0, 8)}
        grupos={[{ id: 'g', etiqueta: 'Cycle time average', valores: textos(Math.min(n, 8)).map((t) => Number.parseFloat(t)), textos: textos(Math.min(n, 8)) }]}
        ancho={357}
      />,
    );
    const marcas = [...html.matchAll(/<text class="marca-eje" x="([\d.]+)"[^>]*>([^<]+)</g)].map((m) => ({ x: Number(m[1]), texto: m[2]! }));
    expect(marcas.length).toBeGreaterThanOrEqual(2);
    // 7 px per 12 px character, scaled to the 11 px of the axis: above the real advance.
    const ancho = (t: string): number => (t.length * 7 * 11) / 12;
    for (let i = 1; i < marcas.length; i++) {
      const [a, b] = [marcas[i - 1]!, marcas[i]!];
      expect(b.x - a.x - (ancho(a.texto) + ancho(b.texto)) / 2).toBeGreaterThanOrEqual(8);
    }
  });

  test('marcasQueCaben keeps every tick when there is room, and thins them from 0 when not', () => {
    expect(marcasQueCaben([0, 500, 1000, 1500], 1)).toEqual([0, 500, 1000, 1500]);
    expect(marcasQueCaben([0, 500, 1000, 1500], 24 / 500)).toEqual([0, 1000]);
  });

  test('the two small charts go full width when half the section leaves the plot under the minimum', async () => {
    await montar();
    const fila = container!.querySelector('[data-grafica="comparar"] [data-juntas]')!;
    const [ciclo] = compareCharts({
      rows: comparison.rows, ir, resourceNames: RECURSOS, scenarioNames: NOMBRES, isVisible: () => true, baseTimeUnit: 'min', costsComparable: true,
    }).graficas;
    // jsdom measures nothing, so the section is the default 640 px: half of it is too narrow here.
    expect(geometriaBarras(ciclo!.grupos, (640 - 12) / 2).anchoPlot).toBeLessThan(PLOT_MINIMO);
    expect(fila.getAttribute('data-juntas')).toBe('false');
    expect(fila.classList.contains('graficas-fila')).toBe(false);
    expect(geometriaBarras(ciclo!.grupos, 900).anchoPlot).toBeGreaterThanOrEqual(PLOT_MINIMO);
  });
});
