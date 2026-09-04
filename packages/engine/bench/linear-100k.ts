import {
  BENCHMARK_CASES,
  BENCHMARK_TASKS,
  CI_REGRESSION_MS,
  JIT_WARMUP_CASES,
  JIT_WARMUP_RUNS,
  LOCAL_TARGET_MS,
  runLinearBenchmark,
} from './linear-model.js';

const result = runLinearBenchmark();

console.log('LILA-031 benchmark');
console.log(`Node: ${process.version}`);
console.log(`Modelo: ${BENCHMARK_TASKS} tareas lineales`);
console.log(`Warmup JIT: ${JIT_WARMUP_RUNS} × ${JIT_WARMUP_CASES.toLocaleString('en-US')} casos`);
console.log(`Medición: ${BENCHMARK_CASES.toLocaleString('en-US')} casos en ${result.elapsedMs.toFixed(2)} ms`);
console.log(
  `Trabajo verificado: ${result.completedCases.toLocaleString('en-US')} casos; ` +
    `${result.completedTaskExecutions.toLocaleString('en-US')} ejecuciones de tarea`,
);
console.log(`Objetivo local: < ${LOCAL_TARGET_MS} ms; umbral de regresión en CI: < ${CI_REGRESSION_MS} ms`);

if (result.elapsedMs >= LOCAL_TARGET_MS) {
  console.error(`E-BENCH-LENTO: ${result.elapsedMs.toFixed(2)} ms excede el objetivo local.`);
  process.exitCode = 1;
}
