/**
 * #700 (ADR-033 § 3) — the standard loop marker on a task (`docs/SEMANTICS.md` § 4.1,
 * R-LOOP-1…6).
 *
 * The oracles are hand-computed: a fixed `count` runs exactly that many iterations, each one an
 * activity instance with its own row, its own resource request and its own `fixedCost`; a
 * `probability` p of repeating gives a mean of 1/(1 − p) iterations, drawn from the derived stream
 * `<taskId>#loop`. A marker with no `loop` in the scenario runs once, byte-identical to the same
 * task without the marker, plus `W-BUCLE-SIN-PARAMETROS`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { parseBpmn } from '../src/bpmn/parse.js';
import { validate } from '../src/bpmn/validate.js';
import { main } from '../src/cli.js';
import type { ProcessIR } from '../src/core/ir.js';
import type { RunResult } from '../src/core/result.js';
import { stream } from '../src/core/rng.js';
import type { SimScenario } from '../src/core/sim.js';
import { simulate } from '../src/index.js';
import { parseScenario, schemaIssueLines, ScenarioSchema, scenarioErrors, validateScenario } from '../src/scenario.js';

function definitions(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_Loop" isExecutable="true">
${body}
  </bpmn:process>
</bpmn:definitions>`;
}

/** `marker` is the body of the task: a loop marker, or nothing for the same task without one. */
const sequence = (marker: string, tag = 'task'): string =>
  definitions(`    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="Flow_In" sourceRef="Start" targetRef="Task_Review" />
    <bpmn:${tag} id="Task_Review" name="Review">${marker}</bpmn:${tag}>
    <bpmn:sequenceFlow id="Flow_Out" sourceRef="Task_Review" targetRef="End" />
    <bpmn:endEvent id="End" />`);

const LOOP = '<bpmn:standardLoopCharacteristics />';
const capped = (maximum: string): string => `<bpmn:standardLoopCharacteristics loopMaximum="${maximum}" />`;

/** The same sequence with a boundary timer on the looping task. */
const withBoundary = (cancelActivity: 'true' | 'false'): string =>
  definitions(`    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="Flow_In" sourceRef="Start" targetRef="Task_Review" />
    <bpmn:task id="Task_Review">${LOOP}</bpmn:task>
    <bpmn:sequenceFlow id="Flow_Out" sourceRef="Task_Review" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:boundaryEvent id="Timer_Deadline" attachedToRef="Task_Review" cancelActivity="${cancelActivity}">
      <bpmn:timerEventDefinition />
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_Late" sourceRef="Timer_Deadline" targetRef="End_Late" />
    <bpmn:endEvent id="End_Late" />`);

function scenario(elements: Record<string, unknown>, run: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    name: 'Loop',
    model: 'model.bpmn',
    run: { start: '2026-09-07T08:00:00-06:00', seed: 11, ...run },
    elements: { Start: { triggerCount: 1 }, ...elements },
  };
}

async function irOf(xml: string): Promise<ProcessIR> {
  const { ir, unsupported } = await parseBpmn(xml);
  expect(validate(ir, { unsupported }).errors).toEqual([]);
  return ir;
}

function run(ir: ProcessIR, raw: unknown): RunResult {
  const parsed = ScenarioSchema.parse(raw);
  expect(scenarioErrors(validateScenario(parsed, ir))).toEqual([]);
  return simulate(ir, parsed as unknown as SimScenario);
}

function problemsOf(ir: ProcessIR, raw: unknown, locale: 'en' | 'es' = 'en') {
  return validateScenario(ScenarioSchema.parse(raw), ir, { locale }).filter((p) => p.severity === 'error');
}

