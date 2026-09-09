/**
 * Pestaña «Validar rutas» (LILA-065): anima los tokens de `bpmn-js-token-simulation` sobre el
 * BPMN ya montado en el lienzo. No sabe nada de bpmn-js por su cuenta —eso vive en
 * `Modeler.tsx`, junto al overlay de cuellos y los marcadores de validación—: solo enciende y
 * apaga la animación por `Modelador.simulacionTokens`, traduce lo que el módulo escribe en el
 * lienzo (LILA-205 / #264) y enseña el aviso de abajo.
 *
 * No es la simulación DES del motor (`packages/engine`): no lee el escenario activo ni escribe
 * resultados, solo anima el recorrido de tokens sobre las figuras del diagrama.
 *
 * **Por qué se traduce observando el DOM** (#264): `bpmn-js-token-simulation@0.40.0` escribe su
 * interfaz con cadenas literales dentro de plantillas HTML y **no** pasa por el servicio
 * `translate` de bpmn-js, así que no hay punto de extensión donde enchufar el español. Las dos
 * salidas eran forkear el módulo o sustituir los textos ya pintados; se sustituyen, que es
 * exactamente lo que ya se hacía con el `title` del minimapa en `Modeler.tsx`. El inventario de
 * cadenas vive en `S.tokenSim.traducciones` y la sustitución es idempotente (el español no es
 * clave de ese mapa), así que el `MutationObserver` puede volver a pasar sobre su propio cambio
 * sin entrar en bucle.
 *
 * ponytail: el mapa está atado a la versión 0.40.0 del módulo. Techo: si una versión nueva cambia
 * un rótulo, ese rótulo vuelve a verse en inglés —nunca roto—. Siguiente paso, si el módulo llega
 * a usar `translate`: borrar todo esto y registrar un `translate` propio.
 */
import { useEffect } from 'react';
import type { Modelador } from './Modeler';
import { es as S } from './strings.es';

interface Props {
  modelador: Modelador | null;
}

/** `title="Set animation speed = Slow"` y `title="Focus process instance 1"`: clave + variable. */
function traducirConPrefijo(texto: string): string | undefined {
  if (texto.startsWith(S.tokenSim.prefijoVelocidad)) {
    const nombre = texto.slice(S.tokenSim.prefijoVelocidad.length);
    return S.tokenSim.velocidad(S.tokenSim.traducciones[nombre] ?? nombre);
  }
  if (texto.startsWith(S.tokenSim.prefijoInstancia)) {
    return S.tokenSim.instancia(texto.slice(S.tokenSim.prefijoInstancia.length));
  }
  return undefined;
}

/** El español de `texto`, o `undefined` si no es una cadena del módulo (o ya está traducida). */
export function traducirTexto(texto: string): string | undefined {
  return S.tokenSim.traducciones[texto] ?? traducirConPrefijo(texto);
}

/**
 * Sustituye, dentro de `raiz`, los textos en inglés que escribe `bpmn-js-token-simulation`: el
 * `title` de la paleta y de los context pads, y el texto visible de sus rótulos, del registro y
 * de sus avisos. Solo toca lo que reconoce; todo lo demás —los nombres de las figuras, que salen
 * del modelo y ya están en español— se queda como está.
 *
 * Función pura sobre el DOM y exportada a propósito: `TokenSim.test.tsx` la ejercita sobre el
 * marcado real del módulo sin montar bpmn-js.
 */
export function traducirSimulacion(raiz: HTMLElement): void {
  // `aria-label` se lee igual que `title` —lo lleva el botón de cerrar el registro— y los dos se
  // tocan como atributo: en un `<svg>` la propiedad `.title` ni siquiera existe (QA de #271).
  for (const atributo of ['title', 'aria-label']) {
    for (const elemento of raiz.querySelectorAll(`[${atributo}]`)) {
      const traducido = traducirTexto(elemento.getAttribute(atributo) ?? '');
      if (traducido !== undefined) elemento.setAttribute(atributo, traducido);
    }
  }
  const textos = raiz.ownerDocument.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let nodo = textos.nextNode(); nodo !== null; nodo = textos.nextNode()) {
    const bruto = nodo.nodeValue ?? '';
    const limpio = bruto.trim();
    if (limpio === '') continue;
    const traducido = traducirTexto(limpio);
    if (traducido !== undefined) nodo.nodeValue = bruto.replace(limpio, traducido);
  }
}

/**
 * Traduce lo que ya hay y lo que el módulo pinte después (el registro crece con cada paso, y la
 * paleta reescribe su `title` al pasar de reproducir a pausar). Devuelve el desmontaje.
 */
