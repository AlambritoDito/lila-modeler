// @vitest-environment jsdom
/**
 * #396 — «Quick view · simulation» in the properties panel header.
 *
 * Two halves: `datosVistaRapida` (pure: the «Pedido» example's AS-IS scenario and a hand-made run)
 * and the block `PanelPropiedades` draws from it, with the «Edit in …» links. The `modelador` is
 * the minimum the panel reads, like `PropertiesPanel.cabecera.test.tsx`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { EventLogRow, ProcessIR, RunResult } from '@lila-modeler/engine';
import { parseBpmn } from '@lila-modeler/engine/bpmn';

import type { Modelador } from './Modeler.js';
import { PanelPropiedades, type ElementoLienzo } from './PropertiesPanel.js';
import { setLocale, strings } from './i18n';
import { datosVistaRapida, type VistaRapidaDatos } from './vistaRapida';

setLocale('en');
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let ir: ProcessIR;
let asIs: Record<string, unknown>;
beforeAll(async () => {
  const parsed = await parseBpmn(readFileSync(resolve(RAIZ, 'examples/pedido/model.bpmn'), 'utf8'));
  if (parsed.ir === undefined) throw new Error('the Pedido example does not parse');
  ir = parsed.ir;
  asIs = JSON.parse(readFileSync(resolve(RAIZ, 'examples/pedido/as-is.scenario.json'), 'utf8')) as Record<string, unknown>;
});

/** A run where Task_TomarPedido waited 2 min on average for a clerk, plus 1 min off hours. */
function corrida(): RunResult {
  const stat = (mean: number) => ({ min: 0, max: 0, mean, sd: 0, total: 0 });
  return {
    elements: { Task_TomarPedido: { resourceWait: stat(120), offHoursWait: stat(60) } },
  } as unknown as RunResult;
}

function fila(elementId: string, instancia: string, espera: number, status: EventLogRow['status'] = 'completed'): EventLogRow {
  return {
    replication: 0, caseId: instancia, activityInstanceId: instancia, elementId, resourceId: 'cajero',
    // Enabled right at the example's warmup (3600 s), so every case of this helper is measured.
    allocationIndex: 0, resourceQuantity: 1, status, enabledAt: 3600, startedAt: 3600 + espera, endedAt: 3601 + espera,
    observedUntil: 3601 + espera, resourceWait: espera, offHoursWait: 0, elementCost: 0, resourceCost: 0, cost: 0,
  };
}

