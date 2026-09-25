/**
 * Paleta de figuras propia (LILA-207).
 *
 * La paleta de bpmn-js son iconos sin nombre, sin búsqueda y dentro del lienzo. El artboard
 * (`docs/design/01-modelar-1440.png`) la quiere como un raíl de 236 px a la izquierda, con el
 * nombre de cada figura, grupos plegables, un filtro y un modo compacto de 48 px.
 *
 * No importa bpmn-js: todo lo que necesita —`create`, `elementFactory`, `canvas`,
 * `modeling` y `directEditing`— entra por `Servicios` (`Modeler.tsx`), que es la frontera
 * del shell con el editor.
 *
 * Los iconos son las clases `bpmn-icon-*` de `bpmn-font`, que la app ya carga en `App.tsx`.
 */
import { useState } from 'react';
import type { Servicios } from './Modeler';
import { strings, useStrings } from './i18n';

/** Una figura de la paleta: lo que hace falta para pintarla y para crearla. */
export interface Figura {
  /** Tipo BPMN que recibe `elementFactory` (`bpmn:UserTask`, `bpmn:Participant`…). */
  readonly tipo: string;
  readonly nombre: string;
  /** Clase de `bpmn-font`, sin el prefijo compartido. */
  readonly icono: string;
  /** Marca el evento: mismo tipo, distinta definición (mensaje, temporizador). */
  readonly eventDefinitionType?: string;
  /** Subproceso dibujado abierto en vez de plegado. */
  readonly isExpanded?: boolean;
  /** An event sub-process (#456): a `bpmn:SubProcess` started by an event, drawn dashed. */
  readonly triggeredByEvent?: boolean;
  /**
   * What has to be selected for the figure to be inserted (#456): a boundary event hangs from an
   * `actividad`, a lane goes into a pool or next to a lane (`contenedor`). Without it the item is
   * disabled and its title says what to select.
   */
  readonly requiere?: 'actividad' | 'contenedor';
}

interface Grupo {
  readonly nombre: string;
  readonly figuras: readonly Figura[];
}

/**
 * Los grupos y su orden son los del artboard. La lista es estática a propósito: el catálogo BPMN
 * no cambia entre sesiones y sacarlo de `elementFactory` costaría más que escribirlo. #456 split
 * the events by kind and added the types that only existed in bpmn-js's own context pad and
 * replace menu, so a model is drawn from here without the stock bpmn-js palette.
 */
