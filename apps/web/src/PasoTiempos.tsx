/**
 * Step «Times» of the Simulate panel (Lote M, split out of the old Parameters step): how long each
 * activity and timer takes. The step has no section of its own: the selected element's form shows
 * its `processingTime` and `fixedCost` (`CAMPOS_DE_PASO.times`), and the list below says which
 * tasks already have a time.
 */
import { leer } from './escenarioModelo.js';
import { ListaElementos, resumenDistribucion, type PropsListaPaso } from './ListaElementos.js';
import { useStrings } from './i18n';

/** The tasks and timers with the processing time already written on each. */
export function ListaTiempos({ ids, rotulo, resuelto, unidad, seleccion, onSeleccionar }: PropsListaPaso): React.JSX.Element | null {
  const S = useStrings();
  return (
    <ListaElementos
      titulo={S.escenario.listaTiempos}
      ids={ids}
      rotulo={rotulo}
      resumen={(id) =>
        resumenDistribucion(id, 'processingTime', leer(resuelto, ['elements', id, 'processingTime']), unidad, S)}
      seleccion={seleccion}
      onSeleccionar={onSeleccionar}
    />
  );
}
