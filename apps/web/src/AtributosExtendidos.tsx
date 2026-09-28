/**
 * Extended attributes (#509), the web half: the fields that fill them in on the selected element
 * (a section of the «Properties» tab) and the dialog that defines them per element type.
 *
 * Storage is `docs/BPMN_EXTENSION.md` § 2.1: `lila:attributeDefinition` in the `extensionElements`
 * of the `bpmn:process` (in a collaboration, the process of a pool; without one, the root), and
 * `lila:attributeValue` in the element's own `extensionElements`. Everything goes through
 * `modeling`, like the rest of the panel, so ⌘Z undoes it; saving the dialog is one command
 * (`Escritor.lote`) however many elements it touches.
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
  type ElementCategory,
} from '@lila-modeler/engine/bpmn';
import { useStrings } from './i18n';
import {
  anadirExtension,
  editarExtension,
  leerExtensiones,
  type ElementoLienzo,
  type ElementoModdle,
  type Escritor,
} from './PropertiesPanel';

const DEF = 'lila:AttributeDefinition';
const VAL = 'lila:AttributeValue';
const OPT = 'lila:Option';

/** The moddle properties this file reads beyond `ElementoModdle`. */
interface Moddle extends ElementoModdle {
  appliesTo?: string;
  default?: string;
  options?: Moddle[];
  participants?: Moddle[];
  rootElements?: Moddle[];
  flowElements?: Moddle[];
  laneSets?: Moddle[];
  lanes?: Moddle[];
  childLaneSet?: Moddle;
  artifacts?: Moddle[];
  extensionElements?: Moddle;
  values?: Moddle[];
  processRef?: Moddle;
}

/** `Escritor`, whose optional `lote` makes several calls one undoable command. */
type EscritorConLote = Escritor;

/* ------------------------------------------------------------------ *
 * Reading and writing on the moddle. No React.
 * ------------------------------------------------------------------ */

/** The elements definitions may hang off: the root and, in a collaboration, each pool's process. */
function duenos(raiz: ElementoLienzo): Moddle[] {
  const bo = raiz.businessObject as Moddle;
  const procesos = (bo.participants ?? []).map((p) => p.processRef).filter((p): p is Moddle => p !== undefined);
  return [...new Set([bo, ...procesos])];
}

function definicionesDe(dueno: Moddle): Moddle[] {
  return (dueno.extensionElements?.values ?? []).filter((v) => v.$type === DEF);
}

/**
 * Where definitions are written: the root process; in a collaboration, the pool process that
 * already has them, else the first pool's process. A process outlives adding or removing pools
 * (bpmn-js keeps it as the pool's `processRef`), which the collaboration does not.
 */
function anfitrion(raiz: ElementoLienzo): Moddle {
  const lista = duenos(raiz);
  const [bo] = lista;
  if (bo?.$type === 'bpmn:Process') return bo;
  const procesos = lista.filter((d) => d.$type === 'bpmn:Process');
  return procesos.find((p) => definicionesDe(p).length > 0) ?? procesos[0] ?? (raiz.businessObject as Moddle);
}

function aPlano(def: Moddle): AttributeDefinition {
  const options = (def.options ?? []).map((o) => o.value ?? '');
  return {
    id: def.id ?? '',
    name: def.name ?? '',
    type: def.type ?? '',
    appliesTo: def.appliesTo ?? '',
    ...(def.default === undefined ? {} : { default: def.default }),
    ...(options.length === 0 ? {} : { options }),
  };
}

/** Every definition of the diagram, in file order. */
export function leerDefiniciones(raiz: ElementoLienzo): AttributeDefinition[] {
  return duenos(raiz).flatMap(definicionesDe).map(aPlano);
}

/** The element's `lila:attributeValue` for the definition `ref`, if it has one. */
export function leerValor(elemento: ElementoLienzo, ref: string): ElementoModdle | undefined {
  return leerExtensiones(elemento, VAL).find((v) => v.ref === ref);
}

/**
 * Sets the element's value for `ref`: edits the one it has, adds one, or — for the empty string —
 * removes it. The caller validates first: this writes what it is given.
 */
export function escribirValor(escritor: Escritor, elemento: ElementoLienzo, ref: string, valor: string): void {
  const existente = leerValor(elemento, ref);
  if (valor !== '') {
    if (existente === undefined) anadirExtension(escritor, elemento, VAL, { ref, value: valor });
    else editarExtension(escritor, elemento, existente, { value: valor });
    return;
  }
  if (existente !== undefined) quitarValores(escritor, elemento, elemento.businessObject as Moddle, new Set([ref]));
}

