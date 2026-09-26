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
import { Bienvenida } from './Bienvenida';
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
