/**
 * Panel de propiedades propio (LILA-060). Dos pestañas del panel derecho:
 *
 * - **Propiedades**: nombre (editable), tipo e id (solo lectura).
 * - **Documentación**: `bpmn:documentation` y los elementos `lila:` de `docs/BPMN_EXTENSION.md`
 *   (`responsibility` con su RACI, y `systemRef`, `documentRef`, `riskRef`, `controlRef`,
 *   `kpiRef`, `input` y `output`, todos multivalor).
 *
 * No hay diálogos: se edita en vivo y cada cambio pasa por `modeling`, así que el `commandStack`
 * de bpmn-js lo apila y Cmd+Z lo deshace.
 *
 * Aquí no se toca XML. `packages/engine/src/bpmn/annotate.ts` escribe lo mismo sobre el XML como
 * cadena (para la CLI); este panel escribe sobre el moddle vivo que bpmn-js tiene en memoria, y
 * el XML sale luego de `saveXML`. Las reglas son las mismas: los `extensionElements` ajenos
 * (`bizagi:`, `bpsim:`, …) se conservan intactos y solo se tocan los `lila:`.
 *
 * Las funciones que escriben en el moddle están fuera del componente y no dependen de React ni
 * de bpmn-js: por eso `propiedades.test.ts` puede ejercitarlas con bpmn-moddle a secas.
 *
 * Los literales van escritos donde se usan: `strings.es.ts` es LILA-066.
 */
import { useEffect, useReducer, useState } from 'react';
import type { Modelador } from './Modeler';

/* ------------------------------------------------------------------ *
 * Modelo: lo mínimo de bpmn-js que hace falta para leer y escribir.
 * ------------------------------------------------------------------ */

/** Un elemento del moddle (el `businessObject` de una figura, o un hijo suyo). */
export interface ElementoModdle {
  $type: string;
  $parent?: unknown;
  $descriptor?: { propertiesByName?: Record<string, unknown> };
  id?: string;
  name?: string;
  text?: string;
  /** `lila:responsibility`. */
  type?: string;
  /** `lila:responsibility`. */
  roleRef?: string;
  /** `lila:systemRef` y compañía. */
  ref?: string;
  documentation?: ElementoModdle[];
  extensionElements?: ElementoModdle;
  values?: ElementoModdle[];
}

/** Una figura o conexión del lienzo. */
export interface ElementoLienzo {
  id: string;
  type: string;
  businessObject: ElementoModdle;
}

/**
 * Los dos servicios de bpmn-js que se usan para escribir, en su forma mínima. El tipo es
 * estructural a propósito: el test los sustituye por bpmn-moddle, que hace lo mismo sin el
 * `commandStack` ni el repintado.
 */
export interface Escritor {
  modeling: {
    updateProperties(elemento: ElementoLienzo, propiedades: Record<string, unknown>): void;
    updateModdleProperties(
      elemento: ElementoLienzo,
      moddle: ElementoModdle,
      propiedades: Record<string, unknown>,
    ): void;
  };
  bpmnFactory: {
    create(tipo: string, atributos?: Record<string, unknown>): ElementoModdle;
  };
}

/* ------------------------------------------------------------------ *
 * Escritura sobre el moddle. Sin React, sin bpmn-js.
 * ------------------------------------------------------------------ */

/**
 * Devuelve el `bpmn:extensionElements` del elemento, creándolo si no lo tenía. Nunca sustituye
 * uno existente: lo que ya hubiera dentro (incluidas las extensiones ajenas) se queda.
 */
function extensiones(escritor: Escritor, elemento: ElementoLienzo): ElementoModdle {
  const bo = elemento.businessObject;
  const existente = bo.extensionElements;
  if (existente !== undefined) return existente;

  const nuevo = escritor.bpmnFactory.create('bpmn:ExtensionElements', { values: [] });
  nuevo.$parent = bo;
  escritor.modeling.updateModdleProperties(elemento, bo, { extensionElements: nuevo });
  return nuevo;
}

/** Los hijos de `extensionElements` de ese tipo, en el orden del archivo. */
export function leerExtensiones(elemento: ElementoLienzo, tipo: string): ElementoModdle[] {
  const valores = elemento.businessObject.extensionElements?.values ?? [];
  return valores.filter((v) => v.$type === tipo);
}

