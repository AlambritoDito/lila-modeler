import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { parseBpmn } from '../src/bpmn/index.js';
import { simulate, type EventLogRow } from '../src/index.js';
import type { ResolvedScenario } from '../src/scenario.js';
import {
  loadPedidoScenario,
  PEDIDO_GOLDEN_PATH,
  PEDIDO_NIVEL3_GOLDEN_PATH,
  renderPedidoScenario,
  withoutCalendars,
  withoutResourcesAndCalendars,
} from './golden/pedido.js';

const PEDIDO_MODEL = new URL('../../../examples/pedido/model.bpmn', import.meta.url);

describe('degradación semántica (LILA-039)', () => {
  test('sin recursos ni calendarios conserva byte a byte el resultado de M1', async () => {
    const source = loadPedidoScenario(42);

    // El fixture de partida debe ejercitar de verdad todas las referencias que retiramos. Si el
    // ejemplo cambia, la prueba no puede convertirse accidentalmente en un caso ya degradado.
    expect(Object.keys(source.resources ?? {})).not.toHaveLength(0);
    expect(Object.keys(source.calendars ?? {})).not.toHaveLength(0);
    expect(source.elements?.Task_TomarPedido?.resources).toBeDefined();
    expect(source.elements?.Task_Preparar?.selection).toBe('and');
    expect(source.elements?.StartEvent_Pedido?.calendar).toBe('oficina');

    const degraded = withoutResourcesAndCalendars(source);

    expect(degraded.resources).toBeUndefined();
    expect(degraded.calendars).toBeUndefined();
    for (const configuration of Object.values(degraded.elements ?? {})) {
      expect(Object.hasOwn(configuration, 'resources')).toBe(false);
      expect(Object.hasOwn(configuration, 'selection')).toBe(false);
      expect(Object.hasOwn(configuration, 'calendar')).toBe(false);
    }

    // La transformación es por copia: el escenario real sigue conservando las capas de M2/M3.
    expect(source.elements?.Task_TomarPedido?.resources).toBeDefined();
    expect(source.elements?.StartEvent_Pedido?.calendar).toBe('oficina');

    const actual = await renderPedidoScenario(degraded);
    const expected = readFileSync(PEDIDO_GOLDEN_PATH, 'utf8');
    expect(actual).toBe(expected);
  }, 60_000); // ponytail: 30 réplicas; mismo techo holgado que el control positivo de abajo

  // Control positivo: sin él, la igualdad byte a byte anterior también se cumpliría si el motor
  // ignorara `resources` por completo, que es justo lo que R-DEG-1 tiene que distinguir.
  test('reintroducir un solo pool sí mueve el resultado', async () => {
    const source = loadPedidoScenario(42);
    const degraded = withoutResourcesAndCalendars(source);
    const pool = source.resources?.cajero;
    const declared = source.elements?.Task_TomarPedido?.resources;
    const task = degraded.elements?.Task_TomarPedido;
    if (pool === undefined || declared === undefined || task === undefined) {
      throw new Error('examples/pedido/as-is.scenario.json debe pedir el pool cajero en Task_TomarPedido.');
    }

    // Un único pool sin calendario: lo que LILA-033 ya sabe simular, sin tocar nada más.
    const cajero = { ...pool };
    delete cajero.calendar;
    const withCajero: ResolvedScenario = {
      ...degraded,
      resources: { cajero },
      elements: { ...degraded.elements, Task_TomarPedido: { ...task, resources: declared } },
    };

    const actual = await renderPedidoScenario(withCajero);
    expect(actual).not.toBe(readFileSync(PEDIDO_GOLDEN_PATH, 'utf8'));
  }, 60_000); // ponytail: 30 réplicas con pool real rondan los 5 s en CI Node 22; techo holgado, no medida de rendimiento

  // El golden solo contiene el resumen agregado: sin esta prueba, el event log del escenario
  // degradado podría inventar asignaciones (R-REC-11) o costos (R-DEG-5) sin romper los bytes.
  test('el event log degradado es una sola fila sentinel por actividad', async () => {
    const degraded = withoutResourcesAndCalendars(loadPedidoScenario(42));
    // Una réplica basta: la sentinel es una invariante por fila y mantiene la prueba barata.
    const scenario: ResolvedScenario = { ...degraded, run: { ...degraded.run, replications: 1 } };
    const parsedBpmn = await parseBpmn(readFileSync(PEDIDO_MODEL, 'utf8'));

    const seen = new Set<string>();
    const offenders: EventLogRow[] = [];
    let rows = 0;
    simulate(parsedBpmn.ir, scenario, {
      onEvent: (row) => {
        rows++;
        const key = `${row.replication}#${row.activityInstanceId}`;
        const duplicated = seen.has(key);
        seen.add(key);
        if (
          duplicated
          || row.resourceId !== null
          || row.allocationIndex !== null
          || row.resourceQuantity !== null
          || row.resourceWait !== 0
          || row.offHoursWait !== 0
          || row.resourceCost !== 0
        ) {
          if (offenders.length < 3) offenders.push(row);
        }
      },
    });

    expect(rows).toBeGreaterThan(0);
    expect(seen.size).toBe(rows);
    expect(offenders).toEqual([]);
  });
});

