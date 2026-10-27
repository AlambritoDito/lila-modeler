/**
 * #698 (ADR-033) — message start and end events, and none and message intermediate throw events
 * (`docs/SEMANTICS.md` § 9.2, R-MSG-1…2 and R-THR-1…3).
 *
 * The oracle is the model itself: a message start is a none start, a message end is a none end,
 * and a throw event is a milestone that only counts. So the same diagram drawn with message
 * events and with none events, with the **same ids**, must give byte-identical results, and a
 * throw event removed from a sequence must leave every other number where it was. Signal and
 * escalation events stay `E-NOSOP` (#639).
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
import type { SimScenario } from '../src/core/sim.js';
import { simulate } from '../src/index.js';
import { messages } from '../src/messages/index.js';
import { ScenarioSchema, scenarioErrors, validateScenario } from '../src/scenario.js';

type Trigger = 'none' | 'message';

function definitions(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:message id="Message_Order" name="Order" />
  <bpmn:process id="Process_Orders" isExecutable="true">
${body}
  </bpmn:process>
</bpmn:definitions>`;
}

/** An event element with no trigger, or with one message trigger: the only difference allowed. */
function event(tag: string, id: string, trigger: Trigger): string {
  return trigger === 'none'
    ? `<bpmn:${tag} id="${id}" />`
    : `<bpmn:${tag} id="${id}"><bpmn:messageEventDefinition id="Def_${id}" messageRef="Message_Order" /></bpmn:${tag}>`;
}

/**
 * Two arrival streams into one shared desk, an XOR, a throw on each branch and two ends. Every
 * event is drawn with `trigger`; the rest of the diagram, ids included, does not change.
 */
const orders = (trigger: Trigger): string =>
  definitions(`    ${event('startEvent', 'Start_Web', trigger)}
    ${event('startEvent', 'Start_Phone', trigger)}
    <bpmn:sequenceFlow id="Flow_Web_Take" sourceRef="Start_Web" targetRef="Task_Take" />
    <bpmn:sequenceFlow id="Flow_Phone_Take" sourceRef="Start_Phone" targetRef="Task_Take" />
    <bpmn:task id="Task_Take" />
    <bpmn:sequenceFlow id="Flow_Take_Check" sourceRef="Task_Take" targetRef="Gateway_Check" />
    <bpmn:exclusiveGateway id="Gateway_Check" />
    <bpmn:sequenceFlow id="Flow_Ok" sourceRef="Gateway_Check" targetRef="Throw_Accepted" />
    <bpmn:sequenceFlow id="Flow_Ko" sourceRef="Gateway_Check" targetRef="Throw_Rejected" />
    ${event('intermediateThrowEvent', 'Throw_Accepted', trigger)}
    <bpmn:sequenceFlow id="Flow_Accepted_Ship" sourceRef="Throw_Accepted" targetRef="Task_Ship" />
    <bpmn:task id="Task_Ship" />
    <bpmn:sequenceFlow id="Flow_Ship_End" sourceRef="Task_Ship" targetRef="End_Shipped" />
    ${event('endEvent', 'End_Shipped', trigger)}
    ${event('intermediateThrowEvent', 'Throw_Rejected', trigger)}
    <bpmn:sequenceFlow id="Flow_Rejected_End" sourceRef="Throw_Rejected" targetRef="End_Rejected" />
    ${event('endEvent', 'End_Rejected', trigger)}`);

const ORDERS_SCENARIO = {
  version: 1,
  name: 'Orders',
  model: 'model.bpmn',
  run: { start: '2026-09-07T08:00:00-06:00', seed: 7, replications: 3, warmup: 600, serviceLevel: 3600 },
  resources: {
    desk: { capacity: 1, costPerHour: 60, fixedCost: 1 },
    courier: { capacity: 2, costPerHour: 40 },
  },
  elements: {
    Start_Web: { interTriggerTimer: { type: 'exponential', mean: 300 }, triggerCount: 40 },
    Start_Phone: { interTriggerTimer: { type: 'uniform', min: 200, max: 600 }, triggerCount: 20 },
    Task_Take: {
      processingTime: { type: 'triangular', min: 60, mode: 180, max: 420 },
      resources: [{ ref: 'desk' }],
      fixedCost: 2.5,
    },
    Task_Ship: {
      processingTime: { type: 'normal', mean: 400, sd: 50 },
      resources: [{ ref: 'courier' }],
    },
    Flow_Ok: { probability: 0.7 },
    Flow_Ko: { probability: 0.3 },
  },
};

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

