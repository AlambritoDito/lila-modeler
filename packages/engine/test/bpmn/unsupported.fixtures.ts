/**
 * Un fixture por cada fila del catálogo cerrado de `docs/SEMANTICS.md` § 3 (R-NOSOP-2).
 * Las filas que agrupan varios qnames los incluyen juntos en el mismo fixture.
 */

interface UnsupportedFixture {
  row: string;
  xml: string;
  messages: string[];
}

const OPEN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="Definitions_1" targetNamespace="urn:lila:test">`;

function processWith(elementId: string, element: string): string {
  return `${OPEN}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:sequenceFlow id="Flow_In" sourceRef="Start_1" targetRef="${elementId}" />
    ${element}
    <bpmn:sequenceFlow id="Flow_Out" sourceRef="${elementId}" targetRef="End_1" />
    <bpmn:endEvent id="End_1" />
  </bpmn:process>
</bpmn:definitions>`;
}

function message(id: string, qname: string, construction: string): string {
  return `${id} (${qname}): ${construction} no soportado por el simulador.`;
}

export const UNSUPPORTED_FIXTURES: UnsupportedFixture[] = [
  {
    row: 'bpmn:boundaryEvent (cualquier disparador)',
    xml: processWith(
      'Boundary_1',
      `<bpmn:task id="Task_1" />
    <bpmn:boundaryEvent id="Boundary_1" name="Vence el plazo" attachedToRef="Task_1">
      <bpmn:timerEventDefinition id="TimerDef_1" />
    </bpmn:boundaryEvent>`,
    ),
    messages: [
      'Boundary_1 (bpmn:boundaryEvent, "Vence el plazo"): evento adjunto a actividad (boundary event) no soportado por el simulador.',
    ],
  },
  {
    row: 'messageEventDefinition en cualquier evento',
    xml: processWith(
      'Event_Message',
      `<bpmn:intermediateCatchEvent id="Event_Message"><bpmn:messageEventDefinition id="Def_Message" /></bpmn:intermediateCatchEvent>`,
    ),
    messages: [message('Event_Message', 'bpmn:intermediateCatchEvent', 'evento de mensaje')],
  },
  {
    row: 'signalEventDefinition',
    xml: processWith(
      'Event_Signal',
      `<bpmn:intermediateCatchEvent id="Event_Signal"><bpmn:signalEventDefinition id="Def_Signal" /></bpmn:intermediateCatchEvent>`,
    ),
    messages: [message('Event_Signal', 'bpmn:intermediateCatchEvent', 'evento de señal')],
  },
  {
    row: 'linkEventDefinition',
    xml: processWith(
      'Event_Link',
      `<bpmn:intermediateCatchEvent id="Event_Link"><bpmn:linkEventDefinition id="Def_Link" name="salto" /></bpmn:intermediateCatchEvent>`,
    ),
    messages: [message('Event_Link', 'bpmn:intermediateCatchEvent', 'evento de enlace')],
  },
  {
    row: 'errorEventDefinition',
    xml: processWith(
      'Event_Error',
      `<bpmn:intermediateCatchEvent id="Event_Error"><bpmn:errorEventDefinition id="Def_Error" /></bpmn:intermediateCatchEvent>`,
    ),
    messages: [message('Event_Error', 'bpmn:intermediateCatchEvent', 'evento de error')],
  },
  {
    row: 'escalationEventDefinition',
    xml: processWith(
      'Event_Escalation',
      `<bpmn:intermediateCatchEvent id="Event_Escalation"><bpmn:escalationEventDefinition id="Def_Escalation" /></bpmn:intermediateCatchEvent>`,
    ),
    messages: [
      message('Event_Escalation', 'bpmn:intermediateCatchEvent', 'evento de escalamiento'),
    ],
  },
  {
    row: 'compensateEventDefinition',
    xml: processWith(
      'Event_Compensate',
      `<bpmn:intermediateCatchEvent id="Event_Compensate"><bpmn:compensateEventDefinition id="Def_Compensate" /></bpmn:intermediateCatchEvent>`,
    ),
    messages: [
      message('Event_Compensate', 'bpmn:intermediateCatchEvent', 'evento de compensación'),
    ],
  },
  {
    row: 'conditionalEventDefinition',
    xml: processWith(
      'Event_Conditional',
      `<bpmn:intermediateCatchEvent id="Event_Conditional"><bpmn:conditionalEventDefinition id="Def_Conditional" /></bpmn:intermediateCatchEvent>`,
    ),
    messages: [message('Event_Conditional', 'bpmn:intermediateCatchEvent', 'evento condicional')],
  },
  {
    row: 'cancelEventDefinition',
    xml: processWith(
      'Event_Cancel',
      `<bpmn:intermediateCatchEvent id="Event_Cancel"><bpmn:cancelEventDefinition id="Def_Cancel" /></bpmn:intermediateCatchEvent>`,
    ),
    messages: [message('Event_Cancel', 'bpmn:intermediateCatchEvent', 'evento de cancelación')],
  },
  {
    row: 'multipleEventDefinition / parallelMultipleEventDefinition',
    xml: processWith(
      'Event_Multiple',
      `<bpmn:intermediateCatchEvent id="Event_Multiple" parallelMultiple="true">
      <bpmn:messageEventDefinition id="Def_Multiple_Message" />
      <bpmn:signalEventDefinition id="Def_Multiple_Signal" />
    </bpmn:intermediateCatchEvent>`,
    ),
    messages: [
      message('Event_Multiple', 'bpmn:intermediateCatchEvent', 'evento con disparadores múltiples'),
    ],
  },
  {
    row: 'bpmn:intermediateThrowEvent (sin disparador o con cualquiera)',
    xml: processWith('Event_Throw', `<bpmn:intermediateThrowEvent id="Event_Throw" />`),
    messages: [
      message('Event_Throw', 'bpmn:intermediateThrowEvent', 'evento intermedio de lanzamiento'),
    ],
  },
  {
    row: 'bpmn:eventBasedGateway',
    xml: processWith('Gateway_Event', `<bpmn:eventBasedGateway id="Gateway_Event" />`),
    messages: [message('Gateway_Event', 'bpmn:eventBasedGateway', 'gateway basado en eventos')],
  },
  {
    row: 'bpmn:complexGateway',
    xml: processWith('Gateway_Complex', `<bpmn:complexGateway id="Gateway_Complex" />`),
    messages: [message('Gateway_Complex', 'bpmn:complexGateway', 'gateway complejo')],
  },
  {
    row: 'multiInstanceLoopCharacteristics',
    xml: processWith(
      'Task_Multi',
      `<bpmn:task id="Task_Multi"><bpmn:multiInstanceLoopCharacteristics id="Loop_Multi" /></bpmn:task>`,
    ),
    messages: [message('Task_Multi', 'bpmn:task', 'marcador de multi-instancia')],
  },
  {
    row: 'standardLoopCharacteristics',
    xml: processWith(
      'Task_Loop',
      `<bpmn:task id="Task_Loop"><bpmn:standardLoopCharacteristics id="Loop_Standard" /></bpmn:task>`,
    ),
    messages: [message('Task_Loop', 'bpmn:task', 'marcador de bucle en la actividad')],
  },
  {
    row: 'bpmn:transaction',
    xml: processWith('Transaction_1', `<bpmn:transaction id="Transaction_1" />`),
    messages: [message('Transaction_1', 'bpmn:transaction', 'subproceso transaccional')],
  },
  {
    row: 'bpmn:adHocSubProcess',
    xml: processWith('AdHoc_1', `<bpmn:adHocSubProcess id="AdHoc_1" />`),
    messages: [message('AdHoc_1', 'bpmn:adHocSubProcess', 'subproceso ad-hoc')],
  },
  {
    row: 'bpmn:subProcess con triggeredByEvent=true',
    xml: processWith('Event_Sub', `<bpmn:subProcess id="Event_Sub" triggeredByEvent="true" />`),
    messages: [message('Event_Sub', 'bpmn:subProcess', 'subproceso de eventos')],
  },
  {
    row: 'bpmn:choreographyTask, bpmn:choreography, bpmn:globalChoreographyTask',
    xml: `${OPEN}
  <bpmn:process id="Process_1" isExecutable="true"><bpmn:startEvent id="Start_1"/><bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="End_1"/><bpmn:endEvent id="End_1"/></bpmn:process>
  <bpmn:choreography id="Choreography_1"><bpmn:choreographyTask id="ChoreographyTask_1" /></bpmn:choreography>
  <bpmn:globalChoreographyTask id="GlobalChoreographyTask_1" />
