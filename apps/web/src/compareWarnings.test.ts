import { describe, expect, test } from 'vitest';

import { compareWarnings, runMetaFrom, type CompareRunMeta } from './compareWarnings.js';
import type { ResolvedScenario } from '@lila/engine/schema';
import type { RunResult } from '@lila/engine';
import { setLocale } from './i18n';

// This suite pins the Spanish translation. English is the app's base language since
// LILA-210, so the locale is set here instead of depending on the machine's.
setLocale('es');

function run(overrides: Partial<CompareRunMeta> = {}): CompareRunMeta {
  return { name: 'AS-IS', ...overrides };
}

describe('compareWarnings', () => {
  test('sin metadatos distintos: todo comparable y sin avisos', () => {
    const result = compareWarnings([run({ currency: 'USD', replications: 30, seed: 42 }), run({ currency: 'USD', name: 'TO-BE', replications: 30, seed: 42 })]);
    expect(result).toEqual({
      costsComparable: true,
      mixedReplicationDefinitions: false,
      significanceAvailable: true,
      unitsMixed: false,
      warnings: [],
    });
  });

  test('monedas distintas: costsComparable false y aviso con los dos códigos', () => {
    const result = compareWarnings([
      run({ currency: 'USD' }),
      run({ currency: 'MXN', name: 'TO-BE' }),
    ]);
    expect(result.costsComparable).toBe(false);
    expect(result.warnings).toContain('Costos en monedas distintas (USD vs MXN): no se comparan sin conversión.');
  });

  test('una corrida con moneda y otra sin ella también bloquea la comparación de costos', () => {
    const result = compareWarnings([run({ currency: 'USD' }), run({ name: 'TO-BE' })]);
    expect(result.costsComparable).toBe(false);
    expect(result.warnings).toContain('Costos en monedas distintas (USD vs sin moneda): no se comparan sin conversión.');
  });

  test('unidades de tiempo distintas: unitsMixed true y aviso', () => {
    const result = compareWarnings([
      run({ baseTimeUnit: 'min' }),
      run({ baseTimeUnit: 'h', name: 'TO-BE' }),
    ]);
    expect(result.unitsMixed).toBe(true);
    expect(result.warnings).toContain(
      'Unidades de tiempo distintas entre corridas (min vs h): cada valor se muestra con la unidad de su propia corrida.',
    );
  });

  test('sin baseTimeUnit declarado en ninguna corrida no hay aviso de unidades (nada que mezclar)', () => {
    const result = compareWarnings([run(), run({ name: 'TO-BE' })]);
    expect(result.unitsMixed).toBe(false);
  });

  test('replications ausente cuenta como 1: sin significancia y sin IC95', () => {
    const result = compareWarnings([run({ replications: 30 }), run({ name: 'TO-BE' })]);
    expect(result.significanceAvailable).toBe(false);
    expect(result.warnings).toContain('Sin intervalos de confianza: hacen falta ≥ 2 réplicas para hablar de significancia.');
  });

  test('replications = 1 en una corrida también bloquea la significancia', () => {
    const result = compareWarnings([run({ replications: 30 }), run({ name: 'TO-BE', replications: 1 })]);
    expect(result.significanceAvailable).toBe(false);
  });

  test('replications >= 2 en todas: significancia disponible', () => {
    const result = compareWarnings([run({ replications: 2 }), run({ name: 'TO-BE', replications: 5 })]);
    expect(result.significanceAvailable).toBe(true);
  });

  test('semillas distintas: aviso informativo, no bloquea nada', () => {
    const result = compareWarnings([
      run({ replications: 30, seed: 1 }),
      run({ name: 'TO-BE', replications: 30, seed: 2 }),
    ]);
    expect(result.warnings).toContain('Semillas distintas entre corridas (1 vs 2): las corridas no comparten la misma secuencia aleatoria.');
    expect(result.costsComparable).toBe(true);
    expect(result.significanceAvailable).toBe(true);
  });

  test('réplicas distintas (ambas >= 2): aviso informativo, no bloquea significancia', () => {
    const result = compareWarnings([run({ replications: 30 }), run({ name: 'TO-BE', replications: 10 })]);
    expect(result.warnings).toContain('Número de réplicas distinto entre corridas (30 vs 10).');
    expect(result.significanceAvailable).toBe(true);
  });

  test('una sola corrida: siempre comparable consigo misma, sin avisos', () => {
    const result = compareWarnings([run({ currency: 'USD', replications: 30, seed: 7 })]);
    // Una sola corrida no tiene con qué comparar (ni moneda ni unidad distintas posibles), y
    // replications=30 sí basta para su propio IC.
    expect(result).toEqual({
      costsComparable: true,
      mixedReplicationDefinitions: false,
      significanceAvailable: true,
      unitsMixed: false,
      warnings: [],
    });
  });

  // #356/#385: revisión de PR #384 — comparar una corrida de antes de 1.0.0-beta.1 (sin `n`)
  // contra una nueva (con `n`) puede marcar una diferencia "significativa" falsa.
  test('una corrida legado (sin n) y otra nueva (con n): significancia bloqueada y aviso propio', () => {
    const result = compareWarnings([
      run({ legacyReplications: true, replications: 30 }),
      run({ legacyReplications: false, name: 'TO-BE', replications: 30 }),
    ]);
    expect(result.significanceAvailable).toBe(false);
    expect(result.mixedReplicationDefinitions).toBe(true);
    expect(result.warnings).toContain(
      'Las corridas comparadas usan estadísticas de replicación distintas (una se calculó antes de 1.0.0-beta.1); no se muestran las marcas de significancia.',
    );
    // Y no dispara además el aviso genérico de "hacen falta ≥ 2 réplicas": las dos corridas sí
    // tienen réplicas suficientes, lo que falta es que compartan definición.
    expect(result.warnings).not.toContain('Sin intervalos de confianza: hacen falta ≥ 2 réplicas para hablar de significancia.');
  });

  test('todas las corridas legado (sin n): no es una mezcla, significancia sigue las réplicas como siempre', () => {
    const result = compareWarnings([
      run({ legacyReplications: true, replications: 30 }),
      run({ legacyReplications: true, name: 'TO-BE', replications: 30 }),
    ]);
    expect(result.significanceAvailable).toBe(true);
    expect(result.mixedReplicationDefinitions).toBe(false);
    expect(result.warnings).not.toContain(
      'Las corridas comparadas usan estadísticas de replicación distintas (una se calculó antes de 1.0.0-beta.1); no se muestran las marcas de significancia.',
    );
  });

  test('todas las corridas nuevas (con n): sin aviso de definiciones mezcladas', () => {
    const result = compareWarnings([
      run({ legacyReplications: false, replications: 30 }),
      run({ legacyReplications: false, name: 'TO-BE', replications: 30 }),
    ]);
    expect(result.significanceAvailable).toBe(true);
    expect(result.mixedReplicationDefinitions).toBe(false);
    expect(result.warnings).toEqual([]);
  });

  test('una corrida legado de 30 réplicas contra una sin resumen de replicaciones: no es mezcla (QA #385)', () => {
    // La corrida sin `legacyReplications` (ni resumen de replicaciones, p. ej. una sola réplica)
    // no es "nueva": es "no aplica", y compararla con una legado no mezcla las dos definiciones.
    const result = compareWarnings([run({ legacyReplications: true, replications: 30 }), run({ name: 'TO-BE', replications: 1 })]);
    expect(result.mixedReplicationDefinitions).toBe(false);
    expect(result.warnings).not.toContain(
      'Las corridas comparadas usan estadísticas de replicación distintas (una se calculó antes de 1.0.0-beta.1); no se muestran las marcas de significancia.',
    );
  });

  test('legacyReplications ausente en ambas (sin resumen de replicaciones que mirar): sin aviso de mezcla', () => {
    const result = compareWarnings([run({ replications: 30 }), run({ name: 'TO-BE', replications: 30 })]);
    expect(result.warnings).not.toContain(
      'Las corridas comparadas usan estadísticas de replicación distintas (una se calculó antes de 1.0.0-beta.1); no se muestran las marcas de significancia.',
    );
  });
});

