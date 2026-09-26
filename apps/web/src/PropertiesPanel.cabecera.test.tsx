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
import { atajoPorId, etiqueta, MAC } from './atajos';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Elemento } from './Modeler.js';
import type { Modelador } from './Modeler.js';
import { nombreDeTipo, PanelPropiedades, type ElementoLienzo } from './PropertiesPanel.js';
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

function montar(modelador: Modelador, avanzado = true): HTMLElement {
  const contenedor = document.createElement('div');
  document.body.append(contenedor);
  const raiz = createRoot(contenedor);
  act(() => {
    raiz.render(<PanelPropiedades modelador={modelador} pestana="propiedades" avisos={6} avanzado={avanzado} />);
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
  //
  // Dos pools sin carriles propios, como en el ejemplo del pedido que encontró el QA (#392, ronda
  // 1): «Restaurante» y «Cliente» no tienen `bpmn:Lane` ninguno, así que antes esto leía
  // «Carriles 0» con dos pools bien a la vista. Dos conexiones (`SequenceFlow`) de propina, CON
  // `width`/`height` —bpmn-js se los pone de fábrica, los de su caja envolvente (QA de la ronda 2:
  // «Elements» contaba 29 en vez de 14 por fiarse solo de esos dos)— para probar que `waypoints`,
  // no el tamaño, es lo que de verdad las saca de la cuenta.
  const restaurante: Elemento = { type: 'bpmn:Participant', parent: {} };
  const cliente: Elemento = { type: 'bpmn:Participant', parent: {} };
  const registro: Elemento[] = [
    { type: 'bpmn:Collaboration', parent: undefined }, // la raíz: sin padre, no cuenta.
    restaurante,
    cliente,
    { type: 'bpmn:StartEvent', parent: restaurante, width: 36, height: 36 },
    { type: 'bpmn:Task', parent: restaurante, width: 100, height: 80 },
    // La etiqueta externa de la tarea de arriba: cuelga del mismo padre pero no es «un elemento».
    { type: 'bpmn:Task', parent: restaurante, width: 100, height: 80, labelTarget: {} },
    { type: 'bpmn:EndEvent', parent: cliente, width: 36, height: 36 },
    // Dos conexiones con caja de fábrica y `waypoints`: ninguna es una figura del proceso.
    { type: 'bpmn:SequenceFlow', parent: restaurante, width: 100, height: 40, waypoints: [] },
    { type: 'bpmn:MessageFlow', parent: restaurante, width: 120, height: 60, waypoints: [] },
  ];

  it('cuenta figuras (no conexiones ni pools) y pools/carriles del `elementRegistry`, y enseña los avisos que le pasan', () => {
    const modelador = modeladorFalso({ registro });
    const panel = montar(modelador);
    expect(panel.textContent).toContain('Nada seleccionado');
    expect(panel.textContent).toContain('Elige una figura para editarla, o empieza por el proceso.');
    expect(panel.textContent).toContain('Proceso');
    // StartEvent, Task y EndEvent: ni la raíz, ni los pools, ni la etiqueta, ni el flujo.
    expect(filaValor(panel, 'Elementos')).toBe('3');
    // Ningún `bpmn:Lane` de verdad: los dos pools sin carriles cuentan como dos filas, no cero.
    expect(filaValor(panel, 'Pools / carriles')).toBe('2');
    // `avisos={6}` en `montar()`, no algo que el panel calcule por su cuenta.
    expect(filaValor(panel, 'Avisos')).toBe('6');
  });

  it('una conexión con la caja de fábrica de bpmn-js no cuenta como elemento (QA de la ronda 2 de #392)', () => {
    // Aislado del resto del `describe`: si `esFigura` volviera a fiarse solo de `width`/`height`
    // —la caja envolvente que bpmn-js le pone a una conexión de fábrica—, esto contaría 1 en vez
    // de 0, con o sin las figuras de alrededor.
    const modelador = modeladorFalso({
      registro: [
        { type: 'bpmn:SequenceFlow', parent: {}, width: 100, height: 40, waypoints: [{ x: 0, y: 0 }, { x: 100, y: 40 }] },
      ],
    });
    const panel = montar(modelador);
    expect(filaValor(panel, 'Elementos')).toBe('0');
  });

  it('un pool con carriles no se cuenta dos veces: son sus carriles, no el pool más sus carriles', () => {
    const restauranteConCarriles: Elemento = { type: 'bpmn:Participant', parent: {} };
    const modelador = modeladorFalso({
      registro: [
        restauranteConCarriles,
        { type: 'bpmn:Lane', parent: restauranteConCarriles },
        { type: 'bpmn:Lane', parent: restauranteConCarriles },
      ],
    });
    const panel = montar(modelador);
    // 2 carriles, no 2 + 1 por el pool que los contiene.
    expect(filaValor(panel, 'Pools / carriles')).toBe('2');
  });

  it('enseña F2 y ⇧F6 con la tecla del mapa de atajos (#412, #413) — no un ⌘K que todavía no busca nada', () => {
    const panel = montar(modeladorFalso({ registro }));
    expect(panel.textContent).toContain('Atajos');
    expect(filaValor(panel, 'Renombrar')).toBe('F2');
    // jsdom is not a Mac: the map formats Shift+F6 the Windows/Linux way there (⇧F6 on a Mac).
    expect(filaValor(panel, 'Propiedades')).toBe(etiqueta(atajoPorId('irPanel'), MAC));
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

  it('un clic en la etiqueta flotante enseña la figura de verdad, no el `type` genérico `label` (QA de la ronda 1 de #392)', () => {
    const figura: ElementoLienzo = {
      id: 'Task_1',
      type: 'bpmn:UserTask',
      businessObject: { $type: 'bpmn:UserTask', id: 'Task_1', name: 'Revisar pedido' },
    };
    // Así la crea `BpmnImporter.addLabel`: `type: 'label'`, id con sufijo, mismo `businessObject`
    // que la figura (ya trae el nombre, el `$type` y el id de verdad).
    const etiqueta: ElementoLienzo = {
      id: 'Task_1_label',
      type: 'label',
      businessObject: figura.businessObject,
      labelTarget: figura,
    };
    const panel = montar(modeladorFalso({ seleccion: [etiqueta] }));
    const cabecera = panel.querySelector('.propiedades-cabecera');
    expect(cabecera!.querySelector('.propiedades-cabecera-nombre')?.textContent).toBe('Revisar pedido');
    expect(cabecera!.querySelector('.propiedades-cabecera-tipo')?.textContent).toBe('bpmn:UserTask · Task_1');
    expect(cabecera!.querySelector('.bpmn-icon-user-task')).not.toBeNull();
  });

  it('un evento intermedio de captura elige el icono por su `eventDefinition`, no siempre el de temporizador', () => {
    const elemento: ElementoLienzo = {
      id: 'Event_1',
      type: 'bpmn:IntermediateCatchEvent',
      businessObject: {
        $type: 'bpmn:IntermediateCatchEvent',
        id: 'Event_1',
        eventDefinitions: [{ $type: 'bpmn:MessageEventDefinition' }],
      },
    };
    const panel = montar(modeladorFalso({ seleccion: [elemento] }));
    const cabecera = panel.querySelector('.propiedades-cabecera');
    expect(cabecera!.querySelector('.bpmn-icon-intermediate-event-catch-message')).not.toBeNull();
    expect(cabecera!.querySelector('.bpmn-icon-intermediate-event-catch-timer')).toBeNull();
  });

  it.each([
    ['bpmn:ManualTask', 'manual-task'],
    ['bpmn:ScriptTask', 'script-task'],
    ['bpmn:SendTask', 'send-task'],
    ['bpmn:SequenceFlow', 'connection'],
  ] as const)('%s ya no se queda sin icono: enseña `bpmn-icon-%s`', (tipo, icono) => {
    const elemento: ElementoLienzo = { id: 'El_1', type: tipo, businessObject: { $type: tipo, id: 'El_1' } };
    const panel = montar(modeladorFalso({ seleccion: [elemento] }));
    expect(panel.querySelector(`.propiedades-cabecera .bpmn-icon-${icono}`)).not.toBeNull();
  });
});

describe('con «Avanzado» apagado (#471): sin id en la cabecera ni fila Id', () => {
  const elemento: ElementoLienzo = {
    id: 'Activity_1',
    type: 'bpmn:UserTask',
    businessObject: { $type: 'bpmn:UserTask', id: 'Activity_1', name: 'Revisar pedido' },
  };

  it('la línea técnica enseña el tipo legible (no el `$type` crudo), sin el id, y la fila Id no se pinta', () => {
    const panel = montar(modeladorFalso({ seleccion: [elemento] }), false);
    const cabecera = panel.querySelector('.propiedades-cabecera');
    const linea = cabecera!.querySelector('.propiedades-cabecera-tipo');
    // Must-fix del QA de #480: `bpmn:UserTask` crudo no le dice nada a quien no conoce el
    // `$type`; `nombreDeTipo` sí, y sin la clase `mono` (que es para ids/números, no prosa).
    expect(linea?.textContent).toBe(nombreDeTipo('bpmn:UserTask'));
    expect(linea?.className).not.toContain('mono');
    expect(panel.textContent).not.toContain('Activity_1');
    expect([...panel.querySelectorAll('.campo')].some((c) => c.querySelector('span')?.textContent === 'Id')).toBe(
      false,
    );
  });

  it('con «Avanzado» encendido, como siempre: `tipo · id` en mono y la fila Id visible y copiable', () => {
    const panel = montar(modeladorFalso({ seleccion: [elemento] }), true);
    const cabecera = panel.querySelector('.propiedades-cabecera');
    const linea = cabecera!.querySelector('.propiedades-cabecera-tipo');
    expect(linea?.textContent).toBe('bpmn:UserTask · Activity_1');
    expect(linea?.className).toContain('mono');
    expect([...panel.querySelectorAll('.campo')].some((c) => c.querySelector('span')?.textContent === 'Id')).toBe(
      true,
    );
  });

  it('sin nombre propio, la línea técnica repetiría el mismo texto que ya está arriba: se omite', () => {
    // `nombre` ya cae a `nombreDeTipo(real.type)` cuando no hay `name`: con Avanzado apagado la
    // línea técnica sería idéntica («Sequence flow» sobre «Sequence flow»), así que no se pinta.
    const sinNombre: ElementoLienzo = {
      id: 'Flow_1',
      type: 'bpmn:SequenceFlow',
      businessObject: { $type: 'bpmn:SequenceFlow', id: 'Flow_1' },
    };
    const panel = montar(modeladorFalso({ seleccion: [sinNombre] }), false);
    const cabecera = panel.querySelector('.propiedades-cabecera');
    expect(cabecera!.querySelector('.propiedades-cabecera-nombre')?.textContent).toBe(nombreDeTipo('bpmn:SequenceFlow'));
    expect(cabecera!.querySelector('.propiedades-cabecera-tipo')).toBeNull();
  });
});
