/**
 * LILA-042 — lint de escenario.
 *
 * Casos que `validateScenario` en main (LILA-013…041) ya cubría, verificados aquí para no
 * duplicar cobertura: R3 (elements sobrantes = warning, faltantes = error;
 * `scenario.test.ts` línea ~128 y ~143), R9 refs colgantes a pools y calendarios
 * (`scenario.test.ts` línea ~191). Este archivo cubre lo que faltaba: R10 (probabilidades de un
 * XOR), R11 (`normal` con masa negativa), R-CAL-2 (`E-CAL-VACIO`) y el hallazgo heredado de
 * `run.start` con fecha civil inexistente.
 */
import { describe, expect, test } from 'vitest';

import type { ProcessIR } from '../src/core/ir.js';
import { runReplication, type SimScenario } from '../src/core/sim.js';
import { RunSchema, ScenarioSchema, scenarioErrors, validateScenario } from '../src/scenario.js';
import { pedidoIr } from './pedido.fixtures.js';

/** IR mínimo: un start y un XOR con `outs` salidas (una por end), para ejercitar R-XOR-1…5. */
function xorIr(outs: readonly string[] = ['Flow_A', 'Flow_B', 'Flow_C']): ProcessIR {
  const node = (type: ProcessIR['nodes'][string]['type'], outgoing: string[] = []) => ({
    type,
    name: '',
    incoming: [],
    outgoing,
  });
  const flows: ProcessIR['flows'] = {
    Flow_Start: { from: 'Start', to: 'Gateway_X', name: '', isDefault: false },
  };
  const nodes: ProcessIR['nodes'] = {
    Start: node('start', ['Flow_Start']),
    Gateway_X: node('xor', [...outs]),
  };
  for (const [i, flowId] of outs.entries()) {
    const endId = `End_${i}`;
    flows[flowId] = { from: 'Gateway_X', to: endId, name: '', isDefault: false };
    nodes[endId] = node('end');
  }
  return {
    id: 'Process_Xor',
    name: 'Xor',
    nodes,
    flows,
    source: { exporter: 'test', exporterVersion: '1', originalIds: {} },
  };
}

const BASE = {
  version: 1 as const,
  name: 'xor',
  model: 'model.bpmn',
  run: { start: '2026-09-07T08:00:00-06:00', duration: 3600 },
};

describe('R10 — probabilidades de un XOR (LILA-042)', () => {
  test('dos salidas cuyas probabilidades no suman 1: warning + normalización, cita el gateway', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      elements: { Flow_A: { probability: 0.5 }, Flow_B: { probability: 0.3 } },
    });
    // Gateway de exactamente dos salidas, ambas declaradas: sin flujo que absorba el residuo,
    // la suma se queda en 0.8 y toca normalizar.
    const problems = validateScenario(scenario, xorIr(['Flow_A', 'Flow_B']));

    const warning = problems.find((p) => p.code === 'W-XOR-NORMALIZADA');
    expect(warning).toMatchObject({ severity: 'warning', path: 'elements.Gateway_X' });
    expect(warning?.message).toContain('Gateway_X');
    expect(warning?.message).toContain('0.8');
    expect(scenarioErrors(problems)).toEqual([]);
  });

  test('dos o más salidas sin probability: el residuo se reparte con aviso, cita gateway y flujos', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      elements: { Flow_A: { probability: 0.4 } }, // Flow_B y Flow_C sin declarar
    });
    const problems = validateScenario(scenario, xorIr());

    const warning = problems.find((p) => p.code === 'W-XOR-RESIDUO-COMPARTIDO');
    expect(warning?.severity).toBe('warning');
    expect(warning?.message).toContain('Gateway_X');
    expect(warning?.message).toContain('Flow_B');
    expect(warning?.message).toContain('Flow_C');
  });

  test('una sola salida sin probability no genera aviso: recibe el residuo completo (R-XOR-2)', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      elements: {
        Flow_A: { probability: 0.6 },
        Flow_B: { probability: 0.4 },
        // Flow_C sin declarar: |U| = 1, recibe max(0, 1 - 1) = 0, sin aviso.
      },
    });
    const problems = validateScenario(scenario, xorIr());
    expect(problems.filter((p) => p.code.startsWith('W-XOR') || p.code === 'E-XOR-SUMA-CERO')).toEqual([]);
  });

  test('probabilidades que suman 0: error E-XOR-SUMA-CERO citando el gateway', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      elements: { Flow_A: { probability: 0 }, Flow_B: { probability: 0 }, Flow_C: { probability: 0 } },
    });
    const errors = scenarioErrors(validateScenario(scenario, xorIr()));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'E-XOR-SUMA-CERO', path: 'elements.Gateway_X' });
    expect(errors[0]?.message).toContain('Gateway_X');
  });

  test('sin ninguna probability declarada: reparto equitativo, sin avisos (R-XOR-1)', () => {
    const scenario = ScenarioSchema.parse({ ...BASE, elements: {} });
    const problems = validateScenario(scenario, xorIr());
    expect(problems.filter((p) => p.code.startsWith('W-XOR') || p.code === 'E-XOR-SUMA-CERO')).toEqual([]);
  });

  test('un gateway que ningún caso visitaría también se lintea (no hace falta simular)', () => {
    // Mismo escenario de suma cero, pero sin ninguna llegada: la validación no simula.
    const scenario = ScenarioSchema.parse({
      version: 1,
      name: 'xor sin start',
      model: 'model.bpmn',
      run: { start: '2026-09-07T08:00:00-06:00', duration: 3600 },
      elements: { Flow_A: { probability: 0 }, Flow_B: { probability: 0 }, Flow_C: { probability: 0 } },
    });
    const errors = scenarioErrors(validateScenario(scenario, xorIr()));
    expect(errors.map((e) => e.code)).toContain('E-XOR-SUMA-CERO');
  });
});

