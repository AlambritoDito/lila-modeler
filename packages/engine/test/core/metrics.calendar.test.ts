import { describe, expect, test } from 'vitest';

import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import { runReplication, type ReplicationRun, type SimScenario } from '../../src/core/sim.js';

/**
 * Aceptación de LILA-041 en la capa de métricas: R-CAL-6 (el cierre no acumula ocupación ni
 * costo), R-CAL-9 (la utilización se mide sobre horas abiertas) y R-COST-2/R-COST-4 (los costos
 * por hora salen del tiempo **abierto** ocupado y siguen cuadrando con el event log).
 */

function makeIr(
  nodes: Record<string, NodeType>,
  flows: Record<string, readonly [from: string, to: string]>,
): ProcessIR {
  const irNodes: Record<string, Node> = {};
  for (const [id, type] of Object.entries(nodes)) {
    irNodes[id] = { type, name: '', incoming: [], outgoing: [] };
  }
  const irFlows: Record<string, Flow> = {};
  for (const [id, [from, to]] of Object.entries(flows)) {
    irFlows[id] = { from, to, name: '', isDefault: false };
    irNodes[from]!.outgoing.push(id);
    irNodes[to]!.incoming.push(id);
  }
  return {
    id: 'Process_MetricsCalendar',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

const HOUR = 3600;
const DAY = 86400;
const MONDAY_0800 = '2026-09-07T08:00:00-06:00';
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
const OFICINA = { intervals: [{ days: WEEKDAYS, from: '09:00', to: '18:00' }] };

/**
 * `Reloj → Largo` es un timer 24×7 más largo que la corrida: obliga a que el heap tenga un
 * evento en `t ≥ t_stop` y la réplica pare exactamente en `run.duration` (R-ARR-3), con lo que
 * la ventana estadística es un intervalo redondo y calculable a mano.
 */
const CLOCK_NODES = { Reloj: 'start', Largo: 'timer', FinReloj: 'end' } as const;
const CLOCK_FLOWS = { FR1: ['Reloj', 'Largo'], FR2: ['Largo', 'FinReloj'] } as const;

function clockElements(duration: number): SimScenario['elements'] {
  return {
    Reloj: { interTriggerTimer: { type: 'constant', value: duration }, triggerCount: 1 },
    Largo: { processingTime: { type: 'constant', value: duration } },
  };
}

/** Suma sobre las filas de los casos incluidos en la ventana estadística. */
function sumRows(run: ReplicationRun, field: 'cost' | 'resourceCost'): number {
  const included = new Set(run.cases.map((record) => String(record.caseId)));
  return run.rows.filter((row) => included.has(row.caseId)).reduce((total, row) => total + row[field], 0);
}

/* ------------------------------------------------------------------ *
 * (a) El cierre no acumula ocupación ni costo (R-CAL-6, R-COST-2)
 * ------------------------------------------------------------------ */

describe('(a) el tiempo cerrado no es busyTime ni costo (R-CAL-6)', () => {
  const ir = makeIr(
    { Start: 'start', Espera: 'timer', Tarea: 'task', End: 'end', ...CLOCK_NODES },
    { F1: ['Start', 'Espera'], F2: ['Espera', 'Tarea'], F3: ['Tarea', 'End'], ...CLOCK_FLOWS },
  );
  const DURATION = 2 * DAY;
  const scenario: SimScenario = {
    run: { start: MONDAY_0800, duration: DURATION, seed: 1 },
    calendars: { oficina: OFICINA },
    // costPerHour 3600 hace que `unitCost` sea el número de segundos ocupados: se lee sin cuentas.
    resources: { cajero: { capacity: 1, calendar: 'oficina', costPerHour: 3600, fixedCost: 10 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
      Espera: { processingTime: { type: 'constant', value: 34200 } }, // lunes 17:30
      Tarea: { processingTime: { type: 'constant', value: 2 * HOUR }, resources: [{ ref: 'cajero' }] },
      ...clockElements(DURATION),
    },
  };
  const run = runReplication(ir, scenario);
  const result = aggregateReplication(ir, run, scenario);
  const cajero = result.resources.cajero!;

  test('la unidad está reservada 17 h de reloj pero solo acumula 2 h de busyTime', () => {
    const row = run.rows.find((candidate) => candidate.elementId === 'Tarea')!;
    expect(row.startedAt).toBe(34200);
    expect(row.endedAt).toBe(95400);
    expect(row.endedAt! - row.startedAt!).toBe(61200);
    expect(cajero.busyTime).toBe(2 * HOUR);
  });

  test('el costo por hora se cobra solo por las horas abiertas (R-COST-2)', () => {
    expect(cajero.unitCost).toBe(2 * HOUR);
    expect(cajero.fixedCost).toBe(10);
    expect(cajero.totalCost).toBe(10 + 2 * HOUR);
  });

  test('la utilización usa las 18 h abiertas de la ventana como denominador (R-CAL-9)', () => {
    // Dos días desde el lunes a las 08:00: lunes y martes de 09:00 a 18:00 = 64800 s abiertos.
    expect(cajero.utilization).toBeCloseTo((2 * HOUR) / 64800, 12);
    // Contra el reloj de pared saldría casi cinco veces menos.
    expect(cajero.utilization).toBeGreaterThan((2 * HOUR) / DURATION);
  });

  test('la identidad R-COST-4 se conserva contra el event log', () => {
    expect(sumRows(run, 'resourceCost')).toBeCloseTo(cajero.totalCost, 9);
    expect(result.process.totalCost).toBeCloseTo(sumRows(run, 'cost'), 9);
  });
});

/* ------------------------------------------------------------------ *
 * (b) Ventana con warmup (R-ARR-7 + R-CAL-9)
 * ------------------------------------------------------------------ */

describe('(b) el denominador son las horas abiertas de [warmup, t_stop]', () => {
  const ir = makeIr(
    { Start: 'start', Tarea: 'task', End: 'end', ...CLOCK_NODES },
    { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'], ...CLOCK_FLOWS },
  );
  const DURATION = 2 * DAY;
  const scenario: SimScenario = {
    run: { start: MONDAY_0800, duration: DURATION, warmup: DAY, seed: 3 },
    calendars: { oficina: OFICINA },
    resources: { cajero: { capacity: 2, calendar: 'oficina', costPerHour: 90, fixedCost: 5 } },
    elements: {
      // Una llegada cada 700 s de reloj y 400 s de servicio con dos unidades: la cola nocturna se
      // desahoga durante la mañana (así la cohorte medida sí ocupa el pool) y la cadencia no es
      // divisor de la jornada, así que alguna tarea arranca a caballo del cierre de las 18:00.
      Start: { interTriggerTimer: { type: 'constant', value: 700 } },
      Tarea: { processingTime: { type: 'constant', value: 400 }, resources: [{ ref: 'cajero' }] },
      ...clockElements(DURATION),
    },
  };
  const run = runReplication(ir, scenario);
  const result = aggregateReplication(ir, run, scenario);
  const cajero = result.resources.cajero!;

  test('utilization = busyTime / (capacity × horas abiertas de la ventana)', () => {
    // Ventana [86400, 172800]: solo el martes de 09:00 a 18:00, 32400 s abiertos.
    const available = 2 * 32400;
    expect(cajero.busyTime).toBeGreaterThan(0);
    expect(cajero.utilization).toBeCloseTo(cajero.busyTime / available, 12);
    // Un pool saturado en horario de oficina supera el 100 % contra el reloj de pared: la única
    // definición comparable con el nivel 3 de Bizagi es la de horas abiertas (R-CAL-9).
    expect(cajero.busyTime / (2 * DAY)).toBeLessThan(cajero.utilization);
    expect(cajero.utilization).toBeLessThanOrEqual(1);
  });

  test('la cohorte previa al warmup no aporta ocupación (R-ARR-7)', () => {
    const included = new Set(run.cases.map((record) => String(record.caseId)));
    const medidas = run.rows.filter(
      (row) => included.has(row.caseId) && row.elementId === 'Tarea' && row.status === 'completed',
    );

    // El pool trabaja sin parar durante la mañana del lunes, pero esos casos nacieron antes del
    // warmup: `busyTime` cuenta exactamente las tareas medidas, ni una más.
    expect(medidas.length).toBeGreaterThan(20);
    expect(cajero.busyTime).toBe(medidas.length * 400);
  });

  test('ninguna fila informa un arranque posterior al fin de la observación', () => {
    // Una concesión en tiempo cerrado apunta a la siguiente apertura, que puede caer más allá
    // del corte: la fila se recorta a `observedUntil` en vez de publicar un futuro.
    for (const row of run.rows) {
      if (row.startedAt === null) continue;
      expect(row.startedAt).toBeGreaterThanOrEqual(row.enabledAt);
      expect(row.startedAt).toBeLessThanOrEqual(row.observedUntil);
    }
  });

  test('los costos siguen cuadrando con el log (R-COST-4)', () => {
    expect(cajero.unitCost).toBeCloseTo((90 * cajero.busyTime) / 3600, 9);
    expect(cajero.totalCost).toBeCloseTo(cajero.fixedCost + cajero.unitCost, 9);
    expect(sumRows(run, 'resourceCost')).toBeCloseTo(cajero.totalCost, 6);
    expect(result.process.totalCost).toBeCloseTo(sumRows(run, 'cost'), 6);
  });
});

/* ------------------------------------------------------------------ *
 * (c) Degradación: sin `calendars` las métricas son las de M2
 * ------------------------------------------------------------------ */

describe('(c) sin calendarios el denominador vuelve a ser la ventana entera (R-DEG-2)', () => {
  const ir = makeIr(
    { Start: 'start', Tarea: 'task', End: 'end', ...CLOCK_NODES },
    { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'], ...CLOCK_FLOWS },
  );
  const DURATION = DAY;
  const base: SimScenario = {
    run: { start: MONDAY_0800, duration: DURATION, seed: 5 },
    resources: { cajero: { capacity: 1, costPerHour: 3600 } },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 900 } },
      Tarea: { processingTime: { type: 'constant', value: 300 }, resources: [{ ref: 'cajero' }] },
      ...clockElements(DURATION),
    },
  };

  test('el resultado es idéntico con y sin un `calendars` 24×7 declarado a mano', () => {
    // Un calendario de los siete días de 00:00 a 24:00 abre exactamente igual que no tener
    // ninguno: es la comprobación de que `"24:00"` cierra el hueco de 60 s del formato.
    const conVeinticuatroSiete: SimScenario = {
      ...base,
      calendars: {
        siempre: {
          intervals: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], from: '00:00', to: '24:00' }],
        },
      },
      resources: { cajero: { capacity: 1, costPerHour: 3600, calendar: 'siempre' } },
    };

    const sin = aggregateReplication(ir, runReplication(ir, base), base);
    const con = aggregateReplication(ir, runReplication(ir, conVeinticuatroSiete), conVeinticuatroSiete);

    expect(JSON.stringify(con)).toBe(JSON.stringify(sin));
    expect(sin.resources.cajero!.utilization).toBeCloseTo(sin.resources.cajero!.busyTime / DURATION, 12);
  });

  test('un elemento sin calendario no acumula offHoursWait', () => {
    const result = aggregateReplication(ir, runReplication(ir, base), base);
    expect(result.elements.Tarea!.offHoursWait.total).toBe(0);
  });
});
