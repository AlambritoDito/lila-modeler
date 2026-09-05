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

/** IR de `pedidoIr()` con una tarea extra `taskId`, para probar avisos de distribución. */
function pedidoIrWithTask(taskId: string): ProcessIR {
  const ir = pedidoIr();
  return {
    ...ir,
    nodes: { ...ir.nodes, [taskId]: { type: 'task', name: '', incoming: [], outgoing: [] } },
  };
}
