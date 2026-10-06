/**
 * Lote M, C2: the sheet of one resource, drawn in place of the list (design 02, «← Resources»).
 *
 * Three tabs, as in the design: **Capacity** (fixed units or shifts, `CampoCapacidadRecurso`),
 * **Costs** (`costPerHour`, `fixedCost` in `run.currency`) and **Calendar and use** (`calendar`,
 * `type`, the tasks that use it and «Assign a whole lane»). A tab with an error carries a «!» and
 * the count, so a problem never hides behind the tab that is not open. Escape goes back to the
 * list from anywhere in the sheet.
 *
 * Every control keeps the id the generic form gave it (`campo-resources.<id>.<field>`), which is
 * what the tests and the QA scripts click by.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ProcessIR } from '@lila-modeler/engine';

import { CampoCapacidadRecurso } from './CampoCapacidadRecurso.js';
import { EntradaNumero, Problemas, Propiedades } from './Campo.js';
import { resumenSelector, type Intervalo } from './CalendarEditor.js';
import { esObjeto, esquemaDe, esquemaEntrada, leer, type Contexto, type Ruta } from './escenarioModelo.js';
import { formatDisplay } from './formatDisplay.js';
import { useStrings } from './i18n';
import { LaneAssign, nombreDeCarril } from './LaneAssign.js';
import { carrilesDelPanel } from './laneToPool.js';
import { useCarriles } from './carrilClic.js';
import {
  derivadosDe,
  horasSemana,
  motivoRenombrar,
  nombraRecurso,
  nombreRecurso,
  problemasBajo,
  renombrarRecurso,
  tareasDeRecurso,
  turnosDe,
  type MotivoClave,
} from './recursosModelo.js';

export const APARTADOS = ['cap', 'cost', 'uso'] as const;
export type Apartado = (typeof APARTADOS)[number];

/** Which tab a field lives in, for the «!» of each tab. */
const CAMPOS_DE_APARTADO: Record<Apartado, readonly string[]> = {
  cap: ['capacity'],
  cost: ['costPerHour', 'fixedCost'],
  uso: ['calendar', 'type', 'name', 'priority', 'preempt'],
};

/** `run.currency` of the resolved scenario, or the engine's default. */
function monedaDe(ctx: Contexto): string {
  const run = ctx.resuelto['run'];
  const moneda = esObjeto(run) ? run['currency'] : undefined;
  return typeof moneda === 'string' && moneda !== '' ? moneda : 'USD';
}

