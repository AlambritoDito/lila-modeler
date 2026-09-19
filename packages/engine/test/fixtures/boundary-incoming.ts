/**
 * Synthetic topology for #364, authored solely for regression coverage: one task, one timer
 * boundary and a shared end. No external model or private case data. The optional start-to-
 * boundary flow violates R-BND-1/R-BND-10; XML declarations and ordering must not affect that.
 */
export function boundaryIncomingXml({
  cancelActivity,
  incoming = true,
  declareIncoming = false,
  flowFirst = false,
}: {
  cancelActivity?: string;
  incoming?: boolean;
  declareIncoming?: boolean;
  flowFirst?: boolean;
} = {}): string {
  const flow = incoming
    ? '<bpmn:sequenceFlow id="Flow_Incoming" sourceRef="Start" targetRef="Boundary" />'
    : '';
  const cancel = cancelActivity === undefined ? '' : ` cancelActivity="${cancelActivity}"`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_BoundaryIncoming" isExecutable="true">
    <bpmn:startEvent id="Start" />
    <bpmn:task id="Host" />
    ${flowFirst ? flow : ''}
    <bpmn:boundaryEvent id="Boundary" name="Deadline" attachedToRef="Host"${cancel}>
      ${declareIncoming ? '<bpmn:incoming>Flow_Incoming</bpmn:incoming>' : ''}
      <bpmn:timerEventDefinition id="Timer" />
    </bpmn:boundaryEvent>
    ${flowFirst ? '' : flow}
    <bpmn:endEvent id="End" />
    <bpmn:sequenceFlow id="Flow_Start" sourceRef="Start" targetRef="Host" />
    <bpmn:sequenceFlow id="Flow_Host" sourceRef="Host" targetRef="End" />
    <bpmn:sequenceFlow id="Flow_Boundary" sourceRef="Boundary" targetRef="End" />
  </bpmn:process>
</bpmn:definitions>`;
}
