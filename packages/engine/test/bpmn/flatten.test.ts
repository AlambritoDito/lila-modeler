import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseBpmn } from '../../src/bpmn/parse.js';
import { validateIr, type Node, type ProcessIR } from '../../src/core/ir.js';

function fixture(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
}

/** El IR sin lo que sí puede diferir entre los dos archivos: identidad del proceso y `subprocessId`. */
function shape(ir: ProcessIR): { nodes: Record<string, Omit<Node, 'subprocessId'>>; flows: ProcessIR['flows'] } {
  const nodes: Record<string, Omit<Node, 'subprocessId'>> = {};
  for (const [id, { subprocessId: _ignored, ...node }] of Object.entries(ir.nodes)) nodes[id] = node;
  return { nodes, flows: ir.flows };
}

test('un subproceso con un AND interno produce el mismo IR que el proceso aplanado a mano', async () => {
  const conSubproceso = await parseBpmn(fixture('subproceso-and.bpmn'));
  const aMano = await parseBpmn(fixture('aplanado-and.bpmn'));

  expect(shape(conSubproceso.ir)).toEqual(shape(aMano.ir));
  expect(validateIr(conSubproceso.ir)).toEqual([]);
  expect(validateIr(aMano.ir)).toEqual([]);

  // El subproceso, su start y su end internos desaparecen como nodos (R-PLAN-1, R-PLAN-2).
  expect(Object.keys(conSubproceso.ir.nodes).sort()).toEqual([
    'End_Proceso',
    'Gateway_Fork',
    'Gateway_Join',
    'Start_Proceso',
    'Task_A',
    'Task_B',
  ]);
  expect(Object.keys(conSubproceso.ir.flows).sort()).toEqual([
    'Flow_A_Join',
    'Flow_B_Join',
    'Flow_Entrada',
    'Flow_Fork_A',
    'Flow_Fork_B',
    'Flow_Join_Fin',
  ]);

  // El flujo entrante cuelga del sucesor del start interno y el saliente del end interno.
  expect(conSubproceso.ir.flows['Flow_Entrada']?.to).toBe('Gateway_Fork');
  expect(conSubproceso.ir.flows['Flow_Join_Fin']?.to).toBe('End_Proceso');

  // Cada nodo aplanado conserva el id del subproceso del que venía.
  for (const id of ['Gateway_Fork', 'Task_A', 'Task_B', 'Gateway_Join']) {
    expect(conSubproceso.ir.nodes[id]?.subprocessId).toBe('SubProcess_Preparacion');
  }
  for (const id of ['Start_Proceso', 'End_Proceso']) {
    expect(conSubproceso.ir.nodes[id]?.subprocessId).toBeUndefined();
  }
  expect(Object.values(aMano.ir.nodes).every((n) => n.subprocessId === undefined)).toBe(true);

  // Sin reescritura de ids no hay nada que registrar: originalIds es la identidad.
  expect(Object.entries(conSubproceso.ir.source.originalIds).every(([k, v]) => k === v)).toBe(true);
});

