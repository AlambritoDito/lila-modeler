import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { runResultSchema } from '../src/result.schema.js';
import type { ResolvedScenario } from '../src/scenario.js';
import {
  canonicalJson,
  loadPedidoScenario,
  numericDiffs,
  PEDIDO_NIVEL3_GOLDEN_PATH,
  renderPedidoScenario,
  withoutCalendars,
} from './golden/pedido.js';

const TOL = 1e-9;

/**
 * QA adversarial del oráculo de R-DEG-2. El golden de nivel 3 se compara byte a byte solo en el
 * CI; fuera de él la red es `numericDiffs`, así que lo que se prueba aquí es que esa red no deje
 * pasar un cambio semántico del motor mientras absorbe la deriva de último bit entre
 * arquitecturas (R-DET-6).
 */
describe('QA del comparador tolerante (R-DEG-2)', () => {
  test('la tolerancia es relativa y estrecha: 1e-10 pasa, 1e-8 falla', () => {
    expect(numericDiffs(1000 * (1 + 1e-10), 1000, TOL)).toEqual([]);
    expect(numericDiffs(1000 * (1 + 1e-8), 1000, TOL)).not.toEqual([]);
  });

  test('con esperado 0 no hay división por cero: el suelo de escala es 1', () => {
    expect(numericDiffs(1e-10, 0, TOL)).toEqual([]);
    expect(numericDiffs(1e-8, 0, TOL)).not.toEqual([]);
    // `-0` y `0` se serializan igual en JSON, así que darlos por iguales es lo coherente.
    expect(numericDiffs(-0, 0, TOL)).toEqual([]);
  });

  test('un ±Infinity contra un finito es diferencia, no igualdad', () => {
    // Regresión: con `scale = Infinity`, `|a-e| <= tol*scale` se cumple siempre y el par se daba
    // por igual. `JSON.parse` no produce Infinity, pero el helper es de uso general.
    expect(numericDiffs(Number.POSITIVE_INFINITY, 1000, TOL)).not.toEqual([]);
    expect(numericDiffs(Number.NEGATIVE_INFINITY, 5, TOL)).not.toEqual([]);
    expect(numericDiffs(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, TOL)).not.toEqual([]);
  });

  test('NaN, null y cambio de tipo son diferencia', () => {
    expect(numericDiffs(Number.NaN, 1000, TOL)).not.toEqual([]);
    expect(numericDiffs(null, 1000, TOL)).not.toEqual([]);
    expect(numericDiffs(1000, null, TOL)).not.toEqual([]);
    expect(numericDiffs('1000', 1000, TOL)).not.toEqual([]);
    expect(numericDiffs({}, [], TOL)).not.toEqual([]);
    expect(numericDiffs([], {}, TOL)).not.toEqual([]);
  });

  test('claves de más, de menos o en otro orden rompen la comparación', () => {
    expect(numericDiffs({ a: 1, b: 2 }, { a: 1 }, TOL)).not.toEqual([]);
    expect(numericDiffs({ a: 1 }, { a: 1, b: 2 }, TOL)).not.toEqual([]);
    expect(numericDiffs({ b: 2, a: 1 }, { a: 1, b: 2 }, TOL)).not.toEqual([]);
    expect(numericDiffs({ a: 1, b: 2 }, { a: 1, b: 2 }, TOL)).toEqual([]);
  });

  test('strings distintos y arrays más cortos rompen la comparación', () => {
    expect(numericDiffs({ id: 'Task_B' }, { id: 'Task_A' }, TOL)).not.toEqual([]);
    expect(numericDiffs([1, 2], [1, 2, 3], TOL)).not.toEqual([]);
    expect(numericDiffs([1, 2, 3], [1, 2], TOL)).not.toEqual([]);
    // Y llega hasta el fondo del anidamiento, no solo al primer nivel.
    expect(numericDiffs({ a: { b: [{ c: 1.1 }] } }, { a: { b: [{ c: 1 }] } }, TOL)).not.toEqual([]);
  });
});

describe('QA del golden de nivel 3 (R-DEG-2)', () => {
  const golden = readFileSync(PEDIDO_NIVEL3_GOLDEN_PATH, 'utf8');

  // Fuera del CI la comparación pasa por `JSON.parse`, así que ni el salto de línea final ni la
  // sangría ni un CRLF colado se verificarían en el Mac. El golden de M1 sí tiene esta red.
  test('el archivo es JSON canónico, termina en salto de línea y no trae CR', () => {
    expect(golden.endsWith('\n')).toBe(true);
    expect(golden).not.toContain('\r');
    expect(canonicalJson(JSON.parse(golden))).toBe(golden);
  });

  test('el golden valida contra runResultSchema', () => {
    expect(runResultSchema.safeParse(JSON.parse(golden)).success).toBe(true);
  });

  // El riesgo del cambio de huella fija a comparación tolerante es esconder un cambio real del
  // motor detrás de la tolerancia. Estas dos mutaciones son las mínimas que sí lo mueven.
  test('un cambio semántico real sigue rompiendo el golden en cualquier plataforma', async () => {
    const parsed: unknown = JSON.parse(golden);

    const base = withoutCalendars(loadPedidoScenario(42));
    const cocinero = base.resources?.cocinero;
    const aprobado = base.elements?.Flow_Aprobado;
    if (cocinero === undefined || aprobado === undefined) {
      throw new Error('examples/pedido debe declarar el pool cocinero y el flujo Flow_Aprobado.');
    }
    expect(cocinero.capacity).toBe(3);
    expect(aprobado.probability).toBe(0.78);

    const conMasCapacidad: ResolvedScenario = {
      ...base,
      resources: { ...base.resources, cocinero: { ...cocinero, capacity: 4 } },
    };
    const otraProbabilidad: ResolvedScenario = {
      ...base,
      elements: {
        ...base.elements,
        Flow_Aprobado: { ...aprobado, probability: 0.5 },
        Flow_Rechazado: { ...base.elements?.Flow_Rechazado, probability: 0.5 },
      },
    };

    expect(numericDiffs(JSON.parse(await renderPedidoScenario(conMasCapacidad)), parsed, TOL))
      .not.toEqual([]);
    expect(numericDiffs(JSON.parse(await renderPedidoScenario(otraProbabilidad)), parsed, TOL))
      .not.toEqual([]);
  }, 60_000);
});
