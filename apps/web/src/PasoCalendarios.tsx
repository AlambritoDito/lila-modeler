/**
 * Step «Calendars» of the Simulate panel (#333). Since Lote M (C3) it is the calendar manager:
 * a compact list with the templates on top and one calendar's editor at a time, whose «Used by»
 * tab replaces the old «Go to Resources» hint (a calendar is assigned to a resource from here).
 * The per-shift capacity of a pool is still edited on the pool, in Resources.
 */
import { GestorCalendarios } from './GestorCalendarios.js';
import { type Contexto } from './escenarioModelo.js';
import { useStrings } from './i18n';

export function PasoCalendarios({
  ctx,
  onIrARecursos,
}: {
  ctx: Contexto;
  /** «Used by» jumps to a resource's step, where its capacity and shifts are edited. */
  onIrARecursos: () => void;
}): React.JSX.Element {
  const S = useStrings();
  return (
    <details open>
      <summary>{S.escenario.seccionCalendarios}</summary>
      <GestorCalendarios ctx={ctx} onIrARecursos={onIrARecursos} />
    </details>
  );
}
