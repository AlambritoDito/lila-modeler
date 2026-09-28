/**
 * Extended attributes (#509), the web UI: the fields that fill them in on the selected element
 * (a section of the «Properties» tab) and the dialog that defines them per element type. The
 * moddle side — where definitions live, reading, writing, the pool guard — is `atributos.ts`.
 *
 * Everything goes through `modeling`, like the rest of the panel, so ⌘Z undoes it; saving the
 * dialog is one command (`Escritor.lote`) however many elements it touches.
 *
 * The type rules (`validateAttributeValue`, `categoryOf`) are the engine's, so the panel, the CLI
 * and the process document agree on what a valid value is.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ATTRIBUTE_TYPES,
  categoryOf,
  ELEMENT_CATEGORIES,
  validateAttributeValue,
  type AttributeDefinition,
  type AttributeType,
  type ElementCategory,
} from '@lila-modeler/engine/bpmn';
import {
  escribirValor,
  estadoDefiniciones,
  guardarDefiniciones,
  leerDefiniciones,
  leerValores,
  valoresDe,
  type Moddle,
} from './atributos';
import { useStrings } from './i18n';
import { leerExtensiones, type ElementoLienzo, type Escritor } from './PropertiesPanel';

/** A fresh definition id, NCName with a type prefix like every other id of the file (ADR-012). */
function nuevoId(usados: ReadonlySet<string>): string {
  for (;;) {
    const id = `Attr_${Math.random().toString(36).slice(2, 9)}`;
    if (!usados.has(id)) return id;
  }
}

/* ------------------------------------------------------------------ *
 * The fields on the selected element.
 * ------------------------------------------------------------------ */

interface PropsElemento {
  /** The element itself: a floating label already resolved to its owner. */
  elemento: ElementoLienzo;
  /** The canvas root; the definitions are found from it up to `bpmn:Definitions`. */
  raiz: ElementoLienzo;
  escritor: Escritor;
  refrescar: () => void;
}

/**
 * The «Extended attributes» section of an element that can carry them; nothing for the rest
 * (flows, data, text annotations). A pool also shows its process's attributes.
 */
export function AtributosDelElemento({ elemento, raiz, escritor, refrescar }: PropsElemento): React.JSX.Element | null {
  const S = useStrings();
  const categoria = categoryOf(elemento.businessObject.$type);
  if (categoria === undefined) return null;
  const proceso = (elemento.businessObject as Moddle).processRef;
  return (
    <>
      <Grupo elemento={elemento} categoria={categoria} titulo={S.atributos.titulo} raiz={raiz} escritor={escritor} refrescar={refrescar} />
      {proceso?.id !== undefined && (
        <Grupo
          elemento={{ id: proceso.id, type: proceso.$type, businessObject: proceso }}
          categoria="process"
          titulo={S.atributos.deProceso}
          raiz={raiz}
          escritor={escritor}
          refrescar={refrescar}
        />
      )}
    </>
  );
}

function Grupo({ elemento, categoria, titulo, raiz, escritor, refrescar }: PropsElemento & { categoria: ElementCategory; titulo: string }): React.JSX.Element {
  const S = useStrings();
  const [abierto, setAbierto] = useState(false);
  const definiciones = leerDefiniciones(raiz);
  const { repetidas } = estadoDefiniciones(raiz);
  const propias = definiciones.filter((d) => d.appliesTo === categoria);
  const conocidas = new Set(definiciones.map((d) => d.id));
  const huerfanos = leerExtensiones(elemento, 'lila:AttributeValue').filter((v) => !conocidas.has(v.ref ?? ''));

  return (
    <section className="grupo atributos">
      <h3>{titulo}</h3>
      {repetidas > 0 && <p className="pista">{S.atributos.repetidas(repetidas)}</p>}
      {propias.length === 0 && <p className="pista">{S.atributos.ninguno(S.atributos.categorias[categoria])}</p>}
      {propias.map((def) => (
        <CampoAtributo key={`${elemento.id}:${def.id}`} def={def} elemento={elemento} escritor={escritor} refrescar={refrescar} />
      ))}
      {huerfanos.map((v, i) => {
        // A value whose definition is gone (edited by hand, another tool): shown, never dropped.
        const nombre = v.ref === undefined || v.ref === '' ? S.atributos.sinReferencia : S.atributos.huerfano(v.ref);
        return (
          <div className="fila" key={`huerfano-${i}`}>
            <output>{nombre}: {v.value ?? ''}</output>
            <button
              type="button"
              className="quitar"
              aria-label={S.atributos.quitarHuerfano(nombre)}
              title={S.atributos.quitarHuerfano(nombre)}
              onClick={() => {
                escribirValor(escritor, elemento, v.ref ?? '', '');
                refrescar();
              }}
            >
              {S.propiedades.cruz}
            </button>
          </div>
        );
      })}
      <button type="button" className="anadir" onClick={() => setAbierto(true)}>
        {S.atributos.definir}
      </button>
      {abierto && (
        <DialogoAtributos
          raiz={raiz}
          escritor={escritor}
          categoria={categoria}
          cerrar={() => {
            setAbierto(false);
            refrescar();
          }}
        />
      )}
    </section>
  );
}

