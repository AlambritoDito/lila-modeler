/**
 * #700 (ADR-033 § 3) — the MCP tools accept a task with a standard loop marker: `validate_bpmn`
 * finds no error and `run_simulation` repeats it as the scenario's `loop` says.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterAll, beforeAll, expect, test } from 'vitest';

import { createServer } from '../src/server.js';

const MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_Loop" isExecutable="true">
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="Flow_In" sourceRef="Start" targetRef="Task_Review" />
    <bpmn:task id="Task_Review"><bpmn:standardLoopCharacteristics /></bpmn:task>
    <bpmn:sequenceFlow id="Flow_Out" sourceRef="Task_Review" targetRef="End" />
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`;

let client: Client;
let dir: string;

async function call(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
  const result = await client.callTool({ name, arguments: args });
  return { isError: result.isError === true, text: (result.content as { text: string }[])[0]?.text ?? '' };
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lila-mcp-700-'));
  writeFileSync(join(dir, 'model.bpmn'), MODEL, 'utf8');
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-700', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterAll(async () => {
  await client.close();
  rmSync(dir, { recursive: true, force: true });
});

test('validate_bpmn accepts the loop marker on a task', async () => {
  const validated = await call('validate_bpmn', { path: join(dir, 'model.bpmn') });
  expect(validated.isError, validated.text).toBe(false);
  const report = JSON.parse(validated.text) as { errors: unknown[]; ir: { nodes: Record<string, { loop?: unknown }> } };
  expect(report.errors).toEqual([]);
  expect(report.ir.nodes.Task_Review?.loop).toEqual({});
});

test('run_simulation runs the iterations the scenario declares', async () => {
  const scenario = {
    version: 1,
    name: 'Loop',
    model: join(dir, 'model.bpmn'),
    run: { start: '2026-09-07T08:00:00-06:00', seed: 1 },
    elements: {
      Start: { triggerCount: 2 },
      Task_Review: { processingTime: { type: 'constant', value: 60 }, loop: { count: 3 } },
    },
  };
  const run = await call('run_simulation', { scenario, detail: 'full' });
  expect(run.isError, run.text).toBe(false);
  const result = JSON.parse(run.text) as {
    elements: Record<string, { started: number; completed: number }>;
    flows: Record<string, { count: number }>;
  };
  expect(result.elements.Task_Review).toMatchObject({ started: 6, completed: 6 });
  expect(result.flows.Flow_Out?.count).toBe(2);

  // The lint answers through the same tool: probability 1 with no loopMaximum never ends.
  const endless = { ...scenario, elements: { ...scenario.elements, Task_Review: { loop: { probability: 1 } } } };
  const refused = await call('run_simulation', { scenario: endless });
  expect(refused.isError).toBe(true);
  expect(refused.text).toContain('E-BUCLE-SIN-SALIDA');
});
