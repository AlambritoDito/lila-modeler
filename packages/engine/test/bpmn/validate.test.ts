import { readFileSync, readdirSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseBpmn } from '../../src/bpmn/parse.js';
import { validate } from '../../src/bpmn/validate.js';
import type { ProcessIR } from '../../src/core/ir.js';
import { UNSUPPORTED_FIXTURES, WARNINGS_FIXTURE } from './unsupported.fixtures.js';

function read(url: URL): string {
  return readFileSync(url, 'utf8');
}

function fixture(name: string): string {
  return read(new URL(`../fixtures/${name}`, import.meta.url));
}

/** IR mínimo al que añadirle nodos y flujos en cada caso. */
function ir(partial: Partial<ProcessIR> = {}): ProcessIR {
  return {
    id: 'Process_1',
    name: '',
    nodes: {},
    flows: {},
    source: { exporter: '', exporterVersion: '', originalIds: {}, warnings: [] },
    ...partial,
  };
}

// Aceptación LILA-021: un .bpmn con un boundary event produce error explícito.
test('un boundary event produce E-NOSOP con el texto literal de SEMANTICS § 3', async () => {
  const { ir: parsed, unsupported } = await parseBpmn(fixture('boundary-event.bpmn'));
  const { errors, warnings } = validate(parsed, { unsupported });

  expect(errors.filter((e) => e.code === 'E-NOSOP')).toEqual([
    {
      code: 'E-NOSOP',
      id: 'Boundary_3a1f',
      message:
        'Boundary_3a1f (bpmn:boundaryEvent, "Vence el plazo"): evento adjunto a actividad (boundary event) no soportado por el simulador.',
    },
  ]);

  // El sequence flow que salía del boundary se descarta con él: no genera un E-NOSOP propio.
  expect(errors.filter((e) => e.id === 'Flow_Boundary_Cancelar')).toEqual([]);

  // La rama de cancelación se queda sin entrada (R-NOSOP-5).
  expect(errors.filter((e) => e.code === 'E-INALCANZABLE').map((e) => e.id).sort()).toEqual([
    'End_Cancelado',
    'Task_Cancelar',
  ]);

  expect(warnings).toEqual([]);
});

// Aceptación LILA-021: examples/pedido produce 0 errores.
test('examples/pedido/model.bpmn no produce ningún error', async () => {
  const xml = read(new URL('../../../../examples/pedido/model.bpmn', import.meta.url));
  const { ir: parsed, unsupported } = await parseBpmn(xml);

  expect(validate(parsed, { unsupported }).errors).toEqual([]);
});

test('los exports de Bizagi pasan por validate sin lanzar excepción', async () => {
  const dir = new URL('../../../../examples/bizagi-exports/', import.meta.url);
  const names = readdirSync(dir).filter((name) => name.endsWith('.bpmn'));
  expect(names).toHaveLength(7);

  for (const name of names) {
    const { ir: parsed, unsupported } = await parseBpmn(read(new URL(name, dir)));
    const result = validate(parsed, { unsupported });
    // Pueden tener errores de validación (usan construcciones fuera de perfil); lo que no pueden
    // es reventar, y todo problema cita el id de un elemento.
    expect(Array.isArray(result.errors)).toBe(true);
    for (const problem of result.errors) expect(problem.id).not.toBe('');
    // Aceptación LILA-185: los ids no NCName pasan por `sanitizeIds` y no pierden elementos; los
    // avisos que sí emite moddle en estos exports (messageRef, dataStoreRef, categoryValueRef,
    // `unknown type <bpmn:LoopCounter>`) son inofensivos y se quedan en W-PARSE.
    expect(
      result.errors.filter((problem) => problem.code === 'E-PARSE-INCOMPLETO'),
      name,
    ).toEqual([]);
  }
});

test('el proceso sin start, sin end y con gateway suelto acumula todos los errores en una pasada', () => {
  const problems = validate(
    ir({
      nodes: {
        Gateway_1: { type: 'xor', name: '', incoming: [], outgoing: ['Flow_1'] },
        Task_1: { type: 'task', name: '', incoming: ['Flow_1'], outgoing: [] },
      },
      flows: { Flow_1: { from: 'Gateway_1', to: 'Task_1', name: '', isDefault: false } },
    }),
  ).errors;

  expect(problems.map((p) => p.code)).toEqual([
    'E-GATEWAY-SIN-ARISTAS',
    'E-SIN-START',
    'E-SIN-END',
  ]);
});

test('un nodo desconectado de todo start es E-INALCANZABLE', () => {
  const problems = validate(
    ir({
      nodes: {
        Start_1: { type: 'start', name: '', incoming: [], outgoing: ['Flow_1'] },
        End_1: { type: 'end', name: '', incoming: ['Flow_1'], outgoing: [] },
        Task_Huerfana: { type: 'task', name: '', incoming: [], outgoing: [] },
      },
      flows: { Flow_1: { from: 'Start_1', to: 'End_1', name: '', isDefault: false } },
    }),
  ).errors;

  expect(problems).toEqual([
    {
      code: 'E-INALCANZABLE',
      id: 'Task_Huerfana',
      message: 'Task_Huerfana: el nodo no es alcanzable desde ningún evento de inicio.',
    },
  ]);
});

test('los elementos que el perfil sí admite pero no son nodos no producen error', () => {
  const { errors } = validate(ir(), {
    unsupported: [
      { id: 'DataObject_1', qname: 'bpmn:DataObject', name: 'Pedido' },
      { id: 'Annotation_1', qname: 'bpmn:TextAnnotation', name: '' },
      { id: 'Association_1', qname: 'bpmn:Association', name: '' },
    ],
  });

  expect(errors.filter((e) => e.code === 'E-NOSOP')).toEqual([]);
});

