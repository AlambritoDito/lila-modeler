/**
 * #701 (ADR-033 § 4) — multi-instance tasks, parallel and sequential (`docs/SEMANTICS.md` § 4.2,
 * R-MI-1…6).
 *
 * The oracles are hand-computed: with a constant duration `d` and no resources, sequential
 * `N = 3` takes `3d`; parallel `N = 3` with one unit takes `3d` and with three units takes `d`.
 * `N` drawn from a distribution comes from the derived stream `<taskId>#instances`, so it moves no
 * other element's numbers, and the same seed gives the same bytes.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { parseBpmn } from '../src/bpmn/parse.js';
import { validate } from '../src/bpmn/validate.js';
import { main } from '../src/cli.js';
import type { ProcessIR } from '../src/core/ir.js';
import type { RunResult } from '../src/core/result.js';
import { runReplication, type SimScenario } from '../src/core/sim.js';
import { simulate } from '../src/index.js';
import { ScenarioSchema, scenarioErrors, validateScenario } from '../src/scenario.js';

function definitions(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_Review" isExecutable="true">
${body}
  </bpmn:process>
</bpmn:definitions>`;
}

interface Marker {
  /** Raw `isSequential` literal; `undefined` leaves the attribute out. */
  isSequential?: string;
  /** Raw `loopCardinality` body; `undefined` leaves the element out. */
  cardinality?: string;
}

/** The multi-instance marker as BPMN writes it, or nothing for a plain task. */
function marker(m: Marker | false): string {
  if (m === false) return '';
  const sequential = m.isSequential === undefined ? '' : ` isSequential="${m.isSequential}"`;
  return m.cardinality === undefined
    ? `<bpmn:multiInstanceLoopCharacteristics${sequential} />`
    : `<bpmn:multiInstanceLoopCharacteristics${sequential}><bpmn:loopCardinality xsi:type="bpmn:tFormalExpression">${m.cardinality}</bpmn:loopCardinality></bpmn:multiInstanceLoopCharacteristics>`;
}

/** Start → Task_Review (with the marker) → End, and an optional boundary timer on the task. */
const line = (m: Marker | false, boundary: 'none' | 'interrupting' | 'non-interrupting' = 'none'): string =>
  definitions(`    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="Flow_In" sourceRef="Start" targetRef="Task_Review" />
    <bpmn:userTask id="Task_Review">${marker(m)}</bpmn:userTask>
    <bpmn:sequenceFlow id="Flow_Out" sourceRef="Task_Review" targetRef="End" />
    <bpmn:endEvent id="End" />${
      boundary === 'none'
        ? ''
        : `
    <bpmn:boundaryEvent id="Timer_Deadline" attachedToRef="Task_Review"${boundary === 'non-interrupting' ? ' cancelActivity="false"' : ''}><bpmn:timerEventDefinition id="Def_Deadline" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_Late" sourceRef="Timer_Deadline" targetRef="End_Late" />
    <bpmn:endEvent id="End_Late" />`
    }`);

const BASE = {
  version: 1,
  name: 'Review',
  model: 'model.bpmn',
  run: { start: '2026-09-07T08:00:00-06:00', seed: 1 },
};

/** One case at `t = 0` through a task that takes `d = 10` seconds per instance. */
function oneCase(task: Record<string, unknown> = {}, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...BASE,
    elements: {
      Start: { triggerCount: 1 },
      Task_Review: { processingTime: { type: 'constant', value: 10 }, ...task },
      ...extra,
    },
  };
}

async function irOf(xml: string): Promise<ProcessIR> {
  const { ir, unsupported } = await parseBpmn(xml);
  expect(validate(ir, { unsupported }).errors).toEqual([]);
  return ir;
}

function run(ir: ProcessIR, scenario: unknown): RunResult {
  const parsed = ScenarioSchema.parse(scenario);
  expect(scenarioErrors(validateScenario(parsed, ir))).toEqual([]);
  return simulate(ir, parsed as unknown as SimScenario);
}

function rowsOf(result: RunResult, elementId: string) {
  return (result.log ?? []).filter((row) => row.elementId === elementId);
}