/** Añade un `lila:*` al final de `extensionElements`. */
export function anadirExtension(
  escritor: Escritor,
  elemento: ElementoLienzo,
  tipo: string,
  atributos: Record<string, unknown>,
): ElementoModdle {
  const ext = extensiones(escritor, elemento);
  const hijo = escritor.bpmnFactory.create(tipo, atributos);
  hijo.$parent = ext;
  escritor.modeling.updateModdleProperties(elemento, ext, {
    values: [...(ext.values ?? []), hijo],
  });
  return hijo;
}

/** Quita un `lila:*`. El resto de `extensionElements` no se toca. */
export function quitarExtension(
  escritor: Escritor,
  elemento: ElementoLienzo,
  hijo: ElementoModdle,
): void {
  const ext = elemento.businessObject.extensionElements;
  if (ext === undefined) return;
  escritor.modeling.updateModdleProperties(elemento, ext, {
    values: (ext.values ?? []).filter((v) => v !== hijo),
  });
}

/** Cambia atributos de un `lila:*` que ya está puesto. */
export function editarExtension(
  escritor: Escritor,
  elemento: ElementoLienzo,
  hijo: ElementoModdle,
  atributos: Record<string, unknown>,
): void {
  escritor.modeling.updateModdleProperties(elemento, hijo, atributos);
}

/**
 * BPMN admite varios `bpmn:documentation` por elemento; se leen todos, en orden, igual que hace
 * `readAnnotations` del motor.
 */
export function leerDocumentacion(elemento: ElementoLienzo): string {
  return (elemento.businessObject.documentation ?? [])
    .map((doc) => doc.text ?? '')
    .filter((t) => t !== '')
    .join('\n');
}

/**
 * Escribe la documentación como un solo hijo. Si ya había exactamente uno se reescribe su texto
 * en vez de añadir otro —eso es lo que garantiza que no se dupliquen—; si había varios, se
 * colapsan en uno, que es lo mismo que hace `annotateElement`. La cadena vacía la borra.
 */
export function escribirDocumentacion(
  escritor: Escritor,
  elemento: ElementoLienzo,
  texto: string,
): void {
  const bo = elemento.businessObject;
  const previas = bo.documentation ?? [];
  const [primera] = previas;

  if (texto === '') {
    escritor.modeling.updateProperties(elemento, { documentation: [] });
    return;
  }
  if (previas.length === 1 && primera !== undefined) {
    escritor.modeling.updateModdleProperties(elemento, primera, { text: texto });
    return;
  }
  const doc = escritor.bpmnFactory.create('bpmn:Documentation', { text: texto });
  doc.$parent = bo;
  escritor.modeling.updateProperties(elemento, { documentation: [doc] });
}

/** Cambia el `name`, que es una propiedad BPMN normal y no una extensión. */
export function escribirNombre(
  escritor: Escritor,
  elemento: ElementoLienzo,
  nombre: string,
): void {
  escritor.modeling.updateProperties(elemento, { name: nombre });
}

/* ------------------------------------------------------------------ *
 * Etiquetas.
 * ------------------------------------------------------------------ */

/** Tipos RACI de `lila:responsibility` (`docs/BPMN_EXTENSION.md` § 2). */
export const RACI = [
  ['R', 'R · Responsable'],
  ['A', 'A · Aprueba'],
  ['C', 'C · Consultado'],
  ['I', 'I · Informado'],
] as const;

/**
 * Los `lila:*Ref` que son una referencia suelta al catálogo, con su etiqueta y el texto de
 * ayuda del campo. El selector desde el catálogo es LILA-093; aquí el id se escribe a mano.
 */
export const REFERENCIAS = [
  ['lila:SystemRef', 'Sistemas', 'id del sistema'],
  ['lila:DocumentRef', 'Documentos', 'id del documento'],
  ['lila:RiskRef', 'Riesgos', 'id del riesgo'],
  ['lila:ControlRef', 'Controles', 'id del control'],
  ['lila:KpiRef', 'KPIs', 'id del indicador'],
  ['lila:Input', 'Entradas', 'id de la entrada'],
  ['lila:Output', 'Salidas', 'id de la salida'],
] as const;

