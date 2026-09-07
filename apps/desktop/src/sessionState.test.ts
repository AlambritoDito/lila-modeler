import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  addRecent,
  defaultSessionState,
  fitsAnyDisplay,
  readSessionState,
  removeRecent,
  withWindowBounds,
  writeSessionState,
  type SessionState,
} from './sessionState.js';

let dir: string;
let statePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'lila-sessionState-'));
  statePath = join(dir, 'estado.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('readSessionState — tolerancia', () => {
  it('archivo ausente: estado por defecto', async () => {
    await expect(readSessionState(statePath)).resolves.toEqual(defaultSessionState());
  });

  it('JSON roto: estado por defecto, no lanza', async () => {
    await writeFile(statePath, 'esto no es json', 'utf8');
    await expect(readSessionState(statePath)).resolves.toEqual(defaultSessionState());
  });

  it('JSON válido pero forma inesperada (array en la raíz): estado por defecto', async () => {
    await writeFile(statePath, '[1, 2, 3]', 'utf8');
    await expect(readSessionState(statePath)).resolves.toEqual(defaultSessionState());
  });

  it('recents con una entrada inválida: se descarta solo esa, no toda la lista', async () => {
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        window: null,
        recents: [
          { dir: '/a', name: 'A', openedAt: '2026-01-01T00:00:00.000Z' },
          { dir: '/b', name: 123 }, // "name" no es texto: inválida.
          { dir: '/c', name: 'C', openedAt: '2026-01-02T00:00:00.000Z' },
        ],
      }),
      'utf8',
    );
    const state = await readSessionState(statePath);
    expect(state.recents).toEqual([
      { dir: '/a', name: 'A', openedAt: '2026-01-01T00:00:00.000Z' },
      { dir: '/c', name: 'C', openedAt: '2026-01-02T00:00:00.000Z' },
    ]);
  });

  it('window con forma inválida (falta "height"): se descarta a null', async () => {
    await writeFile(statePath, JSON.stringify({ version: 1, window: { x: 0, y: 0, width: 800 }, recents: [] }), 'utf8');
    const state = await readSessionState(statePath);
    expect(state.window).toBeNull();
  });
});

describe('writeSessionState / readSessionState — ida y vuelta', () => {
  it('escribe y relee sin dejar temporales', async () => {
    const state: SessionState = {
      version: 1,
      window: { x: 10, y: 20, width: 1024, height: 768 },
      recents: [{ dir: '/proyecto', name: 'Pedido', openedAt: '2026-01-01T00:00:00.000Z' }],
    };
    await writeSessionState(statePath, state);
    await expect(readSessionState(statePath)).resolves.toEqual(state);
    const contenido = await readFile(statePath, 'utf8');
    expect(contenido.includes('.tmp-')).toBe(false);
  });

  it('crea el directorio contenedor si falta', async () => {
    const anidado = join(dir, 'sub', 'estado.json');
    await writeSessionState(anidado, defaultSessionState());
    await expect(readSessionState(anidado)).resolves.toEqual(defaultSessionState());
  });
});

describe('addRecent', () => {
  it('añade al frente, más reciente primero', () => {
    let state = defaultSessionState();
    state = addRecent(state, { dir: '/a', name: 'A', openedAt: '2026-01-01T00:00:00.000Z' });
    state = addRecent(state, { dir: '/b', name: 'B', openedAt: '2026-01-02T00:00:00.000Z' });
    expect(state.recents.map((r) => r.dir)).toEqual(['/b', '/a']);
  });

  it('sin duplicar dir: reabrir mueve la entrada al frente con el openedAt nuevo', () => {
    let state = defaultSessionState();
    state = addRecent(state, { dir: '/a', name: 'A', openedAt: '2026-01-01T00:00:00.000Z' });
    state = addRecent(state, { dir: '/b', name: 'B', openedAt: '2026-01-02T00:00:00.000Z' });
    state = addRecent(state, { dir: '/a', name: 'A', openedAt: '2026-01-03T00:00:00.000Z' });
    expect(state.recents).toEqual([
      { dir: '/a', name: 'A', openedAt: '2026-01-03T00:00:00.000Z' },
      { dir: '/b', name: 'B', openedAt: '2026-01-02T00:00:00.000Z' },
    ]);
  });

  it('como máximo MAX_RECENTS (10), descarta los más antiguos', () => {
    let state = defaultSessionState();
    for (let i = 0; i < 12; i++) {
      state = addRecent(state, { dir: `/p${i}`, name: `P${i}`, openedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` });
    }
    expect(state.recents).toHaveLength(10);
    expect(state.recents[0]?.dir).toBe('/p11');
    expect(state.recents.at(-1)?.dir).toBe('/p2');
  });
});

describe('removeRecent', () => {
  it('quita solo la entrada de "dir"', () => {
    let state = defaultSessionState();
    state = addRecent(state, { dir: '/a', name: 'A', openedAt: '2026-01-01T00:00:00.000Z' });
    state = addRecent(state, { dir: '/b', name: 'B', openedAt: '2026-01-02T00:00:00.000Z' });
    state = removeRecent(state, '/a');
    expect(state.recents.map((r) => r.dir)).toEqual(['/b']);
  });
});

describe('withWindowBounds', () => {
  it('reemplaza la ventana recordada', () => {
    const state = withWindowBounds(defaultSessionState(), { x: 1, y: 2, width: 3, height: 4 });
    expect(state.window).toEqual({ x: 1, y: 2, width: 3, height: 4 });
  });
});

describe('fitsAnyDisplay', () => {
  const pantalla = { x: 0, y: 0, width: 1920, height: 1080 };

  it('true si la ventana cabe entera dentro de una pantalla', () => {
    expect(fitsAnyDisplay({ x: 100, y: 100, width: 800, height: 600 }, [pantalla])).toBe(true);
  });

  it('false si la ventana se sale de todas las pantallas', () => {
    expect(fitsAnyDisplay({ x: 1800, y: 100, width: 800, height: 600 }, [pantalla])).toBe(false);
    expect(fitsAnyDisplay({ x: -50, y: 100, width: 800, height: 600 }, [pantalla])).toBe(false);
  });

  it('true si cabe en cualquiera de varias pantallas (segundo monitor a la derecha)', () => {
    const segunda = { x: 1920, y: 0, width: 1280, height: 720 };
    expect(fitsAnyDisplay({ x: 2000, y: 50, width: 800, height: 600 }, [pantalla, segunda])).toBe(true);
  });

  it('false con la lista de pantallas vacía', () => {
    expect(fitsAnyDisplay({ x: 0, y: 0, width: 800, height: 600 }, [])).toBe(false);
  });
});
