// @vitest-environment jsdom
/**
 * Cabecera del panel de propiedades (diseño «Turno 2», bloque 2d): el resumen sin selección —
 * título, pista, «Proceso» y «Atajos»— y la cabecera con un elemento elegido —icono, nombre y
 * `$type · id`. `PropertiesPanel.qa.test.tsx` ya monta el panel entero contra un moddle real para
 * probar la lectura y escritura de campos; esto solo mira lo nuevo, así que el `modelador` de
 * mentira es el mínimo que `PanelPropiedades` toca: `selection.get`, `rootElement` y
 * `elementRegistry.filter`. Ni `Selection` ni `EventBus` de diagram-js hacen falta porque ningún
 * test de aquí cambia de selección tras montar.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Elemento } from './Modeler.js';
import type { Modelador } from './Modeler.js';
import { PanelPropiedades, type ElementoLienzo } from './PropertiesPanel.js';
import { setLocale } from './i18n';

// Igual que `PropertiesPanel.qa.test.tsx`: la traducción base es inglés desde LILA-210, así que
// esta suite fija español en vez de depender del idioma de la máquina.
setLocale('es');

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Un `modelador` que solo sabe responder a lo que `PanelPropiedades` le pregunta. */
function modeladorFalso(opciones: {
  seleccion?: ElementoLienzo[];
  raiz?: ElementoLienzo;
  registro?: Elemento[];
}): Modelador {
  const { seleccion = [], raiz, registro = [] } = opciones;
  return {
    servicios: {
      selection: { get: () => seleccion },
      rootElement: () => raiz,
      elementRegistry: { filter: (prueba: (el: Elemento) => boolean) => registro.filter(prueba) },
    },
    // Ningún test de aquí dispara un evento tras montar: basta con no reventar al (des)suscribir.
    suscribir: () => () => undefined,
  } as unknown as Modelador;
}

const montados: Array<() => void> = [];
afterEach(() => {
  for (const desmontar of montados.splice(0)) desmontar();
  vi.unstubAllGlobals();
});

function montar(modelador: Modelador): HTMLElement {
  const contenedor = document.createElement('div');
  document.body.append(contenedor);
  const raiz = createRoot(contenedor);
  act(() => {
    raiz.render(<PanelPropiedades modelador={modelador} pestana="propiedades" avisos={6} />);
  });
  montados.push(() => {
    act(() => {
      raiz.unmount();
    });
    contenedor.remove();
  });
  return contenedor;
}

/** La fila «etiqueta a la izquierda, valor a la derecha» con esa etiqueta exacta. */
function filaValor(raiz: HTMLElement, etiqueta: string): string {
  const fila = [...raiz.querySelectorAll('.propiedades-fila')].find(
    (f) => f.querySelector('span')?.textContent === etiqueta,
  );
  if (fila === undefined) throw new Error(`no hay fila «${etiqueta}»`);
  return fila.querySelector('output')?.textContent ?? '';
}