/** Everything with an `id` under the diagram's `bpmn:definitions`, as `annotate.ts` walks it. */
function* todos(el: Moddle): Generator<Moddle> {
  yield el;
  const hijos = [
    ...(el.rootElements ?? []),
    ...(el.flowElements ?? []),
    ...(el.participants ?? []),
    ...(el.artifacts ?? []),
    ...(el.laneSets ?? []),
    ...(el.lanes ?? []),
    ...(el.childLaneSet === undefined ? [] : [el.childLaneSet]),
  ];
  for (const hijo of hijos) yield* todos(hijo);
}

function arbol(raiz: ElementoLienzo): Moddle {
  const bo = raiz.businessObject as Moddle;
  const padre = bo.$parent as Moddle | undefined;
  return padre?.$type === 'bpmn:Definitions' ? padre : bo;
}

/** How many elements of the diagram have a value for `ref`. */
export function contarValores(raiz: ElementoLienzo, ref: string): number {
  let n = 0;
  for (const el of new Set(todos(arbol(raiz)))) {
    if ((el.extensionElements?.values ?? []).some((v) => v.$type === VAL && v.ref === ref)) n++;
  }
  return n;
}

/** Removes the values of `refs` from `dueno`; an `extensionElements` left empty goes too. */
function quitarValores(escritor: Escritor, elemento: ElementoLienzo, dueno: Moddle, refs: ReadonlySet<string>): void {
  const ext = dueno.extensionElements;
  if (ext === undefined) return;
  const resto = (ext.values ?? []).filter((v) => !(v.$type === VAL && refs.has(v.ref ?? '')));
  if (resto.length === (ext.values ?? []).length) return;
  if (resto.length === 0) escritor.modeling.updateModdleProperties(elemento, dueno, { extensionElements: undefined });
  else escritor.modeling.updateModdleProperties(elemento, ext, { values: resto });
}

function crearDefinicion(escritor: Escritor, d: AttributeDefinition): Moddle {
  const def = escritor.bpmnFactory.create(DEF, {
    id: d.id,
    name: d.name,
    type: d.type,
    appliesTo: d.appliesTo,
    ...(d.default === undefined || d.default === '' ? {} : { default: d.default }),
  }) as Moddle;
  if (d.type === 'list') {
    def.options = (d.options ?? []).map((value) => {
      const opcion = escritor.bpmnFactory.create(OPT, { value }) as Moddle;
      opcion.$parent = def;
      return opcion;
    });
  }
  return def;
}

/**
 * Replaces every definition of the diagram with `nuevas` and clears the values of `vaciar`
 * (deleted definitions, or ones the user chose to empty), as one undoable command when the
 * modeler offers `lote`.
 */
export function guardarDefiniciones(
  escritor: EscritorConLote,
  raiz: ElementoLienzo,
  nuevas: readonly AttributeDefinition[],
  vaciar: ReadonlySet<string>,
): void {
  const hacer = (): void => {
    const { modeling, bpmnFactory } = escritor;
    const host = anfitrion(raiz);
    for (const dueno of duenos(raiz)) {
      const ext = dueno.extensionElements;
      if (dueno === host || ext === undefined) continue;
      const resto = (ext.values ?? []).filter((v) => v.$type !== DEF);
      if (resto.length !== (ext.values ?? []).length) modeling.updateModdleProperties(raiz, ext, { values: resto });
    }

    const defs = nuevas.map((d) => crearDefinicion(escritor, d));
    const ext = host.extensionElements;
    const resto = (ext?.values ?? []).filter((v) => v.$type !== DEF);
    if (ext === undefined) {
      if (defs.length > 0) {
        const nuevo = bpmnFactory.create('bpmn:ExtensionElements', { values: defs }) as Moddle;
        nuevo.$parent = host;
        for (const d of defs) d.$parent = nuevo;
        modeling.updateModdleProperties(raiz, host, { extensionElements: nuevo });
      }
    } else if (resto.length === 0 && defs.length === 0) {
      modeling.updateModdleProperties(raiz, host, { extensionElements: undefined });
    } else {
      for (const d of defs) d.$parent = ext;
      modeling.updateModdleProperties(raiz, ext, { values: [...resto, ...defs] });
    }

    if (vaciar.size > 0) for (const el of new Set(todos(arbol(raiz)))) quitarValores(escritor, raiz, el, vaciar);
  };
  if (escritor.lote === undefined) hacer();
  else escritor.lote(hacer);
}

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
  /** The canvas root, which holds (or leads to) the definitions. */
  raiz: ElementoLienzo;
  escritor: EscritorConLote;
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
  const propias = definiciones.filter((d) => d.appliesTo === categoria);
  const conocidas = new Set(definiciones.map((d) => d.id));
  const huerfanos = leerExtensiones(elemento, VAL).filter((v) => !conocidas.has(v.ref ?? ''));

  return (
    <section className="grupo atributos">
      <h3>{titulo}</h3>
      {propias.length === 0 && <p className="pista">{S.atributos.ninguno(S.atributos.categorias[categoria])}</p>}
      {propias.map((def) => (
        <CampoAtributo key={`${elemento.id}:${def.id}`} def={def} elemento={elemento} escritor={escritor} refrescar={refrescar} />
      ))}
      {huerfanos.map((v, i) => (
        // A value whose definition is gone (edited by hand, another tool): shown, never dropped.
        <div className="fila" key={`huerfano-${i}`}>
          <output>{S.atributos.huerfano(v.ref ?? '')}: {v.value ?? ''}</output>
          <button
            type="button"
            className="quitar"
            aria-label={S.atributos.quitarHuerfano(v.ref ?? '')}
            title={S.atributos.quitarHuerfano(v.ref ?? '')}
            onClick={() => {
              escribirValor(escritor, elemento, v.ref ?? '', '');
              refrescar();
            }}
          >
            {S.propiedades.cruz}
          </button>
        </div>
      ))}
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
 * One attribute's field. A value that does not fit its type is explained and not written (the
 * model keeps the last valid one); what the file already says is shown as it is, with the
 * explanation if it does not fit either.
 */