const NOMBRES_DE_TIPO: Record<string, string> = {
  'bpmn:Task': 'Tarea',
  'bpmn:UserTask': 'Tarea de usuario',
  'bpmn:ManualTask': 'Tarea manual',
  'bpmn:ServiceTask': 'Tarea de servicio',
  'bpmn:ScriptTask': 'Tarea de script',
  'bpmn:SendTask': 'Tarea de envío',
  'bpmn:ReceiveTask': 'Tarea de recepción',
  'bpmn:BusinessRuleTask': 'Tarea de regla de negocio',
  'bpmn:CallActivity': 'Actividad de llamada',
  'bpmn:SubProcess': 'Subproceso',
  'bpmn:StartEvent': 'Evento de inicio',
  'bpmn:EndEvent': 'Evento de fin',
  'bpmn:IntermediateCatchEvent': 'Evento intermedio de captura',
  'bpmn:IntermediateThrowEvent': 'Evento intermedio de lanzamiento',
  'bpmn:BoundaryEvent': 'Evento de borde',
  'bpmn:ExclusiveGateway': 'Compuerta exclusiva (XOR)',
  'bpmn:ParallelGateway': 'Compuerta paralela (AND)',
  'bpmn:InclusiveGateway': 'Compuerta inclusiva (OR)',
  'bpmn:EventBasedGateway': 'Compuerta basada en eventos',
  'bpmn:ComplexGateway': 'Compuerta compleja',
  'bpmn:SequenceFlow': 'Flujo de secuencia',
  'bpmn:MessageFlow': 'Flujo de mensaje',
  'bpmn:Association': 'Asociación',
  'bpmn:DataObjectReference': 'Objeto de datos',
  'bpmn:DataStoreReference': 'Almacén de datos',
  'bpmn:TextAnnotation': 'Anotación de texto',
  'bpmn:Group': 'Grupo',
  'bpmn:Participant': 'Pool',
  'bpmn:Lane': 'Carril',
  'bpmn:Process': 'Proceso',
  'bpmn:Collaboration': 'Colaboración',
};

/** Nombre legible en español del `$type`; si no está en la tabla, el tipo sin el prefijo. */
export function nombreDeTipo(tipo: string): string {
  return NOMBRES_DE_TIPO[tipo] ?? tipo.replace(/^bpmn:/, '');
}

/* ------------------------------------------------------------------ *
 * Componente.
 * ------------------------------------------------------------------ */

interface Props {
  /** `null` mientras el lienzo no ha terminado de montarse. */
  modelador: Modelador | null;
  pestana: 'Propiedades' | 'Documentación';
}

export function PanelPropiedades({ modelador, pestana }: Props): React.JSX.Element {
  const [seleccion, setSeleccion] = useState<ElementoLienzo[]>([]);
  // El moddle no es estado de React: se lee en cada render. Este contador es lo que fuerza a
  // releerlo cuando algo cambia, venga del panel o del lienzo.
  const [, refrescar] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (modelador === null) return;
    const { selection } = modelador.servicios;
    const leerSeleccion = (): void => {
      setSeleccion(selection.get() as ElementoLienzo[]);
    };

    // Al montar puede haber ya algo seleccionado: `selection.changed` solo avisa de los cambios.
    leerSeleccion();
    const desuscribir = [
      modelador.suscribir(['selection.changed'], leerSeleccion),
      // Deshacer, edición directa en el lienzo o un import nuevo cambian el moddle por fuera
      // del panel; sin esto los campos seguirían enseñando lo anterior.
      modelador.suscribir(['element.changed', 'elements.changed', 'import.done'], refrescar),
    ];
    return () => {
      for (const off of desuscribir) off();
    };
  }, [modelador]);

  const elemento = seleccion.length === 1 ? seleccion[0] : undefined;

  if (modelador === null || elemento === undefined) {
    return (
      <p className="vacio">
        {seleccion.length > 1
          ? `${seleccion.length} elementos seleccionados: las acciones sobre varios a la vez` +
            ' todavía no están. Selecciona uno solo para editarlo.'
          : 'Selecciona un elemento del lienzo para ver sus propiedades.'}
      </p>
    );
  }

  return pestana === 'Propiedades' ? (
    <Propiedades elemento={elemento} escritor={modelador.servicios} refrescar={refrescar} />
  ) : (
    <Documentacion elemento={elemento} escritor={modelador.servicios} refrescar={refrescar} />
  );
}

interface PropsPestana {
  elemento: ElementoLienzo;
  escritor: Escritor;
  refrescar: () => void;
}

