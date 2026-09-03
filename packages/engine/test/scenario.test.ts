import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import type { ProcessIR } from '../src/core/ir.js';
import {
  ScenarioSchema,
  scenarioErrors,
  toJsonSchema,
  validateScenario,
} from '../src/scenario.js';
import { unsupportedKeywords, validateJsonSchema } from './mini-json-schema.js';

const repoRoot = new URL('../../../', import.meta.url);

/**
 * AS-IS copiado literalmente de `docs/SCENARIO_FORMAT.md` § 7.1.
 *
 * ponytail: va inline porque `examples/pedido/*.scenario.json` todavía no existe (LILA-008 va en
 * paralelo). El test de abajo valida además cualquier `*.scenario.json` que aparezca en
 * `examples/`, así que cuando ese ticket aterrice la aceptación se cumple sin tocar esto.
 */
const AS_IS = {
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
const TO_BE = {
  version: 1,
  name: 'TO-BE 3 cajeros',
  extends: 'as-is.scenario.json',
  resources: { cajero: { capacity: 3 } },
} as const;

/** IR de `examples/pedido` con los siete ids que cita el AS-IS. */
function pedidoIr(): ProcessIR {
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
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('esquema del escenario', () => {
  test('el AS-IS y el TO-BE de docs/SCENARIO_FORMAT.md validan', () => {
    expect(ScenarioSchema.safeParse(AS_IS).success).toBe(true);
    expect(ScenarioSchema.safeParse(TO_BE).success).toBe(true);
  });

  test('los escenarios de examples/ validan', () => {
    const dir = fileURLToPath(new URL('examples/', repoRoot));
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((f) =>
      f.endsWith('.scenario.json'),
    );
    for (const file of files) {
      const json: unknown = JSON.parse(readFileSync(`${dir}${file}`, 'utf8'));
      const result = ScenarioSchema.safeParse(json);
      expect(result.success, `${file}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  test('probability: 1.5 se rechaza', () => {
    const bad = clone(AS_IS) as Record<string, never>;
    (bad['elements'] as Record<string, Record<string, number>>)['Flow_Aprobado']!['probability'] = 1.5;
    const result = ScenarioSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.join('.')).toBe('elements.Flow_Aprobado.probability');
  });

  test('una clave desconocida es error, no silencio (R7/R-RES-4)', () => {
    const bad = clone(AS_IS) as Record<string, never>;
    (bad['resources'] as Record<string, Record<string, number>>)['cajero'] = { capacty: 3 };
    expect(ScenarioSchema.safeParse(bad).success).toBe(false);
  });

  test('version distinta de 1 se rechaza (R7)', () => {
    expect(ScenarioSchema.safeParse({ ...clone(AS_IS), version: 2 }).success).toBe(false);
  });

  test('las 14 distribuciones se aceptan y un type desconocido no', () => {
    const distributions = [
      { type: 'constant', value: 90 },
      { type: 'uniform', min: 10, max: 20 },
      { type: 'triangular', min: 60, mode: 120, max: 300 },
      { type: 'exponential', mean: 240 },
      { type: 'normal', mean: 480, sd: 90 },
      { type: 'truncatedNormal', mean: 480, sd: 90, min: 0, max: 900 },
      { type: 'lognormal', mean: 480, sd: 90 },
      { type: 'gamma', shape: 2, scale: 30 },
      { type: 'erlang', k: 3, mean: 90 },
      { type: 'weibull', shape: 1.5, scale: 60 },
      { type: 'beta', alpha: 2, beta: 5, min: 0, max: 100 },
      { type: 'poisson', mean: 4 },
      { type: 'binomial', n: 10, p: 0.3 },
      { type: 'user', points: [{ value: 60, probability: 0.5 }, { value: 120, probability: 0.5 }] },
    ];
    expect(distributions).toHaveLength(14);

    for (const processingTime of distributions) {
      const scenario = clone(AS_IS) as Record<string, never>;
      (scenario['elements'] as Record<string, Record<string, unknown>>)['Timer_Reposo'] = {
        processingTime,
      };
      const result = ScenarioSchema.safeParse(scenario);
      expect(result.success, `${processingTime.type}: ${JSON.stringify(result.error?.issues)}`).toBe(
        true,
      );
    }

    const scenario = clone(AS_IS) as Record<string, never>;
    (scenario['elements'] as Record<string, Record<string, unknown>>)['Timer_Reposo'] = {
      processingTime: { type: 'scipy', args: [1, 2] },
    };
    expect(ScenarioSchema.safeParse(scenario).success).toBe(false);
  });

  test('un parámetro sobrante dentro de una distribución se rechaza citándolo', () => {
    const scenario = clone(AS_IS) as Record<string, never>;
    (scenario['elements'] as Record<string, Record<string, unknown>>)['Timer_Reposo'] = {
      processingTime: { type: 'normal', mean: 60, stddev: 10 },
    };
    const result = ScenarioSchema.safeParse(scenario);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('stddev');
  });

  test('defaults degradantes: ninguno inventa esperas, costos ni variabilidad', () => {
    const minimal = ScenarioSchema.parse({
      version: 1,
      name: 'mínimo',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00', duration: 3600 },
      resources: { cajero: { capacity: 1 } },
      elements: { Task_TomarPedido: { resources: [{ ref: 'cajero' }] } },
    });

    expect(minimal.run).toMatchObject({ warmup: 0, replications: 1, seed: 1, baseTimeUnit: 's' });
    expect(minimal.resources?.['cajero']).toMatchObject({
      type: 'role',
      costPerHour: 0,
      fixedCost: 0,
    });
    expect(minimal.elements?.['Task_TomarPedido']?.resources?.[0]?.quantity).toBe(1);
    // `selection` no lleva default en el esquema: hay que distinguir ausente de declarado (R14).
    expect(minimal.elements?.['Task_TomarPedido']?.selection).toBeUndefined();
  });
});

describe('validateScenario contra el IR', () => {
  test('el AS-IS no produce ningún error contra su IR', () => {
    const scenario = ScenarioSchema.parse(clone(AS_IS));
    expect(scenarioErrors(validateScenario(scenario, pedidoIr()))).toEqual([]);
  });

  test('una clave de elements que no existe en el IR produce error que cita el id', () => {
    const raw = clone(AS_IS) as Record<string, never>;
    (raw['elements'] as Record<string, unknown>)['Task_NoExiste'] = {
      processingTime: { type: 'constant', value: 30 },
    };
    const scenario = ScenarioSchema.parse(raw);

    const errors = scenarioErrors(validateScenario(scenario, pedidoIr()));

    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe('E-ELEMENTO-DESCONOCIDO');
    expect(errors[0]?.path).toBe('elements.Task_NoExiste');
    expect(errors[0]?.message).toContain('Task_NoExiste');
  });

  test('un elemento del IR sin parámetros es warning, no error (R3)', () => {
    const scenario = ScenarioSchema.parse(clone(AS_IS));
    const problems = validateScenario(scenario, pedidoIr());
    const warning = problems.find((p) => p.path === 'elements.Gateway_Revision');
    expect(warning?.severity).toBe('warning');
    expect(warning?.code).toBe('W-ELEMENTO-SIN-PARAMETROS');
  });

  test('los campos reservados los acepta el esquema y los rechaza el motor', () => {
    const raw = clone(AS_IS) as Record<string, never>;
    (raw['elements'] as Record<string, Record<string, unknown>>)['Task_TomarPedido']!['priority'] = 1;
    (raw['resources'] as Record<string, Record<string, unknown>>)['cajero']!['preempt'] = true;
    (raw['calendars'] as Record<string, Record<string, unknown>>)['oficina']!['holidays'] = [
      '2026-12-25',
    ];

    const parsed = ScenarioSchema.safeParse(raw);
    expect(parsed.success).toBe(true);

    const errors = scenarioErrors(validateScenario(parsed.data!, pedidoIr()));
    expect(errors.map((e) => e.message)).toEqual([
      'calendars.oficina.holidays: campo reservado, no soportado por el simulador en v1.',
      'resources.cajero.preempt: campo reservado, no soportado por el simulador en v1.',
      'elements.Task_TomarPedido.priority: campo reservado, no soportado por el simulador en v1.',
    ]);
  });

  test('un reservado en null (borrado por extends) no dispara el error (R-RES-3)', () => {
    const raw = clone(AS_IS) as Record<string, never>;
    (raw['elements'] as Record<string, Record<string, unknown>>)['Task_TomarPedido']!['priority'] =
      null;
    const scenario = ScenarioSchema.parse(raw);
    expect(scenarioErrors(validateScenario(scenario, pedidoIr()))).toEqual([]);
  });

  test('probability fuera de un sequence flow y selection sin resources son error', () => {
    const raw = clone(AS_IS) as Record<string, never>;
    (raw['elements'] as Record<string, Record<string, unknown>>)['Timer_Reposo'] = {
      probability: 0.5,
      selection: 'or',
      interTriggerTimer: { type: 'exponential', mean: 60 },
    };
    const scenario = ScenarioSchema.parse(raw);

    const codes = scenarioErrors(validateScenario(scenario, pedidoIr())).map((e) => e.path);
    expect(codes).toEqual(['elements.Timer_Reposo.probability', 'elements.Timer_Reposo.selection']);
  });

  test('una ref de recurso o de calendario inexistente es error (R9)', () => {
    const raw = clone(AS_IS) as Record<string, never>;
    (raw['elements'] as Record<string, Record<string, unknown>>)['Task_Preparar'] = {
      resources: [{ ref: 'barista' }],
    };
    const scenario = ScenarioSchema.parse(raw);

    const errors = scenarioErrors(validateScenario(scenario, pedidoIr()));
    expect(errors[0]?.code).toBe('E-REF-DESCONOCIDA');
    expect(errors[0]?.message).toContain('barista');
  });

  test('sin duration ni triggerCount no hay condición de parada (R6)', () => {
    const scenario = ScenarioSchema.parse({
      version: 1,
      name: 'sin parada',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00' },
    });
    expect(scenarioErrors(validateScenario(scenario, pedidoIr())).map((e) => e.code)).toContain(
      'E-SIN-PARADA',
    );
  });
});

describe('JSON Schema generado', () => {
  const committed: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL('docs/scenario.schema.json', repoRoot)), 'utf8'),
  );

  test('docs/scenario.schema.json es exactamente lo que genera el script', () => {
    expect(committed).toEqual(toJsonSchema());
  });

  test('el validador mínimo entiende todas las palabras clave del esquema', () => {
    expect(unsupportedKeywords(committed)).toEqual([]);
  });

  test('valida los mismos casos que zod', () => {
    expect(validateJsonSchema(committed, AS_IS)).toEqual([]);
    expect(validateJsonSchema(committed, TO_BE)).toEqual([]);

    const bad = clone(AS_IS) as Record<string, never>;
    (bad['elements'] as Record<string, Record<string, number>>)['Flow_Aprobado']!['probability'] = 1.5;
    expect(validateJsonSchema(committed, bad)).toContainEqual(
      expect.stringContaining('$.elements.Flow_Aprobado.probability'),
    );

    const unknownKey = clone(AS_IS) as Record<string, never>;
    (unknownKey['resources'] as Record<string, Record<string, number>>)['cajero'] = { capacty: 3 };
    expect(validateJsonSchema(committed, unknownKey).length).toBeGreaterThan(0);
  });
});
