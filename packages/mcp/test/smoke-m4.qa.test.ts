/**
 * QA adversarial de LILA-056: `lila mcp` como **proceso**, no como servidor en memoria.
 *
 * `e2e.test.ts` ya cubre el camino feliz de los dos flujos de M4. Aquí se ataca lo que solo se ve
 * cuando el servidor es un proceso de verdad detrás de un pipe: paridad byte a byte con la CLI,
 * el cwd contra el que se resuelven las rutas, el framing de stdout (un `console.log` de más lo
 * rompe), el cierre sin zombies, y la coherencia entre `docs/MCP.md` y las tools que el servidor
 * sirve de verdad. Más los dos defectos que encontró esta ronda en `patch_scenario` (ver los dos
 * últimos tests).
 *
 * Requiere `dist/` (`npm run build`).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, expect, test } from 'vitest';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const lilaBin = join(repo, 'packages/engine/bin/lila.js');
const asIs = 'examples/pedido/as-is.scenario.json';
const modelo = 'examples/pedido/model.bpmn';

let client: Client;
let temp: string;

function textOf(result: { content: unknown }): string {
  return (result.content as { type: string; text: string }[])[0]?.text ?? '';
}

function jsonOf(result: { content: unknown }): any {
  return JSON.parse(textOf(result));
}

/** Un cliente propio contra `lila mcp` lanzado en `cwd`. Quien lo pide, lo cierra. */
async function connect(cwd: string): Promise<Client> {
  const c = new Client({ name: 'lila-qa-m4', version: '0' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: [lilaBin, 'mcp'], cwd }));
  return c;
}

beforeAll(async () => {
  temp = mkdtempSync(join(tmpdir(), 'lila-mcp-qa-m4-'));
  client = await connect(repo);
}, 120_000);

afterAll(async () => {
  await client.close();
  rmSync(temp, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ *
 * Prueba de humo: los dos flujos de la aceptación, contra la CLI
 * ------------------------------------------------------------------ */

test('humo (a): run_simulation da el mismo bottlenecks[0] y los mismos bytes que `lila run --json`', async () => {
  const viaTool = join(temp, 'humo-run-tool.json');
  const viaCli = join(temp, 'humo-run-cli.json');

  const result = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: asIs, seed: 42, saveTo: viaTool },
  });
  expect(result.isError ?? false).toBe(false);

  execFileSync(process.execPath, [lilaBin, 'run', modelo, asIs, '--seed', '42', '--json', viaCli], {
    cwd: repo,
    stdio: 'ignore',
  });

  // El JSON que la tool devuelve, el que escribe con `saveTo` y el de la CLI son el mismo.
  expect(jsonOf(result).bottlenecks[0]).toEqual(JSON.parse(readFileSync(viaCli, 'utf8')).bottlenecks[0]);
  expect(readFileSync(viaTool, 'utf8')).toBe(readFileSync(viaCli, 'utf8'));
  expect(jsonOf(result).bottlenecks[0].elementId).toBe('Task_Preparar');
}, 120_000);

test('humo (b): "agrego un cajero" — extends en un directorio ajeno y compare byte a byte con la CLI', async () => {
  const saveTo = join(temp, 'to-be-cajero.scenario.json');

  const patched = await client.callTool({
    name: 'patch_scenario',
    arguments: {
      scenario: asIs,
      patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }],
      saveTo,
      name: 'TO-BE 3 cajeros (QA)',
    },
  });
  expect(patched.isError ?? false).toBe(false);

  // El archivo nuevo vive fuera del repo: su `extends` tiene que seguir apuntando al AS-IS.
  const escrito = JSON.parse(readFileSync(saveTo, 'utf8'));
  expect(escrito.extends).toBeTypeOf('string');
  expect(escrito.resources).toEqual({ cajero: { capacity: 3 } });
  expect(jsonOf(patched).scenario.resources.cajero.capacity).toBe(3);
  expect(jsonOf(patched).scenario.resources.cocinero.capacity).toBe(3); // heredado del AS-IS

  const viaTool = join(temp, 'humo-compare-tool.json');
  const viaCli = join(temp, 'humo-compare-cli.json');
  const compared = await client.callTool({
    name: 'compare_scenarios',
    arguments: { scenarios: [asIs, saveTo], seed: 42, saveTo: viaTool },
  });
  expect(compared.isError ?? false).toBe(false);

  execFileSync(
    process.execPath,
    [lilaBin, 'compare', modelo, asIs, saveTo, '--seed', '42', '--json', viaCli],
    { cwd: repo, stdio: 'ignore' },
  );
  expect(readFileSync(viaTool, 'utf8')).toBe(readFileSync(viaCli, 'utf8'));

  const rows = jsonOf(compared).comparison.rows as {
    kpi: string;
    base: number | null;
    values: (number | null)[];
    significant: boolean[];
  }[];
  const espera = rows.find((row) => row.kpi === 'elements.Task_TomarPedido.resourceWait.mean')!;
  expect(espera).toBeDefined();
  expect(espera.values[1]).toBeLessThan(espera.base!);
  expect(espera.significant[1]).toBe(true);
}, 120_000);

