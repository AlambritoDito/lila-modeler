/**
 * Charts of a run (#636): the data functions moved from the app's `graficas.ts`, and `chartsSvg`,
 * which draws the app's Results charts as plain SVG for the process document. The app checks that
 * its own document charts carry the same titles and values (`GraficasResultados.engine.test.tsx`).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn } from '../src/bpmn/index.js';
import {
  barGeometry,
  chartsSvg,
  formatDisplay,
  formatDisplayDuration,
  histogram,
  instancesByTask,
  legendRows,
  nothingMeasured,
  processPercentiles,
  roundStep,
  scale,
  ticksThatFit,
  utilizationByResource,
} from '../src/charts.js';
import type { ProcessIR } from '../src/core/ir.js';
import type { RunResult } from '../src/core/result.js';
import { simulate } from '../src/core/run.js';
import { resolveExtends, type ResolvedScenario } from '../src/scenario.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PEDIDO = resolve(HERE, '../../../examples/pedido');
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

let ir: ProcessIR;
let scenario: ResolvedScenario;
let result: RunResult;
let cycleTimes: number[] = [];

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(PEDIDO, 'model.bpmn'), 'utf8'))).ir;
  const full = resolveExtends(resolve(PEDIDO, 'as-is.scenario.json'), read) as unknown as ResolvedScenario;
  scenario = { ...full, run: { ...full.run, duration: 3 * 86_400, replications: 1, seed: 42 } } as ResolvedScenario;
  result = simulate(ir, scenario as never, { log: false, onCycleTimes: (_, times) => (cycleTimes = times) });
}, 60_000);

const titleOf = (chart: { alt: string }): string => chart.alt.split('. ')[0]!;

describe('chart data (moved from the app)', () => {
  test('utilization in % in the order of the Resources table; instances of tasks only', () => {
    expect(utilizationByResource(result, { Cashier: 'Till' })).toEqual(
      Object.entries(result.resources).map(([id, m]) => ({ id, label: id === 'Cashier' ? 'Till' : id, value: m.utilization * 100 })),
    );
    const instances = instancesByTask(ir, result);
    expect(instances.length).toBeGreaterThan(0);
    for (const point of instances) {
      expect(ir.nodes[point.id]!.type).toBe('task');
      expect(point.value).toBe(result.elements[point.id]!.started);
    }
  });

  test('percentiles are absent, not zero, when no case completed', () => {
    expect(processPercentiles(result)!.cycle).toEqual([result.process.cycleTime.p50, result.process.cycleTime.p90, result.process.cycleTime.p95]);
    expect(processPercentiles({ ...result, process: { ...result.process, completed: 0 } } as RunResult)).toBeNull();
  });

  test('axis, classes and display numbers', () => {
    expect(roundStep(0.3)).toBe(0.5);
    expect(scale(87)).toEqual({ top: 100, ticks: [0, 20, 40, 60, 80, 100] });
    expect(scale(0).top).toBe(1);
    expect(histogram([])).toEqual([]);
    expect(histogram([4, 4, 4])).toEqual([{ from: 4, to: 4, cases: 3 }]);
    expect(histogram(cycleTimes).reduce((a, c) => a + c.cases, 0)).toBe(result.process.completed);
    expect(formatDisplay(1.23456)).toBe('1.23');
    expect(formatDisplay(0.004158)).toBe('0.0042');
    expect(formatDisplayDuration(11_700, 'min', { s: 's', min: 'min', h: 'h', day: 'd' })).toBe('3.25 h (195 min)');
    expect(ticksThatFit([0, 500, 1000, 1500], 24 / 500)).toEqual([0, 1000]);
    expect(legendRows(['a', 'b'], 640).map((e) => e.row)).toEqual([0, 0]);
    expect(barGeometry([{ label: 'x', texts: ['1'] }], 640).plotWidth).toBeGreaterThan(40);
  });
});

describe('chartsSvg', () => {
  test('the app’s order: utilization, percentiles, histogram (with per-case times), instances', () => {
    expect(chartsSvg({ ir, scenario, result }).map(titleOf)).toEqual([
      'Utilization by resource (%)',
      'Cycle and wait time percentiles (min)',
      'Instances started by task',
    ]);
    const withTimes = chartsSvg({ ir, scenario, result, cycleTimes });
    expect(withTimes.map(titleOf)).toEqual([
      'Utilization by resource (%)',
      'Cycle and wait time percentiles (min)',
      'Cycle time per case (min)',
      'Instances started by task',
    ]);
    expect(withTimes[2]!.svg).toContain(`>${cycleTimes.length} completed cases</text>`);
  });

  test('every value of the chart data is in the alt text and at a bar tip, as the table shows it', () => {
    const [utilization, percentiles, instances] = chartsSvg({ ir, scenario, result });
    const names = Object.fromEntries(Object.entries(scenario.resources ?? {}).map(([id, r]) => [id, r.name ?? id]));
    for (const point of utilizationByResource(result, names)) {
      expect(utilization!.alt).toContain(`${point.label}: ${formatDisplay(point.value!)}`);
      expect(utilization!.svg).toContain(`>${formatDisplay(point.value!)}</text>`);
    }
    for (const point of instancesByTask(ir, result)) expect(instances!.alt).toContain(`${point.label}: ${formatDisplay(point.value!)}`);
    const short = { s: 's', min: 'min', h: 'h', day: 'd' } as const;
    const data = processPercentiles(result)!;
    expect(percentiles!.alt).toContain(
      `p95: Cycle time: ${formatDisplayDuration(data.cycle[2]!, 'min', short)}, Wait time: ${formatDisplayDuration(data.wait[2]!, 'min', short)}`,
    );
  });

  test('standalone SVG: one root, a title and a description, escaped text, no ids', () => {
    const named = { ...ir, nodes: { ...ir.nodes } };
    const task = Object.keys(named.nodes).find((id) => named.nodes[id]!.type === 'task')!;
    named.nodes[task] = { ...named.nodes[task]!, name: 'Pack <a> & "b"' };
    const charts = chartsSvg({ ir: named, scenario, result });
    for (const { svg } of charts) {
      expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" role="img" ')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg.match(/<svg/g)).toHaveLength(1);
      expect(svg).toMatch(/<title>[^<]+<\/title><desc>[^<]*<\/desc>/);
      expect(svg).not.toMatch(/\sid="/);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    }
    const instances = charts.at(-1)!;
    expect(instances.svg).toContain('Pack &lt;a&gt; &amp; &quot;b&quot;');
    expect(instances.alt).toContain('Pack <a> & "b"');
  });

  test('same input, same bytes', () => {
    expect(chartsSvg({ ir, scenario, result, cycleTimes })).toEqual(chartsSvg({ ir, scenario, result, cycleTimes }));
  });

  test('nothing measured: only what is not a zero of the warm-up; Spanish titles', () => {
    const empty = { ...result, process: { ...result.process, started: 0, completed: 0 } } as RunResult;
    const warm = { ...scenario, run: { ...scenario.run, warmup: 3600 } } as ResolvedScenario;
    expect(nothingMeasured(empty, 3600)).toBe(true);
    expect(chartsSvg({ ir, scenario: warm, result: empty })).toEqual([]);
    expect(chartsSvg({ ir, scenario, result, locale: 'es' }).map(titleOf)).toEqual([
      'Utilización por recurso (%)',
      'Percentiles de tiempo de ciclo y de espera (min)',
      'Instancias iniciadas por tarea',
    ]);
  });
});