describe('R-MSG-1, R-MSG-2, R-THR-1 — the IR', () => {
  test('a message start is a `start`, a message end an `end`, and both throws a `throw`', async () => {
    const ir = await irOf(orders('message'));
    expect(ir.nodes.Start_Web?.type).toBe('start');
    expect(ir.nodes.End_Shipped?.type).toBe('end');
    expect(ir.nodes.Throw_Accepted?.type).toBe('throw');

    const none = await irOf(orders('none'));
    expect(none.nodes.Throw_Accepted?.type).toBe('throw');
    // Same ids, same edges: the trigger is the only difference and it never reaches the IR.
    expect(none.nodes).toEqual(ir.nodes);
    expect(none.flows).toEqual(ir.flows);
  });
});

describe('oracle — message events give the same results as none events', () => {
  test('the same diagram with message and with none events is byte-identical, log included', async () => {
    const withMessages = run(await irOf(orders('message')), ORDERS_SCENARIO);
    const withNone = run(await irOf(orders('none')), ORDERS_SCENARIO);

    expect(JSON.stringify(withMessages)).toBe(JSON.stringify(withNone));
    // Not a vacuous comparison: both arrival streams ran and both branches were taken.
    expect(withMessages.elements.Start_Web!.completed).toBeGreaterThan(0);
    expect(withMessages.elements.Start_Phone!.completed).toBeGreaterThan(0);
    expect(withMessages.process.byEndEvent.End_Shipped!.completed).toBeGreaterThan(0);
    expect(withMessages.process.byEndEvent.End_Rejected!.completed).toBeGreaterThan(0);
  });

  test('a message start and end inside an embedded sub-process flatten like none ones', async () => {
    const box = (trigger: Trigger): string =>
      definitions(`    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="Flow_Start_Box" sourceRef="Start" targetRef="Sub_Box" />
    <bpmn:subProcess id="Sub_Box">
      ${event('startEvent', 'Start_Inner', trigger)}
      <bpmn:sequenceFlow id="Flow_Inner_Work" sourceRef="Start_Inner" targetRef="Task_Work" />
      <bpmn:task id="Task_Work" />
      <bpmn:sequenceFlow id="Flow_Work_Throw" sourceRef="Task_Work" targetRef="Throw_Inner" />
      ${event('intermediateThrowEvent', 'Throw_Inner', trigger)}
      <bpmn:sequenceFlow id="Flow_Throw_End" sourceRef="Throw_Inner" targetRef="End_Inner" />
      ${event('endEvent', 'End_Inner', trigger)}
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="Flow_Box_End" sourceRef="Sub_Box" targetRef="End" />
    <bpmn:endEvent id="End" />`);
    const scenario = {
      ...ORDERS_SCENARIO,
      resources: undefined,
      elements: {
        Start: { interTriggerTimer: { type: 'exponential', mean: 120 }, triggerCount: 25 },
        Task_Work: { processingTime: { type: 'lognormal', mean: 90, sd: 30 } },
      },
    };
    const withMessages = await irOf(box('message'));
    // R-PLAN-2: the inner start and end are gone; the inner throw stays, with its sub-process.
    expect(withMessages.nodes.Start_Inner).toBeUndefined();
    expect(withMessages.nodes.End_Inner).toBeUndefined();
    expect(withMessages.nodes.Throw_Inner).toMatchObject({ type: 'throw', subprocessId: 'Sub_Box' });

    expect(JSON.stringify(run(withMessages, scenario))).toBe(JSON.stringify(run(await irOf(box('none')), scenario)));
  });
});