/* ------------------------------------------------------------------ *
 * Ataques al proceso
 * ------------------------------------------------------------------ */

test('las rutas se resuelven contra el cwd del servidor, no contra el repo', async () => {
  const otro = await connect(temp);
  try {
    // La misma ruta relativa que funciona desde el repo no existe desde el cwd del servidor.
    const relativa = await otro.callTool({ name: 'validate_bpmn', arguments: { path: modelo } });
    expect(relativa.isError).toBe(true);
    expect(textOf(relativa)).toContain(join(temp, modelo));

    // Y una absoluta funciona desde cualquier cwd: es lo que documenta `docs/MCP.md` § Rutas.
    const absoluta = await otro.callTool({ name: 'validate_bpmn', arguments: { path: join(repo, modelo) } });
    expect(absoluta.isError ?? false).toBe(false);
    expect(jsonOf(absoluta).errors).toEqual([]);
  } finally {
    await otro.close();
  }
}, 120_000);

test('extends cíclico y XML impenetrable: isError con el motivo, y el servidor sigue sirviendo', async () => {
  const a = join(temp, 'ciclo-a.scenario.json');
  const b = join(temp, 'ciclo-b.scenario.json');
  execFileSync('/bin/sh', ['-c', `printf '%s' '{"version":1,"extends":"ciclo-b.scenario.json"}' > ${a}`]);
  execFileSync('/bin/sh', ['-c', `printf '%s' '{"version":1,"extends":"ciclo-a.scenario.json"}' > ${b}`]);

  const ciclo = await client.callTool({ name: 'run_simulation', arguments: { scenario: a } });
  expect(ciclo.isError).toBe(true);
  expect(textOf(ciclo)).toContain('ciclo en la cadena de herencia');

  const basura = await client.callTool({ name: 'describe_process', arguments: { xml: 'no soy xml <<<' } });
  expect(basura.isError).toBe(true);
  expect(textOf(basura).startsWith('describe_process: ')).toBe(true);

  // Un escenario ilegible en `describe_process` no es un fallo de la tool: lo dice en el resumen.
  const conCiclo = await client.callTool({
    name: 'describe_process',
    arguments: { path: modelo, scenario: a },
  });
  expect(conCiclo.isError ?? false).toBe(false);
  expect(jsonOf(conCiclo).resumen).toContain('no se pudo leer el escenario');

  expect((await client.listTools()).tools).toHaveLength(5);
}, 120_000);

test('dos llamadas concurrentes se responden las dos, sin mezclarse', async () => {
  const [simulacion, validacion] = await Promise.all([
    client.callTool({ name: 'run_simulation', arguments: { scenario: asIs, seed: 7, replications: 2 } }),
    client.callTool({ name: 'validate_bpmn', arguments: { path: modelo } }),
  ]);
  expect(simulacion.isError ?? false).toBe(false);
  expect(validacion.isError ?? false).toBe(false);
  expect(jsonOf(simulacion).replications.count).toBe(2);
  expect(jsonOf(validacion).ir.id).toBe('Process_Restaurante');
}, 120_000);

test('stdout solo lleva protocolo, stderr queda limpio y el proceso muere al cerrar stdin', async () => {
  const child = spawn(process.execPath, [lilaBin, 'mcp'], { cwd: repo, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (chunk) => (out += String(chunk)));
  child.stderr.on('data', (chunk) => (err += String(chunk)));
  const send = (msg: unknown): void => void child.stdin.write(`${JSON.stringify(msg)}\n`);

  send({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'qa', version: '0' } },
  });
  await new Promise((r) => setTimeout(r, 500));
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  // Una llamada que simula (la que más código de motor arrastra) y una que falla.
  send({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'run_simulation', arguments: { scenario: asIs, seed: 1, replications: 2 } },
  });
  send({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'validate_bpmn', arguments: { path: 'no-existe.bpmn' } },
  });

  const salida = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
  await new Promise((r) => setTimeout(r, 8_000));
  const lineas = out.split('\n').filter((line) => line.trim() !== '');
  expect(lineas.length).toBeGreaterThanOrEqual(3);
  for (const linea of lineas) expect(JSON.parse(linea).jsonrpc).toBe('2.0');
  expect(err).toBe('');

  // Cerrar stdin (lo que hace un cliente MCP al terminar) tiene que bastar: nada de zombies.
  child.stdin.end();
  const code = await Promise.race([salida, new Promise((r) => setTimeout(() => r('sigue vivo'), 10_000))]);
  expect(code).toBe(0);
}, 120_000);

test('`.mcp.json` del repo apunta a un comando que existe tras `npm run build`', () => {
  const config = JSON.parse(readFileSync(join(repo, '.mcp.json'), 'utf8'));
  const lila = config.mcpServers.lila;
  expect(lila.command).toBe('node');
  // Las rutas de `args` son relativas a la raíz del proyecto, que es el cwd que usa Claude Code.
  const script = join(repo, lila.args[0]);
  expect(existsSync(script)).toBe(true);
  expect(existsSync(join(repo, 'packages/engine/dist/cli.js'))).toBe(true);
  expect(existsSync(join(repo, 'packages/mcp/dist/server.js'))).toBe(true);
  expect(lila.args[1]).toBe('mcp');
});