describe('ADR-033 § 4 — profile and IR', () => {
  test('a task or call activity with the marker is a `task` with `multiInstance`', async () => {
    const parallel = await irOf(line({ cardinality: '3' }));
    expect(parallel.nodes.Task_Review).toMatchObject({
      type: 'task',
      multiInstance: { sequential: false, cardinality: 3 },
    });

    const call = await irOf(
      line({ isSequential: 'true' }).replace(/userTask/g, 'callActivity'),
    );
    expect(call.nodes.Task_Review?.type).toBe('task');
    expect(call.nodes.Task_Review?.multiInstance).toEqual({ sequential: true });

    // An IR without the marker keeps its exact shape: no `multiInstance` key at all.
    const plain = await irOf(line(false));
    expect('multiInstance' in plain.nodes.Task_Review!).toBe(false);
  });

  test('isSequential is read from the raw literal: true/1 sequential, absent/false/0 parallel', async () => {
    const cases: [string | undefined, boolean][] = [
      [undefined, false],
      ['false', false],
      ['0', false],
      ['true', true],
      ['1', true],
    ];
    for (const [isSequential, sequential] of cases) {
      const ir = await irOf(line(isSequential === undefined ? {} : { isSequential }));
      expect(ir.nodes.Task_Review?.multiInstance, String(isSequential)).toEqual({ sequential });
    }
  });

  test('loopCardinality is a cardinality only as a trimmed decimal integer literal, 0 included', async () => {
    const cases: [string, number | undefined][] = [
      ['3', 3],
      [' 4 ', 4],
      ['0', 0],
      ['007', 7],
      ['+3', undefined],
      ['-2', undefined],
      ['2.5', undefined],
      ['${reviewers.size()}', undefined],
      ['', undefined],
    ];
    for (const [body, cardinality] of cases) {
      const ir = await irOf(line({ cardinality: body }));
      expect(ir.nodes.Task_Review?.multiInstance?.cardinality, JSON.stringify(body)).toBe(cardinality);
    }
  });

  test('an unknown isSequential literal and a marker on a sub-process stay `E-NOSOP`', async () => {
    const xml = definitions(`    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Task_Odd" />
    <bpmn:task id="Task_Odd"><bpmn:multiInstanceLoopCharacteristics isSequential="yes" /></bpmn:task>
    <bpmn:sequenceFlow id="F2" sourceRef="Task_Odd" targetRef="Sub" />
    <bpmn:subProcess id="Sub">
      <bpmn:multiInstanceLoopCharacteristics />
      <bpmn:startEvent id="Sub_Start" />
      <bpmn:sequenceFlow id="F3" sourceRef="Sub_Start" targetRef="Sub_End" />
      <bpmn:endEvent id="Sub_End" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="F4" sourceRef="Sub" targetRef="End" />
    <bpmn:endEvent id="End" />`);
    const { ir, unsupported } = await parseBpmn(xml);
    const nosop = (locale: 'en' | 'es') =>
      validate(ir, { unsupported, locale })
        .errors.filter((error) => error.code === 'E-NOSOP')
        .map((error) => error.message);
    expect(nosop('en')).toEqual([
      'Task_Odd (bpmn:task): multi-instance marker not supported by the simulator.',
      'Sub (bpmn:subProcess): multi-instance marker not supported by the simulator.',
    ]);
    expect(nosop('es')).toEqual([
      'Task_Odd (bpmn:task): marcador de multi-instancia no soportado por el simulador.',
      'Sub (bpmn:subProcess): marcador de multi-instancia no soportado por el simulador.',
    ]);
  });

  test('the raw isSequential belongs to the activity that encloses the marker, comments ignored', async () => {
    const xml = definitions(`    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Task_A" />
    <!-- <bpmn:task id="Task_A"><bpmn:multiInstanceLoopCharacteristics isSequential="1" /></bpmn:task> -->
    <bpmn:task id="Task_A" name="a > b"><bpmn:documentation>isSequential="1"</bpmn:documentation><bpmn:multiInstanceLoopCharacteristics isSequential='0' /></bpmn:task>
    <bpmn:sequenceFlow id="F2" sourceRef="Task_A" targetRef="Task_B" />
    <bpmn:task id="Task_B"><bpmn:multiInstanceLoopCharacteristics id="Marker_B" isSequential="1"></bpmn:multiInstanceLoopCharacteristics></bpmn:task>
    <bpmn:sequenceFlow id="F3" sourceRef="Task_B" targetRef="End" />
    <bpmn:endEvent id="End" />`);
    const ir = await irOf(xml);
    expect(ir.nodes.Task_A?.multiInstance).toEqual({ sequential: false });
    expect(ir.nodes.Task_B?.multiInstance).toEqual({ sequential: true });
  });
});

