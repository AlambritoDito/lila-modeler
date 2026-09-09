/**
 * QA adversarial de `patch_scenario` (LILA-055), por un agente distinto al implementador.
 *
 * Cubre lo que los tests del ticket no cubrían: punteros RFC 6901 con `~0`/`~1`, `-` y índices de
 * array, atomicidad del patch entero, contaminación de prototipo, `value` ausente, cadenas de
 * `extends`, `null` como borrado heredado, `saveTo` igual a `scenario`, y el contrato de aplanado
 * del modo (a).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  scratch = mkdtempSync(join(tmpdir(), 'lila-mcp-patch-qa-'));
});

afterEach(async () => {
  await client.close();
  rmSync(scratch, { recursive: true, force: true });
});

function textOf(result: { content: unknown }): string {
  return (result.content as { type: string; text: string }[])[0]?.text ?? '';
}

/** Copia de as-is.scenario.json con `model` absoluto, para no copiar también el .bpmn. */
function copyAsIs(name = 'copia.scenario.json', dir = scratch): string {
  const raw = JSON.parse(readFileSync(pedidoScenario, 'utf8')) as Record<string, unknown>;
  const path = join(dir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ ...raw, model: pedidoBpmn }, null, 2));
  return path;
}

async function patch(args: Record<string, unknown>): Promise<{ isError?: unknown; content: unknown }> {
  return (await client.callTool({ name: 'patch_scenario', arguments: args })) as {
    isError?: unknown;
    content: unknown;
  };
}

/* ------------------------------------------------------------------ *
 * Contaminación de prototipo
 * ------------------------------------------------------------------ */

test('un puntero /__proto__/… se rechaza, no contamina Object.prototype y no cuelga el servidor', async () => {
  const path = copyAsIs();
  const before = readFileSync(path, 'utf8');

  const result = await patch({
    scenario: path,
    patch: [{ op: 'add', path: '/__proto__/pwned', value: 'sí' }],
  });

  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('prototipo');
  expect(readFileSync(path, 'utf8')).toBe(before);
  expect((({}) as Record<string, unknown>)['pwned']).toBeUndefined();

  // El servidor sigue vivo: la llamada siguiente responde (antes se colgaba para siempre).
  const next = await patch({
    scenario: path,
    patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
  });
  expect(next.isError).toBe(false);
});

test('los segmentos constructor y prototype también se rechazan', async () => {
  const path = copyAsIs();
  for (const pointer of ['/constructor/prototype/x', '/resources/prototype']) {
    const result = await patch({ scenario: path, patch: [{ op: 'add', path: pointer, value: 1 }] });
    expect(result.isError, pointer).toBe(true);
    expect(textOf(result), pointer).toContain('prototipo');
  }
});

test('un value con __proto__ dentro se rechaza y no deja un escenario contaminado en disco (LILA-204)', async () => {
  const path = copyAsIs();
  const saveTo = join(scratch, 'hijo.scenario.json');
  // `JSON.parse`, no un literal: `{ __proto__: … }` escrito a mano no crea una clave propia y el
  // patch no llevaría nada. Así es como llega de verdad, parseado del JSON-RPC del agente.
  const value = JSON.parse('{"capacity":3,"__proto__":{"pwnedValue":1}}') as unknown;

  for (const args of [
    { scenario: path, patch: [{ op: 'replace', path: '/resources/cajero', value }] },
    { scenario: path, saveTo, patch: [{ op: 'replace', path: '/resources/cajero', value }] },
    { scenario: path, patch: [{ op: 'add', path: '/resources/nuevo', value: [value] }] },
  ]) {
    const result = await patch(args);
    expect(result.isError, JSON.stringify(args['saveTo'] ?? 'en sitio')).toBe(true);
    expect(textOf(result)).toContain('prototipo');
  }

  expect(existsSync(saveTo)).toBe(false);
  expect((({}) as Record<string, unknown>)['pwnedValue']).toBeUndefined();
  expect(Object.hasOwn(JSON.parse(readFileSync(path, 'utf8')) as object, '__proto__')).toBe(false);
});

/* ------------------------------------------------------------------ *
 * JSON Patch RFC 6902
 * ------------------------------------------------------------------ */

