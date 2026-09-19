/**
 * #81, third slice — **event-based gateway** with timer and message branches (R-EVG-1…7 of
 * `docs/SEMANTICS.md` § 9.1).
 *
 * The models are inline, like the rest of the boundary and gateway tests. What is under test is
 * the race between the branches, not the sampling, so almost everything runs on constant
 * distributions, one replication and `seed: 42`; the determinism test (R-EVG-3, § 16) is the one
 * with real distributions.
 */
import { expect, test } from 'vitest';

import { parseBpmn } from '../src/bpmn/parse.js';
import { validate } from '../src/bpmn/validate.js';
import type { ProcessIR } from '../src/core/ir.js';
import { simulate } from '../src/core/run.js';
import type { EventLogRow, RunResult } from '../src/core/result.js';

const seconds = (value: number) => ({ type: 'constant' as const, value });

type Scenario = Parameters<typeof simulate>[1];

function definitions(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_Evento" isExecutable="true">
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

/**
 * `Task_Pedir` hands its token to an event-based gateway with two branches, listed in this
 * order: `Event_Respuesta` (the trigger given) and `Event_Plazo` (a timer). Each branch has its
 * own task and its own end, so every counter tells the two apart.
 */
const carrera = (primero: 'message' | 'timer'): string =>
  `    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Pedir" sourceRef="Start_Proceso" targetRef="Task_Pedir" />
    <bpmn:task id="Task_Pedir" name="Pedir" />
    <bpmn:sequenceFlow id="Flow_Pedir_Espera" sourceRef="Task_Pedir" targetRef="Gateway_Espera" />
    <bpmn:eventBasedGateway id="Gateway_Espera" name="Espera" />
    <bpmn:sequenceFlow id="Flow_Espera_Respuesta" sourceRef="Gateway_Espera" targetRef="Event_Respuesta" />
    <bpmn:sequenceFlow id="Flow_Espera_Plazo" sourceRef="Gateway_Espera" targetRef="Event_Plazo" />
    <bpmn:intermediateCatchEvent id="Event_Respuesta" name="Llega respuesta">
      <bpmn:${primero}EventDefinition id="Trigger_Respuesta" />
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_Respuesta_Registrar" sourceRef="Event_Respuesta" targetRef="Task_Registrar" />
    <bpmn:task id="Task_Registrar" name="Registrar" />
    <bpmn:sequenceFlow id="Flow_Registrar_Fin" sourceRef="Task_Registrar" targetRef="End_Respondido" />
    <bpmn:endEvent id="End_Respondido" name="Respondido" />
    <bpmn:intermediateCatchEvent id="Event_Plazo" name="Vence el plazo">
      <bpmn:timerEventDefinition id="Trigger_Plazo" />
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_Plazo_Reclamar" sourceRef="Event_Plazo" targetRef="Task_Reclamar" />
    <bpmn:task id="Task_Reclamar" name="Reclamar" />
    <bpmn:sequenceFlow id="Flow_Reclamar_Fin" sourceRef="Task_Reclamar" targetRef="End_Vencido" />
    <bpmn:endEvent id="End_Vencido" name="Vencido" />`;

const dosTimers = (): Promise<ProcessIR> => irOf(definitions(carrera('timer')));
const mensajeYTimer = (): Promise<ProcessIR> => irOf(definitions(carrera('message')));

/** The same scenario for both models: only the two branch delays change per test. */
const escenario = (respuesta: number, plazo: number): Scenario => ({
  run: { seed: 42, replications: 1 },
  elements: {
    Start_Proceso: { triggerCount: 1 },
    Task_Pedir: { processingTime: seconds(60) },
    Event_Respuesta: { processingTime: seconds(respuesta) },
    Event_Plazo: { processingTime: seconds(plazo) },
    Task_Registrar: { processingTime: seconds(5) },
    Task_Reclamar: { processingTime: seconds(7) },
  },
});

test('R-EVG-1 — the gateway is an `eventGateway` and its branches are `timer` nodes', async () => {
  const ir = await mensajeYTimer();

  expect(ir.nodes['Gateway_Espera']).toMatchObject({
    type: 'eventGateway',
    incoming: ['Flow_Pedir_Espera'],
    outgoing: ['Flow_Espera_Respuesta', 'Flow_Espera_Plazo'],
  });
  // R-EVG-2: the message branch is a wait with a time, the same `timer` node as the timer one.
  expect(ir.nodes['Event_Respuesta']).toMatchObject({
    type: 'timer',
    incoming: ['Flow_Espera_Respuesta'],
    outgoing: ['Flow_Respuesta_Registrar'],
  });
  expect(ir.nodes['Event_Plazo']?.type).toBe('timer');
});

test('(a) two timers: the shorter one wins, the other leaves no trace', async () => {
  const result = simulate(await dosTimers(), escenario(100, 300));

  // R-EVG-3: the gateway counts like any other gateway, in the instant the token reaches it.
  expect(result.elements['Gateway_Espera']).toMatchObject({ started: 1, completed: 1 });
  // The winner counts one `started` (when it is armed, t = 60) and one `completed` (when it
  // fires, t = 160), and emits the event-log row of any other timer.
  expect(result.elements['Event_Respuesta']).toMatchObject({ started: 1, completed: 1 });
  expect(rowsOf(result, 'Event_Respuesta')).toHaveLength(1);
  expect(rowsOf(result, 'Event_Respuesta')[0]).toMatchObject({
    caseId: '1',
    status: 'completed',
    enabledAt: 60,
    startedAt: 60,
    endedAt: 160,
    resourceId: null,
  });
  // R-EVG-3: the discarded branch counts nothing and writes no row at all.
  expect(result.elements['Event_Plazo']).toMatchObject({ started: 0, completed: 0 });
  expect(rowsOf(result, 'Event_Plazo')).toEqual([]);
  expect(result.elements['Task_Reclamar']).toMatchObject({ started: 0, completed: 0 });

  // Only the winner's flow was walked.
  expect(result.flows['Flow_Espera_Respuesta']?.count).toBe(1);
  expect(result.flows['Flow_Espera_Plazo']?.count).toBe(0);
  expect(result.flows['Flow_Respuesta_Registrar']?.count).toBe(1);
  expect(result.flows['Flow_Plazo_Reclamar']?.count).toBe(0);

  expect(result.process).toMatchObject({ started: 1, completed: 1, inFlight: 0 });
  expect(result.process.byEndEvent['End_Respondido']?.completed).toBe(1);
  expect(result.process.byEndEvent['End_Vencido']?.completed).toBe(0);
  // 60 (task) + 100 (wait) + 5 (task) with no queue anywhere.
  expect(result.process.cycleTime.max).toBe(165);
});

test('(a bis) two timers: when the deadline is the shorter one it takes the token instead', async () => {
  const result = simulate(await dosTimers(), escenario(300, 100));

  expect(result.elements['Event_Plazo']).toMatchObject({ started: 1, completed: 1 });
  expect(result.elements['Event_Respuesta']).toMatchObject({ started: 0, completed: 0 });
  expect(rowsOf(result, 'Event_Plazo')[0]).toMatchObject({ enabledAt: 60, endedAt: 160 });
  expect(result.flows['Flow_Espera_Plazo']?.count).toBe(1);
  expect(result.flows['Flow_Espera_Respuesta']?.count).toBe(0);
  expect(result.process.byEndEvent['End_Vencido']?.completed).toBe(1);
  expect(result.process.cycleTime.max).toBe(167);
});

test('(b) message + timer: the message is shorter and wins', async () => {
  const result = simulate(await mensajeYTimer(), escenario(90, 240));

  // R-EVG-2: the message branch is simulated as a wait of its own `processingTime` — the Bizagi
  // convention — so it races exactly like the timer next to it.
  expect(result.elements['Event_Respuesta']).toMatchObject({ started: 1, completed: 1 });
  expect(rowsOf(result, 'Event_Respuesta')[0]).toMatchObject({
    status: 'completed',
    enabledAt: 60,
    endedAt: 150,
  });
  expect(result.elements['Event_Plazo']).toMatchObject({ started: 0, completed: 0 });
  expect(result.elements['Task_Registrar']).toMatchObject({ started: 1, completed: 1 });
  expect(result.process.byEndEvent['End_Respondido']?.completed).toBe(1);
  expect(result.process.cycleTime.max).toBe(155);
});

test('(c) determinism: same seed twice, and a third branch moves no other draw', async () => {
  const dos = await mensajeYTimer();
  const scenario = {
    run: { seed: 7, replications: 1, duration: 7200 },
    elements: {
      Start_Proceso: { interTriggerTimer: { type: 'exponential' as const, mean: 120 } },
      Task_Pedir: { processingTime: { type: 'exponential' as const, mean: 90 } },
      Event_Respuesta: { processingTime: { type: 'uniform' as const, min: 30, max: 300 } },
      Event_Plazo: { processingTime: { type: 'uniform' as const, min: 60, max: 200 } },
      Task_Registrar: { processingTime: { type: 'normal' as const, mean: 20, sd: 5 } },
      Task_Reclamar: { processingTime: { type: 'normal' as const, mean: 30, sd: 5 } },
    },
  };

  // R-DET-6: same seed, same input, identical output.
  expect(simulate(dos, scenario)).toEqual(simulate(dos, scenario));
  // The race really is a race: both branches win some of the cases.
  const dosResult = simulate(dos, scenario);
  expect(dosResult.elements['Event_Respuesta']?.completed).toBeGreaterThan(0);
  expect(dosResult.elements['Event_Plazo']?.completed).toBeGreaterThan(0);

  // R-EVG-3 / § 16: a third branch, with its own stream, does not shift a single draw of the
  // elements that were already there. Its delay is far too long to ever win, so the winners —
  // and every instant of the run — are the same as without it.
  const tres = await irOf(
    definitions(
      `${carrera('message')}
    <bpmn:sequenceFlow id="Flow_Espera_Cancela" sourceRef="Gateway_Espera" targetRef="Event_Cancela" />
    <bpmn:intermediateCatchEvent id="Event_Cancela" name="Cancela el cliente">
      <bpmn:messageEventDefinition id="Trigger_Cancela" />
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_Cancela_Fin" sourceRef="Event_Cancela" targetRef="End_Cancelado" />
    <bpmn:endEvent id="End_Cancelado" name="Cancelado" />`,
    ),
  );
  const conTres = simulate(tres, {
    ...scenario,
    elements: { ...scenario.elements, Event_Cancela: { processingTime: seconds(100_000) } },
  });

  expect(conTres.elements['Event_Cancela']).toMatchObject({ started: 0, completed: 0 });
  const instantes = (result: RunResult, elementId: string) =>
    rowsOf(result, elementId).map((row) => [row.caseId, row.enabledAt, row.startedAt, row.endedAt]);
  for (const elementId of ['Task_Pedir', 'Event_Respuesta', 'Event_Plazo', 'Task_Registrar']) {
    expect(instantes(conTres, elementId), elementId).toEqual(instantes(dosResult, elementId));
    expect(conTres.elements[elementId], elementId).toEqual(dosResult.elements[elementId]);
  }
  expect(conTres.process.cycleTime).toEqual(dosResult.process.cycleTime);
});

test('(d) a tie goes to the branch listed first among the gateway’s outgoing flows', async () => {
  const ir = await mensajeYTimer();
  const result = simulate(ir, escenario(120, 120));

  // R-EVG-4: with the same firing instant the first `outgoing` wins, which is the document order
  // of the gateway's flows (R-TOK-3). `Flow_Espera_Respuesta` is declared first.
  expect(ir.nodes['Gateway_Espera']?.outgoing[0]).toBe('Flow_Espera_Respuesta');
  expect(result.elements['Event_Respuesta']).toMatchObject({ started: 1, completed: 1 });
  expect(result.elements['Event_Plazo']).toMatchObject({ started: 0, completed: 0 });
  expect(result.process.byEndEvent['End_Respondido']?.completed).toBe(1);

  // And the other way around when the timer is the one declared first: the rule is the order, not
  // the trigger.
  const invertido = await irOf(
    definitions(
      carrera('message')
        .replace(
          '    <bpmn:sequenceFlow id="Flow_Espera_Respuesta" sourceRef="Gateway_Espera" targetRef="Event_Respuesta" />\n',
          '',
        )
        .replace(
          '    <bpmn:sequenceFlow id="Flow_Espera_Plazo" sourceRef="Gateway_Espera" targetRef="Event_Plazo" />',
          '    <bpmn:sequenceFlow id="Flow_Espera_Plazo" sourceRef="Gateway_Espera" targetRef="Event_Plazo" />\n    <bpmn:sequenceFlow id="Flow_Espera_Respuesta" sourceRef="Gateway_Espera" targetRef="Event_Respuesta" />',
        ),
    ),
  );
  expect(invertido.nodes['Gateway_Espera']?.outgoing[0]).toBe('Flow_Espera_Plazo');
  const otro = simulate(invertido, escenario(120, 120));
  expect(otro.elements['Event_Plazo']).toMatchObject({ started: 1, completed: 1 });
  expect(otro.elements['Event_Respuesta']).toMatchObject({ started: 0, completed: 0 });
});

/* ------------------------------------------------------------------ *
 * (e) validation: what stays out of the profile
 * ------------------------------------------------------------------ */

const nosop = async (xml: string): Promise<{ errors: string[]; ir: ProcessIR }> => {
  const { ir, unsupported } = await parseBpmn(xml);
  const { errors } = validate(ir, { unsupported });
  return {
    errors: errors.filter((problem) => problem.code === 'E-NOSOP').map((problem) => problem.message),
    ir,
  };
};

test('(e) a gateway followed by a task stays `E-NOSOP`, with the text of § 3 unchanged', async () => {
  const { errors, ir } = await nosop(
    definitions(
      carrera('timer').replace(
        'targetRef="Event_Respuesta" />',
        'targetRef="Task_Registrar" />',
      ),
    ),
  );

  // R-EVG-1 is all-or-nothing: one branch that is not a catch event leaves the whole gateway out,
  // with the construction § 3 already had for it.
  expect(errors).toEqual([
    'Gateway_Espera (bpmn:eventBasedGateway, "Espera"): event-based gateway not supported by the simulator.',
  ]);
  expect(ir.nodes['Gateway_Espera']).toBeUndefined();
});

test('(e) a parallel event gateway, `instantiate="true"` and `instantiate="1"` stay `E-NOSOP`', async () => {
  for (const attribute of [
    'eventGatewayType="Parallel"',
    'instantiate="true"',
    // bpmn-moddle collapses every `xsd:boolean` with `s === 'true'`, so this literal — which
    // means *true* in BPMN — reaches the tree as `false`. R-EVG-1 reads the raw XML instead.
    'instantiate="1"',
    'instantiate="TRUE"',
  ]) {
    const { errors, ir } = await nosop(
      definitions(
        carrera('timer').replace(
          '<bpmn:eventBasedGateway id="Gateway_Espera" name="Espera" />',
          `<bpmn:eventBasedGateway id="Gateway_Espera" name="Espera" ${attribute} />`,
        ),
      ),
    );
    expect(errors, attribute).toEqual([
      'Gateway_Espera (bpmn:eventBasedGateway, "Espera"): event-based gateway not supported by the simulator.',
    ]);
    expect(ir.nodes['Gateway_Espera'], attribute).toBeUndefined();
  }

  // `instantiate="false"` and `"0"` are the same as not declaring it (R-EVG-1).
  for (const attribute of ['instantiate="false"', 'instantiate="0"']) {
    const ir = await irOf(
      definitions(
        carrera('timer').replace(
          '<bpmn:eventBasedGateway id="Gateway_Espera" name="Espera" />',
          `<bpmn:eventBasedGateway id="Gateway_Espera" name="Espera" ${attribute} />`,
        ),
      ),
    );
    expect(ir.nodes['Gateway_Espera']?.type, attribute).toBe('eventGateway');
  }
});

test('(e) a standalone intermediate message catch event stays `E-NOSOP`', async () => {
  const { errors, ir } = await nosop(
    definitions(`    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Espera" sourceRef="Start_Proceso" targetRef="Event_Respuesta" />
    <bpmn:intermediateCatchEvent id="Event_Respuesta" name="Llega respuesta">
      <bpmn:messageEventDefinition id="Trigger_Respuesta" />
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_Respuesta_Fin" sourceRef="Event_Respuesta" targetRef="End_Proceso" />
    <bpmn:endEvent id="End_Proceso" name="Fin" />`),
  );

  // § 3: only a branch of a supported event-based gateway makes a message event simulable.
  expect(errors).toEqual([
    'Event_Respuesta (bpmn:intermediateCatchEvent, "Llega respuesta"): message event not supported by the simulator.',
  ]);
  expect(ir.nodes['Event_Respuesta']).toBeUndefined();
});

test('(e) a branch reachable from somewhere else leaves the gateway out of the profile', async () => {
  // R-EVG-1 asks the branch for exactly one incoming flow, the gateway's: with a second way in,
  // a token could reach the event without the race ever happening.
  const { errors } = await nosop(
    definitions(
      `${carrera('timer')}
    <bpmn:sequenceFlow id="Flow_Pedir_Plazo" sourceRef="Task_Pedir" targetRef="Event_Plazo" />`,
    ),
  );

  expect(errors).toEqual([
    'Gateway_Espera (bpmn:eventBasedGateway, "Espera"): event-based gateway not supported by the simulator.',
  ]);
});

test('(e) a branch with no `processingTime` never fires and warns, citing its gateway', async () => {
  const ir = await mensajeYTimer();
  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { interTriggerTimer: seconds(500), triggerCount: 2 },
      Task_Pedir: { processingTime: seconds(60) },
      Event_Plazo: { processingTime: seconds(100) },
      Task_Registrar: { processingTime: seconds(5) },
      Task_Reclamar: { processingTime: seconds(7) },
    },
  });

  // R-EVG-5: the existing `W-TIMER-SIN-TIEMPO`, with no new code, aggregated into one line even
  // though both cases pass by the gateway.
  const warnings = result.warnings.filter((warning) => warning.startsWith('W-TIMER-SIN-TIEMPO'));
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('Event_Respuesta');
  expect(warnings[0]).toContain('Gateway_Espera');
  // The branch without a time cannot win, so the other one takes every token.
  expect(result.elements['Event_Respuesta']).toMatchObject({ started: 0, completed: 0 });
  expect(result.elements['Event_Plazo']).toMatchObject({ started: 2, completed: 2 });
  expect(result.process).toMatchObject({ started: 2, completed: 2, inFlight: 0 });
});

