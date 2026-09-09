/**
 * Las 14 distribuciones del contrato, con parámetros **nombrados** y en **segundos**
 * (`docs/SCENARIO_FORMAT.md` § 3, R-DET-4 y R-DET-7 de `docs/SEMANTICS.md`).
 *
 * Este archivo es `core/`: no importa nada fuera de `core/` (ni zod, ni bpmn-moddle, ni
 * `node:*`, ni React) y no hace I/O. Los algoritmos van escritos a mano, sin dependencias.
 *
 * Todo el azar sale del `Rng` que se recibe por parámetro: nunca `Math.random` ni `Date`
 * (R-DET-5). `normal` y `truncatedNormal` usan Box-Muller **sin cachear** el segundo valor,
 * así que consumen exactamente 2 uniformes por muestra (R-DET-4).
 */

import { coreMessages, type Locale } from './messages/index.js';
import type { Rng } from './rng.js';

/** Punto de la empírica discreta `user`. */
export interface UserPoint {
  value: number;
  probability: number;
}

/** Distribución del escenario. Los parámetros son los de `docs/SCENARIO_FORMAT.md` § 3. */
export type Distribution =
  | { type: 'constant'; value: number }
  | { type: 'uniform'; min: number; max: number }
  | { type: 'triangular'; min: number; mode: number; max: number }
  | { type: 'exponential'; mean: number }
  | { type: 'normal'; mean: number; sd: number }
  | { type: 'truncatedNormal'; mean: number; sd: number; min: number; max: number }
  | { type: 'lognormal'; mean: number; sd: number }
  | { type: 'gamma'; shape: number; scale: number }
  | { type: 'erlang'; k: number; mean: number }
  | { type: 'weibull'; shape: number; scale: number }
  | { type: 'beta'; alpha: number; beta: number; min: number; max: number }
  | { type: 'poisson'; mean: number }
  | { type: 'binomial'; n: number; p: number }
  | { type: 'user'; points: UserPoint[] };

/** Códigos de aviso que puede producir una distribución (§ 17 de `docs/SEMANTICS.md`). */
export type DistributionWarningCode = 'W-NORMAL-NEGATIVA' | 'W-USER-NORMALIZADA';

/**
 * Aviso devuelto **como dato**: `core/` no imprime nada. Quien llama le añade el `id` del
 * elemento antes de meterlo en `RunResult.warnings[]`.
 */
export interface DistributionWarning {
  code: DistributionWarningCode;
  message: string;
}

