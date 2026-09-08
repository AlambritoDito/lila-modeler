// @vitest-environment jsdom
/**
 * QA adversarial del panel de propiedades (LILA-060). `propiedades.test.ts` prueba la aceptación
 * del ticket sobre las funciones de escritura; aquí se ataca el componente montado y el ida y
 * vuelta por el XML.
 *
 * El banco de pruebas monta `PanelPropiedades` en jsdom (que ya está en el repo desde LILA-058)
 * con un `Modelador` de mentira hecho de tres piezas:
 *
 * - **bpmn-moddle de verdad**, el mismo que bpmn-js tiene debajo, con el descriptor `lila`: es
 *   lo que decide qué sale y qué entra del XML.
 * - **`Selection` y `EventBus` de diagram-js de verdad**, que no tocan el DOM: así lo que se
 *   prueba de `selection.changed` es el servicio real y no una imitación.
 * - **`modeling` imitado**, porque el de bpmn-js necesita el lienzo. Escribe en el moddle y
 *   dispara `element.changed`, que es lo que hacen `UpdatePropertiesHandler` y
 *   `UpdateModdlePropertiesHandler`. Montar bpmn-js entero no se puede aquí: su `Canvas` pide
 *   `SVGElement.transform.baseVal` y `getBBox`, que jsdom no implementa.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';
import EventBus from 'diagram-js/lib/core/EventBus';
import Selection from 'diagram-js/lib/features/selection/Selection';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAnnotations } from '../../../packages/engine/src/bpmn/annotate.js';
import lila from '../../../packages/engine/src/bpmn/lila.moddle.json' with { type: 'json' };
import type { Modelador } from './Modeler.js';
import {
  anadirExtension,
  editarExtension,
  escribirDocumentacion,
  escribirNombre,
  leerDocumentacion,
  leerExtensiones,
  PanelPropiedades,
  type ElementoLienzo,
  type ElementoModdle,
  type Escritor,
} from './PropertiesPanel.js';

// React 19 exige declararlo para usar `act` fuera de @testing-library (que el repo no trae).
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// En jsdom `import.meta.url` no es un `file:`; la raíz del repo es el cwd de vitest.
const leer = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');

const PEDIDO = 'examples/pedido/model.bpmn';
const BIZAGI = 'examples/bizagi-exports/bizagi-miwg-A.2.0-roundtrip.bpmn';

/** Todo lo que tiene `id` en el árbol, igual que `annotate.ts`. */
function* recorrer(el: ModdleElement): Generator<ModdleElement> {
  if (typeof el.id === 'string') yield el;
  const hijos = [
    ...(el.rootElements ?? []),
    ...(el.flowElements ?? []),
    ...(el.participants ?? []),
    ...(el.messageFlows ?? []),
    ...(el.artifacts ?? []),
    ...(el.laneSets ?? []),
    ...(el.lanes ?? []),
  ];
  for (const hijo of hijos) yield* recorrer(hijo);
}

interface Banco {
  modelador: Modelador;
  /** Selecciona por id, como hace un clic en el lienzo. */
  clic(...ids: string[]): void;
  /** Deselecciona todo, como hace un clic en el fondo del lienzo. */
  clicEnElFondo(): void;
  figura(id: string): ElementoLienzo;
  /** Cambia el moddle sin pasar por el panel y avisa como lo haría bpmn-js (Cmd+Z, edición
   * directa en el lienzo). */
  desdeElLienzo(cambiar: () => void): void;
  exportar(): Promise<string>;
}