test('(e) with no branch able to fire the token stays at the gateway and it is named', async () => {
  const ir = await mensajeYTimer();
  const result = simulate(ir, {
    run: { seed: 42, replications: 1, duration: 1000 },
    elements: {
      Start_Proceso: { triggerCount: 2, interTriggerTimer: seconds(100) },
      Task_Pedir: { processingTime: seconds(60) },
      Task_Registrar: { processingTime: seconds(5) },
      Task_Reclamar: { processingTime: seconds(7) },
    },
  });

  // R-EVG-6: no branch declares a time, so no delay can elapse; the token is stuck and the case
  // is left in flight. The blocked-token warning names the gateway and counts the cases.
  const blocked = result.warnings.filter((warning) => warning.startsWith('W-JOIN-BLOQUEADO'));
  expect(blocked).toHaveLength(1);
  expect(blocked[0]).toContain('Gateway_Espera');
  expect(blocked[0]).toContain('2');
  expect(result.elements['Gateway_Espera']).toMatchObject({ started: 2, completed: 2 });
  expect(result.process).toMatchObject({ started: 2, completed: 0, inFlight: 2 });
});

/* ------------------------------------------------------------------ *
 * (f) and (g)
 * ------------------------------------------------------------------ */

test('(f) inside a loop the gateway arms a fresh race on every pass', async () => {
  // The XOR sends every token back to the gateway (`probability: 1`), so the loop only ends when
  // the run's duration cuts it: three passes in 25 seconds with a 10-second branch.
  const ir = await irOf(
    definitions(`    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Espera" sourceRef="Start_Proceso" targetRef="Gateway_Espera" />
    <bpmn:eventBasedGateway id="Gateway_Espera" />
    <bpmn:sequenceFlow id="Flow_Espera_Corto" sourceRef="Gateway_Espera" targetRef="Event_Corto" />
    <bpmn:sequenceFlow id="Flow_Espera_Largo" sourceRef="Gateway_Espera" targetRef="Event_Largo" />
    <bpmn:intermediateCatchEvent id="Event_Corto">
      <bpmn:timerEventDefinition id="Trigger_Corto" />
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_Corto_Ciclo" sourceRef="Event_Corto" targetRef="Gateway_Ciclo" />
    <bpmn:intermediateCatchEvent id="Event_Largo">
      <bpmn:messageEventDefinition id="Trigger_Largo" />
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_Largo_Ciclo" sourceRef="Event_Largo" targetRef="Gateway_Ciclo" />
    <bpmn:exclusiveGateway id="Gateway_Ciclo" />
    <bpmn:sequenceFlow id="Flow_Ciclo_Espera" sourceRef="Gateway_Ciclo" targetRef="Gateway_Espera" />
    <bpmn:sequenceFlow id="Flow_Ciclo_Fin" sourceRef="Gateway_Ciclo" targetRef="End_Proceso" />
    <bpmn:endEvent id="End_Proceso" name="Fin" />`),
  );

  const result = simulate(ir, {
    run: { seed: 42, replications: 1, duration: 25 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Event_Corto: { processingTime: { type: 'uniform', min: 9, max: 11 } },
      Event_Largo: { processingTime: seconds(1000) },
      Flow_Ciclo_Espera: { probability: 1 },
    },
  });

  // Entered at t = 0 and after each firing: one race per pass, each with its own draw.
  expect(result.elements['Gateway_Espera']).toMatchObject({ started: 3, completed: 3 });
  expect(result.elements['Event_Corto']).toMatchObject({ started: 3, completed: 2 });
  expect(result.elements['Event_Largo']).toMatchObject({ started: 0, completed: 0 });
  expect(result.flows['Flow_Espera_Corto']?.count).toBe(3);
  expect(result.flows['Flow_Ciclo_Espera']?.count).toBe(2);

  // A fresh draw per pass, not the first one reused: three different delays from the same stream.
  const delays = rowsOf(result, 'Event_Corto').map((row) => (row.endedAt ?? row.observedUntil) - row.enabledAt);
  expect(delays).toHaveLength(3);
  expect(new Set(delays.slice(0, 2)).size).toBe(2);
  // The third one is still waiting when the run stops: an in-flight case, like any other timer.
  expect(rowsOf(result, 'Event_Corto')[2]).toMatchObject({ status: 'inFlight' });
  expect(result.process).toMatchObject({ started: 1, completed: 0, inFlight: 1 });
});

