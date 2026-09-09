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
import { strings, useStrings } from './i18n';
import type { PestanaId } from './ids';
import type { Strings } from './strings.types';

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
  /** `lila:versionTag`. */
  value?: string;
  /** Proceso ejecutado por un `bpmn:Participant`. */
  processRef?: ElementoModdle;
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
function normalizarReferencias(atributos: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(atributos).map(([nombre, valor]) => [
      nombre,
      (nombre === 'ref' || nombre === 'roleRef') && typeof valor === 'string'
        ? valor.trim()
        : valor,
    ]),
  );
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
  const bo = elemento.businessObject;
  const hijo = escritor.bpmnFactory.create(tipo, normalizarReferencias(atributos));
  const existente = bo.extensionElements;
  if (existente === undefined) {
    // Crear contenedor e hijo antes del único comando evita que un undo deje un
    // `extensionElements` vacío al deshacer la primera extensión.
    const nuevo = escritor.bpmnFactory.create('bpmn:ExtensionElements', { values: [hijo] });
    nuevo.$parent = bo;
    hijo.$parent = nuevo;
    escritor.modeling.updateModdleProperties(elemento, bo, { extensionElements: nuevo });
    return hijo;
  }

  const ext = existente;
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
  escritor.modeling.updateModdleProperties(
    elemento,
    hijo,
    normalizarReferencias(atributos),
  );
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

/** `bpmn:TextAnnotation` usa `text`, no la propiedad `name` de los flow nodes. */
export function escribirTextoAnotacion(
  escritor: Escritor,
  elemento: ElementoLienzo,
  texto: string,
): void {
  escritor.modeling.updateProperties(elemento, { text: texto });
}

/** Proceso seleccionado directamente o asociado al pool seleccionado. */
export function procesoRelacionado(elemento: ElementoLienzo): ElementoLienzo | undefined {
  if (elemento.businessObject.$type === 'bpmn:Process') return elemento;
  const processRef = elemento.businessObject.processRef;
  if (elemento.businessObject.$type !== 'bpmn:Participant' || processRef?.id === undefined) {
    return undefined;
  }
  return { id: processRef.id, type: processRef.$type, businessObject: processRef };
}

export function leerVersionTag(elemento: ElementoLienzo): string {
  return leerExtensiones(elemento, 'lila:VersionTag')[0]?.value ?? '';
}

export function escribirVersionTag(
  escritor: Escritor,
  proceso: ElementoLienzo,
  value: string,
): void {
  const [existente] = leerExtensiones(proceso, 'lila:VersionTag');
  const limpio = value.trim();
  if (limpio === '') {
    if (existente !== undefined) quitarExtension(escritor, proceso, existente);
    return;
  }
  if (existente === undefined) {
    anadirExtension(escritor, proceso, 'lila:VersionTag', { value: limpio });
  } else {
    editarExtension(escritor, proceso, existente, { value: limpio });
  }
}

/* ------------------------------------------------------------------ *
 * Etiquetas.
 * ------------------------------------------------------------------ */

/** Tipos RACI de `lila:responsibility` (`docs/BPMN_EXTENSION.md` § 2), en el idioma activo. */
export const raci = (): Strings['propiedades']['raci'] => strings().propiedades.raci;

/**
 * Los `lila:*Ref` que son una referencia suelta al catálogo, con su etiqueta y el texto de
 * ayuda del campo. El selector desde el catálogo es LILA-093; aquí el id se escribe a mano.
 */
export const referencias = (): Strings['propiedades']['referencias'] => strings().propiedades.referencias;

/** Nombre legible del `$type` en el idioma activo; si no está en la tabla, el tipo sin el prefijo. */
export function nombreDeTipo(tipo: string): string {
  return strings().propiedades.tipos[tipo] ?? tipo.replace(/^bpmn:/, '');
}

/* ------------------------------------------------------------------ *
 * Componente.
 * ------------------------------------------------------------------ */

interface Props {
  /** `null` mientras el lienzo no ha terminado de montarse. */
  modelador: Modelador | null;
  pestana: Exclude<PestanaId, 'simulacion'>;
}