export function gruposDeFiguras(): readonly Grupo[] {
  const S = strings();
  const F = S.paleta.figuras;
  const mensaje = 'bpmn:MessageEventDefinition', temporizador = 'bpmn:TimerEventDefinition', senal = 'bpmn:SignalEventDefinition';
  const condicional = 'bpmn:ConditionalEventDefinition', enlace = 'bpmn:LinkEventDefinition', error = 'bpmn:ErrorEventDefinition';
  return [
    {
      nombre: S.paleta.grupos.eventosInicio,
      figuras: [
        { tipo: 'bpmn:StartEvent', nombre: F.inicio, icono: 'start-event-none' },
        { tipo: 'bpmn:StartEvent', nombre: F.inicioMensaje, icono: 'start-event-message', eventDefinitionType: mensaje },
        { tipo: 'bpmn:StartEvent', nombre: F.inicioTemporizador, icono: 'start-event-timer', eventDefinitionType: temporizador },
        { tipo: 'bpmn:StartEvent', nombre: F.inicioSenal, icono: 'start-event-signal', eventDefinitionType: senal },
        { tipo: 'bpmn:StartEvent', nombre: F.inicioCondicional, icono: 'start-event-condition', eventDefinitionType: condicional },
      ],
    },
    {
      nombre: S.paleta.grupos.eventosIntermedios,
      figuras: [
        { tipo: 'bpmn:IntermediateThrowEvent', nombre: F.intermedio, icono: 'intermediate-event-none' },
        { tipo: 'bpmn:IntermediateCatchEvent', nombre: F.capturaMensaje, icono: 'intermediate-event-catch-message', eventDefinitionType: mensaje },
        { tipo: 'bpmn:IntermediateCatchEvent', nombre: F.capturaTemporizador, icono: 'intermediate-event-catch-timer', eventDefinitionType: temporizador },
        { tipo: 'bpmn:IntermediateCatchEvent', nombre: F.capturaSenal, icono: 'intermediate-event-catch-signal', eventDefinitionType: senal },
        { tipo: 'bpmn:IntermediateCatchEvent', nombre: F.capturaEnlace, icono: 'intermediate-event-catch-link', eventDefinitionType: enlace },
        { tipo: 'bpmn:IntermediateCatchEvent', nombre: F.capturaCondicional, icono: 'intermediate-event-catch-condition', eventDefinitionType: condicional },
        { tipo: 'bpmn:IntermediateThrowEvent', nombre: F.lanzamientoMensaje, icono: 'intermediate-event-throw-message', eventDefinitionType: mensaje },
        { tipo: 'bpmn:IntermediateThrowEvent', nombre: F.lanzamientoSenal, icono: 'intermediate-event-throw-signal', eventDefinitionType: senal },
        { tipo: 'bpmn:IntermediateThrowEvent', nombre: F.lanzamientoEnlace, icono: 'intermediate-event-throw-link', eventDefinitionType: enlace },
        { tipo: 'bpmn:IntermediateThrowEvent', nombre: F.lanzamientoEscalado, icono: 'intermediate-event-throw-escalation', eventDefinitionType: 'bpmn:EscalationEventDefinition' },
      ],
    },
    {
      nombre: S.paleta.grupos.eventosFin,
      figuras: [
        { tipo: 'bpmn:EndEvent', nombre: F.fin, icono: 'end-event-none' },
        { tipo: 'bpmn:EndEvent', nombre: F.finMensaje, icono: 'end-event-message', eventDefinitionType: mensaje },
        { tipo: 'bpmn:EndEvent', nombre: F.finTerminar, icono: 'end-event-terminate', eventDefinitionType: 'bpmn:TerminateEventDefinition' },
        { tipo: 'bpmn:EndEvent', nombre: F.finError, icono: 'end-event-error', eventDefinitionType: error },
        { tipo: 'bpmn:EndEvent', nombre: F.finSenal, icono: 'end-event-signal', eventDefinitionType: senal },
      ],
    },
    {
      nombre: S.paleta.grupos.eventosBorde,
      figuras: [
        { tipo: 'bpmn:BoundaryEvent', nombre: F.bordeMensaje, icono: 'intermediate-event-catch-message', eventDefinitionType: mensaje, requiere: 'actividad' },
        { tipo: 'bpmn:BoundaryEvent', nombre: F.bordeTemporizador, icono: 'intermediate-event-catch-timer', eventDefinitionType: temporizador, requiere: 'actividad' },
        { tipo: 'bpmn:BoundaryEvent', nombre: F.bordeError, icono: 'intermediate-event-catch-error', eventDefinitionType: error, requiere: 'actividad' },
        { tipo: 'bpmn:BoundaryEvent', nombre: F.bordeSenal, icono: 'intermediate-event-catch-signal', eventDefinitionType: senal, requiere: 'actividad' },
      ],
    },
    {
      nombre: S.paleta.grupos.actividades,
      figuras: [
        { tipo: 'bpmn:Task', nombre: F.tarea, icono: 'task' },
        { tipo: 'bpmn:UserTask', nombre: F.tareaUsuario, icono: 'user-task' },
        { tipo: 'bpmn:ServiceTask', nombre: F.tareaServicio, icono: 'service-task' },
        { tipo: 'bpmn:ManualTask', nombre: F.tareaManual, icono: 'manual-task' },
        { tipo: 'bpmn:ScriptTask', nombre: F.tareaScript, icono: 'script-task' },
        { tipo: 'bpmn:SendTask', nombre: F.tareaEnvio, icono: 'send-task' },
        { tipo: 'bpmn:ReceiveTask', nombre: F.tareaRecepcion, icono: 'receive-task' },
        { tipo: 'bpmn:BusinessRuleTask', nombre: F.tareaReglaNegocio, icono: 'business-rule-task' },
        { tipo: 'bpmn:SubProcess', nombre: F.subproceso, icono: 'subprocess-expanded', isExpanded: true },
        { tipo: 'bpmn:SubProcess', nombre: F.subprocesoPlegado, icono: 'subprocess-collapsed', isExpanded: false },
        { tipo: 'bpmn:SubProcess', nombre: F.subprocesoEvento, icono: 'event-subprocess-expanded', isExpanded: true, triggeredByEvent: true },
        { tipo: 'bpmn:Transaction', nombre: F.transaccion, icono: 'transaction', isExpanded: true },
        { tipo: 'bpmn:CallActivity', nombre: F.actividadLlamada, icono: 'call-activity' },
      ],
    },
    {
      nombre: S.paleta.grupos.compuertas,
      figuras: [
        { tipo: 'bpmn:ExclusiveGateway', nombre: F.exclusiva, icono: 'gateway-xor' },
        { tipo: 'bpmn:ParallelGateway', nombre: F.paralela, icono: 'gateway-parallel' },
        { tipo: 'bpmn:InclusiveGateway', nombre: F.inclusiva, icono: 'gateway-or' },
        { tipo: 'bpmn:EventBasedGateway', nombre: F.basadaEnEventos, icono: 'gateway-eventbased' },
      ],
    },
    {
      nombre: S.paleta.grupos.datos,
      figuras: [
        { tipo: 'bpmn:DataObjectReference', nombre: F.objetoDeDatos, icono: 'data-object' },
        { tipo: 'bpmn:DataStoreReference', nombre: F.almacenDeDatos, icono: 'data-store' },
      ],
    },
    {
      nombre: S.paleta.grupos.artefactos,
      figuras: [
        { tipo: 'bpmn:TextAnnotation', nombre: F.anotacion, icono: 'text-annotation' },
        { tipo: 'bpmn:Group', nombre: F.grupo, icono: 'group' },
      ],
    },
    {
      nombre: S.paleta.grupos.poolsYCarriles,
      figuras: [
        { tipo: 'bpmn:Participant', nombre: F.pool, icono: 'participant' },
        { tipo: 'bpmn:Lane', nombre: F.carril, icono: 'lane', requiere: 'contenedor' },
      ],
    },
  ];
}