test('(g) with several replications the race aggregates like everything else', async () => {
  const result = simulate(await mensajeYTimer(), {
    run: { seed: 42, replications: 4, duration: 3600 },
    elements: {
      Start_Proceso: { interTriggerTimer: seconds(600) },
      Task_Pedir: { processingTime: seconds(60) },
      // Both branches are constant, so every case of every replication ends the same way: the
      // means are exact and the confidence interval collapses on them.
      Event_Respuesta: { processingTime: seconds(90) },
      Event_Plazo: { processingTime: seconds(240) },
      Task_Registrar: { processingTime: seconds(5) },
      Task_Reclamar: { processingTime: seconds(7) },
    },
  });

  // Six arrivals (t = 0, 600 … 3000) per replication, all of them through the winning branch.
  expect(result.elements['Gateway_Espera']).toMatchObject({ started: 6, completed: 6 });
  expect(result.elements['Event_Respuesta']).toMatchObject({ started: 6, completed: 6 });
  expect(result.elements['Event_Plazo']).toMatchObject({ started: 0, completed: 0 });
  expect(result.process).toMatchObject({ started: 6, completed: 6, inFlight: 0 });
  expect(result.process.cycleTime.mean).toBeCloseTo(155, 10);
  expect(result.replications?.count).toBe(4);
  expect(result.replications?.kpis['process.cycleTime.mean']?.ci95).toEqual([155, 155]);
});