</bpmn:definitions>`,
    messages: [
      message('Choreography_1', 'bpmn:choreography', 'diagrama de coreografía'),
      message('ChoreographyTask_1', 'bpmn:choreographyTask', 'diagrama de coreografía'),
      message('GlobalChoreographyTask_1', 'bpmn:globalChoreographyTask', 'diagrama de coreografía'),
    ],
  },
  {
    row: 'bpmn:conversation, bpmn:callConversation, bpmn:subConversation',
    xml: `${OPEN}
  <bpmn:process id="Process_1" isExecutable="true"><bpmn:startEvent id="Start_1"/><bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="End_1"/><bpmn:endEvent id="End_1"/></bpmn:process>
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:conversation id="Conversation_1" />
    <bpmn:callConversation id="CallConversation_1" />
    <bpmn:subConversation id="SubConversation_1" />
  </bpmn:collaboration>
</bpmn:definitions>`,
    messages: [
      message('Conversation_1', 'bpmn:conversation', 'diagrama de conversación'),
      message('CallConversation_1', 'bpmn:callConversation', 'diagrama de conversación'),
      message('SubConversation_1', 'bpmn:subConversation', 'diagrama de conversación'),
    ],
  },
  {
    row: 'startQuantity distinto de 1',
    xml: processWith('Task_StartQuantity', `<bpmn:task id="Task_StartQuantity" startQuantity="2" />`),
    messages: [
      message('Task_StartQuantity', 'bpmn:task', 'atributo startQuantity distinto de 1'),
    ],
  },
  {
    row: 'completionQuantity distinto de 1',
    xml: processWith(
      'Task_CompletionQuantity',
      `<bpmn:task id="Task_CompletionQuantity" completionQuantity="2" />`,
    ),
    messages: [
      message(
        'Task_CompletionQuantity',
        'bpmn:task',
        'atributo completionQuantity distinto de 1',
      ),
    ],
  },
  {
    row: 'bpmn:endEvent con un disparador que no sea none ni terminate',
    xml: `${OPEN}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="End_Timer" />
    <bpmn:endEvent id="End_Timer"><bpmn:timerEventDefinition id="Def_End_Timer" /></bpmn:endEvent>
  </bpmn:process>