describe('ADR-033 § 3 — profile and IR', () => {
  test('a task with a loop marker no longer gives E-NOSOP, and its node carries `loop`', async () => {
    const ir = await irOf(sequence(LOOP));
    expect(ir.nodes.Task_Review).toMatchObject({ type: 'task', loop: {} });
    expect(ir.nodes.Task_Review!.loop!.maximum).toBeUndefined();
    // Any task variant and the call activity take it as well (R-PERF-1, R-PLAN-4).
    for (const tag of ['userTask', 'serviceTask', 'callActivity']) {
      expect((await irOf(sequence(LOOP, tag))).nodes.Task_Review!.loop).toEqual({});
    }
    // A task without the marker gets no `loop`: every other IR stays as it was.
    expect('loop' in (await irOf(sequence(''))).nodes.Task_Review!).toBe(false);
  });

  test('loopMaximum is read from the raw literal: only a decimal integer ≥ 1 caps the loop', async () => {
    const cases: [string, number | undefined][] = [
      ['3', 3],
      [' 4 ', 4],
      ['007', 7],
      ['0', undefined],
      ['+3', undefined],
      ['-2', undefined],
      ['3.5', undefined],
      ['1e3', undefined],
      ['3abc', undefined],
      ['', undefined],
      ['99999999999999999999', undefined],
    ];
    for (const [literal, maximum] of cases) {
      const ir = await irOf(sequence(capped(literal)));
      expect(ir.nodes.Task_Review!.loop, literal).toEqual(maximum === undefined ? {} : { maximum });
    }
    // With an id of its own, single quotes, a prefix other than `bpmn:` and the ignored fields.
    const xml = sequence(
      `<bpmn:standardLoopCharacteristics id='Loop_1' testBefore="true" loopMaximum='5'><bpmn:loopCondition>x &gt; 1</bpmn:loopCondition></bpmn:standardLoopCharacteristics>`,
    );
    expect((await irOf(xml)).nodes.Task_Review!.loop).toEqual({ maximum: 5 });
  });

  test('the cap belongs to its own task: nested and sibling markers do not leak', async () => {
    const xml = definitions(`    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Sub" />
    <bpmn:subProcess id="Sub">
      <bpmn:startEvent id="Sub_Start" />
      <bpmn:sequenceFlow id="F2" sourceRef="Sub_Start" targetRef="Task_A" />
      <bpmn:task id="Task_A"><bpmn:standardLoopCharacteristics loopMaximum="2" /></bpmn:task>
      <bpmn:sequenceFlow id="F3" sourceRef="Task_A" targetRef="Task_B" />
      <bpmn:task id="Task_B"><!-- <bpmn:standardLoopCharacteristics loopMaximum="9" /> --><bpmn:standardLoopCharacteristics /></bpmn:task>
      <bpmn:sequenceFlow id="F4" sourceRef="Task_B" targetRef="Sub_End" />
      <bpmn:endEvent id="Sub_End" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F5" sourceRef="Sub" targetRef="Task_C" />
    <bpmn:task id="Task_C" />
    <bpmn:sequenceFlow id="F6" sourceRef="Task_C" targetRef="End" />
    <bpmn:endEvent id="End" />`);
    const ir = await irOf(xml);
    expect(ir.nodes.Task_A!.loop).toEqual({ maximum: 2 });
    expect(ir.nodes.Task_B!.loop).toEqual({});
    expect(ir.nodes.Task_C!.loop).toBeUndefined();
  });

  test('on an embedded sub-process the loop marker stays E-NOSOP `loopMarker`', async () => {
    const xml = definitions(`    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Sub" />
    <bpmn:subProcess id="Sub">
      ${LOOP}
      <bpmn:startEvent id="Sub_Start" />
      <bpmn:sequenceFlow id="F2" sourceRef="Sub_Start" targetRef="Sub_End" />
      <bpmn:endEvent id="Sub_End" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F3" sourceRef="Sub" targetRef="End" />
    <bpmn:endEvent id="End" />`);
    const { ir, unsupported } = await parseBpmn(xml);
    const errors = validate(ir, { unsupported, locale: 'en' }).errors.filter((e) => e.code === 'E-NOSOP');
    expect(errors.map((e) => e.message)).toEqual([
      'Sub (bpmn:subProcess): loop marker on the activity not supported by the simulator.',
    ]);
  });
});

