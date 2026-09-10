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
const incompletoBpmn = fileURLToPath(
  new URL('../../engine/test/fixtures/parse-incompleto.bpmn', import.meta.url),
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

// Aceptación LILA-185: los avisos de bpmn-moddle llegan al JSON de la tool, clasificados.
test('validate_bpmn sobre un export que pierde elementos: E-PARSE-INCOMPLETO y W-PARSE', async () => {
  const result = await client.callTool({
    name: 'validate_bpmn',
    arguments: { path: incompletoBpmn },
  });
  expect(result.isError).toBe(false);

  const parsed = JSON.parse(textOf(result)) as {
    ir: { source: { warnings: { message: string }[] } };
    errors: { code: string; id: string; message: string }[];
    warnings: { code: string; id: string }[];
  };

  expect(parsed.ir.source.warnings).toHaveLength(2);
  expect(parsed.errors.filter((error) => error.code === 'E-PARSE-INCOMPLETO')).toMatchObject([
    { id: 'Task_Revisar' },
  ]);
  expect(parsed.warnings.filter((warning) => warning.code === 'W-PARSE')).toMatchObject([
    { id: 'Process_Incompleto' },
  ]);
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
  expect(parsed.resumen).toContain('XOR gateway');
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
  expect(textOf(result)).toContain('not both');
});

test('validate_bpmn con una ruta inexistente: isError, y el servidor sigue respondiendo', async () => {
  const missing = await client.callTool({ name: 'validate_bpmn', arguments: { path: '/no/existe.bpmn' } });
  expect(missing.isError).toBe(true);
  expect(textOf(missing)).toContain('does not exist');

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
  expect(resumen).toContain('Validation: 3 errors, 0 warnings.');
  expect(resumen).toContain('CANNOT be simulated');
});

test('describe_process lista los otros procesos del archivo, no simulados', async () => {
  const result = await client.callTool({ name: 'describe_process', arguments: { path: pedidoBpmn } });
  const { resumen } = JSON.parse(textOf(result)) as { resumen: string };
  expect(resumen).toContain('Other processes in the file, not simulated: Process_Cliente');
  expect(resumen).toContain('Validation: 0 errors, 1 warning.');
});

test('describe_process acepta `xml` inline igual que validate_bpmn (LILA-056)', async () => {
  const xml = readFileSync(pedidoBpmn, 'utf8');
  const inline = await client.callTool({ name: 'describe_process', arguments: { xml } });
  const porRuta = await client.callTool({ name: 'describe_process', arguments: { path: pedidoBpmn } });
  expect(inline.isError ?? false).toBe(false);
  expect(textOf(inline)).toBe(textOf(porRuta));

  const ambos = await client.callTool({ name: 'describe_process', arguments: { path: pedidoBpmn, xml } });
  expect(ambos.isError).toBe(true);
  expect(textOf(ambos)).toContain('not both');

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
    expect(resumen).toContain('the scenario could not be read');
    expect(resumen).toContain('run.duration');
    expect(resumen).not.toContain('no scenario');
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
  expect(resumen).toContain('the scenario could not be read');
  expect(resumen).toContain('Process Process_Restaurante');
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
  expect(textOf(result)).toContain('does not match scenario.model');
});

test('los defectos del esquema salen con el texto del catálogo, el mismo que la CLI (LILA-202)', async () => {
  const roto = join(tmpdir(), `lila-mcp-es-${process.pid}.scenario.json`);
  writeFileSync(roto, JSON.stringify({
    version: 1, name: 'malo', model: pedidoBpmn,
    // `probability: 1.5` ya no sirve de cebo del esquema (LILA-198 se la pasó al lint):
    // `run.warmup` negativo sí lo sigue siendo.
    run: { start: '2026-01-01T08:00:00Z', duration: 3600, warmup: -1 },
  }));
  try {
    // `describe_process` (lectura del escenario) y `run_simulation` (carga completa) son las dos
    // rutas por las que el esquema llega al agente; las dos citan la ruta y dicen lo mismo.
    const descripcion = await client.callTool({
      name: 'describe_process',
      arguments: { path: pedidoBpmn, scenario: roto },
    });
    expect(textOf(descripcion)).toContain('run.warmup: must be ≥ 0');

    const corrida = await client.callTool({ name: 'run_simulation', arguments: { scenario: roto } });
    expect(corrida.isError).toBe(true);
    expect(textOf(corrida)).toContain('run.warmup: must be ≥ 0');
    expect(textOf(corrida)).not.toMatch(/Too big|expected/i);
  } finally {
    rmSync(roto, { force: true });
  }
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
  expect(textOf(result)).toContain('at least two scenarios');
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
    // Una errata de clave: la rechaza el esquema (`E-CLAVE-DESCONOCIDA`) antes de resolver nada,
    // que es el camino donde antes se colaba el nombre de un archivo inexistente. (Un
    // `probability: 1.5` ya no sirve de cebo: desde LILA-198 lo caza el lint, no el esquema.)
    arguments: { scenario: { ...barato(), elements: { Flow_Aprobado: { probabilty: 1.5 } } } },
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('inline scenario: invalid scenario');
  expect(textOf(result)).not.toContain('.json:');
});

/* ------------------------------------------------------------------ *
 * Idioma (LILA-211, parte 2)
 * ------------------------------------------------------------------ */

test('`title`, `description` y los `describe()` de las cinco tools están en inglés', async () => {
  const { tools } = await client.listTools();
  // La superficie del protocolo no depende del `locale`: el cliente la leyó una sola vez.
  for (const tool of tools) {
    const surface = [
      tool.title ?? '',
      tool.description ?? '',
      JSON.stringify(tool.inputSchema),
    ].join(' ');
    for (const spanish of ['Ruta', 'escenario', 'archivo', 'Sobrescribe', 'inválido']) {
      expect(surface, `${tool.name} menciona "${spanish}"`).not.toContain(spanish);
    }
  }
  expect(tools.map((tool) => tool.title).sort()).toEqual([
    'Compare scenarios',
    'Describe process',
    'Patch scenario',
    'Run simulation',
    'Validate BPMN',
  ]);
});

test('las cinco tools aceptan `locale` como enum opcional', async () => {
  const { tools } = await client.listTools();
  for (const tool of tools) {
    const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    const required = (tool.inputSchema as { required?: string[] }).required ?? [];
    expect(properties, tool.name).toHaveProperty('locale');
    expect(required, tool.name).not.toContain('locale');
    expect((properties['locale'] as { enum?: string[] }).enum, tool.name).toEqual(['en', 'es']);
  }
});

test("validate_bpmn con locale 'es' devuelve los problemas traducidos, con el mismo código", async () => {
  const spanish = await client.callTool({
    name: 'validate_bpmn',
    arguments: { path: boundaryBpmn, locale: 'es' },
  });
  const english = await client.callTool({ name: 'validate_bpmn', arguments: { path: boundaryBpmn } });

  const errorsOf = (result: unknown): { code: string; message: string }[] =>
    (JSON.parse(textOf(result as { content: unknown })) as { errors: { code: string; message: string }[] }).errors;

  expect(errorsOf(spanish).map((error) => error.code)).toEqual(errorsOf(english).map((error) => error.code));
  expect(errorsOf(spanish)[0]!.message).toContain('no soportado por el simulador');
  expect(errorsOf(english)[0]!.message).toContain('not supported by the simulator');
});

test("describe_process con locale 'es' devuelve el resumen en español, en la misma clave `resumen`", async () => {
  const result = await client.callTool({
    name: 'describe_process',
    arguments: { path: pedidoBpmn, scenario: pedidoScenario, locale: 'es' },
  });
  const parsed = JSON.parse(textOf(result)) as { ir: unknown; resumen: string };

  expect(parsed.ir).toBeDefined();
  expect(parsed.resumen).toContain('Proceso Process_Restaurante (Restaurant)');
  expect(parsed.resumen).toContain('gateway XOR');
  expect(parsed.resumen).toContain('Validación: 0 errores, 1 aviso.');
  expect(parsed.resumen).toContain('Otros procesos del archivo, no simulados: Process_Cliente');
  expect(parsed.resumen).toContain('Recursos referenciados:');
});

test("run_simulation con locale 'es': el escenario inválido sale en español y con su código", async () => {
  const result = await client.callTool({
    name: 'run_simulation',
    arguments: {
      scenario: { version: 1, name: 'Malo', model: pedidoBpmn, run: { start: '2026-09-07T08:00:00-06:00', duration: 60 }, elements: { NoExiste: {} } },
      locale: 'es',
    },
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('escenario inválido');
  expect(textOf(result)).toContain('E-ELEMENTO-DESCONOCIDO');
  expect(textOf(result)).toContain('no existe en el modelo');
});

test("compare_scenarios con locale 'es': el error y las `notes` salen en español", async () => {
  const solo = await client.callTool({
    name: 'compare_scenarios',
    arguments: { scenarios: [pedidoScenario], locale: 'es' },
  });
  expect(solo.isError).toBe(true);
  expect(textOf(solo)).toContain('hacen falta al menos dos escenarios');

  const compared = await client.callTool({
    name: 'compare_scenarios',
    arguments: { scenarios: [pedidoScenario, toBeScenario], seed: 42, replications: 1, locale: 'es' },
  });
  expect(compared.isError ?? false).toBe(false);
  const notes = (JSON.parse(textOf(compared)) as { notes: string[] }).notes;
  expect(notes.some((note) => note.includes('sin IC95 no hay marca de significancia'))).toBe(true);
}, 60_000);

test("patch_scenario con locale 'es': un patch que invalida el escenario se rechaza en español", async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lila-mcp-locale-'));
  try {
    const scenario = join(directory, 'copia.scenario.json');
    writeFileSync(scenario, readFileSync(pedidoScenario, 'utf8'), 'utf8');

    const result = await client.callTool({
      name: 'patch_scenario',
      arguments: {
        scenario,
        patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 0 }],
        locale: 'es',
      },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('escenario inválido tras el patch');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('el idioma del servidor es el que reciben las tools sin `locale`, y `locale` lo sobrescribe', async () => {
  const spanishServer = createServer({ locale: 'es' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const spanishClient = new Client({ name: 'test-client-es', version: '0.0.0' });
  await Promise.all([spanishClient.connect(clientTransport), spanishServer.connect(serverTransport)]);

  try {
    const byDefault = await spanishClient.callTool({
      name: 'validate_bpmn',
      arguments: { path: '/no/existe.bpmn' },
    });
    expect(textOf(byDefault)).toBe('validate_bpmn: no existe el archivo /no/existe.bpmn.');

    const overridden = await spanishClient.callTool({
      name: 'validate_bpmn',
      arguments: { path: '/no/existe.bpmn', locale: 'en' },
    });
    expect(textOf(overridden)).toBe('validate_bpmn: the file /no/existe.bpmn does not exist.');
  } finally {
    await spanishClient.close();
  }
});