/**
 * Qué clase `bpmn-icon-intermediate-event-catch-*` le toca a un evento intermedio de captura o
 * de límite según su `eventDefinition` (`docs.../events.md` no distingue: los dos comparten
 * icono por definición en `bpmn-font`). Sin definición reconocida, el círculo genérico —el mismo
 * «sin nada especial» que un `IntermediateCatchEvent` recién puesto (QA de la ronda 1 de #392).
 */
const ICONO_POR_DEFINICION: Readonly<Record<string, string>> = {
  'bpmn:TimerEventDefinition': 'intermediate-event-catch-timer',
  'bpmn:MessageEventDefinition': 'intermediate-event-catch-message',
  'bpmn:SignalEventDefinition': 'intermediate-event-catch-signal',
  'bpmn:ConditionalEventDefinition': 'intermediate-event-catch-condition',
  'bpmn:ErrorEventDefinition': 'intermediate-event-catch-error',
  'bpmn:EscalationEventDefinition': 'intermediate-event-catch-escalation',
  'bpmn:CompensateEventDefinition': 'intermediate-event-catch-compensation',
  'bpmn:LinkEventDefinition': 'intermediate-event-catch-link',
  'bpmn:CancelEventDefinition': 'intermediate-event-catch-cancel',
};

/**
 * Tipos que no están en ningún grupo de `gruposDeFiguras()` pero sí tienen icono propio en
 * `bpmn-font`: el flujo de secuencia, que no es una figura y por eso no vive en el catálogo (QA de
 * la ronda 1 de #392: antes se quedaba sin icono en la cabecera del panel). The task subtypes that
 * used to be here are palette figures since #456.
 */
const ICONO_SIN_FIGURA: Readonly<Record<string, string>> = {
  'bpmn:SequenceFlow': 'connection',
};

/**
 * Clase `bpmn-icon-*` de un `$type` BPMN, para quien necesita el mismo icono que la paleta sin
 * pintar la paleta entera (la cabecera de un elemento seleccionado en `PropertiesPanel.tsx`,
 * diseño 2d). El evento intermedio de captura y el de límite se resuelven a mano, porque su icono
 * depende de `eventDefinitionType` y no solo del `tipo` (el `find` de abajo solo mira el `tipo`,
 * así que sin este corte antes cogía siempre la primera figura del grupo para cualquier
 * definición). El resto toma la primera figura de su tipo, que es la «sin definición». Lo que no
 * está en ninguna rama se queda sin icono.
 */
