/**
 * The calendar manager of the Calendars step (Lote M, C3; screen 03 of the design).
 *
 * A compact list with «New calendar» and the templates on top, and the editor of **one** calendar
 * at a time below, split in four tabs: Week (the hour grid), Holidays, Repetitions (monthly and
 * yearly ranges, #82) and Used by (who reads it, and «Assign to a resource»). Until beta.21 the
 * step drew every calendar's whole editor one after the other, a new calendar was born empty
 * (E-CAL-VACIO) while the range picker already showed Mon–Fri 09–18, and a calendar was assigned
 * from the resource, after «Go to Resources» dropped the person in the middle of another list.
 *
 * Nothing here changes the format: the key of `calendars` is the name (renaming rewrites the
 * references, `renombrarCalendario`), templates are presets of `intervals` and «Used by» is
 * derived from the resolved scenario (`usadoPor`).
 */
import { useEffect, useRef, useState } from 'react';

import { Campo, Problemas } from './Campo.js';
import { CampoFestivos, CampoIntervalos } from './CamposCalendario.js';
import { aCeldas, celda, pintar, tieneMinutos, type Intervalo } from './CalendarEditor.js';
import {
  cambiosDeDelta,
  declaraCalendario,
  descendientesDe,
  esObjeto,
  esquemaDe,
  esquemaEntrada,
  leer,
  nombraCalendario,
  renombrarCalendario,
  renombrarEnDescendiente,
  type Contexto,
} from './escenarioModelo.js';
import { formatDisplay } from './formatDisplay.js';
import { useStrings } from './i18n';
import {
  PLANTILLAS,
  aplicarPlantilla,
  horasSemana,
  intervalosDePlantilla,
  nombreLibre,
  vaciarSemana,
  type Plantilla,
} from './plantillasCalendario.js';
import { recursosAsignables, usadoPor, type Uso } from './usadoPor.js';

export const PESTANAS_CALENDARIO = ['semana', 'festivos', 'repeticiones', 'uso'] as const;
export type PestanaCalendario = (typeof PESTANAS_CALENDARIO)[number];

/** § 4: the calendar's reserved key, shown only when the file carries it. */
const RESERVADO_TZ = 'timezone';

/** The templates that create a calendar with hours; «Blank» is its own button. */
const CON_HORAS = PLANTILLAS.filter((p): p is Exclude<Plantilla, 'enBlanco'> => p !== 'enBlanco');

function intervalosDe(ctx: Contexto, clave: string): Intervalo[] {
  const valor = leer(ctx.resuelto, ['calendars', clave, 'intervals']);
  return (Array.isArray(valor) ? valor : []) as Intervalo[];
}

/** The scenarios that extend the one being edited (QA of #599): a rename has to follow into them. */
function derivados(ctx: Contexto): string[] {
  return ctx.archivo !== undefined && ctx.escenarios !== undefined ? descendientesDe(ctx.archivo, ctx.escenarios) : [];
}

/**
 * After «Used by» switches to Resources, bring that pool into view and focus its first field.
 * The Resources step is another component, so it is found by its `data-clave` (the registry's
 * fieldset; a master-detail row should keep the attribute) two frames later, once it has mounted.
 */
function enfocarRecurso(id: string): void {
  const buscar = (): void => {
    const destino = [...document.querySelectorAll<HTMLElement>('.escenario [data-clave]')].find(
      (el) => el.dataset.clave === id && !el.closest('.gcal'),
    );
    if (destino === undefined) return;
    // Lote M (C2): Resources is master-detail; its row opens the resource's sheet in place.
    if (destino.matches('button.rec-fila')) {
      destino.click();
      return;
    }
    destino.scrollIntoView?.({ block: 'start' });
    (destino.querySelector<HTMLElement>('input, select, button') ?? destino).focus({ preventScroll: true });
  };
  requestAnimationFrame(() => {
    requestAnimationFrame(buscar);
  });
}

/** `true` if the live lint has anything under `calendars.<clave>`. */
function tieneProblemas(ctx: Contexto, clave: string): boolean {
  const prefijo = `calendars.${clave}`;
  for (const ruta of ctx.problemas.keys()) {
    if (ruta === prefijo || ruta.startsWith(`${prefijo}.`) || ruta.startsWith(`${prefijo}[`)) return true;
  }
  return false;
}

