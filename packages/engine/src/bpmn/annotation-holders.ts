/**
 * Where the annotations of a pool live (#99, QA of #559). The app shows a pool's **description**
 * from the process it references (`processRef`): that is the process's documentation, the one the
 * process document opens with. A pool's **RACI and catalog references** stay on the participant
 * itself, and a process drawn inside a pool is never selected on its own, so RACI written on it is
 * never shown. The web's properties panel and the engine's `annotateLilaElement` both follow these
 * rules, so an agent writes where the app reads.
 *
 * Pure: plain ids and BPMN types, no bpmn-moddle, so the browser bundle can use it.
 */

/** The bits of an element these rules look at: its id, BPMN `$type` and, for a pool, its `processRef` id. */
export interface AnnotationHost {
  readonly id: string;
  readonly type: string;
  readonly processRef?: string | undefined;
}

/**
 * The id of the element that holds the description shown for `element`: the referenced process
 * for a pool that has one, the element itself otherwise.
 */
export function documentationHolder(element: AnnotationHost): string {
  return element.type === 'bpmn:Participant' && element.processRef !== undefined ? element.processRef : element.id;
}

/**
 * The pool whose RACI and references stand for the process `processId`, when a pool references
 * it; `undefined` for a process with no pool (a diagram without a collaboration), which holds its
 * own.
 */
export function poolOfProcess(processId: string, elements: Iterable<AnnotationHost>): string | undefined {
  for (const element of elements) {
    if (element.type === 'bpmn:Participant' && element.processRef === processId) return element.id;
  }
  return undefined;
}
