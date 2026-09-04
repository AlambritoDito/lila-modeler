import { afterEach, describe, expect, test, vi } from 'vitest';

import { runLinearBenchmark } from '../bench/linear-model.js';

afterEach(() => vi.restoreAllMocks());

describe('QA adversarial del benchmark (LILA-031)', () => {
  test.each([0, -1, 1.5, Number.NaN])('rechaza un conteo de casos irreal: %s', (caseCount) => {
    expect(() => runLinearBenchmark({ caseCount, warmupRuns: 0 })).toThrow('E-BENCH-CASOS');
  });

  test('rechaza un reloj regresivo en vez de aprobar por duración negativa', () => {
    vi.spyOn(globalThis.performance, 'now').mockReturnValueOnce(10).mockReturnValueOnce(5);

    expect(() => runLinearBenchmark({ caseCount: 1, warmupRuns: 0 })).toThrow('E-BENCH-RELOJ');
  });

  test('rechaza un reloj no finito', () => {
    vi.spyOn(globalThis.performance, 'now').mockReturnValue(Number.NaN);

    expect(() => runLinearBenchmark({ caseCount: 1, warmupRuns: 0 })).toThrow('E-BENCH-RELOJ');
  });
});