export function PanelPropiedades({ modelador, pestana }: Props): React.JSX.Element {
  const S = useStrings();
  const [seleccion, setSeleccion] = useState<ElementoLienzo[]>([]);
  // El moddle no es estado de React: se lee en cada render. Este contador es lo que fuerza a
  // releerlo cuando algo cambia, venga del panel o del lienzo.
  const [, refrescar] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (modelador === null) return;
    const leerSeleccion = (): void => {
      const elegidos = modelador.servicios.selection.get() as ElementoLienzo[];
      const raiz = modelador.servicios.rootElement?.() as ElementoLienzo | undefined;
      setSeleccion(
        elegidos.length === 0 && raiz?.businessObject.$type === 'bpmn:Process'
          ? [raiz]
          : elegidos,
      );
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
          ? S.propiedades.variosSeleccionados(seleccion.length)
          : S.propiedades.sinSeleccion}
      </p>
    );
  }

  return pestana === 'propiedades' ? (
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
  const S = useStrings();
  const [copiado, setCopiado] = useState(false);
  const bo = elemento.businessObject;
  // `bpmn:association` y algún artefacto más no tienen atributo `name`: escribírselo produciría
  // un XML que no valida contra el esquema BPMN.
  const admiteNombre = bo.$descriptor?.propertiesByName?.name !== undefined;
  const esAnotacion = bo.$type === 'bpmn:TextAnnotation';
  const proceso = procesoRelacionado(elemento);

  return (
    <div className="campos">
      {esAnotacion ? (
        <label className="campo">
          <span>{S.propiedades.textoAnotacion}</span>
          <textarea
            aria-label={S.propiedades.textoAnotacion}
            rows={4}
            value={bo.text ?? ''}
            onChange={(e) => {
              escribirTextoAnotacion(escritor, elemento, e.target.value);
              refrescar();
            }}
          />
        </label>
      ) : (
        <label className="campo">
          <span>{S.propiedades.nombre}</span>
          <input
            type="text"
            value={bo.name ?? ''}
            disabled={!admiteNombre}
            placeholder={admiteNombre ? S.propiedades.sinNombre : S.propiedades.tipoSinNombre}
            onChange={(e) => {
              // ponytail: una entrada del `commandStack` por pulsación, así que Cmd+Z deshace
              // letra a letra. Es lo que hace el panel de bpmn-js. Agrupar las pulsaciones
              // seguidas en un solo comando es un ticket propio si llega a molestar.
              escribirNombre(escritor, elemento, e.target.value);
              refrescar();
            }}
          />
        </label>
      )}

      {proceso !== undefined && proceso !== elemento && (
        <label className="campo">
          <span>{S.propiedades.nombreProceso}</span>
          <input
            type="text"
            aria-label={S.propiedades.nombreProceso}
            value={proceso.businessObject.name ?? ''}
            onChange={(e) => {
              escribirNombre(escritor, proceso, e.target.value);
              refrescar();
            }}
          />
        </label>
      )}

      <div className="campo">
        <span>{S.propiedades.tipo}</span>
        <output>{nombreDeTipo(elemento.type)}</output>
      </div>

      <div className="campo">
        <span>{S.propiedades.id}</span>
        <div className="fila">
          <output className="mono">{elemento.id}</output>
          <button
            type="button"
            className="boton"
            onClick={() => {
              // Sin contexto seguro (la demo servida por http desde otra máquina) el navegador
              // no expone `navigator.clipboard`, y con el permiso denegado `writeText` rechaza:
              // ni una cosa ni la otra pueden tumbar el panel. El id se queda a la vista y se
              // copia a mano, que es lo que se puede hacer ahí.
              const portapapeles = navigator.clipboard as Clipboard | undefined;
              void portapapeles
                ?.writeText(elemento.id)
                .then(() => {
                  setCopiado(true);
                  setTimeout(() => {
                    setCopiado(false);
                  }, 1200);
                })
                .catch(() => undefined);
            }}
          >
            {copiado ? S.propiedades.copiado : S.propiedades.copiar}
          </button>
        </div>
      </div>
    </div>
  );
}

