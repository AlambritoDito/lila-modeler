import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseBpmn } from '../../src/bpmn/parse.js';
import { validateIr } from '../../src/core/ir.js';

const PEDIDO = readFileSync(new URL('../../../../examples/pedido/model.bpmn', import.meta.url), 'utf8');

test('snapshot del IR de examples/pedido', async () => {
  const { ir } = await parseBpmn(PEDIDO);
  expect(ir).toMatchSnapshot();
});

test('los nodos y flujos esperados de examples/pedido están en el IR', async () => {
  const { ir, ignoredProcessIds } = await parseBpmn(PEDIDO);

  expect(ir.id).toBe('Process_Restaurante');
  expect(ir.name).toBe('Restaurante');
  // Multiproceso: se parsea el primer proceso no vacío; el pool "Cliente" solo se lista.
  expect(ignoredProcessIds).toEqual(['Process_Cliente']);

  expect(Object.fromEntries(Object.entries(ir.nodes).map(([id, n]) => [id, n.type]))).toEqual({
    StartEvent_Pedido: 'start',
    Task_TomarPedido: 'task',
    Gateway_ANDFork: 'and',
    Task_Preparar: 'task',
    Task_Empacar: 'task',
    Gateway_ANDJoin: 'and',
    Task_Revisar: 'task',
    Gateway_Aprobacion: 'xor',
    Timer_Reposo: 'timer',
    EndEvent_Entregado: 'end',
    EndEvent_Rechazado: 'end',
  });

  expect(Object.keys(ir.flows)).toEqual([
    'Flow_Start_TomarPedido',
    'Flow_TomarPedido_ANDFork',
    'Flow_ANDFork_Preparar',
    'Flow_ANDFork_Empacar',
    'Flow_Preparar_ANDJoin',
    'Flow_Empacar_ANDJoin',
    'Flow_ANDJoin_Revisar',
    'Flow_Revisar_Aprobacion',
    'Flow_Aprobado',
    'Flow_Rechazado',
    'Flow_Timer_EndEntregado',
  ]);

  expect(ir.flows['Flow_Aprobado']).toEqual({
    from: 'Gateway_Aprobacion',
    to: 'Timer_Reposo',
    name: 'Aprobado',
    isDefault: false,
  });

  // incoming/outgoing en orden de aparición en el documento.
  expect(ir.nodes['Gateway_ANDFork']?.outgoing).toEqual([
    'Flow_ANDFork_Preparar',
    'Flow_ANDFork_Empacar',
  ]);
  expect(ir.nodes['Gateway_ANDJoin']?.incoming).toEqual([
    'Flow_Preparar_ANDJoin',
    'Flow_Empacar_ANDJoin',
  ]);

  expect(ir.source.exporter).toBe('Lila Modeler examples (hand-written)');
  expect(ir.source.exporterVersion).toBe('0.0.0');
  // Todavía no se reescribe ningún id: originalIds es la identidad.
  expect(Object.entries(ir.source.originalIds).every(([k, v]) => k === v)).toBe(true);
  expect(Object.keys(ir.source.originalIds)).toHaveLength(22);

  expect(validateIr(ir)).toEqual([]);
});

test('funciona en Node sin DOM', async () => {
  expect((globalThis as Record<string, unknown>)['document']).toBeUndefined();
  expect((globalThis as Record<string, unknown>)['DOMParser']).toBeUndefined();
  expect((globalThis as Record<string, unknown>)['window']).toBeUndefined();

  const { ir } = await parseBpmn(PEDIDO);
  expect(Object.keys(ir.nodes)).toHaveLength(11);
});

test('mapea variantes de tarea, gateways, lanes, terminate e isDefault', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  id="Definitions_Perfil" targetNamespace="urn:t">
  <bpmn:process id="Process_Perfil" name="Perfil" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Back" name="Backoffice">
        <bpmn:flowNodeRef>Task_User</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Service</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_1" name="Inicio" />
    <bpmn:userTask id="Task_User" name="Revisar" />
    <bpmn:serviceTask id="Task_Service" />
    <bpmn:scriptTask id="Task_Script" />
    <bpmn:businessRuleTask id="Task_Rule" />
    <bpmn:sendTask id="Task_Send" />
    <bpmn:receiveTask id="Task_Receive" />
    <bpmn:manualTask id="Task_Manual" />
    <bpmn:inclusiveGateway id="Gateway_Or" default="Flow_Default" />
    <bpmn:exclusiveGateway id="Gateway_Xor" />
    <bpmn:intermediateCatchEvent id="Timer_1" name="Espera">
      <bpmn:timerEventDefinition id="TED_1" />
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="End_1" />
    <bpmn:endEvent id="End_Terminate">
      <bpmn:terminateEventDefinition id="TerED_1" />
    </bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_Default" sourceRef="Gateway_Or" targetRef="Task_User" />
    <bpmn:sequenceFlow id="Flow_Otro" name="otro" sourceRef="Gateway_Or" targetRef="Task_Service" />
  </bpmn:process>
</bpmn:definitions>`;

  const { ir } = await parseBpmn(xml);

  expect(Object.fromEntries(Object.entries(ir.nodes).map(([id, n]) => [id, n.type]))).toEqual({
    Start_1: 'start',
    Task_User: 'task',
    Task_Service: 'task',
    Task_Script: 'task',
    Task_Rule: 'task',
    Task_Send: 'task',
    Task_Receive: 'task',
    Task_Manual: 'task',
    Gateway_Or: 'or',
    Gateway_Xor: 'xor',
    Timer_1: 'timer',
    End_1: 'end',
    End_Terminate: 'terminate',
  });

  expect(ir.nodes['Task_User']?.lane).toBe('Backoffice');
  expect(ir.nodes['Task_Service']?.lane).toBe('Backoffice');
  expect(ir.nodes['Task_Script']?.lane).toBeUndefined();
  expect(ir.nodes['Task_Service']?.name).toBe('');

  expect(ir.flows['Flow_Default']?.isDefault).toBe(true);
  expect(ir.flows['Flow_Otro']?.isDefault).toBe(false);

  // Sin exporter/exporterVersion en el XML: cadena vacía, no undefined.
  expect(ir.source.exporter).toBe('');
  expect(ir.source.exporterVersion).toBe('');
});
