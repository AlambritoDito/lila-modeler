/**
 * Diálogo «Acerca de» (LILA-381, pedido del dueño el 2026-09-22): todos sus productos llevan uno,
 * y este es el de Lila Modeler. Sigue el mismo patrón que el diálogo de ajustes (`.ajustes` en
 * `App.tsx`) — un `<dialog>` nativo gobernado por una `ref` desde fuera—, así `Escape` y el
 * backdrop ya funcionan gratis y `App.tsx` no necesita un estado `abierto` aparte.
 *
 * Vive en su propio archivo, y no como una sección más de Ajustes, porque es un diálogo
 * independiente: se abre desde un botón de Ajustes (que cierra Ajustes al hacerlo) y también
 * desde el menú nativo de escritorio (acción `'acerca'`).
 */
import type { RefObject } from 'react';
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

export function About({ dialogRef }: {
  readonly dialogRef: RefObject<HTMLDialogElement | null>;
}) {
  const S = useStrings();
  return (
    <dialog ref={dialogRef} className="acerca" aria-labelledby="acerca-nombre">
      <button type="button" className="acerca-cerrar" aria-label={S.app.cerrar} onClick={() => dialogRef.current?.close()}>×</button>
      {/* `logo` es la misma clase de la marca de la barra (LILA-206, Modernist): comparte su
          redondeo de 7 px en vez de inventar otro radio en `app.css`, que el design system del
          artefacto no permite fuera de esa única regla. */}
      <img className="logo acerca-icono" src={`${import.meta.env.BASE_URL}branding/app-icon.png`} alt="" width="104" height="104" />
      <strong id="acerca-nombre">{S.bienvenida.nombre}</strong>
      <p className="acerca-version">v{version}</p>
      <p className="acerca-marca">{MARCA_1}</p>
      <p className="acerca-marca">{MARCA_2}</p>
    </dialog>
  );
}
