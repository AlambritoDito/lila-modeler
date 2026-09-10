/**
 * E2E de LILA-056: el cliente MCP oficial contra `node packages/engine/bin/lila.js mcp`, el
 * subcomando real, por `StdioClientTransport` — procesos de verdad, no `InMemoryTransport`.
 * Requiere `dist/` (el `pretest` de la raíz y el CI construyen antes de los tests).
 *
 * Cubre los dos flujos de la aceptación del hito M4 tal como los haría un agente:
 * "simula examples/pedido con as-is y dime el cuello de botella" y "qué pasa si agrego un cajero".
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, expect, test } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const asIs = 'examples/pedido/as-is.scenario.json';

let client: Client;
let temp: string;

/** Texto del primer bloque de contenido, que es donde viaja el JSON de todas las tools. */
function textOf(result: { content: unknown }): string {
  return (result.content as { type: string; text: string }[])[0]?.text ?? '';
}

function jsonOf(result: { content: unknown }): any {
  return JSON.parse(textOf(result));
}

beforeAll(async () => {
  temp = mkdtempSync(join(tmpdir(), 'lila-mcp-e2e-'));
  client = new Client({ name: 'lila-e2e', version: '0' });
  // cwd del servidor = raíz del repo: las rutas relativas de las tools se resuelven contra ahí.
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd: repo }),
  );
}, 120_000);

afterAll(async () => {
  await client.close();
  rmSync(temp, { recursive: true, force: true });
});

test('`lila mcp` sirve las cinco tools por stdio', async () => {
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    'compare_scenarios',
    'describe_process',
    'patch_scenario',
    'run_simulation',
    'validate_bpmn',
  ]);
}, 120_000);

test('flujo "dime el cuello de botella": el mismo bottlenecks[0] que `lila run --json`', async () => {
  const result = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: asIs, seed: 42 },
  });
  expect(result.isError ?? false).toBe(false);

  const cli = join(temp, 'cli.json');
  execFileSync(process.execPath, [lilaBin, 'run', 'examples/pedido/model.bpmn', asIs, '--seed', '42', '--json', cli], {
    cwd: repo,
    stdio: 'ignore',
  });

  const viaTool = jsonOf(result).bottlenecks;
  const viaCli = JSON.parse(readFileSync(cli, 'utf8')).bottlenecks;
  expect(viaTool[0]).toEqual(viaCli[0]);
  expect(viaTool).toEqual(viaCli);
  expect(typeof viaTool[0].elementId).toBe('string');
}, 120_000);

test('flujo "qué pasa si agrego un cajero": patch_scenario con extends y compare_scenarios coherente', async () => {
  const saveTo = join(temp, 'to-be-3-cajeros.scenario.json');
  const patched = await client.callTool({
    name: 'patch_scenario',
    arguments: {
      scenario: asIs,
      // Un cajero más que el as-is (capacity 2).
      patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
      saveTo,
      extendsFrom: asIs,
      name: 'TO-BE 3 cashiers',
    },
  });
  expect(patched.isError ?? false).toBe(false);

  const escrito = JSON.parse(readFileSync(saveTo, 'utf8'));
  expect(escrito.extends).toBeTypeOf('string');
  expect(escrito.resources).toEqual({ cajero: { capacity: 3 } });
  expect(jsonOf(patched).scenario.resources.cajero.capacity).toBe(3);

  const compared = await client.callTool({
    name: 'compare_scenarios',
    arguments: { scenarios: [asIs, saveTo], seed: 42 },
  });
  expect(compared.isError ?? false).toBe(false);

  const rows = jsonOf(compared).comparison.rows as {
    kpi: string;
    base: number | null;
    values: (number | null)[];
    significant: boolean[];
  }[];
  const espera = rows.find((row) => row.kpi === 'elements.Task_TomarPedido.resourceWait.mean');
  expect(espera).toBeDefined();
  expect(espera!.values[1]).toBeLessThan(espera!.base!);
  expect(espera!.significant[1]).toBe(true);
}, 120_000);

test('el servidor sobrevive a un error de tool y sigue respondiendo', async () => {
  const roto = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: 'examples/pedido/no-existe.scenario.json' },
  });
  expect(roto.isError).toBe(true);

  const { tools } = await client.listTools();
  expect(tools).toHaveLength(5);
}, 120_000);

test('nada de esto deja archivos nuevos en examples/pedido', () => {
  expect(readdirSync(join(repo, 'examples/pedido')).sort()).toEqual([
    'README.md',
    'as-is.scenario.json',
    'model.bpmn',
    'to-be-3-cajeros.scenario.json',
  ]);
});