/**
 * Compara dos `RunResult` canónicos con tolerancia **relativa** en los números y estricta en todo
 * lo demás (claves, orden de claves, strings, longitudes). Es lo que se usa fuera del CI: entre
 * arquitecturas `Math.log`/`Math.exp`/`Math.cos` difieren en el último bit, y con colas de por
 * medio esa diferencia deja de cancelarse (R-DET-6). Devuelve las rutas que se salen de `tol`.
 */
function numericDiffs(actual: unknown, expected: unknown, tol: number, path = ''): string[] {
  if (typeof expected === 'number' && typeof actual === 'number') {
    if (Object.is(actual, expected)) return [];
    const scale = Math.max(Math.abs(expected), Math.abs(actual), 1);
    return Math.abs(actual - expected) <= tol * scale ? [] : [`${path}: ${actual} ≠ ${expected}`];
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual) || actual.length !== expected.length) {
      return [`${path}: arrays distintos`];
    }
    return expected.flatMap((item, index) => numericDiffs(actual[index], item, tol, `${path}[${index}]`));
  }
  if (expected !== null && actual !== null && typeof expected === 'object' && typeof actual === 'object') {
    const expectedKeys = Object.keys(expected);
    const actualKeys = Object.keys(actual);
    // El orden de claves es parte del contrato del golden, no solo el conjunto.
    if (expectedKeys.join('\u0000') !== actualKeys.join('\u0000')) return [`${path}: claves distintas`];
    return expectedKeys.flatMap((key) =>
      numericDiffs(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        tol,
        path === '' ? key : `${path}.${key}`,
      ),
    );
  }
  return Object.is(actual, expected) ? [] : [`${path}: ${String(actual)} ≠ ${String(expected)}`];
}

/**
 * Compara contra un golden versionado. En el CI (Linux x64, la plataforma que generó el archivo)
 * la igualdad es **byte a byte**; fuera del CI se admite deriva de último bit con tolerancia
 * relativa 1e-9, que sigue siendo siete órdenes de magnitud más estricta que cualquier cambio
 * semántico real del motor (R-DET-6).
 */
function expectGolden(actual: string, goldenPath: string): void {
  const expected = readFileSync(goldenPath, 'utf8');
  if (process.env.CI !== undefined && process.env.CI !== '' && process.env.CI !== 'false') {
    expect(actual).toBe(expected);
    return;
  }
  expect(numericDiffs(JSON.parse(actual), JSON.parse(expected), 1e-9)).toEqual([]);
}

describe('degradación de calendarios (LILA-043)', () => {
  test('sin `calendars` el resultado es bit a bit el del motor de M2 (R-DEG-2)', async () => {
    const source = loadPedidoScenario(42);

    // El fixture de partida tiene que ejercitar de verdad la capa que retiramos.
    expect(Object.keys(source.calendars ?? {})).not.toHaveLength(0);
    expect(source.resources?.cajero?.calendar).toBe('oficina');
    expect(source.elements?.StartEvent_Pedido?.calendar).toBe('oficina');

    const degraded = withoutCalendars(source);

    expect(degraded.calendars).toBeUndefined();
    for (const pool of Object.values(degraded.resources ?? {})) {
      expect(Object.hasOwn(pool, 'calendar')).toBe(false);
    }
    for (const element of Object.values(degraded.elements ?? {})) {
      expect(Object.hasOwn(element, 'calendar')).toBe(false);
    }
    // Los recursos siguen ahí: esto es nivel 3, no nivel 1.
    expect(Object.keys(degraded.resources ?? {})).toHaveLength(3);
    expect(degraded.elements?.Task_Preparar?.selection).toBe('and');

    expectGolden(await renderPedidoScenario(degraded), PEDIDO_NIVEL3_GOLDEN_PATH);
  }, 60_000);

  // Control positivo: sin él, el golden anterior también cuadraría si el motor ignorase
  // `calendars` por completo, que es exactamente lo que R-DEG-2 tiene que distinguir. Aquí la
  // comparación es de bytes en cualquier plataforma: la diferencia que busca es enorme, no de ULP.
  test('reintroducir el calendario `oficina` sí mueve el resultado', async () => {
    const source = loadPedidoScenario(42);
    const actual = await renderPedidoScenario(source);

    expect(actual).not.toBe(readFileSync(PEDIDO_NIVEL3_GOLDEN_PATH, 'utf8'));
    expect(numericDiffs(JSON.parse(actual), JSON.parse(readFileSync(PEDIDO_NIVEL3_GOLDEN_PATH, 'utf8')), 1e-9))
      .not.toEqual([]);
  }, 60_000);

  test('el golden de M1 tampoco se mueve al añadir calendarios al motor (R-DEG-1)', async () => {
    // La degradación total (sin recursos y sin calendarios) sigue produciendo los mismos bytes
    // versionados: los dos escalones de degradación son independientes.
    const actual = await renderPedidoScenario(withoutResourcesAndCalendars(loadPedidoScenario(42)));

    expect(actual).toBe(readFileSync(PEDIDO_GOLDEN_PATH, 'utf8'));
  }, 60_000);
});
