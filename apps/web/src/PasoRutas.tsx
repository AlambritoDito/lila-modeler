/**
 * Step «Routes» of the Simulate panel (Lote M, C4, design screen 04): what share of the cases each
 * exit of a gateway takes, written and read in percent.
 *
 * - Nothing selected: the list of splitting gateways, each with its split («Yes 70 % · No 30 %»)
 *   and a pill with the sum, green or red. Picking one opens it.
 * - A gateway (or one of its outgoing flows) selected: its outgoing flows with an inline % field
 *   (↑/↓ ±5, Escape restores, Enter leaves), a stacked bar that adds up to 100 and a status with
 *   the one-click fix («Set «No» to 30 %», «Split evenly»).
 * - A join gateway: a note, it takes no parameters.
 *
 * It replaces the gateway view of the old Parameters step (#332): same path
 * (`elements[flowId].probability`), same engine rules (`repartoRutas.ts` mirrors R-XOR/R-OR), and the
 * file still holds fractions — 70 % is written as 0.7. Per-flow `conditions` (ADR-028) stay in the
 * element section below, which `ScenarioPanel` draws for the selected flow as before.
 */
import { useState } from 'react';
import type { ProcessIR } from '@lila-modeler/engine';

import { Problemas } from './Campo.js';
import { rutaTexto, type Contexto, type Ruta } from './escenarioModelo.js';
import {
  aFraccion,
  compuertaDeSeleccion,
  compuertasRepartibles,
  leerPorcentaje,
  pasoPorcentaje,
  repartoDe,
  repartoIgual,
  resumenReparto,
  type FlujoReparto,
  type Reparto,
} from './repartoRutas.js';
import { useStrings } from './i18n';

export { compuertaDeSeleccion };

/** Segment colours of the bar, from the theme's tokens. */
const COLORES = ['var(--accent-primary)', 'var(--accent-secondary)', 'var(--accent-tertiary)', 'var(--status-info)', 'var(--fg-muted)'];
const colorDe = (i: number): string => COLORES[i % COLORES.length]!;

export interface PropsPasoRutas {
  ctx: Contexto;
  ir: ProcessIR | null;
  /** The selected element (IR id), or `null`. */
  seleccion: string | null;
  onSeleccionar: (id: string | null) => void;
  /** Settings → «Advanced» (#447): ids next to the names. */
  avanzado?: boolean;
}