/**
 * One attribute's field. Text and lists write as they change; numbers and dates keep a draft and
 * write it on blur, Enter or when the field goes away, and only if it fits — «24,5» never leaves
 * «24» behind on the way. An invalid draft stays on screen with the explanation, and the model
 * keeps the last valid value. Save, export and Run blur the focused field first
 * (`edicionEnCurso.ts`).
 */
function CampoAtributo({ def, elemento, escritor, refrescar }: {
  def: AttributeDefinition;
  elemento: ElementoLienzo;
  escritor: Escritor;
  refrescar: () => void;
}): React.JSX.Element {
  const S = useStrings();
  const valores = leerValores(elemento, def.id).map((v) => v.value ?? '');
  const guardado = valores[0] ?? '';
  const [borrador, setBorrador] = useState<string | null>(null);
  // Undo, redo or another edit of the stored value wins over a pending draft.
  useEffect(() => setBorrador(null), [guardado]);
  const mostrado = borrador ?? guardado;
  const problema = validateAttributeValue(def, mostrado);
  const idError = `atributo-error-${elemento.id}-${def.id}`;
  const pista = def.default === undefined || def.default === '' ? undefined : S.atributos.porDefecto(def.default);
  const alConfirmar = def.type === 'number' || def.type === 'date';

  const escribir = (valor: string): void => {
    setBorrador(null);
    if (valor === guardado) return;
    escribirValor(escritor, elemento, def.id, valor);
    refrescar();
  };
  const confirmar = (): void => {
    if (borrador !== null && validateAttributeValue(def, borrador) === null) escribir(borrador);
  };
  // A field that goes away without a blur — the selection changed by keyboard or by code, the tab
  // switched — still commits a draft that fits (second QA pass of #513). One that does not fit is
  // dropped, as on blur: the model keeps its last valid value.
  const pendiente = useRef<() => void>(() => undefined);
  pendiente.current = () => {
    if (borrador !== null && borrador !== guardado && validateAttributeValue(def, borrador) === null) {
      escribirValor(escritor, elemento, def.id, borrador);
      refrescar();
    }
  };
  useEffect(() => () => pendiente.current(), []);
  const cambiar = (valor: string): void => {
    if (!alConfirmar && validateAttributeValue(def, valor) === null) escribir(valor);
    else setBorrador(valor);
  };
  const comunes = {
    'aria-label': def.name,
    'aria-invalid': problema !== null,
    ...(problema === null ? {} : { 'aria-describedby': idError }),
  };

  let control: React.JSX.Element;
  if (def.type === 'list') {
    const opciones = def.options ?? [];
    control = (
      <select {...comunes} value={mostrado} onChange={(e) => cambiar(e.target.value)}>
        <option value="">{pista ?? S.atributos.sinValor}</option>
        {mostrado !== '' && !opciones.includes(mostrado) && (
          <option value={mostrado} disabled>{S.atributos.noEsOpcion(mostrado)}</option>
        )}
        {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  } else {
    control = (
      <input
        {...comunes}
        type={def.type === 'date' ? 'date' : 'text'}
        inputMode={def.type === 'number' ? 'decimal' : undefined}
        placeholder={pista}
        value={mostrado}
        onChange={(e) => cambiar(e.target.value)}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirmar();
        }}
      />
    );
  }

  return (
    <label className="campo">
      <span>{def.name}</span>
      {control}
      {problema !== null && <small id={idError} className="error" role="alert">{S.atributos.problemas[problema]}</small>}
      {valores.length > 1 && <small className="pista">{S.atributos.varios(valores.length, valores.join(', '))}</small>}
    </label>
  );
}

