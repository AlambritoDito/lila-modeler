import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { loadResolvedScenario } from '../src/cli-shared.js';
import {
  ScenarioSchema,
  parseScenario,
  resolveExtends,
  scenarioErrors,
  toJsonSchema,
  validateScenario,
  type ScenarioReader,
} from '../src/scenario.js';
import { unsupportedKeywords, validateJsonSchema } from './mini-json-schema.js';
import { AS_IS, TO_BE, clone, pedidoIr } from './pedido.fixtures.js';

const repoRoot = new URL('../../../', import.meta.url);

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

  test('probability: 1.5 la rechaza el lint con E-PROB-RANGO, no el esquema (§ 17, LILA-198)', () => {
    const bad = clone(AS_IS) as Record<string, never>;
    (bad['elements'] as Record<string, Record<string, number>>)['Flow_Aprobado']!['probability'] = 1.5;
    // El esquema ya no acota el rango a propósito: así el defecto llega al lint con el código del
    // catálogo y su ruta, en vez de un defecto genérico de zod que no lleva código.
    const parsed = ScenarioSchema.safeParse(bad);
    expect(parsed.success).toBe(true);
    const error = scenarioErrors(validateScenario(parsed.data!, pedidoIr())).find(
      (problem) => problem.path === 'elements.Flow_Aprobado.probability',
    );
    expect(error?.code).toBe('E-PROB-RANGO');
    expect(error?.message).toContain('fuera de [0, 1]');
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

    expect(minimal.run).toMatchObject({ warmup: 0, replications: 1, baseTimeUnit: 's' });
    // `seed` no lleva default en el esquema desde LILA-198: R-DEG-4 pide avisar `W-SIN-SEED`
    // cuando el escenario no la declara, y con default el lint no podría distinguirlo de un 1
    // escrito a mano. El valor neutro (1) lo aplica el motor.
    expect(minimal.run?.seed).toBeUndefined();
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
  test('el AS-IS de la documentación no tiene errores (OR multi-pool vale desde LILA-035)', () => {
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

  test('probability, selection e interTriggerTimer en un timer intermedio son error (R4, R5, R14)', () => {
    const raw = clone(AS_IS) as Record<string, never>;
    (raw['elements'] as Record<string, Record<string, unknown>>)['Timer_Reposo'] = {
      probability: 0.5,
      selection: 'or',
      interTriggerTimer: { type: 'exponential', mean: 60 },
    };
    const scenario = ScenarioSchema.parse(raw);

    // R5 (LILA-186 QA): `interTriggerTimer` solo va en un `start`. El «timer generador» de R5 es
    // el `bpmn:startEvent` con `timerEventDefinition`, que SEMANTICS § 2 ya mapea a `start`; un
    // `timer` en el IR es el `intermediateCatchEvent` de retardo, sobre el que `core/sim.ts`
    // nunca monta generador de llegadas.
    const codes = scenarioErrors(validateScenario(scenario, pedidoIr())).map((e) => e.path);
    expect(codes).toEqual([
      'elements.Timer_Reposo.probability',
      'elements.Timer_Reposo.interTriggerTimer',
      'elements.Timer_Reposo.selection',
    ]);
  });

  test('una ref de recurso o de calendario inexistente es error (R9)', () => {
    const raw = clone(AS_IS) as Record<string, never>;
    (raw['elements'] as Record<string, Record<string, unknown>>)['Task_Preparar'] = {
      resources: [{ ref: 'barista' }],
    };
    const scenario = ScenarioSchema.parse(raw);

    const errors = scenarioErrors(validateScenario(scenario, pedidoIr()));
    expect(errors[0]?.code).toBe('E-REC-DESCONOCIDO');
    expect(errors[0]?.message).toContain('barista');
  });

  test('rechaza pool duplicado, quantity imposible y recursos en timer', () => {
    const raw = clone(AS_IS) as Record<string, never>;
    const elements = raw['elements'] as Record<string, Record<string, unknown>>;
    elements['Task_TomarPedido']!['resources'] = [
      { ref: 'cajero', quantity: 3 },
      { ref: 'cajero', quantity: 1 },
    ];
    elements['Timer_Reposo']!['resources'] = [{ ref: 'horno' }];
    const scenario = ScenarioSchema.parse(raw);
    const errors = scenarioErrors(validateScenario(scenario, pedidoIr()));

    expect(errors.map((problem) => problem.code)).toEqual([
      'E-REC-CANTIDAD',
      'E-REC-DUPLICADO',
      // Un timer con recursos tiene código propio en § 17 (LILA-198).
      'E-TIMER-RECURSO',
    ]);
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

describe('§ 2.4 — capacity por intervalos (LILA-164)', () => {
  const pool = (capacity: unknown, extra: Record<string, unknown> = {}) =>
    ScenarioSchema.safeParse({
      version: 1,
      name: 'turnos',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00', duration: 3600 },
      calendars: { dia: { intervals: [{ days: ['MON'], from: '08:00', to: '20:00' }] } },
      resources: { enfermera: { capacity, ...extra } },
    });

  test('acepta el entero y la lista de tramos', () => {
    expect(pool(3).success).toBe(true);
    expect(pool([{ calendar: 'dia', capacity: 3 }]).success).toBe(true);
    const parsed = pool([{ calendar: 'dia', capacity: 3 }]);
    expect(parsed.success && parsed.data.resources!.enfermera!.capacity).toEqual([
      { calendar: 'dia', capacity: 3 },
    ]);
  });

  test('rechaza la lista vacía, el tramo sin calendario, la capacidad no entera y las claves de más', () => {
    expect(pool([]).success).toBe(false);
    expect(pool([{ capacity: 3 }]).success).toBe(false);
    expect(pool([{ calendar: 'dia', capacity: 0 }]).success).toBe(false);
    expect(pool([{ calendar: 'dia', capacity: 1.5 }]).success).toBe(false);
    expect(pool([{ calendar: 'dia', capacity: 3, priority: 1 }]).success).toBe(false);
  });

  test('el JSON Schema generado acepta y rechaza lo mismo que zod', () => {
    const committed: unknown = JSON.parse(
      readFileSync(fileURLToPath(new URL('docs/scenario.schema.json', repoRoot)), 'utf8'),
    );
    const escenario = (capacity: unknown) => ({
      version: 1,
      name: 'turnos',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00', duration: 3600 },
      calendars: { dia: { intervals: [{ days: ['MON'], from: '08:00', to: '20:00' }] } },
      resources: { enfermera: { capacity } },
    });
    expect(validateJsonSchema(committed, escenario([{ calendar: 'dia', capacity: 3 }]))).toEqual([]);
    expect(validateJsonSchema(committed, escenario(3))).toEqual([]);
    expect(validateJsonSchema(committed, escenario([{ capacity: 3 }])).length).toBeGreaterThan(0);
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

    // Desde LILA-198 el rango de `probability` no vive en el esquema sino en el lint
    // (`E-PROB-RANGO`): ni zod ni el JSON Schema publicado lo rechazan, y siguen coincidiendo.
    const bad = clone(AS_IS) as Record<string, never>;
    (bad['elements'] as Record<string, Record<string, number>>)['Flow_Aprobado']!['probability'] = 1.5;
    expect(ScenarioSchema.safeParse(bad).success).toBe(true);
    expect(validateJsonSchema(committed, bad)).toEqual([]);

    const unknownKey = clone(AS_IS) as Record<string, never>;
    (unknownKey['resources'] as Record<string, Record<string, number>>)['cajero'] = { capacty: 3 };
    expect(validateJsonSchema(committed, unknownKey).length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * Mensajes en español (LILA-202)
 * ------------------------------------------------------------------ */

describe('mensajes del esquema en español (LILA-202)', () => {
  const BASE = {
    version: 1,
    name: 'x',
    model: 'model.bpmn',
    run: { start: '2026-01-01T08:00:00Z', duration: 3600 },
  };

  /** Vocabulario de los textos de fábrica de zod: si asoma cualquiera, se coló el inglés. */
  const INGLES = /Invalid|Too (big|small)|Unrecognized|expected|received|option|Required/i;

  /** El primer defecto de un escenario, con el formato `ruta: mensaje` de la CLI y del panel. */
  function defecto(scenario: unknown): { code: string; texto: string } {
    const parsed = parseScenario(scenario);
    if (parsed.success) throw new Error('el escenario era válido');
    for (const issue of parsed.error.issues) {
      expect(issue.message, `${issue.code} sale en inglés`).not.toMatch(INGLES);
    }
    const first = parsed.error.issues[0]!;
    return { code: first.code, texto: `${first.path.join('.') || '$'}: ${first.message}` };
  }

  // Un caso por tipo de defecto que produce hoy `ScenarioSchema` (la aceptación de LILA-202).
  const casos: [string, string, unknown, string][] = [
    // Desde LILA-198 `probability` no la acota el esquema (la caza el lint con `E-PROB-RANGO`),
    // así que el cebo de rango es otro campo que el esquema sí acota: `p` de la binomial y
    // `run.warmup`.
    ['too_big', 'too_big',
      { ...BASE, elements: { T: { processingTime: { type: 'binomial', n: 1, p: 1.5 } } } },
      'elements.T.processingTime.p: debe ser ≤ 1'],
    ['too_small inclusivo', 'too_small', { ...BASE, run: { ...BASE.run, warmup: -1 } },
      'run.warmup: debe ser ≥ 0'],
    ['too_small exclusivo', 'too_small', { ...BASE, run: { ...BASE.run, duration: 0 } },
      'run.duration: debe ser > 0'],
    ['too_small de lista', 'too_small',
      { ...BASE, elements: { T: { processingTime: { type: 'user', points: [] } } } },
      'elements.T.processingTime.points: debe tener al menos 1 elemento'],
    ['invalid_type', 'invalid_type', { ...BASE, run: { ...BASE.run, seed: 'abc' } },
      'run.seed: debe ser un número, no un texto'],
    ['invalid_type entero', 'invalid_type', { ...BASE, run: { ...BASE.run, seed: 1.5 } },
      'run.seed: debe ser un entero, no un número'],
    ['invalid_type ausente', 'invalid_type', { version: 1 },
      'name: es obligatorio y debe ser un texto'],
    ['invalid_value de enum', 'invalid_value', { ...BASE, run: { ...BASE.run, baseTimeUnit: 'semana' } },
      'run.baseTimeUnit: debe ser uno de: "s", "min", "h", "day"'],
    ['invalid_value de literal', 'invalid_value', { ...BASE, version: 2 }, 'version: debe ser 1'],
    ['unrecognized_keys', 'unrecognized_keys', { ...BASE, elements: { Flow_X: { probabilidad: 1 } } },
      'elements.Flow_X: clave desconocida: "probabilidad"'],
    ['unrecognized_keys en plural', 'unrecognized_keys',
      { ...BASE, elements: { Flow_X: { probabilidad: 1, otra: 2 } } },
      'elements.Flow_X: claves desconocidas: "probabilidad", "otra"'],
    ['invalid_union discriminada', 'invalid_union',
      { ...BASE, elements: { T: { processingTime: { type: 'raro' } } } },
      'elements.T.processingTime.type: debe ser uno de: "constant", "uniform", "triangular", "exponential", "normal", "truncatedNormal", "lognormal", "gamma", "erlang", "weibull", "beta", "poisson", "binomial", "user"'],
    ['invalid_union plana', 'invalid_union', { ...BASE, resources: { r: { capacity: 'x' } } },
      'resources.r.capacity: no encaja con ninguna de las formas admitidas'],
  ];

  test.each(casos)('%s', (_nombre, code, scenario, esperado) => {
    const { code: real, texto } = defecto(scenario);
    expect(real).toBe(code);
    expect(texto).toBe(esperado);
  });

  test('el mensaje propio del esquema manda sobre el mapa (R11, R13, R8)', () => {
    // `refine`, `regex` y `min` con texto siguen diciendo lo suyo: zod no consulta el mapa.
    expect(defecto({ ...BASE, elements: { T: { processingTime: { type: 'uniform', min: 5, max: 1 } } } }).texto)
      .toBe('elements.T.processingTime: uniform: se requiere min ≤ max');
    expect(defecto({ ...BASE, run: { ...BASE.run, currency: 'pesos' } }).texto)
      .toBe('run.currency: run.currency debe ser un código ISO 4217');
    expect(defecto({ ...BASE, calendars: { c: { intervals: [] } } }).texto)
      .toBe('calendars.c.intervals: E-CAL-VACIO: el calendario no tiene intervalos abiertos.');
  });

  test('la CLI imprime exactamente el mismo texto que el esquema', () => {
    const roto = { ...BASE, run: { ...BASE.run, warmup: -1 } };
    expect(() => loadResolvedScenario('as-is.scenario.json', () => roto)).toThrow(
      'run.warmup: debe ser ≥ 0',
    );
  });
});

describe('claves de prototipo en la herencia (LILA-204)', () => {
  // JSON.parse, **no** un literal de objeto: `{ __proto__: … }` escrito a mano no crea una clave
  // propia (escribe en el prototipo del propio literal) y el test no probaría nada.
  const PADRE =
    '{"version":1,"name":"padre","model":"model.bpmn","run":{"start":"2026-01-01T08:00:00Z","duration":3600}}';
  const HIJO =
    '{"extends":"padre.scenario.json","__proto__":{"x":1},"constructor":{"prototype":{"y":1}},"prototype":{"z":1},"run":{"__proto__":{"x":1}}}';

  const read: ScenarioReader = (path) =>
    JSON.parse(path === 'padre.scenario.json' ? PADRE : HIJO) as unknown;

  test('resolveExtends ignora __proto__, constructor y prototype a cualquier profundidad', () => {
    const resolved = resolveExtends('hijo.scenario.json', read);

    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
    expect(({} as Record<string, unknown>)['y']).toBeUndefined();
    expect(Object.getPrototypeOf(resolved)).toBe(Object.prototype);
    expect(resolved['x']).toBeUndefined();
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      expect(Object.hasOwn(resolved, key), key).toBe(false);
    }

    const run = resolved['run'] as Record<string, unknown>;
    expect(Object.getPrototypeOf(run)).toBe(Object.prototype);
    expect(run['x']).toBeUndefined();
    expect(run['duration']).toBe(3600); // el resto del padre sí se hereda.
  });

  // El filtro solo corría en las ramas que la fusión recorre: un objeto que el padre **no** trae
  // se copiaba entero por referencia y el resuelto se quedaba con la clave propia (QA de LILA-204).
  test('también se filtra un objeto que el padre no trae', () => {
    const padre = '{"version":1,"name":"padre","model":"model.bpmn"}';
    const hijo =
      '{"extends":"padre.scenario.json","run":{"start":"2026-01-01T08:00:00Z","duration":3600,"__proto__":{"pwn":1}}}';
    const resolved = resolveExtends('hijo.scenario.json', (path) =>
      JSON.parse(path === 'padre.scenario.json' ? padre : hijo) as unknown,
    );

    const run = resolved['run'] as Record<string, unknown>;
    expect(Object.hasOwn(run, '__proto__')).toBe(false);
    expect(JSON.stringify(resolved)).not.toContain('__proto__');
    // `Object.assign` sí invoca el setter: con la clave propia dentro, esto reemplazaba el prototipo.
    expect(Object.getPrototypeOf(Object.assign({}, run))).toBe(Object.prototype);
    expect(run['duration']).toBe(3600);
  });

  test('el escenario malicioso carga y valida como si esas claves no estuvieran', () => {
    const scenario = loadResolvedScenario('hijo.scenario.json', read);

    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
    expect(({} as Record<string, unknown>)['y']).toBeUndefined();
    expect((scenario as unknown as Record<string, unknown>)['x']).toBeUndefined();
    expect(Object.hasOwn(scenario, 'constructor')).toBe(false);
    expect(scenario.name).toBe('padre');
  });
});
