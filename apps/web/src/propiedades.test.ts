/**
 * Aceptación de LILA-060: «añadir `lila:responsibility` desde el panel aparece en el XML
 * exportado».
 *
 * El panel escribe sobre el moddle vivo de bpmn-js con `modeling.updateProperties` y
 * `modeling.updateModdleProperties`, y el XML sale después de `saveXML`. Montar bpmn-js de
 * verdad no se puede aquí ni con el jsdom que trajo LILA-058: le falta el SVG que bpmn-js
 * necesita (`getBBox`, `getComputedTextLength`). Así que se ejercitan las funciones que
 * `PropertiesPanel.tsx` usa para escribir —las mismas, no una copia— contra bpmn-moddle, que
 * es exactamente lo que bpmn-js tiene debajo. Lo que `modeling` añade sobre eso es el
 * `commandStack` (Cmd+Z) y el repintado del lienzo, y eso está verificado a mano en el
 * navegador: queda escrito en el comentario del issue, con la captura en
 * `docs/design/properties-panel.png`.
 */
import { readFileSync } from 'node:fs';
import { BpmnModdle, type ModdleElement } from 'bpmn-moddle';
import { describe, expect, it } from 'vitest';
import { readAnnotations } from '../../../packages/engine/src/bpmn/annotate.js';
import lila from '../../../packages/engine/src/bpmn/lila.moddle.json' with { type: 'json' };
import {
  anadirExtension,
  editarExtension,
  escribirDocumentacion,
  escribirNombre,
  leerDocumentacion,
  leerExtensiones,
  quitarExtension,
  type ElementoLienzo,
  type ElementoModdle,
  type Escritor,
} from './PropertiesPanel.js';

const raiz = new URL('../../../', import.meta.url);
const leer = (rel: string): string => readFileSync(new URL(rel, raiz), 'utf8');

/** Recorre el árbol igual que `annotate.ts`: todo lo que tenga `id`, también lo anidado. */
function* recorrer(el: ModdleElement): Generator<ModdleElement> {
  if (typeof el.id === 'string') yield el;
  const hijos = [
    ...(el.rootElements ?? []),
    ...(el.flowElements ?? []),
    ...(el.participants ?? []),
    ...(el.messageFlows ?? []),
    ...(el.artifacts ?? []),
  ];
  for (const hijo of hijos) yield* recorrer(hijo);
}

/**
 * Un lienzo de mentira. `updateProperties` y `updateModdleProperties` de bpmn-js hacen esto y
 * además apilan el comando y repintan; lo que escriben en el moddle es esta asignación.
 */
async function lienzo(xml: string): Promise<{
  escritor: Escritor;
  seleccionar(id: string): ElementoLienzo;
  exportar(): Promise<string>;
}> {
  const moddle = BpmnModdle({ lila });
  const { rootElement: definitions } = await moddle.fromXML(xml);

  return {
    escritor: {
      modeling: {
        updateProperties: (elemento, propiedades) => {
          Object.assign(elemento.businessObject, propiedades);
        },
        updateModdleProperties: (_elemento, objeto, propiedades) => {
          Object.assign(objeto, propiedades);
        },
      },
      bpmnFactory: {
        create: (tipo, atributos) => moddle.create(tipo, atributos) as ElementoModdle,
      },
    },
    seleccionar: (id) => {
      for (const el of recorrer(definitions)) {
        if (el.id === id) return { id, type: el.$type as string, businessObject: el };
      }
      throw new Error(`no hay ningún elemento con id ${id}`);
    },
    exportar: async () => (await moddle.toXML(definitions, { format: true })).xml,
  };
}

const PEDIDO = 'examples/pedido/model.bpmn';
const BIZAGI = 'examples/bizagi-exports/bizagi-miwg-A.2.0-roundtrip.bpmn';

