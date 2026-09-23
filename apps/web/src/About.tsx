/**
 * «About Lila Modeler» (LILA-381, owner request 2026-09-22), in its own window since #408: the
 * content of a `VentanaFlotante` named `lila-acerca`, which `App.tsx` opens from Settings, the web
 * File menu and the native desktop menu (action `'acerca'`). The window is not a modal and does not
 * trap focus; closing it (its OS button, the «×» here or `Escape`) unmounts this component, so the
 * Easter egg starts over every time it opens.
 *
 * **Easter egg (owner request, 2026-09-22, «fundamental para la Beta»).** Six clicks on the image
 * reveal a form with a key; «brito» closes the window and plays a full-screen karaoke in the MAIN
 * window that ends by opening a YouTube link, and «scuba» opens another link at once. Anything else
 * reveals nothing. Each click also plays a short pulse on the image, which never swallows a click.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { version } from '../package.json';
import { useStrings } from './i18n';

/**
 * Línea de marca del dueño (pedido del 2026-09-22): a propósito NO sale del catálogo — se lee
 * siempre en español, sea cual sea el idioma de la interfaz, igual que en el resto de sus
 * productos. `strings.test.ts` no la ve porque entra como identificador (`{MARCA_1}`), no como
 * literal JSX.
 */
const MARCA_1 = 'Lila Modeler® — Hecho en México 🇲🇽';
const MARCA_2 = 'De Tabachines para el mundo.';

/** Cuántos clics en el icono destapan la clave secreta. Nadie fuera de este archivo lo sabe. */
const CLICS_PARA_REVELAR = 6;

/**
 * Los dos textos fijos del formulario (pedido del dueño, 2026-09-22): igual que la marca, no
 * salen del catálogo —el dueño los quiso en español siempre, sin pista de qué son— y entran como
 * identificadores por la misma razón.
 */
const CLAVE_ETIQUETA = 'Clave secreta';
const CLAVE_BOTON = 'Entrar';

/** Los dos enlaces del huevo de pascua, tal cual los dio el dueño: ni un carácter tocado. */
const URL_SCUBA = 'https://www.youtube.com/watch?v=1jvqMJ379rc';
const URL_BRITO = 'https://www.youtube.com/watch?v=r7GBGZ004vQ&list=RDr7GBGZ004vQ&start_radio=1&t=203s';

