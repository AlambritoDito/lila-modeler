import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { simulate } from '../src/index.js';
import type { ProcessIR } from '../src/core/ir.js';
import type { SimScenario } from '../src/core/sim.js';

/**
 * LILA-052 · oráculo Prosimos (fixture congelado).
 *
 * Tercera pata de la validación numérica, junto a `theory-simpy.test.ts` (SimPy) y
 * `mm1.test.ts` (Erlang-C): el mismo modelo de 5 tareas secuenciales corrido con
 * [Prosimos](https://github.com/AutomatedProcessImprovement/Prosimos), cuya salida está
 * **congelada** en `fixtures/oracles/prosimos-chain5.json`.
 *
 * A diferencia del oráculo SimPy, este test **corre siempre**: no invoca Python. Prosimos no
 * declara licencia (`docs/ORACLES.md` §Prosimos), así que ni su código ni sus binarios entran al
 * repo ni a CI; lo único versionado son las cifras que produjo, regenerables a mano con
 * `tools/oracles/run_prosimos.sh` (`ORACLES=1` lo hace desde aquí).
 *
 * Desviación deliberada respecto de `theory-simpy.test.ts`: **duraciones uniformes, no
 * triangulares**. Prosimos no implementa la triangular (`DurationDistribution.from_dict` de
 * `pix_framework` no tiene rama para `triang`), y aproximarla con otra familia compararía dos
 * leyes distintas. La uniforme sobre el mismo `[min, max]` la muestrean idénticamente los dos
 * motores, así que la comparación mide semántica de cola y contabilidad, no ajuste de
 * distribución. Todo lo demás — topología, capacidades, llegadas, 24×7 — es el modelo de
 * `tools/oracles/des_simpy.py`.
 */

const N_CASES = 5000;
const SEED = 42;
const REPLICATIONS = 30;
const ARRIVAL_MEAN = 10; // segundos

// Mismas 5 tareas y capacidades que tools/oracles/to_prosimos.py (verificado contra el fixture).
const TASKS = [
  { id: 'T1', capacity: 2, min: 5, max: 15 },
  { id: 'T2', capacity: 3, min: 10, max: 30 },
  { id: 'T3', capacity: 1, min: 3, max: 8 },
  { id: 'T4', capacity: 2, min: 8, max: 20 },
  { id: 'T5', capacity: 1, min: 2, max: 7 },
] as const;

/**
 * Tolerancias. El fixture es un punto congelado de 30 replicaciones de Prosimos y Lila corre
 * otras 30 con su propio RNG: no hay ninguna semilla común, así que comparar IC95 contra IC95
 * (el método de `theory-simpy.test.ts`, donde ambos lados se recalculan en la misma corrida) no
 * añade nada aquí y sí haría el test frágil — con 30 replicaciones de 5000 casos los IC95 son
 * de ±0.5 % y cualquier diferencia de semántica de tercer orden los separaría. Se compara media
 * contra media con un margen holgado respecto del ruido observado:
 *
 * - `cycleTimeMean` ±3 %: el IC95 relativo de cada lado ronda ±0.6 %; 3 % deja ~5σ de margen y
 *   aun así detecta un error de contabilidad (una espera perdida mueve el ciclo mucho más).
 * - `cycleTimeP95` ±5 %: un percentil de cola tiene más varianza entre replicaciones que la media.
 * - `utilization` ±0.03 **absoluto**: la utilización es un ratio en [0, 1] y su error natural es
 *   aditivo (el 1 ms/día de hueco del calendario 24×7 de Prosimos, el redondeo del makespan);
 *   un margen relativo castigaría de más a los recursos poco cargados.
 * - `resourceWait` ±10 %: la espera en cola es la métrica más sensible del modelo (crece de
 *   forma no lineal con la utilización), así que su ruido relativo es el mayor de las cuatro.
 */
const TOLERANCE = {
  cycleTimeMean: 0.03,
  cycleTimeP95: 0.05,
  utilization: 0.03,
  resourceWait: 0.1,
} as const;