async function banco(xml: string): Promise<Banco> {
  const moddle = BpmnModdle({ lila });
  const { rootElement: definitions } = await moddle.fromXML(xml);
  const eventBus = new EventBus();
  // `Selection` filtra por raíz: con una sola, todo lo del archivo es seleccionable.
  const procesos = (definitions.rootElements ?? []).filter((el) => el.$type === 'bpmn:Process');
  const raizBo = procesos.length === 1 ? procesos[0] : definitions;
  const raiz = {
    id: raizBo?.id ?? '__raiz',
    type: raizBo?.$type ?? 'bpmn:Definitions',
    businessObject: raizBo as unknown as ElementoModdle,
  };
  const selection = new Selection(eventBus, {
    getRootElement: () => raiz,
    findRoot: () => raiz,
  } as never);

  const figuras = new Map<string, ElementoLienzo>();
  for (const el of recorrer(definitions)) {
    figuras.set(el.id as string, {
      id: el.id as string,
      type: el.$type as string,
      businessObject: el as unknown as ElementoModdle,
    });
  }
  const figura = (id: string): ElementoLienzo => {
    const encontrada = figuras.get(id);
    if (encontrada === undefined) throw new Error(`no hay ningún elemento con id ${id}`);
    return encontrada;
  };

  const escritor: Escritor = {
    modeling: {
      updateProperties: (elemento, propiedades) => {
        Object.assign(elemento.businessObject, propiedades);
        eventBus.fire('element.changed', { element: elemento });
      },
      updateModdleProperties: (elemento, objeto, propiedades) => {
        Object.assign(objeto, propiedades);
        eventBus.fire('element.changed', { element: elemento });
      },
    },
    bpmnFactory: {
      create: (tipo, atributos) => moddle.create(tipo, atributos) as ElementoModdle,
    },
  };

  const modelador = {
    abrir: () => Promise.resolve(true),
    exportar: async () => (await moddle.toXML(definitions, { format: true })).xml,
    ajustar: () => undefined,
    servicios: { ...escritor, selection, rootElement: () => raiz },
    suscribir: (eventos: string[], escuchar: () => void) => {
      eventBus.on(eventos, escuchar);
      return () => {
        eventBus.off(eventos, escuchar);
      };
    },
  } as unknown as Modelador;

  return {
    modelador,
    figura,
    clic: (...ids) => {
      act(() => {
        selection.select(ids.map(figura) as never);
      });
    },
    clicEnElFondo: () => {
      act(() => {
        selection.select([]);
      });
    },
    desdeElLienzo: (cambiar) => {
      act(() => {
        cambiar();
        eventBus.fire('element.changed', { element: raiz });
      });
    },
    exportar: modelador.exportar,
  };
}

const montados: Array<() => void> = [];
afterEach(() => {
  for (const desmontar of montados.splice(0)) desmontar();
  vi.unstubAllGlobals();
});

function montar(modelador: Modelador, pestana: 'Propiedades' | 'Documentación'): HTMLElement {
  const contenedor = document.createElement('div');
  document.body.append(contenedor);
  const raiz = createRoot(contenedor);
  act(() => {
    raiz.render(<PanelPropiedades modelador={modelador} pestana={pestana} />);
  });
  montados.push(() => {
    act(() => {
      raiz.unmount();
    });
    contenedor.remove();
  });
  return contenedor;
}

