import { describe, expect, test } from 'vitest';
import { checkDistribution, sample, type Distribution } from '../../src/core/distributions.js';
import { stream } from '../../src/core/rng.js';

const N = 100_000;
const TOLERANCE = 0.02; // 2 % (aceptación de LILA-025)

function stats(dist: Distribution, label: string): { mean: number; sd: number } {
  // Semilla fija por caso: el test es determinista, nunca intermitente.
  const rng = stream(20250903, 0, label);
  let sum = 0;
  let sumSquares = 0;
  for (let i = 0; i < N; i++) {
    const x = sample(dist, rng);
    sum += x;
    sumSquares += x * x;
  }
  const mean = sum / N;
  return { mean, sd: Math.sqrt(sumSquares / N - mean * mean) };
}

/**
 * Las 14 distribuciones con su media y desviación estándar teóricas.
 *
 * - constant(v):            mean = v,                      sd = 0
 * - uniform(a, b):          mean = (a+b)/2,                sd = (b-a)/sqrt(12)
 * - triangular(a, m, b):    mean = (a+m+b)/3,              var = (a²+m²+b²-am-ab-mb)/18
 * - exponential(mu):        mean = mu,                     sd = mu
 * - normal(mu, s):          mean = mu,                     sd = s   (con P(x<0) despreciable:
 *                           480/90 => P = 6e-8, así que el truncado a >= 0 no mueve nada)
 * - lognormal(mu, s):       mean = mu,                     sd = s   (por construcción: son los
 *                           momentos de la variable, no los del logaritmo)
 * - gamma(k, theta):        mean = k·theta,                sd = sqrt(k)·theta
 * - erlang(k, mu):          mean = mu,                     sd = mu/sqrt(k)
 * - weibull(k, lambda):     mean = lambda·Γ(1+1/k),        var = lambda²(Γ(1+2/k) − Γ(1+1/k)²)
 *                           k=2: Γ(1.5)=sqrt(pi)/2=0.8862269255, Γ(2)=1
 * - beta(a, b, lo, hi):     mean = lo + (hi−lo)·a/(a+b),   sd = (hi−lo)·sqrt(ab/((a+b)²(a+b+1)))
 * - poisson(lambda):        mean = lambda,                 sd = sqrt(lambda)
 * - binomial(n, p):         mean = np,                     sd = sqrt(np(1−p))
 * - user(points):           mean = Σ p·v,                  var = Σ p·v² − mean²
 *
 * `truncatedNormal` se prueba aparte (§ "truncatedNormal"): sus momentos NO son los de la
 * normal sin truncar.
 */
const CASES: { label: string; dist: Distribution; mean: number; sd: number }[] = [
  { label: 'constant', dist: { type: 'constant', value: 90 }, mean: 90, sd: 0 },
  { label: 'uniform', dist: { type: 'uniform', min: 60, max: 300 }, mean: 180, sd: 240 / Math.sqrt(12) },
  {
    label: 'triangular',
    dist: { type: 'triangular', min: 60, mode: 120, max: 300 },
    mean: 160,
    sd: Math.sqrt(2600), // (3600+14400+90000−7200−18000−36000)/18 = 2600
  },
  { label: 'exponential', dist: { type: 'exponential', mean: 240 }, mean: 240, sd: 240 },
  { label: 'normal', dist: { type: 'normal', mean: 480, sd: 90 }, mean: 480, sd: 90 },
  { label: 'lognormal', dist: { type: 'lognormal', mean: 300, sd: 120 }, mean: 300, sd: 120 },
  {
    label: 'gamma',
    dist: { type: 'gamma', shape: 2.5, scale: 80 },
    mean: 200,
    sd: Math.sqrt(2.5) * 80,
  },
  {
    // shape < 1: es la rama del ajuste por potencia de Marsaglia-Tsang.
    label: 'gamma-shape-menor-que-1',
    dist: { type: 'gamma', shape: 0.4, scale: 100 },
    mean: 40,
    sd: Math.sqrt(0.4) * 100,
  },
  { label: 'erlang', dist: { type: 'erlang', k: 3, mean: 600 }, mean: 600, sd: 600 / Math.sqrt(3) },
  {
    label: 'weibull',
    dist: { type: 'weibull', shape: 2, scale: 100 },
    mean: 100 * 0.8862269254527580,
    sd: 100 * Math.sqrt(1 - 0.8862269254527580 ** 2),
  },
  {
    label: 'beta',
    dist: { type: 'beta', alpha: 2, beta: 5, min: 0, max: 600 },
    mean: 600 * (2 / 7),
    sd: 600 * Math.sqrt(10 / (49 * 8)),
  },
  { label: 'poisson', dist: { type: 'poisson', mean: 4 }, mean: 4, sd: 2 },
  {
    // mean >= 30: es la rama PTRS, no la de Knuth.
    label: 'poisson-media-grande',
    dist: { type: 'poisson', mean: 250 },
    mean: 250,
    sd: Math.sqrt(250),
  },
  {
    label: 'binomial',
    dist: { type: 'binomial', n: 20, p: 0.3 },
    mean: 6,
    sd: Math.sqrt(20 * 0.3 * 0.7),
  },
  {
    label: 'user',
    dist: {
      type: 'user',
      points: [
        { value: 60, probability: 0.5 },
        { value: 180, probability: 0.3 },
        { value: 600, probability: 0.2 },
      ],
    },
    mean: 204, // 0.5·60 + 0.3·180 + 0.2·600
    sd: Math.sqrt(83520 - 204 ** 2), // E[x²] = 0.5·3600 + 0.3·32400 + 0.2·360000
  },
];

