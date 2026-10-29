/**
 * #702 — ADR-033 § 5 and § 6: the error boundary event on a task or an embedded sub-process
 * (R-ERR-1…5), and the timer boundary event on an embedded sub-process (R-BND-15…19).
 *
 * Every fixture is inline and synthetic (`docs/EXAMPLES_POLICY.md`). Constant times and one
 * replication wherever the expectation is hand-computed; the shares are checked on many cases.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { parseBpmn } from '../src/bpmn/parse.js';
import { validate } from '../src/bpmn/validate.js';
import { main } from '../src/cli.js';
import { flowOrder } from '../src/process-document.js';
import type { ProcessIR } from '../src/core/ir.js';
import type { EventLogRow, RunResult } from '../src/core/result.js';
import { simulate, type SimulationProgress } from '../src/core/run.js';
import type { SimScenario } from '../src/core/sim.js';
import { ScenarioSchema, validateScenario } from '../src/scenario.js';

const seconds = (value: number) => ({ type: 'constant' as const, value });

function definitions(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_1" isExecutable="true">
${body}
  </bpmn:process>
</bpmn:definitions>`;
}

async function irOf(xml: string): Promise<ProcessIR> {
  const { ir, unsupported } = await parseBpmn(xml);
  expect(validate(ir, { unsupported }).errors).toEqual([]);
  return ir;
}

const rowsOf = (result: RunResult, elementId: string): EventLogRow[] =>
  (result.log ?? []).filter((row) => row.elementId === elementId);

function runWithStop(ir: ProcessIR, scenario: SimScenario): { result: RunResult; stoppedAt: number } {
  let stoppedAt = 0;
  const onProgress = (progress: SimulationProgress): void => {
    stoppedAt = progress.simulatedTime;
  };
  return { result: simulate(ir, scenario, { onProgress }), stoppedAt };
}

/** Lint of a scenario against an IR, after the schema (as the CLI does). */
function lint(raw: unknown, ir: ProcessIR, locale: 'en' | 'es' = 'en') {
  return validateScenario(ScenarioSchema.parse(raw), ir, { locale });
}

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

/** Start → Work → End_Ok, with error boundaries `Err_A` (and `Err_B`) on `Work` → End_Err. */
const TASK_WITH_ERRORS = (extra = '') =>
  definitions(`
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F_Start" sourceRef="Start" targetRef="Work" />
    <bpmn:task id="Work" />
    <bpmn:sequenceFlow id="F_Ok" sourceRef="Work" targetRef="End_Ok" />
    <bpmn:endEvent id="End_Ok" />
    <bpmn:boundaryEvent id="Err_A" attachedToRef="Work"><bpmn:errorEventDefinition id="Def_A" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_A" sourceRef="Err_A" targetRef="End_Err" />
    ${extra}
    <bpmn:endEvent id="End_Err" />`);

const SECOND_ERROR = `
    <bpmn:boundaryEvent id="Err_B" attachedToRef="Work" cancelActivity="1"><bpmn:errorEventDefinition id="Def_B" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_B" sourceRef="Err_B" targetRef="End_Err" />`;

/** The same process without any boundary event. */
const TASK_ALONE = definitions(`
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F_Start" sourceRef="Start" targetRef="Work" />
    <bpmn:task id="Work" />
    <bpmn:sequenceFlow id="F_Ok" sourceRef="Work" targetRef="End_Ok" />
    <bpmn:endEvent id="End_Ok" />`);

/**
 * Start → Sub(T1 → T2) → After → End_Ok, with a boundary on `Sub` → Late → End_Late. `boundary` is
 * the boundary's event definition and attributes.
 */
const SUBPROCESS = (boundary: string, inside = '') =>
  definitions(`
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F_In" sourceRef="Start" targetRef="Sub" />
    <bpmn:subProcess id="Sub" name="Review">
      <bpmn:startEvent id="Sub_Start" />
      <bpmn:sequenceFlow id="S1" sourceRef="Sub_Start" targetRef="T1" />
      <bpmn:task id="T1" />
      <bpmn:sequenceFlow id="S2" sourceRef="T1" targetRef="T2" />
      <bpmn:task id="T2" />
      <bpmn:sequenceFlow id="S3" sourceRef="T2" targetRef="Sub_End" />
      <bpmn:endEvent id="Sub_End" />
      ${inside}
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F_Out" sourceRef="Sub" targetRef="After" />
    <bpmn:task id="After" />
    <bpmn:sequenceFlow id="F_After" sourceRef="After" targetRef="End_Ok" />
    <bpmn:endEvent id="End_Ok" />
    ${boundary}
    <bpmn:sequenceFlow id="F_Late" sourceRef="Deadline" targetRef="Late" />
    <bpmn:task id="Late" />
    <bpmn:sequenceFlow id="F_LateEnd" sourceRef="Late" targetRef="End_Late" />
    <bpmn:endEvent id="End_Late" />`);

const TIMER_ON_SUB = SUBPROCESS(
  `<bpmn:boundaryEvent id="Deadline" attachedToRef="Sub"><bpmn:timerEventDefinition id="Def_T" /></bpmn:boundaryEvent>`,
);
const NON_INTERRUPTING_ON_SUB = SUBPROCESS(
  `<bpmn:boundaryEvent id="Deadline" attachedToRef="Sub" cancelActivity="false"><bpmn:timerEventDefinition id="Def_T" /></bpmn:boundaryEvent>`,
);
const ERROR_ON_SUB = SUBPROCESS(
  `<bpmn:boundaryEvent id="Deadline" attachedToRef="Sub"><bpmn:errorEventDefinition id="Def_E" /></bpmn:boundaryEvent>`,
);

/* ------------------------------------------------------------------ *
 * Profile and IR
 * ------------------------------------------------------------------ */

