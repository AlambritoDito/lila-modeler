/**
 * The catalog panel (#674, RM-01 § 2.3, § 2.4, § 3.4, § 4): one place to list the roles, units,
 * systems and documents of the repository, see where each is used and go there, create and rename.
 * A modal `<dialog>` opened from the File menu and ⌘K (`App.tsx`), mounted only while open, as the
 * command palette: the browser traps the focus and closes on Esc, and closing puts the focus back
 * where it was.
 *
 * What is listed, searched and counted is `catalogo.ts`; this component draws it. Every change goes
 * through the same units as the pickers (#93): `catalogo.crear` asks the version 3 question once,
 * and create and update register with «Undo last catalog change». A field is written when it is
 * left (or on Enter), never while typing. Objects of a type this build does not know are shown and
 * not edited. There is no delete here (#675) and no attachment (RM-01 § 6).
 */
import { CATALOG_TYPES, catalogKey, isKnownCatalogType, type CatalogAttribute, type CatalogFields, type CatalogObject, type CatalogUse, type KnownCatalogType, type ProcessUse } from '@lila-modeler/engine/project';
import { useEffect, useId, useRef, useState } from 'react';
import { groupCatalog, isProcessUse, repeatsName, unitDescendants, usesOf, type CatalogIndexState } from './catalogo';
import { useStrings } from './i18n';
import { SelectorCatalogo, type CatalogoPanel } from './SelectorCatalogo';

interface Props {
  /** The catalog and its create/adopt, the same object the properties panel's pickers get. */
  catalogo: CatalogoPanel;
  /** The usage index; `'pending'` until it is built. */
  indice: CatalogIndexState;
  /** The processes of the project, to name each use. */
  procesos: readonly { readonly slug: string; readonly name: string }[];
  /** Writes `campos` to `objeto`; resolves to the object, or `null` when nothing changed. */
  actualizar: (objeto: CatalogObject, campos: CatalogFields) => Promise<CatalogObject | null>;
  /** «Undo last catalog change» (#93): whether there is one, and the command. */
  puedeDeshacer: boolean;
  onDeshacer: () => void;
  /** Opens the process of `uso` and selects its element; the panel has closed by then. */
  onIr: (uso: ProcessUse) => void;
  /** Why the last change was refused, if it was. */
  error?: string | null | undefined;
  onCerrar: () => void;
}

/** As the engine checks a `url` (RM-01 § 2.2): absolute `http`/`https`. The engine has the last word. */
const ES_URL = /^https?:\/\/\S+$/i;

interface PropsCampo {
  etiqueta: string;
  valor: string;
  multilinea?: boolean;
  /**
   * Why the text may not be written, or `null`. Such a text is never written: while it is in the
   * field the field is `aria-invalid`, and leaving it puts back the value it had, with the reason.
   */
  invalido?: (texto: string) => string | null;
  /** A note under the field for the text it holds, or `null`: a warning, the text is still written. */
  aviso?: (texto: string) => string | null;
  /** `true` once the panel is closing: what was typed and not confirmed is then discarded, not written. */
  descartar: { readonly current: boolean };
  onConfirmar: (texto: string) => void;
}

/** A text field that writes when it is left or on Enter (a single line), not while typing. */
function CampoTexto({ etiqueta, valor, multilinea = false, invalido, aviso, descartar, onConfirmar }: PropsCampo): React.JSX.Element {
  const [borrador, setBorrador] = useState<string | null>(null);
  /** Why the last text was not written; shown until the field is typed in again. */
  const [rechazo, setRechazo] = useState<string | null>(null);
  const avisoId = useId();
  const texto = borrador ?? valor;
  const error = borrador !== null ? invalido?.(borrador) ?? null : null;
  const nota = error ?? rechazo ?? aviso?.(texto) ?? null;
  const confirmar = (): void => {
    // Esc and «Close» take the focus away too (the dialog closes): that is not a confirmation.
    if (borrador === null || descartar.current) return;
    if (error !== null) setRechazo(error);
    else if (borrador !== valor) onConfirmar(borrador);
    setBorrador(null);
  };
  const escribir = (valorNuevo: string): void => { setBorrador(valorNuevo); setRechazo(null); };
  const comunes = {
    'aria-label': etiqueta,
    'aria-describedby': nota !== null ? avisoId : undefined,
    'aria-invalid': error !== null ? true : undefined,
    value: texto,
    onBlur: confirmar,
  };
  return (
    <>
      {multilinea
        ? <textarea {...comunes} rows={3} onChange={(e) => escribir(e.target.value)} />
        : <input {...comunes} type="text" onChange={(e) => escribir(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirmar(); } }} />}
      {nota !== null && <small className="catalogo-aviso" id={avisoId} role="status">{nota}</small>}
    </>
  );
}