describe('el panel de propiedades escribiendo sobre el moddle', () => {
  it('añadir una responsabilidad desde el panel aparece en el XML exportado', async () => {
    const { escritor, seleccionar, exportar } = await lienzo(leer(PEDIDO));
    const tarea = seleccionar('Task_TomarPedido');
    // La tarea no tiene `extensionElements`: el panel tiene que crearlo.
    expect(tarea.businessObject.extensionElements).toBeUndefined();

    anadirExtension(escritor, tarea, 'lila:Responsibility', { type: 'R', roleRef: 'rol-1' });
    const xml = await exportar();

    expect(xml).toMatch(/<lila:responsibility type="R" roleRef="rol-1" ?\/>/);
    // Dentro de `extensionElements` y no colgando de la tarea: eso lo prueba el motor, que solo
    // mira ahí dentro.
    expect((await readAnnotations(xml)).Task_TomarPedido?.responsibilities).toEqual([
      { type: 'R', roleRef: 'rol-1' },
    ]);
  });

  it('varias responsabilidades conviven, se editan y se quitan una a una', async () => {
    const { escritor, seleccionar, exportar } = await lienzo(leer(PEDIDO));
    const tarea = seleccionar('Task_Revisar');

    const primera = anadirExtension(escritor, tarea, 'lila:Responsibility', {
      type: 'R',
      roleRef: '',
    });
    const segunda = anadirExtension(escritor, tarea, 'lila:Responsibility', {
      type: 'R',
      roleRef: 'rol-jefe',
    });
    expect(leerExtensiones(tarea, 'lila:Responsibility')).toEqual([primera, segunda]);

    // Lo que hacen el `<select>` y el campo de rol de la fila: editar la que ya está puesta.
    editarExtension(escritor, tarea, primera, { roleRef: 'rol-cajero' });
    editarExtension(escritor, tarea, segunda, { type: 'A' });

    expect((await readAnnotations(await exportar())).Task_Revisar?.responsibilities).toEqual([
      { type: 'R', roleRef: 'rol-cajero' },
      { type: 'A', roleRef: 'rol-jefe' },
    ]);

    quitarExtension(escritor, tarea, primera);
    expect((await readAnnotations(await exportar())).Task_Revisar?.responsibilities).toEqual([
      { type: 'A', roleRef: 'rol-jefe' },
    ]);
  });

  it('los siete `lila:*Ref` son multivalor y salen con su atributo `ref`', async () => {
    const { escritor, seleccionar, exportar } = await lienzo(leer(PEDIDO));
    const tarea = seleccionar('Task_Preparar');

    anadirExtension(escritor, tarea, 'lila:SystemRef', { ref: 'sys-pos' });
    anadirExtension(escritor, tarea, 'lila:SystemRef', { ref: 'sys-cocina' });
    anadirExtension(escritor, tarea, 'lila:DocumentRef', { ref: 'doc-comanda' });
    anadirExtension(escritor, tarea, 'lila:RiskRef', { ref: 'rie-quema' });
    anadirExtension(escritor, tarea, 'lila:ControlRef', { ref: 'ctl-termometro' });
    anadirExtension(escritor, tarea, 'lila:KpiRef', { ref: 'kpi-tiempo' });
    anadirExtension(escritor, tarea, 'lila:Input', { ref: 'doc-comanda' });
    anadirExtension(escritor, tarea, 'lila:Output', { ref: 'doc-bandeja' });

    expect((await readAnnotations(await exportar())).Task_Preparar?.refs).toEqual({
      systemRef: ['sys-pos', 'sys-cocina'],
      documentRef: ['doc-comanda'],
      riskRef: ['rie-quema'],
      controlRef: ['ctl-termometro'],
      kpiRef: ['kpi-tiempo'],
      input: ['doc-comanda'],
      output: ['doc-bandeja'],
    });
  });

  it('editar el nombre cambia el `name` de la tarea', async () => {
    const { escritor, seleccionar, exportar } = await lienzo(leer(PEDIDO));
    const tarea = seleccionar('Task_TomarPedido');

    escribirNombre(escritor, tarea, 'Tomar el pedido en caja');

    expect(await exportar()).toContain(
      '<bpmn:task id="Task_TomarPedido" name="Tomar el pedido en caja">',
    );
  });

  it('la documentación se escribe una sola vez, por muchas veces que se teclee', async () => {
    const { escritor, seleccionar, exportar } = await lienzo(leer(PEDIDO));
    const tarea = seleccionar('Task_Empacar');
    // El benchmark ya documenta el proceso y la pool del cliente: lo que se cuenta es que el
    // panel añada una `bpmn:documentation` y no una por pulsación.
    const antes = (await exportar()).match(/<bpmn:documentation>/g)?.length ?? 0;

    // Una pulsación por letra, que es lo que dispara el `onChange` del textarea.
    for (const texto of ['E', 'En', 'Env', 'Envolver el pedido']) {
      escribirDocumentacion(escritor, tarea, texto);
    }
    const xml = await exportar();

    expect(tarea.businessObject.documentation).toHaveLength(1);
    expect(xml.match(/<bpmn:documentation>/g)).toHaveLength(antes + 1);
    expect(xml).toContain('<bpmn:documentation>Envolver el pedido</bpmn:documentation>');
    expect(leerDocumentacion(tarea)).toBe('Envolver el pedido');
    expect((await readAnnotations(xml)).Task_Empacar?.documentation).toBe('Envolver el pedido');
  });

  it('vaciar el campo borra la documentación en vez de dejar una vacía', async () => {
    const { escritor, seleccionar, exportar } = await lienzo(leer(PEDIDO));
    const tarea = seleccionar('Task_Empacar');

    escribirDocumentacion(escritor, tarea, 'Algo');
    escribirDocumentacion(escritor, tarea, '');
    const xml = await exportar();

    expect(tarea.businessObject.documentation).toEqual([]);
    expect(leerDocumentacion(tarea)).toBe('');
    expect((await readAnnotations(xml)).Task_Empacar).toBeUndefined();
  });

  it('los `bizagi:` del elemento sobreviven a que el panel le añada un `lila:`', async () => {
    const original = leer(BIZAGI);
    const { escritor, seleccionar, exportar } = await lienzo(original);
    const tarea = seleccionar('_5a972b87-735d-454a-b31c-f52fb3afc5c7');
    // Esta tarea ya trae un `extensionElements` con `bizagi:BizagiExtensions` dentro.
    expect(tarea.businessObject.extensionElements?.values).toHaveLength(1);

    anadirExtension(escritor, tarea, 'lila:Responsibility', { type: 'C', roleRef: 'rol-1' });
    escribirDocumentacion(escritor, tarea, 'Anotada desde el panel');
    const xml = await exportar();

    const etiquetas = (s: string): number => (s.match(/<bizagi:[A-Za-z]+/g) ?? []).length;
    expect(etiquetas(original)).toBeGreaterThan(0);
    expect(etiquetas(xml)).toBe(etiquetas(original));
    // Y el `lila:` queda junto al `bizagi:`, no en lugar de él.
    expect(tarea.businessObject.extensionElements?.values).toHaveLength(2);
    const anotaciones = (await readAnnotations(xml))['_5a972b87-735d-454a-b31c-f52fb3afc5c7'];
    expect(anotaciones?.responsibilities).toEqual([{ type: 'C', roleRef: 'rol-1' }]);
    expect(anotaciones?.documentation).toBe('Anotada desde el panel');
  });

  it('quitar el último `lila:` no se lleva por delante el `extensionElements` ajeno', async () => {
    const original = leer(BIZAGI);
    const { escritor, seleccionar, exportar } = await lienzo(original);
    const tarea = seleccionar('_4f7d62d7-f0e6-46bc-be00-69e02da38f65');

    const puesta = anadirExtension(escritor, tarea, 'lila:KpiRef', { ref: 'kpi-1' });
    quitarExtension(escritor, tarea, puesta);
    const xml = await exportar();

    expect(xml).not.toContain('lila:kpiRef');
    expect((xml.match(/<bizagi:[A-Za-z]+/g) ?? []).length).toBe(
      (original.match(/<bizagi:[A-Za-z]+/g) ?? []).length,
    );
  });
});
