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
import { outlineToBpmn } from '../../src/bpmn/outline.js';
import { decodeLila, encodeLila, processesOf, processIds, withProcesses, type ProcessDocument } from '../../src/project/index.js';
import { createLilaProcess, deleteLilaProcess, editLilaProcess, readLilaProcessBpmn } from '../../src/project-fs/index.js';
import { CREDIT, ORDER } from '../fixtures/outlines.js';

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

  test('after a remove the process still simulates: the entries of removed ids go, reported with their values', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    const dry = await editLilaProcess(file, [{ op: 'remove', id: 'Task_Revisar' }], { dryRun: true });
    const edited = await editLilaProcess(file, [{ op: 'remove', id: 'Task_Revisar' }]);
    expect(dry.scenarioRemovals).toEqual(edited.scenarioRemovals);
    expect(edited.removed).toEqual(['Flow_Revisar_Aprobacion', 'Task_Revisar']);
    const previous = { processingTime: { type: 'constant', value: 90 }, resources: [{ ref: 'cajero' }, { ref: 'cocinero' }], selection: 'or' };
    expect(edited.scenarioRemovals).toEqual([{ scenario: 'as-is.scenario.json', id: 'Task_Revisar', removed: previous, entry: true }]);
    expect(edited.notes).toEqual([
      `as-is.scenario.json: removed elements.Task_Revisar ${JSON.stringify(previous)}, which no longer applies to the model; patch_scenario can put it back on another element.`,
    ]);
    const document = decodeLila(new Uint8Array(readFileSync(file)));
    expect((document.scenarios['as-is.scenario.json']!.elements as Record<string, unknown>)['Task_Revisar']).toBeUndefined();
    expect(document.scenarioRevisions['as-is.scenario.json']).toBe(2);
    expect(await main(['run', file, 'as-is', '--replications', '1'])).toBe(0);
    expect(await main(['run', file, 'to-be-3-cajeros', '--replications', '1'])).toBe(0);
  });

  test('after setType the process still simulates: fields the new type cannot take go, reported', async () => {
    const file = join(scratch, 'pedido.lila');
    writeFileSync(file, readFileSync(exampleLila));
    // A task with a duration becomes a sub-process; a task with resources becomes a gateway.
    const edited = await editLilaProcess(file, [
      { op: 'setType', id: 'Task_TomarPedido', type: 'subprocess' },
      { op: 'setType', id: 'Task_Preparar', type: 'xor' },
    ]);
    expect(edited.scenarioRemovals).toEqual([
      {
        scenario: 'as-is.scenario.json',
        id: 'Task_TomarPedido',
        removed: { processingTime: { type: 'triangular', min: 60, mode: 120, max: 300 }, resources: [{ ref: 'cajero', quantity: 1 }], fixedCost: 2.5 },
        entry: true,
      },
      {
        scenario: 'as-is.scenario.json',
        id: 'Task_Preparar',
        // The scenario format still accepts a time on a gateway: only the resources go.
        removed: { resources: [{ ref: 'cocinero' }, { ref: 'horno' }], selection: 'and' },
        entry: false,
      },
    ]);
    expect(await main(['run', file, 'as-is', '--replications', '1'])).toBe(0);

    // Only what no longer applies goes: a timer keeps its delay but not its resources.
    const timer = join(scratch, 'timer.lila');
    writeFileSync(timer, readFileSync(exampleLila));
    const retimed = await editLilaProcess(timer, [{ op: 'setType', id: 'Task_TomarPedido', type: 'timer' }]);
    expect(retimed.scenarioRemovals).toEqual([
      { scenario: 'as-is.scenario.json', id: 'Task_TomarPedido', removed: { resources: [{ ref: 'cajero', quantity: 1 }] }, entry: false },
    ]);
    expect(await main(['run', timer, 'as-is', '--replications', '1'])).toBe(0);
  });

  test('#631: removing a boundary timer removes its delay; an xor retyped to an and loses its branch probabilities', async () => {
    const file = join(scratch, 'credit.lila');
    await createLilaProcess(file, CREDIT);
    const added = await editLilaProcess(file, [
      { op: 'addBoundary', on: 'check', boundary: { id: 'sla', type: 'timer', duration: '48h', interrupting: false, to: 'reject' } },
    ]);
    expect(added.scenarioRemovals).toEqual([]);
    let document = decodeLila(new Uint8Array(readFileSync(file)));
    expect((document.scenarios['as-is.scenario.json']!.elements as Record<string, unknown>)['sla']).toEqual({ processingTime: { type: 'constant', value: 172800 } });

    const removed = await editLilaProcess(file, [{ op: 'remove', id: 'sla' }]);
    expect(removed.scenarioRemovals).toEqual([
      { scenario: 'as-is.scenario.json', id: 'sla', removed: { processingTime: { type: 'constant', value: 172800 } }, entry: true },
    ]);
    document = decodeLila(new Uint8Array(readFileSync(file)));
    expect((document.scenarios['as-is.scenario.json']!.elements as Record<string, unknown>)['sla']).toBeUndefined();

    const retyped = await editLilaProcess(file, [{ op: 'setType', id: 'ok', type: 'and' }]);
    expect(retyped.scenarioRemovals).toEqual([
      { scenario: 'as-is.scenario.json', id: 'Flow_ok_issue', removed: { probability: 0.7 }, entry: true },
      { scenario: 'as-is.scenario.json', id: 'Flow_ok_reject', removed: { probability: 0.3 }, entry: true },
    ]);
    expect(await main(['run', file, 'as-is', '--replications', '1'])).toBe(0);
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
    expect(out.join('\n')).toContain('la edición se rechazó; no se cambió nada:\n  operations[0].id: no se puede quitar "Gateway_ANDFork"');
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

describe('setCalledProcess (#664)', () => {
  /** A .lila with ORDER (its call activity `fix`) and CREDIT. */
  async function calls(): Promise<string> {
    const file = join(scratch, 'calls.lila');
    await createLilaProcess(file, ORDER);
    await createLilaProcess(file, CREDIT);
    return file;
  }
  const processOf = (file: string, slug: string) => processesOf(decodeLila(new Uint8Array(readFileSync(file)))).find((p) => p.slug === slug)!;
  const fix = (xml: string): string => /<bpmn:callActivity id="fix"[^>]*>/.exec(xml)![0];

  test('writes calledElement = the target\'s model.id (get_process_bpmn shows it); the revision goes up by one; delete_process of the target is refused', async () => {
    const file = await calls();
    const target = processOf(file, 'credit-application');
    const revision = processOf(file, 'order-fulfilment').model.revision;
    const edited = await editLilaProcess(file, [{ op: 'setCalledProcess', id: 'fix', process: 'credit-application' }], { process: 'order-fulfilment' });
    expect(edited.changes).toEqual([{ op: 0, message: '"fix" now calls Credit application (credit-application)' }]);
    const read = await readLilaProcessBpmn(file, { process: 'order-fulfilment' });
    expect(fix(read.xml)).toContain(`calledElement="${target.model.id}"`);
    expect(read.revision).toBe(revision + 1);
    // The target and its scenarios are untouched.
    expect(processOf(file, 'credit-application')).toEqual(target);

    const hash = sha(file);
    await expect(deleteLilaProcess({ file, process: 'credit-application' })).rejects.toThrow('order-fulfilment/fix (Fix)');
    expect(sha(file)).toBe(hash);

    // null removes it, and the target can then go.
    const cleared = await editLilaProcess(file, [{ op: 'setCalledProcess', id: 'fix', process: null }], { process: 'order-fulfilment' });
    expect(cleared.changes).toEqual([{ op: 0, message: '"fix" no longer calls a process' }]);
    const after = processOf(file, 'order-fulfilment');
    expect(fix(after.model.xml)).not.toContain('calledElement');
    expect(after.model.revision).toBe(revision + 2);
    await expect(deleteLilaProcess({ file, process: 'credit-application', dryRun: true })).resolves.toMatchObject({ dryRun: true, process: 'credit-application' });
  });

  test('dryRun writes nothing; unknown slug, own slug, a step that is not a call activity: refused, nothing written', async () => {
    const file = await calls();
    const hash = sha(file);
    const dry = await editLilaProcess(file, [{ op: 'setCalledProcess', id: 'fix', process: 'credit-application' }], { process: 'order-fulfilment', dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, changes: [{ op: 0, message: '"fix" now calls Credit application (credit-application)' }] });
    expect(sha(file)).toBe(hash);

    const refusal = async (ops: unknown[]): Promise<EditError> => {
      const error = await editLilaProcess(file, ops, { process: 'order-fulfilment' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(EditError);
      return error as EditError;
    };
    const error = await refusal([
      { op: 'setCalledProcess', id: 'fix', process: 'billing' },
      { op: 'setCalledProcess', id: 'fix', process: 'order-fulfilment' },
      { op: 'setCalledProcess', id: 'take', process: 'credit-application' },
    ]);
    expect(error.issues.map((i) => [i.op, i.path, i.message])).toEqual([
      [0, 'process', 'the project has no process "billing"; the processes a call activity can call are: credit-application.'],
      [1, 'process', '"order-fulfilment" has the BPMN process id Process_order_fulfilment, that of the process being edited: a call activity cannot call its own process.'],
      [2, 'id', '"take" is a userTask, not a call activity (callActivity); only a call activity calls a process.'],
    ]);
    // A valid operation next to a refused one is not written either.
    await refusal([
      { op: 'setCalledProcess', id: 'fix', process: 'credit-application' },
      { op: 'setCalledProcess', id: 'fix', process: 'nope' },
    ]);
    expect(sha(file)).toBe(hash);
  });

  test('lila process edit passes it through (--dry-run, then written; es refusal exits 1)', async () => {
    const file = await calls();
    const hash = sha(file);
    const ops = join(scratch, 'call.json');
    writeFileSync(ops, JSON.stringify([{ op: 'setCalledProcess', id: 'fix', process: 'credit-application' }]));
    expect(await main(['process', 'edit', '-p', file, '--process', 'order-fulfilment', '--ops', ops, '--dry-run'])).toBe(0);
    expect(out).toContain('  0: "fix" now calls Credit application (credit-application)');
    expect(sha(file)).toBe(hash);
    expect(await main(['process', 'edit', '-p', file, '--process', 'order-fulfilment', '--ops', ops])).toBe(0);
    expect(fix(processOf(file, 'order-fulfilment').model.xml)).toContain('calledElement="Process_credit_application"');

    out = [];
    const written = sha(file);
    writeFileSync(ops, JSON.stringify([{ op: 'setCalledProcess', id: 'fix', process: 'nope' }]));
    expect(await main(['process', 'edit', '-p', file, '--process', 'order-fulfilment', '--ops', ops, '--lang', 'es'])).toBe(1);
    expect(out.join('\n')).toContain('operations[0].process: el proyecto no tiene un proceso "nope"; los procesos a los que una actividad de llamada puede llamar son: credit-application.');
    expect(sha(file)).toBe(written);
  });

  /** A process whose model is `xml` (BPMN process id(s) as given) and whose manifest says `id`. */
  const made = (slug: string, xml: string, id: string, scenarios: ProcessDocument['scenarios'] = {}): ProcessDocument => ({
    slug,
    name: slug.toUpperCase(),
    model: { id, name: 'model.bpmn', xml, revision: 1 },
    scenarios,
    scenarioRevisions: Object.fromEntries(Object.keys(scenarios).map((k) => [k, 1])),
    runs: [],
  });
  /** `extra` written next to the processes of `file`. */
  const add = (file: string, extra: ProcessDocument[]): void => {
    const document = decodeLila(new Uint8Array(readFileSync(file)));
    writeFileSync(file, encodeLila(withProcesses(document, [...processesOf(document), ...extra])));
  };
  const built = async (outline: unknown, processId: string) => {
    const { xml, scenario } = await outlineToBpmn(outline, { processId });
    return { xml, scenarios: { 'as-is.scenario.json': scenario } };
  };

  test('a BPMN process id two processes declare is refused, both ways: the call could not tell them apart', async () => {
    const file = join(scratch, 'shared.lila');
    const billing = await built(ORDER, 'Process_1');
    const shipping = await built(CREDIT, 'Process_1');
    const twin = await built(CREDIT, 'Process_Twin');
    await createLilaProcess(file, CREDIT);
    add(file, [
      made('billing', billing.xml, 'Process_1', billing.scenarios),
      made('shipping', shipping.xml, 'Process_1', shipping.scenarios),
      made('b', twin.xml, 'Process_Twin', twin.scenarios),
      made('c', twin.xml, 'Process_Twin', twin.scenarios),
    ]);
    const hash = sha(file);
    const error = await editLilaProcess(
      file,
      [
        { op: 'setCalledProcess', id: 'fix', process: 'c' },
        { op: 'setCalledProcess', id: 'fix', process: 'shipping' },
        { op: 'setCalledProcess', id: 'fix', process: 'billing' },
      ],
      { process: 'billing' },
    ).catch((e: unknown) => e as EditError);
    expect(error).toBeInstanceOf(EditError);
    const shared = (slug: string, id: string, other: string): string =>
      `"${slug}" has the BPMN process id ${id}, which "${other}" declares too: a call activity cannot tell them apart; give one of them another id (put_process_bpmn with mode "replace").`;
    expect((error as EditError).issues.map((i) => [i.op, i.path, i.message])).toEqual([
      [0, 'process', shared('c', 'Process_Twin', 'b')],
      // The process being edited declares it: not "its own process", another one with the same id.
      [1, 'process', shared('shipping', 'Process_1', 'billing')],
      [2, 'process', '"billing" has the BPMN process id Process_1, that of the process being edited: a call activity cannot call its own process.'],
    ]);
    expect(sha(file)).toBe(hash);
    // A process with an id of its own can still be called.
    const ok = await editLilaProcess(file, [{ op: 'setCalledProcess', id: 'fix', process: 'credit-application' }], { process: 'billing' });
    expect(ok.changes[0]!.message).toBe('"fix" now calls Credit application (credit-application)');
  });

  test('a manifest model.id the model does not declare: its only process, else the one it simulates, else refused', async () => {
    const file = await calls();
    const stale = await built(CREDIT, 'Process_stale');
    const pedido = processesOf(decodeLila(new Uint8Array(readFileSync(exampleLila))))[0]!;
    expect(processIds(pedido.model.xml)).toEqual(['Process_Restaurante', 'Process_Cliente']);
    add(file, [
      made('stale', stale.xml, 'b9c1e6a0-uuid', stale.scenarios),
      { ...pedido, slug: 'pedido', model: { ...pedido.model, id: 'e2a1-uuid' } },
      made('lost', '<definitions><process id="Process_A"><process id="Process_B">', 'e2a1-uuid'),
    ]);

    await editLilaProcess(file, [{ op: 'setCalledProcess', id: 'fix', process: 'stale' }], { process: 'order-fulfilment' });
    expect(fix(processOf(file, 'order-fulfilment').model.xml)).toContain('calledElement="Process_stale"');
    await expect(deleteLilaProcess({ file, process: 'stale', dryRun: true })).rejects.toThrow('order-fulfilment/fix (Fix)');

    await editLilaProcess(file, [{ op: 'setCalledProcess', id: 'fix', process: 'pedido' }], { process: 'order-fulfilment' });
    expect(fix(processOf(file, 'order-fulfilment').model.xml)).toContain('calledElement="Process_Restaurante"');
    await expect(deleteLilaProcess({ file, process: 'pedido', dryRun: true })).rejects.toThrow('order-fulfilment/fix (Fix)');

    const hash = sha(file);
    const error = await editLilaProcess(file, [{ op: 'setCalledProcess', id: 'fix', process: 'lost' }], { process: 'order-fulfilment' }).catch((e: unknown) => e as EditError);
    expect(error).toBeInstanceOf(EditError);
    expect((error as EditError).issues).toEqual([
      {
        op: 0,
        path: 'process',
        message: 'cannot tell which BPMN process of "lost" to call: its model declares Process_A, Process_B, and none of them is its model id or the process it simulates.',
      },
    ]);
    expect(sha(file)).toBe(hash);
  });
});
