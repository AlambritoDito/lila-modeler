/**
 * Compare inside Results (Lote M, design 06). «Compare with…» picks the other scenario (one with
 * no current run is simulated when picked, by the shell); this view then shows the six KPIs of the
 * other run with their change against the reference (▼ green = better, ▲ red = worse), the
 * comparison warnings (`compareWarnings`: currency, unit, seed, replications, significance)
 * always in sight, the two read-only maps with the wait difference per task, and, below, the
 * whole of what Compare showed before (`CompareView`: tables per scope, charts, XLSX, every
 * scenario with a current run) in a disclosure.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { formatDisplay } from './formatDisplay';
import { compareWarnings, type CompareRunMeta } from './compareWarnings';
import { kpisDe, tituloKpi, type Kpi } from './PanelResumen';
import { MapasComparados, type MapasComparadosProps } from './MapasComparados';
import type { Corrida } from './BottleneckOverlay';
import { useStrings } from './i18n';

/** A run of one side: what the maps and the KPIs read. */
export type LadoComparado = Omit<Corrida, 'calor'>;

/** Change of one KPI from the reference to the other run. `null` fraction: the reference is 0. */
export interface DeltaKpi {
  kpi: Kpi;
  ref: Kpi;
  fraccion: number | null;
  estado: 'mejora' | 'empeora' | 'igual';
}

/** Pure: the six KPIs of `otro` with their change against `ref` (same order as `kpisDe`). */
export function deltasKpi(ref: LadoComparado, otro: LadoComparado): DeltaKpi[] {
  const a = kpisDe(ref.result, ref.scenario);
  return kpisDe(otro.result, otro.scenario).map((kpi, i) => {
    const base = a[i]!;
    const diferencia = kpi.valor - base.valor;
    // What the screen shows decides «no change»: two values that read the same are the same.
    const igual = kpi.texto === base.texto || diferencia === 0;
    const mejor = kpi.menosEsMejor ? diferencia < 0 : diferencia > 0;
    return {
      kpi, ref: base,
      fraccion: base.valor === 0 ? null : diferencia / Math.abs(base.valor),
      estado: igual ? 'igual' : mejor ? 'mejora' : 'empeora',
    };
  });
}

/** One entry of «Compare with…». */
export interface OpcionComparar {
  id: string;
  nombre: string;
  simulado: boolean;
}

/**
 * The dropdown of «Compare with…» (also «Choose scenario» while comparing): the other scenarios,
 * each marked «Simulated» or «Not simulated · simulated when picked». Esc closes it and gives the
 * focus back to its button; a click outside closes it.
 */
export function MenuComparar({ opciones, onElegir, etiqueta, titulo, className }: {
  opciones: readonly OpcionComparar[];
  onElegir: (id: string) => void;
  etiqueta: string;
  titulo?: string;
  className?: string;
}): React.JSX.Element {
  const S = useStrings();
  const [abierto, setAbierto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const idMenu = useId();
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e: PointerEvent): void => { if (!raiz.current?.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('pointerdown', fuera);
    return () => document.removeEventListener('pointerdown', fuera);
  }, [abierto]);
  return (
    <div className={`c5-comparar-menu ${className ?? ''}`} ref={raiz} onKeyDown={(e) => {
      if (e.key !== 'Escape' || !abierto) return;
      e.preventDefault();
      e.stopPropagation();
      setAbierto(false);
      boton.current?.focus();
    }}>
      <button ref={boton} type="button" className="boton c5-comparar-boton" aria-haspopup="true" aria-expanded={abierto}
        aria-controls={abierto ? idMenu : undefined} title={titulo} onClick={() => setAbierto(!abierto)}>
        {etiqueta} <span aria-hidden="true">▾</span>
      </button>
      {abierto && (
        <div id={idMenu} className="c5-escenario-menu c5-comparar-lista" role="group" aria-label={etiqueta}>
          {opciones.length === 0 ? <p className="vacio">{S.c5.resultados.sinOtros}</p> : (
            <ul className="c5-escenario-lista">
              {opciones.map((o) => (
                <li key={o.id}>
                  <button type="button" className="c5-escenario-fila" onClick={() => { setAbierto(false); onElegir(o.id); }}>
                    <span className="c5-escenario-nombre">{o.nombre}</span>
                    <span className="c5-escenario-sub">{o.simulado ? S.c5.escenario.simulado : S.c5.resultados.seSimulara}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export interface VistaCompararProps {
  referencia: LadoComparado;
  otro: LadoComparado;
  nombreRef: string;
  nombreOtro: string;
  /** Metadata of the two runs, for the comparison warnings (`compareWarnings`). */
  metas: readonly CompareRunMeta[];
  mapas: Omit<MapasComparadosProps, 'referencia' | 'otro' | 'nombreRef' | 'nombreOtro'>;
  opciones: readonly OpcionComparar[];
  onElegir: (id: string) => void;
  onIntercambiar: () => void;
  onCerrar: () => void;
  /** The full comparison (`CompareView`), drawn inside the disclosure. */
  detalle: ReactNode;
}


export function VistaComparar(props: VistaCompararProps): React.JSX.Element {
  const S = useStrings();
  const deltas = deltasKpi(props.referencia, props.otro);
  const avisos = compareWarnings(props.metas).warnings;
  return (
    <section className="c5-comparar" aria-label={`${S.c5.comparar.comparando} ${props.nombreRef} ⇄ ${props.nombreOtro}`}>
      <div className="c5-subbarra c5-comparar-barra">
        <span className="c5-rotulo">{S.c5.comparar.comparando}</span>
        <span className="c5-comparar-nombre">{props.nombreRef}</span>
        <button type="button" className="boton icono" aria-label={S.c5.comparar.intercambiar} title={S.c5.comparar.intercambiar} onClick={props.onIntercambiar}>⇄</button>
        <MenuComparar opciones={props.opciones} onElegir={props.onElegir} etiqueta={props.nombreOtro} titulo={S.c5.comparar.elegir} />
        <span className="c5-hueco" />
        <span className="c5-nota">{S.c5.comparar.leyenda}</span>
        <button type="button" className="boton" onClick={props.onCerrar}>{`${S.c5.comparar.cerrar} ✕`}</button>
      </div>
      <dl className="c5-deltas">
        {deltas.map((d) => (
          <div key={d.kpi.id} title={tituloKpi(d.kpi, props.otro.result)}>
            <dt>{S.c5.resultados.kpis[d.kpi.id]}</dt>
            <dd>
              <span className="c5-delta-valor">{d.kpi.texto}</span>
              <span className={`c5-delta ${d.estado}`} aria-label={S.c5.comparar[d.estado]}>
                {d.estado === 'igual' ? '=' : `${d.kpi.valor > d.ref.valor ? '▲' : '▼'} ${d.fraccion === null ? '' : `${d.fraccion > 0 ? '+' : '−'}${formatDisplay(Math.abs(d.fraccion) * 100)} %`}`}
              </span>
            </dd>
            <dd className="c5-delta-ref">{S.c5.comparar.valorRef(props.nombreRef, d.ref.texto)}</dd>
          </div>
        ))}
      </dl>
      {avisos.length > 0 && (
        <ul className="c5-comparar-avisos" role="note">
          {avisos.map((a) => <li key={a}>{a}</li>)}
        </ul>
      )}
      <MapasComparados {...props.mapas} referencia={props.referencia} otro={props.otro} nombreRef={props.nombreRef} nombreOtro={props.nombreOtro} />
      <details className="c5-comparar-detalle">
        <summary>{S.c5.comparar.detalle}</summary>
        {props.detalle}
      </details>
    </section>
  );
}
