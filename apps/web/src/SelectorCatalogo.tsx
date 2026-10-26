/**
 * The catalog picker of a `lila:*Ref` field (#93, RM-01 § 3.1): an ARIA combobox that shows the
 * object's name and writes its id. What it lists and how a value resolves is `catalogPicker.ts`;
 * this component only draws it and turns keys into choices.
 *
 * Typing filters, it does not write: the reference changes when a row is chosen (click or Enter),
 * or is cleared when the field is emptied and left (Enter, Tab or a click elsewhere), as the text
 * field cleared it. Esc puts the field back as it was. Every write goes through `onElegir`, which
 * the panel sends through `editarExtension`, so ⌘Z undoes it on the canvas as before.
 *
 * A value no object has is kept and shown (RM-01 § 3.4): with its id, and in a repository that
 * has a catalog (version 3) as «id — not in catalog»; a version 1 or 2 project shows its typed ids
 * without warnings. «Adopt» makes an object with that id when that rewrites no BPMN.
 */
import type { CatalogObject, KnownCatalogType } from '@lila-modeler/engine/project';
import { useId, useState } from 'react';
import { createName, pickerOptions, resolveReference } from './catalogPicker';
import { useStrings } from './i18n';

/**
 * The catalog as the properties panel sees it. `crear` and `adoptar` resolve to the object, or to
 * `null` when nothing was changed (the version 3 confirmation was cancelled, or the change failed).
 */
export interface CatalogoPanel {
  readonly objetos: readonly CatalogObject[];
  /** `true` in a version 3 repository: only there is an unresolved value flagged (RM-01 § 3.4). */
  readonly conCatalogo: boolean;
  crear(tipo: KnownCatalogType, nombre: string): Promise<CatalogObject | null>;
  adoptar(tipo: KnownCatalogType, id: string): Promise<CatalogObject | null>;
}

interface Props {
  /** The field's accessible name, unique in the panel («Role 1», «Systems 2»). */
  campo: string;
  tipo: KnownCatalogType;
  valor: string | undefined;
  catalogo: CatalogoPanel;
  /** Writes the reference: an object's id, or `''` to clear it. */
  onElegir: (id: string) => void;
}

type Fila = { readonly clave: string; readonly texto: string; readonly elegir: () => void };

export function SelectorCatalogo({ campo, tipo, valor, catalogo, onElegir }: Props): React.JSX.Element {
  const S = useStrings();
  const base = useId();
  const listaId = `${base}-lista`;
  /** What is being typed; `null` while the field shows the current value. */
  const [consulta, setConsulta] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);

  const resolucion = resolveReference(catalogo.objetos, tipo, valor);
  /** Why a value cannot be adopted, in a repository with a catalog only (RM-01 § 3.4). */
  const nota = resolucion.state === 'unresolved' && !resolucion.adoptable && catalogo.conCatalogo;
  const notaId = `${base}-nota`;
  const mostrado =
    resolucion.state === 'object' ? resolucion.label
      : resolucion.state === 'unresolved' ? (catalogo.conCatalogo ? S.catalogo.noEnCatalogo(resolucion.id) : resolucion.id)
        : '';

  const cerrar = (): void => {
    setConsulta(null);
    setAbierto(false);
    setActivo(0);
  };
  const elegir = (id: string): void => {
    cerrar();
    if (id !== (valor ?? '').trim()) onElegir(id);
  };
  const crear = (nombre: string): void => {
    cerrar();
    void catalogo.crear(tipo, nombre).then((objeto) => { if (objeto !== null) onElegir(objeto.id); });
  };

  const texto = consulta ?? '';
  const filas: Fila[] = abierto
    ? [
      ...pickerOptions(catalogo.objetos, tipo, texto).map((o): Fila => ({ clave: `o:${o.object.id}`, texto: o.label, elegir: () => elegir(o.object.id) })),
      ...[createName(catalogo.objetos, tipo, texto)].filter((n) => n !== null).map((nombre): Fila => ({ clave: 'crear', texto: S.catalogo.crear(nombre), elegir: () => crear(nombre) })),
    ]
    : [];
  const indice = Math.min(activo, filas.length - 1);
  const filaId = (i: number): string => `${base}-fila-${i}`;

  /** Leaving the field: an emptied field clears the reference; anything else goes back as it was. */
  const confirmarVacio = (): void => {
    if (consulta !== null && consulta.trim() === '') elegir('');
    else cerrar();
  };

  return (
    <div className="selector-catalogo">
      <div className="selector-catalogo-campo">
        <input
          type="text"
          role="combobox"
          aria-label={campo}
          aria-autocomplete="list"
          aria-expanded={abierto}
          aria-controls={listaId}
          aria-activedescendant={abierto && indice >= 0 ? filaId(indice) : undefined}
          aria-describedby={nota ? notaId : undefined}
          className={resolucion.state === 'unresolved' && catalogo.conCatalogo ? 'no-resuelto' : undefined}
          placeholder={S.catalogo.pista[tipo]}
          value={consulta ?? mostrado}
          onChange={(e) => {
            setConsulta(e.target.value);
            setAbierto(true);
            setActivo(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              if (!abierto) { setAbierto(true); setActivo(0); return; }
              const n = filas.length;
              if (n > 0) setActivo((indice + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              // An emptied field clears the reference, even with every object listed under it.
              const fila = filas[indice];
              if (consulta !== null && consulta.trim() === '') confirmarVacio();
              else if (abierto && fila !== undefined) fila.elegir();
              else confirmarVacio();
            } else if (e.key === 'Escape') {
              // Only when there is something to close: otherwise Esc is the panel's or the app's.
              if (!abierto && consulta === null) return;
              e.preventDefault();
              e.stopPropagation();
              cerrar();
            }
          }}
          onBlur={confirmarVacio}
        />
        {abierto && (
          // The field keeps the focus: a press on the list (a row, its scrollbar) must not blur it
          // first, which would close the list or, on an emptied field, clear the reference.
          <ul className="selector-catalogo-lista" role="listbox" id={listaId} aria-label={S.catalogo.opciones(campo)} onMouseDown={(e) => e.preventDefault()}>
            {filas.length === 0 && <li className="vacio" role="presentation">{S.catalogo.sinResultados}</li>}
            {filas.map((fila, i) => (
              <li
                key={fila.clave}
                id={filaId(i)}
                role="option"
                aria-selected={i === indice}
                onClick={fila.elegir}
              >
                {fila.texto}
              </li>
            ))}
          </ul>
        )}
      </div>
      {resolucion.state === 'unresolved' && (resolucion.adoptable ? (
        <button
          type="button"
          className="boton adoptar"
          aria-label={S.catalogo.adoptarDe(campo, resolucion.id)}
          title={S.catalogo.adoptarDe(campo, resolucion.id)}
          onClick={() => void catalogo.adoptar(tipo, resolucion.id)}
        >
          {S.catalogo.adoptar}
        </button>
      ) : nota && <small className="selector-catalogo-nota" id={notaId}>{S.catalogo.noAdoptable(resolucion.id)}</small>)}
    </div>
  );
}