test('an event-based gateway inside an embedded sub-process survives flattening', async () => {
  // R-PLAN-1 keeps the ids of the children, and the branch events keep their single incoming flow
  // inside the box, so R-EVG-1 decides exactly the same before and after flattening. What gets
  // rewired is the branch's exit, like any other flow that reached the sub-process's `end`.
  const ir = await irOf(
    definitions(`    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Caja" sourceRef="Start_Proceso" targetRef="Sub_Caja" />
    <bpmn:subProcess id="Sub_Caja" name="Atender">
      <bpmn:startEvent id="Start_Caja" />
      <bpmn:sequenceFlow id="Flow_Caja_Espera" sourceRef="Start_Caja" targetRef="Gateway_Espera" />
      <bpmn:eventBasedGateway id="Gateway_Espera" name="Espera" />
      <bpmn:sequenceFlow id="Flow_Espera_Respuesta" sourceRef="Gateway_Espera" targetRef="Event_Respuesta" />
      <bpmn:sequenceFlow id="Flow_Espera_Plazo" sourceRef="Gateway_Espera" targetRef="Event_Plazo" />
      <bpmn:intermediateCatchEvent id="Event_Respuesta" name="Llega respuesta">
        <bpmn:messageEventDefinition id="Trigger_Respuesta" />
      </bpmn:intermediateCatchEvent>
      <bpmn:sequenceFlow id="Flow_Respuesta_Caja" sourceRef="Event_Respuesta" targetRef="End_Caja" />
      <bpmn:intermediateCatchEvent id="Event_Plazo" name="Vence el plazo">
        <bpmn:timerEventDefinition id="Trigger_Plazo" />
      </bpmn:intermediateCatchEvent>
      <bpmn:sequenceFlow id="Flow_Plazo_Caja" sourceRef="Event_Plazo" targetRef="End_Caja" />
      <bpmn:endEvent id="End_Caja" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="Flow_Caja_Fin" sourceRef="Sub_Caja" targetRef="End_Proceso" />
    <bpmn:endEvent id="End_Proceso" name="Fin" />`),
  );

  expect(ir.nodes['Gateway_Espera']).toMatchObject({
    type: 'eventGateway',
    subprocessId: 'Sub_Caja',
    outgoing: ['Flow_Espera_Respuesta', 'Flow_Espera_Plazo'],
  });
  expect(ir.nodes['Event_Respuesta']?.type).toBe('timer');
  expect(ir.flows['Flow_Respuesta_Caja']?.to).toBe('End_Proceso');

  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Event_Respuesta: { processingTime: seconds(40) },
      Event_Plazo: { processingTime: seconds(90) },
    },
  });

  expect(result.elements['Gateway_Espera']).toMatchObject({ started: 1, completed: 1 });
  expect(result.elements['Event_Respuesta']).toMatchObject({ started: 1, completed: 1 });
  expect(result.elements['Event_Plazo']).toMatchObject({ started: 0, completed: 0 });
  expect(result.process).toMatchObject({ started: 1, completed: 1, inFlight: 0 });
  expect(result.process.cycleTime.max).toBe(40);
});

