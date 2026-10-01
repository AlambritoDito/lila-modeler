/**
 * #396 — per-element percentiles from the log sample: the population rules of the engine
 * (completed instances, one per activity instance, measured cohort after `run.warmup`).
 */
import { describe, expect, it } from 'vitest';
import type { EventLogRow } from '@lila-modeler/engine';
import { ESPERA, muestrasPorElemento, percentil, percentilesPorElemento } from './percentilesPorElemento';

function fila(parcial: Partial<EventLogRow>): EventLogRow {
  return {
    replication: 0, caseId: '1', activityInstanceId: 'a', elementId: 'T', resourceId: 'p', allocationIndex: 0,
    resourceQuantity: 1, status: 'completed', enabledAt: 0, startedAt: 0, endedAt: 1, observedUntil: 1,
    resourceWait: 0, offHoursWait: 0, elementCost: 0, resourceCost: 0, cost: 0, ...parcial,
  };
}

describe('percentil', () => {
  it('interpolates linearly over the sorted sample, like the engine', () => {
    expect(percentil([10, 0], 0.95)).toBeCloseTo(9.5);
    expect(percentil([1, 2, 3], 0.5)).toBe(2);
    expect(percentil([], 0.5)).toBeNaN();
  });
});

describe('muestrasPorElemento', () => {
  it('counts an instance with two pool rows once, and only completed ones', () => {
    const rows = [
      fila({ activityInstanceId: 'x', resourceWait: 10 }),
      fila({ activityInstanceId: 'x', resourceWait: 10, resourceId: 'q', allocationIndex: 1 }),
      fila({ activityInstanceId: 'y', resourceWait: 20, offHoursWait: 5 }),
      fila({ activityInstanceId: 'z', resourceWait: 999, status: 'inFlight' }),
    ];
    expect(muestrasPorElemento(rows).get('T')).toEqual([10, 25]);
  });

  it('drops every row of a case that started before the warmup, dated by its earliest row', () => {
    const rows = [
      fila({ caseId: '1', activityInstanceId: 'a', elementId: 'A', enabledAt: 50 }),
      fila({ caseId: '1', activityInstanceId: 'b', elementId: 'T', enabledAt: 200, resourceWait: 7 }),
      fila({ caseId: '2', activityInstanceId: 'c', elementId: 'T', enabledAt: 100, resourceWait: 3 }),
      // Same caseId in another replication is another case.
      fila({ replication: 1, caseId: '1', activityInstanceId: 'a', elementId: 'T', enabledAt: 150, resourceWait: 4 }),
    ];
    expect(muestrasPorElemento(rows, 100).get('T')).toEqual([3, 4]);
    expect(muestrasPorElemento(rows, 0).get('T')).toEqual([7, 3, 4]);
  });

  it('takes any measure, and percentilesPorElemento returns the asked percentiles in order', () => {
    const rows = [0, 10, 20, 30, 40].map((v, i) => fila({ activityInstanceId: `i${i}`, startedAt: 0, endedAt: v }));
    const duracion = (r: EventLogRow): number => (r.endedAt ?? r.observedUntil) - (r.startedAt ?? 0);
    expect(percentilesPorElemento(rows, [0.5, 0.95], { medida: duracion }).get('T')).toEqual([20, 38]);
    expect(percentilesPorElemento(rows, [0.5]).get('T')).toEqual([ESPERA(rows[0]!)]);
  });
});