describe('R-LOOP-1…4 — iterations, hand-computed', () => {
  test('a fixed count runs exactly that many iterations, each its own instance, row and fixed cost', async () => {
    const ir = await irOf(sequence(LOOP));
    const result = run(ir, scenario({
      Task_Review: { processingTime: { type: 'constant', value: 10 }, fixedCost: 4, loop: { count: 3 } },
    }));
    expect(result.elements.Task_Review).toMatchObject({ started: 3, completed: 3, fixedCostTotal: 12 });
    expect(result.elements.Task_Review!.processing.mean).toBe(10);
    // R-LOOP-3: one token, one pass on each flow.
    expect(result.flows.Flow_In!.count).toBe(1);
    expect(result.flows.Flow_Out!.count).toBe(1);
    expect(result.process.completed).toBe(1);
    expect(result.process.cycleTime.mean).toBe(30);
    const rows = result.log!.filter((row) => row.elementId === 'Task_Review');
    expect(rows.map((row) => [row.activityInstanceId, row.enabledAt, row.startedAt, row.endedAt, row.elementCost])).toEqual([
      ['1', 0, 0, 10, 4],
      ['2', 10, 10, 20, 4],
      ['3', 20, 20, 30, 4],
    ]);
    expect(result.warnings).toEqual([]);
  });

  test('loopMaximum caps a larger count, and probability 1 runs exactly loopMaximum times', async () => {
    const ir = await irOf(sequence(capped('2')));
    const counted = run(ir, scenario({ Task_Review: { processingTime: { type: 'constant', value: 5 }, loop: { count: 5 } } }));
    expect(counted.elements.Task_Review).toMatchObject({ started: 2, completed: 2 });
    const certain = run(ir, scenario({ Task_Review: { processingTime: { type: 'constant', value: 5 }, loop: { probability: 1 } } }));
    expect(certain.elements.Task_Review).toMatchObject({ started: 2, completed: 2 });
    expect(certain.process.cycleTime.mean).toBe(10);
  });

  test('probability p of repeating gives a mean of 1/(1 − p) iterations', async () => {
    const ir = await irOf(sequence(LOOP));
    const cases = 20_000;
    for (const p of [0.5, 0.75]) {
      const result = run(ir, scenario(
        { Start: { triggerCount: cases }, Task_Review: { processingTime: { type: 'constant', value: 1 }, loop: { probability: p } } },
        { seed: 3 },
      ));
      expect(result.process.completed).toBe(cases);
      const mean = result.elements.Task_Review!.completed / cases;
      // Iterations are geometric: sd of the mean = sqrt(p / (1 − p)²) / sqrt(cases), 0.024 at p = 0.75.
      expect(Math.abs(mean - 1 / (1 - p)), `p = ${p}: mean ${mean}`).toBeLessThan(0.1);
    }
    // p = 0 never repeats.
    const once = run(ir, scenario({ Start: { triggerCount: 50 }, Task_Review: { loop: { probability: 0 } } }));
    expect(once.elements.Task_Review!.completed).toBe(50);
  });

  test('the decision draws one uniform per completed iteration from the derived stream `<taskId>#loop`', async () => {
    const ir = await irOf(sequence(LOOP));
    const p = 0.8;
    for (const seed of [1, 2, 3, 4, 5]) {
      const rng = stream(seed, 0, 'Task_Review#loop');
      let expected = 1;
      while (rng.next() < p) expected++;
      const result = run(ir, scenario({ Task_Review: { loop: { probability: p } } }, { seed }));
      expect(result.elements.Task_Review!.completed, `seed ${seed}`).toBe(expected);
    }
  });

  test('units are released at each iteration, so a waiting token takes them in between (FIFO)', async () => {
    const ir = await irOf(sequence(LOOP));
    const result = run(ir, {
      ...scenario({
        Start: { triggerCount: 2 },
        Task_Review: { processingTime: { type: 'constant', value: 10 }, resources: [{ ref: 'clerk' }], loop: { count: 2 } },
      }),
      resources: { clerk: { capacity: 1 } },
    });
    const rows = result.log!
      .filter((row) => row.elementId === 'Task_Review')
      .map((row) => [row.caseId, row.enabledAt, row.startedAt, row.endedAt]);
    // Case 2 has queued since 0, so it takes the unit at 10, before case 1's second iteration.
    expect(rows).toEqual([
      ['1', 0, 0, 10],
      ['2', 0, 10, 20],
      ['1', 10, 20, 30],
      ['2', 20, 30, 40],
    ]);
    expect(result.elements.Task_Review!.resourceWait.mean).toBe(7.5);
    expect(result.process.cycleTime.max).toBe(40);
  });

  test('results keep the same columns as any other task (Bizagi names unchanged)', async () => {
    const plain = run(await irOf(sequence('')), scenario({ Task_Review: { processingTime: { type: 'constant', value: 1 } } }));
    const looped = run(await irOf(sequence(LOOP)), scenario({
      Task_Review: { processingTime: { type: 'constant', value: 1 }, loop: { count: 2 } },
    }));
    expect(Object.keys(looped)).toEqual(Object.keys(plain));
    expect(Object.keys(looped.elements.Task_Review!)).toEqual(Object.keys(plain.elements.Task_Review!));
    expect(Object.keys(looped.log![0]!)).toEqual(Object.keys(plain.log![0]!));
  });
});

