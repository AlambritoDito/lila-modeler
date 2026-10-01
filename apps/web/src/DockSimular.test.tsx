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
import { formatNumber } from '@lila-modeler/engine/format';
import { resolveExtends, type ResolvedScenario } from '@lila-modeler/engine/schema';
import { simulate, type ProcessIR, type RunResult } from '@lila-modeler/engine';

import { DockSimular, FILAS_LOG, filasRapidas, PESTANAS_DOCK, type DockSimularProps, type PestanaDock } from './DockSimular';
import type { LogDeCorrida } from './GraficasResultados';
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
    expect(celdas[0]).toBe(formatNumber(result.process.completed));
    const costo = tareas.reduce((suma, id) => suma + result.elements[id]!.fixedCostTotal, 0);
    expect(celdas[4]).toBe(formatNumber(costo));
    // The scenario KPIs head the dock.
    expect(container.querySelector('.dock-kpis')!.textContent).toContain(S.dock.kpis.completados);
    expect(container.querySelector('.dock-kpis')!.textContent).toContain(formatNumber(result.process.totalCost));
  });

  test('per-task wait percentiles come from the log, utilization is the busiest pool used', () => {
    const { filas } = filasRapidas(ir, result, log);
    for (const fila of filas) {
      const esperas = [...new Map(log.rows.filter((r) => r.elementId === fila.id && r.startedAt !== null)
        .map((r) => [`${r.replication}|${r.activityInstanceId}`, r.resourceWait])).values()].sort((a, b) => a - b);
      if (esperas.length === 0) { expect(fila.esperaP50).toBeNull(); continue; }
      expect(fila.esperaP95).toBeGreaterThanOrEqual(fila.esperaP50!);
      expect(fila.esperaP95).toBeLessThanOrEqual(esperas.at(-1)!);
      expect(fila.casos).toBe(result.elements[fila.id]!.completed);
    }
    // The engine ranks bottlenecks with the same utilization (busiest pool the element used).
    for (const cuello of result.bottlenecks) {
      expect(filas.find((f) => f.id === cuello.elementId)?.utilizacion).toBeCloseTo(cuello.utilization, 12);
    }
  });

  test('without a log the percentiles are absent, never zero', () => {
    const { filas } = filasRapidas(ir, result, undefined);
    expect(filas.every((f) => f.esperaP50 === null && f.esperaP95 === null)).toBe(true);
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

  test('the warnings tab joins the run warnings and the scenario problems, and counts them', async () => {
    await montar({ inicial: 'avisos', avisos: [{ mensaje: 'E-ESCENARIO: falta algo', severidad: 'error' }] });
    const items = [...container.querySelectorAll('.dock-avisos li')].map((li) => li.textContent);
    expect(items).toEqual([...result.warnings, 'E-ESCENARIO: falta algo']);
    expect(container.querySelector('.dock-avisos li.error')!.textContent).toBe('E-ESCENARIO: falta algo');
    expect(tabs()[3]!.textContent).toBe(`${S.dock.pestanas.avisos} (${items.length})`);
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