describe('runMetaFrom', () => {
  test('toma moneda, semilla, réplicas, unidad y warnings del escenario/resultado', () => {
    const scenario = {
      run: { baseTimeUnit: 'min', currency: 'USD', replications: 30, seed: 42 },
    } as unknown as ResolvedScenario;
    const result = { warnings: ['aviso de prueba'] } as unknown as RunResult;

    expect(runMetaFrom('AS-IS', scenario, result)).toEqual({
      baseTimeUnit: 'min',
      currency: 'USD',
      name: 'AS-IS',
      replications: 30,
      seed: 42,
      warnings: ['aviso de prueba'],
    });
  });

  // #356/#385
  test('legacyReplications: true cuando las entradas de replications.kpis no traen n', () => {
    const scenario = { run: {} } as unknown as ResolvedScenario;
    const result = {
      replications: { count: 30, kpis: { 'process.cycleTime.mean': { ci95: [1, 2], mean: 1.5, sd: 0.3 } } },
      warnings: [],
    } as unknown as RunResult;

    expect(runMetaFrom('AS-IS', scenario, result).legacyReplications).toBe(true);
  });

  test('legacyReplications: false cuando las entradas de replications.kpis traen n', () => {
    const scenario = { run: {} } as unknown as ResolvedScenario;
    const result = {
      replications: { count: 30, kpis: { 'process.cycleTime.mean': { mean: 1.5, n: 30 } } },
      warnings: [],
    } as unknown as RunResult;

    expect(runMetaFrom('AS-IS', scenario, result).legacyReplications).toBe(false);
  });

  // #385 QA: mira todas las entradas de `kpis`, no solo la primera.
  test('legacyReplications: true si CUALQUIER entrada de kpis no trae n, aunque la primera sí', () => {
    const scenario = { run: {} } as unknown as ResolvedScenario;
    const result = {
      replications: {
        count: 30,
        kpis: {
          'elements.A.processing.mean': { mean: 1.5, n: 30 },
          'process.cycleTime.mean': { ci95: [1, 2], mean: 1.5, sd: 0.3 },
        },
      },
      warnings: [],
    } as unknown as RunResult;

    expect(runMetaFrom('AS-IS', scenario, result).legacyReplications).toBe(true);
  });

  test('legacyReplications: ausente del objeto cuando la corrida no tiene resumen de replicaciones', () => {
    const scenario = { run: {} } as unknown as ResolvedScenario;
    const result = { warnings: [] } as unknown as RunResult;

    expect(runMetaFrom('AS-IS', scenario, result)).not.toHaveProperty('legacyReplications');
  });
});
