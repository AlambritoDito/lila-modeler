/**
 * The base scenario a process gets when nobody has configured it yet (#632): what the web app's
 * `defaultScenarios` (`apps/web/src/project.ts`) writes as `as-is.scenario.json`, without its
 * to-be and without the currency. `put_process_bpmn` gives it to a BPMN added to a `.lila`, so the
 * new process runs out of the box like one drawn with «New». Browser-safe: types only.
 */
import type { ProcessIR } from '../core/ir.js';
import type { ScenarioDocument } from './types.js';

/**
 * Arrivals of a start event nobody configured: the web app's `defaultElement('start')` (#420), 20
 * cases one minute apart.
 */
export const DEFAULT_ARRIVALS = { triggerCount: 20, interTriggerTimer: { type: 'constant', value: 60 } } as const;

/** Work time of a task nobody configured: the web app's `defaultElement('task')`, one minute. */
export const DEFAULT_PROCESSING_TIME = { type: 'constant', value: 60 } as const;

/** The web app's `defaultScenarios` run block, without the currency. */
export const DEFAULT_RUN = {
  start: '2026-09-07T08:00:00Z',
  duration: 3600,
  warmup: 0,
  replications: 3,
  seed: 42,
  baseTimeUnit: 'min',
} as const;

/** `as-is.scenario.json` for `ir`: default arrivals on every start event and a minute of work on every task. */
export function defaultScenario(ir: ProcessIR): ScenarioDocument {
  const elements: Record<string, unknown> = {};
  for (const [id, node] of Object.entries(ir.nodes)) {
    if (node.type === 'start') elements[id] = { triggerCount: DEFAULT_ARRIVALS.triggerCount, interTriggerTimer: { ...DEFAULT_ARRIVALS.interTriggerTimer } };
    else if (node.type === 'task') elements[id] = { processingTime: { ...DEFAULT_PROCESSING_TIME } };
  }
  return { version: 1, name: 'AS-IS', model: 'model.bpmn', run: { ...DEFAULT_RUN }, elements };
}
