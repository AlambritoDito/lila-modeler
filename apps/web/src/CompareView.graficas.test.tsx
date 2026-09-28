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

import { CompareView, compareCharts, compareMetricLabel } from './CompareView';
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
