import { describe, expect, test } from 'vitest';

import { simulate } from '../../src/index.js';
import type { ProcessIR } from '../../src/core/ir.js';
import type { SimScenario } from '../../src/core/sim.js';

const IR: ProcessIR = {
  id: 'Process_QA',
  name: '',
  nodes: {
    Start: { type: 'start', name: '', incoming: [], outgoing: ['Flow_SA'] },
    A: { type: 'task', name: '', incoming: ['Flow_SA'], outgoing: ['Flow_AE'] },
    End: { type: 'end', name: '', incoming: ['Flow_AE'], outgoing: [] },
  },
  flows: {
    Flow_SA: { from: 'Start', to: 'A', name: '', isDefault: false },
    Flow_AE: { from: 'A', to: 'End', name: '', isDefault: false },
  },
  source: { exporter: 'qa', exporterVersion: '0', originalIds: {} },
};

function scenario(replications = 1): SimScenario {
  return {
    run: { duration: 100, replications, seed: 7 },
    elements: {
      Start: { interTriggerTimer: { type: 'constant', value: 10 }, triggerCount: 3 },
      A: { processingTime: { type: 'constant', value: 5 } },
    },
  };
}

describe('QA adversarial de simulate (LILA-029)', () => {
  test('la cancelacion desde onEvent termina la transicion DES actual antes de cortar', () => {
    const controller = new AbortController();

    const result = simulate(IR, scenario(3), {
      signal: controller.signal,
      onEvent: () => controller.abort(),
    });

    expect(result).toMatchObject({ cancelled: true, completedReplications: 0 });
    expect(result.elements.A).toMatchObject({ started: 1, completed: 1 });
    // Recorrer el flujo saliente forma parte de completar A y consume cero segundos (R-TOK-4).
    expect(result.flows).toMatchObject({ Flow_SA: { count: 1 }, Flow_AE: { count: 1 } });
  });

  test('log false no ejecuta un callback con efectos laterales ni cancela la corrida', () => {
    const controller = new AbortController();

    const result = simulate(IR, scenario(2), {
      log: false,
      signal: controller.signal,
      onEvent: () => controller.abort(),
    });

    expect(controller.signal.aborted).toBe(false);
    expect(result.cancelled).toBeUndefined();
    expect(result.completedReplications).toBeUndefined();
    expect(result.process.completed).toBe(3);
  });

  test('el progreso empieza en cero incluso si la replica no tiene eventos', () => {
    const input = scenario();
    // Sin ninguno de los dos campos de llegada el start no genera nada (R-ARR-1, LILA-186).
    delete input.elements?.Start?.interTriggerTimer;
    delete input.elements?.Start?.triggerCount;
    const fractions: number[] = [];

    simulate(IR, input, { onProgress: ({ fraction }) => fractions.push(fraction) });

    expect(fractions).toEqual([0, 1]);
  });

  test('AbortSignal real pre-abortado no emite filas y deja un resultado determinista', () => {
    const controller = new AbortController();
    controller.abort();
    let events = 0;

    const first = simulate(IR, scenario(4), {
      signal: controller.signal,
      onEvent: () => events++,
    });
    // Ambas corridas pasan `onEvent`: con él `result.log` no se materializa (LILA-037 § 7) y la
    // comparación sigue siendo entre dos resultados construidos exactamente igual.
    const second = simulate(IR, scenario(4), { signal: controller.signal, onEvent: () => events++ });

    expect(events).toBe(0);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ cancelled: true, completedReplications: 0 });
    expect(first.replications).toBeUndefined();
  });
});
