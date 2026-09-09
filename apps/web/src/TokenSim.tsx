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
import { S } from './strings.es';

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
  // remontar el lienzo por un cambio de tema, que trae un `Modelador` nuevo).
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
