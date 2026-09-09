// @vitest-environment jsdom
/**
 * Aceptación de LILA-205 (#264): en el modo «Validar rutas» los textos visibles salen en español
 * y el diagrama conserva los colores del tema mientras dura la animación.
 *
 * El marcado de las pruebas es el que emite `bpmn-js-token-simulation@0.40.0` —copiado de
 * `node_modules/bpmn-js-token-simulation/lib`, con sus clases y sus `title`—, no una invención:
 * si el módulo cambia sus plantillas, esta prueba sigue verde y el aviso llega por el mapa de
 * `strings.es.ts`, que es donde está escrito de qué versión se habla.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { observarSimulacion, traducirSimulacion, traducirTexto } from './TokenSim';
import { S } from './strings.es';

const AQUI = dirname(fileURLToPath(import.meta.url));
const appCss = readFileSync(resolve(AQUI, 'app.css'), 'utf8');

/** La interfaz que el módulo monta dentro del contenedor del lienzo, tal cual la escribe. */
function lienzoConSimulacion(): HTMLElement {
  const contenedor = document.createElement('div');
  contenedor.innerHTML = `
    <div class="bts-toggle-mode">Token Simulation <span class="bts-toggle"></span></div>
    <div class="bts-palette">
      <button class="bts-entry" title="Play/Pause Simulation"></button>
      <button class="bts-entry" title="Reset Simulation"></button>
      <button class="bts-entry" title="Toggle Simulation Log"></button>
      <button class="bts-entry" data-speed="0.5" title="Set animation speed = Slow"></button>
    </div>
    <div class="bts-log">
      <div class="bts-header">Simulation Log</div>
      <p class="bts-entry placeholder">No Entries</p>
    </div>
    <div class="bts-context-pad-container">
      <button class="bts-context-pad" title="Add pause point"></button>
      <button class="bts-context-pad" title="Trigger Event"></button>
    </div>
  `;
  document.body.appendChild(contenedor);
  return contenedor;
}

/** Una entrada del registro, con la misma forma que `Log.js` (`title` y texto repetidos). */
function entradaDeRegistro(texto: string): HTMLElement {
  const p = document.createElement('p');
  p.className = 'bts-entry';
  p.innerHTML = `<span class="bts-icon"></span><span class="bts-text" title="${texto}">${texto}</span>`;
  return p;
}

describe('«Validar rutas»: la UI del módulo en español (#264)', () => {
  it('traduce los rótulos, los `title` de la paleta y del context pad, y el registro', () => {
    const lienzo = lienzoConSimulacion();
    traducirSimulacion(lienzo);

    const titulo = (selector: string): string =>
      lienzo.querySelector<HTMLElement>(selector)?.title ?? '';

    expect(lienzo.querySelector('.bts-toggle-mode')?.textContent).toContain(
      S.tokenSim.traducciones['Token Simulation'],
    );
    expect(titulo('[data-speed]')).toBe(S.tokenSim.velocidad(S.tokenSim.traducciones['Slow']!));
    expect(lienzo.querySelector('.bts-header')?.textContent?.trim()).toBe(
      S.tokenSim.traducciones['Simulation Log'],
    );
    expect(lienzo.querySelector('.placeholder')?.textContent).toBe(
      S.tokenSim.traducciones['No Entries'],
    );
    // Ni un solo texto en inglés a la vista, y ningún `title` sin traducir.
    expect(lienzo.textContent).not.toMatch(/Token Simulation|Simulation Log|No Entries/);
    for (const boton of lienzo.querySelectorAll<HTMLElement>('[title]')) {
      expect(traducirTexto(boton.title)).toBeUndefined();
    }
  });

  it('deja en paz lo que no es suyo y se puede repetir sin cambiar nada', () => {
    const lienzo = lienzoConSimulacion();
    // El nombre de una figura sale del modelo y ya está en español: no se toca.
    lienzo.appendChild(entradaDeRegistro('Tomar pedido'));
    traducirSimulacion(lienzo);
    const primera = lienzo.innerHTML;
    traducirSimulacion(lienzo);
    expect(lienzo.innerHTML).toBe(primera);
    expect(lienzo.textContent).toContain('Tomar pedido');
  });

  it('traduce también lo que el módulo pinta después (el registro crece por pasos)', async () => {
    const lienzo = lienzoConSimulacion();
    const parar = observarSimulacion(lienzo);
    try {
      lienzo.querySelector('.bts-log')?.appendChild(entradaDeRegistro('Found unsupported elements'));
      // El `MutationObserver` entrega en microtarea: basta ceder el turno una vez.
      await Promise.resolve();
      await new Promise((listo) => {
        setTimeout(listo, 0);
      });
      expect(lienzo.textContent).toContain(
        S.tokenSim.traducciones['Found unsupported elements'],
      );
      expect(lienzo.textContent).not.toContain('Found unsupported elements');
    } finally {
      parar();
    }
  });

  it('el aviso que distingue la animación de la simulación DES sale de strings.es.ts', () => {
    expect(S.tokenSim.aviso).toContain('no es simulación de eventos discretos');
  });
});

describe('«Validar rutas»: el diagrama conserva los colores del tema (#264)', () => {
  it('deshace el repintado neutro de NeutralElementColors con los tokens del tema', () => {
    // Los dos únicos valores que escribe el módulo sobre TODAS las figuras.
    expect(appCss).toContain('.lienzo .bjs-container.simulation .djs-visual [fill="#fff"]');
    expect(appCss).toContain('.lienzo .bjs-container.simulation .djs-visual [stroke="#212121"]');
    const reglas = appCss.match(/\.lienzo \.bjs-container\.simulation[^{]*\{[^}]*\}/g) ?? [];
    expect(reglas.length).toBeGreaterThanOrEqual(3);
    expect(reglas.join('\n')).toContain('var(--diagram-fill)');
    expect(reglas.join('\n')).toContain('var(--diagram-stroke)');
    expect(reglas.join('\n')).toContain('var(--diagram-label)');
    // Ningún color a pelo: si el tema cambia, esto cambia con él.
    for (const regla of reglas) {
      expect(regla.split('{')[1]).not.toMatch(/#[0-9a-f]{3,6}/i);
    }
  });

  it('no toca los colores con los que la propia animación marca el flujo o el error', () => {
    // El verde del flujo elegido y el rojo del elemento no admitido llevan otro valor que `#fff`
    // y `#212121`; si alguien ampliara el selector a `.djs-visual *` se los llevaría por delante.
    const reglas = appCss.match(/\.lienzo \.bjs-container\.simulation[^{]*\{[^}]*\}/g) ?? [];
    for (const regla of reglas) {
      expect(regla).toMatch(/\[(?:fill|stroke)="#(?:fff|212121)"\]/);
    }
  });
});