test('una call activity es un task: no se expande el proceso llamado (R-PLAN-4)', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:t">
  <bpmn:process id="Process_Llamador" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Call_Reusable" />
    <bpmn:callActivity id="Call_Reusable" name="Evaluar riesgo" calledElement="Process_Llamado" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Call_Reusable" targetRef="End_1" />
    <bpmn:endEvent id="End_1" />
  </bpmn:process>
  <bpmn:process id="Process_Llamado" isExecutable="false">
    <bpmn:startEvent id="Start_Llamado" />
    <bpmn:sequenceFlow id="Flow_Llamado" sourceRef="Start_Llamado" targetRef="Task_Interna" />
    <bpmn:task id="Task_Interna" name="Interna" />
  </bpmn:process>
</bpmn:definitions>`;

  const { ir, ignoredProcessIds } = await parseBpmn(xml);

  expect(ir.nodes['Call_Reusable']).toEqual({
    type: 'task',
    name: 'Evaluar riesgo',
    incoming: ['Flow_1'],
    outgoing: ['Flow_2'],
  });
  expect(Object.keys(ir.nodes)).toEqual(['Start_1', 'Call_Reusable', 'End_1']);
  expect(ignoredProcessIds).toEqual(['Process_Llamado']);
  expect(validateIr(ir)).toEqual([]);
});

test('el aplanado es recursivo y varios end internos apuntan a la salida del subproceso', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:t">
  <bpmn:process id="Process_Anidado" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Sub_Externo" />
    <bpmn:subProcess id="Sub_Externo" name="Externo">
      <bpmn:startEvent id="Ext_Start" />
      <bpmn:sequenceFlow id="Flow_2" sourceRef="Ext_Start" targetRef="Sub_Interno" />
      <bpmn:subProcess id="Sub_Interno" name="Interno">
        <bpmn:startEvent id="Int_Start" />
        <bpmn:sequenceFlow id="Flow_3" sourceRef="Int_Start" targetRef="Gateway_Xor" />
        <bpmn:exclusiveGateway id="Gateway_Xor" default="Flow_4" />
        <bpmn:sequenceFlow id="Flow_4" sourceRef="Gateway_Xor" targetRef="Int_End_A" />
        <bpmn:sequenceFlow id="Flow_5" sourceRef="Gateway_Xor" targetRef="Int_End_B" />
        <bpmn:endEvent id="Int_End_A" />
        <bpmn:endEvent id="Int_End_B" />
      </bpmn:subProcess>
      <bpmn:sequenceFlow id="Flow_6" sourceRef="Sub_Interno" targetRef="Task_Ext" />
      <bpmn:task id="Task_Ext" name="Tarea externa" />
      <bpmn:sequenceFlow id="Flow_7" sourceRef="Task_Ext" targetRef="Ext_End" />
      <bpmn:endEvent id="Ext_End" />
    </bpmn:subProcess>
    <bpmn:sequenceFlow id="Flow_8" sourceRef="Sub_Externo" targetRef="End_1" />
    <bpmn:endEvent id="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

  const { ir } = await parseBpmn(xml);

  expect(Object.keys(ir.nodes)).toEqual(['Start_1', 'Gateway_Xor', 'Task_Ext', 'End_1']);
  // El `subprocessId` es el del subproceso más interno que lo contiene (R-PLAN-1).
  expect(ir.nodes['Gateway_Xor']?.subprocessId).toBe('Sub_Interno');
  expect(ir.nodes['Task_Ext']?.subprocessId).toBe('Sub_Externo');

  expect(ir.flows['Flow_1']?.to).toBe('Gateway_Xor');
  // Los dos end del subproceso interno salen a la tarea que seguía al subproceso.
  expect(ir.flows['Flow_4']).toEqual({
    from: 'Gateway_Xor',
    to: 'Task_Ext',
    name: '',
    isDefault: true,
  });
  expect(ir.flows['Flow_5']?.to).toBe('Task_Ext');
  expect(ir.flows['Flow_7']?.to).toBe('End_1');
  expect(Object.keys(ir.flows)).toEqual(['Flow_1', 'Flow_4', 'Flow_5', 'Flow_7']);
  expect(validateIr(ir)).toEqual([]);
});

test('devuelve los elementos fuera del perfil en orden de documento, sin formatear el error', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:t">
  <bpmn:process id="Process_NoSop" isExecutable="true">
    <bpmn:startEvent id="Start_1" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:task id="Task_1" name="Revisar" />
    <bpmn:boundaryEvent id="Boundary_1" name="Vence el plazo" attachedToRef="Task_1">
      <bpmn:timerEventDefinition id="TED_1" />
    </bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="Flow_Boundary" sourceRef="Boundary_1" targetRef="End_1" />
    <bpmn:eventBasedGateway id="Gateway_Eventos" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
    <bpmn:endEvent id="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

  const { ir, unsupported } = await parseBpmn(xml);

  expect(unsupported).toEqual([
    {
      id: 'Boundary_1',
      qname: 'bpmn:BoundaryEvent',
      name: 'Vence el plazo',
      construction: 'boundaryEvent',
    },
    { id: 'Flow_Boundary', qname: 'bpmn:SequenceFlow', name: '' },
    {
      id: 'Gateway_Eventos',
      qname: 'bpmn:EventBasedGateway',
      name: '',
      construction: 'eventBasedGateway',
    },
  ]);
  // El IR queda estructuralmente sano: ni el elemento ni su flujo entran.
  expect(Object.keys(ir.nodes)).toEqual(['Start_1', 'Task_1', 'End_1']);
  expect(validateIr(ir)).toEqual([]);
});
