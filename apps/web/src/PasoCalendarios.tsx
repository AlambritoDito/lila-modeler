/**
 * Step «Calendars» of the Simulate panel (#333): the weekly grids. Until #396 the pool editor
 * showed up here as well, because a pool's `calendar` and per-shift `capacity` live inside it; now
 * every control is in exactly one step, so the pools stay in Resources and this step says where
 * they went.
 */
import { Campo } from './Campo.js';
import { esquemaDe, type Contexto } from './escenarioModelo.js';
import { useStrings } from './i18n';

export function PasoCalendarios({
  ctx,
  onIrARecursos,
}: {
  ctx: Contexto;
  /** «Go to Resources»: where the pools' calendars and per-shift capacity are edited. */
  onIrARecursos: () => void;
}): React.JSX.Element {
  const S = useStrings();
  return (
    <details open>
      <summary>{S.escenario.seccionCalendarios}</summary>
      <Campo
        esquema={esquemaDe('calendars')}
        ruta={['calendars']}
        etiqueta="calendars"
        requerido={false}
        ctx={ctx}
      />
      <p className="ayuda">
        {S.escenario.calendariosDePools}{' '}
        <button type="button" className="boton" onClick={() => { onIrARecursos(); }}>
          {S.escenario.irARecursos}
        </button>
      </p>
    </details>
  );
}
