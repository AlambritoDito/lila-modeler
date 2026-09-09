/**
 * Único punto de contacto con bpmn-js (LILA-057).
 *
 * Todo lo que sepa de `BpmnModeler`, del `eventBus` o del `elementRegistry` vive aquí; el resto
 * de la app habla con el lienzo por la interfaz `Modelador` de abajo. Así el panel de
 * propiedades (LILA-060), el overlay de cuellos de botella (LILA-064) y el Worker (LILA-059)
 * pueden crecer sin repartir bpmn-js por toda la aplicación.
 */
import Modeler from 'bpmn-js/lib/Modeler';
// Se importa como VALOR, no solo como tipo: `repintar()` vuelve a ejecutar este constructor sobre
// el renderer vivo para cambiar de tema sin remontar el lienzo (LILA-113; el porqué, allí abajo).
import BpmnRenderer from 'bpmn-js/lib/draw/BpmnRenderer';
// Minimapa del lienzo (LILA-208). Es un módulo de diagram-js: se monta solo dentro del
// contenedor del canvas y viaja con él en `attachTo`, así que el shell no lo dibuja ni lo
// conoce. Su CSS se importa aquí y se viste con tokens en `app.css` (bloque «minimapa»).
import minimapModule from 'diagram-js-minimap';
import 'diagram-js-minimap/assets/diagram-js-minimap.css';
// Animación de tokens para la pestaña «Validar rutas» (LILA-065). No es la simulación DES del
// motor: solo anima el recorrido de tokens sobre el BPMN ya importado, por eso vive junto al
// minimapa como otro módulo más de bpmn-js y no como algo que el resto de la app conozca.
import tokenSimulationModule from 'bpmn-js-token-simulation';
import 'bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css';
import type BpmnFactory from 'bpmn-js/lib/features/modeling/BpmnFactory';
import type Modeling from 'bpmn-js/lib/features/modeling/Modeling';
import type Canvas from 'diagram-js/lib/core/Canvas';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type EventBus from 'diagram-js/lib/core/EventBus';
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
// Misma frontera que el overlay de cuellos: los marcadores de validación (LILA-209) reciben el
// `Modeler` desde aquí y el shell solo llama a `Modelador.validacion`.
import { sincronizarMarcadores, type Validacion } from './ValidationMarkers';
import {
  autorizarExportacion,
  finalizarExportacion,
  prepararImportacionTransaccional,
  type ImportacionPreparada,
  type OpcionesExportacion,
} from './modelerXml';
import { strings, useLocale } from './i18n';
import { rotularMinimapa } from './minimapa';
// Los colores del diagrama durante «Validar rutas» (#264). Van en `TokenSim.tsx` con el resto de
// lo que sabe de ese módulo; aquí solo se registran detrás de él para sustituir dos de sus
// servicios (ver `moduloColoresDelTema`).
import { moduloColoresDelTema } from './TokenSim';

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
  /**
   * El subconjunto de esos avisos que implica pérdida al volver a serializar (LILA-193): no son
   * «revisa esto», son «esto ya no está en el modelo».
   */
  perdidas: string[];
  /**
   * Ids que el archivo original referencia sin declararlos (LILA-192). moddle no los conserva,
   * así que exportar los borra aunque el import no se haya quejado de nada.
   */
  refsRotas: string[];
  /** Mensaje del último import fallido, o `null` si todo fue bien. */
  error: string | null;
}

/**
 * Los servicios de bpmn-js que el panel de propiedades (LILA-060) necesita para leer y escribir
 * el moddle vivo. Se exponen aquí y no por `modeler.get()` suelto para que el resto de la app
 * siga sin importar bpmn-js: `PropertiesPanel.tsx` solo conoce esta interfaz.
 */
