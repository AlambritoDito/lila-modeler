import { describe, expect, test } from 'vitest';

import type { Flow, Node, NodeType, ProcessIR } from '../../src/core/ir.js';
import { aggregateReplication } from '../../src/core/metrics.js';
import { runReplication, type SimScenario } from '../../src/core/sim.js';

/**
 * #82 in the simulator: a mid-week holiday (R-CAL-14) and a monthly calendar (R-CAL-12) through
 * `runReplication`, with a fixed seed. The IR is built by hand, as in `sim.calendar.test.ts`.
 */

function makeIr(
  nodes: Record<string, NodeType>,
  flows: Record<string, readonly [from: string, to: string]>,
): ProcessIR {
  const irNodes: Record<string, Node> = {};
  for (const [id, type] of Object.entries(nodes)) irNodes[id] = { type, name: '', incoming: [], outgoing: [] };
  const irFlows: Record<string, Flow> = {};
  for (const [id, [from, to]] of Object.entries(flows)) {
    irFlows[id] = { from, to, name: '', isDefault: false };
    irNodes[from]!.outgoing.push(id);
    irNodes[to]!.incoming.push(id);
  }
  return {
    id: 'Process_Dated',
    name: '',
    nodes: irNodes,
    flows: irFlows,
    source: { exporter: 'test', exporterVersion: '0', originalIds: {} },
  };
}

const HOUR = 3600;
const DAY = 86400;
const WEEK = 7 * DAY;

/** Monday 2026-09-07 08:00; Wednesday 2026-09-09 is the holiday. */
const MONDAY_0800 = '2026-09-07T08:00:00-06:00';
const WEDNESDAY = { from: 2 * DAY - 8 * HOUR, to: 3 * DAY - 8 * HOUR };

const ir = makeIr({ Start: 'start', Tarea: 'task', End: 'end' }, { F1: ['Start', 'Tarea'], F2: ['Tarea', 'End'] });
const weekdays = { days: ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const, from: '09:00', to: '17:00' };

function scenario(holidays?: string[]): SimScenario {
  return {
    run: { start: MONDAY_0800, duration: 2 * WEEK, seed: 7 },
    calendars: { oficina: holidays === undefined ? { intervals: [weekdays] } : { intervals: [weekdays], holidays } },
    resources: { cajero: { capacity: 1, calendar: 'oficina' } },
    elements: {
      Start: { interTriggerTimer: { type: 'exponential', mean: 4 * HOUR } },
      Tarea: { processingTime: { type: 'exponential', mean: 30 * 60 }, resources: [{ ref: 'cajero' }] },
    },
  };
}

describe('a mid-week holiday (R-CAL-14) with a fixed seed', () => {
  const without = runReplication(ir, scenario());
  const withHoliday = runReplication(ir, scenario(['2026-09-09']));
  const base = aggregateReplication(ir, without, scenario());
  const holiday = aggregateReplication(ir, withHoliday, scenario(['2026-09-09']));

  test('same arrivals (the start has no calendar): only the pool changes', () => {
    expect(withHoliday.cases.map((c) => c.startedAt)).toEqual(without.cases.map((c) => c.startedAt));
  });

  test('nothing is worked on the holiday; without it, Wednesday is worked', () => {
    const workedWednesday = (rows: typeof without.rows): number =>
      rows.filter((row) => row.startedAt !== undefined && row.startedAt >= WEDNESDAY.from && row.startedAt < WEDNESDAY.to)
        .length;
    expect(workedWednesday(without.rows)).toBeGreaterThan(0);
    expect(workedWednesday(withHoliday.rows)).toBe(0);
  });

  test('available time drops by one 8 h day, so utilization rises', () => {
    const before = base.resources.cajero!;
    const after = holiday.resources.cajero!;
    expect(after.utilization).toBeGreaterThan(before.utilization);
    // Same work over 72 h instead of 80 h (two weeks of Mon–Fri 09–17, minus Wednesday).
    expect(after.busyTime / after.utilization).toBeCloseTo(72 * HOUR, 6);
    expect(before.busyTime / before.utilization).toBeCloseTo(80 * HOUR, 6);
  });

  test('waiting grows: more off-hours wait and a longer cycle time', () => {
    expect(holiday.elements.Tarea!.offHoursWait.total).toBeGreaterThan(base.elements.Tarea!.offHoursWait.total);
    const meanCycle = (run: typeof without): number => {
      const done = run.cases.filter((c) => c.endedAt !== undefined);
      return done.reduce((total, c) => total + (c.endedAt! - c.startedAt), 0) / done.length;
    };
    expect(meanCycle(withHoliday)).toBeGreaterThan(meanCycle(without));
  });

  test('a holiday outside the run changes nothing (R-DEG-2 in spirit)', () => {
    const outside = runReplication(ir, scenario(['2025-12-25']));
    expect(outside.rows.map((row) => [row.startedAt, row.endedAt])).toEqual(
      without.rows.map((row) => [row.startedAt, row.endedAt]),
    );
  });
});

describe('a monthly calendar in the simulator (R-CAL-12)', () => {
  test('a task on a "last day of the month" calendar waits for it', () => {
    const run = runReplication(ir, {
      run: { start: '2026-04-01T00:00:00Z', seed: 1 },
      calendars: { cierre: { intervals: [{ monthDays: [-1], from: '09:00', to: '17:00' }] } },
      resources: { contador: { capacity: 1, calendar: 'cierre' } },
      elements: {
        Start: { interTriggerTimer: { type: 'constant', value: 1 }, triggerCount: 1 },
        // 10 h of work: 8 h on April 30, 2 h on May 31.
        Tarea: { processingTime: { type: 'constant', value: 10 * HOUR }, resources: [{ ref: 'contador' }] },
      },
    });
    const row = run.rows.find((r) => r.elementId === 'Tarea')!;
    expect(row.startedAt).toBe(29 * DAY + 9 * HOUR);
    expect(row.endedAt).toBe(60 * DAY + 11 * HOUR);
    expect(row.endedAt! - row.enabledAt).toBe(row.resourceWait + row.offHoursWait + 10 * HOUR);
  });
});

describe('the process timezone does not matter (R-DET-5)', () => {
  test('the same run under two TZ values is identical', () => {
    const previous = process.env['TZ'];
    try {
      process.env['TZ'] = 'Pacific/Kiritimati';
      const east = runReplication(ir, scenario(['2026-09-09', '12-25']));
      process.env['TZ'] = 'America/Los_Angeles';
      const west = runReplication(ir, scenario(['2026-09-09', '12-25']));
      expect(west.rows).toEqual(east.rows);
    } finally {
      if (previous === undefined) delete process.env['TZ'];
      else process.env['TZ'] = previous;
    }
  });
});