function Propiedades({ elemento, escritor, refrescar }: PropsPestana): React.JSX.Element {
  const [copiado, setCopiado] = useState(false);
  const bo = elemento.businessObject;
  // `bpmn:association` y algún artefacto más no tienen atributo `name`: escribírselo produciría
  // un XML que no valida contra el esquema BPMN.
  const admiteNombre = bo.$descriptor?.propertiesByName?.name !== undefined;

  return (
    <div className="campos">
      <label className="campo">
        <span>Nombre</span>
        <input
          type="text"
          value={bo.name ?? ''}
          disabled={!admiteNombre}
          placeholder={admiteNombre ? 'Sin nombre' : 'Este tipo no tiene nombre'}
          onChange={(e) => {
            // ponytail: una entrada del `commandStack` por pulsación, así que Cmd+Z deshace
            // letra a letra. Es lo que hace el panel de bpmn-js. Agrupar las pulsaciones
            // seguidas en un solo comando es un ticket propio si llega a molestar.
            escribirNombre(escritor, elemento, e.target.value);
            refrescar();
          }}
        />
      </label>

      <div className="campo">
        <span>Tipo</span>
        <output>{nombreDeTipo(elemento.type)}</output>
      </div>

      <div className="campo">
        <span>Id</span>
        <div className="fila">
          <output className="mono">{elemento.id}</output>
          <button
            type="button"
            className="boton"
            onClick={() => {
              void navigator.clipboard.writeText(elemento.id).then(() => {
                setCopiado(true);
                setTimeout(() => {
                  setCopiado(false);
                }, 1200);
              });
            }}
          >
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Documentacion({ elemento, escritor, refrescar }: PropsPestana): React.JSX.Element {
  const responsabilidades = leerExtensiones(elemento, 'lila:Responsibility');

  return (
    <div className="campos">
      <label className="campo">
        <span>Descripción</span>
        <textarea
          rows={5}
          value={leerDocumentacion(elemento)}
          placeholder="Para qué sirve este elemento"
          onChange={(e) => {
            escribirDocumentacion(escritor, elemento, e.target.value);
            refrescar();
          }}
        />
      </label>

      <section className="grupo">
        <h3>Responsabilidades</h3>
        {responsabilidades.map((responsabilidad, i) => (
          // El moddle no da una clave estable y el orden de la lista sí lo es: el índice vale.
          <div className="fila" key={i}>
            <select
              aria-label="Tipo de responsabilidad"
              value={responsabilidad.type ?? 'R'}
              onChange={(e) => {
                editarExtension(escritor, elemento, responsabilidad, { type: e.target.value });
                refrescar();
              }}
            >
              {RACI.map(([valor, etiqueta]) => (
                <option key={valor} value={valor}>
                  {etiqueta}
                </option>
              ))}
            </select>
            <input
              type="text"
              aria-label="Rol"
              placeholder="id del rol"
              value={responsabilidad.roleRef ?? ''}
              onChange={(e) => {
                editarExtension(escritor, elemento, responsabilidad, { roleRef: e.target.value });
                refrescar();
              }}
            />
            <button
              type="button"
              className="quitar"
              title="Quitar responsabilidad"
              aria-label="Quitar responsabilidad"
              onClick={() => {
                quitarExtension(escritor, elemento, responsabilidad);
                refrescar();
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="anadir"
          onClick={() => {
            anadirExtension(escritor, elemento, 'lila:Responsibility', { type: 'R', roleRef: '' });
            refrescar();
          }}
        >
          + Añadir responsabilidad
        </button>
      </section>

      {REFERENCIAS.map(([tipo, etiqueta, ayuda]) => (
        <ListaDeReferencias
          key={tipo}
          tipo={tipo}
          etiqueta={etiqueta}
          ayuda={ayuda}
          elemento={elemento}
          escritor={escritor}
          refrescar={refrescar}
        />
      ))}
    </div>
  );
}

function ListaDeReferencias({
  tipo,
  etiqueta,
  ayuda,
  elemento,
  escritor,
  refrescar,
}: PropsPestana & { tipo: string; etiqueta: string; ayuda: string }): React.JSX.Element {
  const referencias = leerExtensiones(elemento, tipo);

  return (
    <section className="grupo">
      <h3>{etiqueta}</h3>
      {referencias.map((referencia, i) => (
        <div className="fila" key={i}>
          <input
            type="text"
            aria-label={etiqueta}
            placeholder={ayuda}
            value={referencia.ref ?? ''}
            onChange={(e) => {
              editarExtension(escritor, elemento, referencia, { ref: e.target.value });
              refrescar();
            }}
          />
          <button
            type="button"
            className="quitar"
            title={`Quitar de ${etiqueta.toLowerCase()}`}
            aria-label={`Quitar de ${etiqueta.toLowerCase()}`}
            onClick={() => {
              quitarExtension(escritor, elemento, referencia);
              refrescar();
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="anadir"
        aria-label={`Añadir a ${etiqueta}`}
        onClick={() => {
          anadirExtension(escritor, elemento, tipo, { ref: '' });
          refrescar();
        }}
      >
        + Añadir
      </button>
    </section>
  );
}
