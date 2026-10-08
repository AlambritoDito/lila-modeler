/**
 * The right panel of Results (Lote M): the six KPIs of the run, the engine's bottleneck ranking
 * (`result.bottlenecks`, never recomputed: the same list `lila run` prints) and the detail of the
 * task selected on the map or in the table. It replaces the KPIs and the Bottlenecks tab of the
 * old Simulate dock.
 *
 * `kpisDe` is shared with the comparison (six KPIs with their delta): one definition of what each
 * KPI reads, how it is formatted and which direction is better.
 */
import type { ReactNode } from 'react';
import { formatNumber, SECONDS_PER_UNIT, type BaseTimeUnit } from '@lila-modeler/engine/format';
import type { ResolvedScenario } from '@lila-modeler/engine/schema';
import type { ProcessIR, RunResult } from '@lila-modeler/engine';
import { BottleneckCard } from './ResultsView';
import { exactDuration, formatDisplay, formatDisplayDurationWithUnit } from './formatDisplay';
import { strings, useStrings } from './i18n';

export const KPI_IDS = ['ciclo', 'espera', 'completados', 'costoCaso', 'utilMax', 'enCurso'] as const;
export type KpiId = (typeof KPI_IDS)[number];

export interface Kpi {
  id: KpiId;
  valor: number;
  /** Two decimals at most; durations as «3.25 h (195 min)». */
  texto: string;
  /** The exact value, for the `title`. */
  exacto: string;
  /** Every KPI but completed cases is better when it goes down. */
  menosEsMejor: boolean;
  /** Key of `result.replications.kpis`, for the confidence interval. */
  clave: string | null;
  /**
   * Formats one end of the 95 % CI like `exacto`: the engine keeps durations in seconds, so a
   * duration's interval goes through the scenario's unit (not the raw seconds next to «min»).
   */
  ic: (v: number) => string;
}

/** The busiest resource's utilization, 0 without resources. */
export const utilizacionMaxima = (result: RunResult): number =>
  Math.max(0, ...Object.values(result.resources).map((r) => r.utilization));

/** The six KPIs of a run, in the order they are drawn. */
export function kpisDe(result: RunResult, scenario: ResolvedScenario): Kpi[] {
  const p = result.process;
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  const moneda = scenario.run.currency === undefined ? '' : ` ${scenario.run.currency}`;
  const corta = strings().lienzo.unidadesCortas[unit];
  const enUnidad = (v: number): string => `${formatDisplay(v / SECONDS_PER_UNIT[unit])} ${corta}`;
  const num = (v: number): string => formatDisplay(v);
  const dur = (id: KpiId, v: number, clave: string): Kpi => ({
    id, valor: v, clave, menosEsMejor: true, ic: enUnidad,
    texto: p.completed > 0 ? formatDisplayDurationWithUnit(v, unit) : '—', exacto: exactDuration(v, unit),
  });
  const util = utilizacionMaxima(result);
  return [
    dur('ciclo', p.cycleTime.mean, 'process.cycleTime.mean'),
    dur('espera', p.waitTime.mean, 'process.waitTime.mean'),
    { id: 'completados', valor: p.completed, texto: formatDisplay(p.completed), exacto: formatNumber(p.completed), menosEsMejor: false, clave: 'process.completed', ic: num },
    { id: 'costoCaso', valor: p.costPerCase, texto: `${formatDisplay(p.costPerCase)}${moneda}`, exacto: `${formatNumber(p.costPerCase)}${moneda}`, menosEsMejor: true, clave: 'process.costPerCase', ic: (v) => `${formatDisplay(v)}${moneda}` },
    { id: 'utilMax', valor: util, texto: `${formatDisplay(util * 100)} %`, exacto: `${formatNumber(util * 100)} %`, menosEsMejor: true, clave: null, ic: num },
    { id: 'enCurso', valor: p.inFlight, texto: formatDisplay(p.inFlight), exacto: formatNumber(p.inFlight), menosEsMejor: true, clave: 'process.inFlight', ic: num },
  ];
}

/** The `title` of a KPI: what it measures, its exact value and, with replications, its 95 % CI. */
export function tituloKpi(k: Kpi, result: RunResult): string {
  const S = strings();
  const ic = k.clave === null ? undefined : result.replications?.kpis[k.clave]?.ci95;
  const partes = [S.c5.resultados.kpiTitulos[k.id], k.exacto];
  if (ic !== undefined) partes.push(S.c5.resultados.ic95(k.ic(ic[0]), k.ic(ic[1])));
  return partes.join(' · ');
}

