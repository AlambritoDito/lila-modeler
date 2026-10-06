/**
 * Step «Run» of the Simulate panel (Lote M, split out of the old Parameters step): `run` whole,
 * because every one of its fields answers «how long and how many times does this model run».
 */
import { Problemas, Propiedades } from './Campo.js';
import { esquemaDe, type Contexto } from './escenarioModelo.js';
import { useStrings } from './i18n';

export function PasoEjecucion({ ctx }: { ctx: Contexto }): React.JSX.Element {
  const S = useStrings();
  return (
    <details open>
      <summary>{S.escenario.seccionCorrida}</summary>
      <Propiedades esquema={esquemaDe('run')} ruta={['run']} ctx={ctx} />
      <Problemas ruta={['run']} ctx={ctx} />
    </details>
  );
}
