/**
 * LILA-334: «assign lane X to pool Y» inside the resources section of the scenario panel.
 *
 * The credit-card example needs thirteen identical `resources` edits, one per task, which is the
 * whole reason this control exists. It writes exactly what the person would have written by hand
 * —`elements[task].resources = [{ ref: pool, quantity: 1 }]` for every **task** of the lane— in a
 * single change, so one undo step and one `onCambio` cover the lot. The lane is not stored
 * anywhere: it is read from the IR when the button is pressed (see `laneToPool.ts`).
 *
 * Overwriting is confirmed in React state, not with `window.confirm`: the dialog of the browser
 * is untestable in jsdom, blocks the whole tab, and cannot show **which** tasks are about to lose
 * their pool, which is precisely what the acceptance asks to list.
 */
import { useMemo, useState } from 'react';

import type { ProcessIR } from '@lila/engine';

import { useStrings } from './i18n';
import { laneAssignmentDelta, tasksByLane } from './laneToPool.js';
import type { Contexto } from './ScenarioPanel.js';

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

export interface LaneAssignProps {
  /** IR of the diagram on the canvas; the lanes and the task names come from here. */
  ir: ProcessIR | null;
  ctx: Contexto;
}

export function LaneAssign({ ir, ctx }: LaneAssignProps): React.JSX.Element | null {
  const S = useStrings();
  const porCarril = useMemo(() => tasksByLane(ir), [ir]);
  const carriles = [...porCarril.keys()];
  const pools = esObjeto(ctx.resuelto['resources']) ? Object.keys(ctx.resuelto['resources']) : [];

  const [carril, setCarril] = useState<string | null>(null);
  const [pool, setPool] = useState<string | null>(null);
  /** Tasks awaiting confirmation; `null` while there is nothing to overwrite. */
  const [pendientes, setPendientes] = useState<readonly string[] | null>(null);

  // Sin carriles (o sin pools que asignar) el control no tiene nada que ofrecer: se oculta entero
  // en vez de enseñar dos selectores vacíos.
  if (carriles.length === 0 || pools.length === 0) return null;

  const carrilElegido = carril !== null && porCarril.has(carril) ? carril : carriles[0]!;
  const poolElegido = pool !== null && pools.includes(pool) ? pool : pools[0]!;
  const tareas = porCarril.get(carrilElegido) ?? [];

  function aplicar(): void {
    const { fragment } = laneAssignmentDelta(ctx.resuelto, tareas, poolElegido);
    ctx.editarVarios?.(
      Object.entries(fragment.elements).map(([id, elemento]) => ({
        ruta: ['elements', id, 'resources'],
        valor: elemento.resources,
      })),
    );
    setPendientes(null);
  }

  function asignar(): void {
    const { alreadyAssigned } = laneAssignmentDelta(ctx.resuelto, tareas, poolElegido);
    if (alreadyAssigned.length > 0) {
      setPendientes(alreadyAssigned);
      return;
    }
    aplicar();
  }

  /** BPMN name of the task, when the IR has one; the id is what the scenario keys by. */
  function nombre(id: string): string | null {
    const texto = ir?.nodes[id]?.name;
    return texto !== undefined && texto !== '' ? texto : null;
  }

  return (
    <div className="carril-a-pool">
      <div className="campo-schema">
        <label htmlFor="carril-a-pool-carril">{S.escenario.carrilCarril}</label>
        <select
          id="carril-a-pool-carril"
          value={carrilElegido}
          onChange={(e) => {
            setCarril(e.target.value);
            setPendientes(null);
          }}
        >
          {carriles.map((nombreCarril) => (
            <option key={nombreCarril} value={nombreCarril}>
              {nombreCarril}
            </option>
          ))}
        </select>
      </div>
      <div className="campo-schema">
        <label htmlFor="carril-a-pool-pool">{S.escenario.carrilPool}</label>
        <select
          id="carril-a-pool-pool"
          value={poolElegido}
          onChange={(e) => {
            setPool(e.target.value);
            setPendientes(null);
          }}
        >
          {pools.map((clave) => (
            <option key={clave} value={clave}>
              {clave}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="boton" onClick={asignar}>
        {S.escenario.carrilAsignar}
      </button>
      <p className="vacio">{S.escenario.carrilAyuda(tareas.length)}</p>
      {pendientes !== null && (
        <>
          <p className="aviso" role="alert">
            {S.escenario.carrilYaAsignadas(pendientes.length)}
          </p>
          <ul className="ids">
            {pendientes.map((id) => (
              <li key={id}>
                {id}
                {nombre(id) !== null && <span className="nombre"> {nombre(id)}</span>}
              </li>
            ))}
          </ul>
          <button type="button" className="boton" onClick={aplicar}>
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
        </>
      )}
    </div>
  );
}