/**
 * Lote M, C6: «187.09 h (11225.46 min)» → [«187.09 h», «(11225.46 min)»]. The narrow panel shows the
 * first part only, on one line (the whole value is in the `title`); a wide one shows both.
 */
export function partirDuracion(texto: string): [string, string] {
  const i = texto.indexOf(' (');
  return i < 0 ? [texto, ''] : [texto.slice(0, i), texto.slice(i + 1)];
}

/**
 * A value as the KPIs draw it: «187.09 h» on one line, and the «(11225.46 min)» part only when the
 * panel is wide (CSS hides `.c6-kpi-paren` in the narrow panel). Lote M, C7: the selected task's
 * durations use it too, so its mean wait no longer wraps onto two lines.
 */
export function TextoCompacto({ texto }: { texto: string }): ReactNode {
  const [corto, paren] = partirDuracion(texto);
  return <>{corto}{paren !== '' && <span className="c6-kpi-paren">{` ${paren}`}</span>}</>;
}

export interface PanelResumenProps {
  ir: ProcessIR;
  result: RunResult;
  scenario: ResolvedScenario;
  /** Element selected on the canvas or in the table. */
  seleccion: string | null;
  onSeleccionar: (id: string) => void;
}

export function PanelResumen({ ir, result, scenario, seleccion, onSeleccionar }: PanelResumenProps): ReactNode {
  const S = useStrings();
  const unit = scenario.run.baseTimeUnit as BaseTimeUnit;
  const kpis = kpisDe(result, scenario);
  const moneda = scenario.run.currency === undefined ? '' : ` ${scenario.run.currency}`;
  const tarea = seleccion !== null && ir.nodes[seleccion]?.type === 'task' ? seleccion : null;
  const m = tarea === null ? undefined : result.elements[tarea];
  const cuello = tarea === null ? undefined : result.bottlenecks.find((b) => b.elementId === tarea);
  return (
    <div className="c5-resumen">
      <h2>{S.c5.resultados.resumen}</h2>
      <dl className="c5-kpis">
        {kpis.map((k) => (
          <div key={k.id} title={tituloKpi(k, result)}>
            <dt>{S.c5.resultados.kpis[k.id]}</dt>
            <dd><TextoCompacto texto={k.texto} /></dd>
          </div>
        ))}
      </dl>
      {/* Lote M, C6: the two figures the old dock showed without a click, under the design's six. */}
      <dl className="c6-kpis-extra">
        <div title={`${S.c6.throughputTitulo} · ${formatNumber(result.process.throughputPerHour)}`}>
          <dt>{S.c6.throughput}</dt>
          <dd>{S.c6.throughputValor(formatDisplay(result.process.throughputPerHour))}</dd>
        </div>
        <div title={`${S.c6.costoTotalTitulo} · ${formatNumber(result.process.totalCost)}${moneda}`}>
          <dt>{S.c6.costoTotal}</dt>
          <dd>{`${formatDisplay(result.process.totalCost)}${moneda}`}</dd>
        </div>
      </dl>
      <BottleneckCard bottlenecks={result.bottlenecks} ir={ir} unit={unit} onElegir={onSeleccionar} />
      <p className="c5-nota">{S.c5.resultados.cuellosNota}</p>
      <section className="c5-tarea" aria-live="polite">
        <h3>{S.c5.resultados.tarea}</h3>
        {tarea === null || m === undefined ? <p className="vacio">{S.c5.resultados.sinSeleccion}</p> : <>
          <p className="c5-tarea-nombre">{ir.nodes[tarea]?.name || tarea}</p>
          <dl className="c5-tarea-datos">
            <div><dt>{S.c5.resultados.casos}</dt><dd title={formatNumber(m.completed)}>{formatDisplay(m.completed)}</dd></div>
            <div><dt>{S.c5.resultados.proceso}</dt><dd title={exactDuration(m.processing.mean, unit)}><TextoCompacto texto={formatDisplayDurationWithUnit(m.processing.mean, unit)} /></dd></div>
            <div><dt>{S.c5.resultados.espera}</dt><dd title={exactDuration(m.resourceWait.mean, unit)}><TextoCompacto texto={formatDisplayDurationWithUnit(m.resourceWait.mean, unit)} /></dd></div>
            {cuello !== undefined && <div><dt>{S.c5.resultados.utilizacion}</dt><dd>{`${formatDisplay(cuello.utilization * 100)} %`}</dd></div>}
          </dl>
          <p className="c5-nota">{cuello !== undefined ? S.c5.resultados.consejoCuello : S.c5.resultados.consejoSinEspera}</p>
        </>}
      </section>
    </div>
  );
}
