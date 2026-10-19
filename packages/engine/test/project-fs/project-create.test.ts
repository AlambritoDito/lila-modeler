/**
 * `lila project create` (#635): `create_project` from the CLI, over the same `createLilaProject`.
 * The file it writes is one `lila project show` reads; an existing file is refused, byte for byte
 * untouched, unless `--force`.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../../src/cli.js';
import { decodeLila } from '../../src/project/index.js';
import { lilaProjectInventory } from '../../src/project-fs/index.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const pedidoBpmn = join(repo, 'examples/pedido/model.bpmn');
const pedidoAsIs = join(repo, 'examples/pedido/as-is.scenario.json');
const pedidoToBe = join(repo, 'examples/pedido/to-be-3-cajeros.scenario.json');

let scratch: string;
let out: string[];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lila-project-create-'));
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

describe('lila project create', () => {
  test('creates a .lila that lila project show reads', async () => {
    const file = join(scratch, 'orders.lila');
    const code = await main([
      'project', 'create', file, '--name', 'Orders', '--bpmn', pedidoBpmn,
      '--scenario', `as-is=${pedidoAsIs}`, '--scenario', `to-be-3-cajeros=${pedidoToBe}`,
    ]);
    expect(code, out.join('\n')).toBe(0);
    expect(out[0]).toBe(`Created project "Orders" (${file.replaceAll('\\', '/')}), process Process_Restaurante.`);
    expect(out).toContain('  as-is.scenario.json: can run');
    expect(out).toContain('  to-be-3-cajeros.scenario.json: can run');

    const document = decodeLila(readFileSync(file));
    expect(document.name).toBe('Orders');
    expect(document.model.xml).toBe(readFileSync(pedidoBpmn, 'utf8'));
    expect(document.scenarios['to-be-3-cajeros.scenario.json']).toEqual(JSON.parse(readFileSync(pedidoToBe, 'utf8')));

    out = [];
    expect(await main(['project', 'show', file, '--json'])).toBe(0);
    const inventory = JSON.parse(out.join('\n')) as Awaited<ReturnType<typeof lilaProjectInventory>>;
    expect(inventory).toEqual(await lilaProjectInventory({ file }));
    expect(inventory).toMatchObject({ name: 'Orders', formatVersion: 1 });
    expect(inventory.processes[0]!.scenarios.map((s) => s.entry)).toEqual(['as-is.scenario.json', 'to-be-3-cajeros.scenario.json']);
  });

  test('--json prints the result of create_project; a draft scenario is kept with its errors', async () => {
    const draft = join(scratch, 'draft.json');
    writeFileSync(draft, JSON.stringify({ version: 1, elements: { Nadie: {} } }));
    const file = join(scratch, 'draft.lila');
    const code = await main(['project', 'create', file, '--name', 'Draft', '--bpmn', pedidoBpmn, '--scenario', `borrador=${draft}`, '--json']);
    expect(code, out.join('\n')).toBe(0);
    const result = JSON.parse(out.join('\n')) as { file: string; processId: string; scenarios: { entry: string; runnable: boolean; errors: string[] }[] };
    expect(result.processId).toBe('Process_Restaurante');
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]).toMatchObject({ entry: 'borrador.scenario.json', runnable: false });
    expect(result.scenarios[0]!.errors.length).toBeGreaterThan(0);
    expect(decodeLila(readFileSync(file)).scenarios['borrador.scenario.json']).toEqual({ model: 'model.bpmn', version: 1, elements: { Nadie: {} } });
  });

  test('an existing file is refused without --force and replaced with it', async () => {
    const file = join(scratch, 'orders.lila');
    expect(await main(['project', 'create', file, '--name', 'First', '--bpmn', pedidoBpmn])).toBe(0);
    const bytes = readFileSync(file);

    out = [];
    expect(await main(['project', 'create', file, '--name', 'Second', '--bpmn', pedidoBpmn])).toBe(1);
    expect(out.join('\n')).toMatch(/already exists; nothing was written\. Pass --force/);
    expect(readFileSync(file).equals(bytes)).toBe(true);

    out = [];
    expect(await main(['project', 'create', file, '--name', 'Second', '--bpmn', pedidoBpmn, '--force']), out.join('\n')).toBe(0);
    expect(decodeLila(readFileSync(file)).name).toBe('Second');
  });

  test('a model with validation errors is refused unless --allow-unsimulatable', async () => {
    const model = join(repo, 'packages/engine/test/fixtures/boundary-event.bpmn');
    const file = join(scratch, 'boundary.lila');
    expect(await main(['project', 'create', file, '--name', 'B', '--bpmn', model])).toBe(1);
    expect(existsSync(file)).toBe(false);

    out = [];
    expect(await main(['project', 'create', file, '--name', 'B', '--bpmn', model, '--allow-unsimulatable']), out.join('\n')).toBe(0);
    expect(out.some((line) => line.startsWith('warning '))).toBe(true);
  });

  test.each([
    ['no --name', ['--bpmn', pedidoBpmn], /needs --name <name>/],
    ['no --bpmn', ['--name', 'X'], /needs --bpmn <file\.bpmn>/],
    ['a --scenario without =', ['--name', 'X', '--bpmn', pedidoBpmn, '--scenario', 'as-is'], /--scenario takes key=value/],
    ['a --scenario file that does not exist', ['--name', 'X', '--bpmn', pedidoBpmn, '--scenario', 'as-is=missing.json'], /missing\.json/],
  ])('%s exits 1 and writes nothing', async (_label, args, error) => {
    const file = join(scratch, 'x.lila');
    expect(await main(['project', 'create', file, ...args])).toBe(1);
    expect(out.join('\n')).toMatch(error);
    expect(existsSync(file)).toBe(false);
  });

  test('a .lila path that is a folder is refused, with --force too', async () => {
    const folder = join(scratch, 'folder.lila');
    mkdirSync(folder);
    for (const force of [[], ['--force']]) {
      out = [];
      expect(await main(['project', 'create', folder, '--name', 'X', '--bpmn', pedidoBpmn, ...force])).toBe(1);
      expect(out.join('\n')).toMatch(/is a directory; nothing was written/);
    }
  });

  test('two --scenario with the same name are refused', async () => {
    const file = join(scratch, 'dup.lila');
    expect(await main(['project', 'create', file, '--name', 'X', '--bpmn', pedidoBpmn, '--scenario', `a=${pedidoAsIs}`, '--scenario', `a=${pedidoToBe}`])).toBe(1);
    expect(out.join('\n')).toMatch(/two scenarios would be saved as a\.scenario\.json/);
    expect(existsSync(file)).toBe(false);
  });

  test('a missing --scenario file is named in the language of the call', async () => {
    expect(await main(['project', 'create', join(scratch, 'x.lila'), '--name', 'X', '--bpmn', pedidoBpmn, '--scenario', 'a=', '--lang', 'es'])).toBe(1);
    expect(out.join('\n')).toMatch(/no existe/);
  });

  test('a path that is not a .lila is refused', async () => {
    expect(await main(['project', 'create', join(scratch, 'x.zip'), '--name', 'X', '--bpmn', pedidoBpmn])).toBe(1);
    expect(out.join('\n')).toMatch(/is not a \.lila path/);
  });

  test('`lila project` lists create among its subcommands', async () => {
    expect(await main(['project', 'nada'])).toBe(1);
    expect(out.join('\n')).toMatch(/show, create/);
  });
});
