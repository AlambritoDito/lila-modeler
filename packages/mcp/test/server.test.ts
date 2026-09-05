/**
 * Cliente MCP del propio SDK contra un transporte in-memory (LILA-053): más rápido y sin
 * procesos que un `StdioClientTransport` de verdad, y ejercita el mismo `McpServer.connect`
 * que usará `bin.ts` sobre stdio.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBpmnXml } from '@lila/engine/bpmn';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { createServer } from '../src/server.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const pedidoBpmn = `${repo}examples/pedido/model.bpmn`;
const pedidoScenario = `${repo}examples/pedido/as-is.scenario.json`;
const toBeScenario = `${repo}examples/pedido/to-be-3-cajeros.scenario.json`;
const boundaryBpmn = fileURLToPath(
  new URL('../../engine/test/fixtures/boundary-event.bpmn', import.meta.url),
);
const subprocesoBpmn = fileURLToPath(
  new URL('../../engine/test/fixtures/subproceso-and.bpmn', import.meta.url),
);
const lanesBpmn = fileURLToPath(new URL('./fixtures/lanes.bpmn', import.meta.url));

let client: Client;

/** Texto del único bloque de contenido que devuelven las dos tools. */
function textOf(result: { content: unknown }): string {
  return (result.content as { type: string; text: string }[])[0]?.text ?? '';
}

beforeEach(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
});

test('listTools devuelve validate_bpmn y describe_process', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  expect(names).toEqual(['describe_process', 'validate_bpmn']);
});

test('validate_bpmn sobre examples/pedido: 0 errores, mismo JSON que la CLI', async () => {
  const result = await client.callTool({ name: 'validate_bpmn', arguments: { path: pedidoBpmn } });
  expect(result.isError).toBe(false);

  const text = textOf(result);
  const parsed = JSON.parse(text) as {
    ir: { nodes: Record<string, unknown> };
    errors: unknown[];
    warnings: { code: string }[];
  };
  expect(parsed.errors).toEqual([]);
  expect(parsed.warnings).toMatchObject([{ code: 'W-MSGFLOW' }]);
  expect(Object.keys(parsed.ir.nodes)).toContain('Task_TomarPedido');

  // Mismo objeto que arma la CLI vía `validateBpmnXml`: es la función compartida.
  const expected = await validateBpmnXml(readFileSync(pedidoBpmn, 'utf8'));
  expect(parsed).toEqual(JSON.parse(JSON.stringify(expected)));
});

test('validate_bpmn con xml inline funciona igual que con path', async () => {
  const xml = readFileSync(pedidoBpmn, 'utf8');
  const result = await client.callTool({ name: 'validate_bpmn', arguments: { xml } });
  expect(result.isError).toBe(false);
});

test('validate_bpmn sobre un modelo con boundary event: errores estructurados, isError false', async () => {
  // isError marca que falló la *tool*, no que el modelo esté mal: un modelo fuera del perfil es
  // un resultado correcto, con sus errores en el JSON (ver docs/MCP.md).
  const result = await client.callTool({ name: 'validate_bpmn', arguments: { path: boundaryBpmn } });
  expect(result.isError).toBe(false);

  const text = textOf(result);
  const parsed = JSON.parse(text) as { errors: { code: string; message: string }[] };
  expect(parsed.errors.length).toBeGreaterThan(0);
  expect(parsed.errors.some((error) => error.code === 'E-NOSOP')).toBe(true);
});

test('validate_bpmn sin path ni xml: isError true, no lanza', async () => {
  const result = await client.callTool({ name: 'validate_bpmn', arguments: {} });
  expect(result.isError).toBe(true);
});

test('describe_process sobre examples/pedido: IR con los nodos esperados', async () => {
  const result = await client.callTool({ name: 'describe_process', arguments: { path: pedidoBpmn } });
  expect(result.isError).toBe(false);

  const text = textOf(result);
  const parsed = JSON.parse(text) as { ir: { nodes: Record<string, unknown> }; resumen: string };
  expect(Object.keys(parsed.ir.nodes)).toContain('Task_TomarPedido');
  expect(parsed.resumen).toContain('gateway XOR');
});

test('describe_process con scenario agrega los recursos referenciados', async () => {
  const result = await client.callTool({
    name: 'describe_process',
    arguments: { path: pedidoBpmn, scenario: pedidoScenario },
  });
  expect(result.isError).toBe(false);

  const text = textOf(result);
  const parsed = JSON.parse(text) as { resumen: string };
  expect(parsed.resumen).toContain('Task_TomarPedido: cajero x1');
});

