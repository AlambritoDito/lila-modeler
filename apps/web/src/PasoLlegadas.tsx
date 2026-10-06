/**
 * Step «Arrivals» of the Simulate panel (#333): how cases enter the process. Arrivals has no
 * section of its own yet — what it shows is the list of start events, in the element section, with
 * the inter-arrival time and the case count already written on each (`ListaLlegadas`).
 */
import { leer } from './escenarioModelo.js';
import { ListaElementos, resumenDistribucion, type PropsListaPaso } from './ListaElementos.js';
import { useStrings } from './i18n';

/** The step's own section, rendered above the element section: empty for now. */
export function PasoLlegadas(): React.JSX.Element | null {
  return null;
}

/** The start events with their inter-arrival time and case count. */
export function ListaLlegadas({ ids, rotulo, resuelto, unidad, seleccion, onSeleccionar }: PropsListaPaso): React.JSX.Element | null {
  const S = useStrings();
  return (
    <ListaElementos
      titulo={S.escenario.listaLlegadas}
      ids={ids}
      rotulo={rotulo}
      resumen={(id) => {
        const casos = leer(resuelto, ['elements', id, 'triggerCount']);
        return S.escenario.resumenLlegada(
          resumenDistribucion(id, 'interTriggerTimer', leer(resuelto, ['elements', id, 'interTriggerTimer']), unidad, S),
          typeof casos === 'number' ? casos : null,
        );
      }}
      seleccion={seleccion}
      onSeleccionar={onSeleccionar}
    />
  );
}
