// @vitest-environment jsdom
/**
 * The Simulate dock (#394) over a real engine run with a fixed seed (`examples/pedido`, AS-IS,
 * three days, one replication): the quick results table and its total row, the bottleneck that
 * picks its element, the ARIA tabs by keyboard, the run log and the warnings.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';

import { parseBpmn } from '@lila-modeler/engine/bpmn';
import { elementsCsv } from '@lila-modeler/engine/csv';
import { formatNumber, type BaseTimeUnit } from '@lila-modeler/engine/format';
import { resolveExtends, type ResolvedScenario } from '@lila-modeler/engine/schema';
import { simulate, type ProcessIR, type RunResult } from '@lila-modeler/engine';

import { DockSimular, FILAS_LOG, filasRapidas, PESTANAS_DOCK, type DockSimularProps, type PestanaDock } from './DockSimular';
import type { LogDeCorrida } from './GraficasResultados';
import { agruparAvisos } from './avisos';
import { ESPERA_RECURSO, percentilesPorElemento } from './percentilesPorElemento';
import { exactDuration, formatDisplayDuration, formatDisplayDurationWithUnit } from './formatDisplay';
import { setLocale, strings } from './i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setLocale('en');
const S = strings();

const HERE = dirname(fileURLToPath(import.meta.url));
const PEDIDO = resolve(HERE, '../../../examples/pedido');
const leer = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

let ir: ProcessIR;
let scenario: ResolvedScenario;
let result: RunResult;
let log: LogDeCorrida;

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(PEDIDO, 'model.bpmn'), 'utf8'))).ir;
  const base = resolveExtends(resolve(PEDIDO, 'as-is.scenario.json'), leer) as unknown as ResolvedScenario;
  scenario = { ...base, run: { ...base.run, duration: 3 * 86_400, replications: 1, seed: 42 } };
  result = simulate(ir, scenario as never);
  log = { rows: result.log!, truncated: false };
}, 60_000);

let root: Root | null = null;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
});

type Extra = Partial<Omit<DockSimularProps, 'pestana' | 'onPestana'>> & { inicial?: PestanaDock };
/** The dock with its tab held in state, as `App.tsx` does. */
function Dock({ inicial = 'rapidos', ...props }: Extra): React.JSX.Element {
  const [pestana, setPestana] = useState<PestanaDock>(inicial);
  return (
    <DockSimular id="dock" ir={ir} corrida={{ result, scenario }} log={log} avisos={[]} onSeleccionar={() => {}}
      onAbrirResultados={() => {}} onEjecutar={() => {}} puedeEjecutar {...props} pestana={pestana} onPestana={setPestana} />
  );
}
async function montar(props: Extra = {}): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<Dock {...props} />));
}
const tabs = (): HTMLButtonElement[] => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const seleccionada = (): string => tabs().find((t) => t.getAttribute('aria-selected') === 'true')!.textContent!;
const boton = (texto: string): HTMLButtonElement => [...container.querySelectorAll('button')].find((b) => b.textContent === texto)!;
async function tecla(key: string): Promise<void> {
  await act(async () => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
}

describe('quick results (#394)', () => {
  test('one row per task and a total row with the process figures', async () => {
    await montar();
    const tabla = container.querySelector('table.dock-rapidos')!;
    const tareas = Object.keys(result.elements).filter((id) => ir.nodes[id]?.type === 'task');
    expect(tareas.length).toBeGreaterThan(0);
    expect(tabla.querySelectorAll('tbody tr')).toHaveLength(tareas.length);
    const total = tabla.querySelector('tfoot tr')!;
    expect(total.querySelector('th')!.textContent).toBe(S.dock.total);
    const celdas = [...total.querySelectorAll('td')].map((td) => td.textContent);
    // Cases and fixed cost only: the process wait per case is another quantity (QA of #394).
    // Whole cases (a mean over replications reads as a count).
    expect(celdas).toEqual([formatNumber(Math.round(result.process.completed)), '—', '—', '—',
      formatNumber(Math.round(tareas.reduce((suma, id) => suma + result.elements[id]!.fixedCostTotal, 0) * 100) / 100)]);
    expect(tabla.querySelectorAll('thead th')[5]!.textContent).toBe(S.dock.columnas.costo);
    // The mean wait column is the engine's, the same figure as the Results view.
    const primera = tabla.querySelector('tbody tr')!;
    const id = tareas[0]!;
    const media = primera.querySelectorAll('td')[1]!;
    const unidad = scenario.run.baseTimeUnit as BaseTimeUnit;
    expect(media.title).toBe(exactDuration(result.elements[id]!.resourceWait.mean, unidad));
    // Shown like the Results tables: two decimals, hours from an hour on (QA of #585).
    expect(media.textContent).toBe(formatDisplayDuration(result.elements[id]!.resourceWait.mean, unidad));
    // A wait of an hour or more reads in hours here too, not in minutes only (QA of #585).
    const largas = [...tabla.querySelectorAll('tbody tr')].filter((tr) => {
      const tarea = tareas.find((t) => (ir.nodes[t]?.name || t) === tr.querySelector('th')!.textContent);
      return tarea !== undefined && result.elements[tarea]!.resourceWait.mean >= 3600;
    });
    expect(largas.length).toBeGreaterThan(0);
    for (const tr of largas) expect(tr.querySelectorAll('td')[1]!.textContent).toMatch(/^[\d.]+ h \([\d.]+ min\)$/);
    // The note says which population each wait column covers.
    expect(container.querySelector('.dock-nota')!.textContent).toBe(S.dock.notaPercentiles(log.rows.length));
    // The scenario KPIs head the dock, rounded, with the exact value as the title.
    const kpis = container.querySelector('.dock-kpis')!;
    expect(kpis.textContent).toContain(S.dock.kpis.completados);
    const costo = [...kpis.querySelectorAll('dd')].find((dd) => dd.title.startsWith(formatNumber(result.process.totalCost)))!;
    expect(costo.textContent).toBe(`${formatNumber(Math.round(result.process.totalCost * 100) / 100)} ${scenario.run.currency}`);
    // The mean cycle reads like Results, with the unit in the title (costuras QA of Lote L).
    const ciclo = [...kpis.querySelectorAll('div')].find((d) => d.querySelector('dt')!.textContent === S.dock.kpis.cicloMedio)!.querySelector('dd')!;
    expect(ciclo.textContent).toBe(formatDisplayDurationWithUnit(result.process.cycleTime.mean, unidad));
    expect(ciclo.title).toBe(exactDuration(result.process.cycleTime.mean, unidad));
  });

  test('a truncated log hides the p95 column and the note says why, the quick view\'s rule', async () => {
    await montar({ log: { rows: log.rows, truncated: true } });
    expect(container.querySelector('.dock-nota')!.textContent).toContain(S.dock.muestraParcial(log.rows.length));
    // No p95 column at all, header and cells (total row included).
    const tabla = container.querySelector('table.dock-rapidos')!;
    expect([...tabla.querySelectorAll('thead th')].map((t) => t.textContent)).not.toContain(S.dock.columnas.esperaP95(scenario.run.baseTimeUnit as BaseTimeUnit));
    expect(tabla.querySelectorAll('thead th')).toHaveLength(5);
    expect(tabla.querySelectorAll('tfoot td')).toHaveLength(4);
    expect(filasRapidas(ir, result, scenario, { rows: log.rows, truncated: true }).filas.every((f) => f.esperaP95 === null)).toBe(true);
  });

  test('the main bottleneck heads the dock and picks its element, without changing tab', async () => {
    const seleccionar = vi.fn();
    await montar({ onSeleccionar: seleccionar });
    const cuello = result.bottlenecks[0]!;
    const boton = container.querySelector<HTMLButtonElement>('.dock-cuello button')!;
    expect(boton.textContent).toContain(ir.nodes[cuello.elementId]!.name);
    expect(boton.textContent).toContain(`${Math.round(cuello.utilization * 100)}%`);
    await act(async () => boton.click());
    expect(seleccionar).toHaveBeenCalledWith(cuello.elementId);
    expect(seleccionada()).toBe(S.dock.pestanas.rapidos);
  });

  test('the end of a run is announced in a status region, and the tablist has its own name', async () => {
    await montar();
    expect(container.querySelector('[role="status"]')!.textContent).toBe(S.dock.corridaTerminada(formatNumber(Math.round(result.process.completed))));
    expect(container.querySelector('[role="tablist"]')!.getAttribute('aria-label')).not.toBe(container.querySelector('section')!.getAttribute('aria-label'));
  });

  test('the p95 is the shared per-element percentile of the same wait, utilization the busiest pool used', () => {
    const { filas } = filasRapidas(ir, result, scenario, log);
    const compartido = percentilesPorElemento(log.rows, [0.95], { warmup: scenario.run.warmup, medida: ESPERA_RECURSO });
    for (const fila of filas) {
      expect(fila.esperaP95).toBe(compartido.get(fila.id)?.[0] ?? null);
      expect(fila.esperaMedia).toBe(result.elements[fila.id]!.resourceWait.mean);
      expect(fila.casos).toBe(result.elements[fila.id]!.completed);
    }
    expect(filas.some((f) => f.esperaP95 !== null)).toBe(true);
    // The engine ranks bottlenecks with the same utilization (busiest pool the element used).
    for (const cuello of result.bottlenecks) {
      expect(filas.find((f) => f.id === cuello.elementId)?.utilizacion).toBeCloseTo(cuello.utilization, 12);
    }
  });

  test('without a log the percentiles are absent, never zero', () => {
    const { filas } = filasRapidas(ir, result, scenario, undefined);
    expect(filas.every((f) => f.esperaP95 === null && f.esperaMedia !== null)).toBe(true);
  });

  test('Export CSV downloads the elements table, byte for byte the engine one', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { blobs.push(b); return 'blob:x'; }, revokeObjectURL: () => {} });
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await montar();
    await act(async () => boton(S.dock.exportarCsv).click());
    expect(clic).toHaveBeenCalledOnce();
    expect(await blobs[0]!.text()).toBe(elementsCsv(ir, result));
    clic.mockRestore();
  });

  test('Open in Results calls back', async () => {
    const abrir = vi.fn();
    await montar({ onAbrirResultados: abrir });
    await act(async () => boton(S.dock.abrirResultados).click());
    expect(abrir).toHaveBeenCalledOnce();
  });
});