export function iconoDeTipo(tipo: string, eventDefinitionType?: string): string | undefined {
  if (tipo === 'bpmn:IntermediateCatchEvent' || tipo === 'bpmn:BoundaryEvent') {
    return (eventDefinitionType !== undefined ? ICONO_POR_DEFINICION[eventDefinitionType] : undefined) ?? 'intermediate-event-none';
  }
  const sinFigura = ICONO_SIN_FIGURA[tipo];
  if (sinFigura !== undefined) return sinFigura;
  for (const grupo of gruposDeFiguras()) {
    const figura = grupo.figuras.find((f) => f.tipo === tipo);
    if (figura !== undefined) return figura.icono;
  }
  return undefined;
}

/** Compara sin acentos ni mayúsculas: «anotacion» encuentra «Anotación». */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Los grupos que quedan tras el filtro, sin los que se han quedado sin figuras. El nombre del
 * grupo también cuenta: quien escribe «compuerta» busca las cuatro, no ninguna.
 */
export function filtrar(grupos: readonly Grupo[], filtro: string): Grupo[] {
  const aguja = normalizar(filtro.trim());
  if (aguja === '') return [...grupos];
  return grupos
    .map((grupo) => normalizar(grupo.nombre).includes(aguja)
      ? grupo
      : { ...grupo, figuras: grupo.figuras.filter((f) => normalizar(f.nombre).includes(aguja)) })
    .filter((grupo) => grupo.figuras.length > 0);
}

/** La figura recién creada, tal cual la devuelve `elementFactory`. */
function nueva(servicios: Servicios, figura: Figura): unknown {
  const { tipo, eventDefinitionType, isExpanded, triggeredByEvent } = figura;
  // El pool tiene su propia fábrica: `createShape({ type: 'bpmn:Participant' })` no le cuelga el
  // proceso que lo hace un pool de verdad.
  if (tipo === 'bpmn:Participant') return servicios.elementFactory.createParticipantShape();
  return servicios.elementFactory.createShape({ type: tipo, eventDefinitionType, isExpanded, ...(triggeredByEvent === true ? { triggeredByEvent } : {}) });
}

/** What a boundary event can hang from: any task, a sub-process, a transaction, a call activity. */
const ACTIVIDAD = /^bpmn:(\w*Task|SubProcess|AdHocSubProcess|Transaction|CallActivity)$/;
/** Where `modeling.addLane` can add a lane: into a pool, or next to one of its lanes. */
const CONTENEDOR = /^bpmn:(Participant|Lane)$/;

/**
 * A stand-in boundary event for asking bpmn-js's `shape.attach` rule before anything is created:
 * the rule only reads the candidate's type (through `businessObject.$instanceOf`) and that it is
 * not a label. Creating a real shape per render would claim a new id in the model each time.
 */
const CANDIDATO_DE_BORDE = { type: 'bpmn:BoundaryEvent', businessObject: { $instanceOf: (tipo: string) => tipo === 'bpmn:BoundaryEvent' } };

/**
 * Where the next boundary event goes on `host`: its bottom edge, near the right corner, each
 * further one 40 px to the left of the previous.
 * ponytail: once the bottom edge is full the next one lands on the left corner and overlaps; the
 * way up is bpmn-js's `AttachSupport` placement, or dragging the item onto the activity.
 */
function puntoDeBorde(host: Caja): Punto {
  const previos = (host as { attachers?: unknown[] }).attachers?.length ?? 0;
  return { x: Math.max(host.x + 18, host.x + host.width - 20 - 40 * previos), y: host.y + host.height };
}

/**
 * The selected element a figure with `requiere` goes into (#456), or `null` when the selection
 * does not fit: nothing, several elements (`seleccion` is `null` then), the wrong type, or an
 * activity bpmn-js refuses to attach to (an event sub-process, a compensation activity…).
 */
