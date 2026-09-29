// @vitest-environment jsdom
/**
 * `Bienvenida` in isolation — no `App`, no bpmn-js, no `window.lila`: it is a pure function of
 * its props plus the active catalog (`i18n.ts`), so mounting it directly is enough to cover both
 * the recent-projects list (already covered end-to-end through `App.test.tsx`) and the new
 * example gallery (#458), whose acceptance is «lists N examples with a description and
 * `onAccion({ejemplo})»`.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Bienvenida, pistaConAtajo } from './Bienvenida';
import { EJEMPLOS } from './ejemplos';
import { en as T } from './strings.en';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it('lista todos los ejemplos del catálogo con su descripción de una línea', async () => {
  const onAccion = vi.fn();
  await act(async () => root.render(
    <Bienvenida recientes={[]} temaNombre="Lila" densidadTexto="cómoda" onAccion={onAccion} onAjustes={() => {}} />,
  ));
  const filas = [...container.querySelectorAll<HTMLLIElement>('.bienvenida-ejemplos li')];
  // Uno por entrada del catálogo (#458): un ejemplo nuevo en `ejemplos.ts` sin su fila en la
  // galería, o al revés, hace fallar esta prueba en vez de quedar en silencio.
  expect(filas).toHaveLength(EJEMPLOS.length);
  const leidas = filas.map((fila) => ({
    titulo: fila.querySelector('strong')!.textContent,
    pista: fila.querySelector('small')!.textContent,
  }));
  const esperadas = EJEMPLOS.map((ejemplo) => T.bienvenida.ejemplos[ejemplo.id]);
  expect(leidas).toEqual(esperadas);
  // Cada título y cada pista es texto suyo, no el mismo repetido por accidente (LILA-058-ish
  // guard contra un `map` que perdió el índice y copió la primera fila N veces).
  expect(new Set(leidas.map((f) => f.titulo)).size).toBe(EJEMPLOS.length);
});

it('pulsar una fila de la galería emite onAccion({ ejemplo }) con el id del catálogo, no una acción de archivo', async () => {
  const onAccion = vi.fn();
  await act(async () => root.render(
    <Bienvenida recientes={[]} temaNombre="Lila" densidadTexto="cómoda" onAccion={onAccion} onAjustes={() => {}} />,
  ));
  const filas = [...container.querySelectorAll<HTMLLIElement>('.bienvenida-ejemplos li')];
  await act(async () => { filas[2]!.querySelector('button')!.click(); });
  expect(onAccion).toHaveBeenCalledExactlyOnceWith({ ejemplo: EJEMPLOS[2]!.id });
});

it('la pista de abrir y nuevo muestra Ctrl fuera de macOS y ⌘ en macOS, con el atajo del mapa único', () => {
  expect(pistaConAtajo('abrir', T.bienvenida.abrirCarpetaPista, false)).toBe('Ctrl+O · a folder with model.bpmn');
  expect(pistaConAtajo('nuevo', T.bienvenida.nuevoPista, false)).toBe('Ctrl+N · creates an empty .bpmn');
  expect(pistaConAtajo('abrir', T.bienvenida.abrirCarpetaPista, true)).toBe('⌘O · a folder with model.bpmn');
  expect(pistaConAtajo('nuevo', T.bienvenida.nuevoPista, true)).toBe('⌘N · creates an empty .bpmn');
});

it('los textos de la bienvenida ya no llevan el atajo escrito: lo compone el componente', () => {
  for (const pista of [T.bienvenida.abrirCarpetaPista, T.bienvenida.nuevoPista]) expect(pista).not.toMatch(/[⌘⌃]|Ctrl/);
});

it('en una plataforma que no es Mac (jsdom) las acciones dicen Ctrl+O y Ctrl+N, no ⌘', async () => {
  await act(async () => root.render(
    <Bienvenida recientes={[]} temaNombre="Lila" densidadTexto="cómoda" onAccion={vi.fn()} onAjustes={() => {}} />,
  ));
  const pistas = [...container.querySelectorAll('.bienvenida-accion small')].map((s) => s.textContent);
  expect(pistas).toContain('Ctrl+O · a folder with model.bpmn');
  expect(pistas).toContain('Ctrl+N · creates an empty .bpmn');
  expect(container.querySelector('.bienvenida-izq')!.textContent).not.toContain('⌘');
});
