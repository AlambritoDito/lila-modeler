/**
 * Cliente MCP del propio SDK contra un transporte in-memory (LILA-053): más rápido y sin
 * procesos que un `StdioClientTransport` de verdad, y ejercita el mismo `McpServer.connect`
 * que usará `bin.ts` sobre stdio.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateBpmnXml } from '@lila/engine/bpmn';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { main } from '../../engine/src/cli.js';
import { runResultSchema } from '@lila/engine/result-schema';

import {
  canonicalJson,
  loadPedidoScenario,
  PEDIDO_GOLDEN_PATH,
  withoutResourcesAndCalendars,
} from '../../engine/test/golden/pedido.js';
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

test('listTools devuelve las cinco tools', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  expect(names).toEqual([
    'compare_scenarios',
    'describe_process',
    'patch_scenario',
    'run_simulation',
    'validate_bpmn',
  ]);
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

test('describe_process acepta `xml` inline igual que validate_bpmn (LILA-056)', async () => {
  const xml = readFileSync(pedidoBpmn, 'utf8');
  const inline = await client.callTool({ name: 'describe_process', arguments: { xml } });
  const porRuta = await client.callTool({ name: 'describe_process', arguments: { path: pedidoBpmn } });
  expect(inline.isError ?? false).toBe(false);
  expect(textOf(inline)).toBe(textOf(porRuta));

  const ambos = await client.callTool({ name: 'describe_process', arguments: { path: pedidoBpmn, xml } });
  expect(ambos.isError).toBe(true);
  expect(textOf(ambos)).toContain('no los dos');

  const ninguno = await client.callTool({ name: 'describe_process', arguments: {} });
  expect(ninguno.isError).toBe(true);
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

/* ------------------------------------------------------------------ *
 * `run_simulation` / `compare_scenarios` (LILA-054)
 * ------------------------------------------------------------------ */

/** Escenario mínimo de examples/pedido: una réplica y una hora, para las pruebas que no miden KPI. */
function barato(): Record<string, unknown> {
  const asIs = JSON.parse(readFileSync(pedidoScenario, 'utf8')) as {
    run: Record<string, unknown>;
    elements: Record<string, Record<string, unknown>>;
  };
  return {
    ...asIs,
    model: pedidoBpmn,
    run: { ...asIs.run, replications: 1, duration: 3600 },
    elements: {
      ...asIs.elements,
      StartEvent_Pedido: { ...asIs.elements['StartEvent_Pedido'], triggerCount: 20 },
    },
  };
}

let scratch: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lila-mcp-run-'));
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true });
});

test(
  'run_simulation sobre examples/pedido (degradado, seed 42): mismo JSON que `lila run --json`',
  async () => {
    // El golden de M1 (`packages/engine/test/golden/pedido.seed-42.json`) se generó con
    // `simulate()` a pelo, antes de que `lila run` empezara a fundir avisos de frontera del
    // modelo/escenario (LILA-046) y de elementos sin parámetros (LILA-184): coincide en todos los
    // KPI, pero no en `warnings`. La aceptación real de este ticket —"RunResult idéntico al de
    // `lila run --json`"— se prueba corriendo la CLI de verdad sobre el mismo escenario degradado.
    const degraded = { ...withoutResourcesAndCalendars(loadPedidoScenario(42)), model: pedidoBpmn };

    const scenarioFile = join(scratch, 'degraded.scenario.json');
    writeFileSync(scenarioFile, JSON.stringify(degraded), 'utf8');
    const cliJson = join(scratch, 'cli.json');
    expect(await main(['run', pedidoBpmn, scenarioFile, '--seed', '42', '--json', cliJson])).toBe(0);
    const expected = readFileSync(cliJson, 'utf8');

    const result = await client.callTool({ name: 'run_simulation', arguments: { scenario: degraded } });
    expect(result.isError).toBe(false);
    expect(`${textOf(result)}\n`).toBe(expected);

    // Aceptación de M4 (LILA_MODELER_ESTRUCTURA.md § 7, "devuelve exactamente el golden"): lo
    // único que se movió desde M1 son los `warnings`, así que la igualdad con el golden se fija
    // byte a byte sobre todo lo demás —misma serialización canónica que usa el propio golden— y
    // aparte se exige que su aviso original siga presente entre los que `lila run` agrega ahora.
    const golden = JSON.parse(readFileSync(PEDIDO_GOLDEN_PATH, 'utf8')) as { warnings: string[] };
    const actual = JSON.parse(textOf(result)) as { warnings: string[] };
    const sinWarnings = (value: object): string => canonicalJson({ ...value, warnings: undefined });
    expect(sinWarnings(actual)).toBe(sinWarnings(golden));
    for (const warning of golden.warnings) expect(actual.warnings).toContain(warning);
  },
  60_000,
);

