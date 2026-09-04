import { expect, test } from 'vitest';

import {
  BENCHMARK_CASES,
  BENCHMARK_TASKS,
  CI_REGRESSION_MS,
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

    // Literales deliberados: importar solo las constantes permitiría reducir el workload y
    // mantener la prueba verde por accidente.
    expect(BENCHMARK_CASES).toBe(100_000);
    expect(BENCHMARK_TASKS).toBe(5);
    expect(CI_REGRESSION_MS).toBe(3_000);
    expect(result).toMatchObject({
      caseCount: 100_000,
      taskCount: 5,
      warmupCases: JIT_WARMUP_CASES,
      warmupRuns: JIT_WARMUP_RUNS,
      completedCases: 100_000,
      completedTaskExecutions: 500_000,
    });
    expect(result.elapsedMs).toBeLessThan(CI_REGRESSION_MS);
  },
  10_000,
);