export interface Servicios {
  modeling: Modeling & {
    /** Cuelga una figura ya fabricada de `target`, en `posicion` del sistema del diagrama. */
    createShape(figura: unknown, posicion: Punto, target: unknown): unknown;
  };
  bpmnFactory: BpmnFactory;
  selection: Selection;
  /** Raíz visible actual; permite editar un proceso simple al seleccionar el fondo. */
  rootElement?(): unknown;
  /**
   * Los cuatro servicios que usa la paleta propia (LILA-207). Se describen aquí con la forma
   * mínima que hace falta —no con los tipos genéricos de bpmn-js— para que `Paleta.tsx` no
   * tenga que importar nada del editor.
   */
  create: { start(evento: Event, figura: unknown): void };
  elementFactory: {
    createShape(atributos: { type: string; eventDefinitionType?: string | undefined; isExpanded?: boolean | undefined }): unknown;
    createParticipantShape(): unknown;
  };
  canvas: {
    viewbox(): Rectangulo;
    getRootElement(): unknown;
    scrollToElement(figura: unknown): void;
    /** Contenedor del lienzo; ahí dentro monta su UI `bpmn-js-token-simulation` (#264). */
    getContainer(): HTMLElement;
  };
  /** `activate` abre la edición del nombre de la figura recién creada. */
  directEditing: { activate(figura: unknown): void };
  /** Para saber sobre qué elemento cae el punto donde se inserta (`Paleta.tsx`). */
  elementRegistry: { filter(prueba: (elemento: Elemento) => boolean): Elemento[] };
  /** Las reglas de bpmn-js: quién puede contener a quién. */
  rules: { allowed(accion: string, contexto: object): unknown };
}

interface Punto { x: number; y: number }
interface Rectangulo extends Punto { width: number; height: number }
/** Lo mínimo de un elemento del diagrama para saber si un punto cae dentro. */
export interface Elemento { x?: number; y?: number; width?: number; height?: number; labelTarget?: unknown }

