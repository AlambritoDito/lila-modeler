/**
 * `patch_scenario` (LILA-055): dos modos (parchear en sitio, crear con `extends`), rechazo sin
 * escribir cuando el resultado no valida, y los casos de JSON Patch RFC 6902 propios de
 * `packages/mcp/src/json-patch.ts`. Cliente MCP del SDK contra un transporte in-memory, igual
 * patrón que `server.test.ts` (LILA-053/054).
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadResolvedScenario } from '@lila/engine/cli-shared';
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { createServer } from '../src/server.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const pedidoBpmn = `${repo}examples/pedido/model.bpmn`;
const pedidoScenario = `${repo}examples/pedido/as-is.scenario.json`;

let client: Client;
let scratch: string;

beforeEach(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  scratch = mkdtempSync(join(tmpdir(), 'lila-mcp-patch-'));
});

afterEach(async () => {
  await client.close();
  rmSync(scratch, { recursive: true, force: true });
});

/** Texto del único bloque de contenido que devuelve la tool. */
function textOf(result: { content: unknown }): string {
  return (result.content as { type: string; text: string }[])[0]?.text ?? '';
}

/** Copia de as-is.scenario.json con `model` reescrito a una ruta absoluta: no hace falta copiar
 * también el .bpmn junto a la copia para que resuelva. */
function copyAsIs(): string {
  const raw = JSON.parse(readFileSync(pedidoScenario, 'utf8')) as Record<string, unknown>;
  const path = join(scratch, 'copia.scenario.json');
  writeFileSync(path, JSON.stringify({ ...raw, model: pedidoBpmn }));
  return path;
}

/* ------------------------------------------------------------------ *
 * Modo (a): parchear en sitio
 * ------------------------------------------------------------------ */

test('modo (a): sin saveTo, parchea el escenario en sitio', async () => {
  const path = copyAsIs();
  const result = await client.callTool({
    name: 'patch_scenario',
    arguments: {
      scenario: path,
      patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
    },
  });
  expect(result.isError).toBe(false);

  const { scenario, file, notes } = JSON.parse(textOf(result)) as {
    scenario: { resources: { cajero: { capacity: number } } };
    file: string;
    notes: string[];
  };
  expect(scenario.resources.cajero.capacity).toBe(3);
  expect(file).toBe(path);
  expect(Array.isArray(notes)).toBe(true);

  // Se escribió de verdad, y el archivo escrito resuelve al mismo valor.
  const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { resources: { cajero: { capacity: number } } };
  expect(onDisk.resources.cajero.capacity).toBe(3);
});

test('modo (a): remove de una clave (description)', async () => {
  const path = copyAsIs();
  const before = JSON.parse(readFileSync(path, 'utf8')) as { description?: string };
  expect(before.description).toBeDefined();

  const result = await client.callTool({
    name: 'patch_scenario',
    arguments: { scenario: path, patch: [{ op: 'remove', path: '/description' }] },
  });
  expect(result.isError).toBe(false);
  const { scenario } = JSON.parse(textOf(result)) as { scenario: { description?: string } };
  expect(scenario.description).toBeUndefined();
});

test('modo (a): add de un pool de recursos nuevo', async () => {
  const path = copyAsIs();
  const result = await client.callTool({
    name: 'patch_scenario',
    arguments: {
      scenario: path,
      patch: [{ op: 'add', path: '/resources/mesero', value: { capacity: 1 } }],
    },
  });
  expect(result.isError).toBe(false);
  // El campo devuelto es el escenario ya resuelto (con defaults de zod aplicados); el pool nuevo
  // no lo usa ninguna tarea, así que no debe producir un error de referencia.
  const { scenario } = JSON.parse(textOf(result)) as { scenario: { resources: Record<string, { capacity: number }> } };
  expect(scenario.resources['mesero']).toMatchObject({ capacity: 1 });
});

test('modo (a): no toca examples/, usa un directorio temporal', async () => {
  const path = copyAsIs();
  expect(dirname(path)).toBe(scratch);
  await client.callTool({
    name: 'patch_scenario',
    arguments: { scenario: path, patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 5 }] },
  });
  // El as-is real de examples/ sigue con capacity 2.
  const real = JSON.parse(readFileSync(pedidoScenario, 'utf8')) as { resources: { cajero: { capacity: number } } };
  expect(real.resources.cajero.capacity).toBe(2);
});

/* ------------------------------------------------------------------ *
 * Rechazo sin escribir
 * ------------------------------------------------------------------ */

test('rechaza sin escribir: probability fuera de [0,1]', async () => {
  const path = copyAsIs();
  const before = readFileSync(path, 'utf8');
  const result = await client.callTool({
    name: 'patch_scenario',
    arguments: { scenario: path, patch: [{ op: 'replace', path: '/elements/Flow_Aprobado/probability', value: 1.5 }] },
  });
  expect(result.isError).toBe(true);
  expect(readFileSync(path, 'utf8')).toBe(before);
});

test('rechaza sin escribir: capacity < 1', async () => {
  const path = copyAsIs();
  const before = readFileSync(path, 'utf8');
  const result = await client.callTool({
    name: 'patch_scenario',
    arguments: { scenario: path, patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 0 }] },
  });
  expect(result.isError).toBe(true);
  expect(readFileSync(path, 'utf8')).toBe(before);
});

