#!/usr/bin/env -S npx tsx
/**
 * Oráculo analítico M/M/c (Erlang C) — LILA-011.
 *
 * Sin dependencias (regla del corpus, ver `tools/oracles/` en
 * LILA_MODELER_ESTRUCTURA.md §5). Ejecutable con `tsx` (devDependency del
 * monorepo) o importable como módulo desde los tests.
 *
 * Fórmulas estándar de teoría de colas para M/M/c con FIFO, población y
 * capacidad de cola infinitas:
 *
 *   a   = λ / μ                          (carga ofrecida, en Erlangs)
 *   ρ   = a / c                          (utilización por servidor, ρ < 1)
 *   C(c, a) = [ (a^c / c!) · 1/(1-ρ) ] / [ Σ_{k=0}^{c-1} a^k/k! + (a^c/c!) · 1/(1-ρ) ]
 *                                        (probabilidad de que un cliente espere, fórmula de Erlang C)
 *   Wq  = C(c, a) / (c·μ·(1-ρ))          (espera media en cola)
 *   Lq  = λ · Wq                          (clientes medios en cola, Little)
 *   L   = Lq + a                          (clientes medios en el sistema)
 *   W   = Wq + 1/μ                        (tiempo medio en el sistema)
 *
 * Para c = 1 estas fórmulas colapsan a las de M/M/1 (C(1,a) = ρ), así que
 * `erlangC` sirve para ambos casos de este ticket.
 */

export interface ErlangCParams {
  /** Tasa de llegadas λ, en llegadas por segundo. */
  lambda: number;
  /** Tasa de servicio μ por servidor, en atenciones por segundo. */
  mu: number;
  /** Número de servidores (capacidad del pool de recursos). */
  c: number;
}

export interface ErlangCResult {
  a: number;
  rho: number;
  utilization: number;
  probWait: number;
  wq: number;
  lq: number;
  l: number;
  w: number;
}

export function erlangC({ lambda, mu, c }: ErlangCParams): ErlangCResult {
  if (lambda <= 0) throw new Error('lambda debe ser > 0');
  if (mu <= 0) throw new Error('mu debe ser > 0');
  if (!Number.isInteger(c) || c < 1) throw new Error('c debe ser un entero >= 1');

  const a = lambda / mu;
  const rho = a / c;
  if (rho >= 1) throw new Error(`sistema inestable: rho = ${rho} >= 1 (c*mu debe ser > lambda)`);

  let sum = 0;
  let term = 1; // a^0 / 0!
  for (let k = 0; k < c; k++) {
    if (k > 0) term *= a / k;
    sum += term;
  }
  // term ahora es a^(c-1)/(c-1)!; el siguiente término es a^c/c!
  const lastTerm = term * (a / c);
  const erlangTerm = lastTerm / (1 - rho);
  const probWait = erlangTerm / (sum + erlangTerm);

  const wq = probWait / (c * mu * (1 - rho));
  const lq = lambda * wq;
  const l = lq + a;
  const w = wq + 1 / mu;

  return { a, rho, utilization: rho, probWait, wq, lq, l, w };
}

// Ejecutable directo: `tsx tools/oracles/erlang_c.ts '{"lambda":0.01,"mu":0.02,"c":1}'`
if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('uso: tsx tools/oracles/erlang_c.ts \'{"lambda":<num>,"mu":<num>,"c":<int>}\'');
    process.exit(1);
  }
  const params = JSON.parse(arg) as ErlangCParams;
  console.log(JSON.stringify(erlangC(params), null, 2));
}
