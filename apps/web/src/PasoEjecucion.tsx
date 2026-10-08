/**
 * Step «Run» of the Simulate panel (Lote M, split out of the old Parameters step and redesigned
 * after the owner's design): `run` whole, in three groups — the horizon (base time unit, start,
 * duration, warmup), the replications (count and seed) and «Advanced» (service level, currency and
 * the reserved timezone) — so no field of the old Parameters step is lost.
 *
 * Differences from the design, on purpose: the groups are visible together instead of sub-tabs
 * (seven fields fit, a tab would cost a click); the start is a full date and the times follow
 * `run.baseTimeUnit` (the design fixes «Mon 08:00» and days); and there is no «confidence %»
 * field, because the engine's interval is a fixed 95 % (`result.schema.ts`) — the step says so.
 */
import { Problemas, Propiedades } from './Campo.js';
import { esquemaDe, type Contexto } from './escenarioModelo.js';
import { useStrings } from './i18n';

/** The `run` fields of each group, in the order they are drawn. */
export const GRUPOS_EJECUCION = {
  horizonte: ['baseTimeUnit', 'start', 'duration', 'warmup'],
  replicas: ['replications', 'seed'],
  avanzado: ['serviceLevel', 'currency', 'timezone'],
} as const;

export function PasoEjecucion({ ctx }: { ctx: Contexto }): React.JSX.Element {
  const S = useStrings();
  const P = S.pasosSim;
  const esquema = esquemaDe('run');
  const grupo = (campos: readonly string[]): React.JSX.Element => (
    <Propiedades esquema={esquema} ruta={['run']} ctx={ctx} visibles={campos} siDefinido={campos} />
  );
  return (
    <details open className="sim-ejecucion">
      <summary>{S.escenario.seccionCorrida}</summary>
      <section className="sim-seccion" aria-label={P.horizonte}>
        <p className="sim-seccion-titulo">{P.horizonte}</p>
        {grupo(GRUPOS_EJECUCION.horizonte)}
        <p className="ayuda">{P.calentamientoAyuda}</p>
      </section>
      <section className="sim-seccion" aria-label={P.replicas}>
        <p className="sim-seccion-titulo">{P.replicas}</p>
        {grupo(GRUPOS_EJECUCION.replicas)}
        <p className="ayuda">{P.replicasAyuda} {P.confianza}</p>
      </section>
      <section className="sim-seccion" aria-label={P.avanzado}>
        <p className="sim-seccion-titulo">{P.avanzado}</p>
        {grupo(GRUPOS_EJECUCION.avanzado)}
      </section>
      <Problemas ruta={['run']} ctx={ctx} />
    </details>
  );
}
