/**
 * E22 / ADR-028 — routing conditioned on the case's previous outcome (`conditions`, R-COND-1…5).
 *
 * The credit card example duplicates the denial pair (`Task_DenyBureau`/`Task_InformBureauDenial`
 * and `Task_DenyDebt`/`Task_InformDebtDenial`) only because v1 could not tell the two rejections
 * apart once they merged. `fixtures/tarjeta-shared-denial.bpmn` is the same process with **one**
 * shared pair; the final XOR routes each case to its own end event by looking at which flow it
 * already took, and the acceptance is an exact equality: every case denied by the bureau ends in
 * `End_BureauRejected` and every case denied for debt in `End_DebtRejected`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import { parseBpmn } from '../src/bpmn/parse.js';
import { simulate } from '../src/index.js';
import type { ProcessIR } from '../src/core/ir.js';
import type { SimScenario } from '../src/core/sim.js';
import { ScenarioSchema, scenarioErrors, validateScenario } from '../src/scenario.js';

const xml = readFileSync(new URL('./fixtures/tarjeta-shared-denial.bpmn', import.meta.url), 'utf8');

async function sharedDenialIr(): Promise<ProcessIR> {
  const { ir } = await parseBpmn(xml);
  return ir!;
}

/**
 * The AS-IS parameters of `examples/tarjeta-credito`, with two deliberate differences: the run
 * stops by `triggerCount` instead of `run.duration` (R-ARR-3), and there is no calendar. Both
 * make the heap drain, so no case is cut in flight and the end events can be compared **exactly**
 * against the flows that decided them.
 */
const BASE = {
  version: 1 as const,
  name: 'shared denial',
  model: 'model.bpmn',
  run: { start: '2026-09-07T08:00:00-06:00', replications: 1, seed: 42 },
  resources: {
    executive: { capacity: 3, costPerHour: 100 },
    analyst: { capacity: 2, costPerHour: 120 },
    operator: { capacity: 1, costPerHour: 80 },
  },
  elements: {
    StartEvent_Application: {
      interTriggerTimer: { type: 'exponential' as const, mean: 360 },
      triggerCount: 200,
    },
    Task_FillApplication: {
      processingTime: { type: 'constant' as const, value: 300 },
      resources: [{ ref: 'executive' }],
    },
    Task_CopyId: {
      processingTime: { type: 'constant' as const, value: 120 },
      resources: [{ ref: 'executive' }],
    },
    Task_CheckBureau: {
      processingTime: { type: 'constant' as const, value: 60 },
      resources: [{ ref: 'analyst' }],
    },
    Flow_BureauBad: { probability: 0.4 },
    Flow_BureauGood: { probability: 0.6 },
    Task_AssessDebt: {
      processingTime: { type: 'constant' as const, value: 1200 },
      resources: [{ ref: 'analyst' }],
    },
    Flow_DebtNotEligible: { probability: 0.3 },
    Flow_DebtEligible: { probability: 0.7 },
    Task_Deny: {
      processingTime: { type: 'constant' as const, value: 120 },
      resources: [{ ref: 'analyst' }],
    },
    Task_Inform: {
      processingTime: { type: 'constant' as const, value: 60 },
      resources: [{ ref: 'executive' }],
    },
    Task_OpenAccount: {
      processingTime: { type: 'constant' as const, value: 180 },
      resources: [{ ref: 'analyst' }],
    },
    Task_ComputePaymentCapacity: {
      processingTime: { type: 'constant' as const, value: 120 },
      resources: [{ ref: 'analyst' }],
    },
    Task_AssignCreditLimit: {
      processingTime: { type: 'constant' as const, value: 60 },
      resources: [{ ref: 'analyst' }],
    },
    Task_PrintCard: {
      processingTime: { type: 'constant' as const, value: 600 },
      resources: [{ ref: 'operator' }],
    },
    Task_DeliverCard: {
      processingTime: { type: 'constant' as const, value: 300 },
      resources: [{ ref: 'executive' }],
    },
  },
};

/** The scenario with whatever `Gateway_Cause` should route by, parsed and linted like a real one. */
function scenarioWith(cause: Record<string, unknown>): ReturnType<typeof ScenarioSchema.parse> {
  return ScenarioSchema.parse({ ...BASE, elements: { ...BASE.elements, ...cause } });
}

const POR_CAUSA = {
  Flow_CauseBureau: { conditions: [{ flowTaken: 'Flow_BureauBad', probability: 1 }] },
  Flow_CauseDebt: { conditions: [{ flowTaken: 'Flow_DebtNotEligible', probability: 1 }] },
};

