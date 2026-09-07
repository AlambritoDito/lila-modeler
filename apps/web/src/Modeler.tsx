/**
 * Único punto de contacto con bpmn-js (LILA-057).
 *
 * Todo lo que sepa de `BpmnModeler`, del `eventBus` o del `elementRegistry` vive aquí; el resto
 * de la app habla con el lienzo por la interfaz `Modelador` de abajo. Así el panel de
 * propiedades (LILA-060), el overlay de cuellos de botella (LILA-064) y el Worker (LILA-059)
 * pueden crecer sin repartir bpmn-js por toda la aplicación.
 */
import Modeler from 'bpmn-js/lib/Modeler';
import type BpmnFactory from 'bpmn-js/lib/features/modeling/BpmnFactory';
import type Modeling from 'bpmn-js/lib/features/modeling/Modeling';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type CommandStack from 'diagram-js/lib/command/CommandStack';
import type Selection from 'diagram-js/lib/features/selection/Selection';
import { useEffect, useRef } from 'react';
// El descriptor de la extensión `lila:` es el de `packages/engine/src/bpmn/lila.moddle.json`,
// única definición del namespace (ADR-012). Se importa del paquete compilado, así que
// `npm run build` de la raíz tiene que haber corrido antes de `vite` (ver package.json).
import lila from '@lila/engine/bpmn/lila.moddle.json';
// El overlay de cuellos de botella (LILA-064) es el único módulo fuera de este archivo que
// necesita el `Modeler` de bpmn-js en crudo; en vez de exponerlo, `Modelador.cuellos` le pasa
// el modelador desde aquí y el resto del shell sigue sin ver bpmn-js.
import { clearOverlay, sincronizarOverlay, type Corrida } from './BottleneckOverlay';
import {
  finalizarExportacion,
  prepararImportacionTransaccional,
  type ImportacionPreparada,
} from './modelerXml';

/** Lo que el shell pinta en la barra de estado. */
export interface EstadoLienzo {
  /** Escala del viewbox: 1 = 100 %. */
  zoom: number;
  /** Figuras y conexiones del diagrama, sin la raíz ni las etiquetas externas. */
  elementos: number;
  /**
   * Avisos del último import. bpmn-js no aborta cuando un elemento no se puede dibujar: lo
   * descarta y lo devuelve como aviso. Sin enseñarlos, un archivo al que le faltan la mitad de
   * las tareas se abre como si estuviera entero.
   */
  avisos: number;
  /** Mensaje del último import fallido, o `null` si todo fue bien. */
  error: string | null;
}

/**
 * Los servicios de bpmn-js que el panel de propiedades (LILA-060) necesita para leer y escribir
 * el moddle vivo. Se exponen aquí y no por `modeler.get()` suelto para que el resto de la app
 * siga sin importar bpmn-js: `PropertiesPanel.tsx` solo conoce esta interfaz.
 */
export interface Servicios {
  modeling: Modeling;
  bpmnFactory: BpmnFactory;
  selection: Selection;
}

/** La superficie que el shell usa para mandar sobre el lienzo. */
export interface Modelador {
  /** `true` si el XML se importó; `false` si falló (el motivo va por `onEstado`). */
  abrir(xml: string): Promise<boolean>;
  exportar(): Promise<string>;
  ajustar(): void;
  servicios: Servicios;
  /** Escucha eventos del `eventBus`; devuelve la función que se desuscribe. */
  suscribir(eventos: string[], escuchar: () => void): () => void;
  /**
   * Overlay de cuellos de botella (LILA-064). `corrida = null` o `visible = false` lo quitan; una
   * corrida nueva reemplaza a la anterior sin acumular nada. Idempotente: el shell puede llamarlo
   * en cada render sin comprobar si algo cambió.
   */
  cuellos(corrida: Corrida | null, visible: boolean): void;
  /** Superficie opcional para que el shell añada controles básicos sin importar diagram-js. */
  deshacer?(): void;
  rehacer?(): void;
  /** Selecciona por id interno o por el id original anterior al saneamiento. */
  seleccionar?(id: string): void;
}

