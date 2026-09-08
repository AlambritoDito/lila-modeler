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

/** Cuerpo de la primera regla con ese selector exacto. */
const bloque = (selector: string): string =>
  new RegExp(`${selector.replaceAll('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(appCss)?.[1] ?? '';

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