function CampoAtributo({ def, elemento, escritor, refrescar }: {
  def: AttributeDefinition;
  elemento: ElementoLienzo;
  escritor: Escritor;
  refrescar: () => void;
}): React.JSX.Element {
  const S = useStrings();
  const guardado = leerValor(elemento, def.id)?.value ?? '';
  const [borrador, setBorrador] = useState<string | null>(null);
  // Undo, redo or another edit of the stored value wins over a pending invalid draft.
  useEffect(() => setBorrador(null), [guardado]);
  const mostrado = borrador ?? guardado;
  const problema = validateAttributeValue(def, mostrado);
  const idError = `atributo-error-${elemento.id}-${def.id}`;
  const pista = def.default === undefined || def.default === '' ? undefined : S.atributos.porDefecto(def.default);

  const cambiar = (valor: string): void => {
    if (validateAttributeValue(def, valor) === null) {
      escribirValor(escritor, elemento, def.id, valor);
      setBorrador(null);
      refrescar();
    } else {
      setBorrador(valor);
    }
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
      />
    );
  }

  return (
    <label className="campo">
      <span>{def.name}</span>
      {control}
      {problema !== null && <small id={idError} className="error" role="alert">{S.atributos.problemas[problema]}</small>}
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

/** What saving would do to existing values, for the confirmation step. */
interface Impacto {
  id: string;
  antes: string;
  ahora: string | null;
  valores: number;
}

function DialogoAtributos({ raiz, escritor, categoria, cerrar }: {
  raiz: ElementoLienzo;
  escritor: EscritorConLote;
  categoria: ElementCategory;
  cerrar: () => void;
}): React.JSX.Element {
  const S = useStrings();
  const dialogo = useRef<HTMLDialogElement>(null);
  const [originales] = useState(() => leerDefiniciones(raiz));
  const [borradores, setBorradores] = useState<Borrador[]>(() => originales.map(aBorrador));
  const [tipoElemento, setTipoElemento] = useState<ElementCategory>(categoria);
  const [errores, setErrores] = useState<string[]>([]);
  const [impactos, setImpactos] = useState<Impacto[] | null>(null);
  const [vaciar, setVaciar] = useState<Set<string>>(new Set());

  useEffect(() => {
    const d = dialogo.current;
    if (d !== null && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);

  const visibles = borradores.map((b, i) => [b, i] as const).filter(([b]) => b.appliesTo === tipoElemento);
  const editar = (i: number, cambio: Partial<Borrador>): void =>
    setBorradores((todos) => todos.map((b, j) => (j === i ? { ...b, ...cambio } : b)));

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

  const aplicar = (vaciados: ReadonlySet<string>): void => {
    guardarDefiniciones(escritor, raiz, borradores.map(aDefinicion), vaciados);
    dialogo.current?.close();
    cerrar();
  };

  const guardar = (): void => {
    const encontrados = validar();
    setErrores(encontrados);
    if (encontrados.length > 0) return;
    // Renaming, retyping or changing the options of an attribute that has values, or deleting
    // one: ask. A changed default or a new attribute touches no stored value.
    const lista: Impacto[] = [];
    for (const o of originales) {
      const valores = contarValores(raiz, o.id);
      if (valores === 0) continue;
      const b = borradores.find((x) => x.id === o.id);
      if (b === undefined) {
        lista.push({ id: o.id, antes: o.name, ahora: null, valores });
        continue;
      }
      const d = aDefinicion(b);
      const cambia = d.name !== o.name || d.type !== o.type
        || (d.type === 'list' && (d.options ?? []).join('\n') !== (o.options ?? []).join('\n'));
      if (cambia) lista.push({ id: o.id, antes: o.name, ahora: d.name, valores });
    }
    if (lista.length === 0) aplicar(new Set());
    else {
      setVaciar(new Set());
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
        dialogo.current?.close();
        cerrar();
      }}
    >
      {impactos === null ? (
        <>
          <h2 id="atributos-titulo">{S.atributos.dialogo}</h2>
          <label className="campo">
            <span>{S.atributos.paraTipo}</span>
            <select value={tipoElemento} onChange={(e) => setTipoElemento(e.target.value as ElementCategory)}>
              {ELEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{S.atributos.categorias[c]}</option>)}
            </select>
          </label>
          {visibles.length === 0 && <p className="pista">{S.atributos.ninguno(S.atributos.categorias[tipoElemento])}</p>}
          {visibles.map(([b, i], n) => (
            <fieldset className="atributo-definicion" key={b.id}>
              <div className="fila">
                <input type="text" aria-label={S.atributos.nombre(n + 1)} value={b.name} onChange={(e) => editar(i, { name: e.target.value })} />
                <select aria-label={S.atributos.tipo(n + 1)} value={b.type} onChange={(e) => editar(i, { type: e.target.value })}>
                  {!(ATTRIBUTE_TYPES as readonly string[]).includes(b.type) && <option value={b.type} disabled>{b.type}</option>}
                  {ATTRIBUTE_TYPES.map((t) => <option key={t} value={t}>{S.atributos.tipos[t]}</option>)}
                </select>
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
                <textarea
                  aria-label={S.atributos.opciones(n + 1)}
                  placeholder={S.atributos.opcionesPista}
                  rows={3}
                  value={b.opciones}
                  onChange={(e) => editar(i, { opciones: e.target.value })}
                />
              )}
              <input
                type={b.type === 'date' ? 'date' : 'text'}
                aria-label={S.atributos.valorPorDefecto(n + 1)}
                placeholder={S.atributos.valorPorDefecto(n + 1)}
                value={b.default}
                onChange={(e) => editar(i, { default: e.target.value })}
              />
            </fieldset>
          ))}
          <button
            type="button"
            className="anadir"
            onClick={() =>
              setBorradores((todos) => [
                ...todos,
                { id: nuevoId(new Set(todos.map((t) => t.id))), name: '', type: 'text', appliesTo: tipoElemento, default: '', opciones: '' },
              ])}
          >
            {S.atributos.anadir}
          </button>
          {errores.length > 0 && (
            <ul className="error" role="alert">{errores.map((e) => <li key={e}>{e}</li>)}</ul>
          )}
          <div className="acciones">
            <button type="button" className="boton primario" onClick={guardar}>{S.atributos.guardar}</button>
            <button
              type="button"
              className="boton"
              onClick={() => {
                dialogo.current?.close();
                cerrar();
              }}
            >
              {S.atributos.cancelar}
            </button>
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
                  S.atributos.borrado(m.antes, m.valores)
                ) : (
                  <fieldset>
                    <legend>{S.atributos.cambio(m.antes, m.ahora, m.valores)}</legend>
                    {(['conservar', 'vaciar'] as const).map((accion) => (
                      <label key={accion}>
                        <input
                          type="radio"
                          name={`impacto-${m.id}`}
                          checked={vaciar.has(m.id) === (accion === 'vaciar')}
                          onChange={() =>
                            setVaciar((antes) => {
                              const nuevo = new Set(antes);
                              if (accion === 'vaciar') nuevo.add(m.id);
                              else nuevo.delete(m.id);
                              return nuevo;
                            })}
                        />
                        {S.atributos[accion]}
                      </label>
                    ))}
                  </fieldset>
                )}
              </li>
            ))}
          </ul>
          <div className="acciones">
            <button
              type="button"
              className="boton primario"
              onClick={() => aplicar(new Set([...vaciar, ...impactos.filter((m) => m.ahora === null).map((m) => m.id)]))}
            >
              {S.atributos.aplicar}
            </button>
            <button type="button" className="boton" onClick={() => setImpactos(null)}>{S.atributos.volver}</button>
          </div>
        </>
      )}
    </dialog>
  );
}
