// @vitest-environment jsdom
/**
 * «Scenario ▾» (Lote M, it replaced the Simulate rail and its RailEscenarios.test): the list with
 * BASE and «Simulated», the validation chips, Duplicate (visible, one click, the copy's name ready
 * to edit), Rename with Enter and Esc, Save, and the dropdown's keyboard.
 */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { StoredRun } from './store/ProjectStore';
import { SelectorEscenario, type SelectorEscenarioProps } from './SelectorEscenario';
import { setLocale, strings } from './i18n';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
setLocale('en');
const S = strings();

let raiz: Root | null = null;
let caja: HTMLDivElement;
afterEach(() => { act(() => raiz?.unmount()); raiz = null; caja?.remove(); });

const ESCENARIOS = {
  'as-is.scenario.json': { version: 1, name: 'AS-IS', model: 'model.bpmn' },
  'to-be.scenario.json': { version: 1, name: 'TO-BE', extends: 'as-is.scenario.json' },
};

type Extra = Partial<SelectorEscenarioProps>;
function Arnes(extra: Extra & { cambios?: [string, Record<string, unknown>][] }): React.JSX.Element {
  const [escenarios, setEscenarios] = useState<Record<string, Record<string, unknown>>>(ESCENARIOS);
  const [activo, setActivo] = useState('as-is.scenario.json');
  return (
    <SelectorEscenario
      escenarios={escenarios}
      activo={activo}
      corridas={[{ scenarioName: 'as-is.scenario.json' } as StoredRun]}
      validacion={{ errores: 0, avisos: 0, primero: null }}
      ir={null}
      onElegir={setActivo}
      onDuplicar={() => {
        const copia = { archivo: 'as-is (copy).scenario.json', nombre: 'AS-IS (copy)' };
        setEscenarios((e) => ({ ...e, [copia.archivo]: { version: 1, name: copia.nombre, extends: 'as-is.scenario.json' } }));
        setActivo(copia.archivo);
        return copia;
      }}
      onCambio={(archivo, escenario) => { extra.cambios?.push([archivo, escenario]); setEscenarios((e) => ({ ...e, [archivo]: escenario })); }}
      onGuardar={() => {}}
      onProblema={() => {}}
      {...extra}
    />
  );
}
function montar(extra: Extra & { cambios?: [string, Record<string, unknown>][] } = {}): void {
  caja = document.createElement('div');
  document.body.append(caja);
  raiz = createRoot(caja);
  act(() => raiz!.render(<Arnes {...extra} />));
}
const boton = (): HTMLButtonElement => caja.querySelector('.c5-escenario-boton')!;
const abrir = (): void => act(() => boton().click());
const fila = (nombre: string): HTMLButtonElement =>
  [...caja.querySelectorAll<HTMLButtonElement>('.c5-escenario-fila')].find((b) => b.querySelector('.c5-escenario-nombre')!.firstChild!.textContent === nombre)!;
const accion = (texto: string): HTMLButtonElement => [...caja.querySelectorAll<HTMLButtonElement>('.c5-escenario-acciones button')].find((b) => b.textContent === texto)!;
const tecla = (destino: Element, key: string): void => act(() => { destino.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });

it('lists the scenarios with BASE, «Simulated» / «Not simulated» and the parent they extend', () => {
  montar();
  expect(boton().textContent).toContain('AS-IS');
  expect(boton().querySelector('.insignia-base')).not.toBeNull();
  expect(boton().getAttribute('aria-expanded')).toBe('false');
  abrir();
  expect(boton().getAttribute('aria-expanded')).toBe('true');
  expect(fila('AS-IS').getAttribute('aria-current')).toBe('true');
  expect(fila('AS-IS').querySelector('.insignia-base')).not.toBeNull();
  expect(fila('AS-IS').textContent).toContain(S.c5.escenario.simulado);
  expect(fila('TO-BE').querySelector('.insignia-base')).toBeNull();
  expect(fila('TO-BE').textContent).toContain(S.c5.escenario.sinSimular);
  expect(fila('TO-BE').textContent).toContain(S.c5.escenario.hereda('AS-IS'));
  act(() => fila('TO-BE').click());
  expect(caja.querySelector('.c5-escenario-menu')).toBeNull();
  expect(boton().textContent).toContain('TO-BE');
  expect(document.activeElement).toBe(boton());
});

it('the chips count errors and warnings and jump to the first problem; none without problems', () => {
  const onProblema = vi.fn();
  montar({ validacion: { errores: 2, avisos: 1, primero: 'Task_1' }, onProblema });
  const chips = [...caja.querySelectorAll<HTMLButtonElement>('.c5-chips .chip')];
  expect(chips.map((c) => c.textContent)).toEqual([S.app.errores(2), S.app.avisos(1)]);
  act(() => chips[0]!.click());
  expect(onProblema).toHaveBeenCalledWith('Task_1');
  act(() => raiz!.unmount()); caja.remove();
  montar();
  expect(caja.querySelector('.c5-chips')).toBeNull();
});

it('the visible Duplicate is one click and leaves the copy\'s name ready; Enter keeps the new name', () => {
  const cambios: [string, Record<string, unknown>][] = [];
  montar({ cambios });
  act(() => caja.querySelector<HTMLButtonElement>('.c5-duplicar')!.click());
  const campo = caja.querySelector<HTMLInputElement>('.c5-escenario-campo')!;
  expect(document.activeElement).toBe(campo);
  expect(campo.value).toBe('AS-IS (copy)');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(campo, 'TO-BE 2'); campo.dispatchEvent(new Event('input', { bubbles: true })); });
  tecla(campo, 'Enter');
  expect(cambios).toEqual([['as-is (copy).scenario.json', { version: 1, name: 'TO-BE 2', extends: 'as-is.scenario.json' }]]);
  expect(boton().textContent).toContain('TO-BE 2');
  expect(caja.querySelector('.c5-escenario-menu')).toBeNull();
});

it('Rename: Esc leaves the name as it was, and a second Esc closes the dropdown back on its button', () => {
  const cambios: [string, Record<string, unknown>][] = [];
  montar({ cambios });
  abrir();
  act(() => accion(S.c5.escenario.renombrar).click());
  const campo = caja.querySelector<HTMLInputElement>('.c5-escenario-campo')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setter.call(campo, 'Otro'); campo.dispatchEvent(new Event('input', { bubbles: true })); });
  tecla(campo, 'Escape');
  expect(caja.querySelector('.c5-escenario-campo')).toBeNull();
  expect(cambios).toEqual([]);
  expect(caja.querySelector('.c5-escenario-menu')).not.toBeNull();
  tecla(caja.querySelector('.c5-escenario-menu')!, 'Escape');
  expect(caja.querySelector('.c5-escenario-menu')).toBeNull();
  expect(document.activeElement).toBe(boton());
});

it('Save project saves and closes; a click outside closes too', () => {
  const onGuardar = vi.fn();
  montar({ onGuardar });
  abrir();
  act(() => accion(S.c5.escenario.guardar).click());
  expect(onGuardar).toHaveBeenCalledOnce();
  expect(caja.querySelector('.c5-escenario-menu')).toBeNull();
  abrir();
  act(() => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
  expect(caja.querySelector('.c5-escenario-menu')).toBeNull();
});
