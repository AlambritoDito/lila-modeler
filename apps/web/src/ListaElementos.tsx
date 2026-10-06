/**
 * The element rows of the Simulate panel: the button that selects an element (#447) and the
 * per-step list of elements with what is already written on each (#333), plus the one-line
 * summaries those lists print. Shared by the Parameters, Resources and Arrivals steps.
 */
import { esObjeto } from './escenarioModelo.js';
import { aUnidad, esTiempoEnSegundos, type UnidadTiempo } from './scenarioFields.js';
import { useStrings } from './i18n';

/** #447: what an element reads — its name, or its id when it has none — plus the id with «Advanced». */
export interface Rotulo {
  readonly principal: string;
  readonly id?: string;
}

/**
 * A row that selects an element. `data-id` is the key (tests and QA click by it), so the visible
 * text is free to be the name; the id, when shown, goes in its own mono span.
 */
export function BotonElemento({
  id,
  rotulo,
  onSeleccionar,
}: {
  id: string;
  rotulo: Rotulo;
  onSeleccionar: (id: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="enlace"
      data-id={id}
      onClick={() => {
        onSeleccionar(id);
      }}
    >
      {rotulo.principal}
      {rotulo.id !== undefined && <span className="id mono"> {rotulo.id}</span>}
    </button>
  );
}

/**
 * A distribution as one line: «Constant 5 min», «Uniform 1 / 5 min», or «—» when there is none.
 *
 * The unit is `run.baseTimeUnit` and it is written once at the end, because every time parameter
 * of the same distribution shares it (R1, R2). Counts and shapes (`k`, `alpha`, `n`) are printed
 * as they are: `esTiempoEnSegundos` is the same table the form uses to decide what to scale.
 */
export function resumenDistribucion(
  id: string,
  campo: string,
  valor: unknown,
  unidad: UnidadTiempo,
  S: ReturnType<typeof useStrings>,
): string {
  if (!esObjeto(valor) || typeof valor['type'] !== 'string') return S.escenario.sinResumen;
  const etiqueta = S.escenario.distribuciones[valor['type']] ?? valor['type'];
  let hayTiempo = false;
  const numeros: string[] = [];
  for (const [clave, sub] of Object.entries(valor)) {
    if (clave === 'type' || typeof sub !== 'number') continue;
    if (esTiempoEnSegundos(['elements', id, campo, clave])) {
      hayTiempo = true;
      numeros.push(String(aUnidad(sub, unidad)));
    } else {
      numeros.push(String(sub));
    }
  }
  if (numeros.length === 0) return etiqueta;
  return `${etiqueta} ${numeros.join(' / ')}${hayTiempo ? ` ${S.escenario.unidades[unidad]}` : ''}`;
}

/** `elements[id].resources` as one line: «cashier ×1, till ×2», or «—» when there is none. */
export function resumenRecursos(valor: unknown, S: ReturnType<typeof useStrings>): string {
  if (!Array.isArray(valor) || valor.length === 0) return S.escenario.sinResumen;
  return valor
    .map((entrada) => {
      if (!esObjeto(entrada) || typeof entrada['ref'] !== 'string') return S.escenario.sinResumen;
      const cantidad = typeof entrada['quantity'] === 'number' ? entrada['quantity'] : 1;
      return S.escenario.resumenAsignacion(entrada['ref'], cantidad);
    })
    .join(', ');
}

/**
 * The elements a step is about, with what is already written on each one.
 *
 * This is the half of the step the selected-element form cannot give: the form answers "what does
 * this task take", the list answers "which tasks have nothing yet", which is the question you
 * actually have while filling in a level. A row selects the element on the canvas, so the list is
 * also a way of walking the diagram without hunting for boxes.
 *
 * Each row reads the element's name (#447); `BotonElemento` keeps the id as its `data-id`.
 */
export function ListaElementos({
  titulo,
  ids,
  rotulo,
  resumen,
  seleccion,
  onSeleccionar,
}: {
  titulo: string;
  ids: readonly string[];
  rotulo: (id: string) => Rotulo;
  resumen: (id: string) => string;
  seleccion: string | null;
  onSeleccionar: (id: string) => void;
}): React.JSX.Element | null {
  if (ids.length === 0) return null;
  return (
    <div className="lista-paso">
      <p className="etiqueta">{titulo}</p>
      <ul className="ids">
        {ids.map((id) => (
          <li key={id} className={id === seleccion ? 'activa' : undefined}>
            <BotonElemento id={id} rotulo={rotulo(id)} onSeleccionar={onSeleccionar} />
            <span className="resumen">{resumen(id)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What every step list needs from the panel: the rows to show and how to read and select them. */
export interface PropsListaPaso {
  /** The ids the step is about, in the order the diagram declares them. */
  ids: readonly string[];
  rotulo: (id: string) => Rotulo;
  /** The resolved scenario (`extends` applied), which the summaries read. */
  resuelto: Record<string, unknown>;
  /** `run.baseTimeUnit`, the unit the summaries print durations in. */
  unidad: UnidadTiempo;
  seleccion: string | null;
  onSeleccionar: (id: string) => void;
}
