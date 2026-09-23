/*
 * Geometría y colores que solo viven en la hoja de estilos (LILA-208).
 *
 * jsdom no maquetea: `getBoundingClientRect` devuelve ceros para todo, así que la distancia de
 * los controles de zoom a la marca de agua no se puede medir en `App.test.tsx`. El dato vive en
 * `app.css`, y aquí se comprueba ahí mismo. Sin `@vitest-environment jsdom` a propósito: esto
 * es lectura de un archivo, no un render.
 */
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

// La ruta va en una variable a propósito: el plugin de assets de Vite reescribe
// `new URL('./algo.css', import.meta.url)` con la ruta literal y devuelve una URL http, que
// `readFileSync` rechaza. Con la ruta en una variable el `file://` llega intacto.
const ruta = './app.css';
const appCss = readFileSync(new URL(ruta, import.meta.url), 'utf8');

/** Escapa lo que un selector CSS puede traer y un `RegExp` no puede leer literal (`[`, `]`, `'`…). */
const escaparRegex = (texto: string): string => texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Cuerpo de la primera regla con ese selector exacto. */
const bloque = (selector: string): string =>
  new RegExp(`${escaparRegex(selector)}\\s*\\{([^}]*)\\}`).exec(appCss)?.[1] ?? '';

it('la pila de zoom deja libre la esquina de la marca de agua', () => {
  // «Powered by bpmn.io» es obligatoria por la licencia de bpmn.io: es un enlace absoluto a
  // 15 px del borde inferior derecho del lienzo y mide unos 14 px de alto. La pila arranca
  // por encima de esos 15 px y alineada con ella.
  const zoom = bloque('.zoom');
  expect(zoom).toContain('right: 15px');
  expect(Number.parseInt(/bottom:\s*(\d+)px/.exec(zoom)?.[1] ?? '0', 10)).toBeGreaterThanOrEqual(40);
});

it('el minimapa se viste con los tokens del tema y sin radio', () => {
  const minimapa = bloque('.lienzo .djs-minimap');
  expect(minimapa).toContain('var(--canvas-bg)');
  expect(minimapa).toContain('var(--border-strong)');
  expect(minimapa).toContain('border-radius: 0');
  // Abajo a la izquierda, no arriba a la derecha como lo pone el plugin.
  expect(minimapa).toContain('bottom: 14px');
  expect(minimapa).toContain('left: 14px');
  expect(bloque('.lienzo .djs-minimap .viewport-dom')).toContain('var(--accent-primary)');
});

it('«Validar rutas» solo esconde el interruptor propio del módulo, no sus mandos (LILA-065)', () => {
  // El modo se enciende desde la barra superior, así que el botón «Token Simulation» que el
  // módulo inyecta en el lienzo sobra. Lo que NO puede taparse es el resto de su interfaz: la
  // paleta de play/pausa/reiniciar (`.bts-palette`), los botones sobre las figuras que arrancan
  // un token y ponen puntos de parada (`.bts-context-pad`), el registro (`.bts-log`) y sus
  // avisos (`.bts-notifications`). Sin ellos no se puede animar paso a paso, que es la
  // aceptación del ticket.
  expect(bloque('.lienzo .bts-toggle-mode')).toContain('display: none');
  for (const mando of ['bts-palette', 'bts-context-pad', 'bts-log', 'bts-notification', 'bts-token']) {
    const reglas = appCss.match(new RegExp(`[^}]*\\.${mando}[^{]*\\{[^}]*\\}`, 'g')) ?? [];
    expect(reglas.filter((r) => /display:\s*none|visibility:\s*hidden/.test(r))).toEqual([]);
  }
});

it('el select, la casilla y la fecha nativos pierden el aspecto del navegador (diseño 2d)', () => {
  const select = bloque('.app select');
  expect(select).toContain('appearance: none');
  expect(select).toContain('border-radius: 0');

  const casilla = bloque(".app input[type='checkbox']");
  expect(casilla).toContain('appearance: none');
  expect(casilla).toContain('border-radius: 0');

  const fecha = bloque(".app input[type='datetime-local']");
  expect(fecha).toContain('border-radius: 0');
  // Sin esto el borde suma 2 px al alto de contenido y el campo sale de 32 px, no 30 como el
  // resto (QA de la ronda 1 de #392).
  expect(fecha).toContain('box-sizing: border-box');
});

it('el glifo del selector de fecha no se invierte por encima de `color-scheme: dark` (QA de la ronda 1 de #392)', () => {
  // `color-scheme: dark` ya hace que el navegador pinte el glifo en claro sobre este control
  // oscuro; invertirlo aquí encima lo devolvía a oscuro sobre oscuro (negro sobre negro en
  // Eva-01/Akira). La regla sigue viva —solo la opacidad—, así que se busca por su selector
  // exacto y se comprueba que no trae ningún `filter`.
  const glifo = bloque("input[type='datetime-local']::-webkit-calendar-picker-indicator");
  expect(glifo).not.toEqual('');
  expect(glifo).not.toContain('filter');
});

it('la marca y los modos no se envuelven: son lo primero que tiene que caber en la barra (QA de la ronda 1 de #392)', () => {
  // Sin esto, «Lila Modeler» y «Validate paths»/«Validar rutas» se parten en dos líneas antes de
  // que el buscador inerte —lo único prescindible de la barra— ceda su sitio, y la barra crece
  // de 53 px a 60-67.
  const identidad = bloque('.identidad');
  expect(identidad).toContain('flex: none');
  expect(identidad).toContain('white-space: nowrap');
  expect(bloque('.modo')).toContain('white-space: nowrap');

  const buscador = bloque('.buscador');
  expect(buscador).toContain('flex: 0 1 210px');
  expect(buscador).toContain('min-width: 0');
  // El ancho fijo de antes competía con el `flex` de arriba por quién manda; tiene que quedar
  // solo el `flex`, no los dos.
  expect(buscador).not.toContain('width: 210px');
});

it('en toda la hoja el radio es 0, salvo el círculo marcado del disco de validación', () => {
  const radios = [...appCss.matchAll(/border-radius:\s*([^;]+);/g)].map((m) => (m[1] ?? '').trim());
  // Si esto falla con algo que no sea «50%» es que una regla nueva volvió a redondear una
  // esquina sin decir por qué (el comentario que acompaña al 50% es el sitio para esa excepción).
  expect(radios.filter((r) => r !== '0')).toEqual(['50%']);
});
