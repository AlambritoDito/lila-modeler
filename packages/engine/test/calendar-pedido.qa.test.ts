import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, test } from 'vitest';

import { parseBpmn } from '../src/bpmn/index.js';
import { openTime, isOpen, type Calendar } from '../src/core/calendar.js';
import type { ProcessIR } from '../src/core/ir.js';
import type { EventLogRow, RunResult } from '../src/core/result.js';
import { activityCalendar, compileCalendars, poolCalendar, type SimScenario } from '../src/core/sim.js';
import { compare, simulate } from '../src/index.js';
import type { ResolvedScenario } from '../src/scenario.js';
import { loadPedidoScenario } from './golden/pedido.js';

/**
 * QA adversarial de LILA-041 sobre el ejemplo real, `examples/pedido` con su calendario
 * `oficina`. Las pruebas de `core/` usan IR de laboratorio; esta comprueba que los invariantes
 * de §12 aguantan en las ~13 000 filas de una corrida completa, con distribuciones continuas,
 * AND, OR, timer, warmup y un pool sin calendario mezclado con dos que sí lo tienen.
 */

const EXAMPLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../examples/pedido');

let ir: ProcessIR;
let scenario: ResolvedScenario;
let rows: EventLogRow[];
let result: RunResult;
let calendars: ReadonlyMap<string, Calendar>;

beforeAll(async () => {
  ir = (await parseBpmn(readFileSync(resolve(EXAMPLE_DIR, 'model.bpmn'), 'utf8'))).ir;
  // Una sola replicación: los invariantes son por fila y 30 solo multiplicarían el reloj.
  scenario = { ...loadPedidoScenario(42), run: { ...loadPedidoScenario(42).run, replications: 1 } };
  rows = [];
  result = simulate(ir, scenario, { onEvent: (row) => rows.push(row) });
  calendars = compileCalendars(scenario as SimScenario);
}, 60_000);

/** Calendario efectivo de una fila: el de los pools que su instancia ocupó, como en `metrics.ts`. */
function calendarOf(row: EventLogRow, byInstance: ReadonlyMap<string, string[]>): Calendar | undefined {
  return activityCalendar(scenario as SimScenario, calendars, row.elementId, byInstance.get(row.activityInstanceId) ?? []);
}