export function FichaRecurso({
  clave,
  ctx,
  ir,
  avanzado,
  enfocarNombre,
  onVolver,
  onRenombrar,
}: {
  clave: string;
  ctx: Contexto;
  ir: ProcessIR | null;
  avanzado: boolean;
  /** Just created: the name takes the focus, so typing it needs no click. */
  enfocarNombre: boolean;
  onVolver: () => void;
  /** The key was renamed (with «Advanced»): the step follows it to the new one. */
  onRenombrar?: (nueva: string) => void;
}): React.JSX.Element {
  const S = useStrings();
  const [apartado, setApartado] = useState<Apartado>('cap');
  const raiz = useRef<HTMLDivElement>(null);
  const nombreRef = useRef<HTMLInputElement>(null);
  const pestanas = useRef<Partial<Record<Apartado, HTMLButtonElement | null>>>({});

  const rutaRecurso: Ruta = ['resources', clave];
  const recurso = leer(ctx.resuelto, rutaRecurso);
  const datos = esObjeto(recurso) ? recurso : {};
  const idBase = `campo-resources.${clave}`;
  const moneda = monedaDe(ctx);

  // Focus without scrolling: the sheet opens where the list was, so nothing has to move (the
  // baseline jumped 1636 px here). Only if its header is above the scrolled view is it brought in.
  useEffect(() => {
    const caja = raiz.current;
    if (caja === null) return;
    const objetivo = enfocarNombre ? nombreRef.current : caja.querySelector<HTMLElement>('.rec-volver');
    objetivo?.focus({ preventScroll: true });
    if (caja.getBoundingClientRect().top < 0) caja.scrollIntoView?.({ block: 'nearest' });
    // Only on opening: a later render (or a rename) must not steal the focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const errores = (a: Apartado): number =>
    CAMPOS_DE_APARTADO[a].reduce((n, campo) => n + problemasBajo(ctx, `resources.${clave}.${campo}`), 0);

  function moverPestana(e: React.KeyboardEvent, actual: Apartado): void {
    const i = APARTADOS.indexOf(actual);
    const siguiente =
      e.key === 'ArrowRight' ? APARTADOS[(i + 1) % APARTADOS.length]
        : e.key === 'ArrowLeft' ? APARTADOS[(i + APARTADOS.length - 1) % APARTADOS.length]
          : e.key === 'Home' ? APARTADOS[0]
            : e.key === 'End' ? APARTADOS[APARTADOS.length - 1]
              : undefined;
    if (siguiente === undefined) return;
    e.preventDefault();
    setApartado(siguiente);
    pestanas.current[siguiente]?.focus();
  }

  const nombreVisible = nombreRecurso(clave, datos);
  const turnos = turnosDe(datos);
  const tablaCalendarios = esObjeto(ctx.resuelto['calendars']) ? ctx.resuelto['calendars'] : {};
  const calendarios = Object.keys(tablaCalendarios);
  const calendario = typeof datos['calendar'] === 'string' ? datos['calendar'] : '';
  const opcionesCalendario = calendario !== '' && !calendarios.includes(calendario) ? [calendario, ...calendarios] : calendarios;
  const tareas = tareasDeRecurso(ctx.resuelto, clave);
  const visuales = useCarriles();
  const carriles = useMemo(() => carrilesDelPanel(ir, visuales), [ir, visuales]);
  const costeHora = typeof datos['costPerHour'] === 'number' ? datos['costPerHour'] : 0;
  const costeFijo = typeof datos['fixedCost'] === 'number' ? datos['fixedCost'] : 0;

  /** Descendant scenarios that name this resource themselves: deleting it would break them. */
  const escenarios = ctx.escenarios ?? {};
  const usadoEnDerivados = derivadosDe(ctx).filter((h) => nombraRecurso(escenarios[h] ?? {}, clave));
  const [confirmarEliminar, setConfirmarEliminar] = useState(false);

  function eliminar(): void {
    ctx.quitar(rutaRecurso);
    onVolver();
  }

  function resumenCalendario(id: string): string {
    const cal = tablaCalendarios[id];
    const intervals = esObjeto(cal) && Array.isArray(cal['intervals']) ? (cal['intervals'] as Intervalo[]) : [];
    const resumen = intervals.map((i) => resumenSelector(i, S.calendario)).join(', ');
    return S.recursos.horasSemana(formatDisplay(horasSemana(cal)), resumen);
  }

  /** The lane a task sits in, named as the lane list names it (never its raw id). */
  function carrilDe(id: string): string | null {
    const carril = carriles.find((c) => c.tareas.includes(id));
    return carril === undefined ? null : nombreDeCarril(carriles, carril, S.recursos.carrilSinNombre);
  }

  function nombreTarea(id: string): string {
    const nombre = ir?.nodes[id]?.name;
    return nombre !== undefined && nombre.trim() !== '' ? nombre : id;
  }

  return (
    <div
      ref={raiz}
      className="rec-ficha"
      data-clave={clave}
      onKeyDown={(e) => {
        // Escape goes back to the list, unless a native select is open (it closes itself first).
        if (e.key !== 'Escape' || e.defaultPrevented) return;
        e.preventDefault();
        e.stopPropagation();
        onVolver();
      }}
    >
      <div className="rec-ficha-cabecera">
        <button type="button" className="boton rec-volver" onClick={onVolver}>
          {S.recursos.volver}
        </button>
        <span className="rec-ficha-titulo">
          {nombreVisible}
          {avanzado && nombreVisible !== clave && <span className="id mono"> {clave}</span>}
        </span>
      </div>

      <div className="campo-schema">
        <label htmlFor={`${idBase}.name`}>{S.recursos.nombre}</label>
        <input
          ref={nombreRef}
          id={`${idBase}.name`}
          type="text"
          placeholder={S.recursos.ejemploNombre}
          value={typeof datos['name'] === 'string' ? datos['name'] : ''}
          onChange={(e) => {
            if (e.target.value === '') ctx.quitar([...rutaRecurso, 'name']);
            else ctx.editar([...rutaRecurso, 'name'], e.target.value);
          }}
        />
        <Problemas ruta={[...rutaRecurso, 'name']} ctx={ctx} />
      </div>

      {avanzado && <CampoClaveRecurso clave={clave} ctx={ctx} onRenombrar={onRenombrar} />}

      <div className="rec-pestanas" role="tablist" aria-label={S.recursos.apartados}>
        {APARTADOS.map((a) => (
          <button
            key={a}
            ref={(b) => {
              pestanas.current[a] = b;
            }}
            type="button"
            role="tab"
            id={`rec-tab-${a}`}
            aria-selected={a === apartado}
            aria-controls={`rec-panel-${a}`}
            tabIndex={a === apartado ? 0 : -1}
            className={a === apartado ? 'rec-pestana activa' : 'rec-pestana'}
            onClick={() => {
              setApartado(a);
            }}
            onKeyDown={(e) => {
              moverPestana(e, a);
            }}
          >
            {S.recursos.apartado[a]}
            {errores(a) > 0 && (
              <span className="rec-insignia" title={S.recursos.conErrores(errores(a))}>
                ! {errores(a)}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="rec-panel" role="tabpanel" id={`rec-panel-${apartado}`} aria-labelledby={`rec-tab-${apartado}`}>
        {apartado === 'cap' && (
          <CampoCapacidadRecurso ruta={[...rutaRecurso, 'capacity']} ctx={ctx} />
        )}

        {apartado === 'cost' && (
          <>
            <div className="rec-dos">
              <div className="campo-schema">
                <label htmlFor={`${idBase}.costPerHour`}>{S.recursos.porHora(moneda)}</label>
                <EntradaNumero valor={datos['costPerHour']} ruta={[...rutaRecurso, 'costPerHour']} ctx={ctx} id={`${idBase}.costPerHour`} />
                <Problemas ruta={[...rutaRecurso, 'costPerHour']} ctx={ctx} />
              </div>
              <div className="campo-schema">
                <label htmlFor={`${idBase}.fixedCost`}>{S.recursos.fijoPorUso(moneda)}</label>
                <EntradaNumero valor={datos['fixedCost']} ruta={[...rutaRecurso, 'fixedCost']} ctx={ctx} id={`${idBase}.fixedCost`} />
                <Problemas ruta={[...rutaRecurso, 'fixedCost']} ctx={ctx} />
              </div>
            </div>
            <p className="ayuda">{S.escenario.ayudas['costPerHour']}</p>
            <p className="rec-vista">{S.recursos.costoEjemplo((costeFijo + costeHora).toFixed(2), moneda)}</p>
          </>
        )}

        {apartado === 'uso' && (
          <>
            <div className="campo-schema">
              <label htmlFor={`${idBase}.calendar`}>{S.recursos.calendario}</label>
              <select
                id={`${idBase}.calendar`}
                value={calendario}
                disabled={turnos !== null && calendario === ''}
                onChange={(e) => {
                  if (e.target.value === '') ctx.quitar([...rutaRecurso, 'calendar']);
                  else ctx.editar([...rutaRecurso, 'calendar'], e.target.value);
                }}
              >
                <option value="">{turnos !== null ? S.recursos.porTurnos : S.recursos.calendarioSiempre}</option>
                {opcionesCalendario.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p className="ayuda">
                {turnos !== null
                  ? S.recursos.calendarioPorTurnos
                  : calendario !== ''
                    ? resumenCalendario(calendario)
                    : S.recursos.sinCalendario}
              </p>
              <Problemas ruta={[...rutaRecurso, 'calendar']} ctx={ctx} />
            </div>

            <div className="campo-schema">
              <label htmlFor={`${idBase}.type`}>{S.recursos.tipo}</label>
              <select
                id={`${idBase}.type`}
                value={typeof datos['type'] === 'string' ? datos['type'] : 'role'}
                onChange={(e) => {
                  ctx.editar([...rutaRecurso, 'type'], e.target.value);
                }}
              >
                {['role', 'equipment'].map((t) => (
                  <option key={t} value={t}>
                    {S.recursos.tipos[t] ?? t}
                  </option>
                ))}
              </select>
              <Problemas ruta={[...rutaRecurso, 'type']} ctx={ctx} />
            </div>

            {/* Reserved fields (§ 4) only show up when the file already has them, to be removed. */}
            <Propiedades
              esquema={esquemaEntrada(esquemaDe('resources'))}
              ruta={rutaRecurso}
              ctx={ctx}
              visibles={[]}
              siDefinido={['priority', 'preempt']}
            />

            <div className="rec-tareas">
              <span className="etiqueta">{S.recursos.tareas}</span>
              {tareas.length === 0 ? (
                <p className="vacio">{S.recursos.ningunaTarea}</p>
              ) : (
                <ul className="ids">
                  {tareas.map(({ id, cantidad }) => (
                    <li key={id} data-id={id}>
                      {nombreTarea(id)}
                      {avanzado && nombreTarea(id) !== id && <span className="id mono"> {id}</span>}
                      {cantidad !== 1 && <span className="resumen"> {S.recursos.cantidad(cantidad)}</span>}
                      {carrilDe(id) !== null && <span className="resumen"> · {carrilDe(id)}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <LaneAssign ir={ir} ctx={ctx} avanzado={avanzado} recursoFijo={clave} />
          </>
        )}
      </div>

      <Problemas ruta={rutaRecurso} ctx={ctx} />

      {usadoEnDerivados.length > 0 && (
        <p className="ayuda">{S.recursos.eliminarBloqueado(usadoEnDerivados.join(', '))}</p>
      )}
      {confirmarEliminar ? (
        <div className="rec-confirmar" role="alert">
          <p className="aviso">{S.recursos.eliminarUsado(tareas.length)}</p>
          <div className="rec-acciones">
            <button type="button" className="boton rec-eliminar" onClick={eliminar}>
              {S.recursos.eliminarConfirmar}
            </button>
            <button
              type="button"
              className="boton"
              onClick={() => {
                setConfirmarEliminar(false);
              }}
            >
              {S.recursos.eliminarCancelar}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="boton rec-eliminar"
          disabled={usadoEnDerivados.length > 0}
          onClick={() => {
            // Tasks that use it would be left with a dangling reference: ask first.
            if (tareas.length > 0) setConfirmarEliminar(true);
            else eliminar();
          }}
        >
          {S.recursos.eliminar}
        </button>
      )}
    </div>
  );
}

/**
 * The resource's key, with «Advanced» only (#447). It is committed on Enter or on leaving the
 * field, not per keystroke: each rename rewrites the references, and «recurso-1» → «s» → «su»…
 * would make a dozen of them. A key that is empty, taken or declared by the parent is refused
 * with the reason, and the field goes back to the key it had.
 */
function CampoClaveRecurso({
  clave,
  ctx,
  onRenombrar,
}: {
  clave: string;
  ctx: Contexto;
  onRenombrar?: ((nueva: string) => void) | undefined;
}): React.JSX.Element {
  const S = useStrings();
  const [texto, setTexto] = useState<string | null>(null);
  const [motivo, setMotivo] = useState<MotivoClave>(null);
  const id = `campo-resources.${clave}.__clave`;

  function confirmar(): void {
    if (texto === null) return;
    const nueva = texto.trim();
    const razon = motivoRenombrar(ctx, clave, nueva);
    setMotivo(razon);
    setTexto(null);
    if (razon !== null || nueva === clave) return;
    renombrarRecurso(ctx, clave, nueva);
    onRenombrar?.(nueva);
  }

  return (
    <div className="campo-schema">
      <label htmlFor={id}>{S.recursos.clave}</label>
      <input
        id={id}
        type="text"
        className="mono"
        value={texto ?? clave}
        aria-invalid={motivo !== null ? true : undefined}
        onChange={(e) => {
          setTexto(e.target.value);
          setMotivo(null);
        }}
        onBlur={confirmar}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            confirmar();
          }
        }}
      />
      {motivo !== null && (
        <p role="alert" className="error">
          {S.recursos.claveMotivo[motivo]}
        </p>
      )}
    </div>
  );
}