test('validate_bpmn con path y xml a la vez: error explícito, no se ignora uno en silencio', async () => {
  const result = await client.callTool({
    name: 'validate_bpmn',
    arguments: { path: pedidoBpmn, xml: '<x/>' },
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('no los dos');
});

test('validate_bpmn con una ruta inexistente: isError, y el servidor sigue respondiendo', async () => {
  const missing = await client.callTool({ name: 'validate_bpmn', arguments: { path: '/no/existe.bpmn' } });
  expect(missing.isError).toBe(true);
  expect(textOf(missing)).toContain('no existe el archivo');

  const ok = await client.callTool({ name: 'validate_bpmn', arguments: { path: pedidoBpmn } });
  expect(ok.isError).toBe(false);
});

test('validate_bpmn con XML malformado: isError, y el servidor sigue respondiendo', async () => {
  const broken = await client.callTool({ name: 'validate_bpmn', arguments: { xml: '<no cierra' } });
  expect(broken.isError).toBe(true);
  expect(textOf(broken)).toContain('validate_bpmn:');

  const ok = await client.callTool({ name: 'validate_bpmn', arguments: { path: pedidoBpmn } });
  expect(ok.isError).toBe(false);
});

test('validate_bpmn con un directorio por ruta: isError con el prefijo de la tool', async () => {
  const result = await client.callTool({
    name: 'validate_bpmn',
    arguments: { path: fileURLToPath(new URL('../../../examples', import.meta.url)) },
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toMatch(/^validate_bpmn: /);
});

test('describe_process avisa de los errores de validación en vez de describir y callar', async () => {
  const result = await client.callTool({ name: 'describe_process', arguments: { path: boundaryBpmn } });
  expect(result.isError).toBe(false);

  const { resumen } = JSON.parse(textOf(result)) as { resumen: string };
  expect(resumen).toContain('Validación: 3 errores, 0 avisos.');
  expect(resumen).toContain('NO se puede simular');
});

test('describe_process lista los otros procesos del archivo, no simulados', async () => {
  const result = await client.callTool({ name: 'describe_process', arguments: { path: pedidoBpmn } });
  const { resumen } = JSON.parse(textOf(result)) as { resumen: string };
  expect(resumen).toContain('Otros procesos del archivo, no simulados: Process_Cliente');
  expect(resumen).toContain('Validación: 0 errores, 1 aviso.');
});

test('describe_process agrupa por lane y por subproceso embebido', async () => {
  const lanes = await client.callTool({ name: 'describe_process', arguments: { path: lanesBpmn } });
  expect((JSON.parse(textOf(lanes)) as { resumen: string }).resumen).toContain('Cajero: StartEvent_1, Task_A');

  const sub = await client.callTool({ name: 'describe_process', arguments: { path: subprocesoBpmn } });
  expect((JSON.parse(textOf(sub)) as { resumen: string }).resumen).toContain(
    'SubProcess_Preparacion: Gateway_Fork, Task_A, Task_B, Gateway_Join',
  );
});

test('describe_process con un escenario inválido: no falla, pero dice por qué en legible', async () => {
  const bad = join(tmpdir(), `lila-mcp-qa-${process.pid}.scenario.json`);
  writeFileSync(bad, JSON.stringify({ version: 1, name: 'malo', run: { duration: 'no soy número' } }));
  try {
    const result = await client.callTool({
      name: 'describe_process',
      arguments: { path: pedidoBpmn, scenario: bad },
    });
    expect(result.isError).toBe(false);
    const { resumen } = JSON.parse(textOf(result)) as { resumen: string };
    expect(resumen).toContain('no se pudo leer el escenario');
    expect(resumen).toContain('run.duration');
    expect(resumen).not.toContain('sin escenario');
  } finally {
    rmSync(bad, { force: true });
  }
});

test('describe_process con un escenario inexistente: lo dice y sigue describiendo el modelo', async () => {
  const result = await client.callTool({
    name: 'describe_process',
    arguments: { path: pedidoBpmn, scenario: '/no/existe.json' },
  });
  expect(result.isError).toBe(false);
  const { resumen } = JSON.parse(textOf(result)) as { resumen: string };
  expect(resumen).toContain('no se pudo leer el escenario');
  expect(resumen).toContain('Proceso Process_Restaurante');
});

test('describe_process con `extends` resuelve el escenario padre', async () => {
  const result = await client.callTool({
    name: 'describe_process',
    arguments: { path: pedidoBpmn, scenario: toBeScenario },
  });
  const { resumen } = JSON.parse(textOf(result)) as { resumen: string };
  expect(resumen).toContain('Task_TomarPedido: cajero x1');
});

test('llamadas concurrentes: todas responden y ninguna se pisa con otra', async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      client.callTool({
        name: i % 2 === 0 ? 'validate_bpmn' : 'describe_process',
        arguments: { path: pedidoBpmn },
      }),
    ),
  );
  expect(results.every((result) => result.isError === false)).toBe(true);
});