describe('QA LILA-041 · examples/pedido con calendarios', () => {
  test('el fixture es el de nivel 4: calendario, tres pools, AND y OR', () => {
    expect(Object.keys(scenario.calendars ?? {})).toEqual(['oficina']);
    expect(scenario.resources?.cajero?.calendar).toBe('oficina');
    expect(scenario.resources?.horno?.calendar).toBeUndefined();
    expect(scenario.elements?.StartEvent_Pedido?.calendar).toBe('oficina');
    expect(rows.length).toBeGreaterThan(5000);
  });

  test('R-CAL-8, signos y horario abierto en **todas** las filas del log', () => {
    const byInstance = new Map<string, string[]>();
    for (const row of rows) {
      if (row.resourceId === null) continue;
      const pools = byInstance.get(row.activityInstanceId) ?? [];
      pools.push(row.resourceId);
      byInstance.set(row.activityInstanceId, pools);
    }

    let completadas = 0;
    let conCierre = 0;
    for (const row of rows) {
      expect(row.resourceWait).toBeGreaterThanOrEqual(0);
      expect(row.offHoursWait).toBeGreaterThanOrEqual(0);
      const calendar = calendarOf(row, byInstance);
      if (row.startedAt !== null) {
        expect(row.startedAt).toBeGreaterThanOrEqual(row.enabledAt);
        expect(row.startedAt).toBeLessThanOrEqual(row.observedUntil);
        // Ninguna fila de este ejemplo cae en el recorte de RESULTS_FORMAT § 7, así que el
        // arranque informado tiene que estar siempre en horario abierto.
        if (calendar !== undefined) expect(isOpen(calendar, row.startedAt)).toBe(true);
      }
      if (row.status !== 'completed' || row.endedAt === null) continue;
      completadas++;
      if (calendar === undefined) {
        expect(row.offHoursWait).toBe(0);
        continue;
      }
      // R-CAL-2: `to` es exclusivo, así que terminar justo al cerrar el turno es legítimo y
      // `isOpen` da falso ahí. Con distribuciones continuas no pasa nunca en este ejemplo —el
      // contador lo deja escrito—, pero la alternativa "cerrado y no en un cierre" sí sería bug.
      if (!isOpen(calendar, row.endedAt)) {
        expect(openTime(calendar, row.endedAt - 1, row.endedAt)).toBeGreaterThan(0);
        conCierre++;
      }
      const processing = openTime(calendar, row.startedAt!, row.endedAt);
      expect(row.endedAt - row.enabledAt).toBeCloseTo(row.resourceWait + row.offHoursWait + processing, 6);
    }

    expect(completadas).toBeGreaterThan(3000);
    expect(conCierre).toBe(0);
  });

  test('R-COST-4: Σ resources[*].totalCost = Σ row.resourceCost', () => {
    const porFila = rows.reduce((total, row) => total + row.resourceCost, 0);
    const porPool = Object.values(result.resources).reduce((total, pool) => total + pool.totalCost, 0);

    expect(porFila).toBeGreaterThan(0);
    expect(porFila).toBeCloseTo(porPool, 6);
    expect(result.process.totalCost).toBeCloseTo(rows.reduce((total, row) => total + row.cost, 0), 6);
  });

  test('R-CAL-9: `availableTime` sale de `[warmup, t_stop]` y ningún pool pasa de su techo', () => {
    // La ventana estadística es `[warmup, t_stop]` y `t_stop` es `run.duration` medido desde
    // `run.start`, no desde el warmup (R-ARR-7).
    const warmup = scenario.run.warmup ?? 0;
    const stop = scenario.run.duration ?? 0;
    for (const [poolId, pool] of Object.entries(scenario.resources ?? {})) {
      const calendar = poolCalendar(calendars, pool);
      const available = calendar === undefined ? stop - warmup : openTime(calendar, warmup, stop);
      const metrics = result.resources[poolId]!;

      expect(metrics.busyTime).toBeLessThanOrEqual(pool.capacity * available + 1e-6);
      expect(metrics.utilization).toBeCloseTo(metrics.busyTime / (pool.capacity * available), 9);
      expect(metrics.utilization).toBeLessThanOrEqual(1);
    }
    // El denominador del cajero son las 198 h abiertas de la ventana, no los 30 días de reloj.
    expect(openTime(calendars.get('oficina')!, warmup, stop)).toBe(712800);
  });

  test('un pool de capacidad 1 no atiende dos filas a la vez', () => {
    const ocupaciones = rows
      .filter((row) => row.resourceId === 'horno' && row.startedAt !== null)
      .map((row) => [row.startedAt!, row.endedAt ?? row.observedUntil] as const)
      .sort((left, right) => left[0] - right[0]);

    expect(scenario.resources?.horno?.capacity).toBe(1);
    expect(ocupaciones.length).toBeGreaterThan(1000);
    for (let index = 1; index < ocupaciones.length; index++) {
      expect(ocupaciones[index]![0]).toBeGreaterThanOrEqual(ocupaciones[index - 1]![1] - 1e-9);
    }
  });

  /**
   * Hallazgo abierto de contrato, sin corregir: R-CAL-9 mide `availableTime` con el calendario
   * **del pool**, pero un pool sin calendario que solo participa en tareas con calendario nunca
   * puede trabajar fuera de ese horario. `horno` está de hecho saturado —ocupa el 99,9 % de las
   * horas en que su tarea puede correr— y la columna `Utilization %` imprime 27,5 %.
   *
   * La prueba ancla el número actual para que el día que LILA-044 decida cambiar la definición,
   * el cambio sea deliberado y no un accidente.
   */
  test('el pool sin calendario informa una utilización diluida por el reloj de pared', () => {
    const warmup = scenario.run.warmup ?? 0;
    const stop = scenario.run.duration ?? 0;
    const horno = result.resources.horno!;
    const abiertoDeSuTarea = openTime(calendars.get('oficina')!, warmup, stop);

    expect(poolCalendar(calendars, scenario.resources!.horno!)).toBeUndefined();
    expect(horno.busyTime / abiertoDeSuTarea).toBeGreaterThan(0.99);
    expect(horno.utilization).toBeLessThan(0.3);
  });
});

describe('QA LILA-041 · la aceptación de `lila compare` sobrevive al calendario', () => {
  test(
    'la espera de Task_TomarPedido sigue siendo significativa al pasar de 2 a 3 cajeros',
    async () => {
      const model = (await parseBpmn(readFileSync(resolve(EXAMPLE_DIR, 'model.bpmn'), 'utf8'))).ir;
      const asIs = loadPedidoScenario(42);
      const toBe: ResolvedScenario = {
        ...asIs,
        resources: { ...asIs.resources, cajero: { ...asIs.resources!.cajero!, capacity: 3 } },
      };

      const comparison = compare([
        simulate(model, asIs, { log: false }),
        simulate(model, toBe, { log: false }),
      ]);
      const row = comparison.rows.find((entry) => entry.kpi === 'elements.Task_TomarPedido.resourceWait.mean')!;

      // Con calendarios: 14,97 s → 2,18 s. RESULTS_FORMAT § 11 cita 14,94 s → 2,19 s, que son los
      // números del mismo ejemplo **sin** calendarios; la nota de la sección lo dice desde el QA.
      expect(row.base).toBeGreaterThan(14);
      expect(row.base).toBeLessThan(16);
      expect(row.values[1]!).toBeLessThan(3);
      expect(row.significant[1]).toBe(true);

      // Y el cuello de botella sigue sin moverse: `horno` con `capacity 1` no lo toca el TO-BE.
      const preparar = comparison.rows.find((entry) => entry.kpi === 'elements.Task_Preparar.resourceWait.mean')!;
      expect(preparar.significant[1]).toBe(false);
    },
    120_000,
  );
});