describe('R-THR-1, R-THR-2 — a throw event is a milestone that only counts', () => {
  /** Start → Task_A → [Throw_Milestone] → Task_B → End, with or without the throw. */
  const line = (withThrow: Trigger | false): string =>
    definitions(`    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="Flow_Start_A" sourceRef="Start" targetRef="Task_A" />
    <bpmn:task id="Task_A" />
${
  withThrow === false
    ? `    <bpmn:sequenceFlow id="Flow_A_B" sourceRef="Task_A" targetRef="Task_B" />`
    : `    <bpmn:sequenceFlow id="Flow_A_Throw" sourceRef="Task_A" targetRef="Throw_Milestone" />
    ${event('intermediateThrowEvent', 'Throw_Milestone', withThrow)}
    <bpmn:sequenceFlow id="Flow_Throw_B" sourceRef="Throw_Milestone" targetRef="Task_B" />`
}
    <bpmn:task id="Task_B" />
    <bpmn:sequenceFlow id="Flow_B_End" sourceRef="Task_B" targetRef="End" />
    <bpmn:endEvent id="End" />`);

  test('hand-computed: three cases pass the milestone with no time, no row and no cost', async () => {
    const scenario = {
      ...ORDERS_SCENARIO,
      run: { start: '2026-09-07T08:00:00-06:00', seed: 1 },
      resources: undefined,
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 100 }, triggerCount: 3 },
        Task_A: { processingTime: { type: 'constant', value: 30 } },
        Task_B: { processingTime: { type: 'constant', value: 40 } },
      },
    };
    for (const trigger of ['none', 'message'] as const) {
      const result = run(await irOf(line(trigger)), scenario);

      expect(result.process).toMatchObject({ started: 3, completed: 3, inFlight: 0 });
      expect(result.process.cycleTime.mean).toBe(70);
      expect(result.elements.Throw_Milestone).toMatchObject({
        started: 3,
        completed: 3,
        processing: { min: 0, max: 0, mean: 0, total: 0 },
        fixedCostTotal: 0,
      });
      expect(result.flows.Flow_A_Throw!.count).toBe(3);
      expect(result.flows.Flow_Throw_B!.count).toBe(3);
      // R-THR-1: no event-log row of its own, unlike a task or a timer.
      expect((result.log ?? []).filter((row) => row.elementId === 'Throw_Milestone')).toEqual([]);
      expect(result.warnings).toEqual([]);
    }
  });

  test('R-THR-2: resources and arrival fields are refused; time, calendar and fixed cost change nothing', async () => {
    const ir = await irOf(line('message'));
    const base = {
      ...ORDERS_SCENARIO,
      run: { start: '2026-09-07T08:00:00-06:00', seed: 1 },
      calendars: { office: { intervals: [{ days: ['MON'], from: '09:00', to: '10:00' }] } },
      resources: { desk: { capacity: 1, costPerHour: 60 } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 100 }, triggerCount: 3 },
        Task_A: { processingTime: { type: 'constant', value: 30 } },
        Task_B: { processingTime: { type: 'constant', value: 40 } },
      },
    };
    const withThrow = (fields: Record<string, unknown>) =>
      ScenarioSchema.parse({ ...base, elements: { ...base.elements, Throw_Milestone: fields } });

    const refused = validateScenario(
      withThrow({ resources: [{ ref: 'desk' }], interTriggerTimer: { type: 'constant', value: 5 }, triggerCount: 2 }),
      ir,
    ).filter((problem) => problem.severity === 'error');
    expect(refused.map((problem) => [problem.code, problem.path])).toEqual([
      ['E-CAMPO-NO-APLICA', 'elements.Throw_Milestone.interTriggerTimer'],
      ['E-CAMPO-NO-APLICA', 'elements.Throw_Milestone.triggerCount'],
      ['E-CAMPO-NO-APLICA', 'elements.Throw_Milestone.resources'],
    ]);

    const ignored = run(ir, {
      ...base,
      elements: {
        ...base.elements,
        Throw_Milestone: { processingTime: { type: 'constant', value: 999 }, calendar: 'office', fixedCost: 7 },
      },
    });
    const plain = run(ir, base);
    expect(ignored.elements.Throw_Milestone!.fixedCostTotal).toBe(0);
    expect(ignored.process.totalCost).toBe(plain.process.totalCost);
    expect(JSON.stringify(ignored)).toBe(JSON.stringify(plain));
  });

  test('the throw has its own label in the process description, in both languages', () => {
    expect(messages('en').mcp.nodeType('throw')).toBe('intermediate throw event');
    expect(messages('es').mcp.nodeType('throw')).toBe('evento intermedio de lanzamiento');
  });

  test('removing the throw moves no other number, with random times and a shared pool', async () => {
    const scenario = {
      ...ORDERS_SCENARIO,
      resources: { desk: { capacity: 1, costPerHour: 30, fixedCost: 0.5 } },
      elements: {
        Start: { interTriggerTimer: { type: 'exponential', mean: 200 }, triggerCount: 60 },
        Task_A: { processingTime: { type: 'exponential', mean: 120 }, resources: [{ ref: 'desk' }] },
        Task_B: { processingTime: { type: 'gamma', shape: 2, scale: 50 }, resources: [{ ref: 'desk' }] },
      },
    };
    const withThrow = run(await irOf(line('none')), scenario);
    const without = run(await irOf(line(false)), scenario);

    const drop = (result: RunResult) => {
      const { flows, elements, replications, ...rest } = result;
      const { Throw_Milestone: _milestone, ...others } = elements;
      const kpis = Object.fromEntries(
        Object.entries(replications?.kpis ?? {}).filter(([path]) => !/Throw_Milestone|Flow_A_|Flow_Throw_/.test(path)),
      );
      return { rest, others, kpis, flows: { Flow_Start_A: flows.Flow_Start_A, Flow_B_End: flows.Flow_B_End } };
    };
    expect(drop(withThrow)).toEqual(drop(without));
    // R-THR-3: one flow became two, each traversed exactly as often as the one it replaced.
    expect(withThrow.flows.Flow_A_Throw!.count).toBe(without.flows.Flow_A_B!.count);
    expect(withThrow.flows.Flow_Throw_B!.count).toBe(without.flows.Flow_A_B!.count);
    expect(withThrow.elements.Throw_Milestone!.completed).toBe(without.elements.Task_A!.completed);
    expect(without.resources.desk!.utilization).toBeGreaterThan(0.5);
  });
});

