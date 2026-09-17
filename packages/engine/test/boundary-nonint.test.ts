/**
 * #81, second slice — **non-interrupting** boundary timer on a task (R-BND-10…14 of
 * `docs/SEMANTICS.md` § 9).
 *
 * The models are inline, like the rest of the boundary tests. What is under test is the semantics
 * of the extra token, not the sampling, so almost everything runs on constant distributions, one
 * replication and `seed: 42`. The only test with real distributions is the determinism one
 * (R-BND-3, § 16).
 */
import { expect, test } from 'vitest';

import { parseBpmn } from '../src/bpmn/parse.js';
import { validate } from '../src/bpmn/validate.js';
import type { ProcessIR } from '../src/core/ir.js';
import { simulate, type SimulationProgress } from '../src/core/run.js';
import type { EventLogRow, RunResult } from '../src/core/result.js';

const seconds = (value: number) => ({ type: 'constant' as const, value });

type Scenario = Parameters<typeof simulate>[1];

function definitions(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_Nonint" isExecutable="true">
${body}
  </bpmn:process>
</bpmn:definitions>`;
}

async function irOf(xml: string): Promise<ProcessIR> {
  const { ir, unsupported } = await parseBpmn(xml);
  expect(validate(ir, { unsupported }).errors).toEqual([]);
  return ir;
}

/**
 * `Task_Revisar` with a **non-interrupting** boundary that leaves to `Task_Avisar`: two branches,
 * two ends. `cancelActivity="false"` is the only non-interrupting form (R-BND-10).
 */
const AVISO_BODY = `    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Revisar" sourceRef="Start_Proceso" targetRef="Task_Revisar" />
    <bpmn:userTask id="Task_Revisar" name="Revisar" />
    <bpmn:sequenceFlow id="Flow_Revisar_Fin" sourceRef="Task_Revisar" targetRef="End_Proceso" />
    <bpmn:boundaryEvent id="Boundary_Aviso" name="Vence el plazo" attachedToRef="Task_Revisar" cancelActivity="false">
      <bpmn:timerEventDefinition id="Timer_Plazo" />
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_Aviso" sourceRef="Boundary_Aviso" targetRef="Task_Avisar" />
    <bpmn:task id="Task_Avisar" name="Avisar" />
    <bpmn:sequenceFlow id="Flow_Avisar_Fin" sourceRef="Task_Avisar" targetRef="End_Avisado" />
    <bpmn:endEvent id="End_Avisado" name="Avisado" />
    <bpmn:endEvent id="End_Proceso" name="Fin" />`;

const aviso = async (): Promise<ProcessIR> => irOf(definitions(AVISO_BODY));

/** The instant the replication stopped: `run.stoppedAt` is only visible through `onProgress`. */
function runWithStop(ir: ProcessIR, scenario: Scenario): { result: RunResult; stoppedAt: number } {
  let stoppedAt = 0;
  const onProgress = (progress: SimulationProgress): void => {
    stoppedAt = progress.simulatedTime;
  };
  return { result: simulate(ir, scenario, { onProgress }), stoppedAt };
}

const rowsOf = (result: RunResult, elementId: string): EventLogRow[] =>
  (result.log ?? []).filter((row) => row.elementId === elementId);

test('a non-interrupting boundary enters the profile as a `timer` with `attachedTo` and no `incoming`', async () => {
  const ir = await aviso();

  // R-BND-10: the same node as the interrupting one, plus the mark that says it does not cancel.
  expect(ir.nodes['Boundary_Aviso']).toMatchObject({
    type: 'timer',
    attachedTo: 'Task_Revisar',
    interrupting: false,
    incoming: [],
    outgoing: ['Flow_Aviso'],
  });
  // The interrupting one does not carry the mark: absent means interrupting, as `cancelActivity`
  // does in BPMN.
  const interrupting = await irOf(definitions(AVISO_BODY.replace(' cancelActivity="false"', '')));
  expect(interrupting.nodes['Boundary_Aviso']?.interrupting).toBeUndefined();
});

test('(a) the host finishes after the deadline: the boundary fires once and the host completes anyway', async () => {
  const ir = await aviso();
  const { result, stoppedAt } = runWithStop(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Task_Revisar: { processingTime: seconds(200) },
      Boundary_Aviso: { processingTime: seconds(100) },
      Task_Avisar: { processingTime: seconds(5) },
    },
  });

  // R-BND-11: the host never notices. It completes on time and its row is an ordinary row.
  expect(rowsOf(result, 'Task_Revisar')[0]).toMatchObject({
    status: 'completed',
    startedAt: 0,
    endedAt: 200,
  });
  expect(result.elements['Task_Revisar']).toMatchObject({ started: 1, completed: 1 });
  // R-BND-6: one whole firing, and not a single event-log row of its own.
  expect(result.elements['Boundary_Aviso']).toMatchObject({ started: 1, completed: 1 });
  expect(rowsOf(result, 'Boundary_Aviso')).toEqual([]);
  // R-BND-11: the new token walks its branch, the host's token walks its own.
  expect(result.elements['Task_Avisar']).toMatchObject({ started: 1, completed: 1 });
  expect(result.flows['Flow_Aviso']?.count).toBe(1);
  expect(result.flows['Flow_Avisar_Fin']?.count).toBe(1);
  expect(result.flows['Flow_Revisar_Fin']?.count).toBe(1);
  // R-BND-14: the case is counted **once** and it is closed by the end that consumed the last
  // token (R-EVT-4), here the host's at t = 200.
  expect(result.process).toMatchObject({ started: 1, completed: 1, inFlight: 0 });
  expect(result.process.byEndEvent['End_Proceso']?.completed).toBe(1);
  expect(result.process.byEndEvent['End_Avisado']?.completed).toBe(0);
  expect(result.process.cycleTime.max).toBe(200);
  expect(stoppedAt).toBe(200);
});

test('(a bis) it fires only once even if the host stays open far longer (no cycle)', async () => {
  const ir = await aviso();
  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Task_Revisar: { processingTime: seconds(1000) },
      Boundary_Aviso: { processingTime: seconds(100) },
      Task_Avisar: { processingTime: seconds(5) },
    },
  });

  // Ten deadlines fit inside the task; one deadline is scheduled per occurrence, so it fires once.
  expect(result.elements['Boundary_Aviso']).toMatchObject({ started: 1, completed: 1 });
  expect(result.flows['Flow_Aviso']?.count).toBe(1);
  expect(result.process).toMatchObject({ completed: 1, inFlight: 0 });
});

test('(b) the host finishes before the deadline: no firing, and no extra `started`/`completed`', async () => {
  const ir = await aviso();
  const { result, stoppedAt } = runWithStop(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Task_Revisar: { processingTime: seconds(50) },
      Boundary_Aviso: { processingTime: seconds(100) },
      Task_Avisar: { processingTime: seconds(5) },
    },
  });

  expect(result.elements['Boundary_Aviso']).toMatchObject({ started: 0, completed: 0 });
  expect(result.elements['Task_Avisar']).toMatchObject({ started: 0, completed: 0 });
  expect(result.flows['Flow_Aviso']?.count).toBe(0);
  expect(rowsOf(result, 'Task_Avisar')).toEqual([]);
  expect(result.elements['Task_Revisar']).toMatchObject({ started: 1, completed: 1 });
  expect(result.process.byEndEvent['End_Proceso']?.completed).toBe(1);
  expect(result.process.byEndEvent['End_Avisado']?.completed).toBe(0);
  // R-BND-9: the dead firing is discarded without advancing the clock up to 100.
  expect(stoppedAt).toBe(50);
});

test('R-BND-13 — tie at the host’s exact end instant: the boundary fires', async () => {
  const ir = await aviso();
  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Task_Revisar: { processingTime: seconds(100) },
      Boundary_Aviso: { processingTime: seconds(100) },
      Task_Avisar: { processingTime: seconds(5) },
    },
  });

  // The firing was queued before the host's `done`, so it leaves the heap first and still finds
  // the host activity open: the same tie-break as R-BND-7, on the same insertion order.
  expect(result.elements['Boundary_Aviso']).toMatchObject({ started: 1, completed: 1 });
  // And the host completes anyway, in that very instant.
  expect(rowsOf(result, 'Task_Revisar')[0]).toMatchObject({ status: 'completed', endedAt: 100 });
  expect(result.elements['Task_Revisar']).toMatchObject({ started: 1, completed: 1 });
  expect(result.process).toMatchObject({ completed: 1, inFlight: 0 });
});

test('R-BND-11 — the firing does not release the host’s resource: the queue waits for its end', async () => {
  const ir = await aviso();
  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    resources: { revisor: { capacity: 1, costPerHour: 36 } },
    elements: {
      Start_Proceso: { interTriggerTimer: seconds(10), triggerCount: 2 },
      Task_Revisar: { processingTime: seconds(200), resources: [{ ref: 'revisor' }] },
      Boundary_Aviso: { processingTime: seconds(100) },
      Task_Avisar: { processingTime: seconds(5) },
    },
  });

  const [first, second] = rowsOf(result, 'Task_Revisar');
  // Unlike R-BND-5, nothing is cancelled here: the host keeps the unit until t = 200 and is
  // charged for all 200 seconds of occupancy (36/h × 200 s = 2).
  expect(first).toMatchObject({ caseId: '1', status: 'completed', startedAt: 0, endedAt: 200 });
  expect(first?.resourceCost).toBeCloseTo(2, 10);
  // The second case had been waiting since t = 10 and does **not** start at the firing (t = 100)
  // but when the unit is released at t = 200.
  expect(second).toMatchObject({ caseId: '2', enabledAt: 10, startedAt: 200 });
  expect(result.elements['Boundary_Aviso']?.started).toBe(2);
});

test('(c) determinism: the boundary has its own random stream and moves no other draw', async () => {
  const withBoundary = await aviso();
  // The same model without the boundary or its branch: the "before" to compare the draws against.
  const withoutBoundary = await irOf(
    definitions(`    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Revisar" sourceRef="Start_Proceso" targetRef="Task_Revisar" />
    <bpmn:userTask id="Task_Revisar" name="Revisar" />
    <bpmn:sequenceFlow id="Flow_Revisar_Fin" sourceRef="Task_Revisar" targetRef="End_Proceso" />
    <bpmn:endEvent id="End_Proceso" name="Fin" />`),
  );

  const scenario = {
    run: { seed: 7, replications: 1, duration: 3600 },
    elements: {
      Start_Proceso: { interTriggerTimer: { type: 'exponential' as const, mean: 120 } },
      Task_Revisar: { processingTime: { type: 'exponential' as const, mean: 300 } },
      Boundary_Aviso: { processingTime: { type: 'uniform' as const, min: 30, max: 90 } },
      Task_Avisar: { processingTime: { type: 'normal' as const, mean: 20, sd: 5 } },
    },
  };

  // R-DET-6: same seed, same input, identical output.
  expect(simulate(withBoundary, scenario)).toEqual(simulate(withBoundary, scenario));

  // R-BND-3 / § 16: adding the boundary shifts not one draw of the other elements, even though
  // the boundary really does fire (a 30..90 deadline elapses inside almost every task).
  const { Boundary_Aviso: _boundary, Task_Avisar: _notify, ...elementsWithout } = scenario.elements;
  const before = simulate(withoutBoundary, { ...scenario, elements: elementsWithout });
  const after = simulate(withBoundary, scenario);

  expect(after.elements['Boundary_Aviso']?.started).toBeGreaterThan(0);
  const instants = (result: RunResult) =>
    rowsOf(result, 'Task_Revisar').map((row) => [row.caseId, row.enabledAt, row.startedAt, row.endedAt]);
  expect(instants(after)).toEqual(instants(before));
  expect(after.elements['Task_Revisar']).toEqual(before.elements['Task_Revisar']);
  expect(after.flows['Flow_Start_Revisar']).toEqual(before.flows['Flow_Start_Revisar']);
});

test('(d) `cancelActivity="false"` with a message trigger stays `E-NOSOP`', async () => {
  const xml = definitions(`    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Revisar" sourceRef="Start_Proceso" targetRef="Task_Revisar" />
    <bpmn:userTask id="Task_Revisar" name="Revisar" />
    <bpmn:sequenceFlow id="Flow_Revisar_Fin" sourceRef="Task_Revisar" targetRef="End_Proceso" />
    <bpmn:boundaryEvent id="Boundary_Mensaje" name="Llega respuesta" attachedToRef="Task_Revisar" cancelActivity="false">
      <bpmn:messageEventDefinition id="Message_Respuesta" />
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_Mensaje" sourceRef="Boundary_Mensaje" targetRef="End_Avisado" />
    <bpmn:endEvent id="End_Avisado" name="Avisado" />
    <bpmn:endEvent id="End_Proceso" name="Fin" />`);

  const { ir, unsupported } = await parseBpmn(xml);
  const { errors } = validate(ir, { unsupported });

  // § 3: what enters the profile is the boundary **timer**; message, error and signal stay out,
  // with the same `boundaryEvent` construction and the same text.
  expect(errors.filter((problem) => problem.code === 'E-NOSOP')).toEqual([
    {
      code: 'E-NOSOP',
      id: 'Boundary_Mensaje',
      message:
        'Boundary_Mensaje (bpmn:boundaryEvent, "Llega respuesta"): event attached to an activity (boundary event) not supported by the simulator.',
    },
  ]);
  expect(ir.nodes['Boundary_Mensaje']).toBeUndefined();
  // Its branch is left without an entry, like any other discard (R-NOSOP-5).
  expect(errors.filter((problem) => problem.code === 'E-INALCANZABLE').map((problem) => problem.id)).toEqual([
    'End_Avisado',
  ]);
});

test('(e) a non-interrupting boundary with no `processingTime` warns once and never fires', async () => {
  const ir = await aviso();
  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { interTriggerTimer: seconds(500), triggerCount: 2 },
      Task_Revisar: { processingTime: seconds(50) },
      Task_Avisar: { processingTime: seconds(5) },
    },
  });

  // R-BND-8: the same `W-BORDE-SIN-TIEMPO` as the first slice, with no new code, aggregated into
  // a single warning even though both occurrences of the host pass by the boundary.
  const warnings = result.warnings.filter((warning) => warning.startsWith('W-BORDE-SIN-TIEMPO'));
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('Boundary_Aviso');
  expect(warnings[0]).toContain('Task_Revisar');
  expect(result.elements['Boundary_Aviso']).toMatchObject({ started: 0, completed: 0 });
  expect(result.elements['Task_Revisar']?.completed).toBe(2);
  expect(result.process.completed).toBe(2);
});

test('R-BND-14 — the new token can rejoin through an AND join and the case is counted once', async () => {
  const ir = await irOf(
    definitions(`    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Revisar" sourceRef="Start_Proceso" targetRef="Task_Revisar" />
    <bpmn:userTask id="Task_Revisar" name="Revisar" />
    <bpmn:sequenceFlow id="Flow_Revisar_Join" sourceRef="Task_Revisar" targetRef="Gateway_Join" />
    <bpmn:boundaryEvent id="Boundary_Aviso" attachedToRef="Task_Revisar" cancelActivity="false">
      <bpmn:timerEventDefinition id="Timer_Plazo" />
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_Aviso_Join" sourceRef="Boundary_Aviso" targetRef="Gateway_Join" />
    <bpmn:parallelGateway id="Gateway_Join" />
    <bpmn:sequenceFlow id="Flow_Join_Fin" sourceRef="Gateway_Join" targetRef="End_Proceso" />
    <bpmn:endEvent id="End_Proceso" name="Fin" />`),
  );

  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Task_Revisar: { processingTime: seconds(200) },
      Boundary_Aviso: { processingTime: seconds(100) },
    },
  });

  // R-AND-2: the join gets both tokens (the boundary's at t = 100, the host's at t = 200), fires
  // on the second and brings the case back to a single token.
  expect(result.elements['Gateway_Join']).toMatchObject({ started: 2, completed: 1 });
  expect(result.process).toMatchObject({ completed: 1, inFlight: 0 });
  expect(result.process.byEndEvent['End_Proceso']?.completed).toBe(1);
  expect(result.process.cycleTime.max).toBe(200);
  expect(result.warnings.filter((warning) => warning.startsWith('W-JOIN-BLOQUEADO'))).toEqual([]);
});

test('R-BND-12 — the new token inherits no OR marks, so the host’s join still closes', async () => {
  const ir = await irOf(
    definitions(`    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Fork" sourceRef="Start_Proceso" targetRef="Gateway_Fork" />
    <bpmn:inclusiveGateway id="Gateway_Fork" />
    <bpmn:sequenceFlow id="Flow_Fork_Revisar" sourceRef="Gateway_Fork" targetRef="Task_Revisar" />
    <bpmn:sequenceFlow id="Flow_Fork_Archivar" sourceRef="Gateway_Fork" targetRef="Task_Archivar" />
    <bpmn:userTask id="Task_Revisar" name="Revisar" />
    <bpmn:sequenceFlow id="Flow_Revisar_Join" sourceRef="Task_Revisar" targetRef="Gateway_Join" />
    <bpmn:task id="Task_Archivar" name="Archivar" />
    <bpmn:sequenceFlow id="Flow_Archivar_Join" sourceRef="Task_Archivar" targetRef="Gateway_Join" />
    <bpmn:boundaryEvent id="Boundary_Aviso" attachedToRef="Task_Revisar" cancelActivity="false">
      <bpmn:timerEventDefinition id="Timer_Plazo" />
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_Aviso_Join" sourceRef="Boundary_Aviso" targetRef="Gateway_Join" />
    <bpmn:inclusiveGateway id="Gateway_Join" />
    <bpmn:sequenceFlow id="Flow_Join_Fin" sourceRef="Gateway_Join" targetRef="End_Proceso" />
    <bpmn:endEvent id="End_Proceso" name="Fin" />`),
  );

  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Flow_Fork_Revisar: { probability: 1 },
      Flow_Fork_Archivar: { probability: 1 },
      Task_Revisar: { processingTime: seconds(200) },
      Task_Archivar: { processingTime: seconds(20) },
      Boundary_Aviso: { processingTime: seconds(100) },
    },
  });

  // The fork activated two outgoing flows: its join expects exactly 2 tokens with that mark
  // (R-OR-5). The boundary's token arrives with no mark and the join passes it through as a merge
  // (R-OR-6, `W-OR-JOIN-SIN-FORK`). Had it inherited the mark, the join would see 3 tokens for one
  // activation, fire on the first two, and the third would open a counter nobody closes:
  // `W-JOIN-BLOQUEADO` and a case left in flight.
  expect(result.warnings.filter((warning) => warning.startsWith('W-JOIN-BLOQUEADO'))).toEqual([]);
  expect(result.warnings.filter((warning) => warning.startsWith('W-OR-JOIN-SIN-FORK'))).toHaveLength(1);
  expect(result.elements['Gateway_Join']).toMatchObject({ started: 3, completed: 2 });
  expect(result.process).toMatchObject({ completed: 1, inFlight: 0 });
  expect(result.process.byEndEvent['End_Proceso']?.completed).toBe(1);
});

test('a non-interrupting boundary survives the flattening of the sub-process holding it', async () => {
  // R-PLAN-1 does not touch the task ids, so `attachedTo` still points at the host and the
  // boundary's outgoing flow is rewired to the sub-process exit like any other.
  const ir = await irOf(
    definitions(`    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Sub" sourceRef="Start_Proceso" targetRef="Sub_Revision" />
    <bpmn:subProcess id="Sub_Revision">
      <bpmn:startEvent id="Sub_Start" />
      <bpmn:sequenceFlow id="Flow_Sub_Revisar" sourceRef="Sub_Start" targetRef="Task_Revisar" />
      <bpmn:task id="Task_Revisar" name="Revisar" />
      <bpmn:sequenceFlow id="Flow_Revisar_Sub_Fin" sourceRef="Task_Revisar" targetRef="Sub_End" />
      <bpmn:boundaryEvent id="Boundary_Aviso" attachedToRef="Task_Revisar" cancelActivity="false">
        <bpmn:timerEventDefinition id="Timer_Plazo" />
      </bpmn:boundaryEvent>
      <bpmn:sequenceFlow id="Flow_Aviso_Sub_Fin" sourceRef="Boundary_Aviso" targetRef="Sub_End" />
      <bpmn:endEvent id="Sub_End" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="Flow_Sub_Fin" sourceRef="Sub_Revision" targetRef="End_Proceso" />
    <bpmn:endEvent id="End_Proceso" name="Fin" />`),
  );

  expect(ir.nodes['Boundary_Aviso']).toMatchObject({
    type: 'timer',
    attachedTo: 'Task_Revisar',
    interrupting: false,
    incoming: [],
  });

  const result = simulate(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Task_Revisar: { processingTime: seconds(200) },
      Boundary_Aviso: { processingTime: seconds(100) },
    },
  });

  // Both tokens leave through the same flattened end; the case is closed by the second (R-EVT-4).
  expect(result.elements['Task_Revisar']).toMatchObject({ started: 1, completed: 1 });
  expect(result.elements['Boundary_Aviso']).toMatchObject({ started: 1, completed: 1 });
  expect(result.process).toMatchObject({ completed: 1, inFlight: 0 });
  expect(result.process.byEndEvent['End_Proceso']?.completed).toBe(1);
});

test('a `terminate` kills the non-interrupting boundary along with the rest of the case', async () => {
  const ir = await irOf(
    definitions(`    <bpmn:startEvent id="Start_Proceso" />
    <bpmn:sequenceFlow id="Flow_Start_Fork" sourceRef="Start_Proceso" targetRef="Gateway_Fork" />
    <bpmn:parallelGateway id="Gateway_Fork" />
    <bpmn:sequenceFlow id="Flow_Fork_Revisar" sourceRef="Gateway_Fork" targetRef="Task_Revisar" />
    <bpmn:sequenceFlow id="Flow_Fork_Espera" sourceRef="Gateway_Fork" targetRef="Timer_Espera" />
    <bpmn:userTask id="Task_Revisar" name="Revisar" />
    <bpmn:sequenceFlow id="Flow_Revisar_Fin" sourceRef="Task_Revisar" targetRef="End_Proceso" />
    <bpmn:boundaryEvent id="Boundary_Aviso" attachedToRef="Task_Revisar" cancelActivity="false">
      <bpmn:timerEventDefinition id="Timer_Plazo" />
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_Aviso" sourceRef="Boundary_Aviso" targetRef="Task_Avisar" />
    <bpmn:task id="Task_Avisar" name="Avisar" />
    <bpmn:sequenceFlow id="Flow_Avisar_Fin" sourceRef="Task_Avisar" targetRef="End_Avisado" />
    <bpmn:intermediateCatchEvent id="Timer_Espera">
      <bpmn:timerEventDefinition id="Timer_Espera_Def" />
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_Espera_Terminate" sourceRef="Timer_Espera" targetRef="End_Terminate" />
    <bpmn:endEvent id="End_Terminate">
      <bpmn:terminateEventDefinition id="Terminate_Def" />
    </bpmn:endEvent>
    <bpmn:endEvent id="End_Avisado" name="Avisado" />
    <bpmn:endEvent id="End_Proceso" name="Fin" />`),
  );

  const { result, stoppedAt } = runWithStop(ir, {
    run: { seed: 42, replications: 1 },
    elements: {
      Start_Proceso: { triggerCount: 1 },
      Task_Revisar: { processingTime: seconds(200) },
      Boundary_Aviso: { processingTime: seconds(100) },
      Task_Avisar: { processingTime: seconds(5) },
      Timer_Espera: { processingTime: seconds(10) },
    },
  });

  // R-EVT-5 closes the host at t = 10, so the t = 100 firing no longer finds an open activity
  // (R-BND-4) and is discarded without moving the clock (R-BND-9).
  expect(rowsOf(result, 'Task_Revisar')[0]).toMatchObject({ status: 'terminated', observedUntil: 10 });
  expect(result.elements['Boundary_Aviso']).toMatchObject({ started: 0, completed: 0 });
  expect(result.process.byEndEvent['End_Terminate']?.completed).toBe(1);
  expect(stoppedAt).toBe(10);
});

/**
 * `cancelActivity` is `xsd:boolean`, whose lexical space is `{true, false, 1, 0}`, and
 * bpmn-moddle collapses the whole of it with `s === 'true'`. The parser therefore reads the raw
 * attribute out of the XML text (R-BND-10), so `"1"` keeps the interrupting semantics BPMN gives
 * it instead of silently selecting the non-interrupting profile, and anything outside that
 * lexical space stays out of the profile with the same `E-NOSOP` as before #81.
 */
const withCancelActivity = (literal: string): string =>
  definitions(AVISO_BODY.replace('cancelActivity="false"', `cancelActivity="${literal}"`));

/** The run of test (a): the deadline expires while the host is still open. */
const PLAZO: Scenario = {
  run: { seed: 42, replications: 1 },
  elements: {
    Start_Proceso: { triggerCount: 1 },
    Task_Revisar: { processingTime: seconds(200) },
    Boundary_Aviso: { processingTime: seconds(100) },
    Task_Avisar: { processingTime: seconds(5) },
  },
};

const runLiteral = async (literal: string): Promise<RunResult> =>
  simulate(await irOf(withCancelActivity(literal)), PLAZO);

test('(f) `cancelActivity="1"` is the interrupting form, exactly like `"true"`', async () => {
  const ir = await irOf(withCancelActivity('1'));
  expect(ir.nodes['Boundary_Aviso']?.interrupting).toBeUndefined();

  // The host is cut short at the deadline and only the boundary's branch reaches an end.
  const result = await runLiteral('1');
  expect(rowsOf(result, 'Task_Revisar')[0]).toMatchObject({
    status: 'interrupted',
    observedUntil: 100,
  });
  expect(result.elements['Task_Revisar']).toMatchObject({ started: 1, completed: 0 });
  expect(result.process.byEndEvent['End_Avisado']?.completed).toBe(1);
  // Byte for byte the run of the canonical literal.
  expect(result).toEqual(await runLiteral('true'));
});

test('(f bis) `cancelActivity="0"` is the non-interrupting form, exactly like `"false"`', async () => {
  const ir = await irOf(withCancelActivity('0'));
  expect(ir.nodes['Boundary_Aviso']?.interrupting).toBe(false);

  const result = await runLiteral('0');
  expect(rowsOf(result, 'Task_Revisar')[0]).toMatchObject({ status: 'completed', endedAt: 200 });
  expect(result).toEqual(await runLiteral('false'));
});

test.each(['TRUE', '', 'no'])(
  '(f ter) `cancelActivity="%s"` is outside `xsd:boolean` and stays `E-NOSOP`',
  async (literal) => {
    const { ir, unsupported } = await parseBpmn(withCancelActivity(literal));
    const { errors } = validate(ir, { unsupported });

    // The same code, construction and text as on the base branch, where every literal other than
    // `false` was rejected here.
    expect(errors.filter((problem) => problem.code === 'E-NOSOP')).toEqual([
      {
        code: 'E-NOSOP',
        id: 'Boundary_Aviso',
        message:
          'Boundary_Aviso (bpmn:boundaryEvent, "Vence el plazo"): event attached to an activity (boundary event) not supported by the simulator.',
      },
    ]);
    expect(ir.nodes['Boundary_Aviso']).toBeUndefined();
  },
);