/* ------------------------------------------------------------------ *
 * The dialog that defines them.
 * ------------------------------------------------------------------ */

/** A definition being edited: options as the textarea's text, one per line. */
interface Borrador {
  id: string;
  name: string;
  type: string;
  appliesTo: string;
  default: string;
  opciones: string;
}

const aBorrador = (d: AttributeDefinition): Borrador => ({
  id: d.id,
  name: d.name,
  type: d.type,
  appliesTo: d.appliesTo,
  default: d.default ?? '',
  opciones: (d.options ?? []).join('\n'),
});

const opcionesDe = (b: Borrador): string[] =>
  [...new Set(b.opciones.split('\n').map((o) => o.trim()).filter((o) => o !== ''))];

const aDefinicion = (b: Borrador): AttributeDefinition => ({
  id: b.id,
  name: b.name.trim(),
  type: b.type,
  appliesTo: b.appliesTo,
  ...(b.default === '' ? {} : { default: b.default }),
  ...(b.type === 'list' ? { options: opcionesDe(b) } : {}),
});

/** What saving would do to one definition's existing values, for the confirmation step. */
interface Impacto {
  id: string;
  antes: AttributeDefinition;
  /** `null`: deleted, with all its values. */
  ahora: AttributeDefinition | null;
  valores: number;
  /** Values that no longer fit `ahora`. */
  invalidos: number;
  opcionesQuitadas: string[];
}