describe('R-MI-2, R-MI-3, R-MI-5 — hand-computed oracles (d = 10)', () => {
  test('sequential N = 3 with no resources takes 3d', async () => {
    const result = run(await irOf(line({ isSequential: 'true', cardinality: '3' })), oneCase());
    expect(result.process.cycleTime.mean).toBe(30);
    expect(result.elements.Task_Review).toMatchObject({ started: 3, completed: 3 });
    expect(result.elements.Task_Review!.processing.total).toBe(30);
    // One token: the flows count once per entry (R-MI-5).
    expect(result.flows.Flow_In!.count).toBe(1);
    expect(result.flows.Flow_Out!.count).toBe(1);
    // Instance k + 1 is enabled at the instant k completes (R-MI-3).
    expect(rowsOf(result, 'Task_Review').map((row) => [row.enabledAt, row.startedAt, row.endedAt])).toEqual([
      [0, 0, 10],
      [10, 10, 20],
      [20, 20, 30],
    ]);
    expect(result.warnings).toEqual([]);
  });

  test('parallel N = 3 with one unit takes 3d, with three units d', async () => {
    const ir = await irOf(line({ cardinality: '3' }));
    const withPool = (capacity: number) => ({
      ...oneCase({ resources: [{ ref: 'reviewer' }] }),
      resources: { reviewer: { capacity } },
    });

    const one = run(ir, withPool(1));
    expect(one.process.cycleTime.mean).toBe(30);
    expect(one.elements.Task_Review).toMatchObject({ started: 3, completed: 3 });
    // R-MI-2: all three enabled at the arrival instant, served FIFO by `(enabledAt, seq)`.
    expect(rowsOf(one, 'Task_Review').map((row) => [row.enabledAt, row.startedAt, row.endedAt])).toEqual([
      [0, 0, 10],
      [0, 10, 20],
      [0, 20, 30],
    ]);
    expect(one.elements.Task_Review!.resourceWait.total).toBe(30);

    const three = run(ir, withPool(3));
    expect(three.process.cycleTime.mean).toBe(10);
    expect(three.elements.Task_Review).toMatchObject({ started: 3, completed: 3 });
    expect(rowsOf(three, 'Task_Review').map((row) => [row.startedAt, row.endedAt])).toEqual([
      [0, 10],
      [0, 10],
      [0, 10],
    ]);
  });

  test('parallel N = 3 with no resources takes d, and every instance charges its fixedCost', async () => {
    const result = run(await irOf(line({ cardinality: '3' })), oneCase({ fixedCost: 2 }));
    expect(result.process.cycleTime.mean).toBe(10);
    expect(result.elements.Task_Review).toMatchObject({ started: 3, completed: 3, fixedCostTotal: 6 });
  });

  test('instances compete with other tokens: a sequential instance queues behind requests already waiting', async () => {
    // Two cases at t = 0 and one unit. Case 1 enters the sequential task first; its instance 2 is
    // enabled at t = 10, after case 2's request (enabled at 0), so case 2 is served first.
    const result = run(await irOf(line({ isSequential: '1', cardinality: '2' })), {
      ...BASE,
      resources: { reviewer: { capacity: 1 } },
      elements: {
        Start: { triggerCount: 2 },
        Task_Review: { processingTime: { type: 'constant', value: 10 }, resources: [{ ref: 'reviewer' }] },
      },
    });
    expect(rowsOf(result, 'Task_Review').map((row) => [row.caseId, row.enabledAt, row.startedAt, row.endedAt])).toEqual([
      ['1', 0, 0, 10],
      ['2', 0, 10, 20],
      ['1', 10, 20, 30],
      ['2', 20, 30, 40],
    ]);
  });
});

