/**
 * Cliente MCP del propio SDK contra un transporte in-memory (LILA-053): más rápido y sin
 * procesos que un `StdioClientTransport` de verdad, y ejercita el mismo `McpServer.connect`
 * que usará `bin.ts` sobre stdio.
 */
import { fileURLToPath } from 'node:url';

import { validateBpmnXml } from '@lila/engine/bpmn';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { createServer } from '../src/server.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const pedidoBpmn = `${repo}examples/pedido/model.bpmn`;
const pedidoScenario = `${repo}examples/pedido/as-is.scenario.json`;
const boundaryBpmn = fileURLToPath(
  new URL('../../engine/test/fixtures/boundary-event.bpmn', import.meta.url),
);

let client: Client;

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

  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
  const parsed = JSON.parse(text) as {
    ir: { nodes: Record<string, unknown> };
    errors: unknown[];
    warnings: { code: string }[];
  };
  expect(parsed.errors).toEqual([]);
  expect(parsed.warnings).toMatchObject([{ code: 'W-MSGFLOW' }]);
  expect(Object.keys(parsed.ir.nodes)).toContain('Task_TomarPedido');

  // Mismo objeto que arma la CLI vía `validateBpmnXml`: es la función compartida.
  const { readFileSync } = await import('node:fs');
  const expected = await validateBpmnXml(readFileSync(pedidoBpmn, 'utf8'));
  expect(parsed).toEqual(JSON.parse(JSON.stringify(expected)));
});

test('validate_bpmn con xml inline funciona igual que con path', async () => {
  const { readFileSync } = await import('node:fs');
  const xml = readFileSync(pedidoBpmn, 'utf8');
  const result = await client.callTool({ name: 'validate_bpmn', arguments: { xml } });
  expect(result.isError).toBe(false);
});

test('validate_bpmn sobre un modelo con boundary event: errores estructurados, isError true', async () => {
  const result = await client.callTool({ name: 'validate_bpmn', arguments: { path: boundaryBpmn } });
  expect(result.isError).toBe(true);

  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
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

  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
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

  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
  const parsed = JSON.parse(text) as { resumen: string };
  expect(parsed.resumen).toContain('Task_TomarPedido: cajero x1');
});