export function CatalogPanel({ catalogo, indice, procesos, actualizar, puedeDeshacer, onDeshacer, onIr, error, onCerrar }: Props): React.JSX.Element {
  const S = useStrings();
  const P = S.catalogo.panel;
  const dialogo = useRef<HTMLDialogElement>(null);
  const buscador = useRef<HTMLInputElement>(null);
  const atributoNuevo = useRef<HTMLInputElement>(null);
  /** Set when the panel starts closing: the fields discard their drafts instead of writing them as they lose the focus. */
  const cerrando = useRef(false);
  // Captured on the first render, before `showModal` moves the focus into the dialog.
  const previo = useRef(document.activeElement as HTMLElement | null);
  const base = useId();
  const [consulta, setConsulta] = useState('');
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const [nuevoTipo, setNuevoTipo] = useState<KnownCatalogType>('role');
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [atributoNombre, setAtributoNombre] = useState('');
  const [atributoValor, setAtributoValor] = useState('');

  useEffect(() => {
    if (!dialogo.current?.open) dialogo.current?.showModal();
    buscador.current?.focus();
  }, []);

  /**
   * Closes and puts the focus back where it was. Opened from the File menu, that was an entry the
   * menu has hidden by now: the focus goes to the menu's own button instead.
   */
  function cerrar(): void {
    cerrando.current = true;
    dialogo.current?.close();
    const menu = previo.current?.closest('details:not([open])');
    (menu?.querySelector<HTMLElement>(':scope > summary') ?? previo.current)?.focus?.();
    onCerrar();
  }

  const objetos = catalogo.objetos;
  const grupos = groupCatalog(objetos, consulta);
  const elegido = objetos.find((o) => catalogKey(o) === seleccion);
  const nombreTipo = (tipo: string): string => (isKnownCatalogType(tipo) ? P.tipo[tipo] : tipo);
  const nombreProceso = (slug: string): string => procesos.find((p) => p.slug === slug)?.name ?? slug;
  const nombreObjeto = (clave: string): string => objetos.find((o) => catalogKey(o) === clave)?.name ?? clave;
  const relacion = (r: string): string => (Object.hasOwn(P.relaciones, r) ? P.relaciones[r as keyof typeof P.relaciones] : r);
  const campoDe = (c: string): string => (Object.hasOwn(P.campos, c) ? P.campos[c as keyof typeof P.campos] : c);
  /** How a use reads: the process, element and relation, or the object and field that refer. */
  const textoUso = (uso: CatalogUse): string => (isProcessUse(uso)
    ? P.usoProceso(nombreProceso(uso.slug), uso.element, relacion(uso.relation))
    : P.usoObjeto(nombreObjeto(uso.object), campoDe(uso.field)));
  /** A use in a process opens it on the canvas (the panel closes); one in an object shows that object. */
  const irA = (uso: CatalogUse): void => {
    if (isProcessUse(uso)) { cerrar(); onIr(uso); } else setSeleccion(uso.object);
  };
  const conteo = (objeto: CatalogObject): string => {
    const usos = usesOf(indice, objeto);
    return usos === 'pending' ? P.pendiente : usos === 'unavailable' ? P.noDisponible : P.usos(usos.length);
  };

  function crear(e: React.FormEvent): void {
    e.preventDefault();
    const nombre = nuevoNombre.trim();
    if (nombre === '') return;
    void catalogo.crear(nuevoTipo, nombre).then((objeto) => {
      if (objeto === null) return;
      setNuevoNombre('');
      setSeleccion(catalogKey(objeto));
    });
  }

  function detalle(objeto: CatalogObject): React.JSX.Element {
    const editable = isKnownCatalogType(objeto.type);
    const cambiar = (campos: CatalogFields): void => { if (!cerrando.current) void actualizar(objeto, campos); };
    const fijarAtributos = (lista: readonly CatalogAttribute[]): void => cambiar({ attributes: lista.length > 0 ? lista : null });
    const sinNombre = (t: string): string | null => (t.trim() === '' ? P.nombreVacio : null);
    const urlInvalida = (t: string): string | null => (t.trim() === '' || ES_URL.test(t.trim()) ? null : P.urlInvalida);
    // A unit is not its own parent, nor the child of a unit under it: no cycles (RM-01 § 2.2).
    const debajo = objeto.type === 'unit' ? unitDescendants(objetos, objeto.id) : new Set<string>();
    /** The row that held the focus is gone, or its button disabled: the focus goes to the new-attribute field. */
    const fijarAtributosYEnfocar = (lista: readonly CatalogAttribute[]): void => { fijarAtributos(lista); atributoNuevo.current?.focus(); };
    const atributos: readonly CatalogAttribute[] = objeto.attributes ?? [];
    const texto = (campo: string): string | undefined => {
      const valor = objeto[campo];
      return typeof valor === 'string' ? valor : undefined;
    };
    const referencia = (campo: 'unitRef' | 'parentRef' | 'ownerRef', tipo: KnownCatalogType): React.JSX.Element => (
      <label className="campo">
        <span>{P.campos[campo]}</span>
        <SelectorCatalogo
          campo={P.campos[campo]}
          tipo={tipo}
          valor={texto(campo)}
          catalogo={{ ...catalogo, // The current value stays, so a cycle already in the file shows its parent by name.
          objetos: objetos.filter((o) => o !== objeto && (o.id === texto(campo) || !(campo === 'parentRef' && o.type === 'unit' && debajo.has(o.id)))) }}
          onElegir={(id) => cambiar({ [campo]: id === '' ? null : id })}
        />
      </label>
    );
    const url = texto('url') ?? '';
    const usos = usesOf(indice, objeto);
    return (
      <section className="catalogo-detalle campos" aria-label={P.detalle(objeto.name)} key={catalogKey(objeto)}>
        {!editable && <p className="catalogo-nota">{P.soloLectura(objeto.type)}</p>}
        <label className="campo">
          <span>{P.nombre}</span>
          {editable
            ? <CampoTexto
              etiqueta={P.nombre}
              valor={objeto.name}
              invalido={sinNombre}
              aviso={(t) => (repeatsName(objetos, objeto.type, t, objeto.id) ? P.nombreRepetido(nombreTipo(objeto.type)) : null)}
              descartar={cerrando}
              onConfirmar={(t) => cambiar({ name: t })}
            />
            : <output>{objeto.name}</output>}
        </label>
        <div className="campo"><span>{P.id}</span><output className="mono">{objeto.id}</output></div>
        <div className="campo"><span>{P.tipoCampo}</span><output>{nombreTipo(objeto.type)}</output></div>
        <label className="campo">
          <span>{P.descripcion}</span>
          {editable
            ? <CampoTexto etiqueta={P.descripcion} valor={objeto.description ?? ''} multilinea descartar={cerrando} onConfirmar={(t) => cambiar({ description: t === '' ? null : t })} />
            : <output>{objeto.description ?? ''}</output>}
        </label>
        {objeto.type === 'role' && referencia('unitRef', 'unit')}
        {objeto.type === 'unit' && referencia('parentRef', 'unit')}
        {(objeto.type === 'system' || objeto.type === 'document') && <>
          {referencia('ownerRef', 'role')}
          <label className="campo">
            <span>{P.campos.url}</span>
            <CampoTexto
              etiqueta={P.campos.url}
              valor={url}
              invalido={urlInvalida}
              descartar={cerrando}
              onConfirmar={(t) => cambiar({ url: t.trim() === '' ? null : t.trim() })}
            />
          </label>
          {/* Shown as a link and never fetched (RM-01 § 2.2); the desktop app opens it in the browser. */}
          {ES_URL.test(url) && <a className="catalogo-enlace" href={url} target="_blank" rel="noopener noreferrer">{P.abrirEnlace}</a>}
        </>}
        <div className="campo">
          <span>{P.atributos}</span>
          {atributos.length === 0 && <output className="catalogo-vacio">{P.sinAtributos}</output>}
          {atributos.map((atributo, i) => (editable
            // Free text pairs, in order (RM-01 § 2.1): the position is the only identity a pair has.
            ? <div className="catalogo-atributo" key={i}>
              <CampoTexto etiqueta={P.atributoNombre(i + 1)} valor={atributo.name} invalido={sinNombre} descartar={cerrando} onConfirmar={(t) => fijarAtributos(atributos.map((a, j) => (j === i ? { ...a, name: t.trim() } : a)))} />
              <CampoTexto etiqueta={P.atributoValor(i + 1)} valor={atributo.value} descartar={cerrando} onConfirmar={(t) => fijarAtributos(atributos.map((a, j) => (j === i ? { ...a, value: t } : a)))} />
              <button type="button" className="boton" aria-label={P.atributoQuitar(i + 1)} title={P.atributoQuitar(i + 1)} onClick={() => fijarAtributosYEnfocar(atributos.filter((_, j) => j !== i))}>
                <span aria-hidden="true">×</span>
              </button>
            </div>
            : <output className="catalogo-atributo" key={i}><span>{atributo.name}</span><span>{atributo.value}</span></output>))}
          {editable && <div className="catalogo-atributo">
            <input ref={atributoNuevo} type="text" aria-label={P.atributoNuevoNombre} placeholder={P.atributoNuevoNombre} value={atributoNombre} onChange={(e) => setAtributoNombre(e.target.value)} />
            <input type="text" aria-label={P.atributoNuevoValor} placeholder={P.atributoNuevoValor} value={atributoValor} onChange={(e) => setAtributoValor(e.target.value)} />
            <button
              type="button"
              className="boton"
              disabled={atributoNombre.trim() === ''}
              onClick={() => {
                // The button disables itself with the name emptied: the focus moves on to the next pair.
                fijarAtributosYEnfocar([...atributos, { name: atributoNombre.trim(), value: atributoValor }]);
                setAtributoNombre(''); setAtributoValor('');
              }}
            >
              {P.atributoAnadir}
            </button>
          </div>}
        </div>
        <div className="campo">
          <span id={`${base}-usos`}>{P.dondeSeUsa}</span>
          {usos === 'pending' && <output role="status">{P.pendiente}</output>}
          {usos === 'unavailable' && <output role="status">{P.noDisponibleTexto}</output>}
          {typeof usos !== 'string' && <>
            <output>{usos.length === 0 ? P.sinUsos : P.usos(usos.length)}</output>
            {usos.length > 0 && <ul className="catalogo-usos" aria-labelledby={`${base}-usos`}>
              {usos.map((uso, i) => (
                <li key={i}><button type="button" className="catalogo-uso" title={P.irAUso(textoUso(uso))} onClick={() => irA(uso)}>{textoUso(uso)}</button></li>
              ))}
            </ul>}
          </>}
        </div>
      </section>
    );
  }

  const sinResolver = typeof indice === 'string' ? indice : indice.unresolved;
  return (
    <dialog
      ref={dialogo}
      className="catalogo"
      aria-labelledby={`${base}-titulo`}
      // The browser's own Esc. A picker with its list open keeps Esc for itself (`SelectorCatalogo`).
      onCancel={(e) => { e.preventDefault(); cerrar(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cerrar(); } }}
    >
      <header className="catalogo-encabezado">
        <h2 id={`${base}-titulo`}>{P.titulo}</h2>
        <input
          ref={buscador}
          type="search"
          aria-label={P.buscar}
          placeholder={P.pistaBuscar}
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
        />
        {/* One level: the button disables itself, so the focus goes to the search field instead of nowhere. */}
        <button type="button" className="boton" disabled={!puedeDeshacer} onClick={() => { onDeshacer(); buscador.current?.focus(); }}>{S.catalogo.deshacer}</button>
        {/* A press here must not take the focus from a field first: that would write its draft before the panel closes. */}
        <button type="button" className="boton" onMouseDown={(e) => e.preventDefault()} onClick={cerrar}>{P.cerrar}</button>
      </header>
      {typeof error === 'string' && error !== '' && <p className="catalogo-error" role="alert">{error}</p>}
      <div className="catalogo-cuerpo">
        <nav className="catalogo-lista" aria-label={P.objetos}>
          <form className="catalogo-nuevo" aria-label={P.nuevo} onSubmit={crear}>
            <select aria-label={P.nuevoTipo} value={nuevoTipo} onChange={(e) => setNuevoTipo(e.target.value as KnownCatalogType)}>
              {CATALOG_TYPES.map((tipo) => <option key={tipo} value={tipo}>{P.tipo[tipo]}</option>)}
            </select>
            <input
              type="text"
              aria-label={P.nuevoNombre}
              aria-describedby={repeatsName(objetos, nuevoTipo, nuevoNombre) ? `${base}-repetido` : undefined}
              placeholder={P.nuevoNombre}
              value={nuevoNombre}
              onChange={(e) => setNuevoNombre(e.target.value)}
            />
            <button type="submit" className="boton" disabled={nuevoNombre.trim() === ''}>{P.crear}</button>
            {repeatsName(objetos, nuevoTipo, nuevoNombre) && <small className="catalogo-aviso" id={`${base}-repetido`} role="status">{P.nombreRepetido(P.tipo[nuevoTipo])}</small>}
          </form>
          {grupos.length === 0 && <p className="catalogo-vacio">{P.sinResultados}</p>}
          {grupos.map((grupo) => (
            <section key={grupo.type} aria-labelledby={`${base}-g-${grupo.type}`}>
              <h3 id={`${base}-g-${grupo.type}`}>{isKnownCatalogType(grupo.type) ? P.tipos[grupo.type] : grupo.type}</h3>
              {grupo.objects.length === 0
                ? <p className="catalogo-vacio">{P.vacio}</p>
                : <ul>
                  {grupo.objects.map((objeto) => (
                    <li key={objeto.id}>
                      <button
                        type="button"
                        className="catalogo-objeto"
                        aria-current={catalogKey(objeto) === seleccion ? 'true' : undefined}
                        onClick={() => { setSeleccion(catalogKey(objeto)); setAtributoNombre(''); setAtributoValor(''); }}
                      >
                        <span className="nombre">{objeto.name}</span>
                        <span className="conteo">{conteo(objeto)}</span>
                      </button>
                    </li>
                  ))}
                </ul>}
            </section>
          ))}
          {/* Only a repository with a catalog has anything to resolve against (RM-01 § 3.4). */}
          {catalogo.conCatalogo && <section aria-labelledby={`${base}-sin-resolver`}>
            <h3 id={`${base}-sin-resolver`}>{P.sinResolver}</h3>
            {sinResolver === 'pending' && <p className="catalogo-vacio" role="status">{P.pendiente}</p>}
            {sinResolver === 'unavailable' && <p className="catalogo-vacio" role="status">{P.noDisponibleTexto}</p>}
            {typeof sinResolver !== 'string' && (sinResolver.length === 0
              ? <p className="catalogo-vacio">{P.sinResolverNinguna}</p>
              : <ul className="catalogo-usos">
                {sinResolver.map((r, i) => {
                  const texto = P.sinResolverFila(r.id, nombreTipo(r.type), textoUso(r));
                  return <li key={i}><button type="button" className="catalogo-uso" title={P.irAUso(textoUso(r))} onClick={() => irA(r)}>{texto}</button></li>;
                })}
              </ul>)}
          </section>}
        </nav>
        {elegido !== undefined ? detalle(elegido) : <p className="catalogo-detalle catalogo-vacio">{P.elige}</p>}
      </div>
    </dialog>
  );
}