describe('R-MI-1 — N from the scenario, its rounding and its precedence', () => {
  test('`instances` overrides `loopCardinality`, and N = floor(max(0, x) + 0.5)', async () => {
    const ir = await irOf(line({ isSequential: 'true', cardinality: '3' }));
    const cases: [number, number][] = [
      [5, 5],
      [2.5, 3],
      [2.49, 2],
      [0.4, 0],
      [0, 0],
    ];
    for (const [value, n] of cases) {
      const result = run(ir, oneCase({ instances: { type: 'constant', value } }));
      expect(result.elements.Task_Review!.started, String(value)).toBe(n);
      expect(result.process.cycleTime.mean, String(value)).toBe(10 * n);
    }
    // A negative sample counts as 0 instances, never as a negative count.
    const negative = run(ir, oneCase({ instances: { type: 'normal', mean: -5, sd: 0.1 } }));
    expect(negative.elements.Task_Review!.started).toBe(0);
    expect(negative.process).toMatchObject({ started: 1, completed: 1 });
  });

  test('a constant `instances` gives the same bytes as the same `loopCardinality`', async () => {
    const scenario = {
      ...BASE,
      run: { ...BASE.run, seed: 11, replications: 2 },
      resources: { reviewer: { capacity: 2 } },
      elements: {
        Start: { interTriggerTimer: { type: 'exponential', mean: 20 }, triggerCount: 30 },
        Task_Review: { processingTime: { type: 'exponential', mean: 12 }, resources: [{ ref: 'reviewer' }] },
      },
    };
    const fromBpmn = run(await irOf(line({ cardinality: '3' })), scenario);
    const fromScenario = run(await irOf(line({ cardinality: '7' })), {
      ...scenario,
      elements: { ...scenario.elements, Task_Review: { ...scenario.elements.Task_Review, instances: { type: 'constant', value: 3 } } },
    });
    expect(JSON.stringify(fromScenario)).toBe(JSON.stringify(fromBpmn));
  });

  test('N as a distribution is drawn from `<taskId>#instances`: deterministic per seed, and it shifts no other stream', async () => {
    const ir = await irOf(line({}));
    const scenario = (seed: number) => ({
      ...BASE,
      run: { ...BASE.run, seed },
      elements: {
        Start: { interTriggerTimer: { type: 'exponential', mean: 50 }, triggerCount: 40 },
        Task_Review: {
          processingTime: { type: 'uniform', min: 5, max: 15 },
          instances: { type: 'user', points: [{ value: 1, probability: 0.5 }, { value: 4, probability: 0.5 }] },
        },
      },
    });
    const a = run(ir, scenario(3));
    const b = run(ir, scenario(3));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(run(ir, scenario(4)))).not.toBe(JSON.stringify(a));

    // Both values occur, so N really is drawn per entry.
    const perCase = new Map<string, number>();
    for (const row of rowsOf(a, 'Task_Review')) perCase.set(row.caseId, (perCase.get(row.caseId) ?? 0) + 1);
    expect(new Set(perCase.values())).toEqual(new Set([1, 4]));

    // The draw of N comes from its own stream: the arrivals (the start's stream) do not move.
    const plain = run(await irOf(line(false)), {
      ...scenario(3),
      elements: { ...scenario(3).elements, Task_Review: { processingTime: { type: 'uniform', min: 5, max: 15 } } },
    });
    const firstEnabled = (result: RunResult) => {
      const first = new Map<string, number>();
      for (const row of rowsOf(result, 'Task_Review')) if (!first.has(row.caseId)) first.set(row.caseId, row.enabledAt);
      return [...first].sort(([x], [y]) => Number(x) - Number(y));
    };
    expect(firstEnabled(a)).toHaveLength(40);
    expect(firstEnabled(a)).toEqual(firstEnabled(plain));
  });
});

