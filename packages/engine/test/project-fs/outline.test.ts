/**
 * `createLilaProcess` / `readLilaOutline` (#97): an outline becomes `processes/<slug>/` of a
 * `.lila` (or a new `.lila`), every other process byte for byte as it was; an existing process is
 * never replaced. Also `lila process create|show`, the CLI over the same two functions.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { normalizeOutline, OutlineError } from '../../src/bpmn/outline.js';
import { main } from '../../src/cli.js';
import { decodeLila, encodeLila, processesOf, withProcesses } from '../../src/project/index.js';
import { createLilaProcess, readLilaOutline } from '../../src/project-fs/index.js';
import { CREDIT, ORDER } from '../fixtures/outlines.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const exampleLila = join(repo, 'examples/pedido.lila');
const exampleOutline = join(repo, 'examples/outline/credit-application.json');

let out: string[];
let scratch: string;

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  scratch = mkdtempSync(join(tmpdir(), 'lila-outline-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

/** A repository with two processes: pedido and a renamed copy of it. */
function repository(): string {
  const pedido = decodeLila(new Uint8Array(readFileSync(exampleLila)));
  const [first] = processesOf(pedido);
  const document = withProcesses(pedido, [first!, { ...first!, slug: 'copia', name: 'Copia' }]);
  const file = join(scratch, 'repo.lila');
  writeFileSync(file, encodeLila(document));
  return file;
}

function entries(file: string): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(readFileSync(file)));
}