export function observarSimulacion(raiz: HTMLElement): () => void {
  traducirSimulacion(raiz);
  const observador = new MutationObserver(() => {
    traducirSimulacion(raiz);
  });
  observador.observe(raiz, {
    attributeFilter: ['title', 'aria-label'],
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  return () => {
    observador.disconnect();
  };
}

export function TokenSim({ modelador }: Props): React.JSX.Element {
  // Se activa al montar (entrar en el modo) y se desactiva al desmontar (salir de él, o al
  // cambiar de tema: `App.tsx` le pone `key={temaId}` justamente para que el modo se reinicie y
  // vuelva a leer los tokens, porque los colores neutros van al DI y el DI gana a `repintar()`).
  useEffect(() => {
    modelador?.simulacionTokens(true);
    return () => modelador?.simulacionTokens(false);
  }, [modelador]);

  // El contenedor del lienzo es donde el módulo monta toda su interfaz. El getter `servicios`
  // lanza mientras no haya un BPMN abierto: sin lienzo no hay nada que traducir, y el aviso de
  // abajo se pinta igual.
  useEffect(() => {
    if (modelador === null) return;
    let contenedor: HTMLElement;
    try {
      contenedor = modelador.servicios.canvas.getContainer();
    } catch {
      return;
    }
    return observarSimulacion(contenedor);
  }, [modelador]);

  return (
    <p className="aviso-token-sim" role="note">
      {S.tokenSim.aviso}
    </p>
  );
}

/* ---------- colores del diagrama durante la animación (LILA-205 / #264) ---------- */

/**
 * Valor de un token de diseño ya resuelto a color por el navegador. Es el mismo lector que usa
 * `Modeler.tsx` para los colores por defecto del renderizador; se repite aquí (dos líneas) para
 * que este archivo —y su prueba— no tengan que importar bpmn-js.
 */
function token(nombre: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

/** Lo mínimo que este módulo necesita de los servicios de bpmn-js. */
interface EventBus { on(evento: string, escuchar: (evento: { active: boolean }) => void): void }
interface RegistroDeElementos { forEach(visita: (elemento: object) => void): void }
interface ColoresDeElemento {
  add(elemento: object, id: string, colores: { fill?: string; stroke?: string }): void;
}

/** `TOGGLE_MODE_EVENT` de `bpmn-js-token-simulation/lib/util/EventHelper`. */
const EVENTO_MODO = 'tokenSimulation.toggleMode';

/**
 * Colores con los que la animación marca la salida de una compuerta, traducidos a tokens del
 * tema. El módulo los lee por `simulationStyles.get()` de `:root`, y sus valores de fábrica
 * —`#212121` para el flujo elegido y `#909090` para el descartado— son de un lienzo blanco: en
 * Eva-01 el flujo elegido quedaba en negro sobre `#17132A`, invisible.
 *
 * El elegido pasa al color de «lo seleccionado» del tema (lima en Eva-01, rojo en Papel) y el
 * descartado al color normal de una conexión, que es exactamente la distinción que el módulo
 * quiere hacer. Los demás colores del módulo —el verde de los ámbitos, el blanco del contador de
 * tokens— se dejan pasar tal cual: son marcadores propios de la animación con su propio
 * contraste, no el diagrama repintado.
 */
const COLORES_DE_FLUJO: Record<string, string> = {
  '--token-simulation-grey-darken-30': '--diagram-selected',
  '--token-simulation-grey-lighten-56': '--diagram-connection',
};

/** Sustituye a `simulationStyles`; sin caché, para que un tema nuevo se lea de verdad. */
export class EstilosDelTema {
  static $inject: string[] = [];

  get(propiedad: string): string {
    return token(COLORES_DE_FLUJO[propiedad] ?? propiedad);
  }
}

/**
 * Sustituye a `NeutralElementColors`, que repinta TODAS las figuras en `#fff` sobre `#212121`
 * mientras dura el modo y las devuelve a su color al salir. Sobre el lienzo oscuro de Eva-01 eso
 * era un diagrama que se cambiaba de piel al entrar en «Validar rutas», con el nombre de la tarea
 * ilegible encima de una figura blanca (contraste medido 1,15:1).
 *
 * Se sustituye el servicio y no se pelea con CSS porque el módulo no pinta con atributos de
 * presentación: `elementColors` escribe los colores en el DI y bpmn-js@18 los emite como
 * `style=` en línea, contra el que solo ganaría un `!important` sobre `.djs-visual`, que se
 * llevaría por delante también los colores propios de la animación (QA de #271).
 *
 * Mismo id y misma prioridad por defecto (1000) que el servicio original: las compuertas siguen
 * pintando su flujo elegido por encima, con prioridad 2000.
 */
export class ColoresNeutrosDelTema {
  static $inject = ['eventBus', 'elementRegistry', 'elementColors'];

  constructor(eventBus: EventBus, registro: RegistroDeElementos, colores: ColoresDeElemento) {
    eventBus.on(EVENTO_MODO, ({ active }) => {
      if (!active) return;
      // Se leen al activar el modo, no al construir: es el mismo momento en el que el módulo
      // original decidía sus colores.
      const delTema = { fill: token('--diagram-fill'), stroke: token('--diagram-stroke') };
      registro.forEach((elemento) => {
        colores.add(elemento, 'neutral-element-colors', delTema);
      });
    });
  }
}

/**
 * Módulo de didi que `Modeler.tsx` registra DESPUÉS de `bpmn-js-token-simulation`: las dos claves
 * son las que usa el módulo, y en didi gana la última definición, así que estas dos clases
 * sustituyen a las suyas sin tocar `node_modules` ni el resto de la animación.
 */
export const moduloColoresDelTema: Record<string, ['type', unknown]> = {
  neutralElementColors: ['type', ColoresNeutrosDelTema],
  simulationStyles: ['type', EstilosDelTema],
};
