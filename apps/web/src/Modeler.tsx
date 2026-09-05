/**
 * Único punto de contacto con bpmn-js (LILA-057).
 *
 * Todo lo que sepa de `BpmnModeler`, del `eventBus` o del `elementRegistry` vive aquí; el resto
 * de la app habla con el lienzo por la interfaz `Modelador` de abajo. Así el panel de
 * propiedades (LILA-060), el overlay de cuellos de botella (LILA-064) y el Worker (LILA-059)
 * pueden crecer sin repartir bpmn-js por toda la aplicación.
 */
import Modeler from 'bpmn-js/lib/Modeler';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import { useEffect, useRef } from 'react';
// El descriptor de la extensión `lila:` es el de `packages/engine/src/bpmn/lila.moddle.json`,
// única definición del namespace (ADR-012). Se importa del paquete compilado, así que
// `npm run build` de la raíz tiene que haber corrido antes de `vite` (ver package.json).
import lila from '@lila/engine/bpmn/lila.moddle.json';

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

/** La superficie que el shell usa para mandar sobre el lienzo. */
export interface Modelador {
  /** `true` si el XML se importó; `false` si falló (el motivo va por `onEstado`). */
  abrir(xml: string): Promise<boolean>;
  exportar(): Promise<string>;
  ajustar(): void;
}

interface Props {
  /** XML que se carga al arrancar. */
  xmlInicial: string;
  /** Se llama una vez con la API del lienzo, en cuanto el modelador existe. */
  onListo: (modelador: Modelador) => void;
  /** Se llama cada vez que cambia el zoom o el número de elementos. */
  onEstado: (estado: EstadoLienzo) => void;
}

/** Valor de un token de diseño, ya resuelto a color por el navegador. */
function token(nombre: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
}

export function Lienzo({ xmlInicial, onListo, onEstado }: Props): React.JSX.Element {
  const contenedor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = contenedor.current;
    if (container === null) return;

    const modeler = new Modeler({
      container,
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
    });

    // React 18+ en modo estricto monta, desmonta y vuelve a montar: sin esta bandera, el
    // `importXML` del primer modelador termina cuando ya está destruido y `fit-viewport`
    // revienta con «SVGMatrix: The provided float value is non-finite».
    let vivo = true;

    const canvas = modeler.get<Canvas>('canvas');
    const registro = modeler.get<ElementRegistry>('elementRegistry');

    /** Un contenedor sin tamaño (pestaña en segundo plano) hace que el viewbox sea NaN. */
    const conTamano = (): boolean => container.clientWidth > 0 && container.clientHeight > 0;

    /** Avisos del último import: se conservan entre repintados de la barra de estado. */
    let avisos = 0;

    const publicar = (error: string | null): void => {
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

    modeler.on(['canvas.viewbox.changed', 'elements.changed'], () => {
      publicar(null);
    });

    const abrir = async (xml: string): Promise<boolean> => {
      try {
        const { warnings } = await modeler.importXML(xml);
        if (!vivo) return false;
        avisos = warnings.length;
        // `fit-viewport` divide por el ancho del contenedor: con la pestaña en segundo plano
        // eso es 0 y bpmn-js muere con «SVGMatrix: The provided float value is non-finite».
        // Sin ajustar, el diagrama queda al 100 % y el botón «ajustar» sigue estando ahí.
        if (conTamano()) canvas.zoom('fit-viewport');
        canvas.focus();
        publicar(null);
        return true;
      } catch (e: unknown) {
        // Un import fallido deja el diagrama anterior en el lienzo: no se borra el trabajo de
        // nadie por elegir un archivo equivocado. Por eso `false` importa, y quien llama tiene
        // que dejar también el nombre anterior.
        if (vivo) publicar(e instanceof Error ? e.message : String(e));
        return false;
      }
    };

    onListo({
      abrir,
      exportar: async () => (await modeler.saveXML({ format: true })).xml ?? '',
      ajustar: () => {
        if (conTamano()) canvas.zoom('fit-viewport');
      },
    });
    void abrir(xmlInicial);

    return () => {
      vivo = false;
      modeler.destroy();
    };
  }, [xmlInicial, onListo, onEstado]);

  return <div className="lienzo" ref={contenedor} />;
}
