// @vitest-environment jsdom
/**
 * Lote M, C2: lanes in visual order, unnamed lanes without their raw id, and the click on a lane's
 * name while the Resources step is mounted. The canvas is a fake with the surface `apply` reads
 * (element registry, canvas, event bus), so no bpmn-js is loaded for this.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProcessIR } from '@lila-modeler/engine';

import {
  MARCA_ASIGNABLE,
  apply,
  carrilElegido,
  elegirCarril,
  ordenVisual,
  publicarCarriles,
  usePasoRecursos,
  type EventoCarril,
  type FormaCarril,
  type LienzoCarriles,
} from './carrilClic.js';
import { carrilesDelPanel } from './laneToPool.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function carril(id: string, y: number, nodos: string[], nombre?: string, extra: Partial<FormaCarril> = {}): FormaCarril {
  return {
    id,
    type: 'bpmn:Lane',
    x: 100,
    y,
    width: 600,
    height: 100,
    businessObject: { ...(nombre === undefined ? {} : { name: nombre }), flowNodeRef: nodos.map((n) => ({ id: n })) },
    ...extra,
  };
}

/** Lanes declared bottom-first, as bpmn-js leaves them after «Add lane above». */
const FORMAS: FormaCarril[] = [
  carril('Lane_abajo', 300, ['T3'], 'Cocina'),
  carril('Lane_0x9k2', 200, ['T2']),
  carril('Lane_arriba', 100, ['T1', 'Start'], 'Caja'),
  { id: 'T1', type: 'bpmn:Task', x: 200, y: 120, width: 100, height: 80 },
];

const IR = {
  nodes: {
    Start: { type: 'start', name: 'Inicio', outgoing: [], incoming: [] },
    T1: { type: 'task', name: 'Cobrar', lane: 'Caja', outgoing: [], incoming: [] },
    T2: { type: 'task', name: 'Revisar', lane: 'Lane_0x9k2', outgoing: [], incoming: [] },
    T3: { type: 'task', name: 'Cocinar', lane: 'Cocina', outgoing: [], incoming: [] },
  },
  flows: {},
  source: { originalIds: {} },
} as unknown as ProcessIR;

describe('ordenVisual', () => {
  it('orders lanes top to bottom, not in file order, and an unnamed lane has no name', () => {
    const orden = ordenVisual(FORMAS);
    expect(orden.map((c) => c.id)).toEqual(['Lane_arriba', 'Lane_0x9k2', 'Lane_abajo']);
    expect(orden.map((c) => c.nombre)).toEqual(['Caja', null, 'Cocina']);
    expect(orden[0]!.nodos).toEqual(['T1', 'Start']);
  });

  it('a parent lane goes before the children it starts with; a vertical pool goes left to right', () => {
    const padre = carril('P', 100, ['T1', 'T2'], 'Padre', { height: 200 });
    const hijo1 = carril('H1', 100, ['T1'], 'Hijo 1');
    const hijo2 = carril('H2', 200, ['T2'], 'Hijo 2');
    expect(ordenVisual([hijo2, hijo1, padre]).map((c) => c.id)).toEqual(['P', 'H1', 'H2']);

    const v = (id: string, x: number): FormaCarril => ({ ...carril(id, 0, []), x, di: { isHorizontal: false } });
    expect(ordenVisual([v('B', 400), v('A', 100)]).map((c) => c.id)).toEqual(['A', 'B']);
  });
});

describe('carrilesDelPanel', () => {
  it('keeps the visual order, keeps only tasks, and drops a lane with none', () => {
    const visuales = [...ordenVisual(FORMAS), { id: 'Lane_vacio', nombre: 'Vacío', nodos: ['Start'] }];
    expect(carrilesDelPanel(IR, visuales)).toEqual([
      { clave: 'Lane_arriba', nombre: 'Caja', tareas: ['T1'] },
      { clave: 'Lane_0x9k2', nombre: null, tareas: ['T2'] },
      { clave: 'Lane_abajo', nombre: 'Cocina', tareas: ['T3'] },
    ]);
  });

  it('translates the file ids of a sanitised IR (non-NCName ids) to the IR keys', () => {
    const ir = { ...IR, nodes: { _1T: { type: 'task', name: 'X' } }, source: { originalIds: { _1T: '1T' } } } as unknown as ProcessIR;
    expect(carrilesDelPanel(ir, [{ id: 'L', nombre: 'L', nodos: ['1T'] }])[0]!.tareas).toEqual(['_1T']);
  });

  it('without the canvas it falls back to the IR grouping', () => {
    expect(carrilesDelPanel(IR, null).map((c) => c.clave)).toEqual(['Caja', 'Lane_0x9k2', 'Cocina']);
  });
});