interface Fixture {
  prosimosVersion: string;
  params: { n: number; seed: number; replications: number };
  model: {
    arrival: { type: string; mean: number };
    tasks: { id: string; capacity: number; processingTime: { type: string; min: number; max: number } }[];
  };
  kpis: Record<string, { mean: number; ci95: [number, number] }>;
}

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, 'fixtures/oracles/prosimos-chain5.json');
const scriptPath = resolve(here, '../../../tools/oracles/run_prosimos.sh');

/** `ORACLES=1` regenera el fixture invocando Prosimos (sólo en desarrollo; nunca en CI). */
function regenerateFixture(): void {
  execFileSync(
    scriptPath,
    ['--n', String(N_CASES), '--seed', String(SEED), '--replications', String(REPLICATIONS)],
    { encoding: 'utf8', timeout: 600_000, stdio: 'inherit' },
  );
}

function buildIr(): ProcessIR {
  const nodes: ProcessIR['nodes'] = {
    Start: { type: 'start', name: '', incoming: [], outgoing: [] },
    End: { type: 'end', name: '', incoming: [], outgoing: [] },
  };
  const flows: ProcessIR['flows'] = {};
  for (const task of TASKS) nodes[task.id] = { type: 'task', name: '', incoming: [], outgoing: [] };

  const chain = ['Start', ...TASKS.map((t) => t.id), 'End'];
  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i]!;
    const to = chain[i + 1]!;
    const flowId = `Flow_${from}_${to}`;
    flows[flowId] = { from, to, name: '', isDefault: false };
    nodes[from]!.outgoing.push(flowId);
    nodes[to]!.incoming.push(flowId);
  }
  return {
    id: 'Process_TheoryProsimos',
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
      processingTime: { type: 'uniform', min: task.min, max: task.max },
      resources: [{ ref: task.id, quantity: 1 }],
    };
  }
  return { run: { seed: SEED, replications: REPLICATIONS }, resources, elements };
}

describe('LILA-052 · oráculo Prosimos (fixture congelado)', () => {
  test(
    'ciclo medio, p95, utilización y espera por recurso caen dentro de la tolerancia del fixture',
    () => {
      if (process.env.ORACLES) regenerateFixture();
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;

      // El fixture es el contrato del modelo: si alguien cambia una capacidad aquí sin
      // regenerarlo, el test debe decirlo antes de comparar KPI y no como "no cuadra el ciclo".
      expect(fixture.params.n, 'el fixture se generó con otro número de casos').toBe(N_CASES);
      expect(fixture.params.replications).toBe(REPLICATIONS);
      expect(fixture.model.arrival).toEqual({ type: 'exponential', mean: ARRIVAL_MEAN });
      expect(fixture.model.tasks).toEqual(
        TASKS.map((t) => ({
          id: t.id,
          capacity: t.capacity,
          processingTime: { type: 'uniform', min: t.min, max: t.max },
        })),
      );

      const lila = simulate(buildIr(), buildScenario());
      const lilaKpis = lila.replications?.kpis;
      expect(lilaKpis, 'se esperaban replicaciones completas con IC95').toBeDefined();

      const check = (path: string, tolerance: number, absolute = false): void => {
        const expected = fixture.kpis[path];
        expect(expected, `falta el KPI ${path} en el fixture de Prosimos`).toBeDefined();
        const actual = lilaKpis![path];
        expect(actual, `falta el KPI ${path} en replications.kpis de Lila`).toBeDefined();
        const margin = absolute ? tolerance : Math.abs(expected!.mean) * tolerance;
        expect(
          Math.abs(actual!.mean - expected!.mean),
          `${path}: Lila ${actual!.mean} vs Prosimos ${expected!.mean} (margen ${margin})`,
        ).toBeLessThanOrEqual(margin);
      };

      check('process.cycleTime.mean', TOLERANCE.cycleTimeMean);
      check('process.cycleTime.p95', TOLERANCE.cycleTimeP95);
      for (const task of TASKS) {
        check(`resources.${task.id}.utilization`, TOLERANCE.utilization, true);
        check(`elements.${task.id}.resourceWait.mean`, TOLERANCE.resourceWait);
      }
    },
    // 60 s de sobra para el camino normal (≈1.2 s: 30 replicaciones de Lila y leer un JSON).
    // Con `ORACLES=1` hay que crear el venv, instalar Prosimos y correr sus 30 replicaciones.
    process.env.ORACLES ? 600_000 : 60_000,
  );
});
