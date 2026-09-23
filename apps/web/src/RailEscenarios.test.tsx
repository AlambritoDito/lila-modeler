// @vitest-environment jsdom
/**
 * Design 2a — the scenario rail of Simulate: one row per scenario, the active one marked, the
 * BASE badge on the scenario without `extends`, and a subtitle that says whether it has a run.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

import { RailEscenarios } from './RailEscenarios';
import { setLocale } from './i18n';
import { en as T } from './strings.en';
import type { StoredRun } from './store/ProjectStore';

setLocale('en');
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root | null = null;
let contenedor: HTMLDivElement | null = null;
afterEach(() => {
  if (raiz !== null) act(() => raiz!.unmount());
  contenedor?.remove();
  raiz = null;
  contenedor = null;
});

const ESCENARIOS = {
  'as-is.scenario.json': { version: 1, name: 'AS-IS', run: { seed: 42, replications: 30 } },
  'to-be.scenario.json': { version: 1, name: 'TO-BE', extends: 'as-is.scenario.json' },
};
const corrida = { scenarioName: 'as-is.scenario.json', inputs: { scenario: { run: { seed: 42, replications: 30 } } } } as unknown as StoredRun;

function montar(props: Partial<Parameters<typeof RailEscenarios>[0]> = {}) {
  const onElegir = vi.fn();
  const onNuevo = vi.fn();
  const onProblema = vi.fn();
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  raiz = createRoot(contenedor);
  act(() => raiz!.render(
    <RailEscenarios escenarios={ESCENARIOS} activo="as-is.scenario.json" corridas={[corrida]}
      validacion={{ errores: 0, avisos: 6, primero: 'Task_1' }}
      onElegir={onElegir} onNuevo={onNuevo} onProblema={onProblema} {...props} />,
  ));
  const filas = [...contenedor.querySelectorAll<HTMLButtonElement>('.rail-fila')];
  return { onElegir, onNuevo, onProblema, filas };
}

it('lists the scenarios and marks the active one', () => {
  const { filas } = montar();
  expect(filas.map((f) => f.querySelector('.rail-nombre')!.firstChild!.textContent)).toEqual(['AS-IS', 'TO-BE']);
  expect(filas[0]!.getAttribute('aria-current')).toBe('true');
  expect(filas[1]!.hasAttribute('aria-current')).toBe(false);
});

it('shows the BASE badge only on the scenario without extends', () => {
  const { filas } = montar();
  expect(filas[0]!.querySelector('.insignia-base')?.textContent).toBe(T.rail.base);
  expect(filas[1]!.querySelector('.insignia-base')).toBeNull();
});

it('the subtitle says the seed and replications of the run, or that it was not run', () => {
  const { filas } = montar();
  expect(filas[0]!.querySelector('.rail-sub')!.textContent).toBe(T.rail.corrida('42', '30'));
  expect(filas[1]!.querySelector('.rail-sub')!.textContent).toBe(`${T.rail.hereda('AS-IS')} · ${T.rail.sinCorrer}`);
  expect(filas[1]!.textContent).toContain(T.rail.sinCorrer);
});

it('clicking a row picks the scenario and + asks for a new one', () => {
  const { filas, onElegir, onNuevo } = montar();
  act(() => filas[1]!.click());
  expect(onElegir).toHaveBeenCalledWith('to-be.scenario.json');
  act(() => contenedor!.querySelector<HTMLButtonElement>(`button[aria-label="${T.rail.nuevo}"]`)!.click());
  expect(onNuevo).toHaveBeenCalledOnce();
});

it('enVentana overrides the subtitle of that scenario', () => {
  const { filas } = montar({ enVentana: 'as-is.scenario.json' });
  expect(filas[0]!.querySelector('.rail-sub')!.textContent).toBe(T.rail.enVentana);
});

it('the validation footer counts and jumps to the first problem', () => {
  const { onProblema } = montar();
  const chips = [...contenedor!.querySelectorAll<HTMLButtonElement>('.rail-pie .chip')];
  expect(chips.map((c) => c.textContent)).toEqual([T.app.errores(0), T.app.avisos(6)]);
  // Nothing to jump to from «0 errors», like the canvas chips that are not drawn at all.
  expect(chips.map((c) => c.disabled)).toEqual([true, false]);
  act(() => chips[1]!.click());
  expect(onProblema).toHaveBeenCalledWith('Task_1');
});
