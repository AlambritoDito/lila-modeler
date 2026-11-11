/**
 * #722: the model's errors while editing.
 *
 * The live reparse of the canvas (`App.tsx`) already runs `validateBpmnModel`, the same call the
 * Run gate makes (`simulationGate.ts`). These two pure functions decide what of its `errors` the
 * status bar, the canvas markers and the validation list show, so nothing is validated twice and
 * no rule of the engine is repeated here.
 */
import type { ValidatedBpmnModel } from '@lila-modeler/engine/bpmn';

import type { Problema } from './escenarioModelo';

/** One error of the engine's model validation, as the live reparse keeps it. */
export interface ErrorDeModelo {
  /** The engine's code (`E-NOSOP`, `E-INALCANZABLE`…) and the BPMN id it is about: the keys. */
  code: string;
  id: string;
  /** The engine's text, verbatim, in the language it was asked for. */
  message: string;
  /** `true` when the error is about the process as a whole (`E-SIN-START`, `E-SIN-END`). */
  proceso: boolean;
}

/**
 * #722: the model errors shown while editing are the ones Run is going to raise — the `errors` of
 * the same `validateBpmnModel` the gate calls, not a second check — so the status bar and Run agree.
 *
 * The one exception is #409: a process with nothing drawn in it («New») is not an error until the
 * first shape is drawn, so its `E-SIN-START`/`E-SIN-END` are left for Run to say.
 */
export function erroresDeModeloEnVivo(informe: Pick<ValidatedBpmnModel, 'ir' | 'errors'>): ErrorDeModelo[] {
  const vacio = Object.keys(informe.ir.nodes).length === 0 && informe.errors.every((p) => p.code === 'E-SIN-START' || p.code === 'E-SIN-END');
  if (vacio) return [];
  return informe.errors.map((p) => ({ code: p.code, id: p.id, message: p.message, proceso: p.id === informe.ir.id }));
}

/**
 * The live model errors as problems of the validation list (#455, #722).
 *
 * In Model a construct the simulator does not run is a warning: the diagram is correct BPMN (#455).
 * The parser leaves those elements and their flows out of the graph, so while there is one the
 * structural errors may only be its consequence (the tasks behind an unsupported boundary event are
 * `E-INALCANZABLE`) and they follow it: warnings in Model, errors everywhere else. Without one they
 * are errors in every mode. Run is the same in all cases: it refuses every one of them.
 */
export function problemasDeModelo(errores: readonly ErrorDeModelo[], enModelar: boolean): Problema[] {
  const aviso = enModelar && errores.some((p) => p.code === 'E-NOSOP');
  return errores.map((p) => ({
    // A path outside `elements` has no shape to mark and no step that owns it; `codigo` keeps a
    // structural problem out of the steps too (`pasoDeProblema`): it is fixed in the diagram.
    ruta: p.proceso ? 'model' : `elements.${p.id}`,
    mensaje: p.message,
    severidad: aviso ? 'warning' : 'error',
    codigo: p.code,
  }));
}
