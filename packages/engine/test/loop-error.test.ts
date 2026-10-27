/**
 * #700 × #702 (ADR-033 R-LOOP-2, R-ERR-1): a looping task with an error boundary. Each completed
 * iteration decides its error first; on error the loop ends without drawing `#loop` and the token
 * leaves through the boundary. Written when the two PRs were merged into `lote/1.0`.
 */
import { describe, expect, test } from 'vitest';

import { parseBpmn } from '../src/bpmn/parse.js';
import { validate } from '../src/bpmn/validate.js';
import type { SimScenario } from '../src/core/sim.js';
import { simulate } from '../src/index.js';
import { ScenarioSchema, scenarioErrors, validateScenario } from '../src/scenario.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_LoopError" isExecutable="true">
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="Flow_In" sourceRef="Start" targetRef="Task_Review" />
    <bpmn:task id="Task_Review"><bpmn:standardLoopCharacteristics /></bpmn:task>
    <bpmn:sequenceFlow id="Flow_Out" sourceRef="Task_Review" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:boundaryEvent id="Err" attachedToRef="Task_Review"><bpmn:errorEventDefinition /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_Err" sourceRef="Err" targetRef="End_Err" />
    <bpmn:endEvent id="End_Err" />
  </bpmn:process>
</bpmn:definitions>`;

async function runWith(errorProbability: number, cases = 1) {
  const { ir, unsupported } = await parseBpmn(XML);
  expect(validate(ir, { unsupported }).errors).toEqual([]);
  const scenario = ScenarioSchema.parse({
    version: 1,
    name: 'Loop and error',
    model: 'model.bpmn',
    run: { start: '2026-09-07T08:00:00-06:00', seed: 7 },
    elements: {
      Start: { triggerCount: cases },
      Task_Review: { processingTime: { type: 'constant', value: 10 }, loop: { count: 3 } },
      Err: { errorProbability },
    },
  });
  expect(scenarioErrors(validateScenario(scenario, ir))).toEqual([]);
  return simulate(ir, scenario as unknown as SimScenario);
}

describe('a looping task with an error boundary', () => {
  test('an error on the first iteration ends the loop and leaves through the boundary', async () => {
    const result = await runWith(1);
    expect(result.elements.Task_Review).toMatchObject({ started: 1, completed: 1 });
    expect(result.elements.End_Err).toMatchObject({ completed: 1 });
    expect(result.elements.End?.completed ?? 0).toBe(0);
  });

  test('with no error every iteration runs and the token leaves through the normal flow', async () => {
    const result = await runWith(0);
    expect(result.elements.Task_Review).toMatchObject({ started: 3, completed: 3 });
    expect(result.elements.End).toMatchObject({ completed: 1 });
    expect(result.elements.End_Err?.completed ?? 0).toBe(0);
  });

  test('a share of the iterations errs: never more than three iterations, every case ends once', async () => {
    const cases = 400;
    const result = await runWith(0.3, cases);
    const ended = (result.elements.End?.completed ?? 0) + (result.elements.End_Err?.completed ?? 0);
    expect(ended).toBe(cases);
    // With p = 0.3 per iteration, P(no error in 3) = 0.343; mean iterations = 1 + 0.7 + 0.49 = 2.19.
    const iterations = result.elements.Task_Review!.completed / cases;
    expect(iterations).toBeGreaterThan(2.19 - 0.12);
    expect(iterations).toBeLessThan(2.19 + 0.12);
    expect(result.elements.End!.completed / cases).toBeCloseTo(0.343, 1);
  });
});
