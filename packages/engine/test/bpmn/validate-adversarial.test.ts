import { expect, test } from 'vitest';

import { parseBpmn } from '../../src/bpmn/parse.js';
import { validate } from '../../src/bpmn/validate.js';

const OPEN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_QA" targetNamespace="urn:lila:qa">`;

function errorsOf(xml: string): Promise<string[]> {
  return parseBpmn(xml).then((parsed) =>
    validate(parsed.ir, {
      // El texto normativo de § 3 es el español (LILA-211).
      locale: 'es',
      unsupported: parsed.unsupported,
      messageFlowCount: parsed.messageFlowCount,
      conditionFlowIds: parsed.conditionFlowIds,
    }).errors
      .filter((problem) => problem.code === 'E-NOSOP')
      .map((problem) => problem.message),
  );
}

test('eventDefinitionRef conserva timers/terminate soportados y el detalle no soportado', async () => {
  const xml = `${OPEN}
  <bpmn:timerEventDefinition id="Timer_Global" />
  <bpmn:terminateEventDefinition id="Terminate_Global" />
  <bpmn:messageEventDefinition id="Message_Global" />
  <bpmn:process id="Process_Refs" isExecutable="true">
    <bpmn:startEvent id="Start_Timer"><bpmn:eventDefinitionRef>Timer_Global</bpmn:eventDefinitionRef></bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_Timer" targetRef="Catch_Timer" />
    <bpmn:intermediateCatchEvent id="Catch_Timer"><bpmn:eventDefinitionRef>Timer_Global</bpmn:eventDefinitionRef></bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Catch_Timer" targetRef="End_Terminate" />
    <bpmn:endEvent id="End_Terminate"><bpmn:eventDefinitionRef>Terminate_Global</bpmn:eventDefinitionRef></bpmn:endEvent>
    <bpmn:startEvent id="Start_Message"><bpmn:eventDefinitionRef>Message_Global</bpmn:eventDefinitionRef></bpmn:startEvent>
  </bpmn:process>
</bpmn:definitions>`;
  const parsed = await parseBpmn(xml);

  expect(parsed.ir.nodes.Start_Timer?.type).toBe('start');
  expect(parsed.ir.nodes.Catch_Timer?.type).toBe('timer');
  expect(parsed.ir.nodes.End_Terminate?.type).toBe('terminate');
  expect(await errorsOf(xml)).toEqual([
    'Start_Message (bpmn:startEvent): evento de mensaje no soportado por el simulador.',
  ]);
});

