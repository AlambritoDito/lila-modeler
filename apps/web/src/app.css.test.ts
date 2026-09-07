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
