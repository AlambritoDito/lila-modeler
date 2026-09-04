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
  });

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
