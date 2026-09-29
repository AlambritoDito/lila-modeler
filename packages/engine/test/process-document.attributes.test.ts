/**
 * Extended attributes in the process document (#509): the filled-in values of every element —
 * process, pool, lanes, tasks, gateways, events — as labelled lines under that element, in the
 * `.docx` and in the HTML.
 *
 * Set `LILA_DOCX_OUT=<file>` to keep the generated `.docx` for the OOXML validator and python-docx
 * (the PR's manual check); the test does not need it.
 */
import { writeFileSync } from 'node:fs';

import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from 'vitest';

import { annotateElement, parseBpmn, readAnnotations } from '../src/bpmn/index.js';
import { buildProcessDocument, toDocx, toHtml } from '../src/process-document.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="urn:test">
  <bpmn:collaboration id="Collab">
    <bpmn:participant id="Pool_Banco" name="Banco" processRef="Proc_Credito" />
  </bpmn:collaboration>
  <bpmn:process id="Proc_Credito" name="Crédito" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Ventas" name="Ventas">
        <bpmn:flowNodeRef>Start_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Revisar</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Call_Buro</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Riesgo" name="Riesgo">
        <bpmn:flowNodeRef>Gateway_Ok</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Sub_Firma</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_1</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="Start_1" name="Solicitud" />
    <bpmn:task id="Task_Revisar" name="Revisar" />
    <bpmn:callActivity id="Call_Buro" name="Llamar buró" />
    <bpmn:subProcess id="Sub_Firma" name="Firmar">
      <bpmn:startEvent id="Sub_Start" />
      <bpmn:task id="Task_Firmar" name="Firmar contrato" />
      <bpmn:endEvent id="Sub_End" />
      <bpmn:sequenceFlow id="S1" sourceRef="Sub_Start" targetRef="Task_Firmar" />
      <bpmn:sequenceFlow id="S2" sourceRef="Task_Firmar" targetRef="Sub_End" />
    </bpmn:subProcess>
    <bpmn:exclusiveGateway id="Gateway_Ok" name="¿Aprobada?" />
    <bpmn:endEvent id="End_1" name="Fin" />
    <bpmn:sequenceFlow id="F1" sourceRef="Start_1" targetRef="Task_Revisar" />
    <bpmn:sequenceFlow id="F2" sourceRef="Task_Revisar" targetRef="Call_Buro" />
    <bpmn:sequenceFlow id="F2b" sourceRef="Call_Buro" targetRef="Gateway_Ok" />
    <bpmn:sequenceFlow id="F3" sourceRef="Gateway_Ok" targetRef="Sub_Firma" />
    <bpmn:sequenceFlow id="F4" sourceRef="Sub_Firma" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;

async function annotated(): Promise<string> {
  let xml = await annotateElement(XML, 'Proc_Credito', {
    attributeDefinitions: [
      { id: 'Attr_sla', name: 'SLA (h)', type: 'number', appliesTo: 'task', default: '24' },
      { id: 'Attr_riesgo', name: 'Nivel de riesgo', type: 'list', appliesTo: 'task', options: ['Bajo', 'Alto & <crítico>'] },
      { id: 'Attr_dueno', name: 'Dueño', type: 'text', appliesTo: 'process' },
      { id: 'Attr_area', name: 'Área', type: 'text', appliesTo: 'lane' },
      { id: 'Attr_regla', name: 'Regla', type: 'text', appliesTo: 'gateway' },
      { id: 'Attr_canal', name: 'Canal', type: 'text', appliesTo: 'event' },
      { id: 'Attr_sistema', name: 'Sistema', type: 'text', appliesTo: 'subProcess' },
    ],
    attributes: [{ ref: 'Attr_dueno', value: 'Gerencia de crédito' }],
  });
  xml = await annotateElement(xml, 'Task_Revisar', {
    attributes: [{ ref: 'Attr_riesgo', value: 'Alto & <crítico>' }, { ref: 'Attr_borrado', value: 'huérfano' }],
  });
  xml = await annotateElement(xml, 'Lane_Riesgo', { attributes: [{ ref: 'Attr_area', value: 'Riesgos' }] });
  xml = await annotateElement(xml, 'Pool_Banco', { attributes: [{ ref: 'Attr_area', value: 'Banca' }] });
  xml = await annotateElement(xml, 'Gateway_Ok', { attributes: [{ ref: 'Attr_regla', value: 'score > 600' }] });
  xml = await annotateElement(xml, 'Start_1', { attributes: [{ ref: 'Attr_canal', value: 'Web' }] });
  xml = await annotateElement(xml, 'Call_Buro', { attributes: [{ ref: 'Attr_sistema', value: 'Buró SAP' }] });
  xml = await annotateElement(xml, 'Sub_Firma', { attributes: [{ ref: 'Attr_sistema', value: 'DocuSign' }] });
  // The same definition again, as a pasted pool leaves it: it must not print twice.
  xml = await annotateElement(xml, 'Collab', {
    attributeDefinitions: [{ id: 'Attr_sla', name: 'SLA (h)', type: 'number', appliesTo: 'task', default: '24' }],
  });
  return xml;
}