describe('determinism (R-DET-6) — same seed, same bytes through `lila run --json`', () => {
  let root: string;
  let output: string[];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lila-message-events-'));
    output = [];
    const capture = (...args: unknown[]) => void output.push(args.join(' '));
    vi.spyOn(console, 'log').mockImplementation(capture);
    vi.spyOn(console, 'error').mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  function project(name: string, trigger: Trigger): { model: string; scenario: string } {
    const folder = join(root, name);
    mkdirSync(folder);
    const model = join(folder, 'model.bpmn');
    const scenario = join(folder, 'orders.scenario.json');
    writeFileSync(model, orders(trigger), 'utf8');
    writeFileSync(scenario, JSON.stringify(ORDERS_SCENARIO), 'utf8');
    return { model, scenario };
  }

  test('two runs of the message model are byte-identical, and equal to the none model', async () => {
    const message = project('message', 'message');
    const none = project('none', 'none');
    const out = (file: string) => join(root, file);

    expect(await main(['run', message.model, message.scenario, '--json', out('a.json')]), output.join('\n')).toBe(0);
    expect(await main(['run', message.model, message.scenario, '--json', out('b.json')])).toBe(0);
    expect(await main(['run', none.model, none.scenario, '--json', out('c.json')])).toBe(0);

    const a = readFileSync(out('a.json'));
    expect(a.length).toBeGreaterThan(0);
    expect(readFileSync(out('b.json'))).toEqual(a);
    expect(readFileSync(out('c.json'))).toEqual(a);

    // Another seed moves the numbers, so the equality above is not two empty runs.
    expect(await main(['run', message.model, message.scenario, '--seed', '8', '--json', out('d.json')])).toBe(0);
    expect(readFileSync(out('d.json'))).not.toEqual(a);
  });
});

