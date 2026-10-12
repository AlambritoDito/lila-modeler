/**
 * Step «Resources» of the Simulate panel, master-detail (Lote M, C2; design 02).
 *
 * The list is compact —name, calendar, capacity, cost per hour— with «+ New resource» on top, and
 * choosing or creating one opens its sheet (`FichaRecurso`) **in the same place**: no jump to the
 * end of a long list (the baseline scrolled 1636 px by itself here). A new resource is written at
 * once with the minimal valid body (`capacity: 1`) under a free key (`resource-n`), and its name
 * field takes the focus, so «create a resource with two units» is: + New resource, type the name,
 * press «+».
 *
 * Keyboard: ↑/↓ (Home/End) move along the list, Enter opens the sheet, Escape in the sheet comes
 * back to the row it was opened from.
 *
 * Lanes: «Assign a whole lane» under the list, and — once the shell wires `carrilClic.apply` —
 * a click on a lane's name on the canvas opens «Lane X · n tasks → resource [Assign]» on top.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import type { ProcessIR } from '@lila-modeler/engine';

import { elegirCarril, useCarrilElegido, usePasoRecursos } from './carrilClic.js';
import { esObjeto, esquemaDe, esquemaEntrada, leer, valorVacio, type Contexto } from './escenarioModelo.js';
import { FichaRecurso } from './FichaRecurso.js';
import { useStrings } from './i18n';
import { LaneAssign } from './LaneAssign.js';
import { ListaElementos, resumenRecursos, type PropsListaPaso } from './ListaElementos.js';
import { claveNueva, nombreRecurso, problemasBajo, recursosDe, turnosDe } from './recursosModelo.js';

export function PasoRecursos({
  ctx,
  ir,
  avanzado,
}: {
  ctx: Contexto;
  ir: ProcessIR | null;
  avanzado: boolean;
}): React.JSX.Element {
  const S = useStrings();
  usePasoRecursos();
  const carrilElegido = useCarrilElegido();
  const recursos = recursosDe(ctx.resuelto);
  const claves = Object.keys(recursos);

  /** The resource whose sheet is open, or `null` for the list. */
  const [abierto, setAbierto] = useState<string | null>(null);
  /** Just created: its sheet focuses the name. */
  const [recienCreado, setRecienCreado] = useState<string | null>(null);
  /** The last one opened: the list block offers it first, and Tab lands on its row. */
  const [reciente, setReciente] = useState<string | null>(null);
  /** The row that gets the focus when the list comes back. */
  const [enfocarFila, setEnfocarFila] = useState<string | null>(null);
  const lista = useRef<HTMLUListElement>(null);

  // A lane clicked on the canvas is answered on the list, so a sheet in the way closes.
  useEffect(() => {
    if (carrilElegido !== null) setAbierto(null);
  }, [carrilElegido]);

  // A sheet whose resource is gone (deleted, undone, another scenario) goes back to the list.
  const existe = abierto !== null && (claves.includes(abierto) || abierto === recienCreado);
  useEffect(() => {
    if (abierto !== null && !existe) setAbierto(null);
  }, [abierto, existe]);

  useEffect(() => {
    if (enfocarFila === null || abierto !== null) return;
    const fila = [...(lista.current?.querySelectorAll<HTMLButtonElement>('button.rec-fila') ?? [])].find(
      (b) => b.dataset['clave'] === enfocarFila,
    );
    setEnfocarFila(null);
    if (fila === undefined) return;
    fila.focus({ preventScroll: true });
    fila.scrollIntoView?.({ block: 'nearest' });
  }, [enfocarFila, abierto]);

  const moneda = useMemo(() => {
    const run = ctx.resuelto['run'];
    const valor = esObjeto(run) ? run['currency'] : undefined;
    return typeof valor === 'string' && valor !== '' ? valor : 'USD';
  }, [ctx.resuelto]);

  function abrir(clave: string): void {
    elegirCarril(null);
    setAbierto(clave);
    setReciente(clave);
  }

  function crear(): void {
    const clave = claveNueva(claves, S.recursos.prefijoClave);
    ctx.editar(['resources', clave], valorVacio(esquemaEntrada(esquemaDe('resources'))));
    setRecienCreado(clave);
    abrir(clave);
  }

  if (abierto !== null && existe) {
    return (
      <section className="rec-paso-recursos" aria-label={S.recursos.lista}>
        <FichaRecurso
          clave={abierto}
          ctx={ctx}
          ir={ir}
          avanzado={avanzado}
          enfocarNombre={abierto === recienCreado}
          onVolver={() => {
            setEnfocarFila(abierto);
            setRecienCreado(null);
            setAbierto(null);
          }}
          onRenombrar={(nueva) => {
            if (recienCreado === abierto) setRecienCreado(nueva);
            setAbierto(nueva);
            setReciente(nueva);
          }}
        />
      </section>
    );
  }

  /** ↑/↓/Home/End move the focus between rows; Enter is the button's own click. */
  function mover(e: React.KeyboardEvent<HTMLUListElement>): void {
    const filas = [...(lista.current?.querySelectorAll<HTMLButtonElement>('button.rec-fila') ?? [])];
    const actual = filas.indexOf(document.activeElement as HTMLButtonElement);
    const destino =
      e.key === 'ArrowDown' ? Math.min(filas.length - 1, actual + 1)
        : e.key === 'ArrowUp' ? Math.max(0, actual - 1)
          : e.key === 'Home' ? 0
            : e.key === 'End' ? filas.length - 1
              : null;
    if (destino === null || filas.length === 0) return;
    e.preventDefault();
    filas[destino]?.focus();
  }

  /** The row that takes Tab: the last one opened, or the first. */
  const filaConTab = reciente !== null && claves.includes(reciente) ? reciente : claves[0];

  return (
    <section className="rec-paso-recursos" aria-label={S.recursos.lista}>
      {claves.length === 0 ? (
        <div className="rec-vacio">
          <strong>{S.recursos.vacioTitulo}</strong>
          <p>{S.recursos.vacioTexto}</p>
          <button type="button" className="boton primario" onClick={crear}>
            {S.recursos.nuevo}
          </button>
        </div>
      ) : (
        <>
          <button type="button" className="boton primario rec-nuevo" onClick={crear}>
            {S.recursos.nuevo}
          </button>
          {carrilElegido !== null && (
            <LaneAssign
              ir={ir}
              ctx={ctx}
              avanzado={avanzado}
              carrilFijo={carrilElegido}
              recursoInicial={reciente}
              onCerrar={() => {
                elegirCarril(null);
              }}
            />
          )}
          <div className="rec-lista">
            <div className="rec-fila rec-cabecera" aria-hidden="true">
              <span>{S.recursos.colRecurso}</span>
              <span>{S.recursos.colCapacidad}</span>
              <span>{S.recursos.colCosto(moneda)}</span>
            </div>
            <ul ref={lista} aria-label={S.recursos.lista} onKeyDown={mover}>
              {claves.map((clave) => {
                const recurso = recursos[clave];
                const turnos = turnosDe(recurso);
                const capacidad = recurso?.['capacity'];
                const calendario = recurso?.['calendar'];
                const coste = recurso?.['costPerHour'];
                const errores = problemasBajo(ctx, `resources.${clave}`);
                const nombre = nombreRecurso(clave, recurso);
                return (
                  <li key={clave}>
                    <button
                      type="button"
                      className={errores > 0 ? 'rec-fila error' : 'rec-fila'}
                      data-clave={clave}
                      tabIndex={clave === filaConTab ? 0 : -1}
                      onClick={() => {
                        abrir(clave);
                      }}
                    >
                      <span className="rec-celda-nombre">
                        <span className="rec-nombre">
                          {nombre}
                          {avanzado && nombre !== clave && <span className="id mono"> {clave}</span>}
                        </span>
                        <span className="rec-calendario">
                          {turnos !== null
                            ? S.recursos.porTurnos
                            : typeof calendario === 'string' && calendario !== ''
                              ? calendario
                              : S.recursos.siempre}
                        </span>
                      </span>
                      <span className="rec-num">
                        {turnos !== null
                          ? S.recursos.turnos(turnos.length)
                          : S.recursos.capacidadFija(typeof capacidad === 'number' ? String(capacidad) : '?')}
                      </span>
                      <span className="rec-num">
                        {typeof coste === 'number' ? coste.toFixed(2) : (0).toFixed(2)}
                        <span className="rec-oculto"> {S.recursos.colCosto(moneda)}</span>
                      </span>
                      {errores > 0 && <span className="rec-oculto">{S.recursos.conErrores(errores)}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <LaneAssign ir={ir} ctx={ctx} avanzado={avanzado} recursoInicial={reciente} />
        </>
      )}
    </section>
  );
}

/** The tasks with the resources already assigned to each. */
export function ListaRecursos({ ids, rotulo, resuelto, seleccion, onSeleccionar }: PropsListaPaso): React.JSX.Element | null {
  const S = useStrings();
  return (
    <ListaElementos
      titulo={S.escenario.listaRecursos}
      ids={ids}
      rotulo={rotulo}
      resumen={(id) => resumenRecursos(leer(resuelto, ['elements', id, 'resources']), S, resuelto['resources'])}
      seleccion={seleccion}
      onSeleccionar={onSeleccionar}
    />
  );
}
