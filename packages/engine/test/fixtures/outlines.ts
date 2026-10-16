/**
 * Outlines for the #97 tests. `CREDIT` is the example of the issue, verbatim (also
 * `examples/outline/credit-application.json`); `ORDER` exercises every step type.
 */
import type { Outline } from '../../src/bpmn/outline.js';

/** The example of issue #97, verbatim. */
export const CREDIT: Outline = {
  name: 'Credit application',
  lanes: ['Customer', 'Analyst'],
  steps: [
    { id: 'receive', name: 'Receive application', lane: 'Analyst' },
    { id: 'check', name: 'Check bureau', lane: 'Analyst', duration: 'normal(20m, 5m)' },
    {
      id: 'ok',
      type: 'xor',
      name: 'Approved?',
      branches: [
        { label: 'Yes', to: 'issue' },
        { label: 'No', to: 'reject', probability: 0.3 },
      ],
    },
    { id: 'issue', name: 'Issue card', end: true },
    { id: 'reject', name: 'Notify rejection', lane: 'Customer', end: true },
  ],
};

/** Every step type, a parallel split and join, a loop back and three lanes. */
export const ORDER: Outline = {
  name: 'Order fulfilment',
  lanes: ['Sales', 'Warehouse', 'Finance'],
  steps: [
    { id: 'take', name: 'Take order', type: 'userTask', lane: 'Sales', duration: 'triangular(1m, 2m, 5m)', resources: ['Clerk'] },
    { id: 'split', type: 'and', next: ['pick', 'invoice'] },
    { id: 'pick', name: 'Pick items', lane: 'Warehouse', duration: 300, resources: [{ name: 'Picker', quantity: 2 }], next: 'join' },
    { id: 'invoice', name: 'Invoice', type: 'serviceTask', lane: 'Finance', next: 'join' },
    { id: 'join', type: 'and', lane: 'Sales' },
    { id: 'wait', name: 'Wait a day', type: 'timer', duration: '1d' },
    { id: 'review', name: 'Review', type: 'subprocess' },
    { id: 'good', type: 'xor', name: 'OK?', branches: [{ label: 'no', to: 'fix', probability: 0.1 }, { label: 'yes', to: 'ship' }] },
    { id: 'fix', name: 'Fix', type: 'callActivity', next: 'review' },
    { id: 'ship', name: 'Ship', lane: 'Warehouse' },
    { id: 'notify', name: 'Notify', type: 'or', branches: [{ to: 'mail', probability: 0.5 }, { to: 'sms', probability: 0.8 }] },
    { id: 'mail', name: 'Mail', end: true },
    { id: 'sms', name: 'SMS', end: true },
  ],
};

/**
 * #631: one outline per construct the simulator runs and the outline now says, each small and
 * runnable. The e2e test `packages/mcp/test/outline-constructs.e2e.test.ts` simulates each one.
 */
export const CONSTRUCTS: Record<string, Outline> = {
  'task variants': {
    name: 'Task variants',
    steps: [
      { id: 'send', type: 'sendTask', duration: '1m' },
      { id: 'receive', type: 'receiveTask', duration: '1m' },
      { id: 'manual', type: 'manualTask', duration: '1m' },
      { id: 'script', type: 'scriptTask', duration: '1m' },
      { id: 'rule', type: 'businessRuleTask', duration: '1m', end: true },
    ],
  },
  'terminate ends': {
    name: 'Terminate ends',
    steps: [
      { id: 'split', type: 'and', next: ['fast', 'slow'] },
      { id: 'fast', name: 'Fast', duration: '1m', end: 'terminate' },
      { id: 'slow', name: 'Slow', duration: '10m', next: 'check' },
      { id: 'check', type: 'xor', branches: [{ label: 'Abort', end: 'terminate', probability: 0.5 }, { label: 'Done', end: true }] },
    ],
  },
  'starts and a timer start': {
    name: 'Two starts',
    lanes: ['Front', 'Back'],
    starts: [
      { id: 'walkIn', name: 'Customer walks in' },
      { id: 'nightly', name: 'Every night', type: 'timer', lane: 'Back' },
    ],
    steps: [
      { id: 'serve', name: 'Serve', lane: 'Front', from: 'walkIn', duration: '2m', next: 'file' },
      { id: 'batch', name: 'Batch', lane: 'Back', from: 'nightly', duration: '5m' },
      { id: 'file', name: 'File', lane: 'Back', duration: '1m', end: true },
    ],
  },
  'default flows': {
    name: 'Default flows',
    steps: [
      { id: 'kind', type: 'xor', branches: [{ label: 'Simple', to: 'fast', probability: 0.6 }, { label: 'Other', to: 'review', default: true }] },
      { id: 'fast', duration: '1m', end: true },
      { id: 'review', duration: '5m', next: 'extras' },
      { id: 'extras', type: 'or', branches: [{ to: 'gift', probability: 0.3 }, { to: 'mail', default: true }] },
      { id: 'gift', duration: '1m', end: true },
      { id: 'mail', duration: '1m', end: true },
    ],
  },
  'boundary timers': {
    name: 'Boundary timers',
    steps: [
      {
        id: 'work',
        name: 'Work',
        duration: '30m',
        boundary: [
          { id: 'late', type: 'timer', duration: '20m', interrupting: false, label: 'Late', to: 'warn' },
          { id: 'cut', type: 'timer', duration: '40m', end: 'terminate' },
        ],
      },
      { id: 'call', name: 'Call', type: 'callActivity', duration: '10m', boundary: [{ id: 'hang', type: 'timer', duration: '5m', to: 'retry' }], end: true },
      { id: 'warn', name: 'Warn', duration: '1m', end: true },
      { id: 'retry', name: 'Retry later', duration: '1m', end: true },
    ],
  },
  'event gateway': {
    name: 'Event gateway',
    steps: [
      { id: 'ask', name: 'Ask', type: 'sendTask', duration: '1m' },
      { id: 'wait', type: 'eventGateway', name: 'Reply?', branches: [{ to: 'answer' }, { to: 'timeout' }] },
      { id: 'answer', type: 'message', name: 'Answer', duration: 'exponential(mean=20m)', next: 'close' },
      { id: 'timeout', type: 'timer', name: '30 min', duration: '30m', end: 'terminate' },
      { id: 'close', name: 'Close', duration: '1m', end: true },
    ],
  },
};