test('rechaza sin escribir: ref colgante a un recurso inexistente', async () => {
  const path = copyAsIs();
  const before = readFileSync(path, 'utf8');
  const result = await client.callTool({
    name: 'patch_scenario',
    arguments: {
      scenario: path,
      patch: [{ op: 'replace', path: '/elements/Task_TomarPedido/resources/0/ref', value: 'no-existe' }],
    },
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('no-existe');
  expect(readFileSync(path, 'utf8')).toBe(before);
});

test('modo (b): rechaza sin crear el archivo saveTo', async () => {
  const saveTo = join(scratch, 'no-deberia-existir.scenario.json');
  const result = await client.callTool({
    name: 'patch_scenario',
    arguments: {
      scenario: pedidoScenario,
      extendsFrom: pedidoScenario,
      saveTo,
      patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 0 }],
    },
  });
  expect(result.isError).toBe(true);
  expect(existsSync(saveTo)).toBe(false);
});

/* ------------------------------------------------------------------ *
 * JSON Patch inválido
 * ------------------------------------------------------------------ */

test('JSON Patch inválido: operación desconocida', async () => {
  const path = copyAsIs();
  const result = await client.callTool({
    name: 'patch_scenario',
    arguments: { scenario: path, patch: [{ op: 'frobnicate', path: '/resources/cajero/capacity', value: 3 }] },
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('no soportada');
});

test('JSON Patch inválido: replace sobre una ruta que no existe', async () => {
  const path = copyAsIs();
  const result = await client.callTool({
    name: 'patch_scenario',
    arguments: { scenario: path, patch: [{ op: 'replace', path: '/resources/cajero/noExiste', value: 1 }] },
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('no existe la ruta');
});

/* ------------------------------------------------------------------ *
 * Modo (b): crear con `extends`
 * ------------------------------------------------------------------ */

test('modo (b): extends relativo correcto desde un directorio anidado distinto', async () => {
  const saveTo = join(scratch, 'nested', 'dir', 'nuevo.scenario.json');
  const result = await client.callTool({
    name: 'patch_scenario',
    arguments: {
      scenario: pedidoScenario,
      extendsFrom: pedidoScenario,
      saveTo,
      patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
    },
  });
  expect(result.isError).toBe(false);
  const { file } = JSON.parse(textOf(result)) as { file: string };
  expect(file).toBe(saveTo);

  const written = JSON.parse(readFileSync(saveTo, 'utf8')) as { extends: string; resources: unknown };
  // Solo el delta: nada de `run`, `calendars` ni el resto de `resources`.
  expect(written).not.toHaveProperty('run');
  expect(written).not.toHaveProperty('calendars');
  expect(written.resources).toEqual({ cajero: { capacity: 3 } });

  const expectedRelative = relative(dirname(saveTo), pedidoScenario).split('\\').join('/');
  expect(written.extends).toBe(expectedRelative === '' ? '.' : expectedRelative);

  // Y resuelve de verdad: cargar el escenario nuevo directamente reproduce lo mismo.
  const resolved = loadResolvedScenario(saveTo);
  expect(resolved.resources?.['cajero']?.capacity).toBe(3);
});

test(
  'modo (b): aceptación literal — equivalente a to-be-3-cajeros.scenario.json salvo name/description',
  async () => {
    const saveTo = join(scratch, 'to-be-generado.scenario.json');
    const result = await client.callTool({
      name: 'patch_scenario',
      arguments: {
        scenario: pedidoScenario,
        extendsFrom: pedidoScenario,
        saveTo,
        patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
      },
    });
    expect(result.isError).toBe(false);

    const toBeScenario = `${repo}examples/pedido/to-be-3-cajeros.scenario.json`;
    const generated = loadResolvedScenario(saveTo);
    const expected = loadResolvedScenario(toBeScenario);

    const strip = (s: object): object => ({ ...s, name: undefined, description: undefined });
    expect(strip(generated)).toEqual(strip(expected));

    // No queda ningún archivo nuevo en examples/.
    expect(existsSync(join(repo, 'examples/pedido/to-be-generado.scenario.json'))).toBe(false);
  },
  30_000,
);

test(
  'modo (b): el archivo generado funciona con run_simulation y compare_scenarios (significativo)',
  async () => {
    const saveTo = join(scratch, 'to-be-generado.scenario.json');
    const patchResult = await client.callTool({
      name: 'patch_scenario',
      arguments: {
        scenario: pedidoScenario,
        extendsFrom: pedidoScenario,
        saveTo,
        patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
      },
    });
    expect(patchResult.isError).toBe(false);

    const run = await client.callTool({ name: 'run_simulation', arguments: { scenario: saveTo, seed: 42 } });
    expect(run.isError).toBe(false);

    const cmp = await client.callTool({
      name: 'compare_scenarios',
      arguments: { scenarios: [pedidoScenario, saveTo], seed: 42 },
    });
    expect(cmp.isError).toBe(false);
    const { comparison } = JSON.parse(textOf(cmp)) as {
      comparison: { rows: { kpi: string; significant: boolean[] }[] };
    };
    const row = comparison.rows.find((r) => r.kpi === 'elements.Task_TomarPedido.resourceWait.mean');
    expect(row, JSON.stringify(comparison.rows)).toBeDefined();
    expect(row?.significant[1]).toBe(true);
  },
  120_000,
);

test('modo (b): extendsFrom por defecto es el propio scenario', async () => {
  const saveTo = join(scratch, 'default-extends.scenario.json');
  const result = await client.callTool({
    name: 'patch_scenario',
    arguments: { scenario: pedidoScenario, saveTo, patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 4 }] },
  });
  expect(result.isError).toBe(false);
  const written = JSON.parse(readFileSync(saveTo, 'utf8')) as { extends: string };
  const resolvedExtends = posix.resolve(posix.dirname(saveTo.split('\\').join('/')), written.extends);
  expect(resolvedExtends).toBe(pedidoScenario.split('\\').join('/'));
});
