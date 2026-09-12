// @vitest-environment jsdom
/**
 * Controls of the replay (#331): play/pause, reset, the speed select and the «Instant» jump, plus
 * the empty state when the selected scenario has nothing to animate.
 *
 * The `Replay` here is a hand-written one, not a simulated run: what is under test is the clock
 * and the panel, and `replayModel.test.ts` already pins the model against the engine.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import type { Modelador } from '../Modeler';
import { Replay } from './Replay';
import type { Replay as ReplayModel } from './replayModel';
import type { ReplayPintura as PinturaOverlay } from './ReplayOverlay';
import { setLocale } from '../i18n';

/** `act` needs to know it is running in a test environment, same as the other jsdom suites. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => setLocale('en'));

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;

function montar(nodo: React.JSX.Element): void {
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => { raiz?.render(nodo); });
}

afterEach(() => {
  if (raiz !== null) act(() => raiz?.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

function boton(texto: string): HTMLButtonElement {
  const encontrado = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === texto);
  if (encontrado === undefined) throw new Error(`no button «${texto}»`);
  return encontrado;
}

function pulsar(texto: string): void {
  const destino = boton(texto);
  act(() => { destino.click(); });
}

function elegir(valor: string): void {
  const campo = document.querySelector('select');
  if (!(campo instanceof HTMLSelectElement)) throw new Error('no speed select');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(campo, valor);
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const progreso = (): string | null =>
  document.querySelector('[data-replay-progress]')?.getAttribute('data-replay-progress') ?? null;

/** One task, one start crossing, one pool, one hop: enough to exercise the clock without the engine. */
function modelo(): ReplayModel {
  return {
    activities: [{
      allocations: [{ quantity: 1, resourceId: 'analyst' }],
      caseId: '1',
      completed: true,
      elementId: 'Task_A',
      enabledAt: 0,
      endAt: 100,
      startedAt: 10,
    }],
    elementIds: ['Task_A', 'Start_1'],
    horizon: 100,
    moves: [{ flows: ['Flow_1'], from: 100, to: 120 }],
    passages: [{ at: 0, elementId: 'Start_1' }],
    pools: { analyst: 2 },
    replications: 1,
    rows: 3,
    startMs: Date.parse('2026-09-07T14:00:00.000Z'),
    truncated: false,
  };
}

function falso(): { modelador: Modelador; pinturas: (PinturaOverlay | null)[] } {
  const pinturas: (PinturaOverlay | null)[] = [];
  const modelador = { replay: (pintura: PinturaOverlay | null) => { pinturas.push(pintura); } } as unknown as Modelador;
  return { modelador, pinturas };
}

it('starts paused at the beginning and toggles to Pause when played', () => {
  const { modelador } = falso();
  montar(<Replay modelador={modelador} replay={modelo()} originalIds={{}} motivo="x" />);
  expect(progreso()).toBe('0');
  pulsar('Play');
  expect(boton('Pause')).toBeDefined();
  pulsar('Pause');
  expect(boton('Play')).toBeDefined();
});

it('«Instant» jumps to the end of the replication, and Reset comes back to zero', () => {
  const { modelador } = falso();
  montar(<Replay modelador={modelador} replay={modelo()} originalIds={{}} motivo="x" />);
  elegir('instantanea');
  expect(progreso()).toBe('100');
  expect(document.body.textContent).toContain('End of the replication');
  pulsar('Reset');
  expect(progreso()).toBe('0');
  expect(document.body.textContent).not.toContain('End of the replication');
});

it('paints a frame on the canvas and shows the pool with its capacity', async () => {
  const { modelador, pinturas } = falso();
  montar(<Replay modelador={modelador} replay={modelo()} originalIds={{}} motivo="x" />);
  await act(async () => { await new Promise((ok) => setTimeout(ok, 80)); });
  const ultima = pinturas.filter((p) => p !== null).pop();
  expect(ultima?.elementIds).toEqual(['Task_A', 'Start_1']);
  expect(ultima?.state.elements['Task_A']).toEqual({ completed: 0, queue: 1, running: 0, started: 1 });
  // The start event has no duration: crossing it counts as started and completed at once.
  expect(ultima?.state.elements['Start_1']).toEqual({ completed: 1, queue: 0, running: 0, started: 1 });
  expect(document.querySelector('[data-pool="analyst"]')?.textContent).toContain('2');
});

it('without a log there is nothing to animate and Play is disabled', () => {
  const { modelador, pinturas } = falso();
  montar(<Replay modelador={modelador} replay={null} originalIds={{}} motivo="no log here" />);
  expect(boton('Play').disabled).toBe(true);
  expect(document.body.textContent).toContain('no log here');
  expect(progreso()).toBe(null);
  expect(pinturas).toEqual([null]);
});

it('clears the overlay when the mode is left', () => {
  const limpiar = vi.fn();
  const modelador = { replay: limpiar } as unknown as Modelador;
  montar(<Replay modelador={modelador} replay={modelo()} originalIds={{}} motivo="x" />);
  act(() => raiz?.unmount());
  raiz = null;
  expect(limpiar).toHaveBeenLastCalledWith(null);
});
