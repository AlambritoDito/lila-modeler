// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { Servicios } from './Modeler';
import { Paleta } from './Paleta';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('leaving Model mode (the palette unmounts) cancels a pending pool pick (QA of #588)', () => {
  const cancelar = vi.fn();
  const servicios = {
    carriles: { cancelar, eligiendo: () => true, elegirPool: vi.fn() },
    elementRegistry: { filter: () => [] },
  } as unknown as Servicios;
  const div = document.createElement('div');
  const root = createRoot(div);
  act(() => root.render(<Paleta servicios={servicios} compacta={false} onCompacta={() => {}} />));
  expect(cancelar).not.toHaveBeenCalled();
  act(() => root.unmount());
  expect(cancelar).toHaveBeenCalledTimes(1);
});
