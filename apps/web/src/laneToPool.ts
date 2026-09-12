/**
 * LILA-334: assign a whole lane to a resource pool in one action.
 *
 * Lanes are labels (`docs/SEMANTICS.md` § 2): the engine does not know them and the scenario
 * format has no place to store them. What this file does is therefore purely a **bulk edit** of
 * `elements[task].resources`, the same per-task field the panel already writes one task at a
 * time. Nothing about the engine, the scenario format or the goldens changes; the lane is read
 * from the IR at the moment of the click and forgotten right after.
 *
 * Two rules the callers depend on:
 *
 * - **Only tasks.** A lane also contains events and gateways, and `validateScenario` rejects
 *   `resources` on anything that is not a task, so they are filtered out here and never reach
 *   the delta.
 * - **The fragment only carries `resources`.** Writing the whole element object into the child
 *   delta would copy the inherited fields of `extends` into the child; writing just the array
 *   replaces it whole, which is what § 6 of `docs/SCENARIO_FORMAT.md` says arrays do.
 */
import type { ProcessIR } from '@lila/engine';

/** One entry of `elements[task].resources`. */
export interface ResourceRef {
  ref: string;
  quantity: number;
}

export interface LaneAssignment {
  /** Scenario fragment to merge into the delta: `elements[id].resources` for each task. */
  fragment: { elements: Record<string, { resources: ResourceRef[] }> };
  /** Tasks of the lane whose **resolved** element already declares a non-empty `resources`. */
  alreadyAssigned: string[];
}

/**
 * `lane label → task ids`, in IR order (which is document order of the BPMN file). Nodes with no
 * lane, and lane members that are not tasks, are left out; a lane with no task at all does not
 * appear, because assigning it would be a no-op.
 */
export function tasksByLane(ir: ProcessIR | null): Map<string, string[]> {
  const porCarril = new Map<string, string[]>();
  if (ir === null) return porCarril;
  for (const [id, node] of Object.entries(ir.nodes)) {
    if (node.type !== 'task' || node.lane === undefined) continue;
    const lista = porCarril.get(node.lane);
    if (lista === undefined) porCarril.set(node.lane, [id]);
    else lista.push(id);
  }
  return porCarril;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** `true` if the resolved element already has a non-empty `resources` array. */
function tieneRecursos(resuelto: Record<string, unknown>, id: string): boolean {
  const elementos = resuelto['elements'];
  if (!esObjeto(elementos)) return false;
  const elemento = elementos[id];
  if (!esObjeto(elemento)) return false;
  const recursos = elemento['resources'];
  return Array.isArray(recursos) && recursos.length > 0;
}

/**
 * The fragment that assigns `pool` (quantity 1) to every task of `taskIds`, plus the list of
 * those tasks that already had resources in `resuelto` — the caller asks for confirmation before
 * applying when that list is not empty.
 *
 * ponytail: quantity is always 1. It is the quantity every example uses and the one the ticket
 * asks for; a task that needs two of a pool is still edited one at a time in the element form.
 */
export function laneAssignmentDelta(
  resuelto: Record<string, unknown>,
  taskIds: readonly string[],
  pool: string,
): LaneAssignment {
  const elements: Record<string, { resources: ResourceRef[] }> = {};
  const alreadyAssigned: string[] = [];
  for (const id of taskIds) {
    elements[id] = { resources: [{ ref: pool, quantity: 1 }] };
    if (tieneRecursos(resuelto, id)) alreadyAssigned.push(id);
  }
  return { fragment: { elements }, alreadyAssigned };
}
