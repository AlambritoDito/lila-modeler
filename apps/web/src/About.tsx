/**
 * Diálogo «Acerca de» (LILA-381, pedido del dueño el 2026-09-22): todos sus productos llevan uno,
 * y este es el de Lila Modeler. Sigue el mismo patrón que el diálogo de ajustes (`.ajustes` en
 * `App.tsx`) — un `<dialog>` nativo gobernado por una `ref` desde fuera—, así `Escape` y el
 * backdrop ya funcionan gratis y `App.tsx` no necesita un estado `abierto` aparte.
 *
 * Vive en su propio archivo, y no como una sección más de Ajustes, porque es un diálogo
 * independiente: se abre desde un botón de Ajustes (que cierra Ajustes al hacerlo) y también
 * desde el menú nativo de escritorio (acción `'acerca'`).
 *
 * **Huevo de Pascua (pedido del dueño, 2026-09-22, «fundamental para la Beta»).** Seis clics en el
 * icono destapan un formulario con una clave; «brito» dispara un karaoke a pantalla completa que
 * termina abriendo un enlace de YouTube, y «scuba» abre otro enlace al instante. Cualquier otra
 * cosa no revela nada. El contador de clics se reinicia cuando el diálogo se cierra (evento nativo
 * `close`, no un `onClick` propio: así también cubre el `Escape`).
 */
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
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
/** Cuánto tarda el karaoke completo, de montarse a llamar `onFin`: lo que tarda en aterrizar la
 * última palabra más la espera final. `About.test.tsx` avanza los temporizadores falsos por esto. */
export const KARAOKE_DURACION_TOTAL_MS = KARAOKE_RETRASO_EPICA_MS + KARAOKE_DURACION_EPICA_MS + KARAOKE_ESPERA_MS;

/**
 * Overlay a pantalla completa por encima de todo (LILA-381): un `<dialog>` no sirve porque su
 * «top layer» taparía esto también, así que es un `<div>` normal montado por portal en
 * `document.body` —el diálogo de Acerca de ya se cerró antes de montarlo, y el propio `About`
 * sigue siendo su hermano en el árbol, no su padre—. `Escape` cancela sin abrir el enlace; un
 * clic sobre el overlay no hace nada (a propósito, sin manejador). El temporizador es el único
 * reloj: `prefers-reduced-motion` solo quita la animación CSS (ver `app.css`), no el tiempo de
 * espera, así que `onFin` llega igual de tarde con o sin movimiento.
 *
 * `onFin`/`onCancelar` viven en `ref`s y el efecto corre con `[]` (QA de #387, Medium): son
 * funciones nuevas en cada render de `About`, y `About` se vuelve a renderizar por cosas que no
 * tienen nada que ver con el karaoke —el progreso de una simulación en curso, por ejemplo—. Con
 * esas funciones como dependencias, cada uno de esos renders limpiaba el `setTimeout` y ponía
 * otro desde cero, así que con una simulación corriendo el enlace no llegaba a abrirse nunca.
 */
function Karaoke({ onFin, onCancelar }: {
  readonly onFin: () => void;
  readonly onCancelar: () => void;
}) {
  const fin = useRef(onFin);
  fin.current = onFin;
  const cancelar = useRef(onCancelar);
  cancelar.current = onCancelar;

  useEffect(() => {
    const reloj = setTimeout(() => fin.current(), KARAOKE_DURACION_TOTAL_MS);
    const teclas = (e: KeyboardEvent): void => { if (e.key === 'Escape') cancelar.current(); };
    window.addEventListener('keydown', teclas);
    return () => { clearTimeout(reloj); window.removeEventListener('keydown', teclas); };
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

export function About({ dialogRef, onKaraoke }: {
  readonly dialogRef: RefObject<HTMLDialogElement | null>;
  /** Avisa a `App.tsx` mientras el karaoke está montado (QA de #387, Low): con el `<dialog>` de
   * Acerca de ya cerrado, ni `⌘,`/`⌘.` ni el menú nativo pasan por su `<dialog>`, así que sin este
   * aviso podían abrir Ajustes u otra vez Acerca de encima del overlay. */
  readonly onKaraoke?: (activo: boolean) => void;
}) {
  const S = useStrings();
  const [clics, setClics] = useState(0);
  const [clave, setClave] = useState('');
  const [tiembla, setTiembla] = useState(false);
  const [karaoke, setKaraoke] = useState(false);

  // Mientras el overlay está montado, el resto de la app queda `inert` (QA de #387, Low): sin eso
  // el `Tab` seguía entrando al `<dialog>` ya cerrado o al lienzo de detrás.
  useEffect(() => {
    if (!karaoke) return;
    const raiz = document.getElementById('root');
    raiz?.setAttribute('inert', '');
    return () => raiz?.removeAttribute('inert');
  }, [karaoke]);

  /** El único sitio que reinicia el huevo de pascua: se cuelga del evento `close` nativo del
   * `<dialog>`, así que cubre por igual el botón «×», el `Escape` y el `close()` que dispara la
   * propia clave «brito» antes del karaoke. */
  function reiniciar(): void {
    setClics(0);
    setClave('');
    setTiembla(false);
  }

  function enviarClave(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const valor = clave.trim().toLowerCase();
    setClave('');
    if (valor === 'brito') {
      dialogRef.current?.close();
      setKaraoke(true);
      onKaraoke?.(true);
    } else if (valor === 'scuba') {
      abrirEnlace(URL_SCUBA);
    } else {
      // Ni una pista de qué claves existen: solo un temblor y listo.
      setTiembla(true);
    }
  }

  return (
    <>
      <dialog ref={dialogRef} className="acerca" aria-labelledby="acerca-nombre" onClose={reiniciar}>
        <button type="button" className="acerca-cerrar" aria-label={S.app.cerrar} onClick={() => dialogRef.current?.close()}>×</button>
        {/* `logo` es la misma clase de la marca de la barra (LILA-206, Modernist): comparte su
            redondeo de 7 px en vez de inventar otro radio en `app.css`, que el design system del
            artefacto no permite fuera de esa única regla. */}
        <img
          className="logo acerca-icono"
          src={`${import.meta.env.BASE_URL}branding/app-icon.png`}
          alt=""
          width="104"
          height="104"
          onClick={() => setClics((c) => c + 1)}
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
      </dialog>
      {karaoke && (
        <Karaoke
          onFin={() => { setKaraoke(false); onKaraoke?.(false); abrirEnlace(URL_BRITO); }}
          onCancelar={() => { setKaraoke(false); onKaraoke?.(false); }}
        />
      )}
    </>
  );
}