describe('R-MI-4 — N = 0', () => {
  test('the token leaves in the same instant: no instance, no row, no started, no boundary armed', async () => {
    const result = run(
      await irOf(line({ cardinality: '0' }, 'interrupting')),
      oneCase({}, { Timer_Deadline: { processingTime: { type: 'constant', value: 0 } } }),
    );
    expect(result.process).toMatchObject({ started: 1, completed: 1 });
    expect(result.process.cycleTime.mean).toBe(0);
    expect(result.elements.Task_Review).toMatchObject({ started: 0, completed: 0 });
    expect(result.elements.Timer_Deadline).toMatchObject({ started: 0, completed: 0 });
    expect(rowsOf(result, 'Task_Review')).toEqual([]);
    expect(result.flows.Flow_In!.count).toBe(1);
    expect(result.flows.Flow_Out!.count).toBe(1);
    expect(result.flows.Flow_Late!.count).toBe(0);
  });
});

describe('degradation — neither `instances` nor a numeric `loopCardinality`', () => {
  test('one instance plus W-MULTI-SIN-CARDINALIDAD, and otherwise the numbers of the plain task', async () => {
    const scenario = {
      ...BASE,
      run: { ...BASE.run, seed: 5 },
      resources: { reviewer: { capacity: 1 } },
      elements: {
        Start: { interTriggerTimer: { type: 'exponential', mean: 30 }, triggerCount: 25 },
        Task_Review: { processingTime: { type: 'triangular', min: 10, mode: 20, max: 40 }, resources: [{ ref: 'reviewer' }] },
      },
    };
    const plain = run(await irOf(line(false)), scenario);
    for (const m of [{}, { cardinality: '${n}' }, { isSequential: 'true', cardinality: '-1' }]) {
      const degraded = run(await irOf(line(m)), scenario);
      expect(degraded.warnings).toEqual([
        'W-MULTI-SIN-CARDINALIDAD: Task_Review: multi-instance task with neither instances in the scenario nor a numeric loopCardinality; it runs one instance. (25 times)',
      ]);
      expect(JSON.stringify({ ...degraded, warnings: [] })).toBe(JSON.stringify({ ...plain, warnings: [] }));
    }
  });

  test('N = 1 gives the plain task\'s warnings in the same order (QA of #701)', async () => {
    // A task and a boundary with no time (the end's time only makes the scenario declare one,
    // so the task warns on its own, R-DEG-3): two warnings whose order depends on whether the
    // duration is sampled before or after the boundary is armed.
    const scenario = {
      ...BASE,
      elements: { Start: { triggerCount: 2 }, End: { processingTime: { type: 'constant', value: 0 } } },
    };
    const plain = run(await irOf(line(false, 'interrupting')), scenario);
    const single = run(await irOf(line({ cardinality: '1' }, 'interrupting')), scenario);
    expect(plain.warnings.map((warning) => warning.slice(0, warning.indexOf(':')))).toEqual([
      'W-TAREA-SIN-TIEMPO',
      'W-BORDE-SIN-TIEMPO',
    ]);
    expect(plain.warnings[0]).toContain('Task_Review: no processingTime');
    expect(JSON.stringify(single)).toBe(JSON.stringify(plain));
  });

  test('the warning in Spanish, once per replication run', async () => {
    const ir = await irOf(line({}));
    const parsed = ScenarioSchema.parse(oneCase());
    const replication = runReplication(ir, parsed as unknown as SimScenario, 0, { locale: 'es' });
    expect(replication.warnings).toEqual([
      'W-MULTI-SIN-CARDINALIDAD: Task_Review: tarea multi-instancia sin instances en el escenario ni loopCardinality numérico; ejecuta una instancia.',
    ]);
    // A numeric loopCardinality, or `instances`, is enough: no warning.
    expect(run(await irOf(line({ cardinality: '2' })), oneCase()).warnings).toEqual([]);
    expect(run(ir, oneCase({ instances: { type: 'constant', value: 2 } })).warnings).toEqual([]);
  });
});