// #369: synthetic races above isolate routing from the ignored flow probabilities.
test.each(['timer', 'message'] as const)(
  'R-EVG-3 — %s race ignores opposite probabilities and warns once per declared flow',
  async (trigger) => {
    const ir = await irOf(definitions(carrera(trigger)));
    for (const locale of ['en', 'es'] as const) {
      const scenario = escenario(90, 240);
      scenario.elements!.Start_Proceso = { triggerCount: 3 };
      const baseline = simulate(ir, scenario, { locale });
      expect(baseline.warnings.filter((warning) => warning.startsWith('W-PROB-IGNORADA:'))).toEqual([]);
      const result = simulate(ir, {
        ...scenario,
        elements: {
          ...scenario.elements,
          Flow_Espera_Respuesta: { probability: 0 },
          Flow_Espera_Plazo: { probability: 1 },
        },
      }, { locale });
      const warnings = result.warnings.filter((warning) => warning.startsWith('W-PROB-IGNORADA:'));
      expect(warnings).toEqual(['Flow_Espera_Respuesta', 'Flow_Espera_Plazo'].map((flowId) =>
        locale === 'en'
          ? `W-PROB-IGNORADA: ${flowId}: it leaves an event-based gateway (Gateway_Espera); probability is ignored because the event race determines the route.`
          : `W-PROB-IGNORADA: ${flowId}: sale de un gateway basado en eventos (Gateway_Espera); probability se ignora porque la carrera entre eventos determina la ruta.`,
      ));
      expect(result.flows.Flow_Espera_Respuesta?.count).toBe(3);
      expect(result.flows.Flow_Espera_Plazo?.count).toBe(0);
      const { warnings: ignoredResultWarnings, ...actual } = result;
      const { warnings: ignoredBaselineWarnings, ...expected } = baseline;
      expect(actual).toEqual(expected);
      expect(ignoredResultWarnings.filter((warning) => !warnings.includes(warning)))
        .toEqual(ignoredBaselineWarnings);
    }
  },
);

