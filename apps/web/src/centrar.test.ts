import { expect, it, vi } from 'vitest';
import { centrar } from './centrar';

it('centrar puts the element in the middle of the view at the current zoom (#410, QA of #438)', () => {
  const orden: string[] = [];
  const viewbox = vi.fn((caja?: object) => { orden.push(caja ? 'viewbox(set)' : 'viewbox()'); return { x: 0, y: 0, width: 800, height: 400 }; });
  const canvas = { scrollToElement: vi.fn(() => { orden.push('scroll'); }), viewbox };
  centrar(canvas as never, { id: 'Task_299', x: 2000, y: 1000, width: 100, height: 80 });
  // Scroll first (it switches planes), then the centre: (2050, 1040) minus half the view.
  expect(orden).toEqual(['scroll', 'viewbox()', 'viewbox(set)']);
  expect(viewbox).toHaveBeenLastCalledWith({ x: 1650, y: 840, width: 800, height: 400 });
});