describe('R-LOOP-5 — boundary timers cover the whole loop', () => {
  const loopScenario = (deadline: number) =>
    scenario({
      Task_Review: { processingTime: { type: 'constant', value: 10 }, loop: { count: 5 } },
      Timer_Deadline: { processingTime: { type: 'constant', value: deadline } },
    });

  test('interrupting: armed once at iteration 1, it closes the iteration in flight and no other runs', async () => {
    const result = run(await irOf(withBoundary('true')), loopScenario(25));
    expect(result.elements.Task_Review).toMatchObject({ started: 3, completed: 2 });
    expect(result.elements.Timer_Deadline).toMatchObject({ started: 1, completed: 1 });
    expect(result.flows.Flow_Out!.count).toBe(0);
    expect(result.flows.Flow_Late!.count).toBe(1);
    expect(result.process.byEndEvent.End_Late!.completed).toBe(1);
    expect(result.log!.filter((row) => row.elementId === 'Task_Review').map((row) => row.status)).toEqual([
      'completed',
      'completed',
      'interrupted',
    ]);
  });

  test('a deadline that ties with an iteration\'s end interrupts it (R-BND-7)', async () => {
    const result = run(await irOf(withBoundary('true')), loopScenario(20));
    expect(result.elements.Task_Review).toMatchObject({ started: 2, completed: 1 });
    expect(result.flows.Flow_Late!.count).toBe(1);
  });

  test('non-interrupting: it fires once per entry and the loop runs to the end', async () => {
    const result = run(await irOf(withBoundary('false')), loopScenario(15));
    expect(result.elements.Task_Review).toMatchObject({ started: 5, completed: 5 });
    expect(result.elements.Timer_Deadline).toMatchObject({ started: 1, completed: 1 });
    expect(result.flows.Flow_Out!.count).toBe(1);
    expect(result.flows.Flow_Late!.count).toBe(1);
  });

  test('a deadline longer than the whole loop never fires and does not stretch the run (R-BND-9)', async () => {
    const result = run(await irOf(withBoundary('true')), loopScenario(100));
    expect(result.elements.Task_Review).toMatchObject({ started: 5, completed: 5 });
    expect(result.elements.Timer_Deadline).toMatchObject({ started: 0, completed: 0 });
    expect(result.process.cycleTime.mean).toBe(50);
    expect(result.log!.at(-1)!.observedUntil).toBe(50);
  });
});

