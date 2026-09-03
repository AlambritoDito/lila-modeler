import { expect, test } from 'vitest';
import { BpmnModdle } from 'bpmn-moddle';
import lila from '../../src/bpmn/lila.moddle.json' with { type: 'json' };

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions
    xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:lila="https://lila-modeler.org/schema/bpmn/1"
    id="Definitions_1"
    targetNamespace="http://lila-modeler.org/schema/bpmn">
  <bpmn:process id="credito-solicitud" isExecutable="false">
    <bpmn:extensionElements>
      <lila:versionTag value="1.3.0" />
    </bpmn:extensionElements>
    <bpmn:task id="Task_7f3k2q1" name="Revisar solicitud">
      <bpmn:extensionElements>
        <lila:responsibility type="R" roleRef="rol-1" />
        <lila:responsibility type="A" roleRef="rol-2" />
        <lila:systemRef ref="sys-crm" />
      </bpmn:extensionElements>
    </bpmn:task>
  </bpmn:process>
</bpmn:definitions>`;

function moddle() {
  return BpmnModdle({ lila });
}

test('lee lila:responsibility type="R" roleRef="rol-1" desde extensionElements', async () => {
  const { rootElement } = await moddle().fromXML(XML);
  const process = rootElement.rootElements[0];
  const task = process.flowElements[0];
  const extensions = task.extensionElements.values;

  expect(extensions).toHaveLength(3);
  expect(extensions[0].$type).toBe('lila:Responsibility');
  expect(extensions[0].type).toBe('R');
  expect(extensions[0].roleRef).toBe('rol-1');
  expect(extensions[1].type).toBe('A');
  expect(extensions[1].roleRef).toBe('rol-2');
  expect(extensions[2].$type).toBe('lila:SystemRef');
  expect(extensions[2].ref).toBe('sys-crm');
});

test('el round-trip import -> export conserva orden y valores de lila:*', async () => {
  const { rootElement } = await moddle().fromXML(XML);
  const { xml } = await moddle().toXML(rootElement, { format: true });

  // Round-trip: reimportar el XML exportado debe producir los mismos valores.
  const { rootElement: reimported } = await moddle().fromXML(xml);
  const process = reimported.rootElements[0];
  const task = process.flowElements[0];
  const extensions = task.extensionElements.values;

  expect(process.extensionElements.values).toHaveLength(1);
  expect(process.extensionElements.values[0].$type).toBe('lila:VersionTag');
  expect(process.extensionElements.values[0].value).toBe('1.3.0');

  expect(extensions.map((e: { $type: string }) => e.$type)).toEqual([
    'lila:Responsibility',
    'lila:Responsibility',
    'lila:SystemRef',
  ]);
  expect(extensions[0].type).toBe('R');
  expect(extensions[0].roleRef).toBe('rol-1');
  expect(extensions[1].type).toBe('A');
  expect(extensions[1].roleRef).toBe('rol-2');
  expect(extensions[2].ref).toBe('sys-crm');

  // El XML serializado escribe explícitamente los atributos lila:*.
  expect(xml).toContain('lila:responsibility');
  expect(xml).toContain('type="R"');
  expect(xml).toContain('roleRef="rol-1"');
  expect(xml).toContain('lila:versionTag');
  expect(xml).toContain('value="1.3.0"');
});

test('escribe lila:responsibility en un elemento creado programáticamente', async () => {
  const m = moddle();
  const definitions = m.create('bpmn:Definitions', {
    id: 'Definitions_2',
    targetNamespace: 'http://lila-modeler.org/schema/bpmn',
  });
  const process = m.create('bpmn:Process', { id: 'proc-1', isExecutable: false });
  const responsibility = m.create('lila:Responsibility', { type: 'R', roleRef: 'rol-1' });
  const task = m.create('bpmn:Task', {
    id: 'Task_x',
    extensionElements: m.create('bpmn:ExtensionElements', { values: [responsibility] }),
  });
  process.flowElements = [task];
  definitions.rootElements = [process];

  const { xml } = await m.toXML(definitions, { format: true });

  expect(xml).toContain('lila:responsibility');
  expect(xml).toContain('type="R"');
  expect(xml).toContain('roleRef="rol-1"');
});