describe('createLilaProcess', () => {
  test('a new .lila: one process, written as a version 1 project, that validates and runs', async () => {
    const file = join(scratch, 'credit.lila');
    const created = await createLilaProcess(file, CREDIT);
    expect(created).toMatchObject({ slug: 'credit-application', name: 'Credit application', newFile: true, dryRun: false });
    expect(created.summary).toContain('Created process "Credit application" (credit-application) in the new file');
    expect(created.outline).toEqual(normalizeOutline(CREDIT));

    const document = decodeLila(new Uint8Array(readFileSync(file)));
    expect(document.processes).toBeUndefined();
    expect(document.model.id).toBe('Process_credit_application');
    expect(Object.keys(document.scenarios)).toEqual(['as-is.scenario.json']);

    expect(await main(['validate', file])).toBe(0);
    expect(await main(['run', file, 'as-is', '--replications', '1'])).toBe(0);
  });

  test('into a repository: the new process is appended, the others stay byte-identical', async () => {
    const file = repository();
    const before = entries(file);
    const created = await createLilaProcess(file, CREDIT);
    expect(created.slugs).toEqual(['pedido', 'copia', 'credit-application']);

    const after = entries(file);
    for (const [name, bytes] of Object.entries(before)) {
      if (name === 'lila-project.json') continue;
      expect(after[name], name).toEqual(bytes);
    }
    expect(Object.keys(after).filter((name) => !(name in before)).sort()).toEqual([
      'processes/credit-application/as-is.scenario.json',
      'processes/credit-application/model.bpmn',
    ]);
    const manifest = JSON.parse(new TextDecoder().decode(after['lila-project.json']));
    expect(manifest.processes.map((p: { slug: string }) => p.slug)).toEqual(['pedido', 'copia', 'credit-application']);
  });

  test('into a one-process .lila: it becomes a repository, the first process unchanged', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    const before = decodeLila(new Uint8Array(readFileSync(file)));
    await createLilaProcess(file, CREDIT, { process: 'credito', name: 'Crédito' });
    const [pedido, credit] = processesOf(decodeLila(new Uint8Array(readFileSync(file))));
    expect(pedido!.model.xml).toBe(before.model.xml);
    expect(pedido!.scenarios).toEqual(before.scenarios);
    expect(credit).toMatchObject({ slug: 'credito', name: 'Crédito' });
    expect(credit!.model.xml).toContain('name="Crédito"');
  });

  test('never replaces a process: the same slug twice is refused and the file is untouched', async () => {
    const file = repository();
    await expect(createLilaProcess(file, ORDER, { process: 'copia' })).rejects.toThrow(
      `already has a process "copia"; nothing was written`,
    );
    await createLilaProcess(file, CREDIT);
    const bytes = readFileSync(file);
    await expect(createLilaProcess(file, CREDIT)).rejects.toThrow('already has a process "credit-application"');
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('dry run: everything checked, nothing written', async () => {
    const fresh = join(scratch, 'fresh.lila');
    const dry = await createLilaProcess(fresh, CREDIT, { dryRun: true, locale: 'es' });
    expect(dry.dryRun).toBe(true);
    expect(dry.summary).toContain('Simulacro');
    expect(existsSync(fresh)).toBe(false);

    const file = repository();
    const bytes = readFileSync(file);
    await createLilaProcess(file, ORDER, { dryRun: true });
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('a bad outline, slug or path writes nothing', async () => {
    const file = repository();
    const bytes = readFileSync(file);
    await expect(createLilaProcess(file, { name: 'X', steps: [{ id: 'a', next: 'b' }] })).rejects.toBeInstanceOf(OutlineError);
    await expect(createLilaProcess(file, CREDIT, { process: 'Not A Slug' })).rejects.toThrow('not a valid process slug');
    await expect(createLilaProcess(join(scratch, 'x.bpmn'), CREDIT)).rejects.toThrow('is not a .lila file');
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('refuses when the file changed on disk after it was opened', async () => {
    const file = repository();
    // Simulate a concurrent writer: the first call creates, the second one opened the old version.
    const results = await Promise.allSettled([
      createLilaProcess(file, CREDIT),
      createLilaProcess(file, ORDER),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    // Either both succeeded one after the other (each opened a fresh copy) or the second was refused.
    for (const r of rejected) expect(String((r as PromiseRejectedResult).reason)).toContain('changed on disk');
    const slugs = processesOf(decodeLila(new Uint8Array(readFileSync(file)))).map((p) => p.slug);
    expect(slugs.slice(0, 2)).toEqual(['pedido', 'copia']);
    expect(slugs.length).toBe(4 - rejected.length);
  });
});

describe('readLilaOutline', () => {
  test('round trip through the .lila, durations and probabilities from as-is', async () => {
    const file = repository();
    await createLilaProcess(file, ORDER);
    const read = await readLilaOutline(file, { process: 'order-fulfilment' });
    expect(read).toMatchObject({ slug: 'order-fulfilment', name: 'Order fulfilment', warnings: [] });
    expect(read.outline).toEqual(normalizeOutline(ORDER));
  });

  test('a process Lila did not generate still reads, with what was left out', async () => {
    const read = await readLilaOutline(exampleLila);
    expect(read.slug).toBe('pedido');
    expect(read.outline.name).toBe('Restaurant');
    expect(read.outline.steps.map((s) => s.id)).toContain('Task_TomarPedido');
    // The XOR's rejected branch goes straight to an end event: it reads as a branch that ends.
    const approval = read.outline.steps.find((s) => s.id === 'Gateway_Aprobacion')!;
    expect(approval.branches).toContainEqual(expect.objectContaining({ end: true, probability: 0.22 }));
  });
});

describe('lila process', () => {
  test('create, then show, from the documented example outline', async () => {
    const file = join(scratch, 'credit.lila');
    expect(await main(['process', 'create', '--outline', exampleOutline, '-p', file])).toBe(0);
    expect(out.join('\n')).toContain('Created process "Credit application" (credit-application)');

    out.length = 0;
    expect(await main(['process', 'show', '-p', file])).toBe(0);
    expect(out[0]).toBe('Process "Credit application" (credit-application)');
    expect(out.join('\n')).toContain('ok  xor  "Approved?"  [Analyst] → Yes: issue (0.7) | No: reject (0.3)');

    out.length = 0;
    expect(await main(['process', 'show', '-p', file, '--json'])).toBe(0);
    expect(JSON.parse(out.join('\n')).outline).toEqual(normalizeOutline(CREDIT));
  });

  test('--dry-run --json, --name and --process', async () => {
    const file = repository();
    const bytes = readFileSync(file);
    expect(await main(['process', 'create', '--outline', exampleOutline, '-p', file, '--name', 'Tarjeta', '--process', 'tarjeta', '--dry-run', '--json'])).toBe(0);
    const result = JSON.parse(out.join('\n'));
    expect(result).toMatchObject({ slug: 'tarjeta', name: 'Tarjeta', dryRun: true, newFile: false });
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('errors exit 1 with a message, in the chosen language', async () => {
    const file = repository();
    expect(await main(['process', 'create', '--outline', exampleOutline, '-p', file, '--process', 'copia', '--lang', 'es'])).toBe(1);
    expect(out.join('\n')).toContain('lila process: ');
    expect(out.join('\n')).toContain('ya tiene un proceso "copia"');
    out.length = 0;
    expect(await main(['process', 'create', '-p', file])).toBe(1);
    expect(out.join('\n')).toContain('missing --outline');
    out.length = 0;
    expect(await main(['process', 'list', '-p', file])).toBe(1);
    expect(out.join('\n')).toContain('unknown subcommand "list"');
    out.length = 0;
    expect(await main(['process', 'show'])).toBe(1);
    expect(out.join('\n')).toContain('missing -p/--project');
    out.length = 0;
    expect(await main(['process', 'create', '--outline', join(scratch, 'none.json'), '-p', file])).toBe(1);
    expect(out.join('\n')).toContain('cannot read the outline');
  });
});
