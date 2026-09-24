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
}

interface Grupo {
  readonly nombre: string;
  readonly figuras: readonly Figura[];
}

/**
 * Los grupos y su orden son los del artboard. La lista es estática a propósito: el catálogo BPMN
 * no cambia entre sesiones y sacarlo de `elementFactory` costaría más que escribirlo.
 * ponytail: los carriles no están porque se añaden desde el context pad de un pool, que es donde
 * bpmn-js sabe dónde meterlos; techo: si hiciera falta, un ítem que llame a `modeling.addLane`.
 */
export function gruposDeFiguras(): readonly Grupo[] {
  const S = strings();
  return [
    {
      nombre: S.paleta.grupos.eventos,
      figuras: [
        { tipo: 'bpmn:StartEvent', nombre: S.paleta.figuras.inicio, icono: 'start-event-none' },
        { tipo: 'bpmn:IntermediateThrowEvent', nombre: S.paleta.figuras.intermedio, icono: 'intermediate-event-none' },
        { tipo: 'bpmn:EndEvent', nombre: S.paleta.figuras.fin, icono: 'end-event-none' },
        { tipo: 'bpmn:StartEvent', nombre: S.paleta.figuras.mensaje, icono: 'start-event-message', eventDefinitionType: 'bpmn:MessageEventDefinition' },
        { tipo: 'bpmn:IntermediateCatchEvent', nombre: S.paleta.figuras.temporizador, icono: 'intermediate-event-catch-timer', eventDefinitionType: 'bpmn:TimerEventDefinition' },
      ],
    },
    {
      nombre: S.paleta.grupos.actividades,
      figuras: [
        { tipo: 'bpmn:Task', nombre: S.paleta.figuras.tarea, icono: 'task' },
        { tipo: 'bpmn:UserTask', nombre: S.paleta.figuras.tareaUsuario, icono: 'user-task' },
        { tipo: 'bpmn:ServiceTask', nombre: S.paleta.figuras.tareaServicio, icono: 'service-task' },
        { tipo: 'bpmn:SubProcess', nombre: S.paleta.figuras.subproceso, icono: 'subprocess-expanded', isExpanded: true },
        { tipo: 'bpmn:CallActivity', nombre: S.paleta.figuras.actividadLlamada, icono: 'call-activity' },
      ],
    },
    {
      nombre: S.paleta.grupos.compuertas,
      figuras: [
        { tipo: 'bpmn:ExclusiveGateway', nombre: S.paleta.figuras.exclusiva, icono: 'gateway-xor' },
        { tipo: 'bpmn:ParallelGateway', nombre: S.paleta.figuras.paralela, icono: 'gateway-parallel' },
        { tipo: 'bpmn:InclusiveGateway', nombre: S.paleta.figuras.inclusiva, icono: 'gateway-or' },
        { tipo: 'bpmn:EventBasedGateway', nombre: S.paleta.figuras.basadaEnEventos, icono: 'gateway-eventbased' },
      ],
    },
    {
      nombre: S.paleta.grupos.datos,
      figuras: [
        { tipo: 'bpmn:DataObjectReference', nombre: S.paleta.figuras.objetoDeDatos, icono: 'data-object' },
        { tipo: 'bpmn:DataStoreReference', nombre: S.paleta.figuras.almacenDeDatos, icono: 'data-store' },
      ],
    },
    {
      nombre: S.paleta.grupos.artefactos,
      figuras: [
        { tipo: 'bpmn:TextAnnotation', nombre: S.paleta.figuras.anotacion, icono: 'text-annotation' },
        { tipo: 'bpmn:Group', nombre: S.paleta.figuras.grupo, icono: 'group' },
      ],
    },
    {
      nombre: S.paleta.grupos.poolsYCarriles,
      figuras: [{ tipo: 'bpmn:Participant', nombre: S.paleta.figuras.pool, icono: 'participant' }],
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
 * Tipos que no están en ningún grupo de `gruposDeFiguras()` —el catálogo no ofrece crearlos
 * directamente— pero sí tienen icono propio en `bpmn-font`: los subtipos de tarea que faltaban
 * (manual, script, mensaje…) y el flujo de secuencia, que no es una figura y por eso no vive en
 * el catálogo (QA de la ronda 1 de #392: antes se quedaban sin icono en la cabecera del panel).
 */
const ICONO_SIN_FIGURA: Readonly<Record<string, string>> = {
  'bpmn:ManualTask': 'manual-task',
  'bpmn:ScriptTask': 'script-task',
  'bpmn:SendTask': 'send-task',
  'bpmn:ReceiveTask': 'receive-task',
  'bpmn:BusinessRuleTask': 'business-rule-task',
  'bpmn:SequenceFlow': 'connection',
};

/**
 * Clase `bpmn-icon-*` de un `$type` BPMN, para quien necesita el mismo icono que la paleta sin
 * pintar la paleta entera (la cabecera de un elemento seleccionado en `PropertiesPanel.tsx`,
 * diseño 2d). `bpmn:Lane` no es una figura de la paleta —un carril se añade desde el context pad
 * de un pool—, así que se resuelve a mano, igual que el evento intermedio de captura y el de
 * límite, cuyo icono depende de `eventDefinitionType` y no solo del `tipo` (el `find` de abajo
 * solo mira el `tipo`, así que sin este corte antes cogía siempre la primera figura del grupo
 * —temporizador— para cualquier definición). Lo que no está en ninguna rama se queda sin icono.
 */
export function iconoDeTipo(tipo: string, eventDefinitionType?: string): string | undefined {
  if (tipo === 'bpmn:Lane') return 'lane';
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
  const { tipo, eventDefinitionType, isExpanded } = figura;
  // El pool tiene su propia fábrica: `createShape({ type: 'bpmn:Participant' })` no le cuelga el
  // proceso que lo hace un pool de verdad.
  if (tipo === 'bpmn:Participant') return servicios.elementFactory.createParticipantShape();
  return servicios.elementFactory.createShape({ type: tipo, eventDefinitionType, isExpanded });
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
 * el clic (o `Enter`) sobre un ítem.
 */
export function insertar(servicios: Servicios, figura: Figura): void {
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
}

export function Paleta({ servicios, compacta, onCompacta, id }: Props): React.JSX.Element {
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
            {grupo.figuras.map((figura) => (
              <button
                key={`${figura.tipo}/${figura.nombre}`}
                type="button"
                className="figura"
                // `draggable` + `dragstart` es la misma vía que usa la paleta de bpmn-js:
                // `create.start` acepta el evento nativo y `dragging` toma el punto de ahí.
                draggable
                title={figura.nombre}
                disabled={servicios === null}
                onDragStart={(e) => servicios?.create.start(e.nativeEvent, nueva(servicios, figura))}
                onClick={() => { if (servicios !== null) insertar(servicios, figura); }}
              >
                <span className={`bpmn-icon-${figura.icono}`} aria-hidden="true" />
                <span className="nombre">{figura.nombre}</span>
                <span className="pista" aria-hidden="true">{S.paleta.arrastrar}</span>
              </button>
            ))}
          </details>
        ))}
        {grupos.length === 0 && <p className="vacio">{S.paleta.sinCoincidencias(filtro)}</p>}
      </div>
      <footer>{S.paleta.piePrefijo}<span>{S.paleta.pieTecla}</span>{S.paleta.pieSufijo}</footer>
    </div>
  );
}