function Documentacion({ elemento, escritor, refrescar }: PropsPestana): React.JSX.Element {
  const S = useStrings();
  const proceso = procesoRelacionado(elemento);
  const documentado = proceso ?? elemento;
  const responsabilidades = leerExtensiones(elemento, 'lila:Responsibility');

  return (
    <div className="campos">
      <label className="campo">
        <span>{proceso === undefined ? S.propiedades.descripcion : S.propiedades.descripcionProceso}</span>
        <textarea
          rows={5}
          value={leerDocumentacion(documentado)}
          placeholder={S.propiedades.descripcionPista}
          onChange={(e) => {
            escribirDocumentacion(escritor, documentado, e.target.value);
            refrescar();
          }}
        />
      </label>

      {proceso !== undefined && (
        <label className="campo">
          <span>{S.propiedades.versionProceso}</span>
          <input
            type="text"
            aria-label={S.propiedades.versionProceso}
            value={leerVersionTag(proceso)}
            placeholder={S.propiedades.versionPista}
            onChange={(e) => {
              escribirVersionTag(escritor, proceso, e.target.value);
              refrescar();
            }}
          />
        </label>
      )}

      <section className="grupo">
        <h3>{S.propiedades.responsabilidades}</h3>
        {responsabilidades.map((responsabilidad, i) => {
          // `type` es cadena libre en el esquema y no se valida al importar
          // (`docs/BPMN_EXTENSION.md` § 2): un archivo ajeno puede traer una responsabilidad sin
          // `type` o con uno que no es RACI. Enseñarla como «R» sería mentir sobre lo que dice el
          // archivo —y el XML seguiría diciendo otra cosa—, así que el valor real se añade como
          // opción propia, deshabilitada para que solo se pueda salir de ahí hacia un RACI.
          const tipo = responsabilidad.type ?? '';
          const esRaci = raci().some(([valor]) => valor === tipo);

          // El moddle no da una clave estable y el orden de la lista sí lo es: el índice vale.
          return (
            <div className="fila" key={i}>
              <select
                aria-label={S.propiedades.tipoResponsabilidad(i + 1)}
                value={tipo}
                onChange={(e) => {
                  editarExtension(escritor, elemento, responsabilidad, { type: e.target.value });
                  refrescar();
                }}
              >
                {!esRaci && (
                  <option value={tipo} disabled>
                    {tipo === '' ? S.propiedades.sinTipo : S.propiedades.noEsRaci(tipo)}
                  </option>
                )}
                {raci().map(([valor, etiqueta]) => (
                  <option key={valor} value={valor}>
                    {etiqueta}
                  </option>
                ))}
              </select>
              <input
                type="text"
                aria-label={S.propiedades.rol(i + 1)}
                placeholder={S.propiedades.rolPista}
                value={responsabilidad.roleRef ?? ''}
                onChange={(e) => {
                  editarExtension(escritor, elemento, responsabilidad, { roleRef: e.target.value });
                  refrescar();
                }}
              />
              <button
                type="button"
                className="quitar"
                title={S.propiedades.quitarResponsabilidad}
                aria-label={S.propiedades.quitarResponsabilidadN(i + 1)}
                onClick={() => {
                  quitarExtension(escritor, elemento, responsabilidad);
                  refrescar();
                }}
              >
                {S.propiedades.cruz}
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="anadir"
          onClick={() => {
            anadirExtension(escritor, elemento, 'lila:Responsibility', { type: 'R', roleRef: '' });
            refrescar();
          }}
        >
          {S.propiedades.anadirResponsabilidad}
        </button>
      </section>

      {referencias().map(([tipo, etiqueta, ayuda]) => (
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
  const S = useStrings();
  const referencias = leerExtensiones(elemento, tipo);

  return (
    <section className="grupo">
      <h3>{etiqueta}</h3>
      {referencias.map((referencia, i) => (
        <div className="fila" key={i}>
          <input
            type="text"
            aria-label={S.propiedades.referenciaN(etiqueta, i + 1)}
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
            title={S.propiedades.quitarDe(etiqueta)}
            aria-label={S.propiedades.quitarDeN(etiqueta, i + 1)}
            onClick={() => {
              quitarExtension(escritor, elemento, referencia);
              refrescar();
            }}
          >
            {S.propiedades.cruz}
          </button>
        </div>
      ))}
      <button
        type="button"
        className="anadir"
        aria-label={S.propiedades.anadirA(etiqueta)}
        onClick={() => {
          anadirExtension(escritor, elemento, tipo, { ref: '' });
          refrescar();
        }}
      >
        {S.propiedades.anadir}
      </button>
    </section>
  );
}
