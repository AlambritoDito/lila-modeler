/**
 * Tests of `keptEntries.ts` with real files (`mkdtemp`), without Electron: the path the desktop's
 * `lila:readProject` and `lila:writeProject` handlers take for a `.lila` (#690). Calling
 * `writeLilaFile` directly would not show that «Save as» loses what the source archive kept.
 */
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeLila, encodeLila, readLilaPreserved, withCatalog, type ProjectDocument } from '@lila-modeler/engine/project';
import { readLilaKeeping, writeLilaKeeping, type KeptEntries } from './keptEntries.js';

const XML = '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"/>';

/** The entries a desktop save must carry through untouched: unknown, broken catalog object, reserved name. */
const KEPT: Record<string, string> = {
  'notes.md': '# Notes\n\nKept by every save.\n',
  'catalog/role/role-broken0broken.json': '{ "type": "role", "id": "role-broken0broken", "revision": 1 }\n',
  'maps/x.json': '{\n  "nodes": []\n}\n',
};

function documento(): ProjectDocument {
  return withCatalog(
    {
      version: 1,
      id: 'p1',
      name: 'pedido',
      model: { id: 'Process_1', name: 'model.bpmn', xml: XML, revision: 1 },
      scenarios: { 'as-is.scenario.json': { version: 1, name: 'AS-IS' } },
      scenarioRevisions: {},
      runs: [],
    },
    [{ type: 'role', id: 'role-1', name: 'Cashier', revision: 1 }],
  );
}

/** A `.lila` of `documento()` plus `extra` entries, as another build or a person left it. */
function archive(extra: Record<string, string>): Uint8Array {
  const entries = Object.fromEntries(Object.entries(extra).map(([name, text]) => [name, new TextEncoder().encode(text)]));
  return encodeLila(documento(), { entries, objects: {}, slugs: [] });
}

/** The entries `file` keeps beside its document, as text. */
async function keptIn(file: string): Promise<Record<string, string>> {
  const { entries } = readLilaPreserved(new Uint8Array(await readFile(file))).preserved;
  return Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, Buffer.from(data).toString('utf8')]));
}

let dir: string;
let kept: KeptEntries;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'lila-kept-')));
  kept = new Map();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('«Save as» of a .lila on the desktop (#690)', () => {
  it('the new file holds the unknown entry, the broken catalog object and maps/, byte for byte', async () => {
    const source = join(dir, 'pedido.lila');
    await writeFile(source, archive(KEPT));
    const { document } = await readLilaKeeping(kept, source);
    const copy = join(dir, 'copia.lila');
    await writeLilaKeeping(kept, copy, document, { saveAs: true });
    expect(await keptIn(copy)).toEqual(KEPT);
    expect(decodeLila(new Uint8Array(await readFile(copy))).catalog).toEqual(documento().catalog);
  });

  it('a second «Save as» from the copy still carries them', async () => {
    const source = join(dir, 'pedido.lila');
    await writeFile(source, archive(KEPT));
    const { document } = await readLilaKeeping(kept, source);
    await writeLilaKeeping(kept, join(dir, 'a.lila'), document, { saveAs: true });
    await writeLilaKeeping(kept, join(dir, 'b.lila'), document, { saveAs: true });
    expect(await keptIn(join(dir, 'b.lila'))).toEqual(KEPT);
  });

  it('a normal save keeps working as before: the file keeps its entries', async () => {
    const source = join(dir, 'pedido.lila');
    const before = archive(KEPT);
    await writeFile(source, before);
    const { document } = await readLilaKeeping(kept, source);
    await writeLilaKeeping(kept, source, document, {});
    expect(Buffer.from(await readFile(source)).equals(Buffer.from(before))).toBe(true);
  });

  it('over an existing .lila it takes the source\'s entries, not the ones of the file it replaces', async () => {
    const source = join(dir, 'pedido.lila');
    await writeFile(source, archive(KEPT));
    const target = join(dir, 'viejo.lila');
    await writeFile(target, archive({ 'old.md': 'from the replaced file\n' }));
    const { document } = await readLilaKeeping(kept, source);
    await writeLilaKeeping(kept, target, document, { saveAs: true, overwrite: true });
    expect(await keptIn(target)).toEqual(KEPT);
  });

  it('a project that was never read from a .lila is saved as before, with nothing kept', async () => {
    const copy = join(dir, 'nuevo.lila');
    await writeLilaKeeping(kept, copy, documento(), { saveAs: true });
    expect(await keptIn(copy)).toEqual({});
    expect(kept.has('p1')).toBe(true);
  });
});
