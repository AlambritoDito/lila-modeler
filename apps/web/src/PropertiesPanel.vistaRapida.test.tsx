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
import { datosVistaRapida, esperasP95, percentil, type VistaRapidaDatos } from './vistaRapida';

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

/** A run where Task_TomarPedido waited 3 min on average (2 for a clerk, 1 off hours). */
function corrida(): RunResult {
  const stat = (mean: number) => ({ min: 0, max: 0, mean, sd: 0, total: 0 });
  return {
    elements: { Task_TomarPedido: { resourceWait: stat(120), offHoursWait: stat(60) } },
  } as unknown as RunResult;
}

function fila(elementId: string, instancia: string, espera: number, status: EventLogRow['status'] = 'completed'): EventLogRow {
  return {
    replication: 0, caseId: instancia, activityInstanceId: instancia, elementId, resourceId: 'cajero',
    allocationIndex: 0, resourceQuantity: 1, status, enabledAt: 0, startedAt: espera, endedAt: espera + 1,
    observedUntil: espera + 1, resourceWait: espera, offHoursWait: 0, elementCost: 0, resourceCost: 0, cost: 0,
  };
}

describe('datosVistaRapida', () => {
  const S = () => strings();

  it('a task: its distribution in the base unit, its pool, and «no run» without a run', () => {
    const datos = datosVistaRapida({ id: 'Task_TomarPedido', ir, escenario: asIs, resultado: null, S: S() });
    expect(datos).toEqual({ tiempo: 'Triangular 1 / 2 / 5 min', recurso: 'cajero ×1', espera: null });
  });

  it('with a run but no log, the mean wait (resource + off hours), flagged as not p95', () => {
    const datos = datosVistaRapida({ id: 'Task_TomarPedido', ir, escenario: asIs, resultado: corrida(), S: S() });
    expect(datos?.espera).toEqual({ texto: '3 min', p95: false });
  });

  it('with the log in memory, the p95 of the completed instances', () => {
    const rows = Array.from({ length: 21 }, (_, i) => fila('Task_TomarPedido', `a${i}`, i * 60));
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
    expect(truncado?.espera?.p95).toBe(false);
  });

  it('a timer has a time and no resource row; gateways, events and flows have no quick view', () => {
    expect(datosVistaRapida({ id: 'Timer_Reposo', ir, escenario: asIs, resultado: null, S: S() }))
      .toEqual({ tiempo: 'Constant 10 min', recurso: null, espera: null });
    for (const id of ['Gateway_Aprobacion', 'StartEvent_Pedido', 'Flow_Aprobado', 'Participant_Restaurante']) {
      expect(datosVistaRapida({ id, ir, escenario: asIs, resultado: null, S: S() }), id).toBeNull();
    }
  });

  it('a task with nothing written reads «—»; a broken scenario hides the block', () => {
    const datos = datosVistaRapida({ id: 'Task_Empacar', ir, escenario: asIs, resultado: null, S: S() });
    expect(datos).toEqual({ tiempo: '—', recurso: '—', espera: null });
    expect(datosVistaRapida({ id: 'Task_TomarPedido', ir, escenario: null, resultado: null, S: S() })).toBeNull();
  });

  it('percentil interpolates like the engine, and an instance with two pools counts once', () => {
    expect(percentil([0, 10], 0.95)).toBeCloseTo(9.5);
    const dos = [fila('T', 'x', 10), { ...fila('T', 'x', 10), resourceId: 'horno', allocationIndex: 1 }, fila('T', 'y', 20)];
    expect(esperasP95(dos).get('T')).toBeCloseTo(19.5);
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

  it('the links ask for the Parameters or the Resources step', () => {
    const { panel, onEditar } = montar({ tiempo: 't', recurso: 'r', espera: null });
    const boton = (texto: string) => [...panel.querySelectorAll('button')].find((b) => b.textContent === texto)!;
    act(() => { boton('Edit in Parameters').click(); });
    act(() => { boton('Edit in Resources').click(); });
    expect(onEditar.mock.calls).toEqual([['parameters'], ['resources']]);
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
