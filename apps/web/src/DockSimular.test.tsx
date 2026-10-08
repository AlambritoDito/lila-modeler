// @vitest-environment jsdom
/**
 * The results table under the Results map (Lote M; the Simulate dock of #394) over a real engine
 * run with a fixed seed (`examples/pedido`, AS-IS, three days, one replication): the Tasks table,
 * the collapse button, the exports, the ARIA tabs by keyboard, the run log and the warnings.
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

import { avisosDelDock, FILAS_LOG, filasTareas, PESTANAS_DOCK, TablaResultados, type AvisoDock, type PestanaDock, type TablaResultadosProps } from './DockSimular';
import { problemasEscenario } from './escenarioModelo';
import type { LogDeCorrida } from './GraficasResultados';
import { agruparAvisos } from './avisos';
import { exactDuration, formatDisplayDurationWithUnit } from './formatDisplay';
import { ESPERA_RECURSO, percentilesPorElemento } from './percentilesPorElemento';
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

type Extra = Partial<Omit<TablaResultadosProps, 'pestana' | 'onPestana' | 'plegada' | 'onPlegar'>> & { inicial?: PestanaDock };
/** The table with its tab and its collapsed state held in state, as `App.tsx` does. */
function Dock({ inicial = 'tareas', ...props }: Extra): React.JSX.Element {
  const [pestana, setPestana] = useState<PestanaDock>(inicial);
  const [plegada, setPlegada] = useState(false);
  return (
    <TablaResultados id="dock" ir={ir} corrida={{ result, scenario }} log={log} avisos={[]} onSeleccionar={() => {}}
      detalle={<p data-detalle>full</p>} {...props} pestana={pestana} onPestana={setPestana} plegada={plegada} onPlegar={() => setPlegada(!plegada)} />
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

describe('the Tasks tab (Lote M, design 05)', () => {
  test('one row per task with the seven columns of the design, in hours (minutes) and two decimals', async () => {
    await montar();
    const tabla = container.querySelector('table.c5-tareas')!;
    const tareas = Object.keys(ir.nodes).filter((id) => ir.nodes[id]!.type === 'task' && result.elements[id] !== undefined);
    expect(tareas.length).toBeGreaterThan(0);
    expect(tabla.querySelectorAll('tbody tr')).toHaveLength(tareas.length);
    const C = S.c5.tabla.columnas;
    expect([...tabla.querySelectorAll('thead th')].map((t) => t.textContent)).toEqual([C.tarea, C.recurso, C.casos, C.proceso, C.espera, C.esperaP95, C.utilizacion, C.costo]);
    const unidad = scenario.run.baseTimeUnit as BaseTimeUnit;
    const id = tareas[0]!;
    const espera = tabla.querySelector('tbody tr')!.querySelectorAll('td')[3]!;
    expect(espera.title).toBe(exactDuration(result.elements[id]!.resourceWait.mean, unidad));
    expect(espera.textContent).toBe(formatDisplayDurationWithUnit(result.elements[id]!.resourceWait.mean, unidad));
    // A wait of an hour or more reads «x h (y min)».
    const largas = [...tabla.querySelectorAll('tbody tr')].filter((tr, i) => result.elements[tareas[i]!]!.resourceWait.mean >= 3600);
    expect(largas.length).toBeGreaterThan(0);
    for (const tr of largas) expect(tr.querySelectorAll('td')[3]!.textContent).toMatch(/^[\d.]+ h \([\d.]+ min\)$/);
    expect(container.querySelector('.dock-nota')!.textContent).toBe(S.c5.tabla.notaCosto);
    expect(container.textContent).toContain(S.c5.tabla.notaPercentiles(log.rows.length));
    // The total row: cases and fixed cost only.
    const total = tabla.querySelector('tfoot tr')!;
    expect(total.querySelector('th')!.textContent).toBe(S.c5.tabla.total);
    const celdas = [...total.querySelectorAll('td')].map((td) => td.textContent);
    expect(celdas[1]).toBe(String(Math.round(result.process.completed * 100) / 100));
    expect(celdas.slice(2, 6)).toEqual(['—', '—', '—', '—']);
  });

  test('the p95 is the shared per-element percentile; a truncated or missing log hides its column and says why', async () => {
    const filas = filasTareas(ir, result, scenario, log);
    const compartido = percentilesPorElemento(log.rows, [0.95], { warmup: scenario.run.warmup, medida: ESPERA_RECURSO });
    for (const f of filas) expect(f.esperaP95).toBe(compartido.get(f.id)?.[0] ?? null);
    expect(filas.some((f) => f.esperaP95 !== null)).toBe(true);
    expect(filasTareas(ir, result, scenario, undefined).every((f) => f.esperaP95 === null)).toBe(true);
    await montar({ log: { rows: log.rows, truncated: true } });
    expect([...container.querySelectorAll('table.c5-tareas thead th')].map((t) => t.textContent)).not.toContain(S.c5.tabla.columnas.esperaP95);
    expect(container.textContent).toContain(S.c5.tabla.muestraParcial(log.rows.length));
  });

  test('resources and utilization come from the scenario, so a run without a log has them too', () => {
    const filas = filasTareas(ir, result, scenario);
    for (const f of filas) {
      const usos = (scenario.elements?.[f.id] as { resources?: { ref: string }[] } | undefined)?.resources ?? [];
      expect(f.recursos).toEqual(usos.map((u) => scenario.resources?.[u.ref]?.name ?? u.ref));
      expect(f.casos).toBe(result.elements[f.id]!.completed);
      expect(f.costo).toBe(result.elements[f.id]!.fixedCostTotal);
    }
    // The engine ranks bottlenecks with the utilization of the busiest pool the element uses.
    for (const cuello of result.bottlenecks) {
      expect(filas.find((f) => f.id === cuello.elementId)?.utilizacion).toBeCloseTo(cuello.utilization, 12);
    }
  });

  test('a task name picks it on the map', async () => {
    const seleccionar = vi.fn();
    await montar({ onSeleccionar: seleccionar });
    const primero = container.querySelector<HTMLButtonElement>('table.c5-tareas tbody button')!;
    await act(async () => primero.click());
    expect(seleccionar).toHaveBeenCalledWith(filasTareas(ir, result, scenario)[0]!.id);
  });

  test('the end of a run is announced in a status region, and the tablist has its own name', async () => {
    await montar();
    expect(container.querySelector('[role="status"]')!.textContent).toBe(S.dock.corridaTerminada(formatNumber(Math.round(result.process.completed))));
    expect(container.querySelector('[role="tablist"]')!.getAttribute('aria-label')).not.toBe(container.querySelector('section')!.getAttribute('aria-label'));
  });

  test('the collapse button keeps only the header, and a tab opens it again', async () => {
    await montar();
    const plegar = container.querySelector<HTMLButtonElement>('.c5-plegar')!;
    expect(plegar.getAttribute('aria-expanded')).toBe('true');
    await act(async () => plegar.click());
    expect(container.querySelector('[role="tabpanel"]')).toBeNull();
    expect(container.querySelector('.c5-plegar')!.getAttribute('aria-expanded')).toBe('false');
    await act(async () => tabs()[2]!.click());
    expect(container.querySelector('[role="tabpanel"]')).not.toBeNull();
    expect(seleccionada()).toBe(S.c5.tabla.pestanas.log);
  });

  test('«Full results» shows the Results view it is given', async () => {
    await montar({ inicial: 'detalle' });
    expect(container.querySelector('[data-detalle]')).not.toBeNull();
  });

  test('CSV downloads the elements table, byte for byte the engine one', async () => {
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', { createObjectURL: (b: Blob) => { blobs.push(b); return 'blob:x'; }, revokeObjectURL: () => {} });
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await montar();
    await act(async () => boton(S.c5.tabla.exportarCsv).click());
    expect(clic).toHaveBeenCalledOnce();
    expect(await blobs[0]!.text()).toBe(elementsCsv(ir, result));
    clic.mockRestore();
  });
});

describe('tabs (#394)', () => {
  test('arrows, Home and End move between the tabs and the focus follows', async () => {
    await montar();
    expect(tabs().map((t) => t.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1']);
    tabs()[0]!.focus();
    await tecla('ArrowRight');
    expect(seleccionada()).toBe(S.c5.tabla.pestanas.detalle);
    expect(document.activeElement).toBe(tabs()[1]);
    await tecla('End');
    expect(document.activeElement).toBe(tabs()[3]);
    await tecla('ArrowRight');
    expect(seleccionada()).toBe(S.c5.tabla.pestanas.tareas);
    await tecla('ArrowLeft');
    expect(document.activeElement!.id).toBe('dock-tab-avisos');
    await tecla('Home');
    expect(seleccionada()).toBe(S.c5.tabla.pestanas.tareas);
    const panel = container.querySelector('[role="tabpanel"]')!;
    expect(panel.getAttribute('aria-labelledby')).toBe('dock-tab-tareas');
    expect(panel.getAttribute('tabindex')).toBe('0');
    expect(PESTANAS_DOCK).toHaveLength(4);
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
    expect(tabs()[3]!.textContent).toBe(`${S.c5.tabla.pestanas.avisos} (4)`);
  });

  test('#554: after a language change the live lint still dedupes against the run, by code and path', async () => {
    // The run's scenario warnings as `prepareSimulation` copies them, in the language it ran in…
    const corridaEn = problemasEscenario(scenario, ir, 'en').filter((p) => p.severidad === 'warning');
    const warnings = corridaEn.map((p) => `${p.codigo}: ${p.mensaje}`);
    expect(warnings.some((w) => w.startsWith('W-ELEMENTO-SIN-PARAMETROS: ') && w.includes('(elements.Task_Empacar)'))).toBe(true);
    // …and the live lint after switching to Spanish, as `App.tsx` hands it to the table.
    const lintEs: AvisoDock[] = problemasEscenario(scenario, ir, 'es')
      .map((p) => ({ mensaje: p.mensaje, severidad: p.severidad, codigo: p.codigo, ruta: p.ruta }));
    expect(lintEs.length).toBe(warnings.length);
    expect(lintEs.every((a) => !warnings.some((w) => w.includes(a.mensaje)))).toBe(true);
    const grupos = avisosDelDock(warnings, lintEs);
    expect(grupos.map((g) => g.mensajes)).toEqual(warnings.map((w) => [w]));
    await montar({ inicial: 'avisos', corrida: { result: { ...result, warnings }, scenario }, avisos: lintEs });
    expect(tabs()[3]!.textContent).toBe(`${S.c5.tabla.pestanas.avisos} (${warnings.length})`);
    // The same code on another element is another problem: it is not swallowed.
    const otra: AvisoDock = { ...lintEs[0]!, mensaje: 'otra (elements.Task_Otra).', ruta: 'elements.Task_Otra' };
    expect(avisosDelDock(warnings, [...lintEs, otra])).toHaveLength(warnings.length + 1);
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

  test('without a run: it says how to get one, and the exports are disabled', async () => {
    await montar({ corrida: null });
    expect(container.textContent).toContain(S.dock.vacio);
    expect(boton(S.c5.tabla.exportarCsv).disabled).toBe(true);
    expect(boton(S.c5.tabla.exportarXlsx).disabled).toBe(true);
  });
});
