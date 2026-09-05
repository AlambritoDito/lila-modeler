import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { simulate } from '../src/index.js';
import type { ProcessIR } from '../src/core/ir.js';
import { summarizeKpi } from '../src/core/replications.js';
import type { SimScenario } from '../src/core/sim.js';

/**
 * LILA-049 · oráculo SimPy.
 *
 * Compara el motor de Lila contra una implementación independiente del mismo modelo (5 tareas
 * secuenciales, recursos de capacidad 1-3, llegadas exponenciales, duraciones triangulares) en
 * `tools/oracles/des_simpy.py`. Es una comparación estadística, no bit a bit: los IC95 de
 * `simulate()` y del oráculo, calculados con la misma fórmula sobre 30 replicaciones cada uno
 * (docs/RESULTS_FORMAT.md §8), se solapan — ver la nota de método más abajo. Es la aceptación
 * (b) de M2 en `LILA_MODELER_ESTRUCTURA.md` §7.
 *
 * Se salta sin `ORACLES=1` porque invoca un proceso Python vía `uv run --with simpy` (sin
 * `simpy` instalado en el repo, regla del ticket): `npm test` normal no cambia de duración.
 *
 * Nota de método: un único run de SimPy no se compara contra el IC95 de Lila directamente.
 * El IC95 de una media de 30 replicaciones es mucho más angosto que la variación de una sola
 * corrida (confirmado empíricamente: con un solo run, la utilización de `T2` cae fuera del
 * IC95 de Lila por un margen menor al 1 % — no es un desacuerdo de semántica, es comparar un
 * punto contra el IC de una media). La comparación válida es correr el mismo número de
 * replicaciones en SimPy, calcular su propio IC95 con la misma fórmula
 * (`summarizeKpi`, t de Student) y verificar que los dos intervalos se solapen.
 */

const N_CASES = 5000;
const SEED = 42;
const REPLICATIONS = 30;
const ARRIVAL_MEAN = 10; // segundos, media de la exponencial de llegadas (bench/des_simpy.py)

// Mismas 5 tareas que tools/oracles/des_simpy.py: id de recurso = id de tarea, capacidad 1-3,
// duración triangular(min, mode, max) en segundos.
const TASKS = [
  { id: 'T1', capacity: 2, min: 5, mode: 8, max: 15 },
  { id: 'T2', capacity: 3, min: 10, mode: 20, max: 30 },
  { id: 'T3', capacity: 1, min: 3, mode: 5, max: 8 },
  { id: 'T4', capacity: 2, min: 8, mode: 12, max: 20 },
  { id: 'T5', capacity: 1, min: 2, mode: 4, max: 7 },
] as const;

