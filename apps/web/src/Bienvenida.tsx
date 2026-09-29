/**
 * Bienvenida de escritorio (artboard 08 de `docs/design/Lila Modeler.dc.html`): un overlay sobre
 * el shell mientras no hay proyecto abierto. Solo sale en Electron —`App` la enciende cuando
 * `pendingOpenPath()` no trae nada que abrir— y la apaga `activate()` al entrar cualquier
 * proyecto, venga de aquí, del menú nativo o de un doble clic.
 *
 * ponytail: sin «n diagramas» (el puente no lo sabe) ni «Atajos de teclado» (no hay tal vista);
 * la marca es el icono aprobado en #350, no el pentágono del artboard. Solo seis recientes: el
 * puente guarda diez y con la tarjeta de novedades no caben en 900 px de alto.
 */
import type { Recent } from '../../desktop/src/bridge.js';
import { atajoPorId, etiqueta, MAC, type AtajoId } from './atajos';
import { EJEMPLOS, type EjemploId } from './ejemplos';
import { useLocale, useStrings } from './i18n';
import { version } from '../package.json';

export const REPO_URL = 'https://github.com/AlambritoDito/lila-modeler';

export type AccionBienvenida = 'openFile' | 'open' | 'new' | { readonly recent: string } | { readonly ejemplo: EjemploId };

/** «⌘O · hint» on Mac, «Ctrl+O · hint» elsewhere: the key comes from the one shortcut map (#413). */
export const pistaConAtajo = (id: AtajoId, pista: string, mac: boolean): string => `${etiqueta(atajoPorId(id), mac)} · ${pista}`;

const UNIDADES: readonly (readonly [number, Intl.RelativeTimeFormatUnit])[] = [
  [60, 'second'], [3600, 'minute'], [86_400, 'hour'], [7 * 86_400, 'day'], [30 * 86_400, 'week'], [365 * 86_400, 'month'],
];

/** «hace 2 h», «ayer», «hace 3 semanas»: `Intl.RelativeTimeFormat` con la unidad más grande que quepa. */
export function haceCuanto(iso: string, locale: string, ahora = Date.now()): string {
  const segundos = Math.round((new Date(iso).getTime() - ahora) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let divisor = 1;
  for (const [limite, unidad] of UNIDADES) {
    if (Math.abs(segundos) < limite) return rtf.format(Math.trunc(segundos / divisor), unidad);
    divisor = limite;
  }
  return rtf.format(Math.trunc(segundos / (365 * 86_400)), 'year');
}

export function Bienvenida({ recientes, temaNombre, densidadTexto, onAccion, onAjustes }: {
  readonly recientes: readonly Recent[];
  readonly temaNombre: string;
  readonly densidadTexto: string;
  readonly onAccion: (accion: AccionBienvenida) => void;
  readonly onAjustes: () => void;
}) {
  const S = useStrings().bienvenida;
  const locale = useLocale();
  const acciones = [
    { kind: 'openFile', titulo: S.abrirLila, pista: S.abrirLilaPista, clase: 'primaria', icono: <path d="M3 7h6l2 2h10v10H3z" /> },
    { kind: 'open', titulo: S.abrirCarpeta, pista: pistaConAtajo('abrir', S.abrirCarpetaPista, MAC), clase: '', icono: <path d="M3 7h6l2 2h10v10H3z" /> },
    { kind: 'new', titulo: S.nuevo, pista: pistaConAtajo('nuevo', S.nuevoPista, MAC), clase: '', icono: <path d="M12 5v14M5 12h14" /> },
  ] as const;
  return (
    <section className="bienvenida" aria-label={S.titulo}>
      <div className="bienvenida-izq">
        <div>
          <div className="bienvenida-marca">
            <img src={`${import.meta.env.BASE_URL}branding/lila-transparent.png`} alt="" width="38" height="38" />
            <div><strong>{S.nombre}</strong><span>{S.subtitulo(version)}</span></div>
          </div>
          <h2>{S.empezar}</h2>
          {acciones.map((a) => (
            <button key={a.kind} type="button" className={`bienvenida-accion ${a.clase}`} onClick={() => onAccion(a.kind)}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{a.icono}</svg>
              <span><strong>{a.titulo}</strong><small>{a.pista}</small></span>
            </button>
          ))}
          {/* #458: the public examples (`docs/EXAMPLES_POLICY.md`), each opened as a fresh, pathless
              project — the same row shape as «Recent» (title + one-line hint), reused instead of a
              new style. */}
          <h3>{S.ejemplosTitulo}</h3>
          <ul className="bienvenida-ejemplos">
            {EJEMPLOS.map((ej) => (
              <li key={ej.id}>
                <button type="button" onClick={() => onAccion({ ejemplo: ej.id })}>
                  <span><strong>{S.ejemplos[ej.id].titulo}</strong><small>{S.ejemplos[ej.id].pista}</small></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <footer>
          <a href={`${REPO_URL}#readme`} target="_blank" rel="noreferrer">{S.documentacion}</a>
          <a href={REPO_URL} target="_blank" rel="noreferrer">{S.repositorio}</a>
        </footer>
      </div>
      <div className="bienvenida-der">
        <h2>{S.recientes}</h2>
        {recientes.length === 0 ? <p className="bienvenida-vacio">{S.sinRecientes}</p> : (
          <ul className="bienvenida-recientes">
            {recientes.slice(0, 6).map((r) => (
              <li key={r.dir}>
                <button type="button" onClick={() => onAccion({ recent: r.dir })}>
                  <span><strong>{r.name}</strong><small>{r.dir}</small></span>
                  <time dateTime={r.openedAt}>{haceCuanto(r.openedAt, locale)}</time>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="bienvenida-novedades">
          <h3>{S.novedades(version)}</h3>
          {__LILA_NOVEDADES__ !== '' && <p>{__LILA_NOVEDADES__}</p>}
          <a href={`${REPO_URL}/releases`} target="_blank" rel="noreferrer">{S.notasVersion}</a>
        </div>
        <p className="bienvenida-tema">
          <span className="muestra" aria-hidden="true" />
          {/* One flex item (#425) so the text and the link wrap inline together, and the «·» is
              glued to the link (`nowrap`): a narrow column breaks before it, never after it. */}
          <span>{S.tema(temaNombre, densidadTexto)}{' '}<span className="enlace-tema">{'· '}<button type="button" className="enlace" onClick={onAjustes}>{S.cambiarApariencia}</button></span></span>
        </p>
      </div>
    </section>
  );
}