test.each(['parallelGateway', 'exclusiveGateway', 'inclusiveGateway'] as const)(
  '#369 — %s preserves its probability warning behavior',
  async (gatewayType) => {
    const ir = await irOf(definitions(carrera('timer').replace('bpmn:eventBasedGateway', `bpmn:${gatewayType}`)));
    for (const locale of ['en', 'es'] as const) {
      const scenario = escenario(90, 240);
      const baseline = simulate(ir, scenario, { locale });
      expect(baseline.warnings.filter((warning) => warning.startsWith('W-PROB-IGNORADA:'))).toEqual([]);
      const result = simulate(ir, {
        ...scenario,
        elements: {
          ...scenario.elements,
          Flow_Espera_Respuesta: { probability: 0 },
          Flow_Espera_Plazo: { probability: 1 },
        },
      }, { locale });
      const warnings = result.warnings.filter((warning) => warning.startsWith('W-PROB-IGNORADA:'));
      expect(warnings).toEqual(gatewayType === 'parallelGateway'
        ? ['Flow_Espera_Respuesta', 'Flow_Espera_Plazo'].map((flowId) => locale === 'en'
          ? `W-PROB-IGNORADA: ${flowId}: it leaves a parallel gateway (Gateway_Espera); probability is ignored.`
          : `W-PROB-IGNORADA: ${flowId}: sale de un gateway paralelo (Gateway_Espera); probability se ignora.`)
        : []);
      expect(result.flows.Flow_Espera_Respuesta?.count).toBe(gatewayType === 'parallelGateway' ? 1 : 0);
      expect(result.flows.Flow_Espera_Plazo?.count).toBe(1);
    }
  },
);
