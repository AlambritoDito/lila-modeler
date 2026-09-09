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
  return validate(parsed.ir, { unsupported: parsed.unsupported, locale: 'es' });
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
  expect(validate(parsed.ir, { unsupported: parsed.unsupported, locale: 'es' }).errors).toEqual([]);
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

/**
 * Las plantillas normativas de R-NOSOP-6, tal como están en el documento y en su orden. Desde
 * LILA-211 cada una aparece dos veces, primero en `en` y después en `es`; este archivo valida con
 * `locale: 'es'`, así que se queda con las impares. La guarda de longitud es para que ganar o
 * perder una plantilla falle diciendo qué pasó, no con el diff opaco de una desestructuración por
 * posición.
 */
function plantillasDeSemantics(): string[] {
  const doc = readFileSync(`${repo}docs/SEMANTICS.md`, 'utf8');
  const desde = doc.indexOf('- **R-NOSOP-6');
  const seccion = doc.slice(desde, doc.indexOf('\n---', desde));
  const ambos = [...seccion.matchAll(/^\s*(\{id\}: .*)$/gm)].map((m) => m[1] as string);
  expect(ambos, 'R-NOSOP-6 tiene 5 textos normativos por idioma en docs/SEMANTICS.md').toHaveLength(
    10,
  );
  return ambos.filter((_, index) => index % 2 === 1);
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
  const { errors, warnings } = validate(parsed.ir, { unsupported: parsed.unsupported, locale: 'es' });
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

/**
 * Casos de LILA-196: la clasificación es por lo que se pierde **del proceso simulado**, y cada
 * aviso dice la verdad sobre lo que pasó. Las plantillas salen del propio documento, así que un
 * cambio de texto en uno solo de los dos lados rompe el test.
 */
const [, PLANTILLA_INOFENSIVA, PLANTILLA_FLUJO_AUSENTE, PLANTILLA_OTRO_PROCESO, PLANTILLA_DEFAULT] =
  plantillasDeSemantics();

/** Rellena una plantilla de R-NOSOP-6 con el id, el aviso de moddle y (si toca) el proceso. */
function rellenar(plantilla: string, id: string, aviso: string, proceso = ''): string {
  return plantilla.replace('{id}', id).replace('{proceso}', proceso).replace('{aviso}', aviso);
}

// (A) Dos `bpmn:dataObject` con el mismo id: el perfil de la sección 2 los lee y no los simula,
// así que moddle tirando el segundo no deja el grafo incompleto y no puede abortar la corrida.
test('un id duplicado entre elementos que el perfil no simula no es error (LILA-196)', async () => {
  const xml = proceso(`    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="End_1" />
    <bpmn:dataObject id="Datos_1" />
    <bpmn:dataObject id="Datos_1" />`);
  const parsed = await parseBpmn(xml);
  const { errors, warnings } = validate(parsed.ir, { unsupported: parsed.unsupported, locale: 'es' });

  expect(errors).toEqual([]);
  expect(warnings).toEqual([
    {
      code: 'W-PARSE',
      id: 'Datos_1',
      message: rellenar(
        PLANTILLA_INOFENSIVA as string,
        'Datos_1',
        parsed.ir.source.warnings[0]?.message as string,
      ),
    },
  ]);
});

// (B) `bpmn:incoming`/`bpmn:outgoing` sin resolver: el elemento nombra un flujo que no está en el
// modelo cargado. Decir "sin pérdida de nodos ni flujos" sería mentira cuando ese flujo se perdió,
// así que el aviso describe lo que de verdad pasa.
test('una referencia rota en bpmn:incoming avisa del flujo ausente (LILA-196)', async () => {
  const xml = proceso(`    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:incoming>Flow_9</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />`);
  const parsed = await parseBpmn(xml);
  const { errors, warnings } = validate(parsed.ir, { unsupported: parsed.unsupported, locale: 'es' });

  expect(errors).toEqual([]);
  expect(warnings).toEqual([
    {
      code: 'W-PARSE',
      id: 'Task_1',
      message: rellenar(
        PLANTILLA_FLUJO_AUSENTE as string,
        'Task_1',
        parsed.ir.source.warnings[0]?.message as string,
      ),
    },
  ]);
  expect(parsed.ir.nodes.Task_1?.incoming).toEqual(['Flow_1']);
});

// (C) `bpmn:default` roto: no se descarta nada, solo se pierde la marca `isDefault`, y § 6
// (R-XOR-1/R-XOR-2) reparte igual sin ella. Aviso propio, no error.
test('un bpmn:default hacia un flujo inexistente emite W-XOR-DEFAULT-ROTO (LILA-196)', async () => {
  const xml = proceso(`    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="Gw_1" default="Flow_Fantasma"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Gw_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Gw_1" targetRef="End_1" />`);
  const parsed = await parseBpmn(xml);
  const { errors, warnings } = validate(parsed.ir, { unsupported: parsed.unsupported, locale: 'es' });

  expect(errors).toEqual([]);
  expect(warnings).toEqual([
    {
      code: 'W-XOR-DEFAULT-ROTO',
      id: 'Gw_1',
      message: rellenar(
        PLANTILLA_DEFAULT as string,
        'Gw_1',
        parsed.ir.source.warnings[0]?.message as string,
      ),
    },
  ]);
  expect(parsed.ir.flows.Flow_2?.isDefault).toBe(false);
});

// (E) Los avisos son del archivo entero y el IR es de un solo proceso: un id duplicado dentro de
// un pool que Lila no simula no puede bloquear al que sí, y el aviso dice de dónde viene.
test('un id duplicado en un proceso que Lila no simula no aborta y cita el proceso (LILA-196)', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="urn:lila:qa">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="End_1" />
  </bpmn:process>
  <bpmn:process id="Process_2">
    <bpmn:task id="Tarea_Otra" />
    <bpmn:task id="Tarea_Otra" />
  </bpmn:process>
</bpmn:definitions>`;
  const parsed = await parseBpmn(xml);
  const { errors, warnings } = validate(parsed.ir, { unsupported: parsed.unsupported, locale: 'es' });

  expect(parsed.ir.id).toBe('Process_1');
  expect(parsed.ignoredProcessIds).toEqual(['Process_2']);
  expect(errors).toEqual([]);
  expect(warnings).toEqual([
    {
      code: 'W-PARSE',
      id: 'Tarea_Otra',
      message: rellenar(
        PLANTILLA_OTRO_PROCESO as string,
        'Tarea_Otra',
        parsed.ir.source.warnings[0]?.message as string,
        'Process_2',
      ),
    },
  ]);
});

/**
 * Segunda vuelta del QA (#249): la clasificación no puede depender de cómo esté formateado el
 * XML. Los exports minificados vienen en una sola línea, los atributos del `<bpmn:process>` se
 * parten donde sea, las comillas simples son XML válido y un `</bpmn:process><bpmn:process …>`
 * cabe en la misma línea. En todas esas formas el aviso tiene que caer en el mismo proceso.
 */

/** Dos pools: `Process_Otro`, que Lila ignora, y `Process_Sim`, el que simula. */
function dosProcesos(
  opts: {
    enOtro?: string;
    enSim?: string;
    aperturaOtro?: string;
    simuladoPrimero?: boolean;
    mismaLinea?: boolean;
  } = {},
): string {
  const otro = `<bpmn:process${opts.aperturaOtro ?? ' id="Process_Otro"'}>
    <bpmn:task id="Tarea_Otra" />
${opts.enOtro ?? ''}  </bpmn:process>`;
  const sim = `<bpmn:process id="Process_Sim" isExecutable="true">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_A"><bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing></bpmn:task>
    <bpmn:task id="Task_B"><bpmn:incoming>Flow_2</bpmn:incoming><bpmn:outgoing>Flow_4</bpmn:outgoing></bpmn:task>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_A" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_A" targetRef="Task_B" />
    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_B" targetRef="End_1" />
${opts.enSim ?? ''}  </bpmn:process>`;
  const orden = opts.simuladoPrimero === true ? [sim, otro] : [otro, sim];
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="urn:lila:qa">
  ${orden.join(opts.mismaLinea === true ? '' : '\n  ')}
</bpmn:definitions>`;
}

/** El mismo archivo en una sola línea, como lo dejan los exports minificados. */
function minificar(xml: string): string {
  return xml.replace(/\n\s*/g, '');
}

/** Un `bpmn:sequenceFlow` que repite el id de otro: moddle tira el segundo y se pierde el flujo. */
const FLUJO_DUPLICADO =
  '    <bpmn:sequenceFlow id="Flow_4" sourceRef="Task_A" targetRef="End_1" />\n';

/** Una `bpmn:task` que repite el id de la que ya trae el pool ignorado. */
const TAREA_DUPLICADA = '    <bpmn:task id="Tarea_Otra" />\n';

/** Apertura del pool ignorado con los atributos partidos en varias líneas (XML válido). */
const APERTURA_MULTILINEA = '\n    id="Process_Otro"\n    name="Otro pool"\n  ';

// El falso negativo que devolvió el PR #249: con el archivo en una sola línea, el mapeo por
// número de línea atribuía TODO al primer `<process>` del archivo, así que una pérdida real en el
// proceso simulado salía como "aviso de otro proceso" y `lila validate` terminaba en verde.
test.each([
  ['indentado', (xml: string) => xml],
  ['minificado', minificar],
])('un flujo perdido del proceso simulado aborta con el XML %s (LILA-196)', async (_caso, forma) => {
  const parsed = await parseBpmn(forma(dosProcesos({ enSim: FLUJO_DUPLICADO })));
  const { errors } = validate(parsed.ir, { unsupported: parsed.unsupported, locale: 'es' });

  expect(parsed.ir.id).toBe('Process_Sim');
  expect(errors.filter((e) => e.code === 'E-PARSE-INCOMPLETO')).toMatchObject([{ id: 'Flow_4' }]);
});

/**
 * Tercera vuelta del QA (#249): el barrido de tramos no puede fiarse de cualquier texto que
 * parezca un `<…:process>`. Un comentario, un CDATA o un elemento `process` de un espacio de
 * nombres ajeno **dentro** del proceso simulado partían el tramo en dos, y la pérdida real que
 * venía detrás salía como “aviso de otro proceso” con `lila validate` en verde.
 */
test.each([
  ['un comentario con un <bpmn:process> dentro', '    <!-- <bpmn:process id="Falso"> -->\n'],
  [
    'un CDATA con un <bpmn:process> dentro',
    '    <bpmn:documentation><![CDATA[<bpmn:process id="Falso">]]></bpmn:documentation>\n',
  ],
  [
    'un <x:process> de un espacio de nombres ajeno',
    '    <bpmn:extensionElements xmlns:x="urn:lila:x"><x:process id="Falso"><x:dato /></x:process></bpmn:extensionElements>\n',
  ],
  [
    'un <x:process /> ajeno autocerrado',
    '    <bpmn:extensionElements xmlns:x="urn:lila:x"><x:process id="Falso" /></bpmn:extensionElements>\n',
  ],
])(
  '%s no despista al localizador: la pérdida del simulado sigue abortando (LILA-196)',
  async (_caso, ruido) => {
    const parsed = await parseBpmn(dosProcesos({ enSim: `${ruido}${FLUJO_DUPLICADO}` }));
    const { errors } = validate(parsed.ir, { unsupported: parsed.unsupported, locale: 'es' });

    expect(parsed.ir.id).toBe('Process_Sim');
    expect(errors.filter((e) => e.code === 'E-PARSE-INCOMPLETO')).toMatchObject([{ id: 'Flow_4' }]);
  },
);

// (E), en todas las formas de XML que el QA probó: el duplicado vive en el pool que Lila no
// simula, así que nunca puede abortar la corrida del que sí, y el aviso nombra el pool.
test.each([
  ['indentado', dosProcesos({ enOtro: TAREA_DUPLICADA })],
  ['minificado', minificar(dosProcesos({ enOtro: TAREA_DUPLICADA }))],
  [
    'minificado con el proceso simulado primero',
    minificar(dosProcesos({ enOtro: TAREA_DUPLICADA, simuladoPrimero: true })),
  ],
  [
    'con los atributos del proceso en varias líneas',
    dosProcesos({ enOtro: TAREA_DUPLICADA, aperturaOtro: APERTURA_MULTILINEA }),
  ],
  [
    'con el id del proceso entre comillas simples',
    dosProcesos({ enOtro: TAREA_DUPLICADA, aperturaOtro: " id='Process_Otro'" }),
  ],
  [
    'con los dos procesos en la misma línea',
    dosProcesos({ enOtro: TAREA_DUPLICADA, simuladoPrimero: true, mismaLinea: true }),
  ],
])(
  'un id duplicado del pool ignorado no aborta y cita el pool, %s (LILA-196)',
  async (_caso, xml) => {
    const parsed = await parseBpmn(xml);
    const { errors, warnings } = validate(parsed.ir, { unsupported: parsed.unsupported, locale: 'es' });

    expect(parsed.ir.id).toBe('Process_Sim');
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      {
        code: 'W-PARSE',
        id: 'Tarea_Otra',
        message: rellenar(
          PLANTILLA_OTRO_PROCESO as string,
          'Tarea_Otra',
          parsed.ir.source.warnings[0]?.message as string,
          'Process_Otro',
        ),
      },
    ]);
  },
);

