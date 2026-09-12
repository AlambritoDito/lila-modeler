// @vitest-environment jsdom
/**
 * Canvas side of the replay (#331) over a fake `elementRegistry`/`overlays`/`canvas`, the same
 * trick `BottleneckOverlay.test.ts` uses: jsdom cannot draw bpmn-js (no `getBBox`, no
 * `SVGElement.transform`), but everything this module does is DOM writes and service calls.
 *
 * What it pins: the counters land in `data-` attributes (the contract `tools/e2e-replay.mjs`
 * reads), repeating a frame does not pile up labels or markers, and clearing leaves nothing.
 */
import { beforeAll, expect, it } from 'vitest';
import type Modeler from 'bpmn-js/lib/Modeler';
import { limpiarReplay, sincronizarReplay } from './ReplayOverlay';
import type { ReplayState } from './replayModel';
import { setLocale } from '../i18n';

beforeAll(() => setLocale('en'));

interface Etiqueta { id: string; type: string; html: HTMLElement }

function modeladorFalso(ids: readonly string[], flujos: Readonly<Record<string, { x: number; y: number }[]>> = {}) {
  const elementos = new Map<string, unknown>(ids.map((id) => [id, { id }]));
  for (const [id, waypoints] of Object.entries(flujos)) elementos.set(id, { id, waypoints });
  const marcadores = new Map<string, Set<string>>();
  const capa = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  let capaVisible = true;
  let etiquetas: Etiqueta[] = [];

  const servicios: Readonly<Record<string, unknown>> = {
    canvas: {
      addMarker: (id: string, clase: string) => {
        const clases = marcadores.get(id) ?? new Set<string>();
        clases.add(clase);
        marcadores.set(id, clases);
      },
      getLayer: () => capa,
      hideLayer: () => { capaVisible = false; },
      removeMarker: (id: string, clase: string) => {
        marcadores.get(id)?.delete(clase);
        if (marcadores.get(id)?.size === 0) marcadores.delete(id);
      },
      showLayer: () => { capaVisible = true; },
    },
    elementRegistry: { get: (id: string) => elementos.get(id) },
    overlays: {
      add: (id: string, type: string, opciones: { html: HTMLElement }) =>
        etiquetas.push({ html: opciones.html, id, type }),
      remove: (filtro: { type: string }) => { etiquetas = etiquetas.filter((e) => e.type !== filtro.type); },
    },
  };
  return {
    capa,
    get capaVisible() { return capaVisible; },
    get etiquetas() { return etiquetas; },
    marcadores,
    modeler: { get: (nombre: string) => servicios[nombre] } as unknown as Modeler,
  };
}

function estado(elements: ReplayState['elements'], tokens: ReplayState['tokens'] = []): ReplayState {
  return { elements, pools: {}, t: 0, tokens };
}

it('writes the counters into the data attributes and reuses the label on the next frame', () => {
  const falso = modeladorFalso(['Task_A', 'Task_B']);
  const pintura = (a: number) => ({
    elementIds: ['Task_A', 'Task_B'],
    originalIds: {},
    state: estado({
      Task_A: { completed: a, queue: 1, running: 1, started: a + 2 },
      Task_B: { completed: 0, queue: 0, running: 0, started: 0 },
    }),
  });
  sincronizarReplay(falso.modeler, pintura(3));
  expect(falso.etiquetas).toHaveLength(2);
  const etiqueta = falso.etiquetas[0]?.html as HTMLElement;
  expect(etiqueta.dataset).toMatchObject({ completed: '3', elementId: 'Task_A', queue: '1', started: '5' });
  expect(falso.marcadores.get('Task_A')).toEqual(new Set(['lila-replay-activo']));

  sincronizarReplay(falso.modeler, pintura(4));
  expect(falso.etiquetas).toHaveLength(2);
  expect(falso.etiquetas[0]?.html).toBe(etiqueta);
  expect(etiqueta.dataset.completed).toBe('4');
});

it('ignores the elements the diagram does not have and follows `originalIds`', () => {
  const falso = modeladorFalso(['tarea con espacios']);
  sincronizarReplay(falso.modeler, {
    elementIds: ['tarea_con_espacios', 'Task_Borrada'],
    originalIds: { tarea_con_espacios: 'tarea con espacios' },
    state: estado({
      Task_Borrada: { completed: 0, queue: 0, running: 0, started: 1 },
      tarea_con_espacios: { completed: 1, queue: 0, running: 0, started: 1 },
    }),
  });
  expect(falso.etiquetas.map((e) => e.id)).toEqual(['tarea con espacios']);
});

it('moves a dot along the waypoints of the flow and clears everything afterwards', () => {
  const falso = modeladorFalso(['Task_A'], { Flow_1: [{ x: 0, y: 0 }, { x: 100, y: 0 }] });
  sincronizarReplay(falso.modeler, {
    elementIds: ['Task_A'],
    originalIds: {},
    state: estado({ Task_A: { completed: 0, queue: 0, running: 0, started: 1 } }, [{ flowId: 'Flow_1', progress: 0.25 }]),
  });
  const punto = falso.capa.querySelector('circle');
  expect(punto?.getAttribute('cx')).toBe('25');
  expect(punto?.getAttribute('cy')).toBe('0');

  limpiarReplay(falso.modeler);
  expect(falso.etiquetas).toEqual([]);
  expect(falso.marcadores.size).toBe(0);
  expect(falso.capa.querySelector('circle')).toBe(null);
  expect(falso.capaVisible).toBe(false);
});
