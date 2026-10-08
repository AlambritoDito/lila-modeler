/**
 * The calendar fields of the scenario panel (`calendars[clave].intervals` and `.holidays`), split
 * out of `Campo.tsx` for the calendar manager (Lote M, C3): `Campo` still routes those paths here,
 * and `GestorCalendarios` draws them one tab at a time.
 *
 * ponytail: this module and `Campo.tsx` import each other. Both only use the other's components
 * at render time, never at module evaluation, so the cycle is harmless in ESM.
 */
import { useState } from 'react';

import { Campo, Problemas } from './Campo.js';
import { CalendarEditor, Festivos, tieneMinutos, type Intervalo } from './CalendarEditor.js';
import { leer, type Contexto, type EsquemaJson, type Ruta } from './escenarioModelo.js';
import { useStrings } from './i18n';

/* ------------------------------------------------------------------ *
 * `calendars[clave].intervals` (LILA-203): rejilla semanal o lista
 * ------------------------------------------------------------------ */

/** `['calendars', <clave>, 'intervals']`: la única ruta donde la rejilla semanal significa algo. */
export function esIntervalosCalendario(ruta: Ruta): boolean {
  return ruta.length === 3 && ruta[0] === 'calendars' && ruta[2] === 'intervals';
}

/**
 * The range picker, the grid of artboard 3 and the toggle to the schema's generic list.
 *
 * The grid is a **partial** view of the format —its cell is a whole hour and § 2.3 accepts any
 * `"HH:MM"`—, so for a calendar with minute slots the grid is hidden, with the warning, and the
 * range picker and the list keep editing it (#448): rounding it to draw it would change the
 * scenario just to show it.
 *
 * ponytail: la lista se dibuja llamando al mismo `Campo` con un `sufijo`, que es lo que corta la
 * recursión (la intercepción de arriba solo mira el campo sin sufijo). Un `Campo` que ya sabe
 * dibujar arrays de objetos desde el esquema no se duplica aquí por tener dos vistas.
 */
export function CampoIntervalos({
  esquema,
  ruta,
  ctx,
  vista = 'todo',
}: {
  esquema: EsquemaJson;
  ruta: Ruta;
  ctx: Contexto;
  /**
   * Lote M (C3): `semana` and `repeticiones` are the two tabs of the calendar manager; the
   * grid/list toggle only exists in `semana` (and `todo`, the editor as it was).
   */
  vista?: 'todo' | 'semana' | 'repeticiones';
}): React.JSX.Element {
  const S = useStrings();
  const [rejilla, setRejilla] = useState(true);
  const valor = leer(ctx.resuelto, ruta);
  const intervals = (Array.isArray(valor) ? valor : []) as Intervalo[];
  const conMinutos = tieneMinutos(intervals);
  const enRejilla = rejilla && !conMinutos;
  if (vista === 'repeticiones') {
    return (
      <div className="campo-schema">
        <CalendarEditor
          intervals={intervals}
          vista="repeticiones"
          onCambio={(nuevos) => {
            ctx.editar(ruta, nuevos);
          }}
        />
        <Problemas ruta={ruta} ctx={ctx} />
      </div>
    );
  }
  return (
    <div className="campo-schema">
      {vista === 'todo' && <span className="etiqueta">{S.escenario.claves.intervals}</span>}
      {conMinutos ? (
        <p className="aviso">{S.escenario.calendarioConMinutos}</p>
      ) : (
        <button
          type="button"
          className="enlace"
          onClick={() => {
            setRejilla(!rejilla);
          }}
        >
          {enRejilla ? S.escenario.editarComoLista : S.escenario.editarComoRejilla}
        </button>
      )}
      {/* #448: the range picker and its list stay in both views; only the grid follows the toggle. */}
      <CalendarEditor
        intervals={intervals}
        rejilla={enRejilla}
        vista={vista}
        onCambio={(nuevos) => {
          // § 6: el array entero en el delta, siempre; un intervalo suelto no significaría nada.
          ctx.editar(ruta, nuevos);
        }}
      />
      {enRejilla ? (
        <Problemas ruta={ruta} ctx={ctx} />
      ) : (
        <Campo esquema={esquema} ruta={ruta} etiqueta="intervals" requerido ctx={ctx} sufijo="-lista" />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * `calendars[clave].holidays` (#82, R-CAL-14): date picker and list
 * ------------------------------------------------------------------ */

/** `['calendars', <clave>, 'holidays']`. */
export function esFestivosCalendario(ruta: Ruta): boolean {
  return ruta.length === 3 && ruta[0] === 'calendars' && ruta[2] === 'holidays';
}

/**
 * The holidays of a calendar with a date picker instead of the schema's generic list of strings.
 * Removing the last one removes the key, so a calendar edited back to no holidays reads as it did
 * before (the file does not grow an empty `holidays: []`).
 */
export function CampoFestivos({ ruta, ctx }: { ruta: Ruta; ctx: Contexto }): React.JSX.Element {
  const S = useStrings();
  const valor = leer(ctx.resuelto, ruta);
  const holidays = Array.isArray(valor) ? valor.filter((f): f is string => typeof f === 'string') : [];
  return (
    <div className="campo-schema">
      <span className="etiqueta">{S.escenario.campos['holidays'] ?? 'holidays'}</span>
      <Festivos
        holidays={holidays}
        onCambio={(nuevos) => {
          // § 6: the whole array in the delta, as with `intervals`.
          if (nuevos.length === 0) ctx.quitar(ruta);
          else ctx.editar(ruta, nuevos);
        }}
      />
      <Problemas ruta={ruta} ctx={ctx} />
    </div>
  );
}