test('dos eventDefinitionRef se reportan una vez como disparadores múltiples', async () => {
  const xml = `${OPEN}
  <bpmn:messageEventDefinition id="Message_Global" />
  <bpmn:signalEventDefinition id="Signal_Global" />
  <bpmn:process id="Process_Multiple" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Catch_Multiple" />
    <bpmn:intermediateCatchEvent id="Catch_Multiple">
      <bpmn:eventDefinitionRef>Message_Global</bpmn:eventDefinitionRef>
      <bpmn:eventDefinitionRef>Signal_Global</bpmn:eventDefinitionRef>
    </bpmn:intermediateCatchEvent>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Catch_Multiple" targetRef="End_1" />
    <bpmn:endEvent id="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

  expect(await errorsOf(xml)).toEqual([
    'Catch_Multiple (bpmn:intermediateCatchEvent): evento con disparadores múltiples no soportado por el simulador.',
  ]);
});

test('la precedencia es determinista, conserva nombres con comillas y ordena entre roots', async () => {
  const xml = `${OPEN}
  <bpmn:choreography id="Choreo_First" name="Raíz &quot;uno&quot;">
    <bpmn:choreographyTask id="Choreo_Task" />
  </bpmn:choreography>
  <bpmn:process id="Process_Order" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:task id="Task_Many" startQuantity="2" completionQuantity="3">
      <bpmn:standardLoopCharacteristics id="Loop_1" />
    </bpmn:task>
    <bpmn:boundaryEvent id="Boundary_Many" attachedToRef="Task_Many" parallelMultiple="true">
      <bpmn:messageEventDefinition id="Message_1" />
      <bpmn:signalEventDefinition id="Signal_1" />
    </bpmn:boundaryEvent>
    <bpmn:intermediateThrowEvent id="Throw_Message">
      <bpmn:messageEventDefinition id="Message_2" />
    </bpmn:intermediateThrowEvent>
    <bpmn:endEvent id="End_Timer"><bpmn:timerEventDefinition id="Timer_1" /></bpmn:endEvent>
  </bpmn:process>
  <bpmn:collaboration id="Collab_Last">
    <bpmn:subConversation id="SubConversation_Last">
      <bpmn:conversation id="Conversation_Nested" />
    </bpmn:subConversation>
  </bpmn:collaboration>
</bpmn:definitions>`;

  expect(await errorsOf(xml)).toEqual([
    'Choreo_First (bpmn:choreography, "Raíz "uno""): diagrama de coreografía no soportado por el simulador.',
    'Choreo_Task (bpmn:choreographyTask): diagrama de coreografía no soportado por el simulador.',
    'Task_Many (bpmn:task): marcador de bucle en la actividad no soportado por el simulador.',
    'Boundary_Many (bpmn:boundaryEvent): evento adjunto a actividad (boundary event) no soportado por el simulador.',
    'Throw_Message (bpmn:intermediateThrowEvent): evento intermedio de lanzamiento no soportado por el simulador.',
    'End_Timer (bpmn:endEvent): evento de fin con ese disparador no soportado por el simulador.',
    'SubConversation_Last (bpmn:subConversation): diagrama de conversación no soportado por el simulador.',
    'Conversation_Nested (bpmn:conversation): diagrama de conversación no soportado por el simulador.',
  ]);
});

test('W-MSGFLOW se agrega entre collaborations y W-COND conserva un aviso por flujo en orden', async () => {
  const xml = `${OPEN}
  <bpmn:process id="Process_Warnings" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:sequenceFlow id="Flow_A" sourceRef="Start_1" targetRef="Task_1">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">a</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:task id="Task_1" />
    <bpmn:sequenceFlow id="Flow_B" sourceRef="Task_1" targetRef="End_1">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">b</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:endEvent id="End_1" />
  </bpmn:process>
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="P1" /><bpmn:participant id="P2" />
    <bpmn:messageFlow id="Message_1" sourceRef="P1" targetRef="P2" />
  </bpmn:collaboration>
  <bpmn:collaboration id="Collab_2">
    <bpmn:participant id="P3" /><bpmn:participant id="P4" />
    <bpmn:messageFlow id="Message_2" sourceRef="P3" targetRef="P4" />
    <bpmn:messageFlow id="Message_3" sourceRef="P4" targetRef="P3" />
  </bpmn:collaboration>
</bpmn:definitions>`;
  const parsed = await parseBpmn(xml);

  expect(parsed.messageFlowCount).toBe(3);
  expect(parsed.conditionFlowIds).toEqual(['Flow_A', 'Flow_B']);
  expect(
    validate(parsed.ir, {
      // El texto normativo de § 3 es el español (LILA-211).
      locale: 'es',
      unsupported: parsed.unsupported,
      messageFlowCount: parsed.messageFlowCount,
      conditionFlowIds: parsed.conditionFlowIds,
    }).warnings,
  ).toEqual([
    {
      code: 'W-MSGFLOW',
      id: 'Process_Warnings',
      message: 'Process_Warnings: se ignoraron 3 flujos de mensaje (bpmn:messageFlow).',
    },
    {
      code: 'W-COND',
      id: 'Flow_A',
      message: 'Flow_A: conditionExpression se ignora; el ramaje es probabilístico.',
    },
    {
      code: 'W-COND',
      id: 'Flow_B',
      message: 'Flow_B: conditionExpression se ignora; el ramaje es probabilístico.',
    },
  ]);
});
