#!/usr/bin/env -S npx tsx
/**
 * Regenera examples/mm1/*\/expected.json a partir de erlang_c.ts — LILA-011.
 *
 * Uso: npx tsx tools/oracles/generate-mm-expected.ts
 *
 * Los parámetros (λ, μ, c) de cada caso están documentados también en
 * examples/mm1/README.md; deben coincidir con los de cada scenario.json
 * (interTriggerTimer.mean = 1/λ, processingTime.mean = 1/μ, capacity = c).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { erlangC, type ErlangCParams } from './erlang_c.js';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, '../../examples/mm1');

interface Case {
  dir: string;
  name: string;
  params: ErlangCParams;
}

const cases: Case[] = [
  {
    dir: 'mm1-rho08',
    name: 'M/M/1 rho=0.8',
    // mu = 1/300 s^-1 (servicio medio 300 s); rho = 0.8 => lambda = 0.8*mu
    params: { lambda: 1 / 375, mu: 1 / 300, c: 1 },
  },
  {
    dir: 'mm3',
    name: 'M/M/3 rho=0.8',
    // mismo mu por servidor; c = 3; rho = 0.8 => lambda = 0.8 * c * mu
    params: { lambda: 1 / 125, mu: 1 / 300, c: 3 },
  },
];

for (const { dir, name, params } of cases) {
  const result = erlangC(params);
  const expected = {
    source: 'tools/oracles/erlang_c.ts (Erlang C)',
    name,
    params,
    values: {
      utilization: result.utilization,
      probWait: result.probWait,
      wqSeconds: result.wq,
      lqCustomers: result.lq,
      lCustomers: result.l,
      wSeconds: result.w,
    },
    nota:
      'Wq/Lq/L/W calculados con la fórmula de Erlang C (M/M/c); reproducible con ' +
      '`npx tsx tools/oracles/generate-mm-expected.ts`. Ver examples/mm1/README.md.',
  };
  const path = resolve(examplesDir, dir, 'expected.json');
  writeFileSync(path, JSON.stringify(expected, null, 2) + '\n');
  console.log(`escrito ${path}`);
}