describe('R11 — avisos de distribución (LILA-042)', () => {
  test('normal con P(x<0) > 1 % produce warning con el id y la probabilidad', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      elements: {
        Task_Riesgo: { processingTime: { type: 'normal', mean: 10, sd: 20 } },
      },
    });
    const ir = pedidoIrWithTask('Task_Riesgo');
    const problems = validateScenario(scenario, ir);

    const warning = problems.find((p) => p.code === 'W-NORMAL-NEGATIVA');
    expect(warning).toMatchObject({ severity: 'warning', path: 'elements.Task_Riesgo.processingTime' });
    expect(warning?.message).toContain('Task_Riesgo');
    expect(warning?.message).toMatch(/%/);
  });

  test('normal con masa negativa despreciable no produce warning', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      elements: { Task_Ok: { processingTime: { type: 'normal', mean: 480, sd: 90 } } },
    });
    const ir = pedidoIrWithTask('Task_Ok');
    expect(validateScenario(scenario, ir).some((p) => p.code === 'W-NORMAL-NEGATIVA')).toBe(false);
  });
});

describe('R-CAL-2 — E-CAL-VACIO (LILA-042)', () => {
  test('un calendario sin intervalos lo rechaza el esquema citando el código de catálogo', () => {
    const raw = {
      ...BASE,
      calendars: { vacio: { intervals: [] } },
    };
    const result = ScenarioSchema.safeParse(raw);
    expect(result.success).toBe(false);
    const issue = result.error?.issues.find((i) => i.path.join('.') === 'calendars.vacio.intervals');
    expect(issue?.message).toContain('E-CAL-VACIO');
  });
});

describe('R9 — calendario colgante en un start (LILA-042)', () => {
  test('elements[start].calendar apuntando a un calendario inexistente es error', () => {
    // `elements[id].calendar` (§ 2.5) no distingue tipo de nodo: un start lo admite igual que
    // una tarea (R-EVT-3, R-ARR-6 usan `calendar` en el start para las llegadas).
    const scenario = ScenarioSchema.parse({
      ...BASE,
      elements: { Start: { calendar: 'inexistente' } },
    });

    const errors = scenarioErrors(validateScenario(scenario, xorIr()));
    const calendarError = errors.find((e) => e.path === 'elements.Start.calendar');
    expect(calendarError?.code).toBe('E-REF-DESCONOCIDA');
    expect(calendarError?.message).toContain('Start');
    expect(calendarError?.message).toContain('inexistente');
  });
});

