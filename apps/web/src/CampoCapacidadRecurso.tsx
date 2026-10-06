/**
 * `resources[pool].capacity` (LILA-164), extracted from `Campo.tsx` for the resource sheet (Lote M,
 * C2): **Fixed** — units with − / + — or **By shifts**.
 *
 * In the engine a shift is not a «from–to» band: it is `{ calendar, capacity }`, so many units
 * while that calendar is open (R-CAL-11). The design's shift row (name, from, to, units) is
 * therefore translated to «which calendar, how many units», and the hours are edited where they
 * live, in Calendars. A per-shift capacity excludes the resource's own `calendar` (R16), so the
 * switch moves it: Fixed → By shifts turns the calendar into the first shift (none, for a 24/7
 * resource), and back again the first shift's calendar becomes the resource's calendar. Each switch is one write of the delta.
 *
 * The ids are the ones the field always had (`campo-resources.<id>.capacity` for the fixed units,
 * `…capacity[i].calendar` / `…capacity[i].capacity` for a shift), so tests and QA keep finding it.
 */
import { useState } from 'react';

import { EntradaNumero, Problemas } from './Campo.js';
import { esObjeto, leer, rutaTexto, variantes, type Contexto, type EsquemaJson, type Ruta } from './escenarioModelo.js';
import { horasSemana, editarRecurso } from './recursosModelo.js';
import { formatDisplay } from './formatDisplay.js';
import { useStrings } from './i18n';

/** `['resources', <id>, 'capacity']` with a union: the exact shape `ResourceSchema` produces. */
export function esCapacidadRecurso(ruta: Ruta, esquema: EsquemaJson): boolean {
  return ruta.length === 3 && ruta[0] === 'resources' && ruta[2] === 'capacity' && variantes(esquema) !== null;
}

/** A positive whole number of units, or `respaldo`. */
function unidadesDe(valor: unknown, respaldo: number): number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 1 ? valor : respaldo;
}

