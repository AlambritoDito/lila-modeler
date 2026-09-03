/**
 * PRNG sembrado y un stream independiente por elemento (ADR-017, R-DET-2 a
 * R-DET-4 en `docs/SEMANTICS.md`). Nunca `Math.random` ni `Date`.
 *
 * Algoritmo: mulberry32. Se elige sobre xoshiro128** porque es un solo
 * entero de 32 bits sin arrays de estado — la implementación más corta que
 * alcanza la calidad estadística que necesita una simulación DES — y así
 * `core/` se mantiene mínimo.
 *
 * `core/` no importa nada fuera de sí mismo.
 */

/** Generador de números pseudoaleatorios: uniforme en [0, 1). */
export interface Rng {
  next(): number;
}

/** mulberry32: PRNG de 32 bits, sembrado, determinista. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/**
 * xmur3: hash de una cadena a un entero de 32 bits. Se usa para derivar la
 * semilla de cada stream a partir de `(seed, replication, elementId)`.
 */
function xmur3(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Un stream independiente por elemento (R-DET-2): `interTriggerTimer` del
 * start, `processingTime` de la tarea o el timer, los sorteos de ramaje del
 * gateway, cada uno consume solo su propio stream. Consecuencia (R-DET-3,
 * common random numbers): añadir un recurso o cambiar un parámetro no
 * cambia la secuencia de los elementos no tocados.
 */
export function stream(seed: number, replication: number, elementId: string): Rng {
  const derivedSeed = xmur3(`${seed}:${replication}:${elementId}`);
  return createRng(derivedSeed);
}
