/**
 * `readLilaProcessBpmn` / `putLilaProcessBpmn` (#632): the raw BPMN of one process of a `.lila`,
 * read back as stored, added as a new process or replacing a model — validated, laid out when it
 * has no diagram, its scenarios pruned and checked, written atomically or not at all — and
 * `lila process export-bpmn|import`, the CLI over the same two functions.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { main } from '../../src/cli.js';
import { decodeLila, DEFAULT_ARRIVALS, DEFAULT_RUN, processesOf } from '../../src/project/index.js';
import {
  createLilaProcess,
  createLilaProject,
  editLilaProcess,
  lilaScenarioView,
  openLilaProcess,
  putLilaProcessBpmn,
  readLilaProcessBpmn,
  writeLilaScenario,
} from '../../src/project-fs/index.js';
import { CREDIT } from '../fixtures/outlines.js';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const exampleLila = join(repo, 'examples/pedido.lila');
const bizagi = (name: string): string => join(repo, `examples/bizagi-exports/bizagi-miwg-${name}-roundtrip.bpmn`);

let out: string[];
let scratch: string;

beforeEach(() => {
  out = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void out.push(args.join(' ')));
  scratch = mkdtempSync(join(tmpdir(), 'lila-process-bpmn-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

function pedido(): string {
  const file = join(scratch, 'pedido.lila');
  copyFileSync(exampleLila, file);
  return file;
}

async function credit(): Promise<string> {
  const file = join(scratch, 'credit.lila');
  await createLilaProcess(file, CREDIT);
  return file;
}

const processes = (file: string) => processesOf(decodeLila(new Uint8Array(readFileSync(file))));

/** `xml` without its diagram (BPMN DI). */
const withoutDiagram = (xml: string): string => xml.replace(/<(\w+:)?BPMNDiagram[\s\S]*<\/(\w+:)?BPMNDiagram>/, '');