describe('R-COND-1…5 — the shared denial pair told apart by the flow already taken', () => {
  test('every case ends in the end event of the gateway that denied it', async () => {
    const ir = await sharedDenialIr();
    const scenario = scenarioWith(POR_CAUSA);
    expect(scenarioErrors(validateScenario(scenario, ir))).toEqual([]);

    const result = simulate(ir, scenario as unknown as SimScenario);

    expect(result.flows['Flow_BureauBad']!.count).toBeGreaterThan(0);
    expect(result.flows['Flow_DebtNotEligible']!.count).toBeGreaterThan(0);
    expect(result.elements['End_BureauRejected']!.completed).toBe(result.flows['Flow_BureauBad']!.count);
    expect(result.elements['End_DebtRejected']!.completed).toBe(result.flows['Flow_DebtNotEligible']!.count);
    // And the shared pair really is shared: it ran once per denied case, whatever the cause.
    expect(result.elements['Task_Deny']!.completed).toBe(
      result.flows['Flow_BureauBad']!.count + result.flows['Flow_DebtNotEligible']!.count,
    );
  });

  test('without conditions the same model splits the denials 50/50, which is the v1 ceiling', async () => {
    const ir = await sharedDenialIr();
    const result = simulate(ir, scenarioWith({}) as unknown as SimScenario);
    // No probability anywhere on Gateway_Cause: R-XOR-1, an even split that ignores the cause.
    expect(result.elements['End_BureauRejected']!.completed).not.toBe(
      result.flows['Flow_BureauBad']!.count,
    );
  });

  test('a condition and a plain probability normalise once per signature, not once per case', async () => {
    const ir = await sharedDenialIr();
    const scenario = scenarioWith({
      Flow_CauseBureau: { conditions: [{ flowTaken: 'Flow_BureauBad', probability: 0.5 }] },
      Flow_CauseDebt: { probability: 0.9 },
    });
    const result = simulate(ir, scenario as unknown as SimScenario);

    // Two signatures: `-1,-1` (sum 0.9 + the even share) and `0,-1` (sum 1.4). Only the second
    // normalises, and its warning is aggregated, never one line per token.
    const normalizadas = result.warnings.filter((w) => w.includes('W-XOR-NORMALIZADA'));
    expect(normalizadas).toHaveLength(1);
    expect(normalizadas[0]).toContain('Gateway_Cause');
    expect(result.elements['End_BureauRejected']!.completed).toBeGreaterThan(0);
    expect(result.elements['End_DebtRejected']!.completed).toBeGreaterThan(0);
  });
});

describe('the lint of `conditions` (ADR-028)', () => {
  test('a flowTaken that is not in the model is E-REF-DESCONOCIDA under its own path', async () => {
    const ir = await sharedDenialIr();
    const problems = validateScenario(
      scenarioWith({ Flow_CauseBureau: { conditions: [{ flowTaken: 'Flow_Nope', probability: 1 }] } }),
      ir,
    );
    expect(problems).toContainEqual({
      code: 'E-REF-DESCONOCIDA',
      path: 'elements.Flow_CauseBureau.conditions[0].flowTaken',
      severity: 'error',
      message: 'elements.Flow_CauseBureau.conditions[0].flowTaken: the sequence flow Flow_Nope does not exist in the model.',
    });
  });

  test('a flowTaken downstream of the gateway can never precede it: W-COND-INALCANZABLE', async () => {
    const ir = await sharedDenialIr();
    const problems = validateScenario(
      scenarioWith({
        Flow_CauseBureau: { conditions: [{ flowTaken: 'Flow_CauseDebt', probability: 1 }] },
      }),
      ir,
    );
    expect(problems).toContainEqual({
      code: 'W-COND-INALCANZABLE',
      path: 'elements.Flow_CauseBureau.conditions[0].flowTaken',
      severity: 'warning',
      message:
        'elements.Flow_CauseBureau.conditions[0].flowTaken: Flow_CauseDebt cannot be reached before Gateway_Cause on any sequential path; the condition only applies if a parallel branch traverses it.',
    });
    // It is a warning: the scenario still runs.
    expect(scenarioErrors(problems)).toEqual([]);
  });

  test('a probability outside [0,1] is E-PROB-RANGO under the condition, like any other', async () => {
    const ir = await sharedDenialIr();
    const problems = validateScenario(
      scenarioWith({ Flow_CauseBureau: { conditions: [{ flowTaken: 'Flow_BureauBad', probability: 2 }] } }),
      ir,
    );
    expect(problems).toContainEqual({
      code: 'E-PROB-RANGO',
      path: 'elements.Flow_CauseBureau.conditions[0].probability',
      severity: 'error',
      message: 'elements.Flow_CauseBureau.conditions[0].probability: 2 is outside [0, 1].',
    });
  });

  test('on a task it is still the reserved field of §15, with the same text as always', async () => {
    const ir = await sharedDenialIr();
    const problems = validateScenario(
      scenarioWith({ Task_Deny: { conditions: [{ flowTaken: 'Flow_BureauBad', probability: 1 }] } }),
      ir,
    );
    expect(problems).toContainEqual({
      code: 'E-RESERVADO',
      path: 'elements.Task_Deny.conditions',
      severity: 'error',
      message: 'elements.Task_Deny.conditions: reserved field, not supported by the simulator in v1.',
    });
  });

  test('on a flow that does not leave a diverging XOR it is E-CAMPO-NO-APLICA', async () => {
    const ir = await sharedDenialIr();
    const problems = validateScenario(
      scenarioWith({
        Flow_Deny_Inform: { conditions: [{ flowTaken: 'Flow_BureauBad', probability: 1 }] },
      }),
      ir,
    );
    expect(problems).toContainEqual({
      code: 'E-CAMPO-NO-APLICA',
      path: 'elements.Flow_Deny_Inform.conditions',
      severity: 'error',
      message:
        'elements.Flow_Deny_Inform.conditions: only accepted on a sequence flow leaving a diverging exclusive gateway.',
    });
  });
});
