/**
 * `patchLilaScenario` (#635): the `.lila` mode of `patch_scenario`, moved into the engine, and
 * `lila scenario patch`, which runs it from the CLI. A patch validates before it writes, a no-op
 * and a dry run write nothing, and every refusal leaves the file byte for byte as it was.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../../src/cli.js';
import { decodeLila, encodeLila, type ProcessDocument, type ProjectDocument } from '../../src/project/index.js';
import { lilaScenarioView, patchLilaScenario } from '../../src/project-fs/index.js';
import { EXAMPLE_LILA } from './export-fixture.js';

const AS_IS = 'as-is.scenario.json';
const TO_BE = 'to-be-3-cajeros.scenario.json';
const FOUR_COOKS = [
  { op: 'test', path: '/resources/cocinero/capacity', value: 3 },
  { op: 'replace', path: '/resources/cocinero/capacity', value: 4 },
];

let scratch: string;
let file: string;
let out: string[];

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lila-patch-scenario-'));
  file = join(scratch, 'pedido.lila');
  copyFileSync(EXAMPLE_LILA, file);
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

function patchFile(patch: unknown): string {
  const path = join(scratch, `patch-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(patch));
  return path;
}

function stored(): ReturnType<typeof decodeLila> {
  return decodeLila(readFileSync(file));
}

describe('patchLilaScenario', () => {
  test('in place: writes the resolved scenario without extends, and its revision goes up by one', async () => {
    const before = stored();
    const result = await patchLilaScenario({ file, scenario: 'as-is', patch: FOUR_COOKS });
    expect(result).toMatchObject({ file: file.replaceAll('\\', '/'), process: 'pedido', entry: AS_IS, written: true, dryRun: false });
    expect(result.scenario.resources?.['cocinero']?.capacity).toBe(4);

    const after = stored();
    const scenario = after.scenarios[AS_IS] as { model: string; extends?: string; resources: Record<string, { capacity: number }> };
    expect(scenario.resources['cocinero']!.capacity).toBe(4);
    expect(scenario.model).toBe('model.bpmn');
    expect(scenario.extends).toBeUndefined();
    expect(after.scenarioRevisions[AS_IS]).toBe(before.scenarioRevisions[AS_IS]! + 1);
    // The other scenario and the model are carried through unchanged.
    expect(after.scenarios[TO_BE]).toEqual(before.scenarios[TO_BE]);
    expect(after.scenarioRevisions[TO_BE]).toBe(before.scenarioRevisions[TO_BE]);
    expect(after.model).toEqual(before.model);
  });

  test('saveTo: a new scenario that extends the parent with only the keys the patch touched', async () => {
    const before = stored();
    const result = await patchLilaScenario({ file, scenario: 'as-is', patch: FOUR_COOKS, saveTo: 'to-be-4-cocineros', name: 'TO-BE 4 cooks' });
    expect(result).toMatchObject({ entry: 'to-be-4-cocineros.scenario.json', written: true });

    const after = stored();
    expect(after.scenarios['to-be-4-cocineros.scenario.json']).toEqual({
      version: 1,
      extends: AS_IS,
      resources: { cocinero: { capacity: 4 } },
      name: 'TO-BE 4 cooks',
    });
    expect(after.scenarioRevisions['to-be-4-cocineros.scenario.json']).toBe(1);
    expect(after.scenarios[AS_IS]).toEqual(before.scenarios[AS_IS]);
    const view = await lilaScenarioView({ file, scenario: 'to-be-4-cocineros', resolved: true });
    expect((view.scenario as { resources: Record<string, { capacity: number }> }).resources['cocinero']!.capacity).toBe(4);
    expect(view.runnable).toBe(true);
  });

  test('extendsFrom names the parent of the new scenario', async () => {
    await patchLilaScenario({ file, scenario: 'as-is', patch: FOUR_COOKS, saveTo: 'child', extendsFrom: 'to-be-3-cajeros' });
    expect(stored().scenarios['child.scenario.json']).toMatchObject({ extends: TO_BE });
  });

  test('a patch that changes nothing writes nothing and keeps the revision (#627)', async () => {
    const bytes = readFileSync(file);
    const result = await patchLilaScenario({ file, scenario: 'as-is', patch: [FOUR_COOKS[0]!] });
    expect(result).toMatchObject({ written: false, dryRun: false });
    expect(result.notes[0]).toMatch(/changes nothing/);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('a dry run validates, answers what it would write and writes nothing', async () => {
    const bytes = readFileSync(file);
    const inPlace = await patchLilaScenario({ file, scenario: 'as-is', patch: FOUR_COOKS, dryRun: true });
    expect(inPlace).toMatchObject({ entry: AS_IS, written: false, dryRun: true });
    expect(inPlace.scenario.resources?.['cocinero']?.capacity).toBe(4);
    expect(inPlace.notes[0]).toBe(`Dry run: the result validates and would be written to ${AS_IS}; nothing was written.`);
    const child = await patchLilaScenario({ file, scenario: 'as-is', patch: FOUR_COOKS, saveTo: 'nuevo', dryRun: true, locale: 'es' });
    expect(child).toMatchObject({ entry: 'nuevo.scenario.json', written: false, dryRun: true });
    expect(child.notes[0]).toBe('Simulacro: el resultado valida y se escribiría en nuevo.scenario.json; no se escribió nada.');
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('a dry run of an invalid patch is refused like the write', async () => {
    const bytes = readFileSync(file);
    await expect(
      patchLilaScenario({ file, scenario: 'as-is', patch: [{ op: 'replace', path: '/resources/cocinero/capacity', value: 0 }], dryRun: true }),
    ).rejects.toThrow(/invalid scenario after the patch/);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test.each([
    ['a result that does not validate', [{ op: 'replace', path: '/resources/cocinero/capacity', value: 0 }], /invalid scenario after the patch/],
    ['an unsupported operation', [{ op: 'move', path: '/resources/cocinero', from: '/resources/cajero' }], /move\/copy/],
    ['a failed test', [{ op: 'test', path: '/resources/cocinero/capacity', value: 9 }], /test/],
    ['a path that does not exist', [{ op: 'remove', path: '/resources/nadie' }], /the path \/resources\/nadie does not exist/],
    ['removing run', [{ op: 'remove', path: '/run' }], /does not declare run/],
  ])('refuses %s and writes nothing', async (_label, patch, error) => {
    const bytes = readFileSync(file);
    await expect(patchLilaScenario({ file, scenario: 'as-is', patch })).rejects.toThrow(error);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('an unknown scenario is refused and lists the ones there are', async () => {
    await expect(patchLilaScenario({ file, scenario: 'nadie', patch: FOUR_COOKS })).rejects.toThrow(/as-is\.scenario\.json/);
  });
});

describe('lila scenario patch', () => {
  test('patches in place and prints where', async () => {
    const code = await main(['scenario', 'patch', file, 'as-is', '--patch', patchFile(FOUR_COOKS)]);
    expect(code, out.join('\n')).toBe(0);
    expect(out[0]).toBe(`Saved scenario ${AS_IS} of process pedido in ${file.replaceAll('\\', '/')}.`);
    expect((stored().scenarios[AS_IS] as { resources: Record<string, { capacity: number }> }).resources['cocinero']!.capacity).toBe(4);
  });

  test('--save-to creates a child that extends the scenario; --json prints the result', async () => {
    const code = await main([
      'scenario', 'patch', file, 'as-is', '--patch', patchFile(FOUR_COOKS),
      '--save-to', 'to-be-4-cocineros', '--name', 'TO-BE 4 cooks', '--description', 'One more cook', '--json',
    ]);
    expect(code, out.join('\n')).toBe(0);
    const result = JSON.parse(out.join('\n')) as { entry: string; written: boolean; dryRun: boolean; process: string };
    expect(result).toMatchObject({ entry: 'to-be-4-cocineros.scenario.json', written: true, dryRun: false, process: 'pedido' });
    expect(stored().scenarios['to-be-4-cocineros.scenario.json']).toEqual({
      version: 1,
      extends: AS_IS,
      resources: { cocinero: { capacity: 4 } },
      name: 'TO-BE 4 cooks',
      description: 'One more cook',
    });
  });

  test('--dry-run writes nothing and says so', async () => {
    const bytes = readFileSync(file);
    const code = await main(['scenario', 'patch', file, 'as-is', '--patch', patchFile(FOUR_COOKS), '--dry-run']);
    expect(code, out.join('\n')).toBe(0);
    expect(out[0]).toBe(`Dry run: the result validates and would be written to ${AS_IS}; nothing was written.`);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('a no-op writes nothing and keeps the revision', async () => {
    const bytes = readFileSync(file);
    const code = await main(['scenario', 'patch', file, 'as-is', '--patch', patchFile([FOUR_COOKS[0]]), '--lang', 'es']);
    expect(code, out.join('\n')).toBe(0);
    expect(out[0]).toMatch(/no cambia nada/);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test.each([
    ['an invalid patch', () => ['--patch', patchFile([{ op: 'replace', path: '/resources/cocinero/capacity', value: 0 }])], /invalid scenario after the patch/],
    ['no --patch', () => [], /needs --patch <ops\.json>/],
    ['a patch that is not a list', () => ['--patch', patchFile({ op: 'replace', path: '/run/seed', value: 1 })], /must be a non-empty JSON list of operations/],
    ['an empty patch', () => ['--patch', patchFile([])], /must be a non-empty JSON list of operations/],
    ['an operation without a path', () => ['--patch', patchFile([{ op: 'remove' }])], /must be a non-empty JSON list of operations/],
    ['a patch file that does not exist', () => ['--patch', join(scratch, 'missing.json')], /missing\.json/],
  ])('%s exits 1 and writes nothing', async (_label, args, error) => {
    const bytes = readFileSync(file);
    const code = await main(['scenario', 'patch', file, 'as-is', ...args()]);
    expect(code).toBe(1);
    expect(out.join('\n')).toMatch(error);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('--process picks a process of a repository; the other one is carried through unchanged', async () => {
    const base = stored();
    const copia: ProcessDocument = {
      slug: 'copia', name: 'Copia', model: base.model, scenarios: { [AS_IS]: base.scenarios[AS_IS]! }, scenarioRevisions: { [AS_IS]: 3 }, runs: [],
    };
    const repository: ProjectDocument = { ...base, process: { slug: 'pedido', name: 'Pedido' }, processes: [copia] };
    writeFileSync(file, encodeLila(repository));
    const before = stored();
    const code = await main(['scenario', 'patch', file, 'as-is', '--process', 'copia', '--patch', patchFile(FOUR_COOKS), '--save-to', 'cuatro', '--json']);
    expect(code, out.join('\n')).toBe(0);
    expect(JSON.parse(out.join('\n'))).toMatchObject({ process: 'copia', entry: 'cuatro.scenario.json', written: true });

    const after = stored();
    const copiaAfter = after.processes!.find((p) => p.slug === 'copia')!;
    expect(copiaAfter.scenarios['cuatro.scenario.json']).toMatchObject({ extends: AS_IS, resources: { cocinero: { capacity: 4 } } });
    expect(copiaAfter.scenarioRevisions[AS_IS]).toBe(3);
    // The first process (the top level of a repository) is untouched.
    expect(after.scenarios).toEqual(before.scenarios);
    expect(after.scenarioRevisions).toEqual(before.scenarioRevisions);
    expect(after.model).toEqual(before.model);
  });

  test('a missing --patch file is named in the language of the call', async () => {
    expect(await main(['scenario', 'patch', file, 'as-is', '--patch', join(scratch, 'nada.json'), '--lang', 'es'])).toBe(1);
    expect(out.join('\n')).toMatch(/no existe el archivo .*nada\.json/);
  });

  test('the wrong number of positionals is a usage error', async () => {
    expect(await main(['scenario', 'patch', file, '--patch', patchFile(FOUR_COOKS)])).toBe(1);
    expect(out.join('\n')).toMatch(/<project\.lila> <scenario>/);
  });

  test('`lila scenario` lists patch among its subcommands', async () => {
    expect(await main(['scenario', 'nada'])).toBe(1);
    expect(out.join('\n')).toMatch(/import, template, show, patch/);
  });
});