describe('scenario lint — `instances` only on a multi-instance task', () => {
  test('on a plain task or on a flow it is E-CAMPO-NO-APLICA, in both languages', async () => {
    const ir = await irOf(line(false));
    const parsed = ScenarioSchema.parse(
      oneCase({ instances: { type: 'constant', value: 2 } }, { Flow_Out: { instances: { type: 'constant', value: 2 } } }),
    );
    const problems = (locale: 'en' | 'es') =>
      validateScenario(parsed, ir, { locale })
        .filter((problem) => problem.code === 'E-CAMPO-NO-APLICA')
        .map(({ path, severity, message }) => ({ path, severity, message }));
    expect(problems('en')).toEqual([
      {
        path: 'elements.Task_Review.instances',
        severity: 'error',
        message: 'only accepted on a multi-instance task (elements.Task_Review.instances).',
      },
      {
        path: 'elements.Flow_Out.instances',
        severity: 'error',
        message: 'only accepted on a multi-instance task (elements.Flow_Out.instances).',
      },
    ]);
    expect(problems('es').map((problem) => problem.message)).toEqual([
      'solo se admite en una tarea multi-instancia (elements.Task_Review.instances).',
      'solo se admite en una tarea multi-instancia (elements.Flow_Out.instances).',
    ]);
  });

  test('a normal with negative mass warns on `instances` as on any distribution (R11)', async () => {
    const ir = await irOf(line({}));
    const parsed = ScenarioSchema.parse(oneCase({ instances: { type: 'normal', mean: 1, sd: 2 } }));
    const problems = validateScenario(parsed, ir);
    expect(scenarioErrors(problems)).toEqual([]);
    expect(problems.find((problem) => problem.code === 'W-NORMAL-NEGATIVA')?.path).toBe('elements.Task_Review.instances');
  });
});

describe('R-MI-6 — boundary events, terminate and stop', () => {
  test('an interrupting timer on a parallel entry closes every open instance and drops the queued ones', async () => {
    // N = 3, one unit, d = 10, deadline 15: instance 1 completes at 10, instance 2 runs from 10
    // and is cut at 15, instance 3 is still queued at 15 and never starts.
    const result = run(await irOf(line({ cardinality: '3' }, 'interrupting')), {
      ...oneCase({ resources: [{ ref: 'reviewer' }] }, { Timer_Deadline: { processingTime: { type: 'constant', value: 15 } } }),
      resources: { reviewer: { capacity: 1 } },
    });
    expect(result.process.cycleTime.mean).toBe(15);
    expect(result.elements.Task_Review).toMatchObject({ started: 3, completed: 1 });
    expect(result.elements.Timer_Deadline).toMatchObject({ started: 1, completed: 1 });
    expect(rowsOf(result, 'Task_Review').map((row) => [row.status, row.startedAt, row.observedUntil])).toEqual([
      ['completed', 0, 10],
      ['interrupted', 10, 15],
      ['interrupted', null, 15],
    ]);
    expect(result.flows.Flow_Out!.count).toBe(0);
    expect(result.flows.Flow_Late!.count).toBe(1);
    expect(result.process.byEndEvent.End_Late?.completed).toBe(1);
  });

  test('on a sequential entry the instances not yet enabled are never created', async () => {
    const result = run(
      await irOf(line({ isSequential: 'true', cardinality: '3' }, 'interrupting')),
      oneCase({}, { Timer_Deadline: { processingTime: { type: 'constant', value: 15 } } }),
    );
    expect(result.elements.Task_Review).toMatchObject({ started: 2, completed: 1 });
    expect(rowsOf(result, 'Task_Review').map((row) => row.status)).toEqual(['completed', 'interrupted']);
  });

  test('a deadline exactly as long as the work interrupts: armed before any instance `done`', async () => {
    const result = run(
      await irOf(line({ cardinality: '3' }, 'interrupting')),
      oneCase({}, { Timer_Deadline: { processingTime: { type: 'constant', value: 10 } } }),
    );
    expect(result.elements.Task_Review).toMatchObject({ started: 3, completed: 0 });
    expect(result.elements.Timer_Deadline).toMatchObject({ started: 1, completed: 1 });
    expect(result.flows.Flow_Out!.count).toBe(0);
  });

  test('a non-interrupting timer fires once per entry and the entry keeps running', async () => {
    const result = run(
      await irOf(line({ isSequential: 'true', cardinality: '3' }, 'non-interrupting')),
      oneCase({}, { Timer_Deadline: { processingTime: { type: 'constant', value: 5 } } }),
    );
    expect(result.elements.Task_Review).toMatchObject({ started: 3, completed: 3 });
    expect(result.elements.Timer_Deadline).toMatchObject({ started: 1, completed: 1 });
    expect(result.flows.Flow_Late!.count).toBe(1);
    expect(result.flows.Flow_Out!.count).toBe(1);
    expect(result.process).toMatchObject({ started: 1, completed: 1 });
    expect(result.process.cycleTime.mean).toBe(30);
  });

  test('terminate closes every open instance; the stop leaves them in flight', async () => {
    const xml = definitions(`    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Split" />
    <bpmn:parallelGateway id="Split" />
    <bpmn:sequenceFlow id="F2" sourceRef="Split" targetRef="Task_Review" />
    <bpmn:sequenceFlow id="F3" sourceRef="Split" targetRef="Timer_Cut" />
    <bpmn:task id="Task_Review">${marker({ cardinality: '3' })}</bpmn:task>
    <bpmn:sequenceFlow id="F4" sourceRef="Task_Review" targetRef="End" />
    <bpmn:endEvent id="End" />
    <bpmn:intermediateCatchEvent id="Timer_Cut"><bpmn:timerEventDefinition id="Def_Cut" /></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F5" sourceRef="Timer_Cut" targetRef="Kill" />
    <bpmn:endEvent id="Kill"><bpmn:terminateEventDefinition id="Def_Kill" /></bpmn:endEvent>`);
    const ir = await irOf(xml);
    const scenario = {
      ...oneCase({ resources: [{ ref: 'reviewer' }] }, { Timer_Cut: { processingTime: { type: 'constant', value: 15 } } }),
      resources: { reviewer: { capacity: 1 } },
    };
    const terminated = run(ir, scenario);
    expect(terminated.process.cycleTime.mean).toBe(15);
    expect(rowsOf(terminated, 'Task_Review').map((row) => row.status)).toEqual(['completed', 'terminated', 'terminated']);
    expect(terminated.flows.F4!.count).toBe(0);

    const stopped = run(ir, {
      ...scenario,
      run: { ...scenario.run, duration: 12 },
      elements: { ...scenario.elements, Timer_Cut: { processingTime: { type: 'constant', value: 100 } } },
    });
    expect(stopped.process).toMatchObject({ started: 1, completed: 0 });
    expect(rowsOf(stopped, 'Task_Review').map((row) => [row.status, row.observedUntil])).toEqual([
      ['completed', 10],
      ['inFlight', 12],
      ['inFlight', 12],
    ]);
  });
});