describe('R-LOOP-6 — terminate and stop', () => {
  test('terminate closes the open iteration and no further one runs', async () => {
    const xml = definitions(`    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Fork" />
    <bpmn:parallelGateway id="Fork" />
    <bpmn:sequenceFlow id="F2" sourceRef="Fork" targetRef="Task_Review" />
    <bpmn:sequenceFlow id="F3" sourceRef="Fork" targetRef="Wait" />
    <bpmn:task id="Task_Review">${LOOP}</bpmn:task>
    <bpmn:sequenceFlow id="F4" sourceRef="Task_Review" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:intermediateCatchEvent id="Wait"><bpmn:timerEventDefinition /></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F5" sourceRef="Wait" targetRef="Kill" />
    <bpmn:endEvent id="Kill"><bpmn:terminateEventDefinition /></bpmn:endEvent>`);
    const result = run(await irOf(xml), scenario({
      Task_Review: { processingTime: { type: 'constant', value: 10 }, loop: { count: 5 } },
      Wait: { processingTime: { type: 'constant', value: 15 } },
    }));
    expect(result.elements.Task_Review).toMatchObject({ started: 2, completed: 1 });
    expect(result.log!.filter((row) => row.elementId === 'Task_Review').map((row) => row.status)).toEqual([
      'completed',
      'terminated',
    ]);
    expect(result.process.byEndEvent.Kill!.completed).toBe(1);
  });

  test('the stop leaves the open iteration in flight', async () => {
    const result = run(await irOf(sequence(LOOP)), scenario(
      { Task_Review: { processingTime: { type: 'constant', value: 10 }, loop: { count: 5 } } },
      { duration: 25 },
    ));
    expect(result.elements.Task_Review).toMatchObject({ started: 3, completed: 2 });
    expect(result.log!.at(-1)!.status).toBe('inFlight');
  });

  test('zero-time iterations count toward the R-TOK-7 budget', async () => {
    const ir = await irOf(sequence(LOOP));
    const parsed = ScenarioSchema.parse(scenario({ Task_Review: { loop: { count: 80_000 } } }));
    expect(() => simulate(ir, parsed as unknown as SimScenario)).toThrow(/^E-LIMITE-SIN-AVANCE: Task_Review/);
  });
});

describe('degradation and determinism', () => {
  const plainTimes = {
    Start: { interTriggerTimer: { type: 'exponential', mean: 30 }, triggerCount: 200 },
    Task_Review: { processingTime: { type: 'triangular', min: 5, mode: 20, max: 60 }, resources: [{ ref: 'clerk' }] },
  };
  const withPool = (elements: Record<string, unknown>) => ({
    ...scenario(elements, { replications: 3 }),
    resources: { clerk: { capacity: 1, costPerHour: 30 } },
  });

  test('a marker with no `loop` runs once: byte-identical to no marker, plus W-BUCLE-SIN-PARAMETROS', async () => {
    const plain = run(await irOf(sequence('')), withPool(plainTimes));
    const degraded = run(await irOf(sequence(LOOP)), withPool(plainTimes));
    expect(degraded.warnings).toEqual([
      'W-BUCLE-SIN-PARAMETROS: Task_Review: loop marker with no loop in the scenario; it runs once. (200 times)',
    ]);
    expect(JSON.stringify({ ...degraded, warnings: [] })).toBe(JSON.stringify({ ...plain, warnings: [] }));
    expect(plain.elements.Task_Review!.completed).toBeGreaterThan(100);

    const ir = await irOf(sequence(LOOP));
    const parsed = ScenarioSchema.parse(scenario({ Task_Review: { processingTime: { type: 'constant', value: 1 } } }));
    const es = simulate(ir, parsed as unknown as SimScenario, { locale: 'es' });
    expect(es.warnings).toEqual([
      'W-BUCLE-SIN-PARAMETROS: Task_Review: marcador de bucle sin loop en el escenario; se ejecuta una vez.',
    ]);
  });

  test('`count: 1` draws nothing extra: byte-identical to the task without the marker', async () => {
    const plain = run(await irOf(sequence('')), withPool(plainTimes));
    const once = run(await irOf(sequence(LOOP)), withPool({
      ...plainTimes,
      Task_Review: { ...plainTimes.Task_Review, loop: { count: 1 } },
    }));
    expect(JSON.stringify(once)).toBe(JSON.stringify(plain));
  });

  test('same seed, same bytes; another seed moves the numbers', async () => {
    const ir = await irOf(sequence(LOOP));
    const looped = withPool({ ...plainTimes, Task_Review: { ...plainTimes.Task_Review, loop: { probability: 0.4 } } });
    const a = JSON.stringify(run(ir, looped));
    expect(JSON.stringify(run(ir, looped))).toBe(a);
    expect(JSON.stringify(run(ir, { ...looped, run: { ...(looped.run as object), seed: 12 } }))).not.toBe(a);
  });
});

