import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import { parseBpmn } from '../src/bpmn/index.js';
import { simulate, type EventLogRow } from '../src/index.js';
import type { ResolvedScenario } from '../src/scenario.js';
import {
  loadPedidoScenario,
  PEDIDO_GOLDEN_PATH,
  renderPedidoScenario,
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
 * Retira **solo** la capa de calendarios: `calendars`, `resources[*].calendar` y
 * `elements[*].calendar`. Los pools de M2 se quedan intactos, que es justo la entrada que
 * entendía el motor de M2. Vive aquí, y no en `golden/pedido.ts`, porque es el único consumidor.
 */
function withoutCalendars(scenario: ResolvedScenario): ResolvedScenario {
  const degraded: ResolvedScenario = {
    ...scenario,
    resources: Object.fromEntries(
      Object.entries(scenario.resources ?? {}).map(([poolId, pool]) => {
        const copy = { ...pool };
        delete copy.calendar;
        return [poolId, copy];
      }),
    ),
    elements: Object.fromEntries(
      Object.entries(scenario.elements ?? {}).map(([elementId, element]) => {
        const copy = { ...element };
        delete copy.calendar;
        return [elementId, copy];
      }),
    ),
  };
  delete degraded.calendars;
  return degraded;
}

describe('degradación de calendarios (LILA-043)', () => {
  /**
   * SHA-256 del `RunResult` canónico de `examples/pedido` con seed 42, recursos completos y
   * **sin** calendarios, tal y como lo producía el motor de M2 (`origin/main` en 82940e0, antes
   * de que LILA-041 cablease `core/calendar.ts`). Es el oráculo de R-DEG-2, y va como huella y no
   * como archivo porque el único golden versionado del repo es el de M1 (LILA-030/039) y este
   * ticket no puede moverlo. Se regenera desde un worktree en ese commit con:
   *
   *   renderPedidoScenario(withoutCalendars(loadPedidoScenario(42)))  →  sha256 del string
   *
   * Un cambio aquí solo es legítimo acompañando un cambio semántico deliberado del motor.
   */
  const M2_SHA256 = 'fd8dc8ec262e4b6afc20801c59b06ab9ea40f667b0ab95795d3a727308babea6';

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

    const actual = await renderPedidoScenario(degraded);
    expect(createHash('sha256').update(actual).digest('hex')).toBe(M2_SHA256);
  }, 60_000);

  // Control positivo: sin él, la huella anterior también cuadraría si el motor ignorase
  // `calendars` por completo, que es exactamente lo que R-DEG-2 tiene que distinguir.
  test('reintroducir el calendario `oficina` sí mueve el resultado', async () => {
    const source = loadPedidoScenario(42);
    const actual = await renderPedidoScenario(source);

    expect(createHash('sha256').update(actual).digest('hex')).not.toBe(M2_SHA256);
  }, 60_000);

  test('el golden de M1 tampoco se mueve al añadir calendarios al motor (R-DEG-1)', async () => {
    // La degradación total (sin recursos y sin calendarios) sigue produciendo los mismos bytes
    // versionados: los dos escalones de degradación son independientes.
    const actual = await renderPedidoScenario(withoutResourcesAndCalendars(loadPedidoScenario(42)));

    expect(actual).toBe(readFileSync(PEDIDO_GOLDEN_PATH, 'utf8'));
  }, 60_000);
});
