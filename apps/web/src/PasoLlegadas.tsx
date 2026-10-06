/**
 * Step «Arrivals» of the Simulate panel (#333, redesigned in Lote M after the owner's design):
 * how cases enter the process.
 *
 * With one start event — or the one selected — the step is its card: the arrival pattern (time
 * between arrivals, the derived rate, the calendar arrivals follow) and the limits (maximum
 * cases). With several and none selected, the list of start events says what each one already
 * has. The design's «cases per arrival» is not drawn: it is the reserved `batch` (§ 4), which the
 * engine rejects, so offering it would only produce an error.
 *
 * The two sections are visible together instead of being the design's two sub-tabs: they are four
 * controls, and a tab would cost a click to reach something that fits.
 */
import { Problemas, Propiedades } from './Campo.js';
import { esObjeto, esquemaDe, esquemaEntrada, leer, type Contexto } from './escenarioModelo.js';
import { mediaDistribucion } from './etiquetasPaso.js';
import { formatDisplay } from './formatDisplay.js';
import { ListaElementos, resumenDistribucion, type PropsListaPaso } from './ListaElementos.js';
import { useStrings } from './i18n';

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

/** Hours a calendar is open in a week: its weekly `days` ranges (the monthly ones do not repeat weekly). */
export function horasSemana(calendario: unknown): number {
  if (!esObjeto(calendario) || !Array.isArray(calendario['intervals'])) return 0;
  let horas = 0;
  for (const franja of calendario['intervals'] as unknown[]) {
    if (!esObjeto(franja) || !Array.isArray(franja['days'])) continue;
    const desde = minutos(franja['from']);
    const hasta = minutos(franja['to']);
    if (desde === null || hasta === null) continue;
    const largo = hasta > desde ? hasta - desde : hasta + 24 * 60 - desde;
    horas += (largo / 60) * franja['days'].length;
  }
  return horas;
}

function minutos(hhmm: unknown): number | null {
  if (typeof hhmm !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm);
  return m === null ? null : Number(m[1]) * 60 + Number(m[2]);
}

/** The card of one start event: pattern and limits. */
export function FichaLlegada({ id, nombre, ctx }: { id: string; nombre: string; ctx: Contexto }): React.JSX.Element {
  const S = useStrings();
  const P = S.pasosSim;
  const esquema = esquemaEntrada(esquemaDe('elements'));
  const ruta = ['elements', id];
  const media = mediaDistribucion(leer(ctx.resuelto, [...ruta, 'interTriggerTimer']));
  const calendarios = esObjeto(ctx.resuelto['calendars']) ? ctx.resuelto['calendars'] : {};
  const calendario = leer(ctx.resuelto, [...ruta, 'calendar']);
  const elegido = typeof calendario === 'string' ? calendario : '';
  const porHora = media !== null && media > 0 ? 3600 / media : null;
  let tasa: string = P.tasaSinMedia;
  if (porHora !== null) {
    tasa = elegido === ''
      ? P.tasaHora(formatDisplay(porHora))
      : P.tasaSemana(formatDisplay(porHora), formatDisplay(porHora * horasSemana(calendarios[elegido]), 0), elegido);
  }
  const idCalendario = `sim-llegada-calendario-${id}`;
  return (
    <div className="sim-ficha">
      <p className="sim-ficha-titulo">{P.inicioDe(nombre)}</p>
      <section className="sim-seccion" aria-label={P.patron}>
        <p className="sim-seccion-titulo">{P.patron}</p>
        <Propiedades esquema={esquema} ruta={ruta} ctx={ctx} visibles={['interTriggerTimer']} siDefinido={['interTriggerTimer']} />
        <p className="sim-dato">{tasa}</p>
        <div className="campo-schema">
          <label htmlFor={idCalendario}>{P.soloDentro}</label>
          <select
            id={idCalendario}
            value={elegido}
            onChange={(e) => {
              if (e.target.value === '') ctx.quitar([...ruta, 'calendar']);
              else ctx.editar([...ruta, 'calendar'], e.target.value);
            }}
          >
            <option value="">{P.siempre}</option>
            {Object.keys(calendarios).map((clave) => (
              <option key={clave} value={clave}>{clave}</option>
            ))}
          </select>
        </div>
      </section>
      <section className="sim-seccion" aria-label={P.limites}>
        <p className="sim-seccion-titulo">{P.limites}</p>
        <Propiedades esquema={esquema} ruta={ruta} ctx={ctx} visibles={['triggerCount']} siDefinido={['triggerCount']} />
        <p className="ayuda">{P.limitesAyuda}</p>
      </section>
      <Problemas ruta={ruta} ctx={ctx} />
    </div>
  );
}
