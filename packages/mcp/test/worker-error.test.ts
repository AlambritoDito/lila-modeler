/**
 * A simulation that fails in its worker (#637, #645): `simulateInWorker` rejects with the worker's
 * message, and `run_simulation` and `compare_scenarios` answer it as `isError`, with the server
 * still serving.
 */
import { fileURLToPath } from 'node:url';

import { loadResolvedScenario } from '@lila-modeler/engine/cli-shared';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const asIs = `${repo}examples/pedido/as-is.scenario.json`;

const failing = vi.hoisted(() => ({ on: false }));
vi.mock('../src/simulate-in-worker.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/simulate-in-worker.js')>();
  return {
    ...original,
    simulateInWorker: (...args: Parameters<typeof original.simulateInWorker>) =>
      failing.on ? Promise.reject(new Error('E-TEST: the worker failed')) : original.simulateInWorker(...args),
  };
});

const { simulateInWorker } = await import('../src/simulate-in-worker.js');
const { createServer } = await import('../src/server.js');

let client: Client;

beforeEach(async () => {
  failing.on = false;
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'worker-error', version: '0' });
  await Promise.all([client.connect(clientTransport), createServer().connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
});

function textOf(result: { content: unknown }): string {
  return (result.content as { text: string }[])[0]?.text ?? '';
}

test('an engine error inside the worker rejects with its message', async () => {
  failing.on = false;
  const scenario = loadResolvedScenario(asIs);
  // An IR with no nodes: `simulate` throws inside the worker, which posts the error back.
  const ir = { nodes: undefined } as unknown as Parameters<typeof simulateInWorker>[0]['ir'];
  const error = await simulateInWorker({ ir, scenario, locale: 'en' }).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(Error);
  // The engine's own message, posted by the worker, not the exit of a worker that died.
  // The engine's TypeError on the missing nodes (V8: «Cannot convert undefined or null to object»).
  expect((error as Error).message).toMatch(/undefined or null/);
});

test('run_simulation and compare_scenarios answer a worker error as isError, and the server keeps serving', async () => {
  failing.on = true;
  const run = (await client.callTool({ name: 'run_simulation', arguments: { scenario: asIs } })) as { isError?: boolean; content: unknown };
  expect(run.isError).toBe(true);
  expect(textOf(run)).toBe('run_simulation: E-TEST: the worker failed');

  const compared = (await client.callTool({ name: 'compare_scenarios', arguments: { scenarios: [asIs, asIs] } })) as { isError?: boolean; content: unknown };
  expect(compared.isError).toBe(true);
  expect(textOf(compared)).toBe('compare_scenarios: E-TEST: the worker failed');

  failing.on = false;
  const ok = (await client.callTool({ name: 'run_simulation', arguments: { scenario: asIs, replications: 1 } })) as { isError?: boolean };
  expect(ok.isError).toBe(false);
}, 60_000);
