import { EventEmitter } from 'node:events';
import type { watch as fsWatch } from 'node:fs';
import { mkdtemp, realpath, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeLila } from '@lila-modeler/engine/project';
import type { ProjectDocument } from '@lila-modeler/engine/project';
import { isOwnSnapshot, readLilaFile, writeLilaFile, writeProjectFolder } from '@lila-modeler/engine/project-fs';
import { RELOAD_DEBOUNCE_MS, relevantProjectFile, watchProject } from './projectWatcher.js';

const XML = '<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"/>';

function documento(name = 'pedido'): ProjectDocument {
  return {
    version: 1,
    id: 'p1',
    name,
    model: { id: 'Process_1', name: 'model.bpmn', xml: XML, revision: 1 },
    scenarios: { 'as-is.scenario.json': { version: 1, name: 'AS-IS' } },
    scenarioRevisions: {},
    runs: [],
  };
}

/**
 * `fs.watch` replaced by an emitter the test fires by hand: what is under test is the debounce and
 * the filter, with fake timers, not the operating system's notifications (one real-watch test
 * below covers that the wiring works). The disk is real (`mkdtemp`), so the own-write check is the
 * engine's `isOwnSnapshot` against files this process did or did not write.
 */
function fakeWatch(): { watch: typeof fsWatch; fire: (filename: string) => void; calls: unknown[][]; closed: () => boolean } {
  let listener: ((event: string, filename: string | null) => void) | null = null;
  let closed = false;
  const calls: unknown[][] = [];
  const watch = ((dir: string, options: unknown, cb: (event: string, filename: string | null) => void) => {
    calls.push([dir, options]);
    listener = cb;
    const watcher = Object.assign(new EventEmitter(), { close: () => { closed = true; } });
    return watcher;
  }) as unknown as typeof fsWatch;
  return { watch, fire: (filename) => listener?.('rename', filename), calls, closed: () => closed };
}

/** Lets the async own-write check run to the end after the timer fires. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('watchProject on a .lila (#539)', () => {
  it('watches the containing folder, filters by name and debounces a burst into one change', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'lila-watch-')));
    const file = join(dir, 'pedido.lila');
    await writeLilaFile(file, documento());
    const fake = fakeWatch();
    const onChange = vi.fn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const watcher = watchProject({ target: file, isLila: true, isOwn: isOwnSnapshot, onChange, watch: fake.watch });
    expect(fake.calls[0]).toEqual([dir, { recursive: false, persistent: false }]);

    // An agent rewrites it: temporary file, then the rename onto the name.
    await writeFile(file, encodeLila(documento('de un agente')));
    await utimes(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    fake.fire('pedido.lila.tmp-1');
    fake.fire('pedido.lila');
    await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS - 50);
    fake.fire('pedido.lila');
    fake.fire('otro.lila'); // Another file in the same folder is none of its business.
    await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS - 50);
    expect(onChange).not.toHaveBeenCalled(); // Still inside the debounce of the last event.
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);

    watcher.close();
    expect(fake.closed()).toBe(true);
  });

  it('ignores Lila\'s own saves: no reload loop after saving', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'lila-watch-')));
    const file = join(dir, 'pedido.lila');
    await writeLilaFile(file, documento());
    const fake = fakeWatch();
    const onChange = vi.fn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    watchProject({ target: file, isLila: true, isOwn: isOwnSnapshot, onChange, watch: fake.watch });

    for (const name of ['v2', 'v3', 'v4']) {
      await writeLilaFile(file, documento(name));
      fake.fire('pedido.lila');
      await settle();
    }
    // The reload itself reads the file: still own.
    await readLilaFile(file);
    fake.fire('pedido.lila');
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('waits for a save still in flight before deciding (the snapshot is recorded after the rename)', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'lila-watch-')));
    const file = join(dir, 'pedido.lila');
    await writeLilaFile(file, documento());
    const fake = fakeWatch();
    const onChange = vi.fn();
    let release: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => { release = resolve; });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    watchProject({
      target: file,
      isLila: true,
      isOwn: async (path) => { await inFlight; return isOwnSnapshot(path); },
      onChange,
      watch: fake.watch,
    });
    // The rename has landed but the save has not remembered the new snapshot yet.
    await writeFile(file, encodeLila(documento('v2')));
    await utimes(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    fake.fire('pedido.lila');
    await settle();
    await readLilaFile(file); // What `writeLilaFile` does last: remember the snapshot.
    release();
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('close() cancels a pending check', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'lila-watch-')));
    const file = join(dir, 'pedido.lila');
    await writeFile(file, encodeLila(documento()));
    const fake = fakeWatch();
    const onChange = vi.fn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const watcher = watchProject({ target: file, isLila: true, isOwn: isOwnSnapshot, onChange, watch: fake.watch });
    fake.fire('pedido.lila');
    watcher.close();
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a folder that cannot be watched leaves the app working without a watcher', () => {
    const watch = (() => { throw new Error('ENOENT'); }) as unknown as typeof fsWatch;
    const watcher = watchProject({ target: '/no/such/pedido.lila', isLila: true, isOwn: async () => true, onChange: () => {}, watch });
    expect(() => watcher.close()).not.toThrow();
  });
});

describe('watchProject on a project folder (#539)', () => {
  it('watches recursively and reloads for a scenario an agent wrote, not for Lila\'s own save', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'lila-watch-')));
    await writeProjectFolder(dir, documento());
    const fake = fakeWatch();
    const onChange = vi.fn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    watchProject({ target: dir, isLila: false, isOwn: isOwnSnapshot, onChange, watch: fake.watch });
    expect(fake.calls[0]).toEqual([dir, { recursive: true, persistent: false }]);

    await writeProjectFolder(dir, documento('v2'));
    fake.fire('model.bpmn');
    fake.fire('lila-project.json');
    fake.fire('model.bpmn.tmp-abc');
    await settle();
    expect(onChange).not.toHaveBeenCalled();

    await writeFile(join(dir, 'to-be.scenario.json'), '{"version":1,"name":"TO-BE"}');
    fake.fire('to-be.scenario.json');
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('counts only the files a project is made of', () => {
    expect(relevantProjectFile('model.bpmn')).toBe(true);
    expect(relevantProjectFile('lila-project.json')).toBe(true);
    expect(relevantProjectFile('as-is.scenario.json')).toBe(true);
    expect(relevantProjectFile(join('processes', 'alta', 'model.bpmn'))).toBe(true);
    expect(relevantProjectFile(join('runs', 'as-is.result.json'))).toBe(false);
    expect(relevantProjectFile('model.bpmn.tmp-1234')).toBe(false);
    expect(relevantProjectFile('.DS_Store')).toBe(false);
    expect(relevantProjectFile('diagrama.png')).toBe(false);
  });
});

describe('watchProject with the real fs.watch', () => {
  it('reports an atomic rewrite of the .lila made by someone else', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'lila-watch-')));
    const file = join(dir, 'pedido.lila');
    await writeLilaFile(file, documento());
    const changed = new Promise<void>((resolve) => {
      const watcher = watchProject({
        target: file,
        isLila: true,
        isOwn: isOwnSnapshot,
        debounceMs: 50,
        onChange: () => { watcher.close(); resolve(); },
      });
    });
    // Like an agent through the CLI: temporary file, then rename over the open project.
    const { rename } = await import('node:fs/promises');
    await writeFile(`${file}.tmp-agent`, encodeLila(documento('de un agente con otro tamaño')));
    await rename(`${file}.tmp-agent`, file);
    await expect(changed).resolves.toBeUndefined();
  });
});
