import { describe, expect, test } from 'vitest';

import { compareWarnings, runMetaFrom, type CompareRunMeta } from './compareWarnings.js';
import type { ResolvedScenario } from '@lila/engine/schema';
import type { RunResult } from '@lila/engine';

function run(overrides: Partial<CompareRunMeta> = {}): CompareRunMeta {
  return { name: 'AS-IS', ...overrides };
}

describe('compareWarnings', () => {
  test('sin metadatos distintos: todo comparable y sin avisos', () => {
    const result = compareWarnings([run({ currency: 'USD', replications: 30, seed: 42 }), run({ currency: 'USD', name: 'TO-BE', replications: 30, seed: 42 })]);
    expect(result).toEqual({ costsComparable: true, significanceAvailable: true, unitsMixed: false, warnings: [] });
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
    expect(result).toEqual({ costsComparable: true, significanceAvailable: true, unitsMixed: false, warnings: [] });
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
});