describe('tabs (#394)', () => {
  test('arrows, Home and End move between the tabs and the focus follows', async () => {
    await montar();
    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    tabs()[0]!.focus();
    await tecla('ArrowRight');
    expect(seleccionada()).toBe(S.dock.pestanas.cuellos);
    expect(document.activeElement).toBe(tabs()[1]);
    await tecla('End');
    expect(document.activeElement).toBe(tabs()[3]);
    await tecla('ArrowRight');
    expect(seleccionada()).toBe(S.dock.pestanas.rapidos);
    await tecla('ArrowLeft');
    expect(document.activeElement!.id).toBe('dock-tab-avisos');
    await tecla('Home');
    expect(seleccionada()).toBe(S.dock.pestanas.rapidos);
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe('dock-tab-rapidos');
    expect(panel.getAttribute('tabindex')).toBe('0');
    expect(PESTANAS_DOCK).toHaveLength(4);
  });

  test('picking a bottleneck selects its element', async () => {
    expect(result.bottlenecks.length).toBeGreaterThan(0);
    const seleccionar = vi.fn();
    await montar({ inicial: 'cuellos', onSeleccionar: seleccionar });
    const primero = container.querySelector<HTMLButtonElement>('[role="tabpanel"] ol button')!;
    expect(primero.textContent).toBe(ir.nodes[result.bottlenecks[0]!.elementId]?.name || result.bottlenecks[0]!.elementId);
    await act(async () => primero.click());
    expect(seleccionar).toHaveBeenCalledWith(result.bottlenecks[0]!.elementId);
  });

  test('the run log lists the rows, at most FILAS_LOG, and says when the sample was cut', async () => {
    await montar({ inicial: 'log', log: { rows: log.rows, truncated: true } });
    const filas = container.querySelectorAll('table.dock-log tbody tr');
    expect(filas.length).toBe(Math.min(FILAS_LOG, log.rows.length));
    expect(container.textContent).toContain(S.dock.logTruncado(log.rows.length));
  });

  test('the warnings tab groups by code, drops the lint the run already says, and counts the groups', async () => {
    const warnings = ['W-TAREA-SIN-TIEMPO: Task_A: no processingTime (30 times)', 'W-MSGFLOW: ignored', 'W-TAREA-SIN-TIEMPO: Task_A: no processingTime (28 times)',
      'W-ELEMENTO-SIN-PARAMETROS: the element has no parameters (elements.Task_A).'];
    await montar({ inicial: 'avisos', corrida: { result: { ...result, warnings }, scenario },
      avisos: [{ mensaje: 'the element has no parameters', severidad: 'warning' }, { mensaje: 'E-ESCENARIO: falta algo', severidad: 'error' }] });
    const items = [...container.querySelectorAll('.dock-avisos > li')];
    expect(items.map((li) => li.firstChild!.textContent)).toEqual([warnings[0], warnings[1], warnings[3], 'E-ESCENARIO: falta algo']);
    expect(items[0]!.querySelector('summary')!.textContent).toBe(S.dock.ocurrencias(2));
    expect(items[0]!.querySelector('details li')!.textContent).toBe(warnings[2]);
    expect(items[3]!.className).toBe('error');
    expect(tabs()[3]!.textContent).toBe(`${S.dock.pestanas.avisos} (4)`);
  });

  test('agruparAvisos keeps two subjects of the same code apart, wherever the subject sits (QA of #394)', () => {
    const grupos = agruparAvisos([
      { mensaje: 'W-TAREA-SIN-TIEMPO: Task_A: no processingTime (30 times)', severidad: 'warning' },
      { mensaje: 'W-TAREA-SIN-TIEMPO: Task_B: no processingTime (12 times)', severidad: 'warning' },
      { mensaje: 'W-TAREA-SIN-TIEMPO: Task_A: no processingTime (28 times)', severidad: 'warning' },
    ]);
    expect(grupos.map((g) => [g.codigo, g.mensajes.length])).toEqual([['W-TAREA-SIN-TIEMPO', 2], ['W-TAREA-SIN-TIEMPO', 1]]);
    expect(grupos[1]!.mensajes[0]).toContain('Task_B');
    // Scenario warnings carry the element at the end; ids with digits are not numbers.
    const alFinal = agruparAvisos([
      { mensaje: 'W-ELEMENTO-SIN-PARAMETROS: the element has no parameters (elements.Task_1).', severidad: 'warning' },
      { mensaje: 'W-ELEMENTO-SIN-PARAMETROS: the element has no parameters (elements.Task_2).', severidad: 'warning' },
    ]);
    expect(alFinal).toHaveLength(2);
  });

  test('agruparAvisos keeps the first-seen order and promotes a group to error', () => {
    // A message with no subject segment groups by its code alone.
    expect(agruparAvisos([{ mensaje: 'W-X: a', severidad: 'warning' }, { mensaje: 'sin código', severidad: 'warning' }, { mensaje: 'W-X: a', severidad: 'error' }]))
      .toEqual([{ codigo: 'W-X', clave: 'W-X: a', severidad: 'error', mensajes: ['W-X: a', 'W-X: a'] }, { codigo: 'sin código', clave: 'sin código', severidad: 'warning', mensajes: ['sin código'] }]);
  });

  test('without a run: an invitation to run, and the actions are disabled', async () => {
    const ejecutar = vi.fn();
    await montar({ corrida: null, onEjecutar: ejecutar });
    expect(container.textContent).toContain(S.dock.vacio);
    expect(container.querySelector('.dock-kpis')).toBeNull();
    expect(boton(S.dock.abrirResultados).disabled).toBe(true);
    expect(boton(S.dock.exportarCsv).disabled).toBe(true);
    await act(async () => boton(S.dock.ejecutar).click());
    expect(ejecutar).toHaveBeenCalledOnce();
  });
});