describe('datosVistaRapida', () => {
  const S = () => strings();

  it('a task: its distribution in the base unit, its pool, and «no run» without a run', () => {
    const datos = datosVistaRapida({ id: 'Task_TomarPedido', ir, escenario: asIs, resultado: null, S: S() });
    // #554: the pool by the name the Resources step shows («Cashier»), not its key («cajero»).
    expect(datos).toEqual({ tiempo: 'Triangular 1 / 2 / 5 min', recurso: 'Cashier ×1', espera: null });
    expect(datosVistaRapida({ id: 'Task_Preparar', ir, escenario: asIs, resultado: null, S: S() })?.recurso).toBe('Cook ×1, Oven ×1');
  });

  it('#554: a pool without a name reads as its key, like the Resources step', () => {
    const recursos = asIs['resources'] as Record<string, Record<string, unknown>>;
    const sinNombre = { ...asIs, resources: { ...recursos, horno: { ...recursos['horno'], name: '  ' } } };
    expect(datosVistaRapida({ id: 'Task_Preparar', ir, escenario: sinNombre, resultado: null, S: S() })?.recurso).toBe('Cook ×1, horno ×1');
  });

  it('with a run but no log, the mean resource wait (off hours apart, as the dock and the canvas), flagged as not p95', () => {
    const datos = datosVistaRapida({ id: 'Task_TomarPedido', ir, escenario: asIs, resultado: corrida(), S: S() });
    // QA of #394: 2 min, not 3 — the off-hours minute is not a wait for a resource.
    expect(datos?.espera).toEqual({ texto: '2 min', p95: false });
  });

  it('with the log in memory, the p95 of the completed instances', () => {
    // Off-hours time on every row: the resource-wait p95 leaves it out (QA of #394).
    const rows = Array.from({ length: 21 }, (_, i) => ({ ...fila('Task_TomarPedido', `a${i}`, i * 60), offHoursWait: 3600 }));
    // An in-flight instance does not count, whatever it waited (RESULTS_FORMAT § 5).
    rows.push(fila('Task_TomarPedido', 'vuelo', 999_999, 'inFlight'));
    const datos = datosVistaRapida({
      id: 'Task_TomarPedido', ir, escenario: asIs, resultado: corrida(), log: { rows, truncated: false }, S: S(),
    });
    // 0, 1, …, 20 min: the 95th percentile is 19 min.
    expect(datos?.espera).toEqual({ texto: '19 min', p95: true });
    // A truncated log is a partial sample: back to the mean.
    const truncado = datosVistaRapida({
      id: 'Task_TomarPedido', ir, escenario: asIs, resultado: corrida(), log: { rows, truncated: true }, S: S(),
    });
    expect(truncado?.espera).toEqual({ texto: '2 min', p95: false });
  });

  it('a timer has a time and no resource row; events, flows and AND gateways have no quick view', () => {
    expect(datosVistaRapida({ id: 'Timer_Reposo', ir, escenario: asIs, resultado: null, S: S() }))
      .toEqual({ tiempo: 'Constant 10 min', recurso: null, espera: null });
    for (const id of ['Gateway_ANDFork', 'StartEvent_Pedido', 'Flow_Aprobado', 'Participant_Restaurante']) {
      expect(datosVistaRapida({ id, ir, escenario: asIs, resultado: null, S: S() }), id).toBeNull();
    }
  });

  it('a splitting gateway shows its route split (Lote M, C4)', () => {
    expect(datosVistaRapida({ id: 'Gateway_Aprobacion', ir, escenario: asIs, resultado: null, S: S() }))
      .toEqual({ tiempo: '', recurso: null, espera: null, rutas: { resumen: 'Approved 78 % · Rejected 22 %', cuadra: true } });
  });

  it('the gateway block links to Routes', () => {
    const { panel, onEditar } = montar({ tiempo: '', recurso: null, espera: null, rutas: { resumen: 'Approved 70 % · Rejected 22 %', cuadra: false } });
    const bloque = panel.querySelector('.vista-rapida')!;
    expect(bloque.textContent).toContain('Approved 70 % · Rejected 22 %');
    expect(bloque.querySelector('.vista-rapida-rutas.error')).not.toBeNull();
    const enlace = [...bloque.querySelectorAll('button')].find((b) => b.textContent === 'Edit the route split')!;
    act(() => { enlace.click(); });
    expect(onEditar).toHaveBeenCalledWith('routes');
  });

  it('a task with nothing written reads «—»; a broken scenario hides the block', () => {
    const datos = datosVistaRapida({ id: 'Task_Empacar', ir, escenario: asIs, resultado: null, S: S() });
    expect(datos).toEqual({ tiempo: '—', recurso: '—', espera: null });
    expect(datosVistaRapida({ id: 'Task_TomarPedido', ir, escenario: null, resultado: null, S: S() })).toBeNull();
  });

  it('a run without data for the element reads «—», not «no run»', () => {
    const vacia = { elements: {} } as unknown as RunResult;
    const datos = datosVistaRapida({ id: 'Task_TomarPedido', ir, escenario: asIs, resultado: vacia, S: S() });
    expect(datos?.espera).toEqual({ texto: '—', p95: false });
  });

  it('the p95 leaves out the cases that started before run.warmup, as the engine does', () => {
    // Case «pre» arrives at 0 (before a 3600 s warmup) and waits 100 min on the task; it is still
    // in the log but out of every statistic (RESULTS_FORMAT § 8). Without the filter it would be
    // the p95 on its own.
    const pre = { ...fila('Task_TomarPedido', 'pre', 6000), enabledAt: 0 };
    const medidos = Array.from({ length: 5 }, (_, i) => ({ ...fila('Task_TomarPedido', `m${i}`, 60), enabledAt: 4000, startedAt: 4060 }));
    // A case is dated by its earliest row: a later row of the same case, enabled after the
    // warmup, does not make a pre-warmup case count.
    const tarde = { ...fila('Task_TomarPedido', 'pre', 6000), activityInstanceId: 'pre-2', enabledAt: 5000 };
    const escenario = { ...asIs, run: { ...(asIs['run'] as object), warmup: 3600 } };
    const datos = datosVistaRapida({
      id: 'Task_TomarPedido', ir, escenario, resultado: corrida(), log: { rows: [pre, tarde, ...medidos], truncated: false }, S: S(),
    });
    expect(datos?.espera).toEqual({ texto: '1 min', p95: true });
    // With warmup 0 the same rows put «pre» back in.
    const sinWarmup = datosVistaRapida({
      id: 'Task_TomarPedido', ir, escenario: { ...asIs, run: { ...(asIs['run'] as object), warmup: 0 } }, resultado: corrida(),
      log: { rows: [pre, tarde, ...medidos], truncated: false }, S: S(),
    });
    // Rounded like the bottleneck labels: the coarsest unit where it is 1 or more, one decimal.
    expect(sinWarmup?.espera?.texto).toBe('1.7 h');
  });
});