/** Abre un enlace externo igual en el navegador que en Electron (`main.ts` ~778 lo manda a `shell.openExternal`). */
function abrirEnlace(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Las tres líneas del karaoke, tal cual las escribió el dueño —incluida la ortografía de «Me eh
 * dado»—. Entran al JSX palabra por palabra como identificadores (el arreglo, no un literal), así
 * que tampoco las ve `strings.test.ts`.
 */
const KARAOKE_LINEA_1 = 'Me eh dado la tarea de sobrepasar los niveles del modelado y simulación, ustedes saben ya.';
const KARAOKE_LINEA_2 = 'El capítulo de hoy se llama';
const KARAOKE_LINEA_3 = '"La Mente Maestra"';
const KARAOKE_PALABRAS_1 = KARAOKE_LINEA_1.split(' ');
const KARAOKE_PALABRAS_2 = KARAOKE_LINEA_2.split(' ');

/** Milisegundos entre el inicio de cada palabra («staggered») y cuánto tarda en caer cada una. */
const KARAOKE_RETRASO_MS = 180;
const KARAOKE_DURACION_MS = 250;
/** La línea épica cae la última, con una animación algo más larga que las palabras sueltas. */
const KARAOKE_DURACION_EPICA_MS = 400;
/** Cuánto se sostiene la última línea en pantalla antes de abrir el enlace y quitar el overlay. */
const KARAOKE_ESPERA_MS = 1500;
const KARAOKE_TOTAL_PALABRAS = KARAOKE_PALABRAS_1.length + KARAOKE_PALABRAS_2.length;
const KARAOKE_RETRASO_EPICA_MS = KARAOKE_TOTAL_PALABRAS * KARAOKE_RETRASO_MS;
/** Cuánto tarda el karaoke completo, de montarse a llamar `onTerminar` y abrir el enlace: lo que tarda en aterrizar la
 * última palabra más la espera final. `About.test.tsx` avanza los temporizadores falsos por esto. */
export const KARAOKE_DURACION_TOTAL_MS = KARAOKE_RETRASO_EPICA_MS + KARAOKE_DURACION_EPICA_MS + KARAOKE_ESPERA_MS;

/**
 * Full-screen overlay above everything (LILA-381), portalled into the MAIN window's `document.body`:
 * `App.tsx` mounts it after closing the About window, and this code runs in the opener's realm, so
 * `document` is the main one. While it plays, `#root` is `inert` (QA of #387, Low). `Escape` cancels
 * without opening the link; a click on the overlay does nothing (on purpose, no handler). The timer
 * is the only clock: `prefers-reduced-motion` only removes the CSS animation (see `app.css`).
 *
 * `onTerminar` lives in a `ref` and the effect runs with `[]` (QA of #387, Medium): `App` re-renders
 * for reasons unrelated to the karaoke — the progress of a running simulation, for one — and with
 * the callback as a dependency each of those renders restarted the `setTimeout`, so the link never
 * opened while a simulation was running.
 */
export function Karaoke({ onTerminar }: { readonly onTerminar: () => void }) {
  const terminar = useRef(onTerminar);
  terminar.current = onTerminar;

  useEffect(() => {
    const raiz = document.getElementById('root');
    raiz?.setAttribute('inert', '');
    const reloj = setTimeout(() => { terminar.current(); abrirEnlace(URL_BRITO); }, KARAOKE_DURACION_TOTAL_MS);
    const teclas = (e: KeyboardEvent): void => { if (e.key === 'Escape') terminar.current(); };
    window.addEventListener('keydown', teclas);
    return () => { clearTimeout(reloj); window.removeEventListener('keydown', teclas); raiz?.removeAttribute('inert'); };
  }, []);

  return createPortal(
    <div className="karaoke" role="presentation" aria-live="polite">
      <p className="karaoke-linea">
        {KARAOKE_PALABRAS_1.map((palabra, i) => (
          <span key={i} className="karaoke-palabra" style={{ animationDelay: `${i * KARAOKE_RETRASO_MS}ms` }}>{palabra}</span>
        ))}
      </p>
      <p className="karaoke-linea">
        {KARAOKE_PALABRAS_2.map((palabra, i) => (
          <span key={i} className="karaoke-palabra" style={{ animationDelay: `${(KARAOKE_PALABRAS_1.length + i) * KARAOKE_RETRASO_MS}ms` }}>{palabra}</span>
        ))}
      </p>
      <p className="karaoke-epica" style={{ animationDelay: `${KARAOKE_RETRASO_EPICA_MS}ms`, animationDuration: `${KARAOKE_DURACION_EPICA_MS}ms` }}>
        {KARAOKE_LINEA_3}
      </p>
    </div>,
    document.body,
  );
}

export function About({ onCerrar, onKaraoke }: {
  /** Closes the About window. */
  readonly onCerrar: () => void;
  /** «brito»: `App.tsx` closes this window and then mounts `<Karaoke>` in the main one. */
  readonly onKaraoke: () => void;
}) {
  const S = useStrings();
  const [clics, setClics] = useState(0);
  const [clave, setClave] = useState('');
  const [tiembla, setTiembla] = useState(false);
  const [pulso, setPulso] = useState(false);

  function enviarClave(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const valor = clave.trim().toLowerCase();
    setClave('');
    if (valor === 'brito') onKaraoke();
    else if (valor === 'scuba') abrirEnlace(URL_SCUBA);
    // Not a hint of which keys exist: a shake and that is all.
    else setTiembla(true);
  }

  return (
    <section className="acerca" aria-labelledby="acerca-nombre">
      <button type="button" className="acerca-cerrar" aria-label={S.app.cerrar} onClick={onCerrar}>×</button>
      {/* The count and the pulse are separate on purpose: every click counts, even one that lands
          while the pulse is still playing (it just does not restart it). */}
      <img
        className={`acerca-icono${pulso ? ' pulso' : ''}`}
        src={`${import.meta.env.BASE_URL}branding/lila-transparent.png`}
        alt=""
        width="120"
        height="120"
        onClick={() => { setClics((c) => c + 1); setPulso(true); }}
        onAnimationEnd={() => setPulso(false)}
      />
      <strong id="acerca-nombre">{S.bienvenida.nombre}</strong>
      <p className="acerca-version">v{version}</p>
      <p className="acerca-marca">{MARCA_1}</p>
      <p className="acerca-marca">{MARCA_2}</p>
      {clics >= CLICS_PARA_REVELAR && (
        <form className={`acerca-clave${tiembla ? ' tiembla' : ''}`} onSubmit={enviarClave} onAnimationEnd={() => setTiembla(false)}>
          <label>
            {CLAVE_ETIQUETA}
            <input type="text" value={clave} onChange={(e) => setClave(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <button type="submit" className="boton primario">{CLAVE_BOTON}</button>
        </form>
      )}
    </section>
  );
}