/** The labelled lines under each heading, `heading -> ["label: text"]`. */
function linesByHeading(blocks: ReturnType<typeof buildProcessDocument>['blocks']): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  let heading = '';
  for (const block of blocks) {
    if (block.kind === 'heading') heading = block.text;
    else if (block.kind === 'paragraph' && block.label !== undefined) (out[heading] ??= []).push(`${block.label}: ${block.text}`);
  }
  return out;
}

test('every filled-in attribute is a labelled line under its element; defaults count, orphans are kept', async () => {
  const xml = await annotated();
  const { ir, subprocesses, lanes, nodeLanes, laneParents, pool, poolName, types } = await parseBpmn(xml);
  expect(types?.Call_Buro).toBe('bpmn:CallActivity');
  expect(lanes).toEqual({ Lane_Ventas: 'Ventas', Lane_Riesgo: 'Riesgo' });
  expect(pool).toBe('Pool_Banco');
  expect(poolName).toBe('Banco');
  const doc = buildProcessDocument({
    ir, annotations: await readAnnotations(xml), subprocesses, lanes, nodeLanes, laneParents, pool, poolName, types,
    title: 'Crédito', date: '2026-09-28', locale: 'es',
  });
  const lines = linesByHeading(doc.blocks);

  // The pool's lines sit under the pool's own heading, apart from the process's (#516).
  expect(lines['Descripción del proceso']).toEqual(['Dueño: Gerencia de crédito']);
  expect(lines['Banco']).toEqual(['Área: Banca']);
  expect(lines['Riesgo']).toEqual(['Área: Riesgos']);
  expect(lines['Ventas']).toBeUndefined();
  expect(lines['Revisar']).toEqual(expect.arrayContaining(['SLA (h): 24', 'Nivel de riesgo: Alto & <crítico>', 'Attr_borrado: huérfano']));
  expect(lines['¿Aprobada?']).toEqual(expect.arrayContaining(['Regla: score > 600']));
  expect(lines['Solicitud']).toEqual(expect.arrayContaining(['Canal: Web']));
  expect(lines['Revisar']?.filter((l) => l.startsWith('SLA'))).toHaveLength(1);
  // A call activity is a sub-process for its attributes, although the IR flattens it to a task.
  expect(lines['Llamar buró']).toEqual(expect.arrayContaining(['Sistema: Buró SAP']));
  expect(lines['Llamar buró']?.some((l) => l.startsWith('SLA'))).toBe(false);
  expect(lines['Firmar']).toEqual(expect.arrayContaining(['Sistema: DocuSign']));
  expect(lines['Firmar contrato']).toEqual(expect.arrayContaining(['SLA (h): 24']));
  // A task-only attribute never lands on an event.
  expect(lines['Fin']?.some((l) => l.startsWith('SLA'))).toBe(false);

  const docx = toDocx(doc);
  const document = strFromU8(unzipSync(docx)['word/document.xml']!);
  expect(document).toContain('Alto &amp; &lt;crítico&gt;');
  expect(document).toContain('score &gt; 600');
  expect(toHtml(doc)).toContain('Alto &amp; &lt;crítico&gt;');

  const out = process.env.LILA_DOCX_OUT;
  if (out !== undefined && out !== '') writeFileSync(out, docx);
});

