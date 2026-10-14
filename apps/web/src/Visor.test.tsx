// @vitest-environment jsdom
/**
 * The viewer (#653): the gesture math and the mount rule are pure; the component is mounted with a
 * stub `NavigatedViewer`, since jsdom cannot draw bpmn-js (`BottleneckOverlay.ts`).
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { processesOf } from '@lila-modeler/engine/project';
import { abrirVisor, pasoGesto, Visor } from './Visor';
import { EJEMPLOS, proyectoDeEjemplo } from './ejemplos';
import { en as T } from './strings.en';

vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class {
    importXML = vi.fn(async () => ({ warnings: [] }));
    on = vi.fn();
    destroy = vi.fn();
    get = (): unknown => ({ zoom: vi.fn(() => 1), scroll: vi.fn(), select: vi.fn(), get: vi.fn() });
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe(): void {} disconnect(): void {} unobserve(): void {} };

let root: Root;
let container: HTMLDivElement;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('one finger pans, a pinch zooms around the fingers', () => {
  expect(pasoGesto([{ x: 10, y: 10 }], [{ x: 25, y: 5 }])).toEqual({ dx: 15, dy: -5, factor: 1, centro: { x: 25, y: 5 } });
  // Spread from 100 to 200 around the same centre.
  expect(pasoGesto([{ x: 50, y: 0 }, { x: 150, y: 0 }], [{ x: 0, y: 0 }, { x: 200, y: 0 }])).toEqual({ dx: 0, dy: 0, factor: 2, centro: { x: 100, y: 0 } });
  // One finger of two moves: the centre moves half as far.
  expect(pasoGesto([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 0, y: 0 }, { x: 100, y: 40 }]).dy).toBe(20);
  // Two fingers on one spot never divide by zero.
  expect(pasoGesto([{ x: 5, y: 5 }, { x: 5, y: 5 }], [{ x: 9, y: 5 }, { x: 5, y: 5 }]).factor).toBe(1);
});

it('a phone opens the viewer, a tablet or a desktop the editor, unless the URL says', () => {
  expect(abrirVisor('?visor', 1080)).toBe(true);
  expect(abrirVisor('', 390)).toBe(true);
  expect(abrirVisor('?editor', 390)).toBe(false);
  expect(abrirVisor('', 768)).toBe(false);
});

it('lists the examples and, for a repository, its processes', async () => {
  const pedido = proyectoDeEjemplo('pedido');
  const [mm3] = processesOf(proyectoDeEjemplo('mm3'));
  const doc = { ...pedido, process: { slug: 'pedido', name: 'Pedido' }, processes: [{ ...mm3!, slug: 'mm3', name: 'Cola' }] };
  await act(async () => root.render(<Visor inicial={doc} />));
  const procesos = container.querySelector<HTMLSelectElement>('.visor-procesos')!;
  expect([...procesos.options].map((o) => o.text)).toEqual(['Pedido', 'Cola']);
  expect(container.querySelector<HTMLSelectElement>('.visor-ejemplos')!.options).toHaveLength(EJEMPLOS.length + 1);
  // The mobile notice is there on every visit.
  expect(container.querySelector('.visor-aviso h2')!.textContent).toBe(T.visor.avisoTitulo);
  // Nothing in the gallery carries a run, so there is no heat map to show.
  expect(container.querySelector<HTMLInputElement>('.visor-calor input')!.disabled).toBe(true);
});
