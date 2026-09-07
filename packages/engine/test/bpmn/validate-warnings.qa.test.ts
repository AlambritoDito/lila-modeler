/**
 * QA adversarial de los avisos de bpmn-moddle (LILA-185 / #198), `docs/SEMANTICS.md` R-NOSOP-6.
 *
 * Ataca la clasificación `E-PARSE-INCOMPLETO` / `W-PARSE` por los bordes: la capa de diagrama,
 * los ids no NCName que ya reescribe `sanitizeIds`, el doble error por una sola causa y el
 * texto normativo, que aquí se compara carácter a carácter contra `docs/SEMANTICS.md`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { parseBpmn } from '../../src/bpmn/parse.js';
import { validate } from '../../src/bpmn/validate.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));

/** Un `bpmn:process` completo alrededor de `body`, sin diagrama. */
function proceso(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="urn:lila:qa">
  <bpmn:process id="Process_1" isExecutable="true">
${body}
  </bpmn:process>
</bpmn:definitions>`;
}

async function validar(xml: string): Promise<ReturnType<typeof validate>> {
  const parsed = await parseBpmn(xml);
  return validate(parsed.ir, { unsupported: parsed.unsupported });
}

/**
 * Modelo intacto (3 nodos, 2 flujos, nada fuera de perfil) cuyo **diagrama** repite el id de una
 * forma. moddle tira la segunda `bpmndi:BPMNShape`; el grafo de tokens no pierde nada.
 */
const DIAGRAMA_CON_ID_DUPLICADO = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs" targetNamespace="urn:lila:qa">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Dia_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Shape_1" bpmnElement="Start_1"><dc:Bounds x="1" y="1" width="36" height="36" /></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Shape_1" bpmnElement="Task_1"><dc:Bounds x="90" y="1" width="90" height="70" /></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

// R-NOSOP-6 solo promueve a error lo que se pierde **del grafo**. La capa de diagrama (DI) es
// geometría: el IR no la lee, así que un id repetido allí no puede volver incompleto el modelo.
test('un id duplicado en el diagrama (DI) es W-PARSE, no E-PARSE-INCOMPLETO (LILA-185)', async () => {
  const { errors, warnings } = await validar(DIAGRAMA_CON_ID_DUPLICADO);

  expect(errors).toEqual([]);
  expect(warnings.filter((w) => w.code === 'W-PARSE')).toMatchObject([{ id: 'Shape_1' }]);
});

// R-NOSOP-6: un `sourceRef` roto pierde el flujo entero, y el parser ya no lo mete al IR; el
// modelo no puede acusar además un flujo colgante que no existe (un error por causa).
test('una referencia rota de topología no duplica el error como flujo colgante (LILA-185)', async () => {
  const { errors } = await validar(
    proceso(`    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Fantasma" targetRef="End_1" />`),
  );

  expect(errors.filter((e) => e.code === 'E-PARSE-INCOMPLETO')).toMatchObject([{ id: 'Flow_1' }]);
  expect(errors.filter((e) => e.code === 'E-FLUJO-COLGANTE')).toEqual([]);
});

// Aceptación de #198: los ids no NCName los reescribe `sanitizeIds` antes de moddle, así que
// nunca son pérdida — ni con dígito inicial, ni con espacio, "/" o ":", ni siendo solo dígitos.
test.each([
  ['dígito inicial', '1inicio', '_1inicio'],
  ['espacio', 'Start 1', 'Start_1'],
  ['barra', 'a/b', 'a_b'],
  ['solo dígitos', '123', '_123'],
  ['dos puntos', 'ns:Start', 'ns_Start'],
])('un id no NCName por %s no pierde elementos (LILA-185)', async (_caso, crudo, saneado) => {
  const xml = proceso(`    <bpmn:startEvent id="${crudo}"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="${crudo}" targetRef="End_1" />`);
  const parsed = await parseBpmn(xml);

  expect(parsed.ir.source.warnings).toEqual([]);
  expect(Object.keys(parsed.ir.nodes)).toEqual([saneado, 'End_1']);
  expect(parsed.ir.source.originalIds[saneado]).toBe(crudo);
  expect(validate(parsed.ir, { unsupported: parsed.unsupported }).errors).toEqual([]);
});

// El mensaje crudo de moddle trae saltos de línea y tabuladores ("detected\n\tline: ..."): la
// CLI imprime una línea por problema, así que no puede sobrevivir ninguno.
test('el aviso de moddle llega aplanado a una sola línea (LILA-185)', async () => {
  const { ir } = await parseBpmn(
    readFileSync(`${repo}packages/engine/test/fixtures/parse-incompleto.bpmn`, 'utf8'),
  );

  expect(ir.source.warnings.length).toBeGreaterThan(0);
  for (const w of ir.source.warnings) expect(w.message).not.toMatch(/\s\s|[\n\t]/);
});

/** Las dos plantillas normativas de R-NOSOP-6, tal como están en el documento. */
function plantillasDeSemantics(): string[] {
  const doc = readFileSync(`${repo}docs/SEMANTICS.md`, 'utf8');
  const desde = doc.indexOf('- **R-NOSOP-6');
  const seccion = doc.slice(desde, doc.indexOf('\n---', desde));
  return [...seccion.matchAll(/^\s*(\{id\}: .*)$/gm)].map((m) => m[1] as string);
}

// El texto de los dos códigos es normativo: si alguien lo cambia en el código sin tocar el
// documento (o al revés), este test lo caza.
test('el texto de E-PARSE-INCOMPLETO y W-PARSE es el de SEMANTICS R-NOSOP-6 (LILA-185)', async () => {
  const [plantillaError, plantillaAviso] = plantillasDeSemantics();
  expect(plantillaError).toBeDefined();
  expect(plantillaAviso).toBeDefined();

  const parsed = await parseBpmn(
    readFileSync(`${repo}packages/engine/test/fixtures/parse-incompleto.bpmn`, 'utf8'),
  );
  const { errors, warnings } = validate(parsed.ir, { unsupported: parsed.unsupported });
  const rellenar = (plantilla: string, id: string, aviso: string): string =>
    plantilla.replace('{id}', id).replace('{aviso}', aviso);

  const error = errors.find((e) => e.code === 'E-PARSE-INCOMPLETO');
  const duplicado = parsed.ir.source.warnings.find((w) => w.message.includes('duplicate ID'));
  expect(error?.message).toBe(
    rellenar(plantillaError as string, 'Task_Revisar', duplicado?.message as string),
  );

  const aviso = warnings.find((w) => w.code === 'W-PARSE');
  const desconocido = parsed.ir.source.warnings.find((w) => w.message.includes('unknown type'));
  expect(aviso?.message).toBe(
    rellenar(plantillaAviso as string, 'Process_Incompleto', desconocido?.message as string),
  );
});
