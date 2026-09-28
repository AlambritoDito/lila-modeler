/**
 * Extended attributes (#509): the rules in `src/bpmn/attributes.ts` and their `lila:` round trip
 * through `annotate.ts`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BpmnModdle } from 'bpmn-moddle';
import { describe, expect, it } from 'vitest';
import { annotateElement, readAnnotations } from '../../src/bpmn/annotate.js';
import {
  categoryOf,
  effectiveAttributes,
  validateAttributeValue,
  type AttributeDefinition,
} from '../../src/bpmn/attributes.js';
import lila from '../../src/bpmn/lila.moddle.json' with { type: 'json' };

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const pedido = read('../../../../examples/pedido/model.bpmn');

const DEFINITIONS: AttributeDefinition[] = [
  { id: 'Attr_sla', name: 'SLA', type: 'number', appliesTo: 'task', default: '10' },
  { id: 'Attr_nivel', name: 'Nivel & <riesgo>', type: 'list', appliesTo: 'task', options: ['Bajo', 'Alto "crítico"'] },
  { id: 'Attr_alta', name: 'Alta', type: 'date', appliesTo: 'process' },
  { id: 'Attr_dueno', name: 'Dueño', type: 'text', appliesTo: 'gateway' },
];

describe('validateAttributeValue', () => {
  it.each([
    ['number', '12', null],
    ['number', '-1.5', null],
    ['number', '.5', null],
    ['number', '1,5', 'number'],
    ['number', '1e3', 'number'],
    ['number', ' 4', 'number'],
    ['number', 'doce', 'number'],
    ['date', '2026-09-28', null],
    ['date', '2026-02-30', 'date'],
    ['date', '28/09/2026', 'date'],
    ['text', 'lo que sea', null],
    ['unknown-type', 'lo que sea', null],
  ])('%s %j -> %s', (type, value, problem) => {
    expect(validateAttributeValue({ type }, value)).toBe(problem);
  });

  it('a list value must be one of its options; empty always fits', () => {
    expect(validateAttributeValue({ type: 'list', options: ['A', 'B'] }, 'B')).toBeNull();
    expect(validateAttributeValue({ type: 'list', options: ['A', 'B'] }, 'b')).toBe('option');
    expect(validateAttributeValue({ type: 'number' }, '')).toBeNull();
  });
});

it('categoryOf maps every BPMN type of the issue and nothing else', () => {
  expect(categoryOf('bpmn:UserTask')).toBe('task');
  expect(categoryOf('bpmn:Task')).toBe('task');
  expect(categoryOf('bpmn:ExclusiveGateway')).toBe('gateway');
  expect(categoryOf('bpmn:BoundaryEvent')).toBe('event');
  expect(categoryOf('bpmn:SubProcess')).toBe('subProcess');
  expect(categoryOf('bpmn:CallActivity')).toBe('subProcess');
  expect(categoryOf('bpmn:Participant')).toBe('lane');
  expect(categoryOf('bpmn:Lane')).toBe('lane');
  expect(categoryOf('bpmn:Process')).toBe('process');
  expect(categoryOf('bpmn:SequenceFlow')).toBeUndefined();
  expect(categoryOf('bpmn:TextAnnotation')).toBeUndefined();
});

it('effectiveAttributes: own value, else default; orphans are kept under their ref', () => {
  expect(effectiveAttributes(DEFINITIONS, 'task', [{ ref: 'Attr_nivel', value: 'Bajo' }, { ref: 'Attr_borrado', value: 'x' }])).toEqual([
    { name: 'SLA', value: '10' },
    { name: 'Nivel & <riesgo>', value: 'Bajo' },
    { name: 'Attr_borrado', value: 'x' },
  ]);
  expect(effectiveAttributes(DEFINITIONS, 'event', [])).toEqual([]);
});

describe('lila:attributeDefinition and lila:attributeValue', () => {
  it('(a) values survive writing the XML and reading it back, with <, & and accents', async () => {
    let xml = await annotateElement(pedido, 'Process_Restaurante', {
      attributeDefinitions: DEFINITIONS,
      attributes: [{ ref: 'Attr_alta', value: '2026-09-28' }],
    });
    xml = await annotateElement(xml, 'Task_TomarPedido', {
      attributes: [{ ref: 'Attr_sla', value: '4.5' }, { ref: 'Attr_nivel', value: 'Alto "crítico"' }],
    });

    // A second trip through bpmn-moddle, as a save after reopening does.
    const moddle = BpmnModdle({ lila });
    const reopened = (await moddle.toXML((await moddle.fromXML(xml)).rootElement, { format: true })).xml;
    const annotations = await readAnnotations(reopened);

    expect(annotations.Process_Restaurante).toMatchObject({
      attributeDefinitions: DEFINITIONS,
      attributes: [{ ref: 'Attr_alta', value: '2026-09-28' }],
    });
    expect(annotations.Task_TomarPedido).toEqual({
      attributes: [{ ref: 'Attr_sla', value: '4.5' }, { ref: 'Attr_nivel', value: 'Alto "crítico"' }],
    });
    expect(reopened).toBe(xml);
  });

  it('writing attributes leaves the other lila: elements of the element alone', async () => {
    const base = await annotateElement(pedido, 'Task_TomarPedido', {
      refs: { systemRef: ['sys-pos'] },
      attributes: [{ ref: 'Attr_sla', value: '1' }],
    });
    const changed = await annotateElement(base, 'Task_TomarPedido', { attributes: [{ ref: 'Attr_sla', value: '2' }] });
    expect((await readAnnotations(changed)).Task_TomarPedido).toEqual({
      refs: { systemRef: ['sys-pos'] },
      attributes: [{ ref: 'Attr_sla', value: '2' }],
    });
  });

  it('(b) a model without attributes serializes byte for byte as it did before the new types', async () => {
    // The descriptor as it was before #509: the same file minus the three new types.
    const before = { ...lila, types: lila.types.filter((t) => !['AttributeDefinition', 'Option', 'AttributeValue'].includes(t.name)) };
    const annotated = await annotateElement(pedido, 'Task_TomarPedido', {
      documentation: 'doc',
      responsibilities: [{ type: 'R', roleRef: 'rol' }],
      refs: { kpiRef: ['kpi'] },
    });
    for (const source of [pedido, annotated]) {
      const trip = async (descriptor: typeof lila): Promise<string> => {
        const moddle = BpmnModdle({ lila: descriptor });
        return (await moddle.toXML((await moddle.fromXML(source)).rootElement, { format: true })).xml;
      };
      const now = await trip(lila);
      expect(now).toBe(await trip(before));
      expect(now).not.toContain('attribute');
      // And a second save changes nothing: the file is a fixed point.
      const moddle = BpmnModdle({ lila });
      expect((await moddle.toXML((await moddle.fromXML(now)).rootElement, { format: true })).xml).toBe(now);
    }
  });
});