describe('scenario lint and schema', () => {
  test('`loop` on a task without a loop marker, or on another element, is E-CAMPO-NO-APLICA/solo-bucle', async () => {
    const ir = await irOf(sequence(''));
    const raw = scenario({ Task_Review: { loop: { count: 2 } }, Flow_In: { loop: { probability: 0.5 } } });
    expect(problemsOf(ir, raw).map((p) => [p.code, p.path, p.message])).toEqual([
      ['E-CAMPO-NO-APLICA', 'elements.Task_Review.loop', 'only accepted on a task with a loop marker (elements.Task_Review.loop).'],
      ['E-CAMPO-NO-APLICA', 'elements.Flow_In.loop', 'only accepted on a task with a loop marker (elements.Flow_In.loop).'],
    ]);
    expect(problemsOf(ir, raw, 'es')[0]!.message).toBe(
      'solo se admite en una tarea con marcador de bucle (elements.Task_Review.loop).',
    );
  });

  test('probability outside [0, 1] is E-PROB-RANGO; 1 without loopMaximum is E-BUCLE-SIN-SALIDA', async () => {
    const ir = await irOf(sequence(LOOP));
    expect(problemsOf(ir, scenario({ Task_Review: { loop: { probability: 1.5 } } })).map((p) => [p.code, p.path, p.message])).toEqual([
      ['E-PROB-RANGO', 'elements.Task_Review.loop.probability', '1.5 is outside [0, 1] (elements.Task_Review.loop.probability).'],
    ]);
    expect(problemsOf(ir, scenario({ Task_Review: { loop: { probability: -0.1 } } })).map((p) => p.code)).toEqual(['E-PROB-RANGO']);
    const endless = scenario({ Task_Review: { loop: { probability: 1 } } });
    expect(problemsOf(ir, endless).map((p) => [p.code, p.path, p.message])).toEqual([
      [
        'E-BUCLE-SIN-SALIDA',
        'elements.Task_Review.loop.probability',
        'a loop with probability 1 and no loopMaximum never ends (elements.Task_Review.loop.probability).',
      ],
    ]);
    expect(problemsOf(ir, endless, 'es')[0]!.message).toBe(
      'un bucle con probabilidad 1 y sin loopMaximum nunca termina (elements.Task_Review.loop.probability).',
    );
    // With a cap it ends, so it is valid; so are 0 and any count.
    const cappedIr = await irOf(sequence(capped('4')));
    expect(problemsOf(cappedIr, endless)).toEqual([]);
    expect(problemsOf(ir, scenario({ Task_Review: { loop: { probability: 0 } } }))).toEqual([]);
    expect(problemsOf(ir, scenario({ Task_Review: { loop: { count: 7 } } }))).toEqual([]);
  });

  test('a marker with no `loop` is not a lint problem: the engine warns at run time', async () => {
    const ir = await irOf(sequence(LOOP));
    const problems = validateScenario(ScenarioSchema.parse(scenario({ Task_Review: {} })), ir);
    expect(problems.filter((p) => p.path.startsWith('elements.Task_Review'))).toEqual([]);
  });

  test('neither or both of count and probability is a schema error at `elements.<id>.loop`', () => {
    for (const loop of [{}, { count: 2, probability: 0.5 }]) {
      for (const [locale, text] of [
        ['en', 'declare exactly one of count or probability'],
        ['es', 'declara exactamente uno de `count` o `probability`'],
      ] as const) {
        const parsed = parseScenario(scenario({ Task_Review: { loop } }), { locale });
        expect(parsed.success).toBe(false);
        expect(schemaIssueLines(parsed.error!.issues, { locale })).toEqual([`elements.Task_Review.loop: ${text}`]);
      }
    }
    // `count` is an integer ≥ 1, and the object is closed.
    for (const loop of [{ count: 0 }, { count: 1.5 }]) {
      expect(parseScenario(scenario({ Task_Review: { loop } })).success).toBe(false);
    }
    const unknown = parseScenario(scenario({ Task_Review: { loop: { count: 2, times: 3 } } }));
    expect(schemaIssueLines(unknown.error!.issues)).toEqual([
      'elements.Task_Review.loop: E-CLAVE-DESCONOCIDA: key not recognised by the schema: times.',
    ]);
  });

  test('core repeats the check before any callback, in both languages', async () => {
    const ir = await irOf(sequence(LOOP));
    const endless = { run: { seed: 1 }, elements: { Start: { triggerCount: 1 }, Task_Review: { loop: { probability: 1 } } } };
    const onProgress = vi.fn();
    expect(() => simulate(ir, endless, { onProgress })).toThrow(
      'E-BUCLE-SIN-SALIDA: Task_Review: a loop with probability 1 and no loopMaximum never ends.',
    );
    expect(onProgress).not.toHaveBeenCalled();
    expect(() => simulate(ir, endless, { locale: 'es' })).toThrow(
      'E-BUCLE-SIN-SALIDA: Task_Review: un bucle con probabilidad 1 y sin loopMaximum nunca termina.',
    );
    // With a cap the same scenario runs.
    expect(simulate(await irOf(sequence(capped('3'))), endless).elements.Task_Review!.completed).toBe(3);
  });
});

