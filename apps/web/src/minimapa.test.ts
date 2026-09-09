// @vitest-environment jsdom
/**
 * The minimap header follows the language (QA of #301, LILA-210).
 *
 * The caption used to be a literal `content: 'Minimapa'` in `app.css`, so the English UI showed
 * «MINIMAPA». It now comes from the catalog through `data-titulo`, which is what these two halves
 * check: the text written on the element, and the stylesheet drawing that attribute instead of a
 * word of its own.
 */
import { readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { rotularMinimapa } from './minimapa';
import { setLocale } from './i18n';
import { en } from './strings.en';
import { es } from './strings.es';

afterEach(() => setLocale('auto'));

/** The plugin's header, as `diagram-js-minimap` leaves it in the canvas. */
const cabecera = (): Element => {
  const minimapa = document.createElement('div');
  minimapa.className = 'djs-minimap open';
  minimapa.innerHTML = '<div class="toggle"></div>';
  return minimapa.querySelector('.toggle')!;
};

it('rotula la cabecera en el idioma activo, plegada y abierta', () => {
  const toggle = cabecera();
  setLocale('en');
  rotularMinimapa(toggle, true);
  expect(toggle.getAttribute('data-titulo')).toBe(en.lienzo.minimapa);
  expect(toggle.getAttribute('title')).toBe(en.lienzo.plegarMinimapa);
  rotularMinimapa(toggle, false);
  expect(toggle.getAttribute('title')).toBe(en.lienzo.desplegarMinimapa);
});

it('cambiar de idioma reescribe el rótulo, no solo el tooltip', () => {
  const toggle = cabecera();
  setLocale('en');
  rotularMinimapa(toggle, true);
  setLocale('es');
  rotularMinimapa(toggle, true);
  expect(toggle.getAttribute('data-titulo')).toBe(es.lienzo.minimapa);
  expect(toggle.getAttribute('title')).toBe(es.lienzo.plegarMinimapa);
  // Y los dos catálogos dicen cosas distintas: si algún día coincidieran, esta prueba no probaría
  // nada y hay que cambiarla, no borrarla.
  expect(es.lienzo.minimapa).not.toBe(en.lienzo.minimapa);
});

it('sin minimapa todavía montado no rompe', () => {
  // El efecto que vigila el idioma corre antes de que bpmn-js haya construido el lienzo.
  expect(() => rotularMinimapa(null, true)).not.toThrow();
  expect(() => rotularMinimapa(undefined, false)).not.toThrow();
});

it('app.css dibuja el atributo y no una palabra suya', () => {
  // La ruta va en una variable por lo mismo que en `app.css.test.ts`: el plugin de assets de Vite
  // reescribe un `new URL('./algo.css', import.meta.url)` literal y devuelve una URL http.
  const ruta = './app.css';
  const appCss = readFileSync(new URL(ruta, import.meta.url), 'utf8');
  const antes = /\.lienzo \.djs-minimap \.toggle::before\s*\{([^}]*)\}/.exec(appCss)?.[1] ?? '';
  expect(antes.replaceAll(/\s+/gu, ' ').trim()).toBe('content: attr(data-titulo);');
  // Y ningún `content` de la hoja guarda texto traducible: los que quedan son comillas vacías y
  // los dos triángulos del plegado. Los comentarios se quitan antes: varios hablan justamente de
  // `content`, y lo que se vigila es lo que llega al navegador.
  const sinComentarios = appCss.replaceAll(/\/\*[\s\S]*?\*\//g, '');
  const contenidos = [...sinComentarios.matchAll(/(?<![\w-])content:\s*([^;}]+)/g)].map((m) => m[1]!.trim());
  expect(contenidos.filter((valor) => /\p{Letter}{3,}/u.test(valor.replace(/^attr\([^)]*\)$/u, '')))).toEqual([]);
});
