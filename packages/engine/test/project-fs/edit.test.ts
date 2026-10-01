/**
 * `editLilaProcess` (#98): edits one process of a `.lila` through `writeLilaProject` — every other
 * process byte for byte, nothing written when an operation is wrong, a concurrent edit refused
 * rather than lost — and `lila process edit`, the CLI over the same function.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { unzipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { EditError } from '../../src/bpmn/edit.js';
import { main } from '../../src/cli.js';
import { decodeLila, encodeLila, processesOf, withProcesses } from '../../src/project/index.js';
import { createLilaProcess, editLilaProcess } from '../../src/project-fs/index.js';
import { CREDIT } from '../fixtures/outlines.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const exampleLila = join(repo, 'examples/pedido.lila');
const exampleOps = join(repo, 'examples/outline/pedido-edit.json');

let out: string[];
let scratch: string;

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  scratch = mkdtempSync(join(tmpdir(), 'lila-edit-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

const sha = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** A repository with pedido and a copy of it, plus the credit process. */
async function repository(): Promise<string> {
  const pedido = decodeLila(new Uint8Array(readFileSync(exampleLila)));
  const [first] = processesOf(pedido);
  const file = join(scratch, 'repo.lila');
  writeFileSync(file, encodeLila(withProcesses(pedido, [first!, { ...first!, slug: 'copia', name: 'Copia' }])));
  await createLilaProcess(file, CREDIT);
  return file;
}

function entries(file: string): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(readFileSync(file)));
}

describe('editLilaProcess', () => {
  test('edits one process; the others stay byte-identical; revisions go up', async () => {
    const file = await repository();
    const before = entries(file);
    const edited = await editLilaProcess(
      file,
      [
        { op: 'add', step: { id: 'verify', name: 'Verify identity', duration: '5m' }, after: 'receive' },
        { op: 'remove', id: 'reject' },
      ],
      { process: 'credit-application' },
    );
    expect(edited).toMatchObject({ slug: 'credit-application', dryRun: false, removed: ['Flow_reject_EndEvent_reject', 'reject'] });
    expect(edited.summary).toBe(`Edited process "Credit application" (credit-application) in ${edited.file}: 2 operations, 2 elements removed.`);
    expect(edited.outline.steps.map((s) => s.id)).toEqual(['receive', 'verify', 'check', 'ok', 'issue']);

    const after = entries(file);
    for (const [name, bytes] of Object.entries(before)) {
      if (name.startsWith('processes/credit-application/') || name === 'lila-project.json') continue;
      expect(after[name], name).toEqual(bytes);
    }
    const credit = processesOf(decodeLila(new Uint8Array(readFileSync(file)))).find((p) => p.slug === 'credit-application')!;
    expect(credit.model.revision).toBe(2);
    expect(credit.scenarioRevisions['as-is.scenario.json']).toBe(2);
    expect((credit.scenarios['as-is.scenario.json']!.elements as Record<string, unknown>)['verify']).toEqual({
      processingTime: { type: 'constant', value: 300 },
    });
    expect(await main(['run', file, 'as-is', '--process', 'credit-application', '--replications', '1'])).toBe(0);
  });

  test('a refused edit leaves the file untouched and lists every problem', async () => {
    const file = await repository();
    const hash = sha(file);
    const error = await editLilaProcess(
      file,
      [
        { op: 'rename', id: 'receive', name: 'ok' },
        { op: 'connect', from: 'receive', to: 'nope' },
        { op: 'remove', id: 'StartEvent' },
      ],
      { process: 'credit-application' },
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EditError);
    expect((error as EditError).issues).toEqual([{ op: 1, path: 'to', message: '"nope" is not the id of an element of the model.' }]);
    expect(sha(file)).toBe(hash);

    // An edit that applies but would not validate is refused too.
    const invalid = await editLilaProcess(file, [{ op: 'remove', id: 'StartEvent' }], { process: 'credit-application' }).catch((e: unknown) => e);
    expect((invalid as EditError).message).toContain('E-SIN-START');
    expect(sha(file)).toBe(hash);
  });

  test('dry run: the result, nothing written', async () => {
    const file = await repository();
    const hash = sha(file);
    const edited = await editLilaProcess(file, [{ op: 'rename', id: 'check', name: 'Bureau' }], { process: 'credit-application', dryRun: true });
    expect(edited.dryRun).toBe(true);
    expect(edited.summary).toContain('Dry run: would edit process "Credit application"');
    expect(edited.outline.steps[1]).toMatchObject({ id: 'check', name: 'Bureau' });
    expect(sha(file)).toBe(hash);
  });

  test('scenario entries of removed elements are reported and kept', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    const edited = await editLilaProcess(file, [{ op: 'remove', id: 'Task_Revisar' }]);
    expect(edited.removed).toEqual(['Flow_Revisar_Aprobacion', 'Task_Revisar']);
    expect(edited.scenarioEntries).toEqual([{ scenario: 'as-is.scenario.json', ids: ['Task_Revisar'] }]);
    expect(edited.notes).toEqual(['as-is.scenario.json still has entries for removed elements (Task_Revisar); they were kept.']);
    const document = decodeLila(new Uint8Array(readFileSync(file)));
    expect((document.scenarios['as-is.scenario.json']!.elements as Record<string, unknown>)['Task_Revisar']).toBeDefined();
    expect(document.model.xml).not.toContain('Task_Revisar"');
  });

  test('two concurrent edits: one is written, the other is refused, nothing is lost', async () => {
    const file = await repository();
    const results = await Promise.allSettled([
      editLilaProcess(file, [{ op: 'rename', id: 'check', name: 'First' }], { process: 'credit-application' }),
      editLilaProcess(file, [{ op: 'rename', id: 'receive', name: 'Second' }], { process: 'credit-application' }),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]!.reason)).toContain('changed on disk while this call was working on it; nothing was written');
    const xml = processesOf(decodeLila(new Uint8Array(readFileSync(file)))).find((p) => p.slug === 'credit-application')!.model.xml;
    const won = results[0]!.status === 'fulfilled' ? 'First' : 'Second';
    expect(xml).toContain(`name="${won}"`);
    // The refused one can simply be retried on the new version.
    const retry = won === 'First' ? { op: 'rename', id: 'receive', name: 'Second' } : { op: 'rename', id: 'check', name: 'First' };
    await editLilaProcess(file, [retry], { process: 'credit-application' });
    const final = processesOf(decodeLila(new Uint8Array(readFileSync(file)))).find((p) => p.slug === 'credit-application')!.model.xml;
    expect(final).toContain('name="First"');
    expect(final).toContain('name="Second"');
  });
});

