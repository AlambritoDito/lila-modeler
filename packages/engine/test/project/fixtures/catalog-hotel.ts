/**
 * A synthetic hotel front office for the catalog operations of #672 (`docs/EXAMPLES_POLICY.md`:
 * invented names, no coursework). Three processes, `check-in`, `check-out` and `room-service`,
 * each with one task (`Task_1`) and, on request, hand-typed references from before the catalog
 * existed: `roleRef="cajero"` (a value of the id grammar) and `systemRef="POS"` (not one).
 *
 * `hotelDocument(2)` is a version 2 repository; `hotelDocument(1)` keeps only `check-in`, a
 * version 1 project. Built as a `ProjectDocument` and encoded by the codec under test's caller.
 */
import { encodeLila, type ProcessDocument, type ProjectDocument } from '../../../src/project/index.js';

export const HOTEL_PROCESSES = [
  { slug: 'check-in', name: 'Check-in', bpmnId: 'Process_CheckIn', task: 'Register the guest' },
  { slug: 'check-out', name: 'Check-out', bpmnId: 'Process_CheckOut', task: 'Settle the bill' },
  { slug: 'room-service', name: 'Room service', bpmnId: 'Process_RoomService', task: 'Deliver the order' },
] as const;

/** A model with one task; `extensions` goes inside its `bpmn:extensionElements` when given. */
export function hotelModel(bpmnId: string, name: string, task: string, extensions = ''): string {
  const ext = extensions === '' ? '' : `\n      <bpmn:extensionElements>${extensions}</bpmn:extensionElements>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="Defs_${bpmnId}" targetNamespace="https://lila-modeler.org/bpmn">
  <bpmn:process id="${bpmnId}" name="${name}" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="${task}">${ext}
      <bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>
`;
}

const scenario = {
  version: 1,
  name: 'AS-IS',
  model: 'model.bpmn',
  run: { start: '2026-09-07T08:00:00Z', duration: 3600, warmup: 0, replications: 1, seed: 42, baseTimeUnit: 'min' },
  elements: {
    Start_1: { triggerCount: 5, interTriggerTimer: { type: 'constant', value: 60 } },
    Task_1: { processingTime: { type: 'constant', value: 30 } },
  },
};

/** The hand-typed references of the fixture, when `handTyped`. */
export const HAND_TYPED = '<lila:responsibility type="R" roleRef="cajero" /><lila:systemRef ref="POS" />';

/** The hotel as a version `version` document; `handTyped` puts `HAND_TYPED` on every task. */
export function hotelDocument(version: 1 | 2, options: { readonly handTyped?: boolean } = {}): ProjectDocument {
  const processes: ProcessDocument[] = HOTEL_PROCESSES.slice(0, version === 1 ? 1 : 3).map((p) => ({
    slug: p.slug,
    name: p.name,
    model: { id: p.bpmnId, name: 'model.bpmn', xml: hotelModel(p.bpmnId, p.name, p.task, options.handTyped === true ? HAND_TYPED : ''), revision: 1 },
    scenarios: { 'as-is.scenario.json': scenario },
    scenarioRevisions: { 'as-is.scenario.json': 1 },
    runs: [],
  }));
  const [first, ...rest] = processes;
  const base: ProjectDocument = {
    version: 1,
    id: '3b1f6a52-8d0c-4e7a-9f21-5c4d3e2b1a09',
    name: version === 1 ? 'Check-in' : 'Hotel front office',
    model: first!.model,
    scenarios: first!.scenarios,
    scenarioRevisions: first!.scenarioRevisions,
    runs: [],
  };
  return version === 1 ? base : { ...base, process: { slug: first!.slug, name: first!.name }, processes: rest };
}

/** `hotelDocument` encoded as a `.lila`. */
export function hotelLila(version: 1 | 2, options: { readonly handTyped?: boolean } = {}): Uint8Array {
  return encodeLila(hotelDocument(version, options));
}