describe('run.start — fecha civil inexistente (hallazgo QA #37/#40, LILA-042)', () => {
  test.each(['2026-02-31T08:00:00-06:00', '2026-13-01T08:00:00-06:00', '2026-04-31T08:00:00-06:00'])(
    '%s se rechaza citando el valor',
    (start) => {
      const result = RunSchema.safeParse({ start, duration: 3600 });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain(start);
    },
  );

  test('2026-02-29 (no bisiesto) se rechaza; 2028-02-29 (bisiesto) se acepta', () => {
    expect(RunSchema.safeParse({ start: '2026-02-29T08:00:00-06:00', duration: 3600 }).success).toBe(false);
    expect(RunSchema.safeParse({ start: '2028-02-29T08:00:00-06:00', duration: 3600 }).success).toBe(true);
  });

  test('una fecha civil válida sigue aceptándose', () => {
    expect(RunSchema.safeParse({ start: '2026-09-07T08:00:00-06:00', duration: 3600 }).success).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * QA de LILA-042 — añadidos por el agente de QA adversarial
 * ------------------------------------------------------------------ */

describe('R10 — el lint y el motor no duplican el mismo aviso (QA LILA-042)', () => {
  /**
   * `cli.ts::resultWithBoundaryWarnings` funde los avisos del lint y los del motor en un
   * `Set<string>` de `${code}: ${message}`. Si los dos textos no son idénticos, el mismo aviso
   * sale dos veces en consola y en `RunResult.warnings[]`. Este test fija la igualdad byte a byte.
   */
  const ir = xorIr(['Flow_A', 'Flow_B']);
  const simScenario: SimScenario = {
    run: { seed: 1 },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 20 },
      Flow_A: { probability: 0.5 },
      Flow_B: { probability: 0.3 },
    },
  };

  test('W-XOR-NORMALIZADA: el texto del lint es el del motor, así que el Set de la CLI lo funde', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      elements: { Flow_A: { probability: 0.5 }, Flow_B: { probability: 0.3 } },
    });
    const lint = validateScenario(scenario, ir).find((p) => p.code === 'W-XOR-NORMALIZADA');
    const motor = runReplication(ir, simScenario).warnings.filter((w) => w.startsWith('W-XOR-NORMALIZADA'));

    expect(motor).toHaveLength(1);
    expect(`${lint?.code}: ${lint?.message}`).toBe(motor[0]);
    expect(new Set([`${lint?.code}: ${lint?.message}`, ...motor]).size).toBe(1);
    // El `path` sí conserva el prefijo: es lo que consume el panel y el JSON de problemas.
    expect(lint?.path).toBe('elements.Gateway_X');
  });

  test('W-XOR-RESIDUO-COMPARTIDO: mismo trato', () => {
    const scenario = ScenarioSchema.parse({ ...BASE, elements: { Flow_A: { probability: 0.4 } } });
    const outs = ['Flow_A', 'Flow_B', 'Flow_C'];
    const lint = validateScenario(scenario, xorIr(outs)).find((p) => p.code === 'W-XOR-RESIDUO-COMPARTIDO');
    const motor = runReplication(xorIr(outs), {
      run: { seed: 1 },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 20 },
        Flow_A: { probability: 0.4 },
      },
    }).warnings.filter((w) => w.startsWith('W-XOR-RESIDUO-COMPARTIDO'));

    expect(motor).toHaveLength(1);
    expect(`${lint?.code}: ${lint?.message}`).toBe(motor[0]);
  });
});

describe('R10 — casos límite del reparto (QA LILA-042)', () => {
  test('0.6 + 0.6 con un tercer flujo `isDefault`: el residuo es 0 y la suma 1.2 se normaliza', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      elements: { Flow_A: { probability: 0.6 }, Flow_B: { probability: 0.6 } },
    });
    const problems = validateScenario(scenario, xorIr());
    const warning = problems.find((p) => p.code === 'W-XOR-NORMALIZADA');
    expect(warning?.message).toContain('1.2');
    expect(scenarioErrors(problems)).toEqual([]);
  });

  test('un único flujo saliente con probability 0.5 se normaliza; con 0 es E-XOR-SUMA-CERO', () => {
    const uno = (probability: number) =>
      validateScenario(ScenarioSchema.parse({ ...BASE, elements: { Flow_A: { probability } } }), xorIr(['Flow_A']));
    expect(uno(0.5).find((p) => p.code === 'W-XOR-NORMALIZADA')?.message).toContain('0.5');
    expect(uno(0).map((p) => p.code)).toContain('E-XOR-SUMA-CERO');
  });

  test('0.1 + 0.2 + 0.7 no dispara el aviso: la tolerancia es 1e-9, no la igualdad exacta', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      elements: {
        Flow_A: { probability: 0.1 },
        Flow_B: { probability: 0.2 },
        Flow_C: { probability: 0.7 },
      },
    });
    expect(validateScenario(scenario, xorIr()).some((p) => p.code.startsWith('W-XOR'))).toBe(false);
  });
});