describe('CLI — `lila validate` and `lila run` accept the loop marker', () => {
  let root: string;
  let output: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lila-loop-marker-'));
    output = [];
    const capture = (...args: unknown[]) => void output.push(args.join(' '));
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  test('validate passes, and two runs with the same seed are byte-identical', async () => {
    const folder = join(root, 'p');
    mkdirSync(folder);
    const model = join(folder, 'model.bpmn');
    const scenarioPath = join(folder, 'loop.scenario.json');
    writeFileSync(model, sequence(capped('6')), 'utf8');
    writeFileSync(scenarioPath, JSON.stringify(scenario({
      Start: { interTriggerTimer: { type: 'exponential', mean: 60 }, triggerCount: 30 },
      Task_Review: { processingTime: { type: 'exponential', mean: 20 }, loop: { probability: 0.5 } },
    })), 'utf8');
    const out = (file: string) => join(root, file);

    expect(await main(['validate', model]), output.join('\n')).toBe(0);
    expect(output.join('\n')).not.toContain('not supported');
    expect(await main(['run', model, scenarioPath, '--json', out('a.json')]), output.join('\n')).toBe(0);
    expect(await main(['run', model, scenarioPath, '--json', out('b.json')])).toBe(0);
    const a = readFileSync(out('a.json'));
    expect(readFileSync(out('b.json'))).toEqual(a);
    const result = JSON.parse(a.toString('utf8')) as RunResult;
    expect(result.elements.Task_Review!.completed).toBeGreaterThan(result.process.completed);
  });
});
