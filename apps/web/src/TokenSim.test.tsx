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
import { Injector } from 'didi';
import { beforeEach, describe, expect, it } from 'vitest';
// Los dos módulos de la librería que `moduloColoresDelTema` sustituye. Se importan de verdad (no
// se copian sus nombres) para que la prueba se entere si el módulo los renombra.
import NeutralElementColorsModule from 'bpmn-js-token-simulation/lib/features/neutral-element-colors';
import SimulationStylesModule from 'bpmn-js-token-simulation/lib/features/simulation-styles';

import {
  ColoresNeutrosDelTema,
  EstilosDelTema,
  moduloColoresDelTema,
  observarSimulacion,
  traducirSimulacion,
  traducirTexto,
} from './TokenSim';
import { S } from './strings.es';

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
      <div class="bts-header">Simulation Log<button class="bts-close" aria-label="Close"></button></div>
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
    // El botón de cerrar el registro solo tiene `aria-label`: sin él, un lector de pantalla
    // seguiría diciendo «Close» (QA de #271).
    expect(lienzo.querySelector('.bts-close')?.getAttribute('aria-label')).toBe(
      S.tokenSim.traducciones['Close'],
    );
    // Ni un solo texto en inglés a la vista, y ningún `title` ni `aria-label` sin traducir.
    expect(lienzo.textContent).not.toMatch(/Token Simulation|Simulation Log|No Entries/);
    for (const nodo of lienzo.querySelectorAll('[title], [aria-label]')) {
      expect(traducirTexto(nodo.getAttribute('title') ?? '')).toBeUndefined();
      expect(traducirTexto(nodo.getAttribute('aria-label') ?? '')).toBeUndefined();
    }
  });

  it('traduce las entradas que el registro compone al vuelo (#271)', () => {
    const lienzo = lienzoConSimulacion();
    // `Log.js` compone «Process started» y «Process finished» en cada corrida: son la primera y
    // la última línea del registro, y el QA de #271 las vio en inglés en el navegador.
    for (const texto of ['Process started', 'Process finished', 'Task']) {
      lienzo.querySelector('.bts-log')?.appendChild(entradaDeRegistro(texto));
    }
    traducirSimulacion(lienzo);
    expect(lienzo.textContent).not.toMatch(/Process (started|finished)/);
    expect(lienzo.textContent).toContain(S.tokenSim.traducciones['Process started']);
    expect(lienzo.textContent).toContain(S.tokenSim.traducciones['Process finished']);
    expect(lienzo.textContent).toContain(S.tokenSim.traducciones['Task']);
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
  /** Los tokens que `applyTheme` escribiría en `documentElement` al cargar Eva-01. */
  function conTema(tokens: Record<string, string>): void {
    for (const [nombre, valor] of Object.entries(tokens)) {
      document.documentElement.style.setProperty(nombre, valor);
    }
  }

  /** Dobles de los tres servicios de bpmn-js que usa `ColoresNeutrosDelTema`. */
  function inyectorDePrueba(): {
    activar: () => void;
    pintados: Array<{ elemento: object; id: string; colores: { fill?: string; stroke?: string } }>;
    injector: Injector;
  } {
    const escuchas: Array<(evento: { active: boolean }) => void> = [];
    const pintados: Array<{ elemento: object; id: string; colores: { fill?: string; stroke?: string } }> = [];
    const elementos = [{ id: 'Tarea_1' }, { id: 'Flujo_1' }];
    const dobles = {
      eventBus: ['value', {
        // `EventBus.on` admite `(evento, fn)` y `(evento, prioridad, fn)`.
        on: (evento: string, ...resto: unknown[]) => {
          const escuchar = resto.at(-1);
          if (evento === 'tokenSimulation.toggleMode' && typeof escuchar === 'function') {
            escuchas.push(escuchar as (e: { active: boolean }) => void);
          }
        },
      }],
      elementRegistry: ['value', { forEach: (visita: (e: object) => void) => elementos.forEach(visita) }],
      elementColors: ['value', {
        add: (elemento: object, id: string, colores: { fill?: string; stroke?: string }) => {
          pintados.push({ elemento, id, colores });
        },
      }],
    };
    // Mismo orden que `Modeler.tsx`: los módulos de la librería primero y el nuestro después,
    // que es lo que hace que gane. Los dobles van al final porque `neutral-element-colors`
    // arrastra por `__depends__` el `elementColors` de verdad, y aquí lo que se quiere observar
    // son las llamadas a `add` (el servicio real escribe en el DI del modelo, que no existe).
    const injector = new Injector([
      NeutralElementColorsModule as never,
      SimulationStylesModule as never,
      moduloColoresDelTema as never,
      dobles as never,
    ]);
    return {
      injector,
      pintados,
      activar: () => {
        injector.get('neutralElementColors');
        for (const escuchar of escuchas) escuchar({ active: true });
      },
    };
  }

  beforeEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('sustituye los dos servicios de color del módulo, no los complementa', () => {
    // Si el módulo renombrara `neutralElementColors` o `simulationStyles`, o si alguien pusiera
    // `moduloColoresDelTema` ANTES en `additionalModules`, aquí saldría la clase de la librería.
    const { injector, activar } = inyectorDePrueba();
    activar();
    expect(injector.get('simulationStyles')).toBeInstanceOf(EstilosDelTema);
    expect(injector.get('neutralElementColors')).toBeInstanceOf(ColoresNeutrosDelTema);
  });

  it('pinta las figuras con los tokens del tema y no con el blanco y negro del módulo', () => {
    conTema({ '--diagram-fill': '#1F1A36', '--diagram-stroke': '#D9D2F0' });
    const { pintados, activar } = inyectorDePrueba();
    activar();

    expect(pintados).toHaveLength(2);
    for (const { id, colores } of pintados) {
      // Mismo id que el servicio original: las compuertas siguen pintando encima (prioridad 2000).
      expect(id).toBe('neutral-element-colors');
      expect(colores).toEqual({ fill: '#1F1A36', stroke: '#D9D2F0' });
    }
    // Los dos valores del bug: figura blanca con borde casi negro sobre el lienzo oscuro.
    expect(pintados.map((p) => p.colores.fill)).not.toContain('#fff');
    expect(pintados.map((p) => p.colores.stroke)).not.toContain('#212121');
  });

  it('no pinta nada al salir del modo (de eso se encarga el `elementColors` del módulo)', () => {
    conTema({ '--diagram-fill': '#FFFFFF', '--diagram-stroke': '#201E1D' });
    const escuchas: Array<(e: { active: boolean }) => void> = [];
    const pintados: object[] = [];
    new ColoresNeutrosDelTema(
      { on: (_evento, escuchar) => escuchas.push(escuchar) },
      { forEach: (visita) => visita({ id: 'Tarea_1' }) },
      { add: (elemento) => pintados.push(elemento) },
    );
    for (const escuchar of escuchas) escuchar({ active: false });
    expect(pintados).toEqual([]);
  });

  it('traduce a tokens del tema los dos colores con los que se marca la salida de una compuerta', () => {
    conTema({ '--diagram-selected': '#9EF01A', '--diagram-connection': '#B9B0DA' });
    const estilos = new EstilosDelTema();
    // `ExclusiveGatewaySettings.js` / `InclusiveGatewaySettings.js`: elegido y descartado.
    expect(estilos.get('--token-simulation-grey-darken-30')).toBe('#9EF01A');
    expect(estilos.get('--token-simulation-grey-lighten-56')).toBe('#B9B0DA');
  });

  it('deja pasar los colores propios de la animación', () => {
    conTema({ '--token-simulation-green-base-44': '#10D070' });
    // El verde de los ámbitos (`ShowScopes`) y el del contador de tokens no son el diagrama
    // repintado: se leen de `:root` tal cual, como haría el `SimulationStyles` original.
    expect(new EstilosDelTema().get('--token-simulation-green-base-44')).toBe('#10D070');
  });

  it('lee el tema en cada activación: un tema nuevo pinta con colores nuevos', () => {
    // El lienzo se remonta al cambiar de tema (`<Lienzo key={temaId}>` en `App.tsx`), pero aun
    // así nada aquí cachea: leer `getComputedStyle` en cada activación es lo que hace que Papel
    // pinte en blanco sobre negro y Eva-01 al revés.
    conTema({ '--diagram-fill': '#1F1A36', '--diagram-stroke': '#D9D2F0' });
    const primero = inyectorDePrueba();
    primero.activar();
    conTema({ '--diagram-fill': '#FFFFFF', '--diagram-stroke': '#201E1D' });
    const segundo = inyectorDePrueba();
    segundo.activar();
    expect(primero.pintados[0]?.colores).toEqual({ fill: '#1F1A36', stroke: '#D9D2F0' });
    expect(segundo.pintados[0]?.colores).toEqual({ fill: '#FFFFFF', stroke: '#201E1D' });
  });
});