/** Box-Muller sin caché: 2 uniformes por muestra, siempre (R-DET-4). */
function standardNormal(rng: Rng): number {
  const u1 = 1 - rng.next(); // (0, 1]: evita log(0)
  const u2 = rng.next();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Gamma por Marsaglia-Tsang; `shape < 1` se reduce a `shape + 1` con el ajuste por potencia. */
function gammaSample(rng: Rng, shape: number, scale: number): number {
  if (shape < 1) return gammaSample(rng, shape + 1, scale) * Math.pow(1 - rng.next(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let z: number;
    let v: number;
    do {
      z = standardNormal(rng);
      v = 1 + c * z;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.next();
    if (u < 1 - 0.0331 * z * z * z * z) return d * v * scale;
    if (Math.log(u) < 0.5 * z * z + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

/** `log(k!)` por Stirling con corrección: error < 1e-4 en `k = 0` y despreciable a partir de ahí. */
function logFactorial(k: number): number {
  const x = k + 1;
  return (
    (x - 0.5) * Math.log(x) - x + 0.9189385332046727 + 1 / (12 * x) - 1 / (360 * x ** 3) + 1 / (1260 * x ** 5)
  );
}

/** Knuth para media pequeña; PTRS (Hörmann 1993), rechazo transformado con squeeze, para grande. */
function poissonSample(rng: Rng, mean: number): number {
  if (mean < 30) {
    const limit = Math.exp(-mean);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= rng.next();
    } while (p > limit);
    return k - 1;
  }
  const b = 0.931 + 2.53 * Math.sqrt(mean);
  const a = -0.059 + 0.02483 * b;
  const invAlpha = 1.1239 + 1.1328 / (b - 3.4);
  const vr = 0.9277 - 3.6224 / (b - 2);
  for (;;) {
    const u = rng.next() - 0.5;
    const v = rng.next();
    const us = 0.5 - Math.abs(u);
    const k = Math.floor(((2 * a) / us + b) * u + mean + 0.43);
    if (us >= 0.07 && v <= vr) return k;
    if (k < 0 || (us < 0.013 && v > us)) continue;
    if (Math.log((v * invAlpha) / (a / (us * us) + b)) <= k * Math.log(mean) - mean - logFactorial(k)) return k;
  }
}

/** Intentos máximos del rechazo de `truncatedNormal` antes de rendirse. */
const MAX_REJECTIONS = 1000;

/** Saca una muestra de `dist` consumiendo el stream `rng`. El resultado está en segundos. */
export function sample(dist: Distribution, rng: Rng): number {
  switch (dist.type) {
    case 'constant':
      return dist.value;
    case 'uniform':
      return dist.min + (dist.max - dist.min) * rng.next();
    case 'triangular': {
      // Inversión de la CDF triangular.
      const u = rng.next();
      const range = dist.max - dist.min;
      const c = range === 0 ? 0 : (dist.mode - dist.min) / range;
      return u < c
        ? dist.min + Math.sqrt(u * range * (dist.mode - dist.min))
        : dist.max - Math.sqrt((1 - u) * range * (dist.max - dist.mode));
    }
    case 'exponential':
      return -dist.mean * Math.log(1 - rng.next());
    case 'normal':
      return Math.max(0, dist.mean + dist.sd * standardNormal(rng)); // truncada a >= 0 (R-DET-7)
    case 'truncatedNormal': {
      for (let i = 0; i < MAX_REJECTIONS; i++) {
        const x = dist.mean + dist.sd * standardNormal(rng);
        if (x >= dist.min && x <= dist.max) return x;
      }
      // ponytail: con una ventana [min, max] absurdamente estrecha el rechazo no converge y
      // devolvemos la media recortada. Techo: sesga esa cola. Camino de mejora: muestreo por
      // inversión de la normal truncada (necesita la inversa de la CDF, que hoy no hace falta).
      return Math.min(dist.max, Math.max(dist.min, dist.mean));
    }
    case 'lognormal': {
      // `mean` y `sd` son de la VARIABLE: se convierten a mu y sigma de su logaritmo.
      const cv2 = (dist.sd * dist.sd) / (dist.mean * dist.mean);
      const sigma = Math.sqrt(Math.log(1 + cv2));
      return Math.exp(Math.log(dist.mean) - (sigma * sigma) / 2 + sigma * standardNormal(rng));
    }
    case 'gamma':
      return gammaSample(rng, dist.shape, dist.scale);
    case 'erlang':
      // `mean` es la media TOTAL: k fases de media mean/k, o sea gamma(shape = k, scale = mean/k).
      return gammaSample(rng, dist.k, dist.mean / dist.k);
    case 'weibull':
      return dist.scale * Math.pow(-Math.log(1 - rng.next()), 1 / dist.shape);
    case 'beta': {
      // Beta estándar como x/(x+y) de dos gammas, reescalada a [min, max].
      const x = gammaSample(rng, dist.alpha, 1);
      const y = gammaSample(rng, dist.beta, 1);
      const b = x + y === 0 ? 0 : x / (x + y);
      return dist.min + b * (dist.max - dist.min);
    }
    case 'poisson':
      return poissonSample(rng, dist.mean);
    case 'binomial': {
      // ponytail: suma de n Bernoulli, O(n) uniformes. Techo: con n de miles se vuelve lento.
      // Camino de mejora: BTRS (rechazo transformado), el equivalente de PTRS para binomial.
      let k = 0;
      for (let i = 0; i < dist.n; i++) if (rng.next() < dist.p) k++;
      return k;
    }
    case 'user': {
      // Empírica discreta con probabilidades normalizadas (el aviso lo da `checkDistribution`).
      const total = dist.points.reduce((acc, point) => acc + point.probability, 0);
      let u = rng.next() * total;
      for (const point of dist.points) {
        u -= point.probability;
        if (u < 0) return point.value;
      }
      return dist.points[dist.points.length - 1]?.value ?? 0;
    }
  }
}

/** erf por Abramowitz-Stegun 7.1.26 (error < 1.5e-7): de sobra para un umbral del 1 %. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-x * x));
}

/**
 * Avisos de una distribución, devueltos como dato (§ 17 de `docs/SEMANTICS.md`):
 * `W-NORMAL-NEGATIVA` si una `normal` tiene `P(x < 0) > 1 %` (se trunca a >= 0 al muestrear) y
 * `W-USER-NORMALIZADA` si las probabilidades de una `user` no suman 1.
 */
export function checkDistribution(dist: Distribution, locale: Locale = 'en'): DistributionWarning[] {
  const M = coreMessages(locale).codes;
  if (dist.type === 'normal' && dist.sd > 0) {
    const pNegative = 0.5 * (1 + erf(-dist.mean / (dist.sd * Math.SQRT2)));
    if (pNegative > 0.01) {
      return [
        {
          code: 'W-NORMAL-NEGATIVA',
          message: M['W-NORMAL-NEGATIVA'](dist.mean, dist.sd, (pNegative * 100).toFixed(1)),
        },
      ];
    }
  }
  if (dist.type === 'user') {
    const total = dist.points.reduce((acc, point) => acc + point.probability, 0);
    if (Math.abs(total - 1) > 1e-9) {
      return [
        {
          code: 'W-USER-NORMALIZADA',
          message: M['W-USER-NORMALIZADA'](total),
        },
      ];
    }
  }
  return [];
}