export function CampoCapacidadRecurso({
  ruta,
  ctx,
}: {
  /** Kept for `Campo`'s call; the two variants are known (number | list of shifts). */
  esquema?: EsquemaJson;
  ruta: Ruta;
  ctx: Contexto;
}): React.JSX.Element {
  const S = useStrings();
  const clave = String(ruta[1]);
  const valor = leer(ctx.resuelto, ruta);
  const porTurno = Array.isArray(valor);
  const idFija = `campo-${rutaTexto(ruta)}`;
  const recurso = leer(ctx.resuelto, ['resources', clave]);
  const tablaCalendarios = esObjeto(ctx.resuelto['calendars']) ? ctx.resuelto['calendars'] : {};
  const calendarios = Object.keys(tablaCalendarios);
  const numero = typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;

  function aTurnos(): void {
    if (porTurno) return;
    // A resource with no calendar works 24/7: its first shift starts with no calendar either
    // (to be chosen), never with someone else's hours, so the round trip comes back unchanged.
    const propio = esObjeto(recurso) ? recurso['calendar'] : undefined;
    const calendario = typeof propio === 'string' && propio !== '' ? propio : '';
    editarRecurso(ctx, clave, {
      capacity: [{ calendar: calendario, capacity: unidadesDe(valor, 1) }],
      calendar: undefined,
    });
  }

  /** By shifts → Fixed with more than one shift asks first: shifts 2+ are discarded. */
  const [descartar, setDescartar] = useState(false);

  function pedirFija(): void {
    if (!porTurno) return;
    if ((valor as unknown[]).length > 1) setDescartar(true);
    else aFija();
  }

  function aFija(): void {
    setDescartar(false);
    if (!porTurno) return;
    const primero = (valor as unknown[])[0];
    const turno = esObjeto(primero) ? primero : {};
    const calendario = typeof turno['calendar'] === 'string' && turno['calendar'] !== '' ? turno['calendar'] : undefined;
    editarRecurso(ctx, clave, { capacity: unidadesDe(turno['capacity'], 1), calendar: calendario });
  }

  /** The next calendar no shift uses yet, so «+ Shift» does not start as a duplicate. */
  function calendarioLibre(): string {
    const usados = new Set((porTurno ? (valor as unknown[]) : []).map((t) => (esObjeto(t) ? t['calendar'] : undefined)));
    return calendarios.find((c) => !usados.has(c)) ?? calendarios[0] ?? '';
  }

  const nombreGrupo = `${idFija}-modo`;
  return (
    <div className="campo-schema rec-capacidad">
      <fieldset className="rec-modo">
        <legend>{S.recursos.capacidad}</legend>
        <label className={porTurno ? 'rec-opcion' : 'rec-opcion activa'}>
          <input type="radio" id={`${idFija}-fija`} name={nombreGrupo} checked={!porTurno} onChange={pedirFija} />
          {S.recursos.fija}
        </label>
        <label className={porTurno ? 'rec-opcion activa' : 'rec-opcion'}>
          <input type="radio" id={`${idFija}-turno`} name={nombreGrupo} checked={porTurno} onChange={aTurnos} />
          {S.recursos.porTurno}
        </label>
      </fieldset>
      {descartar && porTurno && (
        <div className="rec-confirmar" role="alert">
          <p className="aviso">{S.recursos.descartarTurnos((valor as unknown[]).length - 1)}</p>
          <div className="rec-acciones">
            <button type="button" className="boton primario" onClick={aFija}>
              {S.recursos.descartarConfirmar}
            </button>
            <button
              type="button"
              className="boton"
              onClick={() => {
                setDescartar(false);
              }}
            >
              {S.recursos.descartarCancelar}
            </button>
          </div>
        </div>
      )}

      {porTurno ? (
        <div className="rec-turnos">
          {calendarios.length === 0 && <p className="aviso">{S.recursos.sinCalendarios}</p>}
          <div className="rec-turno rec-cabecera" aria-hidden="true">
            <span />
            <span>{S.recursos.turnoCalendario}</span>
            <span>{S.recursos.turnoCapacidad}</span>
            <span />
          </div>
          {(valor as unknown[]).map((_, i) => {
            const rutaTramo = [...ruta, i] as Ruta;
            const rutaCalendar = [...rutaTramo, 'calendar'] as Ruta;
            const rutaCapacidad = [...rutaTramo, 'capacity'] as Ruta;
            const idCalendar = `campo-${rutaTexto(rutaCalendar)}`;
            const idCapacidad = `campo-${rutaTexto(rutaCapacidad)}`;
            const elegido = leer(ctx.resuelto, rutaCalendar);
            // A calendar the scenario names but does not declare stays visible, so it can be fixed.
            const opciones =
              typeof elegido === 'string' && elegido !== '' && !calendarios.includes(elegido)
                ? [elegido, ...calendarios]
                : calendarios;
            const horas = typeof elegido === 'string' ? horasSemana(tablaCalendarios[elegido]) : 0;
            return (
              <div key={i} className="rec-turno-bloque">
                <div className="rec-turno">
                  <span className="rec-turno-n">{S.recursos.turnoN(i + 1)}</span>
                  <label htmlFor={idCalendar} className="rec-oculto">
                    {`${S.recursos.turnoN(i + 1)} · ${S.recursos.turnoCalendario}`}
                  </label>
                  <select
                    id={idCalendar}
                    value={typeof elegido === 'string' ? elegido : ''}
                    onChange={(e) => {
                      ctx.editar(rutaCalendar, e.target.value);
                    }}
                  >
                    <option value="">{S.escenario.sinDefinir}</option>
                    {opciones.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={idCapacidad} className="rec-oculto">
                    {`${S.recursos.turnoN(i + 1)} · ${S.recursos.turnoCapacidad}`}
                  </label>
                  <EntradaNumero valor={leer(ctx.resuelto, rutaCapacidad)} ruta={rutaCapacidad} ctx={ctx} id={idCapacidad} />
                  <button
                    type="button"
                    className="enlace rec-quitar"
                    aria-label={S.recursos.quitarTurno(i + 1)}
                    onClick={() => {
                      ctx.quitar(rutaTramo);
                    }}
                  >
                    ✕
                  </button>
                </div>
                {horas > 0 && <p className="ayuda">{S.recursos.horasSemana(formatDisplay(horas), '')}</p>}
                <Problemas ruta={rutaTramo} ctx={ctx} />
                <Problemas ruta={rutaCalendar} ctx={ctx} />
                <Problemas ruta={rutaCapacidad} ctx={ctx} />
              </div>
            );
          })}
          <button
            type="button"
            className="boton"
            onClick={() => {
              ctx.editar([...ruta, (valor as unknown[]).length], { calendar: calendarioLibre(), capacity: 1 });
            }}
          >
            {S.recursos.anadirTurno}
          </button>
          <p className="ayuda">{S.recursos.ayudaTurnos}</p>
        </div>
      ) : (
        <div className="rec-unidades">
          <label htmlFor={idFija}>{S.recursos.unidades}</label>
          <div className="rec-paso">
            <button
              type="button"
              className="boton"
              aria-label={S.recursos.restar}
              onClick={() => {
                ctx.editar(ruta, Math.max(0, Math.ceil(numero) - 1));
              }}
            >
              −
            </button>
            <EntradaNumero valor={valor} ruta={ruta} ctx={ctx} id={idFija} />
            <button
              type="button"
              className="boton"
              aria-label={S.recursos.sumar}
              onClick={() => {
                ctx.editar(ruta, Math.max(0, Math.floor(numero)) + 1);
              }}
            >
              +
            </button>
          </div>
        </div>
      )}
      {!porTurno && typeof valor === 'number' && valor < 1 && (
        <p className="error" role="alert">
          {S.recursos.capacidadCero}
        </p>
      )}
      <Problemas ruta={ruta} ctx={ctx} />
    </div>
  );
}
