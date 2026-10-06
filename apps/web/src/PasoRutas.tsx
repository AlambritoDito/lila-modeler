/**
 * Step «Routes» of the Simulate panel (Lote M, split out of the old Parameters step): the gateway
 * view (#332) — each outgoing flow with its probability and the sum — and the list of gateways
 * with their split. C4 redesigns this step; this module keeps the behaviour it had in Parameters.
 */
import type { ProcessIR } from '@lila-modeler/engine';

import { Problemas, EntradaNumero } from './Campo.js';
import { leer, rutaTexto, type Contexto, type Ruta } from './escenarioModelo.js';
import { ListaElementos, type PropsListaPaso } from './ListaElementos.js';
import { repartoXor, type ClaseElemento } from './scenarioFields.js';
import { useStrings } from './i18n';

/** What a gateway splits into, as the engine weighs it (R-XOR-1…4 / R-OR-2). */
function repartoDe(ir: ProcessIR, id: string, clase: ClaseElemento, resuelto: unknown): { pesos: number[]; total: number; avisa: boolean } {
  const salientes = ir.nodes[id]?.outgoing ?? [];
  const declaradas = salientes.map((f) => {
    const p = leer(resuelto, ['elements', f, 'probability']);
    return typeof p === 'number' ? p : undefined;
  });
  if (clase === 'xor') return repartoXor(declaradas);
  return {
    pesos: declaradas.map((p) => p ?? 1),
    total: Math.round(declaradas.reduce<number>((acc, p) => acc + (p ?? 1), 0) * 1e6) / 1e6,
    avisa: false,
  };
}

/** The exclusive and inclusive gateways with their «Total» (what has to add up to 1 on an XOR). */
export function ListaRutas({
  ids,
  ir,
  rotulo,
  resuelto,
  seleccion,
  onSeleccionar,
}: PropsListaPaso & { ir: ProcessIR | null }): React.JSX.Element | null {
  const S = useStrings();
  return (
    <ListaElementos
      titulo={S.escenario.listaRutas}
      ids={ids}
      rotulo={rotulo}
      resumen={(id) => {
        const clase = ir?.nodes[id]?.type as ClaseElemento | undefined;
        if (ir === null || clase === undefined) return S.escenario.sinResumen;
        return S.escenario.compuertaSuma(repartoDe(ir, id, clase, resuelto).total);
      }}
      seleccion={seleccion}
      onSeleccionar={onSeleccionar}
    />
  );
}

/**
 * What a flow reads: its BPMN name if it has one, else its target's; the id when there is neither,
 * and next to the name only with «Advanced» (#447).
 */
function rotuloFlujo(ir: ProcessIR, S: ReturnType<typeof useStrings>, id: string, avanzado: boolean): string {
  const flujo = ir.flows[id];
  if (flujo === undefined) return id;
  const nombre = flujo.name !== '' ? flujo.name : (ir.nodes[flujo.to]?.name ?? '');
  // A blank name counts as none (QA S1 of #447): it would leave the label empty.
  if (nombre.trim() === '') return id;
  return avanzado ? `${nombre}${S.escenario.nombreEntreParentesis(id)}` : nombre;
}

/**
 * La vista que hace de una compuerta algo que se parametriza desde el diagrama: sus flujos
 * salientes con su `probability`, la suma, y el aviso cuando no da 1.
 *
 * Sin ella la probabilidad de una rama solo se editaba seleccionando **el flujo**, que en el
 * lienzo es una línea de tres píxeles y que además obliga a recordar cuál es la otra rama para
 * que sumen. La ruta que se escribe es la misma de siempre (`elements[flowId].probability`): esto
 * es otra vista del mismo campo, no un campo nuevo.
 *
 * Solo para XOR e inclusiva: en una AND salen todos los caminos y la probabilidad no significa
 * nada (por eso `fieldsForKind` no la ofrece tampoco en el flujo… que sí la acepta, porque el
 * mismo flujo podría colgar de otra compuerta). La suma se avisa únicamente en la XOR, que es la
 * que R10 normaliza; en la inclusiva cada camino es independiente y no tiene que sumar 1.
 */
export function VistaCompuerta({
  ir,
  id,
  clase,
  ctx,
  avanzado,
}: {
  ir: ProcessIR;
  id: string;
  clase: ClaseElemento;
  ctx: Contexto;
  avanzado: boolean;
}): React.JSX.Element {
  const S = useStrings();
  const salientes = ir.nodes[id]?.outgoing ?? [];
  if (salientes.length === 0) return <p className="vacio">{S.escenario.compuertaSinSalientes}</p>;

  // R-XOR-4: the split is computed the way the engine does (`scenarioFields.ts::repartoXor`),
  // not by adding up only what is declared. A flow without a number — the `isDefault` one
  // included — takes its share of the remainder, so `Total` is the number the engine compares
  // with 1 and the warning appears exactly when the engine would warn.
  const declaradas = salientes.map((f) => {
    const p = leer(ctx.resuelto, ['elements', f, 'probability']);
    return typeof p === 'number' ? p : undefined;
  });
  // R-OR-2: on an inclusive gateway each path is independent, a flow without `probability`
  // weighs 1, and there is no remainder to share nor a sum to normalise.
  const reparto =
    clase === 'xor'
      ? repartoXor(declaradas)
      : {
          pesos: declaradas.map((p) => p ?? 1),
          total: Math.round(declaradas.reduce<number>((acc, p) => acc + (p ?? 1), 0) * 1e6) / 1e6,
          avisa: false,
        };

  return (
    <fieldset className="entrada">
      <legend>{S.escenario.seccionCompuerta}</legend>
      {salientes.map((flujo, i) => {
        const ruta: Ruta = ['elements', flujo, 'probability'];
        const idCampo = `campo-${rutaTexto(ruta)}`;
        // What a flow with no declared number contributes: without showing it, `Total` would
        // come from somewhere that is not on screen.
        const implicito =
          declaradas[i] === undefined && clase === 'xor' ? (
            <span className="etiqueta">{S.escenario.compuertaImplicita(reparto.pesos[i]!)}</span>
          ) : null;
        if (ir.flows[flujo]?.isDefault === true) {
          return (
            <div key={flujo} className="campo-schema">
              <span className="etiqueta">{rotuloFlujo(ir, S, flujo, avanzado)}</span>
              <span className="aviso">{S.escenario.compuertaPorDefecto}</span>
              {implicito}
            </div>
          );
        }
        return (
          <div key={flujo} className="campo-schema">
            <label htmlFor={idCampo}>{rotuloFlujo(ir, S, flujo, avanzado)}</label>
            <EntradaNumero
              valor={leer(ctx.resuelto, ruta)}
              ruta={ruta}
              ctx={ctx}
              id={idCampo}
            />
            {implicito}
            <Problemas ruta={ruta} ctx={ctx} />
          </div>
        );
      })}
      <p className="etiqueta">{S.escenario.compuertaSuma(reparto.total)}</p>
      {clase === 'xor'
        ? reparto.avisa && <p className="aviso">{S.escenario.compuertaSumaAviso}</p>
        : clase === 'or' && <p className="aviso">{S.escenario.compuertaIndependiente}</p>}
    </fieldset>
  );
}