describe('profile (ADR-033 § 5 and § 6)', () => {
  test('an interrupting error boundary on a task is an `errorBoundary` node, not `E-NOSOP`', async () => {
    const ir = await irOf(TASK_WITH_ERRORS(SECOND_ERROR));
    expect(ir.nodes['Err_A']).toMatchObject({ type: 'errorBoundary', attachedTo: 'Work', incoming: [], outgoing: ['F_A'] });
    expect(ir.nodes['Err_A']?.interrupting).toBeUndefined();
    expect(ir.nodes['Err_B']).toMatchObject({ type: 'errorBoundary', attachedTo: 'Work' });
    // No boundary on a sub-process: the IR does not gain `subprocesses`.
    expect(ir.subprocesses).toBeUndefined();
  });

  test('a non-interrupting error boundary, a bad `cancelActivity` literal or no way out stay `E-NOSOP`', async () => {
    const xml = definitions(`
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F_Start" sourceRef="Start" targetRef="Work" />
    <bpmn:task id="Work" />
    <bpmn:sequenceFlow id="F_Ok" sourceRef="Work" targetRef="End_Ok" />
    <bpmn:endEvent id="End_Ok" />
    <bpmn:boundaryEvent id="Err_Soft" attachedToRef="Work" cancelActivity="false"><bpmn:errorEventDefinition id="D1" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_Soft" sourceRef="Err_Soft" targetRef="End_Ok" />
    <bpmn:boundaryEvent id="Err_Typo" attachedToRef="Work" cancelActivity="TRUE"><bpmn:errorEventDefinition id="D2" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_Typo" sourceRef="Err_Typo" targetRef="End_Ok" />
    <bpmn:boundaryEvent id="Err_Nowhere" attachedToRef="Work"><bpmn:errorEventDefinition id="D3" /></bpmn:boundaryEvent>`);
    const { ir, unsupported } = await parseBpmn(xml);
    const nosop = validate(ir, { unsupported }).errors.filter((e) => e.code === 'E-NOSOP').map((e) => e.id);
    expect(nosop).toEqual(['Err_Soft', 'Err_Typo', 'Err_Nowhere']);
    expect(unsupported.find((u) => u.id === 'Err_Soft')?.construction).toBe('boundaryEvent');
  });

  test('a timer boundary on a sub-process is a `timer` attached to it, and the IR lists the passages', async () => {
    const ir = await irOf(TIMER_ON_SUB);
    expect(ir.nodes['Deadline']).toMatchObject({ type: 'timer', attachedTo: 'Sub', incoming: [] });
    expect(ir.nodes['Sub']).toBeUndefined();
    expect(ir.subprocesses).toEqual({ Sub: { entryFlows: ['F_In'], exitFlows: ['S3'] } });
  });

  test('nested sub-processes: a flow entering or leaving both is listed on both, with `parent`', async () => {
    const xml = definitions(`
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F_In" sourceRef="Start" targetRef="Outer" />
    <bpmn:subProcess id="Outer">
      <bpmn:startEvent id="O_Start" />
      <bpmn:sequenceFlow id="O1" sourceRef="O_Start" targetRef="Inner" />
      <bpmn:subProcess id="Inner">
        <bpmn:startEvent id="I_Start" />
        <bpmn:sequenceFlow id="I1" sourceRef="I_Start" targetRef="T" />
        <bpmn:task id="T" />
        <bpmn:sequenceFlow id="I2" sourceRef="T" targetRef="I_End" />
        <bpmn:endEvent id="I_End" />
      </bpmn:subProcess>
      <bpmn:sequenceFlow id="O2" sourceRef="Inner" targetRef="O_End" />
      <bpmn:endEvent id="O_End" />
      <bpmn:boundaryEvent id="Inner_Late" attachedToRef="Inner"><bpmn:timerEventDefinition id="DI" /></bpmn:boundaryEvent>
      <bpmn:sequenceFlow id="O3" sourceRef="Inner_Late" targetRef="O_End" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F_Out" sourceRef="Outer" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:boundaryEvent id="Outer_Late" attachedToRef="Outer"><bpmn:timerEventDefinition id="DO" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_Late" sourceRef="Outer_Late" targetRef="End" />`);
    const ir = await irOf(xml);
    expect(ir.subprocesses).toEqual({
      Outer: { entryFlows: ['F_In'], exitFlows: ['I2', 'O3'] },
      Inner: { parent: 'Outer', entryFlows: ['F_In'], exitFlows: ['I2'] },
    });
    expect(ir.nodes['Inner_Late']).toMatchObject({ attachedTo: 'Inner', subprocessId: 'Outer' });
  });

  test('a boundary on a sub-process with no exit flow stays `E-NOSOP` `boundaryEvent`, with its flow', async () => {
    const xml = definitions(`
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F_In" sourceRef="Start" targetRef="Sub" />
    <bpmn:subProcess id="Sub">
      <bpmn:startEvent id="Sub_Start" />
      <bpmn:sequenceFlow id="S1" sourceRef="Sub_Start" targetRef="T1" />
      <bpmn:task id="T1" />
      <bpmn:sequenceFlow id="S2" sourceRef="T1" targetRef="Sub_End" />
      <bpmn:endEvent id="Sub_End" />
    </bpmn:subProcess>
    <bpmn:boundaryEvent id="Deadline" attachedToRef="Sub"><bpmn:timerEventDefinition id="Def_T" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_Late" sourceRef="Deadline" targetRef="End_Late" />
    <bpmn:endEvent id="End_Late" />`);
    const { ir, unsupported } = await parseBpmn(xml);
    expect(ir.nodes['Deadline']).toBeUndefined();
    expect(ir.flows['F_Late']).toBeUndefined();
    expect(ir.subprocesses).toBeUndefined();
    expect(unsupported.map((u) => [u.id, u.construction])).toEqual([
      ['Deadline', 'boundaryEvent'],
      ['F_Late', undefined],
    ]);
    const errors = validate(ir, { unsupported }).errors.map((e) => `${e.code} ${e.id}`);
    expect(errors).toContain('E-NOSOP Deadline');
    expect(errors).toContain('E-INALCANZABLE End_Late');
  });

  test('the process document lists a sub-process boundary with the nodes inside its host', async () => {
    const order = flowOrder(await irOf(TIMER_ON_SUB));
    expect(order.indexOf('Deadline')).toBeLessThan(order.indexOf('End_Ok'));
    expect(order.indexOf('Deadline')).toBeGreaterThan(order.indexOf('T1'));
  });

  test('a boundary on a sub-process is reachable with its host: no `E-INALCANZABLE`', async () => {
    const { ir, unsupported } = await parseBpmn(ERROR_ON_SUB);
    expect(validate(ir, { unsupported }).errors).toEqual([]);
    expect(ir.nodes['Deadline']).toMatchObject({ type: 'errorBoundary', attachedTo: 'Sub' });
  });
});