test('a model without attributes gives the same document as before (no extra lines)', async () => {
  const { ir, subprocesses, lanes, pool } = await parseBpmn(XML);
  const annotations = await readAnnotations(XML);
  const base = { ir, annotations, subprocesses, title: 't', date: 'd' } as const;
  expect(buildProcessDocument({ ...base, lanes, pool })).toEqual(buildProcessDocument(base));
});

test('a parent lane keeps its section and attributes, and its child lanes hang from it (#516)', async () => {
  const nested = XML.replace(
    /<bpmn:laneSet id="LaneSet_1">[\s\S]*?<\/bpmn:laneSet>/,
    `<bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Comercial" name="Comercial">
        <bpmn:flowNodeRef>Start_1</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Task_Revisar</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Call_Buro</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Gateway_Ok</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>Sub_Firma</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>End_1</bpmn:flowNodeRef>
        <bpmn:childLaneSet id="LaneSet_2">
          <bpmn:lane id="Lane_Ventas" name="Ventas">
            <bpmn:flowNodeRef>Start_1</bpmn:flowNodeRef>
            <bpmn:flowNodeRef>Task_Revisar</bpmn:flowNodeRef>
            <bpmn:flowNodeRef>Call_Buro</bpmn:flowNodeRef>
          </bpmn:lane>
          <bpmn:lane id="Lane_Riesgo" name="Riesgo">
            <bpmn:flowNodeRef>Gateway_Ok</bpmn:flowNodeRef>
            <bpmn:flowNodeRef>Sub_Firma</bpmn:flowNodeRef>
            <bpmn:flowNodeRef>End_1</bpmn:flowNodeRef>
          </bpmn:lane>
        </bpmn:childLaneSet>
      </bpmn:lane>
    </bpmn:laneSet>`,
  );
  let xml = await annotateElement(nested, 'Proc_Credito', {
    attributeDefinitions: [{ id: 'Attr_area', name: 'Área', type: 'text', appliesTo: 'lane' }],
  });
  xml = await annotateElement(xml, 'Lane_Comercial', { attributes: [{ ref: 'Attr_area', value: 'Comercial y riesgo' }] });
  xml = await annotateElement(xml, 'Lane_Riesgo', { attributes: [{ ref: 'Attr_area', value: 'Riesgos' }] });
  const { ir, subprocesses, lanes, nodeLanes, laneParents, pool, poolName, types } = await parseBpmn(xml);
  expect(laneParents).toEqual({ Lane_Ventas: 'Lane_Comercial', Lane_Riesgo: 'Lane_Comercial' });
  const doc = buildProcessDocument({
    ir, annotations: await readAnnotations(xml), subprocesses, lanes, nodeLanes, laneParents, pool, poolName, types,
    title: 'Crédito', date: '2026-09-28', locale: 'es',
  });
  const lines = linesByHeading(doc.blocks);
  expect(lines['Comercial']).toEqual(['Área: Comercial y riesgo']);
  expect(lines['Comercial / Riesgo']).toEqual(['Área: Riesgos']);
  const h1 = doc.blocks.filter((b) => b.kind === 'heading' && b.level === 1).map((b) => (b as { text: string }).text);
  expect(h1).toEqual(['Descripción del proceso', 'Comercial', 'Comercial / Ventas', 'Comercial / Riesgo']);
  expect(lines['Revisar']).toContain('Carril: Comercial / Ventas');
});
