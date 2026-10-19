/**
 * #396, moved from the web app by #666 — per-element percentiles from the log rows: the population
 * rules of the engine (completed instances, one per activity instance, measured cohort after
 * `run.warmup`).
 */
import { describe, expect, it } from 'vitest';

import type { EventLogRow } from '../src/core/result.js';
import { RESOURCE_WAIT, WAIT, elementPercentiles, elementSampler, elementSamples, percentile } from '../src/index.js';

function row(partial: Partial<EventLogRow>): EventLogRow {
  return {
    replication: 0, caseId: '1', activityInstanceId: 'a', elementId: 'T', resourceId: 'p', allocationIndex: 0,
    resourceQuantity: 1, status: 'completed', enabledAt: 0, startedAt: 0, endedAt: 1, observedUntil: 1,
    resourceWait: 0, offHoursWait: 0, elementCost: 0, resourceCost: 0, cost: 0, ...partial,
  };
}

describe('percentile', () => {
  it('interpolates linearly over the sorted sample, like the engine', () => {
    expect(percentile([10, 0], 0.95)).toBeCloseTo(9.5);
    expect(percentile([1, 2, 3], 0.5)).toBe(2);
    expect(percentile([], 0.5)).toBeNaN();
  });
});

describe('elementSamples', () => {
  it('counts an instance with two pool rows once, and only completed ones', () => {
    const rows = [
      row({ activityInstanceId: 'x', resourceWait: 10 }),
      row({ activityInstanceId: 'x', resourceWait: 10, resourceId: 'q', allocationIndex: 1 }),
      row({ activityInstanceId: 'y', resourceWait: 20, offHoursWait: 5 }),
      row({ activityInstanceId: 'z', resourceWait: 999, status: 'inFlight' }),
    ];
    expect(elementSamples(rows).get('T')).toEqual([10, 25]);
    expect(elementSamples(rows, 0, RESOURCE_WAIT).get('T')).toEqual([10, 20]);
  });

  it('drops every row of a case that started before the warmup, dated by its earliest row', () => {
    const rows = [
      row({ caseId: '1', activityInstanceId: 'a', elementId: 'A', enabledAt: 50 }),
      row({ caseId: '1', activityInstanceId: 'b', elementId: 'T', enabledAt: 200, resourceWait: 7 }),
      row({ caseId: '2', activityInstanceId: 'c', elementId: 'T', enabledAt: 100, resourceWait: 3 }),
      // Same caseId in another replication is another case.
      row({ replication: 1, caseId: '1', activityInstanceId: 'a', elementId: 'T', enabledAt: 150, resourceWait: 4 }),
    ];
    expect(elementSamples(rows, 100).get('T')).toEqual([3, 4]);
    expect(elementSamples(rows, 0).get('T')).toEqual([7, 3, 4]);
  });

  it('takes any measure, and elementPercentiles returns the asked percentiles in order', () => {
    const rows = [0, 10, 20, 30, 40].map((v, i) => row({ activityInstanceId: `i${i}`, startedAt: 0, endedAt: v }));
    const duration = (r: EventLogRow): number => (r.endedAt ?? r.observedUntil) - (r.startedAt ?? 0);
    expect(elementPercentiles(rows, [0.5, 0.95], { measure: duration }).get('T')).toEqual([20, 38]);
    expect(elementPercentiles(rows, [0.5]).get('T')).toEqual([WAIT(rows[0]!)]);
  });
});

describe('elementSampler', () => {
  it('fed one row at a time, in any order, gives what elementSamples gives', () => {
    const rows = [
      // The case's earliest row arrives last: the cohort is still decided by it.
      row({ caseId: '1', activityInstanceId: 'b', elementId: 'T', enabledAt: 200, resourceWait: 7 }),
      row({ caseId: '2', activityInstanceId: 'c', elementId: 'T', enabledAt: 100, resourceWait: 3 }),
      row({ caseId: '1', activityInstanceId: 'a', elementId: 'A', enabledAt: 50, status: 'inFlight' }),
    ];
    const sampler = elementSampler(100, RESOURCE_WAIT);
    for (const r of rows) sampler.add(r);
    expect(sampler.samples()).toEqual(elementSamples(rows, 100, RESOURCE_WAIT));
    expect(sampler.samples().get('T')).toEqual([3]);
  });

  it('with replicationsInOrder, decides each replication when the next starts, with the same result', () => {
    const rows = [
      row({ caseId: '1', activityInstanceId: 'a', enabledAt: 50, resourceWait: 1 }),
      row({ caseId: '2', activityInstanceId: 'b', enabledAt: 150, resourceWait: 2 }),
      row({ replication: 1, caseId: '1', activityInstanceId: 'a', enabledAt: 120, resourceWait: 3 }),
      row({ replication: 1, caseId: '1', activityInstanceId: 'c', enabledAt: 130, resourceWait: 4 }),
      row({ replication: 2, caseId: '1', activityInstanceId: 'a', enabledAt: 90, resourceWait: 5 }),
    ];
    const sampler = elementSampler(100, RESOURCE_WAIT, { replicationsInOrder: true });
    for (const [index, r] of rows.entries()) {
      sampler.add(r);
      // Reading in between changes nothing.
      expect(sampler.samples()).toEqual(elementSamples(rows.slice(0, index + 1), 100, RESOURCE_WAIT));
    }
    expect(sampler.samples().get('T')).toEqual([2, 3, 4]);
  });
});
