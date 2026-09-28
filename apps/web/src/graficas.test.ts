/**
 * Chart data of #460: the pure part. The rows each chart draws are compared with the rows of its
 * table in `ResultsView.graficas.test.tsx`; here, the histogram classes over a real run and over a
 * very large sample, and the axis and class helpers on edge cases.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn } from '@lila-modeler/engine/bpmn';
import { resolveExtends } from '@lila-modeler/engine/schema';
import { simulate, type RunResult, type SimScenario } from '@lila-modeler/engine';

import { escala, histograma, pasoRedondo, percentilesDelProceso, SERIES_CLARO, SERIES_OSCURO, sinVentana } from './graficas';

const HERE = dirname(fileURLToPath(import.meta.url));
const PEDIDO = resolve(HERE, '../../../examples/pedido');
const leer = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

let result: RunResult;
let ciclos: number[] = [];

beforeAll(async () => {
  const { ir } = await parseBpmn(readFileSync(resolve(PEDIDO, 'model.bpmn'), 'utf8'));
  const scenario = resolveExtends(resolve(PEDIDO, 'as-is.scenario.json'), leer) as unknown as SimScenario;
  // Three days, one replication, fixed seed; the per-case sample comes from the engine itself.
  const corto = { ...scenario, run: { ...scenario.run, duration: 3 * 86_400, replications: 1, seed: 42 } };
  result = simulate(ir, corto, { log: false, onCycleTimes: (_, times) => (ciclos = times) });
}, 60_000);

describe('histograma (#460)', () => {
  test('the engine’s per-case sample: the classes add up to the completed cases', () => {
    const clases = histograma(ciclos);
    expect(clases.length).toBeGreaterThanOrEqual(5);
    expect(clases.reduce((a, c) => a + c.casos, 0)).toBe(result.process.completed);
    for (const [i, c] of clases.entries()) if (i > 0) expect(c.desde).toBeCloseTo(clases[i - 1]!.hasta, 9);
  });

  test('200 000 values (a year of one arrival a minute) do not overflow the stack', () => {
    const valores = Array.from({ length: 200_000 }, (_, i) => (i * 7919) % 10_007);
    const clases = histograma(valores);
    expect(clases.reduce((a, c) => a + c.casos, 0)).toBe(200_000);
    expect(clases[0]!.desde).toBeLessThanOrEqual(0);
    expect(clases.at(-1)!.hasta).toBeGreaterThan(10_006);
  });
});

describe('missing is not zero (#460)', () => {
  test('no completed case: no percentiles to chart, instead of a row of zeros', () => {
    const vacio = { ...result, process: { ...result.process, completed: 0 } } as RunResult;
    expect(percentilesDelProceso(vacio)).toBeNull();
    expect(percentilesDelProceso(result)!.ciclo).toEqual([
      result.process.cycleTime.p50,
      result.process.cycleTime.p90,
      result.process.cycleTime.p95,
    ]);
  });

  test('no values, no classes; one distinct value, one class', () => {
    expect(histograma([])).toEqual([]);
    expect(histograma([4, 4, 4])).toEqual([{ desde: 4, hasta: 4, casos: 3 }]);
  });
});

describe('the warm-up swallowed the run', () => {
  test('nothing started and a warm-up: nothing measured; no warm-up, a real zero', () => {
    const nada = { ...result, process: { ...result.process, started: 0 } } as RunResult;
    expect(sinVentana(nada, 3600)).toBe(true);
    expect(sinVentana(nada, 0)).toBe(false);
    expect(sinVentana(result, 3600)).toBe(false);
  });
});

describe('axis helpers', () => {
  test('round steps and a top that covers the maximum', () => {
    expect(pasoRedondo(0.3)).toBe(0.5);
    expect(pasoRedondo(7)).toBe(10);
    expect(pasoRedondo(2)).toBe(2);
    expect(escala(87)).toEqual({ tope: 100, marcas: [0, 20, 40, 60, 80, 100] });
    expect(escala(0).tope).toBe(1);
    expect(escala(42, 100)).toEqual({ tope: 100, marcas: [0, 20, 40, 60, 80, 100] });
  });
});

describe('palette', () => {
  test('graficas.css declares the same eight slots per mode as the paper palette', () => {
    const css = readFileSync(resolve(HERE, 'graficas.css'), 'utf8').toLowerCase();
    const slots = (bloque: string): string[] => [...bloque.matchAll(/--serie-\d: (#[0-9a-f]{6})/g)].map((m) => m[1]!);
    const [oscuro, claro] = css.split("[data-esquema='claro']");
    expect(slots(oscuro!)).toEqual([...SERIES_OSCURO]);
    expect(slots(claro!)).toEqual([...SERIES_CLARO]);
  });
});
