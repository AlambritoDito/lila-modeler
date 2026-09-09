import { describe, expect, test } from 'vitest';

import type { ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import { runReplication, type SimScenario } from '../../src/core/sim.js';

const IR: ProcessIR = {
  id: 'Process_Utilization',
  name: '',
  nodes: {
    Start: { type: 'start', name: '', incoming: [], outgoing: ['F1'] },
    Task: { type: 'task', name: '', incoming: ['F1'], outgoing: ['F2'] },
    End: { type: 'end', name: '', incoming: ['F2'], outgoing: [] },
  },
  flows: {
    F1: { from: 'Start', to: 'Task', name: '', isDefault: false },
    F2: { from: 'Task', to: 'End', name: '', isDefault: false },
  },
  source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
};

describe('utilización atribuible a la cohorte y capacidad no apropiativa (LILA-204)', () => {
  test('un caso pre-warmup ocupa toda la ventana física pero no aporta busyTime medido', () => {
    const scenario: SimScenario = {
      run: { duration: 20, warmup: 10, seed: 1 },
      elements: {
        Start: { triggerCount: 1 },
        Task: { processingTime: { type: 'constant', value: 20 }, resources: [{ ref: 'agente' }] },
      },
      resources: { agente: { capacity: 1 } },
    };
    const run = runReplication(IR, scenario);
    const result = aggregateReplication(IR, run, scenario);

    expect(run.rows.find((row) => row.elementId === 'Task')).toMatchObject({
      startedAt: 0,
      observedUntil: 20,
    });
    expect(run.statisticsDuration).toBe(10);
    expect(result.resources.agente).toMatchObject({ busyTime: 0, utilization: 0 });
    expect(result.warnings).not.toContainEqual(expect.stringContaining('W-UTILIZACION-MAYOR-UNO'));
  });

  test('la ocupación de calentamiento tampoco se descuenta del denominador (0,5, no 1)', () => {
    // QA de LILA-204: los dos casos de arriba valen 0 con denominador 0 y con denominador
    // completo, así que no distinguen la decisión de R-CAL-9 de su alternativa. Aquí sí: el caso
    // 1 (t = 0, fuera de la cohorte) ocupa `[0, 30]`, de los que 10 s caen en la ventana medida
    // `[20, 40]`; el caso 2 (t = 20, medido) arranca al soltarse la unidad y aporta 10 s.
    // Denominador completo ⇒ 10/20 = 0,5. Descontar la ocupación no medida daría 10/10 = 1.
    const scenario: SimScenario = {
      run: { duration: 40, warmup: 20, seed: 1 },
      elements: {
        Start: { triggerCount: 2, interTriggerTimer: { type: 'constant', value: 20 } },
        Task: { processingTime: { type: 'constant', value: 30 }, resources: [{ ref: 'agente' }] },
      },
      resources: { agente: { capacity: 1 } },
    };
    const run = runReplication(IR, scenario);
    const result = aggregateReplication(IR, run, scenario);

    expect(run.statisticsDuration).toBe(20);
    expect(run.rows.filter((row) => row.elementId === 'Task').map((row) => row.startedAt)).toEqual([0, 30]);
    expect(result.resources.agente).toMatchObject({ busyTime: 10, utilization: 0.5 });
    expect(result.warnings).not.toContainEqual(expect.stringContaining('W-UTILIZACION-MAYOR-UNO'));
  });

  test('dos tareas largas cruzan 2 → 1 y producen 4/3 sin clamp, con diagnóstico', () => {
    const everyDay = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
    const scenario: SimScenario = {
      run: { start: '2026-09-07T00:00:00-06:00', duration: 7200, seed: 1 },
      calendars: {
        always: { intervals: [{ days: everyDay, from: '00:00', to: '24:00' }] },
        firstHour: { intervals: [{ days: everyDay, from: '00:00', to: '01:00' }] },
      },
      elements: {
        Start: { triggerCount: 2 },
        Task: { processingTime: { type: 'constant', value: 7200 }, resources: [{ ref: 'agente' }] },
      },
      resources: {
        agente: {
          capacity: [
            { calendar: 'always', capacity: 1 },
            { calendar: 'firstHour', capacity: 1 },
          ],
        },
      },
    };
    const run = runReplication(IR, scenario);
    const result = aggregateReplication(IR, run, scenario);

    // Ocupación: 2 unidades × 7200 s = 14400. Disponibilidad integrada:
    // 1 × 7200 s + 1 × 3600 s = 10800. Las tareas siguen al bajar la capacidad en t=3600.
    expect(result.resources.agente!.busyTime).toBe(14400);
    expect(result.resources.agente!.utilization).toBeCloseTo(4 / 3, 12);
    expect(result.resources.agente!.utilization).toBeGreaterThan(1);
    expect(result.warnings).toContain(
      'W-UTILIZACION-MAYOR-UNO: agente: the measured occupancy exceeds the integrated available capacity; this can happen when crossing a capacity drop without preemption.',
    );
  });
});