test('`move` y `copy` se rechazan con su nombre, y `from` no se aplica en silencio', async () => {
  const path = copyAsIs();
  const before = readFileSync(path, 'utf8');
  // `docs/MCP.md` promete que las dos no están: si alguien las implementa a medias, o el `from`
  // del esquema empieza a colarse por otra rama, esto lo caza antes de que escriba un escenario.
  for (const op of ['move', 'copy'] as const) {
    const result = await patch({ scenario: path, patch: [{ op, from: '/name', path: '/description' }] });
    expect(result.isError, op).toBe(true);
    expect(textOf(result), op).toContain(`operación no soportada: "${op}"`);
    expect(readFileSync(path, 'utf8')).toBe(before);
  }
});

test('add/replace/test sin `value` es error explícito, no un borrado silencioso', async () => {
  const path = copyAsIs();
  const before = readFileSync(path, 'utf8');
  for (const op of ['add', 'replace', 'test'] as const) {
    const result = await patch({ scenario: path, patch: [{ op, path: '/description' }] });
    expect(result.isError, op).toBe(true);
    expect(textOf(result), op).toContain('requiere "value"');
    expect(readFileSync(path, 'utf8')).toBe(before);
  }
});

test('punteros con ~1 (barra) y ~0 (tilde) escriben la clave sin escapar', async () => {
  const path = copyAsIs();
  const result = await patch({
    scenario: path,
    patch: [
      { op: 'add', path: '/resources/con~1barra', value: { capacity: 1 } },
      { op: 'add', path: '/resources/con~0tilde', value: { capacity: 2 } },
    ],
  });
  expect(result.isError).toBe(false);

  const onDisk = JSON.parse(readFileSync(path, 'utf8')) as { resources: Record<string, { capacity: number }> };
  expect(onDisk.resources['con/barra']?.capacity).toBe(1);
  expect(onDisk.resources['con~tilde']?.capacity).toBe(2);
});

test('arrays: `-` añade al final, y el índice fuera de rango o no numérico es error', async () => {
  const path = copyAsIs();
  const ok = await patch({
    scenario: path,
    patch: [{ op: 'add', path: '/elements/Task_Preparar/resources/-', value: { ref: 'cajero', quantity: 1 } }],
  });
  expect(ok.isError).toBe(false);
  const onDisk = JSON.parse(readFileSync(path, 'utf8')) as {
    elements: { Task_Preparar: { resources: { ref: string }[] } };
  };
  expect(onDisk.elements.Task_Preparar.resources.map((r) => r.ref)).toEqual(['cocinero', 'horno', 'cajero']);

  for (const index of ['99', '-1', 'abc']) {
    const bad = await patch({
      scenario: path,
      patch: [{ op: 'replace', path: `/elements/Task_Preparar/resources/${index}`, value: { ref: 'cajero' } }],
    });
    expect(bad.isError, index).toBe(true);
    expect(textOf(bad), index).toContain('índice inválido');
  }
});

test('la raíz no se puede parchear (path vacío) y un puntero sin `/` inicial es error', async () => {
  const path = copyAsIs();
  const root = await patch({ scenario: path, patch: [{ op: 'remove', path: '' }] });
  expect(root.isError).toBe(true);
  expect(textOf(root)).toContain('raíz');

  const bare = await patch({ scenario: path, patch: [{ op: 'replace', path: 'resources', value: {} }] });
  expect(bare.isError).toBe(true);
  expect(textOf(bare)).toContain('puntero inválido');
});

test('el patch es atómico: un `test` que falla, o una op posterior inválida, no dejan nada escrito', async () => {
  const path = copyAsIs();
  const before = readFileSync(path, 'utf8');

  const failedTest = await patch({
    scenario: path,
    patch: [
      { op: 'test', path: '/resources/cajero/capacity', value: 99 },
      { op: 'replace', path: '/resources/cajero/capacity', value: 3 },
    ],
  });
  expect(failedTest.isError).toBe(true);
  expect(textOf(failedTest)).toContain('test falló');
  expect(readFileSync(path, 'utf8')).toBe(before);

  const halfway = await patch({
    scenario: path,
    patch: [
      { op: 'replace', path: '/resources/cajero/capacity', value: 3 },
      { op: 'replace', path: '/no/existe', value: 1 },
    ],
  });
  expect(halfway.isError).toBe(true);
  expect(readFileSync(path, 'utf8')).toBe(before);

  // Y con el `test` correcto sí se aplica todo.
  const good = await patch({
    scenario: path,
    patch: [
      { op: 'test', path: '/resources/cajero/capacity', value: 2 },
      { op: 'replace', path: '/resources/cajero/capacity', value: 3 },
    ],
  });
  expect(good.isError).toBe(false);
});