describe('sample: media y sd de 100 000 muestras dentro del 2 % de la teórica', () => {
  test.each(CASES)('$label', ({ label, dist, mean, sd }) => {
    const observed = stats(dist, label);
    expect(Math.abs(observed.mean - mean)).toBeLessThanOrEqual(Math.abs(mean) * TOLERANCE);
    if (sd === 0) expect(observed.sd).toBe(0);
    else expect(Math.abs(observed.sd - sd)).toBeLessThanOrEqual(sd * TOLERANCE);
  });
});

describe('truncatedNormal', () => {
  /**
   * Momentos de la normal truncada a [min, max] con alpha = (min−mu)/s y beta = (max−mu)/s:
   *   Z = Φ(beta) − Φ(alpha)
   *   mean = mu + s·(φ(alpha) − φ(beta))/Z
   *   var  = s²·[1 + (alpha·φ(alpha) − beta·φ(beta))/Z − ((φ(alpha) − φ(beta))/Z)²]
   * Con mu=60, s=30, [30, 120]: alpha=−1, beta=2, φ(1)=0.2419707245, φ(2)=0.0539909665,
   * Φ(2)=0.9772498681, Φ(−1)=0.1586552539 => Z=0.8185946142,
   * mean = 66.889092, sd = sqrt(467.7853) = 21.628345.
   */
  const dist: Distribution = { type: 'truncatedNormal', mean: 60, sd: 30, min: 30, max: 120 };

  test('media y sd dentro del 2 % de las teóricas de la truncada', () => {
    const observed = stats(dist, 'truncatedNormal');
    expect(Math.abs(observed.mean - 66.889092)).toBeLessThanOrEqual(66.889092 * TOLERANCE);
    expect(Math.abs(observed.sd - 21.628345)).toBeLessThanOrEqual(21.628345 * TOLERANCE);
  });

  test('ninguna muestra sale de [min, max]', () => {
    const rng = stream(7, 0, 'truncatedNormal-rango');
    for (let i = 0; i < 10_000; i++) {
      const x = sample(dist, rng);
      expect(x).toBeGreaterThanOrEqual(30);
      expect(x).toBeLessThanOrEqual(120);
    }
  });
});

describe('normal truncada a >= 0', () => {
  test('ninguna muestra es negativa aunque la normal lo permita', () => {
    const rng = stream(7, 0, 'normal-negativa');
    for (let i = 0; i < 10_000; i++) {
      expect(sample({ type: 'normal', mean: 100, sd: 60 }, rng)).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('checkDistribution', () => {
  test('normal con P(x < 0) > 1 % emite W-NORMAL-NEGATIVA', () => {
    // mean=100, sd=60 => P(x < 0) = Φ(−1.6667) = 4.78 % > 1 %.
    const warnings = checkDistribution({ type: 'normal', mean: 100, sd: 60 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('W-NORMAL-NEGATIVA');
  });

  test('normal con P(x < 0) despreciable no emite aviso', () => {
    // mean=480, sd=90 => P(x < 0) = 6e-8 (el caso del AS-IS de SCENARIO_FORMAT.md § 7.3).
    expect(checkDistribution({ type: 'normal', mean: 480, sd: 90 })).toEqual([]);
  });

  test('user con probabilidades que no suman 1 emite W-USER-NORMALIZADA', () => {
    const warnings = checkDistribution({
      type: 'user',
      points: [
        { value: 60, probability: 2 },
        { value: 180, probability: 2 },
      ],
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe('W-USER-NORMALIZADA');
  });

  test('user con probabilidades sin normalizar muestrea igual que normalizada', () => {
    // 2:2 es 50/50: la media teórica es 120.
    const observed = stats(
      {
        type: 'user',
        points: [
          { value: 60, probability: 2 },
          { value: 180, probability: 2 },
        ],
      },
      'user-sin-normalizar',
    );
    expect(Math.abs(observed.mean - 120)).toBeLessThanOrEqual(120 * TOLERANCE);
  });
});

describe('determinismo', () => {
  test('el mismo stream produce la misma secuencia para cada distribución', () => {
    for (const { label, dist } of CASES) {
      const a = Array.from({ length: 100 }, () => 0);
      const rngA = stream(1, 0, label);
      const rngB = stream(1, 0, label);
      const first = a.map(() => sample(dist, rngA));
      const second = a.map(() => sample(dist, rngB));
      expect(first).toEqual(second);
    }
  });
});