export function anfitrion(servicios: Servicios, figura: Figura, seleccion: string | null): Caja & { type: string } | null {
  if (figura.requiere === undefined || seleccion === null) return null;
  const valido = figura.requiere === 'actividad' ? ACTIVIDAD : CONTENEDOR;
  const [elegido] = servicios.elementRegistry.filter((el) => el.id === seleccion && el.labelTarget === undefined);
  if (elegido === undefined || !valido.test(elegido.type ?? '')) return null;
  const host = elegido as Caja & { type: string };
  if (figura.requiere === 'actividad' &&
    servicios.rules.allowed('shape.attach', { shape: CANDIDATO_DE_BORDE, target: host, position: puntoDeBorde(host) }) !== 'attach') return null;
  return host;
}

interface Punto { x: number; y: number }

/** Centro de un elemento del diagrama, en coordenadas del propio diagrama. */
const centroDe = (caja: Caja): Punto => ({
  x: Math.round(caja.x + caja.width / 2),
  y: Math.round(caja.y + caja.height / 2),
});
interface Caja extends Punto { width: number; height: number }

/**
 * Dónde cae la figura: de quién cuelga y en qué punto. `modeling.createShape` no busca padre —mete
 * la figura en el que se le pase—, así que hay que preguntárselo a las reglas de bpmn-js. Con un
 * modelo de pools la raíz es una `bpmn:Collaboration`, que no tiene `flowElements`: colgarle una
 * tarea revienta el updater a mitad del comando y deja el modelo a medias.
 */
function sitio(servicios: Servicios, forma: unknown, centro: Punto): { target: unknown; punto: Punto } {
  const permite = (target: unknown, punto: Punto): boolean =>
    servicios.rules.allowed('shape.create', { shape: forma, target, position: punto }) === true;
  const cajas = servicios.elementRegistry
    .filter((el) => el.labelTarget === undefined && el.width !== undefined && el.height !== undefined)
    // Del más pequeño al más grande: un carril gana al pool que lo contiene.
    .sort((a, b) => a.width! * a.height! - b.width! * b.height!) as Caja[];

  const debajo = cajas.find((caja) =>
    caja.x <= centro.x && centro.x <= caja.x + caja.width &&
    caja.y <= centro.y && centro.y <= caja.y + caja.height && permite(caja, centro));
  if (debajo !== undefined) return { target: debajo, punto: centro };

  const raiz = servicios.canvas.getRootElement();
  if (permite(raiz, centro)) return { target: raiz, punto: centro };

  // Ni bajo el punto ni en la raíz: el centro visible cae fuera de todo pool (pasa siempre que el
  // lienzo es más alto que el diagrama). La figura va al centro del contenedor más grande que la
  // admita, que es lo único que la deja donde el usuario puede verla y no rompe el modelo.
  for (let i = cajas.length - 1; i >= 0; i--) {
    const punto = centroDe(cajas[i]!);
    if (permite(cajas[i], punto)) return { target: cajas[i], punto };
  }
  return { target: raiz, punto: centro };
}

/**
 * Inserta la figura en el centro de lo que se ve y deja el nombre en edición, que es lo que hace
 * el clic (o `Enter`) sobre un ítem. A figure with `requiere` goes into the selected element
 * instead (#456), and without a fitting selection nothing happens (the item is disabled then).
 */
export function insertar(servicios: Servicios, figura: Figura, seleccion: string | null = null): void {
  if (figura.requiere !== undefined) {
    insertarEnSeleccion(servicios, figura, seleccion);
    return;
  }
  const vista = servicios.canvas.viewbox();
  const forma = nueva(servicios, figura);
  const { target, punto } = sitio(servicios, forma, centroDe({ ...vista }));
  const creada = servicios.modeling.createShape(forma, punto, target);
  // La tercera rama de `sitio()` deja la figura en el centro de un contenedor que puede estar
  // fuera de la pantalla; sin esto el usuario pulsa, no ve nada aparecer y escribe el nombre a
  // ciegas. `scrollToElement` no mueve nada si la figura ya se ve.
  servicios.canvas.scrollToElement(creada);
  servicios.directEditing.activate(creada);
}

/**
 * A lane goes at the bottom of the selected pool (or below the selected lane), as bpmn-js's own
 * «Add lane below» does. A boundary event is attached on the bottom edge of the selected activity
 * (`puntoDeBorde`); `anfitrion` has already asked bpmn-js whether it may.
 */
