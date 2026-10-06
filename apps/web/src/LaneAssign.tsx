/**
 * LILA-334: «assign lane X to resource Y» in the Resources step.
 *
 * The service-request example needs thirteen identical `resources` edits, one per task, which is the
 * whole reason this control exists. It writes exactly what the person would have written by hand
 * —`elements[task].resources = [{ ref: pool, quantity: 1 }]` for every **task** of the lane— in a
 * single change, so one undo step and one `onCambio` cover the lot. The lane is not stored
 * anywhere: it is read when the button is pressed (see `laneToPool.ts`).
 *
 * Lote M (C2) draws it three ways, one per place the design asks for it:
 *
 * - the list's «Assign a whole lane» block: lane and resource, both chosen;
 * - `carrilFijo`, the lane clicked on the canvas (`carrilClic.ts`): only the resource is asked for;
 * - `recursoFijo`, the resource sheet: only the lane is asked for.
 *
 * Lanes come in the order they are drawn and an unnamed lane reads «Unnamed lane n», never its id
 * (`carrilesDelPanel`). Overwriting is confirmed in React state, not with `window.confirm`: the
 * dialog of the browser is untestable in jsdom, blocks the whole tab, and cannot show **which**
 * tasks are about to lose their resource, which is precisely what the acceptance asks to list.
 */
import { useMemo, useState } from 'react';

import type { ProcessIR } from '@lila-modeler/engine';

import { useCarriles } from './carrilClic.js';
import type { Contexto } from './escenarioModelo.js';
import { useStrings } from './i18n';
import { carrilesDelPanel, laneAssignmentDelta, type CarrilPanel } from './laneToPool.js';
import { nombreRecurso, recursosDe } from './recursosModelo.js';

export interface LaneAssignProps {
  /** IR of the diagram on the canvas; the lanes (without the canvas) and the task names come from here. */
  ir: ProcessIR | null;
  ctx: Contexto;
  /** Settings → «Advanced» (#447): show BPMN ids next to names. */
  avanzado?: boolean;
  /** The lane picked on the canvas (`CarrilPanel.clave`): only the resource is asked for. */
  carrilFijo?: string | null;
  /** The resource whose sheet is open: only the lane is asked for. */
  recursoFijo?: string | null;
  /** The resource offered first in the list block: the last one opened. */
  recursoInicial?: string | null;
  /** Dismisses the canvas-picked lane block. */
  onCerrar?: () => void;
}

/** What a lane reads: its name, or «Unnamed lane n», numbered among the unnamed ones in visual order. */
export function nombreDeCarril(
  carriles: readonly CarrilPanel[],
  carril: CarrilPanel,
  sinNombre: (n: number) => string,
): string {
  if (carril.nombre !== null) return carril.nombre;
  return sinNombre(carriles.filter((c) => c.nombre === null).indexOf(carril) + 1);
}