function buildIr(): ProcessIR {
  const nodes: ProcessIR['nodes'] = {
    Start: { type: 'start', name: '', incoming: [], outgoing: ['Flow_Start_T1'] },
  };
  const flows: ProcessIR['flows'] = {};
  const chain = ['Start', ...TASKS.map((t) => t.id), 'End'];
  nodes.End = { type: 'end', name: '', incoming: [`Flow_${TASKS.at(-1)!.id}_End`], outgoing: [] };
  for (const task of TASKS) {
    nodes[task.id] = { type: 'task', name: '', incoming: [], outgoing: [] };
  }
  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i]!;
    const to = chain[i + 1]!;
    const flowId = `Flow_${from}_${to}`;
    flows[flowId] = { from, to, name: '', isDefault: false };
    nodes[from]!.outgoing.push(flowId);
    nodes[to]!.incoming.push(flowId);
  }
  return {
    id: 'Process_TheorySimpy',
    name: '',
    nodes,
    flows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

function buildScenario(): SimScenario {
  const resources: NonNullable<SimScenario['resources']> = {};
  const elements: NonNullable<SimScenario['elements']> = {
    Start: {
      interTriggerTimer: { type: 'exponential', mean: ARRIVAL_MEAN },
      triggerCount: N_CASES,
    },
  };
  for (const task of TASKS) {
    resources[task.id] = { capacity: task.capacity };
    elements[task.id] = {
      processingTime: { type: 'triangular', min: task.min, mode: task.mode, max: task.max },
      resources: [{ ref: task.id, quantity: 1 }],
    };
  }
  return { run: { seed: SEED, replications: REPLICATIONS }, resources, elements };
}

interface OracleResource {
  id: string;
  capacity: number;
  utilization: number;
  busyTime: number;
  waitMean: number;
}

interface OracleReplication {
  now: number;
  cycleTime: { mean: number; p95: number };
  resources: OracleResource[];
}

interface OracleOutput {
  params: { n: number; seed: number; replications: number; arrivalMean: number };
  replications: OracleReplication[];
}

function runOracle(): OracleOutput {
  const here = dirname(fileURLToPath(import.meta.url));
  const scriptPath = resolve(here, '../../../tools/oracles/des_simpy.py');
  const args = [
    'run',
    '--with',
    'simpy',
    'python',
    scriptPath,
    '--n',
    String(N_CASES),
    '--seed',
    String(SEED),
    '--replications',
    String(REPLICATIONS),
    '--arrival-mean',
    String(ARRIVAL_MEAN),
  ];
  let stdout: string;
  try {
    stdout = execFileSync('uv', args, { encoding: 'utf8', timeout: 60_000 });
  } catch (cause) {
    // Sin `uv` el fallo nativo es un escueto `spawnSync uv ENOENT`: se traduce a la causa real.
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
    throw new Error(
      'ORACLES=1 necesita `uv` en el PATH (https://astral.sh/uv) para correr tools/oracles/des_simpy.py',
      { cause },
    );
  }
  return JSON.parse(stdout) as OracleOutput;
}

/** Se solapan dos intervalos cerrados `[lo, hi]`. */
function overlaps(a: readonly [number, number], b: readonly [number, number]): boolean {
  return Math.max(a[0], b[0]) <= Math.min(a[1], b[1]);
}

describe.skipIf(!process.env.ORACLES)('LILA-049 · oráculo SimPy (ORACLES=1)', () => {
  test(
    `ciclo medio, p95 y utilización por recurso: los IC95 de ${REPLICATIONS} replicaciones se solapan entre Lila y SimPy`,
    () => {
      const ir = buildIr();
      const scenario = buildScenario();
      const lila = simulate(ir, scenario);
      const lilaKpis = lila.replications?.kpis;
      expect(lilaKpis, 'se esperaban replicaciones completas con IC95').toBeDefined();

      const oracle = runOracle();
      expect(oracle.replications).toHaveLength(REPLICATIONS);

      const lilaCi95 = (path: string): [number, number] => {
        const summary = lilaKpis![path];
        expect(summary, `falta el KPI ${path} en replications.kpis de Lila`).toBeDefined();
        return summary!.ci95;
      };
      const oracleCi95 = (values: readonly number[]): [number, number] => summarizeKpi(values).ci95;

      const checkOverlap = (label: string, lilaInterval: [number, number], oracleValues: readonly number[]): void => {
        const oracleInterval = oracleCi95(oracleValues);
        expect(
          overlaps(lilaInterval, oracleInterval),
          `${label}: IC95 Lila [${lilaInterval}] no se solapa con IC95 SimPy [${oracleInterval}]`,
        ).toBe(true);
      };

      checkOverlap(
        'process.cycleTime.mean',
        lilaCi95('process.cycleTime.mean'),
        oracle.replications.map((r) => r.cycleTime.mean),
      );
      checkOverlap(
        'process.cycleTime.p95',
        lilaCi95('process.cycleTime.p95'),
        oracle.replications.map((r) => r.cycleTime.p95),
      );

      for (const task of TASKS) {
        checkOverlap(
          `resources.${task.id}.utilization`,
          lilaCi95(`resources.${task.id}.utilization`),
          oracle.replications.map((r) => r.resources.find((res) => res.id === task.id)!.utilization),
        );
      }

      // Espera media por tarea (extra de Lila sobre Bizagi, docs/RESULTS_FORMAT.md §2): se
      // reporta "si es fácil" por el ticket; mismo método de solape de IC95 que las demás.
      for (const task of TASKS) {
        checkOverlap(
          `elements.${task.id}.resourceWait.mean`,
          lilaCi95(`elements.${task.id}.resourceWait.mean`),
          oracle.replications.map((r) => r.resources.find((res) => res.id === task.id)!.waitMean),
        );
      }
    },
    120_000,
  );
});
