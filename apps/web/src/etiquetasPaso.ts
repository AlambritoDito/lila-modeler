/**
 * Lote M: under each element of the canvas, the parameter of the Simulate step being filled in —
 * «≈ 1.25 h (75 min)» under a task in Times, its pool in Resources, its calendar in Calendars,
 * «every 12 min» under a start event in Arrivals. The design draws them so the person reads the
 * whole step on the diagram instead of clicking element by element; «No duration» and «No
 * resource» are drawn as missing.
 *
 * Same split as `BottleneckOverlay.ts`: `modeloEtiquetas` is pure (no bpmn-js, tested in node)
 * and `aplicarEtiquetasPaso(modeler, entrada)` is the only function that touches the modeler. It
 * removes its own overlays first, so calling it again repaints and `null` clears. The shell (C5)
 * calls it from one effect with the panel's step, the resolved scenario and the IR.
 *
 * Ids: the label map is keyed by IR id; `originalIds` (`ir.source.originalIds`) turns a sanitised
 * id back into the one bpmn-js imported, as the bottleneck overlay does.
 */
import type Modeler from 'bpmn-js/lib/Modeler';
import type ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Overlays from 'diagram-js/lib/features/overlays/Overlays';
import type { ProcessIR } from '@lila-modeler/engine';
import type { BaseTimeUnit } from '@lila-modeler/engine/format';

import { formatDisplayDurationWithUnit } from './formatDisplay';
import type { PasoId } from './ids';
import { strings } from './i18n';

const TIPO = 'lila-etiqueta-paso';

/** One label: its text and whether it says something is missing (drawn in the error colour). */
export interface EtiquetaPaso {
  texto: string;
  falta: boolean;
}

export type ModeloEtiquetas = Readonly<Record<string, EtiquetaPaso>>;

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/* ------------------------------------------------------------------ *
 * Mean of a distribution (the «≈» of the labels and of the Times step)
 * ------------------------------------------------------------------ */

/** Lanczos approximation of Γ(x), enough for a «≈» label (Weibull's mean). */
function gamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  const y = x - 1;
  let a = c[0]!;
  const t = y + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (y + i);
  return Math.sqrt(2 * Math.PI) * t ** (y + 0.5) * Math.exp(-t) * a;
}

/** Standard normal density and distribution (Abramowitz–Stegun 7.1.26 for erf). */
function phi(z: number): number {
  return Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}
function Phi(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}

/**
 * The mean of a scenario distribution (§ 3), in the distribution's own units (seconds for a
 * time), or `null` when the value is not a distribution or a parameter is missing.
 */
