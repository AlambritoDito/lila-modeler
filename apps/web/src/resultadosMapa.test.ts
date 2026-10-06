/**
 * Lote M, C5: the pure parts of Results on the map and of Compare, over a real engine run of
 * `examples/pedido` (AS-IS and TO-BE 3 cashiers, three days, one replication, seed 42): the six
 * KPIs, their deltas, the heat map, the wait differences per task and the scenario order of #581.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseBpmn } from '@lila-modeler/engine/bpmn';
import { resolveExtends, type ResolvedScenario } from '@lila-modeler/engine/schema';
import { simulate, type ProcessIR, type RunResult } from '@lila-modeler/engine';
import { deltasDeEspera, modeloCalor, overlayModel } from './BottleneckOverlay';
import { kpisDe, KPI_IDS, utilizacionMaxima } from './PanelResumen';
import { deltasKpi } from './VistaComparar';
import { ordenarEscenarios } from './SelectorEscenario';
import { formatDisplayDurationWithUnit } from './formatDisplay';
import { setLocale, strings } from './i18n';

setLocale('en');
const S = strings();
const PEDIDO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/pedido');
const leer = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

let ir: ProcessIR;
let tareas: string[];
const corridas: Record<'asIs' | 'toBe', { result: RunResult; scenario: ResolvedScenario; originalIds: Record<string, string> }> = {} as never;

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(PEDIDO, 'model.bpmn'), 'utf8'))).ir;
  tareas = Object.keys(ir.nodes).filter((id) => ir.nodes[id]!.type === 'task');
  for (const [clave, archivo] of [['asIs', 'as-is.scenario.json'], ['toBe', 'to-be-3-cajeros.scenario.json']] as const) {
    const base = resolveExtends(resolve(PEDIDO, archivo), leer) as unknown as ResolvedScenario;
    const scenario = { ...base, run: { ...base.run, duration: 3 * 86_400, replications: 1, seed: 42 } };
    corridas[clave] = { result: simulate(ir, scenario as never), scenario, originalIds: {} };
  }
}, 60_000);

describe('the six KPIs (design 05)', () => {
  it('read the engine as it is, with «In progress at the end» from inFlight', () => {
    const { result, scenario } = corridas.asIs;
    const kpis = kpisDe(result, scenario);
    expect(kpis.map((k) => k.id)).toEqual([...KPI_IDS]);
    const por = Object.fromEntries(kpis.map((k) => [k.id, k]));
    expect(por['ciclo']!.valor).toBe(result.process.cycleTime.mean);
    expect(por['ciclo']!.texto).toBe(formatDisplayDurationWithUnit(result.process.cycleTime.mean, scenario.run.baseTimeUnit));
    expect(por['espera']!.valor).toBe(result.process.waitTime.mean);
    expect(por['completados']!.valor).toBe(result.process.completed);
    expect(por['completados']!.menosEsMejor).toBe(false);
    expect(por['costoCaso']!.texto).toContain(scenario.run.currency ?? '');
    expect(por['utilMax']!.valor).toBe(utilizacionMaxima(result));
    expect(por['enCurso']!.valor).toBe(result.process.inFlight);
    // Two decimals at most.
    for (const k of kpis) expect(k.texto).not.toMatch(/\.\d{3,}/);
  });
});

describe('Compare (design 06)', () => {
  it('a run against itself changes nothing', () => {
    expect(deltasKpi(corridas.asIs, corridas.asIs).every((d) => d.estado === 'igual')).toBe(true);
  });

  it('three cashiers instead of one: better is green, worse red, the same text «no change»', () => {
    const deltas = deltasKpi(corridas.asIs, corridas.toBe);
    expect(deltas.some((d) => d.estado !== 'igual')).toBe(true);
    for (const d of deltas) {
      const diff = d.kpi.valor - d.ref.valor;
      if (d.kpi.texto === d.ref.texto || diff === 0) { expect(d.estado, d.kpi.id).toBe('igual'); continue; }
      expect(d.estado, d.kpi.id).toBe((d.kpi.menosEsMejor ? diff < 0 : diff > 0) ? 'mejora' : 'empeora');
      expect(d.fraccion, d.kpi.id).toBeCloseTo(diff / Math.abs(d.ref.valor), 12);
    }
    // Swapping the sides swaps the verdicts.
    const vuelta = deltasKpi(corridas.toBe, corridas.asIs);
    deltas.forEach((d, i) => { if (d.estado !== 'igual') expect(vuelta[i]!.estado).not.toBe(d.estado); });
  });

  it('the wait difference per task is signed, coloured and skips what rounds to zero', () => {
    const deltas = deltasDeEspera(corridas.asIs.result, corridas.toBe.result, tareas, 'min');
    expect(Object.keys(deltas).length).toBeGreaterThan(0);
    for (const [id, x] of Object.entries(deltas)) {
      const diff = corridas.toBe.result.elements[id]!.resourceWait.mean - corridas.asIs.result.elements[id]!.resourceWait.mean;
      expect(x.mejora).toBe(diff < 0);
      expect(x.texto.startsWith(diff < 0 ? '−' : '+')).toBe(true);
    }
    expect(deltasDeEspera(corridas.asIs.result, corridas.asIs.result, tareas, 'min')).toEqual({});
  });
});

describe('the heat map (design 05)', () => {
  it('tints every task that started, with a «Wait …» badge, and nothing else', () => {
    const calor = modeloCalor(corridas.asIs.result, corridas.asIs.scenario, tareas);
    const empezadas = tareas.filter((id) => corridas.asIs.result.elements[id]!.started > 0);
    expect(Object.keys(calor).sort()).toEqual(empezadas.sort());
    for (const e of Object.values(calor)) expect(e.etiqueta.startsWith(S.c5.mapa.espera(''))).toBe(true);
    // The bottleneck marks are the engine's ranking cut, unchanged.
    const corte = Object.keys(overlayModel(corridas.asIs.result, corridas.asIs.scenario));
    expect(corte.every((id) => corridas.asIs.result.bottlenecks.some((b) => b.elementId === id))).toBe(true);
  });
});

describe('the scenario order after reopening (#581)', () => {
  it('each base first, followed by what extends it; broken chains keep their place at the end', () => {
    const orden = ordenarEscenarios({
      'as-is (copy).scenario.json': { extends: 'as-is.scenario.json' },
      'as-is.scenario.json': {},
      'b.scenario.json': {},
      'huerfano.scenario.json': { extends: 'nadie.scenario.json' },
      'nieto.scenario.json': { extends: 'as-is (copy).scenario.json' },
      'x.scenario.json': { extends: 'y.scenario.json' },
      'y.scenario.json': { extends: 'x.scenario.json' },
    });
    expect(Object.keys(orden)).toEqual([
      'as-is.scenario.json', 'as-is (copy).scenario.json', 'nieto.scenario.json', 'b.scenario.json',
      'huerfano.scenario.json', 'x.scenario.json', 'y.scenario.json',
    ]);
  });
});