function DialogoAtributos({ raiz, escritor, categoria, cerrar }: {
  raiz: ElementoLienzo;
  escritor: Escritor;
  categoria: ElementCategory;
  cerrar: () => void;
}): React.JSX.Element {
  const S = useStrings();
  const dialogo = useRef<HTMLDialogElement>(null);
  const [originales] = useState(() => leerDefiniciones(raiz));
  const [estado] = useState(() => estadoDefiniciones(raiz));
  const [borradores, setBorradores] = useState<Borrador[]>(() => originales.map(aBorrador));
  const [tipoElemento, setTipoElemento] = useState<ElementCategory>(categoria);
  const [errores, setErrores] = useState<string[]>([]);
  const [impactos, setImpactos] = useState<Impacto[] | null>(null);
  const [limpiar, setLimpiar] = useState<Set<string>>(new Set());
  const [enfocar, setEnfocar] = useState<string | null>(null);

  useEffect(() => {
    const d = dialogo.current;
    if (d !== null && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);
  // «Add attribute» moves the focus to the new row's name.
  useEffect(() => {
    if (enfocar === null) return;
    dialogo.current?.querySelector<HTMLInputElement>(`[data-atributo="${enfocar}"]`)?.focus();
    setEnfocar(null);
  }, [enfocar]);

  const visibles = borradores.map((b, i) => [b, i] as const).filter(([b]) => b.appliesTo === tipoElemento);
  const editar = (i: number, cambio: Partial<Borrador>): void =>
    setBorradores((todos) => todos.map((b, j) => (j === i ? { ...b, ...cambio } : b)));
  const cerrarDialogo = (): void => {
    dialogo.current?.close();
    cerrar();
  };

  const validar = (): string[] => {
    const out: string[] = [];
    for (const cat of ELEMENT_CATEGORIES) {
      const nombres = new Set<string>();
      for (const b of borradores.filter((x) => x.appliesTo === cat)) {
        const nombre = b.name.trim();
        if (nombre === '') out.push(S.atributos.errores.nombre);
        else if (nombres.has(nombre.toLowerCase())) out.push(S.atributos.errores.repetido(nombre));
        nombres.add(nombre.toLowerCase());
        if (b.type === 'list' && opcionesDe(b).length === 0) out.push(S.atributos.errores.opciones(nombre));
        if (validateAttributeValue({ type: b.type, options: opcionesDe(b) }, b.default) !== null) {
          out.push(S.atributos.errores.porDefecto(nombre));
        }
      }
    }
    return [...new Set(out)];
  };

  const nuevas = (): AttributeDefinition[] => borradores.map(aDefinicion);
  const nombreTipo = (t: string): string =>
    (ATTRIBUTE_TYPES as readonly string[]).includes(t) ? S.atributos.tipos[t as AttributeType] : t;

  const aplicar = (impactosAhora: readonly Impacto[], limpiados: ReadonlySet<string>): void => {
    const porId = new Map(nuevas().map((d) => [d.id, d]));
    const borrados = new Set(impactosAhora.filter((m) => m.ahora === null).map((m) => m.id));
    guardarDefiniciones(escritor, raiz, nuevas(), (ref, valor) => {
      if (borrados.has(ref)) return true;
      const def = porId.get(ref);
      return limpiados.has(ref) && def !== undefined && validateAttributeValue(def, valor) !== null;
    });
    cerrarDialogo();
  };

  const guardar = (): void => {
    const encontrados = validar();
    setErrores(encontrados);
    if (encontrados.length > 0) return;
    // Nothing edited and nothing to tidy up: no command, no undo step, the model stays clean.
    const igual = JSON.stringify(nuevas()) === JSON.stringify(originales.map((o) => aDefinicion(aBorrador(o))));
    if (igual && estado.repetidas === 0 && !estado.fueraDeSitio) {
      cerrarDialogo();
      return;
    }
    // Renaming, retyping or changing the options of an attribute that has values, or deleting
    // one: ask. A changed default or a new attribute touches no stored value.
    const lista: Impacto[] = [];
    for (const antes of originales) {
      const valores = valoresDe(raiz, antes.id);
      if (valores.length === 0) continue;
      const b = borradores.find((x) => x.id === antes.id);
      const ahora = b === undefined ? null : aDefinicion(b);
      const opcionesQuitadas = ahora !== null && antes.type === 'list' && ahora.type === 'list'
        ? (antes.options ?? []).filter((o) => !(ahora.options ?? []).includes(o))
        : [];
      const cambia = ahora === null || ahora.name !== antes.name || ahora.type !== antes.type || opcionesQuitadas.length > 0;
      if (!cambia) continue;
      const invalidos = ahora === null ? valores.length : valores.filter((v) => validateAttributeValue(ahora, v) !== null).length;
      lista.push({ id: antes.id, antes, ahora, valores: valores.length, invalidos, opcionesQuitadas });
    }
    if (lista.length === 0) aplicar([], new Set());
    else {
      setLimpiar(new Set());
      setImpactos(lista);
    }
  };

  return (
    <dialog
      ref={dialogo}
      className="atributos-dialogo"
      aria-labelledby="atributos-titulo"
      onCancel={(e) => {
        e.preventDefault();
        cerrarDialogo();
      }}
    >
      {impactos === null ? (
        <>
          <h2 id="atributos-titulo">{S.atributos.dialogo}</h2>
          {estado.repetidas > 0 && <p className="pista">{S.atributos.repetidas(estado.repetidas)}</p>}
          <label className="campo">
            <span>{S.atributos.paraTipo}</span>
            <select value={tipoElemento} onChange={(e) => setTipoElemento(e.target.value as ElementCategory)}>
              {ELEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{S.atributos.categorias[c]}</option>)}
            </select>
          </label>
          {visibles.length === 0 && <p className="pista">{S.atributos.ninguno(S.atributos.categorias[tipoElemento])}</p>}
          {visibles.map(([b, i], n) => (
            <fieldset className="atributo-definicion" key={b.id}>
              <legend>{S.atributos.atributoN(n + 1)}</legend>
              <div className="fila">
                <label className="campo">
                  <span>{S.atributos.etiquetas.nombre}</span>
                  <input type="text" data-atributo={b.id} aria-label={S.atributos.nombre(n + 1)} value={b.name} onChange={(e) => editar(i, { name: e.target.value })} />
                </label>
                <label className="campo">
                  <span>{S.atributos.etiquetas.tipo}</span>
                  <select aria-label={S.atributos.tipo(n + 1)} value={b.type} onChange={(e) => editar(i, { type: e.target.value })}>
                    {!(ATTRIBUTE_TYPES as readonly string[]).includes(b.type) && <option value={b.type} disabled>{b.type}</option>}
                    {ATTRIBUTE_TYPES.map((t) => <option key={t} value={t}>{S.atributos.tipos[t]}</option>)}
                  </select>
                </label>
                <button
                  type="button"
                  className="quitar"
                  aria-label={S.atributos.quitar(n + 1)}
                  title={S.atributos.quitar(n + 1)}
                  onClick={() => setBorradores((todos) => todos.filter((_, j) => j !== i))}
                >
                  {S.propiedades.cruz}
                </button>
              </div>
              {b.type === 'list' && (
                <label className="campo">
                  <span>{S.atributos.etiquetas.opciones}</span>
                  <textarea
                    aria-label={S.atributos.opciones(n + 1)}
                    rows={3}
                    value={b.opciones}
                    onChange={(e) => editar(i, { opciones: e.target.value })}
                  />
                </label>
              )}
              <label className="campo">
                <span>{S.atributos.etiquetas.porDefecto}</span>
                <input
                  type={b.type === 'date' ? 'date' : 'text'}
                  aria-label={S.atributos.valorPorDefecto(n + 1)}
                  value={b.default}
                  onChange={(e) => editar(i, { default: e.target.value })}
                />
              </label>
            </fieldset>
          ))}
          <button
            type="button"
            className="anadir"
            onClick={() => {
              const id = nuevoId(new Set(borradores.map((t) => t.id)));
              setBorradores((todos) => [...todos, { id, name: '', type: 'text', appliesTo: tipoElemento, default: '', opciones: '' }]);
              setEnfocar(id);
            }}
          >
            {S.atributos.anadir}
          </button>
          {errores.length > 0 && (
            <ul className="error" role="alert">{errores.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
          <div className="acciones">
            <button type="button" className="boton primario" onClick={guardar}>{S.atributos.guardar}</button>
            <button type="button" className="boton" onClick={cerrarDialogo}>{S.atributos.cancelar}</button>
          </div>
        </>
      ) : (
        <>
          <h2 id="atributos-titulo">{S.atributos.confirmarTitulo}</h2>
          <p>{S.atributos.confirmarTexto}</p>
          <ul className="atributos-impactos">
            {impactos.map((m) => (
              <li key={m.id}>
                {m.ahora === null ? (
                  S.atributos.borrado(m.antes.name, m.valores)
                ) : (
                  <fieldset>
                    <legend>
                      {[
                        m.ahora.name === m.antes.name ? m.antes.name : S.atributos.renombrado(m.antes.name, m.ahora.name),
                        ...(m.ahora.type === m.antes.type ? [] : [S.atributos.cambiaTipo(nombreTipo(m.antes.type), nombreTipo(m.ahora.type))]),
                        ...(m.opcionesQuitadas.length === 0 ? [] : [S.atributos.opcionesQuitadas(m.opcionesQuitadas.join(', '))]),
                        S.atributos.conValores(m.valores, m.invalidos),
                      ].join(' ')}
                    </legend>
                    {m.invalidos > 0 && (['conservar', 'limpiar'] as const).map((accion) => (
                      <label key={accion}>
                        <input
                          type="radio"
                          name={`impacto-${m.id}`}
                          checked={limpiar.has(m.id) === (accion === 'limpiar')}
                          onChange={() =>
                            setLimpiar((antes) => {
                              const nuevo = new Set(antes);
                              if (accion === 'limpiar') nuevo.add(m.id);
                              else nuevo.delete(m.id);
                              return nuevo;
                            })}
                        />
                        {accion === 'conservar' ? S.atributos.conservar : S.atributos.limpiar(m.invalidos)}
                      </label>
                    ))}
                  </fieldset>
                )}
              </li>
            ))}
          </ul>
          <div className="acciones">
            <button type="button" className="boton primario" onClick={() => aplicar(impactos, limpiar)}>
              {S.atributos.aplicar}
            </button>
            <button type="button" className="boton" onClick={() => setImpactos(null)}>{S.atributos.volver}</button>
          </div>
        </>
      )}
    </dialog>
  );
}
