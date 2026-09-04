import {
  BENCHMARK_CASES,
  BENCHMARK_TASKS,
  JIT_WARMUP_CASES,
  JIT_WARMUP_RUNS,
  runLinearBenchmark,
} from './linear-model.js';

const result = runLinearBenchmark();

console.log('LILA-031 benchmark');
console.log(`Node: ${process.version}`);
console.log(`Modelo: ${BENCHMARK_TASKS} tareas lineales`);
console.log(`Warmup JIT: ${JIT_WARMUP_RUNS} × ${JIT_WARMUP_CASES.toLocaleString('en-US')} casos`);
console.log(`Medición: ${BENCHMARK_CASES.toLocaleString('en-US')} casos en ${result.elapsedMs.toFixed(2)} ms`);
console.log('Objetivo local: < 1000 ms; umbral de regresión en CI: < 3000 ms');