/* ------------------------------------------------------------------ *
 * Scenario lint
 * ------------------------------------------------------------------ */

describe('scenario field `errorProbability` (ADR-033 § 5, § 1.6)', () => {
  const run = { start: '2026-10-26T08:00:00Z', seed: 1, duration: 100 };

  test('`E-PROB-ERROR-SUMA` cites the host, in both languages, with the sum printed plainly', async () => {
    const ir = await irOf(TASK_WITH_ERRORS(SECOND_ERROR));
    const raw = { version: 1, name: 's', run, elements: { Err_A: { errorProbability: 0.7 }, Err_B: { errorProbability: 0.45 } } };
    const en = lint(raw, ir).filter((p) => p.code === 'E-PROB-ERROR-SUMA');
    expect(en).toEqual([
      {
        code: 'E-PROB-ERROR-SUMA',
        path: 'elements.Work',
        severity: 'error',
        message: 'the error probabilities of the boundary events on Work add up to 1.15, more than 1 (elements.Work).',
      },
    ]);
    expect(lint(raw, ir, 'es').find((p) => p.code === 'E-PROB-ERROR-SUMA')?.message).toBe(
      'las probabilidades de error de los eventos adjuntos a Work suman 1.15, más de 1 (elements.Work).',
    );
    // A sum of exactly 1 (within 1e-9) is accepted.
    const exact = { ...raw, elements: { Err_A: { errorProbability: 0.7 }, Err_B: { errorProbability: 0.3 } } };
    expect(lint(exact, ir).filter((p) => p.code === 'E-PROB-ERROR-SUMA')).toEqual([]);
  });

  test('`core/` repeats the sum check before the first event', async () => {
    const ir = await irOf(TASK_WITH_ERRORS(SECOND_ERROR));
    const scenario: SimScenario = {
      run: { seed: 1 },
      elements: { Start: { triggerCount: 1 }, Err_A: { errorProbability: 0.6 }, Err_B: { errorProbability: 0.6 } },
    };
    const onProgress = vi.fn();
    expect(() => simulate(ir, scenario, { onProgress })).toThrow(
      'E-PROB-ERROR-SUMA: Work: the error probabilities of its boundary events add up to 1.2, more than 1.',
    );
    expect(onProgress).not.toHaveBeenCalled();
    expect(() => simulate(ir, scenario, { locale: 'es' })).toThrow(
      'E-PROB-ERROR-SUMA: Work: las probabilidades de error de sus eventos adjuntos suman 1.2, más de 1.',
    );
  });

  test('range, wrong element, and the fields the boundary refuses or ignores', async () => {
    const ir = await irOf(TASK_WITH_ERRORS());
    const raw = {
      version: 1,
      name: 's',
      run,
      resources: { pool: { capacity: 1 } },
      elements: {
        Err_A: { errorProbability: 1.5, resources: [{ ref: 'pool' }], processingTime: seconds(3), fixedCost: 9 },
        Work: { errorProbability: 0.1 },
      },
    };
    const problems = lint(raw, ir).map((p) => `${p.code} ${p.path}: ${p.message}`);
    expect(problems).toContain('E-PROB-RANGO elements.Err_A.errorProbability: 1.5 is outside [0, 1] (elements.Err_A.errorProbability).');
    expect(problems).toContain(
      'E-CAMPO-NO-APLICA elements.Err_A.resources: only a task can consume resources (elements.Err_A.resources).',
    );
    expect(problems).toContain(
      'E-CAMPO-NO-APLICA elements.Work.errorProbability: only accepted on an error boundary event (elements.Work.errorProbability).',
    );
    expect(lint(raw, ir, 'es').map((p) => p.message)).toContain(
      'solo se admite en un evento de error adjunto (elements.Work.errorProbability).',
    );
    // `processingTime` and `fixedCost` are accepted and change nothing (as on a throw event).
    expect(problems.filter((p) => p.includes('Err_A.processingTime') || p.includes('Err_A.fixedCost'))).toEqual([]);
  });

  test('on a sub-process host: `errorProbability` is `E-CAMPO-NO-APLICA`, and an outer one is still a sub-process', async () => {
    const ir = await irOf(ERROR_ON_SUB);
    const problems = lint({ version: 1, name: 's', run, elements: { Sub: { errorProbability: 0.2 } } }, ir);
    expect(problems.filter((p) => p.severity === 'error').map((p) => `${p.code} ${p.path}`)).toEqual([
      'E-CAMPO-NO-APLICA elements.Sub.errorProbability',
    ]);

    // `Outer` only contains `Inner`, so no node names it; `ir.subprocesses` does (R-PLAN-3).
    const nested = await irOf(definitions(`
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F_In" sourceRef="Start" targetRef="Outer" />
    <bpmn:subProcess id="Outer">
      <bpmn:startEvent id="O_Start" />
      <bpmn:sequenceFlow id="O1" sourceRef="O_Start" targetRef="Inner" />
      <bpmn:subProcess id="Inner">
        <bpmn:startEvent id="I_Start" />
        <bpmn:sequenceFlow id="I1" sourceRef="I_Start" targetRef="T" />
        <bpmn:task id="T" />
        <bpmn:sequenceFlow id="I2" sourceRef="T" targetRef="I_End" />
        <bpmn:endEvent id="I_End" />
      </bpmn:subProcess>
      <bpmn:sequenceFlow id="O2" sourceRef="Inner" targetRef="O_End" />
      <bpmn:endEvent id="O_End" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F_Out" sourceRef="Outer" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:boundaryEvent id="Outer_Late" attachedToRef="Outer"><bpmn:timerEventDefinition id="DO" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_Late" sourceRef="Outer_Late" targetRef="End" />`));
    const outer = lint({ version: 1, name: 's', run, elements: { Outer: { processingTime: seconds(5) } } }, nested);
    expect(outer.filter((p) => p.severity === 'error').map((p) => p.code)).toEqual(['E-SUBPROC-PARAMETRO']);
  });

  test('`W-ELEMENTO-SIN-PARAMETROS` does not apply to an error boundary', async () => {
    const ir = await irOf(TASK_WITH_ERRORS());
    const problems = lint({ version: 1, name: 's', run, elements: {} }, ir);
    expect(problems.filter((p) => p.path === 'elements.Err_A')).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Error boundary on a task (R-ERR-1, R-ERR-2, R-ERR-3, R-ERR-5)
 * ------------------------------------------------------------------ */

describe('error boundary on a task', () => {
  const CASES = 4000;
  const base = (elements: SimScenario['elements']): SimScenario => ({
    run: { seed: 7, replications: 1 },
    resources: { clerk: { capacity: 2, costPerHour: 3600 } },
    elements: {
      Start: { interTriggerTimer: seconds(10), triggerCount: CASES },
      Work: { processingTime: seconds(5), resources: [{ ref: 'clerk' }], fixedCost: 2 },
      ...elements,
    },
  });

  test('a share p of the completions leaves through the boundary; the work is not cancelled', async () => {
    const ir = await irOf(TASK_WITH_ERRORS());
    const result = simulate(ir, base({ Err_A: { errorProbability: 0.3 } }));
    const errors = result.elements['Err_A']!.completed;
    expect(Math.abs(errors / CASES - 0.3)).toBeLessThan(0.025);
    // R-ERR-5: one started and one completed per firing, no row of its own.
    expect(result.elements['Err_A']!.started).toBe(errors);
    expect(rowsOf(result, 'Err_A')).toEqual([]);
    // R-ERR-3: every instance did its work; the host's own flow does not count the errors.
    expect(result.elements['Work']).toMatchObject({ started: CASES, completed: CASES });
    expect(result.elements['Work']!.fixedCostTotal).toBe(2 * CASES);
    expect(rowsOf(result, 'Work').every((row) => row.status === 'completed' && row.endedAt === row.startedAt! + 5)).toBe(true);
    expect(result.flows['F_Ok']!.count).toBe(CASES - errors);
    expect(result.flows['F_A']!.count).toBe(errors);
    expect(result.process.byEndEvent['End_Err']!.completed).toBe(errors);
    // No double counting: 5 s at 1 €/s per instance, whatever the path.
    expect(result.resources['clerk']!.busyTime).toBe(5 * CASES);
    expect(result.process.totalCost).toBeCloseTo(CASES * (5 + 2), 6);
  });

  test('two boundaries: one draw per completion, walked in document order', async () => {
    const ir = await irOf(TASK_WITH_ERRORS(SECOND_ERROR));
    const result = simulate(ir, base({ Err_A: { errorProbability: 0.2 }, Err_B: { errorProbability: 0.5 } }));
    const a = result.elements['Err_A']!.completed / CASES;
    const b = result.elements['Err_B']!.completed / CASES;
    expect(Math.abs(a - 0.2)).toBeLessThan(0.025);
    expect(Math.abs(b - 0.5)).toBeLessThan(0.025);
    expect(result.flows['F_Ok']!.count + result.flows['F_A']!.count + result.flows['F_B']!.count).toBe(CASES);
  });

  test('probabilities adding up to 1 leave no normal path; p = 1 always fires', async () => {
    const ir = await irOf(TASK_WITH_ERRORS(SECOND_ERROR));
    const full = simulate(ir, base({ Err_A: { errorProbability: 0.25 }, Err_B: { errorProbability: 0.75 } }));
    expect(full.flows['F_Ok']!.count).toBe(0);
    const one = simulate(ir, base({ Err_A: { errorProbability: 1 } }));
    expect(one.elements['Err_A']!.completed).toBe(CASES);
    expect(one.elements['Err_B']!.completed).toBe(0);
  });

  test('determinism: same seed, same bytes; another seed moves the draws', async () => {
    const ir = await irOf(TASK_WITH_ERRORS());
    const scenario = base({ Err_A: { errorProbability: 0.3 } });
    const a = JSON.stringify(simulate(ir, scenario));
    expect(JSON.stringify(simulate(ir, scenario))).toBe(a);
    expect(JSON.stringify(simulate(ir, { ...scenario, run: { ...scenario.run, seed: 8 } }))).not.toBe(a);
  });

  test('degradation: no `errorProbability` never fires, warns, and draws nothing', async () => {
    const ir = await irOf(TASK_WITH_ERRORS());
    const scenario = base({});
    const result = simulate(ir, scenario);
    expect(result.elements['Err_A']).toMatchObject({ started: 0, completed: 0 });
    expect(result.warnings).toContain(
      `W-ERROR-SIN-PROBABILIDAD: Err_A: error boundary event without errorProbability; it never fires on Work. (${CASES} times)`,
    );
    expect(simulate(ir, scenario, { locale: 'es' }).warnings.some((w) =>
      w.startsWith('W-ERROR-SIN-PROBABILIDAD: Err_A: evento de error adjunto sin errorProbability; nunca dispara sobre Work.'),
    )).toBe(true);

    // The same process without the boundary gives the same log and the same numbers (R-DEG-5).
    const alone = simulate(await irOf(TASK_ALONE), scenario);
    expect(result.log).toEqual(alone.log);
    // The only difference is the outcome the boundary adds, with nothing in it.
    const { End_Err: unused, ...outcomes } = result.process.byEndEvent;
    expect(unused?.completed).toBe(0);
    expect({ ...result.process, byEndEvent: outcomes }).toEqual(alone.process);
    expect(result.resources).toEqual(alone.resources);
    expect(result.elements['Work']).toEqual(alone.elements['Work']);

    // `errorProbability: 0` draws from `Work#error` only: no other stream moves.
    const zero = simulate(ir, base({ Err_A: { errorProbability: 0 } }));
    expect(zero.log).toEqual(alone.log);
    expect(zero.warnings.some((w) => w.startsWith('W-ERROR-SIN-PROBABILIDAD'))).toBe(false);
  });

  test('the error stream is derived: random times elsewhere draw the same numbers with and without it', async () => {
    const ir = await irOf(TASK_WITH_ERRORS());
    const random = (elements: SimScenario['elements']): SimScenario => ({
      run: { seed: 3, replications: 1 },
      elements: {
        Start: { interTriggerTimer: { type: 'exponential', mean: 4 }, triggerCount: 300 },
        Work: { processingTime: { type: 'exponential', mean: 3 } },
        ...elements,
      },
    });
    const withErrors = simulate(ir, random({ Err_A: { errorProbability: 0.5 } }));
    const alone = simulate(await irOf(TASK_ALONE), random({}));
    // Every `Work` row (enabling, start, end) is the same: the draw of `Work#error` shifts nothing.
    expect(rowsOf(withErrors, 'Work')).toEqual(rowsOf(alone, 'Work'));
  });
});

/* ------------------------------------------------------------------ *
 * Timer boundary on a sub-process (R-BND-15 … R-BND-19)
 * ------------------------------------------------------------------ */

describe('timer boundary on a sub-process', () => {
  /**
   * Hand-computed. One unit of `team` (1 €/s) serves T1; T2 takes no resource. Cases arrive at
   * 0, 10 and 20; the deadline is 150 s after each case enters `Sub`.
   *
   * - Case 1: T1 0–100, T2 100–200, cut at 150 (T2 interrupted at 150).
   * - Case 2: queues until 100, T1 100–200, cut at 160 (T1 interrupted, unit released at 160).
   * - Case 3: queues until 160, T1 160–260, cut at 170 (T1 interrupted).
   *
   * `team` is busy 100 + 60 + 10 = 170 s and costs 170 €; nothing past a cut is counted.
   */
  const scenario: SimScenario = {
    run: { seed: 42, replications: 1 },
    resources: { team: { capacity: 1, costPerHour: 3600 } },
    elements: {
      Start: { interTriggerTimer: seconds(10), triggerCount: 3 },
      T1: { processingTime: seconds(100), resources: [{ ref: 'team' }], fixedCost: 5 },
      T2: { processingTime: seconds(100) },
      After: { processingTime: seconds(1) },
      Deadline: { processingTime: seconds(150) },
      Late: { processingTime: seconds(2) },
    },
  };

  test('a deadline shorter than the work always fires, cancels the work inside and frees its units', async () => {
    const ir = await irOf(TIMER_ON_SUB);
    const { result, stoppedAt } = runWithStop(ir, scenario);

    expect(rowsOf(result, 'T1').map((r) => [r.caseId, r.status, r.startedAt, r.endedAt, r.observedUntil, r.resourceCost, r.elementCost])).toEqual([
      ['1', 'completed', 0, 100, 100, 100, 5],
      ['2', 'interrupted', 100, null, 160, 60, 0],
      ['3', 'interrupted', 160, null, 170, 10, 0],
    ]);
    expect(rowsOf(result, 'T2').map((r) => [r.caseId, r.status, r.startedAt, r.observedUntil])).toEqual([
      ['1', 'interrupted', 100, 150],
    ]);
    expect(result.elements['T1']).toMatchObject({ started: 3, completed: 1 });
    expect(result.elements['T2']).toMatchObject({ started: 1, completed: 0 });
    // R-BND-19: the boundary counts a firing per instance and has no row.
    expect(result.elements['Deadline']).toMatchObject({ started: 3, completed: 3 });
    expect(rowsOf(result, 'Deadline')).toEqual([]);
    expect(result.elements['After']).toMatchObject({ started: 0, completed: 0 });
    expect(result.flows['S3']!.count).toBe(0);
    expect(result.flows['F_Late']!.count).toBe(3);
    expect(result.process.byEndEvent['End_Late']!.completed).toBe(3);
    expect(result.process.byEndEvent['End_Ok']!.completed).toBe(0);
    // No double counting in utilization or costs.
    expect(result.resources['team']!.busyTime).toBe(170);
    expect(result.process.totalCost).toBeCloseTo(170 + 5, 9);
    // Each case leaves at its cut and `Late` takes 2 s: the last one ends at 172.
    expect(result.process.cycleTime.max).toBe(152);
    expect(stoppedAt).toBe(172);
  });

  test('a deadline exactly as long as the work fires (the deadline is queued first)', async () => {
    const ir = await irOf(TIMER_ON_SUB);
    const result = simulate(ir, {
      run: { seed: 1, replications: 1 },
      elements: {
        Start: { triggerCount: 1 },
        T1: { processingTime: seconds(100) },
        T2: { processingTime: seconds(50) },
        Deadline: { processingTime: seconds(150) },
      },
    });
    expect(result.elements['Deadline']!.completed).toBe(1);
    expect(rowsOf(result, 'T2').map((r) => [r.status, r.observedUntil])).toEqual([['interrupted', 150]]);
    expect(result.process.byEndEvent['End_Late']!.completed).toBe(1);
  });

  test('a deadline longer than the work never fires and does not stretch the run', async () => {
    const ir = await irOf(TIMER_ON_SUB);
    const { result, stoppedAt } = runWithStop(ir, {
      run: { seed: 1, replications: 1 },
      elements: {
        Start: { triggerCount: 1 },
        T1: { processingTime: seconds(100) },
        T2: { processingTime: seconds(50) },
        After: { processingTime: seconds(10) },
        Deadline: { processingTime: seconds(1000) },
      },
    });
    expect(result.elements['Deadline']!.completed).toBe(0);
    expect(result.process.byEndEvent['End_Ok']!.completed).toBe(1);
    expect(result.flows['S3']!.count).toBe(1);
    expect(stoppedAt).toBe(160);
  });

  test('with random work longer than every deadline, every case leaves through the boundary', async () => {
    const ir = await irOf(TIMER_ON_SUB);
    const result = simulate(ir, {
      run: { seed: 11, replications: 1 },
      resources: { team: { capacity: 3 } },
      elements: {
        Start: { interTriggerTimer: { type: 'exponential', mean: 60 }, triggerCount: 500 },
        T1: { processingTime: { type: 'uniform', min: 100, max: 200 }, resources: [{ ref: 'team' }] },
        T2: { processingTime: { type: 'uniform', min: 100, max: 200 } },
        Deadline: { processingTime: { type: 'uniform', min: 50, max: 199 } },
      },
    });
    expect(result.elements['Deadline']!.completed).toBe(500);
    expect(result.flows['S3']!.count).toBe(0);
    expect(result.process.byEndEvent['End_Late']!.completed).toBe(500);
    expect(result.process.inFlight).toBe(0);
    // Every row inside is cut or completed, never left open, and the pool ends idle.
    const inside = [...rowsOf(result, 'T1'), ...rowsOf(result, 'T2')];
    expect(inside.every((r) => r.status === 'interrupted' || r.status === 'completed')).toBe(true);
    expect(result.elements['T2']!.completed).toBe(0);
  });

  test('a parallel branch inside is cancelled too, and its join counter discarded', async () => {
    const xml = SUBPROCESS(
      `<bpmn:boundaryEvent id="Deadline" attachedToRef="Sub"><bpmn:timerEventDefinition id="Def_T" /></bpmn:boundaryEvent>`,
    ).replace(
      `<bpmn:sequenceFlow id="S1" sourceRef="Sub_Start" targetRef="T1" />
      <bpmn:task id="T1" />
      <bpmn:sequenceFlow id="S2" sourceRef="T1" targetRef="T2" />
      <bpmn:task id="T2" />
      <bpmn:sequenceFlow id="S3" sourceRef="T2" targetRef="Sub_End" />`,
      `<bpmn:sequenceFlow id="S1" sourceRef="Sub_Start" targetRef="Fork" />
      <bpmn:parallelGateway id="Fork" />
      <bpmn:sequenceFlow id="P1" sourceRef="Fork" targetRef="T1" />
      <bpmn:sequenceFlow id="P2" sourceRef="Fork" targetRef="T2" />
      <bpmn:task id="T1" />
      <bpmn:task id="T2" />
      <bpmn:sequenceFlow id="P3" sourceRef="T1" targetRef="Join" />
      <bpmn:sequenceFlow id="P4" sourceRef="T2" targetRef="Join" />
      <bpmn:parallelGateway id="Join" />
      <bpmn:sequenceFlow id="S3" sourceRef="Join" targetRef="Sub_End" />`,
    );
    const ir = await irOf(xml);
    const result = simulate(ir, {
      run: { seed: 1, replications: 1 },
      elements: {
        Start: { triggerCount: 1 },
        T1: { processingTime: seconds(10) },
        T2: { processingTime: seconds(100) },
        Deadline: { processingTime: seconds(50) },
      },
    });
    // T1 finished and waits at the join; T2 is cut at 50. One token leaves; the case closes.
    expect(rowsOf(result, 'T2').map((r) => [r.status, r.observedUntil])).toEqual([['interrupted', 50]]);
    expect(result.elements['Join']).toMatchObject({ started: 1, completed: 0 });
    expect(result.process).toMatchObject({ completed: 1, inFlight: 0 });
    expect(result.warnings.some((w) => w.startsWith('W-JOIN-BLOQUEADO'))).toBe(false);
    expect(result.process.byEndEvent['End_Late']!.completed).toBe(1);
  });

  test('non-interrupting: fires once per instance, adds a token, and the sub-process keeps running', async () => {
    const ir = await irOf(NON_INTERRUPTING_ON_SUB);
    expect(ir.nodes['Deadline']).toMatchObject({ type: 'timer', attachedTo: 'Sub', interrupting: false });
    const result = simulate(ir, {
      run: { seed: 1, replications: 1 },
      elements: {
        Start: { triggerCount: 2 },
        T1: { processingTime: seconds(100) },
        T2: { processingTime: seconds(100) },
        Deadline: { processingTime: seconds(30) },
      },
    });
    expect(result.elements['Deadline']).toMatchObject({ started: 2, completed: 2 });
    expect(result.elements['T2']).toMatchObject({ started: 2, completed: 2 });
    expect(result.process.byEndEvent['End_Late']!.completed).toBe(0);
    // The case ends with its last token, at End_Ok (R-BND-14).
    expect(result.process.byEndEvent['End_Ok']!.completed).toBe(2);
    expect(result.process.cycleTime.max).toBe(200);
  });

  test('degradation: no `processingTime` on the boundary never fires and names the sub-process', async () => {
    const ir = await irOf(TIMER_ON_SUB);
    const result = simulate(ir, {
      run: { seed: 1, replications: 1 },
      elements: { Start: { triggerCount: 2 }, T1: { processingTime: seconds(10) } },
    });
    expect(result.elements['Deadline']!.completed).toBe(0);
    expect(result.warnings).toContain(
      'W-BORDE-SIN-TIEMPO: Deadline: boundary timer without processingTime; it never fires on Sub. (2 times)',
    );
    expect(result.process.byEndEvent['End_Ok']!.completed).toBe(2);
  });

  test('the outer deadline closes a nested instance: its own deadline never fires', async () => {
    const xml = definitions(`
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F_In" sourceRef="Start" targetRef="Outer" />
    <bpmn:subProcess id="Outer">
      <bpmn:startEvent id="O_Start" />
      <bpmn:sequenceFlow id="O1" sourceRef="O_Start" targetRef="Inner" />
      <bpmn:subProcess id="Inner">
        <bpmn:startEvent id="I_Start" />
        <bpmn:sequenceFlow id="I1" sourceRef="I_Start" targetRef="T" />
        <bpmn:task id="T" />
        <bpmn:sequenceFlow id="I2" sourceRef="T" targetRef="I_End" />
        <bpmn:endEvent id="I_End" />
      </bpmn:subProcess>
      <bpmn:sequenceFlow id="O2" sourceRef="Inner" targetRef="O_End" />
      <bpmn:endEvent id="O_End" />
      <bpmn:boundaryEvent id="Inner_Late" attachedToRef="Inner"><bpmn:timerEventDefinition id="DI" /></bpmn:boundaryEvent>
      <bpmn:sequenceFlow id="O3" sourceRef="Inner_Late" targetRef="O_End" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F_Out" sourceRef="Outer" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:boundaryEvent id="Outer_Late" attachedToRef="Outer"><bpmn:timerEventDefinition id="DO" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_Late" sourceRef="Outer_Late" targetRef="End_Late" />
    <bpmn:endEvent id="End_Late" />`);
    const ir = await irOf(xml);
    const { result, stoppedAt } = runWithStop(ir, {
      run: { seed: 1, replications: 1 },
      elements: {
        Start: { triggerCount: 1 },
        T: { processingTime: seconds(100) },
        Outer_Late: { processingTime: seconds(40) },
        Inner_Late: { processingTime: seconds(60) },
      },
    });
    expect(result.elements['Outer_Late']!.completed).toBe(1);
    expect(result.elements['Inner_Late']!.completed).toBe(0);
    expect(rowsOf(result, 'T').map((r) => [r.status, r.observedUntil])).toEqual([['interrupted', 40]]);
    expect(result.process.byEndEvent['End_Late']!.completed).toBe(1);
    // The dead inner deadline (at 60) does not move the clock.
    expect(stoppedAt).toBe(40);

    // The inner deadline first: it cuts T at 60, the token leaves the inner and outer sub-process,
    // and the outer deadline (at 80) is discarded with its closed instance.
    const inner = simulate(ir, {
      run: { seed: 1, replications: 1 },
      elements: {
        Start: { triggerCount: 1 },
        T: { processingTime: seconds(100) },
        Outer_Late: { processingTime: seconds(80) },
        Inner_Late: { processingTime: seconds(60) },
      },
    });
    expect(inner.elements['Inner_Late']!.completed).toBe(1);
    expect(inner.elements['Outer_Late']!.completed).toBe(0);
    expect(inner.process.byEndEvent['End']!.completed).toBe(1);
  });

  test('determinism: same seed, same bytes', async () => {
    const ir = await irOf(TIMER_ON_SUB);
    const random: SimScenario = {
      run: { seed: 5, replications: 3 },
      resources: { team: { capacity: 2 } },
      elements: {
        Start: { interTriggerTimer: { type: 'exponential', mean: 50 }, triggerCount: 200 },
        T1: { processingTime: { type: 'exponential', mean: 60 }, resources: [{ ref: 'team' }] },
        T2: { processingTime: { type: 'exponential', mean: 60 } },
        Deadline: { processingTime: { type: 'exponential', mean: 150 } },
      },
    };
    const a = JSON.stringify(simulate(ir, random));
    expect(JSON.stringify(simulate(ir, random))).toBe(a);
  });
});

/* ------------------------------------------------------------------ *
 * Error boundary on a sub-process (R-ERR-1, R-ERR-4)
 * ------------------------------------------------------------------ */

describe('error boundary on a sub-process', () => {
  test('each exit decides once; the exit flow counts and the token goes to the boundary', async () => {
    const ir = await irOf(ERROR_ON_SUB);
    const CASES = 3000;
    const result = simulate(ir, {
      run: { seed: 9, replications: 1 },
      elements: {
        Start: { interTriggerTimer: seconds(10), triggerCount: CASES },
        T1: { processingTime: seconds(3) },
        T2: { processingTime: seconds(3) },
        Deadline: { errorProbability: 0.4 },
      },
    });
    const errors = result.elements['Deadline']!.completed;
    expect(Math.abs(errors / CASES - 0.4)).toBeLessThan(0.025);
    expect(result.flows['S3']!.count).toBe(CASES);
    expect(result.elements['After']!.started).toBe(CASES - errors);
    expect(result.flows['F_Late']!.count).toBe(errors);
    expect(result.elements['T2']).toMatchObject({ started: CASES, completed: CASES });
  });

  test('an error on one exit cancels the parallel branch still inside, with no double counting', async () => {
    const xml = ERROR_ON_SUB.replace(
      `<bpmn:sequenceFlow id="S1" sourceRef="Sub_Start" targetRef="T1" />
      <bpmn:task id="T1" />
      <bpmn:sequenceFlow id="S2" sourceRef="T1" targetRef="T2" />
      <bpmn:task id="T2" />
      <bpmn:sequenceFlow id="S3" sourceRef="T2" targetRef="Sub_End" />
      <bpmn:endEvent id="Sub_End" />`,
      `<bpmn:sequenceFlow id="S1" sourceRef="Sub_Start" targetRef="Fork" />
      <bpmn:parallelGateway id="Fork" />
      <bpmn:sequenceFlow id="P1" sourceRef="Fork" targetRef="T1" />
      <bpmn:sequenceFlow id="P2" sourceRef="Fork" targetRef="T2" />
      <bpmn:task id="T1" />
      <bpmn:task id="T2" />
      <bpmn:sequenceFlow id="S3" sourceRef="T1" targetRef="Sub_End" />
      <bpmn:sequenceFlow id="S4" sourceRef="T2" targetRef="Sub_End2" />
      <bpmn:endEvent id="Sub_End" />
      <bpmn:endEvent id="Sub_End2" />`,
    );
    const ir = await irOf(xml);
    const result = simulate(ir, {
      run: { seed: 1, replications: 1 },
      resources: { team: { capacity: 1, costPerHour: 3600 } },
      elements: {
        Start: { triggerCount: 1 },
        T1: { processingTime: seconds(10) },
        T2: { processingTime: seconds(100), resources: [{ ref: 'team' }], fixedCost: 7 },
        Deadline: { errorProbability: 1 },
      },
    });
    expect(rowsOf(result, 'T2').map((r) => [r.status, r.observedUntil, r.resourceCost, r.elementCost])).toEqual([
      ['interrupted', 10, 10, 0],
    ]);
    expect(result.resources['team']!.busyTime).toBe(10);
    expect(result.flows['S4']!.count).toBe(0);
    expect(result.elements['After']!.started).toBe(0);
    expect(result.process).toMatchObject({ completed: 1, inFlight: 0 });
    expect(result.process.byEndEvent['End_Late']!.completed).toBe(1);
  });

  test('a token sent to the error boundary of the first of two sub-processes never enters the second', async () => {
    const xml = definitions(`
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F_In" sourceRef="Start" targetRef="First" />
    <bpmn:subProcess id="First">
      <bpmn:startEvent id="A_Start" />
      <bpmn:sequenceFlow id="A1" sourceRef="A_Start" targetRef="TA" />
      <bpmn:task id="TA" />
      <bpmn:sequenceFlow id="A2" sourceRef="TA" targetRef="A_End" />
      <bpmn:endEvent id="A_End" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F_Mid" sourceRef="First" targetRef="Second" />
    <bpmn:subProcess id="Second">
      <bpmn:startEvent id="B_Start" />
      <bpmn:sequenceFlow id="B1" sourceRef="B_Start" targetRef="TB" />
      <bpmn:task id="TB" />
      <bpmn:sequenceFlow id="B2" sourceRef="TB" targetRef="B_End" />
      <bpmn:endEvent id="B_End" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F_Out" sourceRef="Second" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:boundaryEvent id="First_Error" attachedToRef="First"><bpmn:errorEventDefinition id="DE" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_Err" sourceRef="First_Error" targetRef="End_Err" />
    <bpmn:endEvent id="End_Err" />
    <bpmn:boundaryEvent id="Second_Late" attachedToRef="Second"><bpmn:timerEventDefinition id="DT" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_Late" sourceRef="Second_Late" targetRef="End_Late" />
    <bpmn:endEvent id="End_Late" />`);
    const ir = await irOf(xml);
    // A2 leaves First and enters Second at once (ADR-033 § 6).
    expect(ir.subprocesses?.['First']?.exitFlows).toEqual(['A2']);
    expect(ir.subprocesses?.['Second']?.entryFlows).toEqual(['A2']);
    const scenario = (p: number): SimScenario => ({
      run: { seed: 1, replications: 1 },
      elements: {
        Start: { triggerCount: 1 },
        TA: { processingTime: seconds(5) },
        TB: { processingTime: seconds(5) },
        First_Error: { errorProbability: p },
        Second_Late: { processingTime: seconds(0) },
      },
    });
    const error = simulate(ir, scenario(1));
    expect(error.elements['First_Error']!.completed).toBe(1);
    expect(error.elements['Second_Late']!.completed).toBe(0);
    expect(error.elements['TB']!.started).toBe(0);
    const pass = simulate(ir, scenario(0));
    // A zero deadline fires before anything the instance schedules: TB never starts.
    expect(pass.elements['Second_Late']!.completed).toBe(1);
    expect(pass.elements['TB']!.started).toBe(0);
    expect(pass.process.byEndEvent['End_Late']!.completed).toBe(1);
  });

  test('degradation: no `errorProbability` on the sub-process boundary warns once per instance and never fires', async () => {
    const ir = await irOf(ERROR_ON_SUB);
    const result = simulate(ir, {
      run: { seed: 1, replications: 1 },
      elements: { Start: { triggerCount: 3 }, T1: { processingTime: seconds(1) } },
    });
    expect(result.elements['Deadline']!.completed).toBe(0);
    expect(result.warnings).toContain(
      'W-ERROR-SIN-PROBABILIDAD: Deadline: error boundary event without errorProbability; it never fires on Sub. (3 times)',
    );
    expect(result.process.byEndEvent['End_Ok']!.completed).toBe(3);
  });
});

/* ------------------------------------------------------------------ *
 * A model without the new elements is untouched
 * ------------------------------------------------------------------ */

test('a sub-process without boundary events gives the same bytes as its flattened twin (R-PLAN-5)', async () => {
  const nested = await irOf(definitions(`
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F_In" sourceRef="Start" targetRef="Sub" />
    <bpmn:subProcess id="Sub">
      <bpmn:startEvent id="Sub_Start" />
      <bpmn:sequenceFlow id="S1" sourceRef="Sub_Start" targetRef="T1" />
      <bpmn:task id="T1" />
      <bpmn:sequenceFlow id="S3" sourceRef="T1" targetRef="Sub_End" />
      <bpmn:endEvent id="Sub_End" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F_Out" sourceRef="Sub" targetRef="End" />
    <bpmn:endEvent id="End" />`));
  expect(nested.subprocesses).toBeUndefined();
});

/* ------------------------------------------------------------------ *
 * CLI: `lila validate` and `lila run` accept both elements
 * ------------------------------------------------------------------ */

describe('`lila validate` and `lila run`', () => {
  let root: string;
  let output: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lila-error-boundary-'));
    output = [];
    const capture = (...args: unknown[]) => void output.push(args.join(' '));
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  test('both models validate and run, byte-identical across runs', async () => {
    for (const [name, xml, elements] of [
      ['task', TASK_WITH_ERRORS(), { Start: { interTriggerTimer: seconds(10), triggerCount: 50 }, Work: { processingTime: seconds(5) }, Err_A: { errorProbability: 0.3 } }],
      ['sub', TIMER_ON_SUB, { Start: { interTriggerTimer: seconds(10), triggerCount: 50 }, T1: { processingTime: { type: 'exponential', mean: 60 } }, Deadline: { processingTime: seconds(90) } }],
    ] as const) {
      const folder = join(root, name);
      mkdirSync(folder);
      const model = join(folder, 'model.bpmn');
      const scenario = join(folder, 'model.scenario.json');
      writeFileSync(model, xml, 'utf8');
      writeFileSync(scenario, JSON.stringify({ version: 1, name, model: './model.bpmn', run: { start: '2026-10-26T08:00:00Z', seed: 4, replications: 2 }, elements }), 'utf8');
      expect(await main(['validate', model]), output.join('\n')).toBe(0);
      expect(await main(['run', model, scenario, '--json', join(folder, 'a.json')]), output.join('\n')).toBe(0);
      expect(await main(['run', model, scenario, '--json', join(folder, 'b.json')])).toBe(0);
      const a = readFileSync(join(folder, 'a.json'));
      expect(a.length).toBeGreaterThan(0);
      expect(readFileSync(join(folder, 'b.json'))).toEqual(a);
    }
  });
});