test(
  'run_simulation con saveTo escribe los mismos bytes que `lila run --json <ruta>`',
  async () => {
    const cliJson = join(scratch, 'cli.json');
    expect(await main(['run', pedidoBpmn, pedidoScenario, '--seed', '42', '--json', cliJson])).toBe(0);

    const saveTo = join(scratch, 'tool.json');
    const result = await client.callTool({
      name: 'run_simulation',
      arguments: { scenario: pedidoScenario, seed: 42, saveTo },
    });
    expect(result.isError).toBe(false);
    expect(readFileSync(saveTo, 'utf8')).toBe(readFileSync(cliJson, 'utf8'));
  },
  30_000,
);

test('run_simulation: modelo que no coincide con scenario.model es un error estructurado', async () => {
  const result = await client.callTool({
    name: 'run_simulation',
    arguments: { model: boundaryBpmn, scenario: pedidoScenario },
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('no coincide con scenario.model');
});

test('run_simulation: escenario inválido es un error estructurado, no una excepción', async () => {
  const result = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: { version: 1, name: 'malo', model: pedidoBpmn, run: { duration: 'no soy número' } } },
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('run_simulation:');
});

test(
  'compare_scenarios: AS-IS vs TO-BE-3-cajeros marca significativa la espera del cajero',
  async () => {
    const result = await client.callTool({
      name: 'compare_scenarios',
      arguments: { scenarios: [pedidoScenario, toBeScenario], seed: 42 },
    });
    expect(result.isError).toBe(false);

    const { comparison, notes } = JSON.parse(textOf(result)) as {
      comparison: { rows: { kpi: string; significant: boolean[] }[] };
      notes: string[];
    };
    const row = comparison.rows.find((r) => r.kpi === 'elements.Task_TomarPedido.resourceWait.mean');
    expect(row, JSON.stringify(comparison.rows)).toBeDefined();
    expect(row?.significant[1]).toBe(true);
    expect(Array.isArray(notes)).toBe(true);
  },
  120_000,
);

test('compare_scenarios: acepta un escenario inline mezclado con una ruta', async () => {
  const asIsInline = { ...(JSON.parse(readFileSync(pedidoScenario, 'utf8')) as Record<string, unknown>), model: pedidoBpmn };
  const result = await client.callTool({
    name: 'compare_scenarios',
    arguments: { scenarios: [asIsInline, toBeScenario], seed: 7, replications: 2 },
  });
  expect(result.isError).toBe(false);
  const { comparison } = JSON.parse(textOf(result)) as { comparison: { count: number } };
  expect(comparison.count).toBe(2);
});

test('compare_scenarios: menos de dos escenarios es un error estructurado', async () => {
  const result = await client.callTool({
    name: 'compare_scenarios',
    arguments: { scenarios: [pedidoScenario] },
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('al menos dos escenarios');
});

test('run_simulation: structuredContent repite el texto, sin log, y valida contra el outputSchema', async () => {
  const { tools } = await client.listTools();
  expect(tools.find((tool) => tool.name === 'run_simulation')?.outputSchema).toBeDefined();

  const result = await client.callTool({ name: 'run_simulation', arguments: { scenario: barato() } });
  expect(result.isError).toBe(false);
  // El contrato MCP: con `outputSchema` declarado, `structuredContent` es obligatorio y tiene que
  // validar contra él. `safeParse` sobre el resultado real, no sobre un objeto de laboratorio.
  const parsed = runResultSchema.safeParse(result.structuredContent);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  expect(JSON.stringify(result.structuredContent, null, 2)).toBe(textOf(result));
  // `log: false`: el event log no viaja por MCP ni siquiera duplicado en `structuredContent`.
  expect(result.structuredContent).not.toHaveProperty('log');
});

test('run_simulation: un escenario inline inválido no cita un archivo que no existe', async () => {
  const result = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: { ...barato(), elements: { Flow_Aprobado: { probability: 1.5 } } } },
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('escenario inline: escenario inválido');
  expect(textOf(result)).not.toContain('.json:');
});