/* ------------------------------------------------------------------ *
 * apply: the canvas layer
 * ------------------------------------------------------------------ */

interface Falso {
  lienzo: LienzoCarriles;
  emitir(evento: string, datos: EventoCarril): void;
  marcadas: Set<string>;
}

function lienzoFalso(): Falso {
  const oyentes = new Map<string, ((e: EventoCarril) => unknown)[]>();
  const marcadas = new Set<string>();
  const contenedor = document.createElement('div');
  contenedor.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}) });
  const lienzo: LienzoCarriles = {
    servicios: {
      elementRegistry: { filter: (prueba) => FORMAS.filter(prueba) },
      canvas: {
        viewbox: () => ({ x: 0, y: 0, scale: 1 }),
        getContainer: () => contenedor,
        addMarker: (f, clase) => marcadas.add(`${f.id}:${clase}`),
        removeMarker: (f, clase) => marcadas.delete(`${f.id}:${clase}`),
      },
    },
    suscribir(eventos, escuchar) {
      for (const e of eventos) oyentes.set(e, [...(oyentes.get(e) ?? []), escuchar]);
      return () => {
        for (const e of eventos) oyentes.set(e, (oyentes.get(e) ?? []).filter((o) => o !== escuchar));
      };
    },
  };
  return {
    lienzo,
    marcadas,
    emitir(evento, datos) {
      for (const o of oyentes.get(evento) ?? []) o(datos);
    },
  };
}

/** What a Resources step does on mount, without the step. */
function Paso(): null {
  usePasoRecursos();
  return null;
}

let desmontar: (() => void) | null = null;
afterEach(() => {
  desmontar?.();
  desmontar = null;
  publicarCarriles(null);
  elegirCarril(null);
});

function montarPaso(): void {
  const div = document.createElement('div');
  const raiz = createRoot(div);
  act(() => {
    raiz.render(createElement(Paso));
  });
  desmontar = () => {
    act(() => {
      raiz.unmount();
    });
  };
}

describe('apply', () => {
  it('a click on a lane name picks the lane only while the Resources step is mounted', () => {
    const falso = lienzoFalso();
    const quitar = apply(falso.lienzo);
    const arriba = FORMAS[2]!;

    // No step on screen: the click is the canvas' own, nothing is picked and nothing is marked.
    falso.emitir('element.click', { element: arriba, originalEvent: { clientX: 110, clientY: 150 } });
    expect(carrilElegido()).toBeNull();
    expect(falso.marcadas.size).toBe(0);

    montarPaso();
    expect([...falso.marcadas].sort()).toEqual(
      ['Lane_0x9k2', 'Lane_abajo', 'Lane_arriba'].map((id) => `${id}:${MARCA_ASIGNABLE}`),
    );
    // Inside the lane but past the 30 px label band: not a click on its name.
    falso.emitir('element.click', { element: arriba, originalEvent: { clientX: 300, clientY: 150 } });
    expect(carrilElegido()).toBeNull();
    // On the band.
    falso.emitir('element.click', { element: arriba, originalEvent: { clientX: 110, clientY: 150 } });
    expect(carrilElegido()).toBe('Lane_arriba');
    // A task is not a lane.
    elegirCarril(null);
    falso.emitir('element.click', { element: FORMAS[3]!, originalEvent: { clientX: 110, clientY: 150 } });
    expect(carrilElegido()).toBeNull();

    // Leaving the step unmarks the lanes; the cleanup unpublishes them.
    desmontar?.();
    desmontar = null;
    expect(falso.marcadas.size).toBe(0);
    quitar();
  });
});
