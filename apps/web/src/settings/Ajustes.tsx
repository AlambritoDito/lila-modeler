/**
 * Body of the Settings dialog (artboard 09, #407): `App.tsx` keeps the `<dialog>` element and its
 * ref (`showModal`/`close` need a DOM node from the shell that opens it), and mounts this for
 * everything inside. Three sections behind a left `role="tablist"` nav — General, Appearance,
 * Shortcuts — replace the old single scrolling column of headings.
 *
 * **Sections stay mounted, only `hidden`.** Unmounting the inactive ones would lose `Apariencia`'s
 * live-preview wiring and would break every existing `App.test.tsx` selector that reaches into
 * the dialog without first clicking a tab (`dialog.ajustes input[aria-label=…]`, the theme
 * `<select>`, …) — they all assume the whole dialog body is in the DOM the moment it opens, which
 * is still true here; only General is *visible* at that moment.
 */
import { useState } from 'react';
import type { Locale, Preferencia } from '../i18n';
import { useStrings } from '../i18n';
import { DENSIDAD_IDS, type Densidad } from '../ids';
import type { Theme } from '../theme/applyTheme';
import type { TemaGuardado } from '../theme/temas';
import { Apariencia } from './Apariencia';
import { Atajos, type GrupoAtajos } from './Atajos';

const SECCIONES = ['general', 'apariencia', 'atajos'] as const;
type Seccion = (typeof SECCIONES)[number];

export interface AjustesProps {
  readonly idioma: Preferencia;
  readonly cambiarIdioma: (preferido: Preferencia) => void;
  readonly LOCALES: readonly Locale[];
  readonly temaId: string;
  readonly tema: Theme | null;
  readonly temas: readonly TemaGuardado[];
  readonly densidad: Densidad;
  readonly onDensidad: (densidad: Densidad) => void;
  readonly onTemas: (temas: readonly TemaGuardado[], seleccion?: string) => void;
  readonly onSeleccionar: (id: string) => void;
  readonly abrirAcerca: () => void;
  /** Closes the `<dialog>` imperatively — needed only by the header's «About» button, which is
   * not a `type="submit"` of the form (that one already closes the dialog on its own). */
  readonly cerrarDialogo: () => void;
}

export function Ajustes(props: AjustesProps): React.JSX.Element {
  const S = useStrings();
  const [seccion, setSeccion] = useState<Seccion>('general');

  // ponytail: C1's shortcut map (`atajos.ts`, #413) feeds this at integration, replacing the
  // two-row placeholder below with `ATAJOS`/`S.atajos`/`etiqueta(·, MAC)`. Until then this repeats
  // the only two shortcuts `PropertiesPanel.tsx`'s empty state already documents.
  const grupos: readonly GrupoAtajos[] = [
    {
      titulo: S.ajustes.secciones.atajos,
      filas: [
        { etiqueta: S.propiedades.renombrar, tecla: 'F2' },
        { etiqueta: S.app.pestanas.propiedades, tecla: '⇧F6' },
      ],
    },
  ];

  return (
    <form method="dialog" onKeyDown={(e) => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault(); }}>
      <div className="ajustes-encabezado">
        <h2 id="ajustes-titulo">{S.app.ajustes} / {S.ajustes.secciones[seccion]}</h2>
        <button type="button" className="boton" onClick={() => { props.cerrarDialogo(); props.abrirAcerca(); }}>{S.app.acercaDe}</button>
      </div>
      <div className="ajustes-cuerpo">
        <nav className="ajustes-nav" role="tablist" aria-label={S.app.ajustes}>
          {SECCIONES.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              id={`ajustes-tab-${s}`}
              aria-selected={seccion === s}
              aria-controls={`ajustes-panel-${s}`}
              className={seccion === s ? 'activo' : undefined}
              onClick={() => setSeccion(s)}
            >
              {S.ajustes.secciones[s]}
            </button>
          ))}
        </nav>
        <section className="ajustes-panel" role="tabpanel" id="ajustes-panel-general" aria-labelledby="ajustes-tab-general" hidden={seccion !== 'general'}>
          <div className="fila">
            <span>{S.app.idioma}</span>
            <label className="campo idioma">
              <select aria-label={S.app.idioma} autoFocus value={props.idioma} onChange={(e) => props.cambiarIdioma(e.target.value as Preferencia)}>
                <option value="auto">{S.app.idiomaAuto}</option>
                {props.LOCALES.map((l) => <option key={l} value={l}>{S.app.idiomas[l]}</option>)}
              </select>
            </label>
          </div>
          <div className="fila">
            <span>{S.app.densidad}</span>
            {/* Density stays a preference, not a theme edit (LILA-113): applies on top of
                whichever theme is active, independent of the `density` token being edited in
                Appearance. */}
            <select aria-label={S.app.densidad} value={props.densidad} onChange={(e) => props.onDensidad(e.target.value as Densidad)}>
              {DENSIDAD_IDS.map((d) => <option key={d} value={d}>{S.app.densidades[d]}</option>)}
            </select>
          </div>
        </section>
        <section className="ajustes-panel" role="tabpanel" id="ajustes-panel-apariencia" aria-labelledby="ajustes-tab-apariencia" hidden={seccion !== 'apariencia'}>
          <Apariencia
            temaId={props.temaId}
            tema={props.tema}
            temas={props.temas}
            onTemas={props.onTemas}
            onSeleccionar={props.onSeleccionar}
          />
        </section>
        <section className="ajustes-panel" role="tabpanel" id="ajustes-panel-atajos" aria-labelledby="ajustes-tab-atajos" hidden={seccion !== 'atajos'}>
          <Atajos grupos={grupos} />
        </section>
      </div>
      <div className="acciones">
        <button className="boton primario">{S.app.cerrar}</button>
      </div>
    </form>
  );
}
