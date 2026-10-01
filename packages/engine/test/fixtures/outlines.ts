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
