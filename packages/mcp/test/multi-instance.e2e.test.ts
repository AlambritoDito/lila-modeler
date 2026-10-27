/**
 * #701 (ADR-033 § 4): the MCP tools accept a multi-instance task like the CLI does —
 * `validate_bpmn` puts it in the IR with no error, and `run_simulation` returns the same bytes as
 * `lila run --json` with `N` drawn from the scenario's `instances`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { main } from '../../engine/src/cli.js';
import { createServer } from '../src/server.js';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" id="D" targetNamespace="urn:lila:test">
  <bpmn:process id="Process_Review" isExecutable="true">
    <bpmn:startEvent id="Start" />
    <bpmn:sequenceFlow id="Flow_In" sourceRef="Start" targetRef="Task_Review" />
    <bpmn:userTask id="Task_Review">
      <bpmn:multiInstanceLoopCharacteristics isSequential="1">
        <bpmn:loopCardinality xsi:type="bpmn:tFormalExpression">3</bpmn:loopCardinality>
      </bpmn:multiInstanceLoopCharacteristics>
    </bpmn:userTask>
    <bpmn:sequenceFlow id="Flow_Out" sourceRef="Task_Review" targetRef="End" />
    <bpmn:endEvent id="End" />
  </bpmn:process>
</bpmn:definitions>`;

let client: Client;
let scratch: string;

function textOf(result: { content: unknown }): string {
  return (result.content as { type: string; text: string }[])[0]?.text ?? '';
}

beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'lila-mcp-multi-'));
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
});

afterEach(async () => {
  await client.close();
  rmSync(scratch, { recursive: true, force: true });
});

test('validate_bpmn: a sequential multi-instance task is in the IR, with no error', async () => {
  const result = await client.callTool({ name: 'validate_bpmn', arguments: { xml: XML } });
  expect(result.isError).toBe(false);
  const parsed = JSON.parse(textOf(result)) as {
    errors: unknown[];
    ir: { nodes: Record<string, { type: string; multiInstance?: unknown }> };
  };
  expect(parsed.errors).toEqual([]);
  expect(parsed.ir.nodes.Task_Review).toMatchObject({
    type: 'task',
    multiInstance: { sequential: true, cardinality: 3 },
  });
});

test('run_simulation with `instances` gives the same bytes as `lila run --json`', async () => {
  const model = join(scratch, 'model.bpmn');
  writeFileSync(model, XML, 'utf8');
  const scenario = {
    version: 1,
    name: 'Review',
    model,
    run: { start: '2026-09-07T08:00:00-06:00', seed: 3, replications: 2 },
    resources: { reviewer: { capacity: 1 } },
    elements: {
      Start: { interTriggerTimer: { type: 'exponential', mean: 60 }, triggerCount: 15 },
      Task_Review: {
        processingTime: { type: 'exponential', mean: 10 },
        resources: [{ ref: 'reviewer' }],
        instances: { type: 'uniform', min: 0, max: 5 },
      },
    },
  };
  const scenarioFile = join(scratch, 'review.scenario.json');
  writeFileSync(scenarioFile, JSON.stringify(scenario), 'utf8');
  const cliJson = join(scratch, 'cli.json');
  expect(await main(['run', model, scenarioFile, '--json', cliJson])).toBe(0);

  const result = await client.callTool({ name: 'run_simulation', arguments: { scenario, detail: 'full' } });
  expect(result.isError).toBe(false);
  expect(`${textOf(result)}\n`).toBe(readFileSync(cliJson, 'utf8'));
}, 60_000);