function insertarEnSeleccion(servicios: Servicios, figura: Figura, seleccion: string | null): void {
  const host = anfitrion(servicios, figura, seleccion);
  if (host === null) return;
  if (figura.requiere === 'contenedor') {
    servicios.directEditing.activate(servicios.modeling.addLane(host as unknown as Parameters<Servicios['modeling']['addLane']>[0], 'bottom'));
    return;
  }
  servicios.directEditing.activate(servicios.modeling.createShape(nueva(servicios, figura), puntoDeBorde(host), host, { attach: true }));
}

interface Props {
  /** `null` mientras el lienzo no está montado: la paleta se pinta igual, pero inerte. */
  servicios: Servicios | null;
  /**
   * Icons-only mode. It lives in `App.tsx` (#406) because the left column divider snaps to it;
   * `App` also keeps it in `localStorage` under `lila.paleta`, as before.
   */
  compacta: boolean;
  onCompacta: () => void;
  /** Region id, for the `aria-controls` of the panel toggles (#412). */
  id?: string;
  /**
   * The canvas selection (one id, or `null`), for the boundary events and the lane (#456): they
   * go into the selected element, so they are enabled only while something fitting is selected.
   */
  seleccion?: string | null;
}

export function Paleta({ servicios, compacta, onCompacta, id, seleccion = null }: Props): React.JSX.Element {
  const S = useStrings();
  const [filtro, setFiltro] = useState('');
  const grupos = filtrar(gruposDeFiguras(), filtro);

  return (
    <div id={id} className={compacta ? 'paleta compacta' : 'paleta'}>
      <div className="paleta-filtro">
        {/* En compacto el campo no cabe: queda solo el botón, y filtrar es volver a la lista. */}
        {!compacta && (
          <label>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
            <input type="search" value={filtro} placeholder={S.paleta.filtrar} aria-label={S.paleta.filtrar} onChange={(e) => setFiltro(e.target.value)} />
          </label>
        )}
        <button type="button" className="boton icono" aria-pressed={compacta} title={compacta ? S.paleta.salirCompacto : S.paleta.entrarCompacto} aria-label={S.paleta.modoCompacto} onClick={onCompacta}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>
        </button>
      </div>
      <div className="paleta-grupos">
        {grupos.map((grupo) => (
          // `<details open>` es el grupo plegable entero: se abre con ratón y con teclado sin
          // una línea de estado en React. En compacto se fuerza abierto desde el CSS.
          <details key={grupo.nombre} open>
            <summary>{grupo.nombre}</summary>
            {grupo.figuras.map((figura) => {
              // Boundary events and lanes need a fitting selection (#456); the title says which.
              const falta = figura.requiere !== undefined && (servicios === null || anfitrion(servicios, figura, seleccion) === null);
              // A lane is only added by `modeling.addLane`: dragging it has no drop target.
              const arrastrable = figura.tipo !== 'bpmn:Lane';
              return (
                <button
                  key={`${figura.tipo}/${figura.nombre}`}
                  type="button"
                  className="figura"
                  // `draggable` + `dragstart` es la misma vía que usa la paleta de bpmn-js:
                  // `create.start` acepta el evento nativo y `dragging` toma el punto de ahí.
                  draggable={arrastrable}
                  title={!falta ? figura.nombre
                    : figura.requiere === 'actividad' ? S.paleta.requiereActividad(figura.nombre) : S.paleta.requiereContenedor(figura.nombre)}
                  disabled={servicios === null || falta}
                  onDragStart={(e) => { if (arrastrable) servicios?.create.start(e.nativeEvent, nueva(servicios, figura)); }}
                  onClick={() => { if (servicios !== null) insertar(servicios, figura, seleccion); }}
                >
                  <span className={`bpmn-icon-${figura.icono}`} aria-hidden="true" />
                  <span className="nombre">{figura.nombre}</span>
                  {arrastrable && <span className="pista" aria-hidden="true">{S.paleta.arrastrar}</span>}
                </button>
              );
            })}
          </details>
        ))}
        {grupos.length === 0 && <p className="vacio">{S.paleta.sinCoincidencias(filtro)}</p>}
      </div>
      <footer>{S.paleta.piePrefijo}<span>{S.paleta.pieTecla}</span>{S.paleta.pieSufijo}</footer>
    </div>
  );
}