/* ------------------------------------------------------------------ *
 * Rechazos del lint, sin escribir
 * ------------------------------------------------------------------ */

test('campo reservado y clave desconocida se rechazan con el mensaje del lint, sin escribir', async () => {
  const path = copyAsIs();
  const before = readFileSync(path, 'utf8');

  const reserved = await patch({
    scenario: path,
    patch: [{ op: 'add', path: '/resources/cajero/priority', value: 1 }],
  });
  expect(reserved.isError).toBe(true);
  expect(textOf(reserved)).toContain('E-RESERVADO');
  expect(readFileSync(path, 'utf8')).toBe(before);

  const unknown = await patch({
    scenario: path,
    patch: [{ op: 'add', path: '/resources/cajero/capacty', value: 3 }],
  });
  expect(unknown.isError).toBe(true);
  // El código de § 17 (LILA-198) y el texto del esquema (LILA-202): los defectos del escenario
  // parcheado pasan por `parseScenario` + `schemaIssueLines`, igual que la CLI y `run_simulation`.
  expect(textOf(unknown)).toContain('E-CLAVE-DESCONOCIDA');
  expect(textOf(unknown)).toContain('capacty');
  expect(readFileSync(path, 'utf8')).toBe(before);

  // Un defecto que caza el esquema y no el lint (LILA-198 pasó `probability` al lint): sale con
  // el texto del catálogo por `parseScenario`, no el volcado crudo de zod.
  const espanol = await patch({
    scenario: path,
    patch: [{ op: 'add', path: '/run/warmup', value: -1 }],
  });
  expect(espanol.isError).toBe(true);
  expect(textOf(espanol)).toContain('run.warmup: must be ≥ 0');
  expect(textOf(espanol)).not.toMatch(/Too big|Too small|expected/i);
  expect(readFileSync(path, 'utf8')).toBe(before);

  // R-RES-3: el mismo reservado puesto a `null` no dispara el error.
  const nulled = await patch({
    scenario: path,
    patch: [{ op: 'add', path: '/resources/cajero/priority', value: null }],
  });
  expect(nulled.isError).toBe(false);
});

test('modo (b): un patch inválido no crea ni trunca el archivo preexistente de saveTo', async () => {
  const saveTo = join(scratch, 'preexistente.scenario.json');
  writeFileSync(saveTo, 'CONTENIDO PREVIO, NO ES JSON\n');

  const result = await patch({
    scenario: pedidoScenario,
    saveTo,
    patch: [{ op: 'replace', path: '/elements/Flow_Aprobado/probability', value: 1.5 }],
  });
  expect(result.isError).toBe(true);
  expect(readFileSync(saveTo, 'utf8')).toBe('CONTENIDO PREVIO, NO ES JSON\n');
});

/* ------------------------------------------------------------------ *
 * `extends`
 * ------------------------------------------------------------------ */

test('modo (b): `extends` relativo con `..` hacia un directorio hermano', async () => {
  const padre = copyAsIs('padre.scenario.json', join(scratch, 'a'));
  const hijo = join(scratch, 'b', 'hijo.scenario.json');

  const result = await patch({
    scenario: padre,
    saveTo: hijo,
    patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
  });
  expect(result.isError).toBe(false);

  const written = JSON.parse(readFileSync(hijo, 'utf8')) as { extends: string };
  expect(written.extends).toBe('../a/padre.scenario.json');
  expect(loadResolvedScenario(hijo).resources?.['cajero']?.capacity).toBe(3);
});

test('modo (b): sobre un padre que ya tiene `extends`, el delta apunta al padre, no lo aplana', async () => {
  const abuelo = copyAsIs('abuelo.scenario.json');
  const padre = join(scratch, 'padre.scenario.json');
  const patchPadre = await patch({
    scenario: abuelo,
    saveTo: padre,
    patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
  });
  expect(patchPadre.isError).toBe(false);

  const hijo = join(scratch, 'hijo.scenario.json');
  const patchHijo = await patch({
    scenario: padre,
    saveTo: hijo,
    patch: [{ op: 'replace', path: '/resources/cocinero/capacity', value: 5 }],
  });
  expect(patchHijo.isError).toBe(false);

  const written = JSON.parse(readFileSync(hijo, 'utf8')) as { extends: string; resources: unknown };
  expect(written.extends).toBe('padre.scenario.json');
  expect(written.resources).toEqual({ cocinero: { capacity: 5 } });

  // La cadena entera se resuelve: el cajero del padre y el cocinero del hijo.
  const resolved = loadResolvedScenario(hijo);
  expect(resolved.resources?.['cajero']?.capacity).toBe(3);
  expect(resolved.resources?.['cocinero']?.capacity).toBe(5);
});