/* ------------------------------------------------------------------ *
 * The block in the panel
 * ------------------------------------------------------------------ */

function tarea(id: string, name: string): ElementoLienzo {
  return { id, type: 'bpmn:Task', businessObject: { $type: 'bpmn:Task', id, name } } as unknown as ElementoLienzo;
}

function modeladorCon(elegido: ElementoLienzo): Modelador {
  return {
    servicios: {
      selection: { get: () => [elegido] },
      rootElement: () => undefined,
      elementRegistry: { filter: () => [] },
    },
    suscribir: () => () => undefined,
  } as unknown as Modelador;
}

const desmontar: Array<() => void> = [];
afterEach(() => {
  for (const d of desmontar.splice(0)) d();
});

function montar(datos: VistaRapidaDatos | null, onEditar = vi.fn()): { panel: HTMLElement; onEditar: typeof onEditar; pedidos: string[] } {
  const panel = document.createElement('div');
  document.body.append(panel);
  const raiz = createRoot(panel);
  const pedidos: string[] = [];
  act(() => {
    raiz.render(
      <PanelPropiedades
        modelador={modeladorCon(tarea('Task_TomarPedido', 'Take order'))}
        pestana="propiedades"
        simulacion={{ datos: (id) => { pedidos.push(id); return datos; }, onEditar }}
      />,
    );
  });
  desmontar.push(() => { act(() => { raiz.unmount(); }); panel.remove(); });
  return { panel, onEditar, pedidos };
}

function valor(panel: HTMLElement, etiqueta: string): string | null {
  const f = [...panel.querySelectorAll('.vista-rapida .propiedades-fila')].find((x) => x.querySelector('span')?.textContent === etiqueta);
  return f?.querySelector('output')?.textContent ?? null;
}

describe('the «Quick view · simulation» block', () => {
  const P = () => strings().propiedades;

  it('before a run: time, resource and «no run», under the element header', () => {
    const { panel, pedidos } = montar({ tiempo: 'Triangular 1 / 2 / 5 min', recurso: 'cajero ×1', espera: null });
    expect(pedidos).toContain('Task_TomarPedido');
    const bloque = panel.querySelector('.vista-rapida')!;
    expect(bloque.querySelector('h3')?.textContent).toBe('Quick view · simulation');
    // Right after the header, before the editable fields.
    expect(panel.querySelector('.propiedades-cabecera')?.nextElementSibling).toBe(bloque);
    expect(valor(panel, P().vistaTiempo)).toBe('Triangular 1 / 2 / 5 min');
    expect(valor(panel, P().vistaRecurso)).toBe('cajero ×1');
    expect(valor(panel, P().vistaEsperaP95)).toBe('no run');
  });

  it('after a run: the p95, or the labelled mean when only the result is there', () => {
    const conP95 = montar({ tiempo: 't', recurso: 'r', espera: { texto: '19 min', p95: true } }).panel;
    expect(valor(conP95, P().vistaEsperaP95)).toBe('19 min');
    const conMedia = montar({ tiempo: 't', recurso: 'r', espera: { texto: '3 min', p95: false } }).panel;
    expect(valor(conMedia, P().vistaEsperaMedia)).toBe('3 min');
  });

  it('the links ask for the Times or the Resources step', () => {
    const { panel, onEditar } = montar({ tiempo: 't', recurso: 'r', espera: null });
    const boton = (texto: string) => [...panel.querySelectorAll('button')].find((b) => b.textContent === texto)!;
    act(() => { boton('Edit in Times').click(); });
    act(() => { boton('Edit in Resources').click(); });
    expect(onEditar.mock.calls).toEqual([['times'], ['resources']]);
  });

  it('a timer gets no resource row nor «Edit in Resources»', () => {
    const { panel } = montar({ tiempo: 't', recurso: null, espera: null });
    expect(valor(panel, P().vistaRecurso)).toBeNull();
    expect(panel.textContent).not.toContain('Edit in Resources');
  });

  it('nothing simulable, or no `simulacion` prop: no block', () => {
    expect(montar(null).panel.querySelector('.vista-rapida')).toBeNull();
    const panel = document.createElement('div');
    document.body.append(panel);
    const raiz = createRoot(panel);
    act(() => { raiz.render(<PanelPropiedades modelador={modeladorCon(tarea('T', 'x'))} pestana="propiedades" />); });
    expect(panel.querySelector('.vista-rapida')).toBeNull();
    act(() => { raiz.unmount(); });
    panel.remove();
  });
});