/** Escribe en un campo como lo haría el usuario: React solo se entera del evento nativo. */
function teclear(campo: HTMLInputElement | HTMLTextAreaElement, texto: string): void {
  const prototipo =
    campo instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const asignar = Object.getOwnPropertyDescriptor(prototipo, 'value')?.set;
  if (asignar === undefined) throw new Error('sin setter de value');
  act(() => {
    asignar.call(campo, texto);
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Busca por prefijo: las filas de una lista llevan el índice añadido al aria-label
 * (LILA-195), así que un campo suelto como "Versión del proceso" sigue casando exacto y el
 * primero de una lista ("Rol" → "Rol 1") es el que toman los tests que no distinguen fila. */
const campoPorEtiqueta = (raiz: HTMLElement, etiqueta: string): HTMLInputElement => {
  const campo = raiz.querySelector(`[aria-label^="${etiqueta}"]`);
  if (!(campo instanceof HTMLInputElement)) throw new Error(`no hay campo «${etiqueta}»`);
  return campo;
};

/** Un archivo con dos responsabilidades que no vienen de Lila: una sin `type` y otra con uno
 * que no es RACI. El esquema no valida `type`, así que ambas son XML legal. */
function pedidoConRaciAjeno(): string {
  return leer(PEDIDO)
    .replace(
      'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"',
      'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"' +
        ' xmlns:lila="https://lila-modeler.org/schema/bpmn/1"',
    )
    .replace(
      '<bpmn:incoming>',
      '<bpmn:extensionElements><lila:responsibility roleRef="rol-x" />' +
        '<lila:responsibility type="Z" roleRef="rol-y" /></bpmn:extensionElements>' +
        '<bpmn:incoming>',
    );
}

describe('QA adversarial del panel de propiedades', () => {
  it('edita proceso simple desde el fondo y TextAnnotation desde su control propio', async () => {
    const xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
      xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="D" targetNamespace="urn:test">
      <bpmn:process id="Process_1" name="Antes"><bpmn:textAnnotation id="Text_1">
        <bpmn:text>Nota anterior</bpmn:text>
      </bpmn:textAnnotation></bpmn:process></bpmn:definitions>`;
    const bancoSimple = await banco(xml);
    const propiedades = montar(bancoSimple.modelador, 'Propiedades');
    const documentacion = montar(bancoSimple.modelador, 'Documentación');

    teclear(propiedades.querySelector('input') as HTMLInputElement, 'Proceso nuevo');
    teclear(documentacion.querySelector('textarea') as HTMLTextAreaElement, 'Documentado');
    teclear(campoPorEtiqueta(documentacion, 'Versión del proceso'), ' 2.0 ');
    bancoSimple.clic('Text_1');
    teclear(
      propiedades.querySelector('[aria-label="Texto de la anotación"]') as HTMLTextAreaElement,
      'Nota nueva',
    );

    const salida = await bancoSimple.exportar();
    expect(salida).toContain('id="Process_1" name="Proceso nuevo"');
    expect(salida).toContain('<bpmn:documentation>Documentado</bpmn:documentation>');
    expect(salida).toContain('<lila:versionTag value="2.0" />');
    expect(salida).toContain('<bpmn:text>Nota nueva</bpmn:text>');
  });

  it('añadir el primer `lila:` a un elemento sin extensionElements es un solo comando', async () => {
    // Si fueran dos comandos (crear el contenedor vacío y luego meterle el hijo), un Cmd+Z
    // dejaría un `<bpmn:extensionElements />` vacío en vez de devolver el XML a como estaba.
    const { modelador, figura } = await banco(leer(PEDIDO));
    const tarea = figura('Task_TomarPedido');
    expect(tarea.businessObject.extensionElements).toBeUndefined();

    const base = modelador.servicios as unknown as Escritor;
    const llamadas: string[] = [];
    const escritor: Escritor = {
      ...base,
      modeling: {
        updateProperties: (...args) => {
          llamadas.push('updateProperties');
          base.modeling.updateProperties(...args);
        },
        updateModdleProperties: (...args) => {
          llamadas.push('updateModdleProperties');
          base.modeling.updateModdleProperties(...args);
        },
      },
    };

    anadirExtension(escritor, tarea, 'lila:SystemRef', { ref: 'sys-1' });
    expect(llamadas).toEqual(['updateModdleProperties']);
  });

  it('lo que escribe el panel sobrevive a exportar y volver a abrir, con `<`, `&` y acentos', async () => {
    const raro = 'ñ & <b> "comillas"';
    const { modelador, figura, exportar } = await banco(leer(PEDIDO));
    const tarea = figura('Task_TomarPedido');

    escribirNombre(modelador.servicios, tarea, `Tomar ${raro}`);
    escribirDocumentacion(modelador.servicios, tarea, `línea 1 ${raro}\nlínea 2 ]]>`);
    anadirExtension(modelador.servicios, tarea, 'lila:Responsibility', {
      type: 'A',
      roleRef: `rol ${raro}`,
    });
    anadirExtension(modelador.servicios, tarea, 'lila:SystemRef', { ref: `sys ${raro}` });
    const xml = await exportar();

    // Segunda vuelta: el archivo exportado se vuelve a abrir y el panel lee lo mismo.
    const segunda = await banco(xml);
    const otraVez = segunda.figura('Task_TomarPedido');

    expect(otraVez.businessObject.name).toBe(`Tomar ${raro}`);
    expect(leerDocumentacion(otraVez)).toBe(`línea 1 ${raro}\nlínea 2 ]]>`);
    expect(
      leerExtensiones(otraVez, 'lila:Responsibility').map((r) => [r.type, r.roleRef]),
    ).toEqual([['A', `rol ${raro}`]]);
    expect(leerExtensiones(otraVez, 'lila:SystemRef').map((r) => r.ref)).toEqual([`sys ${raro}`]);
    // Y el motor lee del archivo exactamente lo mismo que el panel.
    expect((await readAnnotations(xml)).Task_TomarPedido).toEqual({
      documentation: `línea 1 ${raro}\nlínea 2 ]]>`,
      responsibilities: [{ type: 'A', roleRef: `rol ${raro}` }],
      refs: { systemRef: [`sys ${raro}`] },
    });
  });

  it('una responsabilidad ajena sin `type` (o con uno que no es RACI) no se enseña como R', async () => {
    const { modelador, clic, exportar } = await banco(pedidoConRaciAjeno());
    const panel = montar(modelador, 'Documentación');
    clic('Task_TomarPedido');

    const tipos = [...panel.querySelectorAll('select')];
    expect(tipos).toHaveLength(2);
    // Antes: las dos filas enseñaban «R · Responsable» mientras el archivo decía otra cosa.
    expect(tipos.map((s) => s.selectedOptions[0]?.textContent)).toEqual([
      'Sin tipo',
      'Z · no es RACI',
    ]);
    expect(tipos.map((s) => s.value)).toEqual(['', 'Z']);
    // Y el panel no ha reescrito nada por el hecho de enseñarlo.
    const xml = await exportar();
    expect(xml).toContain('<lila:responsibility roleRef="rol-x" />');
    expect(xml).toContain('<lila:responsibility type="Z" roleRef="rol-y" />');
  });

  it('editar el rol de esa responsabilidad ajena no le inventa un `type`', async () => {
    const { modelador, clic, exportar } = await banco(pedidoConRaciAjeno());
    const panel = montar(modelador, 'Documentación');
    clic('Task_TomarPedido');

    teclear(campoPorEtiqueta(panel, 'Rol'), 'rol-nuevo');

    expect((await exportar()).replace(/\s+/g, ' ')).toContain(
      '<lila:responsibility roleRef="rol-nuevo" />',
    );
  });

  it('las refs se guardan con `trim()`: los espacios no cuentan para el catálogo (LILA-093)', async () => {
    const { modelador, figura, exportar } = await banco(leer(PEDIDO));
    const tarea = figura('Task_TomarPedido');

    const responsabilidad = anadirExtension(modelador.servicios, tarea, 'lila:Responsibility', {
      type: 'R',
      roleRef: ' rol-x ',
    });
    editarExtension(modelador.servicios, tarea, responsabilidad, { roleRef: ' rol-y ' });
    anadirExtension(modelador.servicios, tarea, 'lila:SystemRef', { ref: ' sys-crm ' });

    const xml = (await exportar()).replace(/\s+/g, ' ');
    expect(xml).toContain('roleRef="rol-y"');
    expect(xml).not.toContain('rol-y ');
    expect(xml).toContain('ref="sys-crm"');
  });

  it('copiar el id no tumba el panel cuando el navegador no da portapapeles', async () => {
    // Es lo que pasa fuera de un contexto seguro: la demo servida por http desde otra máquina.
    expect(navigator.clipboard).toBeUndefined();
    const { modelador, clic } = await banco(leer(PEDIDO));
    const panel = montar(modelador, 'Propiedades');
    clic('Task_TomarPedido');

    const copiar = panel.querySelector('button');
    expect(copiar?.textContent).toBe('Copiar');

    // El `onClick` lo invoca el DOM, que se traga la excepción y la reporta como error global:
    // sin escucharlo, un `expect(...).not.toThrow()` daría verde con el panel roto.
    const reventones: string[] = [];
    const anotar = (e: ErrorEvent): void => {
      reventones.push(String(e.error));
    };
    window.addEventListener('error', anotar);
    act(() => {
      copiar?.click();
    });
    window.removeEventListener('error', anotar);

    // Antes: «TypeError: Cannot read properties of undefined (reading 'writeText')».
    expect(reventones).toEqual([]);
    expect(panel.textContent).toContain('Task_TomarPedido');
    expect(copiar?.textContent).toBe('Copiar');
  });

  it('con portapapeles copia el id y avisa; si lo rechaza, no revienta', async () => {
    const escribir = vi.fn<(t: string) => Promise<void>>(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText: escribir } });
    const { modelador, clic } = await banco(leer(PEDIDO));
    const panel = montar(modelador, 'Propiedades');
    clic('Task_TomarPedido');

    await act(async () => {
      panel.querySelector('button')?.click();
    });
    expect(escribir).toHaveBeenCalledWith('Task_TomarPedido');
    expect(panel.querySelector('button')?.textContent).toBe('Copiado');

    escribir.mockRejectedValueOnce(new Error('permiso denegado'));
    await expect(
      act(async () => {
        panel.querySelector('button')?.click();
      }),
    ).resolves.not.toThrow();
  });

  it('el panel se resincroniza cuando el moddle cambia por fuera (deshacer, lienzo)', async () => {
    const { modelador, clic, figura, desdeElLienzo } = await banco(leer(PEDIDO));
    const panel = montar(modelador, 'Propiedades');
    clic('Task_TomarPedido');
    const nombre = panel.querySelector('input');
    expect(nombre?.value).toBe('Tomar pedido');

    teclear(nombre as HTMLInputElement, 'Tomar pedido en caja');
    expect(figura('Task_TomarPedido').businessObject.name).toBe('Tomar pedido en caja');

    // Cmd+Z: bpmn-js devuelve el moddle a su valor anterior y lo anuncia con `element.changed`.
    desdeElLienzo(() => {
      figura('Task_TomarPedido').businessObject.name = 'Tomar pedido';
    });
    expect(panel.querySelector('input')?.value).toBe('Tomar pedido');
  });

  it('la pestaña de documentación también se resincroniza tras un cambio externo', async () => {
    const { modelador, clic, figura, desdeElLienzo } = await banco(leer(PEDIDO));
    const panel = montar(modelador, 'Documentación');
    clic('Task_Revisar');
    expect(panel.querySelectorAll('select')).toHaveLength(0);

    desdeElLienzo(() => {
      anadirExtension(modelador.servicios, figura('Task_Revisar'), 'lila:Responsibility', {
        type: 'C',
        roleRef: 'rol-jefe',
      });
    });

    expect(panel.querySelectorAll('select')).toHaveLength(1);
    expect(campoPorEtiqueta(panel, 'Rol').value).toBe('rol-jefe');
  });

  it('flujos, compuertas, eventos, pools y la selección múltiple no rompen el panel', async () => {
    const { modelador, clic, clicEnElFondo } = await banco(leer(PEDIDO));
    const propiedades = montar(modelador, 'Propiedades');
    const documentacion = montar(modelador, 'Documentación');

    const tipos: Array<[string, string]> = [
      ['Flow_Start_TomarPedido', 'Flujo de secuencia'],
      ['Gateway_Aprobacion', 'Compuerta exclusiva (XOR)'],
      ['Gateway_ANDFork', 'Compuerta paralela (AND)'],
      ['Timer_Reposo', 'Evento intermedio de captura'],
      ['StartEvent_Pedido', 'Evento de inicio'],
      ['EndEvent_Entregado', 'Evento de fin'],
      ['Participant_Cliente', 'Pool'],
      ['MessageFlow_Rechazado', 'Flujo de mensaje'],
    ];
    for (const [id, etiqueta] of tipos) {
      clic(id);
      expect(propiedades.textContent).toContain(etiqueta);
      expect(propiedades.textContent).toContain(id);
      // La pestaña de documentación ofrece los mismos campos para cualquiera de ellos.
      expect(documentacion.querySelectorAll('textarea')).toHaveLength(1);
      expect(documentacion.querySelectorAll('h3')).toHaveLength(8);
    }

    clic('Task_TomarPedido', 'Task_Empacar');
    expect(propiedades.textContent).toContain('2 elementos seleccionados');
    expect(propiedades.querySelectorAll('input')).toHaveLength(0);
    expect(documentacion.textContent).toContain('2 elementos seleccionados');

    clicEnElFondo();
    expect(propiedades.textContent).toContain('Selecciona un elemento del lienzo');
  });

  it('el id se enseña tal cual viene del archivo y el panel no lo deja tocar', async () => {
    // Los ids de Bizagi no son los que genera Lila; el id es la única clave (ADR-012) y el panel
    // no puede ni regenerarlo ni sanearlo por su cuenta.
    const id = '_5a972b87-735d-454a-b31c-f52fb3afc5c7';
    const { modelador, clic, exportar } = await banco(leer(BIZAGI));
    const panel = montar(modelador, 'Propiedades');
    clic(id);

    expect([...panel.querySelectorAll('output')].map((o) => o.textContent)).toContain(id);
    // El único campo editable de la pestaña es el nombre.
    expect(panel.querySelectorAll('input, textarea, select')).toHaveLength(1);

    teclear(panel.querySelector('input') as HTMLInputElement, 'Renombrada desde el panel');
    const xml = await exportar();
    expect(xml).toContain(`id="${id}"`);
    expect(xml).toContain('name="Renombrada desde el panel"');
  });

  it('cada fila de una lista con más de un elemento tiene `aria-label` único (LILA-195)', async () => {
    // Antes: todas las filas de "Sistemas" compartían aria-label="Sistemas" y un lector de
    // pantalla anunciaba campos idénticos. pedidoConRaciAjeno() ya trae dos responsabilidades.
    const { modelador, clic, figura } = await banco(pedidoConRaciAjeno());
    const panel = montar(modelador, 'Documentación');
    clic('Task_TomarPedido');
    act(() => {
      anadirExtension(modelador.servicios, figura('Task_TomarPedido'), 'lila:SystemRef', {
        ref: 'sys-1',
      });
      anadirExtension(modelador.servicios, figura('Task_TomarPedido'), 'lila:SystemRef', {
        ref: 'sys-2',
      });
    });

    const etiquetasDe = (selector: string): string[] =>
      [...panel.querySelectorAll(selector)].map((el) => el.getAttribute('aria-label') ?? '');

    for (const selector of [
      'select[aria-label]',
      'input[aria-label^="Rol"]',
      'input[aria-label^="Sistemas"]',
    ]) {
      const etiquetas = etiquetasDe(selector);
      expect(etiquetas.length).toBeGreaterThanOrEqual(2);
      expect(new Set(etiquetas).size).toBe(etiquetas.length);
    }
  });

  it('todos los controles del panel tienen nombre accesible y el RACI es un `select` nativo', async () => {
    const { modelador, clic } = await banco(pedidoConRaciAjeno());
    const panel = montar(modelador, 'Documentación');
    clic('Task_TomarPedido');
    act(() => {
      // Una fila por cada lista, para que ninguna quede sin ejercitar.
      for (const anadir of panel.querySelectorAll('button.anadir')) {
        (anadir as HTMLButtonElement).click();
      }
    });

    const controles = [...panel.querySelectorAll('input, textarea, select, button')];
    expect(controles.length).toBeGreaterThan(20);
    const sinNombre = controles.filter(
      (c) =>
        c.getAttribute('aria-label') === null &&
        c.closest('label') === null &&
        (c.textContent ?? '') === '',
    );
    expect(sinNombre.map((c) => c.outerHTML)).toEqual([]);
    // Nativo: se abre y se recorre con el teclado sin que el panel ponga nada de su parte.
    for (const select of panel.querySelectorAll('select')) {
      expect(select.getAttribute('tabindex')).toBeNull();
      expect(select.disabled).toBe(false);
    }
  });
});