test('`lila mcp` con argumentos de más falla en español; `--help` imprime la ayuda', () => {
  // Los dos casos que **no** arrancan servidor, que son los que alguien escribe a mano. El test
  // anterior solo comprobaba que el proceso nacía (`pid > 0`) y lo mataba: `lila mcp de-más`
  // podía haber arrancado el servidor igualmente y nadie se enteraba.
  const sobra = spawnSync(process.execPath, [lilaBin, 'mcp', 'de-más'], { cwd: repo, encoding: 'utf8' });
  expect(sobra.status).toBe(1);
  expect(sobra.stderr).toContain('lila mcp: no acepta argumentos.');
  expect(sobra.stdout).toBe(''); // stdout es el transporte: nada que no sea protocolo.

  const ayuda = spawnSync(process.execPath, [lilaBin, 'mcp', '--help'], { cwd: repo, encoding: 'utf8' });
  expect(ayuda.status).toBe(0);
  expect(ayuda.stdout).toContain('lila mcp');
  expect(ayuda.stdout).toContain('Arranca el servidor MCP por stdio');
}, 120_000);

test('docs/MCP.md documenta las tools reales, con los argumentos reales', async () => {
  const doc = readFileSync(join(repo, 'docs/MCP.md'), 'utf8');
  const { tools } = await client.listTools();

  const firmas = new Map<string, Set<string>>();
  for (const [, name, args] of doc.matchAll(/`(\w+)\(\{([^}]*)\}\)`/g)) {
    const claves = args
      .split(/[,|]/)
      .map((clave) => clave.trim().replace(/\?$/, ''))
      .filter((clave) => clave !== '');
    // La primera aparición es la firma de la lista de tools; las de más abajo son ejemplos con
    // valores concretos (`run_simulation({ "scenario": …, "seed": 42 })`), que no son firmas.
    if (!firmas.has(name!)) firmas.set(name!, new Set(claves));
  }

  expect([...firmas.keys()].sort()).toEqual(tools.map((tool) => tool.name).sort());
  for (const tool of tools) {
    const documentados = firmas.get(tool.name)!;
    const reales = Object.keys((tool.inputSchema as { properties?: object }).properties ?? {});
    expect([...documentados].sort(), `argumentos de ${tool.name}`).toEqual(reales.sort());
  }
}, 120_000);

/* ------------------------------------------------------------------ *
 * Defectos encontrados en esta ronda (`patch_scenario`, modo (a))
 * ------------------------------------------------------------------ */

/** Copia del AS-IS y su modelo a `dir`, con el `model` relativo tal cual lo declara el repo. */
function copiaConModeloRelativo(dir: string, nombre: string): string {
  copyFileSync(join(repo, modelo), join(dir, 'model.bpmn'));
  const destino = join(dir, nombre);
  copyFileSync(join(repo, asIs), destino);
  return destino;
}

test('modo (a): un patch que deja el escenario sin `run` se rechaza, no se escribe un archivo ilegible', async () => {
  const escenario = copiaConModeloRelativo(temp, 'sin-run.scenario.json');
  const antes = readFileSync(escenario, 'utf8');

  const patched = await client.callTool({
    name: 'patch_scenario',
    arguments: { scenario: escenario, patch: [{ op: 'remove', path: '/run' }] },
  });
  expect(patched.isError).toBe(true);
  expect(readFileSync(escenario, 'utf8')).toBe(antes);

  // Lo mismo con `model`: el mensaje es del dominio, no un TypeError de `node:path` filtrado.
  const sinModelo = copiaConModeloRelativo(temp, 'sin-model.scenario.json');
  const roto = await client.callTool({
    name: 'patch_scenario',
    arguments: { scenario: sinModelo, patch: [{ op: 'remove', path: '/model' }] },
  });
  expect(roto.isError).toBe(true);
  expect(textOf(roto)).not.toContain('must be of type string');
  expect(textOf(roto)).toContain('model');
}, 120_000);

test('modo (a): el escenario reescrito conserva el `model` relativo, no la ruta de esta máquina', async () => {
  const escenario = copiaConModeloRelativo(temp, 'en-sitio.scenario.json');

  const patched = await client.callTool({
    name: 'patch_scenario',
    arguments: { scenario: escenario, patch: [{ op: 'replace', path: '/resources/cajero/capacity', value: 3 }] },
  });
  expect(patched.isError ?? false).toBe(false);

  const onDisk = JSON.parse(readFileSync(escenario, 'utf8'));
  expect(onDisk.resources.cajero.capacity).toBe(3);
  // Un escenario con la ruta absoluta de quien corrió la tool deja de resolver en otro checkout.
  expect(onDisk.model).toBe('model.bpmn');

  // Y sigue resolviendo: el archivo reescrito simula.
  const corrida = await client.callTool({
    name: 'run_simulation',
    arguments: { scenario: escenario, replications: 1 },
  });
  expect(corrida.isError ?? false).toBe(false);
}, 120_000);