describe('signal and escalation stay out of the profile (#639)', () => {
  test('every signal and escalation start, throw and end, and the other message uses, give `E-NOSOP`', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_Out" isExecutable="true">
    <bpmn:startEvent id="Start" />
    <bpmn:startEvent id="Start_Signal"><bpmn:signalEventDefinition id="S1" /></bpmn:startEvent>
    <bpmn:startEvent id="Start_Escalation" name="Escalated"><bpmn:escalationEventDefinition id="E1" /></bpmn:startEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Task" />
    <bpmn:task id="Task" />
    <bpmn:boundaryEvent id="Boundary_Message" attachedToRef="Task"><bpmn:messageEventDefinition id="M1" /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F_B" sourceRef="Boundary_Message" targetRef="End" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task" targetRef="Throw_Signal" />
    <bpmn:intermediateThrowEvent id="Throw_Signal"><bpmn:signalEventDefinition id="S2" /></bpmn:intermediateThrowEvent>
    <bpmn:sequenceFlow id="F3" sourceRef="Throw_Signal" targetRef="Throw_Escalation" />
    <bpmn:intermediateThrowEvent id="Throw_Escalation"><bpmn:escalationEventDefinition id="E2" /></bpmn:intermediateThrowEvent>
    <bpmn:sequenceFlow id="F4" sourceRef="Throw_Escalation" targetRef="Throw_Twice" />
    <bpmn:intermediateThrowEvent id="Throw_Twice"><bpmn:messageEventDefinition id="M2" /><bpmn:signalEventDefinition id="S3" /></bpmn:intermediateThrowEvent>
    <bpmn:sequenceFlow id="F5" sourceRef="Throw_Twice" targetRef="Catch_Message" />
    <bpmn:intermediateCatchEvent id="Catch_Message"><bpmn:messageEventDefinition id="M3" /></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="F6" sourceRef="Catch_Message" targetRef="End_Signal" />
    <bpmn:endEvent id="End_Signal"><bpmn:signalEventDefinition id="S4" /></bpmn:endEvent>
    <bpmn:endEvent id="End_Escalation"><bpmn:escalationEventDefinition id="E3" /></bpmn:endEvent>
    <bpmn:endEvent id="End_Message_Terminate"><bpmn:messageEventDefinition id="M4" /><bpmn:terminateEventDefinition id="T1" /></bpmn:endEvent>
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`;
    const { ir, unsupported } = await parseBpmn(xml);
    const nosop = (locale: 'en' | 'es') =>
      validate(ir, { unsupported, locale })
        .errors.filter((error) => error.code === 'E-NOSOP')
        .map((error) => error.message);

    expect(nosop('en')).toEqual([
      'Start_Signal (bpmn:startEvent): signal event not supported by the simulator.',
      'Start_Escalation (bpmn:startEvent, "Escalated"): escalation event not supported by the simulator.',
      'Boundary_Message (bpmn:boundaryEvent): event attached to an activity (boundary event) not supported by the simulator.',
      'Throw_Signal (bpmn:intermediateThrowEvent): intermediate throw event not supported by the simulator.',
      'Throw_Escalation (bpmn:intermediateThrowEvent): intermediate throw event not supported by the simulator.',
      'Throw_Twice (bpmn:intermediateThrowEvent): intermediate throw event not supported by the simulator.',
      'Catch_Message (bpmn:intermediateCatchEvent): message event not supported by the simulator.',
      'End_Signal (bpmn:endEvent): signal event not supported by the simulator.',
      'End_Escalation (bpmn:endEvent): escalation event not supported by the simulator.',
      'End_Message_Terminate (bpmn:endEvent): event with multiple triggers not supported by the simulator.',
    ]);
    expect(nosop('es')[0]).toBe('Start_Signal (bpmn:startEvent): evento de señal no soportado por el simulador.');
  });
});