describe('R11 — el resto del catálogo de distribuciones (QA LILA-042)', () => {
  const conDistribucion = (dist: unknown) =>
    validateScenario(
      ScenarioSchema.parse({ ...BASE, elements: { Task_R: { processingTime: dist } } }),
      pedidoIrWithTask('Task_R'),
    );

  test('`user` cuyas probabilidades no suman 1 produce W-USER-NORMALIZADA con el id', () => {
    const warning = conDistribucion({
      type: 'user',
      points: [
        { value: 60, probability: 0.5 },
        { value: 120, probability: 0.3 },
      ],
    }).find((p) => p.code === 'W-USER-NORMALIZADA');

    expect(warning).toMatchObject({ severity: 'warning', path: 'elements.Task_R.processingTime' });
    expect(warning?.message).toContain('Task_R');
  });

  test('`truncatedNormal` con la misma masa negativa no avisa: el rechazo ya la excluye', () => {
    const problems = conDistribucion({ type: 'truncatedNormal', mean: 100, sd: 60, min: 0, max: 1000 });
    expect(problems.some((p) => p.code === 'W-NORMAL-NEGATIVA')).toBe(false);
  });

  test('el aviso también sale de `interTriggerTimer`, no solo de `processingTime`', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      elements: { Start: { interTriggerTimer: { type: 'normal', mean: 100, sd: 60 }, triggerCount: 5 } },
    });
    const warning = validateScenario(scenario, xorIr()).find((p) => p.code === 'W-NORMAL-NEGATIVA');
    expect(warning?.path).toBe('elements.Start.interTriggerTimer');
  });
});

describe('R3 — sobrante es aviso, faltante es error (QA LILA-042)', () => {
  test('una clave de `elements` que no está en el IR es error; un nodo del IR sin parámetros, aviso', () => {
    const scenario = ScenarioSchema.parse({ ...BASE, elements: { Fantasma: { fixedCost: 1 } } });
    const problems = validateScenario(scenario, xorIr(['Flow_A']));

    expect(problems.find((p) => p.path === 'elements.Fantasma')).toMatchObject({
      code: 'E-ELEMENTO-DESCONOCIDO',
      severity: 'error',
    });
    expect(problems.find((p) => p.path === 'elements.Gateway_X')).toMatchObject({
      code: 'W-ELEMENTO-SIN-PARAMETROS',
      severity: 'warning',
    });
  });
});

describe('R9 — las cuatro refs colgantes del ticket (QA LILA-042)', () => {
  test('pool inexistente, calendario de pool, de tarea y de start: un error por cada uno', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      calendars: { ok: { intervals: [{ days: ['MON'], from: '09:00', to: '18:00' }] } },
      resources: { pool: { capacity: 1, calendar: 'no-existe-1' } },
      elements: {
        Task_R: { calendar: 'no-existe-2', resources: [{ ref: 'fantasma' }] },
        StartEvent_Pedido: { calendar: 'no-existe-3' },
      },
    });
    const errors = scenarioErrors(validateScenario(scenario, pedidoIrWithTask('Task_R')));
    const byPath = Object.fromEntries(errors.map((e) => [e.path, e.code]));

    expect(byPath['resources.pool.calendar']).toBe('E-REF-DESCONOCIDA');
    expect(byPath['elements.Task_R.calendar']).toBe('E-REF-DESCONOCIDA');
    expect(byPath['elements.StartEvent_Pedido.calendar']).toBe('E-REF-DESCONOCIDA');
    expect(byPath['elements.Task_R.resources[0].ref']).toBe('E-REC-DESCONOCIDO');
    for (const error of errors) expect(error.message).toMatch(/no-existe-|fantasma/);
  });
});

