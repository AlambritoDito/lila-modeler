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
export const GRUPOS: readonly Grupo[] = [
  {
    nombre: 'Eventos',
    figuras: [
      { tipo: 'bpmn:StartEvent', nombre: 'Inicio', icono: 'start-event-none' },
      { tipo: 'bpmn:IntermediateThrowEvent', nombre: 'Intermedio', icono: 'intermediate-event-none' },
      { tipo: 'bpmn:EndEvent', nombre: 'Fin', icono: 'end-event-none' },
      { tipo: 'bpmn:StartEvent', nombre: 'Mensaje', icono: 'start-event-message', eventDefinitionType: 'bpmn:MessageEventDefinition' },
      { tipo: 'bpmn:IntermediateCatchEvent', nombre: 'Temporizador', icono: 'intermediate-event-catch-timer', eventDefinitionType: 'bpmn:TimerEventDefinition' },
    ],
  },
  {
    nombre: 'Actividades',
    figuras: [
      { tipo: 'bpmn:Task', nombre: 'Tarea', icono: 'task' },
      { tipo: 'bpmn:UserTask', nombre: 'Tarea de usuario', icono: 'user-task' },
      { tipo: 'bpmn:ServiceTask', nombre: 'Tarea de servicio', icono: 'service-task' },
      { tipo: 'bpmn:SubProcess', nombre: 'Subproceso', icono: 'subprocess-expanded', isExpanded: true },
      { tipo: 'bpmn:CallActivity', nombre: 'Actividad de llamada', icono: 'call-activity' },
    ],
  },
  {
    nombre: 'Compuertas',
    figuras: [
      { tipo: 'bpmn:ExclusiveGateway', nombre: 'Exclusiva', icono: 'gateway-xor' },
      { tipo: 'bpmn:ParallelGateway', nombre: 'Paralela', icono: 'gateway-parallel' },
      { tipo: 'bpmn:InclusiveGateway', nombre: 'Inclusiva', icono: 'gateway-or' },
      { tipo: 'bpmn:EventBasedGateway', nombre: 'Basada en eventos', icono: 'gateway-eventbased' },
    ],
  },
  {
    nombre: 'Datos',
    figuras: [
      { tipo: 'bpmn:DataObjectReference', nombre: 'Objeto de datos', icono: 'data-object' },
      { tipo: 'bpmn:DataStoreReference', nombre: 'Almacén de datos', icono: 'data-store' },
    ],
  },
  {
    nombre: 'Artefactos',
    figuras: [
      { tipo: 'bpmn:TextAnnotation', nombre: 'Anotación', icono: 'text-annotation' },
      { tipo: 'bpmn:Group', nombre: 'Grupo', icono: 'group' },
    ],
  },
  {
    nombre: 'Pools y carriles',
    figuras: [{ tipo: 'bpmn:Participant', nombre: 'Pool', icono: 'participant' }],
  },
];

/** Compara sin acentos ni mayúsculas: «anotacion» encuentra «Anotación». */
function normalizar(texto: string): string {
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
  servicios.directEditing.activate(servicios.modeling.createShape(forma, punto, target));
}

interface Props {
  /** `null` mientras el lienzo no está montado: la paleta se pinta igual, pero inerte. */
  servicios: Servicios | null;
}

/** Clave de `localStorage` del modo compacto; el resto de preferencias viven en `App.tsx`. */
const CLAVE = 'lila.paleta';

export function Paleta({ servicios }: Props): React.JSX.Element {
  const [filtro, setFiltro] = useState('');
  const [compacta, setCompacta] = useState(() => {
    try { return localStorage.getItem(CLAVE) === 'compacta'; } catch { return false; }
  });
  const grupos = filtrar(GRUPOS, filtro);

  function cambiarCompacta(): void {
    setCompacta((antes) => {
      try { localStorage.setItem(CLAVE, antes ? 'normal' : 'compacta'); } catch { /* modo privado: no persiste, no rompe */ }
      return !antes;
    });
  }

  return (
    <div className={compacta ? 'paleta compacta' : 'paleta'}>
      <div className="paleta-filtro">
        {/* En compacto el campo no cabe: queda solo el botón, y filtrar es volver a la lista. */}
        {!compacta && (
          <label>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></svg>
            <input type="search" value={filtro} placeholder="Filtrar figuras" aria-label="Filtrar figuras" onChange={(e) => setFiltro(e.target.value)} />
          </label>
        )}
        <button type="button" className="boton icono" aria-pressed={compacta} title={compacta ? 'Salir del modo compacto' : 'Modo compacto (solo iconos)'} aria-label="Modo compacto" onClick={cambiarCompacta}>
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
                <span className="pista">arrastrar</span>
              </button>
            ))}
          </details>
        ))}
        {grupos.length === 0 && <p className="vacio">Ninguna figura coincide con «{filtro}».</p>}
      </div>
      <footer>Arrastra al lienzo o pulsa <span>Enter</span> para insertar</footer>
    </div>
  );
}
