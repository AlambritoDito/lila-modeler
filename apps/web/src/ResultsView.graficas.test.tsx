// @vitest-environment jsdom
/**
 * Acceptance of #460 in Results, over a real engine run with a fixed seed (`examples/pedido`,
 * AS-IS, three days, one replication):
 *
 * (a) every chart shows the same values as its table — read from the rendered DOM, the table's
 *     cells against the text at each bar's tip and its `data-valor`;
 * (b) with nothing to draw (no pools, no completed case, no per-case times, all in the warm-up) the chart
 *     says so instead of drawing zeros, and nothing throws;
 * (c) the process document gets the charts of the run as standalone SVG in paper colors.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn } from '@lila-modeler/engine/bpmn';
import { columnLabel, formatNumber } from '@lila-modeler/engine/format';
import { resolveExtends, type ResolvedScenario } from '@lila-modeler/engine/schema';
import { simulate, type ProcessIR, type RunResult } from '@lila-modeler/engine';

import { graficasDelDocumento, type LogDeCorrida } from './GraficasResultados';
import { ResultsView, tabLabels } from './ResultsView';
import { setLocale, strings } from './i18n';
import { SERIES_CLARO } from './graficas';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setLocale('en');

const HERE = dirname(fileURLToPath(import.meta.url));
const PEDIDO = resolve(HERE, '../../../examples/pedido');
const leer = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

let ir: ProcessIR;
let scenario: ResolvedScenario;
let result: RunResult;
let ciclos: number[] = [];
let log: LogDeCorrida;

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(PEDIDO, 'model.bpmn'), 'utf8'))).ir;
  const base = resolveExtends(resolve(PEDIDO, 'as-is.scenario.json'), leer) as unknown as ResolvedScenario;
  scenario = { ...base, run: { ...base.run, duration: 3 * 86_400, replications: 1, seed: 42 } };
  result = simulate(ir, scenario as never, { onCycleTimes: (_, times) => (ciclos = times) });
  log = { rows: result.log!, truncated: false, ciclos };
}, 60_000);

let root: Root | null = null;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

async function montar(props: Partial<Parameters<typeof ResultsView>[0]> = {}): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(<ResultsView ir={ir} scenario={scenario} result={result} log={log} {...props} />),
  );
}

async function pestana(tab: 'elements' | 'resources' | 'process'): Promise<void> {
  const boton = [...container.querySelectorAll('button')].find((b) => b.textContent === tabLabels()[tab])!;
  await act(async () => boton.click());
}

/** The first table on screen as `{ header: cell text }` rows. */
function tabla(): Record<string, string>[] {
  const t = container.querySelector('table')!;
  const headers = [...t.querySelectorAll('thead th')].map((th) => th.textContent!.replace(/ [▲▼]$/, ''));
  return [...t.querySelectorAll('tbody tr')].map((tr) =>
    Object.fromEntries([...tr.querySelectorAll('td')].map((td, i) => [headers[i]!, td.textContent!])),
  );
}

/** The bars of one chart: group id, series index, `data-valor` and the text at the bar's tip. */
function barras(grafica: string): { grupo: string; serie: number; valor: string; texto: string }[] {
  return [...container.querySelectorAll(`[data-grafica="${grafica}"] g[data-grupo]`)].flatMap((g) =>
    [...g.querySelectorAll('g.marca')].map((m) => ({
      grupo: g.getAttribute('data-grupo')!,
      serie: Number(m.getAttribute('data-serie')),
      valor: m.getAttribute('data-valor')!,
      texto: m.querySelector('text.valor')!.textContent!,
    })),
  );
}

const unidad = (etiqueta: string): string => strings().resultados.columnaConUnidad(etiqueta, 'min');