/** La superficie que el shell usa para mandar sobre el lienzo. */
export interface Modelador {
  /** `true` si el XML se importó; `false` si falló (el motivo va por `onEstado`). */
  abrir(xml: string): Promise<boolean>;
  exportar(opciones?: OpcionesExportacion): Promise<string>;
  /** Comprueba parseo y renderizado en una instancia aislada sin tocar el modelo activo. */
  comprobar?(xml: string): Promise<void>;
  ajustar(): void;
  /**
   * Zoom del lienzo para los botones + / − / ajustar (LILA-208). `factor` multiplica la escala
   * actual (1.2 acerca, 1/1.2 aleja) y `'ajustar'` encuadra el diagrama. Se acota a 20 %–400 %
   * para que pulsar sin mirar no deje el modelo fuera de la vista.
   */
  zoom(factor: number | 'ajustar'): void;
  servicios: Servicios;
  /** Escucha eventos del `eventBus`; devuelve la función que se desuscribe. */
  suscribir(eventos: string[], escuchar: () => void): () => void;
  /**
   * Overlay de cuellos de botella (LILA-064). `corrida = null` o `visible = false` lo quitan; una
   * corrida nueva reemplaza a la anterior sin acumular nada. Idempotente: el shell puede llamarlo
   * en cada render sin comprobar si algo cambió.
   */
  cuellos(corrida: Corrida | null, visible: boolean): void;
  /**
   * Marcadores de validación (LILA-209). `null` o un mapa vacío los quitan; repetir la llamada
   * no acumula nada, así que el shell puede llamarla en cada render.
   */
  validacion(validacion: Validacion | null): void;
  /**
   * Activa o desactiva la animación de tokens de `bpmn-js-token-simulation` (LILA-065). No tiene
   * relación con el motor DES: solo anima el recorrido de tokens sobre las figuras del diagrama
   * ya importado; el shell la enciende al entrar en «Validar rutas» y la apaga al salir.
   */
  simulacionTokens(activa: boolean): void;
  /**
   * Vuelve a leer los tokens del tema y redibuja las figuras (LILA-113). El shell la llama después
   * de `applyTheme`; no toca el modelo, así que la pila de deshacer y la selección siguen donde
   * estaban —que es justamente lo que se perdía cuando cambiar de tema remontaba el lienzo—.
   */
  repintar(): void;
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

/**
 * Los tres colores por defecto de las figuras, leídos de los tokens de AHORA MISMO. bpmn-js dibuja
 * negro sobre blanco; el lienzo de Lila es el que diga el tema. Son «por defecto» en el sentido de
 * bpmn-js: un elemento con color propio en su DI sigue mandando sobre ellos.
 */
function coloresDelDiagrama(): { defaultFillColor: string; defaultStrokeColor: string; defaultLabelColor: string } {
  return {
    defaultFillColor: token('--diagram-fill'),
    defaultStrokeColor: token('--diagram-stroke'),
    defaultLabelColor: token('--diagram-label'),
  };
}

/**
 * `eventBus` que no registra nada, para la reconstrucción del renderer en `repintar()`: el
 * constructor de bpmn-js llama a `BaseRenderer`, que se suscribe a `render.shape`/`render.connection`.
 * Los oyentes de la primera construcción ya apuntan a esa misma instancia y siguen valiendo, así
 * que dejarle un bus mudo evita apilar una copia de cada uno en cada cambio de tema.
 */
const BUS_MUDO = { on: () => {} } as unknown as EventBus;

export function Lienzo({ xmlInicial, onListo, onEstado, onSeleccion }: Props): React.JSX.Element {
  const contenedor = useRef<HTMLDivElement>(null);
  const locale = useLocale();

  // El rótulo y el `title` del minimapa los escribe bpmn-js cada vez que se pliega o se abre, y
  // nada más: al cambiar de idioma no hay evento que los repinte, así que se reescriben aquí
  // sobre el minimapa que ya está montado. El lienzo NO se remonta por cambiar de idioma (eso se
  // llevaría la pila de deshacer), igual que no lo hace por cambiar de tema (LILA-113).
  useEffect(() => {
    const minimapa = contenedor.current?.querySelector('.djs-minimap');
    rotularMinimapa(minimapa?.querySelector('.toggle'), minimapa?.classList.contains('open') === true);
  }, [locale]);

  useEffect(() => {
    const container = contenedor.current;
    if (container === null) return;

    const opciones = {
      // La extensión `lila:` sobrevive a abrir y exportar sin que el modelador la entienda.
      moddleExtensions: { lila },
      // `moduloColoresDelTema` va DETRÁS de `tokenSimulationModule` a propósito: en didi la
      // última definición de un servicio gana, y así la animación pinta el diagrama con los
      // tokens del tema en vez de en blanco y negro (#264).
      additionalModules: [minimapModule, tokenSimulationModule, moduloColoresDelTema],
      // Abierto de entrada, como en el artboard; el plugin guarda el estado en su clase `open`
      // y su cabecera es el propio botón de plegar, restilizado en `app.css`.
      minimap: { open: true },
      // Colores del tema al montar; el cambio en caliente lo hace `repintar()` (LILA-113).
      bpmnRenderer: coloresDelDiagrama(),
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
    let refsRotas: string[] = [];
    let ultimaApertura = 0;
    const suscripciones = new Set<{ eventos: string[]; escuchar: () => void }>();

    /** Un contenedor sin tamaño (pestaña en segundo plano) hace que el viewbox sea NaN. */
    const conTamano = (): boolean => container.clientWidth > 0 && container.clientHeight > 0;

    /** Avisos del último import: se conservan entre repintados de la barra de estado. */
    let avisos = 0;

    const publicar = (error: string | null): void => {
      if (activo === null) {
        onEstado({ zoom: 1, avisos, perdidas, refsRotas, elementos: 0, error });
        return;
      }
      const canvas = activo.get<Canvas>('canvas');
      const registro = activo.get<ElementRegistry>('elementRegistry');
      const zoom = canvas.zoom();
      onEstado({
        zoom: Number.isFinite(zoom) ? zoom : 1,
        avisos,
        perdidas,
        refsRotas,
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
      // El minimapa reescribe el rótulo y el `title` de su cabecera en inglés («Close minimap»)
      // cada vez que se pliega o se abre, así que se vuelven a poner desde el catálogo en vez de
      // montar un servicio `translate` propio. Se busca dentro del contenedor de ESTE modelador,
      // no del de React: al abrir un archivo el anterior sigue montado hasta que se destruye, y
      // su minimapa saldría antes.
      const suyo = modeler.get<Canvas>('canvas').getContainer();
      const alPlegar = ({ open }: { open: boolean }): void => {
        rotularMinimapa(suyo.querySelector('.djs-minimap .toggle'), open);
      };
      modeler.on('minimap.toggle', alPlegar);
      for (const suscripcion of suscripciones) {
        modeler.on(suscripcion.eventos, suscripcion.escuchar);
      }
      alPlegar({ open: suyo.querySelector('.djs-minimap')?.classList.contains('open') === true });
    };

    const crearCandidato = (): { modeler: Modeler; staging: HTMLDivElement } => {
      const staging = document.createElement('div');
      staging.style.cssText =
        'position:fixed;left:-10000px;top:0;width:1024px;height:768px;visibility:hidden';
      document.body.appendChild(staging);
      return { modeler: new Modeler({ ...opciones, container: staging }), staging };
    };

    const abrir = async (xml: string): Promise<boolean> => {
      const apertura = ++ultimaApertura;
      const { modeler: candidato, staging } = crearCandidato();
      let preparada: ImportacionPreparada<Modeler>;
      try {
        preparada = await prepararImportacionTransaccional(xml, () => candidato);
      } catch (e: unknown) {
        staging.remove();
        if (vivo && apertura === ultimaApertura) {
          publicar(e instanceof Error ? e.message : String(e));
        }
        return false;
      }
      if (!vivo || apertura !== ultimaApertura) {
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
      refsRotas = preparada.refsRotas;
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
      exportar: async (opciones) => {
        if (activo === null) throw new Error(strings().lienzo.errorSinBpmn);
        autorizarExportacion(perdidas, opciones);
        const xml = (await activo.saveXML({ format: true })).xml ?? '';
        return finalizarExportacion(xml, originalIds);
      },
      comprobar: async (xml) => {
        const { modeler: candidato, staging } = crearCandidato();
        let importado = false;
        try {
          await prepararImportacionTransaccional(xml, () => candidato);
          importado = true;
        } finally {
          if (importado) candidato.destroy();
          staging.remove();
        }
      },
      ajustar: () => api.zoom('ajustar'),
      zoom: (factor) => {
        if (activo === null || !conTamano()) return;
        const canvas = activo.get<Canvas>('canvas');
        if (factor === 'ajustar') canvas.zoom('fit-viewport');
        else canvas.zoom(Math.min(4, Math.max(0.2, canvas.zoom() * factor)));
      },
      get servicios(): Servicios {
        if (activo === null) throw new Error(strings().lienzo.errorSinBpmn);
        return {
          modeling: activo.get<Servicios['modeling']>('modeling'),
          bpmnFactory: activo.get<BpmnFactory>('bpmnFactory'),
          selection: activo.get<Selection>('selection'),
          rootElement: () => activo?.get<Canvas>('canvas').getRootElement(),
          create: activo.get<Servicios['create']>('create'),
          elementFactory: activo.get<Servicios['elementFactory']>('elementFactory'),
          canvas: activo.get<Servicios['canvas']>('canvas'),
          directEditing: activo.get<Servicios['directEditing']>('directEditing'),
          elementRegistry: activo.get<Servicios['elementRegistry']>('elementRegistry'),
          rules: activo.get<Servicios['rules']>('rules'),
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
      validacion: (validacion) => {
        if (activo !== null) sincronizarMarcadores(activo, validacion);
      },
      simulacionTokens: (activa) => {
        if (activo !== null) activo.get<{ toggleMode(activa: boolean): void }>('toggleMode').toggleMode(activa);
      },
      repintar: () => {
        if (activo === null) return;
        // bpmn-js copia `defaultFillColor`/`defaultStrokeColor`/`defaultLabelColor` a variables
        // locales del constructor de `BpmnRenderer` (`node_modules/bpmn-js/lib/draw/BpmnRenderer.js`,
        // ~línea 123): no hay ni setter ni evento para cambiarlas después, y la config que didi le
        // inyectó ya no se vuelve a mirar. Volver a ejecutar ese constructor sobre la MISMA
        // instancia reescribe esas variables y su `this.handlers`, que es exactamente lo que hace
        // falta; el resto del injector no se entera de nada porque el objeto no cambia.
        // ponytail: si algún día bpmn-js expone los colores por servicio, esto es una línea menos.
        const renderer = activo.get<BpmnRenderer>('bpmnRenderer');
        BpmnRenderer.call(
          renderer,
          coloresDelDiagrama(),
          BUS_MUDO,
          activo.get('styles'),
          activo.get('pathMap'),
          activo.get<Canvas>('canvas'),
          activo.get('textRenderer'),
        );
        // `elements.changed` es la vía normal de diagram-js para "vuelve a dibujar esto"
        // (`ChangeSupport` -> `graphicsFactory.update`). No pasa por el `commandStack`, así que no
        // ensucia el documento ni añade un paso al deshacer. Sin la raíz: `update` la ignora.
        const registro = activo.get<ElementRegistry>('elementRegistry');
        activo.get<EventBus>('eventBus').fire('elements.changed', {
          elements: registro.filter((el) => el.parent != null),
        });
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