// (A) sin lista blanca: un id duplicado a nivel raíz no está dentro de ningún `bpmn:process`, así
// que no puede ser nodo ni flujo del proceso simulado por mucho que el tipo no salga en la lista.
test.each([
  ['bpmn:message', '<bpmn:message id="Raiz_1" /><bpmn:message id="Raiz_1" />'],
  ['bpmn:signal', '<bpmn:signal id="Raiz_1" /><bpmn:signal id="Raiz_1" />'],
  ['bpmn:error', '<bpmn:error id="Raiz_1" /><bpmn:error id="Raiz_1" />'],
  ['bpmn:category', '<bpmn:category id="Raiz_1" /><bpmn:category id="Raiz_1" />'],
  [
    'bpmn:participant',
    '<bpmn:collaboration id="Collab_1"><bpmn:participant id="Raiz_1" processRef="Process_1" /><bpmn:participant id="Raiz_1" processRef="Process_1" /></bpmn:collaboration>',
  ],
])('un id duplicado en %s de raíz no deja incompleto el proceso (LILA-196)', async (_caso, raiz) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs" targetNamespace="urn:lila:qa">
  ${raiz}
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_1</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>`;
  const parsed = await parseBpmn(xml);
  const { errors, warnings } = validate(parsed.ir, { unsupported: parsed.unsupported, locale: 'es' });

  expect(errors.filter((e) => e.code === 'E-PARSE-INCOMPLETO')).toEqual([]);
  expect(warnings.filter((w) => w.code === 'W-PARSE')).toEqual([
    {
      code: 'W-PARSE',
      id: 'Raiz_1',
      message: rellenar(
        PLANTILLA_INOFENSIVA as string,
        'Raiz_1',
        parsed.ir.source.warnings.find((w) => w.message.includes('duplicate ID'))
          ?.message as string,
      ),
    },
  ]);
});
