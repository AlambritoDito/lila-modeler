import { expect, it, vi } from 'vitest';
import { ajustar, centrar } from './centrar';

it('centrar puts the element in the middle of the view at the current zoom (#410, QA of #438)', () => {
  const orden: string[] = [];
  const viewbox = vi.fn((caja?: object) => { orden.push(caja ? 'viewbox(set)' : 'viewbox()'); return { x: 0, y: 0, width: 800, height: 400 }; });
  const canvas = { scrollToElement: vi.fn(() => { orden.push('scroll'); }), viewbox };
  centrar(canvas as never, { id: 'Task_299', x: 2000, y: 1000, width: 100, height: 80 });
  // Scroll first (it switches planes), then the centre: (2050, 1040) minus half the view.
  expect(orden).toEqual(['scroll', 'viewbox()', 'viewbox(set)']);
  expect(viewbox).toHaveBeenLastCalledWith({ x: 1650, y: 840, width: 800, height: 400 });
});

it('centrar uses the waypoints of a connection, which has no x/y/width/height (QA of #438, second pass)', () => {
  const viewbox = vi.fn(() => ({ x: 0, y: 0, width: 800, height: 400 }));
  const canvas = { scrollToElement: vi.fn(), viewbox };
  centrar(canvas as never, { id: 'Flow_1', waypoints: [{ x: 100, y: 100 }, { x: 300, y: 200 }] });
  // The box of the waypoints is (100,100)-(300,200): its centre (200,150) minus half the view.
  expect(viewbox).toHaveBeenLastCalledWith({ x: -200, y: -50, width: 800, height: 400 });
});

const vistaDe = (inner: { x: number; y: number; width: number; height: number }, outer: { width: number; height: number }) =>
  vi.fn((_caja?: object) => ({ x: 0, y: 0, width: outer.width, height: outer.height, inner, outer }));
const MARGEN = { arriba: 56, derecha: 16, abajo: 16, izquierda: 16 };

it('ajustar fits a wide diagram below the top margin and centred across (#717)', () => {
  const viewbox = vistaDe({ x: 180, y: 80, width: 2000, height: 600 }, { width: 1200, height: 900 });
  ajustar({ viewbox } as never, MARGEN);
  const caja = viewbox.mock.lastCall![0] as { x: number; y: number; width: number; height: number };
  const escala = 1200 / caja.width;
  // Width-bound: 1168 px of room for 2000 units.
  expect(escala).toBeCloseTo(1168 / 2000, 12);
  // The diagram's top edge lands 56 px down the view, not at 0 under the floating row.
  expect((80 - caja.y) * escala).toBeCloseTo(56, 9);
  // Its left and right edges keep 16 px each.
  expect((180 - caja.x) * escala).toBeCloseTo(16, 9);
  expect((caja.x + caja.width - 2180) * escala).toBeCloseTo(16, 9);
});

it('ajustar keeps 100 % for a diagram that already fits and centres it across (#717)', () => {
  const viewbox = vistaDe({ x: 0, y: 0, width: 400, height: 200 }, { width: 1000, height: 800 });
  ajustar({ viewbox } as never, MARGEN);
  expect(viewbox).toHaveBeenLastCalledWith({ x: 200 - 16 - 484, y: -56, width: 1000, height: 800 });
});

it('ajustar leaves the view alone for an empty diagram or a view with no room (#717)', () => {
  for (const [inner, outer] of [
    [{ x: 0, y: 0, width: 0, height: 0 }, { width: 1000, height: 800 }],
    [{ x: 0, y: 0, width: 400, height: 200 }, { width: 0, height: 0 }],
    [{ x: 0, y: 0, width: 400, height: 200 }, { width: 30, height: 60 }],
  ] as const) {
    const viewbox = vistaDe(inner, outer);
    ajustar({ viewbox } as never, MARGEN);
    expect(viewbox).toHaveBeenCalledTimes(1);
    expect(viewbox).toHaveBeenLastCalledWith();
  }
});