describe('(a) each chart shows the values of its table', () => {
  test('Elements: instances started per task', async () => {
    await montar();
    const filas = tabla();
    const tareas = filas.filter((f) => f[strings().resultados.columnas.type] === 'task');
    const grafica = barras('instancias');
    expect(grafica.map((b) => b.grupo)).toEqual(tareas.map((f) => f.Id));
    for (const b of grafica) {
      const fila = tareas.find((f) => f.Id === b.grupo)!;
      expect(b.texto).toBe(fila[columnLabel('elements', 'started')]);
      expect(formatNumber(Number(b.valor))).toBe(b.texto);
    }
  });

  test('Resources: utilization per pool', async () => {
    await montar();
    await pestana('resources');
    const filas = tabla();
    const grafica = barras('utilizacion');
    expect(filas.length).toBeGreaterThan(0);
    expect(grafica.map((b) => b.grupo)).toEqual(filas.map((f) => f.Id));
    for (const b of grafica) {
      const texto = filas.find((f) => f.Id === b.grupo)![columnLabel('resources', 'utilization')];
      expect(b.texto).toBe(texto);
      expect(formatNumber(Number(b.valor))).toBe(texto);
    }
  });

  test('Process: cycle and wait time p50/p90/p95, and the histogram adds up to the completed cases', async () => {
    await montar();
    await pestana('process');
    const [fila] = tabla();
    const grafica = barras('percentiles');
    expect(grafica).toHaveLength(6);
    for (const b of grafica) {
      const metrica = `${b.serie === 0 ? 'cycleTime' : 'waitTime'}.${b.grupo}`;
      expect(b.texto).toBe(fila![unidad(columnLabel('process', metrica))]);
      expect(formatNumber(Number(b.valor))).toBe(b.texto);
    }
    const clases = [...container.querySelectorAll('[data-grafica="histograma"] g.marca')];
    expect(clases.length).toBeGreaterThanOrEqual(5);
    const casos = clases.reduce((suma, c) => suma + Number(c.getAttribute('data-valor')), 0);
    expect(String(casos)).toBe(fila![columnLabel('process', 'completed')]);
    // Its data table lists the same classes.
    const datos = [...container.querySelectorAll('[data-grafica="histograma"] details tbody tr')];
    expect(datos.map((tr) => tr.lastElementChild!.textContent)).toEqual(clases.map((c) => c.getAttribute('data-valor')));
  });

  test('every chart is an accessible image: title plus a description that lists the values', async () => {
    await montar();
    await pestana('resources');
    const svg = container.querySelector('[data-grafica="utilizacion"] svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    const texto = (atributo: string): string => svg.querySelector(`[id="${svg.getAttribute(atributo)}"]`)!.textContent!;
    // The name is the title; the values are the description, not part of the name.
    const [titulo, desc] = [texto('aria-labelledby'), texto('aria-describedby')];
    expect(titulo).toBe(strings().graficas.utilizacion);
    for (const b of barras('utilizacion')) expect(desc).toContain(b.texto);
  });
});

describe('(b) nothing to draw is said, not drawn as zero', () => {
  test('no pools, no completed case, no event log', async () => {
    const vacio: RunResult = { ...result, resources: {}, process: { ...result.process, completed: 0 } };
    await montar({ result: vacio, log: undefined });
    await pestana('resources');
    expect(container.querySelector('[data-grafica="utilizacion"] svg')).toBeNull();
    expect(container.querySelector('[data-grafica="utilizacion"]')!.textContent).toBe(strings().graficas.sinDatos);
    await pestana('process');
    expect(container.querySelector('[data-grafica="percentiles"] svg')).toBeNull();
    expect(container.querySelector('[data-grafica="percentiles"]')!.textContent).toBe(strings().graficas.sinCompletados);
    expect(container.querySelector('[data-grafica="histograma"]')!.textContent).toBe(strings().graficas.histogramaSinLog);
  });

  test('a log without the per-case times, or with none completed, gets its note', async () => {
    await montar({ log: { rows: result.log!, truncated: false } });
    await pestana('process');
    expect(container.querySelector('[data-grafica="histograma"]')!.textContent).toBe(strings().graficas.histogramaSinLog);
    act(() => root!.unmount());
    container.remove();
    await montar({ log: { rows: [], truncated: false, ciclos: [] } });
    await pestana('process');
    expect(container.querySelector('[data-grafica="histograma"]')!.textContent).toBe(strings().graficas.histogramaSinCasos);
  });

  test('the per-case times do not depend on the log sample: a truncated one still gets its histogram', async () => {
    await montar({ log: { rows: result.log!.slice(0, 10), truncated: true, ciclos } });
    await pestana('process');
    const clases = [...container.querySelectorAll('[data-grafica="histograma"] g.marca')];
    expect(clases.reduce((suma, c) => suma + Number(c.getAttribute('data-valor')), 0)).toBe(result.process.completed);
  });

  test('200 000 cases draw a histogram, not a blank screen', async () => {
    const muchos = Array.from({ length: 200_000 }, (_, i) => 60 + ((i * 7919) % 10_007));
    await montar({ log: { rows: [], truncated: true, ciclos: muchos } });
    await pestana('process');
    const clases = [...container.querySelectorAll('[data-grafica="histograma"] g.marca')];
    expect(clases.reduce((suma, c) => suma + Number(c.getAttribute('data-valor')), 0)).toBe(200_000);
  });

  test('a chart that throws becomes a note; the tables and the other charts stay', async () => {
    const roto = new Proxy([1, 2, 3], {
      get(target, key) {
        if (key === 'map') throw new Error('boom');
        return Reflect.get(target, key);
      },
    });
    await montar({ log: { rows: [], truncated: false, ciclos: roto } });
    await pestana('process');
    expect(container.querySelector('[data-grafica="histograma"]')!.textContent).toBe(strings().graficas.error);
    expect(container.querySelector('[data-grafica="percentiles"] svg')).not.toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
  });

  test('everything inside the warm-up: a note, not charts of measured zeros', async () => {
    const nada: RunResult = { ...result, process: { ...result.process, started: 0, completed: 0 } };
    await montar({ result: nada, scenario: { ...scenario, run: { ...scenario.run, warmup: 3600 } } });
    expect(container.querySelector('[data-grafica="instancias"]')!.textContent).toBe(strings().graficas.sinVentana);
    await pestana('resources');
    expect(container.querySelector('[data-grafica="utilizacion"]')!.textContent).toBe(strings().graficas.sinVentana);
  });

  test('a task never reached is a real zero: a bar of length 0 labelled 0, not a missing one', async () => {
    const [id] = Object.keys(result.elements).filter((e) => ir.nodes[e]?.type === 'task');
    const conCero: RunResult = { ...result, elements: { ...result.elements, [id!]: { ...result.elements[id!]!, started: 0 } } };
    await montar({ result: conCero });
    const barra = barras('instancias').find((b) => b.grupo === id)!;
    expect(barra).toMatchObject({ valor: '0', texto: '0' });
  });
});

describe('(c) the process document gets the charts of the run', () => {
  test('four charts as standalone SVG in paper colors, each with an alt text that carries its values', () => {
    let graficas: ReturnType<typeof graficasDelDocumento> = [];
    act(() => {
      graficas = graficasDelDocumento({ ir, scenario, result, log });
    });
    expect(graficas).toHaveLength(4);
    for (const { svg, alt } of graficas) {
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(svg).not.toContain('var(');
      expect(svg).toContain(SERIES_CLARO[0]);
      expect(alt.length).toBeGreaterThan(20);
    }
    expect(graficas[0]!.alt).toContain(strings().graficas.utilizacion);
    const doc = new DOMParser().parseFromString(graficas[0]!.svg, 'image/svg+xml');
    expect(doc.querySelector('parsererror')).toBeNull();
  });

  test('a chart that fails is left out and the document keeps the others', () => {
    const roto = new Proxy([1, 2, 3], {
      get(target, key) {
        if (key === 'map') throw new Error('boom');
        return Reflect.get(target, key);
      },
    });
    let graficas: ReturnType<typeof graficasDelDocumento> = [];
    act(() => {
      graficas = graficasDelDocumento({ ir, scenario, result, log: { rows: [], truncated: false, ciclos: roto } });
    });
    expect(graficas.map((g) => g.alt.split('. ')[0])).toEqual([
      strings().graficas.utilizacion,
      strings().graficas.percentiles('min'),
      strings().graficas.instancias,
    ]);
  });

  test('without pools, completed cases or log, only the charts that have something to draw', () => {
    const vacio: RunResult = { ...result, resources: {}, process: { ...result.process, completed: 0 } };
    let graficas: ReturnType<typeof graficasDelDocumento> = [];
    act(() => {
      graficas = graficasDelDocumento({ ir, scenario, result: vacio });
    });
    expect(graficas.map((g) => g.alt.split('. ')[0])).toEqual([strings().graficas.instancias]);
  });
});
