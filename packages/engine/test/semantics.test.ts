import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

import {
  loadPedidoScenario,
  PEDIDO_GOLDEN_PATH,
  renderPedidoScenario,
  withoutResourcesAndCalendars,
} from './golden/pedido.js';

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
});
