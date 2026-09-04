import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { parseBpmn, roundTripXml } from '../../src/bpmn/parse.js';

const FIXTURES_DIR = fileURLToPath(new URL('../../../../examples/bizagi-exports/', import.meta.url));

const FIXTURES = readdirSync(FIXTURES_DIR)
  .filter((f) => f.endsWith('.bpmn'))
  .sort();

// Fija la lista para que un fixture agregado o quitado sin querer se note en el diff del test,
// no solo en el conteo (aceptación de LILA-020: los 7 fixtures parsean sin excepción).
test('examples/bizagi-exports trae los 7 fixtures esperados', () => {
  expect(FIXTURES).toEqual([
    'bizagi-miwg-A.1.0-roundtrip.bpmn',
    'bizagi-miwg-A.2.0-roundtrip.bpmn',
    'bizagi-miwg-A.3.0-roundtrip.bpmn',
    'bizagi-miwg-A.4.0-roundtrip.bpmn',
    'bizagi-miwg-A.4.1-roundtrip.bpmn',
    'bizagi-miwg-B.1.0-roundtrip.bpmn',
    'bizagi-miwg-B.2.0-roundtrip.bpmn',
  ]);
});

for (const name of FIXTURES) {
  test(`${name}: parsea sin excepción`, async () => {
    const xml = readFileSync(FIXTURES_DIR + name, 'utf8');
    await expect(parseBpmn(xml)).resolves.toBeDefined();
  });

  test(`${name}: el round-trip conserva los bloques bizagi: con el mismo conteo`, async () => {
    const xml = readFileSync(FIXTURES_DIR + name, 'utf8');
    // Conteo de etiquetas de apertura `<bizagi:Algo`, no del texto libre "bizagi" (que también
    // aparece en el propio xmlns:bizagi="..." y no debe contarse ahí).
    const tagsBefore = xml.match(/<bizagi:[A-Za-z]+/g) ?? [];
    expect(tagsBefore.length).toBeGreaterThan(0);

    const out = await roundTripXml(xml);
    const tagsAfter = out.match(/<bizagi:[A-Za-z]+/g) ?? [];

    expect(tagsAfter.length).toBe(tagsBefore.length);
  });
}

test('bpmn-moddle no necesita un descriptor moddle propio para bizagi:', async () => {
  // El namespace xmlns:bizagi se declara localmente dentro de cada bizagi:BizagiExtensions
  // (no una sola vez en la raíz, como lila:), y bpmn-moddle igual lo tolera y lo conserva al
  // reserializar: no hace falta registrar un `bizagi.moddle.json` (ver docs/BPMN_EXTENSION.md
  // § "Round-trip"). Este test deja constancia explícita de esa decisión: no añadir código.
  const xml = readFileSync(FIXTURES_DIR + 'bizagi-miwg-A.1.0-roundtrip.bpmn', 'utf8');
  const { ir } = await parseBpmn(xml);
  expect(Object.keys(ir.nodes).length).toBeGreaterThan(0);
});

test('un id no-NCName de un fixture tipo Bizagi se sanitiza y se recupera en originalIds', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bizagi="http://www.bizagi.com/bpmn20"
                  id="Definitions_1" targetNamespace="urn:t">
  <bpmn:process id="Process_1" name="Con ids de Bizagi" isExecutable="true">
    <bpmn:startEvent id="1-inicio" name="Inicio" />
    <bpmn:task id="2-revisar" name="Revisar">
      <bpmn:extensionElements>
        <bizagi:BizagiExtensions xmlns:bizagi="http://www.bizagi.com/bpmn20">
          <bizagi:BizagiProperties>
            <bizagi:BizagiProperty name="ANYSIZE" value="false" />
          </bizagi:BizagiProperties>
        </bizagi:BizagiExtensions>
      </bpmn:extensionElements>
    </bpmn:task>
    <bpmn:endEvent id="3-fin" name="Fin" />
    <bpmn:sequenceFlow id="4-flujo1" sourceRef="1-inicio" targetRef="2-revisar" />
    <bpmn:sequenceFlow id="5-flujo2" sourceRef="2-revisar" targetRef="3-fin" />
  </bpmn:process>
</bpmn:definitions>`;

  const { ir } = await parseBpmn(xml);

  // Ninguno de los ids originales ("1-inicio", ...) es NCName (empiezan por dígito): todos se
  // sanitizan, y el IR los usa como clave sanitizada, no el original.
  expect(Object.keys(ir.nodes)).toHaveLength(3);
  expect(Object.keys(ir.nodes)).not.toContain('1-inicio');
  expect(Object.keys(ir.nodes)).not.toContain('2-revisar');
  expect(Object.keys(ir.nodes)).not.toContain('3-fin');

  const startId = Object.entries(ir.nodes).find(([, n]) => n.type === 'start')?.[0];
  const taskId = Object.entries(ir.nodes).find(([, n]) => n.type === 'task')?.[0];
  const endId = Object.entries(ir.nodes).find(([, n]) => n.type === 'end')?.[0];
  expect(startId).toBeDefined();
  expect(taskId).toBeDefined();
  expect(endId).toBeDefined();

  // originalIds recupera el id de Bizagi a partir del id sanitizado.
  expect(ir.source.originalIds[startId as string]).toBe('1-inicio');
  expect(ir.source.originalIds[taskId as string]).toBe('2-revisar');
  expect(ir.source.originalIds[endId as string]).toBe('3-fin');

  // sourceRef/targetRef quedaron recableados de forma coherente con los ids sanitizados: el
  // grafo sigue siendo start -> task -> end, no quedó colgante.
  expect(ir.nodes[startId as string]?.outgoing).toHaveLength(1);
  const firstFlowId = ir.nodes[startId as string]?.outgoing[0] as string;
  expect(ir.flows[firstFlowId]?.to).toBe(taskId);
  expect(ir.nodes[taskId as string]?.outgoing).toHaveLength(1);
  const secondFlowId = ir.nodes[taskId as string]?.outgoing[0] as string;
  expect(ir.flows[secondFlowId]?.to).toBe(endId);

  // Los ids de los flujos ("4-flujo1", "5-flujo2") tampoco son NCName y también se sanitizan.
  expect(ir.source.originalIds[firstFlowId]).toBe('4-flujo1');
  expect(ir.source.originalIds[secondFlowId]).toBe('5-flujo2');

  // La sanitización se conserva en el round-trip: el bloque bizagi: sigue ahí y la reserialización
  // no lanza.
  const out = await roundTripXml(xml);
  expect(out).toContain('<bizagi:BizagiProperty');
});