export function mediaDistribucion(d: unknown): number | null {
  if (!esObjeto(d)) return null;
  const p = (k: string): number | null => num(d[k]);
  switch (d['type']) {
    case 'constant':
      return p('value');
    case 'uniform': {
      const [a, b] = [p('min'), p('max')];
      return a === null || b === null ? null : (a + b) / 2;
    }
    case 'triangular': {
      const [a, m, b] = [p('min'), p('mode'), p('max')];
      return a === null || m === null || b === null ? null : (a + m + b) / 3;
    }
    case 'exponential':
    case 'normal':
    case 'lognormal':
    case 'erlang':
    case 'poisson':
      return p('mean');
    case 'truncatedNormal': {
      const [mu, sd, a, b] = [p('mean'), p('sd'), p('min'), p('max')];
      if (mu === null || sd === null || a === null || b === null) return null;
      if (sd === 0) return Math.min(b, Math.max(a, mu));
      const [za, zb] = [(a - mu) / sd, (b - mu) / sd];
      const masa = Phi(zb) - Phi(za);
      return masa <= 0 ? (a + b) / 2 : mu + (sd * (phi(za) - phi(zb))) / masa;
    }
    case 'gamma': {
      const [k, s] = [p('shape'), p('scale')];
      return k === null || s === null ? null : k * s;
    }
    case 'weibull': {
      const [k, s] = [p('shape'), p('scale')];
      return k === null || s === null || k <= 0 ? null : s * gamma(1 + 1 / k);
    }
    case 'beta': {
      const [al, be, a, b] = [p('alpha'), p('beta'), p('min'), p('max')];
      return al === null || be === null || a === null || b === null ? null : a + ((b - a) * al) / (al + be);
    }
    case 'binomial': {
      const [n, q] = [p('n'), p('p')];
      return n === null || q === null ? null : n * q;
    }
    case 'user': {
      const puntos = Array.isArray(d['points']) ? d['points'].filter(esObjeto) : [];
      const total = puntos.reduce((acc, x) => acc + (num(x['probability']) ?? 0), 0);
      if (total <= 0) return null;
      return puntos.reduce((acc, x) => acc + (num(x['value']) ?? 0) * (num(x['probability']) ?? 0), 0) / total;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * The labels of one step
 * ------------------------------------------------------------------ */

export interface EntradaEtiquetas {
  paso: PasoId;
  /** The scenario with `extends` applied: what the run would use. */
  resuelto: Record<string, unknown>;
  ir: ProcessIR;
  /** `run.baseTimeUnit`; the labels read «1.25 h (75 min)» from it (`formatDisplayDuration…`). */
  unidad: BaseTimeUnit;
  /** `ir.source.originalIds`: IR id → the id bpmn-js imported. */
  originalIds?: Readonly<Record<string, string>>;
}

function nombreRecurso(recursos: Record<string, unknown>, ref: string): string {
  const r = recursos[ref];
  const nombre = esObjeto(r) ? r['name'] : undefined;
  return typeof nombre === 'string' && nombre.trim() !== '' ? nombre : ref;
}

/** The calendar a task follows: its own, else the one of its first pool, else none (24×7). */
export function calendarioEfectivo(resuelto: Record<string, unknown>, id: string): string | null {
  const elementos = esObjeto(resuelto['elements']) ? resuelto['elements'] : {};
  const recursos = esObjeto(resuelto['resources']) ? resuelto['resources'] : {};
  const entrada = esObjeto(elementos[id]) ? elementos[id] : {};
  if (typeof entrada['calendar'] === 'string') return entrada['calendar'];
  const asignados = Array.isArray(entrada['resources']) ? entrada['resources'].filter(esObjeto) : [];
  for (const a of asignados) {
    const r = typeof a['ref'] === 'string' ? recursos[a['ref']] : undefined;
    if (esObjeto(r) && typeof r['calendar'] === 'string') return r['calendar'];
  }
  return null;
}

/**
 * The label of every element the step says something about, keyed by IR id. Routes and Run draw
 * nothing here: the gateway percentages are C4's flow labels, and the run has no element.
 */
export function modeloEtiquetas({ paso, resuelto, ir, unidad }: EntradaEtiquetas): ModeloEtiquetas {
  const L = strings().pasosSim.etiquetas;
  const elementos = esObjeto(resuelto['elements']) ? resuelto['elements'] : {};
  const recursos = esObjeto(resuelto['resources']) ? resuelto['resources'] : {};
  const salida: Record<string, EtiquetaPaso> = {};
  const de = (id: string): Record<string, unknown> => (esObjeto(elementos[id]) ? elementos[id] : {});
  for (const [id, nodo] of Object.entries(ir.nodes)) {
    const entrada = de(id);
    if (paso === 'times' && (nodo.type === 'task' || nodo.type === 'timer')) {
      const media = mediaDistribucion(entrada['processingTime']);
      if (media !== null) salida[id] = { texto: `≈ ${formatDisplayDurationWithUnit(media, unidad)}`, falta: false };
      else if (nodo.type === 'task') salida[id] = { texto: L.sinDuracion, falta: true };
    } else if (paso === 'resources' && nodo.type === 'task') {
      const asignados = Array.isArray(entrada['resources']) ? entrada['resources'].filter(esObjeto) : [];
      const nombres = asignados
        .filter((a) => typeof a['ref'] === 'string')
        .map((a) => {
          const cantidad = num(a['quantity']) ?? 1;
          const nombre = nombreRecurso(recursos, a['ref'] as string);
          return cantidad === 1 ? nombre : `${nombre} ×${cantidad}`;
        });
      salida[id] = nombres.length > 0 ? { texto: nombres.join(' + '), falta: false } : { texto: L.sinRecurso, falta: true };
    } else if (paso === 'calendars' && nodo.type === 'task') {
      const cal = calendarioEfectivo(resuelto, id);
      salida[id] = { texto: cal ?? L.siempre, falta: false };
    } else if (paso === 'arrivals' && nodo.type === 'start') {
      const media = mediaDistribucion(entrada['interTriggerTimer']);
      if (media !== null && media > 0) salida[id] = { texto: L.cada(formatDisplayDurationWithUnit(media, unidad)), falta: false };
    }
  }
  return salida;
}

/* ------------------------------------------------------------------ *
 * The only function that touches bpmn-js
 * ------------------------------------------------------------------ */

function html(etiqueta: EtiquetaPaso): HTMLElement {
  const div = document.createElement('div');
  div.className = etiqueta.falta ? 'lila-etiqueta-paso falta' : 'lila-etiqueta-paso';
  div.textContent = etiqueta.texto;
  return div;
}

/**
 * Paints the labels of `entrada.paso` under their elements, or clears them with `null`. Ids the
 * canvas does not know are skipped (a result of another model, an element being deleted).
 */
export function aplicarEtiquetasPaso(modeler: Modeler, entrada: EntradaEtiquetas | null): void {
  const overlays = modeler.get<Overlays>('overlays');
  overlays.remove({ type: TIPO });
  if (entrada === null) return;
  const registro = modeler.get<ElementRegistry>('elementRegistry');
  for (const [id, etiqueta] of Object.entries(modeloEtiquetas(entrada))) {
    const idLienzo = entrada.originalIds?.[id] ?? id;
    const forma = registro.get(idLienzo) as { width?: number; height?: number } | undefined;
    if (forma === undefined) continue;
    overlays.add(idLienzo, TIPO, {
      html: html(etiqueta),
      position: { left: 0, top: (forma.height ?? 0) + 4 },
    });
  }
}

/** The name the pattern of the other canvas layers uses (`apply(modeler, …)`). */
export const apply = aplicarEtiquetasPaso;