export function PasoRutas({ ctx, ir, seleccion, onSeleccionar, avanzado = false }: PropsPasoRutas): React.JSX.Element {
  const S = useStrings();
  const R = S.rutas;
  if (ir === null) return <p className="vacio">{R.listaVacia}</p>;

  const compuerta = compuertaDeSeleccion(ir, seleccion);
  if (compuerta !== null) {
    // The selected flow is the one just edited: focusing a field — here or on the canvas — selects
    // its flow, so the one-click fix moves another one instead of undoing it.
    const flujoSeleccionado = seleccion !== compuerta ? seleccion : null;
    const reparto = repartoDe(ir, compuerta, ctx.resuelto, flujoSeleccionado)!;
    return (
      <VistaCompuerta
        reparto={reparto}
        ctx={ctx}
        avanzado={avanzado}
        flujoSeleccionado={flujoSeleccionado}
        onEnfocar={onSeleccionar}
        onVolver={() => { onSeleccionar(null); }}
      />
    );
  }

  const nodo = seleccion === null ? undefined : ir.nodes[seleccion];
  if (nodo !== undefined && (nodo.type === 'xor' || nodo.type === 'or')) {
    return <p className="vacio">{nodo.outgoing.length === 0 ? S.escenario.compuertaSinSalientes : R.union}</p>;
  }

  const ids = compuertasRepartibles(ir);
  if (ids.length === 0) return <p className="vacio rutas-vacio">{R.listaVacia}</p>;
  return (
    <div className="rutas">
      <p className="etiqueta">{R.listaTitulo}</p>
      <ul className="rutas-lista">
        {ids.map((id) => {
          const reparto = repartoDe(ir, id, ctx.resuelto)!;
          return (
            <li key={id}>
              <button type="button" className="rutas-fila" data-id={id} onClick={() => { onSeleccionar(id); }}>
                <span className="rutas-rombo" aria-hidden="true" />
                <span className="rutas-fila-texto">
                  <span className="rutas-fila-nombre">
                    {reparto.nombre}
                    {avanzado && reparto.nombre !== id && <span className="id mono"> {id}</span>}
                  </span>
                  <span className="rutas-fila-resumen">{resumenReparto(reparto)}</span>
                </span>
                {reparto.clase === 'xor' && (
                  <span className={reparto.cuadra ? 'rutas-pildora ok' : 'rutas-pildora mal'}>{R.sumaPildora(reparto.suma)}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="ayuda">{R.listaAyuda}</p>
    </div>
  );
}

function VistaCompuerta({
  reparto,
  ctx,
  avanzado,
  flujoSeleccionado,
  onEnfocar,
  onVolver,
}: {
  reparto: Reparto;
  ctx: Contexto;
  avanzado: boolean;
  flujoSeleccionado: string | null;
  /** A flow's field got the focus: select that flow. */
  onEnfocar: (flujo: string) => void;
  onVolver: () => void;
}): React.JSX.Element {
  const S = useStrings();
  const R = S.rutas;
  const xor = reparto.clase === 'xor';

  const escribir = (flujo: string, porcentaje: number | null): void => {
    const ruta: Ruta = ['elements', flujo, 'probability'];
    if (porcentaje === null) ctx.quitar(ruta);
    else ctx.editar(ruta, aFraccion(porcentaje));
  };
  const escribirVarios = (cambios: readonly { flujo: string; porcentaje: number }[]): void => {
    const lista = cambios.map((c) => ({ ruta: ['elements', c.flujo, 'probability'] as Ruta, valor: aFraccion(c.porcentaje) }));
    if (ctx.editarVarios !== undefined) ctx.editarVarios(lista);
    else for (const c of lista) ctx.editar(c.ruta, c.valor);
  };

  const ancho = reparto.suma > 0 ? Math.max(100, reparto.suma) : 100;
  return (
    <div className="rutas">
      <button type="button" className="enlace rutas-volver" onClick={onVolver}>{R.volver}</button>
      <div className="rutas-cabecera">
        <strong>{R.flujosSalientes}</strong>
        <span className="rutas-tipo">{xor ? R.tipoXor : R.tipoOr}</span>
      </div>
      {xor && (
        <div
          className={reparto.cuadra ? 'rutas-barra' : 'rutas-barra mal'}
          role="img"
          aria-label={R.barraAria(resumenReparto(reparto), reparto.suma)}
        >
          {reparto.flujos.map((f, i) => (
            <span key={f.id} style={{ width: `${(f.efectivo / ancho) * 100}%`, background: colorDe(i) }} />
          ))}
        </div>
      )}
      <ul className="rutas-flujos">
        {reparto.flujos.map((f, i) => (
          <FilaFlujo
            key={f.id}
            flujo={f}
            color={colorDe(i)}
            ctx={ctx}
            avanzado={avanzado}
            activa={f.id === flujoSeleccionado}
            onEnfocar={() => { if (f.id !== flujoSeleccionado) onEnfocar(f.id); }}
            onCambiar={(p) => {
              escribir(f.id, p);
            }}
          />
        ))}
      </ul>
      {xor && (
        <div role="status" className={reparto.cuadra ? 'rutas-estado ok' : 'rutas-estado mal'}>
          <strong>{reparto.cuadra ? R.suma100 : R.sumaMal(reparto.suma, reparto.diferencia)}</strong>
          <span>{reparto.cuadra ? R.listo : reparto.suma === 0 ? R.sumaCero : R.sumaMalCuerpo}</span>
          {!reparto.cuadra && (
            <span className="rutas-arreglos">
              {reparto.arreglo !== null && (
                <button
                  type="button"
                  className="boton primario"
                  onClick={() => {
                    const { flujo, porcentaje } = reparto.arreglo!;
                    escribir(flujo, porcentaje);
                  }}
                >
                  {R.arreglo(reparto.arreglo.etiqueta, reparto.arreglo.porcentaje)}
                </button>
              )}
              <button type="button" className="boton" onClick={() => { escribirVarios(repartoIgual(reparto)); }}>
                {R.repartirIgual}
              </button>
            </span>
          )}
        </div>
      )}
      <p className="ayuda">{R.notaTeclas}</p>
    </div>
  );
}

function FilaFlujo({
  flujo,
  color,
  ctx,
  avanzado,
  activa,
  onEnfocar,
  onCambiar,
}: {
  flujo: FlujoReparto;
  color: string;
  ctx: Contexto;
  avanzado: boolean;
  activa: boolean;
  onEnfocar: () => void;
  onCambiar: (porcentaje: number | null) => void;
}): React.JSX.Element {
  const S = useStrings();
  const R = S.rutas;
  // While focused the field shows what was typed («7», «70,»), not the value re-read from the file.
  const [texto, setTexto] = useState<string | null>(null);
  const [alEnfocar, setAlEnfocar] = useState('');
  const ruta: Ruta = ['elements', flujo.id, 'probability'];
  const idCampo = `rutas-${rutaTexto(ruta)}`;
  const guardado = flujo.porcentaje === null ? '' : String(flujo.porcentaje);
  const mostrado = texto ?? guardado;
  // Not a number from 0 to 100: shown invalid and not written (nothing is clamped silently).
  const invalido = texto !== null && leerPorcentaje(texto) === null;
  const idAviso = `${idCampo}-invalido`;

  const escribir = (bruto: string): void => {
    setTexto(bruto);
    const leido = leerPorcentaje(bruto);
    if (leido !== null) onCambiar(leido === 'vacio' ? null : leido);
  };

  return (
    <li className={['rutas-flujo', ...(activa ? ['activa'] : []), ...(invalido ? ['invalido'] : [])].join(' ')} data-id={flujo.id}>
      <span className="rutas-color" style={{ background: color }} aria-hidden="true" />
      <span className="rutas-flujo-texto">
        <label htmlFor={idCampo} className="rutas-flujo-nombre">
          {flujo.etiqueta}
          {avanzado && flujo.etiqueta !== flujo.id && <span className="id mono"> {flujo.id}</span>}
        </label>
        <span className="rutas-destino">{R.haciaDestino(flujo.destino)}</span>
        {flujo.porDefecto && <span className="rutas-destino">{R.porDefecto}</span>}
        {invalido && <span className="rutas-invalido" id={idAviso} role="alert">{R.invalido}</span>}
        <Problemas ruta={ruta} ctx={ctx} />
      </span>
      {flujo.porDefecto ? (
        <span className="rutas-campo rutas-campo-fijo" id={idCampo}>{R.porciento(flujo.efectivo)}</span>
      ) : (
        <span className="rutas-campo">
          <input
            id={idCampo}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label={R.porcentajeDe(flujo.etiqueta)}
            placeholder={String(flujo.efectivo)}
            value={mostrado}
            aria-invalid={invalido}
            aria-describedby={invalido ? idAviso : undefined}
            onFocus={(e) => {
              setAlEnfocar(guardado);
              // Like the canvas field: typing replaces the value instead of appending to it («4045»).
              e.currentTarget.select();
              onEnfocar();
            }}
            onChange={(e) => { escribir(e.target.value); }}
            onBlur={() => { setTexto(null); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                const leido = leerPorcentaje(mostrado);
                escribir(String(pasoPorcentaje(typeof leido === 'number' ? leido : flujo.efectivo, e.key === 'ArrowUp')));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (mostrado !== alEnfocar) escribir(alEnfocar);
                e.currentTarget.blur();
              }
            }}
          />
          <span className="rutas-unidad" aria-hidden="true">%</span>
        </span>
      )}
    </li>
  );
}
