/**
 * Step «Times» of the Simulate panel (Lote M, split out of the old Parameters step and redesigned
 * after the owner's design): how long each activity and timer takes.
 *
 * Without a selection the step is the list of tasks and timers with their mean duration
 * («≈ 1.25 h (75 min)») or «No duration» in the error colour — «which task still has no time» at
 * a glance. With one selected, the panel draws its `processingTime` and `fixedCost` form
 * (`CAMPOS_DE_PASO.times`, every distribution of the schema) and `ResumenTiempo` adds the mean
 * duration under it, or says the duration is missing.
 */
import { leer, type Contexto } from './escenarioModelo.js';
import { mediaDistribucion } from './etiquetasPaso.js';
import { formatDisplayDurationWithUnit } from './formatDisplay.js';
import { ListaElementos, type PropsListaPaso } from './ListaElementos.js';
import type { UnidadTiempo } from './scenarioFields.js';
import { useStrings } from './i18n';

/** The tasks and timers with their mean duration; `tareas` are the ones a missing time is a problem for. */
export function ListaTiempos({
  ids,
  tareas,
  rotulo,
  resuelto,
  unidad,
  seleccion,
  onSeleccionar,
}: PropsListaPaso & { tareas: ReadonlySet<string> }): React.JSX.Element | null {
  const S = useStrings();
  const media = (id: string): number | null => mediaDistribucion(leer(resuelto, ['elements', id, 'processingTime']));
  return (
    <ListaElementos
      titulo={S.escenario.listaTiempos}
      ids={ids}
      rotulo={rotulo}
      resumen={(id) => {
        const m = media(id);
        if (m !== null) return `≈ ${formatDisplayDurationWithUnit(m, unidad)}`;
        return tareas.has(id) ? S.pasosSim.sinDuracion : S.escenario.sinResumen;
      }}
      falta={(id) => tareas.has(id) && media(id) === null}
      seleccion={seleccion}
      onSeleccionar={onSeleccionar}
    />
  );
}

/** Under the selected element's form: its mean duration, or that a task has none. */
export function ResumenTiempo({
  id,
  esTarea,
  ctx,
  unidad,
}: {
  id: string;
  esTarea: boolean;
  ctx: Contexto;
  unidad: UnidadTiempo;
}): React.JSX.Element | null {
  const S = useStrings();
  const media = mediaDistribucion(leer(ctx.resuelto, ['elements', id, 'processingTime']));
  if (media === null) {
    return esTarea ? <p className="sim-falta">{S.pasosSim.faltaDuracion}</p> : null;
  }
  return (
    <div className="sim-dato sim-dato-fila">
      <span>{S.pasosSim.duracionMedia}</span>
      <span className="mono">{formatDisplayDurationWithUnit(media, unidad)}</span>
    </div>
  );
}