describe('CLI — `lila validate` and `lila run` accept the element; same seed, same bytes', () => {
  let root: string;
  let output: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lila-multi-instance-'));
    output = [];
    const capture = (...args: unknown[]) => void output.push(args.join(' '));
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  test('two runs with N from a distribution are byte-identical; another seed is not', async () => {
    const model = join(root, 'model.bpmn');
    const scenario = join(root, 'review.scenario.json');
    writeFileSync(model, line({ isSequential: 'true' }), 'utf8');
    writeFileSync(
      scenario,
      JSON.stringify({
        ...BASE,
        run: { ...BASE.run, seed: 9, replications: 2 },
        resources: { reviewer: { capacity: 1 } },
        elements: {
          Start: { interTriggerTimer: { type: 'exponential', mean: 40 }, triggerCount: 20 },
          Task_Review: {
            processingTime: { type: 'exponential', mean: 8 },
            resources: [{ ref: 'reviewer' }],
            instances: { type: 'uniform', min: 0, max: 4 },
          },
        },
      }),
      'utf8',
    );
    const out = (file: string) => join(root, file);

    expect(await main(['validate', model]), output.join('\n')).toBe(0);
    expect(await main(['run', model, scenario, '--json', out('a.json')]), output.join('\n')).toBe(0);
    expect(await main(['run', model, scenario, '--json', out('b.json')])).toBe(0);
    const a = readFileSync(out('a.json'));
    expect(a.length).toBeGreaterThan(0);
    expect(readFileSync(out('b.json'))).toEqual(a);

    expect(await main(['run', model, scenario, '--seed', '10', '--json', out('c.json')])).toBe(0);
    expect(readFileSync(out('c.json'))).not.toEqual(a);
  });
});