export function LaneAssign({
  ir,
  ctx,
  avanzado = false,
  carrilFijo = null,
  recursoFijo = null,
  recursoInicial = null,
  onCerrar,
}: LaneAssignProps): React.JSX.Element | null {
  const S = useStrings();
  const visuales = useCarriles();
  const carriles = useMemo(() => carrilesDelPanel(ir, visuales), [ir, visuales]);
  const nombreCarril = (c: CarrilPanel): string => nombreDeCarril(carriles, c, S.recursos.carrilSinNombre);
  const tabla = recursosDe(ctx.resuelto);
  const pools = Object.keys(tabla);

  const [carril, setCarril] = useState<string | null>(null);
  const [pool, setPool] = useState<string | null>(null);
  /** Tasks awaiting confirmation; `null` while there is nothing to overwrite. */
  const [pendientes, setPendientes] = useState<readonly string[] | null>(null);
  /** «3 tasks of X now use Y», until the next change. */
  const [hecho, setHecho] = useState<string | null>(null);

  const porClave = (clave: string | null): CarrilPanel | undefined =>
    clave === null ? undefined : carriles.find((c) => c.clave === clave);
  const elegidoCarril = carrilFijo !== null ? porClave(carrilFijo) : (porClave(carril) ?? carriles[0]);
  const candidatoPool = recursoFijo ?? pool ?? recursoInicial;
  const elegidoPool = candidatoPool !== null && pools.includes(candidatoPool) ? candidatoPool : pools[0];

  // Without lanes (or without a resource to give them) there is nothing to offer: the control
  // hides whole instead of showing empty selectors.
  if (elegidoCarril === undefined || elegidoPool === undefined) return null;
  const carrilActual = elegidoCarril;
  const poolActual = elegidoPool;
  const tareas = carrilActual.tareas;

  function aplicar(): void {
    const { fragment } = laneAssignmentDelta(ctx.resuelto, tareas, poolActual);
    const cambios = Object.entries(fragment.elements).map(([id, elemento]) => ({
      ruta: ['elements', id, 'resources'] as const,
      valor: elemento.resources,
    }));
    if (ctx.editarVarios !== undefined) ctx.editarVarios(cambios);
    else for (const { ruta, valor } of cambios) ctx.editar(ruta, valor);
    setPendientes(null);
    setHecho(S.recursos.carrilHecho(tareas.length, nombreCarril(carrilActual), nombreRecurso(poolActual, tabla[poolActual])));
  }

  function asignar(): void {
    const { alreadyAssigned } = laneAssignmentDelta(ctx.resuelto, tareas, poolActual);
    if (alreadyAssigned.length > 0) {
      setPendientes(alreadyAssigned);
      setHecho(null);
      return;
    }
    aplicar();
  }

  /** BPMN name of the task, when the IR has one; the id is what the scenario keys by. */
  function nombre(id: string): string | null {
    const texto = ir?.nodes[id]?.name;
    return texto !== undefined && texto.trim() !== '' ? texto : null;
  }

  const selectorCarril = (id: string, conRotulo: boolean): React.JSX.Element => (
    <div className="campo-schema">
      <label htmlFor={id} className={conRotulo ? undefined : 'rec-oculto'}>
        {S.escenario.carrilCarril}
      </label>
      <select
        id={id}
        value={carrilActual.clave}
        onChange={(e) => {
          setCarril(e.target.value);
          setPendientes(null);
          setHecho(null);
        }}
      >
        {carriles.map((c) => (
          <option key={c.clave} value={c.clave}>
            {nombreCarril(c)}
          </option>
        ))}
      </select>
    </div>
  );

  const selectorPool = (id: string, conRotulo: boolean): React.JSX.Element => (
    <div className="campo-schema">
      <label htmlFor={id} className={conRotulo ? undefined : 'rec-oculto'}>
        {S.escenario.carrilPool}
      </label>
      <select
        id={id}
        value={poolActual}
        onChange={(e) => {
          setPool(e.target.value);
          setPendientes(null);
          setHecho(null);
        }}
      >
        {pools.map((clave) => (
          <option key={clave} value={clave}>
            {nombreRecurso(clave, tabla[clave])}
          </option>
        ))}
      </select>
    </div>
  );

  const confirmacion = pendientes !== null && (
    <>
      <p className="aviso" role="alert">
        {S.escenario.carrilYaAsignadas(pendientes.length)}
      </p>
      <ul className="ids">
        {pendientes.map((id) => (
          <li key={id} data-id={id}>
            {/* #447: the name, or the id without one; the id beside it only with «Advanced». */}
            {nombre(id) ?? id}
            {avanzado && nombre(id) !== null && <span className="id mono"> {id}</span>}
          </li>
        ))}
      </ul>
      <div className="rec-acciones">
        <button type="button" className="boton primario" onClick={aplicar}>
          {S.escenario.carrilSobrescribir}
        </button>
        <button
          type="button"
          className="boton"
          onClick={() => {
            setPendientes(null);
          }}
        >
          {S.escenario.carrilCancelar}
        </button>
      </div>
    </>
  );
  const estado = hecho !== null && (
    <p className="rec-hecho" role="status">
      ✓ {hecho}
    </p>
  );

  if (carrilFijo !== null) {
    return (
      <div className="carril-a-pool rec-carril-elegido" role="group" aria-label={S.recursos.carrilEntero}>
        <div className="rec-carril-cabecera">
          <strong>{S.recursos.carrilTitulo(nombreCarril(carrilActual), tareas.length)}</strong>
          <button type="button" className="enlace rec-quitar" aria-label={S.recursos.cerrarCarril} onClick={onCerrar}>
            ✕
          </button>
        </div>
        <p className="ayuda">{S.recursos.carrilTituloAyuda}</p>
        <div className="rec-en-linea">
          {selectorPool('carril-elegido-recurso', false)}
          <button type="button" className="boton primario" onClick={asignar}>
            {S.recursos.asignar}
          </button>
        </div>
        {confirmacion}
        {estado}
      </div>
    );
  }

  if (recursoFijo !== null) {
    return (
      <div className="carril-a-pool" role="group" aria-label={S.recursos.carrilEntero}>
        <span className="etiqueta">{S.recursos.carrilEntero}</span>
        <div className="rec-en-linea">
          {selectorCarril('carril-a-recurso-carril', false)}
          <button type="button" className="boton primario" onClick={asignar}>
            {S.recursos.asignar}
          </button>
        </div>
        <p className="ayuda">{S.escenario.carrilAyuda(tareas.length)}</p>
        {confirmacion}
        {estado}
      </div>
    );
  }

  return (
    <div className="carril-a-pool" role="group" aria-label={S.recursos.carrilEntero}>
      <span className="etiqueta">{S.recursos.carrilEntero}</span>
      <p className="ayuda">{S.recursos.carrilEnteroAyuda}</p>
      <div className="rec-dos">
        {selectorCarril('carril-a-pool-carril', true)}
        {selectorPool('carril-a-pool-pool', true)}
      </div>
      <button type="button" className="boton" onClick={asignar}>
        {S.escenario.carrilAsignar}
      </button>
      <p className="ayuda">{S.escenario.carrilAyuda(tareas.length)}</p>
      {confirmacion}
      {estado}
    </div>
  );
}
