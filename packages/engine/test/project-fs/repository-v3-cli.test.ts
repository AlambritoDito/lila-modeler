/**
 * A version 3 `.lila` (#92, RM-01 § 8) through the CLI commands that write into one: `run --save`,
 * `scenario patch`, `scenario rename`, `process rename` and `process delete`. After each, every
 * entry the command had no reason to touch — the catalog (a broken object and a type this build
 * does not know included), `maps/`, `notes.md` and the other processes — is byte for byte what it
 * was, and the manifest stays version 3 with the same process ids.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { unzipSync } from 'fflate';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { main } from '../../src/cli.js';
import { encodeLila, processesOf, withProcesses, decodeLilaArchive } from '../../src/project/index.js';
import { BILLING_ID, FRONT_DESK_ID, v3Fixture } from '../project/fixtures/lila-v3.js';

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), 'lila-v3-cli-'));
  file = join(scratch, 'hotel.lila');
  // A third process, so `process delete` has one to delete.
  const { document, preserved } = decodeLilaArchive(v3Fixture({ notes: true }));
  const [frontDesk] = processesOf(document);
  const extra = { ...frontDesk!, id: 'process-h0u5e8k3e9pq', slug: 'housekeeping', name: 'Housekeeping' };
  writeFileSync(file, encodeLila(withProcesses(document, [...processesOf(document), extra]), preserved));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(scratch, { recursive: true, force: true });
});

function entries(): Record<string, string> {
  return Object.fromEntries(Object.entries(unzipSync(readFileSync(file))).map(([name, data]) => [name, Buffer.from(data).toString('base64')]));
}

function ids(): Record<string, string> {
  const manifest = JSON.parse(Buffer.from(unzipSync(readFileSync(file))['lila-project.json']!).toString('utf8')) as {
    version: number;
    processes: { id: string; slug: string }[];
  };
  expect(manifest.version).toBe(3);
  return Object.fromEntries(manifest.processes.map((p) => [p.slug, p.id]));
}

test('every writing CLI command leaves the entries it does not own byte for byte', async () => {
  const patch = join(scratch, 'patch.json');
  writeFileSync(patch, JSON.stringify([{ op: 'replace', path: '/elements/Task_1/processingTime/value', value: 40 }]));

  async function write(args: string[], owns: (name: string) => boolean): Promise<void> {
    const before = entries();
    expect(await main(args), args.join(' ')).toBe(0);
    const after = entries();
    expect(after, `${args.join(' ')} changed nothing`).not.toEqual(before);
    const kept = (all: Record<string, string>) => Object.fromEntries(Object.entries(all).filter(([n]) => n !== 'lila-project.json' && !owns(n)));
    expect(kept(after), args.join(' ')).toEqual(kept(before));
    expect(ids()['front-desk']).toBe(FRONT_DESK_ID);
  }
  const under = (slug: string) => (name: string) => name.startsWith(`processes/${slug}/`);

  await write(['run', file, 'as-is', '--process', 'billing', '--replications', '1', '--save'], under('billing'));
  await write(['scenario', 'patch', file, 'as-is', '--process', 'billing', '--patch', patch], under('billing'));
  await write(['scenario', 'rename', file, 'as-is', '--process', 'billing', '--name', 'Baseline'], under('billing'));
  await write(['process', 'rename', file, 'billing', '--name', 'Invoicing'], under('billing'));
  await write(['process', 'delete', file, 'housekeeping'], under('housekeeping'));

  expect(ids()).toEqual({ 'front-desk': FRONT_DESK_ID, billing: BILLING_ID });
  const original = Object.fromEntries(Object.entries(unzipSync(v3Fixture({ notes: true }))).map(([n, d]) => [n, Buffer.from(d).toString('base64')]));
  const final = entries();
  for (const name of Object.keys(original).filter((n) => n.startsWith('catalog/') || n === 'maps/x.json' || n === 'notes.md')) {
    expect(final[name], name).toBe(original[name]);
  }
}, 120_000);