test('modo (b): un `remove` de una clave heredada se escribe como `null` (§ 6) y la borra', async () => {
  const padre = copyAsIs('padre.scenario.json');
  const hijo = join(scratch, 'sin-moneda.scenario.json');

  const result = await patch({
    scenario: padre,
    saveTo: hijo,
    patch: [
      { op: 'remove', path: '/description' },
      { op: 'remove', path: '/run/currency' },
    ],
    name: 'sin moneda',
  });
  expect(result.isError).toBe(false);

  // El delta conserva el `null`, anidado donde toca; no se aplana el `run` entero.
  const written = JSON.parse(readFileSync(hijo, 'utf8')) as Record<string, unknown>;
  expect(written['description']).toBeNull();
  expect(written['run']).toEqual({ currency: null });

  const resolved = loadResolvedScenario(hijo);
  expect(resolved.description).toBeUndefined();
  expect(resolved.run).not.toHaveProperty('currency');
  expect(resolved.run.duration).toBe(2_592_000); // el resto de `run` se hereda intacto.
});

test('modo (b): `saveTo` igual a `scenario` es un ciclo de `extends`, error y archivo intacto', async () => {
  const path = copyAsIs();
  const before = readFileSync(path, 'utf8');

  const result = await patch({
    scenario: path,
    saveTo: path,
    patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).toContain('ciclo');
  expect(readFileSync(path, 'utf8')).toBe(before);
});

test('modo (b): el error no cita el archivo de saveTo, que ni existe ni se va a escribir', async () => {
  const saveTo = join(scratch, 'fantasma.scenario.json');
  const result = await patch({
    scenario: pedidoScenario,
    saveTo,
    patch: [{ op: 'replace', path: '/elements/Flow_Aprobado/probability', value: 1.5 }],
  });
  expect(result.isError).toBe(true);
  expect(textOf(result)).not.toContain(saveTo);
  expect(textOf(result)).toContain('escenario inválido tras el patch');
  expect(existsSync(saveTo)).toBe(false);
});

test('modo (b): `extendsFrom` a un archivo que no existe es error y no escribe', async () => {
  const saveTo = join(scratch, 'huerfano.scenario.json');
  const result = await patch({
    scenario: pedidoScenario,
    saveTo,
    extendsFrom: join(scratch, 'no-existe.scenario.json'),
    patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
  });
  expect(result.isError).toBe(true);
  expect(existsSync(saveTo)).toBe(false);
});

/* ------------------------------------------------------------------ *
 * `model` heredado y contrato del modo (a)
 * ------------------------------------------------------------------ */

test('modo (b): el `model` relativo del padre sigue resolviendo desde otro directorio', async () => {
  const saveTo = join(scratch, 'sub', 'dir', 'nuevo.scenario.json');
  const result = await patch({
    scenario: pedidoScenario,
    saveTo,
    patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
  });
  expect(result.isError).toBe(false);

  // El hijo no declara `model`: lo hereda, y `resolveExtends` lo reescribe relativo al padre.
  const written = JSON.parse(readFileSync(saveTo, 'utf8')) as Record<string, unknown>;
  expect(written).not.toHaveProperty('model');
  expect(loadResolvedScenario(saveTo).model).toBe(pedidoBpmn);
});

test('modo (a): parchear en sitio un archivo con `extends` lo aplana (contrato documentado)', async () => {
  const padre = copyAsIs('padre.scenario.json');
  const hijo = join(scratch, 'hijo.scenario.json');
  writeFileSync(
    hijo,
    JSON.stringify({ version: 1, name: 'hijo', extends: 'padre.scenario.json', resources: { cajero: { capacity: 3 } } }),
  );

  const result = await patch({
    scenario: hijo,
    patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 5 }],
  });
  expect(result.isError).toBe(false);

  // Lo que queda en disco es el escenario resuelto completo, sin `extends`: `docs/MCP.md` lo dice.
  const written = JSON.parse(readFileSync(hijo, 'utf8')) as Record<string, unknown>;
  expect(written).not.toHaveProperty('extends');
  expect(written['run']).toBeDefined();
  expect(written['calendars']).toBeDefined();
  expect((written['resources'] as Record<string, { capacity: number }>)['cajero']?.capacity).toBe(5);
});