describe('lila process edit', () => {
  test('edits, prints one line per operation, and the result validates and runs', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    expect(await main(['process', 'edit', '-p', file, '--ops', exampleOps])).toBe(0);
    expect(out[0]).toBe(`Edited process "pedido" (pedido) in ${file}: 6 operations, 0 elements removed.`);
    expect(out[1]).toBe('  0: added task "Task_Cobrar" after "Task_TomarPedido"');
    expect(await main(['validate', file])).toBe(0);
    expect(await main(['run', file, 'as-is', '--replications', '1'])).toBe(0);
  });

  test('--no-layout --json --dry-run; es messages; a refused edit exits 1 with the problems', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    const hash = sha(file);
    expect(await main(['process', 'edit', '-p', file, '--ops', exampleOps, '--no-layout', '--dry-run', '--json'])).toBe(0);
    const result = JSON.parse(out.join('\n'));
    expect(result).toMatchObject({ slug: 'pedido', dryRun: true, removed: [] });
    expect(result.changes).toHaveLength(6);
    expect(sha(file)).toBe(hash);

    out = [];
    const ops = join(scratch, 'bad.json');
    writeFileSync(ops, JSON.stringify([{ op: 'remove', id: 'Gateway_ANDFork' }]));
    expect(await main(['process', 'edit', '-p', file, '--ops', ops, '--lang', 'es'])).toBe(1);
    expect(out.join('\n')).toContain('la edición se rechazó; no se cambió nada:\n  operations[0] id: no se puede quitar "Gateway_ANDFork"');
    expect(sha(file)).toBe(hash);

    out = [];
    expect(await main(['process', 'edit', '-p', file])).toBe(1);
    expect(out.join('\n')).toContain('missing --ops <ops.json>.');
    out = [];
    writeFileSync(ops, '{ nope');
    expect(await main(['process', 'edit', '-p', file, '--ops', ops])).toBe(1);
    expect(out.join('\n')).toContain(`cannot read the operations ${ops}`);
  });
});