test('sin nombre, el mensaje de E-NOSOP usa la plantilla corta', () => {
  const { errors } = validate(ir(), {
    unsupported: [{ id: 'Gateway_9', qname: 'bpmn:ComplexGateway', name: '' }],
  });

  expect(errors[0]?.message).toBe(
    'Gateway_9 (bpmn:complexGateway): gateway complejo no soportado por el simulador.',
  );
});

test('cada fila de SEMANTICS § 3 produce el texto normativo exacto (LILA-163)', async () => {
  expect(UNSUPPORTED_FIXTURES).toHaveLength(24);

  for (const fixtureCase of UNSUPPORTED_FIXTURES) {
    const parsed = await parseBpmn(fixtureCase.xml);
    const errors = validate(parsed.ir, { unsupported: parsed.unsupported }).errors
      .filter((error) => error.code === 'E-NOSOP')
      .map((error) => error.message);
    expect(errors, fixtureCase.row).toEqual(fixtureCase.messages);
  }
});

test('W-MSGFLOW agrega el conteo y W-COND cita cada flujo condicionado (LILA-163)', async () => {
  const parsed = await parseBpmn(WARNINGS_FIXTURE);
  const { warnings } = validate(parsed.ir, {
    unsupported: parsed.unsupported,
    messageFlowCount: parsed.messageFlowCount,
    conditionFlowIds: parsed.conditionFlowIds,
  });

  expect(warnings).toEqual([
    {
      code: 'W-MSGFLOW',
      id: 'Process_1',
      message: 'Process_1: se ignoraron 2 flujos de mensaje (bpmn:messageFlow).',
    },
    {
      code: 'W-COND',
      id: 'Flow_Condition',
      message: 'Flow_Condition: conditionExpression se ignora; el ramaje es probabilístico.',
    },
  ]);
});

// Aceptación LILA-185: un export que pierde elementos al cargarse no puede validar en verde.
test('parseBpmn conserva los avisos de bpmn-moddle en ir.source.warnings (LILA-185)', async () => {
  const parsed = await parseBpmn(fixture('parse-incompleto.bpmn'));

  // `processId` (LILA-196) ubica el aviso en su `bpmn:process`: los dos son del que se simula.
  expect(parsed.ir.source.warnings).toEqual([
    {
      message: expect.stringContaining('unknown type <bpmn:LoopCounter>') as unknown as string,
      processId: 'Process_Incompleto',
    },
    {
      message: expect.stringContaining('duplicate ID <Task_Revisar>') as unknown as string,
      elementId: 'Task_Revisar',
      processId: 'Process_Incompleto',
    },
  ]);
  // El elemento que moddle tiró no está en el IR: el archivo declara dos tareas, el IR trae una.
  expect(Object.values(parsed.ir.nodes).filter((node) => node.type === 'task')).toHaveLength(1);
});

test('un id duplicado produce E-PARSE-INCOMPLETO con el texto de SEMANTICS R-NOSOP-6 (LILA-185)', async () => {
  const parsed = await parseBpmn(fixture('parse-incompleto.bpmn'));
  const { errors, warnings } = validate(parsed.ir, { unsupported: parsed.unsupported });

  const parseErrors = errors.filter((error) => error.code === 'E-PARSE-INCOMPLETO');
  expect(parseErrors).toHaveLength(1);
  expect(parseErrors[0]?.id).toBe('Task_Revisar');
  expect(parseErrors[0]?.message).toMatch(
    /^Task_Revisar: el lector XML descartó contenido del modelo, que quedó incompleto: unparsable content <bpmn:task> detected .* duplicate ID <Task_Revisar>\.$/,
  );

  // El `unknown type` de Bizagi no descarta ningún nodo: se queda en aviso.
  const parseWarnings = warnings.filter((warning) => warning.code === 'W-PARSE');
  expect(parseWarnings).toHaveLength(1);
  expect(parseWarnings[0]?.id).toBe('Process_Incompleto');
  expect(parseWarnings[0]?.message).toMatch(
    /^Process_Incompleto: aviso del lector XML, sin pérdida de nodos ni flujos: unparsable content <bpmn:LoopCounter> detected .* unknown type <bpmn:LoopCounter>\.$/,
  );
});

test('una referencia rota de topología es error y una de mensaje solo aviso (LILA-185)', () => {
  const base = ir({
    nodes: { Start_1: { type: 'start', name: '', incoming: [], outgoing: [] } },
    source: {
      exporter: '',
      exporterVersion: '',
      originalIds: {},
      warnings: [
        { message: 'unresolved reference <Task_X>', elementId: 'Flow_1', property: 'bpmn:targetRef' },
        { message: 'unresolved reference <Message_1>', elementId: 'Event_1', property: 'bpmn:messageRef' },
      ],
    },
  });
  const { errors, warnings } = validate(base);

  expect(errors.filter((error) => error.code === 'E-PARSE-INCOMPLETO')).toEqual([
    {
      code: 'E-PARSE-INCOMPLETO',
      id: 'Flow_1',
      message:
        'Flow_1: el lector XML descartó contenido del modelo, que quedó incompleto: unresolved reference <Task_X>.',
    },
  ]);
  expect(warnings.filter((warning) => warning.code === 'W-PARSE')).toEqual([
    {
      code: 'W-PARSE',
      id: 'Event_1',
      message:
        'Event_1: aviso del lector XML, sin pérdida de nodos ni flujos: unresolved reference <Message_1>.',
    },
  ]);
});
