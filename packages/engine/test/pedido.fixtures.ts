import type { ProcessIR } from '../src/core/ir.js';

/**
 * AS-IS copiado literalmente de `docs/SCENARIO_FORMAT.md` § 7.1.
 *
 * ponytail: va inline porque `examples/pedido/*.scenario.json` todavía no existe (LILA-008 va en
 * paralelo). El test de abajo valida además cualquier `*.scenario.json` que aparezca en
 * `examples/`, así que cuando ese ticket aterrice la aceptación se cumple sin tocar esto.
 */
export const AS_IS = {
  $schema: 'https://lila-modeler.org/schema/scenario/1.json',
  version: 1,
  name: 'AS-IS',
  description: 'Operación actual, 2 cajeros y 3 cocineros',
  model: 'model.bpmn',
  run: {
    start: '2026-09-07T08:00:00-06:00',
    duration: 2592000,
    warmup: 3600,
    replications: 30,
    seed: 42,
    baseTimeUnit: 'min',
    currency: 'MXN',
  },
  calendars: {
    oficina: {
      intervals: [{ days: ['MON', 'TUE', 'WED', 'THU', 'FRI'], from: '09:00', to: '18:00' }],
    },
  },
  resources: {
    cajero: { name: 'Cajero', type: 'role', capacity: 2, costPerHour: 220, fixedCost: 0, calendar: 'oficina' },
    cocinero: { name: 'Cocinero', type: 'role', capacity: 3, costPerHour: 180, calendar: 'oficina' },
    horno: { name: 'Horno', type: 'equipment', capacity: 1 },
  },
  elements: {
    StartEvent_Pedido: {
      interTriggerTimer: { type: 'exponential', mean: 240 },
      triggerCount: 10000,
      calendar: 'oficina',
    },
    Task_TomarPedido: {
      processingTime: { type: 'triangular', min: 60, mode: 120, max: 300 },
      resources: [{ ref: 'cajero', quantity: 1 }],
      fixedCost: 2.5,
    },
    Task_Preparar: {
      processingTime: { type: 'normal', mean: 480, sd: 90 },
      resources: [{ ref: 'cocinero' }, { ref: 'horno' }],
      selection: 'and',
    },
    Task_Revisar: {
      processingTime: { type: 'constant', value: 90 },
      resources: [{ ref: 'cajero' }, { ref: 'cocinero' }],
      selection: 'or',
    },
    Timer_Reposo: { processingTime: { type: 'constant', value: 600 } },
    Flow_Aprobado: { probability: 0.78 },
    Flow_Rechazado: { probability: 0.22 },
  },
} as const;

/** TO-BE como delta, literal de `docs/SCENARIO_FORMAT.md` § 7.2. */
export const TO_BE = {
  version: 1,
  name: 'TO-BE 3 cajeros',
  extends: 'as-is.scenario.json',
  resources: { cajero: { capacity: 3 } },
} as const;

/** IR de `examples/pedido` con los siete ids que cita el AS-IS. */
export function pedidoIr(): ProcessIR {
  const node = (type: ProcessIR['nodes'][string]['type'], name: string) => ({
    type,
    name,
    incoming: [],
    outgoing: [],
  });
  return {
    id: 'Process_Pedido',
    name: 'Pedido',
    nodes: {
      StartEvent_Pedido: node('start', 'Llega pedido'),
      Task_TomarPedido: node('task', 'Tomar pedido'),
      Task_Preparar: node('task', 'Preparar'),
      Task_Revisar: node('task', 'Revisar'),
      Timer_Reposo: node('timer', 'Reposo'),
      Gateway_Revision: node('xor', 'Revisión'),
      EndEvent_Listo: node('end', 'Listo'),
    },
    flows: {
      Flow_Aprobado: { from: 'Gateway_Revision', to: 'EndEvent_Listo', name: 'Aprobado', isDefault: false },
      Flow_Rechazado: { from: 'Gateway_Revision', to: 'Task_Revisar', name: 'Rechazado', isDefault: false },
    },
    source: { exporter: 'Bizagi Modeler', exporterVersion: '4.2.0', originalIds: {} },
  };
}

/** Deep clone barato para mutar un fixture sin contaminar el resto de los tests. */
export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
