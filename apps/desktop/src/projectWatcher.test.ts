import { EventEmitter } from 'node:events';
import type { watch as fsWatch } from 'node:fs';
import { mkdir, mkdtemp, realpath, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * Own-write checks started and finished. `isOwnSnapshot` does a real `stat` in libuv's thread pool,
 * which a loaded CI can delay past any fixed number of event-loop turns (QA round 2 of #551): the
 * tests wait for the checks themselves instead.
 */
let empezadas = 0;
let hechas = 0;
function contado(isOwn: (file: string) => Promise<boolean>): (file: string) => Promise<boolean> {
  return async (file) => {
    empezadas += 1;
    try {
      return await isOwn(file);
    } finally {
      hechas += 1;
    }
  };
}

/**
 * Fires the debounce and waits until every own-write check it started has finished, then one more
 * turn for `onChange`, which runs right after the check that found a foreign change.
 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
  await vi.waitFor(() => expect(hechas).toBe(empezadas));
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  empezadas = 0;
  hechas = 0;
});

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
    const watcher = watchProject({ target: file, singleFile: true, isOwn: contado(isOwnSnapshot), onChange, watch: fake.watch });
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
    watchProject({ target: file, singleFile: true, isOwn: contado(isOwnSnapshot), onChange, watch: fake.watch });

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
      singleFile: true,
      isOwn: contado(async (path) => { await inFlight; return isOwnSnapshot(path); }),
      onChange,
      watch: fake.watch,
    });
    // The rename has landed but the save has not remembered the new snapshot yet.
    await writeFile(file, encodeLila(documento('v2')));
    await utimes(file, new Date(Date.now() + 5000), new Date(Date.now() + 5000));
    fake.fire('pedido.lila');
    await vi.advanceTimersByTimeAsync(RELOAD_DEBOUNCE_MS);
    expect([empezadas, hechas]).toEqual([1, 0]); // Checking, and held by the save in flight.
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
    const watcher = watchProject({ target: file, singleFile: true, isOwn: contado(isOwnSnapshot), onChange, watch: fake.watch });
    fake.fire('pedido.lila');
    watcher.close();
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a folder that cannot be watched leaves the app working without a watcher', () => {
    const watch = (() => { throw new Error('ENOENT'); }) as unknown as typeof fsWatch;
    const watcher = watchProject({ target: '/no/such/pedido.lila', singleFile: true, isOwn: async () => true, onChange: () => {}, watch });
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
    watchProject({ target: dir, singleFile: false, isOwn: contado(isOwnSnapshot), onChange, watch: fake.watch });
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

  it('counts only the files a project is made of: the top level and processes/<slug>/', () => {
    expect(relevantProjectFile('model.bpmn')).toBe(true);
    expect(relevantProjectFile('lila-project.json')).toBe(true);
    expect(relevantProjectFile('as-is.scenario.json')).toBe(true);
    expect(relevantProjectFile(join('processes', 'alta', 'model.bpmn'))).toBe(true);
    expect(relevantProjectFile('processes\\alta\\to-be.scenario.json')).toBe(true); // Windows separators.
    expect(relevantProjectFile(join('processes', 'alta', 'runs', 'r1.result.json'))).toBe(false);
    expect(relevantProjectFile(join('processes', 'alta', 'copia', 'model.bpmn'))).toBe(false);
    expect(relevantProjectFile(join('processes', 'lila-project.json'))).toBe(false);
    expect(relevantProjectFile(join('copia-vieja', 'model.bpmn'))).toBe(false);
    expect(relevantProjectFile(join('otra', 'sub', 'as-is.scenario.json'))).toBe(false);
    expect(relevantProjectFile('borrador.bpmn')).toBe(false); // Not the project's model.
    expect(relevantProjectFile(join('runs', 'as-is.result.json'))).toBe(false);
    expect(relevantProjectFile('model.bpmn.tmp-1234')).toBe(false);
    expect(relevantProjectFile('.DS_Store')).toBe(false);
    expect(relevantProjectFile('diagrama.png')).toBe(false);
  });
});

describe('watchProject with nested copies and loose diagrams (QA of #551)', () => {
  it('a copy of model.bpmn in a subfolder of the project is not the project', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'lila-watch-')));
    await writeProjectFolder(dir, documento());
    const fake = fakeWatch();
    const onChange = vi.fn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    watchProject({ target: dir, singleFile: false, isOwn: contado(isOwnSnapshot), onChange, watch: fake.watch });
    await mkdir(join(dir, 'copia-vieja'));
    await writeFile(join(dir, 'copia-vieja', 'model.bpmn'), XML);
    fake.fire(join('copia-vieja', 'model.bpmn'));
    fake.fire('copia-vieja');
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a loose .bpmn is watched alone, without recursing into the folder it sits in', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'lila-descargas-')));
    const file = join(dir, 'suelto.bpmn');
    await writeProjectFolder(dir, documento(), { modelFile: 'suelto.bpmn', diagramOnly: true });
    expect(await isOwnSnapshot(file)).toBe(true);
    const fake = fakeWatch();
    const onChange = vi.fn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    watchProject({ target: file, singleFile: true, isOwn: contado(isOwnSnapshot), onChange, watch: fake.watch });
    expect(fake.calls[0]).toEqual([dir, { recursive: false, persistent: false }]);

    // Other programs writing diagrams next to it, or below it, are none of its business.
    await mkdir(join(dir, 'otra', 'sub'), { recursive: true });
    await writeFile(join(dir, 'otra', 'sub', 'ajeno.bpmn'), XML);
    await writeFile(join(dir, 'model.bpmn'), XML);
    fake.fire(join('otra', 'sub', 'ajeno.bpmn'));
    fake.fire('model.bpmn');
    fake.fire('lila-project.json');
    await settle();
    expect(onChange).not.toHaveBeenCalled();

    // The diagram itself, rewritten by somebody else, is.
    await writeFile(file, XML.replace('/>', '><!-- agente --></bpmn:definitions>'));
    fake.fire('suelto.bpmn');
    await settle();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('watchProject with the real fs.watch', () => {
  // macOS's FSEvents starts listening asynchronously, so a single write right after `watch()` can
  // land before it is listening, more so under load: the agent rewrites until it is heard, a bounded
  // number of times (QA nit 1 of #551).
  it('reports an atomic rewrite of the .lila made by someone else', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'lila-watch-')));
    const file = join(dir, 'pedido.lila');
    await writeLilaFile(file, documento());
    let oido = false;
    let watcher: { close(): void } = { close: () => {} };
    const changed = new Promise<void>((resolve) => {
      watcher = watchProject({
        target: file,
        singleFile: true,
        isOwn: isOwnSnapshot,
        debounceMs: 50,
        onChange: () => { oido = true; resolve(); },
      });
    });
    const { rename } = await import('node:fs/promises');
    try {
      for (let intento = 0; intento < 40 && !oido; intento++) {
        // Like an agent through the CLI: temporary file, then rename over the open project.
        await writeFile(`${file}.tmp-agent`, encodeLila(documento(`de un agente, intento ${intento}`)));
        await rename(`${file}.tmp-agent`, file);
        await Promise.race([changed, new Promise((resolve) => setTimeout(resolve, 250))]);
      }
      expect(oido).toBe(true);
    } finally {
      watcher.close();
    }
  }, 20_000);
});
