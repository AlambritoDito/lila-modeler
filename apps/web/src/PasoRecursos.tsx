/**
 * Step «Resources» of the Simulate panel (#333): the pools with their capacity and calendar (#396),
 * the lane-to-pool assignment, and the list of tasks with the resources each one takes.
 */
import type { ProcessIR } from '@lila-modeler/engine';

import { Campo } from './Campo.js';
import { esquemaDe, leer, type Contexto } from './escenarioModelo.js';
import { LaneAssign } from './LaneAssign.js';
import { ListaElementos, resumenRecursos, type PropsListaPaso } from './ListaElementos.js';
import { useStrings } from './i18n';

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
  return (
    <details open>
      <summary>{S.escenario.seccionRecursos}</summary>
      <Campo
        esquema={esquemaDe('resources')}
        ruta={['resources']}
        etiqueta="resources"
        requerido={false}
        ctx={ctx}
      />
      <LaneAssign ir={ir} ctx={ctx} avanzado={avanzado} />
    </details>
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
      resumen={(id) => resumenRecursos(leer(resuelto, ['elements', id, 'resources']), S)}
      seleccion={seleccion}
      onSeleccionar={onSeleccionar}
    />
  );
}