describe('putLilaProcessBpmn mode add', () => {
  test('adds a Bizagi export to a version 1 project, which becomes a repository; pedido stays as it was', async () => {
    const file = pedido();
    const [before] = processes(file);
    const added = await putLilaProcessBpmn({ file, mode: 'add', bpmn: bizagi('A.1.0') });
    expect(added).toMatchObject({
      mode: 'add',
      slug: 'bizagi-miwg-a-1-0-roundtrip',
      name: 'bizagi-miwg-A.1.0-roundtrip',
      processId: 'WFP-6-',
      revision: 1,
      dryRun: false,
      laidOut: false,
      scenarioRemovals: [],
      notes: [],
      slugs: ['pedido', 'bizagi-miwg-a-1-0-roundtrip'],
    });
    expect(added.summary).toBe(`Added process "bizagi-miwg-A.1.0-roundtrip" (bizagi-miwg-a-1-0-roundtrip) to ${added.file}.`);

    const [first, second] = processes(file);
    expect(first).toEqual(before);
    expect(second!.model).toEqual({ id: 'WFP-6-', name: 'model.bpmn', xml: readFileSync(bizagi('A.1.0'), 'utf8'), revision: 1 });
    // The default scenario: the app's arrivals on the start event, a minute on each task.
    const scenario = second!.scenarios['as-is.scenario.json'] as { run: unknown; elements: Record<string, Record<string, unknown>> };
    expect(scenario.run).toEqual(DEFAULT_RUN);
    const starts = Object.values(scenario.elements).filter((e) => 'triggerCount' in e);
    expect(starts).toEqual([{ ...DEFAULT_ARRIVALS }]);
    expect(Object.values(scenario.elements).filter((e) => 'processingTime' in e).length).toBeGreaterThan(0);
    expect((await lilaScenarioView({ file, process: added.slug, scenario: 'as-is' })).runnable).toBe(true);
  });

  test('a slug already in the file is refused and nothing is written; name and process pick another', async () => {
    const file = pedido();
    await putLilaProcessBpmn({ file, mode: 'add', bpmn: bizagi('A.1.0') });
    const bytes = readFileSync(file);
    await expect(putLilaProcessBpmn({ file, mode: 'add', bpmn: bizagi('A.1.0') })).rejects.toThrow(
      /already has a process "bizagi-miwg-a-1-0-roundtrip"; nothing was written/,
    );
    expect(readFileSync(file).equals(bytes)).toBe(true);
    const named = await putLilaProcessBpmn({ file, mode: 'add', bpmn: bizagi('A.1.0'), name: 'Copy of A.1.0' });
    expect([named.slug, named.name]).toEqual(['copy-of-a-1-0', 'Copy of A.1.0']);
    const slugged = await putLilaProcessBpmn({ file, mode: 'add', bpmn: bizagi('A.1.0'), process: 'third' });
    expect(slugged.slugs).toEqual(['pedido', 'bizagi-miwg-a-1-0-roundtrip', 'copy-of-a-1-0', 'third']);
  });

  test('the .lila has to exist, the mode has to be add or replace, the slug has to be one', async () => {
    const missing = join(scratch, 'nope.lila');
    await expect(putLilaProcessBpmn({ file: missing, mode: 'add', bpmn: bizagi('A.1.0') })).rejects.toThrow(
      /nope\.lila does not exist; nothing was written\. .*create_project/,
    );
    const file = pedido();
    await expect(putLilaProcessBpmn({ file, mode: 'upsert', bpmn: bizagi('A.1.0') })).rejects.toThrow('mode must be "add" or "replace"; got "upsert".');
    await expect(putLilaProcessBpmn({ file, mode: 'add', bpmn: bizagi('A.1.0'), process: 'Bad Slug' })).rejects.toThrow(/is not a valid process slug/);
    await expect(putLilaProcessBpmn({ file, mode: 'add', bpmn: join(scratch, 'none.bpmn') })).rejects.toThrow(/none\.bpmn/);
  });

  test('a model with validation errors (A.3.0) is refused, and kept with allowUnsimulatable', async () => {
    const file = pedido();
    const bytes = readFileSync(file);
    await expect(putLilaProcessBpmn({ file, mode: 'add', bpmn: bizagi('A.3.0') })).rejects.toThrow(
      /^the model has 7 validation errors; nothing was written: E-NOSOP: .*pass allowUnsimulatable \(--allow-unsimulatable\)\.$/s,
    );
    expect(readFileSync(file).equals(bytes)).toBe(true);

    const kept = await putLilaProcessBpmn({ file, mode: 'add', bpmn: bizagi('A.3.0'), allowUnsimulatable: true, process: 'escalations' });
    expect(kept.notes).toHaveLength(7);
    expect(kept.notes[0]).toMatch(/^does not simulate: E-NOSOP: /);
    expect(kept.notes.some((note) => note.startsWith('does not simulate: E-INALCANZABLE: '))).toBe(true);
    // Nothing marks it: «not simulable» is what the validator says of it.
    const view = await lilaScenarioView({ file, process: 'escalations', scenario: 'as-is' });
    expect(view.runnable).toBe(false);
    expect(view.notes[0]).toMatch(/^E-NOSOP: /);
  });

  test('a file that is not XML, not BPMN or has no process is refused even with allowUnsimulatable', async () => {
    const file = pedido();
    const bytes = readFileSync(file);
    const noProcess = '<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="d"/>';
    for (const bpmn of ['<not xml', '<a/>', noProcess]) {
      await expect(putLilaProcessBpmn({ file, mode: 'add', bpmn, allowUnsimulatable: true })).rejects.toThrow(/^the BPMN cannot be read; nothing was written: /);
    }
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('a model without a diagram is laid out, unless layout is false', async () => {
    const file = pedido();
    const bare = withoutDiagram(readFileSync(bizagi('A.1.0'), 'utf8'));
    expect(bare).not.toContain('BPMNShape');
    const drawn = await putLilaProcessBpmn({ file, mode: 'add', bpmn: bare, process: 'drawn' });
    expect(drawn.laidOut).toBe(true);
    expect((await readLilaProcessBpmn(file, { process: 'drawn' })).xml).toContain('BPMNShape');
    const kept = await putLilaProcessBpmn({ file, mode: 'add', bpmn: bare, process: 'kept', layout: false });
    expect(kept.laidOut).toBe(false);
    expect((await readLilaProcessBpmn(file, { process: 'kept' })).xml).toBe(bare);
  });

  test('dryRun checks everything and leaves the bytes as they were', async () => {
    const file = pedido();
    const bytes = readFileSync(file);
    const dry = await putLilaProcessBpmn({ file, mode: 'add', bpmn: bizagi('A.1.0'), dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.summary).toMatch(/^Dry run: would add process .* Nothing was written\.$/);
    expect(dry.slugs).toEqual(['pedido', 'bizagi-miwg-a-1-0-roundtrip']);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });
});

describe('putLilaProcessBpmn mode replace', () => {
  test('prunes the scenario entries that no longer apply, as edit_process does, and bumps the revisions', async () => {
    const file = await credit();
    const xml = (await readLilaProcessBpmn(file)).xml;
    // The same model without the "check" step, built the way edit_process builds it.
    const edited = await editLilaProcess(file, [{ op: 'remove', id: 'check' }], { dryRun: true });
    const scratchCopy = join(scratch, 'copy.lila');
    copyFileSync(file, scratchCopy);
    await editLilaProcess(scratchCopy, [{ op: 'remove', id: 'check' }]);
    const without = (await readLilaProcessBpmn(scratchCopy)).xml;
    expect(without).not.toBe(xml);

    const replaced = await putLilaProcessBpmn({ file, mode: 'replace', bpmn: without });
    expect(replaced.scenarioRemovals).toEqual(edited.scenarioRemovals);
    expect(replaced.scenarioRemovals).toEqual([
      { scenario: 'as-is.scenario.json', id: 'check', removed: { processingTime: { type: 'normal', mean: 1200, sd: 300 } }, entry: true },
    ]);
    expect(replaced.notes).toEqual(edited.notes.filter((note) => note.includes('removed elements.')));
    expect(replaced).toMatchObject({ mode: 'replace', slug: 'credit-application', name: 'Credit application', revision: 2, processId: 'Process_credit_application' });
    expect(replaced.summary).toBe(`Replaced the model of process "Credit application" (credit-application) in ${replaced.file}: revision 2.`);
    const [stored] = processes(file);
    expect(stored!.model.xml).toBe(without);
    expect(stored!.scenarioRevisions['as-is.scenario.json']).toBe(2);
    expect((stored!.scenarios['as-is.scenario.json'] as { elements: object }).elements).not.toHaveProperty('check');
  });

  test('a scenario error the old model did not cause refuses it; allowUnsimulatable saves it with the error in notes', async () => {
    const file = await credit();
    // A scenario that stops by its arrivals only: without its start event, nothing stops it.
    const lila = await openLilaProcess(file);
    const scenario = lila.process.scenarios['as-is.scenario.json'] as { run: Record<string, unknown> };
    const { duration: _duration, ...run } = scenario.run;
    await writeLilaScenario(lila, 'as-is.scenario.json', { ...scenario, run });
    const renamed = (await readLilaProcessBpmn(file)).xml.replaceAll('StartEvent', 'Begin');
    const bytes = readFileSync(file);

    await expect(putLilaProcessBpmn({ file, mode: 'replace', bpmn: renamed })).rejects.toThrow(
      /^the new model would leave a scenario with errors it did not have; nothing was written:\n {2}as-is\.scenario\.json: run\.duration: E-SIN-PARADA: /,
    );
    expect(readFileSync(file).equals(bytes)).toBe(true);

    const kept = await putLilaProcessBpmn({ file, mode: 'replace', bpmn: renamed, allowUnsimulatable: true });
    expect(kept.scenarioRemovals.map((r) => r.id)).toEqual(['StartEvent']);
    expect(kept.notes.at(-1)).toMatch(/^as-is\.scenario\.json cannot run as it is: run\.duration: E-SIN-PARADA: /);
    expect((await lilaScenarioView({ file, scenario: 'as-is' })).runnable).toBe(false);
  });

  test('name is refused, the process is picked like everywhere, and the other processes stay byte for byte', async () => {
    const file = pedido();
    await putLilaProcessBpmn({ file, mode: 'add', bpmn: bizagi('A.1.0') });
    const xml = (await readLilaProcessBpmn(file, { process: 'pedido' })).xml;
    await expect(putLilaProcessBpmn({ file, mode: 'replace', bpmn: xml, name: 'Other' })).rejects.toThrow(/keeps its name/);
    await expect(putLilaProcessBpmn({ file, mode: 'replace', bpmn: xml })).rejects.toThrow(/holds several processes \(pedido, bizagi-miwg-a-1-0-roundtrip\)/);
    const [, before] = processes(file);
    const replaced = await putLilaProcessBpmn({ file, mode: 'replace', process: 'pedido', bpmn: xml.replace('name="Take order"', 'name="Take the order"') });
    expect(replaced.revision).toBe(2);
    expect(processes(file)[1]).toEqual(before);
    expect((await readLilaProcessBpmn(file, { process: 'pedido' })).xml).toContain('name="Take the order"');
  });

  test('dryRun leaves the bytes as they were', async () => {
    const file = await credit();
    const bytes = readFileSync(file);
    const xml = (await readLilaProcessBpmn(file)).xml;
    const dry = await putLilaProcessBpmn({ file, mode: 'replace', bpmn: xml.replace('Check bureau', 'Check'), dryRun: true });
    expect(dry.revision).toBe(2);
    expect(readFileSync(file).equals(bytes)).toBe(true);
  });

  test('E-CAMBIO-EXTERNO: of two concurrent replaces one is written, the other refused with nothing lost', async () => {
    const file = await credit();
    const xml = (await readLilaProcessBpmn(file)).xml;
    const results = await Promise.allSettled([
      putLilaProcessBpmn({ file, mode: 'replace', bpmn: xml.replace('Check bureau', 'First') }),
      putLilaProcessBpmn({ file, mode: 'replace', bpmn: xml.replace('Check bureau', 'Second') }),
    ]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: 'E-CAMBIO-EXTERNO' });
    const won = results[0]!.status === 'fulfilled' ? 'First' : 'Second';
    expect((await readLilaProcessBpmn(file)).xml).toContain(`name="${won}"`);
  });
});

describe('readLilaProcessBpmn', () => {
  test('returns the model as stored, with its revision and process id', async () => {
    const file = pedido();
    const read = await readLilaProcessBpmn(file);
    const [stored] = processes(file);
    expect(read).toEqual({ file: read.file, process: 'pedido', processId: stored!.model.id, revision: stored!.model.revision, xml: stored!.model.xml });
  });
});

describe('createLilaProject allowUnsimulatable', () => {
  test('a model with errors is refused with a hint, and kept with the flag, errors in notes', async () => {
    const path = join(scratch, 'docs.lila');
    await expect(createLilaProject({ path, name: 'Docs', bpmn: bizagi('A.3.0') })).rejects.toThrow(/pass allowUnsimulatable/);
    const created = await createLilaProject({ path, name: 'Docs', bpmn: bizagi('A.3.0'), allowUnsimulatable: true });
    expect(created.notes).toHaveLength(7);
    expect(created.notes[0]).toMatch(/^does not simulate: E-NOSOP: /);
    const valid = await createLilaProject({ path: join(scratch, 'ok.lila'), name: 'Ok', bpmn: bizagi('A.1.0') });
    expect(valid.notes).toEqual([]);
  });
});

describe('lila process export-bpmn and import', () => {
  test('export-bpmn prints the XML or writes it, refusing an existing file unless --force', async () => {
    const file = pedido();
    const xml = (await readLilaProcessBpmn(file)).xml;
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await main(['process', 'export-bpmn', '-p', file])).toBe(0);
    expect(write).toHaveBeenCalledWith(xml);
    const target = join(scratch, 'out.bpmn');
    expect(await main(['process', 'export-bpmn', '-p', file, '--out', target])).toBe(0);
    expect(out.at(-1)).toBe(`BPMN: ${target}`);
    expect(readFileSync(target, 'utf8')).toBe(xml);
    expect(await main(['process', 'export-bpmn', '-p', file, '--out', target])).toBe(1);
    expect(await main(['process', 'export-bpmn', '-p', file, '--out', target, '--force'])).toBe(0);
  });

  test('import adds, --replace replaces, --allow-unsimulatable keeps, --json prints the result', async () => {
    const file = pedido();
    expect(await main(['process', 'import', '-p', file, '--bpmn', bizagi('A.1.0'), '--dry-run'])).toBe(0);
    expect(out.at(-1)).toMatch(/^Dry run: would add process "bizagi-miwg-A.1.0-roundtrip"/);
    expect(processes(file)).toHaveLength(1);

    out = [];
    expect(await main(['process', 'import', '-p', file, '--bpmn', bizagi('A.3.0')])).toBe(1);
    expect(out[0]).toMatch(/^lila process: the model has 7 validation errors/);
    out = [];
    expect(await main(['process', 'import', '-p', file, '--bpmn', bizagi('A.3.0'), '--allow-unsimulatable', '--process', 'docs'])).toBe(0);
    expect(out[0]).toMatch(/^Added process "bizagi-miwg-A.3.0-roundtrip" \(docs\)/);
    expect(out[1]).toMatch(/^warning does not simulate: E-NOSOP: /);

    const source = join(scratch, 'pedido.bpmn');
    writeFileSync(source, (await readLilaProcessBpmn(file, { process: 'pedido' })).xml.replace('name="Take order"', 'name="Order"'));
    out = [];
    expect(await main(['process', 'import', '-p', file, '--bpmn', source, '--replace', '--process', 'pedido', '--json'])).toBe(0);
    expect(JSON.parse(out.join('\n'))).toMatchObject({ mode: 'replace', slug: 'pedido', revision: 2, slugs: ['pedido', 'docs'] });

    out = [];
    expect(await main(['process', 'import', '-p', file])).toBe(1);
    expect(out[0]).toBe('lila process import: needs --bpmn <file.bpmn>.');
  });
});