describe('sin selección: resumen del proceso y atajos', () => {
  // Ni una raíz `bpmn:Process` en el árbol (`Elemento` no lleva `businessObject`, así que
  // `leerSeleccion` de `PanelPropiedades` no puede elegirla sola): la única forma de que la
  // selección se quede vacía y el panel entre por la cabecera nueva.
  const registro: Elemento[] = [
    { type: 'bpmn:Collaboration', parent: undefined }, // la raíz: sin padre, no cuenta.
    { type: 'bpmn:Participant', parent: {} },
    { type: 'bpmn:Lane', parent: {} },
    { type: 'bpmn:Lane', parent: {} },
    { type: 'bpmn:StartEvent', parent: {} },
    { type: 'bpmn:Task', parent: {} },
    // La etiqueta externa de la tarea de arriba: cuelga del mismo padre pero no es «un elemento».
    { type: 'bpmn:Task', parent: {}, labelTarget: {} },
    { type: 'bpmn:EndEvent', parent: {} },
  ];

  it('cuenta elementos y carriles del `elementRegistry`, y enseña los avisos que le pasan', () => {
    const modelador = modeladorFalso({ registro });
    const panel = montar(modelador);
    expect(panel.textContent).toContain('Nada seleccionado');
    expect(panel.textContent).toContain('Elige una figura para editarla, o empieza por el proceso.');
    expect(panel.textContent).toContain('Proceso');
    // Participant, StartEvent, Task y EndEvent: ni la raíz, ni los dos carriles, ni la etiqueta.
    expect(filaValor(panel, 'Elementos')).toBe('4');
    expect(filaValor(panel, 'Carriles')).toBe('2');
    // `avisos={6}` en `montar()`, no algo que el panel calcule por su cuenta.
    expect(filaValor(panel, 'Avisos')).toBe('6');
  });

  it('enseña solo los atajos que existen de verdad, F2 y ⇥ — no un ⌘K que todavía no busca nada', () => {
    const panel = montar(modeladorFalso({ registro }));
    expect(panel.textContent).toContain('Atajos');
    expect(filaValor(panel, 'Renombrar')).toBe('F2');
    expect(filaValor(panel, 'Propiedades')).toBe('⇥');
    expect(panel.textContent).not.toContain('⌘K');
  });

  it('sin avisos que pasarle, el resumen enseña 0 en vez de dejarlo en blanco', () => {
    const contenedor = document.createElement('div');
    document.body.append(contenedor);
    const raizReact = createRoot(contenedor);
    act(() => {
      raizReact.render(<PanelPropiedades modelador={modeladorFalso({ registro })} pestana="propiedades" />);
    });
    montados.push(() => {
      act(() => {
        raizReact.unmount();
      });
      contenedor.remove();
    });
    expect(filaValor(contenedor, 'Avisos')).toBe('0');
  });
});

describe('con un elemento elegido: su icono, su nombre y su `$type · id`', () => {
  it('con nombre, la cabecera lo enseña y debajo el tipo técnico y el id', () => {
    const elemento: ElementoLienzo = {
      id: 'Activity_1',
      type: 'bpmn:UserTask',
      businessObject: { $type: 'bpmn:UserTask', id: 'Activity_1', name: 'Revisar pedido' },
    };
    const panel = montar(modeladorFalso({ seleccion: [elemento] }));
    const cabecera = panel.querySelector('.propiedades-cabecera');
    expect(cabecera).not.toBeNull();
    expect(cabecera!.querySelector('.propiedades-cabecera-nombre')?.textContent).toBe('Revisar pedido');
    expect(cabecera!.querySelector('.propiedades-cabecera-tipo')?.textContent).toBe('bpmn:UserTask · Activity_1');
    // El mismo icono que pinta la paleta para una tarea de usuario (`Paleta.tsx`).
    expect(cabecera!.querySelector('.bpmn-icon-user-task')).not.toBeNull();
  });

  it('sin nombre, cae al nombre legible del tipo en vez de dejarlo vacío', () => {
    const elemento: ElementoLienzo = {
      id: 'Gateway_1',
      type: 'bpmn:ExclusiveGateway',
      businessObject: { $type: 'bpmn:ExclusiveGateway', id: 'Gateway_1' },
    };
    const panel = montar(modeladorFalso({ seleccion: [elemento] }));
    const cabecera = panel.querySelector('.propiedades-cabecera');
    expect(cabecera!.querySelector('.propiedades-cabecera-nombre')?.textContent).toBe('Compuerta exclusiva (XOR)');
    expect(cabecera!.querySelector('.propiedades-cabecera-tipo')?.textContent).toBe('bpmn:ExclusiveGateway · Gateway_1');
    expect(cabecera!.querySelector('.bpmn-icon-gateway-xor')).not.toBeNull();
  });
});
