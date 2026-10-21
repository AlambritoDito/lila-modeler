/**
 * A synthetic version 3 `.lila` (RM-01 § 1, #92), zipped by hand entry by entry — not by
 * `encodeLila` — so a decode → encode round trip that gives back these bytes proves the codec, not
 * that the codec agrees with itself. All names are invented (`docs/EXAMPLES_POLICY.md`).
 *
 * It holds two processes, one object of each lot A1 type (a `document` with a `url`, a `system`
 * written compactly and with a field this build does not know), a `risk` (a type this build does
 * not know), a broken object (no `name`) and a `maps/x.json` (a reserved name), in the canonical
 * order of RM-01 § 1.5. `notes` adds a `notes.md` (an entry this build does not understand).
 */
import { strToU8, zipSync } from 'fflate';

import { version as engineVersion } from '../../../src/version.js';

/** The fixed timestamp of `encodeLila`: local midday on 1980-01-02. */
const MTIME = new Date(1980, 0, 2, 12, 0, 0, 0);

export const FRONT_DESK_ID = 'process-4k9w2m7q1z8c';
export const BILLING_ID = 'process-p0x3n8d2r5ta';
export const RECEPTIONIST = 'role-7k2m9q4x1pzd';
export const FRONT_OFFICE = 'unit-b3r8w1c6k0qe';
export const BOOKING_SYSTEM = 'system-m4q8w2k6z1rd';
export const CHECK_IN_FORM = 'document-x9d2k7m4q1wa';
export const NO_SHOW_RISK = 'risk-c5n2v8b1x7qa';
export const BROKEN = 'role-broken0broken';

function model(processId: string, name: string, task: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:lila="https://lila-modeler.org/schema/bpmn/1" id="Defs_${processId}" targetNamespace="https://lila-modeler.org/bpmn">
  <bpmn:process id="${processId}" name="${name}" isExecutable="false">
    <bpmn:startEvent id="Start_1"><bpmn:outgoing>Flow_1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:task id="Task_1" name="${task}">
      <bpmn:extensionElements><lila:responsibility type="R" roleRef="${RECEPTIONIST}" /><lila:systemRef ref="${BOOKING_SYSTEM}" /></bpmn:extensionElements>
      <bpmn:incoming>Flow_1</bpmn:incoming><bpmn:outgoing>Flow_2</bpmn:outgoing>
    </bpmn:task>
    <bpmn:endEvent id="End_1"><bpmn:incoming>Flow_2</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1" />
  </bpmn:process>
</bpmn:definitions>
`;
}

const scenario = {
  version: 1,
  name: 'AS-IS',
  model: 'model.bpmn',
  run: { start: '2026-09-07T08:00:00Z', duration: 3600, warmup: 0, replications: 1, seed: 42, baseTimeUnit: 'min' },
  elements: {
    Start_1: { triggerCount: 5, interTriggerTimer: { type: 'constant', value: 60 } },
    Task_1: { processingTime: { type: 'constant', value: 30 } },
  },
};

const pretty = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** The entries of the fixture, in archive order, as text. */
export function v3Entries(options: { readonly notes?: boolean } = {}): [string, string][] {
  const manifest = {
    version: 3,
    id: '0f6b9d2a-3c41-4e7a-9b15-6d2e8f0a1c37',
    name: 'Hotel front office',
    processes: [
      {
        id: FRONT_DESK_ID,
        slug: 'front-desk',
        name: 'Front desk',
        model: { id: 'Process_FrontDesk', name: 'model.bpmn', revision: 2 },
        scenarioRevisions: { 'as-is.scenario.json': 1 },
      },
      {
        id: BILLING_ID,
        slug: 'billing',
        name: 'Billing',
        model: { id: 'Process_Billing', name: 'model.bpmn', revision: 1 },
        scenarioRevisions: { 'as-is.scenario.json': 1 },
      },
    ],
    engine: engineVersion,
  };
  const entries: [string, string][] = [
    ['lila-project.json', pretty(manifest)],
    ['processes/front-desk/model.bpmn', model('Process_FrontDesk', 'Front desk', 'Check the guest in')],
    ['processes/front-desk/as-is.scenario.json', pretty(scenario)],
    ['processes/billing/model.bpmn', model('Process_Billing', 'Billing', 'Issue the invoice')],
    ['processes/billing/as-is.scenario.json', pretty(scenario)],
    [
      `catalog/document/${CHECK_IN_FORM}.json`,
      pretty({
        type: 'document',
        id: CHECK_IN_FORM,
        name: 'Check-in form',
        revision: 1,
        ownerRef: RECEPTIONIST,
        url: 'https://example.org/forms/check-in',
        attributes: [{ name: 'Retention', value: '1 year' }],
      }),
    ],
    [
      `catalog/risk/${NO_SHOW_RISK}.json`,
      pretty({ type: 'risk', id: NO_SHOW_RISK, name: 'Guest does not show up', revision: 3, likelihood: 'medium' }),
    ],
    [
      `catalog/role/${RECEPTIONIST}.json`,
      pretty({ type: 'role', id: RECEPTIONIST, name: 'Receptionist', description: 'Welcomes guests.', revision: 2, unitRef: FRONT_OFFICE }),
    ],
    // Written compactly and with a field this build does not know: kept as it is.
    [
      `catalog/system/${BOOKING_SYSTEM}.json`,
      `${JSON.stringify({ type: 'system', id: BOOKING_SYSTEM, name: 'Booking system', revision: 1, vendor: 'In-house', ownerRef: RECEPTIONIST })}\n`,
    ],
    [`catalog/unit/${FRONT_OFFICE}.json`, pretty({ type: 'unit', id: FRONT_OFFICE, name: 'Front office', revision: 1 })],
    // Kept entries come last, sorted by name: the broken object (no `name`) and a reserved name.
    [`catalog/role/${BROKEN}.json`, '{ "type": "role", "id": "role-broken0broken", "revision": 1 }\n'],
    ['maps/x.json', pretty({ nodes: [{ process: FRONT_DESK_ID }] })],
  ];
  if (options.notes === true) entries.push(['notes.md', '# Notes\n\nKept by every save.\n']);
  return entries;
}

/** The fixture as a `.lila`, zipped the way `encodeLila` zips (level 6, fixed mtime). */
export function v3Fixture(options: { readonly notes?: boolean } = {}): Uint8Array {
  return zipSync(Object.fromEntries(v3Entries(options).map(([name, text]) => [name, [strToU8(text), { mtime: MTIME, level: 6 }]])));
}