</bpmn:definitions>`,
    messages: [message('End_Timer', 'bpmn:endEvent', 'evento de fin con ese disparador')],
  },
  {
    row: 'bpmn:startEvent con un disparador que no sea none ni timer',
    xml: `${OPEN}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_Terminate"><bpmn:terminateEventDefinition id="Def_Start_Terminate" /></bpmn:startEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_Terminate" targetRef="End_1" />
    <bpmn:endEvent id="End_1" />
  </bpmn:process>
</bpmn:definitions>`,
    messages: [message('Start_Terminate', 'bpmn:startEvent', 'evento de inicio con ese disparador')],
  },
];

export const WARNINGS_FIXTURE = `${OPEN}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:sequenceFlow id="Flow_Condition" sourceRef="Start_1" targetRef="End_1">
      <bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">true</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
    <bpmn:endEvent id="End_1" />
  </bpmn:process>
  <bpmn:collaboration id="Collaboration_1">
    <bpmn:participant id="Participant_1" processRef="Process_1" />
    <bpmn:participant id="Participant_2" />
    <bpmn:messageFlow id="MessageFlow_1" sourceRef="Participant_1" targetRef="Participant_2" />
    <bpmn:messageFlow id="MessageFlow_2" sourceRef="Participant_2" targetRef="Participant_1" />
  </bpmn:collaboration>
</bpmn:definitions>`;
