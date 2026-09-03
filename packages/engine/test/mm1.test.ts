import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { erlangC } from '../../../tools/oracles/erlang_c.js';

// LILA-011: los valores de expected.json son reproducibles corriendo
// tools/oracles/erlang_c.ts con los mismos parámetros que citan
// scenario.json y examples/mm1/README.md.

const here = dirname(fileURLToPath(import.meta.url));
const mm1Dir = resolve(here, '../../../examples/mm1');

const cases = ['mm1-rho08', 'mm3'] as const;

describe.each(cases)('examples/mm1/%s', (dir) => {
  const caseDir = resolve(mm1Dir, dir);
  const bpmnXml = readFileSync(resolve(caseDir, 'model.bpmn'), 'utf8');
  const scenario = JSON.parse(readFileSync(resolve(caseDir, 'scenario.json'), 'utf8'));
  const expected = JSON.parse(readFileSync(resolve(caseDir, 'expected.json'), 'utf8'));

  test('el .bpmn es una sola tarea con start y end', () => {
    expect(bpmnXml).toContain('id="StartEvent_Llegadas"');
    expect(bpmnXml).toContain('id="Task_Servicio"');
    expect(bpmnXml).toContain('id="EndEvent_Fin"');
    expect([...bpmnXml.matchAll(/<bpmn:task\s+id="/g)]).toHaveLength(1);
  });

  test('scenario.json sigue SCENARIO_FORMAT.md y coincide con expected.json#params', () => {
    expect(scenario.version).toBe(1);
    expect(scenario.model).toBe('model.bpmn');
    // R6: al menos uno de run.duration o triggerCount.
    expect(scenario.run.duration).toBeGreaterThan(0);
    expect(scenario.elements.StartEvent_Llegadas.triggerCount).toBeGreaterThan(0);

    const lambda = 1 / scenario.elements.StartEvent_Llegadas.interTriggerTimer.mean;
    const mu = 1 / scenario.elements.Task_Servicio.processingTime.mean;
    const c = scenario.resources.servidor.capacity;

    expect(lambda).toBeCloseTo(expected.params.lambda, 10);
    expect(mu).toBeCloseTo(expected.params.mu, 10);
    expect(c).toBe(expected.params.c);
  });

  test('erlangC(params) reproduce expected.json#values', () => {
    const result = erlangC(expected.params);
    expect(result.utilization).toBeCloseTo(expected.values.utilization, 10);
    expect(result.probWait).toBeCloseTo(expected.values.probWait, 10);
    expect(result.wq).toBeCloseTo(expected.values.wqSeconds, 6);
    expect(result.lq).toBeCloseTo(expected.values.lqCustomers, 6);
    expect(result.l).toBeCloseTo(expected.values.lCustomers, 6);
    expect(result.w).toBeCloseTo(expected.values.wSeconds, 6);
  });

  test('rho = 0.8', () => {
    expect(expected.values.utilization).toBeCloseTo(0.8, 6);
  });
});

test('erlangC con c=1 coincide con las fórmulas cerradas de M/M/1', () => {
  const lambda = 1 / 375;
  const mu = 1 / 300;
  const rho = lambda / mu;
  const result = erlangC({ lambda, mu, c: 1 });

  expect(result.rho).toBeCloseTo(rho, 10);
  expect(result.wq).toBeCloseTo(rho / (mu * (1 - rho)), 6); // Wq = rho / (mu (1-rho))
  expect(result.lq).toBeCloseTo((rho * rho) / (1 - rho), 6); // Lq = rho^2 / (1-rho)
  expect(result.l).toBeCloseTo(rho / (1 - rho), 6); // L = rho / (1-rho)
  expect(result.probWait).toBeCloseTo(rho, 10); // P(wait) = rho en M/M/1
});