interface Props {
  /** XML que se carga al arrancar. */
  xmlInicial: string;
  /** Se llama una vez con la API del lienzo, en cuanto el modelador existe. */
  onListo: (modelador: Modelador) => void;
  /** Se llama cada vez que cambia el zoom o el número de elementos. */
  onEstado: (estado: EstadoLienzo) => void;
  /**
   * Id del elemento seleccionado, o `null` si no hay ninguno o hay varios (LILA-061: el panel
   * de escenario edita `elements[id]`, y con dos seleccionados no hay un `id` que editar).
   * Debe ser estable entre renders: entra en las dependencias del efecto que monta bpmn-js.
   */
  onSeleccion: (id: string | null) => void;
}

/** Valor de un token de diseño, ya resuelto a color por el navegador. */
function token(nombre: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

export function Lienzo({ xmlInicial, onListo, onEstado, onSeleccion }: Props): React.JSX.Element {
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = contenedor.current;
    if (container === null) return;

    const opciones = {
      // La extensión `lila:` sobrevive a abrir y exportar sin que el modelador la entienda.
      moddleExtensions: { lila },
      // bpmn-js dibuja negro sobre blanco; el lienzo de Lila es oscuro. Los tres colores se
      // leen de los tokens una sola vez, al montar: hacerlos reactivos al cambio de tema en
      // caliente es LILA-113.
      bpmnRenderer: {
        defaultFillColor: token('--diagram-fill'),
        defaultStrokeColor: token('--diagram-stroke'),
        defaultLabelColor: token('--diagram-label'),
      },
      // Sin `keyboard.bindTo`: en bpmn-js 18 (diagram-js 15) esa opción ya no existe y solo
      // imprime «unsupported configuration <keyboard.bindTo>» en consola. El teclado se engancha
      // solo al SVG del lienzo en `canvas.init`, así que los atajos responden cuando el lienzo
      // tiene el foco; de eso se encarga `canvas.focus()` tras cada import.
    };

    // React 18+ en modo estricto monta, desmonta y vuelve a montar: sin esta bandera, el
    // `importXML` del primer modelador termina cuando ya está destruido y `fit-viewport`
    // revienta con «SVGMatrix: The provided float value is non-finite».
    let vivo = true;

    let activo: Modeler | null = null;
    let originalIds = new Map<string, string>();
    let perdidas: string[] = [];
    const suscripciones = new Set<{ eventos: string[]; escuchar: () => void }>();

    /** Un contenedor sin tamaño (pestaña en segundo plano) hace que el viewbox sea NaN. */
    const conTamano = (): boolean => container.clientWidth > 0 && container.clientHeight > 0;

    /** Avisos del último import: se conservan entre repintados de la barra de estado. */
    let avisos = 0;

    const publicar = (error: string | null): void => {
      if (activo === null) {
        onEstado({ zoom: 1, avisos, elementos: 0, error });
        return;
      }
      const canvas = activo.get<Canvas>('canvas');
      const registro = activo.get<ElementRegistry>('elementRegistry');
      const zoom = canvas.zoom();
      onEstado({
        zoom: Number.isFinite(zoom) ? zoom : 1,
        avisos,
        // La raíz no tiene padre y las etiquetas externas cuelgan de su elemento: ni una ni
        // otras son "elementos del diagrama" para quien mira la barra de estado.
        elementos: registro.filter((el) => el.parent != null && el.labelTarget == null).length,
        error,
      });
    };

    const vincular = (modeler: Modeler): void => {
      modeler.on(['canvas.viewbox.changed', 'elements.changed'], () => {
        if (modeler === activo) publicar(null);
      });
      // Única fuente de la selección para el resto de la app (LILA-061).
      modeler.on('selection.changed', (evento: { newSelection: Array<{ id: string }> }) => {
        if (modeler !== activo) return;
        const elegidos = evento.newSelection;
        onSeleccion(elegidos.length === 1 ? (elegidos[0]?.id ?? null) : null);
      });
      for (const suscripcion of suscripciones) {
        modeler.on(suscripcion.eventos, suscripcion.escuchar);
      }
    };

    const crearCandidato = (): { modeler: Modeler; staging: HTMLDivElement } => {
      const staging = document.createElement('div');
      staging.style.cssText =
        'position:fixed;left:-10000px;top:0;width:1024px;height:768px;visibility:hidden';
      document.body.appendChild(staging);
      return { modeler: new Modeler({ ...opciones, container: staging }), staging };
    };

    const abrir = async (xml: string): Promise<boolean> => {
      const { modeler: candidato, staging } = crearCandidato();
      let preparada: ImportacionPreparada<Modeler>;
      try {
        preparada = await prepararImportacionTransaccional(xml, () => candidato);
      } catch (e: unknown) {
        staging.remove();
        if (vivo) publicar(e instanceof Error ? e.message : String(e));
        return false;
      }
      if (!vivo) {
        candidato.destroy();
        staging.remove();
        return false;
      }

      // Solo ahora se sustituye la instancia activa: hasta aquí XML, selección, servicios e
      // historial del modelo anterior seguían intactos.
      const anterior = activo;
      try {
        candidato.attachTo(container);
      } catch (e: unknown) {
        candidato.destroy();
        staging.remove();
        publicar(e instanceof Error ? e.message : String(e));
        return false;
      }

      activo = candidato;
      originalIds = preparada.originalIds;
      perdidas = preparada.perdidas;
      avisos = preparada.avisos.length;
      vincular(candidato);
      if (anterior !== null) {
        for (const suscripcion of suscripciones) {
          anterior.off(suscripcion.eventos, suscripcion.escuchar);
        }
        clearOverlay(anterior);
        anterior.destroy();
      }
      staging.remove();
      onSeleccion(null);
      const canvas = candidato.get<Canvas>('canvas');
      // `fit-viewport` divide por el ancho del contenedor: con la pestaña en segundo plano
      // eso es 0 y bpmn-js muere con «SVGMatrix: The provided float value is non-finite».
      // Sin ajustar, el diagrama queda al 100 % y el botón «ajustar» sigue estando ahí.
      if (conTamano()) canvas.zoom('fit-viewport');
      canvas.focus();
      publicar(null);
      return true;
    };

    const api: Modelador = {
      abrir,
      exportar: async () => {
        if (activo === null) throw new Error('El modelador todavía no tiene un BPMN abierto.');
        if (perdidas.length > 0) {
          const detalle = perdidas.map((warning) => `• ${warning}`).join('\n');
          const continuar = window.confirm(
            `El archivo original contenía referencias o elementos que no se pudieron importar. ` +
              `Si exportas ahora, ese contenido se perderá:\n\n${detalle}\n\n¿Exportar de todos modos?`,
          );
          if (!continuar) throw new Error(`Exportación cancelada por contenido perdido:\n${detalle}`);
        }
        const xml = (await activo.saveXML({ format: true })).xml ?? '';
        return finalizarExportacion(xml, originalIds);
      },
      ajustar: () => {
        if (activo === null) return;
        const canvas = activo.get<Canvas>('canvas');
        if (conTamano()) canvas.zoom('fit-viewport');
      },
      get servicios(): Servicios {
        if (activo === null) throw new Error('El modelador todavía no tiene un BPMN abierto.');
        return {
          modeling: activo.get<Modeling>('modeling'),
          bpmnFactory: activo.get<BpmnFactory>('bpmnFactory'),
          selection: activo.get<Selection>('selection'),
        };
      },
      suscribir: (eventos, escuchar) => {
        const suscripcion = { eventos, escuchar };
        suscripciones.add(suscripcion);
        activo?.on(eventos, escuchar);
        return () => {
          suscripciones.delete(suscripcion);
          activo?.off(eventos, escuchar);
        };
      },
      cuellos: (corrida, visible) => {
        if (activo !== null) sincronizarOverlay(activo, corrida, visible);
      },
      deshacer: () => {
        const commands = activo?.get<CommandStack>('commandStack');
        if (commands?.canUndo()) commands.undo();
      },
      rehacer: () => {
        const commands = activo?.get<CommandStack>('commandStack');
        if (commands?.canRedo()) commands.redo();
      },
      seleccionar: (id) => {
        if (activo === null) return;
        const registro = activo.get<ElementRegistry>('elementRegistry');
        const interno = registro.get(id)
          ? id
          : [...originalIds].find(([, original]) => original === id)?.[0];
        const elemento = interno === undefined ? undefined : registro.get(interno);
        if (elemento !== undefined) activo.get<Selection>('selection').select(elemento);
      },
    };
    // `onListo` se publica después del import inicial: su primera exportación ya contiene el
    // modelo recibido y nunca el lienzo vacío de una instancia recién creada.
    void abrir(xmlInicial).then((abierto) => {
      if (vivo && abierto) onListo(api);
    });

    return () => {
      vivo = false;
      activo?.destroy();
    };
  }, [xmlInicial, onListo, onEstado, onSeleccion]);

  return <div className="lienzo" ref={contenedor} />;
}
