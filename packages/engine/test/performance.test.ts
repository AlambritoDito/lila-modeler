import { expect, test } from 'vitest';

import {
  BENCHMARK_CASES,
  BENCHMARK_TASKS,
  JIT_WARMUP_CASES,
  JIT_WARMUP_RUNS,
  runLinearBenchmark,
} from '../bench/linear-model.js';

// Aceptación LILA-031: objetivo local < 1 s. El umbral de 3 s evita flakes en CI compartido,
// pero sigue detectando una regresión de orden de magnitud. El runner calienta el JIT antes de
// iniciar el reloj y valida que los 100 000 casos recorrieron las cinco tareas.
test(
  '100 000 casos × 5 tareas tardan menos de 3 s (objetivo local: 1 s)',
  () => {
    const result = runLinearBenchmark();

    expect(result).toMatchObject({
      caseCount: BENCHMARK_CASES,
      taskCount: BENCHMARK_TASKS,
      warmupCases: JIT_WARMUP_CASES,
      warmupRuns: JIT_WARMUP_RUNS,
    });
    expect(result.elapsedMs).toBeLessThan(3_000);
  },
  10_000,
);