export function GestorCalendarios({
  ctx,
  onIrARecursos,
}: {
  ctx: Contexto;
  /** Where a resource of «Used by» is edited. */
  onIrARecursos: () => void;
}): React.JSX.Element {
  const S = useStrings();
  const calendarios = esObjeto(ctx.resuelto['calendars']) ? ctx.resuelto['calendars'] : {};
  const claves = Object.keys(calendarios);
  const [elegido, setElegido] = useState<string | null>(null);
  const [pestana, setPestana] = useState<PestanaCalendario>('semana');
  const [nombreNuevo, setNombreNuevo] = useState('');
  /** The calendar just created: its editor takes the focus once it comes back in `resuelto`. */
  const [recienCreado, setRecienCreado] = useState<string | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const clave = elegido !== null && claves.includes(elegido) ? elegido : (claves[0] ?? null);

  useEffect(() => {
    if (recienCreado === null || clave !== recienCreado) return;
    setRecienCreado(null);
    // No scrolling (QA of #599): the template buttons, the list and the editor header are already
    // in view, and jumping the panel hid the step bar.
    editor.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true });
  });

  const limpio = nombreNuevo.trim();
  const repetido = limpio !== '' && claves.includes(limpio);

  function crear(plantilla: Plantilla): void {
    if (repetido) return;
    const base = limpio !== '' ? limpio : plantilla === 'enBlanco' ? S.gcal.nombreEnBlanco : S.gcal.plantillas[plantilla];
    const nombre = nombreLibre(base, claves);
    // Only the bare entry: `holidays` and the reserved `timezone` are added when someone types them.
    ctx.editar(['calendars', nombre], { intervals: intervalosDePlantilla(plantilla) });
    setNombreNuevo('');
    setElegido(nombre);
    setPestana('semana');
    setRecienCreado(nombre);
  }

  const idNuevo = 'gcal-nuevo';
  return (
    <div className="gcal">
      {claves.length === 0 && (
        <div className="gcal-vacio">
          <strong>{S.gcal.vacioTitulo}</strong>
          <span>{S.gcal.vacioTexto}</span>
        </div>
      )}
      <div className="gcal-crear">
        <label htmlFor={idNuevo} className="etiqueta">
          {S.escenario.nuevoCalendario}
        </label>
        <input
          id={idNuevo}
          type="text"
          placeholder={S.escenario.ejemploCalendario}
          aria-invalid={repetido ? true : undefined}
          value={nombreNuevo}
          onChange={(e) => {
            setNombreNuevo(e.target.value);
          }}
          onKeyDown={(e) => {
            // Enter creates from the first template: a calendar typed by name is born with hours.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && limpio !== '') {
              e.preventDefault();
              crear(CON_HORAS[0]!);
            }
          }}
        />
        {repetido && (
          <p role="alert" className="error">
            {S.escenario.claveRepetida(limpio)}
          </p>
        )}
        <span className="gcal-rotulo">{S.gcal.desdePlantilla}</span>
        <div className="gcal-plantillas">
          {CON_HORAS.map((plantilla) => (
            <button
              key={plantilla}
              type="button"
              className="boton gcal-plantilla"
              disabled={repetido}
              onClick={() => {
                crear(plantilla);
              }}
            >
              {S.gcal.plantillas[plantilla]}
            </button>
          ))}
          <button
            type="button"
            className="boton gcal-plantilla gcal-blanco"
            disabled={repetido}
            title={S.gcal.enBlancoAviso}
            onClick={() => {
              crear('enBlanco');
            }}
          >
            {S.escenario.crearCalendario}
          </button>
        </div>
      </div>

      {claves.length > 0 && (
        <ul className="gcal-lista" aria-label={S.gcal.lista}>
          {claves.map((c) => {
            const usos = usadoPor(ctx.resuelto, c, ctx.ir).length;
            const mal = tieneProblemas(ctx, c);
            return (
              <li key={c}>
                <button
                  type="button"
                  className={mal ? 'gcal-fila con-error' : 'gcal-fila'}
                  aria-current={c === clave ? 'true' : undefined}
                  data-clave={c}
                  onClick={() => {
                    setElegido(c);
                  }}
                >
                  <span className="gcal-nombre">
                    {mal && <span className="gcal-marca" aria-label={S.gcal.conProblemas} role="img">!</span>}
                    {c}
                  </span>
                  <span className="gcal-uso">{usos > 0 ? S.gcal.usadoPorN(usos) : S.gcal.sinUso}</span>
                  <span className="gcal-horas mono">{S.gcal.horasSemana(formatDisplay(horasSemana(intervalosDe(ctx, c))))}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {clave !== null && (
        <EditorCalendario
          key={clave}
          ref={editor}
          clave={clave}
          claves={claves}
          ctx={ctx}
          pestana={pestana}
          onPestana={setPestana}
          onRenombrado={(nuevo) => {
            setElegido(nuevo);
            // The editor remounts under its new key: give the focus back to its name field.
            setRecienCreado(nuevo);
          }}
          onIrARecursos={onIrARecursos}
        />
      )}
    </div>
  );
}

function EditorCalendario({
  ref,
  clave,
  claves,
  ctx,
  pestana,
  onPestana,
  onRenombrado,
  onIrARecursos,
}: {
  ref: React.Ref<HTMLDivElement>;
  clave: string;
  claves: readonly string[];
  ctx: Contexto;
  pestana: PestanaCalendario;
  onPestana: (pestana: PestanaCalendario) => void;
  onRenombrado: (nuevo: string) => void;
  onIrARecursos: () => void;
}): React.JSX.Element {
  const S = useStrings();
  const [borrador, setBorrador] = useState(clave);
  const intervals = intervalosDe(ctx, clave);
  const usos = usadoPor(ctx.resuelto, clave, ctx.ir);
  const tabs = useRef<HTMLDivElement>(null);
  const ruta = ['calendars', clave] as const;

  const nombre = borrador.trim();
  const hijos = derivados(ctx);
  const escenarios = ctx.escenarios ?? {};
  /** A descendant that declares the new name itself would end up with two calendars merged in one. */
  const hijoConNombre = hijos.find((h) => declaraCalendario(escenarios[h] ?? {}, nombre));
  const errorNombre =
    nombre === ''
      ? S.gcal.nombreVacio
      : nombre !== clave && claves.includes(nombre)
        ? S.gcal.nombreRepetido(nombre)
        : nombre !== clave && hijoConNombre !== undefined
          ? S.gcal.nombreEnDerivado(nombre, hijoConNombre)
          : null;
  /** Descendants that name this calendar themselves: deleting it would break them. */
  const usadoEnDerivados = hijos.filter((h) => nombraCalendario(escenarios[h] ?? {}, clave));
  const bloqueado = usos.length > 0 || usadoEnDerivados.length > 0;

  function renombrar(): void {
    if (errorNombre !== null || nombre === clave) {
      if (errorNombre !== null) setBorrador(clave);
      return;
    }
    const delta = ctx.delta ?? ctx.resuelto;
    const despues = renombrarCalendario(delta, ctx.resuelto, ctx.padre ?? null, clave, nombre);
    if (despues === delta) return;
    const cambios = cambiosDeDelta(delta, despues);
    if (ctx.editarVarios !== undefined) ctx.editarVarios(cambios);
    else for (const { ruta: r, valor } of cambios) ctx.editar(r, valor);
    // QA of #599: the scenarios that extend this one follow the rename in the same gesture, or a
    // Duplicate's override stops applying (its KPIs change) and its own references break.
    for (const hijo of hijos) {
      const antes = escenarios[hijo];
      if (antes === undefined) continue;
      const despuesHijo = renombrarEnDescendiente(antes, clave, nombre);
      if (despuesHijo !== antes) ctx.editarArchivo?.(hijo, despuesHijo);
    }
    onRenombrado(nombre);
  }

  const idNombre = `gcal-nombre-${clave}`;
  const idPanel = (p: PestanaCalendario): string => `gcal-panel-${p}`;
  const idTab = (p: PestanaCalendario): string => `gcal-tab-${p}`;
  const conProblemasSemana = ctx.problemas.has(`calendars.${clave}.intervals`);

  return (
    <div className="gcal-editor" ref={ref} data-clave={clave}>
      <div className="gcal-cabecera">
        <input
          id={idNombre}
          type="text"
          aria-label={S.gcal.nombre}
          title={S.gcal.nombre}
          value={borrador}
          aria-invalid={errorNombre !== null ? true : undefined}
          onChange={(e) => {
            setBorrador(e.target.value);
          }}
          onBlur={renombrar}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              renombrar();
            } else if (e.key === 'Escape') {
              setBorrador(clave);
            }
          }}
        />
        <span className="gcal-horas mono">{S.gcal.horasPorSemana(formatDisplay(horasSemana(intervals)))}</span>
        {errorNombre !== null && nombre !== clave && (
          <p role="alert" className="error">
            {errorNombre}
          </p>
        )}
      </div>

      <div className="gcal-pestanas" role="tablist" aria-label={S.gcal.pestanasRotulo} ref={tabs}>
        {PESTANAS_CALENDARIO.map((p, i) => (
          <button
            key={p}
            id={idTab(p)}
            type="button"
            role="tab"
            aria-selected={p === pestana}
            aria-controls={idPanel(p)}
            tabIndex={p === pestana ? 0 : -1}
            onClick={() => {
              onPestana(p);
            }}
            onKeyDown={(e) => {
              const paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (paso === 0) return;
              e.preventDefault();
              const siguiente = PESTANAS_CALENDARIO[(i + paso + PESTANAS_CALENDARIO.length) % PESTANAS_CALENDARIO.length]!;
              onPestana(siguiente);
              tabs.current?.querySelector<HTMLButtonElement>(`#${idTab(siguiente)}`)?.focus();
            }}
          >
            {S.gcal.pestanas[p]}
            {p === 'semana' && conProblemasSemana && <span className="gcal-marca" aria-hidden="true">!</span>}
            {p === 'uso' && <span className="gcal-cuenta">{usos.length}</span>}
          </button>
        ))}
      </div>

      <div className="gcal-panel" role="tabpanel" id={idPanel(pestana)} aria-labelledby={idTab(pestana)}>
        {pestana === 'semana' && (
          <Semana clave={clave} intervals={intervals} ctx={ctx} />
        )}
        {pestana === 'festivos' && <CampoFestivos ruta={[...ruta, 'holidays']} ctx={ctx} />}
        {pestana === 'repeticiones' && (
          <>
            <p className="ayuda">{S.gcal.ayudaRepeticiones}</p>
            <CampoIntervalos
              esquema={esquemaEntrada(esquemaDe('calendars')).properties?.['intervals'] ?? {}}
              ruta={[...ruta, 'intervals']}
              ctx={ctx}
              vista="repeticiones"
            />
          </>
        )}
        {pestana === 'uso' && (
          <UsadoPor clave={clave} usos={usos} derivados={usadoEnDerivados} ctx={ctx} onIrARecursos={onIrARecursos} />
        )}
      </div>

      {/* § 4: the reserved `timezone` only shows up when the file carries it, so it can be removed. */}
      {leer(ctx.resuelto, [...ruta, RESERVADO_TZ]) !== undefined && (
        <Campo
          esquema={esquemaEntrada(esquemaDe('calendars')).properties?.[RESERVADO_TZ] ?? {}}
          ruta={[...ruta, RESERVADO_TZ]}
          etiqueta={S.escenario.campos['timezone'] ?? RESERVADO_TZ}
          requerido={false}
          ctx={ctx}
        />
      )}
      <Problemas ruta={ruta} ctx={ctx} />

      <button
        type="button"
        className="boton gcal-eliminar"
        disabled={bloqueado}
        title={bloqueado ? S.gcal.eliminarBloqueado : undefined}
        onClick={() => {
          ctx.quitar(ruta);
        }}
      >
        {S.gcal.eliminar}
      </button>
    </div>
  );
}

/** Week tab: the empty-week warning, the grid (or the list), and the quick actions. */
function Semana({ clave, intervals, ctx }: { clave: string; intervals: Intervalo[]; ctx: Contexto }): React.JSX.Element {
  const S = useStrings();
  const ruta = ['calendars', clave, 'intervals'] as const;
  const escribir = (nuevos: Intervalo[]): void => {
    ctx.editar(ruta, nuevos);
  };
  const conMinutos = tieneMinutos(intervals);
  return (
    <>
      {intervals.length === 0 && (
        <p role="alert" className="aviso gcal-sin-horas">
          {S.gcal.sinHoras}
        </p>
      )}
      <p className="ayuda">{S.gcal.ayudaSemana}</p>
      <CampoIntervalos esquema={esquemaEntrada(esquemaDe('calendars')).properties?.['intervals'] ?? {}} ruta={ruta} ctx={ctx} vista="semana" />
      <div className="gcal-acciones">
        <button
          type="button"
          className="boton"
          // Copying works on the grid's cells, which only exist for whole hours.
          disabled={conMinutos}
          onClick={() => {
            escribir(copiarLunes(intervals));
          }}
        >
          {S.gcal.copiarLunes}
        </button>
        {CON_HORAS.map((plantilla) => (
          <button
            key={plantilla}
            type="button"
            className="boton"
            onClick={() => {
              escribir(aplicarPlantilla(intervals, plantilla));
            }}
          >
            {S.gcal.plantillas[plantilla]}
          </button>
        ))}
        <button
          type="button"
          className="boton"
          onClick={() => {
            escribir(vaciarSemana(intervals));
          }}
        >
          {S.gcal.vaciar}
        </button>
      </div>
    </>
  );
}

/** «Copy Monday to Mon–Fri»: Tuesday to Friday get Monday's hours; the weekend stays. */
export function copiarLunes(intervals: readonly Intervalo[]): Intervalo[] {
  const celdas = aCeldas(intervals);
  const nuevas = new Set([...celdas].filter((c) => c < celda(1, 0) || c >= celda(5, 0)));
  for (let hora = 0; hora < 24; hora += 1) {
    if (!celdas.has(celda(0, hora))) continue;
    for (let dia = 1; dia <= 4; dia += 1) nuevas.add(celda(dia, hora));
  }
  return pintar(intervals, nuevas);
}

/** «Used by» tab: who reads the calendar, with a jump to Resources, and «Assign to a resource». */
function UsadoPor({
  clave,
  usos,
  derivados: enDerivados,
  ctx,
  onIrARecursos,
}: {
  clave: string;
  usos: readonly Uso[];
  /** Scenarios that extend this one and name the calendar themselves. */
  derivados: readonly string[];
  ctx: Contexto;
  onIrARecursos: () => void;
}): React.JSX.Element {
  const S = useStrings();
  const asignables = recursosAsignables(ctx.resuelto, clave);
  const [elegido, setElegido] = useState<string>('');
  const [hecho, setHecho] = useState<string | null>(null);
  const destino = asignables.some((a) => a.id === elegido) ? elegido : (asignables[0]?.id ?? '');
  const hayRecursos = esObjeto(ctx.resuelto['resources']) && Object.keys(ctx.resuelto['resources']).length > 0;
  const idSelect = `gcal-asignar-${clave}`;
  return (
    <>
      {usos.length === 0 ? (
        <p className="vacio">{S.gcal.nadieLoUsa}</p>
      ) : (
        <ul className="gcal-usos">
          {usos.map((uso, k) => {
            const recurso = uso.tipo === 'recurso' || uso.tipo === 'turno';
            const texto = (
              <>
                <span className="gcal-tipo">{S.gcal.tiposUso[uso.tipo]}</span>
                <span className="gcal-quien">{uso.nombre}</span>
                {uso.capacidad !== undefined && <span className="gcal-detalle">{S.gcal.turnoCapacidad(uso.capacidad)}</span>}
              </>
            );
            // ponytail: index keys; a pool can use the same calendar twice (pool and shift).
            return (
              <li key={k}>
                {recurso ? (
                  <button
                    type="button"
                    className="gcal-uso-fila"
                    aria-label={S.gcal.irA(uso.nombre)}
                    onClick={() => {
                      onIrARecursos();
                      enfocarRecurso(uso.id);
                    }}
                  >
                    {texto}
                    <span aria-hidden="true">→</span>
                  </button>
                ) : (
                  <span className="gcal-uso-fila">{texto}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {enDerivados.length > 0 && <p className="ayuda gcal-derivados">{S.gcal.usadoEnDerivados(enDerivados.join(', '))}</p>}
      <div className="gcal-asignar">
        <label htmlFor={idSelect} className="etiqueta">
          {S.gcal.asignarA}
        </label>
        {!hayRecursos ? (
          <p className="ayuda">
            {S.gcal.sinRecursos}{' '}
            <button type="button" className="boton" onClick={onIrARecursos}>
              {S.escenario.irARecursos}
            </button>
          </p>
        ) : asignables.length === 0 ? (
          <p className="ayuda">{S.gcal.todosAsignados}</p>
        ) : (
          <div className="gcal-asignar-fila">
            <select
              id={idSelect}
              value={destino}
              onChange={(e) => {
                setElegido(e.target.value);
                setHecho(null);
              }}
            >
              {asignables.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.actual !== undefined ? S.gcal.ahoraUsa(a.nombre, a.actual) : a.nombre}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="boton primario"
              onClick={() => {
                const elegidoAhora = asignables.find((a) => a.id === destino);
                if (elegidoAhora === undefined) return;
                ctx.editar(['resources', destino, 'calendar'], clave);
                setHecho(elegidoAhora.nombre);
              }}
            >
              {S.gcal.asignar}
            </button>
          </div>
        )}
        {hecho !== null && (
          <p role="status" className="gcal-hecho">
            {S.gcal.asignado(hecho)}
          </p>
        )}
      </div>
    </>
  );
}