describe('R16 — `capacity` por intervalos (LILA-164)', () => {
  const CAL = {
    dia: { intervals: [{ days: ['MON'], from: '08:00', to: '20:00' }] },
    noche: { intervals: [{ days: ['MON'], from: '20:00', to: '24:00' }] },
  };

  test('capacity por intervalos y calendar del pool son excluyentes', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      calendars: CAL,
      resources: { pool: { capacity: [{ calendar: 'dia', capacity: 3 }], calendar: 'noche' } },
      elements: { Task_R: { resources: [{ ref: 'pool' }] } },
    });
    const errors = scenarioErrors(validateScenario(scenario, pedidoIrWithTask('Task_R')));
    const problema = errors.find((e) => e.path === 'resources.pool.capacity');
    expect(problema?.code).toBe('E-CAPACIDAD-Y-CALENDARIO');
    expect(problema?.message).toMatch(/excluyentes/);
  });

  test('R9: el calendario de cada tramo tiene que existir, y el error cita el tramo', () => {
    const scenario = ScenarioSchema.parse({
      ...BASE,
      calendars: CAL,
      resources: {
        pool: { capacity: [{ calendar: 'dia', capacity: 3 }, { calendar: 'fantasma', capacity: 1 }] },
      },
      elements: { Task_R: { resources: [{ ref: 'pool' }] } },
    });
    const errors = scenarioErrors(validateScenario(scenario, pedidoIrWithTask('Task_R')));
    const byPath = Object.fromEntries(errors.map((e) => [e.path, e.code]));
    expect(byPath['resources.pool.capacity[1].calendar']).toBe('E-REF-DESCONOCIDA');
    expect(byPath['resources.pool.capacity[0].calendar']).toBeUndefined();
  });

  test('R-REC-2: `quantity` se valida contra el máximo de la semana, no contra la suma', () => {
    const escenario = (quantity: number) =>
      ScenarioSchema.parse({
        ...BASE,
        calendars: CAL,
        resources: {
          pool: { capacity: [{ calendar: 'dia', capacity: 3 }, { calendar: 'noche', capacity: 1 }] },
        },
        elements: { Task_R: { resources: [{ ref: 'pool', quantity }] } },
      });
    const ir = pedidoIrWithTask('Task_R');
    expect(scenarioErrors(validateScenario(escenario(3), ir))).toEqual([]);
    const error = scenarioErrors(validateScenario(escenario(4), ir)).find(
      (e) => e.path === 'elements.Task_R.resources[0].quantity',
    );
    // 3 + 1 = 4 unidades declaradas, pero nunca simultáneas: el tope es 3.
    expect(error?.code).toBe('E-REC-CANTIDAD');
    expect(error?.message).toMatch(/excede capacity 3/);
  });
});

describe('run.start — hora y offset inexistentes (QA LILA-042)', () => {
  /**
   * Todos estos pasaban el regex de R8 y dejaban `Date.parse` en `NaN`: las tres columnas ISO de
   * `log.csv` salían vacías en todas las filas, sin un solo aviso. `24:00` se rechaza aunque
   * ISO 8601 la admita: como instante de arranque es ambigua y `24:00:01` no la entiende nadie.
   */
  test.each([
    '2026-01-01T23:60:00-06:00',
    '2026-01-01T23:59:60-06:00',
    '2026-01-01T99:00:00-06:00',
    '2026-01-01T24:00:00-06:00',
    '2026-01-01T24:00:01-06:00',
    '2026-01-01T08:00:00+24:00',
    '2026-01-01T08:00:00-06:99',
  ])('%s se rechaza citando el valor', (start) => {
    const result = RunSchema.safeParse({ start, duration: 3600 });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain(start);
  });

  test('los límites siguen aceptándose: 23:59:59, medianoche, Z y un offset de media hora', () => {
    for (const start of [
      '2026-01-01T23:59:59-06:00',
      '2026-01-01T00:00:00-06:00',
      '2026-01-01T00:00Z',
      '2026-01-01T08:00:00+05:30',
      '2026-01-01T08:00:00.500-06:00',
    ]) {
      expect(RunSchema.safeParse({ start, duration: 3600 }).success).toBe(true);
    }
  });

  test('siglo bisiesto: 2100-02-29 se rechaza y 2000-02-29 se acepta', () => {
    expect(RunSchema.safeParse({ start: '2100-02-29T08:00:00-06:00', duration: 3600 }).success).toBe(false);
    expect(RunSchema.safeParse({ start: '2000-02-29T08:00:00-06:00', duration: 3600 }).success).toBe(true);
  });

  test('todo `run.start` aceptado es un instante que `Date.parse` sabe leer', () => {
    for (const start of [
      '2026-09-07T08:00:00-06:00',
      '2024-02-29T08:00:00-06:00',
      '2000-02-29T08:00:00-06:00',
      '2026-01-01T23:59:59+05:30',
      '2026-01-01T00:00Z',
    ]) {
      expect(RunSchema.safeParse({ start, duration: 3600 }).success).toBe(true);
      expect(Number.isNaN(Date.parse(start))).toBe(false);
    }
  });
});

/** IR de `pedidoIr()` con una tarea extra `taskId`, para probar avisos de distribución. */
function pedidoIrWithTask(taskId: string): ProcessIR {
  const ir = pedidoIr();
  return {
    ...ir,
    nodes: { ...ir.nodes, [taskId]: { type: 'task', name: '', incoming: [], outgoing: [] } },
  };
}
